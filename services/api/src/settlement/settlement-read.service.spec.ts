import { SettlementReadService } from "./settlement-read.service";

describe("SettlementReadService", () => {
  it("returns the settlement detail read model with payment rules", () => {
    const service = new SettlementReadService();

    const detail = service.getDetail("JS-2026-018");

    expect(detail.id).toBe("JS-2026-018");
    expect(detail.baseInfo.some((item) => item.value === "月度结算")).toBe(true);
    expect(detail.paymentRules.map((rule) => rule.paymentRequestStatus)).toEqual([
      "未开放",
      "未开放"
    ]);
    expect(detail.chainLinks.map((link) => link.to)).toContain("/payments/FK-2026-006");
  });
});
