import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { formatChineseUppercaseMoney } from "../contract-document/contract-docx-renderer";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

export const SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY =
  "spot_procurement_approval_original_v1";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

export type ApprovalSignature = {
  name: string | null;
  signedAt: Date | null;
};

export type SpotProcurementApplicationFormInput = {
  kind: "application";
  projectName: string;
  procurementCode: string;
  applicationDepartment: string;
  applicationName: string;
  purchaserDepartment: string;
  purchaserName: string;
  requestedArrivalAt: Date;
  reason: string;
  lines: Array<{
    materialName: string;
    specification: string | null;
    unit: string;
    quantity: string;
    note: string | null;
  }>;
  signatures: {
    materialDirector: ApprovalSignature;
    projectManager: ApprovalSignature;
  };
  watermark?: string[];
};

export type SpotProcurementPaymentFormInput = {
  kind: "payment";
  projectName: string;
  paymentCode: string;
  submittedAt: Date;
  payerCompanyName: string;
  reason: string;
  amountCents: bigint;
  paymentTypeLabel: string;
  paymentMethodLabel: string;
  primaryPaymentChannel: string;
  handlerName: string;
  signatures: {
    comprehensiveDirector: ApprovalSignature;
    projectManager: ApprovalSignature;
    financeDirector: ApprovalSignature;
    finalApprover: ApprovalSignature;
  };
  watermark?: string[];
};

export type SpotProcurementApprovalFormInput =
  | SpotProcurementApplicationFormInput
  | SpotProcurementPaymentFormInput;

export async function renderSpotProcurementApprovalForm(
  input: SpotProcurementApprovalFormInput
): Promise<Buffer> {
  const buffer =
    input.kind === "application"
      ? await renderApplicationForm(input)
      : await renderPaymentForm(input);
  return buffer;
}

async function renderApplicationForm(
  input: SpotProcurementApplicationFormInput
): Promise<Buffer> {
  const margin = 32;
  const doc = createDocument("A4", "portrait", margin);
  const done = collectPdf(doc);
  const contentWidth = doc.page.width - margin * 2;

  doc.fontSize(20).text("零星/小额材料采购申请表", margin, 30, {
    width: contentWidth,
    align: "center"
  });
  doc.fontSize(9).text(
    `项目名称：${input.projectName}    系统申请单编号：${input.procurementCode}`,
    margin,
    58,
    { width: contentWidth, align: "center" }
  );

  let y = 78;
  const widths = [92, 160, 92, contentWidth - 344];
  y = drawGridRow(doc, margin, y, widths, 30, [
    "申请部门",
    input.applicationDepartment,
    "申请人",
    input.applicationName
  ]);
  y = drawGridRow(doc, margin, y, widths, 30, [
    "采购部门",
    input.purchaserDepartment,
    "采购人",
    input.purchaserName
  ]);
  y = drawGridRow(doc, margin, y, widths, 30, [
    "要求采购到位日期",
    formatDate(input.requestedArrivalAt),
    "采购编号",
    input.procurementCode
  ]);

  const materialColumns = [32, 150, 126, 54, 72, contentWidth - 434];
  y = drawGridRow(doc, margin, y, materialColumns, 25, [
    "序号",
    "名称",
    "型号",
    "单位",
    "数量",
    "备注"
  ], true);

  const pages = chunk(input.lines, 9);
  const linePages = pages.length ? pages : [[]];
  linePages.forEach((lines, pageIndex) => {
    if (pageIndex > 0) {
      doc.addPage({ size: "A4", layout: "portrait", margin });
      doc.fontSize(15).text("零星/小额材料采购申请表（材料明细续页）", margin, 30, {
        width: contentWidth,
        align: "center"
      });
      y = 58;
      y = drawGridRow(doc, margin, y, materialColumns, 25, [
        "序号",
        "名称",
        "型号",
        "单位",
        "数量",
        "备注"
      ], true);
    }
    lines.forEach((line, lineIndex) => {
      y = drawGridRow(doc, margin, y, materialColumns, 34, [
        String(pageIndex * 9 + lineIndex + 1),
        line.materialName,
        display(line.specification),
        line.unit,
        line.quantity,
        display(line.note)
      ]);
    });
  });

  y += 8;
  y = drawLabeledBox(doc, margin, y, contentWidth, 62, "物资用途及采购原因", input.reason);
  y = drawLabeledBox(
    doc,
    margin,
    y,
    contentWidth,
    74,
    "物资部部长意见",
    signatureText(input.signatures.materialDirector)
  );
  y = drawLabeledBox(
    doc,
    margin,
    y,
    contentWidth,
    74,
    "项目经理意见",
    signatureText(input.signatures.projectManager)
  );
  doc.fontSize(8).text(
    "注：物资部门必须填写《零星/小额材料采购申请表》得到审批后方可购买所需材料。",
    margin,
    y + 8,
    { width: contentWidth }
  );
  stampWatermark(doc, input.watermark);
  doc.end();
  return done;
}

