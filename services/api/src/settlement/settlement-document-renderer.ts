import { resolve } from "node:path";
import * as ExcelJS from "exceljs";
import { degrees, PDFDocument as PdfLibDocument } from "pdf-lib";
import PDFDocument = require("pdfkit");

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const PDF_LINE_ROWS_PER_PAGE = 9;
const PDF_TABLE_HEADERS = [
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
] as const;
export const SETTLEMENT_SIGNATURE_BOARD_LAYOUT = {
  margin: 24,
  boardTop: 470,
  boardHeight: 78,
  imageTopOffset: 18,
  imageHeight: 28,
  dateTopOffset: 61,
  dateHeight: 10
} as const;

export type SettlementDocumentContractType =
  | "material_purchase"
  | "equipment_rental"
  | "labor_subcontract"
  | "professional_subcontract";

export interface SettlementApprovalSignatureRow {
  nodeName: string;
  roleName: string;
  roleKey?: string | null;
  approverName: string;
  comment: string;
  approvedAt: Date | null;
  signatureImage?: Buffer | null;
}

export interface SettlementDocumentInput {
  settlementId: string;
  settlementCode: string;
  periodLabel: string;
  status: string;
  projectName: string;
  contractCode: string;
  contractName: string;
  counterparty: string;
  companyEntityName: string;
  amountCents: bigint;
  invoiceType: string;
  taxMode: string;
  defaultTaxRatePercent: string | null;
  taxFactRevision: number | null;
  finalCumulativeAmountCents?: bigint | null;
  payableAmountCents: bigint;
  previousEffectiveSettlementCents: bigint;
  isFinal: boolean;
  generatedAt: Date;
  documentRevision?: number | null;
  contractTypeKey?: SettlementDocumentContractType | null;
  fieldReviewerRoleKey?: "material_staff" | "engineering_foreman" | "engineering_tech" | null;
  lines: SettlementDocumentLine[];
  approvalRows: SettlementApprovalSignatureRow[];
}

export interface SettlementDocumentLine {
  sourceType: "contract_bill_row" | "visa_change" | "manual_adjustment";
  name: string;
  specification?: string | null;
  unit: string | null;
  quantity: string | null;
  taxInclusiveUnitPrice: string | null;
  taxExclusiveUnitPrice: string | null;
  taxRatePercent: string | null;
  taxInclusiveAmountCents: bigint;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
  remark: string | null;
}

export interface SettlementDocumentRow {
  source: string;
  previousCumulativeCents: bigint;
  currentSettlementCents: bigint;
  afterCumulativeCents: bigint;
  payableAmountCents: bigint;
  remark: string;
}

export function settlementDocumentRows(input: SettlementDocumentInput): SettlementDocumentRow[] {
  const previousCumulativeCents =
    input.previousEffectiveSettlementCents > 0n
      ? input.previousEffectiveSettlementCents
      : 0n;
  const finalCumulativeCents =
    input.finalCumulativeAmountCents ??
    (input.amountCents > previousCumulativeCents
      ? input.amountCents
      : previousCumulativeCents);
  const currentSettlementCents = input.isFinal
    ? input.finalCumulativeAmountCents == null
      ? input.amountCents - previousCumulativeCents > 0n
        ? input.amountCents - previousCumulativeCents
        : 0n
      : input.amountCents
    : input.amountCents;
  const afterCumulativeCents = input.isFinal
    ? input.finalCumulativeAmountCents == null
      ? previousCumulativeCents + currentSettlementCents
      : finalCumulativeCents
    : previousCumulativeCents + input.amountCents;

  return [
    {
      source: input.isFinal ? "最终结算" : input.periodLabel,
      previousCumulativeCents,
      currentSettlementCents,
      afterCumulativeCents,
      payableAmountCents: input.payableAmountCents,
      remark: input.isFinal
        ? "最终审定累计结算总额 - 前序已生效累计结算金额"
        : "本期结算金额"
    }
  ];
}

export function settlementSignatureBoardPageIndexes(
  rangeStart: number,
  rangeCount: number,
  signaturePageCount: number
): number[] {
  const pageCount = Math.max(Math.trunc(rangeCount), 0);
  const signatureCount = Math.min(Math.max(Math.trunc(signaturePageCount), 0), pageCount);
  const startPage = rangeStart + pageCount - signatureCount;

  return Array.from({ length: signatureCount }, (_, offset) => startPage + offset);
}

