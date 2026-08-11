import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { appendDocxImageAttachments } from "./docx-attachment-appender";
import { extractContractDocx } from "./contract-docx-extractor";
import { compareContractDocumentSnapshots } from "./contract-document-comparison";
import { renderContractDocx } from "./contract-docx-renderer";
import {
  CONTRACT_DOCUMENT_ENGINE_VERSION,
  declaredBillKeys,
  requiredPlaceholderKeys,
  type ContractDocumentInputSnapshot
} from "./contract-document.service";
import { convertDocxToPdf } from "./libreoffice-converter";
import { normalizeContractPdf, type PdfAttachment } from "./pdf-normalizer";

const ERROR_MESSAGE_LIMIT = 2_000;
const PROCESSING_LEASE_MS = 10 * 60 * 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_PERSISTED_ERROR_MESSAGES = new Set([
  "合同版式版本不存在",
  "合同版式版本已不可预览，请刷新后重试",
  "合同版式预览清单数据格式不正确",
  "合同生成文档前驱文件记录异常，无法接入版本链",
  "合同文档输入快照格式不正确",
  "合同金额格式不正确",
  "合同金额超出中文大写金额可转换范围",
  "合同文档缺少必填内容，请补充后重试",
  "合同 DOCX 模板格式不正确",
  "合同 DOCX 模板渲染失败，请检查模板内容",
  "合同附件合并所用 DOCX 文件结构不正确",
  "合同附件图片格式不正确",
  "合同文档包含不允许的字体，请按模板字体规范调整",
  "合同文档字体检查失败，请联系管理员",
  "合同文档所需字体在转换服务中不可用，请联系管理员",
  "合同 PDF 转换服务不可用，请联系管理员",
  "合同 PDF 转换超时，请稍后重试",
  "合同 PDF 转换失败，请稍后重试",
  "合同 PDF 转换未生成输出文件，请稍后重试",
  "合同正文 PDF 格式不正确",
  "合同附件文件类型不受支持",
  "合同附件处理失败，请检查文件是否完整且格式正确",
  "合同 PDF 总页数超过系统限制",
  "合同附件图片像素超过系统限制",
  "合同 PDF 及附件总大小超过系统限制"
]);

