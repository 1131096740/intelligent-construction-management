import { describe, expect, it } from "vitest";
import {
  billTabs,
  canApplyImport,
  clauseDocumentText,
  clauseReadinessMessages,
  documentsWithStaleFlag,
  documentWarnings,
  importPreviewCounts,
  normalizeClauseDocument,
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
