import { describe, expect, it } from "vitest";
import {
  contractDetailChainLinks,
  paymentDetailChainLinks,
  settlementDetailChainLinks
} from "./business-chain-links.config";

describe("business chain links", () => {
  it("links contract detail to downstream settlement, archive, and audit pages", () => {
    expect(contractDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联合同台账", "/合同管理"],
      ["关联结算", "/结算管理/JS-2026-018"],
      ["归档资料", "/资料库"],
      ["审计日志", "/审计日志"]
    ]);
  });

  it("links settlement detail to upstream contract, downstream payment, archive, and audit pages", () => {
    expect(settlementDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联合同", "/合同管理/HT-2026-001"],
      ["付款申请", "/付款管理/FK-2026-006"],
      ["归档资料", "/资料库"],
      ["审计日志", "/审计日志"]
    ]);
  });

  it("links payment detail to settlement, voucher archive, and audit pages", () => {
    expect(paymentDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联结算", "/结算管理/JS-2026-018"],
      ["付款凭证", "/资料库"],
      ["审计日志", "/审计日志"]
    ]);
  });
});
