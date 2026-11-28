import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { ActualPurchaseBatchService } from "../actual-purchase/actual-purchase-batch.service";
import { AuditService } from "../audit/audit.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
  ExpenseClaimApprovalOperatingSourceAdapter
} from "../expense-claim/expense-claim-operating-source.adapter";
import { ExpenseClaimService } from "../expense-claim/expense-claim.service";
import type { AppendOperatingFactInput, OperatingLedgerService } from "../operating-ledger/operating-ledger.service";

/**
 * #404 真库证据（真实 PostgreSQL 16）：
 * 1) 全员多类别报销：一张单多行类别（餐饮/车辆使用费/新增夜宵）按行汇总；
 *    数量可空、有值时最多 4 位；历史行只有 receiptCount 时数量仍为 NULL；
 *    普通项目报销通过后按行确认成本，实付只清偿。
 * 2) 无采购直接报销：不选任何采购申请也能创建、提交、审批。
 * 3) 原采购单垫付报销：公司直付 600 + 员工垫 400 的 1000 批次，员工只报 400；
 *    挂同一实际采购批次、沿用原类别、带出原采购信息与附件；批次成本只确认一次，
 *    垫付报销审批不再写第二笔成本；超批次剩余可付金额被拒绝；退款后容量恢复。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue404-reimbursement-local.cjs
 */
