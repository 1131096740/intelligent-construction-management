import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  applyBatchRemark,
  applyTsvQuantityPaste,
  buildSettlementLinePayload,
  canApplySettlementPreviewResponse,
  setSourceLineSelection,
  settlementQuantityProgress,
  validateSettlementWorkbench,
  type ManualAdjustmentDraft,
  type SourceLineDraftMap
} from "./settlement-workbench.state";

describe("settlement workbench state", () => {
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
      "合同清单项“钢筋”本期数量必须是非负数字，最多保留 6 位小数。",
      "合同清单项“暂定项目”本期金额必须是非负数字，最多保留两位小数。",
      "第 1 条人工调整必须填写原因。"
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
    expect(settlementQuantityProgress("9007199254740993.123456", "1.5", "2.25")).toEqual({
      cumulative: "3.75",
      remaining: "9007199254740989.373456"
    });
    expect(settlementQuantityProgress("10", null, "1")).toEqual({
      cumulative: null,
      remaining: null
    });
    expect(settlementQuantityProgress("10", "2", "0")).toEqual({
      cumulative: "2",
      remaining: "8"
    });
  });

  it("accepts only the latest preview for the unchanged contract and payload", () => {
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-1", "hash", "hash")).toBe(true);
    expect(canApplySettlementPreviewResponse(1, 2, "v-1", "v-1", "hash", "hash")).toBe(false);
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-2", "hash", "hash")).toBe(false);
    expect(canApplySettlementPreviewResponse(2, 2, "v-1", "v-1", "old", "new")).toBe(false);
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
