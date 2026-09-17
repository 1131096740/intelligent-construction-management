import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";

const permissions = { view: ["contract_staff"], edit: ["contract_staff"] } as const;

export const SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_DEFINITION: BusinessEntrySceneDefinition = {
  key: "settlement_line_attachment_purpose",
  entityType: "settlement_line_attachment",
  version: 1,
  name: "结算明细附件用途",
  description: "正式结算提交时冻结的明细附件用途。",
  rules: [],
  fields: [{
    key: "purpose",
    label: "附件用途",
    type: "text",
    order: 1,
    required: true,
    scope: "header",
    description: "来自结算明细附件的用途。",
    example: "现场签证单",
    unit: "",
    precision: 0,
    permissions,
    bulk: { enabled: false, maxRows: 1, strategy: "replace" },
    excel: { column: "附件用途", paste: "single", errorLocation: "cell" },
    display: {
      formHint: "请填写附件用途",
      gridColumn: "附件用途",
      mobilePriority: 1,
      readonlyText: "以提交时的附件用途为准"
    }
  }]
};

export function settlementLineAttachmentPurposeEntryValues(facts: { purpose: string }) {
  return { purpose: facts.purpose };
}
