import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type RoleKey,
  type SpotProcurementInvoiceStatus
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import type { AttachSpotPaymentInvoiceDto } from "./dto/attach-spot-payment-invoice.dto";
import type { InvalidateSpotPaymentInvoiceDto } from "./dto/invalidate-spot-payment-invoice.dto";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

const FINANCE_APPEND_ROLES = new Set<RoleKey>([
  "finance_staff",
  "finance_director"
]);
const OPEN_PROCUREMENT_STATUSES = new Set([
  "approved_in_progress",
  "closed",
  "abnormally_terminated"
]);
const INVOICE_STATUS_LABELS: Record<SpotProcurementInvoiceStatus, string> = {
  not_required: "无需发票",
  pending: "待补发票",
  uploaded: "已上传发票"
};

type ProcurementLockRow = {
  id: string;
  projectId: string;
  currentVersionId: string | null;
  status: string;
};

type PaymentLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  paymentType: string | null;
  factsFrozenAt: Date | null;
  handlerUserId: string;
  invalidatedAt: Date | null;
};

@Injectable()
export class SpotProcurementInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly pilot: SpotProcurementPilotService
  ) {}

  append(
    paymentIdInput: string,
    actorUserId: string,
    input: AttachSpotPaymentInvoiceDto
  ) {
    const paymentId = requiredText(paymentIdInput, "请选择付款申请");
    const fileId = requiredText(input.fileId, "请选择发票文件");
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const { procurement, payment } = await this.lockContext(tx, paymentId);
        await this.requireAppendAccess(tx, procurement, payment, actorUserId);
        const existing = await tx.spotProcurementPaymentInvoice.findUnique({
          where: { fileId }
        });
        if (existing) {
          if (
            existing.paymentId === payment.id &&
            existing.status === "active" &&
            existing.uploadedByUserId === actorUserId
          ) {
            return invoiceReadModel(existing);
          }
          throw new ConflictException("该文件已关联其他付款发票事实");
        }
        const file = await this.files.assertFileHasNoBusinessBinding(tx, fileId);
        if (file.uploadedByUserId !== actorUserId) {
          throw new ForbiddenException("只能追加本人上传且尚未绑定的发票文件");
        }
        if (!isInvoiceFile(file.mimeType)) {
          throw new BadRequestException("发票附件只支持图片或 PDF 文件");
        }
        const invoice = await tx.spotProcurementPaymentInvoice.create({
          data: {
            paymentId: payment.id,
            fileId,
            status: "active",
            uploadedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.invoice.append",
          businessType: "spot_procurement_payment_invoice",
          businessId: invoice.id,
          metadata: {
            projectId: payment.projectId,
            procurementId: payment.procurementId,
            paymentId: payment.id,
            fileId
          }
        });
        return invoiceReadModel(invoice);
      })
    );
  }

  invalidate(
    paymentIdInput: string,
    invoiceIdInput: string,
    actorUserId: string,
    input: InvalidateSpotPaymentInvoiceDto
  ) {
    const paymentId = requiredText(paymentIdInput, "请选择付款申请");
    const invoiceId = requiredText(invoiceIdInput, "请选择发票附件");
    const reason = requiredText(input.reason, "请填写发票附件作废原因");
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const { procurement, payment } = await this.lockContext(tx, paymentId);
        await this.requireAppendAccess(tx, procurement, payment, actorUserId);
        if (procurement.status !== "approved_in_progress") {
          throw new ConflictException("采购办结或异常终止后只能追加发票，不能作废既有附件");
        }
        const invoice = await tx.spotProcurementPaymentInvoice.findFirst({
          where: { id: invoiceId, paymentId: payment.id }
        });
        if (!invoice) throw new NotFoundException("付款发票附件不存在");
        if (invoice.status === "invalidated") {
          if (
            invoice.invalidatedByUserId === actorUserId &&
            invoice.invalidationReason === reason &&
            invoice.invalidatedAt
          ) {
            return invoiceReadModel(invoice);
          }
          throw new ConflictException("该付款发票附件已经作废");
        }
        const now = new Date();
        const updated = await tx.spotProcurementPaymentInvoice.updateMany({
          where: { id: invoice.id, paymentId: payment.id, status: "active" },
          data: {
            status: "invalidated",
            invalidatedAt: now,
            invalidatedByUserId: actorUserId,
            invalidationReason: reason
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("付款发票附件状态已变化，请刷新后重试");
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.invoice.invalidate",
          businessType: "spot_procurement_payment_invoice",
          businessId: invoice.id,
          metadata: {
            projectId: payment.projectId,
            procurementId: payment.procurementId,
            paymentId: payment.id,
            reason
          }
        });
        return invoiceReadModel({
          ...invoice,
          status: "invalidated",
          invalidatedAt: now,
          invalidatedByUserId: actorUserId,
          invalidationReason: reason
        });
      })
    );
  }

  async summary(
    paymentId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const [lines, invoices] = await Promise.all([
      client.spotProcurementPaymentLine.findMany({
        where: { paymentId },
        select: { expectedInvoiceCondition: true }
      }),
      client.spotProcurementPaymentInvoice.findMany({
        where: { paymentId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ]);
    const fileIds = invoices.map((invoice) => invoice.fileId);
    const files = fileIds.length
      ? await client.fileObject.findMany({
          where: { id: { in: fileIds } },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            storageStatus: true
          }
        })
      : [];
    const fileById = new Map(files.map((file) => [file.id, file]));
    const activeInvoices = invoices.filter(
      (invoice) =>
        invoice.status === "active" &&
        fileById.get(invoice.fileId)?.storageStatus === "active"
    );
    const status = deriveInvoiceStatus(
      lines.map((line) => line.expectedInvoiceCondition),
      activeInvoices.length
    );
    return {
      status,
      statusLabel: INVOICE_STATUS_LABELS[status],
      activeCount: activeInvoices.length,
      invoices: invoices.map((invoice) => ({
        ...invoiceReadModel(invoice),
        file: fileById.get(invoice.fileId)
          ? {
              id: invoice.fileId,
              originalName: fileById.get(invoice.fileId)!.originalName,
              mimeType: fileById.get(invoice.fileId)!.mimeType,
              sizeBytes: fileById.get(invoice.fileId)!.sizeBytes,
              storageStatus: fileById.get(invoice.fileId)!.storageStatus
            }
          : null
      }))
    };
  }

  private async lockContext(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const paymentRows = await tx.$queryRaw<PaymentLockRow[]>(Prisma.sql`
      SELECT
        "id", "projectId", "procurementId", "procurementVersionId", "status",
        "paymentType", "factsFrozenAt", "handlerUserId", "invalidatedAt"
      FROM "SpotProcurementPayment"
      WHERE "id" = ${paymentId}
      FOR UPDATE
    `);
    const payment = paymentRows[0];
    if (!payment) throw new NotFoundException("付款申请不存在");
    const procurementRows = await tx.$queryRaw<ProcurementLockRow[]>(Prisma.sql`
      SELECT "id", "projectId", "currentVersionId", "status"
      FROM "SpotProcurement"
      WHERE "id" = ${payment.procurementId}
      FOR UPDATE
    `);
    const procurement = procurementRows[0];
    if (
      !procurement ||
      procurement.projectId !== payment.projectId ||
      procurement.currentVersionId !== payment.procurementVersionId
    ) {
      throw new ConflictException("付款申请关联的当前采购事实不一致");
    }
    return { procurement, payment };
  }

  private async requireAppendAccess(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    payment: PaymentLockRow,
    actorUserId: string
  ) {
    this.pilot.assertEnabled(payment.projectId);
    if (
      !OPEN_PROCUREMENT_STATUSES.has(procurement.status) ||
      payment.status === "invalidated" ||
      payment.invalidatedAt
    ) {
      throw new ConflictException("当前付款申请不允许追加发票附件");
    }
    if (!payment.paymentType || !payment.factsFrozenAt) {
      throw new ConflictException("付款申请尚未提交并冻结，不能追加发票附件");
    }
    const roles = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
    if (
      actorUserId !== payment.handlerUserId &&
      !roles.some((role) => FINANCE_APPEND_ROLES.has(role))
    ) {
      throw new ForbiddenException("只有采购经办人或本项目财务人员可以追加发票附件");
    }
  }

  private async loadActorRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, memberPositions] =
      await Promise.all([
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId: null },
          select: { positionId: true }
        }),
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionId: true }
        }),
        tx.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionKey: true }
        })
      ]);
    const positionIds = [
      ...new Set(
        [...globalPositions, ...projectPositions].map(
          (position) => position.positionId
        )
      )
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const keyByPositionId = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    return resolveEffectiveRoleKeys(
      globalPositions.flatMap((position) => {
        const key = keyByPositionId.get(position.positionId);
        return key ? [key] : [];
      }),
      [
        ...projectPositions.flatMap((position) => {
          const key = keyByPositionId.get(position.positionId);
          return key ? [key] : [];
        }),
        ...memberPositions.map((position) => position.positionKey as RoleKey)
      ]
    );
  }

  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = prismaErrorCode(error);
      if (["P2002", "P2003", "P2025", "P2034"].includes(code ?? "")) {
        throw new ConflictException("付款发票附件数据已变化，请刷新后重试");
      }
      throw error;
    }
  }
}

