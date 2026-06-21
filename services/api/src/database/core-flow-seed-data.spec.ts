import { coreFlowSeedData } from "./core-flow-seed-data";

describe("coreFlowSeedData", () => {
  it("describes the first contract-settlement-payment closed loop", () => {
    expect(coreFlowSeedData.project.code).toBe("JGXM-001");
    expect(coreFlowSeedData.contract.code).toBe("HT-2026-001");
    expect(coreFlowSeedData.contractVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentTermsVersion.status).toBe("effective");
    expect(coreFlowSeedData.paymentStages.map((stage) => stage.ratioBps)).toEqual([8000, 2000]);
    expect(coreFlowSeedData.settlement.code).toBe("JS-2026-018");
    expect(coreFlowSeedData.settlement.status).toBe("effective");
    expect(coreFlowSeedData.paymentRequest.code).toBe("FK-2026-006");
    expect(coreFlowSeedData.paymentRequest.status).toBe("approved_pending_payment");
    expect(coreFlowSeedData.paymentExecution.amountCents).toBe(12800000);
  });
});
