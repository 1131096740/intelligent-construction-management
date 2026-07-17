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
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { hasNonReceiptBusinessFileBinding } from "../file/file-business-binding";
import { FileService } from "../file/file.service";
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
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const RECEIPT_EDITABLE_STATUSES = new Set([
  "draft",
  "returned",
  "review_revoked"
]);
const RECEIPT_PHOTO_APPENDABLE_STATUSES = new Set([
  ...RECEIPT_EDITABLE_STATUSES,
  "submitted"
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

type FileLockRow = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  contentSha256: string | null;
  storageStatus: string;
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
    private readonly access: SpotProcurementAccessService
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
          photos,
          delegation
        ] = await Promise.all([
          tx.spotProcurement.findUnique({
          where: { id: procurementId },
          select: {
            code: true,
            projectId: true,
            applicantUserId: true,
            handlerUserId: true,
              currentVersionId: true
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
          tx.spotProcurementReceiptPhoto.findMany({
            where: {
              receiptId: receipt.id,
              receiptRevisionNo: receipt.currentRevisionNo
            },
            orderBy: [
              { serverRecordedAt: "asc" },
              { id: "asc" }
            ]
          }),
          tx.spotProcurementReceiptDelegation.findFirst({
            where: { receiptId: receipt.id, revokedAt: null },
            orderBy: { delegatedAt: "desc" }
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
              frozenUnitPrice: line.unitPrice.toString(),
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
          }))
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead
      }
    );
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
        this.assertReceiptBusinessOpen(context);
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
        this.assertReceiptBusinessOpen(context);
        this.assertDraftEditable(context);

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const prepared = this.prepareReceiptLines(
          input.lines,
          procurementLines
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

    try {
      return await this.runWrite(() =>
        this.runSerializable(async (tx) => {
          const context = await this.requireLockedContext(
            tx,
            procurementId
          );
          await this.requireReceiptActor(tx, context, actorUserId);
          this.assertReceiptBusinessOpen(context);
          this.assertPhotoAppendable(context);
          this.assertPhotoSnapshotCurrent(context, snapshot);

          const appendReason = context.revision.submittedAt
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
            context.revision.submittedAt !== null;
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
        this.assertReceiptBusinessOpen(context);
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
    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.requireLockedContext(
          tx,
          procurementId
        );
        const delegationId = await this.requireReceiptActor(
          tx,
          context,
          actorUserId
        );
        this.assertReceiptBusinessOpen(context);
        this.assertDraftEditable(context);

        const procurementLines = await this.lockProcurementLines(
          tx,
          context.version.id
        );
        const receiptLines = await this.lockReceiptLines(
          tx,
          context
        );
        const recalculated = this.validateStoredReceiptLines(
          procurementLines,
          receiptLines
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
        await tx.spotProcurementReceiptPhoto.updateMany({
          where: {
            receiptId: context.receipt.id,
            receiptRevisionNo:
              context.receipt.currentRevisionNo
          },
          data: {
            lockedAtFirstSubmission: true,
            lockedAt: submittedAt
          }
        });
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
      })
    );
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
        this.assertReceiptBusinessOpen(context);
        this.assertPhotoAppendable(context);

        const note = normalizeOptionalText(
          noteInput,
          "收货照片备注",
          300
        );
        const appendReason = context.revision.submittedAt
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
    procurementLines: ProcurementLineLockRow[]
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
          procurementLine.unitPrice
        )
      };
    });
  }

  private validateStoredReceiptLines(
    procurementLines: ProcurementLineLockRow[],
    receiptLines: ReceiptLineLockRow[]
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
          procurementLine.unitPrice
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
        snapshot.revisionSubmittedAt
    ) {
      throw new ConflictException(
        "收货单在生成水印期间已变化，请刷新后重试"
      );
    }
  }

  private assertReceiptBusinessOpen(context: LockedReceiptContext) {
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
      select: { id: true, isActive: true }
    });
    if (!user?.isActive) {
      throw new ForbiddenException(message);
    }
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
      WHERE "receiptId" = ${context.receipt.id}
        AND "receiptRevisionNo" = ${context.receipt.currentRevisionNo}
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async lockFiles(
    tx: Prisma.TransactionClient,
    fileIds: string[]
  ): Promise<FileLockRow[]> {
    const uniqueIds = [...new Set(fileIds)].sort();
    if (!uniqueIds.length) return [];
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
