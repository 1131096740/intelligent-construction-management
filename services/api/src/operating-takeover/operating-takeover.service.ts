import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  OPERATING_FACT_KINDS,
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  type BusinessAction,
  type EvidenceLevel,
  type OperatingFactKind,
  type OperatingImpactKind,
  type OperatingSubjectKind,
  type OperatingSubjectRole,
  type OperatingTakeoverProfession,
  type PrimaryCostCategoryCode
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { BusinessEntryDefinitionService } from "../business-entry-definition/business-entry-definition.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  AppendOperatingFactInput,
  type OperatingFactEntryKind,
  OperatingFactSubjects,
  OperatingImpactInput,
  OperatingLedgerService,
  OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import {
  canonicalize,
  fingerprint,
  formatAmountCents,
  isHistoricalPostEffectiveOwnPayment,
  normalizeTakeoverRow,
  OPERATING_TAKEOVER_SOURCE_TYPE,
  parseDateOnly,
  sceneDefinition,
  textValue
} from "./operating-takeover.utils";
import {
  AddOperatingTakeoverAttachmentGroupDto,
  ConfirmOperatingTakeoverDto,
  CreateOperatingTakeoverBatchDto,
  PrecheckOperatingTakeoverDto,
  UpdateOperatingTakeoverRowDto
} from "./operating-takeover.dto";

type DbTransaction = Prisma.TransactionClient;
type TakeoverIssue = {
  code: string;
  severity: "error" | "warning" | "confirmed_duplicate";
  fieldKey?: string;
  message: string;
  suggestion?: string;
};

interface TakeoverRowInput {
  sceneKey?: string;
  values: Record<string, unknown>;
}

export interface CheckedTakeoverRow {
  rowNo: number;
  sceneKey: string;
  values: Record<string, unknown>;
  definitionVersion: number | null;
  amountCents: string | null;
  evidenceLevel: EvidenceLevel | null;
  duplicateStatus: "none" | "suspected" | "confirmed";
  duplicateNote: string | null;
  occurredAt: string | null;
  issues: TakeoverIssue[];
}

export interface TakeoverCheckResult {
  rows: CheckedTakeoverRow[];
  summary: { totalRows: number; blockedRows: number; warningRows: number; readyRows: number };
}

interface TakeoverFactBatch {
  id: string;
  batchNo: string;
  confirmations?: Array<{ profession: string; confirmedAt: Date; confirmedByUserId: string }>;
}

interface TakeoverFactRow {
  id: string;
  rowNo: number;
  sceneKey: string;
  occurredAt: Date | null;
  valuesSnapshot: Prisma.JsonValue;
  evidenceLevel: string;
  revision: number;
  amountCents: bigint | null;
}

