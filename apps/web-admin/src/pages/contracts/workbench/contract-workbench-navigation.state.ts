export interface ContractWorkbenchNavigationState {
  draftDirty: boolean;
  billDirty: boolean;
  draftSaving: boolean;
  billBatchSaving: boolean;
}

export interface ContractWorkbenchNavigationPrompt {
  title: string;
  message: string;
}

export function contractWorkbenchNavigationPrompt(
  state: ContractWorkbenchNavigationState
): ContractWorkbenchNavigationPrompt | null {
  if (state.billBatchSaving && state.draftSaving) {
    return {
      title: "合同草稿和清单正在保存",
      message: "合同草稿和清单都在保存，请等待保存完成后再离开。"
    };
  }
  if (state.billBatchSaving) {
    return {
      title: "合同清单正在保存",
      message: "合同清单正在保存，请等待保存完成后再离开。"
    };
  }
  if (state.draftSaving) {
    return {
      title: "合同草稿正在保存",
      message: "保存请求正在处理中，当前不能放弃并离开。请等待保存完成后重试，系统不会中断已发出的保存请求。"
    };
  }
  if (state.draftDirty && state.billDirty) {
    return {
      title: "合同基础信息和清单均未保存",
      message: "当前合同基础信息和清单都有未保存修改。放弃后两类本地修改都会丢失，服务端最近保存内容不受影响。"
    };
  }
  if (state.billDirty) {
    return {
      title: "合同清单尚未保存",
      message: "当前清单有未保存修改。放弃后将恢复到最近一次整表保存状态。"
    };
  }
  if (state.draftDirty) {
    return {
      title: "合同基础信息尚未保存",
      message: "当前合同基础信息有未保存修改。放弃后将恢复到服务端最近保存状态。"
    };
  }
  return null;
}

export function shouldCancelPendingNavigation(
  pending: boolean,
  state: ContractWorkbenchNavigationState
) {
  return pending && contractWorkbenchNavigationPrompt(state) === null;
}