export async function renderSettlementDraftExcel(input: SettlementDocumentInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "建工智管";
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;

  const sheet = workbook.addWorksheet("结算单", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2
      }
    }
  });
  sheet.pageSetup.printTitlesRow = "1:9";
  sheet.headerFooter.oddHeader = '&C&"Arial,Bold"&24草稿 DRAFT';
  sheet.views = [{ state: "frozen", ySplit: 9 }];
  sheet.columns = [
    { width: 6 },
    { width: 12 },
    { width: 20 },
    { width: 7 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 8 },
    { width: 13 },
    { width: 13 },
    { width: 12 },
    { width: 24 }
  ];

  sheet.mergeCells("A1:L1");
  sheet.getCell("A1").value = "工程结算单";
  sheet.getCell("A1").font = { size: 18, bold: true };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.mergeCells("A2:L2");
  sheet.getCell("A2").value = "草稿 DRAFT";
  sheet.getCell("A2").font = { size: 22, bold: true, color: { argb: "FFBFBFBF" } };
  sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(2).height = 32;

  const infoRows = [
    ["项目名称", input.projectName, "", "结算编号", input.settlementCode, "", "结算期次", input.periodLabel, "", "", "", ""],
    ["合同名称", input.contractName, "", "合同编号", input.contractCode, "", "相对方", input.counterparty, "", "", "", ""],
    ["我方主体", input.companyEntityName, "", "结算类型", input.isFinal ? "最终结算" : "过程结算", "", "生成日期", formatDate(input.generatedAt), "", "", "", ""],
    ["状态", input.status, "", "", "", "", "", "", "", "", "", ""]
  ];
  for (const values of infoRows) {
    sheet.addRow(values);
  }

  sheet.addRow([
    "税务事实",
    "发票类型",
    input.invoiceType,
    "税率模式",
    input.taxMode,
    "默认税率",
    input.defaultTaxRatePercent ? `${input.defaultTaxRatePercent}%` : "—",
    "税务修订",
    input.taxFactRevision ?? "—",
    "",
    "",
    ""
  ]);
  sheet.addRow([]);
  sheet.addRow(["序号", "来源", "名称", "单位", "数量", "含税单价", "不含税单价", "税率", "含税金额", "不含税金额", "税额", "备注"]);
  const headerRow = sheet.getRow(9);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    cell.border = thinBorder();
  });

  input.lines.forEach((line, index) => {
    const manualAdjustment = line.sourceType === "manual_adjustment";
    const visaChange = line.sourceType === "visa_change";
    const excelRow = sheet.addRow([
      index + 1,
      manualAdjustment ? "人工调整" : visaChange ? "签证/变更" : "合同清单项",
      line.name,
      line.unit ?? "-",
      line.quantity ?? "-",
      line.taxInclusiveUnitPrice ?? "-",
      line.taxExclusiveUnitPrice ?? "-",
      line.taxRatePercent === null ? "-" : `${line.taxRatePercent}%`,
      centsToYuanText(line.taxInclusiveAmountCents),
      line.taxExclusiveAmountCents === null
        ? "-"
        : centsToYuanText(line.taxExclusiveAmountCents),
      line.taxAmountCents === null ? "-" : centsToYuanText(line.taxAmountCents),
      manualAdjustment
        ? `人工调整，不适用合同单价税额拆分${line.remark ? `；${line.remark}` : ""}`
        : line.remark ?? ""
    ]);
    excelRow.eachCell((cell, columnNumber) => {
      cell.border = thinBorder();
      cell.alignment = {
        horizontal:
          (columnNumber >= 5 && columnNumber <= 11) ? "right" : "center",
        vertical: "middle",
        wrapText: true
      };
    });
  });

  sheet.addRow([]);
  const summaryHeader = sheet.addRow([
    "来源",
    "期前累计结算金额",
    "本期结算金额",
    "期后累计结算金额",
    "本期可付金额",
    "备注"
  ]);
  summaryHeader.font = { bold: true };
  settlementDocumentRows(input).forEach((row) => {
    sheet.addRow([
      row.source,
      centsToYuanText(row.previousCumulativeCents),
      centsToYuanText(row.currentSettlementCents),
      centsToYuanText(row.afterCumulativeCents),
      centsToYuanText(row.payableAmountCents),
      row.remark
    ]);
  });
  sheet.addRow([]);
  const signTitle = sheet.addRow(["审批签字栏"]);
  signTitle.font = { bold: true };
  sheet.addRow(["审批节点", "审批角色", "审批人姓名", "审批意见", "审批时间", "手写签名/姓名", ""]);
  const signatureRows = input.approvalRows.length
    ? input.approvalRows
    : [{ nodeName: "", roleName: "", approverName: "", comment: "", approvedAt: null }];
  for (const row of signatureRows) {
    sheet.addRow([
      row.nodeName,
      row.roleName,
      row.approverName,
      row.comment,
      row.approvedAt ? formatDateTime(row.approvedAt) : "",
      row.approverName,
      ""
    ]);
  }

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: "middle", wrapText: true };
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function renderSettlementArchivePdf(input: SettlementDocumentInput): Promise<Buffer> {
  const margin = 24;
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin,
    autoFirstPage: false,
    compress: false
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
  });

  doc.registerFont("cn", FONT_PATH);
  const pages = settlementPdfPagePlan(input);
  pages.forEach((page) => drawSettlementPdfPage(doc, input, page, margin));

  doc.end();
  const rendered = await done;
  const normalized = await PdfLibDocument.load(rendered);
  for (const page of normalized.getPages()) {
    const { width, height } = page.getSize();
    page.setMediaBox(0, 0, width, height);
    page.setCropBox(0, 0, width, height);
    page.setRotation(degrees(0));
  }
  return Buffer.from(await normalized.save({ useObjectStreams: false }));
}

