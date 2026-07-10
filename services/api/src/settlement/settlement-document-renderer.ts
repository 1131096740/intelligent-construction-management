import { resolve } from "node:path";
import * as ExcelJS from "exceljs";
import PDFDocument = require("pdfkit");

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const SIGNATURE_ROWS_PER_PAGE = 12;

export interface SettlementApprovalSignatureRow {
  nodeName: string;
  roleName: string;
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
  finalCumulativeAmountCents?: bigint | null;
  payableAmountCents: bigint;
  previousEffectiveSettlementCents: bigint;
  isFinal: boolean;
  generatedAt: Date;
  approvalRows: SettlementApprovalSignatureRow[];
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
  sheet.pageSetup.printTitlesRow = "1:8";
  sheet.headerFooter.oddHeader = '&C&"Arial,Bold"&24草稿 DRAFT';
  sheet.views = [{ state: "frozen", ySplit: 8 }];
  sheet.columns = [
    { width: 8 },
    { width: 24 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 18 },
    { width: 32 }
  ];

  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "工程结算单";
  sheet.getCell("A1").font = { size: 18, bold: true };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.mergeCells("A2:G2");
  sheet.getCell("A2").value = "草稿 DRAFT";
  sheet.getCell("A2").font = { size: 22, bold: true, color: { argb: "FFBFBFBF" } };
  sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(2).height = 32;

  const infoRows = [
    ["项目名称", input.projectName, "结算编号", input.settlementCode, "结算期次", input.periodLabel, ""],
    ["合同名称", input.contractName, "合同编号", input.contractCode, "相对方", input.counterparty, ""],
    ["我方主体", input.companyEntityName, "结算类型", input.isFinal ? "最终结算" : "过程结算", "生成日期", formatDate(input.generatedAt), ""],
    ["状态", input.status, "", "", "", "", ""]
  ];
  for (const values of infoRows) {
    sheet.addRow(values);
  }

  sheet.addRow([]);
  sheet.addRow(["序号", "来源", "期前累计结算金额", "本期结算金额", "期后累计结算金额", "本期可付金额", "备注"]);
  const headerRow = sheet.getRow(8);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    cell.border = thinBorder();
  });

  settlementDocumentRows(input).forEach((row, index) => {
    const excelRow = sheet.addRow([
      index + 1,
      row.source,
      centsToYuanText(row.previousCumulativeCents),
      centsToYuanText(row.currentSettlementCents),
      centsToYuanText(row.afterCumulativeCents),
      centsToYuanText(row.payableAmountCents),
      row.remark
    ]);
    excelRow.eachCell((cell, columnNumber) => {
      cell.border = thinBorder();
      cell.alignment = {
        horizontal: columnNumber >= 3 && columnNumber <= 6 ? "right" : "center",
        vertical: "middle",
        wrapText: true
      };
    });
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
  const margin = 32;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
  });

  doc.registerFont("cn", FONT_PATH);
  doc.font("cn");

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  doc.fontSize(18).text("工程结算单", margin, margin, {
    width: contentWidth,
    align: "center"
  });
  doc.moveDown(0.5);

  let y = doc.y;
  const signaturePages = pdfSignatureBoardPages(input);
  const signatureBoardHeight = Math.max(
    ...signaturePages.map((page) => pdfSignatureBoardHeight(page.rows))
  );
  y = drawPdfTable(
    doc,
    margin,
    y,
    [
      ["项目名称", input.projectName, "结算编号", input.settlementCode],
      ["合同名称", input.contractName, "合同编号", input.contractCode],
      ["相对方", input.counterparty, "结算期次", input.periodLabel],
      ["我方主体", input.companyEntityName, "结算类型", input.isFinal ? "最终结算" : "过程结算"]
    ],
    [80, 260, 80, contentWidth - 420],
    24
  );

  y += 12;
  y = drawPdfTable(
    doc,
    margin,
    y,
    [
      ["序号", "来源", "期前累计结算金额", "本期结算金额", "期后累计结算金额", "本期可付金额", "备注"],
      ...settlementDocumentRows(input).map((row, index) => [
        String(index + 1),
        row.source,
        formatYuan(row.previousCumulativeCents),
        formatYuan(row.currentSettlementCents),
        formatYuan(row.afterCumulativeCents),
        formatYuan(row.payableAmountCents),
        row.remark
      ])
    ],
    [34, 98, 124, 118, 124, 110, contentWidth - 608],
    28,
    { bottomReserved: signatureBoardHeight + 12, repeatHeader: true }
  );

  if (y + signatureBoardHeight + 12 > doc.page.height - margin) {
    doc.addPage();
  }
  let range = doc.bufferedPageRange();
  while (range.count < signaturePages.length) {
    doc.addPage();
    range = doc.bufferedPageRange();
  }
  const signaturePageIndexes = settlementSignatureBoardPageIndexes(
    range.start,
    range.count,
    signaturePages.length
  );
  for (let offset = 0; offset < signaturePageIndexes.length; offset += 1) {
    const pageIndex = signaturePageIndexes[offset];
    doc.switchToPage(pageIndex);
    const signaturePage = signaturePages[offset];
    drawSignatureBoard(doc, margin, contentWidth, signaturePage.rows, signaturePage.images);
  }
  doc.flushPages();

  doc.end();
  return done;
}

