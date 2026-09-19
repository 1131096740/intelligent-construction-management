import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { clearingKindOptions } from "./clearing-workbench.state";

const categoryOptions = [
  { value: "management_fee", label: "管理费" },
  { value: "final_tax", label: "最终税费" },
  { value: "deposit", label: "保证金" },
  { value: "insurance_fee", label: "保险费" },
  { value: "service_fee", label: "服务费" },
  { value: "assigned_management_salary", label: "委派管理人员工资" },
  { value: "other_controlled_deduction", label: "其他受控扣项" }
] as const;

function field(
  key: string,
  label: string,
  options: Partial<BusinessEntryFieldDefinition> = {}
): BusinessEntryFieldDefinition {
  return {
    key,
    label,
    description: `请填写${label}`,
    example: "",
    type: "text",
    scope: "header",
    unit: "",
    precision: 0,
    required: false,
    // These definitions only render and normalize fields. Existing clearing
    // capabilities remain the sole authorization source for every command.
    permissions: { view: [], edit: [] },
    display: {
      formHint: `请填写${label}`,
      gridColumn: label,
      mobilePriority: 1,
      readonlyText: `以清分版本中的${label}为准`
    },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    bulk: { enabled: false, maxRows: 1, strategy: "replace" },
    ...options
  };
}

export const CLEARING_CASE_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "clearing_case_entry",
  entityType: "clearing_case",
  name: "清分事项",
  description: "创建清分事项时使用的统一展示与填写字段。",
  version: 1,
  fields: [
    field("projectId", "项目", { type: "single_select", required: true }),
    field("category", "分类", { type: "single_select", required: true, options: categoryOptions }),
    field("authoritySelectionRef", "服务端权威业务选项", {
      type: "single_select",
      required: true,
      visibleWhen: { fieldKey: "category", operator: "in", value: ["deposit", "assigned_management_salary"] }
    }),
    field("guaranteeTrancheYuan", "本次暂扣金额", {
      type: "money",
      unit: "元",
      precision: 2,
      visibleWhen: { fieldKey: "category", operator: "eq", value: "deposit" }
    }),
    field("governedSubjectKey", "受控事项", {
      required: true,
      visibleWhen: { fieldKey: "category", operator: "not_in", value: ["deposit", "assigned_management_salary"] }
    }),
    field("authoritativeGrossCapYuan", "权威毛额", {
      type: "money",
      unit: "元",
      precision: 2,
      required: true,
      visibleWhen: { fieldKey: "category", operator: "not_in", value: ["deposit", "assigned_management_salary"] }
    })
  ],
  rules: []
};

export const CLEARING_EVENT_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "clearing_event_entry",
  entityType: "clearing_event",
  name: "清分事件",
  description: "普通清分事件草稿的统一展示与填写字段。",
  version: 1,
  fields: [
    field("kind", "事件类型", { type: "single_select", required: true, options: clearingKindOptions }),
    field("amountYuan", "金额", { type: "money", unit: "元", precision: 2, required: true }),
    field("evidenceLevel", "证据等级", {
      type: "single_select",
      required: true,
      options: [{ value: "A", label: "A 级" }, { value: "B", label: "B 级" }]
    }),
    field("businessReason", "业务说明", { type: "long_text" }),
    field("evidenceRef", "依据说明")
  ],
  rules: []
};

export const CLEARING_CONFIRMATION_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "clearing_confirmation_entry",
  entityType: "clearing_event",
  name: "清分确认与分配",
  description: "确认清分事件时使用的业务化分配字段。",
  version: 1,
  fields: [
    field("sourceKind", "分配来源", {
      type: "single_select",
      required: true,
      options: [
        { value: "authority_cap", label: "权威毛额上限" },
        { value: "withheld", label: "已确认暂扣" },
        { value: "final_confirmed", label: "已确认最终扣项" },
        { value: "supplemental", label: "已确认补扣" }
      ]
    }),
    field("sourceEventVersionId", "来源清分版本", { type: "single_select", required: true }),
    field("sourceSelectionRef", "可用确认余额", { type: "single_select", required: true }),
    field("amountYuan", "本次分配金额", {
      type: "money",
      unit: "元",
      precision: 2,
      required: true
    }),
    field("pairedWithheldAmountYuan", "同事务配对暂扣金额", {
      type: "money",
      unit: "元",
      precision: 2,
      required: true
    })
  ],
  rules: []
};

export const CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "clearing_authority_event_entry",
  entityType: "clearing_event",
  name: "权威来源清分事件",
  description: "权威来源清分事件只填写允许由用户补充的字段。",
  version: 1,
  fields: [
    field("kind", "事件类型", { type: "single_select", required: true, options: clearingKindOptions }),
    field("amountYuan", "本次保证金暂扣金额", { type: "money", unit: "元", precision: 2 }),
    field("businessReason", "业务原因", { required: true }),
    field("evidenceRef", "证据引用")
  ],
  rules: []
};
