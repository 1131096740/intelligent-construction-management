import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

const approvalRoles = ["chairman", "general_manager", "finance_director"] as const;

export const PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "payment_approval_amount",
  entityType: "payment_request",
  version: 1,
  name: "付款批准金额",
  description: "付款最终审批节点冻结的结构化批准金额。",
  rules: [],
  fields: [{
    key: "approvedAmountYuan",
    label: "批准金额",
    type: "money",
    scope: "header",
    order: 1,
    required: true,
    unit: "元",
    precision: 2,
    description: "最终审批通过时确认的批准付款金额。",
    example: "100.00",
    permissions: { view: approvalRoles, edit: approvalRoles },
    bulk: { enabled: false, strategy: "replace" },
    excel: { column: "批准金额", paste: "single", errorLocation: "cell" },
    display: {
      formHint: "由付款最终审批节点确认",
      gridColumn: "批准金额",
      mobilePriority: 1,
      readonlyText: "以最终审批通过时冻结的批准金额为准"
    }
  }]
};

export function paymentApprovalAmountEntryValues(approvedAmountCents: bigint) {
  return { approvedAmountYuan: formatMoneyCentsAsYuan(approvedAmountCents) };
}
