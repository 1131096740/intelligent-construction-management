import { describe, expect, it } from "vitest";
import {
  contractDraftManualSaveMessage,
  contractDraftSaveReceiptText,
  contractDraftSaveStatusText,
  shouldReloadContractAfterManualSave
} from "./contract-draft-save-status";

describe("contract draft save status", () => {
  it.each([
    ["saving", "保存中"],
    ["failed", "保存失败"],
    ["conflict", "存在保存冲突"]
  ] as const)("prioritizes %s over lifecycle and dirty state", (saveState, expected) => {
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: false,
        dirty: true,
        saveState
      })
    ).toBe(expected);
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: true,
        dirty: false,
        saveState
      })
    ).toBe(expected);
  });

  it("distinguishes local backup from a clean draft before the first formal save", () => {
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: false,
        dirty: true,
        saveState: "idle"
      })
    ).toBe("本地已备份，尚未正式保存");
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: false,
        dirty: false,
        saveState: "idle"
      })
    ).toBe("未正式保存");
  });

  it("distinguishes pending, freshly saved and otherwise clean formal drafts", () => {
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: true,
        dirty: true,
        saveState: "idle"
      })
    ).toBe("有待保存修改");
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: true,
        dirty: false,
        saveState: "saved"
      })
    ).toBe("已保存");
    expect(
      contractDraftSaveStatusText({
        formalSaveCompleted: true,
        dirty: false,
        saveState: "idle"
      })
    ).toBe("当前内容已保存");
  });

  it.each([
    [
      { hadDirtyContent: true, formalSaveCompleted: true },
      "已保存当前合同内容"
    ],
    [
      { hadDirtyContent: false, formalSaveCompleted: true },
      "当前内容已保存"
    ],
    [
      { hadDirtyContent: false, formalSaveCompleted: false },
      "当前没有待保存修改，合同尚未正式保存"
    ]
  ] as const)("reports the actual manual-save outcome for %o", (input, expected) => {
    expect(contractDraftManualSaveMessage(input)).toBe(expected);
  });

  it("reloads only after the first successful formal save with a contract id", () => {
    expect(
      shouldReloadContractAfterManualSave({
        wasFormalSaveCompleted: false,
        formalSaveCompleted: true,
        contractId: "contract-1"
      })
    ).toBe(true);
    expect(
      shouldReloadContractAfterManualSave({
        wasFormalSaveCompleted: true,
        formalSaveCompleted: true,
        contractId: "contract-1"
      })
    ).toBe(false);
    expect(
      shouldReloadContractAfterManualSave({
        wasFormalSaveCompleted: false,
        formalSaveCompleted: false,
        contractId: "contract-1"
      })
    ).toBe(false);
    expect(
      shouldReloadContractAfterManualSave({
        wasFormalSaveCompleted: false,
        formalSaveCompleted: true,
        contractId: ""
      })
    ).toBe(false);
  });

  it("formats only a real successful-save receipt", () => {
    const savedAt = new Date("2026-07-25T02:03:04.000Z");
    const savedTime = savedAt.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    expect(
      contractDraftSaveReceiptText({
        formalSaveCompleted: true,
        savedRevision: 7,
        lastSavedAt: savedAt
      })
    ).toBe(`修订 7 · ${savedTime}`);
    expect(
      contractDraftSaveReceiptText({
        formalSaveCompleted: true,
        savedRevision: 7,
        lastSavedAt: null
      })
    ).toBe("");
    expect(
      contractDraftSaveReceiptText({
        formalSaveCompleted: false,
        savedRevision: 7,
        lastSavedAt: savedAt
      })
    ).toBe("");
  });
});
