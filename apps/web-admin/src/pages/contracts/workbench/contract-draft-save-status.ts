import type { ContractDraftSaveState } from "./use-contract-draft";

export function contractDraftSaveStatusText(input: {
  formalSaveCompleted: boolean;
  dirty: boolean;
  saveState: ContractDraftSaveState;
}) {
  if (input.saveState === "saving") return "保存中";
  if (input.saveState === "failed") return "保存失败";
  if (input.saveState === "conflict") return "存在保存冲突";
  if (!input.formalSaveCompleted) {
    return input.dirty ? "本地已备份，尚未正式保存" : "未正式保存";
  }
  if (input.dirty) return "有待保存修改";
  return input.saveState === "saved" ? "已保存" : "当前内容已保存";
}

export function contractDraftManualSaveMessage(input: {
  hadDirtyContent: boolean;
  formalSaveCompleted: boolean;
}) {
  if (input.hadDirtyContent) return "已保存当前合同内容";
  return input.formalSaveCompleted
    ? "当前内容已保存"
    : "当前没有待保存修改，合同尚未正式保存";
}

export function contractDraftSaveReceiptText(input: {
  formalSaveCompleted: boolean;
  savedRevision: number;
  lastSavedAt: Date | null;
}) {
  if (!input.formalSaveCompleted || input.lastSavedAt === null) return "";
  return `修订 ${input.savedRevision} · ${input.lastSavedAt.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}

export function shouldReloadContractAfterManualSave(input: {
  wasFormalSaveCompleted: boolean;
  formalSaveCompleted: boolean;
  contractId: string;
}) {
  return (
    !input.wasFormalSaveCompleted &&
    input.formalSaveCompleted &&
    input.contractId.length > 0
  );
}
