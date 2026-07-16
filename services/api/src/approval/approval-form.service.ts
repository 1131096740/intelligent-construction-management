import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { resolve } from "node:path";
import type { RoleKey } from "@jiangkong/shared-domain";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import { SpotProcurementAccessService } from "../spot-procurement/spot-procurement-access.service";

const APPROVAL_FORM_TEMPLATE_KEY = "approval_form";
const SPOT_PROCUREMENT_APPROVAL_TYPES = new Set([
  "spot_procurement_version",
  "spot_procurement_payment"
]);
const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");

type ApprovalFormClient = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "approvalInstance"
  | "approvalActionLog"
  | "pdfDocument"
  | "paymentRequest"
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
  | "spotProcurementPaymentExecution"
  | "fileObject"
  | "auditLog"
>;

interface ApprovalFormSnapshotToken {
  approvalInstanceId: string;
  approvalInstanceUpdatedAt: string;
  latestActionLogId: string | null;
  businessUpdatedAt: string;
  activeExecutionFingerprint: string | null;
}

// 审批路线节点（与各业务 service 的 frozenNodes 形态一致：name/mode/roleKeys）
interface FrozenNode {
  name: string;
  mode: string;
  roleKeys: RoleKey[];
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
  spot_procurement_payment: "项目零星材料付款审批单"
};

const roleLabel = (key: string) => ROLE_LABELS[key] ?? key;
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

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
  title: string;
  companyName: string;
  businessCode: string;
  applicantName: string;
  summary: Array<{ label: string; value: string }>;
  nodes: FrozenNode[];
  logs: Array<{
    name: string;
    position: string;
    action: string;
    signedAt: string;
    comment: string;
    signature: Buffer | null;
  }>;
  watermark?: string[];
}

interface ProjectPaymentApprovalRowsInput {
  payment: {
    sourceType?: string | null;
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
  currentAvailableCents?: bigint | null;
}

type ApprovalFormRow = { label: string; value: string };

const empty = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
};

function sourceTypeLabel(sourceType?: string | null): string {
  if (sourceType === "contract_advance") return "合同预付款";
  if (sourceType === "contract_due") return "合同累计付款";
  return "结算付款";
}

