import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import type { Cell, Worksheet } from "exceljs";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { convertXlsxToPdf } from "../contract-document/libreoffice-converter";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import type {
  CreateSettlementTemplateDto,
  UpdateSettlementTemplateVersionDto
} from "./dto/settlement-template.dto";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME = "application/pdf";
const DEFAULT_SHEET_NAME = "本期结算明细";
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const GOVERNANCE_ROLES = ["contract_director", "super_admin"] as const;
const AMOUNT_ROLE_LABELS: Record<string, string> = {
  included: "合同计价金额",
  reference: "参考价",
  non_priced: "非计价",
  provisional: "暂定价"
};
const PRICING_MODE_LABELS: Record<string, string> = {
  tax_inclusive: "含税计价",
  tax_exclusive: "不含税计价"
};
const FIXED_COLUMNS = [
  "清单编码/行号",
  "清单项名称",
  "是否本期结算",
  "合同数量",
  "合同单价",
  "前期已结算数量",
  "本期数量",
  "累计结算数量",
  "剩余可结算数量",
  "本期结算金额(分)",
  "人工调整金额(分)",
  "调整原因",
  "证据说明",
  "异常说明",
  "备注"
] as const;

const FIXED_SAMPLE_DATA = {
  dataClassification: "系统固定脱敏测试数据",
  rows: [
    {
      "清单编码/行号": "TEST-001",
      清单项名称: "脱敏测试-正常计价行",
      是否本期结算: "是",
      合同数量: "100",
      合同单价: "12.50",
      前期已结算数量: "40",
      本期数量: "10",
      累计结算数量: "50",
      剩余可结算数量: "50",
      "本期结算金额(分)": "12500",
      "人工调整金额(分)": "",
      调整原因: "",
      证据说明: "脱敏测试验收记录",
      异常说明: "",
      备注: "固定测试数据"
    },
    {
      "清单编码/行号": "TEST-002",
      清单项名称: "脱敏测试-暂定价行",
      是否本期结算: "是",
      合同数量: "5",
      合同单价: "参考价",
      前期已结算数量: "1",
      本期数量: "1",
      累计结算数量: "2",
      剩余可结算数量: "3",
      "本期结算金额(分)": "",
      "人工调整金额(分)": "30000",
      调整原因: "暂定价按本期确认金额填报",
      证据说明: "脱敏测试确认单",
      异常说明: "暂定价需人工确认",
      备注: "固定测试数据"
    },
    {
      "清单编码/行号": "",
      清单项名称: "脱敏测试-人工调整",
      是否本期结算: "是",
      合同数量: "",
      合同单价: "",
      前期已结算数量: "",
      本期数量: "",
      累计结算数量: "",
      剩余可结算数量: "",
      "本期结算金额(分)": "",
      "人工调整金额(分)": "-5000",
      调整原因: "脱敏测试扣减调整",
      证据说明: "脱敏测试调整依据",
      异常说明: "",
      备注: "固定测试数据"
    }
  ]
} as const;

export interface SettlementTemplateInspectionReport {
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  duplicateColumns: string[];
  hasPrintArea: boolean;
  handlerSignatureRow: number | null;
  reviewerSignatureRow: number | null;
  blockingErrors: string[];
  warnings: string[];
}

interface SettlementTemplateCompatibilityContext {
  projectId: string;
  contractTypeKey: string | null;
  amountRoles: string[];
  pricingModes: string[];
}

interface SettlementTemplateCompatibilityCandidate {
  compatibleContractTypeKeys: string[];
  compatibleAmountRoles: string[];
  compatiblePricingModes: string[];
}

type GovernanceClient = {
  userPosition: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ positionId: string }>>;
  };
  position: {
    findMany(args: { where: Record<string, unknown> }): Promise<Array<{ key: string }>>;
  };
};

type CompatibilityClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SettlementTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService
  ) {}

  async listGovernance(actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const templates = await tx.settlementTemplate.findMany({ orderBy: { createdAt: "asc" } });
      const versions = templates.length
        ? await tx.settlementTemplateVersion.findMany({
            where: { settlementTemplateId: { in: templates.map((template) => template.id) } },
            orderBy: [{ settlementTemplateId: "asc" }, { versionNo: "desc" }]
          })
        : [];
      return templates.map((template) => ({
        ...template,
        versions: versions
          .filter((version) => version.settlementTemplateId === template.id)
          .map((version) => this.versionReadModel(version))
      }));
    });
  }

  async create(actorUserId: string, input: CreateSettlementTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      await this.assertOwnedXlsx(tx, input.xlsxFileId, actorUserId);
      await this.assertKnownCompatibility(tx, input.compatibleContractTypeKeys ?? []);
      this.assertRuleSchemas(
        input.columnSchema,
        input.printRules,
        input.evidenceRules,
        input.anomalyRules
      );
      const template = await tx.settlementTemplate.create({
        data: {
          name: input.name.trim(),
          code: input.code.trim(),
          createdByUserId: actorUserId
        }
      });
      const version = await tx.settlementTemplateVersion.create({
        data: {
          settlementTemplateId: template.id,
          versionNo: 1,
          status: "draft",
          xlsxFileId: input.xlsxFileId,
          ...this.compatibilityData(input),
          columnSchema: input.columnSchema as Prisma.InputJsonValue,
          printRules: input.printRules as Prisma.InputJsonValue,
          evidenceRules: input.evidenceRules as Prisma.InputJsonValue,
          anomalyRules: input.anomalyRules as Prisma.InputJsonValue
        }
      });
      await this.record(tx, actorUserId, "create", version.id, { templateId: template.id });
      return { template, version: this.versionReadModel(version) };
    });
  }

  async get(templateId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const template = await tx.settlementTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new NotFoundException("未找到结算模板，请刷新后重试");
      const versions = await tx.settlementTemplateVersion.findMany({
        where: { settlementTemplateId: templateId },
        orderBy: { versionNo: "desc" }
      });
      const jobs = versions.length
        ? await tx.settlementTemplatePreviewJob.findMany({
            where: { settlementTemplateVersionId: { in: versions.map((version) => version.id) } },
            orderBy: { createdAt: "desc" }
          })
        : [];
      return {
        template,
        versions: versions.map((version) => ({
          ...this.versionReadModel(version),
          latestPreview:
            this.previewReadModel(
              jobs.find(
                (job) =>
                  job.settlementTemplateVersionId === version.id &&
                  job.sourceRevision === version.draftRevision
              ) ?? null
            )
        }))
      };
    });
  }

  async updateDraft(
    versionId: string,
    actorUserId: string,
    input: UpdateSettlementTemplateVersionDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("已提交或已发布的结算模板不可覆盖，请复制为新草稿后修改");
      }
      if (version.draftRevision !== input.expectedRevision) {
        throw new BadRequestException("结算模板草稿已被更新，请刷新后重试");
      }
      const changedFields = this.changedFields(input);
      if (!changedFields.length) throw new BadRequestException("请至少修改一项结算模板内容");
      if (input.xlsxFileId !== undefined) {
        await this.assertOwnedXlsx(tx, input.xlsxFileId, actorUserId);
      }
      if (input.compatibleContractTypeKeys !== undefined) {
        await this.assertKnownCompatibility(tx, input.compatibleContractTypeKeys);
      }
      this.assertRuleSchemas(
        input.columnSchema ?? version.columnSchema,
        input.printRules ?? version.printRules,
        input.evidenceRules ?? version.evidenceRules,
        input.anomalyRules ?? version.anomalyRules
      );
      const result = await tx.settlementTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: input.expectedRevision },
        data: {
          draftRevision: { increment: 1 },
          ...(input.xlsxFileId !== undefined ? { xlsxFileId: input.xlsxFileId } : {}),
          ...(input.compatibleContractTypeKeys !== undefined
            ? { compatibleContractTypeKeys: this.normalizedKeys(input.compatibleContractTypeKeys) }
            : {}),
          ...(input.compatibleAmountRoles !== undefined
            ? { compatibleAmountRoles: this.normalizedAmountRoles(input.compatibleAmountRoles) }
            : {}),
          ...(input.compatiblePricingModes !== undefined
            ? { compatiblePricingModes: this.normalizedPricingModes(input.compatiblePricingModes) }
            : {}),
          ...(input.columnSchema !== undefined
            ? { columnSchema: input.columnSchema as Prisma.InputJsonValue }
            : {}),
          ...(input.printRules !== undefined
            ? { printRules: input.printRules as Prisma.InputJsonValue }
            : {}),
          ...(input.evidenceRules !== undefined
            ? { evidenceRules: input.evidenceRules as Prisma.InputJsonValue }
            : {}),
          ...(input.anomalyRules !== undefined
            ? { anomalyRules: input.anomalyRules as Prisma.InputJsonValue }
            : {}),
          inspectionReport: Prisma.DbNull,
          inspectionRevision: null,
          previewXlsxFileId: null,
          previewPdfFileId: null
        }
      });
      if (result.count !== 1) {
        throw new BadRequestException("结算模板草稿已被更新，请刷新后重试");
      }
      const invalidated = await tx.settlementTemplatePreviewJob.updateMany({
        where: {
          settlementTemplateVersionId: versionId,
          sourceRevision: input.expectedRevision,
          status: { in: ["queued", "processing", "succeeded"] }
        },
        data: { status: "stale" }
      });
      await this.record(tx, actorUserId, "update_draft", versionId, {
        fromRevision: input.expectedRevision,
        toRevision: input.expectedRevision + 1,
        changedFields,
        invalidatedPreviewCount: invalidated.count
      });
      return { id: versionId, draftRevision: input.expectedRevision + 1 };
    });
  }

  async inspect(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的结算模板可以检查");
      }
      this.assertRuleSchemas(
        version.columnSchema,
        version.printRules,
        version.evidenceRules,
        version.anomalyRules
      );
      const source = await this.files.getFileBuffer(version.xlsxFileId);
      this.assertXlsxFile(source.file, source.buffer);
      const report = await this.inspectWorkbook(
        source.buffer,
        version.columnSchema,
        version.evidenceRules
      );
      const updated = await tx.settlementTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: version.draftRevision },
        data: {
          inspectionReport: report as unknown as Prisma.InputJsonValue,
          inspectionRevision: version.draftRevision
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("结算模板状态已变化，请刷新后重试");
      }
      await this.record(tx, actorUserId, "inspect", versionId, {
        sourceRevision: version.draftRevision,
        blockingErrorCount: report.blockingErrors.length
      });
      return { ...report, sourceRevision: version.draftRevision };
    });
  }

  async generatePreview(versionId: string, actorUserId: string) {
    const { version, job } = await this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const current = await this.findVersion(tx, versionId);
      this.assertPreviewReady(current);
      const created = await tx.settlementTemplatePreviewJob.create({
        data: {
          settlementTemplateVersionId: versionId,
          sourceRevision: current.draftRevision,
          status: "processing",
          sampleData: FIXED_SAMPLE_DATA as unknown as Prisma.InputJsonValue,
          createdByUserId: actorUserId,
          startedAt: new Date()
        }
      });
      await this.record(tx, actorUserId, "preview_start", versionId, {
        previewJobId: created.id,
        sourceRevision: current.draftRevision
      });
      return { version: current, job: created };
    });

    try {
      const source = await this.files.getFileBuffer(version.xlsxFileId);
      this.assertXlsxFile(source.file, source.buffer);
      const previewXlsx = await this.buildPreviewWorkbook(source.buffer, version.columnSchema);
      const previewPdf = await convertXlsxToPdf(previewXlsx);
      const [xlsxFile, pdfFile] = await Promise.all([
        this.files.uploadPrivateFile({
          originalName: "结算模板脱敏预览.xlsx",
          mimeType: XLSX_MIME,
          sizeBytes: previewXlsx.length,
          uploadedByUserId: actorUserId,
          buffer: previewXlsx
        }),
        this.files.uploadPrivateFile({
          originalName: "结算模板脱敏预览.pdf",
          mimeType: PDF_MIME,
          sizeBytes: previewPdf.length,
          uploadedByUserId: actorUserId,
          buffer: previewPdf
        })
      ]);
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.settlementTemplateVersion.updateMany({
          where: { id: versionId, status: "draft", draftRevision: version.draftRevision },
          data: { previewXlsxFileId: xlsxFile.id, previewPdfFileId: pdfFile.id }
        });
        if (current.count !== 1) {
          await tx.settlementTemplatePreviewJob.update({
            where: { id: job.id },
            data: { status: "stale", completedAt: new Date() }
          });
          throw new BadRequestException("结算模板已变化，本次预览已失效，请重新生成");
        }
        const completed = await tx.settlementTemplatePreviewJob.update({
          where: { id: job.id },
          data: {
            status: "succeeded",
            previewXlsxFileId: xlsxFile.id,
            previewPdfFileId: pdfFile.id,
            completedAt: new Date()
          }
        });
        await this.record(tx, actorUserId, "preview_succeeded", versionId, {
          previewJobId: job.id,
          sourceRevision: version.draftRevision
        });
        return this.previewReadModel(completed);
      });
    } catch (error) {
      const stale =
        error instanceof BadRequestException && error.message.includes("本次预览已失效");
      await this.prisma.settlementTemplatePreviewJob.updateMany({
        where: { id: job.id, status: "processing" },
        data: {
          status: stale ? "stale" : "failed",
          errorMessage: stale
            ? "结算模板已变化，本次预览已失效，请重新生成"
            : "结算模板预览生成失败，请检查模板或转换服务后重试",
          completedAt: new Date()
        }
      });
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("结算模板预览生成失败，请检查模板或转换服务后重试");
    }
  }

  submit(versionId: string, actorUserId: string) {
    return this.changeDraftToSubmitted(versionId, actorUserId);
  }

  async publish(versionId: string, actorUserId: string, changeSummary: string) {
    const normalizedChangeSummary = changeSummary.trim();
    if (!normalizedChangeSummary) {
      throw new BadRequestException("请填写结算模板发布说明");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      await this.lockTemplateVersionFamily(tx, versionId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "submitted") {
        throw new BadRequestException("只有已提交的结算模板可以发布");
      }
      this.assertInspectionCurrent(version);
      if (!version.previewXlsxFileId || !version.previewPdfFileId) {
        throw new BadRequestException("请先生成当前修订的 XLSX 和 PDF 脱敏预览");
      }
      const latestPreview = await tx.settlementTemplatePreviewJob.findFirst({
        where: {
          settlementTemplateVersionId: versionId,
          sourceRevision: version.draftRevision,
          status: "succeeded"
        },
        orderBy: { createdAt: "desc" }
      });
      if (!latestPreview?.previewXlsxFileId || !latestPreview.previewPdfFileId) {
        throw new BadRequestException("请先生成当前修订的 XLSX 和 PDF 脱敏预览");
      }
      const publishedAt = new Date();
      const superseded = await tx.settlementTemplateVersion.updateMany({
        where: {
          settlementTemplateId: version.settlementTemplateId,
          id: { not: versionId },
          status: "published"
        },
        data: { status: "stopped", stoppedAt: publishedAt }
      });
      const changed = await tx.settlementTemplateVersion.updateMany({
        where: { id: versionId, status: "submitted", draftRevision: version.draftRevision },
        data: {
          status: "published",
          publishedByUserId: actorUserId,
          publishedAt,
          changeSummary: normalizedChangeSummary,
          previewXlsxFileId: latestPreview.previewXlsxFileId,
          previewPdfFileId: latestPreview.previewPdfFileId
        }
      });
      if (changed.count !== 1) {
        throw new BadRequestException("结算模板状态已变化，请刷新后重试");
      }
      await this.record(tx, actorUserId, "publish", versionId, {
        supersededVersionCount: superseded.count
      });
      return { id: versionId, status: "published", publishedAt };
    });
  }

  async clone(versionId: string, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertGovernance(tx, actorUserId);
        await this.lockTemplateVersionFamily(tx, versionId);
        const source = await this.findVersion(tx, versionId);
        if (source.status !== "published" && source.status !== "stopped") {
          throw new BadRequestException("只有已发布或已停用的结算模板可以复制为新草稿");
        }
        const latest = await tx.settlementTemplateVersion.findFirst({
          where: { settlementTemplateId: source.settlementTemplateId },
          orderBy: { versionNo: "desc" }
        });
        const clone = await tx.settlementTemplateVersion.create({
          data: {
            settlementTemplateId: source.settlementTemplateId,
            versionNo: (latest?.versionNo ?? 0) + 1,
            status: "draft",
            xlsxFileId: source.xlsxFileId,
            compatibleContractTypeKeys: source.compatibleContractTypeKeys,
            compatibleAmountRoles: source.compatibleAmountRoles,
            compatiblePricingModes: source.compatiblePricingModes,
            columnSchema: source.columnSchema as Prisma.InputJsonValue,
            printRules: source.printRules as Prisma.InputJsonValue,
            evidenceRules: source.evidenceRules as Prisma.InputJsonValue,
            anomalyRules: source.anomalyRules as Prisma.InputJsonValue
          }
        });
        await this.record(tx, actorUserId, "clone", clone.id, { sourceVersionId: versionId });
        return this.versionReadModel(clone);
      });
    } catch (error) {
      if (this.errorCode(error) === "P2002") {
        throw new BadRequestException("结算模板已被其他人复制，请刷新版本列表后重试");
      }
      throw error;
    }
  }

  async stop(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      await this.lockTemplateVersionFamily(tx, versionId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "published") {
        throw new BadRequestException("只有已发布的结算模板可以停用");
      }
      const changedAt = new Date();
      const changed = await tx.settlementTemplateVersion.updateMany({
        where: { id: versionId, status: "published" },
        data: { status: "stopped", stoppedAt: changedAt }
      });
      if (changed.count !== 1) {
        throw new BadRequestException("只有已发布的结算模板可以停用");
      }
      await this.record(tx, actorUserId, "stop", versionId);
      return { id: versionId, status: "stopped", stoppedAt: changedAt };
    });
  }

  async createPreviewDownloadTicket(
    versionId: string,
    format: "xlsx" | "pdf",
    actorUserId: string,
    downloadReason: string
  ) {
    const fileId = await this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      const selectedFileId =
        format === "xlsx" ? version.previewXlsxFileId : version.previewPdfFileId;
      if (!selectedFileId) {
        throw new NotFoundException(
          format === "xlsx" ? "当前版本尚无 XLSX 脱敏预览" : "当前版本尚无 PDF 脱敏预览"
        );
      }
      const preview = await tx.settlementTemplatePreviewJob.findFirst({
        where: {
          settlementTemplateVersionId: versionId,
          sourceRevision: version.draftRevision,
          status: "succeeded",
          ...(format === "xlsx"
            ? { previewXlsxFileId: selectedFileId }
            : { previewPdfFileId: selectedFileId })
        }
      });
      if (!preview) throw new BadRequestException("结算模板预览引用校验失败，请重新生成预览");
      await this.record(tx, actorUserId, "preview_download_ticket", versionId, {
        format,
        sourceRevision: version.draftRevision
      });
      return selectedFileId;
    });
    return this.files.createDownloadTicket(fileId, { actorUserId, downloadReason });
  }

  async recommend(projectId: string, contractVersionId: string) {
    const run = async (tx: Prisma.TransactionClient) => {
    const context = await this.compatibilityContext(contractVersionId, projectId, tx);
    const [published, templates] = await Promise.all([
      tx.settlementTemplateVersion.findMany({
        where: { status: "published" },
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }]
      }),
      tx.settlementTemplate.findMany({ orderBy: { code: "asc" } })
    ]);
    const templateById = new Map(templates.map((template) => [template.id, template]));
    const choices = published.flatMap((candidate) => {
      const template = templateById.get(candidate.settlementTemplateId);
      if (!template) return [];
      if (!this.isCompatible(candidate, context)) return [];
      return [
        {
          templateVersionId: candidate.id,
          templateName: template.name,
          templateCode: template.code,
          versionNo: candidate.versionNo,
          reasons: [
            candidate.compatibleContractTypeKeys.length
              ? "合同类型条件已匹配当前合同类型"
              : "合同类型条件为通用",
            candidate.compatibleAmountRoles.length
              ? `清单金额角色均已匹配（${this.businessLabels(context.amountRoles, AMOUNT_ROLE_LABELS)}）`
              : "清单金额角色条件为通用",
            candidate.compatiblePricingModes.length
              ? `清单计价模式均已匹配（${this.businessLabels(context.pricingModes, PRICING_MODE_LABELS)}）`
              : "清单计价模式条件为通用"
          ]
        }
      ];
    });
    choices.sort((left, right) => left.templateCode.localeCompare(right.templateCode, "zh-CN"));
    if (choices.length === 0) {
      throw new BadRequestException(
        "未找到与当前合同类型、清单金额角色和计价模式兼容的已发布结算模板"
      );
    }
    return choices.length === 1
      ? { selectionMode: "automatic" as const, selected: choices[0], choices }
      : { selectionMode: "choice_required" as const, selected: null, choices };
    };
    if (typeof (this.prisma as { $transaction?: unknown }).$transaction !== "function") {
      return run(this.prisma as unknown as Prisma.TransactionClient);
    }
    return this.prisma.$transaction(run);
  }

  async assertPublishedCompatible(
    templateVersionId: string,
    contractVersionId: string,
    projectId?: string,
    client: CompatibilityClient = this.prisma
  ) {
    await this.lockTemplateVersionFamily(client, templateVersionId);
    const [context, candidate] = await Promise.all([
      this.compatibilityContext(contractVersionId, projectId, client),
      client.settlementTemplateVersion.findUnique({
        where: { id: templateVersionId },
        select: {
          id: true,
          status: true,
          compatibleContractTypeKeys: true,
          compatibleAmountRoles: true,
          compatiblePricingModes: true
        }
      })
    ]);
    if (!candidate || candidate.status !== "published" || !this.isCompatible(candidate, context)) {
      throw new BadRequestException("所选结算模板未发布、已停用或与当前合同不兼容");
    }
    return { templateVersionId: candidate.id, projectId: context.projectId };
  }

  private async changeDraftToSubmitted(versionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGovernance(tx, actorUserId);
      const version = await this.findVersion(tx, versionId);
      if (version.status !== "draft") {
        throw new BadRequestException("只有草稿状态的结算模板可以提交");
      }
      this.assertInspectionCurrent(version);
      const preview = await tx.settlementTemplatePreviewJob.findFirst({
        where: {
          settlementTemplateVersionId: versionId,
          sourceRevision: version.draftRevision,
          status: "succeeded"
        },
        orderBy: { createdAt: "desc" }
      });
      if (!preview?.previewXlsxFileId || !preview.previewPdfFileId) {
        throw new BadRequestException("请先生成当前修订的 XLSX 和 PDF 脱敏预览");
      }
      const changed = await tx.settlementTemplateVersion.updateMany({
        where: { id: versionId, status: "draft", draftRevision: version.draftRevision },
        data: { status: "submitted", submittedByUserId: actorUserId }
      });
      if (changed.count !== 1) {
        throw new BadRequestException("结算模板状态已变化，请刷新后重试");
      }
      await this.record(tx, actorUserId, "submit", versionId);
      return { id: versionId, status: "submitted" };
    });
  }

  private assertPreviewReady(version: {
    status: string;
    draftRevision: number;
    inspectionRevision: number | null;
    inspectionReport: Prisma.JsonValue | null;
  }) {
    if (version.status !== "draft") {
      throw new BadRequestException("只有草稿状态的结算模板可以生成预览");
    }
    this.assertInspectionCurrent(version);
  }

  private assertInspectionCurrent(version: {
    draftRevision: number;
    inspectionRevision: number | null;
    inspectionReport: Prisma.JsonValue | null;
  }) {
    const report = version.inspectionReport as unknown as SettlementTemplateInspectionReport | null;
    if (
      !report ||
      !Array.isArray(report.blockingErrors) ||
      report.blockingErrors.length > 0 ||
      version.inspectionRevision !== version.draftRevision
    ) {
      throw new BadRequestException("结算模板检查仍有阻断项，请处理后重新检查");
    }
  }

  private async inspectWorkbook(
    buffer: Buffer,
    columnSchema: Prisma.JsonValue,
    evidenceRules: Prisma.JsonValue
  ): Promise<SettlementTemplateInspectionReport> {
    this.assertSafeXlsxArchive(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("结算模板 XLSX 无法读取，请重新上传");
    }
    const sheetName = this.configuredSheetName(columnSchema);
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) throw new BadRequestException(`结算模板缺少“${sheetName}”工作表`);
    const columns = this.headerTexts(sheet);
    const duplicateColumns = [...new Set(columns.filter((column, index) => columns.indexOf(column) !== index))];
    const requiredColumns = [
      ...FIXED_COLUMNS,
      ...this.configuredColumns(columnSchema, "requiredColumns"),
      ...this.configuredColumns(evidenceRules, "requiredColumns")
    ];
    const missingColumns = [...new Set(requiredColumns)].filter(
      (column) => !columns.includes(column)
    );
    const handlerSignature = this.findExactTextCell(sheet, "经办人签字：");
    const reviewerSignature = this.findExactTextCell(sheet, "审核人签字：");
    const handlerSignatureRow = handlerSignature?.row ?? null;
    const reviewerSignatureRow = reviewerSignature?.row ?? null;
    const hasPrintArea = Boolean(sheet.pageSetup.printArea?.trim());
    const printAreaRows = this.printAreaRows(sheet.pageSetup.printArea);
    const blockingErrors: string[] = [];
    if (missingColumns.length) blockingErrors.push(`缺少固定列：${missingColumns.join("、")}`);
    if (duplicateColumns.length) blockingErrors.push(`存在重复列：${duplicateColumns.join("、")}`);
    const configuredOrder = this.configuredColumns(columnSchema, "columns");
    const expectedOrder = configuredOrder.length ? configuredOrder : [...FIXED_COLUMNS];
    if (JSON.stringify(columns) !== JSON.stringify(expectedOrder)) {
      blockingErrors.push(`列顺序不正确，应按以下顺序排列：${expectedOrder.join("、")}`);
    }
    if (!hasPrintArea) blockingErrors.push("未设置打印区域");
    if (hasPrintArea && !printAreaRows) blockingErrors.push("打印区域必须是单一完整矩形");
    if (printAreaRows && printAreaRows.min > 1) {
      blockingErrors.push("打印区域必须从表头开始");
    }
    if (!handlerSignatureRow) blockingErrors.push("缺少经办人签字区");
    if (!reviewerSignatureRow) blockingErrors.push("缺少审核人签字区");
    if (
      printAreaRows &&
      (printAreaRows.minColumn !== 1 ||
        printAreaRows.maxColumn < expectedOrder.length ||
        Math.max(handlerSignatureRow ?? 0, reviewerSignatureRow ?? 0) > printAreaRows.max)
    ) blockingErrors.push("打印区域必须完整覆盖固定列、表头和签字区");
    if ((handlerSignatureRow ?? 0) < 5 || (reviewerSignatureRow ?? 0) < 5) {
      blockingErrors.push("签字区必须位于固定脱敏预览数据行之后");
    }
    if (this.hasWorkbookFormula(workbook)) blockingErrors.push("模板中不允许使用公式");
    if (this.hasWorkbookNotes(workbook)) blockingErrors.push("模板中不允许保留批注或备注");
    if (this.hasWorkbookDataValidations(workbook)) {
      blockingErrors.push("模板中不允许保留源数据验证规则");
    }
    if (this.hasWorkbookConditionalFormatting(workbook)) {
      blockingErrors.push("模板中不允许保留源条件格式");
    }
    if (workbook.worksheets.some((worksheet) => worksheet.getImages().length > 0)) {
      blockingErrors.push("模板中不允许嵌入图片");
    }
    const signatureStart = Math.min(
      handlerSignatureRow ?? Number.MAX_SAFE_INTEGER,
      reviewerSignatureRow ?? Number.MAX_SAFE_INTEGER
    );
    if (this.hasMergedCellBefore(sheet, signatureStart)) {
      blockingErrors.push("表头和明细数据区不允许合并单元格");
    }
    return {
      sheetName,
      columns,
      missingColumns,
      duplicateColumns,
      hasPrintArea,
      handlerSignatureRow,
      reviewerSignatureRow,
      blockingErrors,
      warnings: []
    };
  }

  private async buildPreviewWorkbook(buffer: Buffer, columnSchema: Prisma.JsonValue) {
    this.assertSafeXlsxArchive(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(this.configuredSheetName(columnSchema));
    if (!sheet) throw new BadRequestException("结算模板预览工作表不存在，请重新检查模板");
    const handlerSignatureCell = this.findExactTextCell(sheet, "经办人签字：");
    const reviewerSignatureCell = this.findExactTextCell(sheet, "审核人签字：");
    const headers = this.headerTexts(sheet);
    const signatureStart = Math.min(
      handlerSignatureCell?.row ?? Number.MAX_SAFE_INTEGER,
      reviewerSignatureCell?.row ?? Number.MAX_SAFE_INTEGER
    );
    if (signatureStart === Number.MAX_SAFE_INTEGER || signatureStart < 5) {
      throw new BadRequestException("结算模板签字区位置不正确，请重新检查模板");
    }
    if (
      this.hasWorkbookFormula(workbook) ||
      this.hasWorkbookNotes(workbook) ||
      workbook.worksheets.some((worksheet) => worksheet.getImages().length > 0)
    ) {
      throw new BadRequestException("结算模板包含公式、批注或图片，无法生成严格脱敏预览");
    }
    // Never copy source validation prompts, validation formulae, or conditional
    // formatting into an artifact advertised as fixed masked preview data. The
    // inspection gate rejects them, while this unconditional cleanup keeps the
    // renderer fail-safe even if a stored inspection snapshot is malformed.
    this.clearWorkbookDynamicCellRules(workbook);
    for (const otherSheet of [...workbook.worksheets]) {
      if (otherSheet.id !== sheet.id) workbook.removeWorksheet(otherSheet.id);
    }
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
        cell.value = null;
      });
    }
    sheet.getCell(handlerSignatureCell!.address).value = "经办人签字：";
    sheet.getCell(reviewerSignatureCell!.address).value = "审核人签字：";
    sheet.headerFooter = {};
    this.clearWorkbookProperties(workbook);
    for (const [rowIndex, sample] of FIXED_SAMPLE_DATA.rows.entries()) {
      const excelRow = sheet.getRow(rowIndex + 2);
      for (const [columnIndex, header] of headers.entries()) {
        if (header in sample) {
          excelRow.getCell(columnIndex + 1).value = sample[header as keyof typeof sample];
        }
      }
      excelRow.commit();
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private assertSafeXlsxArchive(buffer: Buffer) {
    let zip: InstanceType<typeof PizZip>;
    try {
      zip = new PizZip(buffer);
    } catch {
      throw new BadRequestException("结算模板压缩包结构异常或解压后内容过大");
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
      throw new BadRequestException("结算模板压缩包结构异常或解压后内容过大");
    }
    let total = 0;
    for (const entry of entries) {
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (
        !Number.isSafeInteger(size) ||
        (size ?? -1) < 0 ||
        (size ?? 0) > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES
      ) {
        throw new BadRequestException("结算模板压缩包结构异常或解压后内容过大");
      }
      total += size ?? 0;
      if (total > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new BadRequestException("结算模板压缩包结构异常或解压后内容过大");
      }
    }
    const forbiddenEntry = entries.find((entry) =>
      /^xl\/(?:externalLinks\/|comments|threadedComments\/|media\/)/i.test(entry.name)
    );
    if (forbiddenEntry) {
      throw new BadRequestException("结算模板不得包含外部链接、批注或嵌入图片");
    }
    const hasExternalRelationship = entries
      .filter((entry) => entry.name.toLowerCase().endsWith(".rels"))
      .some((entry) => /TargetMode\s*=\s*["']External["']/i.test(entry.asText()));
    if (hasExternalRelationship) {
      throw new BadRequestException("结算模板不得包含外部链接、批注或嵌入图片");
    }
    const workbookXml = zip.file("xl/workbook.xml")?.asText() ?? "";
    const unsafeDefinedName = [...workbookXml.matchAll(/<definedName\b[^>]*name="([^"]+)"/gi)]
      .map((match) => match[1])
      .find((name) => !["_xlnm.Print_Area", "_xlnm.Print_Titles"].includes(name));
    if (unsafeDefinedName) {
      throw new BadRequestException("结算模板不得包含自定义名称或外部引用");
    }
  }

  private headerTexts(sheet: Worksheet): string[] {
    const row = sheet.getRow(1);
    return Array.from({ length: row.cellCount }, (_value, index) =>
      this.cellText(row.getCell(index + 1))
    );
  }

  private hasWorkbookFormula(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      let found = false;
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          const value = cell.value;
          if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
            found = true;
          }
        })
      );
      return found;
    });
  }

  private hasWorkbookNotes(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      let found = false;
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (cell.note) found = true;
      }));
      return found;
    });
  }

  private hasWorkbookDataValidations(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      const internal = sheet as unknown as {
        dataValidations?: { model?: Record<string, unknown> };
      };
      return Object.keys(internal.dataValidations?.model ?? {}).length > 0;
    });
  }

  private hasWorkbookConditionalFormatting(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some((sheet) => {
      const internal = sheet as unknown as { conditionalFormattings?: unknown[] };
      return (internal.conditionalFormattings?.length ?? 0) > 0;
    });
  }

  private clearWorkbookDynamicCellRules(workbook: ExcelJS.Workbook) {
    for (const sheet of workbook.worksheets) {
      const internal = sheet as unknown as {
        dataValidations?: { model?: Record<string, unknown> };
      };
      if (internal.dataValidations) internal.dataValidations.model = {};
      sheet.removeConditionalFormatting(undefined);
    }
  }

  private hasMergedCellBefore(sheet: Worksheet, rowLimit: number): boolean {
    const merges = (sheet.model as unknown as { merges?: string[] }).merges ?? [];
    return merges.some((range) => {
      const start = range.split(":")[0];
      const row = Number(start.match(/\d+/)?.[0] ?? 0);
      return row > 0 && row < rowLimit;
    });
  }

  private findExactTextCell(sheet: Worksheet, text: string): { row: number; address: string } | null {
    let found: { row: number; address: string } | null = null;
    sheet.eachRow((row, rowNumber) => {
      if (found !== null) return;
      row.eachCell((cell) => {
        if (this.cellText(cell) === text) found = { row: rowNumber, address: cell.address };
      });
    });
    return found;
  }

  private printAreaRows(
    printArea: string | undefined
  ): { min: number; max: number; minColumn: number; maxColumn: number } | null {
    if (!printArea?.trim()) return null;
    if (printArea.includes(",")) return null;
    const cells = [...printArea.matchAll(/\$?([A-Z]+)\$?(\d+)/gi)];
    if (cells.length !== 2) return null;
    const rows = cells.map((match) => Number(match[2]));
    const columns = cells.map((match) => this.columnNumber(match[1]));
    return {
      min: Math.min(...rows),
      max: Math.max(...rows),
      minColumn: Math.min(...columns),
      maxColumn: Math.max(...columns)
    };
  }

  private columnNumber(letters: string): number {
    return letters
      .toUpperCase()
      .split("")
      .reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
  }

  private clearWorkbookProperties(workbook: ExcelJS.Workbook) {
    const metadata = workbook as unknown as Record<string, unknown>;
    for (const key of [
      "creator",
      "lastModifiedBy",
      "company",
      "manager",
      "title",
      "subject",
      "keywords",
      "category",
      "description",
      "language"
    ]) {
      metadata[key] = "";
    }
    metadata.created = new Date(0);
    metadata.modified = new Date(0);
    metadata.lastPrinted = undefined;
    (workbook.definedNames as unknown as { model: unknown[] }).model = [];
  }

  private cellText(cell: Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part.text ?? "")).join("").trim();
    }
    return "";
  }

  private configuredSheetName(value: Prisma.JsonValue): string {
    return value && typeof value === "object" && !Array.isArray(value) &&
      typeof (value as { sheetName?: unknown }).sheetName === "string"
      ? (value as { sheetName: string }).sheetName.trim() || DEFAULT_SHEET_NAME
      : DEFAULT_SHEET_NAME;
  }

  private configuredColumns(value: Prisma.JsonValue, key: string): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const columns = (value as Record<string, unknown>)[key];
    if (columns === undefined) return [];
    if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string")) {
      return [`配置错误：${key}`];
    }
    return columns.map((column) => String(column).trim()).filter(Boolean);
  }

  private assertRuleSchemas(
    columnSchema: unknown,
    printRules: unknown,
    evidenceRules: unknown,
    anomalyRules: unknown
  ) {
    const column = this.ruleRecord(columnSchema, "列结构", [
      "sheetName",
      "columns",
      "requiredColumns"
    ]);
    if (column.sheetName !== undefined && column.sheetName !== DEFAULT_SHEET_NAME) {
      throw new BadRequestException(`结算模板工作表名称必须是“${DEFAULT_SHEET_NAME}”`);
    }
    for (const key of ["columns", "requiredColumns"] as const) {
      if (column[key] === undefined) continue;
      if (
        !Array.isArray(column[key]) ||
        column[key].some((value) => typeof value !== "string")
      ) {
        throw new BadRequestException(`结算模板${key}必须是文字数组`);
      }
    }
    if (
      column.columns !== undefined &&
      JSON.stringify(column.columns) !== JSON.stringify(FIXED_COLUMNS)
    ) {
      throw new BadRequestException("结算模板 columns 必须完整采用系统固定列及固定顺序");
    }
    if (
      Array.isArray(column.requiredColumns) &&
      column.requiredColumns.some((value) => !FIXED_COLUMNS.includes(value as typeof FIXED_COLUMNS[number]))
    ) {
      throw new BadRequestException("结算模板 requiredColumns 包含未知列");
    }

    const print = this.ruleRecord(printRules, "打印规则", ["requirePrintArea"]);
    if (print.requirePrintArea !== undefined && print.requirePrintArea !== true) {
      throw new BadRequestException("结算模板打印规则不得关闭打印区域检查");
    }

    const evidence = this.ruleRecord(evidenceRules, "证据规则", ["requiredColumns"]);
    if (evidence.requiredColumns !== undefined) {
      if (
        !Array.isArray(evidence.requiredColumns) ||
        evidence.requiredColumns.some(
          (value) => typeof value !== "string" || !FIXED_COLUMNS.includes(value as typeof FIXED_COLUMNS[number])
        )
      ) {
        throw new BadRequestException("结算模板证据规则包含未知列");
      }
    }

    const anomaly = this.ruleRecord(anomalyRules, "异常规则", [
      "rejectNegativeOrdinaryRows",
      "requireAdjustmentReason",
      "rejectFormula",
      "rejectMergedDataCells"
    ]);
    for (const [key, value] of Object.entries(anomaly)) {
      if (value !== true) {
        throw new BadRequestException(`结算模板异常规则 ${key} 必须启用`);
      }
    }
  }

  private ruleRecord(value: unknown, label: string, allowedKeys: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`结算模板${label}必须是 JSON 对象`);
    }
    const record = value as Record<string, unknown>;
    const unknown = Object.keys(record).filter((key) => !allowedKeys.includes(key));
    if (unknown.length) {
      throw new BadRequestException(`结算模板${label}包含未知配置：${unknown.join("、")}`);
    }
    return record;
  }

  private compatibilityData(input: CreateSettlementTemplateDto) {
    return {
      compatibleContractTypeKeys: this.normalizedKeys(input.compatibleContractTypeKeys ?? []),
      compatibleAmountRoles: this.normalizedAmountRoles(input.compatibleAmountRoles ?? []),
      compatiblePricingModes: this.normalizedPricingModes(input.compatiblePricingModes ?? [])
    };
  }

  private normalizedKeys(values: string[]): string[] {
    const normalized = values.map((value) => value.trim()).filter(Boolean);
    return [...new Set(normalized)].sort();
  }

  private changedFields(input: UpdateSettlementTemplateVersionDto): string[] {
    return [
      "xlsxFileId",
      "compatibleContractTypeKeys",
      "compatibleAmountRoles",
      "compatiblePricingModes",
      "columnSchema",
      "printRules",
      "evidenceRules",
      "anomalyRules"
    ].filter((key) => input[key as keyof UpdateSettlementTemplateVersionDto] !== undefined);
  }

  private async compatibilityContext(
    contractVersionId: string,
    requestedProjectId?: string,
    client: CompatibilityClient = this.prisma
  ): Promise<SettlementTemplateCompatibilityContext> {
    const version = await client.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { contractId: true, status: true }
    });
    if (!version) throw new NotFoundException("未找到可结算的合同版本，请刷新后重试");
    if (version.status !== "effective") {
      throw new BadRequestException("合同版本尚未归档生效，不能推荐或绑定结算模板");
    }
    const findFirst = (client.contractVersion as {
      findFirst?: (args: unknown) => Promise<{ id: string } | null>;
    }).findFirst;
    if (findFirst) {
      const latest = await findFirst.call(client.contractVersion, {
        where: { contractId: version.contractId, status: "effective" },
        orderBy: { versionNo: "desc" },
        select: { id: true }
      });
      if (latest && latest.id !== contractVersionId) {
        throw new BadRequestException("所选合同版本已不是当前最新生效版本，请刷新后重试");
      }
    }
    const [contract, bills] = await Promise.all([
      client.contract.findUnique({
        where: { id: version.contractId },
        select: { projectId: true, contractTypeKey: true }
      }),
      client.contractBill.findMany({
        where: { contractVersionId },
        select: { amountRole: true, pricingMode: true }
      })
    ]);
    if (!contract) throw new NotFoundException("未找到结算关联合同，请刷新后重试");
    if (requestedProjectId && contract.projectId !== requestedProjectId) {
      throw new BadRequestException("合同版本不属于当前项目");
    }
    return {
      projectId: contract.projectId,
      contractTypeKey: contract.contractTypeKey,
      amountRoles: [...new Set(bills.map((bill) => bill.amountRole))].sort(),
      pricingModes: [...new Set(bills.map((bill) => bill.pricingMode))].sort()
    };
  }

  private isCompatible(
    candidate: SettlementTemplateCompatibilityCandidate,
    context: SettlementTemplateCompatibilityContext
  ): boolean {
    const contractTypeMatches =
      candidate.compatibleContractTypeKeys.length === 0 ||
      (!!context.contractTypeKey &&
        candidate.compatibleContractTypeKeys.includes(context.contractTypeKey));
    return (
      contractTypeMatches &&
      this.allCompatible(context.amountRoles, candidate.compatibleAmountRoles) &&
      this.allCompatible(context.pricingModes, candidate.compatiblePricingModes)
    );
  }

  private allCompatible(actual: string[], compatible: string[]): boolean {
    return compatible.length === 0 ||
      (actual.length > 0 && actual.every((value) => compatible.includes(value)));
  }

  private normalizedAmountRoles(values: string[]): string[] {
    return this.normalizedAllowedKeys(values, Object.keys(AMOUNT_ROLE_LABELS), "金额角色");
  }

  private normalizedPricingModes(values: string[]): string[] {
    return this.normalizedAllowedKeys(values, Object.keys(PRICING_MODE_LABELS), "计价模式");
  }

  private normalizedAllowedKeys(values: string[], allowed: string[], label: string): string[] {
    const normalized = this.normalizedKeys(values);
    if (normalized.some((value) => !allowed.includes(value))) {
      throw new BadRequestException(`兼容${label}不在系统允许范围内`);
    }
    return normalized;
  }

  private businessLabels(values: string[], labels: Record<string, string>): string {
    return values.length
      ? values.map((value) => labels[value] ?? "未识别项").join("、")
      : "无清单";
  }

  private async assertKnownCompatibility(
    tx: Prisma.TransactionClient,
    values: string[]
  ) {
    const normalized = this.normalizedKeys(values);
    if (!normalized.length) return;
    const templates = await tx.contractBusinessTemplate.findMany({
      where: { contractTypeKey: { in: normalized } },
      select: { contractTypeKey: true }
    });
    const known = new Set(templates.map((template) => template.contractTypeKey));
    if (normalized.some((value) => !known.has(value))) {
      throw new BadRequestException("兼容合同类型包含系统未登记的类型");
    }
  }

  private async assertOwnedXlsx(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    const file = await tx.fileObject.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException("未找到结算模板 XLSX 源文件，请重新上传");
    if (file.uploadedByUserId !== actorUserId) {
      throw new ForbiddenException("只能使用本人上传的结算模板 XLSX 源文件");
    }
    this.assertXlsxFile(file, null);
  }

  private assertXlsxFile(
    file: { originalName: string; mimeType: string; storageStatus: string; sizeBytes: number },
    buffer: Buffer | null
  ) {
    if (file.storageStatus !== "active") {
      throw new BadRequestException("结算模板 XLSX 源文件已失效，请重新上传");
    }
    if (!file.originalName.toLowerCase().endsWith(".xlsx") || file.mimeType !== XLSX_MIME) {
      throw new BadRequestException("结算模板源文件必须是 XLSX 文件");
    }
    if (file.sizeBytes > 10 * 1024 * 1024) {
      throw new BadRequestException("结算模板 XLSX 文件大小不正确或超过 10 MB");
    }
    if (buffer && buffer.length !== file.sizeBytes) {
      throw new BadRequestException("结算模板 XLSX 文件大小不正确或超过 10 MB");
    }
  }

  private async findVersion(tx: Prisma.TransactionClient, versionId: string) {
    const version = await tx.settlementTemplateVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("未找到结算模板版本，请刷新后重试");
    return version;
  }

  private async lockTemplateVersionFamily(
    client: CompatibilityClient,
    versionId: string
  ) {
    await client.$queryRaw(Prisma.sql`
      SELECT v."id"
      FROM "SettlementTemplateVersion" v
      JOIN "SettlementTemplate" t ON t."id" = v."settlementTemplateId"
      WHERE v."id" = ${versionId}
      FOR UPDATE OF t, v
    `);
  }

  private errorCode(error: unknown): string | null {
    return error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  }

  private async assertGovernance(tx: GovernanceClient, actorUserId: string) {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
        })
      : [];
    if (!positions.some((position) => GOVERNANCE_ROLES.includes(position.key as typeof GOVERNANCE_ROLES[number]))) {
      throw new ForbiddenException("只有合同主管或系统管理员可以治理结算模板");
    }
  }

  private versionReadModel<
    T extends {
      xlsxFileId: string;
      previewXlsxFileId: string | null;
      previewPdfFileId: string | null;
    }
  >(version: T) {
    const { xlsxFileId, previewXlsxFileId, previewPdfFileId, ...safe } = version;
    return {
      ...safe,
      hasSourceXlsx: Boolean(xlsxFileId),
      hasPreviewXlsx: Boolean(previewXlsxFileId),
      hasPreviewPdf: Boolean(previewPdfFileId)
    };
  }

  private previewReadModel<
    T extends {
      previewXlsxFileId: string | null;
      previewPdfFileId: string | null;
    }
  >(preview: T | null) {
    if (!preview) return null;
    const { previewXlsxFileId, previewPdfFileId, ...safe } = preview;
    return {
      ...safe,
      hasPreviewXlsx: Boolean(previewXlsxFileId),
      hasPreviewPdf: Boolean(previewPdfFileId)
    };
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
      action: `settlement_template.${action}`,
      businessType: "settlement_template_version",
      businessId,
      metadata
    });
  }
}
