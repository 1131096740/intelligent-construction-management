import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import {
  SPOT_PROCUREMENT_BUSINESS_TYPES,
  SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT,
  SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
} from "./spot-procurement.constants";

export const RECEIPT_PDF_BUSINESS_TYPE =
  SPOT_PROCUREMENT_BUSINESS_TYPES.receipt;
export const RECEIPT_PDF_TEMPLATE_KEY =
  SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY;

const RECEIPT_PDF_REFRESH_ACTION = "spot_procurement.receipt.pdf.refresh";
const RECEIPT_PDF_REFRESH_FAILED_ACTION =
  "spot_procurement.receipt.pdf.refresh_failed";
const RECEIPT_PDF_ORPHAN_ACTION = "spot_procurement.receipt.pdf.orphan_file";
const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RECEIPT_PDF_MAX_EVIDENCE_BYTES = 96 * 1024 * 1024;

type ReceiptPdfClient = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "spotProcurementReceipt"
  | "spotProcurementReceiptRevision"
  | "spotProcurementReceiptLine"
  | "spotProcurementReceiptPhoto"
  | "spotProcurementReceiptReview"
  | "spotProcurementReceiptDelegation"
  | "spotProcurement"
  | "spotProcurementVersion"
  | "spotProcurementLine"
  | "project"
  | "user"
  | "pdfDocument"
  | "fileObject"
  | "auditLog"
>;

export interface ReceiptPdfProjection {
  sourceRevisionNo?: number;
  reviewId?: string;
}

export interface ReceiptPdfSnapshotToken {
  receiptId: string;
  receiptUpdatedAt: string;
  currentRevisionNo: number;
  receiptStatus: string;
  sourceRevisionNo: number;
  sourceRevisionUpdatedAt: string;
  reviewId: string | null;
  latestReviewId: string | null;
  factFingerprint: string;
}

export interface ReceiptPdfLine {
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  frozenUnitPrice: string;
  approvedQuantity: string;
  qualifiedQuantity: string;
  unqualifiedQuantity: string;
  freeGiftQuantity: string;
  discrepancy: string;
  note: string;
  actualCostCents: bigint;
}

export interface ReceiptPdfReview {
  id: string;
  decision: string;
  conclusion: string;
  reviewerName: string;
  reviewedAt: Date;
  comment: string | null;
  targetReviewId: string | null;
}

export interface ReceiptPdfPhotoFact {
  id: string;
  receiptRevisionNo: number;
  watermarkedFileId: string;
  watermarkedSha256: string;
  category: string;
  source: string;
  note: string | null;
  appendReason: string | null;
  uploadedByName: string;
  serverRecordedAt: Date;
  lockedAt: Date;
}

export interface ReceiptPdfEvidencePhoto
  extends Omit<ReceiptPdfPhotoFact, "watermarkedSha256" | "lockedAt"> {
  buffer: Buffer;
}

export interface ReceiptPdfRenderInput {
  projectCode: string;
  projectName: string;
  procurementCode: string;
  procurementVersionNo: number;
  receiptRevisionNo: number;
  receiptStatus: string;
  supplierName: string;
  handlerName: string;
  submittedByName: string;
  submittedAt: Date | null;
  delegationSummary: string;
  receiptNote: string | null;
  approvedAmountCents: bigint;
  actualCostCents: bigint;
  differenceAmountCents: bigint;
  lines: ReceiptPdfLine[];
  review: ReceiptPdfReview | null;
  photos: ReceiptPdfEvidencePhoto[];
  generatedAt: Date;
}

export interface ReceiptPdfSnapshot {
  token: ReceiptPdfSnapshotToken;
  renderInput: ReceiptPdfRenderInput;
  photoFacts: ReceiptPdfPhotoFact[];
}

