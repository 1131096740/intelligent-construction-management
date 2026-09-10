import type {
  NecessaryExpenseReserveCapabilities,
  NecessaryExpenseReserveEntryReadModel
} from "../../api/necessary-expense-reserve.api";

export function necessaryExpenseReserveActions(
  entry: NecessaryExpenseReserveEntryReadModel,
  capabilities: NecessaryExpenseReserveCapabilities
) {
  return {
    edit: capabilities.prepare && (entry.status === "draft" || entry.status === "returned"),
    submit: capabilities.submit && (entry.status === "draft" || entry.status === "returned"),
    attest: capabilities.attest && entry.status === "submitted",
    confirm: capabilities.confirm && entry.status === "attested",
    return: capabilities.return && (entry.status === "submitted" || entry.status === "attested")
  };
}

export const necessaryExpenseReserveEntryKindLabels = {
  establish: "建立准备",
  increase: "增加准备",
  release: "释放准备",
  technical_reversal: "技术冲销"
} as const;

export const necessaryExpenseReserveStatusLabels = {
  draft: "未提交",
  submitted: "待项目经理见证",
  attested: "待财务总监确认",
  confirmed: "已进入正式账",
  returned: "已退回"
} as const;
