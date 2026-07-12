import { describe, expect, it } from "vitest";
import { canApplySettlementSourceResponse } from "./settlement-source-lines.state";

describe("settlement source lines request state", () => {
  it("accepts only the latest response for the still-selected contract version", () => {
    expect(canApplySettlementSourceResponse(2, 2, "version-2", "version-2")).toBe(true);
    expect(canApplySettlementSourceResponse(1, 2, "version-1", "version-2")).toBe(false);
    expect(canApplySettlementSourceResponse(2, 2, "version-2", "version-3")).toBe(false);
  });
});
