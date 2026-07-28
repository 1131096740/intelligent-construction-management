import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_FACT_SOURCES,
  CONTRACT_TAX_MODES,
  normalizeTaxRatePercent,
  type ContractInvoiceType,
  type ContractTaxFactSource,
  type ContractTaxMode
} from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { recalculateBillAndContractAmount } from "../contract-bill/contract-bill-totals";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { calculateBillRow } from "../money/decimal-money";
import type {
  ReviewContractTaxFactRevisionDto,
  SaveContractTaxFactRevisionDto
} from "./dto/contract-tax-fact-revision.dto";
import type { AbandonContractTaxFactRevisionDto } from "./dto/abandon-contract-tax-fact-revision.dto";

type CandidateRowFact = {
  contractBillRowId: string;
  taxInclusiveUnitPrice: string | null;
  taxRatePercentOverride: string | null;
};

type Candidate = {
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  source: ContractTaxFactSource | null;
  confirmationExplanation: string | null;
  evidenceFileId: string | null;
  correctionReason: string | null;
  rowFacts: CandidateRowFact[];
};

@Injectable()
export class ContractTaxFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly files?: FileService
  ) {}

  list(projectId: string, takeoverId: string, actorUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const revisions = await tx.contractTaxFactRevision.findMany({
        where: { contractVersionId: context.version.id },
        orderBy: { revisionNo: "desc" }
      });
      return {
        contractId: context.contract.id,
        current: this.currentFacts(context.version),
        rows: this.currentRows(context.bills, context.rows),
        revisions: revisions.map((revision) => this.revisionReadModel(revision, actorUserId))
      };
    });
  }

  create(
    projectId: string,
    takeoverId: string,
    input: SaveContractTaxFactRevisionDto,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const candidate = await this.normalizeCandidate(
        tx,
        context,
        input,
        actorUserId
      );
      if (input.kind === "correction" && context.version.taxFactStatus !== "confirmed") {
        throw new BadRequestException("当前税务事实尚未确认，不能发起更正");
      }
      if (input.kind === "correction" && !candidate.correctionReason) {
        throw new BadRequestException("更正已确认税务事实时必须填写更正原因");
      }
      const active = await tx.contractTaxFactRevision.findFirst({
        where: {
          contractVersionId: context.version.id,
          status: {
            in: ["draft", "pending_finance_review", "pending_contract_confirmation"]
          }
        },
        select: { id: true }
      });
      if (active) {
        throw new BadRequestException("当前合同已有进行中的税务事实补录或更正");
      }
      const latest = await tx.contractTaxFactRevision.findFirst({
        where: { contractVersionId: context.version.id },
        orderBy: { revisionNo: "desc" },
        select: { revisionNo: true }
      });
      const revision = await tx.contractTaxFactRevision.create({
        data: {
          projectId,
          contractId: context.contract.id,
          contractVersionId: context.version.id,
          revisionNo: (latest?.revisionNo ?? 0) + 1,
          kind: input.kind,
          status: "draft",
          invoiceType: candidate.invoiceType,
          taxMode: candidate.taxMode,
          defaultTaxRatePercent: candidate.defaultTaxRatePercent,
          source: candidate.source,
          confirmationExplanation: candidate.confirmationExplanation,
          evidenceFileId: candidate.evidenceFileId,
          rowFacts: candidate.rowFacts as unknown as Prisma.InputJsonValue,
          beforeSnapshot: {
            ...this.currentFacts(context.version),
            correctionReason: candidate.correctionReason,
            rows: context.rows.map((row) => this.rowSnapshot(row))
          } as unknown as Prisma.InputJsonValue,
          createdByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.tax_fact_revision.create",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: {
          projectId,
          takeoverId,
          contractVersionId: context.version.id,
          revisionNo: revision.revisionNo,
          kind: revision.kind
        }
      });
      return this.revisionReadModel(revision);
    });
  }

  async abandon(
    projectId: string,
    takeoverId: string,
    revisionId: string,
    input: AbandonContractTaxFactRevisionDto,
    actorUserId: string
  ) {
    const reason = input.reason?.trim() ?? "";
    if (input.action === "abandon_application" && !reason) {
      throw new BadRequestException("放弃税务修订必须填写原因");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const [revision] = await tx.$queryRaw<Array<NonNullable<Awaited<ReturnType<typeof tx.contractTaxFactRevision.findUnique>>>>>(Prisma.sql`
        SELECT * FROM "ContractTaxFactRevision"
        WHERE "id" = ${revisionId} AND "contractVersionId" = ${context.version.id}
        FOR UPDATE
      `);
      if (!revision) throw new NotFoundException("未找到税务事实修订，请刷新后重试");
      if (revision.createdByUserId !== actorUserId) {
        throw new ForbiddenException("只能删除或放弃自己创建的税务事实修订");
      }
      if (revision.status === "abandoned") {
        return { ...this.revisionReadModel(revision), idempotent: true };
      }
      if (revision.status === "confirmed") {
        throw new ConflictException("已确认的税务事实不能放弃，请发起新的税务修订");
      }
      if (!new Set([
        "draft", "pending_finance_review", "pending_contract_confirmation", "rejected"
      ]).has(revision.status)) {
        throw new ConflictException("税务修订状态已变化，请刷新后重试");
      }
      const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
      if (revision.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("税务修订已被更新，请刷新后重试");
      }
      const pristine = revision.status === "draft" && !revision.submittedAt;
      const expectedAction = pristine ? "delete_pristine_draft" : "abandon_application";
      if (input.action !== expectedAction) {
        throw new ConflictException(
          pristine
            ? "当前税务修订仍是纯净草稿，请刷新后使用“删除草稿”"
            : "当前税务修订已进入复核，只能放弃修订并保留历史"
        );
      }
      const now = new Date();
      const updated = await tx.contractTaxFactRevision.updateMany({
        where: { id: revision.id, status: revision.status, updatedAt: expectedUpdatedAt },
        data: {
          status: "abandoned",
          abandonedAt: now,
          abandonedByUserId: actorUserId,
          abandonReason: pristine ? null : reason
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("税务修订已被其他操作处理，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: pristine
          ? "contract.tax_fact_revision.draft.delete"
          : "contract.tax_fact_revision.abandon",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: {
          projectId,
          takeoverId,
          contractVersionId: context.version.id,
          previousStatus: revision.status,
          reason: pristine ? null : reason
        }
      });
      return {
        ...this.revisionReadModel({
          ...revision,
          status: "abandoned",
          abandonedAt: now,
          abandonedByUserId: actorUserId,
          abandonReason: pristine ? null : reason,
          updatedAt: now
        }),
        action: expectedAction,
        idempotent: false
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error instanceof BadRequestException || error instanceof ConflictException ||
        error instanceof ForbiddenException || error instanceof NotFoundException
      ) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("税务修订正在被其他操作处理，请刷新后重试");
      }
      throw error;
    }
  }

  update(
    projectId: string,
    takeoverId: string,
    revisionId: string,
    input: SaveContractTaxFactRevisionDto,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const revision = await this.loadRevision(tx, context.version.id, revisionId);
      if (revision.status !== "draft") {
        throw new BadRequestException("只有草稿状态的税务事实修订可以编辑");
      }
      if (revision.createdByUserId !== actorUserId) {
        throw new BadRequestException("只能编辑自己创建的税务事实修订草稿");
      }
      if (input.kind !== revision.kind) {
        throw new BadRequestException("税务事实修订类型创建后不能修改");
      }
      const candidate = await this.normalizeCandidate(
        tx,
        context,
        input,
        actorUserId
      );
      if (revision.kind === "correction" && !candidate.correctionReason) {
        throw new BadRequestException("更正已确认税务事实时必须填写更正原因");
      }
      const updated = await tx.contractTaxFactRevision.update({
        where: { id: revision.id },
        data: {
          invoiceType: candidate.invoiceType,
          taxMode: candidate.taxMode,
          defaultTaxRatePercent: candidate.defaultTaxRatePercent,
          source: candidate.source,
          confirmationExplanation: candidate.confirmationExplanation,
          evidenceFileId: candidate.evidenceFileId,
          rowFacts: candidate.rowFacts as unknown as Prisma.InputJsonValue,
          beforeSnapshot: {
            ...jsonObject(revision.beforeSnapshot),
            correctionReason: candidate.correctionReason
          } as Prisma.InputJsonValue
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.tax_fact_revision.update",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: { projectId, takeoverId, contractVersionId: context.version.id }
      });
      return this.revisionReadModel(updated);
    });
  }

  submitFinanceReview(
    projectId: string,
    takeoverId: string,
    revisionId: string,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const revision = await this.loadRevision(tx, context.version.id, revisionId);
      if (revision.status !== "draft") {
        throw new BadRequestException("只有草稿状态的税务事实修订可以提交财务复核");
      }
      if (revision.createdByUserId !== actorUserId) {
        throw new BadRequestException("只能提交自己创建的税务事实修订草稿");
      }
      const candidate = this.candidateFromRevision(revision);
      await this.assertCandidateReady(tx, context, candidate);
      const submittedAt = new Date();
      const updated = await tx.contractTaxFactRevision.update({
        where: { id: revision.id },
        data: {
          status: "pending_finance_review",
          submittedByUserId: actorUserId,
          submittedAt
        }
      });
      if (revision.kind !== "correction") {
        await tx.contractVersion.update({
          where: { id: context.version.id },
          data: { taxFactStatus: "pending_finance_review" }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.tax_fact_revision.submit_finance_review",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: { projectId, takeoverId, contractVersionId: context.version.id }
      });
      return this.revisionReadModel(updated);
    });
  }

  financeReview(
    projectId: string,
    takeoverId: string,
    revisionId: string,
    input: ReviewContractTaxFactRevisionDto,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, projectId, takeoverId);
      const revision = await this.loadRevision(tx, context.version.id, revisionId);
      if (revision.status !== "pending_finance_review") {
        throw new BadRequestException("当前税务事实修订不在财务复核节点");
      }
      const comment = input.comment?.trim() || null;
      if (input.decision === "reject" && !comment) {
        throw new BadRequestException("退回税务事实补录时必须填写原因");
      }
      const nextStatus =
        input.decision === "approve" ? "pending_contract_confirmation" : "rejected";
      const updated = await tx.contractTaxFactRevision.update({
        where: { id: revision.id },
        data: {
          status: nextStatus,
          financeReviewedByUserId: actorUserId,
          financeReviewedAt: new Date(),
          financeReviewComment: comment
        }
      });
      if (revision.kind !== "correction") {
        await tx.contractVersion.update({
          where: { id: context.version.id },
          data: {
            taxFactStatus:
              input.decision === "approve"
                ? "pending_contract_confirmation"
                : "unconfirmed"
          }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action:
          input.decision === "approve"
            ? "contract.tax_fact_revision.finance_approve"
            : "contract.tax_fact_revision.finance_reject",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: { projectId, takeoverId, contractVersionId: context.version.id, comment }
      });
      return this.revisionReadModel(updated);
    });
  }

  contractConfirmation(
    projectId: string,
    takeoverId: string,
    revisionId: string,
    input: ReviewContractTaxFactRevisionDto,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ContractTaxFactRevision" WHERE "id" = ${revisionId} FOR UPDATE`
      );
      const context = await this.loadContext(tx, projectId, takeoverId);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${context.version.id} FOR UPDATE`
      );
      const revision = await this.loadRevision(tx, context.version.id, revisionId);
      if (revision.status !== "pending_contract_confirmation") {
        throw new BadRequestException("当前税务事实修订不在合同部确认节点");
      }
      const comment = input.comment?.trim() || null;
      if (input.decision === "reject") {
        if (!comment) throw new BadRequestException("退回税务事实补录时必须填写原因");
        const rejected = await tx.contractTaxFactRevision.update({
          where: { id: revision.id },
          data: {
            status: "rejected",
            confirmedByUserId: actorUserId,
            confirmedAt: new Date(),
            contractReviewComment: comment
          }
        });
        if (revision.kind !== "correction") {
          await tx.contractVersion.update({
            where: { id: context.version.id },
            data: { taxFactStatus: "unconfirmed" }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "contract.tax_fact_revision.contract_reject",
          businessType: "contract_tax_fact_revision",
          businessId: revision.id,
          metadata: { projectId, takeoverId, contractVersionId: context.version.id, comment }
        });
        return this.revisionReadModel(rejected);
      }

      const candidate = this.candidateFromRevision(revision);
      await this.assertCandidateReady(tx, context, candidate);
      if (context.rows.length) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "ContractBillRow"
            WHERE "id" IN (${Prisma.join(context.rows.map((row) => row.id))})
            FOR UPDATE`
        );
      }
      const before = {
        ...this.currentFacts(context.version),
        rows: context.rows.map((row) => this.rowSnapshot(row))
      };
      const candidateRowById = new Map(
        candidate.rowFacts.map((fact) => [fact.contractBillRowId, fact])
      );
      const affectedBillIds = new Set<string>();
      for (const row of context.rows) {
        const fact = candidateRowById.get(row.id);
        const unitPrice =
          fact?.taxInclusiveUnitPrice ?? row.unitPrice?.toString() ?? null;
        const explicitOverride =
          candidate.taxMode === "multiple_rate"
            ? fact?.taxRatePercentOverride ?? null
            : null;
        const preserveExistingOverride =
          candidate.taxMode === "multiple_rate" &&
          !fact &&
          row.taxRateSource === "row_override";
        const taxRate = explicitOverride
          ?? (preserveExistingOverride ? row.taxRate?.toString() ?? null : candidate.defaultTaxRatePercent);
        const taxRateSource =
          explicitOverride || preserveExistingOverride
            ? "row_override"
            : "version_default";
        const amounts =
          row.quantity !== null && unitPrice !== null && taxRate !== null
            ? calculateBillRow({
                quantity: row.quantity.toString(),
                unitPrice,
                taxRatePercent: taxRate,
                pricingMode: "tax_inclusive"
              })
            : {
                taxInclusiveAmountCents: null,
                taxExclusiveAmountCents: null,
                taxAmountCents: null
              };
        await tx.contractBillRow.update({
          where: { id: row.id },
          data: {
            unitPrice,
            taxRate,
            taxRateSource,
            pricingFactStatus:
              unitPrice !== null && taxRate !== null ? "confirmed" : "unconfirmed",
            precisionPolicy: unitPrice === null ? row.precisionPolicy : "two_decimal",
            ...amounts
          }
        });
        affectedBillIds.add(row.contractBillId);
      }

      const nextTaxRevision = context.version.taxFactRevision + 1;
      const confirmedAt = new Date();
      const version = await tx.contractVersion.update({
        where: { id: context.version.id },
        data: {
          invoiceType: candidate.invoiceType,
          taxMode: candidate.taxMode,
          defaultTaxRatePercent: candidate.defaultTaxRatePercent,
          taxFactStatus: "confirmed",
          taxFactSource: candidate.source,
          taxFactExplanation: candidate.confirmationExplanation,
          taxFactEvidenceFileId: candidate.evidenceFileId,
          taxFactRevision: nextTaxRevision,
          taxFactsFrozenAt: confirmedAt
        }
      });
      for (const billId of affectedBillIds) {
        await recalculateBillAndContractAmount(
          tx,
          { id: billId, contractVersionId: context.version.id },
          version
        );
      }
      const confirmed = await tx.contractTaxFactRevision.update({
        where: { id: revision.id },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt,
          contractReviewComment: comment
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action:
          revision.kind === "correction"
            ? "contract.tax_fact_revision.correction_confirm"
            : "contract.tax_fact_revision.confirm",
        businessType: "contract_tax_fact_revision",
        businessId: revision.id,
        metadata: {
          projectId,
          takeoverId,
          contractVersionId: context.version.id,
          source: candidate.source,
          evidenceFileId: candidate.evidenceFileId,
          before,
          after: {
            invoiceType: candidate.invoiceType,
            taxMode: candidate.taxMode,
            defaultTaxRatePercent: candidate.defaultTaxRatePercent,
            taxFactRevision: nextTaxRevision
          },
          comment
        }
      });
      return this.revisionReadModel(confirmed);
    });
  }

  private async loadContext(
    tx: Prisma.TransactionClient,
    projectId: string,
    takeoverId: string
  ) {
    const takeover = await tx.contractTakeover.findUnique({ where: { id: takeoverId } });
    if (!takeover || takeover.projectId !== projectId) {
      throw new NotFoundException("未找到当前项目的历史合同接管记录");
    }
    const contract = await tx.contract.findUnique({ where: { id: takeover.contractId } });
    const version = await tx.contractVersion.findUnique({
      where: { id: takeover.contractVersionId }
    });
    if (
      !contract ||
      contract.projectId !== projectId ||
      !version ||
      version.contractId !== contract.id
    ) {
      throw new BadRequestException("历史合同与项目归属不一致，请刷新后重试");
    }
    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id }
    });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
        })
      : [];
    return { takeover, contract, version, bills, rows };
  }

  private async loadRevision(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    revisionId: string
  ) {
    const revision = await tx.contractTaxFactRevision.findUnique({
      where: { id: revisionId }
    });
    if (!revision || revision.contractVersionId !== contractVersionId) {
      throw new NotFoundException("未找到当前合同版本的税务事实修订");
    }
    return revision;
  }

  private async normalizeCandidate(
    tx: Prisma.TransactionClient,
    context: Awaited<ReturnType<ContractTaxFactsService["loadContext"]>>,
    input: SaveContractTaxFactRevisionDto,
    actorUserId: string
  ): Promise<Candidate> {
    const invoiceType = input.invoiceType ?? null;
    const taxMode = input.taxMode ?? "single_rate";
    const defaultTaxRatePercent = input.defaultTaxRatePercent?.trim()
      ? this.normalizeTaxRate(input.defaultTaxRatePercent, "默认税率")
      : null;
    const source = input.source ?? null;
    const confirmationExplanation = input.confirmationExplanation?.trim() || null;
    const evidenceFileId = input.evidenceFileId?.trim() || null;
    if (evidenceFileId) {
      if (!this.files) {
        throw new Error("私有文件校验服务暂不可用，请稍后重试");
      }
      await this.files.assertCanDownloadFile(tx, evidenceFileId, actorUserId);
    }
    const rowIds = new Set<string>();
    const rowById = new Map(context.rows.map((row) => [row.id, row]));
    const rowFacts = (input.rowFacts ?? []).map((fact, index) => {
      const contractBillRowId = fact.contractBillRowId.trim();
      if (rowIds.has(contractBillRowId)) {
        throw new BadRequestException(`第 ${index + 1} 条清单价格事实重复`);
      }
      rowIds.add(contractBillRowId);
      if (!rowById.has(contractBillRowId)) {
        throw new BadRequestException(`第 ${index + 1} 条清单价格事实不属于当前合同版本`);
      }
      const taxInclusiveUnitPrice = fact.taxInclusiveUnitPrice?.trim()
        ? this.normalizeUnitPrice(fact.taxInclusiveUnitPrice, index + 1)
        : null;
      const taxRatePercentOverride = fact.taxRatePercentOverride?.trim()
        ? this.normalizeTaxRate(fact.taxRatePercentOverride, `第 ${index + 1} 条例外税率`)
        : null;
      if (
        taxMode === "single_rate" &&
        taxRatePercentOverride &&
        (!defaultTaxRatePercent ||
          !new Prisma.Decimal(taxRatePercentOverride).eq(defaultTaxRatePercent))
      ) {
        throw new BadRequestException("单一税率合同的清单税率必须与合同默认税率一致");
      }
      return {
        contractBillRowId,
        taxInclusiveUnitPrice,
        taxRatePercentOverride
      };
    });
    return {
      invoiceType,
      taxMode,
      defaultTaxRatePercent,
      source,
      confirmationExplanation,
      evidenceFileId,
      correctionReason: input.correctionReason?.trim() || null,
      rowFacts
    };
  }

  private async assertCandidateReady(
    _tx: Prisma.TransactionClient,
    _context: Awaited<ReturnType<ContractTaxFactsService["loadContext"]>>,
    candidate: Candidate
  ) {
    if (!candidate.invoiceType || !CONTRACT_INVOICE_TYPES.includes(candidate.invoiceType)) {
      throw new BadRequestException("请选择增值税普通发票或增值税专用发票");
    }
    if (!CONTRACT_TAX_MODES.includes(candidate.taxMode)) {
      throw new BadRequestException("计税模式不正确，请重新选择");
    }
    if (!candidate.defaultTaxRatePercent) {
      throw new BadRequestException("请填写合同默认税率");
    }
    if (!candidate.source || !CONTRACT_TAX_FACT_SOURCES.includes(candidate.source)) {
      throw new BadRequestException("请选择税务事实来源");
    }
    if (!candidate.evidenceFileId && !candidate.confirmationExplanation) {
      throw new BadRequestException("未上传依据附件时，必须填写税务事实确认说明");
    }
  }

  private candidateFromRevision(revision: {
    invoiceType: string | null;
    taxMode: string | null;
    defaultTaxRatePercent: Prisma.Decimal | null;
    source: string | null;
    confirmationExplanation: string | null;
    evidenceFileId: string | null;
    rowFacts: Prisma.JsonValue;
    beforeSnapshot: Prisma.JsonValue;
  }): Candidate {
    return {
      invoiceType: CONTRACT_INVOICE_TYPES.includes(revision.invoiceType as ContractInvoiceType)
        ? revision.invoiceType as ContractInvoiceType
        : null,
      taxMode: CONTRACT_TAX_MODES.includes(revision.taxMode as ContractTaxMode)
        ? revision.taxMode as ContractTaxMode
        : "single_rate",
      defaultTaxRatePercent: revision.defaultTaxRatePercent?.toString() ?? null,
      source: CONTRACT_TAX_FACT_SOURCES.includes(revision.source as ContractTaxFactSource)
        ? revision.source as ContractTaxFactSource
        : null,
      confirmationExplanation: revision.confirmationExplanation,
      evidenceFileId: revision.evidenceFileId,
      correctionReason:
        typeof jsonObject(revision.beforeSnapshot)["correctionReason"] === "string"
          ? jsonObject(revision.beforeSnapshot)["correctionReason"] as string
          : null,
      rowFacts: parseCandidateRows(revision.rowFacts)
    };
  }

  private currentFacts(version: {
    invoiceType: string | null;
    taxMode: string;
    defaultTaxRatePercent: Prisma.Decimal | null;
    taxFactStatus: string;
    taxFactSource: string | null;
    taxFactExplanation: string | null;
    taxFactEvidenceFileId: string | null;
    taxFactRevision: number;
  }) {
    return {
      invoiceType: version.invoiceType,
      taxMode: version.taxMode,
      defaultTaxRatePercent: version.defaultTaxRatePercent?.toString() ?? null,
      status: version.taxFactStatus,
      source: version.taxFactSource,
      confirmationExplanation: version.taxFactExplanation,
      evidenceFileId: version.taxFactEvidenceFileId,
      revision: version.taxFactRevision
    };
  }

  private currentRows(
    bills: Array<{
      id: string;
      name: string;
    }>,
    rows: Array<{
      id: string;
      contractBillId: string;
      rowKey: string;
      itemName: string;
      specification: string | null;
      unit: string;
      unitPrice: Prisma.Decimal | null;
      taxRate: Prisma.Decimal | null;
      taxRateSource: string;
      pricingFactStatus: string;
    }>
  ) {
    const billNameById = new Map(bills.map((bill) => [bill.id, bill.name]));
    return rows.map((row) => ({
      contractBillRowId: row.id,
      billName: billNameById.get(row.contractBillId) ?? "合同清单",
      rowKey: row.rowKey,
      itemName: row.itemName,
      specification: row.specification,
      unit: row.unit,
      taxInclusiveUnitPrice: row.unitPrice?.toString() ?? null,
      taxRatePercent: row.taxRate?.toString() ?? null,
      taxRateSource: row.taxRateSource,
      pricingFactStatus: row.pricingFactStatus
    }));
  }

  private rowSnapshot(row: {
    id: string;
    contractBillId: string;
    rowKey: string;
    unitPrice: Prisma.Decimal | null;
    taxRate: Prisma.Decimal | null;
    taxRateSource: string;
    pricingFactStatus: string;
  }) {
    return {
      contractBillRowId: row.id,
      contractBillId: row.contractBillId,
      rowKey: row.rowKey,
      taxInclusiveUnitPrice: row.unitPrice?.toString() ?? null,
      taxRatePercent: row.taxRate?.toString() ?? null,
      taxRateSource: row.taxRateSource,
      pricingFactStatus: row.pricingFactStatus
    };
  }

  private revisionReadModel(revision: {
    id: string;
    revisionNo: number;
    kind: string;
    status: string;
    invoiceType: string | null;
    taxMode: string | null;
    defaultTaxRatePercent: Prisma.Decimal | null;
    source: string | null;
    confirmationExplanation: string | null;
    evidenceFileId: string | null;
    rowFacts: Prisma.JsonValue;
    beforeSnapshot: Prisma.JsonValue;
    createdByUserId: string;
    submittedByUserId: string | null;
    submittedAt: Date | null;
    financeReviewedByUserId: string | null;
    financeReviewedAt: Date | null;
    financeReviewComment: string | null;
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    contractReviewComment: string | null;
    abandonedAt?: Date | null;
    abandonedByUserId?: string | null;
    abandonReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }, actorUserId?: string) {
    const terminal = ["confirmed", "abandoned"].includes(revision.status);
    const pristine = revision.status === "draft" && !revision.submittedAt;
    const owns = Boolean(actorUserId) && revision.createdByUserId === actorUserId;
    const lifecycleBlockers = [
      ...(terminal ? [revision.status === "confirmed" ? "税务事实已确认" : "税务修订已放弃"] : []),
      ...(!owns && actorUserId ? ["当前账号不是该税务修订创建人"] : []),
      ...(!actorUserId && !terminal ? ["未提供当前操作人"] : [])
    ];
    const lifecycleKind = terminal ? "formal_record" : pristine ? "pristine_draft" : "approval_draft";
    const availableActions = terminal ? [] : [{
      key: pristine ? "delete_pristine_draft" : "abandon_application",
      label: pristine ? "删除草稿" : "放弃税务修订",
      kind: "danger" as const,
      enabled: lifecycleBlockers.length === 0,
      disabledReason: lifecycleBlockers.length ? lifecycleBlockers.join("；") : null,
      ...(pristine ? {} : { requiresComment: true })
    }];
    return {
      ...revision,
      defaultTaxRatePercent: revision.defaultTaxRatePercent?.toString() ?? null,
      rowFacts: parseCandidateRows(revision.rowFacts),
      beforeSnapshot: jsonObject(revision.beforeSnapshot),
      lifecycleKind,
      lifecycleBlockers,
      availableActions
    };
  }

  private normalizeTaxRate(value: string, label: string) {
    try {
      return normalizeTaxRatePercent(value);
    } catch {
      throw new BadRequestException(
        `${label}必须是 0 到 100 之间且最多 6 位小数的数字`
      );
    }
  }

  private normalizeUnitPrice(value: string, index: number) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) {
      throw new BadRequestException(`第 ${index} 条含税单价必须是非负数字且最多保留 2 位小数`);
    }
    return value;
  }
}

function parseCandidateRows(value: Prisma.JsonValue): CandidateRowFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row["contractBillRowId"] !== "string") return [];
    return [{
      contractBillRowId: row["contractBillRowId"],
      taxInclusiveUnitPrice:
        typeof row["taxInclusiveUnitPrice"] === "string"
          ? row["taxInclusiveUnitPrice"]
          : null,
      taxRatePercentOverride:
        typeof row["taxRatePercentOverride"] === "string"
          ? row["taxRatePercentOverride"]
          : null
    }];
  });
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}
