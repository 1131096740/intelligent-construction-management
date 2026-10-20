import { ledgerApprovalFacts } from "./ledger-approval-facts";

const createdAt = new Date("2026-10-20T00:00:00Z");
describe("ledger approval paper facts", () => {
  it("freezes bank company, reference, direction, amount and business date without full account", async () => {
    const row = { id: "bank-id", createdAt, projectId: "p", companyName: "建设公司", bankReference: "回单-001", accountLast4: "1234", direction: "outflow", amountCents: 12345n, occurredAt: new Date("2026-10-19T16:00:00Z"), reason: "核验付款" };
    const tx = { project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "项目甲" }) }, contractBankVerificationRequest: { findUniqueOrThrow: jest.fn().mockResolvedValue(row) } };
    const form = await ledgerApprovalFacts(tx as never, "contract_bank_verification", row.id);
    expect(form.code).toBe("回单-001");
    expect(form.code).not.toContain("bank-id");
    expect(form.summary).toEqual(expect.arrayContaining([{ label: "银行流水号", value: "回单-001" }, { label: "银行账号尾号", value: "1234" }, { label: "资金方向", value: "支出" }, { label: "金额", value: "123.45 元" }, { label: "发生日期", value: "2026-10-20" }]));
    row.companyName = "后来改名";
    expect(form.companyName).toBe("建设公司");
  });
  it("identifies the exact upward contract, revision nature and effective date", async () => {
    const tx = { project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "项目甲" }) },
      upwardContractAmountRevision: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "r", createdAt, projectId: "p", contractId: "c", reason: "调整", amountNature: "fixed", amountCents: 50000n, effectiveAt: new Date("2026-10-18") }) },
      projectAffiliateCompanyContract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ contractReference: "上-001", contractName: "对上合同", companyEntityNameSnapshot: "原签约公司" }) } };
    const form = await ledgerApprovalFacts(tx as never, "upward_contract_amount_revision", "r");
    expect(form.companyName).toBe("原签约公司");
    expect(form.summary).toEqual(expect.arrayContaining([{ label: "对上合同编号", value: "上-001" }, { label: "对上合同名称", value: "对上合同" }, { label: "金额性质", value: "固定合同额" }, { label: "修订生效日期", value: "2026-10-18" }]));
  });
  it("preserves both transfer scopes and the original borrowing reference", async () => {
    const row = { id: "repay", code: "HZ-002", createdAt, sourceProjectId: "p", destinationProjectId: null, frozenParties: { source: { name: "甲公司" }, destination: { name: "乙公司" } }, kind: "repayment", sourceAccountLast4: "1234", destinationAccountLast4: "5678", amountCents: 5000n, reason: "归还", originalTransferId: "loan" };
    const tx = { project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "项目甲" }) }, companyTransfer: { findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.id === "loan" ? { code: "HZ-001" } : row)) } };
    const form = await ledgerApprovalFacts(tx as never, "company_transfer", "repay");
    expect(form.summary).toEqual(expect.arrayContaining([{ label: "转出资金归属", value: "项目甲" }, { label: "转入资金归属", value: "公司自有资金" }, { label: "原借款单号", value: "HZ-001" }]));
  });
});