@Injectable()
export class OperatingTakeoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly definitions: BusinessEntryDefinitionService,
    private readonly visibility: ProjectVisibilityService,
    private readonly files: FileService,
    private readonly ledger: OperatingLedgerService,
    private readonly audit: AuditService
  ) {}

  async capability(projectId: string, actorUserId: string) {
    const roles = await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    return {
      projectId,
      scenes: await this.sceneList(projectId, actorUserId),
      actions: {
        manage: canPerform("operating_takeover.manage", roles),
        create: roles.includes("contract_director"),
        confirm: canPerform("operating_takeover.confirm", roles),
        activate: canPerform("operating_takeover.activate", roles),
        fileUpload: canPerform("operating_takeover.file.upload", roles)
      },
      availableActions: [
        canPerform("operating_takeover.manage", roles) ? "manage" : null,
        canPerform("operating_takeover.confirm", roles) ? "confirm" : null,
        canPerform("operating_takeover.activate", roles) ? "activate" : null,
        canPerform("operating_takeover.file.upload", roles) ? "file_upload" : null
      ].filter((action): action is string => action !== null),
      confirmationProfessions: {
        contract: roles.includes("contract_director"),
        finance: roles.includes("finance_director")
      }
    };
  }

  async sceneList(projectId: string, actorUserId: string) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    return OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((definition) => ({
        key: definition.key,
        name: definition.name,
        description: definition.description,
        version: definition.version,
        defaultFactKind: definition.defaultFactKind,
        requiredProfessions: definition.requiredProfessions,
        fields: definition.fields,
        rules: definition.rules
      }));
  }

  async precheck(projectId: string, actorUserId: string, input: PrecheckOperatingTakeoverDto) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    const project = await this.project(projectId);
    const rows = this.inputRows(input);
    const existing = await this.existingRows(projectId);
    const result = await this.evaluateRows(projectId, actorUserId, rows, project.operatingLedgerEffectiveDate, existing);
    return {
      ...result,
      zeroWrites: true,
      importFingerprint: fingerprint(result.rows.map((row) => ({
        sceneKey: row.sceneKey,
        values: row.values
      })))
    };
  }

  async uploadSourceFile(
    projectId: string,
    actorUserId: string,
    input: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      buffer: Buffer;
      idempotencyKey?: string;
    }
  ) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.file.upload");
    const file = await this.files.uploadPrivateFile({ ...input, uploadedByUserId: actorUserId });
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt.toISOString()
    };
  }

  async createBatch(projectId: string, actorUserId: string, input: CreateOperatingTakeoverBatchDto) {
    const roles = await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    if (!roles.includes("contract_director")) throw new ForbiddenException("首次、分阶段或补充接管批次必须由合同部负责人创建");
    const project = await this.project(projectId);
    const rows = this.inputRows(input);
    if (!rows.length) throw new BadRequestException("历史接管批次至少需要一行业务事实");
    const existing = await this.existingRows(projectId);
    const checked = await this.evaluateRows(projectId, actorUserId, rows, project.operatingLedgerEffectiveDate, existing);
    if (checked.summary.blockedRows > 0) {
      throw new BadRequestException({
        message: "历史接管预检存在阻断项，不能生成草稿",
        summary: checked.summary,
        rows: checked.rows
      });
    }

    const batchId = randomUUID();
    const batchNo = textValue(input.batchNo) ?? `OT-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const importFingerprint = fingerprint(checked.rows.map((row) => ({ sceneKey: row.sceneKey, values: row.values })));
    const sourceFileName = input.sourceFileId
      ? (await this.prisma.fileObject.findUnique({ where: { id: input.sourceFileId }, select: { originalName: true } }))?.originalName
      : undefined;
    if (input.sourceFileId && !sourceFileName) throw new BadRequestException("来源文件不存在或已被移除");

    await this.prisma.$transaction(async (tx) => {
      if (input.sourceFileId) await this.files.assertCanUseHistoricalTakeoverFile(tx, input.sourceFileId, actorUserId, false);
      const createdBatch = await tx.operatingTakeoverBatch.create({
        data: {
          id: batchId,
          projectId,
          batchNo,
          sourceFileId: input.sourceFileId,
          sourceFileName,
          sceneKeys: [...new Set(checked.rows.map((row) => row.sceneKey))] as unknown as Prisma.InputJsonValue,
          status: "under_review",
          revision: 1,
          importFingerprint,
          totalRows: checked.summary.totalRows,
          readyRows: checked.summary.readyRows,
          blockedRows: checked.summary.blockedRows,
          warningRows: checked.summary.warningRows,
          createdByUserId: actorUserId
        }
      });
      for (const checkedRow of checked.rows) {
        const rowId = randomUUID();
        const createdRow = await tx.operatingTakeoverRow.create({
          data: {
            id: rowId,
            batchId: createdBatch.id,
            rowNo: checkedRow.rowNo,
            sceneKey: checkedRow.sceneKey,
            definitionVersion: checkedRow.definitionVersion ?? 1,
            businessRef: textValue(checkedRow.values.businessRef),
            occurredAt: parseDateOnly(checkedRow.values.occurredAt),
            periodLabel: textValue(checkedRow.values.periodLabel),
            amountCents: checkedRow.amountCents === null ? null : BigInt(checkedRow.amountCents),
            valuesSnapshot: checkedRow.values as Prisma.InputJsonObject,
            evidenceLevel: checkedRow.evidenceLevel ?? "C",
            reviewStatus: "pending",
            duplicateStatus: checkedRow.duplicateStatus,
            duplicateNote: checkedRow.duplicateNote,
            revision: 1
          }
        });
        for (const issue of checkedRow.issues) {
          await tx.operatingTakeoverIssue.create({
            data: {
              id: randomUUID(),
              batchId: createdBatch.id,
              rowId: createdRow.id,
              code: issue.code,
              severity: issue.severity,
              fieldKey: issue.fieldKey,
              message: issue.message,
              suggestion: issue.suggestion
            }
          });
        }
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "operating_takeover.batch.create",
        businessType: "operating_takeover_batch",
        businessId: batchId,
        metadata: { batchNo, totalRows: checked.summary.totalRows, importFingerprint }
      });
    });
    return this.detail(projectId, batchId, actorUserId);
  }

  async list(projectId: string, actorUserId: string) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    const batches = await this.prisma.operatingTakeoverBatch.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });
    return batches.map((batch) => this.serializeBatch(batch));
  }

  async detail(projectId: string, batchId: string, actorUserId: string) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    const batch = await this.prisma.operatingTakeoverBatch.findFirst({
      where: { id: batchId, projectId },
      include: {
        rows: { orderBy: { rowNo: "asc" }, include: { issues: true, attachmentGroups: { include: { links: true } } } },
        issues: { where: { rowId: null }, orderBy: { createdAt: "asc" } },
        confirmations: { orderBy: { confirmedAt: "desc" } },
        activation: true
      }
    });
    if (!batch) throw new NotFoundException("历史接管批次不存在，请刷新后重试");
    return {
      ...this.serializeBatch(batch),
      rows: batch.rows.map((row) => ({
        id: row.id,
        rowNo: row.rowNo,
        sceneKey: row.sceneKey,
        definitionVersion: row.definitionVersion,
        businessRef: row.businessRef,
        occurredAt: row.occurredAt?.toISOString().slice(0, 10) ?? null,
        periodLabel: row.periodLabel,
        amountCents: row.amountCents?.toString() ?? null,
        amountYuan: row.amountCents === null ? null : formatAmountCents(row.amountCents),
        values: row.valuesSnapshot,
        evidenceLevel: row.evidenceLevel,
        reviewStatus: row.reviewStatus,
        duplicateStatus: row.duplicateStatus,
        duplicateNote: row.duplicateNote,
        reviewConclusion: row.reviewConclusion,
        revision: row.revision,
        issues: row.issues,
        attachmentGroups: row.attachmentGroups
      })),
      issues: batch.issues,
      confirmations: batch.confirmations,
      activation: batch.activation
    };
  }

  async updateRow(projectId: string, batchId: string, rowId: string, actorUserId: string, input: UpdateOperatingTakeoverRowDto) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.manage");
    const project = await this.project(projectId);
    const current = await this.prisma.operatingTakeoverRow.findFirst({ where: { id: rowId, batchId, batch: { projectId } }, include: { batch: true } });
    if (!current) throw new NotFoundException("历史接管行不存在，请刷新后重试");
    if (current.batch.status === "activated") throw new ConflictException("批次已激活，只能追加更正或冲销，不能修改原接管行");
    if (current.revision !== input.expectedRevision) throw new ConflictException("接管行版本已变化，请刷新后再修改");
    const checked = await this.evaluateRows(projectId, actorUserId, [{ sceneKey: current.sceneKey, values: input.values }], project.operatingLedgerEffectiveDate, await this.existingRows(projectId, rowId));
    const checkedRow = checked.rows[0];
    if (checked.summary.blockedRows > 0) throw new BadRequestException({ message: "接管行未通过业务校验", issues: checkedRow.issues });
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.operatingTakeoverRow.updateMany({
        where: { id: rowId, batchId, revision: input.expectedRevision },
        data: {
          businessRef: textValue(input.values.businessRef),
          occurredAt: parseDateOnly(input.values.occurredAt),
          periodLabel: textValue(input.values.periodLabel),
          amountCents: checkedRow.amountCents === null ? null : BigInt(checkedRow.amountCents),
          valuesSnapshot: input.values as Prisma.InputJsonObject,
          evidenceLevel: checkedRow.evidenceLevel ?? "C",
          duplicateStatus: checkedRow.duplicateStatus,
          duplicateNote: textValue(input.duplicateNote) ?? checkedRow.duplicateNote,
          reviewStatus: "pending",
          reviewConclusion: textValue(input.reviewConclusion),
          revision: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw new ConflictException("接管行版本已变化，请刷新后再修改");
      await tx.operatingTakeoverIssue.deleteMany({ where: { rowId, status: "open" } });
      for (const issue of checkedRow.issues) {
        await tx.operatingTakeoverIssue.create({
          data: { id: randomUUID(), batchId, rowId, code: issue.code, severity: issue.severity, fieldKey: issue.fieldKey, message: issue.message, suggestion: issue.suggestion }
        });
      }
      await tx.operatingTakeoverBatch.update({
        where: { id: batchId },
        data: { revision: { increment: 1 }, status: "under_review" }
      });
      await this.audit.record(tx, { actorUserId, action: "operating_takeover.row.update", businessType: "operating_takeover_row", businessId: rowId, metadata: { expectedRevision: input.expectedRevision } });
    });
    return this.detail(projectId, batchId, actorUserId);
  }

  async confirm(projectId: string, batchId: string, actorUserId: string, input: ConfirmOperatingTakeoverDto) {
    const roles = await this.assertProjectAction(projectId, actorUserId, "operating_takeover.confirm");
    const requiredRole = input.profession === "contract" ? "contract_director" : "finance_director";
    if (!roles.includes(requiredRole)) throw new ForbiddenException("当前岗位不能完成该专业确认");
    const result = await this.prisma.$transaction(async (tx) => {
      const idempotent = await tx.operatingTakeoverConfirmation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (idempotent) {
        if (idempotent.batchId !== batchId) throw new ConflictException("确认幂等键已用于其他接管批次");
        return idempotent;
      }
      const batch = await tx.operatingTakeoverBatch.findFirst({ where: { id: batchId, projectId }, include: { rows: true } });
      if (!batch) throw new NotFoundException("历史接管批次不存在，请刷新后重试");
      if (batch.status === "activated") throw new ConflictException("批次已激活，不能重复确认");
      if (batch.revision !== input.expectedRevision) throw new ConflictException("批次版本已变化，请刷新后再确认");
      const blocked = batch.rows.some((row) => row.reviewStatus === "blocked" || row.duplicateStatus === "confirmed");
      if (blocked) throw new BadRequestException("存在未解决的阻断行或确定重复，不能完成专业确认");
      const snapshot = fingerprint({ rows: batch.rows.map((row) => ({ id: row.id, revision: row.revision, values: row.valuesSnapshot })) });
      const sameRevision = await tx.operatingTakeoverConfirmation.findUnique({ where: { batchId_profession_revision: { batchId, profession: input.profession, revision: batch.revision } } });
      if (sameRevision) throw new ConflictException("该专业已经确认当前版本，请勿重复提交");
      const confirmation = await tx.operatingTakeoverConfirmation.create({
        data: { idempotencyKey: input.idempotencyKey, batchId, profession: input.profession, revision: batch.revision, confirmedByUserId: actorUserId, snapshot: { fingerprint: snapshot, rowCount: batch.rows.length } }
      });
      await tx.operatingTakeoverBatch.update({ where: { id: batchId }, data: { revision: { increment: 1 }, status: "under_review" } });
      await this.audit.record(tx, { actorUserId, action: `operating_takeover.${input.profession}.confirm`, businessType: "operating_takeover_batch", businessId: batchId, metadata: { revision: batch.revision, snapshot } });
      return confirmation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  }

  async activate(projectId: string, batchId: string, actorUserId: string, idempotencyKey: string) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.activate");
    const result = await this.prisma.$transaction(async (tx) => {
      const existingActivation = await tx.operatingTakeoverActivation.findUnique({ where: { idempotencyKey } });
      if (existingActivation) {
        if (existingActivation.batchId !== batchId) throw new ConflictException("激活幂等键已用于其他接管批次");
        return existingActivation;
      }
      const batch = await tx.operatingTakeoverBatch.findFirst({
        where: { id: batchId, projectId },
        include: { rows: { orderBy: { rowNo: "asc" } }, confirmations: { orderBy: { confirmedAt: "desc" } }, activation: true }
      });
      if (!batch) throw new NotFoundException("历史接管批次不存在，请刷新后重试");
      if (batch.activation) return batch.activation;
      if (batch.status === "activated") throw new ConflictException("批次已激活，请刷新后重试");
      const requiredProfessions = new Set<OperatingTakeoverProfession>();
      for (const row of batch.rows) for (const profession of sceneDefinition(row.sceneKey)?.requiredProfessions ?? []) requiredProfessions.add(profession);
      const currentSnapshot = fingerprint({ rows: batch.rows.map((row) => ({ id: row.id, revision: row.revision, values: row.valuesSnapshot })) });
      for (const profession of requiredProfessions) {
        if (!batch.confirmations.some((confirmation) => confirmation.profession === profession && snapshotFingerprint(confirmation.snapshot) === currentSnapshot)) {
          throw new BadRequestException(`缺少${profession === "contract" ? "合同" : "财务"}专业确认，不能激活`);
        }
      }
      const issues = await tx.operatingTakeoverIssue.findMany({ where: { batchId, status: "open", severity: { in: ["error", "confirmed_duplicate"] } } });
      if (issues.length || batch.rows.some((row) => row.duplicateStatus === "confirmed" || (row.duplicateStatus === "suspected" && !row.reviewConclusion))) throw new BadRequestException("存在未解决的阻断问题或重复说明，不能激活");
      const project = await tx.project.findUnique({ where: { id: projectId, isActive: true }, select: { operatingLedgerEffectiveDate: true, takeoverStatus: true } });
      if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      const formalRows = batch.rows.filter((row) => row.evidenceLevel !== "C");
      if (formalRows.length && !project.operatingLedgerEffectiveDate) throw new BadRequestException("项目尚未设置经营账生效日期，不能激活正式历史事实");
      const generatedFactIds: string[] = [];
      const gapRowIds: string[] = [];
      for (const row of batch.rows) {
        if (row.evidenceLevel === "C") {
          gapRowIds.push(row.id);
          await tx.operatingTakeoverRow.update({ where: { id: row.id }, data: { reviewStatus: "activated" } });
          continue;
        }
        const mapped = await this.factInput(tx, projectId, batch, row, actorUserId);
        const fact = await this.ledger.replayFromSourceInTransaction(tx, mapped.input, actorUserId, mapped.entryKind);
        generatedFactIds.push(fact.id);
        await tx.operatingTakeoverRow.update({ where: { id: row.id }, data: { reviewStatus: "activated", generatedFactId: fact.id } });
      }
      const activation = await tx.operatingTakeoverActivation.create({
        data: { idempotencyKey, batchId, revision: batch.revision, status: "activated", generatedFactIds, gapRowIds, activatedByUserId: actorUserId }
      });
      await tx.operatingTakeoverBatch.update({ where: { id: batchId }, data: { status: "activated", activatedAt: new Date(), activatedByUserId: actorUserId } });
      if (project.takeoverStatus === "preparing") {
        await tx.project.update({ where: { id: projectId }, data: { takeoverStatus: "operating_with_takeover" } });
      }
      await this.audit.record(tx, { actorUserId, action: "operating_takeover.activate", businessType: "operating_takeover_batch", businessId: batchId, metadata: { generatedFactIds, gapRowIds } });
      return activation;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  }

  async addAttachmentGroup(projectId: string, batchId: string, actorUserId: string, input: AddOperatingTakeoverAttachmentGroupDto) {
    await this.assertProjectAction(projectId, actorUserId, "operating_takeover.file.upload");
    if (!textValue(input.purpose) || !input.fileIds.length) throw new BadRequestException("附件用途和附件不能为空");
    const result = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.operatingTakeoverBatch.findFirst({ where: { id: batchId, projectId }, select: { id: true } });
      if (!batch) throw new NotFoundException("历史接管批次不存在，请刷新后重试");
      if (input.rowId) {
        const row = await tx.operatingTakeoverRow.findFirst({ where: { id: input.rowId, batchId }, select: { id: true } });
        if (!row) throw new BadRequestException("附件行不属于当前历史接管批次");
      }
      for (const fileId of input.fileIds) await this.files.assertCanUseHistoricalTakeoverFile(tx, fileId, actorUserId, true);
      const group = await tx.operatingTakeoverAttachmentGroup.create({ data: { id: randomUUID(), batchId, rowId: input.rowId, purpose: textValue(input.purpose)!, createdByUserId: actorUserId } });
      for (const fileId of input.fileIds) await tx.operatingTakeoverAttachmentLink.create({ data: { id: randomUUID(), groupId: group.id, fileId } });
      await this.audit.record(tx, { actorUserId, action: "operating_takeover.file.attach", businessType: "operating_takeover_batch", businessId: batchId, metadata: { rowId: input.rowId ?? null, fileIds: input.fileIds } });
      return group;
    });
    return result;
  }

  private async evaluateRows(projectId: string, actorUserId: string, rows: TakeoverRowInput[], effectiveDate: Date | null, existing: Array<{ sceneKey: string; rowFingerprint?: string | null; businessRef: string | null; occurredAt: Date | null; amountCents: bigint | null }>): Promise<TakeoverCheckResult> {
    const output: CheckedTakeoverRow[] = [];
    const fingerprintsInWorkbook = new Map<string, number>();
    for (const [index, input] of rows.entries()) {
      const sceneKey = input.sceneKey ?? textValue(input.values.sceneKey);
      const issues: TakeoverIssue[] = [];
      const definition = sceneKey ? sceneDefinition(sceneKey) : undefined;
      if (!definition) {
        output.push({ rowNo: index + 1, sceneKey: sceneKey ?? "", values: input.values, definitionVersion: null, amountCents: null, evidenceLevel: null, duplicateStatus: "none", duplicateNote: null, occurredAt: null, issues: [{ code: "unknown_scene", severity: "error", message: "接管场景不存在" }] });
        continue;
      }
      let normalized: ReturnType<typeof normalizeTakeoverRow> | undefined;
      try {
        normalized = normalizeTakeoverRow(definition.key, input.values);
      } catch (error) {
        issues.push({ code: "invalid_value", severity: "error", message: error instanceof Error ? error.message : "接管行字段无效" });
      }
      let definitionVersion: number | null = definition.version;
      const validation = await this.definitions.validateDraft(definition.key, projectId, actorUserId, { target: { entityType: "operating_takeover_row", entityId: projectId }, values: input.values, operation: "import" });
      definitionVersion = validation.definitionVersion;
      if (!validation.valid) for (const error of validation.errors) issues.push({ code: error.code, severity: "error", fieldKey: error.fieldKey, message: error.message });
      for (const issue of semanticIssues(definition.key, input.values)) issues.push(issue);
      if (normalized && isHistoricalPostEffectiveOwnPayment(definition.key, normalized.occurredAt, effectiveDate, normalized.values)) {
        issues.push({ code: "post_effective_payment", severity: "error", fieldKey: "actualPayerName", message: "经营账生效日后的我方付款不能使用历史接管模板", suggestion: "请走正式付款申请、审批和实付登记流程" });
      }
      let duplicateStatus: "none" | "suspected" | "confirmed" = "none";
      if (normalized) {
        const duplicateRowNo = fingerprintsInWorkbook.get(normalized.rowFingerprint);
        if (duplicateRowNo !== undefined) {
          duplicateStatus = "confirmed";
          issues.push({ code: "definite_duplicate_in_workbook", severity: "confirmed_duplicate", message: `该行与本次导入第 ${duplicateRowNo} 行完全重复`, suggestion: "删除重复行后重新预检" });
        }
        fingerprintsInWorkbook.set(normalized.rowFingerprint, index + 1);
        const exact = existing.some((row) => row.sceneKey === normalized!.sceneKey && row.occurredAt && row.occurredAt.toISOString().slice(0, 10) === normalized!.occurredAt.toISOString().slice(0, 10) && row.amountCents === normalized!.amountCents && row.businessRef === textValue(normalized!.values.businessRef));
        const sameBusiness = existing.some((row) => row.sceneKey === normalized!.sceneKey && row.businessRef && row.businessRef === textValue(normalized!.values.businessRef));
        if (exact) {
          duplicateStatus = "confirmed";
          issues.push({ code: "definite_duplicate", severity: "confirmed_duplicate", fieldKey: "businessRef", message: "该行与已激活历史事实完全重复", suggestion: "删除重复行或提交更正/冲销，不得再次激活" });
        } else if (sameBusiness) {
          duplicateStatus = "suspected";
          issues.push({ code: "suspected_duplicate", severity: "warning", fieldKey: "businessRef", message: "该业务编号已在历史事实中出现，需人工说明", suggestion: "在复核结论中说明是否为同一事实" });
        }
      }
      output.push({ rowNo: index + 1, sceneKey: definition.key, values: input.values, definitionVersion, amountCents: normalized?.amountCents?.toString() ?? null, evidenceLevel: normalized?.evidenceLevel ?? null, duplicateStatus, issues, occurredAt: normalized?.occurredAt.toISOString().slice(0, 10) ?? null, duplicateNote: duplicateStatus === "suspected" ? "待人工说明" : null });
    }
    const summary = {
      totalRows: output.length,
      blockedRows: output.filter((row) => row.issues.some((issue) => issue.severity !== "warning")).length,
      warningRows: output.filter((row) => row.issues.some((issue) => issue.severity === "warning")).length,
      readyRows: output.filter((row) => !row.issues.some((issue) => issue.severity !== "warning")).length
    };
    return { rows: output, summary };
  }

  private async factInput(tx: DbTransaction, projectId: string, batch: TakeoverFactBatch, row: TakeoverFactRow, actorUserId: string): Promise<{ input: AppendOperatingFactInput; entryKind: OperatingFactEntryKind }> {
    if (!(row.occurredAt instanceof Date)) throw new BadRequestException("历史接管行缺少发生日期，不能激活");
    const project = await tx.project.findUnique({ where: { id: projectId, isActive: true }, select: { operatingLedgerEffectiveDate: true } });
    if (!project?.operatingLedgerEffectiveDate) throw new BadRequestException("项目尚未设置经营账生效日期，不能激活");
    const assignment = await tx.projectAffiliateAssignment.findFirst({ where: { projectId, effectiveFrom: { lte: row.occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: row.occurredAt } }] }, orderBy: { effectiveFrom: "desc" } });
    if (!assignment) throw new BadRequestException("事实日没有有效的施工企业档案，不能激活");
    if (row.amountCents === null) throw new BadRequestException("历史接管行金额不能为空，不能激活");
    const amountCents = row.amountCents;
    const values = row.valuesSnapshot as Record<string, unknown>;
    const definition = sceneDefinition(row.sceneKey);
    const factKind = (definition?.defaultFactKind ?? "historical_gap") as OperatingFactKind;
    const entryType = textValue(values.entryType);
    const deductionType = textValue(values.deductionType);
    const adjustsFactId = textValue(values.adjustsFactId ?? values.originalFactId);
    const entryKind: OperatingFactEntryKind =
      row.sceneKey === "employee_advance" && entryType === "reversal"
        ? "reversal"
        : row.sceneKey === "construction_enterprise_deduction" && deductionType === "return"
          ? "reversal"
          : row.sceneKey === "construction_enterprise_deduction" && deductionType === "adjustment"
            ? "correction"
            : "original";
    if (entryKind !== "original" && !adjustsFactId) throw new BadRequestException("退补或冲销必须填写原经营事实编号");
    if (row.sceneKey === "employee_advance" && entryType === "reversal" && !textValue(values.sourceRepaymentId)) {
      throw new BadRequestException("员工还款冲销必须填写原还款记录编号");
    }
    let returnImpactKind: "estimated_clearing_expense" | "confirmed_cost" | undefined;
    if (row.sceneKey === "construction_enterprise_deduction" && deductionType === "return") {
      const target = await tx.operatingFact.findUnique({
        where: { id: adjustsFactId },
        select: { projectId: true, factKind: true, impacts: { select: { impactKind: true } } }
      });
      const targetImpact = target?.impacts.find((impact) => ["estimated_clearing_expense", "confirmed_cost"].includes(impact.impactKind));
      if (!target || target.projectId !== projectId || target.factKind !== "construction_enterprise_deduction" || !targetImpact) {
        throw new BadRequestException("施工企业扣费退回必须引用同项目的原扣费事实");
      }
      returnImpactKind = targetImpact.impactKind as "estimated_clearing_expense" | "confirmed_cost";
    }
    const subjects = await this.subjects(tx, projectId, row.occurredAt, assignment, row.sceneKey, values);
    const impacts = this.impacts(row.sceneKey, amountCents, values, subjects, returnImpactKind);
    if (!OPERATING_FACT_KINDS.includes(factKind) || !impacts.length) throw new BadRequestException("历史接管行未能生成合法经营事实");
    const confirmation = batch.confirmations?.find((item) => item.profession === "finance") ?? batch.confirmations?.[0];
    const confirmedAt = confirmation?.confirmedAt ?? new Date();
    const confirmedByUserId = confirmation?.confirmedByUserId ?? actorUserId;
    const operatingLedgerEffectiveDate = project.operatingLedgerEffectiveDate;
    const direction = row.sceneKey === "employee_advance"
      ? entryType === "repayment" ? "inflow" : entryType === "offset" ? "neutral" : "outflow"
      : ["owner_settlement", "owner_payment", "construction_enterprise_company_payment"].includes(row.sceneKey) ? "inflow" : "outflow";
    const sourceSnapshot = {
      batchId: batch.id,
      batchNo: batch.batchNo,
      rowId: row.id,
      rowNo: row.rowNo,
      sceneKey: row.sceneKey,
      values: canonicalize(values) as Prisma.InputJsonObject,
      fact: {
        occurredAt: row.occurredAt.toISOString(),
        confirmedAt: confirmedAt.toISOString(),
        confirmedByUserId,
        factKind,
        operatingLevel: "project",
        evidenceLevel: row.evidenceLevel,
        amountCents: amountCents.toString(),
        currencyCode: "CNY",
        direction,
        isBeforeOperatingLedgerEffectiveDate: row.occurredAt < operatingLedgerEffectiveDate,
        affiliateAssignmentId: assignment.id,
        affiliateBusinessPartyVersionId: assignment.businessPartyVersionId,
        affiliateNameSnapshot: assignment.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot ?? null,
        historicalTakeoverBatchId: batch.id,
        entryKind,
        adjustsFactId: adjustsFactId ?? null,
        subjects: canonicalize(subjects) as Prisma.InputJsonObject,
        impacts: impacts.map((impact) => ({ ...impact, amountCents: impact.amountCents.toString() })) as unknown as Prisma.InputJsonValue
      },
      entryType: entryType ?? null,
      deductionType: deductionType ?? null,
      adjustsFactId: adjustsFactId ?? null,
      sourceRepaymentId: textValue(values.sourceRepaymentId) ?? null,
      reversalOfEntryId: adjustsFactId ?? null
    } as unknown as Prisma.InputJsonObject;
    const input: AppendOperatingFactInput = {
      projectId,
      sourceType: OPERATING_TAKEOVER_SOURCE_TYPE,
      sourceBusinessId: row.id,
      sourceBusinessCode: `${batch.batchNo}-${row.rowNo}`,
      sourceVersion: row.revision,
      idempotencyKey: `${OPERATING_TAKEOVER_SOURCE_TYPE}:${row.id}:${row.revision}`,
      occurredAt: row.occurredAt,
      confirmedAt,
      confirmedByUserId,
      factKind,
      operatingLevel: "project",
      evidenceLevel: row.evidenceLevel as EvidenceLevel,
      amountCents,
      currencyCode: "CNY",
      direction,
      isBeforeOperatingLedgerEffectiveDate: row.occurredAt < operatingLedgerEffectiveDate,
      affiliateAssignmentId: assignment.id,
      affiliateBusinessPartyVersionId: assignment.businessPartyVersionId,
      affiliateNameSnapshot: assignment.affiliateNameSnapshot,
      affiliateCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot ?? undefined,
      historicalTakeoverBatchId: batch.id,
      sourceSnapshot,
      subjects,
      impacts,
      ...(adjustsFactId ? { adjustsFactId } : {})
    };
    return { input, entryKind };
  }

  private async subjects(tx: DbTransaction, projectId: string, occurredAt: Date, assignment: { businessPartyId: string }, sceneKey: string, values: Record<string, unknown>): Promise<OperatingFactSubjects> {
    const constructionEnterprise: OperatingSubjectReference = { kind: "construction_enterprise", id: assignment.businessPartyId };
    const participant = async (name: unknown): Promise<OperatingSubjectReference> => {
      const text = textValue(name);
      if (!text) throw new BadRequestException("历史接管行缺少我方公司主体");
      const row = await tx.projectParticipatingCompany.findFirst({ where: { projectId, companyNameSnapshot: text, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] } });
      if (!row) throw new BadRequestException(`事实日未找到参与公司：${text}`);
      return { kind: "participating_company", id: row.companyEntityId };
    };
    const party = async (name: unknown, kind: OperatingSubjectKind): Promise<OperatingSubjectReference> => {
      const text = textValue(name);
      if (!text) throw new BadRequestException("历史接管行缺少交易主体");
      const row = await tx.businessParty.findFirst({ where: { name: text, status: "active" } });
      return { kind, id: row?.id ?? `${kind}:${text}` };
    };
    const employee = (name: unknown): OperatingSubjectReference => {
      const text = textValue(name);
      if (!text) throw new BadRequestException("历史接管行缺少员工主体");
      return { kind: "employee", id: `employee:${text}` };
    };
    switch (sceneKey) {
      case "owner_settlement": return { debtor: await party(values.counterpartyName, "owner"), creditor: constructionEnterprise };
      case "owner_payment": return { actualPayer: await party(values.actualPayerName ?? values.counterpartyName, "owner"), payee: constructionEnterprise };
      case "construction_enterprise_company_payment": return { actualPayer: constructionEnterprise, payee: await participant(values.payeeName ?? values.counterpartyName) };
      case "construction_enterprise_downstream_payment": return { actualPayer: constructionEnterprise, payee: await party(values.payeeName ?? values.counterpartyName, "downstream_counterparty") };
      case "construction_enterprise_deduction": return { costBearingCompany: constructionEnterprise };
      case "employee_advance": {
        const employeeSubject = employee(values.employeeName);
        const company = await participant(values.costBearingCompanyName);
        const entryType = textValue(values.entryType);
        if (entryType === "expense_advance") return { debtor: employeeSubject, creditor: company, actualPayer: employeeSubject, payee: await party(values.payeeName ?? values.counterpartyName, "downstream_counterparty"), costBearingCompany: company };
        if (entryType === "disbursement") return { debtor: employeeSubject, creditor: company, actualPayer: company, payee: employeeSubject };
        if (entryType === "offset") return { debtor: employeeSubject, creditor: company, costBearingCompany: company };
        if (entryType === "repayment" || entryType === "reversal") return { debtor: employeeSubject, creditor: company, actualPayer: employeeSubject, payee: company };
        throw new BadRequestException("员工往来类型不支持历史经营账投影");
      }
      case "project_wage": return { costBearingCompany: await participant(values.costBearingCompanyName), payee: employee(values.payeeName ?? values.counterpartyName) };
      case "construction_enterprise_wage": return { costBearingCompany: constructionEnterprise, payee: employee(values.payeeName ?? values.counterpartyName) };
      case "fund_movement": return { actualPayer: await participant(values.actualPayerName), payee: await participant(values.payeeName) };
      case "invoice_tax_settlement": return { payee: await party(values.counterpartyName, "downstream_counterparty") };
      case "financial_reconciliation": return { payee: await party(values.counterpartyName, "downstream_counterparty") };
      default: return { costBearingCompany: await participant(values.costBearingCompanyName) };
    }
  }

  private impacts(sceneKey: string, amountCents: bigint, values: Record<string, unknown>, subjects: OperatingFactSubjects, returnImpactKind?: "estimated_clearing_expense" | "confirmed_cost"): OperatingImpactInput[] {
    const impact = (key: string, impactKind: OperatingImpactKind, direction: "increase" | "decrease" | "notice", subjectRole?: OperatingSubjectRole, subject?: OperatingSubjectReference): OperatingImpactInput => ({ idempotencyKey: `${key}:${amountCents.toString()}`, sourceImpactKey: key, impactKind, direction, amountCents, subjectRole, subject, costCategoryCode: textValue(values.costCategoryCode) as PrimaryCostCategoryCode | undefined, description: textValue(values.sourceDescription), impactSnapshot: { sceneKey } });
    switch (sceneKey) {
      case "owner_settlement": return [impact("income", "confirmed_income", "increase", "creditor", subjects.creditor), impact("receivable", "receivable_increase", "increase", "debtor", subjects.debtor)];
      case "owner_payment": return [impact("receivable", "receivable_decrease", "decrease", "actual_payer", subjects.actualPayer), impact("funds", "construction_enterprise_funds_increase", "increase", "payee", subjects.payee)];
      case "construction_enterprise_company_payment": return [impact("funds", "company_project_funds_increase", "increase", "payee", subjects.payee)];
      case "construction_enterprise_downstream_payment": return [impact("payable", "payable_decrease", "decrease", "payee", subjects.payee), impact("funds", "construction_enterprise_funds_decrease", "decrease", "actual_payer", subjects.actualPayer)];
      case "construction_enterprise_deduction": {
        const deductionType = textValue(values.deductionType);
        if (deductionType === "temporary_hold") return [impact("deduction", "estimated_clearing_expense", "increase", "cost_bearing_company", subjects.costBearingCompany)];
        if (deductionType === "final_deduction") return [impact("deduction", "confirmed_cost", "increase", "cost_bearing_company", subjects.costBearingCompany)];
        if (deductionType === "return") return [impact("deduction", returnImpactKind ?? "estimated_clearing_expense", "decrease", "cost_bearing_company", subjects.costBearingCompany)];
        if (deductionType === "adjustment") return [impact("deduction", "confirmed_cost", textValue(values.adjustmentDirection) === "decrease" ? "decrease" : "increase", "cost_bearing_company", subjects.costBearingCompany)];
        throw new BadRequestException("施工企业扣费类型不支持历史经营账投影");
      }
      case "employee_advance": {
        const entryType = textValue(values.entryType);
        if (entryType === "expense_advance") return [impact("cost", "confirmed_cost", "increase", "cost_bearing_company", subjects.costBearingCompany), impact("receivable", "receivable_increase", "increase", "creditor", subjects.creditor)];
        if (entryType === "disbursement") return [impact("receivable", "receivable_increase", "increase", "creditor", subjects.creditor), impact("funds", "company_project_funds_decrease", "decrease", "actual_payer", subjects.actualPayer)];
        if (entryType === "offset") return [impact("receivable", "receivable_decrease", "decrease", "creditor", subjects.creditor)];
        if (entryType === "repayment") return [impact("receivable", "receivable_decrease", "decrease", "creditor", subjects.creditor), impact("funds", "company_project_funds_increase", "increase", "payee", subjects.payee)];
        if (entryType === "reversal") return [impact("receivable", "receivable_decrease", "increase", "creditor", subjects.creditor), impact("funds", "company_project_funds_increase", "decrease", "payee", subjects.payee)];
        throw new BadRequestException("员工往来类型不支持历史经营账投影");
      }
      case "project_wage":
      case "construction_enterprise_wage": return [impact("cost", "confirmed_cost", "increase", "cost_bearing_company", subjects.costBearingCompany), impact("payable", "payable_increase", "increase", "payee", subjects.payee)];
      case "fund_movement": return [impact("out", "company_project_funds_decrease", "decrease", "actual_payer", subjects.actualPayer), impact("in", "company_project_funds_increase", "increase", "payee", subjects.payee)];
      case "invoice_tax_settlement": return [impact("invoice", "invoice_reference", "notice", "payee", subjects.payee)];
      case "financial_reconciliation": return [impact("gap", "evidence_gap_notice", "notice")];
      default: return [impact("cost", "confirmed_cost", "increase", "cost_bearing_company", subjects.costBearingCompany)];
    }
  }

  private inputRows(input: PrecheckOperatingTakeoverDto): TakeoverRowInput[] {
    if (!Array.isArray(input.rows) || input.rows.length > 500) throw new BadRequestException("单次历史接管最多 500 行");
    return input.rows.map((row) => ({ sceneKey: input.sceneKey ?? row.sceneKey, values: row.values }));
  }

  private async existingRows(projectId: string, excludeRowId?: string) {
    return this.prisma.operatingTakeoverRow.findMany({ where: { batch: { projectId }, generatedFactId: { not: null }, ...(excludeRowId ? { id: { not: excludeRowId } } : {}) }, select: { sceneKey: true, businessRef: true, occurredAt: true, amountCents: true } });
  }

  private async project(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, isActive: true }, select: { id: true, operatingLedgerEffectiveDate: true } });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    return project;
  }

  private async assertProjectAction(projectId: string, actorUserId: string, action: BusinessAction) {
    await this.project(projectId);
    const roles = await this.visibility.effectiveRoleKeys(actorUserId, projectId);
    if (!canPerform(action, roles)) throw new ForbiddenException(`当前岗位无权执行${action}`);
    return roles;
  }

  private serializeBatch(batch: {
    id: string;
    projectId: string;
    batchNo: string;
    sourceFileId: string | null;
    sourceFileName: string | null;
    sceneKeys: Prisma.JsonValue;
    status: string;
    revision: number;
    importFingerprint: string;
    totalRows: number;
    readyRows: number;
    blockedRows: number;
    warningRows: number;
    createdByUserId: string;
    activatedAt: Date | null;
    activatedByUserId: string | null;
    createdAt: Date;
  }) {
    return {
      id: batch.id,
      projectId: batch.projectId,
      batchNo: batch.batchNo,
      sourceFileId: batch.sourceFileId,
      sourceFileName: batch.sourceFileName,
      sceneKeys: batch.sceneKeys,
      status: batch.status,
      revision: batch.revision,
      importFingerprint: batch.importFingerprint,
      totalRows: batch.totalRows,
      readyRows: batch.readyRows,
      blockedRows: batch.blockedRows,
      warningRows: batch.warningRows,
      createdByUserId: batch.createdByUserId,
      activatedAt: batch.activatedAt?.toISOString() ?? null,
      activatedByUserId: batch.activatedByUserId,
      createdAt: batch.createdAt?.toISOString() ?? null
    };
  }
}

function snapshotFingerprint(value: Prisma.JsonValue): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fingerprintValue = (value as Record<string, Prisma.JsonValue>).fingerprint;
  return typeof fingerprintValue === "string" ? fingerprintValue : undefined;
}

function semanticIssues(sceneKey: string, values: Record<string, unknown>): TakeoverIssue[] {
  const issues: TakeoverIssue[] = [];
  if (sceneKey === "employee_advance") {
    const entryType = textValue(values.entryType);
    if (!entryType) issues.push({ code: "missing_entry_type", severity: "error", fieldKey: "entryType", message: "员工垫资、报销或借款冲账必须选择往来类型" });
    if (entryType === "expense_advance" && !textValue(values.costCategoryCode)) {
      issues.push({ code: "missing_cost_category", severity: "error", fieldKey: "costCategoryCode", message: "员工垫付未报销必须填写一级成本分类" });
    }
    if (entryType === "reversal" && !textValue(values.adjustsFactId)) {
      issues.push({ code: "missing_original_fact", severity: "error", fieldKey: "adjustsFactId", message: "员工还款冲销必须填写原经营事实编号" });
    }
    if (entryType === "reversal" && !textValue(values.sourceRepaymentId)) {
      issues.push({ code: "missing_repayment_reference", severity: "error", fieldKey: "sourceRepaymentId", message: "员工还款冲销必须填写原还款记录编号" });
    }
  }
  if (sceneKey === "construction_enterprise_deduction") {
    const deductionType = textValue(values.deductionType);
    if (!deductionType) issues.push({ code: "missing_deduction_type", severity: "error", fieldKey: "deductionType", message: "施工企业扣费必须选择扣费类型" });
    if (["return", "adjustment"].includes(deductionType ?? "") && !textValue(values.originalFactId)) {
      issues.push({ code: "missing_original_fact", severity: "error", fieldKey: "originalFactId", message: "施工企业退补或调整必须填写原扣费事实编号" });
    }
    if (deductionType === "adjustment" && !textValue(values.adjustmentDirection)) {
      issues.push({ code: "missing_adjustment_direction", severity: "error", fieldKey: "adjustmentDirection", message: "施工企业扣费调整必须填写调整方向" });
    }
  }
  return issues;
}
