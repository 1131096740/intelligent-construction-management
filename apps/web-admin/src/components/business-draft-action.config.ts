import type {
  DetailActionReadModel,
  DraftLifecycleAction
} from "@jiangkong/shared-domain";

export interface BusinessDraftActionConfig {
  label: string;
  danger: true;
  requireReason: boolean;
  confirmText: string;
  description: string;
}

export interface BusinessDraftActionItem extends BusinessDraftActionConfig {
  key: Exclude<DraftLifecycleAction, "discard_local">;
  enabled: boolean;
  disabledReason: string | null;
  requirePassword: boolean;
}

export const businessDraftActionConfig: Readonly<Record<DraftLifecycleAction, BusinessDraftActionConfig>> = {
  discard_local: {
    label: "放弃填写",
    danger: true,
    requireReason: false,
    confirmText: "确认放弃填写",
    description: "本页尚未保存的填写内容将不会保留。"
  },
  delete_pristine_draft: {
    label: "删除草稿",
    danger: true,
    requireReason: false,
    confirmText: "确认删除草稿",
    description: "这份纯净草稿将结束，正式业务记录不受影响。"
  },
  abandon_application: {
    label: "放弃申请",
    danger: true,
    requireReason: true,
    confirmText: "确认放弃申请",
    description: "申请将结束，已有审批、文件和操作历史仍会保留。"
  },
  withdraw: {
    label: "撤回申请",
    danger: true,
    requireReason: false,
    confirmText: "确认撤回申请",
    description: "申请将按当前业务规则撤回，后续处理以服务端结果为准。"
  },
  void: {
    label: "作废",
    danger: true,
    requireReason: false,
    confirmText: "确认作废",
    description: "正式记录将按当前业务规则作废，历史证据仍会保留。"
  },
  terminate: {
    label: "异常终止",
    danger: true,
    requireReason: false,
    confirmText: "确认异常终止",
    description: "业务流程将异常终止，历史证据仍会保留。"
  },
  discard_version: {
    label: "废弃版本",
    danger: true,
    requireReason: false,
    confirmText: "确认废弃版本",
    description: "该草稿版本将废弃，已形成的正式引用不受影响。"
  }
};

const serverDraftActionKeys = new Set<Exclude<DraftLifecycleAction, "discard_local">>([
  "delete_pristine_draft",
  "abandon_application",
  "withdraw",
  "void",
  "terminate",
  "discard_version"
]);

function isServerDraftActionKey(
  key: string
): key is Exclude<DraftLifecycleAction, "discard_local"> {
  return serverDraftActionKeys.has(key as Exclude<DraftLifecycleAction, "discard_local">);
}

export function toBusinessDraftActionItems(
  actions: readonly DetailActionReadModel[]
): BusinessDraftActionItem[] {
  return actions.flatMap((action) => {
    if (!isServerDraftActionKey(action.key)) return [];

    const config = businessDraftActionConfig[action.key];
    return [{
      ...config,
      key: action.key,
      label: action.label || config.label,
      enabled: action.enabled,
      disabledReason: action.disabledReason,
      requireReason: config.requireReason || Boolean(action.requiresComment),
      requirePassword: Boolean(action.requiresPassword)
    }];
  });
}
