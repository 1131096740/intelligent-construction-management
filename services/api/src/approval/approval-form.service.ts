import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { RoleKey } from "@jiangkong/shared-domain";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import { verifyApprovalSignatureSnapshot } from "./approval-signature-snapshot";
import { SpotProcurementAccessService } from "../spot-procurement/spot-procurement-access.service";
import {
  renderExpenseClaimApprovalForm,
  type ExpenseClaimApprovalFormInput
} from "../expense-claim/expense-claim-approval-form-renderer";
import {
  renderSpotProcurementApprovalForm,
  SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
  type ApprovalSignature,
  type SpotProcurementApprovalFormInput
} from "../spot-procurement/spot-procurement-form-renderer";

const APPROVAL_FORM_TEMPLATE_KEY = "approval_form";
const SPOT_PROCUREMENT_APPROVAL_TYPES = new Set([
  "spot_procurement_version",
  "spot_procurement_payment"
]);
const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const GENERATION_CLAIM_STALE_MS = 120_000;
const GENERATION_WAIT_ATTEMPTS = 30;
const GENERATION_WAIT_INTERVAL_MS = 100;

type ApprovalFormClient = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "approvalInstance"
  | "approvalActionLog"
  | "pdfDocument"
  | "paymentRequest"
  | "paymentTermsStage"
  | "project"
  | "settlement"
  | "contract"
  | "contractVersion"
  | "user"
  | "userPosition"
  | "projectMember"
  | "position"
  | "spotProcurement"
  | "spotProcurementVersion"
  | "spotProcurementLine"
  | "spotProcurementPayment"
  | "spotProcurementPaymentChannel"
  | "spotProcurementPaymentMethodOption"
  | "spotProcurementPaymentExecution"
  | "spotProcurementDiscrepancy"
  | "spotProcurementRefund"
  | "supplierBalanceEntry"
  | "fileObject"
  | "auditLog"
  | "expenseClaim"
  | "expenseClaimLine"
>;

interface ApprovalFormFreezeToken {
  approvalInstanceId: string;
  approvalInstanceUpdatedAt: string;
  latestActionLogId: string | null;
}

type SpotPaymentSettlementDiscrepancy = {
  id: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  actualCostCentsSnapshot: bigint;
  shortageAmountCents: bigint;
  canceledUnexecutedAmountCents: bigint;
  overpaidAmountCents: bigint;
  resolutionType: string | null;
  supplierBalanceEntryId: string | null;
  updatedAt: Date;
};

type SpotPaymentSettlementRefund = {
  id: string;
  discrepancyId: string;
  procurementId: string;
  amountCents: bigint;
  receivedAt: Date;
  refundMethod: string;
  voucherFileId: string;
};

type SpotPaymentSettlementBalanceEntry = {
  id: string;
  procurementId: string | null;
  entryType: string;
  availableDeltaCents: bigint;
  reservedDeltaCents: bigint;
};

type SpotPaymentSettlementFacts = {
  discrepancy: SpotPaymentSettlementDiscrepancy | null;
  refund: SpotPaymentSettlementRefund | null;
  supplierBalanceEntry:
    | SpotPaymentSettlementBalanceEntry
    | null;
};

// 审批路线节点（与各业务 service 的 frozenNodes 形态一致：name/mode/roleKeys）
interface FrozenNode {
  name: string;
  mode: string;
  roleKeys: RoleKey[];
}

interface FrozenApprovalRelationship {
  kind: "transfer" | "delegate";
  fromUserId: string;
  toUserId: string;
  fromRoleKey: string;
}

const ROLE_LABELS: Record<string, string> = {
  chairman: "董事长",
  general_manager: "总经理",
  project_manager: "项目经理",
  contract_director: "合同部主管",
  contract_staff: "合同员",
  budget_director: "预算部主管",
  budget_staff: "预算员",
  finance_director: "财务主管",
  finance_staff: "财务员",
  material_director: "物资主管",
  material_staff: "物资员",
  engineering_director: "工程部主管",
  engineering_foreman: "施工队长",
  engineering_tech: "技术员",
  comprehensive_director: "综合部主管",
  employee: "员工",
  super_admin: "系统管理员"
};

const ACTION_LABELS: Record<string, string> = {
  submit: "提交",
  approve: "通过",
  reject: "驳回",
  reject_previous: "退回上一节点",
  return_to_applicant: "退回申请人",
  withdraw: "撤回",
  void: "作废",
  transfer: "转交",
  delegate: "委托",
  remind: "催办",
  node_skipped: "自动跳过"
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  contract_version: "合同审批单",
  settlement: "结算审批单",
  payment_request: "项目付款审批表",
  spot_procurement_version: "项目零星材料采购申请单",
  spot_procurement_payment: "项目零星材料付款审批单",
  expense_claim: "费用申请审批单"
};

const roleLabel = (key: string) => ROLE_LABELS[key] ?? key;
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

function frozenApprovalRelationship(
  action: string,
  metadata: unknown
): FrozenApprovalRelationship | null {
  if (action !== "transfer" && action !== "delegate") return null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (
    record.kind !== action ||
    typeof record.fromUserId !== "string" ||
    !record.fromUserId ||
    typeof record.toUserId !== "string" ||
    !record.toUserId ||
    typeof record.fromRoleKey !== "string" ||
    !record.fromRoleKey
  ) {
    return null;
  }
  return {
    kind: action,
    fromUserId: record.fromUserId,
    toUserId: record.toUserId,
    fromRoleKey: record.fromRoleKey
  };
}

function formatDateTime(value: Date): string {
  // 本地化为 YYYY-MM-DD HH:mm:ss，避免依赖运行环境 locale
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// 分 -> 「1,234.56 元」，不依赖运行环境 locale。
function formatYuan(cents: bigint): string {
  return `${formatMoneyCentsAsYuan(dbMoneyToBigInt(cents, "审批金额"))} 元`;
}

interface TableColumn {
  header: string;
  width: number;
}

interface RenderInput {
  businessType: string;
  title: string;
  companyName: string;
  businessCode: string;
  applicantName: string;
  summary: Array<{ label: string; value: string }>;
  nodes: FrozenNode[];
  logs: Array<{
    actionKey?: string;
    approvedRoleKey: string | null;
    name: string;
    position: string;
    action: string;
    signedAt: string;
    comment: string;
    relationship: string;
    signature: Buffer | null;
    createdAt: Date;
  }>;
  watermark?: string[];
  expenseClaim?: Omit<ExpenseClaimApprovalFormInput, "code" | "companyName" | "applicantName" | "watermark">;
}

interface ProjectPaymentApprovalRowsInput {
  payment: {
    sourceType?: string | null;
    paymentTermsStageId?: string | null;
    requestedAmountCents: bigint;
    approvedAmountCents?: bigint | null;
    createdAt?: Date | null;
    dueDate?: Date | null;
  };
  applicantName: string;
  companyName: string;
  projectName?: string | null;
  contract?: {
    code?: string | null;
    name?: string | null;
    counterparty?: string | null;
    companyEntityName?: string | null;
  } | null;
  settlement?: {
    code?: string | null;
    periodLabel?: string | null;
  } | null;
  contractAmountCents?: bigint | null;
  cumulativeSettledCents?: bigint | null;
  cumulativePaidCents?: bigint | null;
  paymentTermsStageName?: string | null;
}

type ApprovalFormRow = { label: string; value: string };

const empty = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
};

function isFrozenContractStagePayment(input: ProjectPaymentApprovalRowsInput): boolean {
  return input.payment.sourceType === "contract_due" && Boolean(input.payment.paymentTermsStageId);
}

function sourceTypeLabel(input: ProjectPaymentApprovalRowsInput): string {
  const sourceType = input.payment.sourceType;
  if (sourceType === "contract_advance") return "合同预付款";
  if (isFrozenContractStagePayment(input)) return "合同冻结阶段直接付款";
  if (sourceType === "contract_due") return "合同累计付款";
  return "结算付款";
}

function paymentReason(input: ProjectPaymentApprovalRowsInput): string {
  if (input.payment.sourceType === "contract_advance") {
    return `${empty(input.contract?.name)}合同预付款`;
  }
  if (input.payment.sourceType === "contract_due") {
    if (isFrozenContractStagePayment(input)) {
      return `${empty(input.contract?.name)}·${empty(input.paymentTermsStageName)}直接付款`;
    }
    return `${empty(input.contract?.name)}合同累计付款`;
  }
  const period = input.settlement?.periodLabel;
  const code = input.settlement?.code;
  if (period && code) return `${period} 结算付款（${code}）`;
  if (code) return `结算付款（${code}）`;
  return `${empty(input.contract?.name)}结算付款`;
}