async function renderPaymentForm(
  input: SpotProcurementPaymentFormInput
): Promise<Buffer> {
  const margin = 24;
  const doc = createDocument("A5", "landscape", margin);
  const done = collectPdf(doc);
  const contentWidth = doc.page.width - margin * 2;
  doc.fontSize(18).text("项目零星付款申请单", margin, 20, {
    width: contentWidth,
    align: "center"
  });

  let y = 52;
  const topWidths = [76, 296, 72, contentWidth - 444];
  y = drawGridRow(doc, margin, y, topWidths, 28, [
    "项目名称",
    input.projectName,
    "申请日期",
    formatDate(input.submittedAt)
  ]);
  y = drawGridRow(doc, margin, y, [76, contentWidth - 76], 28, [
    "付款主体",
    input.payerCompanyName
  ]);
  y = drawGridRow(doc, margin, y, [76, contentWidth - 76], 40, [
    "付款事由",
    input.reason
  ]);
  y = drawGridRow(doc, margin, y, [76, 130, 50, contentWidth - 256], 30, [
    "申请金额",
    `￥${formatMoneyCentsAsYuan(input.amountCents)} 元`,
    "大写",
    formatChineseUppercaseMoney(input.amountCents)
  ]);
  y = drawGridRow(doc, margin, y, [76, contentWidth - 76], 34, [
    "付款方式",
    `${input.paymentTypeLabel}；${input.paymentMethodLabel}`
  ]);
  y = drawGridRow(doc, margin, y, [76, contentWidth - 76], 58, [
    "对方账户信息",
    input.primaryPaymentChannel
  ]);

  const signatureWidths = [76, 198, 76, contentWidth - 350];
  y = drawGridRow(doc, margin, y, signatureWidths, 32, [
    "经办人",
    input.handlerName,
    "部门经理",
    signatureText(input.signatures.projectManager)
  ]);
  y = drawGridRow(doc, margin, y, signatureWidths, 32, [
    "综合部",
    signatureText(input.signatures.comprehensiveDirector),
    "财务部",
    signatureText(input.signatures.financeDirector)
  ]);
  drawGridRow(doc, margin, y, [132, contentWidth - 132], 44, [
    "董事长/总经理",
    signatureText(input.signatures.finalApprover)
  ]);

  stampWatermark(doc, input.watermark);
  doc.end();
  return done;
}

function createDocument(
  size: "A4" | "A5",
  layout: "portrait" | "landscape",
  margin: number
) {
  const doc = new PDFDocument({
    size,
    layout,
    margin,
    autoFirstPage: true,
    bufferPages: true
  });
  doc.registerFont("cn", FONT_PATH);
  doc.font("cn");
  return doc;
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", rejectPromise);
  });
}

function drawGridRow(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  widths: number[],
  height: number,
  cells: string[],
  header = false
) {
  let x = startX;
  doc.lineWidth(0.7).strokeColor("#111111");
  widths.forEach((width, index) => {
    doc.rect(x, startY, width, height).stroke();
    doc
      .fontSize(header ? 8.5 : 9)
      .fillColor("#111111")
      .text(cells[index] ?? "", x + 4, startY + 5, {
        width: Math.max(width - 8, 1),
        height: Math.max(height - 8, 1),
        align: header ? "center" : "left"
      });
    x += width;
  });
  return startY + height;
}

function drawLabeledBox(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  width: number,
  height: number,
  label: string,
  value: string
) {
  doc.lineWidth(0.7).strokeColor("#111111").rect(startX, startY, width, height).stroke();
  doc.fontSize(8.5).text(`${label}：`, startX + 4, startY + 5, {
    width: width - 8
  });
  doc.fontSize(9).text(value, startX + 6, startY + 22, {
    width: width - 12,
    height: height - 27
  });
  return startY + height;
}

function signatureText(signature: ApprovalSignature) {
  if (!signature.name) return "";
  return signature.signedAt
    ? `${signature.name}  ${formatDate(signature.signedAt)}`
    : signature.name;
}

function display(value: string | null | undefined) {
  return value?.trim() || "";
}

function formatDate(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}.${pad(value.getMonth() + 1)}.${pad(value.getDate())}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function stampWatermark(doc: PDFKit.PDFDocument, lines?: string[]) {
  const text = lines?.filter(Boolean).join("  ·  ");
  if (!text) return;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("cn").fontSize(9).fillColor("#000000").fillOpacity(0.08);
    for (let x = -120; x < doc.page.width + 200; x += 220) {
      for (let y = 0; y < doc.page.height + 200; y += 82) {
        doc.text(text, x, y, { lineBreak: false });
      }
    }
    doc.restore();
    doc.fillOpacity(1).fillColor("#111111");
  }
  doc.flushPages();
}
