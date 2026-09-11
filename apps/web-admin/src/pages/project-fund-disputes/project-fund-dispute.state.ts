import type {
  ProjectFundDisputeCapabilities,
  ProjectFundDisputeEntryReadModel
} from "../../api/project-fund-dispute.api";

export function projectFundDisputeActions(
  entry: ProjectFundDisputeEntryReadModel,
  capabilities: ProjectFundDisputeCapabilities
) {
  return {
    edit: capabilities.prepare && (entry.status === "draft" || entry.status === "returned"),
    submit: capabilities.submit && (entry.status === "draft" || entry.status === "returned"),
    attest: capabilities.attest && entry.status === "submitted",
    confirm: capabilities.confirm && entry.status === "attested",
    return: capabilities.return && (entry.status === "submitted" || entry.status === "attested")
  };
}

export const projectFundDisputeEntryKindLabels = {
  establish: "建立争议占用",
  increase: "增加争议占用",
  release: "解除争议占用",
  technical_reversal: "技术冲销"
} as const;

export const projectFundDisputeStatusLabels = {
  draft: "未提交",
  submitted: "待独立见证",
  attested: "待财务总监确认",
  confirmed: "已进入正式账",
  returned: "已退回"
} as const;
