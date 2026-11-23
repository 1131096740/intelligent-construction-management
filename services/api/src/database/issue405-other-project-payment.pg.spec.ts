import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { ExpenseClaimApprovalOperatingSourceAdapter } from "../expense-claim/expense-claim-operating-source.adapter";
import { ExpenseClaimCorrectionService } from "../expense-claim/expense-claim-correction.service";
import { ExpenseClaimPaymentRefundService } from "../expense-claim/expense-claim-payment-refund.service";
import { ExpenseClaimService } from "../expense-claim/expense-claim.service";
import { OtherProjectPaymentController } from "../expense-claim/other-project-payment.controller";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";

/**
 * #405 真库证据（真实 PostgreSQL 16）：无合同特殊项目付款与费用
 * 1) 只有综合部主管能登记“其他项目付款”，填项目/用途/类别/收款对象/金额；
 * 2) 提交冻结综合部主管、项目经理、财务主管、董事长/总经理四个并联职责；
 * 3) 审批通过只确认一次费用成本，分两次实付不重复计成本；
 * 4) 超过待付金额的第二笔补付被拒绝；退款复用 PaymentExecutionRefund 并重开可付；
 * 5) 财务主管确认费用金额更正后向经营账追加更正分录（原事实不改）；
 * 6) 本流程不创建合同/结算/合同付款申请，未与有合同项目付款口径混用。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue405-other-project-payment-local.cjs
 */
