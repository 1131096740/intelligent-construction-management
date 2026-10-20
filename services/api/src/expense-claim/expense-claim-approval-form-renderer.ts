import { approvalDate as formatDate, approvalDateTime } from "../approval/approval-date";
import { BadRequestException } from "@nestjs/common";
import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { formatChineseUppercaseMoney } from "../contract-document/contract-docx-renderer";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

export type ExpenseClaimApprovalFormInput = {
  claimType: "reimbursement" | "loan" | "incidental_expense";
  incidentalExpenseCategory?: string | null;
  generalProcurementId?: string | null;
  code: string;
  companyName: string;
  projectName: string;
  applicantName: string;
  handlerName: string;
  submittedAt: Date | null;
  reason: string;
  requestedAmountCents: bigint;
  loanOffsetAmountCents: bigint;
  companyPayableAmountCents: bigint;
  paymentMethod: string | null;
  payeeName: string | null;
  loanExpectedClearanceAt: Date | null;
  lines: Array<{
    sortOrder: number;
    expenseCategory: string;
    occurredOn: Date;
    purpose: string;
    receiptCount: number;
    amountCents: bigint;
  }>;
  approvals: Array<{
    name: string;
    position: string;
    comment: string;
    signedAt: Date;
    signature: Buffer | null;
  }>;
  watermark?: string[];
};

/**
 * 费用报销、借款审批完成版的固定 A5 横向原件。
 *
 * 该渲染器只接受已冻结的业务快照和审批签名快照；付款/归档后续版本由
 * 对应领域服务另行追加，绝不覆盖此审批完成版。
 */