export function deriveInvoiceStatus(
  expectedConditions: readonly string[],
  activeInvoiceCount: number
): SpotProcurementInvoiceStatus {
  if (activeInvoiceCount > 0) return "uploaded";
  return expectedConditions.length > 0 &&
    expectedConditions.every((condition) => condition === "no_invoice")
    ? "not_required"
    : "pending";
}

function invoiceReadModel(invoice: {
  id: string;
  paymentId: string;
  fileId: string;
  status: string;
  uploadedByUserId: string;
  invalidatedAt: Date | null;
  invalidatedByUserId: string | null;
  invalidationReason: string | null;
  createdAt: Date;
}) {
  return {
    id: invoice.id,
    paymentId: invoice.paymentId,
    fileId: invoice.fileId,
    status: invoice.status,
    uploadedByUserId: invoice.uploadedByUserId,
    invalidatedAt: invoice.invalidatedAt?.toISOString() ?? null,
    invalidatedByUserId: invoice.invalidatedByUserId,
    invalidationReason: invoice.invalidationReason,
    createdAt: invoice.createdAt.toISOString()
  };
}

function isInvoiceFile(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "application/pdf" || normalized.startsWith("image/");
}

function requiredText(value: unknown, message: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function prismaErrorCode(error: unknown) {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
