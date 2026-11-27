import { summarizeCompanyTransfers } from "./company-transfer-summary";
import type { CompanyTransfer, CompanyTransferEvent } from "@prisma/client";
const loan = { id: "loan", kind: "loan", sourceCompanyId: "a", destinationCompanyId: "b", sourceProjectId: "p", destinationProjectId: null, frozenParties: { source: { name: "甲公司" }, destination: { name: "乙公司" } } } as unknown as CompanyTransfer;
const events = [{ transferId: "loan", kind: "outgoing", amountCents: 10000n }, { transferId: "loan", kind: "incoming", amountCents: 6000n }, { transferId: "loan", kind: "returned", amountCents: 1000n }] as CompanyTransferEvent[];
it("项目借给自有资金，出款不冒充债务，到账形成双方往来且在途只在转出侧", () => { const result = summarizeCompanyTransfers([loan], events, { includeOwn: true }); expect(result).toEqual([{ companyId: "a", companyName: "甲公司", projectId: "p", cashChangeCents: "-9000", inTransitCents: "3000", receivableCents: "6000", payableCents: "0" }, { companyId: "b", companyName: "乙公司", projectId: null, cashChangeCents: "6000", inTransitCents: "0", receivableCents: "0", payableCents: "6000" }]); });
it("项目余额不泄漏自有资金或未授权项目；跨项目按本侧归属计算", () => { expect(summarizeCompanyTransfers([loan], events, { projectIds: ["p"], includeOwn: false })).toHaveLength(1); expect(summarizeCompanyTransfers([loan], events, { projectIds: ["other"], includeOwn: false })).toEqual([]); const cross = { ...loan, destinationProjectId: "q" }; expect(summarizeCompanyTransfers([cross], events, { projectIds: ["q"], includeOwn: false })).toEqual([expect.objectContaining({ companyId: "b", projectId: "q", payableCents: "6000" })]); });
it("归还原借款到账才冲往来；原代付归还不重复扣借款余额", () => { const repay = { ...loan, id: "repay", kind: "repayment", sourceCompanyId: "b", destinationCompanyId: "a", sourceProjectId: null, destinationProjectId: "p", originalTransferId: "loan", frozenParties: { source: { name: "乙公司" }, destination: { name: "甲公司" } } } as unknown as CompanyTransfer; const legs = [...events, { transferId: "repay", kind: "outgoing", amountCents: 2000n }, { transferId: "repay", kind: "incoming", amountCents: 1500n }] as CompanyTransferEvent[]; expect(summarizeCompanyTransfers([loan, repay], legs, { projectIds: ["p"], includeOwn: false })[0]).toMatchObject({ receivableCents: "4500", cashChangeCents: "-7500" }); expect(summarizeCompanyTransfers([loan, { ...repay, originalTransferId: null, originalProxyId: "proxy" }], legs, { projectIds: ["p"], includeOwn: false })[0].receivableCents).toBe("6000"); });
it("同归属转存仅变更资金持有，不形成借款或合同金额", () => { expect(summarizeCompanyTransfers([{ ...loan, kind: "storage", destinationProjectId: "p" }], events, { projectIds: ["p"], includeOwn: false }).every(r => r.receivableCents === "0" && r.payableCents === "0")).toBe(true); });
it("第三家公司代还后原债务人欠代还公司，旧借款应收减少，同一实付不重复计现金或成本", () => {
  const originalLoan = { ...loan, id: "loan-ba", sourceCompanyId: "b", destinationCompanyId: "a", sourceProjectId: "p", destinationProjectId: "p",
    frozenParties: { source: { name: "乙公司" }, destination: { name: "甲公司" } } } as unknown as CompanyTransfer;
  const thirdParty = { ...loan, id: "third", kind: "repayment", sourceCompanyId: "c", destinationCompanyId: "b", repaymentDebtorCompanyId: "a",
    sourceProjectId: "p", destinationProjectId: "p", originalTransferId: "loan-ba", frozenParties: { source: { name: "丙公司" }, destination: { name: "乙公司" }, debtor: { name: "甲公司" } } } as unknown as CompanyTransfer;
  const cash = [{ transferId: "loan-ba", kind: "outgoing", amountCents: 800n }, { transferId: "loan-ba", kind: "incoming", amountCents: 800n },
    { transferId: "third", kind: "outgoing", amountCents: 800n }, { transferId: "third", kind: "incoming", amountCents: 800n }] as CompanyTransferEvent[];
  const result = summarizeCompanyTransfers([originalLoan, thirdParty], cash, { projectIds: ["p"], includeOwn: false });
  expect(result.find(row => row.companyId === "a")).toMatchObject({ payableCents: "800", onBehalfPayableCents: "800" });
  expect(result.find(row => row.companyId === "b")).toMatchObject({ receivableCents: "0", cashChangeCents: "0" });
  expect(result.find(row => row.companyId === "c")).toMatchObject({ receivableCents: "800", onBehalfReceivableCents: "800", cashChangeCents: "-800" });
});

it("到账后部分退款恢复原借款并冲减代还新债，在途金额不变", () => {
  const original = { ...loan, id: "original", sourceCompanyId: "b", destinationCompanyId: "a", destinationProjectId: "p" };
  const repayment = { ...loan, id: "repayment", kind: "repayment", sourceCompanyId: "c", destinationCompanyId: "b",
    destinationProjectId: "p", repaymentDebtorCompanyId: "a", originalTransferId: "original" };
  const legs = [
    { transferId: "original", kind: "outgoing", amountCents: 800n },
    { transferId: "original", kind: "incoming", amountCents: 800n },
    { transferId: "repayment", kind: "outgoing", amountCents: 800n },
    { transferId: "repayment", kind: "incoming", amountCents: 800n },
    { transferId: "repayment", kind: "returned", returnedIncomingEventId: "receipt", amountCents: 300n },
  ] as CompanyTransferEvent[];
  const result = summarizeCompanyTransfers([original, repayment], legs, { includeOwn: false });
  expect(result.find(row => row.companyId === "a")).toMatchObject({ payableCents: "800", onBehalfPayableCents: "500" });
  expect(result.find(row => row.companyId === "b")).toMatchObject({ receivableCents: "300", cashChangeCents: "-300" });
  expect(result.find(row => row.companyId === "c")).toMatchObject({ receivableCents: "500", cashChangeCents: "-500", inTransitCents: "0" });
});
