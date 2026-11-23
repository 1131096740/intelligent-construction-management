import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { PaymentCorrectionService } from "../payment/payment-correction.service";
import { PaymentRefundService } from "../payment/payment-refund.service";
import { loadSignedSettlementPaymentBasis } from "../payment/signed-settlement-payment-capacity";
import { availableRegisteredBalance } from "../payment/registered-payment-funding";

/**
 * #400 真库证据（真实 PostgreSQL 16）：
 * 1) 退款关联原实付、累计不超原实付、同键幂等回放；
 * 2) 退款后净已付与合同容量/占用变化，多付退款不新增成本事实；
 * 3) 实付更正“反转+重登”由财务主管确认，原 PaymentExecution 不改；
 * 4) 财务主管本人发起/原登记人确认时强制自审原因；
 * 5) 数据库触发器兜底累计退款上限。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue400-financial-correction-local.cjs
 */
describe("issue 400 financial correction and refund PostgreSQL", () => {
  const integrationTest = process.env.ISSUE400_FINANCIAL_CORRECTION_RUN === "1" ? it : it.skip;

  integrationTest("registers refunds and corrections as new facts without rewriting the original payment", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const auth = {
      confirmPassword: async (_userId: string, password: string) => {
        if (password !== "current-password") throw new Error("密码错误");
      }
    };
    const refunds = new PaymentRefundService(prisma as never, new AuditService());
    const corrections = new PaymentCorrectionService(prisma as never, new AuditService(), auth as never);
    try {
      // 1) 已确认结算 1000，付款申请只批 800，实际付 1000（多付 200）。退款 200。
      const before = await loadSignedSettlementPaymentBasis(prisma as never, fixture.refundContractId);
      expect(before.confirmedCents).toBe(100000n);
      expect(before.netPaidCents).toBe(100000n);
      expect(before.remainingCents).toBe(0n);

      const refund = await refunds.recordRefund(
        fixture.refundPaymentId,
        fixture.refundExecutionId,
        fixture.staffUserId,
        {
          amountCents: "20000",
          receivedAt: "2026-11-20",
          reason: "多付款退回",
          evidenceReference: "BANK-REFUND-400-1",
          idempotencyKey: randomUUID()
        }
      );
      expect(refund).toMatchObject({
        amountCents: "20000",
        originalPaidCents: "100000",
        refundedCents: "20000",
        netPaidCents: "80000",
        status: "paid"
      });
      assert.ok(refund.fundRegistrationId);

      const after = await loadSignedSettlementPaymentBasis(prisma as never, fixture.refundContractId);
      expect(after.netPaidCents).toBe(80000n);
      expect(after.outstandingCents).toBe(0n);
      expect(after.remainingCents).toBe(20000n);
      const originalExecution = await prisma.paymentExecution.findUniqueOrThrow({ where: { id: fixture.refundExecutionId } });
      expect(originalExecution.amountCents).toBe(100000n);
      const accountBalance = await readAvailableBalance(prisma, fixture.accountId);
      expect(accountBalance).toBe(220000n);
      expect(await countCostImpacts(prisma)).toBe(0);

      // 2) 同键重试只回放原退款，不新增第二笔。
      const replay = await refunds.recordRefund(
        fixture.refundPaymentId,
        fixture.refundExecutionId,
        fixture.staffUserId,
        {
          amountCents: "20000",
          receivedAt: "2026-11-20",
          reason: "多付款退回",
          evidenceReference: "BANK-REFUND-400-1",
          idempotencyKey: (await prisma.paymentExecutionRefund.findUniqueOrThrow({ where: { id: refund.refundId } })).idempotencyKey
        }
      );
      expect(replay.refundId).toBe(refund.refundId);
      expect(replay.idempotent).toBe(true);
      expect(await prisma.paymentExecutionRefund.count({ where: { paymentExecutionId: fixture.refundExecutionId } })).toBe(1);

      // 3) 累计退款超过原实付被拒；数据库触发器也兜底同一上限。
      // 先补一笔 500 的实付，使“当前净已付”大于“本笔原实付剩余可退”，
      // 从而单独验证按执行事实累计的上限。
      const secondExecutionId = randomUUID();
      await prisma.paymentExecution.create({
        data: {
          id: secondExecutionId, idempotencyKey: `exec-refund-second-${fixture.prefix}`,
          paymentRequestId: fixture.refundPaymentId, paymentSubjectType: "our_company",
          companyEntityIdSnapshot: randomUUID(), companyEntityNameSnapshot: "我方公司",
          companyEntityCreditCodeSnapshot: "91350000TEST400000",
          amountCents: 50000n, paidAt: new Date("2026-11-02T00:00:00.000Z"), executedByUserId: fixture.staffUserId
        }
      });
      await prisma.paymentRequest.update({ where: { id: fixture.refundPaymentId }, data: { paidAmountCents: 130000n, status: "paid" } });
      await expect(refunds.recordRefund(fixture.refundPaymentId, fixture.refundExecutionId, fixture.staffUserId, {
        amountCents: "90000",
        receivedAt: "2026-11-21",
        reason: "重复退款测试",
        idempotencyKey: randomUUID()
      })).rejects.toThrow("累计退款");
      await expect(prisma.paymentExecutionRefund.create({
        data: {
          idempotencyKey: randomUUID(),
          paymentExecutionId: fixture.refundExecutionId,
          paymentRequestId: fixture.refundPaymentId,
          projectId: fixture.projectId,
          amountCents: 90000n,
          receivedAt: new Date("2026-11-21T00:00:00.000Z"),
          reason: "数据库兜底测试",
          recordedByUserId: fixture.staffUserId,
          payloadFingerprint: "f".repeat(64)
        }
      })).rejects.toThrow();
      expect(await prisma.paymentExecutionRefund.count({ where: { paymentExecutionId: fixture.refundExecutionId } })).toBe(1);

      // 4) 实付更正：员工发起，财务主管确认，原实付不改写，净已付 1000→800。
      const requested = await corrections.request(
        fixture.correctionPaymentId,
        fixture.correctionExecutionId,
        fixture.staffUserId,
        {
          correctedAmountCents: "80000",
          correctedPaidAt: "2026-11-02",
          correctionReason: "原登记金额多记 200",
          idempotencyKey: randomUUID()
        }
      );
      expect(requested).toMatchObject({ status: "pending_confirm", originalAmountCents: "100000", correctedAmountCents: "80000", amountDeltaCents: "-20000" });
      const confirmed = await corrections.confirm(requested.correctionId, fixture.directorUserId, {
        confirmationPassword: "current-password",
        idempotencyKey: randomUUID(),
        reviewNote: "核对银行流水后确认"
      });
      expect(confirmed).toMatchObject({ status: "confirmed", netPaidCents: "80000" });
      const correctionPayment = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: fixture.correctionPaymentId } });
      expect(correctionPayment.paidAmountCents).toBe(80000n);
      const untouchedExecution = await prisma.paymentExecution.findUniqueOrThrow({ where: { id: fixture.correctionExecutionId } });
      expect(untouchedExecution.amountCents).toBe(100000n);
      const stored = await prisma.paymentExecutionCorrection.findUniqueOrThrow({ where: { id: requested.correctionId } });
      expect(stored.originalSnapshot).toMatchObject({ entryKind: "original", amountCents: "100000" });
      expect(stored.reversalSnapshot).toMatchObject({ entryKind: "reversal", amountCents: "100000" });
      expect(stored.correctionSnapshot).toMatchObject({ entryKind: "correction", amountCents: "80000" });
      expect(await prisma.paymentExecutionCorrection.count({ where: { paymentRequestId: fixture.correctionPaymentId, status: "confirmed" } })).toBe(1);

      // 5) 财务主管本人发起、本人确认：必须填写自审原因。
      const selfRequested = await corrections.request(
        fixture.selfReviewPaymentId,
        fixture.selfReviewExecutionId,
        fixture.directorUserId,
        {
          correctedAmountCents: "80000",
          correctedPaidAt: "2026-11-02",
          correctionReason: "主管本人更正",
          idempotencyKey: randomUUID()
        }
      );
      await expect(corrections.confirm(selfRequested.correctionId, fixture.directorUserId, {
        confirmationPassword: "current-password",
        idempotencyKey: randomUUID()
      })).rejects.toThrow("自审原因");
      const selfConfirmed = await corrections.confirm(selfRequested.correctionId, fixture.directorUserId, {
        confirmationPassword: "current-password",
        idempotencyKey: randomUUID(),
        selfReviewReason: "本人核对原付款凭证后自审"
      });
      expect(selfConfirmed).toMatchObject({ status: "confirmed", netPaidCents: "80000" });
      // 同键重试确认回放，不生成第二份补偿。
      const replayConfirmed = await corrections.confirm(selfRequested.correctionId, fixture.directorUserId, {
        confirmationPassword: "current-password",
        idempotencyKey: (await prisma.paymentExecutionCorrection.findUniqueOrThrow({ where: { id: selfRequested.correctionId } })).confirmationKey!
      });
      expect(replayConfirmed.idempotent).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });
});