export async function renderExpenseClaimApprovalForm(
  input: ExpenseClaimApprovalFormInput
): Promise<Buffer> {
  const margin = 20;
  const doc = createDocument(margin);
  const done = collectPdf(doc);
  const contentWidth = doc.page.width - margin * 2;
  const title = input.generalProcurementId ? "综合采购付款申请单" :
    input.claimType === "reimbursement"
      ? "费用报销单"
      : input.claimType === "incidental_expense"
        ? "零星费用支付申请单"
        : "借款申请单";
  const detailLines = input.claimType === "reimbursement" ? input.lines : [];
  const firstPageLines = detailLines;

  doc.fontSize(17).text(title, margin, 16, { width: contentWidth, align: "center" });
  let y = 44;
  y = row(doc, margin, y, [78, contentWidth - 78], 24, ["使用单位", input.companyName]);
  y = row(doc, margin, y, [64, 210, 64, contentWidth - 338], 24, [
    "单据编号",
    input.code,
    "申请日期",
    input.submittedAt ? formatDate(input.submittedAt) : ""
  ]);
  y = row(doc, margin, y, [64, 150, 64, contentWidth - 278], 24, [
    "申请人",
    input.applicantName,
    "项目",
    input.projectName || "非项目"
  ]);
  y = row(doc, margin, y, [64, contentWidth - 64], 36, ["事由", input.reason]);
  if (input.claimType === "incidental_expense") {
    y = row(doc, margin, y, [64, contentWidth - 64], 24, [
      "费用分类",
      incidentalExpenseCategoryLabel(input.incidentalExpenseCategory)
    ]);
  }
  y = row(doc, margin, y, [64, 120, 52, 134, 64, contentWidth - 434], 24, [
    "申请金额",
    `￥${formatMoneyCentsAsYuan(input.requestedAmountCents)}`,
    "大写",
    formatChineseUppercaseMoney(input.requestedAmountCents),
    input.claimType !== "loan" ? "公司支付" : "预计清账",
    input.claimType !== "loan"
      ? `￥${formatMoneyCentsAsYuan(input.companyPayableAmountCents)}`
      : input.loanExpectedClearanceAt ? formatDate(input.loanExpectedClearanceAt) : ""
  ]);

  if (input.claimType === "reimbursement") {
    y = row(doc, margin, y, [28, 70, 72, 172, 44, contentWidth - 386], 20, [
      "序", "日期", "类别", "用途", "票数", "金额"
    ], true);
    const rows = firstPageLines.length ? firstPageLines : [{
      sortOrder: 1,
      occurredOn: new Date(0),
      expenseCategory: "",
      purpose: "（无费用明细）",
      receiptCount: 0,
      amountCents: 0n
    }];
    for (const line of rows) {
      y = row(doc, margin, y, [28, 70, 72, 172, 44, contentWidth - 386], 23, [
        String(line.sortOrder),
        line.occurredOn.getTime() ? formatDate(line.occurredOn) : "",
        line.expenseCategory,
        line.purpose,
        String(line.receiptCount),
        `￥${formatMoneyCentsAsYuan(line.amountCents)}`
      ]);
    }
  } else {
    y = row(doc, margin, y, [64, contentWidth - 64], 24, [
      "收款信息",
      [input.payeeName, input.paymentMethod].filter(Boolean).join("；")
    ]);
  }

  y += 3;
  y = drawApprovalRows(doc, margin, y, contentWidth, input.approvals);
  doc.fontSize(7.5).text(
    "最终审批通过后留存",
    margin,
    Math.min(y + 4, doc.page.height - 18),
    { width: contentWidth }
  );

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(7).text(`${input.code}  第 ${page + 1} / ${range.count} 页`, margin, doc.page.height - 17,
      { width: contentWidth, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }

  stampWatermark(doc, input.watermark);
  doc.end();
  return done;
}

function createDocument(margin: number) {
  const doc = new PDFDocument({ size: "A5", layout: "landscape", margin, bufferPages: true });
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

function row(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  widths: number[],
  height: number,
  cells: string[],
  header = false
) {
  const layout = fitRow(doc, widths, cells, height, header ? 7.5 : 8.5);
  const y = ensureSpace(doc, startY, layout.height);
  drawCells(doc, startX, y, widths, layout.height, cells, layout.fontSize, header);
  return y + layout.height;
}

function fitRow(doc: PDFKit.PDFDocument, widths: number[], cells: string[], minimum: number, preferredFont: number) {
  const available = doc.page.height - 85;
  for (let fontSize = preferredFont; fontSize >= 5; fontSize -= 0.5) {
    doc.fontSize(fontSize);
    const height = Math.max(minimum, ...widths.map((width, index) =>
      doc.heightOfString(cells[index] ?? "", { width: Math.max(1, width - 8) }) + 10));
    if (height <= available) return { height, fontSize };
  }
  throw new BadRequestException("单条审批意见或明细过长，无法在纸质页内完整保留，请调整内容后重试");
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, height: number) {
  if (y + height <= doc.page.height - 25) return y;
  doc.addPage({ size: "A5", layout: "landscape", margin: 20 });
  doc.font("cn").fontSize(10).text("单据续页", 20, 14, { lineBreak: false });
  return 36;
}

function drawCells(doc: PDFKit.PDFDocument, startX: number, y: number, widths: number[], height: number,
  cells: string[], fontSize: number, header = false) {
  let x = startX;
  for (const [index, width] of widths.entries()) {
    doc.rect(x, y, width, height).lineWidth(0.6).strokeColor("#111").stroke();
    doc.fontSize(fontSize).fillColor("#111").text(cells[index] ?? "", x + 4, y + 4, {
      width: Math.max(width - 8, 1), align: header ? "center" : "left"
    });
    x += width;
  }
}

function drawApprovalRows(doc: PDFKit.PDFDocument, startX: number, startY: number, width: number,
  approvals: ExpenseClaimApprovalFormInput["approvals"]) {
  if (!approvals.length || approvals.some(approval => !approval.signature || !approval.name.trim())) {
    throw new BadRequestException("实际签批记录或手写签名不完整，不能生成正式审批单");
  }
  const widths = [78, 98, width - 292, 116];
  const header = ["审批岗位", "审批人/时间", "审批意见", "手写签名"];
  let y = row(doc, startX, startY, widths, 18, header, true);
  for (const approval of approvals) {
    const cells = [approval.position, `${approval.name}\n${approvalDateTime(approval.signedAt)}`, approval.comment, ""];
    const layout = fitRow(doc, widths, cells, 34, 8);
    if (y + layout.height > doc.page.height - 25) {
      y = ensureSpace(doc, y, layout.height + 18);
      y = row(doc, startX, y, widths, 18, header, true);
    }
    drawCells(doc, startX, y, widths, layout.height, cells, layout.fontSize);
    try {
      doc.image(approval.signature!, startX + width - 112, y + 4, { fit: [108, Math.min(42, layout.height - 8)], align: "center", valign: "center" });
    } catch {
      throw new BadRequestException("审批签名图片无法解码，不能生成正式审批单");
    }
    y += layout.height;
  }
  return y;
}

function incidentalExpenseCategoryLabel(category: string | null | undefined) {
  if (category === "temporary_service") return "非材料临时服务";
  if (category === "temporary_machinery_shift") return "临时机械台班";
  if (category === "sporadic_labor") return "零星用工";
  if (category === "other_incidental") return "其他非材料临时费用";
  return "";
}

function stampWatermark(doc: PDFKit.PDFDocument, lines: string[] | undefined): void {
  const text = lines?.filter(Boolean).join("  ·  ");
  if (!text) return;
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("cn").fontSize(11).fillColor("#000000").fillOpacity(0.08);
    for (let x = -120; x < doc.page.width + 240; x += 250) {
      for (let y = 0; y < doc.page.height + 240; y += 92) {
        doc.text(text, x, y, { lineBreak: false });
      }
    }
    doc.restore();
    doc.fillOpacity(1).fillColor("#000");
  }
  doc.flushPages();
}