@Injectable()
export class SpotProcurementReceiptPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly audit: AuditService
  ) {}

  /**
   * 收货业务动作提交后的容错入口。PDF 失败只留审计，不反向回滚复核。
   */
  async tryRefreshLatest(
    receiptId: string,
    actorUserId: string,
    trigger: string,
    projection: ReceiptPdfProjection = {}
  ): Promise<void> {
    try {
      await this.refreshLatest(receiptId, actorUserId, trigger, projection);
    } catch (error) {
      await this.recordRefreshFailure(
        receiptId,
        actorUserId,
        trigger,
        projection,
        error
      ).catch(() => undefined);
    }
  }

  /**
   * 生成并原子切换收货确认单的唯一最新 PDF 指针。
   * 渲染和文件 IO 在事务外；关联前以收货根行锁重新校验完整快照。
   */
  async refreshLatest(
    receiptId: string,
    actorUserId: string,
    trigger: string,
    projection: ReceiptPdfProjection = {}
  ) {
    const normalizedReceiptId = requiredId(receiptId, "收货单编号缺失");
    const normalizedActorUserId = requiredId(actorUserId, "PDF 生成人缺失");
    const normalizedTrigger = requiredId(trigger, "PDF 刷新来源缺失");
    const normalizedProjection = normalizeProjection(projection);

    const source = await this.prisma.$transaction(
      async (tx) => {
        const snapshot = await this.loadSourceSnapshot(
          tx,
          normalizedReceiptId,
          normalizedProjection
        );
        const currentPdf = await this.findCurrentPdfForSnapshot(
          tx,
          normalizedReceiptId,
          snapshot.token
        );
        return currentPdf ? { currentPdf } : { snapshot };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    if ("currentPdf" in source) {
      return source.currentPdf;
    }

    const { snapshot } = source;
    const evidence = await this.loadWatermarkedEvidence(snapshot.photoFacts);
    const renderInput: ReceiptPdfRenderInput = {
      ...snapshot.renderInput,
      photos: evidence,
      generatedAt: new Date()
    };
    const buffer = await this.renderPdf(renderInput);
    const file = await this.files.uploadPrivateFile({
      buffer,
      originalName: receiptPdfFileName(renderInput),
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: normalizedActorUserId
    });

    let orphanReason: ReceiptPdfOrphanReason = "association_failed";
    let associationResult: {
      pdfDocument: Awaited<ReturnType<Prisma.TransactionClient["pdfDocument"]["create"]>>;
      uploadedFileLinked: boolean;
    };
    try {
      associationResult = await this.prisma.$transaction(async (tx) => {
        await this.lockReceipt(tx, normalizedReceiptId);
        const currentSnapshot = await this.loadSourceSnapshot(
          tx,
          normalizedReceiptId,
          normalizedProjection
        );
        if (!sameSnapshotToken(snapshot.token, currentSnapshot.token)) {
          orphanReason = "stale_snapshot";
          throw new Error("收货或复核事实已变化，本次 PDF 不再关联");
        }

        const alreadyCurrent = await this.findCurrentPdfForSnapshot(
          tx,
          normalizedReceiptId,
          currentSnapshot.token
        );
        if (alreadyCurrent) {
          return { pdfDocument: alreadyCurrent, uploadedFileLinked: false };
        }

        const existing = await tx.pdfDocument.findFirst({
          where: {
            businessType: RECEIPT_PDF_BUSINESS_TYPE,
            businessId: normalizedReceiptId,
            templateKey: RECEIPT_PDF_TEMPLATE_KEY
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        const oldFileId = existing?.fileId ?? null;
        let pdfDocument;
        if (existing) {
          await this.files.linkFileReplacement(tx, {
            newFileId: file.id,
            oldFileId: existing.fileId,
            actorUserId: normalizedActorUserId
          });
          pdfDocument = await tx.pdfDocument.update({
            where: { id: existing.id },
            data: { fileId: file.id }
          });
        } else {
          pdfDocument = await tx.pdfDocument.create({
            data: {
              businessType: RECEIPT_PDF_BUSINESS_TYPE,
              businessId: normalizedReceiptId,
              fileId: file.id,
              templateKey: RECEIPT_PDF_TEMPLATE_KEY
            }
          });
        }

        await this.audit.record(tx, {
          actorUserId: normalizedActorUserId,
          action: RECEIPT_PDF_REFRESH_ACTION,
          businessType: RECEIPT_PDF_BUSINESS_TYPE,
          businessId: normalizedReceiptId,
          metadata: {
            pdfDocumentId: pdfDocument.id,
            newFileId: file.id,
            oldFileId,
            trigger: normalizedTrigger,
            templateKey: RECEIPT_PDF_TEMPLATE_KEY,
            sourceRevisionNo: snapshot.token.sourceRevisionNo,
            reviewId: snapshot.token.reviewId,
            sourceSnapshotToken: { ...snapshot.token }
          }
        });
        return { pdfDocument, uploadedFileLinked: true };
      });
    } catch (error) {
      await this.handleUnlinkedFile({
        receiptId: normalizedReceiptId,
        actorUserId: normalizedActorUserId,
        trigger: normalizedTrigger,
        orphanFileId: file.id,
        reason: orphanReason
      });
      throw error;
    }

    if (!associationResult.uploadedFileLinked) {
      await this.handleUnlinkedFile({
        receiptId: normalizedReceiptId,
        actorUserId: normalizedActorUserId,
        trigger: normalizedTrigger,
        orphanFileId: file.id,
        reason: "already_current"
      });
    }
    return associationResult.pdfDocument;
  }

  private async loadSourceSnapshot(
    client: ReceiptPdfClient,
    receiptId: string,
    projection: ReceiptPdfProjection
  ): Promise<ReceiptPdfSnapshot> {
    const receipt = await client.spotProcurementReceipt.findUnique({
      where: { id: receiptId },
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
        lockedAt: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!receipt) {
      throw new Error("零星采购收货单不存在");
    }

    const reviews = await client.spotProcurementReceiptReview.findMany({
      where: { receiptId },
      orderBy: [{ sequenceNo: "asc" }, { id: "asc" }]
    });
    const latestReview = reviews.at(-1) ?? null;
    const requestedReview = projection.reviewId
      ? reviews.find((review) => review.id === projection.reviewId) ?? null
      : null;
    if (projection.reviewId && !requestedReview) {
      throw new Error("指定的收货复核记录不存在");
    }
    // 历史刷新不得在新复核事实出现后反向覆盖最新指针。
    if (requestedReview && latestReview?.id !== requestedReview.id) {
      throw new Error("指定的收货复核已不是最新事实");
    }

    const sourceRevisionNo =
      projection.sourceRevisionNo ??
      requestedReview?.receiptRevisionNo ??
      receipt.currentRevisionNo;
    if (
      !Number.isSafeInteger(sourceRevisionNo) ||
      sourceRevisionNo <= 0 ||
      sourceRevisionNo > receipt.currentRevisionNo
    ) {
      throw new Error("收货 PDF 源修订号不正确");
    }
    if (
      requestedReview &&
      requestedReview.receiptRevisionNo !== sourceRevisionNo
    ) {
      throw new Error("收货 PDF 源修订与复核记录不一致");
    }

    const revision = await client.spotProcurementReceiptRevision.findUnique({
      where: {
        receiptId_revisionNo: { receiptId, revisionNo: sourceRevisionNo }
      }
    });
    if (!revision) {
      throw new Error("收货 PDF 对应修订不存在");
    }
    const selectedReview =
      requestedReview ??
      (latestReview &&
      latestReview.receiptRevisionNo === sourceRevisionNo &&
      latestReview.procurementId === revision.procurementId &&
      latestReview.procurementVersionId === revision.procurementVersionId
        ? latestReview
        : null);

    const [
      procurement,
      version,
      project,
      procurementLines,
      receiptLines,
      versionRevisions,
      delegation
    ] = await Promise.all([
      client.spotProcurement.findUnique({ where: { id: revision.procurementId } }),
      client.spotProcurementVersion.findUnique({
        where: { id: revision.procurementVersionId }
      }),
      client.project.findUnique({ where: { id: receipt.projectId } }),
      client.spotProcurementLine.findMany({
        where: { versionId: revision.procurementVersionId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      client.spotProcurementReceiptLine.findMany({
        where: {
          receiptId,
          receiptRevisionNo: sourceRevisionNo,
          procurementId: revision.procurementId,
          procurementVersionId: revision.procurementVersionId
        },
        orderBy: { id: "asc" }
      }),
      client.spotProcurementReceiptRevision.findMany({
        where: {
          receiptId,
          procurementId: revision.procurementId,
          procurementVersionId: revision.procurementVersionId,
          revisionNo: { lte: sourceRevisionNo }
        },
        select: { revisionNo: true },
        orderBy: { revisionNo: "asc" }
      }),
      revision.submissionDelegationId
        ? client.spotProcurementReceiptDelegation.findUnique({
            where: { id: revision.submissionDelegationId }
          })
        : Promise.resolve(null)
    ]);
    if (!procurement || !version || !project) {
      throw new Error("收货 PDF 关联的项目或采购数据不完整");
    }
    assertSourceCoordinates({ receipt, revision, procurement, version, project });
    assertReviewCoordinates(selectedReview, revision, receiptId);
    assertDelegationCoordinates(revision, delegation, receiptId);
    if (!versionRevisions.some((item) => item.revisionNo === sourceRevisionNo)) {
      throw new Error("收货 PDF 修订链不完整");
    }

    const revisionNos = versionRevisions.map((item) => item.revisionNo);
    const photos = await client.spotProcurementReceiptPhoto.findMany({
      where: {
        receiptId,
        receiptRevisionNo: { in: revisionNos }
      },
      orderBy: [{ serverRecordedAt: "asc" }, { id: "asc" }]
    });
    if (
      photos.length >
      SPOT_PROCUREMENT_RECEIPT_MAX_PHOTO_COUNT
    ) {
      throw new Error("收货照片数量超过 PDF 生成上限");
    }
    if (photos.some((photo) => photo.lockedAt === null)) {
      throw new Error("收货 PDF 不能包含未提交锁定的照片");
    }
    if (!photos.some((photo) => photo.category === "material_scene")) {
      throw new Error("收货 PDF 缺少正式材料或卸货现场照片");
    }

    const userIds = uniqueStrings([
      revision.handlerUserId,
      revision.submittedByUserId,
      delegation?.delegatorUserId,
      delegation?.delegateUserId,
      ...photos.map((photo) => photo.uploadedByUserId)
    ]);
    const users = userIds.length
      ? await client.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, updatedAt: true }
        })
      : [];
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    for (const userId of userIds) {
      if (!userNameById.has(userId)) {
        throw new Error("收货 PDF 关联人员信息不完整");
      }
    }

    const receiptLineByProcurementLineId = new Map(
      receiptLines.map((line) => [line.procurementLineId, line])
    );
    if (
      receiptLineByProcurementLineId.size !== procurementLines.length ||
      receiptLines.length !== procurementLines.length
    ) {
      throw new Error("收货 PDF 明细与冻结采购明细不一致");
    }
    const renderLines = procurementLines.map((line): ReceiptPdfLine => {
      const received = receiptLineByProcurementLineId.get(line.id);
      if (!received) {
        throw new Error("收货 PDF 明细缺失");
      }
      if (
        received.receiptId !== receiptId ||
        received.receiptRevisionNo !== sourceRevisionNo ||
        received.procurementId !== revision.procurementId ||
        received.procurementVersionId !== revision.procurementVersionId ||
        !decimalEquals(received.approvedQuantitySnapshot, line.quantity)
      ) {
        throw new Error("收货 PDF 明细坐标或审批数量快照不一致");
      }
      const approvedQuantity = decimalText(received.approvedQuantitySnapshot);
      const qualifiedQuantity = decimalText(received.qualifiedQuantity);
      const difference = new Prisma.Decimal(received.approvedQuantitySnapshot).minus(
        received.qualifiedQuantity
      );
      const notes = [
        received.unqualifiedReason
          ? `不合格原因：${received.unqualifiedReason}`
          : null,
        received.discrepancyNote,
        received.replenishmentPending ? "供应商待补货" : null,
        line.note
      ].filter((value): value is string => Boolean(value?.trim()));
      return {
        sortOrder: line.sortOrder,
        materialName: line.materialName,
        specification: line.specification,
        unit: line.unit,
        frozenUnitPrice: decimalText(line.unitPrice),
        approvedQuantity,
        qualifiedQuantity,
        unqualifiedQuantity: decimalText(received.unqualifiedQuantity),
        freeGiftQuantity: decimalText(received.freeGiftQuantity),
        discrepancy: difference.isZero()
          ? "无"
          : `${difference.isPositive() ? "少货" : "超量"} ${decimalText(
              difference.abs()
            )} ${line.unit}`,
        note: notes.join("；") || "—",
        actualCostCents: dbMoneyToBigInt(
          received.actualCostCents,
          "收货明细实际成本"
        )
      };
    });
    const lineActualCostCents = renderLines.reduce(
      (total, line) => total + line.actualCostCents,
      0n
    );
    const actualCostCents = dbMoneyToBigInt(
      revision.actualCostCents,
      "收货实际成本"
    );
    if (lineActualCostCents !== actualCostCents) {
      throw new Error("收货 PDF 明细成本与修订合计不一致");
    }
    const approvedAmountCents = dbMoneyToBigInt(
      version.totalAmountCents,
      "采购审批金额"
    );

    const handlerName = userName(userNameById, revision.handlerUserId);
    const submittedByName = revision.submittedByUserId
      ? userName(userNameById, revision.submittedByUserId)
      : handlerName;
    const review = selectedReview
      ? {
          id: selectedReview.id,
          decision: selectedReview.decision,
          conclusion: reviewDecisionLabel(selectedReview.decision),
          reviewerName: requiredSnapshotName(
            selectedReview.reviewedByNameSnapshot,
            "收货复核人姓名快照缺失"
          ),
          reviewedAt: selectedReview.createdAt,
          comment: selectedReview.comment,
          targetReviewId: selectedReview.targetReviewId
        }
      : null;
    const photoFacts: ReceiptPdfPhotoFact[] = photos.map((photo) => ({
      id: photo.id,
      receiptRevisionNo: photo.receiptRevisionNo,
      watermarkedFileId: photo.watermarkedFileId,
      watermarkedSha256: photo.watermarkedSha256,
      category: photo.category,
      source: photo.source,
      note: photo.note,
      appendReason: photo.appendReason,
      uploadedByName: userName(userNameById, photo.uploadedByUserId),
      serverRecordedAt: photo.serverRecordedAt,
      lockedAt: requiredDate(photo.lockedAt, "收货照片锁定时间缺失")
    }));
    const renderInput: ReceiptPdfRenderInput = {
      projectCode: project.code,
      projectName: project.name,
      procurementCode: procurement.code,
      procurementVersionNo: version.versionNo,
      receiptRevisionNo: sourceRevisionNo,
      receiptStatus: receipt.status,
      supplierName: procurement.supplierNameSnapshot,
      handlerName,
      submittedByName,
      submittedAt: revision.submittedAt,
      delegationSummary: delegationSummary(
        delegation,
        userNameById,
        handlerName,
        submittedByName
      ),
      receiptNote: revision.note,
      approvedAmountCents,
      actualCostCents,
      differenceAmountCents: approvedAmountCents - actualCostCents,
      lines: renderLines,
      review,
      photos: [],
      generatedAt: new Date()
    };

    const fingerprintFacts = {
      receipt,
      revision,
      procurement,
      version,
      project,
      procurementLines,
      receiptLines,
      versionRevisionNos: revisionNos,
      photos,
      reviews,
      selectedReviewId: selectedReview?.id ?? null,
      delegation,
      users,
      renderInput: { ...renderInput, generatedAt: null, photos: [] }
    };
    return {
      token: {
        receiptId,
        receiptUpdatedAt: receipt.updatedAt.toISOString(),
        currentRevisionNo: receipt.currentRevisionNo,
        receiptStatus: receipt.status,
        sourceRevisionNo,
        sourceRevisionUpdatedAt: revision.updatedAt.toISOString(),
        reviewId: selectedReview?.id ?? null,
        latestReviewId: latestReview?.id ?? null,
        factFingerprint: fingerprint(fingerprintFacts)
      },
      renderInput,
      photoFacts
    };
  }

  private async loadWatermarkedEvidence(
    photoFacts: ReceiptPdfPhotoFact[]
  ): Promise<ReceiptPdfEvidencePhoto[]> {
    const evidence: ReceiptPdfEvidencePhoto[] = [];
    let totalBytes = 0;
    for (const photo of photoFacts) {
      if (!SHA256_PATTERN.test(photo.watermarkedSha256)) {
        throw new Error("收货水印照片完整性元数据不正确");
      }
      const stored = await this.files.getFileBuffer(photo.watermarkedFileId);
      totalBytes += stored.buffer.length;
      if (totalBytes > RECEIPT_PDF_MAX_EVIDENCE_BYTES) {
        throw new Error("收货水印照片总大小超过 PDF 生成上限");
      }
      const actualSha256 = createHash("sha256")
        .update(stored.buffer)
        .digest("hex");
      if (
        stored.file.id !== photo.watermarkedFileId ||
        stored.file.storageStatus !== "active" ||
        !["image/jpeg", "image/png"].includes(stored.file.mimeType) ||
        stored.file.sizeBytes !== stored.buffer.length ||
        stored.file.contentSha256 !== photo.watermarkedSha256 ||
        actualSha256 !== photo.watermarkedSha256
      ) {
        throw new Error("收货水印照片完整性校验失败");
      }
      evidence.push({
        id: photo.id,
        receiptRevisionNo: photo.receiptRevisionNo,
        watermarkedFileId: photo.watermarkedFileId,
        category: photo.category,
        source: photo.source,
        note: photo.note,
        appendReason: photo.appendReason,
        uploadedByName: photo.uploadedByName,
        serverRecordedAt: photo.serverRecordedAt,
        buffer: stored.buffer
      });
    }
    return evidence;
  }

  private renderPdf(input: ReceiptPdfRenderInput): Promise<Buffer> {
    return renderSpotProcurementReceiptPdf(input);
  }

  private async findCurrentPdfForSnapshot(
    client: ReceiptPdfClient,
    receiptId: string,
    token: ReceiptPdfSnapshotToken
  ) {
    const existing = await client.pdfDocument.findFirst({
      where: {
        businessType: RECEIPT_PDF_BUSINESS_TYPE,
        businessId: receiptId,
        templateKey: RECEIPT_PDF_TEMPLATE_KEY
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!existing) return null;
    const latestRefresh = await client.auditLog.findFirst({
      where: {
        action: RECEIPT_PDF_REFRESH_ACTION,
        businessType: RECEIPT_PDF_BUSINESS_TYPE,
        businessId: receiptId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { metadata: true }
    });
    const metadata = jsonObject(latestRefresh?.metadata);
    if (
      metadata?.pdfDocumentId !== existing.id ||
      metadata?.newFileId !== existing.fileId
    ) {
      return null;
    }
    const storedToken = parseSnapshotToken(metadata.sourceSnapshotToken);
    return storedToken &&
      (sameSnapshotToken(token, storedToken) ||
        isFinalLockOfReviewedSnapshot(token, storedToken))
      ? existing
      : null;
  }

  private async lockReceipt(client: ReceiptPdfClient, receiptId: string): Promise<void> {
    const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SpotProcurementReceipt"
      WHERE "id" = ${receiptId}
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new Error("零星采购收货单不存在，无法关联最新 PDF");
    }
  }

  private async handleUnlinkedFile(input: {
    receiptId: string;
    actorUserId: string;
    trigger: string;
    orphanFileId: string;
    reason: ReceiptPdfOrphanReason;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockReceipt(tx, input.receiptId);
        const binding = await tx.pdfDocument.findFirst({
          where: { fileId: input.orphanFileId },
          select: { id: true, businessType: true, businessId: true }
        });
        if (binding) {
          await this.recordOrphanAudit(tx, input, {
            cleanupStatus: "bound_pdf_preserved",
            retryable: false,
            boundPdfDocumentId: binding.id,
            boundBusinessType: binding.businessType,
            boundBusinessId: binding.businessId
          });
          return;
        }

        const file = await tx.fileObject.findUnique({
          where: { id: input.orphanFileId },
          select: {
            id: true,
            uploadedByUserId: true,
            storageStatus: true,
            supersedesFileObjectId: true
          }
        });
        const successor = await tx.fileObject.findFirst({
          where: { supersedesFileObjectId: input.orphanFileId },
          select: { id: true }
        });
        if (file?.supersedesFileObjectId || successor) {
          await this.recordOrphanAudit(tx, input, {
            cleanupStatus: "bound_replacement_preserved",
            retryable: false,
            predecessorFileId: file?.supersedesFileObjectId ?? null,
            successorFileId: successor?.id ?? null
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
        await this.recordOrphanAudit(tx, input, {
          cleanupStatus: quarantined.count === 1 ? "quarantined" : "not_quarantined",
          retryable: quarantined.count !== 1
        });
      });
    } catch (cleanupError) {
      await this.audit
        .record(this.prisma, {
          actorUserId: input.actorUserId,
          action: RECEIPT_PDF_ORPHAN_ACTION,
          businessType: RECEIPT_PDF_BUSINESS_TYPE,
          businessId: input.receiptId,
          metadata: {
            orphanFileId: input.orphanFileId,
            reason: input.reason,
            trigger: input.trigger,
            cleanupStatus: "cleanup_failed",
            retryable: true,
            errorType: safeErrorType(cleanupError)
          }
        })
        .catch(() => undefined);
    }
  }

  private recordOrphanAudit(
    client: ReceiptPdfClient,
    input: {
      receiptId: string;
      actorUserId: string;
      trigger: string;
      orphanFileId: string;
      reason: ReceiptPdfOrphanReason;
    },
    metadata: Record<string, string | boolean | null>
  ) {
    return this.audit.record(client, {
      actorUserId: input.actorUserId,
      action: RECEIPT_PDF_ORPHAN_ACTION,
      businessType: RECEIPT_PDF_BUSINESS_TYPE,
      businessId: input.receiptId,
      metadata: {
        orphanFileId: input.orphanFileId,
        reason: input.reason,
        trigger: input.trigger,
        ...metadata
      }
    });
  }

  private recordRefreshFailure(
    receiptId: string,
    actorUserId: string,
    trigger: string,
    projection: ReceiptPdfProjection,
    error: unknown
  ): Promise<unknown> {
    return this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actorUserId,
        action: RECEIPT_PDF_REFRESH_FAILED_ACTION,
        businessType: RECEIPT_PDF_BUSINESS_TYPE,
        businessId: receiptId,
        metadata: {
          retryable: true,
          status: "retryable",
          trigger,
          templateKey: RECEIPT_PDF_TEMPLATE_KEY,
          sourceRevisionNo: projection.sourceRevisionNo ?? null,
          reviewId: projection.reviewId ?? null,
          errorType: safeErrorType(error),
          errorSummary: "收货确认单生成失败，可稍后重试"
        }
      })
    );
  }
}

type ReceiptPdfOrphanReason =
  | "stale_snapshot"
  | "already_current"
  | "association_failed";

export async function renderSpotProcurementReceiptPdf(
  input: ReceiptPdfRenderInput
): Promise<Buffer> {
  const margin = 32;
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin,
    bufferPages: true,
    autoFirstPage: true
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise, rejectPromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", rejectPromise);
  });
  doc.registerFont("cn", FONT_PATH);
  doc.font("cn");

  const contentWidth = doc.page.width - margin * 2;
  doc.fontSize(18).text("项目零星材料收货确认单", margin, margin, {
    width: contentWidth,
    align: "center"
  });
  doc.fontSize(9).fillColor(statusColor(input.receiptStatus)).text(
    receiptStatusLabel(input.receiptStatus),
    doc.page.width - margin - 110,
    margin + 4,
    { width: 110, align: "right" }
  );
  doc.fillColor("black");
  let y = doc.y + 10;
  y = drawKeyValueRows(
    doc,
    margin,
    y,
    contentWidth,
    [
      ["项目", `${input.projectName}（${input.projectCode}）`, "采购编号", input.procurementCode],
      [
        "采购版本 / 收货修订",
        `V${input.procurementVersionNo} / R${input.receiptRevisionNo}`,
        "供应商",
        input.supplierName
      ],
      ["采购经办人", input.handlerName, "实际提交人", input.submittedByName],
      [
        "提交时间",
        formatOptionalDateTime(input.submittedAt),
        "生成时间",
        formatDateTime(input.generatedAt)
      ],
      ["委托关系", input.delegationSummary, "收货备注", display(input.receiptNote)]
    ]
  );
  y += 10;
  y = drawKeyValueRows(
    doc,
    margin,
    y,
    contentWidth,
    [
      [
        "采购审批金额",
        formatYuan(input.approvedAmountCents),
        "本次采购实际成本",
        formatYuan(input.actualCostCents)
      ],
      [
        "差异金额",
        formatYuan(input.differenceAmountCents),
        "照片 / 送货单",
        `${input.photos.filter((photo) => photo.category === "material_scene").length} / ${
          input.photos.filter((photo) => photo.category === "delivery_note").length
        }`
      ]
    ]
  );
  y += 12;
  doc.fontSize(11).text("最终收货明细", margin, y);
  y = doc.y + 5;
  y = drawMaterialTable(doc, margin, y, input.lines);
  y += 12;
  y = ensureVerticalSpace(doc, y, 82);
  doc.fontSize(11).text("物资主管复核", margin, y);
  y = doc.y + 5;
  drawKeyValueRows(doc, margin, y, contentWidth, [
    [
      "复核结论",
      input.review?.conclusion ?? "待复核",
      "复核人",
      input.review?.reviewerName ?? "—"
    ],
    [
      "复核时间",
      input.review ? formatDateTime(input.review.reviewedAt) : "—",
      "复核意见",
      display(input.review?.comment)
    ]
  ]);

  input.photos.forEach((photo, index) => {
    doc.addPage({ size: "A4", layout: "landscape", margin });
    const category =
      photo.category === "delivery_note" ? "乙方送货单" : "材料/卸货现场照片";
    doc.fontSize(14).text(`${category}（${index + 1}/${input.photos.length}）`, margin, margin, {
      width: contentWidth,
      align: "center"
    });
    const caption = [
      `收货修订：R${photo.receiptRevisionNo}`,
      `上传人：${photo.uploadedByName}`,
      `服务器时间：${formatDateTime(photo.serverRecordedAt)}`,
      `来源：${photo.source === "camera" ? "系统拍照" : "相册上传"}`,
      `备注：${display(photo.note)}`,
      photo.appendReason ? `补充原因：${photo.appendReason}` : null
    ]
      .filter((value): value is string => Boolean(value))
      .join("    ");
    doc.fontSize(9).text(caption, margin, doc.y + 6, {
      width: contentWidth,
      align: "left"
    });
    const imageY = doc.y + 10;
    const imageHeight = doc.page.height - imageY - margin;
    // 正式证据图不做静默降级：损坏图像必须让本次刷新失败。
    doc.image(photo.buffer, margin, imageY, {
      fit: [contentWidth, imageHeight],
      align: "center",
      valign: "center"
    });
  });

  doc.end();
  return done;
}

function drawKeyValueRows(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  totalWidth: number,
  rows: string[][]
): number {
  const widths = [92, totalWidth / 2 - 92, 92, totalWidth / 2 - 92];
  let currentY = y;
  for (const row of rows) {
    const height = Math.max(
      26,
      ...row.map((value, index) =>
        doc.heightOfString(value, { width: widths[index] - 8 }) + 10
      )
    );
    let currentX = x;
    row.forEach((value, index) => {
      const width = widths[index];
      if (index % 2 === 0) {
        doc.save().rect(currentX, currentY, width, height).fill("#edf2f7").restore();
      }
      doc.rect(currentX, currentY, width, height).stroke("#718096");
      doc
        .fillColor("black")
        .fontSize(index % 2 === 0 ? 8 : 9)
        .text(value, currentX + 4, currentY + 5, {
          width: width - 8,
          align: index % 2 === 0 ? "center" : "left"
        });
      currentX += width;
    });
    currentY += height;
  }
  return currentY;
}

function drawMaterialTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  lines: ReceiptPdfLine[]
): number {
  const headers = [
    "序号",
    "材料",
    "规格",
    "单位",
    "审批数量",
    "合格",
    "不合格",
    "附赠",
    "差异",
    "实际成本",
    "说明"
  ];
  const widths = [30, 78, 72, 36, 60, 60, 60, 60, 92, 70, 160];
  const rows = lines.map((line) => [
    String(line.sortOrder),
    line.materialName,
    display(line.specification),
    line.unit,
    line.approvedQuantity,
    line.qualifiedQuantity,
    line.unqualifiedQuantity,
    line.freeGiftQuantity,
    line.discrepancy,
    formatYuan(line.actualCostCents),
    `冻结单价：${line.frozenUnitPrice}；${line.note}`
  ]);
  let currentY = y;
  const drawRow = (row: string[], header: boolean) => {
    const rowHeight = Math.max(
      header ? 28 : 34,
      ...row.map(
        (value, index) =>
          doc.heightOfString(value, { width: widths[index] - 8 }) + 10
      )
    );
    let currentX = x;
    row.forEach((value, index) => {
      const width = widths[index];
      if (header) {
        doc.save().rect(currentX, currentY, width, rowHeight).fill("#edf2f7").restore();
      }
      doc.rect(currentX, currentY, width, rowHeight).stroke("#718096");
      doc
        .fillColor("black")
        .fontSize(header ? 8 : 7)
        .text(value, currentX + 4, currentY + 5, {
          width: width - 8,
          align: index >= 4 && index <= 9 ? "right" : "center"
        });
      currentX += width;
    });
    currentY += rowHeight;
  };
  drawRow(headers, true);
  for (const row of rows) {
    const expectedHeight = Math.max(
      34,
      ...row.map(
        (value, index) =>
          doc.heightOfString(value, { width: widths[index] - 8 }) + 10
      )
    );
    if (currentY + expectedHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ size: "A4", layout: "landscape", margin: doc.page.margins.left });
      currentY = doc.page.margins.top;
      drawRow(headers, true);
    }
    drawRow(row, false);
  }
  return currentY;
}

function ensureVerticalSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  requiredHeight: number
): number {
  if (
    y + requiredHeight <=
    doc.page.height - doc.page.margins.bottom
  ) {
    return y;
  }
  doc.addPage({ size: "A4", layout: "landscape", margin: doc.page.margins.left });
  doc.y = doc.page.margins.top;
  return doc.y;
}

function assertSourceCoordinates(input: {
  receipt: {
    id: string;
    projectId: string;
    procurementId: string;
  };
  revision: {
    receiptId: string;
    procurementId: string;
    procurementVersionId: string;
  };
  procurement: { id: string; projectId: string };
  version: { id: string; procurementId: string };
  project: { id: string };
}): void {
  if (
    input.revision.receiptId !== input.receipt.id ||
    input.revision.procurementId !== input.receipt.procurementId ||
    input.procurement.id !== input.receipt.procurementId ||
    input.procurement.projectId !== input.receipt.projectId ||
    input.project.id !== input.receipt.projectId ||
    input.version.id !== input.revision.procurementVersionId ||
    input.version.procurementId !== input.receipt.procurementId
  ) {
    throw new Error("收货 PDF 项目、采购或版本坐标不一致");
  }
}

function assertReviewCoordinates(
  review: {
    receiptId: string;
    receiptRevisionNo: number;
    procurementId: string;
    procurementVersionId: string;
    submissionDelegationId: string | null;
  } | null,
  revision: {
    revisionNo: number;
    procurementId: string;
    procurementVersionId: string;
    submissionDelegationId: string | null;
  },
  receiptId: string
): void {
  if (!review) return;
  if (
    review.receiptId !== receiptId ||
    review.receiptRevisionNo !== revision.revisionNo ||
    review.procurementId !== revision.procurementId ||
    review.procurementVersionId !== revision.procurementVersionId ||
    review.submissionDelegationId !== revision.submissionDelegationId
  ) {
    throw new Error("收货 PDF 复核事实与修订坐标不一致");
  }
}

