import type { ContractDraftSaveState } from "./use-contract-draft";

export function contractDraftSaveStatusText(input: {
  formalSaveCompleted: boolean;
  dirty: boolean;
  saveState: ContractDraftSaveState;
}) {
  if (input.saveState === "saving") return "保存中";
  if (input.saveState === "failed") return "保存失败";
  if (input.saveState === "conflict") return "存在保存冲突";
  if (input.saveState === "readonly") return "编辑租约已失效，当前页面只读";
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

export function contractDraftPreviewFeedbackText(input: {
  savedRevision: number;
  previewState: "saved" | "queueing" | "failed";
}) {
  if (input.previewState === "queueing") return "文档预览生成中";
  const saved = `资料已保存，修订号 ${input.savedRevision}`;
  return input.previewState === "failed"
    ? `${saved}；文档预览生成失败，可稍后重试；左侧继续显示上一版`
    : saved;
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

type ManualSaveFeedbackTimer = ReturnType<typeof setTimeout>;

export function createContractDraftManualSaveFeedback(input: {
  setMessage: (message: string) => void;
  schedule?: (callback: () => void, delayMs: number) => ManualSaveFeedbackTimer;
  cancel?: (timer: ManualSaveFeedbackTimer) => void;
  clearAfterMs?: number;
}) {
  const schedule =
    input.schedule ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel =
    input.cancel ??
    ((timer: ManualSaveFeedbackTimer) => clearTimeout(timer));
  const clearAfterMs = input.clearAfterMs ?? 4_000;
  let timer: ManualSaveFeedbackTimer | null = null;
  let generation = 0;

  function clear() {
    generation += 1;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    input.setMessage("");
  }

  function show(message: string) {
    clear();
    input.setMessage(message);
    const messageGeneration = generation;
    timer = schedule(() => {
      if (messageGeneration !== generation) return;
      timer = null;
      input.setMessage("");
    }, clearAfterMs);
  }

  return { clear, show };
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
