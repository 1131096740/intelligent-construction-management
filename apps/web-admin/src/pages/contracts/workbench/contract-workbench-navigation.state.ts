export type ContractWorkbenchNavigationSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "conflict"
  | "readonly";

export interface ContractWorkbenchNavigationState {
  dirty: boolean;
  saveState: ContractWorkbenchNavigationSaveState;
  error: string;
}

export interface ContractWorkbenchNavigationPrompt {
  title: string;
  message: string;
  actionLabel: string;
  canFlush: boolean;
  tone: "warning" | "error";
}

export function contractWorkbenchNavigationPrompt(
  state: ContractWorkbenchNavigationState
): ContractWorkbenchNavigationPrompt | null {
  if (state.saveState === "conflict") {
    return {
      title: "合同草稿存在版本冲突",
      message: state.error || "请先处理版本冲突，当前页面不会丢弃本地草稿。",
      actionLabel: "暂不能离开",
      canFlush: false,
      tone: "error"
    };
  }
  if (state.saveState === "readonly") {
    return {
      title: "当前页面已转为只读",
      message:
        state.error ||
        "编辑租约已失效，未保存内容仍保留在本机；请先复制或处理本机副本。",
      actionLabel: "暂不能离开",
      canFlush: false,
      tone: "error"
    };
  }
  if (state.saveState === "failed") {
    return {
      title: "合同草稿保存失败",
      message: state.error || "合同草稿尚未保存，请检查网络后重试。",
      actionLabel: "重新保存并离开",
      canFlush: true,
      tone: "error"
    };
  }
  if (state.saveState === "saving") {
    return {
      title: "合同草稿正在保存",
      message:
        "系统会等待当前保存及其后的最新编辑全部收敛；保存成功后才会离开当前页面。",
      actionLabel: "等待保存并离开",
      canFlush: true,
      tone: "warning"
    };
  }
  if (state.dirty) {
    return {
      title: "保存合同草稿后离开",
      message: "系统会先保存全部合同草稿修改；保存成功后才会离开当前页面。",
      actionLabel: "保存并离开",
      canFlush: true,
      tone: "warning"
    };
  }
  return null;
}

export function contractWorkbenchShouldBlockUnload(
  state: ContractWorkbenchNavigationState
): boolean {
  return state.dirty || state.saveState === "saving";
}

export function createContractWorkbenchLeaveSave(options: {
  state: () => ContractWorkbenchNavigationState;
  flushBeforeLeave: () => Promise<boolean>;
}) {
  let pending: Promise<boolean> | null = null;

  function flush(): Promise<boolean> {
    if (pending) return pending;
    const before = options.state();
    if (before.saveState === "conflict" || before.saveState === "readonly") {
      return Promise.resolve(false);
    }
    if (!contractWorkbenchNavigationPrompt(before)) {
      return Promise.resolve(true);
    }

    let current: Promise<boolean>;
    try {
      current = options.flushBeforeLeave().then(
        (saved) => saved && canLeaveAfterFlush(options.state()),
        () => false
      );
    } catch {
      current = Promise.resolve(false);
    }
    pending = current;
    void current.then(
      () => {
        if (pending === current) pending = null;
      },
      () => {
        if (pending === current) pending = null;
      }
    );
    return current;
  }

  return { flush };
}

function canLeaveAfterFlush(state: ContractWorkbenchNavigationState): boolean {
  return (
    !state.dirty &&
    state.saveState !== "saving" &&
    state.saveState !== "failed" &&
    state.saveState !== "conflict" &&
    state.saveState !== "readonly"
  );
}