function assertDelegationCoordinates(
  revision: {
    handlerUserId: string;
    submittedByUserId: string | null;
    submissionDelegationId: string | null;
  },
  delegation: {
    id: string;
    receiptId: string;
    delegatorUserId: string;
    delegateUserId: string;
    scope: string;
  } | null,
  receiptId: string
): void {
  if (!revision.submissionDelegationId) {
    if (
      revision.submittedByUserId &&
      revision.submittedByUserId !== revision.handlerUserId
    ) {
      throw new Error("收货 PDF 提交人与委托事实不一致");
    }
    return;
  }
  if (
    !delegation ||
    delegation.id !== revision.submissionDelegationId ||
    delegation.receiptId !== receiptId ||
    delegation.delegatorUserId !== revision.handlerUserId ||
    delegation.delegateUserId !== revision.submittedByUserId ||
    delegation.scope !== "receipt_confirmation"
  ) {
    throw new Error("收货 PDF 委托事实与提交修订不一致");
  }
}

function delegationSummary(
  delegation: {
    delegatorUserId: string;
    delegateUserId: string;
    delegatedAt: Date;
  } | null,
  userNames: Map<string, string>,
  handlerName: string,
  submittedByName: string
): string {
  if (!delegation) return `${handlerName}本人确认收货`;
  return `${userName(userNames, delegation.delegatorUserId)}于${formatDateTime(
    delegation.delegatedAt
  )}委托${userName(userNames, delegation.delegateUserId)}办理；实际提交人：${submittedByName}`;
}

