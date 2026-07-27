import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_WORKBENCH_STEPS,
  FINAL_SETTLEMENT_CONFIRMATIONS,
  applyBatchRemark,
  applyImportedSettlementLines,
  applyTsvQuantityPaste,
  buildSettlementDraftLinePayload,
  buildSettlementLinePayload,
  canApplySettlementImportResponse,
  canApplySettlementPreviewResponse,
  restoreSettlementDraftLines,
  setSourceLineSelection,
  settlementQuantityProgress,
  settlementWorkbenchDraftFingerprint,
  settlementSignatureStateAfterLinkFailure,
  settlementSignatureNextAction,
  settlementSignatureStateAfterDraftRevision,
  validateFinalSettlementConfirmations,
  validateSettlementWorkbench,
  type ManualAdjustmentDraft,
  type SourceLineDraftMap
} from "./settlement-workbench.state";

describe("settlement workbench state", () => {
  it("keeps the governed settlement workflow in the required five-step order", () => {
    expect(SETTLEMENT_WORKBENCH_STEPS.map((step) => step.label)).toEqual([
      "录入结算事实",
      "选择现场复核人",
      "生成冻结结算单",
      "上传乙方签章扫描件",
      "提交审批"
    ]);
  });

  it("exposes exactly five structured confirmations for final settlement", () => {
    expect(FINAL_SETTLEMENT_CONFIRMATIONS.map((item) => item.key)).toEqual([
      "finalScopeCompleted",
      "finalPriorSettlementsIncluded",
      "finalNoOutstandingSettlements",
      "finalWithinContractCap",
      "finalNoFurtherOrdinarySettlements"
    ]);
    expect(validateFinalSettlementConfirmations(false, {})).toEqual([]);
    expect(validateFinalSettlementConfirmations(true, {})).toHaveLength(5);
    expect(
      validateFinalSettlementConfirmations(
        true,
        Object.fromEntries(FINAL_SETTLEMENT_CONFIRMATIONS.map((item) => [item.key, true]))
      )
    ).toEqual([]);
  });

  it("keeps a staged upload after failure but invalidates all revision-bound evidence after an edit", () => {
    const current = {
      draftId: "draft-1",
      revision: 3,
      reviewerUserId: "reviewer-1",
      frozenDocumentId: "frozen-3",
      frozenFileId: "file-frozen-3",
      stagedUploadedFileId: "uploaded-file",
      linkedOriginalDocumentId: "original-3"
    };

    expect(settlementSignatureNextAction(current)).toEqual({
      step: 5,
      label: "提交结算审批",
      reason: "当前修订版的参与人、冻结版和乙方签章扫描件均已就绪。"
    });
    expect(settlementSignatureStateAfterLinkFailure(current)).toEqual(current);
    expect(settlementSignatureStateAfterDraftRevision(current, 4)).toEqual({
      draftId: "draft-1",
      revision: 4,
      reviewerUserId: "reviewer-1",
      frozenDocumentId: "",
      frozenFileId: "",
      stagedUploadedFileId: "",
      linkedOriginalDocumentId: ""
    });
  });

  it("describes one precise next action without treating an uploaded file as linked evidence", () => {
    expect(settlementSignatureNextAction({
      draftId: "",
      revision: 0,
      reviewerUserId: "",
      frozenDocumentId: "",
      frozenFileId: "",
      stagedUploadedFileId: "",
      linkedOriginalDocumentId: ""
    }).label).toBe("先保存结算草稿");
    expect(settlementSignatureNextAction({
      draftId: "draft-1",
      revision: 1,
      reviewerUserId: "reviewer-1",
      frozenDocumentId: "frozen-1",
      frozenFileId: "file-1",
      stagedUploadedFileId: "uploaded-file",
      linkedOriginalDocumentId: ""
    }).label).toBe("确认关联乙方签章扫描件");
  });

  it("keeps source rows unselected by default and clears all current-period state on deselect", () => {
    const selected = setSourceLineSelection({}, "row-1", true);
    selected["row-1"] = { quantity: "2", amountYuan: "12.30", remark: "本期完成" };

    expect(setSourceLineSelection(selected, "row-1", false)).toEqual({});
  });

  it("builds payload from selected rows only and never submits a client total", () => {
    const rows = [normalRow(), manualRow(), normalRow({ id: "row-unselected" })];
    const drafts: SourceLineDraftMap = {
      "row-normal": { quantity: "2.5", amountYuan: "", remark: "一区" },
      "row-manual": { quantity: "1", amountYuan: "12.34", remark: "暂定价核对" }
    };
    const adjustments: ManualAdjustmentDraft[] = [
      {
        clientId: "adjustment-1",
        name: "质量扣款",
        amountYuan: "-1.25",
        reason: "现场签认",
        remark: ""
      }
    ];

    expect(buildSettlementLinePayload(rows, drafts, adjustments)).toEqual([
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-normal",
        quantity: "2.5",
        remark: "一区",
        sortOrder: 1
      },
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-manual",
        quantity: "1",
        amountCents: "1234",
        remark: "暂定价核对",
        sortOrder: 2
      },
      {
        sourceType: "manual_adjustment",
        name: "质量扣款",
        amountCents: "-125",
        reason: "现场签认",
        sortOrder: 3
      }
    ]);
    expect(JSON.stringify(buildSettlementLinePayload(rows, drafts, adjustments))).not.toContain(
      "row-unselected"
    );
  });

  it("saves and restores incomplete draft lines without creating a formal amount", () => {
    const rows = [normalRow(), manualRow()];
    const draftLines = buildSettlementDraftLinePayload(
      rows,
      {
        "row-normal": { quantity: "", amountYuan: "", remark: "待补数量" },
        "row-manual": { quantity: "1", amountYuan: "", remark: "待补金额" }
      },
      [
        {
          clientId: "adjustment-1",
          name: "",
          amountYuan: "",
          reason: "",
          remark: "待补调整依据"
        }
      ]
    );

    expect(draftLines).toEqual([
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-normal",
        remark: "待补数量",
        sortOrder: 1
      },
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-manual",
        quantity: "1",
        remark: "待补金额",
        sortOrder: 2
      },
      {
        sourceType: "manual_adjustment",
        remark: "待补调整依据",
        sortOrder: 3
      }
    ]);

    expect(restoreSettlementDraftLines(rows, draftLines)).toEqual({
      drafts: {
        "row-normal": { quantity: "", amountYuan: "", remark: "待补数量" },
        "row-manual": {
          quantity: "1",
          amountYuan: "",
          remark: "待补金额"
        }
      },
      adjustments: [
        {
          clientId: "draft-adjustment-1",
          name: "",
          amountYuan: "",
          reason: "",
          remark: "待补调整依据"
        }
      ]
    });
  });

  it("restores visa-change facts without collapsing them into a manual adjustment", () => {
    expect(restoreSettlementDraftLines([], [{
      sourceType: "visa_change",
      sourceItemType: "现场签证",
      occurredOn: "2026-07-27",
      name: "基础加深",
      description: "现场确认基础加深",
      pricingBasis: "签证单 QZ-001",
      quantity: "1.25",
      unitPriceCents: "101",
      remark: "待补附件"
    }])).toEqual({
      drafts: {},
      adjustments: [],
      visaChanges: [{
        clientId: "draft-visa-1",
        sourceItemType: "现场签证",
        occurredOn: "2026-07-27",
        name: "基础加深",
        description: "现场确认基础加深",
        pricingBasis: "签证单 QZ-001",
        quantity: "1.25",
        unitPriceYuan: "1.01",
        amountYuan: "",
        remark: "待补附件"
      }]
    });
  });

  it("validates normal, special and adjustment inputs with Chinese reasons", () => {
    expect(
      validateSettlementWorkbench({
        contractVersionId: "version-1",
        code: "JS-001",
        periodLabel: "2026-07",
        rows: [normalRow(), manualRow()],
        drafts: {
          "row-normal": { quantity: "-1", amountYuan: "", remark: "" },
          "row-manual": { quantity: "", amountYuan: "-2", remark: "" }
        },
        adjustments: [
          { clientId: "a-1", name: "扣款", amountYuan: "-1", reason: "", remark: "" }
        ]
      })
    ).toEqual([
      "合同清单项“钢筋”本期数量必须是非负数字，最多保留 2 位小数。",
      "合同清单项“暂定项目”本期金额必须是非负数字，最多保留两位小数。",
      "第 1 条人工调整必须填写原因。",
      "第 1 条负向人工调整必须关联原结算明细。"
    ]);
  });

  it("pastes TSV quantities across visible normal rows and selects only affected rows", () => {
    expect(
      applyTsvQuantityPaste([normalRow(), normalRow({ id: "row-2", itemName: "模板" })], {}, 0, "1.5\t忽略\n2.75")
    ).toEqual({
      "row-normal": { quantity: "1.5", amountYuan: "", remark: "忽略" },
      "row-2": { quantity: "2.75", amountYuan: "", remark: "" }
    });
  });

  it("applies a batch remark only to selected rows", () => {
    expect(
      applyBatchRemark(
        {
          "row-normal": { quantity: "1", amountYuan: "", remark: "旧" },
          "row-manual": { quantity: "", amountYuan: "2", remark: "" }
        },
        "  本期现场确认  "
      )
    ).toEqual({
      "row-normal": { quantity: "1", amountYuan: "", remark: "本期现场确认" },
      "row-manual": { quantity: "", amountYuan: "2", remark: "本期现场确认" }
    });
  });

  it("calculates quantity progress without Number precision loss", () => {
    expect(settlementQuantityProgress("9007199254740993.123456", "1.123456", "2.25")).toEqual({
      cumulative: "3.373456",
      remaining: "9007199254740989.75"
    });
    expect(settlementQuantityProgress("10", null, "1")).toEqual({
      cumulative: null,
      remaining: null
    });
    expect(settlementQuantityProgress("10", "2", "0")).toEqual({
      cumulative: "2",
      remaining: "8"
    });
    expect(settlementQuantityProgress(null, "1.5", "2.25")).toEqual({
      cumulative: "3.75",
      remaining: null
    });
  });

  it("accepts only the latest preview for the unchanged contract and payload", () => {
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-1", "hash", "hash")).toBe(true);
    expect(canApplySettlementPreviewResponse(1, 2, "v-1", "v-1", "hash", "hash")).toBe(false);
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-2", "hash", "hash")).toBe(false);
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-1", "old", "new")).toBe(false);
  });

  it("maps frozen imported lines back to selected drafts and signed adjustments exactly", () => {
    const result = applyImportedSettlementLines(
      [normalRow(), manualRow()],
      [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "row-normal",
          quantity: "2.50",
          remark: "现场完成"
        },
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "row-manual",
          amountCents: "123456",
          reason: "签认计价"
        },
        {
          sourceType: "manual_adjustment",
          name: "质量扣款",
          amountCents: "-125",
          reason: "现场复核",
          remark: "已确认"
        }
      ]
    );

    expect(result).toEqual({
      drafts: {
        "row-normal": { quantity: "2.50", amountYuan: "", remark: "现场完成" },
        "row-manual": {
          quantity: "",
          amountYuan: "1234.56",
          reason: "签认计价",
          remark: ""
        }
      },
      adjustments: [
        {
          clientId: "import-adjustment-1",
          name: "质量扣款",
          amountYuan: "-1.25",
          reason: "现场复核",
          remark: "已确认"
        }
      ]
    });
    expect(settlementWorkbenchDraftFingerprint(result.drafts, result.adjustments)).toContain(
      "质量扣款"
    );
  });

  it("preserves selected input while reporting a precise source fact blocker", () => {
    const blocked = normalRow({
      unitPrice: null,
      taxExclusiveUnitPrice: null,
      pricingFactStatus: "unconfirmed",
      calculationAvailable: false,
      submissionBlocker: {
        code: "missing_unit_price",
        message: "合同清单项“钢筋”的含税单价尚未确认，暂不能提交结算审批。请先补录并完成复核。",
        remedyPath: "/合同工作台/contract-1"
      }
    });
    const drafts = {
      "row-normal": { quantity: "2.25", amountYuan: "", remark: "本期实际量" }
    };

    expect(
      validateSettlementWorkbench({
        contractVersionId: "version-1",
        code: "JS-001",
        periodLabel: "2026-07",
        rows: [blocked],
        drafts,
        adjustments: []
      })
    ).toEqual([
      "合同清单项“钢筋”的含税单价尚未确认，暂不能提交结算审批。请先补录并完成复核。"
    ]);
    expect(buildSettlementLinePayload([blocked], drafts, [])).toEqual([
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-normal",
        quantity: "2.25",
        remark: "本期实际量",
        sortOrder: 1
      }
    ]);
  });

  it("rejects stale import responses and imported rows outside the selected contract", () => {
    expect(canApplySettlementImportResponse(2, 2, "v-1", "v-1", "i-1", "i-1")).toBe(true);
    expect(canApplySettlementImportResponse(1, 2, "v-1", "v-1", "i-1", "i-1")).toBe(false);
    expect(canApplySettlementImportResponse(2, 2, "v-1", "v-2", "i-1", "i-1")).toBe(false);
    expect(canApplySettlementImportResponse(2, 2, "v-1", "v-1", "i-1", "i-2")).toBe(false);
    expect(() =>
      applyImportedSettlementLines([normalRow()], [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "row-other",
          quantity: "1"
        }
      ])
    ).toThrow("导入结果中的合同清单已变化");
    expect(() =>
      applyImportedSettlementLines(
        [normalRow()],
        [{ sourceType: "unknown_import_source" } as never]
      )
    ).toThrow("导入结果中的明细来源不正确");
  });
});

