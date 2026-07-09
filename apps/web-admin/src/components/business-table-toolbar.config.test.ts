import { describe, expect, it } from "vitest";
import { hasActiveToolbarFilters } from "./business-table-toolbar.config";

describe("hasActiveToolbarFilters", () => {
  it("detects whether a toolbar has active filters", () => {
    expect(hasActiveToolbarFilters({ keyword: "", status: undefined })).toBe(false);
    expect(hasActiveToolbarFilters({ keyword: "合同", status: "" })).toBe(true);
  });

  it("treats booleans, arrays, objects, and numbers narrowly", () => {
    expect(hasActiveToolbarFilters({ flag: false })).toBe(false);
    expect(hasActiveToolbarFilters({ flag: true })).toBe(true);
    expect(hasActiveToolbarFilters({ tags: [] })).toBe(false);
    expect(hasActiveToolbarFilters({ tags: ["x"] })).toBe(true);
    expect(hasActiveToolbarFilters({ meta: {} })).toBe(false);
    expect(hasActiveToolbarFilters({ meta: { status: "x" } })).toBe(true);
    expect(hasActiveToolbarFilters({ page: 0 })).toBe(true);
  });
});
