import {
  createBusinessEntryDefinitionRegistry,
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  PROJECT_OPERATING_TAKEOVER_STATUS_LABELS,
  PROJECT_OPERATING_TAKEOVER_STATUSES,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";

const projectFinanceRoles = ["finance_staff", "finance_director"] as const;

export const BUSINESS_ENTRY_SCENE_DEFINITIONS: readonly BusinessEntrySceneDefinition[] = [
  {
    key: "project_operating_profile",
    entityType: "project",
    name: "项目经营档案",
    description: "维护项目经营账生效日、历史接管完成日和受控接管状态。",
    version: 1,
    fields: [
      {
        key: "operatingLedgerEffectiveDate",
        label: "经营账生效日",
        description: "项目经营账开始纳入正式事实的日期。",
        example: "2026-08-16",
        type: "date",
        scope: "header",
        unit: "日",
        precision: 0,
        required: false,
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "填写项目经营账开始纳入正式事实的日期",
          gridColumn: "经营账生效日",
          mobilePriority: 1,
          readonlyText: "以项目经营账生效日为准"
        },
        excel: { column: "经营账生效日", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      },
      {
        key: "takeoverCompletedDate",
        label: "经营接管完成日",
        description: "历史经营资料完成专业确认的日期。",
        example: "2026-08-16",
        type: "date",
        scope: "header",
        unit: "日",
        precision: 0,
        required: false,
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "填写历史经营资料完成专业确认的日期",
          gridColumn: "经营接管完成日",
          mobilePriority: 2,
          readonlyText: "以经营接管完成日冻结快照为准"
        },
        excel: { column: "经营接管完成日", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      },
      {
        key: "takeoverStatus",
        label: "经营接管状态",
        description: "项目历史经营资料的受控接管状态。",
        example: "正式使用、历史接管中",
        type: "single_select",
        scope: "header",
        unit: "",
        precision: 0,
        required: true,
        options: PROJECT_OPERATING_TAKEOVER_STATUSES.map((value) => ({
          value,
          label: PROJECT_OPERATING_TAKEOVER_STATUS_LABELS[value]
        })),
        permissions: { view: projectFinanceRoles, edit: projectFinanceRoles },
        display: {
          formHint: "只能选择系统登记的经营接管状态",
          gridColumn: "经营接管状态",
          mobilePriority: 1,
          readonlyText: "提交后按冻结版本展示"
        },
        excel: { column: "经营接管状态", paste: "single", errorLocation: "cell" },
        bulk: { enabled: true, maxRows: 1, strategy: "replace" }
      }
    ],
    rules: [
      {
        key: "takeover_completed_requires_date",
        kind: "required_if",
        when: {
          fieldKey: "takeoverStatus",
          operator: "eq",
          value: "takeover_completed"
        },
        fieldKey: "takeoverCompletedDate",
        message: "接管完成时必须填写经营接管完成日"
      },
      {
        key: "takeover_completed_date_after_effective_date",
        kind: "less_than_or_equal",
        leftFieldKey: "operatingLedgerEffectiveDate",
        rightFieldKey: "takeoverCompletedDate",
        message: "经营接管完成日不能早于经营账生效日"
      }
    ]
  },
  ...OPERATING_TAKEOVER_SCENE_DEFINITIONS
];

export const BUSINESS_ENTRY_DEFINITION_REGISTRY = createBusinessEntryDefinitionRegistry(
  BUSINESS_ENTRY_SCENE_DEFINITIONS
);
