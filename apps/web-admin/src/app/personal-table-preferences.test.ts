import { describe, expect, it, vi } from "vitest";
import {
  defaultPersonalTablePreferences,
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "./personal-table-preferences";

describe("personal table preferences", () => {
  const allKeys = ["type", "title", "project", "operation"];

  it("creates default preferences with all columns visible", () => {
    expect(defaultPersonalTablePreferences(allKeys)).toEqual({
      query: "",
      visibleColumnKeys: allKeys
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
      visibleColumnKeys: ["title", "project"]
    });
  });

  it("falls back to defaults when storage is unavailable or malformed", () => {
    expect(readPersonalTablePreferences(null, "table-key", allKeys)).toEqual({
      query: "",
      visibleColumnKeys: allKeys
    });
    expect(readPersonalTablePreferences({ getItem: vi.fn(() => "{bad") }, "table-key", allKeys)).toEqual({
      query: "",
      visibleColumnKeys: allKeys
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