export interface SettlementPdfPagePlan {
  pageNumber: number;
  pageCount: number;
  settlementCode: string;
  revisionLabel: string;
  pageMarker: string;
  lineStartIndex: number;
  lines: SettlementDocumentLine[];
  tableHeaders: readonly string[];
  signatureRoleLabels: readonly string[];
}

export function settlementPdfPagePlan(input: SettlementDocumentInput): SettlementPdfPagePlan[] {
  const linePages: SettlementDocumentLine[][] = [];
  for (let index = 0; index < input.lines.length; index += PDF_LINE_ROWS_PER_PAGE) {
    linePages.push(input.lines.slice(index, index + PDF_LINE_ROWS_PER_PAGE));
  }
  if (!linePages.length) linePages.push([]);
  const signatureRoleLabels = settlementSignatureRoleSlots(input).map((slot) => slot.label);
  return linePages.map((lines, pageIndex) => ({
    pageNumber: pageIndex + 1,
    pageCount: linePages.length,
    settlementCode: input.settlementCode,
    revisionLabel: `R${input.documentRevision ?? 1}`,
    pageMarker: `第 ${pageIndex + 1}/${linePages.length} 页`,
    lineStartIndex: pageIndex * PDF_LINE_ROWS_PER_PAGE,
    lines,
    tableHeaders: PDF_TABLE_HEADERS,
    signatureRoleLabels
  }));
}

export function settlementSignatureRoleSlots(input: SettlementDocumentInput) {
  const contractType = input.contractTypeKey;
  const fieldRole = input.fieldReviewerRoleKey;
  const materialRoute =
    contractType === "material_purchase" ||
    contractType === "equipment_rental" ||
    fieldRole === "material_staff";
  const engineeringRoute =
    contractType === "labor_subcontract" ||
    contractType === "professional_subcontract" ||
    fieldRole === "engineering_foreman" ||
    fieldRole === "engineering_tech";
  if (materialRoute) {
    return [
      { key: "counterparty", label: "乙方" },
      { key: "preparer", label: "编制人" },
      { key: "material_staff", label: "物资员" },
      { key: "material_director", label: "物资主管" },
      { key: "contract_director", label: "合同部主管" },
      { key: "project_manager", label: "项目经理" },
      { key: "finance_director", label: "财务主管" }
    ] as const;
  }
  if (engineeringRoute) {
    const fieldLabel = fieldRole === "engineering_tech" ? "施工员" : "工长";
    return [
      { key: "counterparty", label: "乙方" },
      { key: "preparer", label: "编制人" },
      { key: fieldRole ?? "engineering_foreman", label: fieldLabel },
      { key: "engineering_director", label: "项目总工" },
      { key: "contract_director", label: "合同部主管" },
      { key: "project_manager", label: "项目经理" },
      { key: "finance_director", label: "财务主管" }
    ] as const;
  }
  return [
    { key: "counterparty", label: "乙方" },
    { key: "preparer", label: "编制人" },
    { key: "field_reviewer", label: "现场复核人" },
    { key: "route_supervisor", label: "业务主管" },
    { key: "contract_director", label: "合同部主管" },
    { key: "project_manager", label: "项目经理" },
    { key: "finance_director", label: "财务主管" }
  ] as const;
}