function paymentReason(input: ProjectPaymentApprovalRowsInput): string {
  if (input.payment.sourceType === "contract_advance") {
    return `${empty(input.contract?.name)}合同预付款`;
  }
  if (input.payment.sourceType === "contract_due") {
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

function invoiceTypeLabel(value?: string | null): string {
  if (value === "vat_general") return "增值税普通发票";
  if (value === "vat_special") return "增值税专用发票";
  return "发票类型未读取";
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
    { label: "付款类型", value: sourceTypeLabel(input.payment.sourceType) },
    { label: "合同金额", value: formatOptionalYuan(input.contractAmountCents) },
    { label: "累计生效结算金额", value: formatOptionalYuan(input.cumulativeSettledCents) },
    { label: "累计已付款", value: formatOptionalYuan(input.cumulativePaidCents) },
    { label: "当前可申请余额", value: formatOptionalYuan(input.currentAvailableCents) },
    { label: "发票类型提醒", value: "按合同约定提交" },
    { label: "本次付款金额", value: formatYuan(input.payment.requestedAmountCents) },
    { label: "收款方名称", value: empty(input.contract?.counterparty) },
    { label: "开户银行", value: "—" },
    { label: "银行账号", value: "—" },
    { label: "转款手续费", value: "—" },
    { label: "备注", value: "付款创建时已通过后端额度校验" }
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

// 仅接受 PNG/JPEG 魔数的图片用于嵌入，廉价挡掉非图片字节。
// ponytail: 头部合法但 IDAT 损坏的 PNG 仍可能拖慢 pdfkit 解码；上传走图片选择器，正常不触发。
function isEmbeddableImage(buffer: Buffer | null): boolean {
  if (!buffer || buffer.length < 4) return false;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPng || isJpeg;
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

    const instance = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId }
    });

    if (!instance || instance.status !== "approved") {
      return null;
    }

    const existing = await this.prisma.pdfDocument.findFirst({
      where: {
        businessType: instance.businessType,
        businessId: instance.businessId,
        templateKey: APPROVAL_FORM_TEMPLATE_KEY
      }
    });
    if (existing) {
      return existing;
    }

    const input = await this.buildRenderInput(instance);
    const buffer = await this.renderPdf(input);

    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: approvalFileName(input),
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId
    });

    const pdfDocument = await this.prisma.pdfDocument.create({
      data: {
        businessType: instance.businessType,
        businessId: instance.businessId,
        fileId: file.id,
        templateKey: APPROVAL_FORM_TEMPLATE_KEY
      }
    });

    await this.audit.record(this.prisma, {
      actorUserId,
      action: "approval.form.generate",
      businessType: instance.businessType,
      businessId: instance.businessId,
      metadata: { pdfDocumentId: pdfDocument.id, fileId: file.id, businessCode: input.businessCode }
    });

    return pdfDocument;
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

  /** 生成并切换一个零星采购单据的当前最新 PDF。 */
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
      const token = await this.loadSnapshotToken(tx, instance, businessType, businessId);
      const currentPdf = await this.findCurrentPdfForSnapshot(
        tx,
        businessType,
        businessId,
        token
      );
      if (currentPdf) {
        return { currentPdf };
      }
      return {
        instance,
        snapshotToken: token
      };
    });
    if ("currentPdf" in source) {
      return source.currentPdf;
    }
    const { instance, snapshotToken } = source;
    // 签名图读取、PDF 渲染与私有文件上传全部在数据库事务外执行。
    const input = await this.buildRenderInput(instance);
    const buffer = await this.renderPdf(input);
    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: approvalFileName(input),
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
        const currentToken = await this.loadSnapshotToken(
          tx,
          currentInstance,
          businessType,
          businessId
        );
        if (!this.sameSnapshotToken(snapshotToken, currentToken)) {
          orphanReason = "stale_snapshot";
          throw new Error("审批或付款事实已变化，本次 PDF 不再关联");
        }

        const alreadyCurrent = await this.findCurrentPdfForSnapshot(
          tx,
          businessType,
          businessId,
          currentToken
        );
        if (alreadyCurrent) {
          return { pdfDocument: alreadyCurrent, uploadedFileLinked: false as const };
        }

        const existing = await tx.pdfDocument.findFirst({
          where: {
            businessType,
            businessId,
            templateKey: APPROVAL_FORM_TEMPLATE_KEY
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        const oldFileId = existing?.fileId ?? null;
        let pdfDocument;
        if (existing) {
          await this.files!.linkFileReplacement(tx, {
            newFileId: file.id,
            oldFileId: existing.fileId,
            actorUserId
          });
          pdfDocument = await tx.pdfDocument.update({
            where: { id: existing.id },
            data: { fileId: file.id }
          });
        } else {
          pdfDocument = await tx.pdfDocument.create({
            data: {
              businessType,
              businessId,
              fileId: file.id,
              templateKey: APPROVAL_FORM_TEMPLATE_KEY
            }
          });
        }

        await this.audit.record(tx, {
          actorUserId,
          action: "approval.form.refresh",
          businessType,
          businessId,
          metadata: {
            pdfDocumentId: pdfDocument.id,
            newFileId: file.id,
            oldFileId,
            trigger,
            templateKey: APPROVAL_FORM_TEMPLATE_KEY,
            sourceSnapshotToken: {
              approvalInstanceId: snapshotToken.approvalInstanceId,
              approvalInstanceUpdatedAt: snapshotToken.approvalInstanceUpdatedAt,
              latestActionLogId: snapshotToken.latestActionLogId,
              businessUpdatedAt: snapshotToken.businessUpdatedAt,
              activeExecutionFingerprint: snapshotToken.activeExecutionFingerprint
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
    if (SPOT_PROCUREMENT_APPROVAL_TYPES.has(businessType)) {
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
    }

    // 复用归档 PdfDocument 做权限锚点与幂等；其字节为无水印存档件，下载件按下载人重渲染。
    const pdfDocument = await this.getOrCreateByBusiness(businessType, businessId, downloaderUserId);
    if (!pdfDocument) {
      throw new Error("审批单暂未生成，请先确认审批已完成后再下载");
    }
    await this.files.assertCanDownloadFileById(pdfDocument.fileId, downloaderUserId);

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType, businessId, status: "approved" },
      orderBy: { updatedAt: "desc" }
    });
    if (!instance) {
      throw new Error("当前业务尚未完成审批，暂不能下载审批单");
    }

    const downloader = await this.prisma.user.findUnique({ where: { id: downloaderUserId } });
    const input = await this.buildRenderInput(instance);
    const watermark = [
      input.companyName || "建工智管",
      `下载人：${downloader?.name ?? "下载人未读取"}`,
      formatDateTime(new Date())
    ];
    const buffer = await this.renderPdf({ ...input, watermark });

    await this.audit.record(this.prisma, {
      actorUserId: downloaderUserId,
      action: "approval.form.download",
      businessType,
      businessId,
      metadata: { fileId: pdfDocument.fileId, businessCode: input.businessCode, downloadReason }
    });

    return { buffer, fileName: approvalFileName(input) };
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

    const [projectId, businessCode, companyName] = await Promise.all([
      this.resolveProjectId(prisma, instance.businessType, instance.businessId),
      this.resolveBusinessCode(prisma, instance.businessType, instance.businessId),
      this.resolveCompanyName(prisma, instance.businessType, instance.businessId)
    ]);

    const actorIds = Array.from(
      new Set([instance.applicantUserId, ...logs.map((log) => log.actorUserId)])
    );
    const users = await prisma.user.findMany({ where: { id: { in: actorIds } } });
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    const signatureFileIdById = new Map(users.map((user) => [user.id, user.signatureFileId]));

    const positionById = new Map<string, string>();
    if (projectId) {
      for (const id of actorIds) {
        const roles = await this.loadActorRoleKeys(prisma, id, projectId);
        positionById.set(id, roles.map(roleLabel).join("、"));
      }
    }

    // 懒加载签名图字节（仅签批人各取一次）。
    const signatureBufferById = new Map<string, Buffer | null>();
    for (const log of logs) {
      if (signatureBufferById.has(log.actorUserId)) continue;
      const fileId = signatureFileIdById.get(log.actorUserId);
      const buffer = fileId
        ? await this.files!
            .getFileBuffer(fileId)
            .then((result) => result.buffer)
            .catch(() => null)
        : null;
      signatureBufferById.set(log.actorUserId, isEmbeddableImage(buffer) ? buffer : null);
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

    return {
      title: BUSINESS_TYPE_LABELS[instance.businessType] ?? "审批单",
      companyName,
      businessCode,
      applicantName,
      summary,
      nodes: instance.frozenNodes as unknown as FrozenNode[],
      logs: logs.map((log) => ({
        name: nameById.get(log.actorUserId) ?? "处理人未读取",
        position: positionById.get(log.actorUserId) ?? "",
        action: actionLabel(log.action),
        signedAt: formatDateTime(log.createdAt),
        comment: log.comment ?? "",
        signature: signatureBufferById.get(log.actorUserId) ?? null
      }))
    };
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

    const existing = await this.prisma.pdfDocument.findFirst({
      where: { businessType, businessId, templateKey: APPROVAL_FORM_TEMPLATE_KEY }
    });
    if (existing) {
      return existing;
    }

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { businessType, businessId, status: "approved" },
      orderBy: { updatedAt: "desc" }
    });
    if (!instance) {
      throw new Error("当前业务尚未完成审批，暂不能生成审批单");
    }

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

  private async loadSnapshotToken(
    client: ApprovalFormClient,
    instance: { id: string; updatedAt: Date },
    businessType: string,
    businessId: string
  ): Promise<ApprovalFormSnapshotToken> {
    const [latestAction, businessSnapshot] = await Promise.all([
      client.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true }
      }),
      businessType === "spot_procurement_version"
        ? client.spotProcurementVersion
            .findUnique({
              where: { id: businessId },
              select: { updatedAt: true }
            })
            .then((business) => ({
              updatedAt: business?.updatedAt ?? null,
              executionFingerprint: null
            }))
        : Promise.all([
            client.spotProcurementPayment.findUnique({
              where: { id: businessId },
              select: { updatedAt: true }
            }),
            client.spotProcurementPaymentExecution.findMany({
              where: { paymentId: businessId, voidedAt: null },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, amountCents: true }
            })
          ]).then(([business, executions]) => ({
            updatedAt: business?.updatedAt ?? null,
            executionFingerprint: `${executions.length}:${executions.at(-1)?.id ?? "-"}:${executions
              .reduce(
                (total, execution) =>
                  total + dbMoneyToBigInt(execution.amountCents, "零星采购实际付款"),
                0n
              )
              .toString()}`
          }))
    ]);
    if (!businessSnapshot.updatedAt) {
      throw new Error("审批单对应业务不存在");
    }
    return {
      approvalInstanceId: instance.id,
      approvalInstanceUpdatedAt: instance.updatedAt.toISOString(),
      latestActionLogId: latestAction?.id ?? null,
      businessUpdatedAt: businessSnapshot.updatedAt.toISOString(),
      activeExecutionFingerprint: businessSnapshot.executionFingerprint
    };
  }

  private sameSnapshotToken(
    left: ApprovalFormSnapshotToken,
    right: ApprovalFormSnapshotToken
  ): boolean {
    return (
      left.approvalInstanceId === right.approvalInstanceId &&
      left.approvalInstanceUpdatedAt === right.approvalInstanceUpdatedAt &&
      left.latestActionLogId === right.latestActionLogId &&
      left.businessUpdatedAt === right.businessUpdatedAt &&
      left.activeExecutionFingerprint === right.activeExecutionFingerprint
    );
  }

  private async findCurrentPdfForSnapshot(
    client: ApprovalFormClient,
    businessType: string,
    businessId: string,
    snapshotToken: ApprovalFormSnapshotToken
  ) {
    const existing = await client.pdfDocument.findFirst({
      where: {
        businessType,
        businessId,
        templateKey: APPROVAL_FORM_TEMPLATE_KEY
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!existing) return null;
    const latestRefresh = await client.auditLog.findFirst({
      where: {
        action: "approval.form.refresh",
        businessType,
        businessId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true }
    });
    const metadata =
      latestRefresh?.metadata &&
      typeof latestRefresh.metadata === "object" &&
      !Array.isArray(latestRefresh.metadata)
        ? (latestRefresh.metadata as Record<string, unknown>)
        : null;
    // Read Committed 下两次 SELECT 之间可能有并发刷新提交。
    // 快照 token 一致还不够：审计必须明确指向第一次读到的同一 PdfDocument/file。
    if (
      metadata?.pdfDocumentId !== existing.id ||
      metadata?.newFileId !== existing.fileId
    ) {
      return null;
    }
    const rawToken = metadata?.sourceSnapshotToken;
    if (!rawToken || typeof rawToken !== "object" || Array.isArray(rawToken)) {
      return null;
    }
    const token = rawToken as Record<string, unknown>;
    const storedToken: ApprovalFormSnapshotToken = {
      approvalInstanceId: String(token.approvalInstanceId ?? ""),
      approvalInstanceUpdatedAt: String(token.approvalInstanceUpdatedAt ?? ""),
      latestActionLogId:
        token.latestActionLogId === null ? null : String(token.latestActionLogId ?? ""),
      businessUpdatedAt: String(token.businessUpdatedAt ?? ""),
      activeExecutionFingerprint:
        token.activeExecutionFingerprint === null
          ? null
          : String(token.activeExecutionFingerprint ?? "")
    };
    return this.sameSnapshotToken(snapshotToken, storedToken) ? existing : null;
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
      { header: "审批意见", width: contentWidth - 30 - 64 - 76 - 44 - 92 - 100 },
      { header: "签名", width: 100 }
    ];
    const sigRows = hasLogs
      ? input.logs.map((log, index) => [
          String(index + 1),
          log.name,
          log.position,
          log.action,
          log.signedAt,
          log.comment,
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

  private async resolveProjectId(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<string | null> {
    if (businessType === "spot_procurement_version") {
      const version = await prisma.spotProcurementVersion.findUnique({
        where: { id: businessId },
        select: { procurementId: true }
      });
      const procurement = version
        ? await prisma.spotProcurement.findUnique({
            where: { id: version.procurementId },
            select: { projectId: true }
          })
        : null;
      return procurement?.projectId ?? null;
    }
    if (businessType === "spot_procurement_payment") {
      const payment = await prisma.spotProcurementPayment.findUnique({
        where: { id: businessId },
        select: { projectId: true }
      });
      return payment?.projectId ?? null;
    }
    if (businessType === "settlement") {
      const settlement = await prisma.settlement.findUnique({ where: { id: businessId } });
      return settlement?.projectId ?? null;
    }
    if (businessType === "payment_request") {
      const payment = await prisma.paymentRequest.findUnique({ where: { id: businessId } });
      return payment?.projectId ?? null;
    }
    if (businessType === "contract_version") {
      const version = await prisma.contractVersion.findUnique({ where: { id: businessId } });
      const contract = version
        ? await prisma.contract.findUnique({ where: { id: version.contractId } })
        : null;
      return contract?.projectId ?? null;
    }
    return null;
  }

  private async resolveBusinessCode(
    prisma: ApprovalFormClient,
    businessType: string,
    businessId: string
  ): Promise<string> {
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

  // 业务信息栏：按业务类型取关键字段（金额/对方/事由等）。查不到的字段直接略过。
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
        {
          label: "供应商",
          value: version.supplierNameSnapshot || procurement?.supplierNameSnapshot || "—"
        },
        { label: "采购原因", value: version.reason || "—" },
        { label: "采购金额合计", value: formatYuan(version.totalAmountCents) },
        { label: "采购版本", value: `第 ${version.versionNo} 版` }
      ];
      for (const line of lines) {
        const quantity = `${decimalText(line.quantity)} ${line.unit}`;
        const invoice =
          line.invoiceMode === "invoice"
            ? `${invoiceTypeLabel(line.invoiceType)}、${line.vatRateLabelSnapshot ?? "税率未读取"}、含税单价 ${decimalText(line.unitPrice)} 元`
            : `无票、无票单价 ${decimalText(line.unitPrice)} 元`;
        const detail = [
          line.materialName,
          line.specification ? `规格 ${line.specification}` : null,
          `数量 ${quantity}`,
          invoice,
          `金额 ${formatYuan(line.amountCents)}`,
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
      const [procurement, project, executions] = await Promise.all([
        prisma.spotProcurement.findUnique({ where: { id: payment.procurementId } }),
        prisma.project.findUnique({ where: { id: payment.projectId } }),
        prisma.spotProcurementPaymentExecution.findMany({
          where: { paymentId: payment.id, voidedAt: null },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }]
        })
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
      const [project, settlement, contract, contractVersion, effectiveSettlements, paidPayments] =
        await Promise.all([
          prisma.project.findUnique({ where: { id: payment.projectId } }),
        payment.settlementId
          ? prisma.settlement.findUnique({ where: { id: payment.settlementId } })
          : Promise.resolve(null),
          prisma.contract.findUnique({ where: { id: payment.contractId } }),
          prisma.contractVersion.findUnique({ where: { id: payment.contractVersionId } }),
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
        cumulativePaidCents: sumCents(paidPayments)
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

  // 与各业务 service 的岗位解析一致：全局/项目岗位 + 项目成员岗位。
  private async loadActorRoleKeys(
    prisma: ApprovalFormClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      prisma.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      prisma.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      prisma.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set(
        [...globalPositions, ...projectPositions].map((position) => position.positionId)
      )
    );
    const positions = positionIds.length
      ? await prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }
}

export { APPROVAL_FORM_TEMPLATE_KEY };