function parseSnapshotToken(value: unknown): ReceiptPdfSnapshotToken | null {
  const token = jsonObject(value);
  if (!token) return null;
  const currentRevisionNo = Number(token.currentRevisionNo);
  const sourceRevisionNo = Number(token.sourceRevisionNo);
  if (!Number.isSafeInteger(currentRevisionNo) || !Number.isSafeInteger(sourceRevisionNo)) {
    return null;
  }
  return {
    receiptId: String(token.receiptId ?? ""),
    receiptUpdatedAt: String(token.receiptUpdatedAt ?? ""),
    currentRevisionNo,
    receiptStatus: String(token.receiptStatus ?? ""),
    sourceRevisionNo,
    sourceRevisionUpdatedAt: String(token.sourceRevisionUpdatedAt ?? ""),
    reviewId: nullableString(token.reviewId),
    latestReviewId: nullableString(token.latestReviewId),
    factFingerprint: String(token.factFingerprint ?? "")
  };
}

function sameSnapshotToken(
  left: ReceiptPdfSnapshotToken,
  right: ReceiptPdfSnapshotToken
): boolean {
  return (
    left.receiptId === right.receiptId &&
    left.receiptUpdatedAt === right.receiptUpdatedAt &&
    left.currentRevisionNo === right.currentRevisionNo &&
    left.receiptStatus === right.receiptStatus &&
    left.sourceRevisionNo === right.sourceRevisionNo &&
    left.sourceRevisionUpdatedAt === right.sourceRevisionUpdatedAt &&
    left.reviewId === right.reviewId &&
    left.latestReviewId === right.latestReviewId &&
    left.factFingerprint === right.factFingerprint
  );
}