function formatOptionalYuan(cents?: bigint | null): string {
  return cents == null ? "—" : formatYuan(cents);
}

function decimalText(value: unknown): string {
  if (value && typeof value === "object" && "toString" in value) {
    return String((value as { toString(): string }).toString());
  }
  return String(value ?? "—");
}

function paymentMethodLabel(value?: string | null): string {
  if (value === "bank_transfer") return "银行转账";
  if (value === "cash") return "现金";
  return value?.trim() || "未读取";
}

function spotPaymentBusinessStatusLabel(value?: string | null): string {
  if (value === "draft") return "草稿";
  if (value === "approval_pending") return "审批中";
  if (value === "approved_pending_payment") return "已审批待付款";
  if (value === "partially_paid") return "部分已付款";
  if (value === "paid") return "已付款";
  if (value === "settled") return "已结清";
  if (value === "returned") return "已退回";
  if (value === "rejected") return "已驳回";
  if (value === "withdrawn") return "已撤回";
  if (value === "voided") return "已作废";
  if (value === "invalidated") return "已失效";
  return "状态未读取";
}

function spotDiscrepancyStatusLabel(value: string): string {
  if (value === "pending_resolution") return "待物资主管确认";
  if (value === "awaiting_refund") return "待退款到账";
  if (value === "awaiting_supplier_balance")
    return "待转入供应商余额";
  if (value === "resolved") return "已解决";
  return "差异状态未读取";
}

function spotDiscrepancyResolutionLabel(
  value: string | null
): string {
  if (value === "full_refund") return "整笔退款";
  if (value === "full_supplier_balance")
    return "整笔转供应商余额";
  return "无需处理真实多付";
}

function spotPaymentExecutionFactLabel(
  actualPaidCents: bigint,
  companyPayableCents: bigint
): string {
  if (companyPayableCents <= 0n) return "无需公司付款";
  if (actualPaidCents <= 0n) return "未付款";
  if (actualPaidCents < companyPayableCents) return "部分已付";
  return "已付款";
}

function safeRefreshErrorType(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}

export function buildProjectPaymentApprovalRows(
  input: ProjectPaymentApprovalRowsInput
): ApprovalFormRow[] {
  const companyName = input.companyName || input.contract?.companyEntityName || "";
  const frozenContractStagePayment = isFrozenContractStagePayment(input);

  return [
    { label: "项目名称", value: empty(input.projectName) },
    { label: "申请日期", value: input.payment.createdAt ? formatDate(input.payment.createdAt) : "—" },
    { label: "付款主体", value: empty(companyName) },
    { label: "经办人", value: empty(input.applicantName) },
    { label: "付款事由", value: paymentReason(input) },
    { label: "计划付款日期", value: input.payment.dueDate ? formatDate(input.payment.dueDate) : "—" },
    { label: "合同名称", value: empty(input.contract?.name) },
    { label: "合同编号", value: empty(input.contract?.code) },
    { label: "付款方式", value: "网银转账" },
    { label: "付款类型", value: sourceTypeLabel(input) },
    { label: "合同金额", value: formatOptionalYuan(input.contractAmountCents) },
    frozenContractStagePayment
      ? { label: "合同冻结付款阶段", value: empty(input.paymentTermsStageName) }
      : { label: "累计生效结算金额", value: formatOptionalYuan(input.cumulativeSettledCents) },
    { label: "累计已付款", value: formatOptionalYuan(input.cumulativePaidCents) },
    { label: "发票类型提醒", value: "按合同约定提交" },
    { label: "本次付款金额", value: formatYuan(input.payment.requestedAmountCents) },
    { label: "收款方名称", value: empty(input.contract?.counterparty) },
    { label: "开户银行", value: "—" },
    { label: "银行账号", value: "—" },
    { label: "转款手续费", value: "—" },
    { label: "备注", value: "付款申请创建时已完成可付款额度校验" }
  ];
}

function sumCents(rows: Array<{ amountCents?: bigint; paidAmountCents?: bigint }>) {
  return rows.reduce<bigint>((total, row) => {
    const value = row.amountCents ?? row.paidAmountCents ?? 0n;
    return total + dbMoneyToBigInt(value, "审批金额");
  }, 0n);
}

function approvalFileName(input: Pick<RenderInput, "title" | "businessCode">): string {
  const prefix = input.title.startsWith("项目零星材料")
    ? input.title
    : input.title === "项目付款审批表"
      ? "项目付款审批表"
      : "审批单";
  return `${prefix}-${input.businessCode}.pdf`;
}

function spotProcurementApprovalFileName(
  input: SpotProcurementApprovalFormInput
): string {
  return input.kind === "application"
    ? `零星小额材料采购申请表-${input.procurementCode}.pdf`
    : `项目零星付款申请单-${input.paymentCode}.pdf`;
}

function spotProcurementApprovalBusinessCode(
  input: SpotProcurementApprovalFormInput
): string {
  return input.kind === "application" ? input.procurementCode : input.paymentCode;
}

function approvalSignatureForRoles(
  logs: RenderInput["logs"],
  roleKeys: string[]
): ApprovalSignature {
  const log = logs.find(
    (candidate) =>
      candidate.actionKey === "approve" &&
      typeof candidate.approvedRoleKey === "string" &&
      roleKeys.includes(candidate.approvedRoleKey)
  );
  return {
    name: log?.name ?? null,
    signedAt: log ? new Date(log.signedAt) : null,
    signature: log?.signature ?? null
  };
}

function currentSpotPaymentApprovalRoundLogs(
  logs: RenderInput["logs"]
): RenderInput["logs"] {
  let boundaryIndex = -1;
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index]?.actionKey === "payer_changed_reapproval") {
      boundaryIndex = index;
      break;
    }
  }
  return boundaryIndex < 0 ? logs : logs.slice(boundaryIndex + 1);
}

function spotPaymentTypeLabel(value: string | null): string {
  if (value === "company_direct") return "公司直付";
  if (value === "handler_reimbursement") return "经办人垫付报回";
  return "未选择";
}

function spotPaymentMethodLabel(value: string | null): string {
  const labels: Record<string, string> = {
    cash: "现金",
    wechat: "微信",
    alipay: "支付宝",
    bank_transfer: "网银转账",
    other: "其他"
  };
  return value ? labels[value] ?? "付款方式未读取" : "未选择";
}

function spotPaymentChannelText(channel: {
  channelType: string;
  accountNameSnapshot: string | null;
  accountNumberSnapshot: string | null;
  bankNameSnapshot: string | null;
  channelNote: string | null;
}): string {
  const parts = [spotPaymentMethodLabel(channel.channelType)];
  if (channel.accountNameSnapshot) parts.push(`户名：${channel.accountNameSnapshot}`);
  if (channel.accountNumberSnapshot) parts.push(`账号：${channel.accountNumberSnapshot}`);
  if (channel.bankNameSnapshot) parts.push(`开户行：${channel.bankNameSnapshot}`);
  if (channel.channelNote) parts.push(`备注：${channel.channelNote}`);
  return parts.join("；");
}

function pairRows(rows: ApprovalFormRow[]): string[][] {
  const paired: string[][] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const left = rows[index];
    const right = rows[index + 1];
    paired.push([left.label, left.value, right?.label ?? "", right?.value ?? ""]);
  }
  return paired;
}

// 画带框线的表格，返回表格底部 y。单元格内文本自动换行；行高随内容增长。
// 可选 imageColumn + rowImages（按数据行索引）在指定列嵌入图片（如签名图）。
function drawTable(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  options: {
    headerRow?: boolean;
    minRowHeight?: number;
    imageColumn?: number;
    rowImages?: (Buffer | null)[];
  } = {}
): number {
  const cellPadding = 4;
  const fontSize = 9;
  doc.fontSize(fontSize);
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  const hasHeader = options.headerRow !== false;
  const all = hasHeader ? [columns.map((c) => c.header), ...rows] : rows;
  let y = startY;

  all.forEach((row, rowIndex) => {
    const isHeader = hasHeader && rowIndex === 0;
    const dataIndex = hasHeader ? rowIndex - 1 : rowIndex;
    const rowHeight = Math.max(
      Math.max(
        ...row.map((cell, colIndex) =>
          doc.heightOfString(cell || "", { width: columns[colIndex].width - cellPadding * 2 })
        )
      ) +
        cellPadding * 2,
      isHeader ? 0 : options.minRowHeight ?? 0
    );

    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    let x = startX;
    row.forEach((cell, colIndex) => {
      const width = columns[colIndex].width;
      if (isHeader) {
        doc.rect(x, y, width, rowHeight).fill("#eeeeee");
        doc.fillColor("#000000");
      }
      doc.rect(x, y, width, rowHeight).stroke("#000000");

      const image = !isHeader && colIndex === options.imageColumn ? options.rowImages?.[dataIndex] : null;
      if (image) {
        try {
          doc.image(image, x + cellPadding, y + cellPadding, {
            fit: [width - cellPadding * 2, rowHeight - cellPadding * 2],
            align: "center",
            valign: "center"
          });
        } catch {
          // 签名图损坏/格式不支持时退化为空白单元格，不影响整单渲染。
        }
      } else {
        doc.text(cell || "", x + cellPadding, y + cellPadding, {
          width: width - cellPadding * 2
        });
      }
      x += width;
    });
    y += rowHeight;
  });

  return y;
}

