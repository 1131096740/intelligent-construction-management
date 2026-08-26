import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  Prisma,
  type ClearingCase,
  type ClearingEvidenceAttestation,
  type ClearingEvent,
  type ClearingEventVersion
} from "@prisma/client";
import {
  canPerform,
  isClearingCategory,
  isClearingEventKind,
  type BusinessAction,
  type ClearingCategory,
  type ClearingEventKind,
  type EvidenceLevel
} from "@jiangkong/shared-domain";

import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingFactEntryKind,
  type OperatingImpactInput,
  type OperatingLedgerTransaction
} from "../operating-ledger/operating-ledger.service";
import {
  assertClearingActorsDisjoint,
  buildClearingConfirmationPlan,
  fingerprintClearingCommand,
  type ClearingAllocationInput,
  type ClearingConfirmationPlan
} from "./clearing-domain";
import type {
  AttestClearingEventDto,
  ClearingCommandDto,
  ConfirmClearingEventDto,
  CreateClearingCaseDto,
  CreateClearingEventDto,
  ReopenClearingEventDto,
  ReturnClearingEventDto,
  SubmitClearingEventDto
} from "./clearing.dto";

type Tx = Prisma.TransactionClient;
type ActorIdentity = {
  actualUserId: string;
  delegatorUserId: string | null;
  actorIds: string[];
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLEARING_SOURCE_TYPE = "clearing_event_version";
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

@Injectable()
export class ClearingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly ledger: OperatingLedgerService,
    private readonly audit: AuditService
  ) {}

  async capabilities(actorUserId: string) {
    const roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    const actionAllowed = (action: BusinessAction) => canPerform(action, roles);
    const availableActions = ([
      "clearing.read",
      "clearing.prepare",
      "clearing.submit",
      "clearing.attest",
      "clearing.confirm",
      "clearing.return",
      "clearing.reopen"
    ] satisfies BusinessAction[]).filter(actionAllowed);
    return {
      availableActions,
      read: actionAllowed("clearing.read"),
      prepare: actionAllowed("clearing.prepare"),
      submit: actionAllowed("clearing.submit"),
      attest: actionAllowed("clearing.attest"),
      confirm: actionAllowed("clearing.confirm"),
      return: actionAllowed("clearing.return"),
      reopen: actionAllowed("clearing.reopen")
    };
  }

  async list(actorUserId: string, projectId?: string) {
    await this.assertDirectAction(actorUserId, "clearing.read");
    const rows = await this.prisma.clearingCase.findMany({
      where: projectId ? { projectId: requiredText(projectId, "项目不能为空") } : undefined,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            versions: {
              orderBy: { versionNo: "desc" },
              take: 1,
              include: { attestation: true }
            }
          }
        }
      }
    });
    return rows.map(jsonSafe);
  }

  async detail(actorUserId: string, caseId: string) {
    await this.assertDirectAction(actorUserId, "clearing.read");
    const row = await this.prisma.clearingCase.findUnique({
      where: { id: requiredText(caseId, "清算事项不能为空") },
      include: {
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            versions: {
              orderBy: { versionNo: "asc" },
              include: {
                attestation: true,
                confirmation: true,
                allocations: true,
                impactLinks: true
              }
            }
          }
        }
      }
    });
    if (!row) throw new NotFoundException("清算事项不存在，请刷新后重试");
    return jsonSafe(row);
  }

  async createCase(actorUserId: string, input: CreateClearingCaseDto) {
    validateCaseInput(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.prepare",
      "clearing_project",
      input.projectId
    );
    const fingerprint = commandFingerprint("clearing.case.create", "new", input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const assignment = await tx.projectAffiliateAssignment.findFirst({
        where: {
          id: input.constructionEnterpriseAssignmentId,
          projectId: input.projectId,
          endedAt: null
        },
        select: { id: true }
      });
      if (!assignment) throw new BadRequestException("施工企业档案不存在、已失效或不属于当前项目");
      await this.revalidateIdentity(
        identity,
        "clearing.prepare",
        "clearing_project",
        input.projectId
      );
      const id = randomUUID();
      const row = await tx.clearingCase.create({
        data: {
          id,
          projectId: input.projectId,
          constructionEnterpriseAssignmentId: input.constructionEnterpriseAssignmentId,
          category: input.category,
          governedSubjectKey: requiredText(input.governedSubjectKey, "受控事项键不能为空"),
          authoritativeGrossCapCents: positiveCents(input.authoritativeGrossCapCents),
          createdByUserId: identity.actualUserId
        }
      });
      const result = jsonSafe(row);
      await this.receipt(tx, input, "clearing.case.create", id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.case.create",
        businessType: "clearing_case",
        businessId: id,
        metadata: auditMetadata(identity, input.expectedRevision)
      });
      return result;
    });
  }

  async createEvent(actorUserId: string, caseId: string, input: CreateClearingEventDto) {
    validateEventInput(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.prepare",
      "clearing_case",
      caseId
    );
    const fingerprint = commandFingerprint("clearing.event.prepare", caseId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const clearingCase = await this.lockCase(tx, caseId);
      assertRevision(clearingCase.revision, input.expectedRevision);
      await this.revalidateIdentity(
        identity,
        "clearing.prepare",
        "clearing_case",
        caseId
      );
      const eventId = randomUUID();
      const versionId = randomUUID();
      const event = await tx.clearingEvent.create({
        data: {
          id: eventId,
          clearingCaseId: clearingCase.id,
          kind: input.kind,
          workflowStatus: "draft",
          revision: 1,
          currentVersionNo: 1,
          createdByUserId: identity.actualUserId
        }
      });
      await tx.clearingEventVersion.create({
        data: {
          id: versionId,
          clearingEventId: eventId,
          clearingCaseId: clearingCase.id,
          versionNo: 1,
          workflowStatus: "draft",
          amountCents: positiveCents(input.amountCents),
          payableRef: optionalText(input.payableRef),
          evidenceLevel: input.evidenceLevel,
          payloadSnapshot: jsonObject(input.payload),
          actorSetSnapshot: identity.actorIds,
          fingerprint,
          createdByUserId: identity.actualUserId
        }
      });
      await tx.clearingCase.update({
        where: { id: clearingCase.id },
        data: { revision: { increment: 1 } }
      });
      const result = { id: event.id, versionId, revision: 1, workflowStatus: "draft" };
      await this.receipt(tx, input, "clearing.event.prepare", event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.event.prepare",
        businessType: "clearing_event",
        businessId: event.id,
        metadata: auditMetadata(identity, input.expectedRevision)
      });
      return result;
    });
  }

  async submitEvent(actorUserId: string, eventId: string, input: SubmitClearingEventDto) {
    validateCommand(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.submit",
      "clearing_event",
      eventId
    );
    const fingerprint = commandFingerprint("clearing.event.submit", eventId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const event = await this.lockEvent(tx, eventId);
      assertRevision(event.revision, input.expectedRevision);
      if (event.workflowStatus !== "draft") {
        throw new ConflictException("只有草稿事件可以提交；已退回事件必须先显式重开");
      }
      await this.revalidateIdentity(
        identity,
        "clearing.submit",
        "clearing_event",
        eventId
      );
      const current = await this.currentVersion(tx, event);
      const nextVersionNo = event.currentVersionNo + 1;
      const versionId = randomUUID();
      await tx.clearingEventVersion.create({
        data: {
          id: versionId,
          clearingEventId: event.id,
          clearingCaseId: event.clearingCaseId,
          versionNo: nextVersionNo,
          workflowStatus: "submitted",
          amountCents: current.amountCents,
          currencyCode: current.currencyCode,
          payableRef: current.payableRef,
          evidenceLevel: current.evidenceLevel,
          payloadSnapshot: jsonInput(current.payloadSnapshot),
          actorSetSnapshot: mergeActorIds(actorIds(current.actorSetSnapshot), identity.actorIds),
          fingerprint,
          previousVersionId: current.id,
          createdByUserId: identity.actualUserId
        }
      });
      const updated = await tx.clearingEvent.update({
        where: { id: event.id },
        data: {
          workflowStatus: "submitted",
          revision: { increment: 1 },
          currentVersionNo: nextVersionNo
        }
      });
      await tx.clearingCase.update({ where: { id: event.clearingCaseId }, data: { revision: { increment: 1 } } });
      const result = { id: event.id, versionId, revision: updated.revision, workflowStatus: "submitted" };
      await this.receipt(tx, input, "clearing.event.submit", event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.event.submit",
        businessType: "clearing_event",
        businessId: event.id,
        metadata: auditMetadata(identity, input.expectedRevision)
      });
      return result;
    });
  }

  async attestEvent(actorUserId: string, eventId: string, input: AttestClearingEventDto) {
    validateCommand(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.attest",
      "clearing_event",
      eventId
    );
    const fingerprint = commandFingerprint("clearing.event.attest", eventId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const event = await this.lockEvent(tx, eventId);
      assertRevision(event.revision, input.expectedRevision);
      if (event.workflowStatus !== "submitted") {
        throw new ConflictException("只有已提交的 B 级证据可以实名 attest");
      }
      const version = await this.currentVersion(tx, event);
      if (version.workflowStatus !== "submitted" || version.evidenceLevel !== "B") {
        throw new BadRequestException("只有当前 B 级已提交版本可以实名 attest");
      }
      await this.revalidateIdentity(
        identity,
        "clearing.attest",
        "clearing_event",
        eventId
      );
      const existing = await tx.clearingEvidenceAttestation.findUnique({
        where: { eventVersionId: version.id }
      });
      if (existing) throw new ConflictException("当前 B 级版本已经完成实名 attest");
      await tx.clearingEvidenceAttestation.create({
        data: {
          eventVersionId: version.id,
          attestedByUserId: identity.actualUserId,
          attesterActorSetSnapshot: identity.actorIds
        }
      });
      const updated = await tx.clearingEvent.update({
        where: { id: event.id },
        data: { revision: { increment: 1 } }
      });
      await tx.clearingCase.update({
        where: { id: event.clearingCaseId },
        data: { revision: { increment: 1 } }
      });
      const result = {
        id: event.id,
        versionId: version.id,
        revision: updated.revision,
        workflowStatus: "submitted",
        attested: true
      };
      await this.receipt(tx, input, "clearing.event.attest", event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.event.attest",
        businessType: "clearing_event",
        businessId: event.id,
        metadata: auditMetadata(identity, input.expectedRevision)
      });
      return result;
    });
  }

  async reviseEvent(actorUserId: string, eventId: string, input: CreateClearingEventDto) {
    validateEventInput(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.prepare",
      "clearing_event",
      eventId
    );
    const fingerprint = commandFingerprint("clearing.event.revise", eventId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const event = await this.lockEvent(tx, eventId);
      assertRevision(event.revision, input.expectedRevision);
      if (event.workflowStatus !== "draft") {
        throw new ConflictException("只有草稿事件可以修订；已退回事件必须先显式重开");
      }
      if (event.kind !== input.kind) throw new BadRequestException("清分事件类型冻结后不能修改");
      await this.revalidateIdentity(
        identity,
        "clearing.prepare",
        "clearing_event",
        eventId
      );
      const current = await this.currentVersion(tx, event);
      const nextVersionNo = event.currentVersionNo + 1;
      const versionId = randomUUID();
      await tx.clearingEventVersion.create({
        data: {
          id: versionId,
          clearingEventId: event.id,
          clearingCaseId: event.clearingCaseId,
          versionNo: nextVersionNo,
          workflowStatus: "draft",
          amountCents: positiveCents(input.amountCents),
          payableRef: optionalText(input.payableRef),
          evidenceLevel: input.evidenceLevel,
          payloadSnapshot: jsonObject(input.payload),
          actorSetSnapshot: mergeActorIds(actorIds(current.actorSetSnapshot), identity.actorIds),
          fingerprint,
          previousVersionId: current.id,
          createdByUserId: identity.actualUserId
        }
      });
      const updated = await tx.clearingEvent.update({
        where: { id: event.id },
        data: {
          workflowStatus: "draft",
          revision: { increment: 1 },
          currentVersionNo: nextVersionNo
        }
      });
      await tx.clearingCase.update({ where: { id: event.clearingCaseId }, data: { revision: { increment: 1 } } });
      const result = { id: event.id, versionId, revision: updated.revision, workflowStatus: "draft" };
      await this.receipt(tx, input, "clearing.event.revise", event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.event.revise",
        businessType: "clearing_event",
        businessId: event.id,
        metadata: auditMetadata(identity, input.expectedRevision)
      });
      return result;
    });
  }

  async confirmEvent(actorUserId: string, eventId: string, input: ConfirmClearingEventDto) {
    validateCommand(input);
    validateAllocationInputs(input.allocations);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      "clearing.confirm",
      "clearing_event",
      eventId
    );
    const fingerprint = commandFingerprint("clearing.event.confirm", eventId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const event = await this.lockEvent(tx, eventId);
      assertRevision(event.revision, input.expectedRevision);
      if (event.workflowStatus !== "submitted") throw new ConflictException("只有已提交事件可以确认");
      const version = await this.currentVersion(tx, event);
      if (version.workflowStatus !== "submitted") throw new ConflictException("当前事件版本不是已提交版本");
      let attestation: ClearingEvidenceAttestation | null = null;
      if (version.evidenceLevel === "B") {
        attestation = await tx.clearingEvidenceAttestation.findUnique({
          where: { eventVersionId: version.id }
        });
        if (!attestation) {
          throw new BadRequestException(
            "B级证据缺少独立实名 attest，不允许直接确认"
          );
        }
        assertClearingActorsDisjoint(
          actorIds(attestation.attesterActorSetSnapshot),
          identity.actorIds
        );
      }
      assertClearingActorsDisjoint(actorIds(version.actorSetSnapshot), identity.actorIds);
      const clearingCase = await this.lockCase(tx, event.clearingCaseId);
      await this.revalidateIdentity(
        identity,
        "clearing.confirm",
        "clearing_event",
        eventId
      );

      if (event.kind === "pending_reconciliation") {
        await this.ensurePendingHasWithheld(
          tx,
          clearingCase,
          event,
          version,
          input,
          identity,
          attestation
        );
      }

      const confirmedAgainstCapCents = await this.confirmedAgainstCap(tx, clearingCase.id);
      const allocations = await this.allocationInputs(tx, clearingCase, event.kind as ClearingEventKind, input);
      const plan = buildClearingConfirmationPlan({
        kind: event.kind as ClearingEventKind,
        amountCents: version.amountCents,
        authoritativeGrossCapCents: clearingCase.authoritativeGrossCapCents,
        confirmedAgainstCapCents,
        category: clearingCase.category as never,
        allocations
      });
      await this.persistConfirmation(tx, clearingCase, event, version, plan, identity);
      const updated = await tx.clearingEvent.update({
        where: { id: event.id },
        data: { workflowStatus: "confirmed", revision: { increment: 1 } }
      });
      await tx.clearingCase.update({ where: { id: clearingCase.id }, data: { revision: { increment: 1 } } });
      const result = { id: event.id, versionId: version.id, revision: updated.revision, workflowStatus: "confirmed" };
      await this.receipt(tx, input, "clearing.event.confirm", event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "clearing.event.confirm",
        businessType: "clearing_event",
        businessId: event.id,
        metadata: auditMetadata(identity, input.expectedRevision, plan)
      });
      return result;
    });
  }

  async returnEvent(actorUserId: string, eventId: string, input: ReturnClearingEventDto) {
    requiredText(input.reason, "退回原因不能为空");
    return this.workflowCommand(actorUserId, eventId, input, "clearing.return", "returned", "clearing.event.return");
  }

  async reopenEvent(actorUserId: string, eventId: string, input: ReopenClearingEventDto) {
    requiredText(input.reason, "重开原因不能为空");
    return this.workflowCommand(actorUserId, eventId, input, "clearing.reopen", "draft", "clearing.event.reopen");
  }

  private async workflowCommand(
    actorUserId: string,
    eventId: string,
    input: ReturnClearingEventDto | ReopenClearingEventDto,
    action: BusinessAction,
    targetStatus: "returned" | "draft",
    auditAction: string
  ) {
    validateCommand(input);
    const identity = await this.resolveIdentity(
      actorUserId,
      input.delegatorUserId,
      action,
      "clearing_event",
      eventId
    );
    const fingerprint = commandFingerprint(auditAction, eventId, input, identity);
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const event = await this.lockEvent(tx, eventId);
      assertRevision(event.revision, input.expectedRevision);
      if (targetStatus === "returned" && event.workflowStatus !== "submitted") {
        throw new ConflictException("只有已提交事件可以退回");
      }
      if (targetStatus === "draft" && event.workflowStatus !== "returned") {
        throw new ConflictException("只有已退回事件可以重开");
      }
      await this.revalidateIdentity(identity, action, "clearing_event", eventId);
      const updated = await tx.clearingEvent.update({
        where: { id: event.id },
        data: { workflowStatus: targetStatus, revision: { increment: 1 } }
      });
      await tx.clearingCase.update({ where: { id: event.clearingCaseId }, data: { revision: { increment: 1 } } });
      const result = { id: event.id, revision: updated.revision, workflowStatus: targetStatus };
      await this.receipt(tx, input, auditAction, event.id, fingerprint, identity, result);
      await this.audit.record(tx, {
        actorUserId,
        action: auditAction,
        businessType: "clearing_event",
        businessId: event.id,
        metadata: { ...auditMetadata(identity, input.expectedRevision), reason: requiredText(input.reason, "原因不能为空") }
      });
      return result;
    });
  }

  private async persistConfirmation(
    tx: Tx,
    clearingCase: ClearingCase,
    event: ClearingEvent,
    version: ClearingEventVersion,
    plan: ClearingConfirmationPlan,
    identity: ActorIdentity
  ) {
    await tx.clearingConfirmation.create({
      data: {
        eventVersionId: version.id,
        confirmedByUserId: identity.actualUserId,
        confirmerActorSetSnapshot: identity.actorIds
      }
    });
    for (const allocation of plan.allocations) {
      await tx.clearingAllocation.create({
        data: {
          eventVersionId: version.id,
          sourceEventVersionId: allocation.sourceEventVersionId,
          sourceKind: allocation.sourceKind,
          amountCents: allocation.amountCents,
          sourceRemainingAfterCents: allocation.sourceRemainingAfterCents
        }
      });
    }
    if (!plan.impacts.length) return;

    if (event.kind === "returned") {
      for (const [index, allocation] of plan.allocations.entries()) {
        if (!allocation.sourceEventVersionId) continue;
        const sourceLinks = await tx.clearingImpactLink.findMany({
          where: { eventVersionId: allocation.sourceEventVersionId },
          orderBy: { sourceImpactKey: "asc" }
        });
        if (!sourceLinks.length) throw new ConflictException("退回来源缺少正式经营账投影");
        const sourceFactIds = new Set(sourceLinks.map((link) => link.operatingFactId));
        if (sourceFactIds.size !== 1) {
          throw new ConflictException("退回来源经营账投影损坏，请停止操作并复核数据");
        }
        const partialPlan = buildClearingConfirmationPlan({
          kind: "returned",
          amountCents: allocation.amountCents,
          authoritativeGrossCapCents: clearingCase.authoritativeGrossCapCents,
          confirmedAgainstCapCents: 0n,
          category: requiredClearingCategory(clearingCase.category),
          allocations: [allocation]
        });
        await this.appendLedger(tx, clearingCase, event, version, partialPlan, identity, {
          suffix: `return-${index + 1}`,
          adjustsFactId: sourceLinks[0]!.operatingFactId,
          entryKind: "correction",
          reversesImpactIds: reverseImpactIds(partialPlan, sourceLinks)
        });
      }
      return;
    }
    await this.appendLedger(tx, clearingCase, event, version, plan, identity);
  }

  private async appendLedger(
    tx: Tx,
    clearingCase: ClearingCase,
    event: ClearingEvent,
    version: ClearingEventVersion,
    plan: ClearingConfirmationPlan,
    identity: ActorIdentity,
    adjustment?: {
      suffix: string;
      adjustsFactId: string;
      entryKind: OperatingFactEntryKind;
      reversesImpactIds: Readonly<Record<string, string>>;
    }
  ) {
    const occurredAt = new Date();
    const [project, assignment] = await Promise.all([
      tx.project.findUnique({ where: { id: clearingCase.projectId }, select: { operatingLedgerEffectiveDate: true } }),
      tx.projectAffiliateAssignment.findFirst({
        where: {
          id: clearingCase.constructionEnterpriseAssignmentId,
          projectId: clearingCase.projectId,
          effectiveFrom: { lte: occurredAt },
          OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
        }
      })
    ]);
    if (!project?.operatingLedgerEffectiveDate) throw new BadRequestException("项目尚未启用经营账");
    if (!assignment) throw new BadRequestException("当前施工企业档案已失效");
    const suffix = adjustment?.suffix ?? "original";
    if (
      adjustment &&
      plan.impacts.some((impact) => !adjustment.reversesImpactIds[impact.sourceImpactKey])
    ) {
      throw new ConflictException("退回来源影响链不完整，请停止操作并复核数据");
    }
    const sourceBusinessId = suffix === "original" ? version.id : `${version.id}:${suffix}`;
    const constructionEnterprise = { kind: "construction_enterprise" as const, id: assignment.businessPartyId };
    const impacts: OperatingImpactInput[] = plan.impacts.map((impact) => ({
      idempotencyKey: `${CLEARING_SOURCE_TYPE}:${sourceBusinessId}:${impact.sourceImpactKey}`,
      sourceImpactKey: impact.sourceImpactKey,
      impactKind: impact.impactKind,
      amountCents: impact.amountCents,
      direction: impact.direction,
      subjectRole: "cost_bearing_company",
      subject: constructionEnterprise,
      costCategoryCode: impact.costCategoryCode,
      description: `清分事项 ${clearingCase.governedSubjectKey}`,
      impactSnapshot: {
        clearingCaseId: clearingCase.id,
        clearingEventId: event.id,
        clearingEventVersionId: version.id,
        category: clearingCase.category,
        kind: event.kind,
        sourceImpactKey: impact.sourceImpactKey
      }
    }));
    const input: AppendOperatingFactInput = {
      projectId: clearingCase.projectId,
      sourceType: CLEARING_SOURCE_TYPE,
      sourceBusinessId,
      sourceBusinessCode: `CLR-${event.id.slice(0, 8)}-V${version.versionNo}`,
      sourceVersion: version.versionNo,
      idempotencyKey: `${CLEARING_SOURCE_TYPE}:${sourceBusinessId}`,
      occurredAt,
      confirmedAt: occurredAt,
      confirmedByUserId: identity.actualUserId,
      factKind: "construction_enterprise_deduction",
      operatingLevel: "construction_enterprise",
      evidenceLevel: requiredEvidenceLevel(version.evidenceLevel),
      amountCents: impacts.reduce((maximum, impact) => impact.amountCents > maximum ? impact.amountCents : maximum, 0n),
      currencyCode: "CNY",
      direction: "neutral",
      isBeforeOperatingLedgerEffectiveDate: occurredAt < project.operatingLedgerEffectiveDate,
      affiliateAssignmentId: assignment.id,
      affiliateBusinessPartyVersionId: assignment.businessPartyVersionId,
      affiliateNameSnapshot: assignment.affiliateNameSnapshot,
      affiliateCreditCodeSnapshot: assignment.affiliateCreditCodeSnapshot ?? undefined,
      sourceSnapshot: {
        clearingCaseId: clearingCase.id,
        clearingEventId: event.id,
        clearingEventVersionId: version.id,
        kind: event.kind,
        workflowStatus: "confirmed",
        amountCents: version.amountCents.toString(),
        category: clearingCase.category,
        governedSubjectKey: clearingCase.governedSubjectKey,
        payload: version.payloadSnapshot,
        actorSet: identity.actorIds,
        impacts: impacts.map((impact) => ({
          sourceImpactKey: impact.sourceImpactKey,
          impactKind: impact.impactKind,
          amountCents: impact.amountCents.toString(),
          direction: impact.direction
        }))
      } as Prisma.InputJsonObject,
      subjects: { costBearingCompany: constructionEnterprise },
      impacts,
      ...(adjustment ? { adjustsFactId: adjustment.adjustsFactId } : {})
    };
    const result = await this.ledger.appendConfirmedSourceInTransaction(
      tx as OperatingLedgerTransaction,
      input,
      identity.actualUserId,
      adjustment?.entryKind ?? "original"
    );
    for (const [index, impact] of impacts.entries()) {
      const impactId = result.impactIds[index];
      if (!impactId) throw new Error("经营账投影未返回完整影响分录");
      await tx.clearingImpactLink.create({
        data: {
          eventVersionId: version.id,
          operatingFactId: result.id,
          operatingImpactId: impactId,
          sourceImpactKey: `${suffix}:${impact.sourceImpactKey}`,
          amountCents: impact.amountCents,
          reversesImpactId: adjustment?.reversesImpactIds[impact.sourceImpactKey]
        }
      });
    }
  }

  private async ensurePendingHasWithheld(
    tx: Tx,
    clearingCase: ClearingCase,
    event: ClearingEvent,
    version: ClearingEventVersion,
    input: ConfirmClearingEventDto,
    identity: ActorIdentity,
    attestation: ClearingEvidenceAttestation | null
  ) {
    const rows = await tx.$queryRaw<Array<{ remaining: bigint }>>(Prisma.sql`
      SELECT
        (COALESCE((
          SELECT SUM(v."amountCents")
          FROM "ClearingEvent" e
          JOIN "ClearingEventVersion" v ON v."clearingEventId" = e.id
          JOIN "ClearingConfirmation" c ON c."eventVersionId" = v.id
          WHERE e."clearingCaseId" = ${clearingCase.id} AND e.kind = 'withheld'
        ), 0) -
        COALESCE((
          SELECT SUM(a."amountCents")
          FROM "ClearingAllocation" a
          JOIN "ClearingEventVersion" v ON v.id = a."sourceEventVersionId"
          JOIN "ClearingEvent" e ON e.id = v."clearingEventId"
          WHERE e."clearingCaseId" = ${clearingCase.id} AND e.kind = 'withheld'
        ), 0))::bigint AS remaining
    `);
    if ((rows[0]?.remaining ?? 0n) > 0n) return;
    const pairedAmount = input.pairedWithheldAmountCents
      ? positiveCents(input.pairedWithheldAmountCents)
      : 0n;
    if (pairedAmount !== version.amountCents) {
      throw new BadRequestException("无暂扣余额时，待核对事件必须在同一事务配对等额暂扣");
    }
    const pairedEvent = await tx.clearingEvent.create({
      data: {
        clearingCaseId: clearingCase.id,
        kind: "withheld",
        workflowStatus: "confirmed",
        revision: 1,
        currentVersionNo: 1,
        createdByUserId: version.createdByUserId
      }
    });
    const pairedVersion = await tx.clearingEventVersion.create({
      data: {
        clearingEventId: pairedEvent.id,
        clearingCaseId: clearingCase.id,
        versionNo: 1,
        workflowStatus: "submitted",
        amountCents: pairedAmount,
        evidenceLevel: version.evidenceLevel,
        payloadSnapshot: { pairedPendingEventId: event.id },
        actorSetSnapshot: actorIds(version.actorSetSnapshot),
        fingerprint: `${version.fingerprint}:paired-withheld`,
        createdByUserId: version.createdByUserId
      }
    });
    if (version.evidenceLevel === "B") {
      if (!attestation) {
        throw new ConflictException("B级配对暂扣缺少实名 attest 快照，请停止操作并复核数据");
      }
      await tx.clearingEvidenceAttestation.create({
        data: {
          eventVersionId: pairedVersion.id,
          attestedByUserId: attestation.attestedByUserId,
          attesterActorSetSnapshot: jsonInput(attestation.attesterActorSetSnapshot),
          attestedAt: attestation.attestedAt
        }
      });
    }
    assertClearingActorsDisjoint(actorIds(version.actorSetSnapshot), identity.actorIds);
    const plan = buildClearingConfirmationPlan({
      kind: "withheld",
      amountCents: pairedAmount,
      authoritativeGrossCapCents: clearingCase.authoritativeGrossCapCents,
      confirmedAgainstCapCents: 0n,
      category: requiredClearingCategory(clearingCase.category),
      allocations: []
    });
    await this.persistConfirmation(tx, clearingCase, pairedEvent, pairedVersion, plan, identity);
  }

  private async allocationInputs(
    tx: Tx,
    clearingCase: ClearingCase,
    kind: ClearingEventKind,
    input: ConfirmClearingEventDto
  ): Promise<ClearingAllocationInput[]> {
    const confirmedAgainstCapCents = await this.confirmedAgainstCap(tx, clearingCase.id);
    const output: ClearingAllocationInput[] = [];
    for (const allocation of input.allocations) {
      const amountCents = positiveCents(allocation.amountCents);
      if (allocation.sourceKind === "authority_cap") {
        if (allocation.sourceEventVersionId) throw new BadRequestException("权威额度不得引用来源版本");
        output.push({
          sourceEventVersionId: null,
          sourceKind: "authority_cap",
          amountCents,
          sourceRemainingCents: clearingCase.authoritativeGrossCapCents - confirmedAgainstCapCents
        });
        continue;
      }
      const sourceId = requiredText(allocation.sourceEventVersionId, "清算分配必须引用来源事件版本");
      const source = await tx.clearingEventVersion.findUnique({
        where: { id: sourceId },
        include: { clearingEvent: true, confirmation: true }
      });
      if (
        !source ||
        source.clearingCaseId !== clearingCase.id ||
        !source.confirmation ||
        source.clearingEvent.kind !== allocation.sourceKind
      ) {
        throw new BadRequestException("清算分配来源不存在、未确认或类型不一致");
      }
      const used = await tx.clearingAllocation.aggregate({
        where: { sourceEventVersionId: sourceId },
        _sum: { amountCents: true }
      });
      output.push({
        sourceEventVersionId: sourceId,
        sourceKind: allocation.sourceKind,
        amountCents,
        sourceRemainingCents: source.amountCents - (used._sum.amountCents ?? 0n)
      });
    }
    if (!["final_confirmed", "supplemental", "returned"].includes(kind) && output.length) {
      throw new BadRequestException("当前事件类型不接受金额分配");
    }
    return output;
  }

  private async confirmedAgainstCap(tx: Tx, caseId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(v."amountCents"), 0)::bigint AS total
      FROM "ClearingEvent" e
      JOIN "ClearingEventVersion" v ON v."clearingEventId" = e.id
      JOIN "ClearingConfirmation" c ON c."eventVersionId" = v.id
      WHERE e."clearingCaseId" = ${caseId}
        AND e.kind IN ('final_confirmed', 'supplemental')
    `);
    return rows[0]?.total ?? 0n;
  }

  private async resolveIdentity(
    actorUserId: string,
    rawDelegatorUserId: string | undefined,
    action: BusinessAction,
    resourceType: "clearing_project" | "clearing_case" | "clearing_event",
    resourceId: string
  ): Promise<ActorIdentity> {
    const directRoles = await this.roles.resolveActiveRoleScopes(actorUserId);
    const delegatorUserId = optionalText(rawDelegatorUserId);
    if (!delegatorUserId) {
      if (!canPerform(action, directRoles)) throw new ForbiddenException("当前公司岗位无权执行该清分动作");
      return { actualUserId: actorUserId, delegatorUserId: null, actorIds: [actorUserId] };
    }
    const active = await activeScopedApprovalDelegatorIds(this.prisma, actorUserId, {
      actionKey: action,
      resourceType,
      resourceId
    });
    if (!active.includes(delegatorUserId)) throw new ForbiddenException("指定委托不存在、已过期或超过一跳");
    const delegatedRoles = await this.roles.resolveActiveRoleScopes(delegatorUserId);
    if (!canPerform(action, delegatedRoles)) throw new ForbiddenException("委托人的公司岗位无权执行该清分动作");
    return { actualUserId: actorUserId, delegatorUserId, actorIds: [actorUserId, delegatorUserId] };
  }

  private async revalidateIdentity(
    identity: ActorIdentity,
    action: BusinessAction,
    resourceType: "clearing_project" | "clearing_case" | "clearing_event",
    resourceId: string
  ) {
    const refreshed = await this.resolveIdentity(
      identity.actualUserId,
      identity.delegatorUserId ?? undefined,
      action,
      resourceType,
      resourceId
    );
    if (refreshed.actorIds.join("|") !== identity.actorIds.join("|")) {
      throw new ConflictException("清分确认前权限或委托已变化，请刷新后重试");
    }
  }

  private async assertDirectAction(actorUserId: string, action: BusinessAction) {
    const roles = await this.roles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform(action, roles)) throw new ForbiddenException("当前公司岗位无权访问清分工作台");
  }

  private async lockCase(tx: Tx, caseId: string) {
    const id = requiredText(caseId, "清算事项不能为空");
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "ClearingCase" WHERE id = ${id} FOR UPDATE
    `);
    if (!locked.length) throw new NotFoundException("清算事项不存在，请刷新后重试");
    const row = await tx.clearingCase.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("清算事项不存在，请刷新后重试");
    return row;
  }

  private async lockEvent(tx: Tx, eventId: string) {
    const id = requiredText(eventId, "清算事件不能为空");
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "ClearingEvent" WHERE id = ${id} FOR UPDATE
    `);
    if (!locked.length) throw new NotFoundException("清算事件不存在，请刷新后重试");
    const row = await tx.clearingEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("清算事件不存在，请刷新后重试");
    return row;
  }

  private async currentVersion(tx: Tx, event: { id: string; currentVersionNo: number }) {
    const row = await tx.clearingEventVersion.findUnique({
      where: { clearingEventId_versionNo: { clearingEventId: event.id, versionNo: event.currentVersionNo } }
    });
    if (!row) throw new ConflictException("清算事件当前版本缺失，请停止操作并复核数据");
    return row;
  }

  private async replay(tx: Tx, idempotencyKey: string, fingerprint: string) {
    validateIdempotencyKey(idempotencyKey);
    const receipt = await tx.clearingCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw new ConflictException("同一幂等键不能用于不同清分请求");
    return receipt.resultSnapshot;
  }

  private receipt(
    tx: Tx,
    input: ClearingCommandDto,
    action: string,
    aggregateId: string,
    fingerprint: string,
    identity: ActorIdentity,
    result: unknown
  ) {
    return tx.clearingCommandReceipt.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        action,
        aggregateId,
        expectedRevision: input.expectedRevision,
        actorUserId: identity.actualUserId,
        delegatorUserId: identity.delegatorUserId,
        fingerprint,
        resultSnapshot: jsonValue(result)
      }
    });
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }
}

function validateCaseInput(input: CreateClearingCaseDto) {
  validateCommand(input);
  if (input.expectedRevision !== 0) {
    throw new ConflictException("新建清算事项的 expectedRevision 必须为 0");
  }
  requiredText(input.projectId, "项目不能为空");
  requiredText(input.constructionEnterpriseAssignmentId, "施工企业档案不能为空");
  if (!isClearingCategory(input.category)) throw new BadRequestException("清分分类不正确");
  requiredText(input.governedSubjectKey, "受控事项键不能为空");
  positiveCents(input.authoritativeGrossCapCents);
}

function validateEventInput(input: CreateClearingEventDto) {
  validateCommand(input);
  if (!isClearingEventKind(input.kind)) throw new BadRequestException("清分事件类型不正确");
  positiveCents(input.amountCents);
  if (!['A', 'B'].includes(input.evidenceLevel)) throw new BadRequestException("清分正式流程只接受 A/B 级证据");
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new BadRequestException("清分事件必须保留对象快照");
  }
}

function validateCommand(input: ClearingCommandDto) {
  validateIdempotencyKey(input.idempotencyKey);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new BadRequestException("expectedRevision 必须是非负整数");
  }
}

function validateAllocationInputs(value: unknown): void {
  const sourceKinds = new Set([
    "authority_cap",
    "withheld",
    "final_confirmed",
    "supplemental"
  ]);
  if (!Array.isArray(value)) {
    throw new BadRequestException("清算分配必须是数组");
  }
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BadRequestException("清算分配格式不正确");
    }
    const allocation = entry as Record<string, unknown>;
    if (
      !sourceKinds.has(String(allocation.sourceKind)) ||
      typeof allocation.amountCents !== "string" ||
      (allocation.sourceEventVersionId !== undefined &&
        typeof allocation.sourceEventVersionId !== "string")
    ) {
      throw new BadRequestException("清算分配格式不正确");
    }
  }
}

function validateIdempotencyKey(value: string) {
  if (!UUID_V4.test(value)) throw new BadRequestException("幂等键必须使用 UUIDv4");
}

function assertRevision(actual: number, expected: number) {
  if (actual !== expected) throw new ConflictException("清分事项版本已变化，请刷新后重试");
}

function positiveCents(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException("金额必须是正整数分字符串");
  }
  const cents = BigInt(value);
  if (cents > POSTGRES_BIGINT_MAX) {
    throw new BadRequestException("金额超过数据库整数分上限");
  }
  return cents;
}

function requiredText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("可选文本字段格式不正确");
  }
  const normalized = value.trim();
  return normalized || null;
}

function requiredClearingCategory(value: string): ClearingCategory {
  if (!isClearingCategory(value)) throw new ConflictException("清分事项分类损坏，请停止操作并复核数据");
  return value;
}

function requiredEvidenceLevel(value: string): EvidenceLevel {
  if (value !== "A" && value !== "B") {
    throw new ConflictException("清分证据等级损坏，请停止操作并复核数据");
  }
  return value;
}

function actorIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new ConflictException("冻结经办人集合损坏，请停止操作并复核数据");
  }
  return [...new Set(value as string[])];
}

function mergeActorIds(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

function reverseImpactIds(
  plan: ClearingConfirmationPlan,
  sourceLinks: ReadonlyArray<{ id: string; sourceImpactKey: string }>
): Readonly<Record<string, string>> {
  const sourceKeyByReturnKey: Readonly<Record<string, string>> = {
    "construction-enterprise-funds-release": "original:construction-enterprise-funds-freeze",
    "confirmed-cost-return": "original:confirmed-cost",
    "construction-enterprise-funds-return": "original:construction-enterprise-funds-decrease"
  };
  return Object.fromEntries(plan.impacts.map((impact) => {
    const sourceKey = sourceKeyByReturnKey[impact.sourceImpactKey];
    const sourceLink = sourceLinks.find((link) => link.sourceImpactKey === sourceKey);
    if (!sourceLink) {
      throw new ConflictException("退回来源缺少对应原影响，请停止操作并复核数据");
    }
    return [impact.sourceImpactKey, sourceLink.id];
  }));
}

function commandFingerprint(
  action: string,
  aggregateId: string,
  input: ClearingCommandDto,
  identity: ActorIdentity
) {
  return fingerprintClearingCommand({
    action,
    aggregateId,
    expectedRevision: input.expectedRevision,
    actorUserId: identity.actualUserId,
    delegatorUserId: identity.delegatorUserId,
    payload: input
  });
}

function auditMetadata(identity: ActorIdentity, expectedRevision: number, plan?: ClearingConfirmationPlan) {
  return {
    expectedRevision,
    actualUserId: identity.actualUserId,
    delegatorUserId: identity.delegatorUserId,
    actorCount: identity.actorIds.length,
    ...(plan ? {
      allocationCount: plan.allocations.length,
      impactKinds: plan.impacts.map((impact) => impact.impactKind)
    } : {})
  } as Prisma.InputJsonObject;
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function jsonInput(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) throw new ConflictException("冻结清分快照不能为空");
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry)) as Prisma.InputJsonValue;
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry)) as T;
}
