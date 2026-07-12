import { describe, expect, it } from "vitest";
import type { SettlementTemplateVersionReadModel } from "../../api/settlement-template.api";
import {
  blockedSettlementTemplateSelection,
  canApplySettlementTemplateRecommendation,
  resolveSettlementTemplateRecommendation,
  settlementTemplateFixedRules,
  settlementTemplateGovernance
} from "./settlement-template.state";

function version(
  overrides: Partial<SettlementTemplateVersionReadModel> = {}
): SettlementTemplateVersionReadModel {
  return {
    id: "version-1",
    settlementTemplateId: "template-1",
    versionNo: 1,
    status: "draft",
    draftRevision: 2,
    compatibleContractTypeKeys: [],
    compatibleAmountRoles: [],
    compatiblePricingModes: [],
    columnSchema: {},
    printRules: {},
    evidenceRules: {},
    anomalyRules: {},
    inspectionReport: null,
    inspectionRevision: null,
    hasSourceXlsx: true,
    hasPreviewXlsx: false,
    hasPreviewPdf: false,
    changeSummary: null,
    publishedAt: null,
    stoppedAt: null,
    latestPreview: null,
    ...overrides
  };
}

describe("settlement template governance state", () => {
  it("sends only print-rule keys accepted by the backend contract", () => {
    expect(settlementTemplateFixedRules.printRules).toEqual({ requirePrintArea: true });
    expect(settlementTemplateFixedRules.printRules).not.toHaveProperty("requireHandlerSignature");
    expect(settlementTemplateFixedRules.printRules).not.toHaveProperty("requireReviewerSignature");
  });

  it("requires the current clean inspection and both current previews before submission", () => {
    const ready = version({
      inspectionRevision: 2,
      inspectionReport: {
        sheetName: "本期结算明细",
        columns: [],
        missingColumns: [],
        duplicateColumns: [],
        hasPrintArea: true,
        handlerSignatureRow: 10,
        reviewerSignatureRow: 11,
        blockingErrors: [],
        warnings: []
      },
      latestPreview: {
        id: "preview-1",
        status: "succeeded",
        sourceRevision: 2,
        errorMessage: null,
        hasPreviewXlsx: true,
        hasPreviewPdf: true
      }
    });

    expect(settlementTemplateGovernance(ready)).toMatchObject({
      inspectionCurrent: true,
      previewCurrent: true,
      canSubmit: true
    });
    expect(settlementTemplateGovernance({ ...ready, draftRevision: 3 }).canSubmit).toBe(false);
    expect(
      settlementTemplateGovernance({
        ...ready,
        inspectionReport: { ...ready.inspectionReport!, blockingErrors: ["缺少签字区"] }
      }).canSubmit
    ).toBe(false);
  });

  it("maps one recommendation to automatic selection and many to explicit choice", () => {
    const choice = {
      templateVersionId: "version-1",
      templateName: "劳务月结模板",
      templateCode: "LABOR",
      versionNo: 3,
      reasons: ["合同类型匹配"]
    };

    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "automatic",
        selected: choice,
        choices: [choice]
      })
    ).toMatchObject({ mode: "automatic", selectedVersionId: "version-1" });
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "choice_required",
        selected: null,
        choices: [choice, { ...choice, templateVersionId: "version-2" }]
      })
    ).toMatchObject({ mode: "choice_required", selectedVersionId: "" });
    expect(blockedSettlementTemplateSelection("没有兼容模板")).toMatchObject({
      mode: "blocked",
      selectedVersionId: ""
    });
  });

  it("fails closed unless the response is an exact zero, one or many recommendation shape", () => {
    const choice = {
      templateVersionId: "version-1",
      templateName: "劳务月结模板",
      templateCode: "LABOR",
      versionNo: 3,
      reasons: ["合同类型匹配"]
    };
    const blocked = { mode: "blocked", selectedVersionId: "", choices: [] };

    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "choice_required",
        selected: null,
        choices: []
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "choice_required",
        selected: null,
        choices: [choice]
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "automatic",
        selected: choice,
        choices: [choice, { ...choice, templateVersionId: "version-2" }]
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "automatic",
        selected: { ...choice, templateVersionId: "not-a-choice" },
        choices: [choice]
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "choice_required",
        selected: null,
        choices: [choice, { ...choice }]
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "choice_required",
        selected: choice,
        choices: [choice, { ...choice, templateVersionId: "version-2" }]
      })
    ).toMatchObject(blocked);
    expect(
      resolveSettlementTemplateRecommendation({
        selectionMode: "automatic",
        selected: { ...choice, templateVersionId: " " },
        choices: [{ ...choice, templateVersionId: " " }]
      })
    ).toMatchObject(blocked);
    expect(resolveSettlementTemplateRecommendation(null)).toMatchObject(blocked);
  });

  it("rejects stale recommendation responses after project or contract switches", () => {
    expect(canApplySettlementTemplateRecommendation(2, 2, "p1", "p1", "c1", "c1")).toBe(true);
    expect(canApplySettlementTemplateRecommendation(1, 2, "p1", "p1", "c1", "c1")).toBe(false);
    expect(canApplySettlementTemplateRecommendation(2, 2, "p1", "p2", "c1", "c1")).toBe(false);
    expect(canApplySettlementTemplateRecommendation(2, 2, "p1", "p1", "c1", "c2")).toBe(false);
  });
});
