import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

type SettlementBasicFacts = {
  contractVersionId: string;
  settlementTemplateVersionId: string | null;
  code: string;
  periodLabel: string;
  periodEnd: Date | null;
  isFinal: boolean;
  finalDeclarationSnapshot: unknown;
  finalCumulativeAmountCents: bigint | string | null;
  fieldReviewerUserId: string | null;
  fieldReviewerRoleKey: string | null;
};

const permissions = { view: ["contract_staff"], edit: ["contract_staff"] } as const;

function settlementField(
  key: string,
  label: string,
  type: BusinessEntryFieldDefinition["type"],
  order: number,
  options: BusinessEntryFieldDefinition["options"] = undefined,
  required = true
): BusinessEntryFieldDefinition {
  return {
    key, label, type, order, options, required, scope: "header",
    description: `来自结算草稿主单的${label}。`, example: `示例${label}`,
    unit: key === "finalCumulativeAmountYuan" ? "元" : "",
    precision: key === "finalCumulativeAmountYuan" ? 2 : 0,
    permissions,
    bulk: { enabled: false, strategy: "replace" },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: order, readonlyText: `以提交时的${label}为准` }
  };
}

export function settlementBasicEntryDefinition(
  facts?: Pick<SettlementBasicFacts, "contractVersionId" | "settlementTemplateVersionId" | "fieldReviewerUserId">
): BusinessEntrySceneDefinition {
  const selectedOption = (value: string | null | undefined, label: string) => value
    ? [{ value, label }]
    : [];
  return {
    key: "settlement_basic", entityType: "settlement", version: 2,
    name: "结算基础信息", description: "本次结算草稿主单在提交审批时冻结的固定字段。", rules: [],
    fields: [
      settlementField("contractVersionId", "关联合同", "single_select", 1,
        selectedOption(facts?.contractVersionId, "已选合同")),
      settlementField("settlementTemplateVersionId", "结算模板", "single_select", 2,
        selectedOption(facts?.settlementTemplateVersionId, "已选结算模板")),
      settlementField("code", "结算编号", "text", 3),
      settlementField("periodLabel", "结算期间", "text", 4),
      settlementField("periodEnd", "结算截止日", "date", 5, undefined, false),
      settlementField("isFinal", "最终结算", "boolean", 6),
      settlementField("finalDeclarationAccepted", "最终结算总体声明", "boolean", 7, undefined, false),
      settlementField("finalCumulativeAmountYuan", "审定累计结算金额", "money", 8, undefined, false),
      settlementField("fieldReviewerUserId", "现场复核人", "single_select", 9,
        selectedOption(facts?.fieldReviewerUserId, "已选现场复核人"), false),
      settlementField("fieldReviewerRoleKey", "现场复核岗位", "single_select", 10, [
        { value: "material_staff", label: "材料专员" },
        { value: "engineering_foreman", label: "工程工长" },
        { value: "engineering_tech", label: "工程技术员" }
      ], false)
    ]
  };
}

export function settlementBasicEntryValues(facts: SettlementBasicFacts): Record<string, unknown> {
  const declaration = facts.finalDeclarationSnapshot as { accepted?: unknown } | null;
  return {
    contractVersionId: facts.contractVersionId,
    ...(facts.settlementTemplateVersionId ? { settlementTemplateVersionId: facts.settlementTemplateVersionId } : {}),
    code: facts.code,
    periodLabel: facts.periodLabel,
    ...(facts.periodEnd ? { periodEnd: facts.periodEnd.toISOString().slice(0, 10) } : {}),
    isFinal: facts.isFinal,
    ...(typeof declaration?.accepted === "boolean" ? { finalDeclarationAccepted: declaration.accepted } : {}),
    ...(facts.finalCumulativeAmountCents != null
      ? { finalCumulativeAmountYuan: formatMoneyCentsAsYuan(
          typeof facts.finalCumulativeAmountCents === "bigint"
            ? facts.finalCumulativeAmountCents
            : BigInt(facts.finalCumulativeAmountCents)
        ) }
      : {}),
    ...(facts.fieldReviewerUserId ? { fieldReviewerUserId: facts.fieldReviewerUserId } : {}),
    ...(facts.fieldReviewerRoleKey ? { fieldReviewerRoleKey: facts.fieldReviewerRoleKey } : {})
  };
}

export const SETTLEMENT_BASIC_ENTRY_DEFINITION = settlementBasicEntryDefinition();
