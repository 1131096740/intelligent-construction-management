import { currentFundTransferDuty } from "./fund-account-transfer-duty";

const cash = {id: "cash", kind: "public_cash"};
const company = {id: "company", kind: "company"};
const base = {sourceAccount: company, destinationAccount: cash, status: "pending_receipt", createdByUserId: "finance"};
const context = (custodian: string | null, previousCustodians: string[] = []) => ({custodian, previousCustodians: new Set(previousCustodians)});

it("仅具名且在岗的现金保管人可接收；未绑定时沿用综合主管办理范围", () => {
  expect(currentFundTransferDuty(base, "acting", ["comprehensive_director"], context("acting"))).toBe("receive");
  expect(currentFundTransferDuty(base, "another", ["comprehensive_director"], context("acting"))).toBeNull();
  expect(currentFundTransferDuty(base, "acting", ["finance_staff"], context("acting"))).toBeNull();
  expect(currentFundTransferDuty(base, "another", ["comprehensive_director"], context(null))).toBe("receive");
});

it("驳回时只向原办理人或完成交接的具名现金接手人显示下一步", () => {
  const rejected = {...base, sourceAccount: cash, destinationAccount: company, status: "rejected_held", createdByUserId: "former"};
  expect(currentFundTransferDuty(rejected, "current", ["comprehensive_director"], context("current", ["former"]))).toBe("resolve_rejection");
  expect(currentFundTransferDuty(rejected, "current", ["comprehensive_director"], context("current"))).toBeNull();
  expect(currentFundTransferDuty(rejected, "other", ["comprehensive_director"], context("current", ["former"]))).toBeNull();
  expect(currentFundTransferDuty({...rejected, status: "returned"}, "current", ["comprehensive_director"], context("current", ["former"]))).toBeNull();
  expect(currentFundTransferDuty(rejected, "former", ["comprehensive_director"], context("current"))).toBe("resolve_rejection");
});
