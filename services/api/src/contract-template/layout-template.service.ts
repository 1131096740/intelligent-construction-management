import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  canonicalContractBillLoopKey,
  canonicalContractPlaceholder,
  CONTRACT_DOCUMENT_REQUIRED_PLACEHOLDERS,
  isContractBillRowPlaceholder
} from "../contract-document/contract-placeholder-registry";
import { FileService } from "../file/file.service";
import type {
  CreateLayoutTemplateDto,
  LayoutTemplatePreviewSampleDataDto,
  UpdateLayoutTemplateVersionDto
} from "./dto/layout-template.dto";

export interface LayoutInspectionReport {
  placeholders: string[];
  unknownPlaceholders: string[];
  missingRequiredPlaceholders: string[];
  hasBillLoop: boolean;
  blockingErrors: string[];
  warnings: string[];
}

type RoleClient = {
  userPosition: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ positionId: string }>>;
  };
  position: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ key: string }>>;
  };
};

const REQUIRED_PLACEHOLDERS = CONTRACT_DOCUMENT_REQUIRED_PLACEHOLDERS;
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

  async createLayout(actorUserId: string, input: CreateLayoutTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const file = await tx.fileObject.findUnique({ where: { id: input.docxFileId } });
      if (!file) throw new NotFoundException("未找到版式源文件，请重新上传 DOCX 文件");
      if (file.uploadedByUserId !== actorUserId) {
        throw new ForbiddenException("只能使用本人上传的版式源文件");
      }
      if (!file.originalName.toLowerCase().endsWith(".docx")) {
        throw new BadRequestException("版式源文件必须是 DOCX 文件");
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

  async getLayoutTemplate(templateId: string, actorUserId: string, includeHistory = false) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAnyGlobalRole(tx, actorUserId, ["contract_staff", "contract_director"]);
      const template = await tx.contractLayoutTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new NotFoundException("未找到合同版式模板，请刷新后重试");
      const versions = await tx.contractLayoutTemplateVersion.findMany({
        where: {
          layoutTemplateId: templateId,
          ...(includeHistory ? {} : { status: { not: "discarded" } })
        },
        orderBy: { versionNo: "desc" }
      });
      if (!includeHistory && versions.length === 0) {
        throw new NotFoundException("未找到合同版式模板，请刷新后重试");
      }
      const jobs = versions.length
        ? await tx.contractLayoutPreviewJob.findMany({
            where: {
              OR: versions.map((version) => ({
                layoutTemplateVersionId: version.id,
                sourceRevision: version.draftRevision
              }))
            },
            orderBy: { createdAt: "desc" }
          })
        : [];
      const latestByVersion = new Map<string, (typeof jobs)[number]>();
      for (const job of jobs) {
        if (!latestByVersion.has(job.layoutTemplateVersionId)) {
          latestByVersion.set(job.layoutTemplateVersionId, job);
        }
      }
      const actionModels = await Promise.all(versions.map(async (version) => {
        const [contract, generatedDocument] = await Promise.all([
          tx.contractVersion.findFirst({
            where: { layoutTemplateVersionId: version.id },
            select: { id: true }
          }),
          tx.contractGeneratedDocument.findFirst({
            where: { layoutTemplateVersionId: version.id },
            select: { id: true }
          })
        ]);
        return this.discardAction(
          version,
          contract || generatedDocument ? "该版本已被合同或生成文件引用" : null
        );
      }));
      return {
        template,
        versions: versions.map((version, index) => ({
          ...version,
          latestPreview: latestByVersion.get(version.id) ?? null,
          ...actionModels[index]
        }))
      };
    });
  }

  async updateDraftVersion(
    versionId: string,
    actorUserId: string,
    input: UpdateLayoutTemplateVersionDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的合同版式可以修改，请复制已发布版本后再编辑");
      }
      if (version.draftRevision !== input.expectedRevision) {
        throw new BadRequestException("版式草稿已被更新，请刷新后重试");
      }
      if (input.docxFileId === undefined && input.placeholderSchema === undefined) {
        throw new BadRequestException("请至少修改版式源文件或占位符结构");
      }
      if (input.docxFileId !== undefined) {
        await this.assertOwnedDocx(tx, input.docxFileId, actorUserId);
      }
      const nextRevision = version.draftRevision + 1;
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: input.expectedRevision },
        data: {
          draftRevision: { increment: 1 },
          ...(input.docxFileId !== undefined ? { docxFileId: input.docxFileId } : {}),
          ...(input.placeholderSchema !== undefined
            ? { placeholderSchema: input.placeholderSchema as Prisma.InputJsonValue }
            : {}),
          inspectionReport: Prisma.DbNull,
          inspectionRevision: null,
          previewPdfFileId: null
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("版式草稿已被更新，请刷新后重试");
      }
      const invalidatedPreviews = await tx.contractLayoutPreviewJob.updateMany({
        where: {
          layoutTemplateVersionId: versionId,
          sourceRevision: input.expectedRevision,
          status: { in: ["queued", "processing", "succeeded"] }
        },
        data: { status: "stale" }
      });
      await this.record(tx, actorUserId, "update_draft", versionId, {
        fromRevision: input.expectedRevision,
        toRevision: nextRevision,
        docxFileChanged: input.docxFileId !== undefined,
        placeholderSchemaChanged: input.placeholderSchema !== undefined,
        invalidatedPreviewCount: invalidatedPreviews.count
      });
      return {
        ...version,
        draftRevision: nextRevision,
        ...(input.docxFileId !== undefined ? { docxFileId: input.docxFileId } : {}),
        ...(input.placeholderSchema !== undefined
          ? { placeholderSchema: input.placeholderSchema }
          : {}),
        inspectionReport: null,
        inspectionRevision: null,
        previewPdfFileId: null
      };
    });
  }

  async inspectVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的合同版式可以检查");
      }
      const source = await this.files.getFileBuffer(version.docxFileId);
      const report = this.inspectDocx(source.buffer, version.placeholderSchema);
      const sourceRevision = version.draftRevision;
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: sourceRevision },
        data: {
          inspectionReport: report as unknown as Prisma.InputJsonValue,
          inspectionRevision: sourceRevision
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("合同版式状态已变化，请刷新后重试");
      }
      await this.record(tx, actorUserId, "inspect", versionId, { sourceRevision });
      return { ...report, sourceRevision };
    });
  }

  async queuePreview(
    versionId: string,
    actorUserId: string,
    sampleData: LayoutTemplatePreviewSampleDataDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的合同版式可以生成预览");
      }
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: version.draftRevision },
        data: { status: "draft" }
      });
      if (result.count !== 1) {
        throw new BadRequestException("合同版式状态已变化，请刷新后重试");
      }
      const job = await tx.contractLayoutPreviewJob.create({
        data: {
          layoutTemplateVersionId: versionId,
          status: "queued",
          sampleData: sampleData as Prisma.InputJsonValue,
          sourceRevision: version.draftRevision,
          createdByUserId: actorUserId
        }
      });
      await this.record(tx, actorUserId, "queue_preview", versionId, {
        sourceRevision: version.draftRevision,
        previewJobId: job.id
      });
      return job;
    });
  }

  getLatestPreview(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      return tx.contractLayoutPreviewJob.findFirst({
        where: { layoutTemplateVersionId: versionId },
        orderBy: { createdAt: "desc" }
      });
    });
  }

  async submitVersion(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的合同版式可以提交");
      }
      const report = version.inspectionReport as unknown as LayoutInspectionReport | null;
      if (
        !report ||
        report.blockingErrors.length ||
        version.inspectionRevision !== version.draftRevision
      ) {
        throw new BadRequestException("版式检查仍有阻断项，请处理后再提交或发布");
      }
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: version.draftRevision },
        data: { status: "submitted", submittedByUserId: actorUserId }
      });
      if (result.count !== 1) {
        throw new BadRequestException("合同版式状态已变化，请刷新后重试");
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
        throw new BadRequestException("只有已提交的合同版式可以发布");
      }
      const report = version.inspectionReport as unknown as LayoutInspectionReport | null;
      if (
        !report ||
        report.blockingErrors.length ||
        version.inspectionRevision !== version.draftRevision
      ) {
        throw new BadRequestException("版式检查仍有阻断项，请处理后再提交或发布");
      }
      const preview = await tx.contractLayoutPreviewJob.findFirst({
        where: {
          layoutTemplateVersionId: versionId,
          sourceRevision: version.draftRevision
        },
        orderBy: { createdAt: "desc" }
      });
      if (preview?.status !== "succeeded" || !preview.previewPdfFileId) {
        throw new BadRequestException("请先生成并确认成功的版式预览");
      }
      const publishedAt = new Date();
      const result = await tx.contractLayoutTemplateVersion.updateMany({
        where: { id: versionId, status: "submitted", draftRevision: version.draftRevision },
        data: {
          status: "published",
          previewPdfFileId: preview.previewPdfFileId,
          publishedByUserId: actorUserId,
          publishedAt,
          changeSummary
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("合同版式状态已变化，请刷新后重试");
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
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const source = await this.findVersion(tx, versionId);
      if (source.status !== "published") {
        throw new BadRequestException("只有已发布的合同版式可以复制为新草稿");
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

  async discardVersion(
    versionId: string,
    actorUserId: string,
    reason: string,
    expectedRevision: number
  ) {
    const discardReason = reason.trim();
    if (!discardReason) throw new BadRequestException("请填写模板草稿废弃原因");
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateMaintenanceRole(tx, actorUserId);
      const [version] = await tx.$queryRaw<Array<{
        id: string;
        layoutTemplateId: string;
        status: string;
        draftRevision: number;
        submittedByUserId: string | null;
        publishedAt: Date | null;
        stoppedAt: Date | null;
        revokedAt: Date | null;
        discardedAt: Date | null;
      }>>(Prisma.sql`
        SELECT v.* FROM "ContractLayoutTemplateVersion" v
        JOIN "ContractLayoutTemplate" t ON t."id" = v."layoutTemplateId"
        WHERE v."id" = ${versionId}
        FOR UPDATE OF t, v
      `);
      if (!version) throw new NotFoundException("未找到合同版式版本，请刷新后重试");
      if (version.status === "discarded") {
        return { id: versionId, status: "discarded", discardedAt: version.discardedAt };
      }
      if (version.draftRevision !== expectedRevision) {
        throw new ConflictException("合同版式草稿已被更新，请刷新页面后重试");
      }
      if (
        version.status !== "draft" ||
        version.submittedByUserId ||
        version.publishedAt ||
        version.stoppedAt ||
        version.revokedAt
      ) {
        throw new BadRequestException("该合同版式版本已提交、发布、停用或撤销，不能废弃");
      }
      const [contract, generatedDocument] = await Promise.all([
        tx.contractVersion.findFirst({
          where: { layoutTemplateVersionId: versionId },
          select: { id: true }
        }),
        tx.contractGeneratedDocument.findFirst({
          where: { layoutTemplateVersionId: versionId },
          select: { id: true }
        })
      ]);
      if (contract || generatedDocument) {
        throw new BadRequestException("该合同版式版本已被合同或生成文件引用，不能废弃");
      }
      const discardedAt = new Date();
      const changed = await tx.contractLayoutTemplateVersion.updateMany({
        where: {
          id: versionId,
          status: "draft",
          draftRevision: expectedRevision,
          discardedAt: null
        },
        data: {
          status: "discarded",
          discardedAt,
          discardedByUserId: actorUserId,
          discardReason,
          previewPdfFileId: null
        }
      });
      if (changed.count !== 1) {
        throw new ConflictException("合同版式草稿已被更新，请刷新页面后重试");
      }
      await tx.contractLayoutPreviewJob.updateMany({
        where: {
          layoutTemplateVersionId: versionId,
          status: { in: ["queued", "processing", "succeeded"] }
        },
        data: {
          status: "stale",
          previewPdfFileId: null,
          completedAt: discardedAt,
          errorMessage: "合同版式草稿已废弃，预览失效"
        }
      });
      await this.record(tx, actorUserId, "discard_version", versionId, {
        reason: discardReason
      });
      return { id: versionId, status: "discarded", discardedAt };
    });
  }

  stopVersion(versionId: string, actorUserId: string) {
    return this.changePublishedStatus(versionId, actorUserId, "stopped");
  }

  revokeVersion(versionId: string, actorUserId: string) {
    return this.changePublishedStatus(versionId, actorUserId, "revoked");
  }

  private discardAction(
    version: {
      status: string;
      submittedByUserId?: string | null;
      publishedAt?: Date | null;
      stoppedAt?: Date | null;
      revokedAt?: Date | null;
    },
    referenceReason: string | null
  ): { availableActions: DetailActionReadModel[]; blockedReasons: string[] } {
    const blockedReasons: string[] = [];
    if (version.status === "discarded") blockedReasons.push("该草稿版本已废弃");
    else if (version.status !== "draft") blockedReasons.push("只有从未提交的草稿版本可以废弃");
    if (version.submittedByUserId || version.publishedAt || version.stoppedAt || version.revokedAt) {
      blockedReasons.push("该版本已形成提交、发布、停用或撤销历史");
    }
    if (referenceReason) blockedReasons.push(referenceReason);
    return {
      availableActions: [{
        key: "discard_version",
        label: "废弃草稿版本",
        kind: "danger",
        enabled: blockedReasons.length === 0,
        disabledReason: blockedReasons.length ? blockedReasons.join("；") : null,
        requiresComment: true
      }],
      blockedReasons
    };
  }

  private inspectDocx(buffer: Buffer, placeholderSchema: unknown): LayoutInspectionReport {
    const zip = (() => {
      try {
        return new PizZip(buffer);
      } catch {
        throw new BadRequestException("DOCX 版式文件无法读取，请重新上传");
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
      throw new BadRequestException("DOCX 版式内容过大，无法完成检查");
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
      throw new BadRequestException("DOCX 版式文件无法读取，请重新上传");
    }
    const rawTags = this.extractTemplateTags(text);
    const placeholders = [
      ...new Set(
        rawTags
          .map((tag) => this.canonicalPlaceholder(tag))
          .filter((tag): tag is string => Boolean(tag))
      )
    ].sort();
    const unknownPlaceholders = placeholders.filter(
      (placeholder) => !RECOGNIZED_NAMESPACE.test(placeholder)
    );
    const missingRequiredPlaceholders = REQUIRED_PLACEHOLDERS.filter(
      (required) => !placeholders.includes(required)
    );
    const billKeys = this.billKeys(placeholderSchema);
    const loopKeys = rawTags
      .filter((tag) => tag.trim().startsWith("#"))
      .map((tag) => this.canonicalBillLoopKey(tag))
      .filter((key): key is string => Boolean(key));
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

  private extractTemplateTags(text: string) {
    return [
      ...[...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]),
      ...[...text.matchAll(/(?<!\{)\{\s*([^{}]+?)\s*\}(?!\})/g)].map(
        (match) => match[1]
      )
    ].map((tag) => tag.trim());
  }

  private canonicalPlaceholder(tag: string) {
    if (/^[#/]/.test(tag.trim())) return null;
    const alias = canonicalContractPlaceholder(tag);
    return isContractBillRowPlaceholder(alias) ? null : alias;
  }

  private canonicalBillLoopKey(tag: string) {
    return canonicalContractBillLoopKey(tag);
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
        throw new BadRequestException("只有已发布的合同版式可以停用或撤回");
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
        throw new BadRequestException("合同版式状态已变化，请刷新后重试");
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
    if (!version) throw new NotFoundException("未找到合同版式版本，请刷新后重试");
    return version;
  }

  private async assertOwnedDocx(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    const file = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("未找到版式源文件，请重新上传 DOCX 文件");
    if (file.uploadedByUserId !== actorUserId) {
      throw new ForbiddenException("只能使用本人上传的版式源文件");
    }
    if (!file.originalName.toLowerCase().endsWith(".docx")) {
      throw new BadRequestException("版式源文件必须是 DOCX 文件");
    }
  }

  private async assertAnyGlobalRole(
    tx: RoleClient,
    actorUserId: string,
    roleKeys: Array<"contract_staff" | "contract_director">
  ) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => roleKeys.includes(position.key as typeof roleKeys[number]))) {
      throw new ForbiddenException("只有合同经办人或合同主管可以执行该版式操作");
    }
  }

  private assertTemplateMaintenanceRole(tx: RoleClient, actorUserId: string) {
    return this.assertAnyGlobalRole(tx, actorUserId, ["contract_staff", "contract_director"]);
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
      throw new ForbiddenException(
        roleKey === "contract_staff"
          ? "只有合同经办人可以执行该版式操作"
          : "只有合同主管可以执行该版式操作"
      );
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
