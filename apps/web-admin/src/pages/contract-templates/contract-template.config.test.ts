import { describe, expect, it } from "vitest";
import {
  billAmountRoleOptions,
  businessPartyEditPolicy,
  businessTemplateVersionActionsByStatus,
  canPublishLayoutVersion,
  fieldTypeOptions,
  hasOnlyAllowedNumberRuleTokens,
  isValidContractNumberPattern,
  pricingModeOptions,
  quantityScaleOptions,
  templateListActions,
  templateListColumns,
  unitPriceScaleOptions
} from "./contract-template.config";

describe("contract template center config", () => {
  it("exposes template list columns and workflow actions", () => {
    expect(templateListColumns.map((column) => column.colKey)).toEqual([
      "status",
      "contractTypeKey",
      "latestVersion",
      "publishedBy",
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

  it("uses shared scale ranges: quantity 0-6 and unit price 2-6", () => {
    expect(quantityScaleOptions).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(unitPriceScaleOptions).toEqual([2, 3, 4, 5, 6]);
  });

  it("does not expose direct edit for published template versions", () => {
    expect(businessTemplateVersionActionsByStatus.published).toEqual([
      "clone",
      "stop",
      "revoke"
    ]);
    expect(businessTemplateVersionActionsByStatus.published).not.toContain("edit");
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
    expect(hasOnlyAllowedNumberRuleTokens("HT-{company}-{month}-{sequence}")).toBe(false);
    expect(isValidContractNumberPattern("HT-{year}-{sequence}")).toBe(true);
    expect(isValidContractNumberPattern("HT-{year}")).toBe(false);
  });
});
