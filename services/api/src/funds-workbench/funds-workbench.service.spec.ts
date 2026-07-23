import { BadRequestException } from "@nestjs/common";
import { FundsWorkbenchService } from "./funds-workbench.service";

describe("FundsWorkbenchService", () => {
  const findMany = jest.fn();
  const projectVisibility = { visibleProjectIds: jest.fn() };
  const prisma = {
    project: { findMany },
    paymentRequest: { findMany },
    spotProcurementPayment: { findMany },
    expenseClaim: { findMany }
  };
  const service = new FundsWorkbenchService(prisma as never, projectVisibility as never);

  beforeEach(() => {
    jest.resetAllMocks();
    projectVisibility.visibleProjectIds.mockResolvedValue(["project-1"]);
  });

  it("projects only visible contract and spot payments while retaining non-project expense funds", async () => {
    findMany
      .mockResolvedValueOnce([{ id: "project-1", code: "JG-001", name: "科技园" }])
      .mockResolvedValueOnce([
        { id: "payment-1", code: "FK-001", projectId: "project-1", settlementId: "settlement-1", sourceType: "settlement", status: "approved_pending_payment", requestedAmountCents: 10000n, paidAmountCents: 0n, updatedAt: new Date("2026-07-23T10:00:00.000Z") }
      ])
      .mockResolvedValueOnce([
        { id: "spot-1", code: "LS-001", projectId: "project-1", procurementId: "procurement-1", status: "partially_paid", companyPaymentAmountCents: 5000n, paidAmountCents: 1000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ])
      .mockResolvedValueOnce([
        { id: "expense-1", code: "BX-001", claimType: "reimbursement", status: "approved_pending_payment", projectId: null, reason: "差旅", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: "集团资金公司", payeeNameSnapshot: "张三", requestedAmountCents: 12000n, companyPayableAmountCents: 8000n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T12:00:00.000Z") },
        { id: "loan-1", code: "JK-001", claimType: "loan", status: "disbursed", projectId: "project-1", reason: "现场周转", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "李四", requestedAmountCents: 3000n, companyPayableAmountCents: 0n, fundedAmountCents: 3000n, updatedAt: new Date("2026-07-23T13:00:00.000Z") },
        { id: "draft-1", code: "BX-DRAFT", claimType: "reimbursement", status: "draft", projectId: "project-1", reason: "草稿", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: null, requestedAmountCents: 100n, companyPayableAmountCents: 100n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T14:00:00.000Z") }
      ]);

    const result = await service.list("finance-1", { view: "all" });

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("finance-1");
    expect(result.items).toEqual([
      expect.objectContaining({ code: "JK-001", source: "loan_disbursement", statusLabel: "已完成", remainingAmountCents: "0", project: { id: "project-1", code: "JG-001", name: "科技园" } }),
      expect.objectContaining({ code: "BX-001", source: "expense_reimbursement", requestedAmountCents: "8000", payeeName: "张三", payerName: "集团资金公司", project: null }),
      expect.objectContaining({ code: "LS-001", source: "spot_procurement_payment", statusLabel: "部分支付", remainingAmountCents: "4000" }),
      expect.objectContaining({ code: "FK-001", source: "contract_payment", sourceDocument: "合同结算付款" })
    ]);
    expect(result.items.map((item) => item.code)).not.toContain("BX-DRAFT");
    expect(result.viewCounts).toMatchObject({ all: 4, pending_funds: 3, completed: 1 });
    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: { in: ["project-1"] } }
    }));
    expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ projectId: { in: ["project-1"] } }, { projectId: null }] })
    }));
  });

  it("filters pending funds by source and rejects unknown query values", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "expense-1", code: "BX-001", claimType: "reimbursement", status: "approved_pending_payment", projectId: null, reason: "差旅", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "张三", requestedAmountCents: 12000n, companyPayableAmountCents: 8000n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23T12:00:00.000Z") },
        { id: "loan-1", code: "JK-001", claimType: "loan", status: "disbursed", projectId: null, reason: "现场周转", companyEntityNameSnapshot: "建工", paymentSubjectNameSnapshot: null, payeeNameSnapshot: "李四", requestedAmountCents: 3000n, companyPayableAmountCents: 0n, fundedAmountCents: 3000n, updatedAt: new Date("2026-07-23T13:00:00.000Z") }
      ]);

    await expect(service.list("finance-1", { view: "pending_funds", source: "expense_reimbursement" })).resolves.toMatchObject({
      items: [expect.objectContaining({ code: "BX-001" })]
    });
    await expect(service.list("finance-1", { view: "unknown" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list("finance-1", { source: "unknown" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("projects partial payment from source facts without treating it as completed", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "spot-1", code: "LS-001", projectId: "project-1", procurementId: "procurement-1", status: "partially_paid", companyPaymentAmountCents: 5000n, paidAmountCents: 1000n, paymentNote: "水泥", payeeNameSnapshot: "供应商", payerCompanyNameSnapshot: "建工", updatedAt: new Date("2026-07-23T11:00:00.000Z") }
      ])
      .mockResolvedValueOnce([]);

    await expect(service.list("finance-1", { view: "partial_payment" })).resolves.toMatchObject({
      items: [expect.objectContaining({ code: "LS-001", statusLabel: "部分支付", remainingAmountCents: "4000" })],
      viewCounts: expect.objectContaining({ partial_payment: 1, completed: 0 })
    });
  });
});
