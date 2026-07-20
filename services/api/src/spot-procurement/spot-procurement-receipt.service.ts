import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type DetailActionReadModel,
  type RoleKey
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { hasNonReceiptBusinessFileBinding } from "../file/file-business-binding";
import { FileService } from "../file/file.service";
import { acquireFileBusinessBindingTransactionLock } from "../file/file-business-binding";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import { collapseUnicodeWhitespace } from "../validation/unicode-whitespace";
import type {
  AttachReceiptPhotoDto,
  ReceiptPhotoCategory,
  ReceiptPhotoSource
} from "./dto/attach-receipt-photo.dto";
import {
  RECEIPT_PHOTO_CATEGORIES,
  RECEIPT_PHOTO_SOURCES
} from "./dto/attach-receipt-photo.dto";
import type { CreateReceiptDelegationDto } from "./dto/create-receipt-delegation.dto";
import {
  RECEIPT_REVIEW_DECISIONS,
  type ReviewReceiptDto
} from "./dto/review-receipt.dto";
import type { RevokeReceiptReviewDto } from "./dto/revoke-receipt-review.dto";
import { SpotProcurementClosureService } from "./spot-procurement-closure.service";
import {
  isSpotProcurementReceiptQuantity,
  type UpdateReceiptDraftDto,
  type UpdateReceiptDraftLineDto
} from "./dto/update-receipt-draft.dto";
import {
  ReceiptWatermarkService,
  type ReceiptWatermarkOutput
} from "./receipt-watermark.service";
import { SpotProcurementAccessService } from "./spot-procurement-access.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import {
  isCurrentFormalReceiptPdfFact,
  RECEIPT_PDF_REFRESH_ACTION
} from "./spot-procurement-receipt-pdf-facts";
import { SpotProcurementReceiptPdfService } from "./spot-procurement-receipt-pdf.service";
import { SpotProcurementPaymentArchiveService } from "./spot-procurement-payment-archive.service";
import {
  SPOT_PROCUREMENT_BUSINESS_TYPES,
  SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT,
  SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
} from "./spot-procurement.constants";

const RECEIPT_EDITABLE_STATUSES = new Set([
  "draft",
  "returned",
  "review_revoked"
]);
const RECEIPT_PHOTO_APPENDABLE_STATUSES = new Set([
  ...RECEIPT_EDITABLE_STATUSES,
  "submitted"
]);
const RECEIPT_CONFIRM_ROLES = new Set<RoleKey>([
  "employee",
  "material_staff",
  "material_director",
  "project_manager"
]);
const RECEIPT_HANDLER_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_IEND_TAIL = Buffer.from("0000000049454e44ae426082", "hex");
const ExactReceiptDecimal = Prisma.Decimal.clone({
  precision: 64,
  rounding: Prisma.Decimal.ROUND_HALF_UP
});

type ProcurementLockRow = {
  id: string;
  projectId: string;
  code: string;
  applicantUserId: string;
  handlerUserId: string;
  currentVersionId: string | null;
  status: string;
  actualCostCents: bigint | null;
};

type VersionLockRow = {
  id: string;
  procurementId: string;
  versionNo: number;
  status: string;
  handlerUserId: string;
  totalAmountCents: bigint;
};

type ReceiptLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  currentRevisionNo: number;
  handlerUserId: string;
  note: string | null;
  actualCostCents: bigint;
  firstSubmittedAt: Date | null;
  submittedAt: Date | null;
  submittedByUserId: string | null;
  submissionDelegationId: string | null;
  lockedAt: Date | null;
};

type ReceiptRevisionLockRow = {
  id: string;
  receiptId: string;
  revisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  handlerUserId: string;
  note: string | null;
  actualCostCents: bigint;
  submittedAt: Date | null;
  submittedByUserId: string | null;
  submissionDelegationId: string | null;
};

type ReceiptDelegationRow = {
  id: string;
  receiptId: string;
  delegatorUserId: string;
  delegateUserId: string;
  scope: string;
  delegatedAt: Date;
  revokedAt: Date | null;
};

type ProcurementLineLockRow = {
  id: string;
  versionId: string;
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
};

type PaymentLinePriceRow = {
  procurementLineId: string;
  unitPrice: Prisma.Decimal;
};

type ReceiptLineLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  procurementLineId: string;
  approvedQuantitySnapshot: Prisma.Decimal;
  qualifiedQuantity: Prisma.Decimal;
  unqualifiedQuantity: Prisma.Decimal;
  unqualifiedReason: string | null;
  freeGiftQuantity: Prisma.Decimal;
  replenishmentPending: boolean;
  discrepancyNote: string | null;
  actualCostCents: bigint;
};

type ReceiptPhotoLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  originalFileId: string;
  watermarkedFileId: string;
  originalSha256: string;
  watermarkedSha256: string;
  source: string;
  category: string;
  serverRecordedAt: Date;
  note: string | null;
  uploadedByUserId: string;
  lockedAtFirstSubmission: boolean;
  lockedAt: Date | null;
  appendReason: string | null;
};

type ReceiptReviewLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  sequenceNo: number;
  decision: string;
  comment: string | null;
  reviewedByUserId: string;
  submissionDelegationId: string | null;
  targetReviewId: string | null;
  createdAt: Date;
};

type FileLockRow = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  contentSha256: string | null;
  storageStatus: string;
};

type ReceiptActionScope = {
  active: boolean;
  effectiveRoleKeys: RoleKey[];
  projectRoleKeys: RoleKey[];
  hasProjectMembership: boolean;
};

type LockedReceiptContext = {
  procurement: ProcurementLockRow;
  version: VersionLockRow;
  receipt: ReceiptLockRow;
  revision: ReceiptRevisionLockRow;
};

type PreparedReceiptLine = {
  procurementLineId: string;
  approvedQuantitySnapshot: Prisma.Decimal;
  qualifiedQuantity: Prisma.Decimal;
  unqualifiedQuantity: Prisma.Decimal;
  unqualifiedReason: string | null;
  freeGiftQuantity: Prisma.Decimal;
  replenishmentPending: boolean;
  discrepancyNote: string | null;
  actualCostCents: bigint;
};

type PhotoSnapshot = {
  receiptId: string;
  revisionNo: number;
  procurementVersionId: string;
  revisionSubmittedAt: number | null;
  firstSubmittedAt: number | null;
  projectLabel: string;
  procurementCode: string;
  uploaderName: string;
  note: string | null;
  appendReason: string | null;
};

export function parseReceiptQuantity(value: unknown): Prisma.Decimal {
  if (!isSpotProcurementReceiptQuantity(value)) {
    throw new BadRequestException("收货数量格式不正确");
  }
  return new Prisma.Decimal(value);
}

export function calculateReceiptActualCostCents(
  qualifiedQuantity: Prisma.Decimal,
  frozenUnitPrice: Prisma.Decimal
): bigint {
  if (qualifiedQuantity.isNegative() || frozenUnitPrice.isNegative()) {
    throw new BadRequestException("收货数量或冻结单价不能小于 0");
  }
  const rounded = new ExactReceiptDecimal(
    qualifiedQuantity.toString()
  )
    .mul(new ExactReceiptDecimal(frozenUnitPrice.toString()))
    .mul("100")
    .toDecimalPlaces(0, ExactReceiptDecimal.ROUND_HALF_UP);
  const amount = BigInt(rounded.toFixed(0));
  if (!isWithinPostgresBigIntRange(amount)) {
    throw new BadRequestException("收货实际成本超出系统可保存范围");
  }
  return amount;
}

export function hasStrictImageContainerEnd(
  buffer: Buffer,
  mimeType: string
): boolean {
  if (mimeType === "image/jpeg") {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[buffer.length - 2] === 0xff &&
      buffer[buffer.length - 1] === 0xd9
    );
  }
  if (mimeType === "image/png") {
    return (
      buffer.length >= PNG_SIGNATURE.length + PNG_IEND_TAIL.length &&
      buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
      buffer.subarray(-PNG_IEND_TAIL.length).equals(PNG_IEND_TAIL)
    );
  }
  return false;
}

