import type { BusinessEntryFieldDefinition, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

function field(
  key: string,
  label: string,
  options: Partial<BusinessEntryFieldDefinition> = {}
): BusinessEntryFieldDefinition {
  return {
    key,
    label,
    description: `请按本次项目经营快照填写${label}`,
    example: "",
    type: "text",
    scope: "header",
    unit: "",
    precision: 0,
    required: true,
    // Presentation-only definitions never authorize an action. The page keeps
    // using the existing server-derived workbench capabilities for every write.
    permissions: { view: [], edit: [] },
    display: {
      formHint: `请填写${label}`,
      gridColumn: label,
      mobilePriority: 1,
      readonlyText: `以本次提交冻结的${label}为准`
    },
    excel: { column: label, paste: "single", errorLocation: "cell" },
    bulk: { enabled: false, maxRows: 1, strategy: "replace" },
    ...options
  };
}

export const PROJECT_CLOSE_BASIS_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "project_close_basis",
  entityType: "project",
  name: "项目阶段与盈亏确认依据",
  description: "项目阶段、最终盈亏和分配提交共用的确认依据字段。",
  version: 1,
  fields: [field("basisSummary", "本次确认依据", {
    type: "long_text",
    display: {
      formHint: "请说明核对范围、依据和结论；系统会与本次经营快照一起冻结",
      gridColumn: "本次确认依据",
      mobilePriority: 1,
      readonlyText: "以本次提交冻结的本次确认依据为准"
    }
  })],
  rules: []
};

export const PROJECT_PROFIT_DISTRIBUTION_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "project_profit_distribution_line",
  entityType: "project",
  name: "公司盈亏分配",
  description: "按参与公司填写最终应分利润或应承担亏损。",
  version: 1,
  fields: [
    field("companyEntityId", "参与公司", { type: "company", readOnly: true }),
    field("finalShareYuan", "最终应分或承担金额", {
      type: "money",
      unit: "元",
      precision: 2,
      exactDecimalString: { sign: "signed", maximumExclusive: "1000000000000000000" },
      bulk: { enabled: true, maxRows: 100, strategy: "replace" },
      excel: { column: "最终应分或承担金额", paste: "multi", errorLocation: "cell" }
    })
  ],
  rules: []
};