describe("issue 404 multi-category reimbursement and purchase advance PostgreSQL", () => {
  const integrationTest = process.env.ISSUE404_REIMBURSEMENT_RUN === "1" ? it : it.skip;

  integrationTest("records a multi-category direct claim, confirms cost once and keeps batch cost unique", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const appendCalls: Array<{ sourceBusinessId: string; impacts: NonNullable<AppendOperatingFactInput["impacts"]> }> = [];
    const approvalAdapter = new ExpenseClaimApprovalOperatingSourceAdapter();
    const claims = buildExpenseClaimService(prisma, async (tx, locator) => {
      if (locator.sourceType !== EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE) return;
      const snapshot = await approvalAdapter.readSourceSnapshot(tx, locator);
      if (!snapshot) return;
      const fact = approvalAdapter.toOperatingFactInput(snapshot);
      appendCalls.push({ sourceBusinessId: locator.sourceBusinessId, impacts: fact.input.impacts ?? [] });
    });
    try {
      // 1) 无采购直接报销：一张单 3 行、多类别；一行数量有值、一行数量为空。
      const direct = await claims.create(fixture.employeeUserId, {
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "现场加班餐与车辆使用",
        requestedAmountCents: "150000",
        paymentMethod: "bank_transfer",
        payeeName: "垫付员工",
        lines: [
          {
            expenseCategory: " 餐 饮 ",
            occurredOn: "2026-11-18",
            purpose: "现场加班餐",
            quantity: "2.5",
            receiptCount: 1,
            amountCents: "90000",
            evidenceType: "invoice"
          },
          {
            expenseCategory: "车辆使用费",
            occurredOn: "2026-11-18",
            purpose: "现场往返",
            quantity: "12",
            receiptCount: 1,
            amountCents: "40000",
            evidenceType: "invoice"
          },
          {
            expenseCategory: "夜宵",
            occurredOn: "2026-11-19",
            purpose: "夜间值守",
            receiptCount: 0,
            amountCents: "20000",
            evidenceType: "none",
            noEvidenceReason: "现场无票据，审批时已说明"
          }
        ]
      });
      expect(direct.requestedAmountCents).toBe("150000");

      const storedLines = await prisma.expenseClaimLine.findMany({
        where: { expenseClaimId: direct.id },
        orderBy: { sortOrder: "asc" }
      });
      // EXP-02：按行统计，多类别同单；数量可空。
      expect(storedLines.map((line) => line.expenseCategory)).toEqual(["餐饮", "车辆使用费", "夜宵"]);
      expect(storedLines.map((line) => line.quantity?.toFixed() ?? null)).toEqual(["2.5", "12", null]);
      expect(storedLines.reduce((sum, line) => sum + line.amountCents, 0n)).toBe(150000n);
      expect(storedLines.map((line) => line.amountCents)).toEqual([90000n, 40000n, 20000n]);

      // EXP-07：默认 10 类 + 本公司已用类别；同名变体复用同一条，不重复建项。
      const categories = await claims.expenseCategories(fixture.employeeUserId, fixture.companyId);
      const names = categories.categories.map((item) => item.name);
      expect(names.slice(0, 10)).toEqual([
        "零星材料", "水电", "零星机械", "零星人工", "差旅", "餐饮", "后勤", "办公用品", "车辆使用费", "其他"
      ]);
      expect(names.filter((name) => name === "餐饮")).toHaveLength(1);
      expect(names.filter((name) => name === "夜宵")).toHaveLength(1);
      expect(categories.categories.find((item) => item.name === "夜宵")).toMatchObject({ isDefault: false, usageCount: 1 });
      // 历史行只填 receiptCount，没有数量列值，读回仍是 NULL。
      const legacy = await prisma.expenseClaim.create({
        data: {
          code: `BX-LEGACY-${fixture.prefix}`,
          claimType: "reimbursement",
          status: "approved_pending_payment",
          companyEntityId: fixture.companyId,
          companyEntityNameSnapshot: "合成费用公司",
          projectId: fixture.projectId,
          applicantUserId: fixture.employeeUserId,
          applicantNameSnapshot: "垫付员工",
          handledByUserId: fixture.employeeUserId,
          handledByNameSnapshot: "垫付员工",
          reason: "历史报销行",
          requestedAmountCents: 5000n,
          companyPayableAmountCents: 5000n,
          approvedAt: new Date("2026-11-01T02:00:00.000Z")
        }
      });
      await prisma.expenseClaimLine.create({
        data: {
          expenseClaimId: legacy.id,
          sortOrder: 1,
          expenseCategory: "其他",
          occurredOn: new Date("2026-10-31"),
          purpose: "历史只填单据张数",
          receiptCount: 2,
          amountCents: 5000n,
          evidenceType: "receipt_or_other"
        }
      });
      const legacyLine = await prisma.expenseClaimLine.findFirstOrThrow({ where: { expenseClaimId: legacy.id } });
      expect(legacyLine.quantity).toBeNull();
      // 数量为 0 由数据库约束拒绝（NULL 不等于 0）。
      await expect(prisma.expenseClaimLine.create({
        data: {
          expenseClaimId: legacy.id,
          sortOrder: 2,
          expenseCategory: "其他",
          occurredOn: new Date("2026-10-31"),
          purpose: "零数量",
          quantity: 0,
          receiptCount: 1,
          amountCents: 100n,
          evidenceType: "invoice"
        }
      })).rejects.toThrow(/ExpenseClaimLine_quantity_positive_check/u);
      // 数量有值不改变金额汇总；数量本身超 4 位小数由服务拒绝，不隐式截断。
      await expect(claims.create(fixture.employeeUserId, {
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "超精度数量",
        requestedAmountCents: "100",
        payeeName: "垫付员工",
        lines: [{
          expenseCategory: "其他",
          occurredOn: "2026-11-19",
          purpose: "超精度",
          quantity: "1.23456",
          receiptCount: 1,
          amountCents: "100",
          evidenceType: "invoice"
        }]
      })).rejects.toThrow("最多 4 位小数");

      // EXP-04：同单多凭证统一上传到整单，不要求每张票关联明细；可先提交后补。
      const draftVoucher = await createVoucher(prisma, fixture.employeeUserId, fixture.prefix, "draft-receipt");
      await claims.attachAttachment(direct.id, fixture.employeeUserId, {
        fileId: draftVoucher,
        category: "invoice",
        expenseCategory: "餐饮"
      });
      const wholeClaimVoucher = await createVoucher(prisma, fixture.employeeUserId, fixture.prefix, "whole-claim-receipt");
      await claims.attachAttachment(direct.id, fixture.employeeUserId, {
        fileId: wholeClaimVoucher,
        category: "receipt_or_other"
      });

      // 2) 从详情读取各岗位可办职责，财务可先签，末岗签完才确认成本。
      const { approvalInstanceId } = await claims.submit(direct.id, fixture.employeeUserId);
      const reviewers = [
        { userId: fixture.financeDirectorUserId, index: 2 },
        { userId: fixture.chairmanUserId, index: 3 },
        { userId: fixture.managerUserId, index: 1 },
        { userId: fixture.comprehensiveDirectorUserId, index: 0 }
      ];
      for (const [position, { userId, index }] of reviewers.entries()) {
        const { approval } = await claims.getMine(direct.id, userId);
        expect(approval).toMatchObject({ canReview: true, approvalInstanceId, actionableDuties: [{ index }] });
        expect(appendCalls).toHaveLength(0);
        const reviewed = await claims.review(direct.id, userId, {
          decision: "approve",
          approvalInstanceId: approval!.approvalInstanceId!,
          approvalDutyIndex: approval!.actionableDuties![0]!.index
        });
        expect(reviewed.completed).toBe(position === reviewers.length - 1);
      }
      const approved = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: direct.id } });
      expect(approved.status).toBe("approved_pending_payment");
      expect(approved.approvedAt).not.toBeNull();
      // 成本只按明细行确认，金额合计等于申请金额，类别随行。
      expect(appendCalls).toHaveLength(1);
      const confirmedCosts = appendCalls[0]!.impacts.filter((impact) => impact.impactKind === "confirmed_cost");
      expect(confirmedCosts.map((impact) => impact.amountCents)).toEqual([90000n, 40000n, 20000n]);
      expect(confirmedCosts.map((impact) => impact.costCategoryCode)).toEqual([
        "project_daily_expense", "project_daily_expense", "project_daily_expense"
      ]);
      expect(appendCalls[0]!.impacts.find((impact) => impact.impactKind === "payable_increase")?.amountCents).toBe(150000n);

      // EXP-05：审批后追加附件不改金额/明细，也不因此重走审批。
      const appendedVoucher = await createVoucher(prisma, fixture.financeStaffUserId, fixture.prefix, "appended-receipt");
      await claims.appendAttachment(direct.id, fixture.financeStaffUserId, {
        fileId: appendedVoucher,
        category: "invoice"
      });
      const afterAppend = await claims.getMine(direct.id, fixture.employeeUserId);
      expect(afterAppend.status).toBe("approved_pending_payment");
      expect(afterAppend.requestedAmountCents).toBe("150000");
      expect(afterAppend.lines.map((line) => line.amountCents)).toEqual(["90000", "40000", "20000"]);
      expect(afterAppend.attachments.filter((attachment) => attachment.removedAt === null)).toHaveLength(3);
      expect(afterAppend.attachments.map((attachment) => attachment.stage)).toEqual([
        "approval_frozen", "approval_frozen", "post_submit_append"
      ]);

      // 3) 实付只清偿，不重复计成本。
      const voucher = await createVoucher(prisma, fixture.financeStaffUserId, fixture.prefix, "payment");
      const payment = await claims.recordPayment(direct.id, fixture.financeStaffUserId, {
        amountCents: "150000",
        paidAt: "2026-11-21",
        paymentMethod: "bank_transfer",
        voucherFileId: voucher,
        confirmationPassword: "current-password",
        note: "公司补付垫付员工"
      });
      expect(payment.status).toBe("paid");
      expect((await prisma.expenseClaim.findUniqueOrThrow({ where: { id: direct.id } })).fundedAmountCents).toBe(150000n);
      // 实付阶段经营来源由付款执行适配器负责；本用例只断言审批阶段成本未再增加。
      const approvalAppends = appendCalls.filter((call) => call.sourceBusinessId === direct.id);
      expect(approvalAppends).toHaveLength(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  integrationTest("lets an employee claim only the advanced part of a purchase batch without a second cost", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const batchLedgerCalls: bigint[] = [];
    const batchLedger = {
      appendConfirmedSourceInTransaction: async (_tx: unknown, input: AppendOperatingFactInput) => {
        batchLedgerCalls.push(input.amountCents ?? 0n);
        return { id: randomUUID() };
      }
    } as unknown as OperatingLedgerService;
    const batches = new ActualPurchaseBatchService(
      prisma as never,
      new AuditService(),
      batchLedger,
      { confirmPassword: async () => undefined } as never
    );
    const claimAppendCalls: Array<{ impacts: NonNullable<AppendOperatingFactInput["impacts"]> }> = [];
    const approvalAdapter = new ExpenseClaimApprovalOperatingSourceAdapter();
    const claims = buildExpenseClaimService(prisma, async (tx, locator) => {
      if (locator.sourceType !== EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE) return;
      const snapshot = await approvalAdapter.readSourceSnapshot(tx, locator);
      if (!snapshot) return;
      const fact = approvalAdapter.toOperatingFactInput(snapshot);
      claimAppendCalls.push({ impacts: fact.input.impacts ?? [] });
    }, batches);
    try {
      // 1000 元实际采购批次；供应商直付 600，员工垫付 400。
      const batch = await batches.create(fixture.materialUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "100000",
        idempotencyKey: `batch-404-${fixture.prefix}`,
        lines: [{ materialName: "角钢", quantity: "10", unitPrice: "100", amountCents: "100000" }]
      });
      const companyPayment = await batches.createSpotPayment(fixture.materialUserId, batch.id, {
        requestedAmountCents: "60000",
        paymentType: "company_direct",
        payeeName: "合成五金供应商",
        paymentMethods: ["bank_transfer"],
        channels: [{ channelType: "bank_transfer", accountName: "合成五金供应商", accountNumber: "6222000000000001", bankName: "合成银行", isPrimary: true }],
        idempotencyKey: `spot-payment-404-${fixture.prefix}`
      });
      await prisma.spotProcurementPayment.update({ where: { id: companyPayment.id }, data: { status: "approval_pending", approvalAmountCents: 60000n } });
      await prisma.$transaction(async (tx) => {
        await batches.confirmCostForSpotPaymentInTransaction(tx, companyPayment.id, fixture.materialUserId, new Date("2026-11-19T02:00:00.000Z"));
      });
      await executeSpot(prisma, companyPayment.id, 60000n, "2026-11-19", fixture.prefix, fixture.materialUserId);
      expect(batchLedgerCalls).toEqual([100000n]);
      const costConfirmedBatch = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(costConfirmedBatch.costVersion).toBe(1);

      // 原采购单垫付报销只能由垫付人本人发起，并沿用原采购类别。
      await expect(claims.create(fixture.comprehensiveDirectorUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "代他人垫付",
        requestedAmountCents: "40000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-20", purpose: "员工垫付", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      })).rejects.toThrow("垫付人本人");
      await expect(claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "改类别",
        requestedAmountCents: "40000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "餐饮", occurredOn: "2026-11-20", purpose: "改类别", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      })).rejects.toThrow("沿用原采购类别");
      // 超过批次剩余可付金额（1000-600=400）被拒绝，不能重复占用。
      await expect(claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "超额垫付报销",
        requestedAmountCents: "50000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-20", purpose: "超额", receiptCount: 1, amountCents: "50000", evidenceType: "invoice" }]
      })).rejects.toThrow("超过批次剩余可付金额");

      const advance = await claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "员工垫付 400 采购款",
        requestedAmountCents: "40000",
        paymentMethod: "bank_transfer",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-20", purpose: "员工垫付采购", quantity: "4", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      });
      // PUR-12：详情带出原采购信息、供应商、原申请编号与附件。
      const detail = await claims.getMine(advance.id, fixture.employeeUserId);
      expect(detail.sourcePurchase).toMatchObject({
        batchId: batch.id,
        kind: "spot_material",
        supplierName: "合成五金供应商",
        categoryLabel: "零星材料",
        procurementCode: `LXCG-404-${fixture.prefix}`,
        costConfirmed: true,
        totalAmountCents: "100000"
      });
      expect(detail.lines.map((line) => [line.expenseCategory, line.quantity?.toFixed() ?? null])).toEqual([["零星材料", "4"]]);
      expect(detail.sourcePurchase?.attachments).toHaveLength(1);
      expect(detail.sourcePurchase?.attachments[0]).toMatchObject({
        fileId: fixture.procurementAttachmentFileId,
        category: "invoice",
        fileName: "原采购发票.pdf"
      });
      // 选择器只列同一项目仍可占用的批次，由填单人手工选择。
      const selectable = await claims.selectableAdvanceBatches(fixture.employeeUserId, {
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId
      });
      expect(selectable.batches).toEqual([
        expect.objectContaining({ batchId: batch.id, supplierName: "合成五金供应商", availableAmountCents: "40000", costConfirmed: true })
      ]);

      // 采购批次垫付仍按原串联审批，每次办理当前节点。
      await claims.submit(advance.id, fixture.employeeUserId);
      await claims.review(advance.id, fixture.comprehensiveDirectorUserId, { decision: "approve" });
      await claims.review(advance.id, fixture.managerUserId, { decision: "approve" });
      await claims.review(advance.id, fixture.financeDirectorUserId, { decision: "approve" });
      const completed = await claims.review(advance.id, fixture.chairmanUserId, { decision: "approve" });
      expect(completed.completed).toBe(true);
      // 成本仍只由批次确认一次：垫付报销审批不写第二笔 confirmed_cost。
      const afterClaim = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(afterClaim.costVersion).toBe(1);
      expect(batchLedgerCalls).toEqual([100000n]);
      expect(claimAppendCalls).toHaveLength(1);
      expect(claimAppendCalls[0]!.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
      expect(claimAppendCalls[0]!.impacts.filter((impact) => impact.impactKind === "payable_increase").map((impact) => impact.amountCents)).toEqual([40000n]);
      const afterApprovalCapacity = await batches.capacityForBatch(batch.id);
      expect(afterApprovalCapacity.usedAmountCents).toBe(100000n);
      expect(afterApprovalCapacity.availableAmountCents).toBe(0n);

      // 公司补付员工 400，批次净实付 1000、容量用尽。
      const voucher = await createVoucher(prisma, fixture.financeStaffUserId, fixture.prefix, "advance-payment");
      const payment = await claims.recordPayment(advance.id, fixture.financeStaffUserId, {
        amountCents: "40000",
        paidAt: "2026-11-21",
        paymentMethod: "bank_transfer",
        voucherFileId: voucher,
        confirmationPassword: "current-password"
      });
      expect(payment.status).toBe("paid");
      const execution = await prisma.expenseClaimPaymentExecution.findFirstOrThrow({ where: { expenseClaimId: advance.id } });
      expect(execution.amountCents).toBe(40000n);
      expect((await batches.capacityForBatch(batch.id)).availableAmountCents).toBe(0n);
      // 数据库层兜底：批次关联报销实付累计不得越过批次确认金额（触发器按批次汇总报销实付）。
      const overPayVoucher = await createVoucher(prisma, fixture.financeStaffUserId, fixture.prefix, "advance-overpay");
      await expect(prisma.expenseClaimPaymentExecution.create({
        data: {
          expenseClaimId: advance.id,
          amountCents: 60001n,
          paidAt: new Date("2026-11-21T00:00:00.000Z"),
          paymentMethod: "bank_transfer",
          voucherFileId: overPayVoucher,
          recordedByUserId: fixture.financeStaffUserId
        }
      })).rejects.toThrow(/actual_purchase_batch_overpay/u);

      // 退款后容量恢复：批次净实付回到 600，可再占用 400；成本不因退款减少或重复。
      await batches.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "expense_claim_payment_execution",
        executionId: execution.id,
        amountCents: "40000",
        receivedAt: "2026-11-22",
        reason: "员工垫付报销退回",
        accountId: fixture.accountId,
        idempotencyKey: `refund-advance-404-${fixture.prefix}`
      });
      const restored = await batches.capacityForBatch(batch.id);
      expect(restored.refundedAmountCents).toBe(40000n);
      expect(restored.netPaidAmountCents).toBe(60000n);
      expect(restored.availableAmountCents).toBe(40000n);
      const stillOneCost = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(stillOneCost.costVersion).toBe(1);
      expect(batchLedgerCalls).toEqual([100000n]);

      const reClaim = await claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "退款后重新垫付",
        requestedAmountCents: "40000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-22", purpose: "重新垫付", quantity: "4", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      });
      expect(reClaim.id).not.toBe(advance.id);
      await expect(claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: batch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "超额再次占用",
        requestedAmountCents: "40001",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "零星材料", occurredOn: "2026-11-22", purpose: "超额", receiptCount: 1, amountCents: "40001", evidenceType: "invoice" }]
      })).rejects.toThrow("超过批次剩余可付金额");
    } finally {
      await prisma.$disconnect();
    }
  });
  integrationTest("carries general procurement and company-daily sources into employee advance claims", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const batches = new ActualPurchaseBatchService(
      prisma as never,
      new AuditService(),
      { appendConfirmedSourceInTransaction: async () => ({ id: randomUUID() }) } as unknown as OperatingLedgerService,
      { confirmPassword: async () => undefined } as never
    );
    const claims = buildExpenseClaimService(prisma, async () => undefined, batches);
    try {
      const projectBatch = await batches.create(fixture.comprehensiveDirectorUserId, {
        kind: "general",
        procurementId: fixture.generalProcurementId,
        companyEntityId: fixture.companyId,
        supplierName: "合成办公用品供应商",
        totalAmountCents: "100000",
        idempotencyKey: `general-batch-404-${fixture.prefix}`,
        lines: [{ materialName: "办公用品一批", amountCents: "100000" }]
      });
      const generalAdvance = await claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: projectBatch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "员工垫付办公用品",
        requestedAmountCents: "40000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: " 办公用品 ", occurredOn: "2026-11-20", purpose: "垫付办公用品", quantity: "4", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      });
      const generalDetail = await claims.getMine(generalAdvance.id, fixture.employeeUserId);
      expect(generalDetail.sourcePurchase).toMatchObject({
        kind: "general",
        categoryLabel: "办公用品",
        procurementCode: `ZHCG-404-${fixture.prefix}`,
        supplierName: "合成办公用品供应商"
      });
      expect(generalDetail.lines.map((line) => line.expenseCategory)).toEqual(["办公用品"]);
      await expect(claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: projectBatch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        projectId: fixture.projectId,
        reason: "改类别",
        requestedAmountCents: "40000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "餐饮", occurredOn: "2026-11-20", purpose: "改类别", receiptCount: 1, amountCents: "40000", evidenceType: "invoice" }]
      })).rejects.toThrow("沿用原采购类别");

      // 公司日常综合采购（不选项目）：允许不关联项目报销，沿用原采购类别，不虚构项目。
      const companyDailyBatch = await batches.create(fixture.comprehensiveDirectorUserId, {
        kind: "general",
        procurementId: fixture.companyDailyProcurementId,
        companyEntityId: fixture.companyId,
        supplierName: "合成后勤供应商",
        totalAmountCents: "50000",
        idempotencyKey: `general-rc-batch-404-${fixture.prefix}`,
        lines: [{ materialName: "后勤用品", amountCents: "50000" }]
      });
      const companyDailyAdvance = await claims.create(fixture.employeeUserId, {
        actualPurchaseBatchId: companyDailyBatch.id,
        claimType: "reimbursement",
        applicantUserId: fixture.employeeUserId,
        companyEntityId: fixture.companyId,
        factWitnessUserId: fixture.managerUserId,
        reason: "公司日常后勤垫付",
        requestedAmountCents: "5000",
        payeeName: "垫付员工",
        lines: [{ expenseCategory: "后勤费用", occurredOn: "2026-11-20", purpose: "公司日常后勤", receiptCount: 1, amountCents: "5000", evidenceType: "invoice" }]
      });
      const companyDailyDetail = await claims.getMine(companyDailyAdvance.id, fixture.employeeUserId);
      expect(companyDailyDetail.projectId).toBeNull();
      expect(companyDailyDetail.sourcePurchase).toMatchObject({
        kind: "general",
        categoryLabel: "后勤费用",
        projectId: null,
        procurementCode: `ZHCG-RC-${fixture.prefix}`
      });
    } finally {
      await prisma.$disconnect();
    }
  });

});

