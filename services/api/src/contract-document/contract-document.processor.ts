import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { renderContractDocx } from "./contract-docx-renderer";
import {
  CONTRACT_DOCUMENT_ENGINE_VERSION,
  type ContractDocumentInputSnapshot
} from "./contract-document.service";
import { convertDocxToPdf } from "./libreoffice-converter";
import { normalizeContractPdf, type PdfAttachment } from "./pdf-normalizer";

const ERROR_MESSAGE_LIMIT = 2_000;

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
    this.timer = setInterval(() => void this.processNext(), 1_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async processNext() {
    if (this.running) return false;
    this.running = true;
    try {
      const preview = await this.claimPreview();
      if (preview) {
        await this.processPreview(preview);
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

  private async processPreview(job: {
    id: string;
    layoutTemplateVersionId: string;
    sampleData: Prisma.JsonValue;
    createdByUserId: string;
  }) {
    try {
      const layout = await this.prisma.contractLayoutTemplateVersion.findUnique({
        where: { id: job.layoutTemplateVersionId }
      });
      if (!layout) throw new Error("Layout template version not found");
      const source = await this.files.getFileBuffer(layout.docxFileId);
      const docx = renderContractDocx(source.buffer, {
        values: this.previewValues(job.sampleData)
      });
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
        await tx.contractLayoutPreviewJob.update({
          where: { id: job.id },
          data: {
            status: "succeeded",
            previewPdfFileId: uploaded.id,
            completedAt,
            errorMessage: null
          }
        });
        await this.audit.record(tx, {
          actorUserId: job.createdByUserId,
          action: "contract.layout_preview.success",
          businessType: "contract_layout_preview_job",
          businessId: job.id,
          metadata: { previewPdfFileId: uploaded.id }
        });
      });
    } catch (cause) {
      await this.failPreview(job, cause);
    }
  }

  private async processDocument(job: {
    id: string;
    purpose: string;
    sourceRevision: number;
    inputSnapshot: Prisma.JsonValue;
    createdByUserId: string;
  }) {
    const uploadedFileIds: string[] = [];
    try {
      const snapshot = this.documentSnapshot(job.inputSnapshot);
      const template = await this.files.getFileBuffer(snapshot.templateFileId);
      const docx = renderContractDocx(template.buffer, snapshot.renderInput);
      const convertedPdf = await convertDocxToPdf(docx);
      const attachments: PdfAttachment[] = [];
      for (const attachment of snapshot.attachmentFiles) {
        const source = await this.files.getFileBuffer(attachment.id);
        attachments.push({
          name: attachment.originalName,
          buffer: source.buffer,
          type: this.attachmentType(attachment.originalName, attachment.mimeType)
        });
      }
      const normalized = await normalizeContractPdf(convertedPdf, attachments);
      const docxFile = await this.files.uploadPrivateFile({
        originalName: `${snapshot.outputBaseName}.docx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: docx.length,
        uploadedByUserId: job.createdByUserId,
        buffer: docx
      });
      uploadedFileIds.push(docxFile.id);
      const pdfFile = await this.files.uploadPrivateFile({
        originalName: `${snapshot.outputBaseName}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: normalized.buffer.length,
        uploadedByUserId: job.createdByUserId,
        buffer: normalized.buffer
      });
      uploadedFileIds.push(pdfFile.id);
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.contractGeneratedDocument.update({
          where: { id: job.id },
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
        await this.audit.record(tx, {
          actorUserId: job.createdByUserId,
          action: "contract.document.success",
          businessType: "contract_generated_document",
          businessId: job.id,
          metadata: {
            docxFileId: docxFile.id,
            pdfFileId: pdfFile.id,
            pageCount: normalized.pageCount
          }
        });
      });
    } catch (cause) {
      await this.failDocument(job, cause, uploadedFileIds);
    }
  }

  private async failPreview(
    job: { id: string; createdByUserId: string },
    cause: unknown
  ) {
    const errorMessage = this.errorMessage(cause);
    await this.prisma.$transaction(async (tx) => {
      await tx.contractLayoutPreviewJob.updateMany({
        where: { id: job.id, status: "processing" },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      await this.audit.record(tx, {
        actorUserId: job.createdByUserId,
        action: "contract.layout_preview.failure",
        businessType: "contract_layout_preview_job",
        businessId: job.id,
        metadata: { errorMessage }
      });
    });
  }

  private async failDocument(
    job: { id: string; createdByUserId: string },
    cause: unknown,
    uploadedFileIds: string[]
  ) {
    const orphanNote = uploadedFileIds.length
      ? ` Uploaded private files may be orphaned: ${uploadedFileIds.join(", ")}.`
      : "";
    const errorMessage = this.errorMessage(`${this.errorMessage(cause)}${orphanNote}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.contractGeneratedDocument.updateMany({
        where: { id: job.id, status: "processing" },
        data: { status: "failed", errorMessage, completedAt: new Date() }
      });
      await this.audit.record(tx, {
        actorUserId: job.createdByUserId,
        action: "contract.document.failure",
        businessType: "contract_generated_document",
        businessId: job.id,
        metadata: { errorMessage, orphanFileIds: uploadedFileIds }
      });
    });
  }

  private documentSnapshot(value: Prisma.JsonValue): ContractDocumentInputSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid contract document input snapshot");
    }
    const snapshot = value as unknown as ContractDocumentInputSnapshot;
    if (
      typeof snapshot.templateFileId !== "string" ||
      typeof snapshot.outputBaseName !== "string" ||
      !snapshot.outputBaseName.trim() ||
      !snapshot.renderInput ||
      typeof snapshot.renderInput.values !== "object" ||
      !Array.isArray(snapshot.attachmentFiles)
    ) {
      throw new Error("Invalid contract document input snapshot");
    }
    return snapshot;
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
    values["contract.temporaryCode"] ??= "PREVIEW";
    values["document.watermark"] ??= "预览";
    return values;
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

  private errorMessage(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return message.slice(0, ERROR_MESSAGE_LIMIT);
  }
}