describe("issue 405 other project payment and expense PostgreSQL", () => {
  const integrationTest = process.env.ISSUE405_OTHER_PROJECT_PAYMENT_RUN === "1" ? it : it.skip;

  integrationTest("registers, approves, splits, refunds and corrects a no-contract project payment with one cost", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const auth = {
      confirmPassword: async (_userId: string, password: string) => {
        if (password !== "current-password") throw new Error("当前密码不正确");
      }
    };
    const operatingSourceCalls: string[] = [];
    const operatingSources = {
      async appendConfirmedSourceIfEnabledInTransaction(_tx: unknown, locator: { sourceType: string; sourceBusinessId: string }) {
        operatingSourceCalls.push(`${locator.sourceType}:${locator.sourceBusinessId}`);
        return { id: randomUUID() };
      }
    };
    const correctionAppends: Array<{ input: AppendOperatingFactInput; entryKind: string }> = [];
    const ledger = {
      async appendConfirmedSourceInTransaction(_tx: unknown, input: AppendOperatingFactInput, _actorUserId: string, entryKind = "original") {
        correctionAppends.push({ input, entryKind });
        return { id: randomUUID() };
      }
    };
    const claims = new ExpenseClaimService(
      prisma as never,
      new BusinessNumberingService(),
      new AuditService(),
      auth as never,
      undefined,
      undefined,
      undefined,
      undefined,
      operatingSources as never
    );
    const refunds = new ExpenseClaimPaymentRefundService(prisma as never, new AuditService());
    const corrections = new ExpenseClaimCorrectionService(prisma as never, new AuditService(), auth as never, ledger as never);
    const controller = new OtherProjectPaymentController(prisma as never, claims, refunds, corrections);
    try {
      // 1) 越权：财务人员不能登记其他项目付款。
      await expect(controller.create({ id: fixture.financeStaffUserId } as never, entryInput(fixture))).rejects.toThrow("综合部主管");

      // 2) 综合部主管登记：项目/用途/类别/收款对象/金额，不需要合同或结算。
      const created = await controller.create({ id: fixture.handlerUserId } as never, entryInput(fixture));
      expect(created).toMatchObject({ status: "draft" });
      const claim = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: created.id } });
      expect(claim.claimType).toBe("incidental_expense");
      expect(claim.projectId).toBe(fixture.projectId);
      expect(claim.reason).toBe("特殊项目临时服务费");
      expect(claim.incidentalExpenseCategory).toBe("temporary_service");
      expect(claim.payeeNameSnapshot).toBe("合成特殊项目收款方");
      expect(claim.requestedAmountCents).toBe(1000000n);
      expect(await prisma.contract.count({ where: { projectId: fixture.projectId } })).toBe(0);
      expect(await prisma.paymentRequest.count({ where: { projectId: fixture.projectId } })).toBe(0);

      // 3) 提交后冻结四个并联职责。
      const submitted = await claims.submit(claim.id, fixture.handlerUserId);
      expect(submitted.status).toBe("approval_pending");
      const instance = await prisma.approvalInstance.findFirstOrThrow({
        where: { businessType: "expense_claim", businessId: claim.id, status: "in_progress" }
      });
      const nodes = instance.frozenNodes as Array<{ name: string; roleKeys: string[] }>;
      expect(nodes.map((node) => node.roleKeys)).toEqual([
        ["comprehensive_director"],
        ["project_manager"],
        ["finance_director"],
        ["chairman", "general_manager"]
      ]);
      expect(nodes.map((node) => node.name)).toEqual(["综合部主管", "项目经理", "财务主管", "董事长/总经理"]);

      // 4) 模拟四职责全部同意（审批引擎本身由既有审批测试覆盖），费用确认一次。
      const approvedAt = new Date("2026-11-20T02:00:00.000Z");
      await prisma.approvalInstance.update({ where: { id: instance.id }, data: { status: "approved" } });
      await prisma.approvalActionLog.create({
        data: { approvalInstanceId: instance.id, action: "approve", actorUserId: fixture.chairmanUserId, approvedRoleKey: "chairman" }
      });
      await prisma.expenseClaim.update({
        where: { id: claim.id },
        data: { status: "approved_pending_payment", approvedAt, companyPayableAmountCents: 1000000n }
      });

      // 5) 成本只确认一次：审批来源确认成本 10k、应付 10k。
      const approvalAdapter = new ExpenseClaimApprovalOperatingSourceAdapter();
      const snapshot = await approvalAdapter.readSourceSnapshot(prisma as never, {
        projectId: fixture.projectId,
        sourceType: "expense_claim_approval",
        sourceBusinessId: claim.id
      });
      assert.ok(snapshot);
      const approvalFact = approvalAdapter.toOperatingFactInput(snapshot);
      expect(approvalFact.input.impacts.filter((impact) => impact.impactKind === "confirmed_cost").map((impact) => impact.amountCents)).toEqual([1000000n]);
      expect(approvalFact.input.impacts.filter((impact) => impact.impactKind === "payable_increase").map((impact) => impact.amountCents)).toEqual([1000000n]);
      const originalFact = await prisma.operatingFact.create({
        data: {
          projectId: approvalFact.input.projectId,
          sourceType: approvalFact.input.sourceType,
          sourceBusinessId: approvalFact.input.sourceBusinessId,
          sourceVersion: approvalFact.input.sourceVersion,
          sourceBusinessCode: approvalFact.input.sourceBusinessCode,
          occurredAt: approvalFact.input.occurredAt,
          confirmedAt: approvalFact.input.confirmedAt,
          affiliateAssignmentId: approvalFact.input.affiliateAssignmentId,
          affiliateBusinessPartyVersionId: approvalFact.input.affiliateBusinessPartyVersionId,
          affiliateNameSnapshot: approvalFact.input.affiliateNameSnapshot,
          affiliateCreditCodeSnapshot: approvalFact.input.affiliateCreditCodeSnapshot ?? null,
          operatingLedgerEffectiveDateSnapshot: new Date("2026-01-01T00:00:00.000Z"),
          isBeforeOperatingLedgerEffectiveDate: approvalFact.input.isBeforeOperatingLedgerEffectiveDate,
          factKind: approvalFact.input.factKind,
          operatingLevel: approvalFact.input.operatingLevel,
          evidenceLevel: approvalFact.input.evidenceLevel,
          amountCents: approvalFact.input.amountCents,
          currencyCode: approvalFact.input.currencyCode,
          direction: approvalFact.input.direction,
          subjectSnapshot: {},
          sourceSnapshot: approvalFact.input.sourceSnapshot,
          basisSnapshot: approvalFact.input.basisSnapshot,
          idempotencyKey: approvalFact.input.idempotencyKey,
          recordedByUserId: fixture.handlerUserId,
          confirmedByUserId: approvalFact.input.confirmedByUserId,
          entryKind: "original"
        }
      });

      // 6) 分次实付：3k + 7k，第二笔后结清；再付 1 分被拒绝。
      const first = await claims.recordPayment(claim.id, fixture.financeStaffUserId, paymentInput(fixture.voucherIds[0]!, "300000", "2026-11-20"));
      expect(first).toMatchObject({ status: "partially_paid", paidAmountCents: "300000" });
      // 超付：首付 3k 后剩余 7k，再申请 8k 被服务拒绝。
      await expect(claims.recordPayment(claim.id, fixture.financeStaffUserId, paymentInput(fixture.voucherIds[2]!, "800000", "2026-11-21")))
        .rejects.toThrow("补付金额超过当前待付金额");
      const second = await claims.recordPayment(claim.id, fixture.financeStaffUserId, paymentInput(fixture.voucherIds[1]!, "700000", "2026-11-21"));
      expect(second).toMatchObject({ status: "paid", paidAmountCents: "1000000" });
      // 结清后不能再登记实付（已付 10k = 确认费用 10k）。
      await expect(claims.recordPayment(claim.id, fixture.financeStaffUserId, paymentInput(fixture.voucherIds[2]!, "1", "2026-11-21")))
        .rejects.toThrow("当前费用申请不可登记实际支付");
      expect(await prisma.expenseClaimPaymentExecution.count({ where: { expenseClaimId: claim.id } })).toBe(2);

      // 7) 两次实付后成本仍只有一次（审批来源快照仍为 1 条，金额仍 10k）。
      const afterPayments = await approvalAdapter.readProjectSnapshots(prisma as never, fixture.projectId);
      expect(afterPayments).toHaveLength(1);
      expect(approvalAdapter.toOperatingFactInput(afterPayments[0]!).input.impacts
        .filter((impact) => impact.impactKind === "confirmed_cost")).toHaveLength(1);

      // 8) 退款 2k：复用 PaymentExecutionRefund，原实付不改，净付 8k、可付重开 2k。
      const executions = await prisma.expenseClaimPaymentExecution.findMany({ where: { expenseClaimId: claim.id }, orderBy: { paidAt: "asc" } });
      const secondExecution = executions[1]!;
      const refundKey = `refund-${fixture.prefix}`;
      const refund = await refunds.recordRefund(claim.id, secondExecution.id, fixture.financeStaffUserId, {
        amountCents: "200000", receivedAt: "2026-11-22", reason: "多付款退回", accountId: fixture.accountId,
        evidenceReference: `BANK-${fixture.prefix}`, idempotencyKey: refundKey
      });
      expect(refund).toMatchObject({
        amountCents: "200000", fundedAmountCents: "1000000", refundedCents: "200000",
        netPaidCents: "800000", remainingPayableCents: "200000", status: "partially_paid", replayed: false
      });
      const refundRow = await prisma.paymentExecutionRefund.findUniqueOrThrow({ where: { idempotencyKey: refundKey } });
      expect(refundRow.executionType).toBe("expense_claim_payment_execution");
      expect(refundRow.expenseClaimPaymentExecutionId).toBe(secondExecution.id);
      expect(refundRow.paymentRequestId).toBeNull();
      expect(refundRow.paymentExecutionId).toBeNull();
      expect((await prisma.expenseClaimPaymentExecution.findUniqueOrThrow({ where: { id: secondExecution.id } })).amountCents).toBe(700000n);
      const refundReplay = await refunds.recordRefund(claim.id, secondExecution.id, fixture.financeStaffUserId, {
        amountCents: "200000", receivedAt: "2026-11-22", reason: "多付款退回", accountId: fixture.accountId,
        evidenceReference: `BANK-${fixture.prefix}`, idempotencyKey: refundKey
      });
      expect(refundReplay.replayed).toBe(true);
      // 同一实付累计退款 2k 后再退 6k 被服务拒绝。
      await expect(refunds.recordRefund(claim.id, secondExecution.id, fixture.financeStaffUserId, {
        amountCents: "600000", receivedAt: "2026-11-22", reason: "多付款退回", accountId: fixture.accountId,
        idempotencyKey: `refund-over-${fixture.prefix}`
      })).rejects.toThrow("累计退款不得超过原实付");
      // 数据库触发器兜底：直接插入 6k 退款被拒绝。
      await expect(prisma.paymentExecutionRefund.create({
        data: {
          idempotencyKey: `refund-db-${fixture.prefix}`, executionType: "expense_claim_payment_execution",
          expenseClaimPaymentExecutionId: secondExecution.id, projectId: fixture.projectId,
          amountCents: 600000n, receivedAt: new Date("2026-11-22T00:00:00.000Z"), reason: "越界退款",
          recordedByUserId: fixture.financeStaffUserId, payloadFingerprint: "e".repeat(64)
        }
      })).rejects.toThrow(/payment_execution_refund_cap_exceeded/u);

      const beforeCorrection = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: claim.id } });
      expect({ payable: beforeCorrection.companyPayableAmountCents.toString(), funded: beforeCorrection.fundedAmountCents.toString() }).toEqual({ payable: "1000000", funded: "1000000" });
      // 9) 财务主管更正已确认费用 10k→8k：追加成本/应付更正，原成本事实不改。
      const correction = await corrections.correctConfirmedAmount(claim.id, fixture.financeDirectorUserId, {
        correctedAmountCents: "800000", reason: "供应商折让，实际应为 8k",
        confirmationPassword: "current-password", idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correction).toMatchObject({
        originalAmountCents: "1000000", correctedAmountCents: "800000", correctionDeltaCents: "-200000",
        netPaidCents: "800000", remainingPayableCents: "0", overpaidCents: "0", status: "paid", replayed: false
      });
      expect(correctionAppends).toHaveLength(1);
      expect(correctionAppends[0]!.entryKind).toBe("correction");
      expect(correctionAppends[0]!.input).toMatchObject({
        adjustsFactId: originalFact.id,
        amountCents: 200000n,
        direction: "inflow",
        impacts: [
          expect.objectContaining({ impactKind: "confirmed_cost", direction: "decrease", amountCents: 200000n }),
          expect.objectContaining({ impactKind: "payable_decrease", direction: "decrease", amountCents: 200000n })
        ]
      });
      const correctedClaim = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(correctedClaim.companyPayableAmountCents).toBe(800000n);
      expect(correctedClaim.requestedAmountCents).toBe(1000000n);
      const storedOriginal = await prisma.operatingFact.findUniqueOrThrow({ where: { id: originalFact.id } });
      expect(storedOriginal.amountCents).toBe(1000000n);
      // 真实经营账会把更正事实落库；本用例用受控端口收集后按同一输入补写，验证同键回放。
      const correctionInput = correctionAppends[0]!.input;
      const correctionFact = await prisma.operatingFact.create({
        data: {
          projectId: correctionInput.projectId,
          sourceType: correctionInput.sourceType,
          sourceBusinessId: correctionInput.sourceBusinessId,
          sourceVersion: correctionInput.sourceVersion,
          sourceBusinessCode: correctionInput.sourceBusinessCode,
          occurredAt: correctionInput.occurredAt,
          confirmedAt: correctionInput.confirmedAt,
          affiliateAssignmentId: correctionInput.affiliateAssignmentId,
          affiliateBusinessPartyVersionId: correctionInput.affiliateBusinessPartyVersionId,
          affiliateNameSnapshot: correctionInput.affiliateNameSnapshot,
          affiliateCreditCodeSnapshot: correctionInput.affiliateCreditCodeSnapshot ?? null,
          operatingLedgerEffectiveDateSnapshot: new Date("2026-01-01T00:00:00.000Z"),
          isBeforeOperatingLedgerEffectiveDate: correctionInput.isBeforeOperatingLedgerEffectiveDate,
          factKind: correctionInput.factKind,
          operatingLevel: correctionInput.operatingLevel,
          evidenceLevel: correctionInput.evidenceLevel,
          amountCents: correctionInput.amountCents,
          currencyCode: correctionInput.currencyCode,
          direction: correctionInput.direction,
          subjectSnapshot: {},
          sourceSnapshot: correctionInput.sourceSnapshot,
          basisSnapshot: correctionInput.basisSnapshot,
          idempotencyKey: correctionInput.idempotencyKey,
          recordedByUserId: fixture.financeDirectorUserId,
          confirmedByUserId: correctionInput.confirmedByUserId,
          entryKind: "correction",
          adjustsFactId: correctionInput.adjustsFactId
        }
      });
      expect(correctionFact.amountCents).toBe(200000n);
      const correctionReplay = await corrections.correctConfirmedAmount(claim.id, fixture.financeDirectorUserId, {
        correctedAmountCents: "800000", reason: "供应商折让，实际应为 8k",
        confirmationPassword: "current-password", idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correctionReplay.replayed).toBe(true);
      expect(correctionAppends).toHaveLength(1);

      // 10) 台账口径：只出现费用来源确认与实付，不产生合同付款申请。
      expect(operatingSourceCalls.filter((item) => item.startsWith("expense_claim_payment_execution:"))).toHaveLength(2);
      expect(operatingSourceCalls.every((item) => item.startsWith("expense_claim_payment_execution:"))).toBe(true);
      expect(await prisma.paymentRequest.count({ where: { projectId: fixture.projectId } })).toBe(0);
      expect(await prisma.paymentExecution.count({ where: { settlementId: null } })).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});

