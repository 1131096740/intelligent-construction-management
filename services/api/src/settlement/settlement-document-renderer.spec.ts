import * as ExcelJS from "exceljs";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import {
  renderSettlementArchivePdf,
  renderSettlementDraftExcel,
  settlementDocumentRows,
  settlementSignatureBoardPageIndexes,
  type SettlementDocumentInput
} from "./settlement-document-renderer";

const baseInput: SettlementDocumentInput = {
  settlementId: "settlement-1",
  settlementCode: "JS-2026-019",
  periodLabel: "2026-06",
  status: "approval_pending",
  projectName: "总部综合楼",
  contractCode: "HT-2026-009",
  contractName: "幕墙分包合同",
  counterparty: "上海示例劳务有限公司",
  companyEntityName: "建工智管工程有限公司",
  amountCents: 1_000_000n,
  invoiceType: "增值税专用发票",
  taxMode: "单一税率",
  defaultTaxRatePercent: "13",
  taxFactRevision: 3,
  payableAmountCents: 800_000n,
  previousEffectiveSettlementCents: 300_000n,
  isFinal: false,
  generatedAt: new Date("2026-07-03T00:00:00.000Z"),
  lines: [
    {
      sourceType: "contract_bill_row",
      name: "钢筋材料",
      unit: "吨",
      quantity: "1.23",
      taxInclusiveUnitPrice: "4.56",
      taxExclusiveUnitPrice: "4.04",
      taxRatePercent: "13",
      taxInclusiveAmountCents: 561n,
      taxExclusiveAmountCents: 496n,
      taxAmountCents: 65n,
      remark: "本期完成"
    },
    {
      sourceType: "manual_adjustment",
      name: "现场扣款",
      unit: null,
      quantity: null,
      taxInclusiveUnitPrice: null,
      taxExclusiveUnitPrice: null,
      taxRatePercent: null,
      taxInclusiveAmountCents: -100n,
      taxExclusiveAmountCents: null,
      taxAmountCents: null,
      remark: "现场确认"
    }
  ],
  approvalRows: [
    {
      nodeName: "合同部主管 + 预算部主管",
      roleName: "合同部主管、预算部主管",
      approverName: "张三",
      comment: "同意",
      approvedAt: new Date("2026-07-03T09:00:00.000Z")
    }
  ]
};

describe("settlement document renderer", () => {
  it("renders a draft Excel settlement sheet as A4 landscape with repeated headers and draft watermark", async () => {
    const buffer = await renderSettlementDraftExcel(baseInput);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const sheet = workbook.getWorksheet("结算单");
    expect(sheet).toBeDefined();
    expect(sheet?.pageSetup.orientation).toBe("landscape");
    expect(sheet?.pageSetup.paperSize).toBe(9);
    expect(sheet?.pageSetup.printTitlesRow).toBe("1:9");
    expect(sheet?.headerFooter.oddHeader).toContain("草稿 DRAFT");
    expect(sheet?.getCell("A1").value).toBe("工程结算单");
    expect(sheet?.getCell("A2").value).toBe("草稿 DRAFT");
    expect(sheet?.getRow(9).values).toEqual([
      undefined,
      "序号",
      "来源",
      "名称",
      "单位",
      "数量",
      "含税单价",
      "不含税单价",
      "税率",
      "含税金额",
      "不含税金额",
      "税额",
      "备注"
    ]);
    expect(sheet?.getRow(10).values).toEqual([
      undefined,
      1,
      "合同清单项",
      "钢筋材料",
      "吨",
      "1.23",
      "4.56",
      "4.04",
      "13%",
      "5.61",
      "4.96",
      "0.65",
      "本期完成"
    ]);
    expect(sheet?.getRow(11).values).toEqual([
      undefined,
      2,
      "人工调整",
      "现场扣款",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-1.00",
      "-",
      "-",
      "人工调整，不适用合同单价税额拆分；现场确认"
    ]);
  });

  it("uses the snapshotted final cumulative amount while keeping the current amount as the period delta", () => {
    const rows = settlementDocumentRows({
      ...baseInput,
      isFinal: true,
      amountCents: 300_000n,
      previousEffectiveSettlementCents: 900_000n,
      finalCumulativeAmountCents: 1_200_000n
    });

    expect(rows).toEqual([
      {
        source: "最终结算",
        previousCumulativeCents: 900_000n,
        currentSettlementCents: 300_000n,
        afterCumulativeCents: 1_200_000n,
        payableAmountCents: 800_000n,
        remark: "最终审定累计结算总额 - 前序已生效累计结算金额"
      }
    ]);
  });

  it("renders a formal settlement PDF on A4 landscape pages", async () => {
    const buffer = await renderSettlementArchivePdf(baseInput);
    const pdf = await PdfLibDocument.load(buffer);
    const [page] = pdf.getPages();
    const { width, height } = page.getSize();

    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(width).toBeGreaterThan(height);
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });

  it("paginates oversized approval signature boards instead of drawing one overflowing block", async () => {
    const buffer = await renderSettlementArchivePdf({
      ...baseInput,
      approvalRows: Array.from({ length: 34 }, (_, index) => ({
        nodeName: `节点${index + 1}`,
        roleName: "审批角色",
        approverName: `审批人${index + 1}`,
        comment: "同意",
        approvedAt: new Date("2026-07-03T09:00:00.000Z")
      }))
    });
    const pdf = await PdfLibDocument.load(buffer);

    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("maps signature board drawing to the buffered tail pages", () => {
    expect(settlementSignatureBoardPageIndexes(0, 5, 2)).toEqual([3, 4]);
    expect(settlementSignatureBoardPageIndexes(2, 3, 5)).toEqual([2, 3, 4]);
  });
});
