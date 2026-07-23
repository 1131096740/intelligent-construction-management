import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { formatChineseUppercaseMoney } from "../contract-document/contract-docx-renderer";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

export type ExpenseClaimFinalPaymentPdfInput = {
  title?: string;
  footerText?: string;
  offsetLabel?: string;
  payableLabel?: string;
  paidLabel?: string;
  code: string;
  companyName: string;
  paymentSubjectName: string;
  projectName: string;
  applicantName: string;
  reason: string;
  requestedAmountCents: bigint;
  loanOffsetAmountCents: bigint;
  companyPayableAmountCents: bigint;
  paidAmountCents: bigint;
  payments: Array<{ paidAt: Date; paymentMethod: string; amountCents: bigint; note: string | null }>;
};

/** 最终付讫版独立于审批完成版，冻结实际公司补付事实，不覆盖审批 PDF。 */
export async function renderExpenseClaimFinalPaymentPdf(input: ExpenseClaimFinalPaymentPdfInput): Promise<Buffer> {
  const margin = 20;
  const doc = new PDFDocument({ size: "A5", layout: "landscape", margin });
  doc.registerFont("cn", FONT_PATH);
  doc.font("cn");
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise, rejectPromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", rejectPromise);
  });
  const width = doc.page.width - margin * 2;
  doc.fontSize(17).text(input.title ?? "费用报销付讫归档单", margin, 16, { width, align: "center" });
  let y = 44;
  y = row(doc, margin, y, [76, width - 76], 24, ["使用单位", input.companyName]);
  y = row(doc, margin, y, [76, width - 76], 24, ["实际付款主体", input.paymentSubjectName]);
  y = row(doc, margin, y, [64, 210, 64, width - 338], 24, ["单据编号", input.code, "项目", input.projectName || "非项目费用"]);
  y = row(doc, margin, y, [64, width - 64], 32, ["报销人 / 事由", `${input.applicantName}；${input.reason}`]);
  y = row(doc, margin, y, [64, 112, 64, 112, 64, width - 416], 24, [
    "申请金额", `￥${formatMoneyCentsAsYuan(input.requestedAmountCents)}`,
    input.offsetLabel ?? "借款冲销", `￥${formatMoneyCentsAsYuan(input.loanOffsetAmountCents)}`,
    input.payableLabel ?? "公司补付", `￥${formatMoneyCentsAsYuan(input.companyPayableAmountCents)}`
  ]);
  y = row(doc, margin, y, [64, 150, 52, width - 266], 24, [
    input.paidLabel ?? "实际补付", `￥${formatMoneyCentsAsYuan(input.paidAmountCents)}`,
    "大写", formatChineseUppercaseMoney(input.paidAmountCents)
  ]);
  y += 4;
  y = row(doc, margin, y, [74, 106, 106, width - 286], 20, ["付款日期", "付款方式", "实际金额", "备注"], true);
  for (const payment of input.payments) {
    y = row(doc, margin, y, [74, 106, 106, width - 286], 24, [
      formatDate(payment.paidAt),
      payment.paymentMethod,
      `￥${formatMoneyCentsAsYuan(payment.amountCents)}`,
      payment.note ?? ""
    ]);
  }
  doc.fontSize(7.5).text(input.footerText ?? "付讫归档版：仅在公司补付已全部登记后生成；付款事实、凭证与审批完成版均独立冻结，不得覆盖。", margin, Math.min(y + 5, doc.page.height - 18), { width });
  doc.end();
  return done;
}

function row(doc: PDFKit.PDFDocument, startX: number, startY: number, widths: number[], height: number, cells: string[], header = false) {
  let x = startX;
  for (const [index, cellWidth] of widths.entries()) {
    doc.rect(x, startY, cellWidth, height).lineWidth(0.6).strokeColor("#111").stroke();
    doc.fontSize(header ? 7.5 : 8.5).fillColor("#111").text(cells[index] ?? "", x + 3, startY + 4, { width: Math.max(cellWidth - 6, 1), height: Math.max(height - 6, 1), align: header ? "center" : "left" });
    x += cellWidth;
  }
  return startY + height;
}

function formatDate(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
