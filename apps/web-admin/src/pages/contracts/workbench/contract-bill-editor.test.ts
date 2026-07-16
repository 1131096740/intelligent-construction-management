import { describe, expect, it } from "vitest";
import {
  billRowValidationMessage,
  billTabs,
  canApplyImport,
  clauseDocumentText,
  clauseReadinessMessages,
  createUnsavedBillRow,
  documentsWithStaleFlag,
  documentWarnings,
  importPreviewErrors,
  importPreviewCounts,
  importPreviewRows,
  inheritedTaxRateText,
  normalizeClauseDocument,
  isUnsavedBillRow,
  selectedBillForDownload,
  updateRowPreservingKey,
  type WorkbenchBill
} from "./contract-bill-editor";

const bills: WorkbenchBill[] = [
  {
    id: "bill-1",
    billKey: "materials",
    name: "材料清单",
    revision: 1,
    rows: [{ rowKey: "row-1", itemName: "钢筋", unit: "吨" }]
  },
  {
    id: "bill-2",
    billKey: "transport",
    name: "运输费清单",
    revision: 1,
    rows: []
  }
];

describe("contract bill editor helpers", () => {
  it("creates a local blank row before any backend mutation", () => {
    const row = createUnsavedBillRow("test-1");

    expect(row).toEqual({
      rowKey: "local-new-test-1",
      itemName: "",
      specification: "",
      unit: "",
      quantity: "",
      unitPrice: "",
      taxRatePercent: "",
      taxRateSource: "version_default",
      customData: {}
    });
    expect(isUnsavedBillRow(row)).toBe(true);
    expect(isUnsavedBillRow(bills[0].rows[0])).toBe(false);
  });

  it("uses the contract tax rate for a new row and names the inherited rate", () => {
    const row = createUnsavedBillRow("tax-rate", "13");

    expect(row.taxRatePercent).toBe("13");
    expect(row.taxRateSource).toBe("version_default");
    expect(inheritedTaxRateText({
      ...bills[0],
      defaultTaxRatePercent: "13"
    })).toBe("继承合同税率（13%）");
  });

  it("rejects quantity and tax-inclusive unit-price precision above two decimals", () => {
    const bill = {
      ...bills[0],
      taxMode: "single_rate" as const,
      defaultTaxRatePercent: "13"
    };

    expect(
      billRowValidationMessage(
        {
          rowKey: "row-1",
          itemName: "钢筋",
          unit: "吨",
          quantity: "1.234",
          unitPrice: "3500.00",
          taxRateSource: "version_default"
        },
        bill
      )
    ).toBe("数量必须是最多保留 2 位小数的正数");
    expect(
      billRowValidationMessage(
        {
          rowKey: "row-1",
          itemName: "钢筋",
          unit: "吨",
          quantity: "1.23",
          unitPrice: "3500.001",
          taxRateSource: "version_default"
        },
        bill
      )
    ).toBe("含税单价必须是最多保留 2 位小数的正数");
  });

  it("allows blank estimated quantity only for unlimited framework contracts", () => {
    const row = {
      rowKey: "row-1",
      itemName: "机械台班",
      unit: "台班",
      quantity: "",
      unitPrice: "1200.00",
      taxRateSource: "version_default" as const
    };

    expect(
      billRowValidationMessage(row, {
        ...bills[0],
        pricingNature: "framework",
        amountLimitType: "unlimited",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13"
      })
    ).toBe("");
    expect(
      billRowValidationMessage(row, {
        ...bills[0],
        pricingNature: "unit_price",
        amountLimitType: "capped",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13"
      })
    ).toBe("请填写数量");
  });

  it("requires a valid exception tax rate only in multiple-rate mode", () => {
    const bill = {
      ...bills[0],
      taxMode: "multiple_rate" as const,
      defaultTaxRatePercent: "13"
    };
    const row = {
      rowKey: "row-1",
      itemName: "设备",
      unit: "台",
      quantity: "1",
      unitPrice: "100.00",
      taxRateSource: "row_override" as const,
      taxRatePercent: ""
    };

    expect(billRowValidationMessage(row, bill)).toBe("请填写例外税率");
    expect(billRowValidationMessage({ ...row, taxRatePercent: "9" }, bill)).toBe("");
  });

  it("preserves unchanged historical precision but rejects a new over-precision value", () => {
    const bill = {
      ...bills[0],
      taxMode: "single_rate" as const,
      defaultTaxRatePercent: "13"
    };
    const historicalRow = {
      rowKey: "legacy-row",
      itemName: "历史钢材",
      unit: "吨",
      quantity: "1.234",
      unitPrice: "3500.123",
      initialQuantity: "1.234",
      initialUnitPrice: "3500.123",
      precisionPolicy: "legacy",
      taxRateSource: "version_default" as const
    };

    expect(billRowValidationMessage(historicalRow, bill)).toBe("");
    expect(
      billRowValidationMessage({ ...historicalRow, quantity: "1.235" }, bill)
    ).toBe("数量必须是最多保留 2 位小数的正数");
    expect(
      billRowValidationMessage(
        { ...historicalRow, precisionPolicy: "two_decimal" },
        bill
      )
    ).toBe("数量必须是最多保留 2 位小数的正数");
  });

  it("shows one tab per configured bill", () => {
    expect(billTabs(bills)).toEqual([
      { label: "材料清单", value: "materials" },
      { label: "运输费清单", value: "transport" }
    ]);
  });

  it("edits rows without changing row keys", () => {
    const next = updateRowPreservingKey(bills[0].rows, "row-1", {
      rowKey: "attempted-change",
      itemName: "盘螺"
    });

    expect(next[0]).toMatchObject({ rowKey: "row-1", itemName: "盘螺" });
  });

  it("downloads the selected bill template", () => {
    expect(selectedBillForDownload(bills, "transport")?.id).toBe("bill-2");
  });

  it("shows import added, updated, removed, skipped, and error counts", () => {
    expect(
      importPreviewCounts({
        summary: {
          added: [{ rowKey: "new" }],
          updatedCount: 2,
          removed: ["old"],
          skippedCount: 3,
          errors: [{ row: 4, message: "数量为空" }]
        }
      })
    ).toEqual({ added: 1, updated: 2, removed: 1, skipped: 3, errors: 1 });
  });

  it("does not apply an import containing errors", () => {
    expect(canApplyImport({ errorCount: 1 })).toBe(false);
    expect(canApplyImport({ errorCount: 0 })).toBe(true);
  });

  it("reads import preview errors and changed rows for the preview dialog", () => {
    const preview = {
      summary: {
        errors: [{ row: 4, message: "数量为空" }],
        updated: [{ rowKey: "row-1", itemName: "钢筋" }]
      }
    };

    expect(importPreviewErrors(preview)).toEqual(["数量为空"]);
    expect(importPreviewRows(preview)).toEqual([{ rowKey: "row-1", itemName: "钢筋" }]);
  });

  it("marks generated documents stale after bill changes", () => {
    expect(
      documentsWithStaleFlag(
        [
          { id: "doc-1", status: "success", sourceRevision: 4 },
          { id: "doc-2", status: "success", sourceRevision: 5 }
        ],
        5
      )
    ).toEqual([
      { id: "doc-1", status: "success", sourceRevision: 4, stale: true },
      { id: "doc-2", status: "success", sourceRevision: 5, stale: false }
    ]);
  });

  it("keeps clause content in a constrained JSON document model", () => {
    const document = normalizeClauseDocument("付款条件");

    expect(document).toEqual({
      text: "付款条件",
      blocks: [{ type: "paragraph", text: "付款条件" }]
    });
    expect(
      clauseDocumentText({
        text: "",
        blocks: [
          { type: "paragraph", text: "质量要求", bold: true },
          { type: "list", items: ["提供合格证", "验收通过"] },
          { type: "table", rows: [["项目", "要求"], ["钢筋", "国标"]] }
        ]
      })
    ).toContain("钢筋 | 国标");
  });

  it("finds clause readiness messages from structured readiness snapshots", () => {
    expect(
      clauseReadinessMessages(
        {
          blocking: [{ key: "clause.payment", message: "付款条款不能为空" }],
          warnings: [{ key: "clause.quality.phrase", message: "质量条款缺少验收" }]
        },
        "payment"
      )
    ).toEqual([{ key: "clause.payment", message: "付款条款不能为空", level: "blocking" }]);
  });

  it("reads generated document warnings from document or input snapshot", () => {
    expect(
      documentWarnings({
        id: "doc-1",
        status: "success",
        sourceRevision: 1,
        warnings: [{ message: "附件已转 A4" }],
        inputSnapshot: { warnings: ["图片页较大"] }
      })
    ).toEqual(["附件已转 A4", "图片页较大"]);
  });
});