@Injectable()
export class SpotProcurementReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly files: FileService,
    private readonly watermark: ReceiptWatermarkService,
    private readonly access: SpotProcurementAccessService,
    private readonly receiptPdfs: SpotProcurementReceiptPdfService,
    private readonly closure: SpotProcurementClosureService,
    private readonly archives?: SpotProcurementPaymentArchiveService
  ) {}

  async getReceipt(procurementId: string, actorUserId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const receipt =
          await tx.spotProcurementReceipt.findUnique({
            where: { procurementId },
            select: {
              id: true,
              projectId: true,
              procurementId: true,
              procurementVersionId: true,
              status: true,
              currentRevisionNo: true,
              handlerUserId: true,
              note: true,
              actualCostCents: true,
              firstSubmittedAt: true,
              submittedAt: true,
              submittedByUserId: true,
              submissionDelegationId: true,
              lockedAt: true
            }
          });
        if (!receipt) {
          throw new NotFoundException("零星采购收货单不存在");
        }
        if (
          (await this.access.resolveReceiptViewAccess(
            receipt.id,
            actorUserId,
            tx
          )) !== "allowed"
        ) {
          throw new ForbiddenException(
            "零星采购资源不存在或当前账号无权访问"
          );
        }
        this.pilot.assertEnabled(receipt.projectId);

        const [
          procurement,
          version,
          revision,
          procurementLines,
          receiptLines,
          delegation,
          versionRevisions,
          reviews,
          pdfDocuments,
          latestPdfRefresh,
          discrepancy
        ] = await Promise.all([
          tx.spotProcurement.findUnique({
          where: { id: procurementId },
          select: {
            id: true,
            code: true,
            projectId: true,
            applicantUserId: true,
            handlerUserId: true,
              currentVersionId: true,
              status: true
            }
          }),
          tx.spotProcurementVersion.findUnique({
            where: { id: receipt.procurementVersionId },
            select: {
              id: true,
              versionNo: true,
              status: true,
              handlerUserId: true
            }
          }),
          tx.spotProcurementReceiptRevision.findUnique({
            where: {
              receiptId_revisionNo: {
                receiptId: receipt.id,
                revisionNo: receipt.currentRevisionNo
              }
            }
          }),
          tx.spotProcurementLine.findMany({
            where: { versionId: receipt.procurementVersionId },
            orderBy: { sortOrder: "asc" }
          }),
          tx.spotProcurementReceiptLine.findMany({
            where: {
              receiptId: receipt.id,
              receiptRevisionNo: receipt.currentRevisionNo
            }
          }),
          tx.spotProcurementReceiptDelegation.findFirst({
            where: { receiptId: receipt.id, revokedAt: null },
            orderBy: { delegatedAt: "desc" }
          }),
          tx.spotProcurementReceiptRevision.findMany({
            where: {
              receiptId: receipt.id,
              procurementId,
              procurementVersionId:
                receipt.procurementVersionId,
              revisionNo: { lte: receipt.currentRevisionNo }
            },
            select: { revisionNo: true },
            orderBy: { revisionNo: "asc" }
          }),
          tx.spotProcurementReceiptReview.findMany({
            where: {
              receiptId: receipt.id,
              procurementId,
              procurementVersionId:
                receipt.procurementVersionId
            },
            orderBy: { sequenceNo: "asc" }
          }),
          tx.pdfDocument.findMany({
            where: {
              businessType:
                SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
              businessId: receipt.id,
              templateKey:
                SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
            },
            select: {
              id: true,
              fileId: true,
              templateKey: true,
              createdAt: true
            },
            orderBy: [
              { createdAt: "desc" },
              { id: "desc" }
            ],
            take: 2
          }),
          tx.auditLog.findFirst({
            where: {
              action: RECEIPT_PDF_REFRESH_ACTION,
              businessType:
                SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
              businessId: receipt.id
            },
            orderBy: [
              { createdAt: "desc" },
              { id: "desc" }
            ],
            select: { metadata: true }
          }),
          tx.spotProcurementDiscrepancy.findFirst({
            where: {
              procurementId,
              procurementVersionId: receipt.procurementVersionId,
              invalidatedAt: null
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              status: true,
              resolutionType: true,
              replenishedAt: true,
              refundExpectedAmountCents: true,
              resolvedAt: true
            }
          })
        ]);
        if (!procurement || !version || !revision) {
          throw new ConflictException(
            "零星采购收货关联数据不完整"
          );
        }
        if (
          procurement.projectId !== receipt.projectId ||
          procurement.currentVersionId !==
            receipt.procurementVersionId ||
          procurement.handlerUserId !== receipt.handlerUserId ||
          version.handlerUserId !== receipt.handlerUserId ||
          revision.procurementVersionId !==
            receipt.procurementVersionId ||
          revision.handlerUserId !== receipt.handlerUserId
        ) {
          throw new ConflictException(
            "零星采购收货当前版本坐标不一致，请刷新后重试"
          );
        }
        const firstActualPayment =
          await this.findActualPaymentExecution(
            tx,
            procurementId,
            receipt.procurementVersionId
          );
        const actorScope = await this.loadReceiptActionScope(
          tx,
          actorUserId,
          receipt.projectId
        );
        const versionRevisionNos = versionRevisions.map(
          (item) => item.revisionNo
        );
        if (
          !versionRevisionNos.includes(
            receipt.currentRevisionNo
          )
        ) {
          throw new ConflictException(
            "零星采购收货版本修订链不完整，请刷新后重试"
          );
        }
        const photos =
          await tx.spotProcurementReceiptPhoto.findMany({
            where: {
              receiptId: receipt.id,
              receiptRevisionNo: {
                in: versionRevisionNos
              }
            },
            orderBy: [
              { serverRecordedAt: "asc" },
              { id: "asc" }
            ]
          });

        const userIds = [
          receipt.handlerUserId,
          receipt.submittedByUserId,
          delegation?.delegateUserId
        ].filter((value): value is string => Boolean(value));
        const users = userIds.length
          ? await tx.user.findMany({
              where: { id: { in: [...new Set(userIds)] } },
              select: { id: true, name: true }
            })
          : [];
        const userNameById = new Map(
          users.map((user) => [user.id, user.name])
        );
        const receiptLineByProcurementLineId = new Map(
          receiptLines.map((line) => [
            line.procurementLineId,
            line
          ])
        );
        const latestReview = reviews.at(-1);
        const currentFormalPdf =
          pdfDocuments.length === 1 &&
          isCurrentFormalReceiptPdfFact({
            binding: pdfDocuments[0],
            receipt,
            latestReview,
            refreshMetadata: latestPdfRefresh?.metadata
          })
            ? pdfDocuments[0]
            : null;

        return {
          receipt: {
            id: receipt.id,
            projectId: receipt.projectId,
            procurementId: receipt.procurementId,
            procurementCode: procurement.code,
            procurementVersionId: receipt.procurementVersionId,
            procurementVersionNo: version.versionNo,
            procurementVersionStatus: version.status,
            status: receipt.status,
            currentRevisionNo: receipt.currentRevisionNo,
            receiptOpen: Boolean(firstActualPayment),
            firstActualPayment: firstActualPayment
              ? {
                  executionId: firstActualPayment.id,
                  paidAt: firstActualPayment.paidAt.toISOString()
                }
              : null,
            blockedReason: firstActualPayment
              ? null
              : "待财务登记实际付款后开放收货确认",
            handler: {
              id: receipt.handlerUserId,
              name:
                userNameById.get(receipt.handlerUserId) ??
                receipt.handlerUserId
            },
            note: receipt.note,
            actualCostCents: receipt.actualCostCents.toString(),
            firstSubmittedAt: asIso(receipt.firstSubmittedAt),
            submittedAt: asIso(receipt.submittedAt),
            submittedBy: receipt.submittedByUserId
              ? {
                  id: receipt.submittedByUserId,
                  name:
                    userNameById.get(receipt.submittedByUserId) ??
                    receipt.submittedByUserId
                }
              : null,
            lockedAt: asIso(receipt.lockedAt)
          },
          delegation: delegation
            ? {
                id: delegation.id,
                delegatorUserId: delegation.delegatorUserId,
                delegateUserId: delegation.delegateUserId,
                delegateName:
                  userNameById.get(delegation.delegateUserId) ??
                  delegation.delegateUserId,
                delegatedAt: delegation.delegatedAt.toISOString()
              }
            : null,
          latestPdf: currentFormalPdf
            ? {
                documentId: currentFormalPdf.id,
                fileId: currentFormalPdf.fileId,
                templateKey: currentFormalPdf.templateKey,
                createdAt:
                  currentFormalPdf.createdAt.toISOString()
              }
            : null,
          lines: procurementLines.map((line) => {
            const received =
              receiptLineByProcurementLineId.get(line.id);
            return {
              procurementLineId: line.id,
              sortOrder: line.sortOrder,
              materialName: line.materialName,
              specification: line.specification,
              unit: line.unit,
              approvedQuantity: line.quantity.toString(),
              frozenUnitPrice: line.unitPrice?.toString() ?? null,
              qualifiedQuantity:
                received?.qualifiedQuantity.toString() ?? null,
              unqualifiedQuantity:
                received?.unqualifiedQuantity.toString() ?? null,
              unqualifiedReason:
                received?.unqualifiedReason ?? null,
              freeGiftQuantity:
                received?.freeGiftQuantity.toString() ?? null,
              replenishmentPending:
                received?.replenishmentPending ?? null,
              discrepancyNote:
                received?.discrepancyNote ?? null,
              actualCostCents:
                received?.actualCostCents.toString() ?? null
            };
          }),
          photos: photos.map((photo) => ({
            id: photo.id,
            watermarkedFileId: photo.watermarkedFileId,
            primaryFileId: photo.watermarkedFileId,
            source: photo.source,
            category: photo.category,
            note: photo.note,
            appendReason: photo.appendReason,
            uploadedByUserId: photo.uploadedByUserId,
            serverRecordedAt:
              photo.serverRecordedAt.toISOString(),
            locked: photo.lockedAt !== null
          })),
          reviews: reviews.map((review) => ({
            id: review.id,
            sequenceNo: review.sequenceNo,
            receiptRevisionNo: review.receiptRevisionNo,
            decision: review.decision,
            comment: review.comment,
            reviewedBy: {
              id: review.reviewedByUserId,
              name: review.reviewedByNameSnapshot
            },
            submissionDelegationId:
              review.submissionDelegationId,
            targetReviewId: review.targetReviewId,
            createdAt: review.createdAt.toISOString()
          })),
          discrepancy: discrepancy
            ? {
                id: discrepancy.id,
                status: discrepancy.status,
                resolutionType: discrepancy.resolutionType,
                replenishedAt: asIso(discrepancy.replenishedAt),
                refundExpectedAmountCents:
                  discrepancy.refundExpectedAmountCents.toString(),
                resolvedAt: asIso(discrepancy.resolvedAt),
                nextStep:
                  discrepancy.status === "pending_resolution"
                    ? "请由经办人选择商户补货，或由财务登记退款"
                    : null
              }
            : {
                status: "none",
                nextStep: null
              },
          availableActions: this.receiptActions({
            actorUserId,
            actorScope,
            procurement,
            version,
            receipt,
            revision,
            delegation,
            latestReview,
            discrepancy,
            firstActualPayment
          })
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead
      }
    );
  }

  private receiptActions(input: {
    actorUserId: string;
    actorScope: ReceiptActionScope;
    procurement: { id: string; projectId: string; handlerUserId: string; currentVersionId: string | null; status: string };
    version: { id: string; status: string; handlerUserId: string };
    receipt: { id: string; handlerUserId: string; procurementVersionId: string; status: string; lockedAt: Date | null };
    revision: { procurementVersionId: string; submittedAt: Date | null };
    delegation: { delegatorUserId: string; delegateUserId: string; scope: string; revokedAt: Date | null } | null;
    latestReview: { id: string; decision: string } | undefined;
    discrepancy: { status: string } | null;
    firstActualPayment: { id: string; paymentId: string; paidAt: Date } | null;
  }): DetailActionReadModel[] {
    const action = (
      key: string,
      label: string,
      kind: DetailActionReadModel["kind"],
      enabled: boolean,
      disabledReason: string
    ): DetailActionReadModel => ({
      key,
      label,
      kind,
      enabled,
      disabledReason: enabled ? null : disabledReason
    });
    const { actorScope } = input;
    const businessOpen =
      input.procurement.status === "approved_in_progress" &&
      input.version.status === "approved" &&
      input.procurement.currentVersionId === input.version.id &&
      input.receipt.procurementVersionId === input.version.id &&
      input.revision.procurementVersionId === input.version.id &&
      input.receipt.lockedAt === null &&
      Boolean(input.firstActualPayment);
    const hasConfirmRole = actorScope.effectiveRoleKeys.some((role) =>
      RECEIPT_CONFIRM_ROLES.has(role)
    );
    const isHandler = input.actorUserId === input.receipt.handlerUserId;
    const isActiveDelegate = Boolean(
      input.delegation &&
      input.delegation.revokedAt === null &&
      input.delegation.scope === "receipt_confirmation" &&
      input.delegation.delegatorUserId === input.receipt.handlerUserId &&
      input.delegation.delegateUserId === input.actorUserId &&
      actorScope.hasProjectMembership
    );
    const canConfirm =
      actorScope.active &&
      hasConfirmRole &&
      (isHandler || isActiveDelegate);
    const editable =
      businessOpen &&
      canConfirm &&
      RECEIPT_EDITABLE_STATUSES.has(input.receipt.status) &&
      input.revision.submittedAt === null;
    const photoAppendable =
      businessOpen &&
      canConfirm &&
      RECEIPT_PHOTO_APPENDABLE_STATUSES.has(input.receipt.status);
    const isMaterialDirector =
      actorScope.active &&
      actorScope.effectiveRoleKeys.includes("material_director");
    const isCurrentHandler =
      actorScope.active &&
      isHandler &&
      actorScope.effectiveRoleKeys.some((role) =>
        RECEIPT_HANDLER_ROLES.has(role)
      );
    const isProjectFinanceStaff =
      actorScope.active &&
      actorScope.effectiveRoleKeys.includes("finance_staff") &&
      actorScope.projectRoleKeys.includes("finance_staff");
    const canAppendInvoice =
      Boolean(input.firstActualPayment) &&
      actorScope.active &&
      (isHandler ||
        actorScope.effectiveRoleKeys.includes("finance_staff") ||
        actorScope.effectiveRoleKeys.includes("finance_director"));

    return [
      action("delegate_receipt", "委托收货办理", "normal", editable && isHandler, "仅当前采购经办人可在收货草稿阶段委托"),
      action("edit_receipt", "编辑收货草稿", "normal", editable, "仅当前采购经办人或有效受托人可编辑收货草稿"),
      action("append_receipt_photo", "上传收货照片", "normal", photoAppendable, "仅当前采购经办人或有效受托人可上传收货照片"),
      action("submit_receipt", "提交最终收货", "primary", editable, "仅当前采购经办人或有效受托人可提交最终收货"),
      action("review_receipt", "复核最终收货", "primary", businessOpen && isMaterialDirector && input.receipt.status === "submitted", "仅本项目物资主管可在待复核阶段办理"),
      action("revoke_receipt_review", "补货后重新确认收货", "danger", businessOpen && isMaterialDirector && input.receipt.status === "reviewed" && input.latestReview?.decision === "approved", "仅本项目物资主管可撤销当前有效复核"),
      action("initiate_discrepancy", "发起少货处理", "primary", businessOpen && isCurrentHandler && input.receipt.status === "reviewed" && !input.discrepancy, "仅当前采购经办人可对已复核收货发起少货处理"),
      action("confirm_discrepancy", "确认少货事实", "primary", businessOpen && isMaterialDirector && input.discrepancy?.status === "pending_resolution", "仅本项目物资主管可确认待处理少货事实"),
      action("record_refund", "登记退款", "primary", businessOpen && isProjectFinanceStaff && input.discrepancy?.status === "awaiting_refund", "仅本项目财务人员可登记待退款事实"),
      action("append_invoice", "追加整单发票", "normal", canAppendInvoice, "仅采购经办人或财务人员可在实际付款后追加发票")
    ];
  }

  private async loadReceiptActionScope(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<ReceiptActionScope> {
    const [actor, globalAssignments, projectAssignments, memberships, roster] =
      await Promise.all([
        tx.user.findUnique({
          where: { id: actorUserId },
          select: { id: true, isActive: true }
        }),
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
        }),
        tx.projectRosterMember.findFirst({
          where: { userId: actorUserId, projectId },
          select: { id: true }
        })
      ]);
    if (!actor?.isActive) {
      return {
        active: false,
        effectiveRoleKeys: [],
        projectRoleKeys: [],
        hasProjectMembership: false
      };
    }
    const positionIds = [
      ...new Set(
        [...globalAssignments, ...projectAssignments].map(
          (assignment) => assignment.positionId
        )
      )
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const keyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalRoleKeys = globalAssignments.flatMap((assignment) => {
      const role = keyById.get(assignment.positionId);
      return role ? [role] : [];
    });
    const projectRoleKeys = [
      ...projectAssignments.flatMap((assignment) => {
        const role = keyById.get(assignment.positionId);
        return role ? [role] : [];
      }),
      ...memberships.map((membership) => membership.positionKey as RoleKey)
    ];
    return {
      active: true,
      effectiveRoleKeys: resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys),
      projectRoleKeys: [...new Set(projectRoleKeys)],
      hasProjectMembership:
        projectAssignments.length > 0 || memberships.length > 0 || Boolean(roster)
    };
  }

  createDelegation(
    procurementId: string,
    actorUserId: string,
    input: CreateReceiptDelegationDto
  ) {
    const delegateUserId = requiredId(
      input.delegateUserId,
      "请选择收货受托人"
    );
    if (delegateUserId === actorUserId) {
      throw new BadRequestException("不能将收货确认委托给自己");
    }

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        if (context.receipt.handlerUserId !== actorUserId) {
          throw new ForbiddenException(
            "只有采购经办人可以委托他人办理收货"
          );
        }
        await this.requireActiveUser(
          tx,
          actorUserId,
          "采购经办人不存在或已停用"
        );
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertPhotoAppendable(context);
        await this.requireActiveProjectMember(
          tx,
          delegateUserId,
          context.receipt.projectId
        );

        const activeDelegation = await this.lockActiveDelegation(
          tx,
          context.receipt.id
        );
        if (
          activeDelegation?.delegatorUserId === actorUserId &&
          activeDelegation.delegateUserId === delegateUserId
        ) {
          return delegationReadModel(activeDelegation);
        }

        const now = new Date();
        if (activeDelegation) {
          await tx.spotProcurementReceiptDelegation.update({
            where: { id: activeDelegation.id },
            data: {
              revokedAt: now,
              revokedByUserId: actorUserId,
              revocationReason: "采购经办人重新指定收货受托人"
            }
          });
        }
        const delegation =
          await tx.spotProcurementReceiptDelegation.create({
            data: {
              receiptId: context.receipt.id,
              delegatorUserId: actorUserId,
              delegateUserId,
              scope: "receipt_confirmation",
              delegatedAt: now
            }
          });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.delegation.create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            receiptRevisionNo: context.receipt.currentRevisionNo,
            delegateUserId,
            replacedDelegationId: activeDelegation?.id ?? null
          }
        });
        return delegationReadModel(delegation);
      })
    );
  }

  updateDraft(
    procurementId: string,
    actorUserId: string,
    input: UpdateReceiptDraftDto
  ) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException("请填写全部收货明细");
    }
    const note = normalizeOptionalText(
      input.note,
      "收货备注",
      500
    );

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        await this.requireReceiptActor(tx, context, actorUserId);
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertDraftEditable(context);

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const paymentLinePrices =
          await this.lockPaymentLinePrices(tx, context);
        const prepared = this.prepareReceiptLines(
          input.lines,
          procurementLines,
          this.paymentLinePriceMap(paymentLinePrices)
        );
        const totalActualCostCents = sumActualCost(prepared);

        await tx.spotProcurementReceiptLine.deleteMany({
          where: {
            receiptId: context.receipt.id,
            receiptRevisionNo: context.receipt.currentRevisionNo
          }
        });
        await tx.spotProcurementReceiptLine.createMany({
          data: prepared.map((line) => ({
            receiptId: context.receipt.id,
            receiptRevisionNo:
              context.receipt.currentRevisionNo,
            procurementId,
            procurementVersionId: context.version.id,
            ...line,
            createdByUserId: actorUserId
          }))
        });
        await tx.spotProcurementReceiptRevision.update({
          where: {
            receiptId_revisionNo: {
              receiptId: context.receipt.id,
              revisionNo: context.receipt.currentRevisionNo
            }
          },
          data: {
            note,
            actualCostCents: totalActualCostCents
          }
        });
        await tx.spotProcurementReceipt.update({
          where: { id: context.receipt.id },
          data: {
            note,
            actualCostCents: totalActualCostCents
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.draft.update",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            receiptRevisionNo: context.receipt.currentRevisionNo,
            lineCount: prepared.length,
            actualCostCents: totalActualCostCents.toString(),
            replenishmentPendingCount: prepared.filter(
              (line) => line.replenishmentPending
            ).length
          }
        });
        return {
          receiptId: context.receipt.id,
          procurementId,
          status: context.receipt.status,
          currentRevisionNo: context.receipt.currentRevisionNo,
          actualCostCents: totalActualCostCents.toString(),
          lineCount: prepared.length
        };
      })
    );
  }

  async attachPhoto(
    procurementId: string,
    actorUserId: string,
    input: AttachReceiptPhotoDto
  ) {
    const originalFileId = requiredId(
      input.originalFileId,
      "请选择收货原图"
    );
    const source = requiredPhotoSource(input.source);
    const category = requiredPhotoCategory(input.category);
    const snapshot = await this.photoSnapshot(
      procurementId,
      actorUserId,
      input.note,
      input.appendReason
    );

    let original: Awaited<
      ReturnType<FileService["getOwnedVerifiedFileBuffer"]>
    >;
    try {
      original = await this.files.getOwnedVerifiedFileBuffer(
        originalFileId,
        actorUserId
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        "收货照片原图不存在、不可用或不属于当前上传人"
      );
    }
    if (
      original.file.mimeType !== "image/jpeg" &&
      original.file.mimeType !== "image/png"
    ) {
      throw new BadRequestException("收货照片原图只支持 JPEG 或 PNG");
    }
    if (
      !hasStrictImageContainerEnd(
        original.buffer,
        original.file.mimeType
      )
    ) {
      throw new BadRequestException(
        "收货照片包含无效尾部数据，请重新导出后上传"
      );
    }

    const serverRecordedAt = new Date();
    const watermarked = await this.watermark.generate({
      originalBuffer: original.buffer,
      mimeType: original.file.mimeType,
      projectLabel: snapshot.projectLabel,
      procurementCode: snapshot.procurementCode,
      uploaderName: snapshot.uploaderName,
      uploadedAt: serverRecordedAt,
      source,
      category,
      ...(snapshot.note ? { note: snapshot.note } : {})
    });

    let receiptOriginalFile: Awaited<
      ReturnType<FileService["uploadPrivateFile"]>
    >;
    try {
      receiptOriginalFile = await this.files.uploadPrivateFile({
        originalName: receiptOriginalFileName(
          snapshot.procurementCode,
          category,
          original.file.mimeType,
          serverRecordedAt
        ),
        mimeType: original.file.mimeType,
        sizeBytes: original.buffer.length,
        uploadedByUserId: actorUserId,
        buffer: original.buffer
      });
    } catch {
      throw new InternalServerErrorException(
        "收货照片专用原图保存失败，请重试"
      );
    }

    let derivedFile: Awaited<
      ReturnType<FileService["uploadPrivateFile"]>
    >;
    try {
      derivedFile = await this.files.uploadPrivateFile({
        originalName: watermarkedFileName(
          snapshot.procurementCode,
          category,
          watermarked.mimeType,
          serverRecordedAt
        ),
        mimeType: watermarked.mimeType,
        sizeBytes: watermarked.buffer.length,
        uploadedByUserId: actorUserId,
        buffer: watermarked.buffer
      });
    } catch {
      await this.quarantineGeneratedReceiptFiles(
        [receiptOriginalFile.id],
        actorUserId
      );
      throw new InternalServerErrorException(
        "收货照片水印文件保存失败，请重试"
      );
    }

    let attachedPhoto: ReturnType<typeof photoReadModel>;
    try {
      attachedPhoto = await this.runWrite(() =>
        this.runSerializable(async (tx) => {
          const context = await this.requireLockedContext(
            tx,
            procurementId
          );
          await this.requireReceiptActor(tx, context, actorUserId);
          await this.assertReceiptBusinessOpen(tx, context);
          this.assertPhotoAppendable(context);
          this.assertPhotoSnapshotCurrent(context, snapshot);
          this.assertReceiptPhotoCount(
            await this.lockReceiptPhotos(tx, context)
          );

          const appendReason = context.receipt.firstSubmittedAt
            ? requiredLimitedText(
                input.appendReason,
                "首次提交后补充照片必须填写原因",
                500,
                "补充照片原因"
              )
            : null;
          if (
            new Set([
              originalFileId,
              receiptOriginalFile.id,
              derivedFile.id
            ]).size !== 3
          ) {
            throw new ConflictException(
              "收货照片专用文件生成异常，请重新上传"
            );
          }
          const files = await this.lockFiles(tx, [
            originalFileId,
            receiptOriginalFile.id,
            derivedFile.id
          ]);
          this.assertPhotoSourceFile(
            files,
            originalFileId,
            actorUserId,
            original.file.mimeType,
            original.buffer.length,
            watermarked.originalSha256
          );
          this.assertPhotoFiles(
            files.filter(
              (file) =>
                file.id === receiptOriginalFile.id ||
                file.id === derivedFile.id
            ),
            receiptOriginalFile.id,
            derivedFile.id,
            actorUserId,
            original.buffer.length,
            watermarked
          );
          if (
            await hasNonReceiptBusinessFileBinding(tx, [
              originalFileId,
              receiptOriginalFile.id,
              derivedFile.id
            ])
          ) {
            throw new ConflictException(
              "收货照片文件已被其他业务使用，请重新上传专用原图"
            );
          }
          const occupied =
            await tx.spotProcurementReceiptPhoto.findFirst({
              where: {
                OR: [
                  {
                    originalFileId: {
                      in: [
                        originalFileId,
                        receiptOriginalFile.id,
                        derivedFile.id
                      ]
                    }
                  },
                  {
                    watermarkedFileId: {
                      in: [
                        originalFileId,
                        receiptOriginalFile.id,
                        derivedFile.id
                      ]
                    }
                  }
                ]
              },
              select: { id: true }
            });
          if (occupied) {
            throw new ConflictException(
              "该收货照片文件已被绑定，请刷新后重试"
            );
          }

          const lockedImmediately =
            context.receipt.firstSubmittedAt !== null;
          const photo =
            await tx.spotProcurementReceiptPhoto.create({
              data: {
                receiptId: context.receipt.id,
                receiptRevisionNo:
                  context.receipt.currentRevisionNo,
                originalFileId: receiptOriginalFile.id,
                watermarkedFileId: derivedFile.id,
                originalSha256: watermarked.originalSha256,
                watermarkedSha256:
                  watermarked.watermarkedSha256,
                source,
                category,
                serverRecordedAt,
                note: snapshot.note,
                uploadedByUserId: actorUserId,
                lockedAtFirstSubmission: false,
                lockedAt: lockedImmediately
                  ? serverRecordedAt
                  : null,
                appendReason
              }
            });
          await this.audit.record(tx, {
            actorUserId,
            action: "spot_procurement.receipt.photo.attach",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
            businessId: context.receipt.id,
            metadata: {
              projectId: context.receipt.projectId,
              procurementId,
              receiptRevisionNo:
                context.receipt.currentRevisionNo,
              photoId: photo.id,
              sourceUploadFileId: originalFileId,
              originalFileId: receiptOriginalFile.id,
              watermarkedFileId: derivedFile.id,
              source,
              category,
              serverRecordedAt:
                serverRecordedAt.toISOString(),
              supplemental: lockedImmediately
            }
          });
          return photoReadModel(photo);
        })
      );
    } catch (error) {
      await this.quarantineGeneratedReceiptFiles(
        [receiptOriginalFile.id, derivedFile.id],
        actorUserId
      );
      throw error;
    }
    if (attachedPhoto.appendReason) {
      await this.receiptPdfs.tryRefreshLatest(
        attachedPhoto.receiptId,
        actorUserId,
        "receipt.photo.supplement",
        {
          sourceRevisionNo:
            attachedPhoto.receiptRevisionNo
        }
      );
    }
    return attachedPhoto;
  }

  deleteDraftPhoto(
    procurementId: string,
    photoId: string,
    actorUserId: string
  ) {
    const normalizedPhotoId = requiredId(
      photoId,
      "收货照片编号不能为空"
    );
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        await this.requireReceiptActor(tx, context, actorUserId);
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertDraftEditable(context);

        const rows = await tx.$queryRaw<ReceiptPhotoLockRow[]>(
          Prisma.sql`
            SELECT
              "id",
              "receiptId",
              "receiptRevisionNo",
              "originalFileId",
              "watermarkedFileId",
              "originalSha256",
              "watermarkedSha256",
              "source",
              "category",
              "serverRecordedAt",
              "note",
              "uploadedByUserId",
              "lockedAtFirstSubmission",
              "lockedAt",
              "appendReason"
            FROM "SpotProcurementReceiptPhoto"
            WHERE "id" = ${normalizedPhotoId}
            LIMIT 1
            FOR UPDATE
          `
        );
        const photo = rows[0];
        if (
          !photo ||
          photo.receiptId !== context.receipt.id ||
          photo.receiptRevisionNo !==
            context.receipt.currentRevisionNo
        ) {
          throw new NotFoundException("收货照片不存在");
        }
        if (
          photo.lockedAt ||
          photo.lockedAtFirstSubmission ||
          context.revision.submittedAt
        ) {
          throw new ConflictException(
            "首次提交后的收货照片已锁定，不能删除"
          );
        }
        const generatedFileIds = [
          photo.originalFileId,
          photo.watermarkedFileId
        ];
        const generatedFiles = await this.lockFiles(
          tx,
          generatedFileIds
        );
        if (
          new Set(generatedFileIds).size !== 2 ||
          generatedFiles.length !== 2 ||
          generatedFiles.some(
            (file) =>
              file.storageStatus !== "active" ||
              file.uploadedByUserId !== photo.uploadedByUserId
          )
        ) {
          throw new ConflictException(
            "收货照片文件状态已变化，请刷新后重试"
          );
        }
        const otherBinding =
          await tx.spotProcurementReceiptPhoto.findFirst({
            where: {
              id: { not: photo.id },
              OR: [
                { originalFileId: { in: generatedFileIds } },
                { watermarkedFileId: { in: generatedFileIds } }
              ]
            },
            select: { id: true }
          });
        if (
          otherBinding ||
          (await hasNonReceiptBusinessFileBinding(
            tx,
            generatedFileIds
          ))
        ) {
          throw new ConflictException(
            "收货照片文件仍被其他业务使用，不能删除"
          );
        }

        await tx.spotProcurementReceiptPhoto.delete({
          where: { id: photo.id }
        });
        const quarantined = await tx.fileObject.updateMany({
          where: {
            id: { in: generatedFileIds },
            uploadedByUserId: photo.uploadedByUserId,
            storageStatus: "active"
          },
          data: { storageStatus: "quarantined" }
        });
        if (quarantined.count !== 2) {
          throw new ConflictException(
            "收货照片文件状态已变化，请刷新后重试"
          );
        }
        for (const [fileKind, fileId] of [
          ["receipt_original", photo.originalFileId],
          ["receipt_watermarked", photo.watermarkedFileId]
        ] as const) {
          await this.audit.record(tx, {
            actorUserId,
            action: "file.quarantine.receipt_photo_deleted",
            businessType: "file_object",
            businessId: fileId,
            metadata: {
              receiptId: context.receipt.id,
              photoId: photo.id,
              fileKind
            }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.photo.delete",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            receiptRevisionNo: context.receipt.currentRevisionNo,
            photoId: photo.id,
            originalFileId: photo.originalFileId,
            watermarkedFileId: photo.watermarkedFileId
          }
        });
        return {
          receiptId: context.receipt.id,
          photoId: photo.id,
          deleted: true
        };
      })
    );
  }

  submit(procurementId: string, actorUserId: string) {
    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        const delegationId = await this.requireReceiptActor(
          tx,
          context,
          actorUserId
        );
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertDraftEditable(context);

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const paymentLinePrices =
          await this.lockPaymentLinePrices(tx, context);
        const receiptLines = await this.lockReceiptLines(
          tx,
          context
        );
        const recalculated = this.validateStoredReceiptLines(
          procurementLines,
          receiptLines,
          this.paymentLinePriceMap(paymentLinePrices)
        );
        if (
          recalculated.some((line) => line.replenishmentPending)
        ) {
          throw new ConflictException(
            "仍有供应商承诺补货的明细，暂不能提交最终收货"
          );
        }

        const photos = await this.lockReceiptPhotos(tx, context);
        if (
          !photos.some(
            (photo) => photo.category === "material_scene"
          )
        ) {
          throw new ConflictException(
            "请至少上传一张材料或卸货现场照片"
          );
        }
        const fileIds = photos.flatMap((photo) => [
          photo.originalFileId,
          photo.watermarkedFileId
        ]);
        const fileRows = await this.lockFiles(tx, fileIds);
        this.assertStoredPhotoFiles(photos, fileRows);

        const totalActualCostCents =
          sumActualCost(recalculated);
        const submittedAt = new Date();
        for (const line of recalculated) {
          await tx.spotProcurementReceiptLine.update({
            where: { id: line.id },
            data: { actualCostCents: line.actualCostCents }
          });
        }
        const firstSubmissionPhotoIds = photos
          .filter((photo) => photo.lockedAt === null)
          .map((photo) => photo.id);
        if (firstSubmissionPhotoIds.length) {
          const lockedPhotos =
            await tx.spotProcurementReceiptPhoto.updateMany({
              where: {
                id: { in: firstSubmissionPhotoIds },
                lockedAt: null,
                lockedAtFirstSubmission: false
              },
              data: {
                lockedAtFirstSubmission: true,
                lockedAt: submittedAt
              }
            });
          if (
            lockedPhotos.count !==
            firstSubmissionPhotoIds.length
          ) {
            throw new ConflictException(
              "收货照片锁定状态已变化，请刷新后重试"
            );
          }
        }
        await tx.spotProcurementReceiptRevision.update({
          where: {
            receiptId_revisionNo: {
              receiptId: context.receipt.id,
              revisionNo: context.receipt.currentRevisionNo
            }
          },
          data: {
            actualCostCents: totalActualCostCents,
            submittedAt,
            submittedByUserId: actorUserId,
            submissionDelegationId: delegationId
          }
        });
        await tx.spotProcurementReceipt.update({
          where: { id: context.receipt.id },
          data: {
            status: "submitted",
            actualCostCents: totalActualCostCents,
            firstSubmittedAt:
              context.receipt.firstSubmittedAt ?? submittedAt,
            submittedAt,
            submittedByUserId: actorUserId,
            submissionDelegationId: delegationId,
            lockedAt: null
          }
        });
        await tx.spotProcurement.update({
          where: { id: procurementId },
          data: { actualCostCents: totalActualCostCents }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.submit",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            procurementVersionId: context.version.id,
            receiptRevisionNo: context.receipt.currentRevisionNo,
            handlerUserId: context.receipt.handlerUserId,
            submissionDelegationId: delegationId,
            lineCount: recalculated.length,
            photoCount: photos.length,
            actualCostCents: totalActualCostCents.toString()
          }
        });
        return {
          receiptId: context.receipt.id,
          procurementId,
          procurementVersionId: context.version.id,
          currentRevisionNo: context.receipt.currentRevisionNo,
          status: "submitted",
          handlerUserId: context.receipt.handlerUserId,
          submittedByUserId: actorUserId,
          submissionDelegationId: delegationId,
          actualCostCents: totalActualCostCents.toString(),
          submittedAt: submittedAt.toISOString()
        };
      });
      await this.receiptPdfs.tryRefreshLatest(
        result.receiptId,
        actorUserId,
        "receipt.submit",
        { sourceRevisionNo: result.currentRevisionNo }
      );
      return result;
    });
  }

  review(
    procurementId: string,
    actorUserId: string,
    input: ReviewReceiptDto
  ) {
    if (
      !RECEIPT_REVIEW_DECISIONS.includes(input.decision)
    ) {
      throw new BadRequestException("收货复核结论不正确");
    }
    const comment = normalizeOptionalText(
      input.comment,
      "收货复核意见",
      500
    );
    if (input.decision === "returned" && !comment) {
      throw new BadRequestException(
        "退回收货确认必须填写原因"
      );
    }

    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        const reviewer = await this.requireMaterialDirector(
          tx,
          actorUserId,
          context.receipt.projectId
        );
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertReceiptSubmissionCoordinates(
          context,
          "submitted",
          "当前收货确认不是待物资主管复核的完整提交"
        );

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const paymentLinePrices =
          await this.lockPaymentLinePrices(tx, context);
        const storedLines = await this.lockReceiptLines(
          tx,
          context
        );
        const receiptLines = this.validateStoredReceiptLines(
          procurementLines,
          storedLines,
          this.paymentLinePriceMap(paymentLinePrices)
        );
        const photos = await this.lockReceiptPhotos(
          tx,
          context
        );
        const latestReview =
          await this.lockLatestReceiptReview(
            tx,
            context.receipt.id
          );
        await this.assertReceiptReviewFacts(
          context,
          receiptLines,
          photos,
          tx
        );

        if (
          latestReview?.decision === "approved" &&
          latestReview.receiptRevisionNo ===
            context.receipt.currentRevisionNo &&
          latestReview.procurementId ===
            context.procurement.id &&
          latestReview.procurementVersionId ===
            context.version.id
        ) {
          throw new ConflictException(
            "当前收货确认已有有效复核，不能重复复核"
          );
        }
        const review =
          await tx.spotProcurementReceiptReview.create({
            data: {
              receiptId: context.receipt.id,
              receiptRevisionNo:
                context.receipt.currentRevisionNo,
              procurementId: context.procurement.id,
              procurementVersionId: context.version.id,
              sequenceNo: (latestReview?.sequenceNo ?? 0) + 1,
              decision: input.decision,
              comment,
              reviewedByUserId: actorUserId,
              reviewedByNameSnapshot: reviewer.name,
              submissionDelegationId:
                context.receipt.submissionDelegationId,
              targetReviewId: null
            }
          });

        let currentRevisionNo =
          context.receipt.currentRevisionNo;
        let replenishmentResolvedDiscrepancyCount = 0;
        if (input.decision === "approved") {
          await tx.spotProcurementReceipt.update({
            where: { id: context.receipt.id },
            data: { status: "reviewed" }
          });
          const replenishmentResolved =
            await tx.spotProcurementDiscrepancy.updateMany({
              where: {
                receiptId: context.receipt.id,
                status: "awaiting_replenishment",
                resolutionType: "replenishment",
                invalidatedAt: null
              },
              data: {
                status: "invalidated",
                replenishedAt: new Date(),
                replenishedByUserId: actorUserId,
                replenishmentNote:
                  comment ?? "商户补货后收货修订复核通过",
                invalidatedAt: new Date(),
                invalidatedByUserId: actorUserId,
                invalidationReason:
                  "商户补货后收货修订复核通过"
              }
            });
          replenishmentResolvedDiscrepancyCount =
            replenishmentResolved.count;
        } else {
          currentRevisionNo =
            await this.advanceReceiptCorrectionRevision(
              tx,
              context,
              receiptLines,
              actorUserId,
              "returned"
            );
        }
        await this.audit.record(tx, {
          actorUserId,
          action: `spot_procurement.receipt.review.${input.decision}`,
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            procurementVersionId: context.version.id,
            reviewedReceiptRevisionNo:
              context.receipt.currentRevisionNo,
            currentReceiptRevisionNo: currentRevisionNo,
            reviewId: review.id,
            sequenceNo: review.sequenceNo,
            decision: input.decision,
            replenishmentResolvedDiscrepancyCount,
            submissionDelegationId:
              context.receipt.submissionDelegationId
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          procurementId,
          `receipt.review.${input.decision}`,
          actorUserId
        );
        return {
          receiptId: context.receipt.id,
          procurementId,
          procurementVersionId: context.version.id,
          reviewId: review.id,
          sequenceNo: review.sequenceNo,
          decision: input.decision,
          comment,
          reviewedByUserId: actorUserId,
          reviewedReceiptRevisionNo:
            context.receipt.currentRevisionNo,
          currentReceiptRevisionNo: currentRevisionNo,
          status:
            input.decision === "approved"
              ? "reviewed"
              : "returned",
          reviewedAt: review.createdAt.toISOString()
        };
      });
      await this.receiptPdfs.tryRefreshLatest(
        result.receiptId,
        actorUserId,
        `receipt.review.${result.decision}`,
        {
          sourceRevisionNo:
            result.reviewedReceiptRevisionNo,
          reviewId: result.reviewId
        }
      );
      if (result.decision === "approved") {
        await this.tryArchiveProcurementPayments(
          procurementId,
          actorUserId,
          "procurement.normal_closure.check"
        );
      }
      return result;
    });
  }

  private async tryArchiveProcurementPayments(
    procurementId: string,
    actorUserId: string,
    trigger: string
  ): Promise<void> {
    if (!this.archives) return;
    const payments = await this.prisma.spotProcurementPayment.findMany({
      where: { procurementId },
      select: { id: true }
    });
    await Promise.all(
      payments.map((payment) =>
        this.archives!.tryCreateVersion(payment.id, actorUserId, trigger)
      )
    );
  }

  revokeReview(
    procurementId: string,
    actorUserId: string,
    input: RevokeReceiptReviewDto
  ) {
    const targetReviewId = requiredId(
      input.targetReviewId,
      "请选择需要撤销的收货复核"
    );
    const reason = requiredLimitedText(
      input.reason,
      "撤销收货复核必须填写原因",
      500,
      "撤销收货复核原因"
    );
    if (input.confirmReviewRevocation !== true) {
      throw new BadRequestException(
        "请明确确认撤销本次收货复核"
      );
    }

    return this.runWrite(async () => {
      const result = await this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        const reviewer = await this.requireMaterialDirector(
          tx,
          actorUserId,
          context.receipt.projectId
        );
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertReceiptSubmissionCoordinates(
          context,
          "reviewed",
          "当前收货确认没有可撤销的有效复核"
        );

        const latestReview =
          await this.lockLatestReceiptReview(
            tx,
            context.receipt.id
          );
        if (
          !latestReview ||
          latestReview.id !== targetReviewId ||
          latestReview.decision !== "approved" ||
          latestReview.receiptRevisionNo !==
            context.receipt.currentRevisionNo ||
          latestReview.procurementId !== context.procurement.id ||
          latestReview.procurementVersionId !== context.version.id
        ) {
          throw new ConflictException(
            "只能撤销当前有效且坐标一致的收货复核"
          );
        }
        const activeDiscrepancy =
          await tx.spotProcurementDiscrepancy.findFirst({
            where: {
              receiptId: context.receipt.id,
              invalidatedAt: null
            },
            select: {
              id: true,
              status: true,
              resolutionType: true
            }
          });
        if (
          activeDiscrepancy &&
          !(
            activeDiscrepancy.status ===
              "awaiting_replenishment" &&
            activeDiscrepancy.resolutionType === "replenishment"
          )
        ) {
          throw new ConflictException(
            "当前收货复核已形成差异结算事实，不能撤销"
          );
        }
        const [
          activeInvoiceAllocation,
          activeNoInvoiceConfirmation,
          activeInvoiceException
        ] = await Promise.all([
          tx.invoiceAllocation.findFirst({
            where: {
              receiptId: context.receipt.id,
              invalidatedAt: null
            },
            select: { id: true }
          }),
          tx.noInvoiceConfirmation.findFirst({
            where: {
              receiptId: context.receipt.id,
              status: { in: ["pending_review", "confirmed"] }
            },
            select: { id: true }
          }),
          tx.invoiceExceptionConfirmation.findFirst({
            where: {
              receiptId: context.receipt.id,
              status: { in: ["pending_review", "confirmed"] }
            },
            select: { id: true }
          })
        ]);
        if (
          activeInvoiceAllocation ||
          activeNoInvoiceConfirmation ||
          activeInvoiceException
        ) {
          throw new ConflictException(
            "当前收货复核已形成有效或待复核票据事实，请先冲销、退回或解除后再撤销复核"
          );
        }

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const paymentLinePrices =
          await this.lockPaymentLinePrices(tx, context);
        const receiptLines = this.validateStoredReceiptLines(
          procurementLines,
          await this.lockReceiptLines(tx, context),
          this.paymentLinePriceMap(paymentLinePrices)
        );
        const review =
          await tx.spotProcurementReceiptReview.create({
            data: {
              receiptId: context.receipt.id,
              receiptRevisionNo:
                context.receipt.currentRevisionNo,
              procurementId: context.procurement.id,
              procurementVersionId: context.version.id,
              sequenceNo: latestReview.sequenceNo + 1,
              decision: "revoked",
              comment: reason,
              reviewedByUserId: actorUserId,
              reviewedByNameSnapshot: reviewer.name,
              submissionDelegationId:
                context.receipt.submissionDelegationId,
              targetReviewId: latestReview.id
            }
          });
        const currentRevisionNo =
          await this.advanceReceiptCorrectionRevision(
            tx,
            context,
            receiptLines,
            actorUserId,
            "review_revoked"
          );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.review.revoked",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: context.receipt.id,
          metadata: {
            projectId: context.receipt.projectId,
            procurementId,
            procurementVersionId: context.version.id,
            revokedReceiptRevisionNo:
              context.receipt.currentRevisionNo,
            currentReceiptRevisionNo: currentRevisionNo,
            reviewId: review.id,
            targetReviewId: latestReview.id,
            sequenceNo: review.sequenceNo,
            explicitConfirmation: true
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          procurementId,
          "receipt.review.revoked",
          actorUserId
        );
        return {
          receiptId: context.receipt.id,
          procurementId,
          procurementVersionId: context.version.id,
          reviewId: review.id,
          targetReviewId: latestReview.id,
          sequenceNo: review.sequenceNo,
          decision: "revoked",
          reason,
          reviewedByUserId: actorUserId,
          revokedReceiptRevisionNo:
            context.receipt.currentRevisionNo,
          currentReceiptRevisionNo: currentRevisionNo,
          status: "review_revoked",
          reviewedAt: review.createdAt.toISOString()
        };
      });
      await this.receiptPdfs.tryRefreshLatest(
        result.receiptId,
        actorUserId,
        "receipt.review.revoked",
        {
          sourceRevisionNo:
            result.revokedReceiptRevisionNo,
          reviewId: result.reviewId
        }
      );
      return result;
    });
  }

  retryFormalPdf(
    procurementId: string,
    actorUserId: string
  ) {
    return this.runWrite(async () => {
      const target = await this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        await this.requireMaterialDirector(
          tx,
          actorUserId,
          context.receipt.projectId
        );
        this.pilot.assertEnabled(context.receipt.projectId);
        if (
          context.receipt.status !== "reviewed" &&
          context.receipt.status !== "locked"
        ) {
          throw new ConflictException(
            "只有复核通过或已办结锁定的收货确认可以重试生成正式 PDF"
          );
        }
        if (
          context.receipt.procurementVersionId !==
            context.version.id ||
          context.revision.procurementVersionId !==
            context.version.id
        ) {
          throw new ConflictException(
            "收货单与当前采购版本不一致，请刷新后重试"
          );
        }
        this.assertReceiptSubmissionCoordinates(
          context,
          context.receipt.status,
          "当前收货确认缺少完整的已提交事实"
        );

        const latestReview =
          await this.lockLatestReceiptReview(
            tx,
            context.receipt.id
          );
        if (
          !latestReview ||
          latestReview.decision !== "approved" ||
          latestReview.receiptRevisionNo !==
            context.receipt.currentRevisionNo ||
          latestReview.procurementId !== context.procurement.id ||
          latestReview.procurementVersionId !== context.version.id
        ) {
          throw new ConflictException(
            "当前收货确认缺少坐标一致的有效复核，不能生成正式 PDF"
          );
        }
        return {
          receiptId: context.receipt.id,
          sourceRevisionNo:
            context.receipt.currentRevisionNo,
          reviewId: latestReview.id
        };
      });

      const document = await this.receiptPdfs.refreshLatest(
        target.receiptId,
        actorUserId,
        "receipt.pdf.manual_retry",
        {
          sourceRevisionNo: target.sourceRevisionNo,
          reviewId: target.reviewId
        }
      );
      if (!document) {
        throw new InternalServerErrorException(
          "正式收货 PDF 生成结果缺失，请稍后重试"
        );
      }
      return {
        receiptId: target.receiptId,
        documentId: document.id,
        fileId: document.fileId,
        templateKey: document.templateKey
      };
    });
  }

  private async photoSnapshot(
    procurementId: string,
    actorUserId: string,
    noteInput: string | undefined,
    appendReasonInput: string | undefined
  ): Promise<PhotoSnapshot> {
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        await this.requireReceiptActor(tx, context, actorUserId);
        await this.assertReceiptBusinessOpen(tx, context);
        this.assertPhotoAppendable(context);
        this.assertReceiptPhotoCount(
          await this.lockReceiptPhotos(tx, context)
        );

        const note = normalizeOptionalText(
          noteInput,
          "收货照片备注",
          300
        );
        const appendReason = context.receipt.firstSubmittedAt
          ? requiredLimitedText(
              appendReasonInput,
              "首次提交后补充照片必须填写原因",
              500,
              "补充照片原因"
            )
          : null;
        const [project, uploader] = await Promise.all([
          tx.project.findUnique({
            where: { id: context.receipt.projectId },
            select: { code: true, name: true, isActive: true }
          }),
          tx.user.findUnique({
            where: { id: actorUserId },
            select: { name: true, isActive: true }
          })
        ]);
        if (!project?.isActive) {
          throw new ConflictException("项目不存在或已停用");
        }
        if (!uploader?.isActive) {
          throw new ForbiddenException("当前上传人不存在或已停用");
        }
        return {
          receiptId: context.receipt.id,
          revisionNo: context.receipt.currentRevisionNo,
          procurementVersionId: context.version.id,
          revisionSubmittedAt:
            context.revision.submittedAt?.getTime() ?? null,
          firstSubmittedAt:
            context.receipt.firstSubmittedAt?.getTime() ?? null,
          projectLabel: `${project.name}（${project.code}）`,
          procurementCode: context.procurement.code,
          uploaderName: uploader.name,
          note,
          appendReason
        };
      })
    );
  }

  private prepareReceiptLines(
    inputs: UpdateReceiptDraftLineDto[],
    procurementLines: ProcurementLineLockRow[],
    paymentLinePrices: Map<string, Prisma.Decimal>
  ): PreparedReceiptLine[] {
    if (inputs.length !== procurementLines.length) {
      throw new BadRequestException(
        "收货明细必须完整对应当前采购版本全部明细"
      );
    }
    const inputByLineId = new Map<string, UpdateReceiptDraftLineDto>();
    for (const input of inputs) {
      const lineId = requiredId(
        input.procurementLineId,
        "采购明细编号不能为空"
      );
      if (inputByLineId.has(lineId)) {
        throw new BadRequestException("收货明细不能重复");
      }
      inputByLineId.set(lineId, input);
    }

    return procurementLines.map((procurementLine) => {
      const input = inputByLineId.get(procurementLine.id);
      if (!input) {
        throw new BadRequestException(
          "收货明细必须完整对应当前采购版本全部明细"
        );
      }
      const qualifiedQuantity = parseReceiptQuantity(
        input.qualifiedQuantity
      );
      const unqualifiedQuantity = parseReceiptQuantity(
        input.unqualifiedQuantity
      );
      const freeGiftQuantity = parseReceiptQuantity(
        input.freeGiftQuantity
      );
      if (qualifiedQuantity.gt(procurementLine.quantity)) {
        throw new BadRequestException(
          "合格数量不能大于审批数量"
        );
      }
      const unqualifiedReason = normalizeOptionalText(
        input.unqualifiedReason,
        "不合格原因",
        500
      );
      if (unqualifiedQuantity.gt(0) && !unqualifiedReason) {
        throw new BadRequestException(
          "存在不合格数量时必须填写不合格原因"
        );
      }
      if (typeof input.replenishmentPending !== "boolean") {
        throw new BadRequestException(
          "待补货标记格式不正确"
        );
      }
      return {
        procurementLineId: procurementLine.id,
        approvedQuantitySnapshot: procurementLine.quantity,
        qualifiedQuantity,
        unqualifiedQuantity,
        unqualifiedReason,
        freeGiftQuantity,
        replenishmentPending: input.replenishmentPending,
        discrepancyNote: normalizeOptionalText(
          input.discrepancyNote,
          "收货差异说明",
          500
        ),
        actualCostCents: calculateReceiptActualCostCents(
          qualifiedQuantity,
          this.receiptUnitPrice(procurementLine, paymentLinePrices)
        )
      };
    });
  }

  private validateStoredReceiptLines(
    procurementLines: ProcurementLineLockRow[],
    receiptLines: ReceiptLineLockRow[],
    paymentLinePrices: Map<string, Prisma.Decimal>
  ): Array<ReceiptLineLockRow & { actualCostCents: bigint }> {
    if (
      procurementLines.length === 0 ||
      receiptLines.length !== procurementLines.length
    ) {
      throw new ConflictException(
        "请先完整填写当前采购版本全部收货明细"
      );
    }
    const procurementById = new Map(
      procurementLines.map((line) => [line.id, line])
    );
    const seen = new Set<string>();
    return receiptLines.map((line) => {
      const procurementLine = procurementById.get(
        line.procurementLineId
      );
      if (
        !procurementLine ||
        seen.has(line.procurementLineId) ||
        line.procurementVersionId !== procurementLine.versionId
      ) {
        throw new ConflictException(
          "收货明细与当前采购版本不一致"
        );
      }
      seen.add(line.procurementLineId);
      if (
        !line.approvedQuantitySnapshot.eq(
          procurementLine.quantity
        )
      ) {
        throw new ConflictException(
          "收货审批数量快照与当前采购版本不一致"
        );
      }
      if (line.qualifiedQuantity.gt(procurementLine.quantity)) {
        throw new ConflictException(
          "合格数量不能大于审批数量"
        );
      }
      if (
        line.unqualifiedQuantity.gt(0) &&
        !line.unqualifiedReason?.trim()
      ) {
        throw new ConflictException(
          "存在不合格数量时必须填写不合格原因"
        );
      }
      return {
        ...line,
        actualCostCents: calculateReceiptActualCostCents(
          line.qualifiedQuantity,
          this.receiptUnitPrice(procurementLine, paymentLinePrices)
        )
      };
    });
  }

  private assertStoredPhotoFiles(
    photos: ReceiptPhotoLockRow[],
    files: FileLockRow[]
  ) {
    const boundFileIds = photos.flatMap((photo) => [
      photo.originalFileId,
      photo.watermarkedFileId
    ]);
    if (
      new Set(boundFileIds).size !== boundFileIds.length ||
      files.length !== boundFileIds.length
    ) {
      throw new ConflictException("收货照片文件绑定存在重复");
    }
    const fileById = new Map(files.map((file) => [file.id, file]));
    for (const photo of photos) {
      const original = fileById.get(photo.originalFileId);
      const watermarked = fileById.get(photo.watermarkedFileId);
      if (
        !original ||
        !watermarked ||
        original.storageStatus !== "active" ||
        watermarked.storageStatus !== "active" ||
        original.uploadedByUserId !== photo.uploadedByUserId ||
        watermarked.uploadedByUserId !== photo.uploadedByUserId ||
        original.contentSha256 !== photo.originalSha256 ||
        watermarked.contentSha256 !== photo.watermarkedSha256 ||
        !SHA256_PATTERN.test(photo.originalSha256) ||
        !SHA256_PATTERN.test(photo.watermarkedSha256) ||
        !isSupportedImageMime(original.mimeType) ||
        watermarked.mimeType !== original.mimeType ||
        original.sizeBytes <= 0 ||
        watermarked.sizeBytes <= 0
      ) {
        throw new ConflictException(
          "收货照片文件状态或完整性校验失败"
        );
      }
    }
  }

  private assertPhotoFiles(
    files: FileLockRow[],
    originalFileId: string,
    watermarkedFileId: string,
    actorUserId: string,
    originalSizeBytes: number,
    watermarked: ReceiptWatermarkOutput
  ) {
    if (files.length !== 2) {
      throw new ConflictException(
        "收货原图或水印图状态已变化，请刷新后重试"
      );
    }
    const fileById = new Map(files.map((file) => [file.id, file]));
    const original = fileById.get(originalFileId);
    const derived = fileById.get(watermarkedFileId);
    if (
      !original ||
      !derived ||
      original.storageStatus !== "active" ||
      derived.storageStatus !== "active" ||
      original.uploadedByUserId !== actorUserId ||
      derived.uploadedByUserId !== actorUserId ||
      original.mimeType !== watermarked.mimeType ||
      derived.mimeType !== watermarked.mimeType ||
      original.sizeBytes !== originalSizeBytes ||
      derived.sizeBytes !== watermarked.buffer.length ||
      original.contentSha256 !== watermarked.originalSha256 ||
      derived.contentSha256 !== watermarked.watermarkedSha256 ||
      !SHA256_PATTERN.test(watermarked.originalSha256) ||
      !SHA256_PATTERN.test(watermarked.watermarkedSha256)
    ) {
      throw new ConflictException(
        "收货原图或水印图状态已变化，请重新上传"
      );
    }
  }

  private assertPhotoSourceFile(
    files: FileLockRow[],
    sourceFileId: string,
    actorUserId: string,
    mimeType: string,
    sizeBytes: number,
    sha256: string
  ) {
    const source = files.find(
      (file) => file.id === sourceFileId
    );
    if (
      !source ||
      source.storageStatus !== "active" ||
      source.uploadedByUserId !== actorUserId ||
      source.mimeType !== mimeType ||
      source.sizeBytes !== sizeBytes ||
      source.contentSha256 !== sha256 ||
      !SHA256_PATTERN.test(sha256)
    ) {
      throw new ConflictException(
        "收货照片上传源文件状态已变化，请重新上传"
      );
    }
  }

  private assertPhotoSnapshotCurrent(
    context: LockedReceiptContext,
    snapshot: PhotoSnapshot
  ) {
    if (
      context.receipt.id !== snapshot.receiptId ||
      context.receipt.currentRevisionNo !== snapshot.revisionNo ||
      context.version.id !== snapshot.procurementVersionId ||
      (context.revision.submittedAt?.getTime() ?? null) !==
        snapshot.revisionSubmittedAt ||
      (context.receipt.firstSubmittedAt?.getTime() ?? null) !==
        snapshot.firstSubmittedAt
    ) {
      throw new ConflictException(
        "收货单在生成水印期间已变化，请刷新后重试"
      );
    }
  }

  private async assertReceiptBusinessOpen(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext
  ) {
    this.pilot.assertEnabled(context.procurement.projectId);
    if (
      context.procurement.status !== "approved_in_progress" ||
      context.version.status !== "approved"
    ) {
      throw new ConflictException(
        "当前采购不是已审批办理中的有效版本"
      );
    }
    if (
      context.procurement.currentVersionId !== context.version.id ||
      context.receipt.procurementVersionId !== context.version.id ||
      context.revision.procurementVersionId !== context.version.id
    ) {
      throw new ConflictException(
        "收货单与当前采购版本不一致，请刷新后重试"
      );
    }
    if (
      context.procurement.handlerUserId !==
        context.version.handlerUserId ||
      context.receipt.handlerUserId !==
        context.version.handlerUserId ||
      context.revision.handlerUserId !==
        context.receipt.handlerUserId
    ) {
      throw new ConflictException(
        "收货经办人与当前采购版本不一致，请刷新后重试"
      );
    }
    if (context.receipt.status === "locked") {
      throw new ConflictException("收货单已锁定，不能继续修改");
    }
    const execution = await this.findActualPaymentExecution(
      tx,
      context.procurement.id,
      context.version.id
    );
    if (!execution) {
      throw new ConflictException(
        "尚未登记实际付款，暂不能办理收货确认"
      );
    }
  }

  private assertDraftEditable(context: LockedReceiptContext) {
    if (
      !RECEIPT_EDITABLE_STATUSES.has(context.receipt.status) ||
      context.revision.submittedAt !== null
    ) {
      throw new ConflictException(
        "当前收货单不是可编辑草稿"
      );
    }
  }

  private assertPhotoAppendable(context: LockedReceiptContext) {
    if (
      !RECEIPT_PHOTO_APPENDABLE_STATUSES.has(
        context.receipt.status
      )
    ) {
      throw new ConflictException(
        "当前收货状态不能补充照片"
      );
    }
  }

  private assertReceiptPhotoCount(
    photos: ReceiptPhotoLockRow[]
  ): void {
    if (
      photos.length >=
      SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT
    ) {
      throw new ConflictException(
        `每笔零星采购最多上传 ${SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT} 张收货照片`
      );
    }
  }

  private assertReceiptSubmissionCoordinates(
    context: LockedReceiptContext,
    expectedStatus: "submitted" | "reviewed" | "locked",
    message: string
  ) {
    if (
      context.receipt.status !== expectedStatus ||
      !context.receipt.firstSubmittedAt ||
      !context.receipt.submittedAt ||
      !context.receipt.submittedByUserId ||
      !context.revision.submittedAt ||
      !context.revision.submittedByUserId ||
      context.receipt.submittedAt.getTime() !==
        context.revision.submittedAt.getTime() ||
      context.receipt.submittedByUserId !==
        context.revision.submittedByUserId ||
      context.receipt.submissionDelegationId !==
        context.revision.submissionDelegationId
    ) {
      throw new ConflictException(message);
    }
  }

  private async assertReceiptReviewFacts(
    context: LockedReceiptContext,
    receiptLines: Array<
      ReceiptLineLockRow & { actualCostCents: bigint }
    >,
    photos: ReceiptPhotoLockRow[],
    tx: Prisma.TransactionClient
  ) {
    if (
      photos.length >
      SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT
    ) {
      throw new ConflictException("收货照片数量超过系统上限");
    }
    if (
      receiptLines.some((line) => line.replenishmentPending)
    ) {
      throw new ConflictException(
        "仍有供应商承诺补货的明细，暂不能复核"
      );
    }
    const actualCostCents = sumActualCost(receiptLines);
    if (
      actualCostCents !== context.receipt.actualCostCents ||
      actualCostCents !== context.revision.actualCostCents ||
      context.procurement.actualCostCents !== actualCostCents
    ) {
      throw new ConflictException(
        "收货实际成本事实不一致，请刷新后重试"
      );
    }
    if (
      !photos.some(
        (photo) => photo.category === "material_scene"
      ) ||
      photos.some((photo) => photo.lockedAt === null)
    ) {
      throw new ConflictException(
        "收货照片证据不完整或尚未锁定"
      );
    }
    const fileRows = await this.lockFiles(
      tx,
      photos.flatMap((photo) => [
        photo.originalFileId,
        photo.watermarkedFileId
      ])
    );
    this.assertStoredPhotoFiles(photos, fileRows);
  }

  private async advanceReceiptCorrectionRevision(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext,
    receiptLines: Array<
      ReceiptLineLockRow & { actualCostCents: bigint }
    >,
    actorUserId: string,
    status: "returned" | "review_revoked"
  ): Promise<number> {
    const nextRevisionNo =
      context.receipt.currentRevisionNo + 1;
    await tx.spotProcurementReceiptRevision.create({
      data: {
        receiptId: context.receipt.id,
        revisionNo: nextRevisionNo,
        procurementId: context.procurement.id,
        procurementVersionId: context.version.id,
        handlerUserId: context.receipt.handlerUserId,
        note: context.revision.note,
        actualCostCents: context.revision.actualCostCents,
        submittedAt: null,
        submittedByUserId: null,
        submissionDelegationId: null,
        createdByUserId: actorUserId
      }
    });
    await tx.spotProcurementReceiptLine.createMany({
      data: receiptLines.map((line) => ({
        receiptId: context.receipt.id,
        receiptRevisionNo: nextRevisionNo,
        procurementId: context.procurement.id,
        procurementVersionId: context.version.id,
        procurementLineId: line.procurementLineId,
        approvedQuantitySnapshot:
          line.approvedQuantitySnapshot,
        qualifiedQuantity: line.qualifiedQuantity,
        unqualifiedQuantity: line.unqualifiedQuantity,
        unqualifiedReason: line.unqualifiedReason,
        freeGiftQuantity: line.freeGiftQuantity,
        replenishmentPending: line.replenishmentPending,
        discrepancyNote: line.discrepancyNote,
        actualCostCents: line.actualCostCents,
        createdByUserId: actorUserId
      }))
    });
    await tx.spotProcurementReceipt.update({
      where: { id: context.receipt.id },
      data: {
        status,
        currentRevisionNo: nextRevisionNo,
        submittedAt: null,
        submittedByUserId: null,
        submissionDelegationId: null,
        lockedAt: null
      }
    });
    return nextRevisionNo;
  }

  private async lockLatestReceiptReview(
    tx: Prisma.TransactionClient,
    receiptId: string
  ): Promise<ReceiptReviewLockRow | null> {
    const rows = await tx.$queryRaw<
      ReceiptReviewLockRow[]
    >(Prisma.sql`
      SELECT
        "id",
        "receiptId",
        "receiptRevisionNo",
        "procurementId",
        "procurementVersionId",
        "sequenceNo",
        "decision",
        "comment",
        "reviewedByUserId",
        "submissionDelegationId",
        "targetReviewId",
        "createdAt"
      FROM "SpotProcurementReceiptReview"
      WHERE "receiptId" = ${receiptId}
      ORDER BY "sequenceNo" DESC
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async requireMaterialDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ) {
    const reviewer = await this.requireActiveUser(
      tx,
      actorUserId,
      "当前物资主管不存在或已停用"
    );
    const [
      globalAssignments,
      projectAssignments,
      memberships
    ] = await Promise.all([
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
        [...globalAssignments, ...projectAssignments].map(
          (assignment) => assignment.positionId
        )
      )
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const globalPositionIds = new Set(
      globalAssignments.map(
        (assignment) => assignment.positionId
      )
    );
    const projectPositionIds = new Set(
      projectAssignments.map(
        (assignment) => assignment.positionId
      )
    );
    const effectiveRoles = resolveEffectiveRoleKeys(
      positions
        .filter((position) =>
          globalPositionIds.has(position.id)
        )
        .map((position) => position.key as RoleKey),
      [
        ...positions
          .filter((position) =>
            projectPositionIds.has(position.id)
          )
          .map((position) => position.key as RoleKey),
        ...memberships.map(
          (membership) => membership.positionKey as RoleKey
        )
      ]
    );
    if (!effectiveRoles.includes("material_director")) {
      throw new ForbiddenException(
        "只有本项目物资主管可以复核收货"
      );
    }
    return reviewer;
  }

  private async requireReceiptActor(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext,
    actorUserId: string
  ): Promise<string | null> {
    await this.requireActiveUser(
      tx,
      actorUserId,
      "当前操作人不存在或已停用"
    );
    if (actorUserId === context.receipt.handlerUserId) {
      return null;
    }
    const delegation = await this.lockActiveDelegation(
      tx,
      context.receipt.id
    );
    if (
      !delegation ||
      delegation.delegatorUserId !==
        context.receipt.handlerUserId ||
      delegation.delegateUserId !== actorUserId ||
      delegation.scope !== "receipt_confirmation"
    ) {
      throw new ForbiddenException(
        "只有采购经办人或当前有效受托人可以办理收货"
      );
    }
    await this.requireActiveProjectMember(
      tx,
      actorUserId,
      context.receipt.projectId
    );
    return delegation.id;
  }

  private async requireActiveProjectMember(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string
  ) {
    await this.requireActiveUser(
      tx,
      userId,
      "收货受托人不存在或已停用"
    );
    const [position, member, roster] = await Promise.all([
      tx.userPosition.findFirst({
        where: { userId, projectId },
        select: { id: true }
      }),
      tx.projectMember.findFirst({
        where: { userId, projectId },
        select: { id: true }
      }),
      tx.projectRosterMember.findFirst({
        where: { userId, projectId },
        select: { id: true }
      })
    ]);
    if (!position && !member && !roster) {
      throw new BadRequestException(
        "只能委托本项目启用人员办理收货"
      );
    }
  }

  private async requireActiveUser(
    tx: Prisma.TransactionClient,
    userId: string,
    message: string
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, isActive: true }
    });
    if (!user?.isActive) {
      throw new ForbiddenException(message);
    }
    return user;
  }

  private async requireLockedContext(
    tx: Prisma.TransactionClient,
    procurementId: string
  ): Promise<LockedReceiptContext> {
    const procurementRows =
      await tx.$queryRaw<ProcurementLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "projectId",
          "code",
          "applicantUserId",
          "handlerUserId",
          "currentVersionId",
          "status",
          "actualCostCents"
        FROM "SpotProcurement"
        WHERE "id" = ${procurementId}
        LIMIT 1
        FOR UPDATE
      `);
    const procurement = procurementRows[0];
    if (!procurement) {
      throw new NotFoundException("零星采购不存在");
    }
    if (!procurement.currentVersionId) {
      throw new ConflictException("零星采购缺少当前版本");
    }

    const versionRows = await tx.$queryRaw<VersionLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "procurementId",
          "versionNo",
          "status",
          "handlerUserId",
          "totalAmountCents"
        FROM "SpotProcurementVersion"
        WHERE "id" = ${procurement.currentVersionId}
          AND "procurementId" = ${procurement.id}
        LIMIT 1
        FOR UPDATE
      `
    );
    const version = versionRows[0];
    if (!version) {
      throw new ConflictException(
        "零星采购当前版本不存在或归属不正确"
      );
    }

    const receiptRows = await tx.$queryRaw<ReceiptLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "status",
          "currentRevisionNo",
          "handlerUserId",
          "note",
          "actualCostCents",
          "firstSubmittedAt",
          "submittedAt",
          "submittedByUserId",
          "submissionDelegationId",
          "lockedAt"
        FROM "SpotProcurementReceipt"
        WHERE "procurementId" = ${procurement.id}
        LIMIT 1
        FOR UPDATE
      `
    );
    const receipt = receiptRows[0];
    if (!receipt) {
      throw new ConflictException(
        "采购审批完成后尚未生成最终收货单"
      );
    }
    if (
      receipt.projectId !== procurement.projectId ||
      receipt.procurementId !== procurement.id
    ) {
      throw new ConflictException("零星采购收货单归属不正确");
    }

    const revisionRows =
      await tx.$queryRaw<ReceiptRevisionLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "receiptId",
          "revisionNo",
          "procurementId",
          "procurementVersionId",
          "handlerUserId",
          "note",
          "actualCostCents",
          "submittedAt",
          "submittedByUserId",
          "submissionDelegationId"
        FROM "SpotProcurementReceiptRevision"
        WHERE "receiptId" = ${receipt.id}
          AND "revisionNo" = ${receipt.currentRevisionNo}
          AND "procurementId" = ${procurement.id}
        LIMIT 1
        FOR UPDATE
      `);
    const revision = revisionRows[0];
    if (!revision) {
      throw new ConflictException(
        "零星采购当前收货修订不存在"
      );
    }
    return { procurement, version, receipt, revision };
  }

  private lockProcurementLines(
    tx: Prisma.TransactionClient,
    versionId: string
  ) {
    return tx.$queryRaw<ProcurementLineLockRow[]>(Prisma.sql`
      SELECT
        "id",
        "versionId",
        "sortOrder",
        "materialName",
        "specification",
        "unit",
        "quantity",
        "unitPrice"
      FROM "SpotProcurementLine"
      WHERE "versionId" = ${versionId}
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async findActualPaymentExecution(
    tx: Prisma.TransactionClient,
    procurementId: string,
    procurementVersionId: string
  ): Promise<{ id: string; paymentId: string; paidAt: Date } | null> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; paymentId: string; paidAt: Date }>
    >(Prisma.sql`
      SELECT
        execution."id",
        execution."paymentId",
        execution."paidAt"
      FROM "SpotProcurementPaymentExecution" execution
      INNER JOIN "SpotProcurementPayment" payment
        ON payment."id" = execution."paymentId"
      WHERE payment."procurementId" = ${procurementId}
        AND payment."procurementVersionId" = ${procurementVersionId}
        AND execution."voidedAt" IS NULL
      ORDER BY execution."paidAt" ASC, execution."id" ASC
      LIMIT 1
      FOR KEY SHARE OF execution
    `);
    return rows[0] ?? null;
  }

  private lockPaymentLinePrices(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext
  ) {
    return tx.$queryRaw<PaymentLinePriceRow[]>(Prisma.sql`
      SELECT
        line."procurementLineId",
        line."unitPrice"
      FROM "SpotProcurementPaymentLine" line
      INNER JOIN "SpotProcurementPayment" payment
        ON payment."id" = line."paymentId"
      WHERE payment."procurementId" = ${context.procurement.id}
        AND payment."procurementVersionId" = ${context.version.id}
        AND payment."paymentType" IS NOT NULL
        AND payment."invalidatedAt" IS NULL
      ORDER BY line."procurementLineId"
      FOR UPDATE OF line
    `);
  }

  private paymentLinePriceMap(
    paymentLines: PaymentLinePriceRow[]
  ) {
    const prices = new Map<string, Prisma.Decimal>();
    for (const line of paymentLines) {
      if (line.unitPrice.isNegative() || prices.has(line.procurementLineId)) {
        throw new ConflictException(
          "付款材料单价事实不完整，请刷新后重试"
        );
      }
      prices.set(line.procurementLineId, line.unitPrice);
    }
    return prices;
  }

  private receiptUnitPrice(
    procurementLine: ProcurementLineLockRow,
    paymentLinePrices: Map<string, Prisma.Decimal>
  ) {
    const unitPrice =
      procurementLine.unitPrice ??
      paymentLinePrices.get(procurementLine.id);
    if (!unitPrice) {
      throw new ConflictException(
        "当前收货材料缺少付款申请冻结单价"
      );
    }
    return unitPrice;
  }

  private lockReceiptLines(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext
  ) {
    return tx.$queryRaw<ReceiptLineLockRow[]>(Prisma.sql`
      SELECT
        "id",
        "receiptId",
        "receiptRevisionNo",
        "procurementId",
        "procurementVersionId",
        "procurementLineId",
        "approvedQuantitySnapshot",
        "qualifiedQuantity",
        "unqualifiedQuantity",
        "unqualifiedReason",
        "freeGiftQuantity",
        "replenishmentPending",
        "discrepancyNote",
        "actualCostCents"
      FROM "SpotProcurementReceiptLine"
      WHERE "receiptId" = ${context.receipt.id}
        AND "receiptRevisionNo" = ${context.receipt.currentRevisionNo}
      ORDER BY "procurementLineId"
      FOR UPDATE
    `);
  }

  private lockReceiptPhotos(
    tx: Prisma.TransactionClient,
    context: LockedReceiptContext
  ) {
    return tx.$queryRaw<ReceiptPhotoLockRow[]>(Prisma.sql`
      SELECT
        photo."id",
        photo."receiptId",
        photo."receiptRevisionNo",
        photo."originalFileId",
        photo."watermarkedFileId",
        photo."originalSha256",
        photo."watermarkedSha256",
        photo."source",
        photo."category",
        photo."serverRecordedAt",
        photo."note",
        photo."uploadedByUserId",
        photo."lockedAtFirstSubmission",
        photo."lockedAt",
        photo."appendReason"
      FROM "SpotProcurementReceiptPhoto" photo
      INNER JOIN "SpotProcurementReceiptRevision" revision
        ON revision."receiptId" = photo."receiptId"
        AND revision."revisionNo" = photo."receiptRevisionNo"
      WHERE photo."receiptId" = ${context.receipt.id}
        AND revision."procurementId" = ${context.procurement.id}
        AND revision."procurementVersionId" = ${context.version.id}
      ORDER BY photo."id"
      FOR UPDATE OF photo
    `);
  }

  private async lockFiles(
    tx: Prisma.TransactionClient,
    fileIds: string[]
  ): Promise<FileLockRow[]> {
    const uniqueIds = [...new Set(fileIds)].sort();
    if (!uniqueIds.length) return [];
    await acquireFileBusinessBindingTransactionLock(tx);
    return tx.$queryRaw<FileLockRow[]>(Prisma.sql`
      SELECT
        "id",
        "mimeType",
        "sizeBytes",
        "uploadedByUserId",
        "contentSha256",
        "storageStatus"
      FROM "FileObject"
      WHERE "id" IN (${Prisma.join(uniqueIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async quarantineGeneratedReceiptFiles(
    fileIds: string[],
    actorUserId: string
  ): Promise<void> {
    let cleanupFailed = false;
    for (const fileId of [...new Set(fileIds)]) {
      try {
        await this.files.quarantineUnboundReceiptWatermark(
          fileId,
          actorUserId
        );
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      throw new InternalServerErrorException(
        "收货照片绑定失败且临时文件隔离未完成，请联系管理员"
      );
    }
  }

  private async lockActiveDelegation(
    tx: Prisma.TransactionClient,
    receiptId: string
  ): Promise<ReceiptDelegationRow | null> {
    const rows = await tx.$queryRaw<ReceiptDelegationRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "receiptId",
          "delegatorUserId",
          "delegateUserId",
          "scope",
          "delegatedAt",
          "revokedAt"
        FROM "SpotProcurementReceiptDelegation"
        WHERE "receiptId" = ${receiptId}
          AND "revokedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `
    );
    if (rows.length > 1) {
      throw new ConflictException("收货委托数据存在冲突");
    }
    return rows[0] ?? null;
  }

  private runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return this.prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }

  private async runWrite<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2034") {
        throw new ConflictException(
          "零星采购收货数据已变化，请刷新后重试"
        );
      }
      if (
        code === "P2002" ||
        code === "P2003" ||
        code === "P2025"
      ) {
        throw new ConflictException(
          "零星采购收货关联数据已变化，请刷新后重试"
        );
      }
      throw error;
    }
  }
}

