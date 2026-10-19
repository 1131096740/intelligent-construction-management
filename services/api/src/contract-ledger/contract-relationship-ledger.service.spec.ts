import { ContractRelationshipLedgerService } from "./contract-relationship-ledger.service";
const date = new Date("2026-10-19T00:00:00.000Z");
function harness() {
  const tx = {upwardReceiptMatch:{findMany:jest.fn().mockResolvedValue([])},settlementArchiveFile:{findMany:jest.fn().mockResolvedValue([])},upwardContractAmountRevision:{findMany:jest.fn().mockResolvedValue([])}, contractProxyExecution: { findMany: jest.fn().mockResolvedValue([]) }, contractEconomicReview: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([{ id: "p", name: "项目一" }]) },
    contract: { findMany: jest.fn().mockResolvedValue([{ id: "c", projectId: "p", code: "HT1", name: "材料合同", counterparty: "供应商" }]) },
    contractVersion: { findMany: jest.fn().mockResolvedValue([
      { id: "v2", contractId: "c", versionNo: 2, effectiveAt: date, signingSubjectType: "our_company", companyEntityIdSnapshot: "company", companyEntityVersionId: "cv", companyEntityNameSnapshot: "我方甲", amountCents: 500000000n, amountLimitType: "capped" },
      { id: "v1", contractId: "c", versionNo: 1, effectiveAt: date, signingSubjectType: "our_company", companyEntityIdSnapshot: "company", companyEntityVersionId: "cv", amountCents: 400000000n, amountLimitType: "capped" }
    ]) },
    projectAffiliateContractFact: { findMany: jest.fn().mockResolvedValue([{ id: "e", ledgerId: "e", projectId: "p", entryKind: "original", amountCents: 200000000n, effectDirection: "increase", externalContractReference: "EXT1", counterpartyName: "班组", affiliateNameSnapshot: "施工企业", signedAt: date }]) },
    projectAffiliateCompanyContract: { findMany: jest.fn().mockResolvedValue([{ id: "u", projectId: "p", amountCents: 800000000n, contractReference: "UP1", contractName: "对上合同", affiliateNameSnapshot: "施工企业", companyEntityId: "company", companyEntityNameSnapshot: "我方甲", signedAt: date }]) },
    projectAffiliateSettlementFact: { findMany: jest.fn().mockResolvedValue([]) },
    projectOwnerContract: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn().mockResolvedValue([]) },
    projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
    projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
    operatingFact: { findMany: jest.fn().mockResolvedValue([]) },
    projectAffiliatePaymentFact: { findMany: jest.fn().mockResolvedValue([]) },
    contractTakeover: { findMany: jest.fn().mockResolvedValue([]) },
    contractTakeoverHistoricalPayment: { findMany: jest.fn().mockResolvedValue([]) },
    projectUpstreamFundFact: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const visibility = { visibleProjectIdsInTransaction: jest.fn().mockResolvedValue(["p"]), effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(new Map([["p", ["contract_staff"]]])) };
  const prisma = { $transaction: jest.fn((run: (t: typeof tx) => unknown) => run(tx)) };
  return { tx, visibility, service: new ContractRelationshipLedgerService(prisma as never, visibility as never) };
}
describe("跨页面统一签约关系台账", () => {
  it("有效版本只计一次，表内500、表外200、对上800分别列示", async () => {
    const { service } = harness(); const result = await service.list("actor");
    expect(result.rows).toHaveLength(3);
    expect(result.totals.map((t) => [t.relationship, t.knownAmountCents])).toEqual([["inside", "500000000"], ["outside", "200000000"], ["upward", "800000000"]]);
    expect(result).not.toHaveProperty("grandTotal");
  });
  it("分类筛选后明细和汇总同范围", async () => {
    const { service } = harness(); const result = await service.list("actor", { relationship: "upward" });
    expect(result.rows.map((r) => r.relationship)).toEqual(["upward"]);
    expect(result.totals).toHaveLength(1);
  });
  it("未知金额保留条目并说明缺口，不伪造零金额", async () => {
    const { service, tx } = harness(); const entries = await tx.projectAffiliateCompanyContract.findMany(); entries[0].amountCents = null;
    const result = await service.list("actor", { relationship: "upward" });
    expect(result.rows[0]?.amountCents).toBeNull(); expect(result.totals[0]?.unknownAmountCount).toBe(1);
  });
  it("跨项目/摘要岗位无法读取金额", async () => {
    const { service, visibility, tx } = harness();
    await expect(service.list("actor", { projectId: "other" })).rejects.toThrow("无权");
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([["p", ["employee"]]]));
    await expect(service.list("actor", { projectId: "p" })).rejects.toThrow("摘要");
    expect(tx.contract.findMany).not.toHaveBeenCalled();
  });
  it("不把旧对上双重登记混入下游承诺", async () => {
    const { service, tx } = harness(); tx.projectAffiliateSettlementFact.findMany.mockResolvedValue([{ contractLedgerId: "e" }]);
    const result = await service.list("actor");
    expect(result.rows.find((r) => r.id === "e")?.relationship).toBe("unclassified");
    expect(result.totals.some((t) => t.relationship === "outside")).toBe(false);
  });
  it("结算同时列示业主收入、我方成本与对上往来，金额分组不相加", async () => {
    const { service, tx } = harness();
    tx.settlement.findMany.mockResolvedValue([{ id: "s1", contractId: "c", contractVersionId: "v2", code: "JS1", amountCents: 400000000n, updatedAt: date,createdAt:date }]);
    tx.projectAffiliateSettlementFact.findMany.mockImplementation(async (query) => query.select ? [] : [{ id: "s2", projectId: "p", contractLedgerId: "u", affiliateCompanyContractId: "u", periodLabel: "对上结算", affiliateNameSnapshot: "施工企业", counterpartyName: "我方甲", amountCents: 600000000n, effectDirection: "increase", settledAt: date }]);
    tx.projectUpstreamSettlement.findMany.mockResolvedValue([{ id: "os", projectId: "p", periodLabel: "业主结算", approvingPartyName: "业主", approvedAmountCents: 900000000n, settledAt: date }]);
    const result = await service.list("actor", { section: "settlements" });
    expect(result.totals.map((r) => [r.relationship, r.knownAmountCents])).toEqual([["inside", "400000000"], ["upward", "600000000"], ["owner", "900000000"]]);
    expect(result.rows.find((r) => r.id === "s2")?.accountingEffect).toContain("不计收入或成本");
  });
  it("支付分类跟随签约版本；历史实付保留，未找到生效版本的金额进入待确认", async () => {
    const { service, tx } = harness();
    tx.paymentRequest.findMany.mockResolvedValue([{ id: "pr", contractId: "c", contractVersionId: "v2", code: "FK1" }]);
    tx.paymentExecution.findMany.mockResolvedValue([{ id: "pe", paymentRequestId: "pr", amountCents: 250000000n, paidAt: date, paymentSubjectType: "affiliate" }]);
    tx.contractTakeover.findMany.mockResolvedValue([{ id: "t", contractId: "c", contractVersionId: "old-version" }]);
    tx.contractTakeoverHistoricalPayment.findMany.mockResolvedValue([{ id: "hp", takeoverId: "t", amountCents: 50000000n, paidAt: date, payerName: "历史付款方" }]);
    const result = await service.list("actor", { section: "payments" });
    expect(result.rows.find((r) => r.id === "pe")?.relationship).toBe("inside");
    expect(result.rows.find((r) => r.id === "hp")).toMatchObject({ relationship: "unclassified", amountCents: "50000000", actualPayer: "历史付款方" });
  });
  it("合同岗位不能借收款选项读取资金事实", async () => {
    const { service, tx } = harness();
    await expect(service.list("actor", { section: "receipts" })).rejects.toThrow("无权读取收款");
    expect(tx.projectUpstreamFundFact.findMany).not.toHaveBeenCalled();
  });
  it("旧施工企业付款进入台账；无冻结签约身份的金额保留为待确认，不能凭付款人归类", async () => {
    const { service, tx } = harness();
    tx.projectProxyPayment.findMany.mockResolvedValue([
      { id: "proxy1", projectId: "p", contractId: "c", paidAt: date, amountCents: 5000n, affiliateNameSnapshot: "施工企业甲", paidTargetName: "班组" },
      { id: "proxy2", projectId: "p", contractId: "c", paidAt: date, amountCents: 3000n, affiliateNameSnapshot: "施工企业甲", paidTargetName: "供应商" }
    ]);
    tx.operatingFact.findMany.mockResolvedValue([{ sourceType: "project_proxy_payment", sourceBusinessId: "proxy1", sourceSnapshot: {
      signingSubjectType: "affiliate", affiliate: { assignmentId: "a", businessPartyVersionId: "av" }
    } }]);
    const result = await service.list("actor", { section: "payments", asOf: "2026-10-19" });
    expect(result.rows.find((r) => r.id === "proxy1")).toMatchObject({ relationship: "outside", amountCents: "5000", actualPayer: "施工企业甲" });
    expect(result.rows.find((r) => r.id === "proxy2")).toMatchObject({ relationship: "unclassified", amountCents: "3000" });
    expect(tx.projectProxyPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: { in: ["p"] }, OR:[{voidedAt:null},{voidedAt:{gt:new Date("2026-10-19T23:59:59.999+08:00")}}] } }));
  });
  it("超出范围上限拒绝不完整汇总", async () => {
    const { service, tx } = harness(); tx.contract.findMany.mockResolvedValue(Array.from({ length: 10001 }, () => ({ id: "c" })));
    await expect(service.list("actor")).rejects.toThrow("未返回不完整合计");
  });

});