function drawSettlementPdfPage(
  doc: PDFKit.PDFDocument,
  input: SettlementDocumentInput,
  page: SettlementPdfPagePlan,
  margin: number
) {
  doc.addPage({ size: "A4", layout: "landscape", margin });
  doc.font("cn");
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  doc.fontSize(16).text("工程结算单", margin, 18, { width: contentWidth, align: "center" });
  doc.fontSize(7.5).fillColor("#334155").text(
    `结算编号：${page.settlementCode}    文件 revision：${page.revisionLabel}`,
    margin,
    44,
    { width: contentWidth / 2, align: "left" }
  );
  doc.text(page.pageMarker, margin + contentWidth / 2, 44, {
    width: contentWidth / 2,
    align: "right"
  });
  doc.fillColor("#111827");

  drawCompactInfoRows(doc, input, margin, 60, contentWidth);
  drawSettlementLineTable(doc, page, margin, 136, contentWidth);
  if (page.pageNumber === page.pageCount) {
    drawSettlementSummary(doc, input, margin, 408, contentWidth);
  }
  drawSingleRowSignatureBoard(doc, input, margin, contentWidth);
  doc.fontSize(6.5).fillColor("#475569").text(
    `生成日期：${formatDate(input.generatedAt)}  ·  本页表头及签名栏为冻结版式`,
    margin,
    558,
    { width: contentWidth, align: "center" }
  );
  doc.fillColor("#111827");
}

function drawCompactInfoRows(
  doc: PDFKit.PDFDocument,
  input: SettlementDocumentInput,
  x: number,
  y: number,
  contentWidth: number
) {
  const widths = [58, 210, 58, 150, 58, contentWidth - 534];
  drawFixedRow(doc, x, y, ["项目", input.projectName, "合同", input.contractName, "乙方", input.counterparty], widths, 21, [0, 2, 4]);
  drawFixedRow(doc, x, y + 21, ["我方主体", input.companyEntityName, "合同编号", input.contractCode, "结算期次", input.periodLabel], widths, 21, [0, 2, 4]);
  drawFixedRow(
    doc,
    x,
    y + 42,
    [
      "发票类型", input.invoiceType,
      "税率", input.defaultTaxRatePercent ? `${input.defaultTaxRatePercent}%` : "—",
      "税务事实", `修订 ${input.taxFactRevision ?? "—"} · ${input.taxMode}`
    ],
    widths,
    22,
    [0, 2, 4]
  );
}

function drawSettlementLineTable(
  doc: PDFKit.PDFDocument,
  page: SettlementPdfPagePlan,
  x: number,
  y: number,
  contentWidth: number
) {
  const widths = [26, 94, 84, 34, 48, 64, 64, 40, 70, 56, 70, contentWidth - 650];
  drawFixedRow(doc, x, y, [...PDF_TABLE_HEADERS], widths, 30, PDF_TABLE_HEADERS.map((_, index) => index), 6.5);
  page.lines.forEach((line, index) => {
    const manualAdjustment = line.sourceType === "manual_adjustment";
    const visaChange = line.sourceType === "visa_change";
    drawFixedRow(
      doc,
      x,
      y + 30 + index * 26,
      [
        String(page.lineStartIndex + index + 1),
        line.name,
        line.specification ?? "—",
        line.unit ?? "—",
        line.quantity ?? "—",
        line.taxExclusiveUnitPrice ?? "—",
        line.taxInclusiveUnitPrice ?? "—",
        line.taxRatePercent === null ? "—" : `${line.taxRatePercent}%`,
        line.taxExclusiveAmountCents === null ? "—" : centsToYuanText(line.taxExclusiveAmountCents),
        line.taxAmountCents === null ? "—" : centsToYuanText(line.taxAmountCents),
        centsToYuanText(line.taxInclusiveAmountCents),
        manualAdjustment
          ? `人工调整${line.remark ? `；${line.remark}` : ""}`
          : visaChange
            ? `签证/变更${line.remark ? `；${line.remark}` : ""}`
          : line.remark ?? ""
      ],
      widths,
      26,
      [],
      6.5,
      [0, 4, 5, 6, 7, 8, 9, 10]
    );
  });
}

