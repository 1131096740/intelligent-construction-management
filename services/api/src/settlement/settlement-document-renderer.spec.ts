import * as ExcelJS from "exceljs";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import {
  renderSettlementArchivePdf,
  renderSettlementDraftExcel,
  settlementDocumentRows,
  settlementPdfPagePlan,
  settlementSignatureRoleSlots,
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
  documentRevision: 4,
  contractTypeKey: "material_purchase",
  fieldReviewerRoleKey: "material_staff",
  lines: [
    {
      sourceType: "contract_bill_row",
      name: "钢筋材料",
      specification: "HRB400 / Φ20",
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

  it("renders a formal settlement PDF with explicit A4 landscape MediaBox, CropBox and zero rotation", async () => {
    const buffer = await renderSettlementArchivePdf(baseInput);
    const pdf = await PdfLibDocument.load(buffer);
    const [page] = pdf.getPages();
    const { width, height } = page.getSize();
    const mediaBox = page.getMediaBox();
    const cropBox = page.getCropBox();

    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.getPageCount()).toBe(1);
    expect(width).toBeGreaterThan(height);
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
    expect(mediaBox).toEqual(cropBox);
    expect(page.getRotation().angle).toBe(0);
  });

  it("plans the exact repeated 12-column header, revision and material/mechanical signature row", () => {
    const [page] = settlementPdfPagePlan(baseInput);

    expect(page).toMatchObject({
      pageNumber: 1,
      pageCount: 1,
      settlementCode: "JS-2026-019",
      revisionLabel: "R4",
      pageMarker: "第 1/1 页"
    });
    expect(page?.tableHeaders).toEqual([
      "序号",
      "名称",
      "规格型号",
      "单位",
      "数量",
      "不含税单价",
      "含税单价",
      "税率",
      "不含税金额",
      "税额",
      "含税金额",
      "备注"
    ]);
    expect(page?.signatureRoleLabels).toEqual([
      "乙方",
      "编制人",
      "物资员",
      "物资主管",
      "合同部主管",
      "项目经理",
      "财务主管"
    ]);
  });

  it("keeps the nine-row boundary on one page and repeats the frozen structure after the boundary", async () => {
    const line = baseInput.lines[0]!;
    const boundaryInput = {
      ...baseInput,
      lines: Array.from({ length: 9 }, (_, index) => ({ ...line, name: `清单项${index + 1}` }))
    };
    expect(settlementPdfPagePlan(boundaryInput)).toHaveLength(1);

    const multiPageInput = {
      ...boundaryInput,
      lines: [...boundaryInput.lines, { ...line, name: "清单项10" }]
    };
    const plan = settlementPdfPagePlan(multiPageInput);
    expect(plan.map((page) => page.pageMarker)).toEqual(["第 1/2 页", "第 2/2 页"]);
    expect(plan.every((page) => page.tableHeaders.length === 12)).toBe(true);
    expect(plan.every((page) => page.signatureRoleLabels.length === 7)).toBe(true);

    const pdf = await PdfLibDocument.load(await renderSettlementArchivePdf(multiPageInput));
    expect(pdf.getPageCount()).toBe(2);
    for (const page of pdf.getPages()) {
      expect(Math.round(page.getMediaBox().width)).toBe(842);
      expect(Math.round(page.getMediaBox().height)).toBe(595);
      expect(page.getCropBox()).toEqual(page.getMediaBox());
      expect(page.getRotation().angle).toBe(0);
    }
  });

  it.each([
    ["engineering_foreman", "工长"],
    ["engineering_tech", "施工员"]
  ] as const)("uses the frozen labor/professional field role %s in the single seven-cell row", (fieldReviewerRoleKey, fieldLabel) => {
    const slots = settlementSignatureRoleSlots({
      ...baseInput,
      contractTypeKey: "professional_subcontract",
      fieldReviewerRoleKey
    });

    expect(slots.map((slot) => slot.label)).toEqual([
      "乙方",
      "编制人",
      fieldLabel,
      "项目总工",
      "合同部主管",
      "项目经理",
      "财务主管"
    ]);
  });

  it("maps signature board drawing to the buffered tail pages", () => {
    expect(settlementSignatureBoardPageIndexes(0, 5, 2)).toEqual([3, 4]);
    expect(settlementSignatureBoardPageIndexes(2, 3, 5)).toEqual([2, 3, 4]);
  });
});