// 平铺对角水印（浅灰半透明），盖在内容之上。用于下载件按下载人留痕。
function stampWatermark(doc: PDFKit.PDFDocument, lines: string[]): void {
  const text = lines.filter(Boolean).join("  ·  ");
  if (!text) return;
  doc.save();
  doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font("cn").fontSize(11).fillColor("#000000").fillOpacity(0.08);
  for (let x = -120; x < doc.page.width + 240; x += 250) {
    for (let y = 0; y < doc.page.height + 240; y += 92) {
      doc.text(text, x, y, { lineBreak: false });
    }
  }
  doc.restore();
  doc.fillOpacity(1).fillColor("#000000");
}

@Injectable()
export class ApprovalFormService {
  constructor(
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly spotAccess?: SpotProcurementAccessService
  ) {}

  // 审批通过后由各业务流程事务外调用，best-effort 生成审批单 PDF 并归档。幂等。
  async generateForInstance(instanceId: string, actorUserId: string) {
    if (!this.prisma || !this.files) {
      throw new Error("Prisma and file services are required to generate approval form");
    }

    const claimToken = randomUUID();
    const acquisition = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${instanceId} FOR UPDATE
      `);
      const instance = await tx.approvalInstance.findUnique({ where: { id: instanceId } });
      if (!instance || instance.status !== "approved") return { kind: "unavailable" as const };
      if (SPOT_PROCUREMENT_APPROVAL_TYPES.has(instance.businessType)) {
        return { kind: "spot" as const, instance };
      }

      const existing = await tx.pdfDocument.findFirst({
        where: { approvalInstanceId: instance.id }
      });
      if (existing) return { kind: "existing" as const, document: existing };

      await tx.$queryRaw(Prisma.sql`
        SELECT "approvalInstanceId" FROM "ApprovalFormGenerationClaim"
        WHERE "approvalInstanceId" = ${instanceId} FOR UPDATE
      `);
      const claim = await tx.approvalFormGenerationClaim.findUnique({
        where: { approvalInstanceId: instanceId }
      });
      const staleBefore = new Date(Date.now() - GENERATION_CLAIM_STALE_MS);
      if (claim && ["pending", "uploaded"].includes(claim.status) &&
        claim.claimedAt > staleBefore) {
        return { kind: "waiting" as const };
      }
      const nextStatus = claim?.uploadedFileId ? "uploaded" : "pending";
      if (claim) {
        await tx.approvalFormGenerationClaim.update({
          where: { approvalInstanceId: instanceId },
          data: {
            claimToken,
            status: nextStatus,
            claimedAt: new Date(),
            attemptCount: { increment: 1 },
            safeFailureCode: null
          }
        });
      } else {
        await tx.approvalFormGenerationClaim.create({
          data: {
            approvalInstanceId: instanceId,
            claimToken,
            status: "pending",
            claimedAt: new Date()
          }
        });
      }
      return {
        kind: "claimed" as const,
        instance,
        uploadedFileId: claim?.uploadedFileId ?? null
      };
    });

    if (acquisition.kind === "unavailable") return null;
    if (acquisition.kind === "spot") {
      return this.refreshLatestForBusiness(
        acquisition.instance.businessType,
        acquisition.instance.businessId,
        actorUserId,
        "approval.approve"
      );
    }
    if (acquisition.kind === "existing") return acquisition.document;
    if (acquisition.kind === "waiting") return this.waitForGeneratedForm(instanceId);

    let uploadedFileId = acquisition.uploadedFileId;
    let input: Awaited<ReturnType<ApprovalFormService["buildRenderInput"]>>;
    try {
      input = await this.buildRenderInput(acquisition.instance);
      if (!uploadedFileId) {
        const buffer = await this.renderPdf(input);
        const file = await this.files.uploadPrivateFile({
        buffer,
        originalName: approvalFileName(input),
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
          uploadedByUserId: actorUserId,
          approvalFormGenerationClaim: { approvalInstanceId: instanceId, claimToken }
        });
        uploadedFileId = file.id;
        const registered = await this.prisma.approvalFormGenerationClaim.updateMany({
          where: { approvalInstanceId: instanceId, claimToken, status: "pending" },
          data: { status: "uploaded", uploadedFileId, safeFailureCode: null }
        });
        if (registered.count === 0) {
          const current = await this.prisma.approvalFormGenerationClaim.findUnique({
            where: { approvalInstanceId: instanceId }
          });
          if (current?.claimToken !== claimToken || current.status !== "uploaded" ||
            current.uploadedFileId !== uploadedFileId) {
            throw new Error("审批单生成权已变化，请稍后重试");
          }
        }
      }
    } catch (error) {
      await this.prisma.approvalFormGenerationClaim.updateMany({
        where: { approvalInstanceId: instanceId, claimToken, status: "pending" },
        data: { status: "failed", safeFailureCode: "render_or_upload_failed" }
      });
      throw error;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "approvalInstanceId" FROM "ApprovalFormGenerationClaim"
          WHERE "approvalInstanceId" = ${instanceId} FOR UPDATE
        `);
        const claim = await tx.approvalFormGenerationClaim.findUnique({
          where: { approvalInstanceId: instanceId }
        });
        if (!claim || claim.claimToken !== claimToken || claim.status !== "uploaded" ||
          claim.uploadedFileId !== uploadedFileId) {
          throw new Error("审批单生成权已变化，请稍后重试");
        }
        const existing = await tx.pdfDocument.findFirst({
          where: { approvalInstanceId: instanceId }
        });
        if (existing) return existing;
        const pdfDocument = await tx.pdfDocument.create({
        data: {
            businessType: acquisition.instance.businessType,
            businessId: acquisition.instance.businessId,
            fileId: uploadedFileId,
          templateKey: APPROVAL_FORM_TEMPLATE_KEY,
            approvalInstanceId: instanceId
        }
      });

