import { PaymentReadService } from "./payment-read.service";

describe("PaymentReadService", () => {
  it("returns the payment detail read model with separated approval and execution chains", () => {
    const service = new PaymentReadService();

    const detail = service.getDetail("FK-2026-006");

    expect(detail.id).toBe("FK-2026-006");
    expect(detail.approvalSteps.map((step) => step.label)).toContain("董事长/总经理或签");
    expect(detail.executionSteps.map((step) => step.label)).toContain("付款凭证上传");
    expect(detail.traceRules).toContain("审批通过不等于实际付款完成");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/settlements/JS-2026-018",
      "/archives",
      "/audit"
    ]);
  });
});
