import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { FundsWorkbenchService } from "./funds-workbench.service";

describe("FundsWorkbenchService", () => {
  const me = { getFundsPendingBusinessIdsInTransaction: jest.fn() };
  const operatingProjection = { readFundsCompatibilitySnapshot: jest.fn() };
  const prisma = {
    $queryRaw: jest.fn(),
    project: { findMany: jest.fn() },
    paymentRequest: { findMany: jest.fn() },
    spotProcurementPayment: { findMany: jest.fn() },
    spotProcurementDiscrepancy: { findMany: jest.fn() },
    spotProcurementPaymentExecution: { findMany: jest.fn() },
    spotProcurementPaymentExecutionVoucher: { findMany: jest.fn() },
    fileObject: { findMany: jest.fn() },
    expenseClaim: { findMany: jest.fn() }
  };
  const service = new FundsWorkbenchService(
    me as never,
    operatingProjection as never
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    me.getFundsPendingBusinessIdsInTransaction.mockResolvedValue({
      contractPaymentIds: [],
      spotPaymentIds: []
    });
    operatingProjection.readFundsCompatibilitySnapshot.mockImplementation(
      async (_actorUserId, _input, readAdditional) => ({
        integrity: { moneyComplete: true },
        sourceReferenceTotals: [
          { sourceReferenceId: "spot-1", confirmedProjectOutflowCents: "1000" },
          { sourceReferenceId: "loan-1", confirmedProjectOutflowCents: "3000" },
          { sourceReferenceId: "spot-paid", confirmedProjectOutflowCents: "5000" }
        ],
        additional: await readAdditional(prisma, ["project-1"], {
          readAt: new Date("2026-09-12T00:00:00.000Z")
        })
      })
    );
  });

  it("projects only visible contract and spot payments while retaining non-project expense funds", async () => {
    prisma.project.findMany.mockResolvedValue([{ id: "project-1", code: "JG-001", name: "科技园" }]);
    prisma.paymentRequest.findMany.mockResolvedValue([
        { id: "payment-1", code: "FK-001", projectId: "project-1", settlementId: "settlement-1", sourceType: "settlement", status: "approved_pending_payment", requestedAmountCents: 10000n, paidAmountCents: 0n, updatedAt: new Date("2026-07-23T10:00:00.000Z") }
      ]);
    prisma.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "spot-1", code: "LS-001", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "partially_paid", createdAt: new Date("2026-07-23T09:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 1000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ]);
    prisma.expenseClaim.findMany.mockResolvedValue([
        { id: "expense-1", code: "BX-001", claimType: "reimbursement", status: "approved_pending_payment", projectId: null, reason: "差旅", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: "集团资金公司", payeeNameSnapshot: "张三", requestedAmountCents: 12000n, companyPayableAmountCents: 8000n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T12:00:00.000Z") },
        { id: "loan-1", code: "JK-001", claimType: "loan", status: "disbursed", projectId: "project-1", reason: "现场周转", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "李四", requestedAmountCents: 3000n, companyPayableAmountCents: 0n, fundedAmountCents: 3000n, updatedAt: new Date("2026-07-23T13:00:00.000Z") },
        { id: "draft-1", code: "BX-DRAFT", claimType: "reimbursement", status: "draft", projectId: "project-1", reason: "草稿", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: null, requestedAmountCents: 100n, companyPayableAmountCents: 100n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T14:00:00.000Z") }
      ]);
    prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([]);
    prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);

    const result = await service.list("finance-1", { view: "all" });

    expect(operatingProjection.readFundsCompatibilitySnapshot).toHaveBeenCalledWith(
      "finance-1",
      {},
      expect.any(Function)
    );
    expect(result.items).toEqual([
      expect.objectContaining({ code: "JK-001", source: "loan_disbursement", statusLabel: "已完成", remainingAmountCents: "0", project: { id: "project-1", code: "JG-001", name: "科技园" } }),
      expect.objectContaining({ code: "BX-001", source: "expense_reimbursement", requestedAmountCents: "8000", payeeName: "张三", payerName: "集团资金公司", project: null }),
      expect.objectContaining({ code: "LS-001", source: "spot_procurement_payment", statusLabel: "部分支付", remainingAmountCents: "4000" }),
      expect.objectContaining({ code: "FK-001", source: "contract_payment", sourceDocument: "合同结算付款" })
    ]);
    expect(result.items.map((item) => item.code)).not.toContain("BX-DRAFT");
    expect(result.viewCounts).toMatchObject({ all: 4, pending_funds: 3, completed: 1 });
    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ["project-1"] } })
    }));
    expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ projectId: { in: ["project-1"] } }, { projectId: null }] })
    }));
  });

  it("filters pending funds by source and rejects unknown query values", async () => {
    prisma.expenseClaim.findMany.mockResolvedValue([
        { id: "expense-1", code: "BX-001", claimType: "reimbursement", status: "approved_pending_payment", projectId: null, reason: "差旅", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "张三", requestedAmountCents: 12000n, companyPayableAmountCents: 8000n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T12:00:00.000Z") },
        { id: "loan-1", code: "JK-001", claimType: "loan", status: "disbursed", projectId: null, reason: "现场周转", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "李四", requestedAmountCents: 3000n, companyPayableAmountCents: 0n, fundedAmountCents: 3000n, updatedAt: new Date("2026-07-23T13:00:00.000Z") }
      ]);

    await expect(service.list("finance-1", { view: "pending_funds", source: "expense_reimbursement" })).resolves.toMatchObject({
      items: [expect.objectContaining({ code: "BX-001" })]
    });
    await expect(service.list("finance-1", { view: "unknown" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list("finance-1", { source: "unknown" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("retains non-project completed and partial funds when project money is incomplete", async () => {
    for (const model of [prisma.project, prisma.paymentRequest, prisma.spotProcurementPayment,
      prisma.spotProcurementDiscrepancy, prisma.spotProcurementPaymentExecution,
      prisma.spotProcurementPaymentExecutionVoucher, prisma.fileObject]) {
      model.findMany.mockResolvedValue([]);
    }
    operatingProjection.readFundsCompatibilitySnapshot.mockImplementation(
      async (_actor, _input, readAdditional) => ({
        integrity: { moneyComplete: false }, sourceReferenceTotals: [],
        additional: await readAdditional(prisma, ["project-1"], {
          readAt: new Date("2026-09-12T00:00:00.000Z"), moneyComplete: false
        })
      })
    );
    const claim = { claimType: "reimbursement", status: "paid", projectId: null,
      reason: "差旅", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null,
      payeeNameSnapshot: "张三", requestedAmountCents: 8000n, companyPayableAmountCents: 8000n,
      fundedAmountCents: 8000n, updatedAt: new Date("2026-07-23T12:00:00.000Z") };
    prisma.expenseClaim.findMany.mockResolvedValue([
      { ...claim, id: "expense-done", code: "BX-DONE" },
      { ...claim, id: "loan-done", code: "JK-DONE", claimType: "loan", status: "disbursed" },
      { ...claim, id: "expense-part", code: "BX-PART", status: "partially_paid", fundedAmountCents: 3000n },
      { ...claim, id: "project-done", code: "BX-PROJECT", projectId: "project-1" }
    ]);
    const result = await service.list("finance-1", { view: "all" });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "expense-done", paidAmountCents: "8000", remainingAmountCents: "0", statusLabel: "已完成", project: null }),
      expect.objectContaining({ id: "loan-done", paidAmountCents: "8000", remainingAmountCents: "0", statusLabel: "已完成" }),
      expect.objectContaining({ id: "expense-part", paidAmountCents: "3000", remainingAmountCents: "5000", statusLabel: "部分支付" }),
      expect.objectContaining({ id: "project-done", paidAmountCents: null, remainingAmountCents: null })
    ]));
    expect(result.viewCounts).toMatchObject({ all: 4, completed: 2, partial_payment: 1 });
    const countSql = prisma.$queryRaw.mock.calls.map(([query]) =>
      (query as { strings: readonly string[] }).strings.join(" ")
    ).find((sql) => sql.includes("normalized AS"));
    expect(countSql).toContain('CASE WHEN claim."projectId" IS NULL AND claim."claimType" IN (\'reimbursement\', \'loan\')');
    expect(countSql).toContain('- claim."fundedAmountCents", 0)');
    const completed = await service.list("finance-1", { view: "completed" });
    expect(completed.items.map((item) => item.id).sort()).toEqual(["expense-done", "loan-done"]);
  });

  it("uses source-filtered database counts independently from the selected view", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      all: 9n,
      pending_action: 1n,
      in_progress: 2n,
      pending_funds: 3n,
      partial_payment: 1n,
      pending_refund: 1n,
      pending_evidence: 1n,
      completed: 2n,
      contract_payment: 9n,
      spot_procurement_payment: 8n,
      expense_reimbursement: 7n,
      incidental_expense: 6n,
      loan_disbursement: 5n
    }]);
    prisma.paymentRequest.findMany.mockResolvedValue([{
      id: "payment-1",
      code: "FK-001",
      projectId: "project-1",
      settlementId: null,
      sourceType: "settlement",
      status: "approval_pending",
      requestedAmountCents: 5000n,
      updatedAt: new Date("2026-09-12T01:00:00.000Z")
    }]);
    prisma.project.findMany.mockResolvedValue([]);

    await expect(service.list("finance-1", {
      view: "in_progress",
      source: "contract_payment"
    })).resolves.toMatchObject({
      viewCounts: {
        all: 9,
        pending_action: 1,
        in_progress: 2,
        pending_funds: 3,
        partial_payment: 1,
        pending_refund: 1,
        pending_evidence: 1,
        completed: 2
      },
      sourceCounts: {
        contract_payment: 9,
        spot_procurement_payment: 8,
        expense_reimbursement: 7,
        incidental_expense: 6,
        loan_disbursement: 5
      }
    });
  });

  it("fails closed when database-wide formal source counts exceed the shared budget", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      all: 10_001n,
      pending_action: 0n,
      in_progress: 0n,
      pending_funds: 0n,
      partial_payment: 0n,
      pending_refund: 0n,
      pending_evidence: 0n,
      completed: 0n,
      contract_payment: 10_001n,
      spot_procurement_payment: 0n,
      expense_reimbursement: 0n,
      incidental_expense: 0n,
      loan_disbursement: 0n
    }]);

    await expect(service.list("finance-1", {
      view: "all",
      source: "spot_procurement_payment"
    })).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(prisma.paymentRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.expenseClaim.findMany).not.toHaveBeenCalled();
  });

  it("lists project-scoped incidental expense actual payments as a separate funds source", async () => {
    prisma.project.findMany.mockResolvedValue([{ id: "project-1", code: "JG-001", name: "科技园" }]);
    prisma.expenseClaim.findMany.mockResolvedValue([
        {
          id: "incidental-1",
          code: "LXFY-001",
          claimType: "incidental_expense",
          status: "approved_pending_payment",
          projectId: "project-1",
          reason: "临时机械台班",
          companyEntityNameSnapshot: "建工",
          paymentSubjectNameSnapshot: "项目公司",
          payeeNameSnapshot: "机械服务商",
          requestedAmountCents: 12000n,
          companyPayableAmountCents: 12000n,
          fundedAmountCents: 0n,
          updatedAt: new Date("2026-08-15T01:00:00.000Z")
        }
      ]);

    await expect(
      service.list("finance-1", {
        view: "pending_funds",
        source: "incidental_expense"
      })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          code: "LXFY-001",
          source: "incidental_expense",
          sourceDocument: "零星费用实际付款",
          project: { id: "project-1", code: "JG-001", name: "科技园" },
          remainingAmountCents: "12000"
        })
      ],
      sourceCounts: { incidental_expense: 1 }
    });
  });

  it("projects partial payment from source facts without treating it as completed", async () => {
    prisma.paymentRequest.findMany.mockResolvedValue([]);
    prisma.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "spot-1", code: "LS-001", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "partially_paid", createdAt: new Date("2026-07-23T09:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 1000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ]);
    prisma.expenseClaim.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([]);
    prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);

    await expect(service.list("finance-1", { view: "partial_payment" })).resolves.toMatchObject({
      items: [expect.objectContaining({ code: "LS-001", statusLabel: "部分支付", remainingAmountCents: "4000" })],
      viewCounts: expect.objectContaining({ partial_payment: 1, completed: 0 })
    });
  });

  it("projects only the refund owner into pending refund and excludes it from completed", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "spot-paid" }]);
    prisma.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "spot-paid", code: "LS-PAID", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "paid", createdAt: new Date("2026-07-23T09:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 5000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") },
        { id: "spot-voided", code: "LS-VOID", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "voided", createdAt: new Date("2026-07-23T10:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 0n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T12:00:00.000Z") }
      ]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([
      { procurementId: "procurement-1", procurementVersionId: "version-1" }
    ]);
    prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);

    await expect(service.list("finance-1", { view: "pending_refund" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "spot-paid", statusLabel: "待退款处理" })],
      viewCounts: expect.objectContaining({ pending_refund: 1, completed: 0 })
    });
    expect(prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["spot-paid"] } }) })
    );
    expect(prisma.spotProcurementDiscrepancy.findMany).not.toHaveBeenCalled();
  });

  it("projects actual spot payments with no active voucher into pending evidence", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "spot-paid" }]);
    prisma.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "spot-paid", code: "LS-PAID", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "paid", createdAt: new Date("2026-07-23T09:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 5000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([]);
    prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([
      { id: "execution-1", paymentId: "spot-paid", voucherFileId: null }
    ]);
    prisma.spotProcurementPaymentExecutionVoucher.findMany.mockResolvedValue([]);

    await expect(service.list("finance-1", { view: "pending_evidence" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "spot-paid", statusLabel: "待补票据" })],
      viewCounts: expect.objectContaining({ pending_evidence: 1, completed: 0 })
    });
    expect(prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["spot-paid"] } }) })
    );
    expect(prisma.spotProcurementPaymentExecution.findMany).not.toHaveBeenCalled();
  });

  it("uses the canonical work-item projection for my pending contract and spot actions", async () => {
    me.getFundsPendingBusinessIdsInTransaction.mockResolvedValue({
      contractPaymentIds: ["payment-1"],
      spotPaymentIds: ["spot-1"]
    });
    prisma.paymentRequest.findMany.mockResolvedValue([
        { id: "payment-1", code: "FK-001", projectId: "project-1", settlementId: null, sourceType: "settlement", status: "approval_pending", requestedAmountCents: 5000n, paidAmountCents: 0n, updatedAt: new Date("2026-07-23T10:00:00.000Z") }
      ]);
    prisma.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "spot-1", code: "LS-001", projectId: "project-1", procurementId: "procurement-1", procurementVersionId: "version-1", status: "approved_pending_payment", createdAt: new Date("2026-07-23T09:00:00.000Z"), companyPaymentAmountCents: 5000n, paidAmountCents: 0n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([]);
    prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);

    await expect(service.list("finance-1", { view: "pending_action" })).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: "spot-1", pendingMyAction: true }),
        expect.objectContaining({ id: "payment-1", pendingMyAction: true })
      ],
      viewCounts: expect.objectContaining({ pending_action: 2 })
    });
    expect(me.getFundsPendingBusinessIdsInTransaction).toHaveBeenCalledWith(
      prisma,
      "finance-1",
      ["project-1"],
      new Date("2026-09-12T00:00:00.000Z"),
      expect.objectContaining({
        remaining: expect.any(Function),
        consume: expect.any(Function)
      })
    );
  });

  it("chunks every visible-project query without treating the batch size as a business cap", async () => {
    const visibleProjectIds = Array.from({ length: 1_001 }, (_, index) => `project-${index}`);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      project: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      expenseClaim: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementDiscrepancy: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPaymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPaymentExecutionVoucher: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const localProjection = {
      readFundsCompatibilitySnapshot: jest.fn(async (_actor, _input, readAdditional) => ({
        integrity: { moneyComplete: true },
        sourceReferenceTotals: [],
        additional: await readAdditional(tx, visibleProjectIds, {
          readAt: new Date("2026-09-12T00:00:00.000Z")
        })
      }))
    };
    const localService = new FundsWorkbenchService(
      { getFundsPendingBusinessIdsInTransaction: jest.fn().mockResolvedValue({ contractPaymentIds: [], spotPaymentIds: [] }) } as never,
      localProjection as never
    );

    await expect(localService.list("finance-1", {})).resolves.toMatchObject({ items: [] });
    for (const reader of [tx.paymentRequest.findMany, tx.spotProcurementPayment.findMany]) {
      expect(reader).toHaveBeenCalledTimes(3);
      for (const [query] of reader.mock.calls) {
        const ids = query.where.id?.in ?? query.where.projectId?.in;
        expect(ids.length).toBeLessThanOrEqual(500);
      }
    }
    expect(tx.project.findMany).not.toHaveBeenCalled();
    expect(tx.expenseClaim.findMany).toHaveBeenCalledTimes(3);
    expect(tx.expenseClaim.findMany.mock.calls[0]?.[0].where.OR)
      .toContainEqual({ projectId: null });
    expect(tx.expenseClaim.findMany.mock.calls[1]?.[0].where.OR)
      .not.toContainEqual({ projectId: null });
  });

  it("does not charge an excluded funds source against the selected source budget", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      project: { findMany: jest.fn() },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue(Array.from(
          { length: 10_001 },
          (_, index) => ({ id: `unrelated-payment-${index}` })
        ))
      },
      spotProcurementPayment: { findMany: jest.fn() },
      expenseClaim: { findMany: jest.fn().mockResolvedValue([{
        id: "loan-1",
        code: "JK-001",
        claimType: "loan",
        status: "approved_pending_disbursement",
        projectId: null,
        reason: "现场周转",
        companyEntityNameSnapshot: "建工",
        paymentSubjectNameSnapshot: null,
        payeeNameSnapshot: "李四",
        requestedAmountCents: 3000n,
        companyPayableAmountCents: 0n,
        fundedAmountCents: 0n,
        updatedAt: new Date("2026-09-12T01:00:00.000Z")
      }]) },
      spotProcurementDiscrepancy: { findMany: jest.fn() },
      spotProcurementPaymentExecution: { findMany: jest.fn() },
      spotProcurementPaymentExecutionVoucher: { findMany: jest.fn() },
      fileObject: { findMany: jest.fn() }
    };
    const localProjection = {
      readFundsCompatibilitySnapshot: jest.fn(async (_actor, _input, readAdditional) => ({
        integrity: { moneyComplete: true },
        sourceReferenceTotals: [],
        additional: await readAdditional(tx, ["project-1"], {
          readAt: new Date("2026-09-12T00:00:00.000Z")
        })
      }))
    };
    const localService = new FundsWorkbenchService(
      { getFundsPendingBusinessIdsInTransaction: jest.fn().mockResolvedValue({ contractPaymentIds: [], spotPaymentIds: [] }) } as never,
      localProjection as never
    );

    await expect(localService.list("finance-1", { source: "loan_disbursement" }))
      .resolves.toMatchObject({
        items: [expect.objectContaining({ id: "loan-1", source: "loan_disbursement" })]
      });
    expect(tx.paymentRequest.findMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.findMany).not.toHaveBeenCalled();
    expect(tx.expenseClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ claimType: { in: ["loan"] } })
    }));
  });

  it("pushes a recoverable view status predicate before the row budget", async () => {
    const payment = {
      id: "payment-paid",
      code: "FK-PAID",
      projectId: "project-1",
      settlementId: "settlement-1",
      sourceType: "settlement",
      status: "paid",
      requestedAmountCents: 5000n,
      updatedAt: new Date("2026-09-12T01:00:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", code: "JG-001", name: "科技园" }]) },
      paymentRequest: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          where.status?.in ? [payment] : Array.from(
            { length: 10_001 },
            (_, index) => ({ id: `unfiltered-payment-${index}` })
          ))
      },
      spotProcurementPayment: { findMany: jest.fn() },
      expenseClaim: { findMany: jest.fn() },
      spotProcurementDiscrepancy: { findMany: jest.fn() },
      spotProcurementPaymentExecution: { findMany: jest.fn() },
      spotProcurementPaymentExecutionVoucher: { findMany: jest.fn() },
      fileObject: { findMany: jest.fn() }
    };
    const localProjection = {
      readFundsCompatibilitySnapshot: jest.fn(async (_actor, _input, readAdditional) => ({
        integrity: { moneyComplete: true },
        sourceReferenceTotals: [{
          sourceReferenceId: payment.id,
          confirmedProjectOutflowCents: "5000"
        }],
        additional: await readAdditional(tx, ["project-1"], {
          readAt: new Date("2026-09-12T00:00:00.000Z")
        })
      }))
    };
    const localService = new FundsWorkbenchService(
      { getFundsPendingBusinessIdsInTransaction: jest.fn().mockResolvedValue({ contractPaymentIds: [], spotPaymentIds: [] }) } as never,
      localProjection as never
    );

    await expect(localService.list("finance-1", {
      view: "completed",
      source: "contract_payment"
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: payment.id, statusLabel: "已完成" })]
    });
    expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["paid", "settled", "disbursed", "offset_completed"] }
      })
    }));
  });

  it("fails closed before accumulating a funds source beyond the hard row budget", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      project: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue(Array.from(
          { length: 10_001 },
          (_, index) => ({ id: `payment-${index}` })
        ))
      },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      expenseClaim: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementDiscrepancy: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPaymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPaymentExecutionVoucher: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const localProjection = {
      readFundsCompatibilitySnapshot: jest.fn(async (_actor, _input, readAdditional) => ({
        integrity: { moneyComplete: true },
        sourceReferenceTotals: [],
        additional: await readAdditional(tx, ["project-1"], {
          readAt: new Date("2026-09-12T00:00:00.000Z")
        })
      }))
    };
    const localService = new FundsWorkbenchService(
      { getFundsPendingBusinessIdsInTransaction: jest.fn().mockResolvedValue({ contractPaymentIds: [], spotPaymentIds: [] }) } as never,
      localProjection as never
    );

    await expect(localService.list("finance-1", {}))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
