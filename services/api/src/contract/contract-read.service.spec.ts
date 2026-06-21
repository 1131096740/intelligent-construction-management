import { ContractReadService } from "./contract-read.service";

describe("ContractReadService", () => {
  it("returns the contract detail read model for the first core-flow contract", () => {
    const service = new ContractReadService();

    const detail = service.getDetail("HT-2026-001");

    expect(detail.id).toBe("HT-2026-001");
    expect(detail.title).toContain("钢材采购合同");
    expect(detail.paymentTermStages[0].paymentTermsVersion).toBe("v1");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts",
      "/settlements/JS-2026-018",
      "/archives",
      "/audit"
    ]);
  });
});