function buildExpenseClaimService(
  prisma: PrismaClient,
  append: (
    tx: Parameters<ExpenseClaimApprovalOperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: Parameters<ExpenseClaimApprovalOperatingSourceAdapter["readSourceSnapshot"]>[1]
  ) => Promise<void>,
  batches?: ActualPurchaseBatchService
) {
  const files = {
    assertFileHasNoBusinessBinding: async (_tx: unknown, fileId: string) => {
      const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId }, select: { uploadedByUserId: true } });
      return { uploadedByUserId: file.uploadedByUserId };
    }
  };
  const operatingSources = {
    appendConfirmedSourceIfEnabledInTransaction: async (
      tx: Parameters<ExpenseClaimApprovalOperatingSourceAdapter["readSourceSnapshot"]>[0],
      locator: Parameters<ExpenseClaimApprovalOperatingSourceAdapter["readSourceSnapshot"]>[1]
    ) => append(tx, locator)
  };
  return new ExpenseClaimService(
    prisma as never,
    new BusinessNumberingService(),
    new AuditService(),
    { confirmPassword: async (_userId: string, password: string) => { if (password !== "current-password") throw new Error("密码错误"); } } as never,
    new ProjectVisibilityService(prisma as never),
    files as never,
    undefined,
    undefined,
    operatingSources as never,
    undefined,
    undefined,
    batches
  );
}