        const completed = await tx.approvalFormGenerationClaim.updateMany({
          where: { approvalInstanceId: instanceId, claimToken, status: "uploaded" },
          data: { status: "completed", pdfDocumentId: pdfDocument.id, safeFailureCode: null }
        });
        if (completed.count !== 1) {
          throw new Error("审批单生成状态已变化，请稍后重试");
        }
        await this.audit.record(tx, {
        actorUserId,
        action: "approval.form.generate",
          businessType: acquisition.instance.businessType,
          businessId: acquisition.instance.businessId,
          metadata: {
            pdfDocumentId: pdfDocument.id,
            fileId: uploadedFileId,
            businessCode: input.businessCode
          }
      });
      return pdfDocument;
    });
    } catch (error) {
      await this.prisma.approvalFormGenerationClaim.updateMany({
        where: { approvalInstanceId: instanceId, claimToken, status: "uploaded" },
        data: { status: "failed", safeFailureCode: "finalize_retry_required" }
      });
      throw error;
    }
  }

  private async waitForGeneratedForm(instanceId: string) {
    for (let attempt = 0; attempt < GENERATION_WAIT_ATTEMPTS; attempt += 1) {
      const existing = await this.prisma!.pdfDocument.findFirst({
        where: { approvalInstanceId: instanceId }
      });
      if (existing) return existing;
      await new Promise<void>((resolve) => setTimeout(resolve, GENERATION_WAIT_INTERVAL_MS));
    }
    return null;
  }

  /**
   * 零星采购业务动作提交后的 best-effort 刷新入口。
   * 生成失败只留可重试审计，不把 PDF 派生失败传回主业务。
   */
  async tryRefreshLatestForBusiness(
    businessType: string,
    businessId: string,
    actorUserId: string,
    trigger: string
  ): Promise<void> {
    try {
      await this.refreshLatestForBusiness(businessType, businessId, actorUserId, trigger);
    } catch (error) {
      await this.recordRefreshFailure(
        businessType,
        businessId,
        actorUserId,
        trigger,
        error
      ).catch(() => undefined);
    }
  }

  /**
   * 生成零星采购原始审批单。
   *
   * 原始审批单在审批通过时冻结；之后的实际付款、退款、发票等事实不得
   * 改写或替换该文件，统一由付款归档版本承载。
   */
  async refreshLatestForBusiness(
    businessType: string,
    businessId: string,
    actorUserId: string,
    trigger: string
  ) {
    if (!this.prisma || !this.files) {
      throw new Error("审批单刷新依赖未正确配置");
    }
    if (!SPOT_PROCUREMENT_APPROVAL_TYPES.has(businessType)) {
      throw new Error("当前业务类型不支持最新审批单刷新");
    }

    const source = await this.prisma.$transaction(async (tx) => {
      const instance = await this.loadLatestApprovalInstance(tx, businessType, businessId);
      if (instance.status !== "approved") {
        return { notApproved: true as const };
      }
      const currentPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType,
          businessId,
          templateKey: SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (currentPdf) {
        return { currentPdf };
      }
      return {
        instance,
        freezeToken: await this.loadApprovalFormFreezeToken(tx, instance)
      };
    });
    if ("notApproved" in source) {
      return null;
    }
    if ("currentPdf" in source) {
      return source.currentPdf;
    }
    const { instance, freezeToken } = source;
    // 签批信息读取、PDF 渲染与私有文件上传全部在数据库事务外执行。
    const input = await this.buildSpotProcurementApprovalFormInput(instance);
    const buffer = await renderSpotProcurementApprovalForm(input);
    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: spotProcurementApprovalFileName(input),
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId
    });

    let orphanReason: "stale_snapshot" | "association_failed" = "association_failed";
    let associationResult;
    try {
      associationResult = await this.prisma.$transaction(async (tx) => {
        await this.lockSpotBusiness(tx, businessType, businessId);
        const currentInstance = await this.loadLatestApprovalInstance(tx, businessType, businessId);
        const currentFreezeToken = await this.loadApprovalFormFreezeToken(
          tx,
          currentInstance
        );
        if (
          currentInstance.status !== "approved" ||
          !this.sameApprovalFormFreezeToken(freezeToken, currentFreezeToken)
        ) {
          orphanReason = "stale_snapshot";
          throw new Error("审批结论已变化，本次原始审批单不再关联");
        }

        const alreadyCurrent = await tx.pdfDocument.findFirst({
          where: {
            businessType,
            businessId,
            templateKey: SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        if (alreadyCurrent) {
          return { pdfDocument: alreadyCurrent, uploadedFileLinked: false as const };
        }

        const pdfDocument = await tx.pdfDocument.create({
          data: {
            businessType,
            businessId,
            fileId: file.id,
            templateKey: SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "approval.form.freeze",
          businessType,
          businessId,
          metadata: {
            pdfDocumentId: pdfDocument.id,
            fileId: file.id,
            trigger,
            templateKey: SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
            sourceFreezeToken: {
              approvalInstanceId: freezeToken.approvalInstanceId,
              approvalInstanceUpdatedAt: freezeToken.approvalInstanceUpdatedAt,
              latestActionLogId: freezeToken.latestActionLogId
            }
          }
        });
        return { pdfDocument, uploadedFileLinked: true as const };
      });
    } catch (error) {
      await this.handleUnlinkedApprovalFormFile({
        businessType,
        businessId,
        actorUserId,
        trigger,
        orphanFileId: file.id,
        reason: orphanReason
      });
      throw error;
    }

    if (!associationResult.uploadedFileLinked) {
      await this.handleUnlinkedApprovalFormFile({
        businessType,
        businessId,
        actorUserId,
        trigger,
        orphanFileId: file.id,
        reason: "already_current"
      });
    }
    return associationResult.pdfDocument;
  }

  // 下载时按下载人动态生成带水印审批单（谁下的+时间+公司名，可追溯防泄露）。
  async renderForDownload(
    businessType: string,
    businessId: string,
    downloaderUserId: string,
    confirmationPassword: string | undefined,
    downloadReason: string | undefined
  ) {
    if (!this.prisma || !this.files) {
      throw new Error("Prisma and file services are required to download approval form");
    }
    if (!confirmationPassword?.trim()) {
      throw new BadRequestException("审批单下载密码必填");
    }
    if (!downloadReason?.trim()) {
      throw new BadRequestException("审批单下载原因必填");
    }
    if (!this.auth) {
      throw new Error("Auth service is required to confirm approval form download");
    }

    await this.auth.confirmPassword(downloaderUserId, confirmationPassword);
    if (businessType === "contract_version") {
      await this.files.assertCanDownloadContractApprovalForm(businessId, downloaderUserId);
    } else if (SPOT_PROCUREMENT_APPROVAL_TYPES.has(businessType)) {
      if (!this.spotAccess) {
        throw new Error("零星采购审批单下载授权依赖未正确配置");
      }
      const access = await this.spotAccess.resolveBusinessDownloadAccess(
        businessType,
        businessId,
        downloaderUserId
      );
      if (access !== "allowed") {
        throw new ForbiddenException("当前账号无权下载该零星采购审批单");
      }
    } else {
      await this.files.assertCanDownloadApprovalFormByBusiness(
        businessType,
        businessId,
        downloaderUserId
      );
    }

    // 复用归档 PdfDocument 做权限锚点与幂等；其字节为无水印存档件，下载件按下载人重渲染。
    const pdfDocument = await this.getOrCreateByBusiness(
      businessType,
      businessId,
      downloaderUserId
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "当前业务尚未完成审批，暂不能生成审批单") {
        throw new Error("当前业务尚未完成审批，暂不能下载审批单");
      }
      throw error;
    });
    if (!pdfDocument) {
      throw new Error("审批单暂未生成，请先确认审批已完成后再下载");
    }
    await this.files.assertCanDownloadFileById(pdfDocument.fileId, downloaderUserId);

    const instance = pdfDocument.approvalInstanceId
      ? await this.prisma.approvalInstance.findUnique({
          where: { id: pdfDocument.approvalInstanceId }
        })
      : await this.prisma.approvalInstance.findFirst({
          where: { businessType, businessId, status: "approved" },
          orderBy: { updatedAt: "desc" }
        });
    if (!instance) {
      throw new Error("当前业务尚未完成审批，暂不能下载审批单");
    }

    const downloader = await this.prisma.user.findUnique({ where: { id: downloaderUserId } });
    const watermark = [
      "建工智管",
      `下载人：${downloader?.name ?? "下载人未读取"}`,
      formatDateTime(new Date())
    ];
    const isSpotProcurement = SPOT_PROCUREMENT_APPROVAL_TYPES.has(businessType);
    let buffer: Buffer;
    let businessCode: string;
    let fileName: string;
    if (isSpotProcurement) {
      const input = await this.buildSpotProcurementApprovalFormInput(
        instance,
        watermark
      );
      buffer = await renderSpotProcurementApprovalForm(input);
      businessCode = spotProcurementApprovalBusinessCode(input);
      fileName = spotProcurementApprovalFileName(input);
    } else {
      const input = await this.buildRenderInput(instance);
      buffer = await this.renderPdf({ ...input, watermark });
      businessCode = input.businessCode;
      fileName = approvalFileName(input);
    }

    await this.audit.record(this.prisma, {
      actorUserId: downloaderUserId,
      action: "approval.form.download",
      businessType,
      businessId,
      metadata: { fileId: pdfDocument.fileId, businessCode, downloadReason }
    });

    return { buffer, fileName };
  }

  // 收集渲染审批单所需的全部数据（业务摘要、我方主体、签批人姓名/职位/签名图）。
  private async buildRenderInput(instance: {
    id: string;
    businessType: string;
    businessId: string;
    applicantUserId: string;
    frozenNodes: unknown;
  }, client?: ApprovalFormClient): Promise<RenderInput> {
    const prisma = client ?? (this.prisma as ApprovalFormClient);
    const logs = await prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: instance.id },
      orderBy: { createdAt: "asc" }
    });

    const [businessCode, companyName, expenseClaim] = await Promise.all([
      this.resolveBusinessCode(prisma, instance.businessType, instance.businessId),
      this.resolveCompanyName(prisma, instance.businessType, instance.businessId),
      this.loadExpenseClaimApprovalFacts(prisma, instance.businessType, instance.businessId)
    ]);

    const relationships = logs.map((log) => frozenApprovalRelationship(log.action, log.metadata));
    const actorIds = Array.from(new Set([
      instance.applicantUserId,
      ...logs.map((log) => log.actorUserId),
      ...logs.flatMap((log) =>
        log.representedUserId ? [log.representedUserId] : []
      ),
      ...relationships.flatMap((relationship) =>
        relationship ? [relationship.fromUserId, relationship.toUserId] : []
      )
    ]));
    const users = await prisma.user.findMany({ where: { id: { in: actorIds } } });
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    const signatureBufferByLogId = new Map<string, Buffer | null>();
    for (const log of logs) {
      const fileId = log.signatureFileIdSnapshot;
      if (!fileId) {
        signatureBufferByLogId.set(log.id, null);
        continue;
      }
      if (!this.files) {
        throw new BadRequestException("审批签名文件服务不可用，请稍后重试");
      }
      const { buffer } = await this.files.getFileBuffer(fileId);
      signatureBufferByLogId.set(
        log.id,
        verifyApprovalSignatureSnapshot(buffer, log.signatureSha256Snapshot)
      );
    }

    const applicantName = nameById.get(instance.applicantUserId) ?? "申请人未读取";
    const summary = await this.resolveBusinessSummary(
      prisma,
      instance.businessType,
      instance.businessId,
      {
        applicantName,
        companyName
      }
    );

    const renderedLogs = logs.map((log, index) => {
      const relationship = relationships[index];
      let relationshipText = "";
      if (log.action === "transfer" || log.action === "delegate") {
        relationshipText = relationship
          ? `${relationship.kind === "transfer" ? "转交" : "委托"}关系：${nameById.get(relationship.fromUserId) ?? "原审批人未读取"} → ${nameById.get(relationship.toUserId) ?? "接收人未读取"}（${ROLE_LABELS[relationship.fromRoleKey] ?? "审批岗位未读取"}）`
          : "历史记录未冻结委托/转交双方关系";
      } else if (
        log.representedUserId &&
        log.representedUserId !== log.actorUserId
      ) {
        relationshipText = `代批关系：${nameById.get(log.representedUserId) ?? "原审批人未读取"} → ${nameById.get(log.actorUserId) ?? "实际审批人未读取"}（${log.approvedRoleKey ? (ROLE_LABELS[log.approvedRoleKey] ?? "审批岗位未读取") : "审批岗位未冻结"}）`;
      }
      return {
        actionKey: log.action,
        approvedRoleKey: log.approvedRoleKey ?? null,
        name: nameById.get(log.actorUserId) ?? "处理人未读取",
        position: log.approvedRoleKey
          ? roleLabel(log.approvedRoleKey as RoleKey)
          : "历史签名未冻结",
        action: actionLabel(log.action),
        signedAt: formatDateTime(log.createdAt),
        comment: log.comment ?? "",
        relationship: relationshipText,
        signature: signatureBufferByLogId.get(log.id) ?? null,
        createdAt: log.createdAt
      };
    });

    return {
      businessType: instance.businessType,
      title: expenseClaim
        ? expenseClaim.claimType === "reimbursement" ? "费用报销单" : "借款申请单"
        : BUSINESS_TYPE_LABELS[instance.businessType] ?? "审批单",
      companyName,
      businessCode,
      applicantName,
      summary,
      nodes: instance.frozenNodes as unknown as FrozenNode[],
      logs: renderedLogs,
      ...(expenseClaim ? {
        expenseClaim: {
          ...expenseClaim,
          approvals: renderedLogs
            .filter((log) => log.actionKey === "approve")
            .map((log) => ({
              name: log.name,
              position: log.position,
              comment: [log.relationship, log.comment].filter(Boolean).join("；"),
              signedAt: log.createdAt,
              signature: log.signature
            }))
        }
      } : {})
    };
  }

  private async buildSpotProcurementApprovalFormInput(
    instance: {
      id: string;
      businessType: string;
      businessId: string;
      applicantUserId: string;
      frozenNodes: unknown;
    },
    watermark?: string[]
  ): Promise<SpotProcurementApprovalFormInput> {
    if (!this.prisma) {
      throw new Error("审批单生成依赖未正确配置");
    }
    const prisma = this.prisma as ApprovalFormClient;
    const rendered = await this.buildRenderInput(instance, prisma);
    const signatureLogs = instance.businessType === "spot_procurement_payment"
      ? currentSpotPaymentApprovalRoundLogs(rendered.logs)
      : rendered.logs;
    const signatures = {
      materialDirector: approvalSignatureForRoles(signatureLogs, ["material_director"]),
      projectManager: approvalSignatureForRoles(signatureLogs, ["project_manager"]),
      comprehensiveDirector: approvalSignatureForRoles(signatureLogs, [
        "comprehensive_director"
      ]),
      financeDirector: approvalSignatureForRoles(signatureLogs, ["finance_director"]),
      finalApprover: approvalSignatureForRoles(signatureLogs, [
        "chairman",
        "general_manager"
      ])
    };

    if (instance.businessType === "spot_procurement_version") {
      const version = await prisma.spotProcurementVersion.findUnique({
        where: { id: instance.businessId }
      });
      if (!version) {
        throw new Error("零星采购申请版本不存在");
      }
      const [procurement, lines] = await Promise.all([
        prisma.spotProcurement.findUnique({ where: { id: version.procurementId } }),
        prisma.spotProcurementLine.findMany({
          where: { versionId: version.id },
          orderBy: { sortOrder: "asc" }
        })
      ]);
      const project = procurement
        ? await prisma.project.findUnique({ where: { id: procurement.projectId } })
        : null;
      return {
        kind: "application",
        projectName: project?.name ?? "项目名称未读取",
        procurementCode: procurement?.code ?? version.id,
        applicationDepartment: version.applicationDepartmentSnapshot,
        applicationName: version.applicationNameSnapshot,
        purchaserDepartment: version.purchaserDepartmentNameSnapshot,
        purchaserName: version.purchaserNameSnapshot,
        requestedArrivalAt: version.requestedArrivalAt,
        reason: version.reason,
        lines: lines.map((line) => ({
          materialName: line.materialName,
          specification: line.specification,
          unit: line.unit,
          quantity: decimalText(line.quantity),
          note: line.note
        })),
        signatures: {
          materialDirector: signatures.materialDirector,
          projectManager: signatures.projectManager
        },
        watermark
      };
    }

    if (instance.businessType === "spot_procurement_payment") {
      const payment = await prisma.spotProcurementPayment.findUnique({
        where: { id: instance.businessId }
      });
      if (!payment) {
        throw new Error("零星采购付款申请不存在");
      }
      const [version, project, channels, methods] = await Promise.all([
        prisma.spotProcurementVersion.findUnique({
          where: { id: payment.procurementVersionId }
        }),
        prisma.project.findUnique({ where: { id: payment.projectId } }),
        prisma.spotProcurementPaymentChannel.findMany({
          where: { paymentId: payment.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        }),
        prisma.spotProcurementPaymentMethodOption.findMany({
          where: { paymentId: payment.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        })
      ]);
      const primary =
        channels.find((channel) => channel.isPrimary) ?? channels[0] ?? null;
      const paymentMethodLabels = methods
        .map((method) => spotPaymentMethodLabel(method.paymentMethod))
        .join("、");
      return {
        kind: "payment",
        projectName: project?.name ?? "项目名称未读取",
        paymentCode: payment.code,
        submittedAt: payment.submittedAt ?? payment.createdAt,
        payerCompanyName: payment.payerCompanyNameSnapshot ?? "未确认",
        reason: payment.paymentNote ?? version?.reason ?? "零星材料采购付款",
        amountCents: dbMoneyToBigInt(payment.approvalAmountCents, "零星采购审批金额"),
        paymentTypeLabel: spotPaymentTypeLabel(payment.paymentType),
        paymentMethodLabel:
          paymentMethodLabels || spotPaymentMethodLabel(payment.paymentMethod),
        primaryPaymentChannel: primary
          ? spotPaymentChannelText(primary)
          : "未设置收款渠道",
        handlerName: rendered.applicantName,
        signatures: {
          comprehensiveDirector: signatures.comprehensiveDirector,
          projectManager: signatures.projectManager,
          financeDirector: signatures.financeDirector,
          finalApprover: signatures.finalApprover
        },
        watermark
      };
    }

    throw new Error("当前业务类型不支持零星采购原始审批单");
  }

  // 控制器惰性获取：若已通过的审批已有审批单则返回，否则补生成。
  async getOrCreateByBusiness(businessType: string, businessId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to load approval form");
    }

    if (SPOT_PROCUREMENT_APPROVAL_TYPES.has(businessType)) {
      const latestInstance = await this.prisma.approvalInstance.findFirst({
        where: { businessType, businessId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      });
      if (!latestInstance || latestInstance.status !== "approved") {
        throw new Error("当前业务尚未完成审批，暂不能生成审批单");
      }
      return this.refreshLatestForBusiness(
        businessType,
        businessId,
        actorUserId,
        "download.repair"
      );
    }
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType, businessId, status: "approved" },
      orderBy: { updatedAt: "desc" }
    });
    if (!instance) {
      throw new Error("当前业务尚未完成审批，暂不能生成审批单");
    }

    const existing = await this.prisma.pdfDocument.findFirst({
      where: { approvalInstanceId: instance.id }
    });
    if (existing) return existing;

    return this.generateForInstance(instance.id, actorUserId);
  }

  private async loadLatestApprovalInstance(
    client: ApprovalFormClient,
    businessType: string,
    businessId: string
  ) {
    const instance = await client.approvalInstance.findFirst({
      where: { businessType, businessId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    if (!instance) {
      throw new Error("未找到对应审批实例，无法生成审批单");
    }
    return instance;
  }

  private async loadApprovalFormFreezeToken(
    client: ApprovalFormClient,
    instance: { id: string; updatedAt: Date }
  ): Promise<ApprovalFormFreezeToken> {
    const latestAction = await client.approvalActionLog.findFirst({
      where: { approvalInstanceId: instance.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true }
    });
    return {
      approvalInstanceId: instance.id,
      approvalInstanceUpdatedAt: instance.updatedAt.toISOString(),
      latestActionLogId: latestAction?.id ?? null
    };
  }

  private sameApprovalFormFreezeToken(
    left: ApprovalFormFreezeToken,
    right: ApprovalFormFreezeToken
  ): boolean {
    return (
      left.approvalInstanceId === right.approvalInstanceId &&
      left.approvalInstanceUpdatedAt === right.approvalInstanceUpdatedAt &&
      left.latestActionLogId === right.latestActionLogId
    );
  }

  private async lockSpotBusiness(
    client: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<void> {
    const rows =
      businessType === "spot_procurement_version"
        ? await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "SpotProcurementVersion"
            WHERE "id" = ${businessId}
            FOR UPDATE
          `)
        : await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "SpotProcurementPayment"
            WHERE "id" = ${businessId}
            FOR UPDATE
          `);
    if (!rows[0]) {
      throw new Error("审批单对应业务不存在，无法关联最新 PDF");
    }
  }

  /**
   * 处置已上传但没有成为当前审批单的专用派生 PDF。
   * 先与当前指针关联共用业务行锁，再确认文件没有绑定任何 PdfDocument；
   * 提交结果不明且已绑定时只记录审计，绝不修改文件状态。
   */
  private async handleUnlinkedApprovalFormFile(input: {
    businessType: string;
    businessId: string;
    actorUserId: string;
    trigger: string;
    orphanFileId: string;
    reason: "stale_snapshot" | "already_current" | "association_failed";
  }): Promise<void> {
    if (!this.prisma) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockSpotBusiness(tx, input.businessType, input.businessId);
        const binding = await tx.pdfDocument.findFirst({
          where: { fileId: input.orphanFileId },
          select: { id: true, businessType: true, businessId: true }
        });
        if (binding) {
          await this.audit.record(tx, {
            actorUserId: input.actorUserId,
            action: "approval.form.orphan_file",
            businessType: input.businessType,
            businessId: input.businessId,
            metadata: {
              orphanFileId: input.orphanFileId,
              reason: input.reason,
              trigger: input.trigger,
              cleanupStatus: "bound_pdf_preserved",
              retryable: false,
              boundPdfDocumentId: binding.id,
              boundBusinessType: binding.businessType,
              boundBusinessId: binding.businessId
            }
          });
          return;
        }

        const successor = await tx.fileObject.findFirst({
          where: { supersedesFileObjectId: input.orphanFileId },
          select: { id: true }
        });
        if (successor) {
          await this.audit.record(tx, {
            actorUserId: input.actorUserId,
            action: "approval.form.orphan_file",
            businessType: input.businessType,
            businessId: input.businessId,
            metadata: {
              orphanFileId: input.orphanFileId,
              reason: input.reason,
              trigger: input.trigger,
              cleanupStatus: "bound_replacement_preserved",
              retryable: false,
              successorFileId: successor.id
            }
          });
          return;
        }

        const quarantined = await tx.fileObject.updateMany({
          where: {
            id: input.orphanFileId,
            uploadedByUserId: input.actorUserId,
            storageStatus: "active",
            supersedesFileObjectId: null
          },
          data: { storageStatus: "quarantined" }
        });
        await this.audit.record(tx, {
          actorUserId: input.actorUserId,
          action: "approval.form.orphan_file",
          businessType: input.businessType,
          businessId: input.businessId,
          metadata: {
            orphanFileId: input.orphanFileId,
            reason: input.reason,
            trigger: input.trigger,
            cleanupStatus: quarantined.count === 1 ? "quarantined" : "not_quarantined",
            retryable: quarantined.count !== 1
          }
        });
      });
    } catch (cleanupError) {
      // 补偿不得覆盖原业务/关联结果；回退为一条不含底层错误文本的可重试审计。
      await this.audit
        .record(this.prisma, {
          actorUserId: input.actorUserId,
          action: "approval.form.orphan_file",
          businessType: input.businessType,
          businessId: input.businessId,
          metadata: {
            orphanFileId: input.orphanFileId,
            reason: input.reason,
            trigger: input.trigger,
            cleanupStatus: "cleanup_failed",
            retryable: true,
            errorType: safeRefreshErrorType(cleanupError)
          }
        })
        .catch(() => undefined);
    }
  }

  private async recordRefreshFailure(
    businessType: string,
    businessId: string,
    actorUserId: string,
    trigger: string,
    error: unknown
  ): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: "approval.form.refresh_failed",
        businessType,
        businessId,
        metadata: {
          retryable: true,
          status: "retryable",
          trigger,
          templateKey: APPROVAL_FORM_TEMPLATE_KEY,
          errorType: safeRefreshErrorType(error),
          errorSummary: "审批单生成失败，可稍后重试"
        }
      })
    );
  }

  private async renderPdf(input: RenderInput): Promise<Buffer> {
    if (input.expenseClaim) {
      return renderExpenseClaimApprovalForm({
        ...input.expenseClaim,
        code: input.businessCode,
        companyName: input.companyName,
        applicantName: input.applicantName,
        watermark: input.watermark
      });
    }
    const margin = 48;
    const doc = new PDFDocument({ size: "A4", margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolvePromise) => {
      doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    });

    doc.registerFont("cn", FONT_PATH);
    doc.font("cn");

    const left = margin;
    const contentWidth = doc.page.width - margin * 2;

    // 抬头：我方公司主体名（合同签订时快照）。
    if (input.companyName) {
      doc.fontSize(12).text(input.companyName, left, doc.y, {
        width: contentWidth,
        align: "center"
      });
      doc.moveDown(0.3);
    }
    doc.fontSize(20).text(input.title, left, doc.y, { width: contentWidth, align: "center" });
    let y = doc.y + 14;

    if (input.title === "项目付款审批表") {
      y =
        drawTable(
          doc,
          left,
          y,
          [
            { header: "项目", width: 88 },
            { header: "内容", width: 178 },
            { header: "项目", width: 88 },
            { header: "内容", width: contentWidth - 88 - 178 - 88 }
          ],
          pairRows([{ label: "付款申请单号", value: input.businessCode }, ...input.summary]),
          { headerRow: false, minRowHeight: 28 }
        ) + 16;
    } else {
      // 业务信息栏（label | value 两列），含单号/申请人/生成时间 + 业务摘要。
      const infoRows: string[][] = [
        ["单号", input.businessCode],
        ["申请人", input.applicantName],
        ...input.summary.map((item): string[] => [item.label, item.value]),
        ["生成时间", formatDateTime(new Date())]
      ];
      y =
        drawTable(
          doc,
          left,
          y,
          [
            { header: "项目", width: 100 },
            { header: "内容", width: contentWidth - 100 }
          ],
          infoRows,
          { headerRow: false }
        ) + 16;
    }

    // 审批路线
    doc.fontSize(12).text("审批路线", left, y);
    y = doc.y + 4;
    y =
      drawTable(
        doc,
        left,
        y,
        [
          { header: "序号", width: 36 },
          { header: "审批节点", width: 150 },
          { header: "签批方式", width: 70 },
          { header: "审批角色", width: contentWidth - 36 - 150 - 70 }
        ],
        input.nodes.map((node, index) => [
          String(index + 1),
          node.name,
          node.mode === "all" ? "会签" : "或签",
          (node.roleKeys ?? []).map(roleLabel).join("、")
        ])
      ) + 16;

    // 签批记录（含签名图列）
    doc.fontSize(12).text("签批记录", left, y);
    y = doc.y + 4;
    const hasLogs = input.logs.length > 0;
    const sigCols = [
      { header: "序号", width: 30 },
      { header: "审批人", width: 64 },
      { header: "职位", width: 76 },
      { header: "动作", width: 44 },
      { header: "签批时间", width: 92 },
      { header: "审批意见 / 委托转交关系", width: contentWidth - 30 - 64 - 76 - 44 - 92 - 100 },
      { header: "签名", width: 100 }
    ];
    const sigRows = hasLogs
      ? input.logs.map((log, index) => [
          String(index + 1),
          log.name,
          log.position,
          log.action,
          log.signedAt,
          [log.relationship, log.comment].filter(Boolean).join("\n"),
          ""
        ])
      : [["", "（无签批记录）", "", "", "", "", ""]];
    drawTable(doc, left, y, sigCols, sigRows, {
      minRowHeight: 44,
      imageColumn: 6,
      rowImages: hasLogs ? input.logs.map((log) => log.signature) : [null]
    });

    // 下载水印：按下载人动态平铺，可追溯防泄露。
    if (input.watermark?.length) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        stampWatermark(doc, input.watermark);
      }
      doc.flushPages();
    }

    doc.end();
    return done;
  }

  private async resolveBusinessCode(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<string> {
    if (businessType === "expense_claim") {
      const claim = await prisma.expenseClaim.findUnique({
        where: { id: businessId },
        select: { code: true }
      });
      return claim?.code ?? businessId;
    }
    if (businessType === "spot_procurement_version") {
      const version = await prisma.spotProcurementVersion.findUnique({
        where: { id: businessId },
        select: { procurementId: true }
      });
      const procurement = version
        ? await prisma.spotProcurement.findUnique({
            where: { id: version.procurementId },
            select: { code: true }
          })
        : null;
      return procurement?.code ?? businessId;
    }
    if (businessType === "spot_procurement_payment") {
      const payment = await prisma.spotProcurementPayment.findUnique({
        where: { id: businessId },
        select: { code: true }
      });
      return payment?.code ?? businessId;
    }
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      return settlement?.code ?? businessId;
    }
    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      return payment?.code ?? businessId;
    }
    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      const contract = version
        ? await prisma.contract.findUnique({ where: { id: version.contractId } })
        : null;
      return contract?.code ?? businessId;
    }
    return businessId;
  }

  // 我方公司主体名（审批单抬头）：三类业务均回溯到合同上的 companyEntityName 快照。
  private async resolveCompanyName(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<string> {
    if (businessType === "expense_claim") {
      const claim = await prisma.expenseClaim.findUnique({
        where: { id: businessId },
        select: { companyEntityNameSnapshot: true }
      });
      return claim?.companyEntityNameSnapshot ?? "";
    }
    let contractId: string | null = null;
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      contractId = settlement?.contractId ?? null;
    } else if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      contractId = payment?.contractId ?? null;
    } else if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      contractId = version?.contractId ?? null;
    }
    if (!contractId) {
      return "";
    }
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    return contract?.companyEntityName ?? "";
  }

  private async loadExpenseClaimApprovalFacts(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<Omit<ExpenseClaimApprovalFormInput, "code" | "companyName" | "applicantName" | "approvals" | "watermark"> | null> {
    if (businessType !== "expense_claim") return null;
    const claim = await prisma.expenseClaim.findUnique({
      where: { id: businessId },
      select: {
        claimType: true,
        incidentalExpenseCategory: true,
        projectId: true,
        handledByNameSnapshot: true,
        submittedAt: true,
        reason: true,
        requestedAmountCents: true,
        loanOffsetAmountCents: true,
        companyPayableAmountCents: true,
        paymentMethod: true,
        payeeNameSnapshot: true,
        loanExpectedClearanceAt: true
      }
    });
    if (
      !claim ||
      (
        claim.claimType !== "reimbursement" &&
        claim.claimType !== "loan" &&
        claim.claimType !== "incidental_expense"
      )
    ) {
      return null;
    }
    const [project, lines] = await Promise.all([
      claim.projectId
        ? prisma.project.findUnique({ where: { id: claim.projectId }, select: { name: true } })
        : Promise.resolve(null),
      claim.claimType === "reimbursement"
        ? prisma.expenseClaimLine.findMany({
          where: { expenseClaimId: businessId },
          orderBy: { sortOrder: "asc" },
          select: {
            sortOrder: true,
            expenseCategory: true,
            occurredOn: true,
            purpose: true,
            receiptCount: true,
            amountCents: true
          }
        })
        : Promise.resolve([])
    ]);
    return {
      claimType: claim.claimType,
      incidentalExpenseCategory: claim.incidentalExpenseCategory,
      projectName: project?.name ?? "",
      handlerName: claim.handledByNameSnapshot,
      submittedAt: claim.submittedAt,
      reason: claim.reason,
      requestedAmountCents: dbMoneyToBigInt(claim.requestedAmountCents, "费用申请金额"),
      loanOffsetAmountCents: dbMoneyToBigInt(claim.loanOffsetAmountCents, "费用借款冲销金额"),
      companyPayableAmountCents: dbMoneyToBigInt(claim.companyPayableAmountCents, "费用公司支付金额"),
      paymentMethod: claim.paymentMethod,
      payeeName: claim.payeeNameSnapshot,
      loanExpectedClearanceAt: claim.loanExpectedClearanceAt,
      lines: lines.map((line) => ({
        ...line,
        amountCents: dbMoneyToBigInt(line.amountCents, "费用明细金额")
      }))
    };
  }

  // 业务信息栏：按业务类型取关键字段（金额/对方/事由等）。查不到的字段直接略过。
  private async loadSpotPaymentSettlementFacts(
    prisma: ApprovalFormClient,
    payment: {
      procurementId: string;
      procurementVersionId: string;
    }
  ): Promise<SpotPaymentSettlementFacts> {
    const discrepancy =
      await prisma.spotProcurementDiscrepancy.findFirst({
        where: {
          procurementId: payment.procurementId,
          procurementVersionId:
            payment.procurementVersionId,
          invalidatedAt: null
        },
        select: {
          id: true,
          procurementId: true,
          procurementVersionId: true,
          status: true,
          actualCostCentsSnapshot: true,
          shortageAmountCents: true,
          canceledUnexecutedAmountCents: true,
          overpaidAmountCents: true,
          resolutionType: true,
          supplierBalanceEntryId: true,
          updatedAt: true
        }
      });
    if (!discrepancy) {
      return {
        discrepancy: null,
        refund: null,
        supplierBalanceEntry: null
      };
    }
    const [refund, supplierBalanceEntry] =
      await Promise.all([
        prisma.spotProcurementRefund.findUnique({
          where: { discrepancyId: discrepancy.id },
          select: {
            id: true,
            discrepancyId: true,
            procurementId: true,
            amountCents: true,
            receivedAt: true,
            refundMethod: true,
            voucherFileId: true
          }
        }),
        discrepancy.supplierBalanceEntryId
          ? prisma.supplierBalanceEntry.findUnique({
              where: {
                id: discrepancy.supplierBalanceEntryId
              },
              select: {
                id: true,
                procurementId: true,
                entryType: true,
                availableDeltaCents: true,
                reservedDeltaCents: true
              }
            })
          : Promise.resolve(null)
      ]);
    if (
      refund &&
      (refund.discrepancyId !== discrepancy.id ||
        refund.procurementId !== payment.procurementId ||
        refund.amountCents !==
          discrepancy.overpaidAmountCents ||
        discrepancy.status !== "resolved" ||
        discrepancy.resolutionType !== "full_refund")
    ) {
      throw new Error(
        "零星采购退款与差异结算事实不一致"
      );
    }
    if (
      discrepancy.status === "resolved" &&
      discrepancy.resolutionType === "full_refund" &&
      !refund
    ) {
      throw new Error(
        "零星采购退款结算缺少到账事实"
      );
    }
    if (
      supplierBalanceEntry &&
      (supplierBalanceEntry.id !==
        discrepancy.supplierBalanceEntryId ||
        supplierBalanceEntry.procurementId !==
          payment.procurementId ||
        supplierBalanceEntry.entryType !==
          "credit_from_discrepancy" ||
        supplierBalanceEntry.availableDeltaCents !==
          discrepancy.overpaidAmountCents ||
        supplierBalanceEntry.reservedDeltaCents !== 0n ||
        discrepancy.status !== "resolved" ||
        discrepancy.resolutionType !==
          "full_supplier_balance")
    ) {
      throw new Error(
        "零星采购供应商余额转入分录与差异事实不一致"
      );
    }
    if (
      discrepancy.status === "resolved" &&
      discrepancy.resolutionType ===
        "full_supplier_balance" &&
      !supplierBalanceEntry
    ) {
      throw new Error(
        "零星采购差异结算缺少供应商余额转入分录"
      );
    }
    return {
      discrepancy,
      refund,
      supplierBalanceEntry
    };
  }

  private async resolveBusinessSummary(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string,
    context: { applicantName: string; companyName: string }
  ): Promise<Array<{ label: string; value: string }>> {
    if (businessType === "spot_procurement_version") {
      const version = await prisma.spotProcurementVersion.findUnique({
        where: { id: businessId }
      });
      if (!version) return [];
      const [procurement, lines] = await Promise.all([
        prisma.spotProcurement.findUnique({ where: { id: version.procurementId } }),
        prisma.spotProcurementLine.findMany({
          where: { versionId: version.id },
          orderBy: { sortOrder: "asc" }
        })
      ]);
      const project = procurement
        ? await prisma.project.findUnique({ where: { id: procurement.projectId } })
        : null;
      const rows: ApprovalFormRow[] = [
        { label: "项目名称", value: project?.name ?? "—" },
        { label: "采购编号", value: procurement?.code ?? businessId },
        { label: "采购原因", value: version.reason || "—" },
        {
          label: "采购金额",
          value:
            version.totalAmountCents === null
              ? "付款申请确定"
              : formatYuan(version.totalAmountCents)
        },
        { label: "采购版本", value: `第 ${version.versionNo} 版` }
      ];
      for (const line of lines) {
        const quantity = `${decimalText(line.quantity)} ${line.unit}`;
        const detail = [
          line.materialName,
          line.specification ? `规格 ${line.specification}` : null,
          `数量 ${quantity}`,
          line.note ? `备注 ${line.note}` : null
        ]
          .filter(Boolean)
          .join("；");
        rows.push({ label: `材料明细 ${line.sortOrder}`, value: detail });
      }
      return rows;
    }

    if (businessType === "spot_procurement_payment") {
      const payment = await prisma.spotProcurementPayment.findUnique({
        where: { id: businessId }
      });
      if (!payment) return [];
      const [
        procurement,
        project,
        executions,
        settlementFacts
      ] = await Promise.all([
        prisma.spotProcurement.findUnique({ where: { id: payment.procurementId } }),
        prisma.project.findUnique({ where: { id: payment.projectId } }),
        prisma.spotProcurementPaymentExecution.findMany({
          where: { paymentId: payment.id, voidedAt: null },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }]
        }),
        this.loadSpotPaymentSettlementFacts(prisma, payment)
      ]);
      const actualPaidCents = executions.reduce(
        (total, execution) => total + dbMoneyToBigInt(execution.amountCents, "零星采购实际付款"),
        0n
      );
      const companyPayableCents =
        dbMoneyToBigInt(payment.companyPaymentAmountCents, "零星采购公司付款金额") -
        dbMoneyToBigInt(payment.canceledCompanyPaymentAmountCents ?? 0n, "零星采购取消付款金额");
      const rows: ApprovalFormRow[] = [
        { label: "项目名称", value: project?.name ?? "—" },
        { label: "采购编号", value: procurement?.code ?? payment.procurementId },
        { label: "付款申请编号", value: payment.code },
        { label: "收款方", value: payment.payeeNameSnapshot || procurement?.supplierNameSnapshot || "—" },
        { label: "结算申请金额", value: formatYuan(payment.settlementAmountCents) },
        { label: "供应商余额抵扣", value: formatYuan(payment.supplierBalanceAmountCents) },
        {
          label: "已执行供应商余额抵扣",
          value: formatYuan(payment.executedSupplierBalanceAmountCents ?? 0n)
        },
        { label: "公司付款申请", value: formatYuan(payment.companyPaymentAmountCents) },
        { label: "未执行取消额度", value: formatYuan(payment.canceledAmountCents ?? 0n) },
        {
          label: "取消公司付款额度",
          value: formatYuan(
            payment.canceledCompanyPaymentAmountCents ?? 0n
          )
        },
        {
          label: "取消余额抵扣额度",
          value: formatYuan(
            payment.canceledSupplierBalanceAmountCents ?? 0n
          )
        },
        { label: "累计实际付款", value: formatYuan(actualPaidCents) },
        {
          label: "付款申请状态",
          value: spotPaymentBusinessStatusLabel(payment.status)
        },
        {
          label: "公司实际付款事实",
          value: spotPaymentExecutionFactLabel(actualPaidCents, companyPayableCents)
        }
      ];
      const discrepancy = settlementFacts.discrepancy;
      rows.push(
        {
          label: "本次采购实际成本",
          value: discrepancy
            ? formatYuan(
                discrepancy.actualCostCentsSnapshot
              )
            : "尚未形成收货差异结算"
        },
        {
          label: "少货差额",
          value: discrepancy
            ? formatYuan(discrepancy.shortageAmountCents)
            : "0.00 元"
        },
        {
          label: "差异处置",
          value: discrepancy
            ? `${spotDiscrepancyStatusLabel(
                discrepancy.status
              )}；${spotDiscrepancyResolutionLabel(
                discrepancy.resolutionType
              )}`
            : "未形成差异"
        },
        {
          label: "已确认到账退款",
          value: settlementFacts.refund
            ? `${formatYuan(
                settlementFacts.refund.amountCents
              )}；${formatDate(
                settlementFacts.refund.receivedAt
              )}；${paymentMethodLabel(
                settlementFacts.refund.refundMethod
              )}；凭证 ${
                settlementFacts.refund.voucherFileId
              }`
            : "0.00 元"
        },
        {
          label: "已转入供应商余额",
          value: settlementFacts.supplierBalanceEntry
            ? formatYuan(
                settlementFacts.supplierBalanceEntry
                  .availableDeltaCents
              )
            : "0.00 元"
        }
      );
      executions.forEach((execution, index) => {
        rows.push({
          label: `实际付款明细 ${index + 1}`,
          value: `${formatYuan(execution.amountCents)}；${formatDate(execution.paidAt)}；${paymentMethodLabel(execution.paymentMethod)}；凭证 ${execution.voucherFileId}`
        });
      });
      return rows;
    }

    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      if (!payment) return [];
      const [
        project,
        settlement,
        contract,
        contractVersion,
        paymentTermsStage,
        effectiveSettlements,
        paidPayments
      ] =
        await Promise.all([
          prisma.project.findUnique({ where: { id: payment.projectId } }),
        payment.settlementId
          ? prisma.settlement.findUnique({ where: { id: payment.settlementId } })
          : Promise.resolve(null),
          prisma.contract.findUnique({ where: { id: payment.contractId } }),
          prisma.contractVersion.findUnique({ where: { id: payment.contractVersionId } }),
          payment.paymentTermsStageId
            ? prisma.paymentTermsStage.findUnique({ where: { id: payment.paymentTermsStageId } })
            : Promise.resolve(null),
          prisma.settlement.findMany({
            where: { contractId: payment.contractId, status: { in: ["effective", "partially_paid", "paid"] } },
            select: { amountCents: true }
          }),
          prisma.paymentRequest.findMany({
            where: { contractId: payment.contractId, status: { in: ["partially_paid", "paid"] } },
            select: { paidAmountCents: true }
          })
        ]);

      return buildProjectPaymentApprovalRows({
        payment,
        applicantName: context.applicantName,
        companyName: context.companyName,
        projectName: project?.name,
        contract,
        settlement,
        contractAmountCents: contractVersion?.amountCents,
        cumulativeSettledCents: sumCents(effectiveSettlements),
        cumulativePaidCents: sumCents(paidPayments),
        paymentTermsStageName:
          paymentTermsStage &&
          paymentTermsStage.paymentTermsVersionId === payment.paymentTermsVersionId
            ? paymentTermsStage.name
            : null
      });
    }

    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      if (!settlement) return [];
      const contract = await prisma.contract.findUnique({
        where: { id: settlement.contractId }
      });
      const rows: Array<{ label: string; value: string }> = [
        { label: "结算期次", value: settlement.periodLabel },
        { label: "结算金额", value: formatYuan(settlement.amountCents) },
        { label: "应付金额", value: formatYuan(settlement.payableAmountCents) }
      ];
      if (contract) {
        rows.push({ label: "对应合同", value: `${contract.name}（${contract.code}）` });
        rows.push({ label: "对方单位", value: contract.counterparty });
      }
      return rows;
    }

    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      if (!version) return [];
      const contract = await prisma.contract.findUnique({ where: { id: version.contractId } });
      const rows: Array<{ label: string; value: string }> = [];
      if (contract) {
        rows.push({ label: "合同名称", value: contract.name });
        rows.push({ label: "对方单位", value: contract.counterparty });
      }
      rows.push({ label: "合同金额", value: formatYuan(version.amountCents) });
      rows.push({ label: "版本号", value: `第 ${version.versionNo} 版` });
      return rows;
    }

    return [];
  }

}

export { APPROVAL_FORM_TEMPLATE_KEY };
