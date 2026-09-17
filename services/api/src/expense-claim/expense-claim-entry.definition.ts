import { ACTION_REQUIRED_ROLES, type BusinessEntryFieldDefinition, type BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const roles = ACTION_REQUIRED_ROLES["expense_claim.create"];
const field = (key: string, label: string, type: BusinessEntryFieldDefinition["type"] = "text", options: Partial<BusinessEntryFieldDefinition> = {}): BusinessEntryFieldDefinition => ({
  key, label, type, description: `${label}沿用费用申请的业务校验。`, example: "按真实业务资料填写", scope: "header", unit: type === "money" ? "元" : "", precision: type === "money" ? 2 : 0, required: false,
  permissions: { view: roles, edit: roles, import: roles, export: roles },
  display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: `提交时的${label}` },
  excel: { column: label, paste: "single", errorLocation: "cell" }, bulk: { enabled: true, maxRows: 200, strategy: "append" }, ...options
});

// Only field metadata; authorization and all formal effects remain in the expense domain.
export const EXPENSE_CLAIM_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "expense_claim.application", entityType: "expense_claim", name: "费用申请", description: "报销、项目借款与零星费用申请", version: 1,
  fields: [
    field("claimType", "费用类型", "single_select", { required: true, options: [{ value: "reimbursement", label: "费用报销" }, { value: "loan", label: "项目借款" }, { value: "incidental_expense", label: "零星费用" }] }),
    field("companyEntityId", "使用单位", "company", { required: true }),
    field("projectId", "所属项目"), field("factWitnessUserId", "事实证明人"), field("applicantUserId", "申请人"),
    field("applicantName", "申请人姓名"), field("applicantPhone", "申请人电话"),
    field("reason", "事由", "long_text", { required: true }),
    field("requestedAmountYuan", "申请金额", "money", { required: true }),
    field("paymentMethod", "收款方式"), field("payeeName", "收款对象"), field("payeeAccountName", "收款账户名称"), field("payeeBankName", "开户银行"), field("payeeBankAccount", "收款账号"),
    field("loanExpectedClearanceOn", "预计清账日期", "date"),
    field("incidentalExpenseCategory", "零星费用分类", "single_select", { options: [{ value: "temporary_service", label: "非材料临时服务" }, { value: "temporary_machinery_shift", label: "临时机械台班" }, { value: "sporadic_labor", label: "零星用工" }, { value: "other_incidental", label: "其他非材料临时费用" }] }),
    field("expenseCategory", "费用类别", "text", { scope: "line", required: true }), field("occurredOn", "发生日期", "date", { scope: "line", required: true }), field("purpose", "用途说明", "long_text", { scope: "line", required: true }),
    field("receiptCount", "单据张数", "number", { scope: "line", required: true }), field("amountYuan", "费用金额", "money", { scope: "line", required: true }),
    field("evidenceType", "证据类型", "single_select", { scope: "line", required: true, options: [{ value: "invoice", label: "发票" }, { value: "receipt_or_other", label: "收据或其他凭证" }, { value: "none", label: "无凭证" }] }),
    field("noEvidenceReason", "无凭证原因", "long_text", { scope: "line" }), field("remark", "备注", "long_text", { scope: "line" })
  ], rules: []
};
