import { describe, expect, it } from "vitest";
import { CORE_FLOW_READ_ENDPOINTS } from "./core-flow-read-model";

describe("core flow read model contract", () => {
  it("defines the first read-only detail API endpoints", () => {
    expect(CORE_FLOW_READ_ENDPOINTS).toEqual({
      contractDetail: "/contracts/:contractId",
      settlementDetail: "/settlements/:settlementId",
      paymentDetail: "/payments/:paymentId"
    });
  });
});
