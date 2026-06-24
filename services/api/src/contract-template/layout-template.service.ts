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
      select: { layoutTemplateId: true }
    });
    const ids = [...new Set(versions.map((version) => version.layoutTemplateId))];
    if (!ids.length) return [];
    return this.prisma.contractLayoutTemplate.findMany({
      where: {
        id: { in: ids },
        ...(contractTypeKey ? { contractTypeKey } : {})
      },
      orderBy: { createdAt: "asc" }
    });
  }

  async createLayout(actorUserId: string, input: CreateLayoutInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const file = await tx.fileObject.findUnique({ where: { id: input.docxFileId } });
      if (!file) throw new NotFoundException("Layout source file not found");
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
      await this.record(tx, actorUserId, "create", template.id);
      return { template, version };
    });
  }

  async inspectVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      const version = await this.findMutableVersion(tx, versionId);
      const source = await this.files.getFileBuffer(version.docxFileId);
      const report = this.inspectDocx(source.buffer, version.placeholderSchema);
      await tx.contractLayoutTemplateVersion.update({
        where: { id: versionId },
        data: { inspectionReport: report as unknown as Prisma.InputJsonValue }
      });
      await this.record(tx, actorUserId, "inspect", versionId);
      return report;
    });
  }

  async queuePreview(versionId: string, actorUserId: string, sampleData: unknown) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalRole(tx, actorUserId, "contract_staff");
      await this.findMutableVersion(tx, versionId);
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
      const updated = await tx.contractLayoutTemplateVersion.update({
        where: { id: versionId },
        data: { status: "submitted", submittedByUserId: actorUserId }
      });
      await this.record(tx, actorUserId, "submit", versionId);
      return updated;
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
      const updated = await tx.contractLayoutTemplateVersion.update({
        where: { id: versionId },
        data: {
          status: "published",
          previewPdfFileId: preview.previewPdfFileId,
          publishedByUserId: actorUserId,
          publishedAt: new Date(),
          changeSummary
        }
      });
      await this.record(tx, actorUserId, "publish", versionId, { changeSummary });
      return updated;
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
    const text = Object.keys(zip.files)
      .filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
      .map((name) => zip.file(name)?.asText() ?? "")
      .join("\n");
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
    const styles = zip.file("word/styles.xml")?.asText() ?? "";
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
      const updated = await tx.contractLayoutTemplateVersion.update({
        where: { id: versionId },
        data: {
          status,
          ...(status === "stopped" ? { stoppedAt: new Date() } : { revokedAt: new Date() })
        }
      });
      await this.record(tx, actorUserId, status, versionId);
      return updated;
    });
  }

  private async findMutableVersion(tx: Prisma.TransactionClient, versionId: string) {
    const version = await this.findVersion(tx, versionId);
    if (version.status === "published") {
      throw new BadRequestException("Published layout versions are immutable");
    }
    if (version.status === "stopped" || version.status === "revoked") {
      throw new BadRequestException("Inactive layout versions are immutable");
    }
    return version;
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
