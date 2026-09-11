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
  ACTION_REQUIRED_ROLES,
  NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE,
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type NecessaryExpenseReserveTransitionAction,
  type RoleKey
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import {
  assertNecessaryExpenseReserveDraft,
  assertNecessaryExpenseReserveTransition,
  buildNecessaryExpenseReserveIdentity,
  buildNecessaryExpenseReserveFingerprint,
  sha256Jcs,
  type NecessaryExpenseReserveDraftCommand,
  type ValidatedNecessaryExpenseReserveDraft
} from "./necessary-expense-reserve.domain";

type Tx = Prisma.TransactionClient;
type ReserveEntryWithRelations = Prisma.ProjectNecessaryExpenseReserveEntryGetPayload<{
  include: { reserve: true; replacements: true };
}>;
type ReserveWithEntries = Prisma.ProjectNecessaryExpenseReserveGetPayload<{
  include: { entries: { include: { replacements: true } } };
}>;
type ReserveEntryPublicData = Prisma.ProjectNecessaryExpenseReserveEntryGetPayload<{
  include: { replacements: true };
}>;

const NECESSARY_EXPENSE_RESERVE_REPLACEMENT_IMPACT_KINDS = new Set([
  "confirmed_cost",
  "payable_increase",
  "estimated_clearing_expense",
  "construction_enterprise_funds_freeze",
  "project_disputed_funds_increase"
]);

export interface NecessaryExpenseReserveActor {
  userId: string;
}

export interface NecessaryExpenseReserveWorkbenchQuery {
  projectId: string;
  reserveId?: string;
}

export interface NecessaryExpenseReserveTransitionCommand {
  entryId: string;
  action: NecessaryExpenseReserveTransitionAction;
  expectedRevision: number;
  expectedFingerprint: string;
  idempotencyKey: string;
  reason?: string;
}

export interface NecessaryExpenseReserveEntryReadModel {
  id: string;
  reserveId: string;
  sequenceNo: number;
  revision: number;
  entryKind: string;
  adjustsEntryId: string | null;
  amountCents: string;
  occurredAt: string;
  reason: string;
  evidenceLevel: string;
  evidenceFileId: string;
  evidenceSha256: string;
  status: string;
  fingerprint: string;
  preparedByUserId: string;
  submittedByUserId: string | null;
  attestedByUserId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  returnReason: string | null;
  replacements: Array<{ operatingImpactEntryId: string; amountCents: string }>;
}

/**
 * Deep business Module for #279. Callers only learn workbench, draft and
 * transition; lifecycle, authority, snapshots, deduplication and ledger
 * append remain local to this implementation.
 */
