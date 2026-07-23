import { describe, expect, it } from "vitest";
import { resolveJgResultState } from "./jg-result-state.config";

describe("resolveJgResultState", () => {
  it("keeps existing results visible while a refresh or retry state changes", () => {
    expect(resolveJgResultState({ loading: true, error: "", hasResults: true })).toBe("ready");
    expect(resolveJgResultState({ loading: false, error: "读取失败", hasResults: true })).toBe("ready");
  });

  it("uses one deterministic no-result state for permission, error, loading and empty", () => {
    expect(resolveJgResultState({ loading: false, permissionReason: "无权查看", hasResults: false })).toBe("permission");
    expect(resolveJgResultState({ loading: false, error: "读取失败", hasResults: false })).toBe("error");
    expect(resolveJgResultState({ loading: true, hasResults: false })).toBe("loading");
    expect(resolveJgResultState({ loading: false, hasResults: false })).toBe("empty");
  });
});