function isFinalLockOfReviewedSnapshot(
  current: ReceiptPdfSnapshotToken,
  stored: ReceiptPdfSnapshotToken
): boolean {
  return (
    current.receiptStatus === "locked" &&
    stored.receiptStatus === "reviewed" &&
    current.receiptId === stored.receiptId &&
    current.currentRevisionNo === stored.currentRevisionNo &&
    current.sourceRevisionNo === stored.sourceRevisionNo &&
    current.sourceRevisionUpdatedAt ===
      stored.sourceRevisionUpdatedAt &&
    current.reviewId === stored.reviewId &&
    current.latestReviewId === stored.latestReviewId
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return '"[undefined]"';
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("PDF 快照包含非法数字");
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Prisma.Decimal.isDecimal(value)) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("PDF 快照包含不可序列化数据");
}

function normalizeProjection(projection: ReceiptPdfProjection): ReceiptPdfProjection {
  const reviewId = projection.reviewId?.trim();
  if (projection.reviewId !== undefined && !reviewId) {
    throw new Error("收货复核记录编号不能为空");
  }
  if (
    projection.sourceRevisionNo !== undefined &&
    (!Number.isSafeInteger(projection.sourceRevisionNo) || projection.sourceRevisionNo <= 0)
  ) {
    throw new Error("收货 PDF 源修订号不正确");
  }
  return {
    sourceRevisionNo: projection.sourceRevisionNo,
    reviewId
  };
}