function drawSettlementSummary(
  doc: PDFKit.PDFDocument,
  input: SettlementDocumentInput,
  x: number,
  y: number,
  contentWidth: number
) {
  const row = settlementDocumentRows(input)[0];
  const widths = [88, 118, 118, 118, 118, contentWidth - 560];
  drawFixedRow(doc, x, y, ["期前累计", "本期结算", "期后累计", "本期可付", "结算类型", "说明"], widths, 18, [0, 1, 2, 3, 4, 5], 6.5);
  drawFixedRow(
    doc,
    x,
    y + 18,
    [
      centsToYuanText(row.previousCumulativeCents),
      centsToYuanText(row.currentSettlementCents),
      centsToYuanText(row.afterCumulativeCents),
      centsToYuanText(row.payableAmountCents),
      row.source,
      row.remark
    ],
    widths,
    26,
    [],
    6.5,
    [0, 1, 2, 3]
  );
}

function drawSingleRowSignatureBoard(
  doc: PDFKit.PDFDocument,
  input: SettlementDocumentInput,
  margin: number,
  contentWidth: number
) {
  const boardY = SETTLEMENT_SIGNATURE_BOARD_LAYOUT.boardTop;
  const boardHeight = SETTLEMENT_SIGNATURE_BOARD_LAYOUT.boardHeight;
  const slots = settlementSignatureRoleSlots(input);
  const cellWidth = contentWidth / slots.length;
  slots.forEach((slot, index) => {
    const x = margin + index * cellWidth;
    const evidence = findSignatureEvidence(input.approvalRows, slot.key, slot.label);
    doc.rect(x, boardY, cellWidth, boardHeight).strokeColor("#64748b").lineWidth(0.6).stroke();
    doc.font("cn").fillColor("#111827").fontSize(8).text(slot.label, x + 3, boardY + 4, {
      width: cellWidth - 6,
      height: 12,
      align: "center"
    });
    if (evidence?.signatureImage) {
      try {
        doc.image(evidence.signatureImage, x + 8, boardY + SETTLEMENT_SIGNATURE_BOARD_LAYOUT.imageTopOffset, {
          fit: [cellWidth - 16, SETTLEMENT_SIGNATURE_BOARD_LAYOUT.imageHeight],
          align: "center",
          valign: "center"
        });
      } catch {
        drawSignatureFallback(doc, evidence.approverName, x, boardY, cellWidth);
      }
    } else {
      drawSignatureFallback(doc, evidence?.approverName ?? "", x, boardY, cellWidth);
    }
    doc.fontSize(6.5).fillColor("#334155").text(
      evidence?.approvedAt ? formatDate(evidence.approvedAt) : "日期：____-__-__",
      x + 3,
      boardY + SETTLEMENT_SIGNATURE_BOARD_LAYOUT.dateTopOffset,
      { width: cellWidth - 6, height: SETTLEMENT_SIGNATURE_BOARD_LAYOUT.dateHeight, align: "center" }
    );
  });
  doc.strokeColor("#000000").fillColor("#111827").lineWidth(1);
}

function drawSignatureFallback(
  doc: PDFKit.PDFDocument,
  name: string,
  x: number,
  y: number,
  width: number
) {
  doc.font("cn").fontSize(7).fillColor("#334155").text(name || "签名：________", x + 4, y + 32, {
    width: width - 8,
    height: 12,
    align: "center"
  });
}

function findSignatureEvidence(
  rows: SettlementApprovalSignatureRow[],
  roleKey: string,
  roleLabel: string
) {
  return rows.find((row) =>
    row.roleKey === roleKey ||
    row.roleName === roleLabel ||
    row.nodeName === roleLabel
  );
}

function drawFixedRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  values: string[],
  widths: number[],
  rowHeight: number,
  highlightedColumns: number[] = [],
  fontSize = 7.5,
  rightAlignedColumns: number[] = []
) {
  let currentX = x;
  values.forEach((value, index) => {
    const width = widths[index] ?? 0;
    if (highlightedColumns.includes(index)) {
      doc.save().rect(currentX, y, width, rowHeight).fill("#edf2f7").restore();
    }
    doc.rect(currentX, y, width, rowHeight).strokeColor("#94a3b8").lineWidth(0.5).stroke();
    doc.font("cn").fillColor("#111827").fontSize(fontSize).text(value, currentX + 3, y + 5, {
      width: width - 6,
      height: rowHeight - 8,
      align: rightAlignedColumns.includes(index) ? "right" : "center",
      ellipsis: true
    });
    currentX += width;
  });
  doc.strokeColor("#000000").lineWidth(1);
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" }
  };
}

function centsToYuanText(amountCents: bigint) {
  const negative = amountCents < 0n;
  const absolute = negative ? -amountCents : amountCents;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function formatDate(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatDateTime(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}
