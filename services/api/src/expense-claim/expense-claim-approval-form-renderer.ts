import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { formatChineseUppercaseMoney } from "../contract-document/contract-docx-renderer";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

export type ExpenseClaimApprovalFormInput = {
  claimType: "reimbursement" | "loan" | "incidental_expense";
  incidentalExpenseCategory?: string | null;
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
  const title =
    input.claimType === "reimbursement"
      ? "费用报销单"
      : input.claimType === "incidental_expense"
        ? "零星费用支付申请单"
        : "借款申请单";
  const detailLines = input.claimType === "reimbursement" ? input.lines : [];
  const firstPageLines = detailLines.slice(0, 2);

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
    "审批完成版：签名、日期和意见均为审批动作当时冻结快照；后续付款或归档不改写本件。",
    margin,
    Math.min(y + 4, doc.page.height - 18),
    { width: contentWidth }
  );

  const overflow = detailLines.slice(2);
  const perPage = 10;
  for (let offset = 0; offset < overflow.length; offset += perPage) {
    const pageNumber = offset / perPage + 2;
    doc.addPage({ size: "A5", layout: "landscape", margin });
    doc.fontSize(14).text(`${title}（费用明细附页 ${pageNumber}）`, margin, 18, {
      width: contentWidth,
      align: "center"
    });
    let appendixY = 46;
    appendixY = row(doc, margin, appendixY, [82, contentWidth - 82], 20, ["关联单据", input.code]);
    appendixY = row(doc, margin, appendixY, [28, 72, 76, 170, 46, contentWidth - 392], 20, [
      "序", "日期", "类别", "用途", "票数", "金额"
    ], true);
    for (const line of overflow.slice(offset, offset + perPage)) {
      appendixY = row(doc, margin, appendixY, [28, 72, 76, 170, 46, contentWidth - 392], 26, [
        String(line.sortOrder),
        formatDate(line.occurredOn),
        line.expenseCategory,
        line.purpose,
        String(line.receiptCount),
        `￥${formatMoneyCentsAsYuan(line.amountCents)}`
      ]);
    }
    row(doc, margin, doc.page.height - margin - 13, [contentWidth], 13, [
      `第 ${pageNumber} 页（A5 横向附页）`
    ]);
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
  let x = startX;
  for (const [index, width] of widths.entries()) {
    doc.rect(x, startY, width, height).lineWidth(0.6).strokeColor("#111").stroke();
    doc.fontSize(header ? 7.5 : 8.5).fillColor("#111").text(cells[index] ?? "", x + 3, startY + 4, {
      width: Math.max(width - 6, 1),
      height: Math.max(height - 6, 1),
      align: header ? "center" : "left"
    });
    x += width;
  }
  return startY + height;
}

function drawApprovalRows(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  width: number,
  approvals: ExpenseClaimApprovalFormInput["approvals"]
) {
  let y = row(doc, startX, startY, [92, 92, width - 316, 132], 18, [
    "审批岗位", "审批人/日期", "审批意见", "真实手写签名"
  ], true);
  const rows = approvals.length ? approvals : [{
    name: "",
    position: "（无通过审批记录）",
    comment: "",
    signedAt: new Date(0),
    signature: null
  }];
  for (const approval of rows) {
    const height = 30;
    const widths = [92, 92, width - 316, 132];
    row(doc, startX, y, widths, height, [
      approval.position,
      approval.name + (approval.signedAt.getTime() ? `\\n${formatDate(approval.signedAt)}` : ""),
      approval.comment,
      ""
    ]);
    if (approval.signature) {
      try {
        doc.image(approval.signature, startX + width - 128, y + 4, { fit: [124, height - 8] });
      } catch {
        // 签名缓冲在业务层已做 PNG/JPEG 与摘要校验；这里不以姓名文字伪造签名。
      }
    }
    y += height;
  }
  return y;
}

function formatDate(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
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
