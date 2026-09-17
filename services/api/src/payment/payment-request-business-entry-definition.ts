import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

type PaymentRequestFacts = {
  code: string; sourceType: string; paymentSubjectType: string;
  settlementId: string | null; contractId: string; contractVersionId: string;
  paymentTermsVersionId: string; paymentTermsStageId: string | null;
  paymentMatter: string | null; amountCalculationExplanation: string | null;
  requestedAmountCents: bigint | string;
};

const permissions = { view: ["contract_staff", "contract_director", "project_manager"], edit: ["contract_staff", "contract_director", "project_manager"] } as const;
function field(key: string, label: string, type: BusinessEntryFieldDefinition["type"], order: number,
  required = false, options?: BusinessEntryFieldDefinition["options"]): BusinessEntryFieldDefinition {
  return {
    key, label, type, order, required, options, scope: "header", description: `来自付款申请的${label}。`, example: `示例${label}`,
    unit: type === "money" ? "元" : "", precision: type === "money" ? 2 : 0, permissions,
    bulk: { enabled: false, strategy: "replace" }, excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: order, readonlyText: `以提交时的${label}为准` }
  };
}
const selected = (value: string | null, label: string) => value ? [{ value, label }] : [];

export function paymentRequestEntryDefinition(facts?: PaymentRequestFacts): BusinessEntrySceneDefinition {
  return {
    key: "payment_request", entityType: "payment_request", version: 1, name: "付款申请", description: "付款申请创建时冻结的业务事实。", rules: [],
    fields: [
      field("code", "付款编号", "text", 1, true),
      field("sourceType", "付款来源", "single_select", 2, true, [{ value: "settlement", label: "已生效结算" }]),
      field("paymentSubjectType", "付款主体", "single_select", 3, true, [{ value: "our_company", label: "我方公司" }, { value: "affiliate", label: "施工企业" }]),
      field("settlementId", "关联结算", "single_select", 4, true, selected(facts?.settlementId ?? null, "已选结算")),
      field("contractId", "关联合同", "single_select", 5, true, selected(facts?.contractId ?? null, "已选合同")),
      field("contractVersionId", "合同版本", "single_select", 6, true, selected(facts?.contractVersionId ?? null, "已选合同版本")),
      field("paymentTermsVersionId", "付款条款版本", "single_select", 7, true, selected(facts?.paymentTermsVersionId ?? null, "已选付款条款")),
      field("paymentTermsStageId", "付款阶段", "single_select", 8, false, selected(facts?.paymentTermsStageId ?? null, "已选付款阶段")),
      field("paymentMatter", "付款事项", "long_text", 9), field("amountCalculationExplanation", "金额计算说明", "long_text", 10),
      field("requestedAmountYuan", "申请金额", "money", 11, true)
    ]
  };
}

export function paymentRequestEntryValues(facts: PaymentRequestFacts): Record<string, unknown> {
  const values: Record<string, unknown> = {
    code: facts.code, sourceType: facts.sourceType, paymentSubjectType: facts.paymentSubjectType,
    settlementId: facts.settlementId, contractId: facts.contractId, contractVersionId: facts.contractVersionId,
    paymentTermsVersionId: facts.paymentTermsVersionId, paymentTermsStageId: facts.paymentTermsStageId,
    paymentMatter: facts.paymentMatter, amountCalculationExplanation: facts.amountCalculationExplanation,
    requestedAmountYuan: formatMoneyCentsAsYuan(typeof facts.requestedAmountCents === "bigint" ? facts.requestedAmountCents : BigInt(facts.requestedAmountCents))
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

export const PAYMENT_REQUEST_ENTRY_DEFINITION = paymentRequestEntryDefinition();
