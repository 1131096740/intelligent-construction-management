import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { BadRequestException } from "@nestjs/common";
import { drawApprovalTable } from "../approval/approval-pdf-table";
import { watermarkApprovalPdf } from "../approval/approval-pdf-watermark";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

export const SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY =
  "spot_procurement_approval_original_v1";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

export type ApprovalSignature = {
  name: string | null;
  signedAt: Date | null;
  signature: Buffer | null;
};

export interface SpotApprovalRow { name: string; position: string; signedAt: string; comment: string; relationship: string; signature: Buffer | null; }

export type SpotProcurementApplicationFormInput = {
  approvals: SpotApprovalRow[];
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
  approvals: SpotApprovalRow[];
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
  businessDirectorLabel?: string;
  finalApproverLabel?: string;
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

export async function renderSpotProcurementApprovalForm(input: SpotProcurementApprovalFormInput): Promise<Buffer> {
  if (!input.approvals.length || input.approvals.some(row => !row.name || !row.position || !row.signedAt || !row.signature)) {
    throw new BadRequestException("实际签批记录及签名不完整，不能生成正式审批单");
  }
  const margin = 24;
  const doc = new PDFDocument({ size: input.kind === "application" ? "A4" : "A5", layout: input.kind === "application" ? "portrait" : "landscape", margin, bufferPages: true });
  doc.registerFont("cn", FONT_PATH).font("cn");
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const width = doc.page.width - 2 * margin;
  doc.fontSize(16).text(input.kind === "application" ? "零星材料采购申请单" : "零星材料付款审批单", margin, margin, { width, align: "center" });
  const summary = input.kind === "application" ? [
    ["单号", input.procurementCode], ["所属项目", input.projectName],
    ["申请人 / 部门", `${input.applicationName} / ${input.applicationDepartment}`],
    ["采购人 / 部门", `${input.purchaserName} / ${input.purchaserDepartment}`],
    ["要求到货日期", input.requestedArrivalAt.toISOString().slice(0, 10)], ["采购原因", input.reason]
  ] : [
    ["单号 / 项目", `${input.paymentCode} / ${input.projectName}`],
    ["付款公司 / 经办人", `${input.payerCompanyName} / ${input.handlerName}`],
    ["付款金额 / 方式", `${formatMoneyCentsAsYuan(input.amountCents)} 元 / ${input.paymentTypeLabel} / ${input.paymentMethodLabel}`],
    ["收款信息", input.primaryPaymentChannel], ["付款事由", input.reason]
  ];
  let y = drawApprovalTable(doc, margin, doc.y + 8, [{ header: "事项", width: 100 }, { header: "内容", width: width - 100 }], summary, { headerRow: false });
  if (input.kind === "application") {
    y = drawApprovalTable(doc, margin, y + 10,
      [{ header: "材料名称", width: 130 }, { header: "规格", width: 100 }, { header: "单位", width: 40 }, { header: "数量", width: 55 }, { header: "备注", width: width - 325 }],
      input.lines.map(line => [line.materialName, line.specification ?? "", line.unit, line.quantity, line.note ?? ""]));
  }
  drawApprovalTable(doc, margin, y + 10,
    [{ header: "实际岗位", width: 75 }, { header: "审批人", width: 65 }, { header: "签批时间", width: 88 }, { header: "意见 / 代批关系", width: width - 300 }, { header: "签名", width: 72 }],
    input.approvals.map(row => [row.position, row.name, row.signedAt, [row.relationship, row.comment].filter(Boolean).join("\n"), ""]),
    { minRowHeight: 32, imageColumn: 4, rowImages: input.approvals.map(row => row.signature) });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.fontSize(7).text(`第 ${i + 1} / ${range.count} 页`, margin, doc.page.height - 16, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  const buffer = await done;
  return input.watermark?.length ? watermarkApprovalPdf(buffer, input.watermark) : buffer;
}