function normalRow(overrides: Partial<SettlementSourceLineReadModel> = {}): SettlementSourceLineReadModel {
  return sourceRow({
    id: "row-normal",
    itemName: "钢筋",
    calculationMode: "normal_auto",
    ...overrides
  });
}

function manualRow(overrides: Partial<SettlementSourceLineReadModel> = {}): SettlementSourceLineReadModel {
  return sourceRow({
    id: "row-manual",
    itemName: "暂定项目",
    calculationMode: "manual_amount",
    provisional: true,
    ...overrides
  });
}

function sourceRow(overrides: Partial<SettlementSourceLineReadModel>): SettlementSourceLineReadModel {
  return {
    id: "row",
    billId: "bill-1",
    billKey: "main",
    billName: "主清单",
    rowKey: "1",
    sortOrder: 1,
    itemCode: "A-01",
    itemName: "清单项",
    specification: null,
    unit: "项",
    quantity: "10",
    unitPrice: "100",
    taxRatePercent: "0",
    taxExclusiveUnitPrice: "100",
    pricingFactStatus: "confirmed",
    calculationAvailable: true,
    submissionBlocker: null,
    amountRole: "included",
    pricingMode: "tax_inclusive",
    calculationMode: "normal_auto",
    contractAmountCents: "100000",
    settledQuantity: "1.5",
    previousSettledQuantity: "1.5",
    remainingQuantity: "8.5",
    settledAmountCents: "15000",
    remainingAmountCents: "85000",
    provisional: false,
    settlementBasis: null,
    exception: null,
    exceptions: [],
    ...overrides
  };
}
