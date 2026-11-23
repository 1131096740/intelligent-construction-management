import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { ActualPurchaseBatchService } from "../actual-purchase/actual-purchase-batch.service";
import { prepareProcurementPayment } from "../general-procurement/general-procurement-payment";
import { AuditService } from "../audit/audit.service";
import type { AppendOperatingFactInput, OperatingLedgerService } from "../operating-ledger/operating-ledger.service";

/**
 * #403 真库证据（真实 PostgreSQL 16）：
 * 1) 10k 批次首申 3k 通过后确认整批 10k 成本一次，后续付款不重复计成本；
 * 2) 同批多次付款、累计到批次总额；超批次总额由服务和数据库触发器双重拒绝；
 * 3) 财务主管确认更正 8k 后重算成本贡献（-2k）并暂停；退款 2k 后容量恢复、暂停解除；
 * 4) 批次创建、退款登记同键幂等，异内容冲突；退款累计不超原实付（服务 + 触发器）。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue403-actual-purchase-local.cjs
 */
describe("issue 403 actual purchase batches and split payments PostgreSQL", () => {
  const integrationTest = process.env.ISSUE403_ACTUAL_PURCHASE_RUN === "1" ? it : it.skip;

  integrationTest("confirms batch cost once, splits payments, corrects cost and restores capacity after refund", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const appendCalls: Array<{ input: AppendOperatingFactInput; entryKind: string }> = [];
    const ledger = {
      appendConfirmedSourceInTransaction: async (
        _tx: unknown,
        input: AppendOperatingFactInput,
        _actorUserId: string,
        entryKind = "original"
      ) => {
        appendCalls.push({ input, entryKind });
        return { id: randomUUID() };
      }
    } as unknown as OperatingLedgerService;
    const service = new ActualPurchaseBatchService(
      prisma as never,
      new AuditService(),
      ledger,
      { confirmPassword: async (_userId: string, password: string) => { if (password !== "current-password") throw new Error("密码错误"); } } as never
    );
    try {
      // 1) 10k 批次，实际明细 2 行。
      const batch = await service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [
          { materialName: "角钢", quantity: "10", unitPrice: "500", amountCents: "500000" },
          { materialName: "扎丝", quantity: "1", unitPrice: "5000", amountCents: "500000" }
        ]
      });
      expect(batch.totalAmountCents).toBe("1000000");
      expect(batch.lines).toHaveLength(2);
      // 同键幂等：同内容返回同一批次，异内容冲突。
      const replay = await service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [
          { materialName: "角钢", quantity: "10", unitPrice: "500", amountCents: "500000" },
          { materialName: "扎丝", quantity: "1", unitPrice: "5000", amountCents: "500000" }
        ]
      });
      expect(replay.id).toBe(batch.id);
      await expect(service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "900000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [{ materialName: "角钢", quantity: "10", unitPrice: "500", amountCents: "900000" }]
      })).rejects.toThrow("内容不一致");

      // 2) 首笔付款申请 3k；审批通过确认整批 10k 成本一次。
      const firstPayment = await createSpotPayment(service, batch.id, "300000", fixture.handlerUserId);
      await prisma.spotProcurementPayment.update({ where: { id: firstPayment.id }, data: { status: "approval_pending", approvalAmountCents: 300000n } });
      await prisma.$transaction(async (tx) => {
        await service.confirmCostForSpotPaymentInTransaction(tx, firstPayment.id, fixture.handlerUserId, new Date("2026-11-20T02:00:00.000Z"));
        await service.confirmCostForSpotPaymentInTransaction(tx, firstPayment.id, fixture.handlerUserId, new Date("2026-11-20T02:00:00.000Z"));
      });
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]!.entryKind).toBe("original");
      expect(appendCalls[0]!.input.amountCents).toBe(1000000n);
      const costConfirmed = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(costConfirmed.costVersion).toBe(1);
      expect(costConfirmed.status).toBe("cost_confirmed");

      // 3) 首笔实付 3k，第二批 7k，正好用尽；第三批 1k 被服务拒绝。
      fixture.executionIds.push(await executeSpot(prisma, firstPayment.id, 300000n, "2026-11-20", "exec-1", fixture.handlerUserId));
      const secondPayment = await createSpotPayment(service, batch.id, "700000", fixture.handlerUserId);
      fixture.executionIds.push(await executeSpot(prisma, secondPayment.id, 700000n, "2026-11-21", "exec-2", fixture.handlerUserId));
      await expect(createSpotPayment(service, batch.id, "100000", fixture.handlerUserId))
        .rejects.toThrow("超过批次剩余可付金额");
      const afterTwo = await service.detail(fixture.handlerUserId, batch.id);
      expect(afterTwo.capacity.netPaidAmountCents).toBe("1000000");
      expect(afterTwo.capacity.availableAmountCents).toBe("0");
      expect(afterTwo.capacity.suspended).toBe(false);
      expect(afterTwo.payments).toHaveLength(2);

      // 4) 数据库层兜底：直接插入第三笔实付 1 分被触发器拒绝。
      await expect(prisma.spotProcurementPaymentExecution.create({
        data: { paymentId: secondPayment.id, amountCents: 1n, paidAt: new Date("2026-11-21T00:00:00.000Z"), paymentMethod: "bank_transfer", executedByUserId: fixture.handlerUserId, idempotencyKey: `exec-over-${fixture.prefix}` }
      })).rejects.toThrow(/actual_purchase_batch_overpay/u);

      // 5) 更正 8k：财务发起、财务主管确认；成本贡献追加 -2k，已付保留，批次暂停。
      const correction = await service.requestCorrection(fixture.financeStaffUserId, batch.id, {
        correctedTotalAmountCents: "800000",
        reason: "供应商折让，实际应为 8k",
        idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correction.status).toBe("pending_confirm");
      const correctionReplay = await service.requestCorrection(fixture.financeStaffUserId, batch.id, {
        correctedTotalAmountCents: "800000",
        reason: "供应商折让，实际应为 8k",
        idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correctionReplay.id).toBe(correction.id);
      const confirmed = await service.confirmCorrection(fixture.financeDirectorUserId, batch.id, correction.id, {
        confirmationKey: `confirm-${fixture.prefix}`,
        reviewNote: "核对折让后确认"
      });
      expect(confirmed.status).toBe("confirmed");
      expect(appendCalls).toHaveLength(2);
      expect(appendCalls[1]!.entryKind).toBe("correction");
      expect(appendCalls[1]!.input.amountCents).toBe(200000n);
      expect(appendCalls[1]!.input.direction).toBe("inflow");
      const correctedBatch = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(correctedBatch.effectiveTotalAmountCents).toBe(800000n);
      expect(correctedBatch.costVersion).toBe(2);
      expect(correctedBatch.totalAmountCents).toBe(1000000n);
      const suspended = await service.detail(fixture.financeStaffUserId, batch.id);
      expect(suspended.capacity.suspended).toBe(true);
      expect(suspended.capacity.overpaidAmountCents).toBe("200000");
      await expect(createSpotPayment(service, batch.id, "1", fixture.handlerUserId)).rejects.toThrow("暂停");

      // 6) 退款 2k：净实付 8k，暂停解除；同键重放不新增。
      const refund = await service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "200000",
        receivedAt: "2026-11-22",
        reason: "供应商退回折让差额",
        accountId: fixture.accountId,
        idempotencyKey: `refund-${fixture.prefix}`
      });
      expect(refund.replayed).toBe(false);
      const refundReplay = await service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "200000",
        receivedAt: "2026-11-22",
        reason: "供应商退回折让差额",
        accountId: fixture.accountId,
        idempotencyKey: `refund-${fixture.prefix}`
      });
      expect(refundReplay.replayed).toBe(true);
      const restored = await service.detail(fixture.financeStaffUserId, batch.id);
      expect(restored.capacity.paidAmountCents).toBe("1000000");
      expect(restored.capacity.refundedAmountCents).toBe("200000");
      expect(restored.capacity.netPaidAmountCents).toBe("800000");
      expect(restored.capacity.availableAmountCents).toBe("0");
      expect(restored.capacity.suspended).toBe(false);
      expect(restored.corrections).toHaveLength(1);
      expect(restored.payments.reduce((sum, payment) => sum + BigInt(payment.refundedAmountCents), 0n)).toBe(200000n);

      // 7) 退款累计不得超过原实付（服务 + 数据库触发器）。
      await expect(service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "100001",
        receivedAt: "2026-11-22",
        reason: "重复退款",
        accountId: fixture.accountId,
        idempotencyKey: `refund-over-${fixture.prefix}`
      })).rejects.toThrow("累计退款不得超过原实付");
      await expect(prisma.paymentExecutionRefund.create({
        data: {
          idempotencyKey: `refund-db-over-${fixture.prefix}`,
          executionType: "spot_procurement_payment_execution",
          spotProcurementPaymentExecutionId: fixture.executionIds[0]!,
          projectId: fixture.projectId,
          amountCents: 100001n,
          receivedAt: new Date("2026-11-22"),
          reason: "数据库兜底",
          recordedByUserId: fixture.financeStaffUserId,
          payloadFingerprint: "c".repeat(64)
        }
      })).rejects.toThrow(/payment_execution_refund_cap_exceeded/u);

      // 8) 更正状态机：已确认更正不可再次改金额，重复确认同键回放。
      const correctionReplayConfirm = await service.confirmCorrection(fixture.financeDirectorUserId, batch.id, correction.id, {
        confirmationKey: `confirm-${fixture.prefix}`
      });
      expect(correctionReplayConfirm.status).toBe("confirmed");
      await expect(prisma.actualPurchaseBatchCorrection.update({
        where: { id: correction.id },
        data: { correctedTotalAmountCents: 700000n, correctionDeltaCents: -300000n }
      })).rejects.toThrow(/actual_purchase_batch_correction_(invalid_transition|snapshot_immutable)/u);
    } finally {
      await prisma.$disconnect();
    }
  });

  integrationTest("records a general procurement batch and rejects over-commitment before claim approval", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const appendCalls: Array<{ amountCents: bigint }> = [];
    const ledger = {
      appendConfirmedSourceInTransaction: async (_tx: unknown, input: AppendOperatingFactInput) => {
        appendCalls.push({ amountCents: input.amountCents ?? 0n });
        return { id: randomUUID() };
      }
    } as unknown as OperatingLedgerService;
    const service = new ActualPurchaseBatchService(prisma as never, new AuditService(), ledger, { confirmPassword: async () => undefined } as never);
    try {
      const batch = await service.create(fixture.comprehensiveDirectorUserId, {
        kind: "general",
        procurementId: fixture.generalProcurementId,
        companyEntityId: fixture.companyId,
        supplierName: "合成办公用品供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `general-batch-${fixture.prefix}`,
        lines: [{ materialName: "办公用品一批", amountCents: "1000000" }]
      });
      const claimInput = (requestKey: string, amountCents: string) => ({
        generalProcurementId: fixture.generalProcurementId,
        generalProcurementRequestKey: requestKey,
        actualPurchaseBatchId: batch.id,
        claimType: "incidental_expense" as const,
        incidentalExpenseCategory: "procurement_office_supplies",
        projectId: fixture.projectId,
        companyEntityId: fixture.companyId,
        reason: "办公用品实际采购",
        requestedAmountCents: amountCents,
        payeeName: "合成办公用品供应商"
      });
      await prisma.$transaction(async (tx) => {
        const prepared = await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-1-${fixture.prefix}`, "300000") as never, 300000n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
        expect(prepared?.existing).toBeNull();
        const claim = await tx.expenseClaim.create({
          data: {
            code: `LXFY-403-1-${fixture.prefix}`,
            claimType: "incidental_expense",
            incidentalExpenseCategory: "procurement_office_supplies",
            status: "approved_pending_payment",
            companyEntityId: fixture.companyId,
            companyEntityNameSnapshot: "合成费用公司",
            projectId: fixture.projectId,
            applicantUserId: fixture.comprehensiveDirectorUserId,
            applicantNameSnapshot: "综合部主管",
            handledByUserId: fixture.comprehensiveDirectorUserId,
            handledByNameSnapshot: "综合部主管",
            reason: "办公用品实际采购",
            requestedAmountCents: 300000n,
            payeeNameSnapshot: "合成办公用品供应商",
            actualPurchaseBatchId: batch.id,
            approvedAt: new Date("2026-11-20T03:00:00.000Z")
          }
        });
        await service.confirmCostForClaimInTransaction(tx, claim.id, fixture.comprehensiveDirectorUserId, new Date("2026-11-20T03:00:00.000Z"));
        await service.confirmCostForClaimInTransaction(tx, claim.id, fixture.comprehensiveDirectorUserId, new Date("2026-11-20T03:00:00.000Z"));
      });
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]!.amountCents).toBe(1000000n);
      const detail = await service.detail(fixture.comprehensiveDirectorUserId, batch.id);
      expect(detail.capacity.outstandingCommittedAmountCents).toBe("300000");
      // 7k 仍可申请；同批第三笔 1 分被拒绝。
      await prisma.$transaction(async (tx) => {
        await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-2-${fixture.prefix}`, "700000") as never, 700000n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
      });
      await prisma.expenseClaim.create({
        data: {
          code: `LXFY-403-2-${fixture.prefix}`,
          claimType: "incidental_expense",
          incidentalExpenseCategory: "procurement_office_supplies",
          status: "approval_pending",
          companyEntityId: fixture.companyId,
          companyEntityNameSnapshot: "合成费用公司",
          projectId: fixture.projectId,
          applicantUserId: fixture.comprehensiveDirectorUserId,
          applicantNameSnapshot: "综合部主管",
          handledByUserId: fixture.comprehensiveDirectorUserId,
          handledByNameSnapshot: "综合部主管",
          reason: "办公用品第二批",
          requestedAmountCents: 700000n,
          payeeNameSnapshot: "合成办公用品供应商",
          actualPurchaseBatchId: batch.id
        }
      });
      await expect(prisma.$transaction(async (tx) => {
        await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-3-${fixture.prefix}`, "1") as never, 1n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
      })).rejects.toThrow("超过批次剩余可付金额");
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createSpotPayment(service: ActualPurchaseBatchService, batchId: string, requestedAmountCents: string, actorUserId: string) {
  return service.createSpotPayment(actorUserId, batchId, {
    requestedAmountCents,
    paymentType: "company_direct",
    payeeName: "合成五金供应商",
    paymentMethods: ["bank_transfer"],
    channels: [{ channelType: "bank_transfer", accountName: "合成五金供应商", accountNumber: "6222000000000001", bankName: "合成银行", isPrimary: true }],
    idempotencyKey: randomUUID()
  });
}

async function executeSpot(prisma: PrismaClient, paymentId: string, amountCents: bigint, paidOn: string, label: string, actorUserId: string) {
  const payment = await prisma.spotProcurementPayment.findUniqueOrThrow({ where: { id: paymentId } });
  const execution = await prisma.spotProcurementPaymentExecution.create({
    data: {
      paymentId,
      amountCents,
      paidAt: new Date(`${paidOn}T00:00:00.000Z`),
      paymentMethod: "bank_transfer",
      executedByUserId: actorUserId,
      idempotencyKey: `${label}-${randomUUID()}`
    }
  });
  const paidAmountCents = payment.paidAmountCents + amountCents;
  await prisma.spotProcurementPayment.update({
    where: { id: paymentId },
    data: {
      paidAmountCents,
      status: paidAmountCents >= payment.approvalAmountCents ? "paid" : "partially_paid"
    }
  });
  return execution.id;
}

function assertDedicatedDatabase(): string {
  const raw = process.env.ISSUE403_DATABASE_URL?.trim();
  if (!raw) throw new Error("ISSUE403_DATABASE_URL 未配置");
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !url.pathname.includes("issue403")) {
    throw new Error("仅允许本机一次性 #403 专库");
  }
  return raw;
}

async function seedFixture(prisma: PrismaClient) {
  const prefix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const companyId = randomUUID();
  const handlerUserId = randomUUID();
  const financeStaffUserId = randomUUID();
  const financeDirectorUserId = randomUUID();
  const comprehensiveDirectorUserId = randomUUID();
  const positionIds: Record<string, string> = {};
  const accountId = randomUUID();
  const openingId = randomUUID();
  const sourceBatchId = randomUUID();
  const procurementId = randomUUID();
  const versionId = randomUUID();

  await prisma.companyEntity.create({ data: { id: companyId, name: `合成费用公司 ${prefix}`, dataStatus: "complete" } });
  await prisma.project.create({
    data: {
      id: projectId,
      code: `P403-${prefix}`,
      name: `#403 真库项目 ${prefix}`,
      operatingLedgerEffectiveDate: new Date("2026-11-01")
    }
  });
  await prisma.user.createMany({
    data: [
      { id: handlerUserId, name: "物资经办" },
      { id: financeStaffUserId, name: "财务经办" },
      { id: financeDirectorUserId, name: "财务主管" },
      { id: comprehensiveDirectorUserId, name: "综合部主管" }
    ]
  });
  for (const [key, name] of [["material_staff", "物资员"], ["finance_staff", "财务人员"], ["finance_director", "财务主管"], ["comprehensive_director", "综合部主管"]] as const) {
    const existing = await prisma.position.findUnique({ where: { key } });
    positionIds[key] = existing?.id ?? (await prisma.position.create({ data: { key, name } })).id;
  }
  await prisma.userPosition.createMany({
    data: [
      { userId: handlerUserId, positionId: positionIds.material_staff!, projectId },
      { userId: financeStaffUserId, positionId: positionIds.finance_staff! },
      { userId: financeDirectorUserId, positionId: positionIds.finance_director! },
      { userId: comprehensiveDirectorUserId, positionId: positionIds.comprehensive_director! }
    ]
  });
  await prisma.projectMember.create({ data: { projectId, userId: handlerUserId, positionKey: "material_staff" } });
  const party = await prisma.businessParty.create({ data: { name: `合成施工企业 ${prefix}`, normalizedName: `party-403-${prefix}`, createdByUserId: handlerUserId } });
  const partyVersion = await prisma.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name }, createdByUserId: handlerUserId } });
  await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: party.id,
      businessPartyVersionId: partyVersion.id,
      affiliateNameSnapshot: party.name,
      effectiveFrom: new Date("2020-01-01"),
      changeReason: "批量付款真库",
      assignedByUserId: handlerUserId
    }
  });
  const generalProcurementId = randomUUID();
  await prisma.generalProcurement.create({
    data: {
      id: generalProcurementId,
      code: `ZHCG-403-${prefix}`,
      requestKey: `general-403-${prefix}`,
      creationFingerprint: "e".repeat(64),
      projectId,
      companyEntityId: companyId,
      companyNameSnapshot: `合成费用公司 ${prefix}`,
      applicantUserId: comprehensiveDirectorUserId,
      applicantNameSnapshot: "综合部主管",
      category: "procurement_office_supplies",
      reason: "办公用品实际采购",
      requestProtocolVersion: 2,
      scope: "project",
      lines: [],
      status: "approved_pending_procurement"
    }
  });
  await prisma.spotProcurement.create({
    data: {
      id: procurementId,
      projectId,
      code: `LXCG-403-${prefix}`,
      applicantUserId: handlerUserId,
      handlerUserId,
      status: "approved_in_progress"
    }
  });
  await prisma.spotProcurementVersion.create({
    data: {
      id: versionId,
      procurementId,
      versionNo: 1,
      requestProtocolVersion: 2,
      status: "approved",
      reason: "真库实际采购批次",
      handlerUserId,
      applicationDepartmentSnapshot: "物资部",
      applicationNameSnapshot: "物资经办",
      purchaserNameSnapshot: "物资经办",
      purchaserDepartmentNameSnapshot: "物资部",
      createdByUserId: handlerUserId,
      approvedAt: new Date("2026-11-19T00:00:00.000Z")
    }
  });
  await prisma.spotProcurement.update({ where: { id: procurementId }, data: { currentVersionId: versionId } });
  await prisma.spotProcurementLine.create({
    data: { versionId, sortOrder: 1, materialName: "角钢", quantity: 10, unitPrice: 500, amountCents: 500000n }
  });
  await prisma.registeredFundAccount.create({ data: { id: accountId, scopeKey: `public_cash_403_${prefix}`, kind: "public_cash" } });
  await prisma.fundAccountBalanceRegistration.create({
    data: {
      id: openingId,
      accountId,
      version: 1,
      kind: "opening",
      status: "confirmed",
      balanceYuan: 5000,
      asOfDate: "2026-11-01",
      evidenceReference: `OPEN-403-${prefix}`,
      reconciliationNote: "真库期初",
      reason: "真库期初",
      idempotencyKey: `opening-403-${prefix}`,
      payloadFingerprint: "d".repeat(64),
      createdByUserId: financeStaffUserId,
      confirmedByUserId: financeStaffUserId,
      confirmedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.fundAccountSourceBatch.create({
    data: {
      id: sourceBatchId,
      registrationId: openingId,
      lineNo: 1,
      amountYuan: 5000,
      sourceStatus: "known",
      sourceName: "期初",
      projectStatus: "project",
      projectId
    }
  });
  return {
    prefix,
    projectId,
    companyId,
    handlerUserId,
    financeStaffUserId,
    financeDirectorUserId,
    comprehensiveDirectorUserId,
    generalProcurementId,
    accountId,
    procurementId,
    versionId,
    executionIds: [] as string[]
  };
}
