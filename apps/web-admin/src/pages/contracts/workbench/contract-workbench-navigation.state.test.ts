import { describe, expect, it, vi } from "vitest";
import {
  contractWorkbenchNavigationPrompt,
  contractWorkbenchShouldBlockUnload,
  createContractWorkbenchLeaveSave,
  type ContractWorkbenchNavigationState
} from "./contract-workbench-navigation.state";

describe("contract workbench navigation save state", () => {
  it("allows a clean draft to leave without a prompt", () => {
    const state = {
      dirty: false,
      saveState: "saved" as const,
      error: ""
    };

    expect(contractWorkbenchNavigationPrompt(state)).toBeNull();
    expect(contractWorkbenchShouldBlockUnload(state)).toBe(false);
  });

  it("offers only save-before-leave or continued editing for a dirty draft", () => {
    expect(contractWorkbenchNavigationPrompt({
      dirty: true,
      saveState: "idle",
      error: ""
    })).toEqual({
      title: "保存合同草稿后离开",
      message: "系统会先保存全部合同草稿修改；保存成功后才会离开当前页面。",
      actionLabel: "保存并离开",
      canFlush: true,
      tone: "warning"
    });
  });

  it("waits for the current save and all later edits through one flush call", async () => {
    let finish!: (saved: boolean) => void;
    const flushBeforeLeave = vi.fn(
      () => new Promise<boolean>((resolve) => { finish = resolve; })
    );
    const state: ContractWorkbenchNavigationState = {
      dirty: true,
      saveState: "saving",
      error: ""
    };
    const leaveSave = createContractWorkbenchLeaveSave({
      state: () => state,
      flushBeforeLeave
    });

    const first = leaveSave.flush();
    const second = leaveSave.flush();
    expect(second).toBe(first);
    expect(flushBeforeLeave).toHaveBeenCalledTimes(1);

    state.saveState = "saved";
    state.dirty = false;
    finish(true);
    await expect(first).resolves.toBe(true);
  });

  it("blocks leave after a failed save and exposes the exact retry reason", async () => {
    const state = {
      dirty: true,
      saveState: "failed" as const,
      error: "网络暂不可用"
    };
    const leaveSave = createContractWorkbenchLeaveSave({
      state: () => state,
      flushBeforeLeave: vi.fn().mockResolvedValue(false)
    });

    await expect(leaveSave.flush()).resolves.toBe(false);
    expect(contractWorkbenchNavigationPrompt(state)).toEqual({
      title: "合同草稿保存失败",
      message: "网络暂不可用",
      actionLabel: "重新保存并离开",
      canFlush: true,
      tone: "error"
    });
  });

  it.each([
    {
      saveState: "conflict" as const,
      error: "合同草稿已在其他页面更新",
      title: "合同草稿存在版本冲突"
    },
    {
      saveState: "readonly" as const,
      error: "编辑租约已失效",
      title: "当前页面已转为只读"
    }
  ])("fails closed for $saveState without invoking save", async (example) => {
    const flushBeforeLeave = vi.fn();
    const state = {
      dirty: true,
      saveState: example.saveState,
      error: example.error
    };
    const leaveSave = createContractWorkbenchLeaveSave({
      state: () => state,
      flushBeforeLeave
    });

    await expect(leaveSave.flush()).resolves.toBe(false);
    expect(flushBeforeLeave).not.toHaveBeenCalled();
    expect(contractWorkbenchNavigationPrompt(state)).toEqual(
      expect.objectContaining({
        title: example.title,
        message: example.error,
        canFlush: false,
        tone: "error"
      })
    );
  });

  it.each([
    { dirty: true, saveState: "idle" as const },
    { dirty: true, saveState: "failed" as const },
    { dirty: false, saveState: "saving" as const }
  ])("registers native unload protection for $saveState", (state) => {
    expect(contractWorkbenchShouldBlockUnload({ ...state, error: "" })).toBe(true);
  });

  it("does not promise asynchronous completion after a forced browser close", () => {
    const prompt = contractWorkbenchNavigationPrompt({
      dirty: true,
      saveState: "saving",
      error: ""
    });

    expect(prompt?.message).toContain("等待当前保存");
    expect(prompt?.message).not.toContain("强制关闭也一定保存");
  });
});
