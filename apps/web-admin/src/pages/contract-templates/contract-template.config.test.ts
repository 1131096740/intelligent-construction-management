import { describe, expect, it } from "vitest";
import {
  billAmountRoleOptions,
  businessPartyEditPolicy,
  businessTemplateVersionActionsByStatus,
  canPublishLayoutVersion,
  contractTemplateVersionGovernance,
  contractTemplateVersionOptions,
  contractTypeOptions,
  displayContractNumberPattern,
  fieldTypeOptions,
  hasOnlyAllowedNumberRuleTokens,
  isValidContractNumberPattern,
  mergeContractTemplateSchemaForSave,
  normalizeContractNumberPattern,
  normalizeContractTemplateDetail,
  normalizePublishedContractTemplates,
  pricingModeOptions,
  publishedTemplateForSelection,
  quantityScaleOptions,
  templateListActions,
  templateListColumns,
  unitPriceScaleOptions
} from "./contract-template.config";

describe("contract template center config", () => {
  const publishedTemplatePayload = {
    id: "template-1",
    code: "TPL-MAT",
    name: "材料采购模板",
    status: "published",
    contractTypeKey: "material_purchase",
    versionId: "version-2",
    versionNo: 2,
    usagePreview: {
      fields: [
        {
          label: "供应商名称",
          type: "text",
          required: true,
          group: "主体信息",
          conditional: true
        }
      ],
      bills: [
        {
          name: "材料清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          columns: [{ label: "材料名称", type: "text", required: true }]
        }
      ],
      clauses: [{ title: "付款约定", required: true }],
      attachments: [{ name: "报价单", required: true, mustBeValid: true }],
      validations: [{ level: "block", message: "请补齐付款约定" }]
    }
  };

  it("normalizes the compact published usage preview and binds selection to type and version", () => {
    const templates = normalizePublishedContractTemplates(
      [publishedTemplatePayload],
      "material_purchase"
    );

    expect(templates).toEqual([publishedTemplatePayload]);
    expect(
      publishedTemplateForSelection(templates, "version-2", "material_purchase")
    ).toEqual(publishedTemplatePayload);
    expect(
      publishedTemplateForSelection(templates, "version-2", "labor_subcontract")
    ).toBeNull();
    expect(
      publishedTemplateForSelection(templates, "stale-version", "material_purchase")
    ).toBeNull();
  });

  it.each([
    [[{ ...publishedTemplatePayload, versionNo: 0 }], "模板发布版本数据不完整，请刷新后重试"],
    [[{ ...publishedTemplatePayload, status: "draft" }], "模板发布状态不正确，请刷新后重试"],
    [[{ ...publishedTemplatePayload, contractTypeKey: "labor_subcontract" }], "模板合同类型与当前选择不一致，请重新选择"],
    [[publishedTemplatePayload, { ...publishedTemplatePayload, id: "template-2" }], "模板发布版本数据重复，请刷新后重试"],
    [[{ ...publishedTemplatePayload, usagePreview: { ...publishedTemplatePayload.usagePreview, previewPdfFileId: "file-secret" } }], "模板结构预览包含未允许的数据，请刷新后重试"],
    [[{ ...publishedTemplatePayload, usagePreview: { ...publishedTemplatePayload.usagePreview, fields: [{ label: "字段", type: "unknown", required: true, conditional: false }] } }], "模板结构预览数据不完整，请刷新后重试"],
    [[{ ...publishedTemplatePayload, usagePreview: { ...publishedTemplatePayload.usagePreview, clauses: [{ title: "条款", required: "yes" }] } }], "模板结构预览数据不完整，请刷新后重试"]
  ])("fails closed for an invalid published usage preview: %p", (value, message) => {
    expect(() =>
      normalizePublishedContractTemplates(value, "material_purchase")
    ).toThrow(message);
  });

  it("按稳定 key 合并五类 schema 且不丢失 UI 未完整表达的元数据", () => {
    const original = {
      fields: [
        {
          key: "field-1",
          label: "原字段",
          type: "text",
          required: false,
          defaultValue: "默认值",
          group: "base",
          order: 7,
          visibleWhen: { fieldKey: "kind", operator: "neq", value: "hidden" }
        }
      ],
      bills: [
        {
          key: "bill-1",
          name: "原清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: [{ key: "item", label: "原列", type: "text", required: true }]
        }
      ],
      clauses: [
        {
          key: "clause-1",
          title: "原条款",
          numberingMode: "automatic",
          required: true,
          content: { text: "原文", source: "standard" }
        }
      ],
      attachments: [
        { key: "attachment-1", name: "原附件", required: true, mustBeValid: true }
      ],
      validations: [
        {
          key: "rule-1",
          level: "block",
          targetClauseKey: "clause-1",
          requiredPhrases: ["原短语"],
          message: "原提示"
        }
      ]
    };
    const edited = {
      fields: [
        {
          key: "field-1",
          label: "新字段",
          type: "text",
          required: true,
          visibleWhen: { fieldKey: "kind", operator: "eq", value: "shown" }
        }
      ],
      bills: [
        {
          key: "bill-1",
          name: "新清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 3,
          unitPriceScale: 2,
          columns: [{ key: "item", label: "新列", type: "text" }]
        }
      ],
      clauses: [
        {
          key: "clause-1",
          title: "新条款",
          numberingMode: "automatic",
          required: true,
          content: { text: "新文" }
        }
      ],
      attachments: [{ key: "attachment-1", name: "新附件", required: false }],
      validations: [
        {
          key: "rule-1",
          level: "warning",
          targetClauseKey: "clause-1",
          message: "新提示"
        }
      ]
    };

    expect(mergeContractTemplateSchemaForSave(original, edited)).toEqual({
      fields: [
        expect.objectContaining({
          key: "field-1",
          label: "新字段",
          required: true,
          defaultValue: "默认值",
          group: "base",
          order: 7,
          visibleWhen: { fieldKey: "kind", operator: "neq", value: "shown" }
        })
      ],
      bills: [
        expect.objectContaining({
          key: "bill-1",
          name: "新清单",
          quantityScale: 3,
          columns: [{ key: "item", label: "新列", type: "text", required: true }]
        })
      ],
      clauses: [
        expect.objectContaining({
          key: "clause-1",
          title: "新条款",
          content: { text: "新文", source: "standard" }
        })
      ],
      attachments: [
        { key: "attachment-1", name: "新附件", required: false, mustBeValid: true }
      ],
      validations: [
        {
          key: "rule-1",
          level: "warning",
          targetClauseKey: "clause-1",
          requiredPhrases: ["原短语"],
          message: "新提示"
        }
      ]
    });
  });

  it("exposes template list columns and workflow actions", () => {
    expect(templateListColumns.map((column) => column.colKey)).toEqual([
      "name",
      "contractTypeKey",
      "status",
      "latestVersion",
      "publicationStatus",
      "operation"
    ]);
    expect(templateListActions).toEqual([
      "open",
      "clone",
      "submit",
      "publish",
      "stop",
      "revoke"
    ]);
  });

  it("supports only explicit field and bill options", () => {
    expect(contractTypeOptions.map((option) => option.label)).toContain("材料采购合同");
    const values = fieldTypeOptions.map((option) => option.value);
    expect(values).toEqual([
      "text",
      "long_text",
      "number",
      "money",
      "date",
      "single_select",
      "multi_select",
      "boolean"
    ]);
    expect((values as readonly string[]).includes("script")).toBe(false);
    expect((values as readonly string[]).includes("formula")).toBe(false);
    expect(billAmountRoleOptions.map((option) => option.value)).toEqual([
      "included",
      "reference",
      "non_priced",
      "provisional"
    ]);
    expect(pricingModeOptions.map((option) => option.value)).toEqual([
      "tax_inclusive",
      "tax_exclusive"
    ]);
  });

  it("uses shared scale ranges: quantity 0-6 and unit price fixed to two decimals", () => {
    expect(quantityScaleOptions).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(unitPriceScaleOptions).toEqual([2]);
  });

  it("does not expose direct edit for published template versions", () => {
    expect(businessTemplateVersionActionsByStatus.published).toEqual([
      "clone",
      "stop",
      "revoke"
    ]);
    expect(businessTemplateVersionActionsByStatus.published).not.toContain("edit");
  });

  it("selects the latest draft first and exposes status-driven actions", () => {
    const detail = normalizeContractTemplateDetail({
      template: {
        id: "template-1",
        code: "TPL-1",
        name: "材料采购模板",
        contractTypeKey: "material_purchase",
        status: "published"
      },
      versions: [
        {
          id: "version-3",
          templateId: "template-1",
          versionNo: 3,
          status: "submitted",
          schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] }
        },
        {
          id: "version-2",
          templateId: "template-1",
          versionNo: 2,
          status: "draft",
          schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] }
        },
        {
          id: "version-1",
          templateId: "template-1",
          versionNo: 1,
          status: "published",
          schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] }
        }
      ]
    });

    expect(detail.defaultVersionId).toBe("version-2");
    expect(contractTemplateVersionOptions(detail.versions).map((option) => option.label)).toEqual([
      "V3 · 待发布",
      "V2 · 草稿",
      "V1 · 已发布"
    ]);
    expect(contractTemplateVersionGovernance(detail.versions[1])).toMatchObject({
      readOnly: false,
      canSave: true,
      canSubmit: true,
      canPublish: false,
      canClone: false
    });
    expect(contractTemplateVersionGovernance(detail.versions[0])).toMatchObject({
      readOnly: true,
      canPublish: true
    });
    expect(contractTemplateVersionGovernance(detail.versions[2])).toMatchObject({
      readOnly: true,
      canClone: true
    });
  });

  it("falls back to the latest published version when no draft exists", () => {
    const detail = normalizeContractTemplateDetail({
      template: { id: "template-1", code: "TPL-1", name: "模板", contractTypeKey: "generic_contract", status: "published" },
      versions: [
        { id: "submitted-2", templateId: "template-1", versionNo: 2, status: "submitted", schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] } },
        { id: "published-1", templateId: "template-1", versionNo: 1, status: "published", schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] } }
      ]
    });

    expect(detail.defaultVersionId).toBe("published-1");
  });

  it.each([
    [{ template: {}, versions: [] }, "模板详情数据不完整，请刷新后重试"],
    [{ template: { id: "t", code: "T", name: "模板", contractTypeKey: "generic", status: "draft" }, versions: [{ id: "v", templateId: "t", versionNo: 1, status: "unknown", schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] } }] }, "模板版本状态不正确，请刷新后重试"],
    [{ template: { id: "t", code: "T", name: "模板", contractTypeKey: "generic", status: "draft" }, versions: [{ id: "v", templateId: "t", versionNo: 1, status: "draft", schema: { fields: [] } }] }, "模板版本数据不完整，请刷新后重试"],
    [{ template: { id: "t", code: "T", name: "模板", contractTypeKey: "generic", status: "draft" }, versions: [{ id: "v", templateId: "t", versionNo: 1, status: "draft", schema: { fields: [null], bills: [], clauses: [], attachments: [], validations: [] } }] }, "模板版本数据不完整，请刷新后重试"]
  ])("fails closed for invalid template detail: %p", (value, message) => {
    expect(() => normalizeContractTemplateDetail(value)).toThrow(message);
  });

  it("requires inspection success and latest preview PDF before layout publication", () => {
    expect(
      canPublishLayoutVersion({
        inspectionReport: { blockingErrors: [] },
        latestPreview: { status: "succeeded", previewPdfFileId: "file-1" }
      })
    ).toBe(true);
    expect(
      canPublishLayoutVersion({
        inspectionReport: { blockingErrors: ["missing placeholder"] },
        latestPreview: { status: "succeeded", previewPdfFileId: "file-1" }
      })
    ).toBe(false);
    expect(
      canPublishLayoutVersion({
        inspectionReport: { blockingErrors: [] },
        latestPreview: { status: "succeeded" }
      })
    ).toBe(false);
  });

  it("marks cooperation-unit edits as new immutable versions", () => {
    expect(businessPartyEditPolicy).toMatchObject({
      mode: "append_version",
      label: expect.stringContaining("新版本")
    });
  });

  it("allows only the supported contract-number placeholders", () => {
    expect(hasOnlyAllowedNumberRuleTokens("HT-{company}-{project}-{year}-{type}-{sequence}")).toBe(
      true
    );
    expect(hasOnlyAllowedNumberRuleTokens("合同-{公司}-{项目}-{年份}-{类型}-{流水号}")).toBe(true);
    expect(hasOnlyAllowedNumberRuleTokens("HT-{company}-{month}-{sequence}")).toBe(false);
    expect(isValidContractNumberPattern("HT-{year}-{sequence}")).toBe(true);
    expect(isValidContractNumberPattern("合同-{年份}-{流水号}")).toBe(true);
    expect(isValidContractNumberPattern("HT-{year}")).toBe(false);
    expect(normalizeContractNumberPattern("合同-{公司}-{流水号}")).toBe("合同-{company}-{sequence}");
    expect(displayContractNumberPattern("HT-{company}-{sequence}")).toBe("HT-{公司}-{流水号}");
  });
});