function assertDedicatedDatabase() {
  const url = process.env.ISSUE405_OTHER_PROJECT_PAYMENT_DATABASE_URL;
  assert.ok(url, "缺少 ISSUE405_OTHER_PROJECT_PAYMENT_DATABASE_URL");
  assert.match(url, /^postgresql:\/\/[^/]+\/jiangkong_issue405(\?.*)?$/u);
  return url;
}

function entryInput(fixture: Awaited<ReturnType<typeof seedFixture>>) {
  return {
    projectId: fixture.projectId,
    reason: "特殊项目临时服务费",
    incidentalExpenseCategory: "temporary_service" as const,
    payeeName: "合成特殊项目收款方",
    requestedAmountCents: "1000000",
    companyEntityId: fixture.companyEntityId,
    paymentMethod: "bank_transfer"
  };
}

function paymentInput(voucherFileId: string, amountCents: string, paidAt: string) {
  return { amountCents, paidAt, paymentMethod: "bank_transfer", voucherFileId, confirmationPassword: "current-password" };
}

async function seedFixture(prisma: PrismaClient) {
  const prefix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const companyEntityId = randomUUID();
  const handlerUserId = randomUUID();
  const projectManagerUserId = randomUUID();
  const financeDirectorUserId = randomUUID();
  const financeStaffUserId = randomUUID();
  const chairmanUserId = randomUUID();
  const accountId = randomUUID();
  const openingId = randomUUID();
  const sourceBatchId = randomUUID();
  await prisma.project.create({
    data: { id: projectId, code: `P405-${prefix}`, name: `#405 无合同特殊项目 ${prefix}`, operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z") }
  });
  await prisma.companyEntity.create({ data: { id: companyEntityId, name: `我方公司 ${prefix}`, dataStatus: "complete" } });
  await prisma.user.createMany({
    data: [
      { id: handlerUserId, name: "综合部主管" },
      { id: projectManagerUserId, name: "项目经理" },
      { id: financeDirectorUserId, name: "财务主管" },
      { id: financeStaffUserId, name: "财务经办" },
      { id: chairmanUserId, name: "董事长" }
    ]
  });
  const positionKeys = ["comprehensive_director", "project_manager", "finance_director", "finance_staff", "chairman"] as const;
  const positionIds = new Map<string, string>();
  for (const key of positionKeys) {
    const id = randomUUID();
    positionIds.set(key, id);
    await prisma.position.create({ data: { id, key, name: key } });
  }
  await prisma.userPosition.createMany({
    data: [
      { userId: handlerUserId, positionId: positionIds.get("comprehensive_director")! },
      { userId: financeDirectorUserId, positionId: positionIds.get("finance_director")! },
      { userId: financeStaffUserId, positionId: positionIds.get("finance_staff")! },
      { userId: chairmanUserId, positionId: positionIds.get("chairman")! }
    ]
  });
  await prisma.projectMember.create({ data: { projectId, userId: projectManagerUserId, positionKey: "project_manager" } });
  await prisma.registeredFundAccount.create({ data: { id: accountId, scopeKey: "public_cash", kind: "public_cash" } });
  await prisma.fundAccountBalanceRegistration.create({
    data: {
      id: openingId, accountId, version: 1, kind: "opening", status: "confirmed",
      balanceYuan: 5000, asOfDate: "2026-01-01", evidenceReference: `OPEN-${prefix}`,
      reconciliationNote: "真库期初", reason: "真库期初", idempotencyKey: `opening-${prefix}`,
      payloadFingerprint: "a".repeat(64), createdByUserId: financeStaffUserId,
      confirmedByUserId: financeStaffUserId, confirmedAt: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  await prisma.fundAccountSourceBatch.create({
    data: { id: sourceBatchId, registrationId: openingId, lineNo: 1, amountYuan: 5000, sourceStatus: "known", sourceName: "期初", projectStatus: "project", projectId }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: randomUUID(), projectId, businessPartyId: randomUUID(), businessPartyVersionId: randomUUID(),
      affiliateNameSnapshot: "合成施工企业", affiliateCreditCodeSnapshot: "91350000TEST405",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), changeReason: "真库接管", assignedByUserId: handlerUserId
    }
  });
  const voucherIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const id = randomUUID();
    voucherIds.push(id);
    await prisma.fileObject.create({
      data: {
        id, bucket: "test-private", objectKey: `issue405/${prefix}/voucher-${index}.pdf`,
        originalName: `凭证-${index}.pdf`, mimeType: "application/pdf", sizeBytes: 1024,
        uploadedByUserId: financeStaffUserId, contentSha256: "c".repeat(64)
      }
    });
  }
  return {
    prefix, projectId, companyEntityId, handlerUserId, projectManagerUserId, financeDirectorUserId,
    financeStaffUserId, chairmanUserId, accountId, voucherIds
  };
}
