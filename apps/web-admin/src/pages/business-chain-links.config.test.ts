import { describe, expect, it } from "vitest";
import {
  contractDetailChainLinks,
  paymentDetailChainLinks,
  settlementDetailChainLinks
} from "./business-chain-links.config";

describe("business chain links", () => {
  it("links contract detail to downstream settlement, archive, and audit pages", () => {
    expect(contractDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联合同台账", "/contracts"],
      ["关联结算", "/settlements/JS-2026-018"],
      ["归档资料", "/archives"],
      ["审计日志", "/audit"]
    ]);
  });

  it("links settlement detail to upstream contract, downstream payment, archive, and audit pages", () => {
    expect(settlementDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联合同", "/contracts/HT-2026-001"],
      ["付款申请", "/payments/FK-2026-006"],
      ["归档资料", "/archives"],
      ["审计日志", "/audit"]
    ]);
  });

  it("links payment detail to settlement, voucher archive, and audit pages", () => {
    expect(paymentDetailChainLinks.map((link) => [link.label, link.to])).toEqual([
      ["关联结算", "/settlements/JS-2026-018"],
      ["付款凭证", "/archives"],
      ["审计日志", "/audit"]
    ]);
  });
});
