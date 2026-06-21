import { coreFlowApiVerificationTargets } from "./core-flow-api-verification";

describe("coreFlowApiVerificationTargets", () => {
  it("covers contract, settlement, and payment detail read endpoints", () => {
    expect(coreFlowApiVerificationTargets.map((target) => target.path)).toEqual([
      "/contracts/HT-2026-001",
      "/settlements/JS-2026-018",
      "/payments/FK-2026-006"
    ]);
    expect(coreFlowApiVerificationTargets[0].requiredText).toContain("钢材采购合同");
    expect(coreFlowApiVerificationTargets[1].requiredText).toContain("JS-2026-018");
    expect(coreFlowApiVerificationTargets[2].requiredText).toContain("approved_pending_payment");
  });
});
