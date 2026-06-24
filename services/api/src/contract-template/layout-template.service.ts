import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import PizZip from "pizzip";
import type { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";

export interface LayoutInspectionReport {
  placeholders: string[];
  unknownPlaceholders: string[];
  missingRequiredPlaceholders: string[];
  hasBillLoop: boolean;
  blockingErrors: string[];
  warnings: string[];
}

interface CreateLayoutInput {
  name: string;
  contractTypeKey: string;
  docxFileId: string;
  placeholderSchema: unknown;
}

type RoleClient = {
  userPosition: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ positionId: string }>>;
  };
  position: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ key: string }>>;
  };
};

const REQUIRED_PLACEHOLDERS = [
  "contract.name",
  "contract.temporaryCode",
  "document.watermark"
];
const RECOGNIZED_NAMESPACE = /^(contract|party|field|clause|bill|document)\./;
const DOCX_INSPECTION_XML_MAX_BYTES = 2_000_000;
const INSPECTION_XML_PATH = /^word\/(document|header\d+|footer\d+|styles)\.xml$/;

@Injectable()
export class LayoutTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService
  ) {}

  async listPublishedLayouts(contractTypeKey?: string) {
    const versions = await this.prisma.contractLayoutTemplateVersion.findMany({
      where: { status: "published" },
      select: {
        id: true,
        layoutTemplateId: true,
        versionNo: true,
        previewPdfFileId: true,
        publishedAt: true
      }
    });
    const ids = [...new Set(versions.map((version) => version.layoutTemplateId))];
    if (!ids.length) return [];
    const templates = await this.prisma.contractLayoutTemplate.findMany({
      where: {
        id: { in: ids },
        ...(contractTypeKey ? { contractTypeKey } : {})
      },
      orderBy: { createdAt: "asc" }
    });
    const templateById = new Map(templates.map((template) => [template.id, template]));
    return versions.flatMap((version) => {
      const template = templateById.get(version.layoutTemplateId);
      return template
        ? [
            {
              ...template,
              layoutTemplateVersionId: version.id,
              versionNo: version.versionNo,
              previewPdfFileId: version.previewPdfFileId,
              publishedAt: version.publishedAt
            }
          ]
        : [];
    });
  }

  async createLayout(actorUserId: string, input: CreateLayoutInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const file = await tx.fileObject.findUnique({ where: { id: input.docxFileId } });
      if (!file) throw new NotFoundException("Layout source file not found");
      if (file.uploadedByUserId !== actorUserId) {
        throw new ForbiddenException("Layout source file must be uploaded by the actor");
      }
      if (!file.originalName.toLowerCase().endsWith(".docx")) {
        throw new BadRequestException("Layout source must be a DOCX file");
      }

      const template = await tx.contractLayoutTemplate.create({
        data: {
          name: input.name,
          contractTypeKey: input.contractTypeKey,
          createdByUserId: actorUserId
        }
      });
      const version = await tx.contractLayoutTemplateVersion.create({
        data: {
          layoutTemplateId: template.id,
          versionNo: 1,
          status: "draft",
          docxFileId: input.docxFileId,
          placeholderSchema: input.placeholderSchema as Prisma.InputJsonValue
        }
      });
      await this.record(tx, actorUserId, "create", version.id);
      return { template, version };
    });
  }

  async inspectVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("Only draft layout versions can be inspected");
      }
      const source = await this.files.getFileBuffer(version.docxFileId);
      const report = this.inspectDocx(source.buffer, version.placeholderSchema);
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft" },
        data: { inspectionReport: report as unknown as Prisma.InputJsonValue }
      });
      if (result.count !== 1) {
        throw new BadRequestException("Layout version status changed");
      }
      await this.record(tx, actorUserId, "inspect", versionId);
      return report;
    });
  }

  async queuePreview(versionId: string, actorUserId: string, sampleData: unknown) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("Only draft layout versions can be previewed");
      }
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft" },
        data: { status: "draft" }
      });
      if (result.count !== 1) {
        throw new BadRequestException("Layout version status changed");
      }
      const job = await tx.contractLayoutPreviewJob.create({
        data: {
          layoutTemplateVersionId: versionId,
          status: "queued",
          sampleData: sampleData as Prisma.InputJsonValue,
          createdByUserId: actorUserId
        }
      });
      await this.record(tx, actorUserId, "queue_preview", versionId);
      return job;
    });
  }

  getLatestPreview(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      return tx.contractLayoutPreviewJob.findFirst({
        where: { layoutTemplateVersionId: versionId },
        orderBy: { createdAt: "desc" }
      });
    });
  }

  async submitVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("Only draft layout versions can be submitted");
      }
      const report = version.inspectionReport as unknown as LayoutInspectionReport | null;
      if (!report || report.blockingErrors.length) {
        throw new BadRequestException("Layout inspection has blocking errors");
      }
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft" },
        data: { status: "submitted", submittedByUserId: actorUserId }
      });
      if (result.count !== 1) {
        throw new BadRequestException("Layout version status changed");
      }
      await this.record(tx, actorUserId, "submit", versionId);
      return { ...version, status: "submitted", submittedByUserId: actorUserId };
    });
  }

  async publishVersion(versionId: string, actorUserId: string, changeSummary: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_director");
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "submitted") {
        throw new BadRequestException("Only submitted layout versions can be published");
      }
      const report = version.inspectionReport as unknown as LayoutInspectionReport | null;
      if (!report || report.blockingErrors.length) {
        throw new BadRequestException("Layout inspection has blocking errors");
      }
      const preview = await tx.contractLayoutPreviewJob.findFirst({
        where: { layoutTemplateVersionId: versionId },
        orderBy: { createdAt: "desc" }
      });
      if (preview?.status !== "succeeded" || !preview.previewPdfFileId) {
        throw new BadRequestException("Latest layout preview has not succeeded");
      }
      const publishedAt = new Date();
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "submitted" },
        data: {
          status: "published",
          previewPdfFileId: preview.previewPdfFileId,
          publishedByUserId: actorUserId,
          publishedAt,
          changeSummary
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("Layout version status changed");
      }
      await this.record(tx, actorUserId, "publish", versionId, { changeSummary });
      return {
        ...version,
        status: "published",
        previewPdfFileId: preview.previewPdfFileId,
        publishedByUserId: actorUserId,
        publishedAt,
        changeSummary
      };
    });
  }

  async cloneVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const source = await this.findVersion(tx, versionId);
      if (source.status !== "published") {
        throw new BadRequestException("Only published layout versions can be cloned");
      }
      const latest = await tx.contractLayoutTemplateVersion.findFirst({
        where: { layoutTemplateId: source.layoutTemplateId },
        orderBy: { versionNo: "desc" }
      });
      const clone = await tx.contractLayoutTemplateVersion.create({
        data: {
          layoutTemplateId: source.layoutTemplateId,
          versionNo: (latest?.versionNo ?? 0) + 1,
          status: "draft",
          docxFileId: source.docxFileId,
          placeholderSchema: source.placeholderSchema as Prisma.InputJsonValue
        }
      });
      await this.record(tx, actorUserId, "clone", clone.id, { sourceVersionId: versionId });
      return clone;
    });
  }

  stopVersion(versionId: string, actorUserId: string) {
    return this.changePublishedStatus(versionId, actorUserId, "stopped");
  }

  revokeVersion(versionId: string, actorUserId: string) {
    return this.changePublishedStatus(versionId, actorUserId, "revoked");
  }

  private inspectDocx(buffer: Buffer, placeholderSchema: unknown): LayoutInspectionReport {
    const zip = (() => {
      try {
        return new PizZip(buffer);
      } catch {
        throw new BadRequestException("Invalid DOCX layout source");
      }
    })();
    const xmlEntries = Object.keys(zip.files)
      .filter((name) => INSPECTION_XML_PATH.test(name))
      .map((name) => zip.file(name))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const uncompressedSize = xmlEntries.reduce(
      (total, entry) =>
        total +
        ((entry as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize ?? 0),
      0
    );
    if (uncompressedSize > DOCX_INSPECTION_XML_MAX_BYTES) {
      throw new BadRequestException("DOCX inspection XML exceeds size limit");
    }
    let text: string;
    let styles: string;
    try {
      text = xmlEntries
        .filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(entry.name))
        .map((entry) => this.visibleWordText(entry.asText()))
        .join("\n");
      styles = xmlEntries.find((entry) => entry.name === "word/styles.xml")?.asText() ?? "";
    } catch {
      throw new BadRequestException("Invalid DOCX layout source");
    }
    const rawTags = [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) =>
      match[1].trim()
    );
    const placeholders = [
      ...new Set(rawTags.map((tag) => tag.replace(/^[#/]\s*/, "").trim()))
    ].sort();
    const unknownPlaceholders = placeholders.filter(
      (placeholder) => !RECOGNIZED_NAMESPACE.test(placeholder)
    );
    const missingRequiredPlaceholders = REQUIRED_PLACEHOLDERS.filter(
      (required) => !placeholders.includes(required)
    );
    const billKeys = this.billKeys(placeholderSchema);
    const loopKeys = [...text.matchAll(/\{#\s*bill\.([^{}\s]+)\s*\}/g)].map(
      (match) => match[1]
    );
    const hasBillLoop = billKeys.some((key) => loopKeys.includes(key));
    const blockingErrors: string[] = [];
    if (unknownPlaceholders.length) {
      blockingErrors.push(`Unknown placeholders: ${unknownPlaceholders.join(", ")}`);
    }
    if (missingRequiredPlaceholders.length) {
      blockingErrors.push(
        `Missing required placeholders: ${missingRequiredPlaceholders.join(", ")}`
      );
    }
    if (billKeys.length && !hasBillLoop) {
      blockingErrors.push(`Missing bill loop marker for: ${billKeys.join(", ")}`);
    }

    const allowedFonts = new Set(
      (process.env.DOC_ALLOWED_FONTS ?? "Noto Sans CJK SC,宋体,仿宋,黑体")
        .split(",")
        .map((font) => font.trim())
        .filter(Boolean)
    );
    const declaredFonts = [
      ...new Set(
        [...styles.matchAll(/w:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g)].map(
          (match) => match[1]
        )
      )
    ];
    const disallowedFonts = declaredFonts.filter((font) => !allowedFonts.has(font));
    if (disallowedFonts.length) {
      blockingErrors.push(`Disallowed fonts: ${disallowedFonts.join(", ")}`);
    }

    return {
      placeholders,
      unknownPlaceholders,
      missingRequiredPlaceholders,
      hasBillLoop,
      blockingErrors,
      warnings: []
    };
  }

  private billKeys(schema: unknown) {
    if (!schema || typeof schema !== "object") return [];
    const bills = (schema as { bills?: unknown }).bills;
    if (!Array.isArray(bills)) return [];
    return bills
      .map((bill) =>
        bill && typeof bill === "object" && typeof (bill as { key?: unknown }).key === "string"
          ? (bill as { key: string }).key
          : null
      )
      .filter((key): key is string => Boolean(key));
  }

  private async changePublishedStatus(
    versionId: string,
    actorUserId: string,
    status: "stopped" | "revoked"
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_director");
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "published") {
        throw new BadRequestException(`Only published layout versions can be ${status}`);
      }
      const changedAt = new Date();
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "published" },
        data: {
          status,
          ...(status === "stopped" ? { stoppedAt: changedAt } : { revokedAt: changedAt })
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("Layout version status changed");
      }
      await this.record(tx, actorUserId, status, versionId);
      return {
        ...version,
        status,
        ...(status === "stopped" ? { stoppedAt: changedAt } : { revokedAt: changedAt })
      };
    });
  }

  private visibleWordText(xml: string) {
    return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => this.decodeXmlEntities(match[1]))
      .join("");
  }

  private decodeXmlEntities(value: string) {
    return value.replace(
      /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
      (entity) => {
        const named: Record<string, string> = {
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'"
        };
        const normalized = entity.toLowerCase();
        if (named[normalized]) return named[normalized];
        const hexadecimal = normalized.startsWith("&#x");
        const codePoint = Number.parseInt(
          normalized.slice(hexadecimal ? 3 : 2, -1),
          hexadecimal ? 16 : 10
        );
        return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
      }
    );
  }

  private async findVersion(tx: Prisma.TransactionClient, versionId: string) {
    const version = await tx.contractLayoutTemplateVersion.findUnique({
      where: { id: versionId }
    });
    if (!version) throw new NotFoundException("Layout version not found");
    return version;
  }

  private async assertGlobalRole(
    tx: RoleClient,
    actorUserId: string,
    roleKey: "contract_staff" | "contract_director"
  ) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => position.key === roleKey)) {
      throw new ForbiddenException(`Requires global role: ${roleKey}`);
    }
  }

  private record(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    businessId: string,
    metadata?: Prisma.InputJsonValue
  ) {
    return this.audit.record(tx, {
      actorUserId,
      action: `contract_layout.${action}`,
      businessType: "contract_layout_template_version",
      businessId,
      metadata
    });
  }
}