@Injectable()
export class NecessaryExpenseReserveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly replay: OperatingSourceReplayService,
    private readonly audit: AuditService
  ) {}

  async getCapabilities(
    rawProjectId: string,
    actor: NecessaryExpenseReserveActor
  ) {
    const projectId = requiredText(rawProjectId, "项目不能为空");
    return this.prisma.$transaction(async (tx) => {
      const roles = await this.requireAction(
        tx,
        actor.userId,
        projectId,
        "necessary_expense_reserve.read"
      );
      return this.capabilities(roles);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getWorkbench(
    query: NecessaryExpenseReserveWorkbenchQuery,
    actor: NecessaryExpenseReserveActor
  ) {
    const projectId = requiredText(query.projectId, "项目不能为空");
    return this.prisma.$transaction(async (tx) => {
      const roles = await this.requireAction(
        tx,
        actor.userId,
        projectId,
        "necessary_expense_reserve.read"
      );
      const reserves = await tx.projectNecessaryExpenseReserve.findMany({
        where: {
          projectId,
          ...(query.reserveId ? { id: query.reserveId } : {})
        },
        include: {
          entries: {
            include: { replacements: true },
            orderBy: [{ sequenceNo: "desc" }, { createdAt: "desc" }]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      });
      return {
        projectId,
        capabilities: this.capabilities(roles),
        reserves: reserves.map((reserve) => this.publicReserve(reserve))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async saveDraft(
    command: NecessaryExpenseReserveDraftCommand,
    actor: NecessaryExpenseReserveActor
  ): Promise<NecessaryExpenseReserveEntryReadModel> {
    const draft = assertNecessaryExpenseReserveDraft(command);
    const identity = buildNecessaryExpenseReserveIdentity({
      projectId: draft.projectId,
      affiliateAssignmentId: draft.affiliateAssignmentId,
      fundHolderKind: draft.fundHolderKind,
      fundHolderId: draft.fundHolderId,
      basisKind: draft.basisKind,
      basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256,
      currencyCode: "CNY"
    });
    const fingerprint = buildNecessaryExpenseReserveFingerprint(draft);
    const receiptAction = draft.entryId ? "update_draft" : "create_draft";
    const commandFingerprint = sha256Jcs({
      interface: "NecessaryExpenseReserveModule.saveDraft/V1",
      action: receiptAction,
      actorUserId: actor.userId,
      entryId: draft.entryId ?? null,
      expectedRevision: draft.expectedRevision ?? null,
      payloadFingerprint: fingerprint
    });
    return this.serializable(async (tx) => {
      await this.lockEconomicIdentity(tx, identity.economicIdentityKey);
      const roles = await this.requireAction(
        tx,
        actor.userId,
        draft.projectId,
        "necessary_expense_reserve.prepare"
      );
      await this.lockCommandIdempotency(tx, draft.idempotencyKey);
      const priorReceipt = await tx.projectNecessaryExpenseReserveCommandReceipt.findUnique({
        where: { idempotencyKey: draft.idempotencyKey }
      });
      if (priorReceipt) {
        if (priorReceipt.commandFingerprint !== commandFingerprint) {
          throw new ConflictException("幂等键已用于另一条必要准备命令");
        }
        return this.commandReceiptResult(priorReceipt.resultSnapshot);
      }
      const context = await this.readAuthoritativeContext(tx, draft);
      const existingByCommand = await tx.projectNecessaryExpenseReserveEntry.findUnique({
        where: { idempotencyKey: draft.idempotencyKey },
        include: { reserve: true, replacements: true }
      });
      if (existingByCommand) {
        if (
          receiptAction !== "create_draft" ||
          existingByCommand.fingerprint !== fingerprint ||
          existingByCommand.reserve.projectId !== draft.projectId
        ) {
          throw new ConflictException("幂等键已用于另一份必要准备草稿");
        }
        const result = this.publicEntry(existingByCommand);
        await this.createCommandReceipt(tx, {
          entryId: existingByCommand.id,
          idempotencyKey: draft.idempotencyKey,
          action: receiptAction,
          actorUserId: actor.userId,
          commandFingerprint,
          result
        });
        return result;
      }

      const reserve = draft.reserveId
        ? await this.requireCompatibleReserve(tx, draft.reserveId, draft, identity)
        : await this.createReserve(tx, draft, identity, context, actor.userId);
      const entry = draft.entryId
        ? await this.updateDraft(tx, reserve.id, draft, fingerprint, actor.userId)
        : await this.createEntry(tx, reserve.id, draft, fingerprint, actor.userId);
      const result = this.publicEntry({ ...entry, replacements: [] });
      await this.audit.record(tx, {
        action: draft.entryId
          ? "necessary_expense_reserve.draft.update"
          : "necessary_expense_reserve.draft.create",
        actorUserId: actor.userId,
        businessType: "project_necessary_expense_reserve_entry",
        businessId: entry.id,
        metadata: {
          projectId: reserve.projectId,
          effectiveRoles: roles,
          entryKind: entry.entryKind,
          revision: entry.draftRevision,
          fingerprint,
          amountCents: entry.amountCents.toString(),
          occurredAt: entry.occurredAt.toISOString().slice(0, 10),
          result: "success"
        }
      });
      await this.createCommandReceipt(tx, {
        entryId: entry.id,
        idempotencyKey: draft.idempotencyKey,
        action: receiptAction,
        actorUserId: actor.userId,
        commandFingerprint,
        result
      });
      return result;
    });
  }

  async transition(
    command: NecessaryExpenseReserveTransitionCommand,
    actor: NecessaryExpenseReserveActor
  ): Promise<NecessaryExpenseReserveEntryReadModel> {
    validateTransitionCommand(command);
    const commandFingerprint = sha256Jcs({
      interface: "NecessaryExpenseReserveModule.transition/V1",
      entryId: command.entryId,
      action: command.action,
      expectedRevision: command.expectedRevision,
      expectedFingerprint: command.expectedFingerprint,
      reason: command.reason?.trim() || null,
      actorUserId: actor.userId
    });
    const confirmationIdentity = command.action === "confirm"
      ? await this.prisma.projectNecessaryExpenseReserveEntry.findUnique({
          where: { id: command.entryId },
          select: { reserve: { select: { economicIdentityKey: true } } }
        })
      : null;
    return this.serializable(async (tx) => {
      if (confirmationIdentity) {
        await this.lockEconomicIdentity(
          tx,
          confirmationIdentity.reserve.economicIdentityKey
        );
      }
      await this.lockCommandIdempotency(tx, command.idempotencyKey);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT entry."id"
          FROM "ProjectNecessaryExpenseReserveEntry" entry
         WHERE entry."id" = ${command.entryId}
         FOR UPDATE
      `);
      if (!locked[0]) throw new NotFoundException("必要准备分录不存在");
      const entry = await tx.projectNecessaryExpenseReserveEntry.findUnique({
        where: { id: command.entryId },
        include: { reserve: true, replacements: true }
      });
      if (!entry) throw new NotFoundException("必要准备分录不存在");
      const action = `necessary_expense_reserve.${command.action}` as BusinessAction;
      const roles = await this.requireAction(
        tx,
        actor.userId,
        entry.reserve.projectId,
        action
      );
      const priorReceipt = await tx.projectNecessaryExpenseReserveCommandReceipt.findUnique({
        where: { idempotencyKey: command.idempotencyKey }
      });
      if (priorReceipt) {
        if (priorReceipt.commandFingerprint !== commandFingerprint) {
          throw new ConflictException("幂等键已用于另一条必要准备命令");
        }
        return this.commandReceiptResult(priorReceipt.resultSnapshot);
      }
      if (entry.draftRevision !== command.expectedRevision) {
        throw new ConflictException("必要准备草稿修订已变化，请刷新后重试");
      }
      const targetStatus = assertNecessaryExpenseReserveTransition({
        action: command.action,
        status: entry.status as never,
        preparedByUserId: entry.preparedByUserId,
        attestedByUserId: entry.attestedByUserId,
        actorUserId: actor.userId,
        actorRoles: roles,
        fingerprint: entry.fingerprint,
        expectedFingerprint: command.expectedFingerprint
      });
      const now = new Date();
      let payloadSnapshot: Prisma.InputJsonObject | undefined;
      if (command.action === "submit") {
        payloadSnapshot = await this.buildFrozenSnapshot(tx, entry);
      }
      if (command.action === "confirm") {
        await this.lockConfirmationRows(tx, entry);
        await this.assertConfirmableSource(tx, entry);
        if (entry.entryKind === "technical_reversal") {
          const targetFact = await tx.operatingFact.findUnique({
            where: {
              sourceType_sourceBusinessId: {
                sourceType: NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE,
                sourceBusinessId: entry.adjustsEntryId!
              }
            },
            select: { id: true, amountCents: true, projectId: true }
          });
          if (!targetFact || targetFact.projectId !== entry.reserve.projectId || targetFact.amountCents !== entry.amountCents) {
            throw new ConflictException("技术冲销引用的原必要准备经营事实不一致");
          }
        }
        if (!entry.payloadSnapshot) {
          throw new ConflictException("必要准备提交冻结快照缺失，拒绝确认");
        }
      }
      const updated = await tx.projectNecessaryExpenseReserveEntry.update({
        where: { id: entry.id },
        data: {
          status: targetStatus,
          ...(command.action === "submit"
            ? {
                submittedByUserId: actor.userId,
                submittedAt: now,
                attestedByUserId: null,
                attestedAt: null,
                confirmedByUserId: null,
                confirmedAt: null,
                returnedByUserId: null,
                returnedAt: null,
                returnReason: null,
                payloadSnapshot
              }
            : {}),
          ...(command.action === "attest"
            ? { attestedByUserId: actor.userId, attestedAt: now }
            : {}),
          ...(command.action === "confirm"
            ? { confirmedByUserId: actor.userId, confirmedAt: now }
            : {}),
          ...(command.action === "return"
            ? {
                returnedByUserId: actor.userId,
                returnedAt: now,
                returnReason: requiredText(command.reason, "退回原因不能为空")
              }
            : {})
        },
        include: { reserve: true, replacements: true }
      });
      if (command.action === "confirm") {
        await this.replay.appendConfirmedSourceIfEnabledInTransaction(
          tx,
          {
            projectId: entry.reserve.projectId,
            sourceType: NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE,
            sourceBusinessId: entry.id
          },
          actor.userId
        );
        if (entry.entryKind === "release") {
          await this.appendReplacementLinks(tx, entry, entry.payloadSnapshot);
        }
      }
      await this.audit.record(tx, {
        action: `necessary_expense_reserve.${command.action}`,
        actorUserId: actor.userId,
        businessType: "project_necessary_expense_reserve_entry",
        businessId: entry.id,
        metadata: {
          projectId: entry.reserve.projectId,
          effectiveRoles: roles,
          entryKind: entry.entryKind,
          revision: entry.draftRevision,
          fingerprint: entry.fingerprint,
          previousStatus: entry.status,
          nextStatus: targetStatus,
          amountCents: entry.amountCents.toString(),
          occurredAt: entry.occurredAt.toISOString().slice(0, 10),
          confirmedAt: command.action === "confirm" ? now.toISOString() : null,
          result: "success"
        }
      });
      if (
        command.action === "confirm" &&
        (entry.entryKind === "release" || entry.entryKind === "technical_reversal")
      ) {
        await this.audit.record(tx, {
          action: `necessary_expense_reserve.${entry.entryKind}`,
          actorUserId: actor.userId,
          businessType: "project_necessary_expense_reserve_entry",
          businessId: entry.id,
          metadata: {
            projectId: entry.reserve.projectId,
            effectiveRoles: roles,
            revision: entry.draftRevision,
            fingerprint: entry.fingerprint,
            occurredAt: entry.occurredAt.toISOString().slice(0, 10),
            confirmedAt: now.toISOString(),
            amountCents: entry.amountCents.toString(),
            result: "success"
          }
        });
      }
      const result = this.publicEntry(updated);
      await this.createCommandReceipt(tx, {
        entryId: entry.id,
        idempotencyKey: command.idempotencyKey,
        action: command.action,
        actorUserId: actor.userId,
        commandFingerprint,
        result
      });
      return result;
    });
  }

  private async createReserve(
    tx: Tx,
    draft: ValidatedNecessaryExpenseReserveDraft,
    identity: ReturnType<typeof buildNecessaryExpenseReserveIdentity>,
    context: Awaited<ReturnType<NecessaryExpenseReserveService["readAuthoritativeContext"]>>,
    actorUserId: string
  ) {
    if (draft.entryKind !== "establish") {
      throw new BadRequestException("新必要准备必须先建立，不能从增加、释放或冲销开始");
    }
    return tx.projectNecessaryExpenseReserve.create({
      data: {
        id: randomUUID(),
        projectId: draft.projectId,
        businessCode: draft.businessCode,
        affiliateAssignmentId: draft.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: context.assignment.businessPartyVersionId,
        affiliateNameSnapshot: context.assignment.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: context.assignment.affiliateCreditCodeSnapshot,
        fundHolderKind: draft.fundHolderKind,
        fundHolderId: draft.fundHolderId,
        reasonKind: draft.reasonKind,
        title: draft.title,
        basisKind: draft.basisKind,
        basisBusinessIdOrEvidenceSha256: draft.basisBusinessIdOrEvidenceSha256,
        basisSummary: draft.basisSummary,
        economicIdentityKey: identity.economicIdentityKey,
        sourceIdentityKey: identity.sourceIdentityKey,
        createdByUserId: actorUserId
      }
    });
  }

  private async requireCompatibleReserve(
    tx: Tx,
    reserveId: string,
    draft: ValidatedNecessaryExpenseReserveDraft,
    identity: ReturnType<typeof buildNecessaryExpenseReserveIdentity>
  ) {
    const reserve = await tx.projectNecessaryExpenseReserve.findUnique({ where: { id: reserveId } });
    if (!reserve || reserve.projectId !== draft.projectId) {
      throw new NotFoundException("必要准备事项不存在");
    }
    if (
      reserve.economicIdentityKey !== identity.economicIdentityKey ||
      reserve.sourceIdentityKey !== identity.sourceIdentityKey ||
      reserve.businessCode !== draft.businessCode ||
      reserve.reasonKind !== draft.reasonKind
    ) {
      throw new ConflictException("必要准备经济身份已冻结，不能通过草稿改写");
    }

    if (reserve.title === draft.title && reserve.basisSummary === draft.basisSummary) {
      return reserve;
    }
    if (!draft.entryId) {
      throw new ConflictException("必要准备事项说明已冻结，后续分录必须沿用原事项说明");
    }
    const [editableEntry, entryCount] = await Promise.all([
      tx.projectNecessaryExpenseReserveEntry.findUnique({
        where: { id: draft.entryId },
        select: { reserveId: true, status: true }
      }),
      tx.projectNecessaryExpenseReserveEntry.count({ where: { reserveId } })
    ]);
    if (
      !editableEntry ||
      editableEntry.reserveId !== reserveId ||
      !new Set(["draft", "returned"]).has(editableEntry.status) ||
      entryCount !== 1
    ) {
      throw new ConflictException("必要准备事项说明已冻结，不能由后续或非草稿分录改写");
    }
    return tx.projectNecessaryExpenseReserve.update({
      where: { id: reserveId },
      data: { title: draft.title, basisSummary: draft.basisSummary }
    });
  }

  private async createEntry(
    tx: Tx,
    reserveId: string,
    draft: ValidatedNecessaryExpenseReserveDraft,
    fingerprint: string,
    actorUserId: string
  ) {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended('pol279:reserve:' || ${reserveId}, 0))
    `);
    const [last, confirmedEstablishment] = await Promise.all([
      tx.projectNecessaryExpenseReserveEntry.aggregate({
        where: { reserveId },
        _max: { sequenceNo: true }
      }),
      tx.projectNecessaryExpenseReserveEntry.findFirst({
        where: { reserveId, entryKind: "establish", status: "confirmed" },
        select: { id: true }
      })
    ]);
    const lastSequenceNo = last._max.sequenceNo ?? 0;
    if (lastSequenceNo === 0 && draft.entryKind !== "establish") {
      throw new ConflictException("必要准备首笔分录必须先建立准备");
    }
    if (lastSequenceNo > 0 && draft.entryKind === "establish") {
      throw new ConflictException("必要准备已建立，后续变化必须追加增加、释放或技术冲销");
    }
    if (draft.entryKind === "increase" && !confirmedEstablishment) {
      throw new ConflictException("必要准备建立分录确认后才能追加增加");
    }
    return tx.projectNecessaryExpenseReserveEntry.create({
      data: {
        id: randomUUID(),
        reserveId,
        sequenceNo: lastSequenceNo + 1,
        draftRevision: 1,
        entryKind: draft.entryKind,
        adjustsEntryId: draft.adjustsEntryId,
        amountCents: draft.amountCents,
        currencyCode: "CNY",
        occurredAt: draft.occurredAtDate,
        reason: draft.reason,
        evidenceLevel: draft.evidenceLevel,
        evidenceFileId: draft.evidenceFileId,
        evidenceSha256: draft.evidenceSha256,
        fingerprint,
        idempotencyKey: draft.idempotencyKey,
        preparedByUserId: actorUserId,
        payloadSnapshot: this.draftReplacementSnapshot(draft)
      }
    });
  }

  private async updateDraft(
    tx: Tx,
    reserveId: string,
    draft: ValidatedNecessaryExpenseReserveDraft,
    fingerprint: string,
    actorUserId: string
  ) {
    const entry = await tx.projectNecessaryExpenseReserveEntry.findUnique({ where: { id: draft.entryId } });
    if (!entry || entry.reserveId !== reserveId) throw new NotFoundException("必要准备草稿不存在");
    if (!new Set(["draft", "returned"]).has(entry.status)) {
      throw new ConflictException("已提交或已确认的必要准备分录不能覆盖修改");
    }
    if (entry.preparedByUserId !== actorUserId) {
      throw new ForbiddenException("必要准备草稿只能由原准备人继续修改");
    }
    if (
      entry.entryKind !== draft.entryKind ||
      entry.adjustsEntryId !== (draft.adjustsEntryId ?? null)
    ) {
      throw new ConflictException("必要准备分录类型与精确调整目标创建后不可改写");
    }
    if (draft.expectedRevision !== entry.draftRevision) {
      throw new ConflictException("必要准备草稿修订已变化，请刷新后重试");
    }
    return tx.projectNecessaryExpenseReserveEntry.update({
      where: { id: entry.id },
      data: {
        draftRevision: { increment: 1 },
        amountCents: draft.amountCents,
        occurredAt: draft.occurredAtDate,
        reason: draft.reason,
        evidenceLevel: draft.evidenceLevel,
        evidenceFileId: draft.evidenceFileId,
        evidenceSha256: draft.evidenceSha256,
        status: "draft",
        fingerprint,
        payloadSnapshot: this.draftReplacementSnapshot(draft),
        submittedByUserId: null,
        submittedAt: null,
        attestedByUserId: null,
        attestedAt: null,
        confirmedByUserId: null,
        confirmedAt: null,
        returnedByUserId: null,
        returnedAt: null,
        returnReason: null
      }
    });
  }

  private async readAuthoritativeContext(tx: Tx, draft: ValidatedNecessaryExpenseReserveDraft) {
    const project = await tx.project.findUnique({
      where: { id: draft.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) {
      throw new ConflictException("项目尚未启用经营账，不能建立必要费用准备");
    }
    const assignment = await tx.projectAffiliateAssignment.findFirst({
      where: {
        id: draft.affiliateAssignmentId,
        projectId: draft.projectId,
        effectiveFrom: { lte: draft.occurredAtDate },
        OR: [{ endedAt: null }, { endedAt: { gt: draft.occurredAtDate } }]
      },
      select: {
        id: true,
        businessPartyVersionId: true,
        affiliateNameSnapshot: true,
        affiliateCreditCodeSnapshot: true
      }
    });
    if (!assignment) throw new ConflictException("业务发生日缺少有效施工企业档案");
    if (draft.fundHolderKind === "construction_enterprise") {
      if (draft.fundHolderId !== assignment.businessPartyVersionId) {
        throw new ConflictException("施工企业资金持有主体与冻结施工企业版本不一致");
      }
    } else {
      const company = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: draft.projectId,
          companyEntityId: draft.fundHolderId,
          effectiveFrom: { lte: draft.occurredAtDate },
          OR: [{ endedAt: null }, { endedAt: { gt: draft.occurredAtDate } }]
        },
        select: { id: true }
      });
      if (!company) throw new ConflictException("业务发生日资金持有公司不是项目有效参与公司");
    }
    const evidence = await tx.fileObject.findUnique({
      where: { id: draft.evidenceFileId },
      select: { contentSha256: true, storageStatus: true }
    });
    if (!evidence || evidence.storageStatus !== "active" || evidence.contentSha256 !== draft.evidenceSha256) {
      throw new ConflictException("私有证据文件不存在、不可用或内容哈希已变化");
    }
    return { project, assignment };
  }

  private async assertConfirmableSource(
    tx: Tx,
    entry: ReserveEntryWithRelations
  ) {
    const draft = this.entryAsDraft(entry);
    await this.readAuthoritativeContext(tx, draft);
    // Positive entries must prove that this economic matter has not already
    // been recognized elsewhere. A release or exact technical reversal is the
    // append-only way to reduce an existing reserve and may intentionally point
    // at the formal impact that replaced it; applying the positive-entry guard
    // here would make that frozen replacement workflow impossible.
    if (entry.entryKind === "release" || entry.entryKind === "technical_reversal") {
      return;
    }
    const crossSource = await tx.$queryRaw<Array<{ duplicateExists: boolean }>>(Prisma.sql`
      SELECT "pol279_cross_source_identity_exists"(
        ${entry.reserve.economicIdentityKey}
      ) AS "duplicateExists"
    `);
    if (crossSource[0]?.duplicateExists) {
      throw new ConflictException("duplicate_blocked：该经济事项已由一般争议资金正式来源覆盖");
    }
    const duplicate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT impact."id"
        FROM "OperatingImpactEntry" impact
        JOIN "OperatingFact" fact ON fact."id" = impact."factId"
       WHERE impact."projectId" = ${entry.reserve.projectId}
         AND fact."status" = 'confirmed'
         AND (
           (
             impact."impactSnapshot" ->> 'economicIdentityKey' = ${entry.reserve.economicIdentityKey}
             AND NOT (
               fact."sourceType" = ${NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE}
               AND impact."impactSnapshot" ->> 'reserveId' = ${entry.reserve.id}
             )
           )
           OR (
             fact."sourceType" = ${NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE}
             AND fact."basisSnapshot" ->> 'evidenceSha256' = ${entry.evidenceSha256}
           )
           OR (
             impact."impactKind" IN ('estimated_clearing_expense', 'confirmed_cost', 'payable_increase')
             AND (
               fact."sourceSnapshot" ->> 'basisBusinessIdOrEvidenceSha256' = ${entry.reserve.basisBusinessIdOrEvidenceSha256}
               OR fact."basisSnapshot" ->> 'evidenceSha256' = ${entry.evidenceSha256}
             )
           )
         )
       LIMIT 1
    `);
    if (duplicate[0]) {
      throw new ConflictException("duplicate_blocked：该经济事项已由预计清算、成本、应付或其他正式来源覆盖");
    }
    const suspected = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT impact."id"
        FROM "OperatingImpactEntry" impact
        JOIN "OperatingFact" fact ON fact."id" = impact."factId"
       WHERE impact."projectId" = ${entry.reserve.projectId}
         AND fact."status" = 'confirmed'
         AND impact."impactKind" IN ('estimated_clearing_expense', 'confirmed_cost', 'payable_increase')
         AND impact."amountCents" = ${entry.amountCents}
         AND impact."subjectKind" = ${entry.reserve.fundHolderKind}
         AND impact."subjectId" = ${entry.reserve.fundHolderId}
         AND NULLIF(impact."impactSnapshot" ->> 'economicIdentityKey', '') IS NULL
         AND NULLIF(fact."sourceSnapshot" ->> 'basisBusinessIdOrEvidenceSha256', '') IS NULL
         AND NULLIF(fact."basisSnapshot" ->> 'evidenceSha256', '') IS NULL
       LIMIT 1
    `);
    if (suspected[0]) {
      throw new ConflictException("duplicate_suspected：存在同金额、同资金主体但缺少可比经济身份的正式扣减，请补充依据后复核");
    }
  }

  private async buildFrozenSnapshot(
    tx: Tx,
    entry: {
      id: string;
      draftRevision: number;
      entryKind: string;
      adjustsEntryId: string | null;
      amountCents: bigint;
      occurredAt: Date;
      reason: string;
      evidenceLevel: string;
      evidenceFileId: string;
      evidenceSha256: string;
      fingerprint: string;
      idempotencyKey: string;
      payloadSnapshot: Prisma.JsonValue | null;
      reserve: {
        id: string;
        projectId: string;
        businessCode: string;
        reasonKind: string;
        title: string;
        affiliateAssignmentId: string;
        affiliateBusinessPartyVersionId: string;
        affiliateNameSnapshot: string;
        affiliateCreditCodeSnapshot: string | null;
        fundHolderKind: string;
        fundHolderId: string;
        basisKind: string;
        basisBusinessIdOrEvidenceSha256: string;
        basisSummary: string;
        economicIdentityKey: string;
        sourceIdentityKey: string;
      };
    }
  ): Promise<Prisma.InputJsonObject> {
    const project = await tx.project.findUnique({
      where: { id: entry.reserve.projectId },
      select: { operatingLedgerEffectiveDate: true }
    });
    if (!project?.operatingLedgerEffectiveDate) {
      throw new ConflictException("项目经营账生效日不存在");
    }
    const adjustedEntry = entry.adjustsEntryId
      ? await tx.projectNecessaryExpenseReserveEntry.findUnique({
          where: { id: entry.adjustsEntryId },
          select: {
            reserveId: true,
            entryKind: true,
            amountCents: true,
            fingerprint: true,
            status: true
          }
        })
      : null;
    if (
      entry.adjustsEntryId &&
      (!adjustedEntry ||
        adjustedEntry.reserveId !== entry.reserve.id ||
        adjustedEntry.status !== "confirmed" ||
        !["establish", "increase"].includes(adjustedEntry.entryKind))
    ) {
      throw new ConflictException("释放或技术冲销必须引用同一事项的已确认建立/增加分录");
    }
    if (
      entry.entryKind === "technical_reversal" &&
      adjustedEntry?.amountCents !== entry.amountCents
    ) {
      throw new ConflictException("技术冲销必须等额冲销原确认分录");
    }
    return {
      schema: "project_necessary_expense_reserve_entry/V1",
      reserveId: entry.reserve.id,
      entryId: entry.id,
      entryKind: entry.entryKind,
      ...(entry.adjustsEntryId ? { adjustsEntryId: entry.adjustsEntryId } : {}),
      ...(adjustedEntry
        ? {
            adjustsEntryKind: adjustedEntry.entryKind,
            adjustsEntryFingerprint: adjustedEntry.fingerprint
          }
        : {}),
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString(),
      reason: entry.reason,
      operatingLedgerEffectiveDate: project.operatingLedgerEffectiveDate.toISOString(),
      evidenceLevel: entry.evidenceLevel,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      fingerprint: entry.fingerprint,
      economicIdentityKey: entry.reserve.economicIdentityKey,
      sourceIdentityKey: entry.reserve.sourceIdentityKey,
      idempotencyKey: entry.idempotencyKey,
      sourceVersion: String(entry.draftRevision),
      businessCode: entry.reserve.businessCode,
      reasonKind: entry.reserve.reasonKind,
      title: entry.reserve.title,
      basisKind: entry.reserve.basisKind,
      basisBusinessIdOrEvidenceSha256:
        entry.reserve.basisBusinessIdOrEvidenceSha256,
      basisSummary: entry.reserve.basisSummary,
      affiliate: {
        assignmentId: entry.reserve.affiliateAssignmentId,
        businessPartyVersionId: entry.reserve.affiliateBusinessPartyVersionId,
        name: entry.reserve.affiliateNameSnapshot,
        ...(entry.reserve.affiliateCreditCodeSnapshot
          ? { creditCode: entry.reserve.affiliateCreditCodeSnapshot }
          : {})
      },
      fundHolder: {
        kind: entry.reserve.fundHolderKind,
        id: entry.reserve.fundHolderId
      },
      replacementImpacts: this.replacementSnapshot(entry.payloadSnapshot)
    };
  }

  private async appendReplacementLinks(
    tx: Tx,
    entry: { id: string; amountCents: bigint; reserve: { projectId: string } },
    snapshot: unknown
  ) {
    const replacements = this.replacementSnapshot(snapshot);
    if (!replacements.length) return;
    const impacts = await tx.operatingImpactEntry.findMany({
      where: {
        id: { in: replacements.map((replacement) => replacement.operatingImpactEntryId) },
        projectId: entry.reserve.projectId
      },
      select: {
        id: true,
        amountCents: true,
        impactKind: true,
        direction: true,
        sourceType: true,
        fact: { select: { status: true } }
      }
    });
    if (impacts.length !== replacements.length) {
      throw new ConflictException("释放声明的替代正式影响不存在或不属于同一项目");
    }
    const impactById = new Map(impacts.map((impact) => [impact.id, impact]));
    if (impacts.some((impact) =>
      impact.fact.status !== "confirmed" ||
      impact.direction !== "increase" ||
      impact.sourceType === NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE ||
      !NECESSARY_EXPENSE_RESERVE_REPLACEMENT_IMPACT_KINDS.has(impact.impactKind)
    )) {
      throw new ConflictException("释放替代只能引用同项目已确认的正式扣减影响");
    }
    const total = replacements.reduce((sum, replacement) => sum + BigInt(replacement.amountCents), 0n);
    if (total > entry.amountCents || replacements.some((replacement) => {
      const impact = impactById.get(replacement.operatingImpactEntryId);
      return !impact || BigInt(replacement.amountCents) > impact.amountCents;
    })) {
      throw new ConflictException("释放替代分配超过释放金额或正式影响金额");
    }
    const orderedReplacements = [...replacements].sort((left, right) =>
      left.operatingImpactEntryId < right.operatingImpactEntryId
        ? -1
        : left.operatingImpactEntryId > right.operatingImpactEntryId
          ? 1
          : 0
    );
    for (const replacement of orderedReplacements) {
      await tx.projectNecessaryExpenseReserveReplacement.create({
        data: {
          id: randomUUID(),
          reserveEntryId: entry.id,
          operatingImpactEntryId: replacement.operatingImpactEntryId,
          amountCents: BigInt(replacement.amountCents)
        }
      });
    }
  }

  private entryAsDraft(entry: {
    reserve: {
      id: string;
      projectId: string;
      businessCode: string;
      affiliateAssignmentId: string;
      fundHolderKind: string;
      fundHolderId: string;
      reasonKind: string;
      title: string;
      basisKind: string;
      basisBusinessIdOrEvidenceSha256: string;
      basisSummary: string;
    };
    id: string;
    entryKind: string;
    adjustsEntryId: string | null;
    amountCents: bigint;
    occurredAt: Date;
    evidenceLevel: string;
    evidenceFileId: string;
    evidenceSha256: string;
    reason: string;
    idempotencyKey: string;
    draftRevision: number;
    payloadSnapshot: Prisma.JsonValue | null;
  }): ValidatedNecessaryExpenseReserveDraft {
    return assertNecessaryExpenseReserveDraft({
      reserveId: entry.reserve.id,
      entryId: entry.id,
      projectId: entry.reserve.projectId,
      businessCode: entry.reserve.businessCode,
      affiliateAssignmentId: entry.reserve.affiliateAssignmentId,
      fundHolderKind: entry.reserve.fundHolderKind as never,
      fundHolderId: entry.reserve.fundHolderId,
      reasonKind: entry.reserve.reasonKind as never,
      title: entry.reserve.title,
      basisKind: entry.reserve.basisKind,
      basisBusinessIdOrEvidenceSha256: entry.reserve.basisBusinessIdOrEvidenceSha256,
      basisSummary: entry.reserve.basisSummary,
      entryKind: entry.entryKind as never,
      ...(entry.adjustsEntryId ? { adjustsEntryId: entry.adjustsEntryId } : {}),
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString().slice(0, 10),
      evidenceLevel: entry.evidenceLevel as never,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      reason: entry.reason,
      replacementImpacts: this.replacementSnapshot(entry.payloadSnapshot),
      idempotencyKey: entry.idempotencyKey,
      expectedRevision: entry.draftRevision
    });
  }

  private draftReplacementSnapshot(draft: ValidatedNecessaryExpenseReserveDraft): Prisma.InputJsonObject {
    return { replacementImpacts: draft.replacementImpacts ?? [] } as Prisma.InputJsonObject;
  }

  private replacementSnapshot(value: unknown): Array<{
    operatingImpactEntryId: string;
    amountCents: string;
  }> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = (value as Record<string, unknown>).replacementImpacts;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      return typeof record.operatingImpactEntryId === "string" &&
        typeof record.amountCents === "string"
        ? [{
            operatingImpactEntryId: record.operatingImpactEntryId,
            amountCents: record.amountCents
          }]
        : [];
    });
  }

  private async requireAction(
    tx: Tx,
    userId: string,
    projectId: string,
    action: BusinessAction
  ): Promise<RoleKey[]> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) throw new ForbiddenException("当前账号不可用");
    const assignments = await tx.userPosition.findMany({
      where: { userId, OR: [{ projectId: null }, { projectId }] },
      select: { positionId: true, projectId: true }
    });
    const positions = assignments.length
      ? await tx.position.findMany({
          where: { id: { in: [...new Set(assignments.map((row) => row.positionId))] } },
          select: { id: true, key: true }
        })
      : [];
    const positionById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const projectMembers = await tx.projectMember.findMany({
      where: { userId, projectId },
      select: { positionKey: true }
    });
    const globalRoles = assignments
      .filter((row) => row.projectId === null)
      .map((row) => positionById.get(row.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const projectRoles = [
      ...assignments
        .filter((row) => row.projectId === projectId)
        .map((row) => positionById.get(row.positionId))
        .filter((role): role is RoleKey => Boolean(role)),
      ...projectMembers.map((row) => row.positionKey as RoleKey)
    ];
    const roles = resolveEffectiveRoleKeys(globalRoles, projectRoles);
    if (!canPerform(action, roles)) {
      throw new ForbiddenException(`当前账号缺少必要准备动作权限：${ACTION_REQUIRED_ROLES[action].join("、")}`);
    }
    return roles;
  }

  private lockEconomicIdentity(tx: Tx, economicIdentityKey: string) {
    return tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('pol:project-cash-restriction:economic:' || ${economicIdentityKey}, 0)
      )
    `);
  }

  private lockCommandIdempotency(tx: Tx, idempotencyKey: string) {
    return tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended('pol279:command:' || ${idempotencyKey}, 0)
      )
    `);
  }

  private async lockConfirmationRows(
    tx: Tx,
    entry: ReserveEntryWithRelations
  ) {
    const project = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT project."id"
        FROM "Project" project
       WHERE project."id" = ${entry.reserve.projectId}
       FOR UPDATE
    `);
    const reserve = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT reserve."id"
        FROM "ProjectNecessaryExpenseReserve" reserve
       WHERE reserve."id" = ${entry.reserve.id}
       FOR UPDATE
    `);
    if (!project[0] || !reserve[0]) {
      throw new ConflictException("必要准备确认锚点已变化，请刷新后重试");
    }
    if (entry.adjustsEntryId) {
      const adjusted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT adjusted."id"
          FROM "ProjectNecessaryExpenseReserveEntry" adjusted
         WHERE adjusted."id" = ${entry.adjustsEntryId}
         FOR UPDATE
      `);
      if (!adjusted[0]) {
        throw new ConflictException("必要准备调整目标已变化，请刷新后重试");
      }
    }
  }

  private createCommandReceipt(
    tx: Tx,
    input: {
      entryId: string;
      idempotencyKey: string;
      action: string;
      actorUserId: string;
      commandFingerprint: string;
      result: NecessaryExpenseReserveEntryReadModel;
    }
  ) {
    return tx.projectNecessaryExpenseReserveCommandReceipt.create({
      data: {
        id: randomUUID(),
        entryId: input.entryId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        actorUserId: input.actorUserId,
        commandFingerprint: input.commandFingerprint,
        resultSnapshot: input.result as unknown as Prisma.InputJsonObject
      }
    });
  }

  private capabilities(roles: readonly RoleKey[]) {
    const actions = ["read", "prepare", "submit", "attest", "confirm", "return"] as const;
    return Object.fromEntries(actions.map((action) => [
      action,
      canPerform(`necessary_expense_reserve.${action}` as BusinessAction, roles)
    ]));
  }

  private publicReserve(reserve: ReserveWithEntries) {
    return {
      id: reserve.id,
      businessCode: reserve.businessCode,
      reasonKind: reserve.reasonKind,
      title: reserve.title,
      fundHolderKind: reserve.fundHolderKind,
      fundHolderId: reserve.fundHolderId,
      basisKind: reserve.basisKind,
      basisBusinessIdOrEvidenceSha256:
        reserve.basisBusinessIdOrEvidenceSha256,
      basisSummary: reserve.basisSummary,
      entries: reserve.entries.map((entry) => this.publicEntry(entry))
    };
  }

  private commandReceiptResult(value: Prisma.JsonValue): NecessaryExpenseReserveEntryReadModel {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.id !== "string" ||
      typeof value.reserveId !== "string" ||
      typeof value.fingerprint !== "string" ||
      typeof value.status !== "string" ||
      !Array.isArray(value.replacements)
    ) {
      throw new ConflictException("必要准备命令回执损坏，拒绝幂等重放");
    }
    return value as unknown as NecessaryExpenseReserveEntryReadModel;
  }

  private publicEntry(entry: ReserveEntryPublicData): NecessaryExpenseReserveEntryReadModel {
    return {
      id: entry.id,
      reserveId: entry.reserveId,
      sequenceNo: entry.sequenceNo,
      revision: entry.draftRevision,
      entryKind: entry.entryKind,
      adjustsEntryId: entry.adjustsEntryId,
      amountCents: entry.amountCents.toString(),
      occurredAt: entry.occurredAt.toISOString().slice(0, 10),
      reason: entry.reason,
      evidenceLevel: entry.evidenceLevel,
      evidenceFileId: entry.evidenceFileId,
      evidenceSha256: entry.evidenceSha256,
      status: entry.status,
      fingerprint: entry.fingerprint,
      preparedByUserId: entry.preparedByUserId,
      submittedByUserId: entry.submittedByUserId,
      attestedByUserId: entry.attestedByUserId,
      confirmedByUserId: entry.confirmedByUserId,
      confirmedAt: entry.confirmedAt?.toISOString() ?? null,
      returnReason: entry.returnReason,
      replacements: entry.replacements.map((replacement) => ({
        operatingImpactEntryId: replacement.operatingImpactEntryId,
        amountCents: replacement.amountCents.toString()
      }))
    };
  }

  private async serializable<T>(work: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        if (attempt === 0 && isDatabaseSerializationFailure(error)) {
          continue;
        }
        if (isNecessaryExpenseReserveConcurrencyOrCapacityConflict(error)) {
          throw new ConflictException(
            necessaryExpenseReserveConflictMessage(error)
          );
        }
        throw error;
      }
    }
    throw new ConflictException("必要准备并发冲突，请刷新后重试");
  }
}

function isNecessaryExpenseReserveConcurrencyOrCapacityConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  const message = `${String(record.message ?? "")} ${String(record.meta?.message ?? "")}`;
  return record.code === "P2034" ||
    record.code === "40001" ||
    record.code === "40P01" ||
    record.code === "23514" ||
    record.meta?.code === "40001" ||
    record.meta?.code === "40P01" ||
    record.meta?.code === "23514" ||
    message.includes("POL-279") ||
    message.includes("40001") ||
    message.includes("40P01") ||
    message.includes("23514") ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected");
}

function necessaryExpenseReserveConflictMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown;
      meta?: { message?: unknown };
    };
    const message = `${String(record.message ?? "")} ${String(record.meta?.message ?? "")}`;
    const remainingCapacityReason =
      "POL-279 release or reversal exceeds remaining reserve capacity";
    if (message.includes(remainingCapacityReason)) {
      return remainingCapacityReason;
    }
  }
  return "必要准备并发或容量校验冲突，请刷新后重试";
}

function isDatabaseSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  const message = `${String(record.message ?? "")} ${String(record.meta?.message ?? "")}`;
  return record.code === "P2034" ||
    record.code === "40001" ||
    record.code === "40P01" ||
    record.meta?.code === "40001" ||
    record.meta?.code === "40P01" ||
    message.includes("40001") ||
    message.includes("40P01") ||
    message.includes("could not serialize access") ||
    message.includes("deadlock detected");
}

function validateTransitionCommand(command: NecessaryExpenseReserveTransitionCommand) {
  requiredText(command.entryId, "必要准备分录不能为空");
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
    throw new BadRequestException("expectedRevision 必须是正整数");
  }
  if (!/^[0-9a-f]{64}$/u.test(command.expectedFingerprint)) {
    throw new BadRequestException("expectedFingerprint 必须是 SHA-256");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.idempotencyKey)) {
    throw new BadRequestException("幂等键必须使用 UUIDv4");
  }
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}