@Injectable()
export class ContractDocumentProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly audit: AuditService
  ) {}

  onApplicationBootstrap() {
    // ponytail: one DB-backed worker matches the current single API deployment;
    // replace with a distributed queue before running multiple API replicas.
    this.timer = setInterval(() => {
      void this.processNext().catch(() => undefined);
    }, 1_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async processNext() {
    if (this.running) return false;
    this.running = true;
    try {
      await this.recoverExpiredJobs();
      const preview = await this.claimPreview();
      if (preview) {
        await this.processPreview(preview);
        return true;
      }
      const offlineRevision = await this.claimOfflineRevision();
      if (offlineRevision) {
        await this.processOfflineRevision(offlineRevision);
        return true;
      }
      const document = await this.claimDocument();
      if (!document) return false;
      await this.processDocument(document);
      return true;
    } finally {
      this.running = false;
    }
  }

  private async recoverExpiredJobs() {
    const expiredBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    await this.prisma.contractLayoutPreviewJob.updateMany({
      where: {
        status: "processing",
        startedAt: { lt: expiredBefore }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
    await this.prisma.contractGeneratedDocument.updateMany({
      where: {
        status: "processing",
        startedAt: { lt: expiredBefore }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
    await this.prisma.contractOfflineRevision.updateMany({
      where: {
        status: "processing",
        startedAt: { lt: expiredBefore }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
    await this.prisma.contractDocumentComparison.updateMany({
      where: {
        status: "processing",
        startedAt: { lt: expiredBefore }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
  }

  private async claimPreview() {
    const job = await this.prisma.contractLayoutPreviewJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    if (!job) return null;
    const startedAt = new Date();
    const claimed = await this.prisma.contractLayoutPreviewJob.updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "processing", startedAt, errorMessage: null }
    });
    return claimed.count === 1 ? { ...job, status: "processing", startedAt } : null;
  }

  private async claimDocument() {
    const job = await this.prisma.contractGeneratedDocument.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    if (!job) return null;
    const startedAt = new Date();
    const claimed = await this.prisma.contractGeneratedDocument.updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "processing", startedAt, errorMessage: null }
    });
    return claimed.count === 1 ? { ...job, status: "processing", startedAt } : null;
  }

  private async claimOfflineRevision() {
    const job = await this.prisma.contractOfflineRevision.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    if (!job) return null;
    const comparison = await this.prisma.contractDocumentComparison.findUnique({
      where: { offlineRevisionId: job.id }
    });
    if (!comparison || comparison.status !== "queued") {
      await this.prisma.$transaction(async (tx) => {
        const errorMessage = "线下修订稿比较记录异常，请联系管理员";
        const updated = await tx.contractOfflineRevision.updateMany({
          where: { id: job.id, status: "queued" },
          data: { status: "failed", errorMessage, completedAt: new Date() }
        });
        if (updated.count !== 1) return;
        await this.audit.record(tx, {
          actorUserId: job.confirmedByUserId,
          action: "contract.offline_revision.process_failure",
          businessType: "contract_offline_revision",
          businessId: job.id,
          metadata: {
            comparisonId: comparison?.id ?? null,
            errorMessage,
            sourceRevision: job.sourceRevision
          }
        });
      });
      return null;
    }
    const startedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const revisionClaimed = await tx.contractOfflineRevision.updateMany({
        where: { id: job.id, status: "queued" },
        data: { status: "processing", startedAt, errorMessage: null }
      });
      if (revisionClaimed.count !== 1) return null;
      const comparisonClaimed = await tx.contractDocumentComparison.updateMany({
        where: { id: comparison.id, status: "queued" },
        data: { status: "processing", startedAt, errorMessage: null }
      });
      if (comparisonClaimed.count !== 1) {
        throw new Error("线下修订稿比较任务状态已变化");
      }
      return { ...job, status: "processing", startedAt, comparisonId: comparison.id };
    });
  }

  private async processOfflineRevision(job: {
    id: string;
    contractVersionId: string;
    negotiationRoundId: string | null;
    sourceGeneratedDocumentId: string | null;
    sourceRevision: number | null;
    fileId: string;
    previewPdfFileId: string | null;
    label: string;
    confirmedByUserId: string;
    comparisonId: string;
  }) {
    let uploadedPdfFileId: string | null = null;
    try {
      if (
        !job.negotiationRoundId ||
        !job.sourceGeneratedDocumentId ||
        job.sourceRevision === null
      ) {
        throw new Error("线下修订稿来源记录异常");
      }
      const [source, revision, version, round] = await Promise.all([
        this.prisma.contractGeneratedDocument.findUnique({
          where: { id: job.sourceGeneratedDocumentId }
        }),
        this.files.getFileBuffer(job.fileId),
        this.prisma.contractVersion.findUnique({ where: { id: job.contractVersionId } }),
        this.prisma.contractNegotiationRound.findUnique({
          where: { id: job.negotiationRoundId }
        })
      ]);
      const sourceInput = source?.inputSnapshot &&
        typeof source.inputSnapshot === "object" &&
        !Array.isArray(source.inputSnapshot)
        ? source.inputSnapshot as Prisma.JsonObject
        : null;
      const sourceDocumentContentRevision =
        sourceInput?.documentContentRevision;
      const sourceDocumentContentFingerprint =
        sourceInput?.documentContentFingerprint;
      if (
        !source?.docxFileId ||
        source.contractVersionId !== job.contractVersionId ||
        source.sourceRevision !== job.sourceRevision ||
        !Number.isInteger(sourceDocumentContentRevision) ||
        (sourceDocumentContentRevision as number) < 1 ||
        typeof sourceDocumentContentFingerprint !== "string" ||
        !SHA256_PATTERN.test(sourceDocumentContentFingerprint) ||
        !version ||
        !round ||
        round.status !== "open" ||
        round.sourceGeneratedDocumentId !== source.id
      ) {
        throw new Error("线下修订稿来源记录异常");
      }
      const sourceFile = await this.files.getFileBuffer(source.docxFileId);
      const baseSnapshot = extractContractDocx(sourceFile.buffer);
      const revisedSnapshot = extractContractDocx(revision.buffer);
      const result = compareContractDocumentSnapshots(
        baseSnapshot,
        revisedSnapshot,
        version.clauseSnapshot,
        version.templateSnapshot
      );
      const convertedPdf = await convertDocxToPdf(revision.buffer);
      const normalizedPdf = await normalizeContractPdf(convertedPdf, []);
      const preview = await this.files.uploadPrivateFile({
        originalName: `${job.label.replace(/[\\/\0\r\n]/gu, "_")}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: normalizedPdf.buffer.length,
        uploadedByUserId: job.confirmedByUserId,
        buffer: normalizedPdf.buffer
      });
      uploadedPdfFileId = preview.id;
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        const mutationBoundary = await lockContractDraftMutationBoundary<{
          id: string;
          contractId: string;
          draftRevision: number;
          documentContentRevision: number;
          documentContentFingerprint: string | null;
          status: string;
          changeType: string | null;
        }, {
          id: string;
          voidedAt: Date | null;
        }>(tx, job.contractVersionId, {
          allowHistoricalTakeoverInspection: true,
          allowEndedApplicationInspection: true
        });
        const currentRound = await tx.contractNegotiationRound.findUnique({
          where: { id: job.negotiationRoundId! }
        });
        const version = mutationBoundary?.version;
        if (
          !mutationBoundary ||
          mutationBoundary.contract.voidedAt ||
          mutationBoundary.formalBlockers.length > 0 ||
          !version ||
          version.changeType === "historical_takeover" ||
          version.hasHistoricalTakeoverRelation === true ||
          version.status !== "draft" ||
          version.documentContentRevision !== sourceDocumentContentRevision ||
          version.documentContentFingerprint !== sourceDocumentContentFingerprint ||
          !currentRound ||
          currentRound.status !== "open"
        ) {
          const revisionUpdated = await tx.contractOfflineRevision.updateMany({
            where: { id: job.id, status: "processing" },
            data: { status: "stale", completedAt, errorMessage: null }
          });
          await tx.contractDocumentComparison.updateMany({
            where: { id: job.comparisonId, status: "processing" },
            data: { status: "stale", completedAt, errorMessage: null }
          });
          if (revisionUpdated.count === 1) {
            await this.audit.record(tx, {
              actorUserId: job.confirmedByUserId,
              action: "contract.offline_revision.process_stale",
              businessType: "contract_offline_revision",
              businessId: job.id,
              metadata: {
                comparisonId: job.comparisonId,
                orphanPdfFileId: preview.id,
                sourceRevision: job.sourceRevision
              }
            });
          }
          return;
        }
        await tx.contractDocumentDifference.deleteMany({
          where: { comparisonId: job.comparisonId }
        });
        if (result.differences.length) {
          await tx.contractDocumentDifference.createMany({
            data: result.differences.map((difference) => ({
              comparisonId: job.comparisonId,
              differenceKey: difference.differenceKey,
              sortOrder: difference.sortOrder,
              changeType: difference.changeType,
              kind: difference.kind,
              locationPath: difference.locationPath,
              basePath: difference.basePath,
              revisedPath: difference.revisedPath,
              beforeText: difference.beforeText,
              afterText: difference.afterText,
              candidate: difference.candidate
                ? (difference.candidate as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              disposition: "pending"
            }))
          });
        }
        const revisionUpdated = await tx.contractOfflineRevision.updateMany({
          where: { id: job.id, status: "processing" },
          data: {
            status: "succeeded",
            previewPdfFileId: preview.id,
            completedAt,
            errorMessage: null
          }
        });
        const comparisonUpdated = await tx.contractDocumentComparison.updateMany({
          where: { id: job.comparisonId, status: "processing" },
          data: {
            status: "succeeded",
            algorithmVersion: result.algorithmVersion,
            baseNormalizedSha256: result.baseNormalizedSha256,
            revisedNormalizedSha256: result.revisionNormalizedSha256,
            completedAt,
            errorMessage: null
          }
        });
        if (revisionUpdated.count !== 1 || comparisonUpdated.count !== 1) {
          throw new Error("线下修订稿处理状态已变化");
        }
        if (job.previewPdfFileId) {
          await this.files.linkFileReplacement(tx, {
            newFileId: preview.id,
            oldFileId: job.previewPdfFileId,
            actorUserId: job.confirmedByUserId
          });
        }
        await this.audit.record(tx, {
          actorUserId: job.confirmedByUserId,
          action: "contract.offline_revision.process_success",
          businessType: "contract_offline_revision",
          businessId: job.id,
          metadata: {
            comparisonId: job.comparisonId,
            previewPdfFileId: preview.id,
            previousPreviewPdfFileId: job.previewPdfFileId,
            replacementKind: job.previewPdfFileId
              ? "contract_offline_revision_preview_retry"
              : null,
            differenceCount: result.differences.length,
            algorithmVersion: result.algorithmVersion,
            sourceRevision: job.sourceRevision
          }
        });
      });
    } catch (cause) {
      await this.failOfflineRevision(job, cause, uploadedPdfFileId);
    }
  }

  private async processPreview(job: {
    id: string;
    layoutTemplateVersionId: string;
    sampleData: Prisma.JsonValue;
    sourceRevision: number;
    createdByUserId: string;
  }) {
    try {
      const layout = await this.prisma.contractLayoutTemplateVersion.findUnique({
        where: { id: job.layoutTemplateVersionId }
      });
      if (!layout) throw new Error("合同版式版本不存在");
      if (!["draft", "submitted"].includes(layout.status)) {
        throw new Error("合同版式版本已不可预览，请刷新后重试");
      }
      if (layout.draftRevision !== job.sourceRevision) {
        await this.markPreviewStale(job);
        return;
      }
      const values = this.previewValues(job.sampleData);
      const billKeys = declaredBillKeys(
        layout.placeholderSchema,
        layout.inspectionReport
      );
      for (const billKey of new Set([
        ...billKeys,
        ...Object.keys(values).filter((key) => /^bill\.[^.]+$/.test(key))
      ])) {
        if (!Array.isArray(values[billKey])) {
          throw new Error("合同版式预览清单数据格式不正确");
        }
      }
      const source = await this.files.getFileBuffer(layout.docxFileId);
      const docx = renderContractDocx(
        source.buffer,
        { values },
        requiredPlaceholderKeys(layout.placeholderSchema, layout.inspectionReport)
      );
      const pdf = await convertDocxToPdf(docx);
      const uploaded = await this.files.uploadPrivateFile({
        originalName: `layout-preview-${job.id}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        uploadedByUserId: job.createdByUserId,
        buffer: pdf
      });
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        const currentLayout = await tx.contractLayoutTemplateVersion.findUnique({
          where: { id: job.layoutTemplateVersionId }
        });
        if (!currentLayout || !["draft", "submitted"].includes(currentLayout.status)) {
          throw new Error("合同版式版本已不可预览，请刷新后重试");
        }
        if (currentLayout.draftRevision !== job.sourceRevision) {
          await tx.contractLayoutPreviewJob.updateMany({
            where: { id: job.id, status: "processing", sourceRevision: job.sourceRevision },
            data: { status: "stale", completedAt, errorMessage: null }
          });
          return;
        }
        const updated = await tx.contractLayoutPreviewJob.updateMany({
          where: { id: job.id, status: "processing", sourceRevision: job.sourceRevision },
          data: {
            status: "succeeded",
            previewPdfFileId: uploaded.id,
            completedAt,
            errorMessage: null
          }
        });
        if (updated.count !== 1) return;
        await this.audit.record(tx, {
          actorUserId: job.createdByUserId,
          action: "contract.layout_preview.success",
          businessType: "contract_layout_preview_job",
          businessId: job.id,
          metadata: { previewPdfFileId: uploaded.id, sourceRevision: job.sourceRevision }
        });
      });
    } catch (cause) {
      await this.failPreview(job, cause);
    }
  }

  private markPreviewStale(job: { id: string; sourceRevision: number }) {
    return this.prisma.$transaction((tx) =>
      tx.contractLayoutPreviewJob.updateMany({
        where: { id: job.id, status: "processing", sourceRevision: job.sourceRevision },
        data: { status: "stale", completedAt: new Date(), errorMessage: null }
      })
    );
  }

  private async processDocument(job: {
    id: string;
    contractVersionId: string;
    purpose: string;
    sourceRevision: number;
    inputSnapshot: Prisma.JsonValue;
    createdByUserId: string;
  }) {
    const uploadedFileIds: string[] = [];
    try {
      const snapshot = this.documentSnapshot(job.inputSnapshot);
      const template = await this.files.getFileBuffer(snapshot.templateFileId);
      const docx = renderContractDocx(
        template.buffer,
        snapshot.renderInput,
        snapshot.requiredKeys,
        { allowBlankWatermark: job.purpose === "external" }
      );
      const attachments: PdfAttachment[] = [];
      for (const attachment of snapshot.attachmentFiles) {
        const source = await this.files.getFileBuffer(attachment.id);
        attachments.push({
          name: attachment.originalName,
          buffer: source.buffer,
          type: this.attachmentType(attachment.originalName, attachment.mimeType)
        });
      }
      const finalDocx = appendDocxImageAttachments(docx, attachments);
      const docxFile = await this.files.uploadPrivateFile({
        originalName: `${snapshot.outputBaseName}.docx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: finalDocx.length,
        uploadedByUserId: job.createdByUserId,
        buffer: finalDocx
      });
      uploadedFileIds.push(docxFile.id);
      const convertedPdf = await convertDocxToPdf(finalDocx);
      const pdfAttachments = attachments.filter((attachment) => attachment.type === "pdf");
      const normalized = await normalizeContractPdf(convertedPdf, pdfAttachments);
      const pdfFile = await this.files.uploadPrivateFile({
        originalName: `${snapshot.outputBaseName}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: normalized.buffer.length,
        uploadedByUserId: job.createdByUserId,
        buffer: normalized.buffer
      });
      uploadedFileIds.push(pdfFile.id);
      const completedAt = new Date();
      const outcome = await this.prisma.$transaction(async (tx) => {
        const mutationBoundary = await lockContractDraftMutationBoundary<{
          id: string;
          contractId: string;
          draftRevision: number;
          documentContentRevision: number;
          documentContentFingerprint: string | null;
          status: string;
          changeType: string | null;
          draftData: Prisma.JsonValue;
          latestDraftPreviewDocumentId: string | null;
        }, {
          id: string;
          voidedAt: Date | null;
        }>(tx, job.contractVersionId, {
          allowHistoricalTakeoverInspection: true,
          allowEndedApplicationInspection: true
        });
        const version = mutationBoundary?.version;
        if (
          !mutationBoundary ||
          mutationBoundary.contract.voidedAt ||
          mutationBoundary.formalBlockers.length > 0 ||
          !version ||
          version.documentContentRevision !== snapshot.documentContentRevision ||
          version.documentContentFingerprint !== snapshot.documentContentFingerprint ||
          version.status !== "draft" ||
          version.changeType === "historical_takeover" ||
          version.hasHistoricalTakeoverRelation === true
        ) {
          await tx.contractGeneratedDocument.updateMany({
            where: {
              id: job.id,
              status: "processing",
              sourceRevision: job.sourceRevision
            },
            data: { status: "stale", completedAt, errorMessage: null }
          });
          return { published: false, discardFileIds: uploadedFileIds };
        }
        const draftData = version.draftData &&
          typeof version.draftData === "object" &&
          !Array.isArray(version.draftData)
          ? version.draftData
          : {};
        const selection = "companyEntitySelection" in draftData &&
          draftData.companyEntitySelection &&
          typeof draftData.companyEntitySelection === "object" &&
          !Array.isArray(draftData.companyEntitySelection)
          ? draftData.companyEntitySelection
          : {};
        const companyEntityId = "id" in selection && typeof selection.id === "string"
          ? selection.id
          : null;
        const companyVersionNo = "versionNo" in selection &&
          typeof selection.versionNo === "number" &&
          Number.isInteger(selection.versionNo)
          ? selection.versionNo
          : null;
        if (
          version.changeType !== "change" &&
          version.changeType !== "supplement" &&
          companyEntityId &&
          companyVersionNo !== null
        ) {
          await tx.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "CompanyEntity"
            WHERE "id" = ${companyEntityId}
            FOR UPDATE
          `);
          const companyEntity = await tx.companyEntity.findUnique({
            where: { id: companyEntityId }
          });
          if (
            !companyEntity ||
            !companyEntity.isActive ||
            companyEntity.dataStatus !== "complete" ||
            companyEntity.currentVersionNo !== companyVersionNo
          ) {
            await tx.contractGeneratedDocument.updateMany({
              where: {
                id: job.id,
                status: "processing",
                sourceRevision: job.sourceRevision
              },
              data: { status: "stale", completedAt, errorMessage: null }
            });
            return { published: false, discardFileIds: uploadedFileIds };
          }
        }
        const updated = await tx.contractGeneratedDocument.updateMany({
          where: {
            id: job.id,
            status: "processing",
            sourceRevision: job.sourceRevision
          },
          data: {
            status: "success",
            docxFileId: docxFile.id,
            pdfFileId: pdfFile.id,
            completedAt,
            errorMessage: null,
            engineVersion: CONTRACT_DOCUMENT_ENGINE_VERSION,
            inputSnapshot: {
              ...snapshot,
              inspection: {
                pageCount: normalized.pageCount,
                pageSizes: normalized.pageSizes,
                warnings: normalized.warnings
              }
            } as unknown as Prisma.InputJsonValue
          }
        });
        if (updated.count !== 1) {
          return { published: false, discardFileIds: uploadedFileIds };
        }
        const predecessor = await tx.contractGeneratedDocument.findFirst({
          where:
            job.purpose === "draft" &&
            version.latestDraftPreviewDocumentId
              ? {
                  id: version.latestDraftPreviewDocumentId,
                  contractVersionId: job.contractVersionId,
                  purpose: "draft",
                  status: { in: ["success", "stale"] },
                  docxFileId: { not: null },
                  pdfFileId: { not: null }
                }
              : {
                  id: { not: job.id },
                  contractVersionId: job.contractVersionId,
                  purpose: job.purpose,
                  status: { in: ["success", "stale"] },
                  docxFileId: { not: null },
                  pdfFileId: { not: null }
                },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" }
          ],
          select: {
            id: true,
            sourceRevision: true,
            status: true,
            docxFileId: true,
            pdfFileId: true
          }
        });
        if (
          job.purpose === "draft" &&
          version.latestDraftPreviewDocumentId &&
          !predecessor
        ) {
          throw new Error("上一份合同草稿预览记录异常，请刷新后重试");
        }
        let predecessorDocumentId: string | null = null;
        let docxOldFileId: string | null = null;
        let pdfOldFileId: string | null = null;
        if (predecessor) {
          const { id, docxFileId, pdfFileId } = predecessor;
          if (
            typeof id !== "string" ||
            !id.trim() ||
            typeof docxFileId !== "string" ||
            !docxFileId.trim() ||
            typeof pdfFileId !== "string" ||
            !pdfFileId.trim()
          ) {
            throw new Error("合同生成文档前驱文件记录异常，无法接入版本链");
          }
          predecessorDocumentId = id;
          docxOldFileId = docxFileId;
          pdfOldFileId = pdfFileId;
          if (job.purpose !== "draft") {
            await this.files.linkFileReplacement(tx, {
              newFileId: docxFile.id,
              oldFileId: docxFileId,
              actorUserId: job.createdByUserId
            });
            await this.files.linkFileReplacement(tx, {
              newFileId: pdfFile.id,
              oldFileId: pdfFileId,
              actorUserId: job.createdByUserId
            });
          }
        }
        if (job.purpose === "draft") {
          const pointerUpdated = await tx.contractVersion.updateMany({
            where: {
              id: job.contractVersionId,
              documentContentRevision: snapshot.documentContentRevision,
              documentContentFingerprint: snapshot.documentContentFingerprint,
              latestDraftPreviewDocumentId:
                version.latestDraftPreviewDocumentId ?? null
            },
            data: { latestDraftPreviewDocumentId: job.id }
          });
          if (pointerUpdated.count !== 1) {
            throw new Error("合同草稿预览已被其他任务更新，请刷新后重试");
          }
          if (predecessor && docxOldFileId && pdfOldFileId) {
            const superseded = await tx.contractGeneratedDocument.updateMany({
              where: {
                id: predecessor.id,
                status: predecessor.status,
                docxFileId: docxOldFileId,
                pdfFileId: pdfOldFileId
              },
              data: {
                status: "superseded",
                docxFileId: null,
                pdfFileId: null
              }
            });
            if (superseded.count !== 1) {
              throw new Error("上一份合同草稿预览状态已变化，请刷新后重试");
            }
          }
        }
        await this.audit.record(tx, {
          actorUserId: job.createdByUserId,
          action: "contract.document.success",
          businessType: "contract_generated_document",
          businessId: job.id,
          metadata: {
            docxFileId: docxFile.id,
            pdfFileId: pdfFile.id,
            pageCount: normalized.pageCount,
            predecessorDocumentId,
            docxOldFileId,
            docxNewFileId: docxFile.id,
            pdfOldFileId,
            pdfNewFileId: pdfFile.id,
            sourceRevision: job.sourceRevision,
            documentContentRevision: snapshot.documentContentRevision,
            documentContentFingerprint: snapshot.documentContentFingerprint,
            replacementKind: predecessorDocumentId
              ? job.purpose === "draft"
                ? "contract_draft_preview_superseded"
                : "contract_generated_document_revision"
              : null
          }
        });
        return {
          published: true,
          discardFileIds:
            job.purpose === "draft" && docxOldFileId && pdfOldFileId
              ? [docxOldFileId, pdfOldFileId]
              : []
        };
      });
      await this.files.discardUnlinkedGeneratedFiles(
        outcome.discardFileIds,
        job.createdByUserId
      );
    } catch (cause) {
      await this.failDocument(job, cause, uploadedFileIds);
      await this.files.discardUnlinkedGeneratedFiles(
        uploadedFileIds,
        job.createdByUserId
      );
    }
  }

  private async failPreview(
    job: { id: string; createdByUserId: string; sourceRevision: number },
    cause: unknown
  ) {
    const errorMessage = this.errorMessage(
      cause,
      "合同版式预览生成失败，请检查版式和预览数据后重试"
    );
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractLayoutPreviewJob.updateMany({
        where: { id: job.id, status: "processing", sourceRevision: job.sourceRevision },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      if (updated.count !== 1) return;
      await this.audit.record(tx, {
        actorUserId: job.createdByUserId,
        action: "contract.layout_preview.failure",
        businessType: "contract_layout_preview_job",
        businessId: job.id,
        metadata: { errorMessage, sourceRevision: job.sourceRevision }
      });
    });
  }

  private async failDocument(
    job: { id: string; createdByUserId: string; sourceRevision: number },
    cause: unknown,
    uploadedFileIds: string[]
  ) {
    const errorMessage = this.errorMessage(
      cause,
      "合同文档生成失败，请检查模板和附件后重试"
    );
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractGeneratedDocument.updateMany({
        where: {
          id: job.id,
          status: "processing",
          sourceRevision: job.sourceRevision
        },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      if (updated.count !== 1) return;
      await this.audit.record(tx, {
        actorUserId: job.createdByUserId,
        action: "contract.document.failure",
        businessType: "contract_generated_document",
        businessId: job.id,
        metadata: { errorMessage, orphanFileIds: uploadedFileIds }
      });
    });
  }

  private async failOfflineRevision(
    job: {
      id: string;
      comparisonId: string;
      confirmedByUserId: string;
      sourceRevision: number | null;
    },
    _cause: unknown,
    orphanPdfFileId: string | null
  ) {
    const errorMessage = "线下修订稿解析、比较或 PDF 生成失败，请检查 DOCX 后重试";
    await this.prisma.$transaction(async (tx) => {
      const revisionUpdated = await tx.contractOfflineRevision.updateMany({
        where: { id: job.id, status: "processing" },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      if (revisionUpdated.count !== 1) return;
      await tx.contractDocumentComparison.updateMany({
        where: { id: job.comparisonId, status: "processing" },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      await this.audit.record(tx, {
        actorUserId: job.confirmedByUserId,
        action: "contract.offline_revision.process_failure",
        businessType: "contract_offline_revision",
        businessId: job.id,
        metadata: {
          comparisonId: job.comparisonId,
          errorMessage,
          orphanPdfFileId,
          sourceRevision: job.sourceRevision
        }
      });
    });
  }

  private documentSnapshot(value: Prisma.JsonValue): ContractDocumentInputSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("合同文档输入快照格式不正确");
    }
    const snapshot = value as unknown as ContractDocumentInputSnapshot;
    if (
      !Number.isInteger(snapshot.documentContentRevision) ||
      snapshot.documentContentRevision < 1 ||
      typeof snapshot.documentContentFingerprint !== "string" ||
      !SHA256_PATTERN.test(snapshot.documentContentFingerprint) ||
      typeof snapshot.templateFileId !== "string" ||
      typeof snapshot.outputBaseName !== "string" ||
      !snapshot.outputBaseName.trim() ||
      !snapshot.renderInput ||
      typeof snapshot.renderInput.values !== "object" ||
      (snapshot.requiredKeys !== undefined && !Array.isArray(snapshot.requiredKeys)) ||
      !Array.isArray(snapshot.attachmentFiles)
    ) {
      throw new Error("合同文档输入快照格式不正确");
    }
    return {
      ...snapshot,
      requiredKeys: snapshot.requiredKeys ?? []
    };
  }

  private previewValues(sampleData: Prisma.JsonValue) {
    const values: Record<string, unknown> = {};
    const flatten = (value: unknown, prefix = "") => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        if (prefix) values[prefix] = value;
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        flatten(nested, prefix ? `${prefix}.${key}` : key);
      }
    };
    if (
      sampleData &&
      typeof sampleData === "object" &&
      !Array.isArray(sampleData) &&
      "values" in sampleData &&
      sampleData.values &&
      typeof sampleData.values === "object" &&
      !Array.isArray(sampleData.values)
    ) {
      Object.assign(values, sampleData.values);
    } else {
      flatten(sampleData);
    }
    values["contract.name"] ??= "版式预览合同";
    values["contract.temporaryCode"] ??= "预览";
    values["document.watermark"] ??= "预览";
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === "boolean" ? String(value) : value
      ])
    );
  }

  private attachmentType(
    originalName: string,
    mimeType: string
  ): PdfAttachment["type"] {
    const lowerName = originalName.toLowerCase();
    if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
    if (mimeType === "image/png" || lowerName.endsWith(".png")) return "png";
    if (
      mimeType === "image/jpeg" ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg")
    ) {
      return "jpeg";
    }
    return undefined;
  }

  private errorMessage(cause: unknown, fallback: string) {
    let message: string;
    try {
      message = cause instanceof Error ? cause.message : String(cause);
    } catch {
      return fallback;
    }
    return SAFE_PERSISTED_ERROR_MESSAGES.has(message)
      ? message.slice(0, ERROR_MESSAGE_LIMIT)
      : fallback;
  }
}