function pdfSignatureBoardPages(input: SettlementDocumentInput) {
  const sourceRows = input.approvalRows.length
    ? input.approvalRows
    : [{ nodeName: "", roleName: "", approverName: "", comment: "", approvedAt: null }];
  const pages: Array<{ rows: string[][]; images: Array<Buffer | null | undefined> }> = [];

  for (let index = 0; index < sourceRows.length; index += SIGNATURE_ROWS_PER_PAGE) {
    const slice = sourceRows.slice(index, index + SIGNATURE_ROWS_PER_PAGE);
    pages.push({
      rows: slice.map((row) => [
        row.nodeName,
        row.roleName,
        row.approverName,
        row.comment,
        row.approvedAt ? formatDateTime(row.approvedAt) : "",
        row.approverName
      ]),
      images: slice.map((row) => row.signatureImage ?? null)
    });
  }

  return pages;
}

function pdfSignatureBoardHeight(rows: string[][]) {
  return 18 + (rows.length + 1) * 28;
}

function drawSignatureBoard(
  doc: PDFKit.PDFDocument,
  margin: number,
  contentWidth: number,
  rows: string[][],
  images: Array<Buffer | null | undefined>
) {
  const boardY = doc.page.height - margin - (pdfSignatureBoardHeight(rows) - 18);
  doc.fontSize(11).text("审批人员签字板块", margin, boardY - 18);
  drawPdfTable(
    doc,
    margin,
    boardY,
    [
      ["审批节点", "审批角色", "审批人姓名", "审批意见", "审批时间", "手写签名图/姓名"],
      ...rows
    ],
    [128, 140, 82, contentWidth - 128 - 140 - 82 - 116 - 120 - 100, 116, 100],
    28,
    {
      imageColumn: 5,
      rowImages: images
    }
  );
}

function drawPdfTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  rows: string[][],
  widths: number[],
  rowHeight: number,
  options: {
    bottomReserved?: number;
    imageColumn?: number;
    rowImages?: Array<Buffer | null | undefined>;
    repeatHeader?: boolean;
  } = {}
) {
  let currentY = y;
  const drawRow = (row: string[], rowIndex: number, dataIndex: number) => {
    let currentX = x;
    row.forEach((value, columnIndex) => {
      const width = widths[columnIndex] ?? widths.at(-1) ?? 80;
      doc.rect(currentX, currentY, width, rowHeight).stroke();
      if (rowIndex === 0) {
        doc.save().rect(currentX, currentY, width, rowHeight).fill("#edf2f7").restore();
        doc.rect(currentX, currentY, width, rowHeight).stroke();
      }
      const image =
        rowIndex !== 0 && columnIndex === options.imageColumn
          ? options.rowImages?.[dataIndex]
          : null;
      if (image) {
        try {
          doc.image(image, currentX + 4, currentY + 4, {
            fit: [width - 8, rowHeight - 8],
            align: "center",
            valign: "center"
          });
        } catch {
          doc.fontSize(8).text(value, currentX + 4, currentY + 6, {
            width: width - 8,
            height: rowHeight - 8,
            align: "center"
          });
        }
      } else {
        doc.fontSize(rowIndex === 0 ? 9 : 8).text(value, currentX + 4, currentY + 6, {
          width: width - 8,
          height: rowHeight - 8,
          align: columnIndex >= 2 && columnIndex <= 5 ? "right" : "center"
        });
      }
      currentX += width;
    });
    currentY += rowHeight;
  };

  rows.forEach((row, rowIndex) => {
    const pageBottom = doc.page.height - doc.page.margins.bottom - (options.bottomReserved ?? 0);
    if (currentY + rowHeight > pageBottom) {
      doc.addPage();
      currentY = doc.page.margins.top;
      if (rowIndex > 0 && options.repeatHeader) {
        drawRow(rows[0], 0, -1);
      }
    }
    drawRow(row, rowIndex, rowIndex - 1);
  });

  return currentY;
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

function formatYuan(amountCents: bigint) {
  return `${centsToYuanText(amountCents)} 元`;
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
