import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canCreateSettlementFromContractStatus,
  isContractSettlementMode,
  SETTLEMENT_IN_PROGRESS_STATUSES,
  SETTLEMENT_OCCUPANCY_STATUSES,
  type ContractVersionStatus,
  type DetailActionReadModel
} from "@jiangkong/shared-domain";
import { lockContractAndAssertCurrentEffective } from "../contract/contract-current-version-lock";
import { PrismaService } from "../database/prisma.service";
import { parseMoneyCentsInput } from "../money/decimal-money";
import type { SaveSettlementDraftDto } from "./dto/settlement-draft.dto";
import type { AbandonSettlementDraftDto } from "./dto/abandon-settlement-draft.dto";
import type { CopySettlementDraftDto } from "./dto/copy-settlement-draft.dto";
import { AuditService } from "../audit/audit.service";
import {
  assertSettlementContractType,
  settlementContractTypeBlockReason
} from "./contract-settlement-capacity";
import { ContractSettlementProcessService } from "./contract-settlement-process.service";
import { settlementSourceSnapshotToken } from "./settlement-line-occupancy";

@Injectable()
export class SettlementDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional() private readonly processes?: ContractSettlementProcessService
  ) {}

  async create(
    projectId: string,
    actorUserId: string,
    input: SaveSettlementDraftDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.contractContext(
        tx,
        projectId,
        input.contractVersionId
      );
      await this.assertNoActiveSettlement(tx, context.contract.id);
      const process = await this.processes?.createOpen(tx, {
        contractId: context.contract.id,
        contractVersionId: context.version.id,
        contractEffectiveAt: context.version.effectiveAt,
        isFinal: input.isFinal === true,
        periodEnd: input.periodEnd
      });
      const sourceSnapshotToken = await settlementSourceSnapshotToken(
        tx,
        context.version.id,
        input.settlementLines
      );
      const finalFacts = this.finalDraftFacts(input);
      const created = await tx.settlementDraft.create({
        data: {
          projectId: context.contract.projectId,
          contractId: context.version.contractId,
          contractVersionId: context.version.id,
          paymentTermsVersionId: context.terms.id,
          settlementTemplateVersionId: input.settlementTemplateVersionId.trim(),
          code: input.code.trim(),
          periodLabel: input.periodLabel.trim(),
          processId: process?.id,
          periodStart: process?.periodStart,
          periodEnd: process?.periodEnd,
          isFinal: input.isFinal === true,
          ...finalFacts,
          lines: this.toJson(input.settlementLines),
          calculationVersion: 3,
          sourceSnapshotToken,
          ownerUserId: actorUserId,
          governanceVersion: 1,
          fieldReviewerUserId: input.fieldReviewerUserId?.trim() || null,
          fieldReviewerRoleKey: input.fieldReviewerRoleKey ?? null
        }
      });
      await this.replaceStructuredLines(tx, created.id, input.settlementLines);
      if (process) await this.processes?.linkDraft(tx, process.id, created.id);
      return this.readModel(created);
    });
  }

  async copyAbandoned(
    projectId: string,
    draftId: string,
    actorUserId: string,
    input: CopySettlementDraftDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [source] = await tx.$queryRaw<Array<{
        id: string;
        projectId: string;
        contractId: string;
        contractVersionId: string;
        paymentTermsVersionId: string;
        settlementTemplateVersionId: string | null;
        code: string;
        periodLabel: string;
        isFinal: boolean;
        finalCumulativeAmountCents: bigint | null;
        finalDeclarationVersion: number | null;
        finalDeclarationSnapshot: Prisma.JsonValue | null;
        lines: Prisma.JsonValue;
        status: string;
        ownerUserId: string;
        fieldReviewerUserId: string | null;
        fieldReviewerRoleKey: string | null;
        finalScopeCompleted: boolean | null;
        finalPriorSettlementsIncluded: boolean | null;
        finalNoOutstandingSettlements: boolean | null;
        finalWithinContractCap: boolean | null;
        finalNoFurtherOrdinarySettlements: boolean | null;
        periodEnd: Date | null;
        updatedAt: Date;
      }>>(Prisma.sql`
        SELECT * FROM "SettlementDraft"
        WHERE "id" = ${draftId}
        FOR UPDATE
      `);
      this.assertOwnedDraft(source, projectId, actorUserId);
      if (source!.status !== "abandoned") {
        throw new ConflictException("只有已放弃的结算草稿可以复制为新草稿");
      }
      if (source!.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new ConflictException("来源结算草稿已变化，请刷新台账后重试");
      }
      const context = await this.contractContext(tx, projectId, source!.contractVersionId);
      await this.assertNoActiveSettlement(tx, context.contract.id);
      const process = await this.processes?.createOpen(tx, {
        contractId: context.contract.id,
        contractVersionId: context.version.id,
        contractEffectiveAt: context.version.effectiveAt,
        isFinal: source!.isFinal,
        periodEnd: source!.periodEnd?.toISOString().slice(0, 10)
      });
      const suffix = new Date().toISOString().replace(/\D/gu, "").slice(4, 14);
      const created = await tx.settlementDraft.create({
        data: {
          projectId: source!.projectId,
          contractId: context.version.contractId,
          contractVersionId: context.version.id,
          paymentTermsVersionId: context.terms.id,
          settlementTemplateVersionId: source!.settlementTemplateVersionId,
          code: `${source!.code}-副本-${suffix}`,
          periodLabel: source!.periodLabel,
          processId: process?.id,
          periodStart: process?.periodStart,
          periodEnd: process?.periodEnd,
          isFinal: source!.isFinal,
          finalCumulativeAmountCents: source!.finalCumulativeAmountCents,
          finalDeclarationVersion: source!.finalDeclarationVersion,
          finalDeclarationSnapshot: source!.finalDeclarationSnapshot === null
            ? Prisma.JsonNull
            : source!.finalDeclarationSnapshot as Prisma.InputJsonValue,
          lines: source!.lines as Prisma.InputJsonValue,
          ownerUserId: actorUserId,
          governanceVersion: 1,
          fieldReviewerUserId: source!.fieldReviewerUserId,
          fieldReviewerRoleKey: source!.fieldReviewerRoleKey,
          finalScopeCompleted: source!.finalScopeCompleted,
          finalPriorSettlementsIncluded: source!.finalPriorSettlementsIncluded,
          finalNoOutstandingSettlements: source!.finalNoOutstandingSettlements,
          finalWithinContractCap: source!.finalWithinContractCap,
          finalNoFurtherOrdinarySettlements: source!.finalNoFurtherOrdinarySettlements,
          copiedFromDraftId: source!.id
        }
      });
      if (process) await this.processes?.linkDraft(tx, process.id, created.id);
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.draft.copy",
        businessType: "settlement_draft",
        businessId: created.id,
        metadata: { copiedFromDraftId: source!.id, projectId }
      });
      return this.readModel(created);
    });
  }

  async list(projectId: string, actorUserId: string) {
    const drafts = await this.prisma.settlementDraft.findMany({
      where: { projectId, ownerUserId: actorUserId, status: { not: "abandoned" } },
      orderBy: { updatedAt: "desc" }
    });
    const contracts = drafts.length ? await this.prisma.contract.findMany({
      where: { id: { in: [...new Set(drafts.map((draft) => draft.contractId))] } },
      select: { id: true, contractTypeKey: true }
    }) : [];
    const typeByContract = new Map(contracts.map((contract) => [contract.id, contract.contractTypeKey]));
    const documents = drafts.length ? await this.prisma.settlementSignedDocument.findMany({
      where: {
        settlementDraftId: { in: drafts.map((draft) => draft.id) },
        status: "active",
        purpose: { in: ["frozen_counterparty_copy", "counterparty_signed_original"] }
      },
      select: { settlementDraftId: true, purpose: true }
    }) : [];
    const evidenceDraftIds = new Set(documents.flatMap((document) =>
      document.settlementDraftId ? [document.settlementDraftId] : []
    ));
    return drafts.map((draft) => this.readModel(
      draft,
      settlementContractTypeBlockReason(typeByContract.get(draft.contractId)),
      evidenceDraftIds.has(draft.id)
    ));
  }

  async get(projectId: string, draftId: string, actorUserId: string) {
    const draft = await this.prisma.settlementDraft.findUnique({
      where: { id: draftId }
    });
    this.assertOwnedDraft(draft, projectId, actorUserId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: draft!.contractId },
      select: { contractTypeKey: true }
    });
    const documents = await this.draftDocuments(draftId);
    const hasApprovalEvidence = Boolean(
      documents.frozenDocument || documents.counterpartySignedOriginal
    );
    return {
      ...this.readModel(
        draft!,
        settlementContractTypeBlockReason(contract?.contractTypeKey),
        hasApprovalEvidence
      ),
      documents
    };
  }

  async finalPreparation(projectId: string, draftId: string, actorUserId: string) {
    const draft = await this.prisma.settlementDraft.findUnique({ where: { id: draftId } });
    this.assertOwnedDraft(draft, projectId, actorUserId);
    if (!draft!.isFinal) {
      return { isFinal: false, checks: [] };
    }
    const [contract, previousSettlements, otherDraftCount, inProgressSettlementCount] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: draft!.contractId } }),
      this.prisma.settlement.findMany({
        where: {
          contractId: draft!.contractId,
          status: { in: ["effective", "partially_paid", "paid"] }
        },
        select: { amountCents: true }
      }),
      this.prisma.settlementDraft.count({
        where: { contractId: draft!.contractId, id: { not: draftId }, status: "draft" }
      }),
      this.prisma.settlement.count({
        where: { contractId: draft!.contractId, status: { in: [...SETTLEMENT_IN_PROGRESS_STATUSES] } }
      })
    ]);
    const declaration = draft!.finalDeclarationSnapshot as { accepted?: unknown } | null;
    const checks = [
      {
        key: "final_declaration",
        label: "最终结算总体声明",
        status: declaration?.accepted === true ? "ready" : "action_required",
        message: declaration?.accepted === true
          ? "已确认：生效后不再发起新结算，未实施余量不再结算。"
          : "请确认最终结算总体声明。"
      },
      {
        key: "prior_effective_history",
        label: "历史已生效结算",
        status: "ready",
        amountCents: previousSettlements.reduce((total, item) => total + item.amountCents, 0n).toString(),
        message: `已纳入 ${previousSettlements.length} 笔历史生效结算。`
      },
      {
        key: "unresolved_settlements",
        label: "未完成结算",
        status: otherDraftCount + inProgressSettlementCount === 0 ? "ready" : "blocking",
        message: otherDraftCount + inProgressSettlementCount === 0
          ? "不存在其他未完成的结算草稿或审批中结算。"
          : `仍有 ${otherDraftCount + inProgressSettlementCount} 笔未完成结算，暂不能提交最终结算。`
      },
      {
        key: "settlement_entry",
        label: "合同结算入口",
        status: contract?.settlementClosedAt || contract?.finalSettlementId ? "blocking" : "ready",
        message: contract?.settlementClosedAt || contract?.finalSettlementId
          ? "合同已经由最终结算关闭。"
          : "最终归档生效后将自动关闭新的结算入口。"
      }
    ];
    return { isFinal: true, checks };
  }

  async update(
    projectId: string,
    draftId: string,
    actorUserId: string,
    input: SaveSettlementDraftDto
  ) {
    if (input.expectedRevision === undefined) {
      throw new BadRequestException("更新结算草稿时必须提供当前修订号");
    }
    return this.prisma.$transaction(async (tx) => {
      const lockedDraft = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "SettlementDraft"
        WHERE "id" = ${draftId}
        FOR UPDATE
      `);
      if (lockedDraft.length !== 1) {
        throw new NotFoundException("未找到结算草稿，请刷新后重试");
      }
      const draft = await tx.settlementDraft.findUnique({
        where: { id: draftId }
      });
      this.assertOwnedDraft(draft, projectId, actorUserId);
      if (draft!.status !== "draft") {
        throw new BadRequestException("结算草稿已提交，不能再次修改");
      }
      if (draft!.revision !== input.expectedRevision) {
        throw new BadRequestException("结算草稿已被更新，请刷新后继续编辑");
      }
      const originalContract = await tx.contract.findUnique({
        where: { id: draft!.contractId },
        select: { contractTypeKey: true }
      });
      assertSettlementContractType(originalContract?.contractTypeKey);
      const context = await this.contractContext(
        tx,
        projectId,
        input.contractVersionId
      );
      const sourceSnapshotToken = await settlementSourceSnapshotToken(
        tx,
        context.version.id,
        input.settlementLines
      );
      const finalFacts = this.finalDraftFacts(input);
      const updated = await tx.settlementDraft.updateMany({
        where: {
          id: draftId,
          projectId,
          ownerUserId: actorUserId,
          status: "draft",
          revision: input.expectedRevision
        },
        data: {
          contractId: context.version.contractId,
          contractVersionId: context.version.id,
          paymentTermsVersionId: context.terms.id,
          settlementTemplateVersionId: input.settlementTemplateVersionId.trim(),
          code: input.code.trim(),
          periodLabel: input.periodLabel.trim(),
          isFinal: input.isFinal === true,
          ...finalFacts,
          lines: this.toJson(input.settlementLines),
          calculationVersion: 3,
          sourceSnapshotToken,
          governanceVersion: 1,
          fieldReviewerUserId: input.fieldReviewerUserId?.trim() || null,
          fieldReviewerRoleKey: input.fieldReviewerRoleKey ?? null,
          revision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("结算草稿已被更新，请刷新后继续编辑");
      }
      await this.replaceStructuredLines(tx, draftId, input.settlementLines);
      await tx.settlementSignedDocument.updateMany({
        where: { settlementDraftId: draftId, status: "active" },
        data: {
          status: "invalidated",
          invalidatedAt: new Date(),
          invalidationReason: "结算草稿事实或参与人已更新，请按新修订号重新生成和签章"
        }
      });
      const result = await tx.settlementDraft.findUnique({
        where: { id: draftId }
      });
      if (!result) {
        throw new NotFoundException("未找到结算草稿，请刷新后重试");
      }
      return this.readModel(result);
    });
  }

  private async replaceStructuredLines(
    tx: Prisma.TransactionClient,
    settlementDraftId: string,
    lines: SaveSettlementDraftDto["settlementLines"]
  ) {
    const prepared = lines.map((line, index) => ({
      lineKey: this.lineKey(line, index),
      data: {
        sourceType: line.sourceType,
        adjustmentKind: line.adjustmentKind?.trim() || null,
        contractBillRowId: line.contractBillRowId?.trim() || null,
        sourceItemType: line.sourceItemType?.trim() || null,
        occurredOn: this.optionalDate(line.occurredOn),
        name: line.name?.trim() || line.contractBillRowId?.trim() || "待补充结算明细",
        description: line.description?.trim() || null,
        unit: line.unit?.trim() || null,
        quantity: this.optionalDecimal(line.quantity),
        unitPriceCents: this.optionalMoney(line.unitPriceCents),
        directAmountCents: this.optionalSignedMoney(line.amountCents),
        calculationMode: line.sourceType === "manual_adjustment"
          ? "manual_adjustment"
          : line.sourceType === "visa_change"
            ? "visa_change"
            : "pending_source",
        status: "active",
        pricingBasis: line.pricingBasis?.trim() || null,
        overageReason: line.overageReason?.trim() || null,
        relatedSettlementLineId: line.relatedSettlementLineId?.trim() || null,
        reason: line.reason?.trim() || null,
        remark: line.remark?.trim() || null,
        sortOrder: line.sortOrder ?? index
      }
    }));
    if (new Set(prepared.map((line) => line.lineKey)).size !== prepared.length) {
      throw new BadRequestException("结算草稿明细行标识重复，请刷新页面后重试");
    }
    const activeLineKeys = prepared.map((line) => line.lineKey);
    await tx.settlementDraftLine.updateMany({
      where: {
        settlementDraftId,
        status: "active",
        ...(activeLineKeys.length ? { lineKey: { notIn: activeLineKeys } } : {})
      },
      data: { status: "removed" }
    });
    await Promise.all(prepared.map(async ({ lineKey, data }) => {
      const existing = await tx.settlementDraftLine.findUnique({
        where: { settlementDraftId_lineKey: { settlementDraftId, lineKey } },
        select: { id: true }
      });
      if (existing) {
        await tx.settlementDraftLine.update({ where: { id: existing.id }, data });
        return;
      }
      await tx.settlementDraftLine.create({
        data: { settlementDraftId, lineKey, ...data }
      });
    }));
  }

  private lineKey(
    line: SaveSettlementDraftDto["settlementLines"][number],
    index: number
  ) {
    const supplied = line.lineKey?.trim();
    if (supplied) return supplied;
    if (line.sourceType === "contract_bill_row" && line.contractBillRowId?.trim()) {
      return `contract:${line.contractBillRowId.trim()}`;
    }
    return `${line.sourceType}:${index + 1}`;
  }

  private optionalDecimal(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    try {
      return new Prisma.Decimal(value as string | number);
    } catch {
      return null;
    }
  }

  private optionalMoney(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return parseMoneyCentsInput(value, "结算草稿明细单价");
    } catch {
      return null;
    }
  }

  private optionalSignedMoney(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  private optionalDate(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    const date = new Date(`${value.trim()}T00:00:00.000Z`);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  async abandon(
    projectId: string,
    draftId: string,
    actorUserId: string,
    input: AbandonSettlementDraftDto
  ) {
    const reason = input.reason?.trim() ?? "";
    if (input.action === "abandon_application" && !reason) {
      throw new BadRequestException("放弃结算申请必须填写原因");
    }
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "SettlementDraft" WHERE "id" = ${draftId} FOR UPDATE
      `);
      if (!locked) throw new NotFoundException("未找到结算草稿，请刷新后重试");
      const draft = await tx.settlementDraft.findUnique({ where: { id: draftId } });
      this.assertOwnedDraft(draft, projectId, actorUserId);
      if (draft!.status === "abandoned") {
        return { draftId, status: "abandoned", idempotent: true };
      }
      if (draft!.submittedSettlementId || draft!.submittedAt || draft!.status !== "draft") {
        throw new ConflictException("该结算草稿已形成正式结算，请在正式结算流程中处理");
      }
      if (draft!.revision !== input.expectedRevision) {
        throw new ConflictException("结算草稿已被更新，请刷新后重试");
      }
      const documents = await tx.settlementSignedDocument.findMany({
        where: { settlementDraftId: draftId, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { id: true, purpose: true }
      });
      const evidencePurposes = new Set([
        "frozen_counterparty_copy", "counterparty_signed_original"
      ]);
      const hasSigningEvidence = documents.some((item) => evidencePurposes.has(item.purpose));
      const expectedAction = hasSigningEvidence
        ? "abandon_application"
        : "delete_pristine_draft";
      if (input.action !== expectedAction) {
        throw new ConflictException(
          hasSigningEvidence
            ? "结算草稿已生成或上传签章文件，只能放弃申请并保留证据"
            : "当前结算仍是纯净草稿，请刷新后使用“删除草稿”"
        );
      }
      const now = new Date();
      const updated = await tx.settlementDraft.updateMany({
        where: {
          id: draftId,
          projectId,
          ownerUserId: actorUserId,
          status: "draft",
          revision: input.expectedRevision,
          submittedSettlementId: null
        },
        data: {
          status: "abandoned",
          abandonedAt: now,
          abandonedByUserId: actorUserId,
          abandonReason: hasSigningEvidence ? reason : null,
          revision: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("结算草稿已被其他操作处理，请刷新后重试");
      }
      if (draft!.processId) {
        await this.processes?.voidOpenDraftProcess(
          tx,
          draft!.processId,
          draftId,
          actorUserId,
          hasSigningEvidence ? reason : "删除纯净结算草稿"
        );
      }
      await tx.settlementSignedDocument.updateMany({
        where: { settlementDraftId: draftId, status: "active" },
        data: {
          status: "invalidated",
          invalidatedAt: now,
          invalidationReason: "结算申请已放弃，文件作为历史证据保留"
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: hasSigningEvidence
          ? "settlement.application.abandon"
          : "settlement.draft.delete",
        businessType: "settlement_draft",
        businessId: draftId,
        metadata: {
          projectId,
          contractId: draft!.contractId,
          contractVersionId: draft!.contractVersionId,
          isFinal: draft!.isFinal,
          documentCount: documents.length,
          reason: hasSigningEvidence ? reason : null
        }
      });
      return {
        draftId,
        status: "abandoned",
        action: expectedAction,
        abandonedAt: now,
        releasedFinalSettlementOccupancy: draft!.isFinal,
        idempotent: false
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async contractContext(
    tx: Prisma.TransactionClient,
    projectId: string,
    contractVersionId: string
  ) {
    const version = await lockContractAndAssertCurrentEffective(
      tx,
      contractVersionId,
      true
    );
    if (
      !canCreateSettlementFromContractStatus(
        version.status as ContractVersionStatus
      )
    ) {
      throw new BadRequestException("合同尚未归档生效，暂时只能保留现有输入，不能新建结算草稿");
    }
    const contract = await tx.contract.findUnique({
      where: { id: version.contractId }
    });
    if (!contract) {
      throw new NotFoundException("未找到结算关联合同，请刷新合同台账后重试");
    }
    if (contract.settlementClosedAt || contract.finalSettlementId) {
      throw new BadRequestException("该合同已由最终结算关闭，不能再新建或修改结算草稿");
    }
    // `undefined` only exists in pre-migration test doubles. A persisted legacy
    // value is NULL and must be explicitly confirmed by the contract director.
    if (version.settlementMode !== undefined) {
      if (
        !isContractSettlementMode(version.settlementMode) ||
        !version.settlementModeConfirmedAt
      ) {
        throw new BadRequestException(
          "合同结算方式尚未由合同部主管确认，不能新建结算"
        );
      }
      if (version.settlementMode !== "settlement_required") {
        throw new BadRequestException("该合同已确认按合同直接付款，不能新建结算");
      }
    } else {
      assertSettlementContractType(contract.contractTypeKey);
    }
    if (contract.projectId !== projectId) {
      throw new BadRequestException("合同版本不属于当前项目，不能保存到该项目的结算草稿");
    }
    const finalSettlementCount = await tx.settlement.count({
      where: {
        contractId: contract.id,
        isFinal: true,
        status: { in: [...SETTLEMENT_OCCUPANCY_STATUSES] }
      }
    });
    if (finalSettlementCount > 0) {
      throw new BadRequestException(
        "该合同已存在占用中的最终结算，不能再新建或修改结算草稿"
      );
    }
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id, status: "effective" },
      orderBy: { versionNo: "desc" }
    });
    if (!terms) {
      throw new BadRequestException(
        "合同缺少已生效的结构化付款条款，当前输入暂不能保存为可提交草稿"
      );
    }
    return { version, contract, terms };
  }

  private assertOwnedDraft(
    draft:
      | {
          projectId: string;
          ownerUserId: string;
        }
      | null,
    projectId: string,
    actorUserId: string
  ): void {
    if (!draft || draft.projectId !== projectId) {
      throw new NotFoundException("未找到结算草稿，请刷新后重试");
    }
    if (draft.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只能查看和修改本人创建的结算草稿");
    }
  }

  private async assertNoActiveSettlement(
    tx: Prisma.TransactionClient,
    contractId: string
  ): Promise<void> {
    const activeDraft = await tx.settlementDraft.findFirst({
      where: {
        contractId,
        status: "draft",
        submittedSettlementId: null
      },
      select: { id: true, code: true }
    });
    if (activeDraft) {
      throw new ConflictException(
        `该合同已有进行中的结算草稿（${activeDraft.code}），请继续办理或作废后再新建`
      );
    }

    const activeSettlement = await tx.settlement.findFirst({
      where: {
        contractId,
        status: { in: [...SETTLEMENT_IN_PROGRESS_STATUSES] }
      },
      select: { id: true, code: true, status: true }
    });
    if (activeSettlement) {
      throw new ConflictException(
        `该合同已有进行中的结算（${activeSettlement.code}），请先继续办理或正式作废`
      );
    }
  }

  private finalAmount(input: SaveSettlementDraftDto): bigint | null {
    if (input.isFinal !== true) return null;
    if (input.finalCumulativeAmountCents === undefined) return null;
    return parseMoneyCentsInput(
      input.finalCumulativeAmountCents,
      "审定累计结算金额",
      "审定累计结算金额必须按分填写为 0 或更大的整数"
    );
  }

  private finalConfirmations(input: SaveSettlementDraftDto) {
    const values = {
      finalScopeCompleted: input.finalScopeCompleted,
      finalPriorSettlementsIncluded: input.finalPriorSettlementsIncluded,
      finalNoOutstandingSettlements: input.finalNoOutstandingSettlements,
      finalWithinContractCap: input.finalWithinContractCap,
      finalNoFurtherOrdinarySettlements: input.finalNoFurtherOrdinarySettlements
    };
    const supplied = Object.values(values).filter((value) => value !== undefined).length;
    if (input.isFinal === true && supplied !== 5) {
      throw new BadRequestException("最终结算必须逐项完成五项完结确认");
    }
    if (input.isFinal !== true && supplied !== 0) {
      throw new BadRequestException("过程结算不能填写最终结算完结确认");
    }
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value ?? null])
    );
  }

  private finalDraftFacts(input: SaveSettlementDraftDto) {
    const hasV2Declaration = input.finalDeclarationAccepted !== undefined;
    if (input.isFinal !== true) {
      if (hasV2Declaration) {
        throw new BadRequestException("过程结算不能填写最终结算总体声明");
      }
      return {
        finalCumulativeAmountCents: null,
        finalDeclarationVersion: null,
        finalDeclarationSnapshot: Prisma.JsonNull,
        ...this.finalConfirmations(input)
      };
    }

    if (!hasV2Declaration) {
      return {
        finalCumulativeAmountCents: this.finalAmount(input),
        finalDeclarationVersion: null,
        finalDeclarationSnapshot: Prisma.JsonNull,
        ...this.finalConfirmations(input)
      };
    }

    const legacyValues = [
      input.finalCumulativeAmountCents,
      input.finalScopeCompleted,
      input.finalPriorSettlementsIncluded,
      input.finalNoOutstandingSettlements,
      input.finalWithinContractCap,
      input.finalNoFurtherOrdinarySettlements
    ];
    if (legacyValues.some((value) => value !== undefined)) {
      throw new BadRequestException("最终结算 V2 不再填写累计金额或五项完结确认");
    }

    return {
      finalCumulativeAmountCents: null,
      finalDeclarationVersion: 1,
      finalDeclarationSnapshot: {
        version: 1,
        statement: "本次为最终结算，生效后不再发起新结算，未实施余量不再结算。",
        accepted: input.finalDeclarationAccepted === true
      } as Prisma.InputJsonValue,
      finalScopeCompleted: null,
      finalPriorSettlementsIncluded: null,
      finalNoOutstandingSettlements: null,
      finalWithinContractCap: null,
      finalNoFurtherOrdinarySettlements: null
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async draftDocuments(draftId: string) {
    const records = await this.prisma.settlementSignedDocument.findMany({
      where: {
        settlementDraftId: draftId,
        status: "active",
        purpose: { in: ["frozen_counterparty_copy", "counterparty_signed_original"] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const fileIds = [...new Set(records.map((record) => record.fileId))];
    const files = fileIds.length
      ? await this.prisma.fileObject.findMany({
          where: { id: { in: fileIds }, storageStatus: "active" },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true
          }
        })
      : [];
    const fileById = new Map(files.map((file) => [file.id, file]));
    const read = (purpose: "frozen_counterparty_copy" | "counterparty_signed_original") => {
      const record = records.find((candidate) => candidate.purpose === purpose);
      if (!record) return null;
      const file = fileById.get(record.fileId);
      if (!file) return null;
      return {
        id: record.id,
        fileId: file.id,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        pageCount: record.pageCount,
        sourceRevision: record.sourceRevision,
        status: record.status,
        generationStatus: record.generationStatus,
        declaration: record.declarationSnapshot,
        createdAt: record.createdAt.toISOString()
      };
    };
    return {
      frozenDocument: read("frozen_counterparty_copy"),
      counterpartySignedOriginal: read("counterparty_signed_original")
    };
  }

  private readModel<T>(
    draft: T,
    submissionBlockingReason: string | null = null,
    hasApprovalEvidence = false
  ): T & {
    submissionBlockingReason: string | null;
    lifecycleKind: "pristine_draft" | "approval_draft" | "formal_record";
    lifecycleBlockers: string[];
    availableActions: DetailActionReadModel[];
  } {
    const facts = draft as T & {
      status?: string; revision?: number; submittedSettlementId?: string | null;
      abandonedAt?: Date | null; abandonedByUserId?: string | null;
      abandonReason?: string | null; updatedAt?: Date;
    };
    const blockers = [
      ...(facts.status !== "draft" ? ["该结算草稿已不处于可编辑状态"] : []),
      ...(facts.submittedSettlementId ? ["该草稿已形成正式结算"] : [])
    ];
    const lifecycleKind = facts.status === "abandoned" || facts.submittedSettlementId
      ? "formal_record"
      : hasApprovalEvidence ? "approval_draft" : "pristine_draft";
    const availableActions: DetailActionReadModel[] = lifecycleKind === "formal_record" ? [] : [{
      key: lifecycleKind === "pristine_draft" ? "delete_pristine_draft" : "abandon_application",
      label: lifecycleKind === "pristine_draft" ? "删除草稿" : "放弃结算申请",
      kind: "danger",
      enabled: blockers.length === 0,
      disabledReason: blockers.length ? blockers.join("；") : null,
      requiresComment: lifecycleKind === "approval_draft"
    }];
    return {
      ...(JSON.parse(
      JSON.stringify(draft, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
      )
      ) as T),
      submissionBlockingReason,
      lifecycleKind,
      lifecycleBlockers: blockers,
      availableActions
    };
  }
}