async function createVoucher(prisma: PrismaClient, userId: string, prefix: string, label: string) {
  const id = randomUUID();
  await prisma.fileObject.create({
    data: {
      id,
      bucket: "private",
      objectKey: `issue404/${prefix}/${label}.pdf`,
      originalName: `${label}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 128,
      uploadedByUserId: userId,
      contentSha256: sha(`voucher-${prefix}-${label}`),
      storageStatus: "active"
    }
  });
  return id;
}

async function executeSpot(prisma: PrismaClient, paymentId: string, amountCents: bigint, paidOn: string, prefix: string, actorUserId: string) {
  const payment = await prisma.spotProcurementPayment.findUniqueOrThrow({ where: { id: paymentId } });
  await prisma.spotProcurementPaymentExecution.create({
    data: {
      paymentId,
      amountCents,
      paidAt: new Date(`${paidOn}T00:00:00.000Z`),
      paymentMethod: "bank_transfer",
      executedByUserId: actorUserId,
      idempotencyKey: `exec-${prefix}-${randomUUID()}`
    }
  });
  const paidAmountCents = payment.paidAmountCents + amountCents;
  await prisma.spotProcurementPayment.update({
    where: { id: paymentId },
    data: { paidAmountCents, status: paidAmountCents >= payment.approvalAmountCents ? "paid" : "partially_paid" }
  });
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertDedicatedDatabase(): string {
  const raw = process.env.ISSUE404_DATABASE_URL?.trim();
  if (!raw) throw new Error("ISSUE404_DATABASE_URL 未配置");
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !url.pathname.includes("issue404")) {
    throw new Error("仅允许本机一次性 #404 专库");
  }
  return raw;
}

async function seedFixture(prisma: PrismaClient) {
  const prefix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const companyId = randomUUID();
  const employeeUserId = randomUUID();
  const managerUserId = randomUUID();
  const materialUserId = randomUUID();
  const comprehensiveDirectorUserId = randomUUID();
  const financeDirectorUserId = randomUUID();
  const financeStaffUserId = randomUUID();
  const chairmanUserId = randomUUID();
  const procurementId = randomUUID();
  const versionId = randomUUID();
  const accountId = randomUUID();
  const openingId = randomUUID();
  const sourceBatchId = randomUUID();
  const procurementAttachmentFileId = randomUUID();
  const procurementAttachmentId = randomUUID();

  await prisma.companyEntity.create({ data: { id: companyId, name: `合成费用公司 ${prefix}`, dataStatus: "complete" } });
  await prisma.project.create({
    data: {
      id: projectId,
      code: `P404-${prefix}`,
      name: `#404 真库项目 ${prefix}`,
      operatingLedgerEffectiveDate: new Date("2026-11-01")
    }
  });
  await prisma.user.createMany({
    data: [
      { id: employeeUserId, name: "垫付员工" },
      { id: managerUserId, name: "项目经理" },
      { id: materialUserId, name: "物资经办" },
      { id: comprehensiveDirectorUserId, name: "综合部主管" },
      { id: financeDirectorUserId, name: "财务主管" },
      { id: financeStaffUserId, name: "财务经办" },
      { id: chairmanUserId, name: "董事长" }
    ]
  });
  const positionIds: Record<string, string> = {};
  for (const [key, name] of [
    ["employee", "员工"],
    ["project_manager", "项目经理"],
    ["material_staff", "物资员"],
    ["comprehensive_director", "综合部主管"],
    ["finance_director", "财务主管"],
    ["finance_staff", "财务人员"],
    ["chairman", "董事长"]
  ] as const) {
    const existing = await prisma.position.findUnique({ where: { key } });
    positionIds[key] = existing?.id ?? (await prisma.position.create({ data: { key, name } })).id;
  }
  await prisma.userPosition.createMany({
    data: [
      { userId: comprehensiveDirectorUserId, positionId: positionIds.comprehensive_director! },
      { userId: financeDirectorUserId, positionId: positionIds.finance_director! },
      { userId: financeStaffUserId, positionId: positionIds.finance_staff! },
      { userId: chairmanUserId, positionId: positionIds.chairman! }
    ]
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId, userId: employeeUserId, positionKey: "employee" },
      { projectId, userId: managerUserId, positionKey: "project_manager" },
      { projectId, userId: materialUserId, positionKey: "material_staff" }
    ]
  });
  const party = await prisma.businessParty.create({ data: { name: `合成施工企业 ${prefix}`, normalizedName: `party-404-${prefix}`, createdByUserId: employeeUserId } });
  const partyVersion = await prisma.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name }, createdByUserId: employeeUserId } });
  await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: party.id,
      businessPartyVersionId: partyVersion.id,
      affiliateNameSnapshot: party.name,
      effectiveFrom: new Date("2020-01-01"),
      changeReason: "报销真库",
      assignedByUserId: employeeUserId
    }
  });
  const generalProcurementId = randomUUID();
  const companyDailyProcurementId = randomUUID();
  await prisma.generalProcurement.createMany({
    data: [
      {
        id: generalProcurementId,
        code: `ZHCG-404-${prefix}`,
        requestKey: `general-404-${prefix}`,
        creationFingerprint: sha(`general-${prefix}`),
        projectId,
        companyEntityId: companyId,
        companyNameSnapshot: `合成费用公司 ${prefix}`,
        applicantUserId: comprehensiveDirectorUserId,
        applicantNameSnapshot: "综合部主管",
        category: "office_supplies",
        reason: "办公用品实际采购",
        requestProtocolVersion: 2,
        scope: "project",
        lines: [],
        status: "approved_pending_procurement"
      },
      {
        id: companyDailyProcurementId,
        code: `ZHCG-RC-${prefix}`,
        requestKey: `general-rc-404-${prefix}`,
        creationFingerprint: sha(`general-rc-${prefix}`),
        projectId: null,
        companyEntityId: companyId,
        companyNameSnapshot: `合成费用公司 ${prefix}`,
        applicantUserId: comprehensiveDirectorUserId,
        applicantNameSnapshot: "综合部主管",
        category: "logistics",
        reason: "公司日常后勤采购",
        requestProtocolVersion: 2,
        scope: "company_daily",
        lines: [],
        status: "approved_pending_procurement"
      }
    ]
  });
  await prisma.spotProcurement.create({
    data: {
      id: procurementId,
      projectId,
      code: `LXCG-404-${prefix}`,
      applicantUserId: materialUserId,
      handlerUserId: materialUserId,
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
      handlerUserId: materialUserId,
      applicationDepartmentSnapshot: "物资部",
      applicationNameSnapshot: "物资经办",
      purchaserNameSnapshot: "物资经办",
      purchaserDepartmentNameSnapshot: "物资部",
      createdByUserId: materialUserId,
      approvedAt: new Date("2026-11-18T00:00:00.000Z")
    }
  });
  await prisma.spotProcurement.update({ where: { id: procurementId }, data: { currentVersionId: versionId } });
  await prisma.spotProcurementLine.create({
    data: { versionId, sortOrder: 1, materialName: "角钢", quantity: 10, unitPrice: 100, amountCents: 100000n }
  });
  await prisma.fileObject.create({
    data: {
      id: procurementAttachmentFileId,
      bucket: "private",
      objectKey: `issue404/${prefix}/procurement-invoice.pdf`,
      originalName: "原采购发票.pdf",
      mimeType: "application/pdf",
      sizeBytes: 256,
      uploadedByUserId: materialUserId,
      contentSha256: sha(`procurement-${prefix}`),
      storageStatus: "active"
    }
  });
  await prisma.spotProcurementAttachment.create({
    data: { id: procurementAttachmentId, versionId, fileId: procurementAttachmentFileId, category: "invoice", uploadedByUserId: materialUserId }
  });
  await prisma.registeredFundAccount.create({ data: { id: accountId, scopeKey: `public_cash_404_${prefix}`, kind: "public_cash" } });
  await prisma.fundAccountBalanceRegistration.create({
    data: {
      id: openingId,
      accountId,
      version: 1,
      kind: "opening",
      status: "confirmed",
      balanceYuan: 5000,
      asOfDate: "2026-11-01",
      evidenceReference: `OPEN-404-${prefix}`,
      reconciliationNote: "真库期初",
      reason: "真库期初",
      idempotencyKey: `opening-404-${prefix}`,
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
  for (const [userId] of [
    [comprehensiveDirectorUserId],
    [managerUserId],
    [financeDirectorUserId],
    [chairmanUserId]
  ] as const) {
    const fileId = randomUUID();
    const digest = sha(`signature-${userId}-${prefix}`);
    await prisma.fileObject.create({
      data: {
        id: fileId,
        bucket: "private",
        objectKey: `issue404/${prefix}/signature-${userId}.png`,
        originalName: "signature.png",
        mimeType: "image/png",
        sizeBytes: 128,
        uploadedByUserId: userId,
        contentSha256: digest,
        storageStatus: "active"
      }
    });
    await prisma.handwrittenSignatureVersion.create({
      data: { userId, fileId, contentSha256: digest, source: "canvas" }
    });
  }
  return {
    prefix,
    projectId,
    companyId,
    employeeUserId,
    managerUserId,
    materialUserId,
    comprehensiveDirectorUserId,
    financeDirectorUserId,
    financeStaffUserId,
    chairmanUserId,
    procurementId,
    versionId,
    accountId,
    procurementAttachmentFileId,
    generalProcurementId,
    companyDailyProcurementId
  };
}
