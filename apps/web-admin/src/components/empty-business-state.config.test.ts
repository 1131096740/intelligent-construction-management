import { describe, expect, it } from "vitest";
import { normalizeEmptyBusinessStateActions } from "./empty-business-state.config";

describe("normalizeEmptyBusinessStateActions", () => {
  it("removes blank actions", () => {
    expect(
      normalizeEmptyBusinessStateActions([
        { label: "" },
        { label: "新建合同", to: "/contracts/workbench" }
      ])
    ).toEqual([{ label: "新建合同", to: "/contracts/workbench" }]);
  });
});