function assertDedicatedDatabase() {
  const url = process.env.ISSUE400_FINANCIAL_CORRECTION_DATABASE_URL;
  assert.ok(url, "缺少 ISSUE400_FINANCIAL_CORRECTION_DATABASE_URL");
  assert.match(url, /^postgresql:\/\/[^/]+\/jiangkong_issue400_[a-z_]+(\?.*)?$/u);
  return url;
}

async function readAvailableBalance(prisma: PrismaClient, accountId: string) {
  const current = await prisma.fundAccountBalanceRegistration.findFirstOrThrow({
    where: { accountId, status: "confirmed" },
    orderBy: { version: "desc" },
    include: { sources: true }
  });
  const available = await availableRegisteredBalance(prisma as never, current);
  return BigInt(available.balanceYuan!.times(100).toFixed(0));
}

async function countCostImpacts(prisma: PrismaClient) {
  return prisma.operatingImpactEntry.count({ where: { impactKind: "confirmed_cost" } });
}

async function seedFixture(prisma: PrismaClient) {
  const prefix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const staffUserId = randomUUID();
  const directorUserId = randomUUID();
  const accountId = randomUUID();
  const openingId = randomUUID();
  const sourceBatchId = randomUUID();
  const financeStaffPositionId = randomUUID();
  const financeDirectorPositionId = randomUUID();
  await prisma.project.create({ data: { id: projectId, code: `P400-${prefix}`, name: `#400 真库项目 ${prefix}` } });
  await prisma.user.createMany({ data: [{ id: staffUserId, name: "财务经办" }, { id: directorUserId, name: "财务主管" }] });
  await prisma.position.createMany({
    data: [
      { id: financeStaffPositionId, key: `finance_staff`, name: "财务人员" },
      { id: financeDirectorPositionId, key: `finance_director`, name: "财务主管" }
    ]
  });
  await prisma.userPosition.createMany({
    data: [
      { userId: staffUserId, positionId: financeStaffPositionId },
      { userId: directorUserId, positionId: financeDirectorPositionId }
    ]
  });
  await prisma.registeredFundAccount.create({
    data: { id: accountId, scopeKey: "public_cash", kind: "public_cash" }
  });
  await prisma.fundAccountBalanceRegistration.create({
    data: {
      id: openingId, accountId, version: 1, kind: "opening", status: "confirmed",
      balanceYuan: 5000, asOfDate: "2026-11-01", evidenceReference: `OPEN-${prefix}`,
      reconciliationNote: "真库期初", reason: "真库期初", idempotencyKey: `opening-${prefix}`,
      payloadFingerprint: "a".repeat(64), createdByUserId: staffUserId,
      confirmedByUserId: staffUserId, confirmedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.fundAccountSourceBatch.create({
    data: {
      id: sourceBatchId, registrationId: openingId, lineNo: 1, amountYuan: 5000,
      sourceStatus: "known", sourceName: "期初", projectStatus: "project", projectId
    }
  });
  const refundContractId = randomUUID();
  const correctionContractId = randomUUID();
  const selfReviewContractId = randomUUID();
  await prisma.signedContractSettlement.createMany({
    data: [
      { id: randomUUID(), projectId, contractKind: "downstream", contractId: refundContractId, ownerUserId: staffUserId, number: `SS-REFUND-${prefix}`, amountYuan: 1000, state: "confirmed", confirmationNo: 1n, reviewedAt: new Date("2026-11-01T00:00:00.000Z"), reviewedByUserId: directorUserId },
      { id: randomUUID(), projectId, contractKind: "downstream", contractId: correctionContractId, ownerUserId: staffUserId, number: `SS-CORR-${prefix}`, amountYuan: 1000, state: "confirmed", confirmationNo: 2n, reviewedAt: new Date("2026-11-01T00:00:00.000Z"), reviewedByUserId: directorUserId },
      { id: randomUUID(), projectId, contractKind: "downstream", contractId: selfReviewContractId, ownerUserId: staffUserId, number: `SS-SELF-${prefix}`, amountYuan: 1000, state: "confirmed", confirmationNo: 3n, reviewedAt: new Date("2026-11-01T00:00:00.000Z"), reviewedByUserId: directorUserId }
    ]
  });
  const refundPaymentId = randomUUID();
  const correctionPaymentId = randomUUID();
  const selfReviewPaymentId = randomUUID();
  await prisma.paymentRequest.createMany({
    data: [
      { id: refundPaymentId, projectId, contractId: refundContractId, contractVersionId: randomUUID(), paymentTermsVersionId: randomUUID(), code: `PAY-REFUND-${prefix}`, status: "paid", requestedAmountCents: 80000n, approvedAmountCents: 80000n, paidAmountCents: 100000n, sourceType: "signed_settlement", signedSettlementId: null },
      { id: correctionPaymentId, projectId, contractId: correctionContractId, contractVersionId: randomUUID(), paymentTermsVersionId: randomUUID(), code: `PAY-CORR-${prefix}`, status: "paid", requestedAmountCents: 100000n, approvedAmountCents: 100000n, paidAmountCents: 100000n, sourceType: "signed_settlement", signedSettlementId: null },
      { id: selfReviewPaymentId, projectId, contractId: selfReviewContractId, contractVersionId: randomUUID(), paymentTermsVersionId: randomUUID(), code: `PAY-SELF-${prefix}`, status: "paid", requestedAmountCents: 100000n, approvedAmountCents: 100000n, paidAmountCents: 100000n, sourceType: "signed_settlement", signedSettlementId: null }
    ]
  });
  const refundExecutionId = randomUUID();
  const correctionExecutionId = randomUUID();
  const selfReviewExecutionId = randomUUID();
  const executions = [
    { id: refundExecutionId, paymentRequestId: refundPaymentId, amountCents: 100000n, idempotencyKey: `exec-refund-${prefix}` },
    { id: correctionExecutionId, paymentRequestId: correctionPaymentId, amountCents: 100000n, idempotencyKey: `exec-corr-${prefix}` },
    { id: selfReviewExecutionId, paymentRequestId: selfReviewPaymentId, amountCents: 100000n, idempotencyKey: `exec-self-${prefix}` }
  ];
  for (const execution of executions) {
    await prisma.paymentExecution.create({
      data: {
        ...execution,
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: randomUUID(),
        companyEntityNameSnapshot: "我方公司",
        companyEntityCreditCodeSnapshot: "91350000TEST400000",
        paidAt: new Date("2026-11-01T00:00:00.000Z"),
        executedByUserId: staffUserId
      }
    });
    await prisma.registeredPaymentFunding.create({
      data: {
        executionId: execution.id, accountId, balanceRegistrationId: openingId,
        actualPayerKind: "public_cash", actualPayerId: "public_cash", actualPayerSnapshot: { kind: "public_cash" },
        openingTreatment: "included", openingReason: "真库测试", openingEvidence: "真库测试",
        payloadFingerprint: "b".repeat(64)
      }
    });
    await prisma.registeredFundPaymentAllocation.create({
      data: { id: randomUUID(), executionId: execution.id, accountId, sourceBatchId, amountCents: execution.amountCents }
    });
  }
  return { prefix, projectId, staffUserId, directorUserId, accountId, refundContractId, correctionContractId, selfReviewContractId, refundPaymentId, correctionPaymentId, selfReviewPaymentId, refundExecutionId, correctionExecutionId, selfReviewExecutionId };
}