function requiredId(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new BadRequestException(message);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new BadRequestException(message);
  }
  if ([...normalized].length > 128) {
    throw new BadRequestException("编号字段不能超过 128 个字符");
  }
  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  label: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}必须是文字`);
  }
  const normalized = collapseUnicodeWhitespace(value);
  if (!normalized) return null;
  if ([...normalized].length > maxLength) {
    throw new BadRequestException(
      `${label}不能超过 ${maxLength} 个字符`
    );
  }
  return normalized;
}

function requiredLimitedText(
  value: unknown,
  emptyMessage: string,
  maxLength: number,
  label: string
): string {
  const normalized = normalizeOptionalText(
    value,
    label,
    maxLength
  );
  if (!normalized) {
    throw new BadRequestException(emptyMessage);
  }
  return normalized;
}

function requiredPhotoSource(value: unknown): ReceiptPhotoSource {
  if (
    !RECEIPT_PHOTO_SOURCES.includes(
      value as ReceiptPhotoSource
    )
  ) {
    throw new BadRequestException("收货照片来源不正确");
  }
  return value as ReceiptPhotoSource;
}

function requiredPhotoCategory(
  value: unknown
): ReceiptPhotoCategory {
  if (
    !RECEIPT_PHOTO_CATEGORIES.includes(
      value as ReceiptPhotoCategory
    )
  ) {
    throw new BadRequestException("收货照片分类不正确");
  }
  return value as ReceiptPhotoCategory;
}

function isSupportedImageMime(
  value: string
): value is "image/jpeg" | "image/png" {
  return value === "image/jpeg" || value === "image/png";
}

function sumActualCost(
  lines: Array<{ actualCostCents: bigint }>
): bigint {
  let total = 0n;
  for (const line of lines) {
    total += line.actualCostCents;
    if (!isWithinPostgresBigIntRange(total)) {
      throw new BadRequestException(
        "收货实际成本合计超出系统可保存范围"
      );
    }
  }
  return total;
}

function receiptOriginalFileName(
  procurementCode: string,
  category: ReceiptPhotoCategory,
  mimeType: "image/jpeg" | "image/png",
  recordedAt: Date
): string {
  const safeCode = procurementCode
    .replace(/[^\w\u4e00-\u9fa5-]+/gu, "_")
    .slice(0, 80);
  const categoryLabel =
    category === "material_scene" ? "现场照片" : "送货单";
  const timestamp = recordedAt
    .toISOString()
    .replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `${safeCode || "零星采购"}-${categoryLabel}-专用原图-${timestamp}.${
    mimeType === "image/jpeg" ? "jpg" : "png"
  }`;
}

function watermarkedFileName(
  procurementCode: string,
  category: ReceiptPhotoCategory,
  mimeType: "image/jpeg" | "image/png",
  recordedAt: Date
): string {
  const safeCode = procurementCode
    .replace(/[^\w\u4e00-\u9fa5-]+/gu, "_")
    .slice(0, 80);
  const categoryLabel =
    category === "material_scene" ? "现场照片" : "送货单";
  const timestamp = recordedAt
    .toISOString()
    .replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `${safeCode || "零星采购"}-${categoryLabel}-水印-${timestamp}.${
    mimeType === "image/jpeg" ? "jpg" : "png"
  }`;
}

function delegationReadModel(delegation: {
  id: string;
  receiptId: string;
  delegatorUserId: string;
  delegateUserId: string;
  scope: string;
  delegatedAt: Date;
}) {
  return {
    id: delegation.id,
    receiptId: delegation.receiptId,
    delegatorUserId: delegation.delegatorUserId,
    delegateUserId: delegation.delegateUserId,
    scope: delegation.scope,
    delegatedAt: delegation.delegatedAt.toISOString()
  };
}

function photoReadModel(photo: {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  originalFileId: string;
  watermarkedFileId: string;
  originalSha256: string;
  watermarkedSha256: string;
  source: string;
  category: string;
  serverRecordedAt: Date;
  note: string | null;
  uploadedByUserId: string;
  lockedAtFirstSubmission: boolean;
  lockedAt: Date | null;
  appendReason: string | null;
}) {
  return {
    id: photo.id,
    receiptId: photo.receiptId,
    receiptRevisionNo: photo.receiptRevisionNo,
    watermarkedFileId: photo.watermarkedFileId,
    primaryFileId: photo.watermarkedFileId,
    originalSha256: photo.originalSha256,
    watermarkedSha256: photo.watermarkedSha256,
    source: photo.source,
    category: photo.category,
    serverRecordedAt: photo.serverRecordedAt.toISOString(),
    note: photo.note,
    uploadedByUserId: photo.uploadedByUserId,
    locked: photo.lockedAt !== null,
    appendReason: photo.appendReason
  };
}

function asIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === "P2010") {
    const meta = (error as { meta?: unknown }).meta;
    if (meta && typeof meta === "object") {
      const postgresCode = (meta as { code?: unknown }).code;
      if (String(postgresCode) === "40001") {
        return "P2034";
      }
    }
  }
  return typeof code === "string" ? code : undefined;
}
