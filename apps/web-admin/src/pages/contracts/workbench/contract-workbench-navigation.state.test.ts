import { describe, expect, it } from "vitest";
import {
  contractWorkbenchNavigationPrompt,
  shouldCancelPendingNavigation
} from "./contract-workbench-navigation.state";

describe("contract workbench navigation prompt state", () => {
  it("shows only the batch-save prompt while replaceRows is in flight", () => {
    const state = {
      draftDirty: false,
      billDirty: false,
      draftSaving: false,
      billBatchSaving: true
    };

    expect(contractWorkbenchNavigationPrompt(state)).toEqual({
      title: "合同清单正在保存",
      message: "合同清单正在保存，请等待保存完成后再离开。"
    });
    expect(shouldCancelPendingNavigation(true, state)).toBe(false);
  });

  it("cancels a pending route attempt once saving settles cleanly", () => {
    const cleanState = {
      draftDirty: false,
      billDirty: false,
      draftSaving: false,
      billBatchSaving: false
    };

    expect(contractWorkbenchNavigationPrompt(cleanState)).toBeNull();
    expect(shouldCancelPendingNavigation(true, cleanState)).toBe(true);
    expect(shouldCancelPendingNavigation(false, cleanState)).toBe(false);
  });

  it("keeps a pending prompt when saving settles with unsaved rows", () => {
    const dirtyState = {
      draftDirty: false,
      billDirty: true,
      draftSaving: false,
      billBatchSaving: false
    };

    expect(contractWorkbenchNavigationPrompt(dirtyState)).toEqual({
      title: "合同清单尚未保存",
      message: "当前清单有未保存修改。放弃后将恢复到最近一次整表保存状态。"
    });
    expect(shouldCancelPendingNavigation(true, dirtyState)).toBe(false);
  });
});
