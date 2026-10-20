import { additionalApprovalFacts } from "./approval-business-facts";
const form = { title: "业务审批单", code: "TEST-001", companyName: "测试公司", projectId: null, summary: [] };
const logs = [{ metadata: { form } }];
describe("formal PDF source validity", () => {
  it.each(["no_invoice_confirmation", "invoice_exception_confirmation"])("blocks reversed %s even when an old instance still says approved", async businessType => {
    const tx = { noInvoiceConfirmation: { findUnique: jest.fn().mockResolvedValue({ status: "reversed" }) },
      invoiceExceptionConfirmation: { findUnique: jest.fn().mockResolvedValue({ status: "reversed" }) } };
    await expect(additionalApprovalFacts(tx as never, businessType, "source", logs)).rejects.toThrow("已失效");
  });
  it("blocks a revoked receipt review and allows the separate current review", async () => {
    const tx = { spotProcurementReceiptReview: {
      findUnique: jest.fn().mockResolvedValue({ decision: "approved" }),
      findFirst: jest.fn().mockResolvedValueOnce({ id: "reversal" }).mockResolvedValueOnce(null)
    } };
    await expect(additionalApprovalFacts(tx as never, "spot_procurement_receipt", "old-review", logs)).rejects.toThrow("已失效");
    await expect(additionalApprovalFacts(tx as never, "spot_procurement_receipt", "new-review", logs)).resolves.toEqual(form);
  });
  it.each([null, { status: "cancelled" }, { status: "pending_approval" }])("blocks invalid seal task %j despite approved historical evidence", async source => {
    const tx = { contractSealTask: { findUnique: jest.fn().mockResolvedValue(source) } };
    await expect(additionalApprovalFacts(tx as never, "contract_seal", "seal", logs)).rejects.toThrow("用章审批已失效");
  });
  it.each(["in_seal", "completed"])("allows the approved seal task in %s", async status => {
    const tx = { contractSealTask: { findUnique: jest.fn().mockResolvedValue({ status }) } };
    await expect(additionalApprovalFacts(tx as never, "contract_seal", "seal", logs)).resolves.toEqual(form);
  });
  it("binds fund execution business data to the exact approval instance", async () => {
    const tx = { fundExecutionCase: { findFirstOrThrow: jest.fn().mockResolvedValue({ fundExecutionId: "fund", reason: "款项归类" }) },
      fundExecution: { findUniqueOrThrow: jest.fn().mockResolvedValue({ amountCents: 500n, direction: "inflow", occurredAt: new Date("2026-10-20") }) } };
    await expect(additionalApprovalFacts(tx as never, "fund_execution_case", "case", [])).rejects.toThrow("审批实例证据缺失");
    await additionalApprovalFacts(tx as never, "fund_execution_case", "case", [], "approval-current");
    expect(tx.fundExecutionCase.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { caseKey: "case", approvalInstanceId: "approval-current" } }));
  });
});


describe("new main approval PDF coverage", () => {
  it.each([
    ["company_transfer", "companyTransfer", "approved"],
    ["contract_economic_review", "contractEconomicReview", "confirmed"],
    ["contract_bank_verification", "contractBankVerificationRequest", "confirmed"],
    ["contract_proxy_execution", "contractProxyExecution", "confirmed"],
    ["upward_contract_amount_revision", "upwardContractAmountRevision", "confirmed"],
    ["upward_receipt_match", "upwardReceiptMatch", "confirmed"]
  ])("requires current final source and frozen form for %s", async (businessType, model, status) => {
    const read = jest.fn().mockResolvedValue({ status });
    const tx = { [model]: { findUnique: read } };
    await expect(additionalApprovalFacts(tx as never, businessType, "source", logs)).resolves.toEqual(form);
    read.mockResolvedValue({ status: "returned" });
    await expect(additionalApprovalFacts(tx as never, businessType, "source", logs)).rejects.toThrow("已失效");
    read.mockResolvedValue({ status });
    await expect(additionalApprovalFacts(tx as never, businessType, "source", [])).rejects.toThrow("快照");
  });
});
