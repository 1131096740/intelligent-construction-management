import { describe, expect, it, vi } from "vitest";
import {
  defaultPersonalTablePreferences,
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "./personal-table-preferences";

describe("personal table preferences", () => {
  const allKeys = ["type", "title", "project", "operation"];

  it("creates v2 default preferences with all columns visible and no override", () => {
    expect(defaultPersonalTablePreferences(allKeys)).toEqual({
      query: "",
      visibleColumnKeys: allKeys,
      columnOrder: allKeys,
      columnWidths: {},
      sort: null
    });
  });

  it("normalizes invalid, duplicate, and unknown column keys", () => {
    expect(normalizeVisibleColumnKeys(["title", "title", "bad"], allKeys)).toEqual(["title"]);
    expect(normalizeVisibleColumnKeys(["bad"], allKeys)).toEqual(allKeys);
    expect(normalizeVisibleColumnKeys(null, allKeys)).toEqual(allKeys);
  });

  it("reads stored query and visible columns safely", () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          query: "合同 项目A",
          visibleColumnKeys: ["title", "project", "bad"]
        })
      )
    };

    expect(readPersonalTablePreferences(storage, "table-key", allKeys)).toEqual({
      query: "合同 项目A",
      visibleColumnKeys: ["title", "project"],
      columnOrder: allKeys,
      columnWidths: {},
      sort: null
    });
  });

  it("falls back to defaults when storage is unavailable or malformed", () => {
    expect(readPersonalTablePreferences(null, "table-key", allKeys)).toEqual(
      defaultPersonalTablePreferences(allKeys)
    );
    expect(readPersonalTablePreferences({ getItem: vi.fn(() => "{bad") }, "table-key", allKeys)).toEqual(
      defaultPersonalTablePreferences(allKeys)
    );
  });

  it("reads v2 column order, widths and sort while ignoring unknown keys", () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          query: "付款",
          visibleColumnKeys: ["title", "project"],
          columnOrder: ["project", "bad", "title"],
          columnWidths: { title: 240, project: 9999, bad: 100 },
          sort: { key: "project", direction: "asc" }
        })
      )
    };

    expect(readPersonalTablePreferences(storage, "table-key", allKeys)).toEqual({
      query: "付款",
      visibleColumnKeys: ["title", "project"],
      columnOrder: ["project", "title", "type", "operation"],
      columnWidths: { title: 240, project: 600 },
      sort: { key: "project", direction: "asc" }
    });
  });

  it("writes preferences as compact JSON", () => {
    const storage = { setItem: vi.fn() };

    writePersonalTablePreferences(storage, "table-key", {
      query: "付款",
      visibleColumnKeys: ["title"]
    });

    expect(storage.setItem).toHaveBeenCalledWith(
      "table-key",
      JSON.stringify({ query: "付款", visibleColumnKeys: ["title"] })
    );
  });
});
