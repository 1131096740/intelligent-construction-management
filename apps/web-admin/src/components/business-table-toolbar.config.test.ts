import { describe, expect, it } from "vitest";
import { hasActiveToolbarFilters } from "./business-table-toolbar.config";

describe("hasActiveToolbarFilters", () => {
  it("detects whether a toolbar has active filters", () => {
    expect(hasActiveToolbarFilters({ keyword: "", status: undefined })).toBe(false);
    expect(hasActiveToolbarFilters({ keyword: "合同", status: "" })).toBe(true);
  });
});