function requiredId(value: string, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function requiredDate(value: Date | null, message: string): Date {
  if (!value) throw new Error(message);
  return value;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function userName(names: Map<string, string>, userId: string): string {
  const name = names.get(userId)?.trim();
  if (!name) throw new Error("收货 PDF 关联人员姓名缺失");
  return name;
}

function requiredSnapshotName(
  value: string,
  message: string
): string {
  const name = value?.trim();
  if (!name) throw new Error(message);
  return name;
}

function decimalText(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toString();
}

function decimalEquals(left: Prisma.Decimal.Value, right: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(left).equals(right);
}

function reviewDecisionLabel(decision: string): string {
  if (decision === "approved") return "复核通过";
  if (decision === "returned") return "退回修改";
  if (decision === "revoked") return "复核已撤销";
  return decision;
}

function receiptStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "草稿",
    submitted: "待物资主管复核",
    reviewed: "复核通过",
    locked: "已办结锁定",
    returned: "已退回",
    review_revoked: "复核已撤销",
    invalidated: "已失效"
  };
  return labels[status] ?? status;
}

function statusColor(status: string): string {
  return status === "reviewed" || status === "locked"
    ? "#237804"
    : "#b42318";
}

function receiptPdfFileName(input: ReceiptPdfRenderInput): string {
  return `${safeFilePart(input.procurementCode)}-收货确认单-R${input.receiptRevisionNo}.pdf`;
}

function safeFilePart(value: string): string {
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f ||
      '\\/:*?"<>|'.includes(character)
      ? "_"
      : character;
  }).join("");
  return sanitized.slice(0, 80) || "零星采购";
}

function formatYuan(cents: bigint): string {
  return `${formatMoneyCentsAsYuan(cents)} 元`;
}

function display(value: string | null | undefined): string {
  return value?.trim() || "—";
}

function formatOptionalDateTime(value: Date | null): string {
  return value ? formatDateTime(value) : "—";
}

function formatDateTime(value: Date): string {
  const pad = (item: number) => String(item).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function safeErrorType(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name) ? name : "UnknownError";
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
