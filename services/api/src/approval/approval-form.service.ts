import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import { verifyApprovalSignatureSnapshot } from "./approval-signature-snapshot";

const APPROVAL_FORM_TEMPLATE_KEY = "approval_form";
const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const GENERATION_CLAIM_STALE_MS = 120_000;
const GENERATION_WAIT_ATTEMPTS = 30;
const GENERATION_WAIT_INTERVAL_MS = 100;

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
  remind: "催办"
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  contract_version: "合同审批单",
  settlement: "结算审批单",
  payment_request: "项目付款审批表"
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
  const prefix = input.title === "项目付款审批表" ? "项目付款审批表" : "审批单";
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
    private readonly auth?: AuthService
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
  }): Promise<RenderInput> {
    const prisma = this.prisma!;
    const logs = await prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: instance.id },
      orderBy: { createdAt: "asc" }
    });

    const [businessCode, companyName] = await Promise.all([
      this.resolveBusinessCode(prisma, instance.businessType, instance.businessId),
      this.resolveCompanyName(prisma, instance.businessType, instance.businessId)
    ]);

    const actorIds = Array.from(
      new Set([instance.applicantUserId, ...logs.map((log) => log.actorUserId)])
    );
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

    return {
      title: BUSINESS_TYPE_LABELS[instance.businessType] ?? "审批单",
      companyName,
      businessCode,
      applicantName,
      summary,
      nodes: instance.frozenNodes as unknown as FrozenNode[],
      logs: logs.map((log) => ({
        name: nameById.get(log.actorUserId) ?? "处理人未读取",
        position: log.approvedRoleKey
          ? roleLabel(log.approvedRoleKey as RoleKey)
          : "历史签名未冻结",
        action: actionLabel(log.action),
        signedAt: formatDateTime(log.createdAt),
        comment: log.comment ?? "",
        signature: signatureBufferByLogId.get(log.id) ?? null
      }))
    };
  }

  // 控制器惰性获取：若已通过的审批已有审批单则返回，否则补生成。
  async getOrCreateByBusiness(businessType: string, businessId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to load approval form");
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

  private async resolveBusinessCode(
    prisma: PrismaService,
    businessType: string,
    businessId: string
  ): Promise<string> {
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
    prisma: PrismaService,
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
    prisma: PrismaService,
    businessType: string,
    businessId: string,
    context: { applicantName: string; companyName: string }
  ): Promise<Array<{ label: string; value: string }>> {
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
