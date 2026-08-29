import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  GLOBAL_USER_POSITION_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { derivePayableSettlementBalance } from "../payable-registry/payable-registry.domain";
import {
  deriveEffectiveWagePayableAmount,
  payableSourceAdapterRegistry
} from "../payable-registry/wage-payable-source.adapter";
import type { RegisteredPayable } from "../payable-registry/wage-payable-source.adapter";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingImpactInput
} from "../operating-ledger/operating-ledger.service";
import {
  assertFundMovementAmountConservation,
  assertFundMovementFundingComposition,
  assertFundMovementLegSet,
  assertFundMovementPurpose,
  type FundMovementDirection,
  type FundMovementKind,
  type FundMovementLegRole
} from "./fund-movement.domain";

export interface FundMovementLegInput {
  role: FundMovementLegRole;
  projectId: string;
  companyEntityId: string;
  direction: FundMovementDirection;
  amountCents: bigint;
  counterpartyProjectId?: string;
  counterpartyCompanyEntityId?: string;
  sourceType?: string;
  sourceAggregateId?: string;
  sourceAllocationCount?: number;
  sourceAllocationAmountCents?: bigint;
  contractId?: string;
  contractVersionId?: string;
  sourceSnapshot: Record<string, unknown>;
}

export interface CreateFundMovementInput {
  kind: FundMovementKind;
  paymentExecutionId?: string;
  sourceProjectId: string;
  beneficiaryProjectId: string;
  sourceCompanyEntityId: string;
  beneficiaryCompanyEntityId: string;
  paymentAmountCents: bigint;
  projectFundUsedCents: bigint;
  companyAdvanceCents: bigint;
  profitAuthorizationId?: string;
  adjustsRelationshipEntryId?: string;
  legs: readonly FundMovementLegInput[];
  idempotencyKey: string;
}

export interface FundMovementCommandInput {
  movementId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

type MovementLegRow = Prisma.FundMovementLegGetPayload<Prisma.FundMovementLegDefaultArgs>;
type MovementRow = Prisma.FundMovementGetPayload<Prisma.FundMovementDefaultArgs> & {
  legs?: MovementLegRow[];
  relationshipEntries?: Prisma.FundMovementRelationshipEntryGetPayload<Prisma.FundMovementRelationshipEntryDefaultArgs>[];
};

type MovementScope = Pick<MovementRow,
  | "id"
  | "kind"
  | "status"
  | "revision"
  | "paymentExecutionId"
  | "sourceProjectId"
  | "beneficiaryProjectId"
  | "sourceCompanyEntityId"
  | "beneficiaryCompanyEntityId"
  | "paymentAmountCents"
  | "projectFundUsedCents"
  | "companyAdvanceCents"
  | "createdByUserId"
  | "submittedByUserId"
>;

type LockedPaymentExecution = {
  id: string;
  amountCents: bigint;
  paymentRequestId: string;
  settlementId: string | null;
  paymentSubjectType: string;
  companyEntityIdSnapshot: string;
  executedByUserId: string;
  paidAt: Date;
  payerAttestationFingerprint: string | null;
};

type PaymentExecutionSourceAllocation = {
  allocationType: string;
  sourceRowId: string;
  settlementId: string | null;
  contractVersionId: string | null;
  paymentTermsVersionId: string;
  sourcePayableAmountCents: bigint;
  amountCents: bigint;
};

type PaymentExecutionPayableContext = {
  settlementCaseId: string;
  caseRevision: number;
  allocationIds: readonly string[];
  payableRefs: readonly string[];
  amountCents: bigint;
  beneficiaryProjectId: string;
  debtorCompanyIds: readonly string[];
  proxyRelationshipId: string | null;
};

type PaymentExecutionApprovalContext = {
  approvalInstanceId: string;
  approvalRevision: string;
  approvedByUserId: string | null;
  representedUserId: string | null;
  approvedRoleKey: string | null;
};

type ActiveFundMovementDelegation = {
  fromUserId: string;
  toUserId: string;
};

type PaymentExecutionContext = {
  execution: LockedPaymentExecution;
  request: {
    id: string;
    projectId: string;
    contractId: string;
    contractVersionId: string;
    paymentTermsVersionId: string;
    sourceType: string;
    status: string;
    settlementId: string | null;
    abandonedAt: Date | null;
    paidAmountCents: bigint;
  };
  approval: PaymentExecutionApprovalContext;
  approvedPayerCompanyId: string;
  payerCompanyEntityId: string;
  source: {
    sourceType: string;
    sourceAggregateId: string;
    allowedAggregateIds: readonly string[];
    sourceAllocationCount: number;
    sourceAllocationAmountCents: bigint;
    contractId: string;
    contractVersionId: string;
    allocations: readonly PaymentExecutionSourceAllocation[];
    sourceSnapshot: Record<string, unknown>;
  };
  payable: PaymentExecutionPayableContext;
};

function requiredText(value: string | undefined, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException(message);
  }
  return value.trim();
}

function requiredApprovalText(value: string | null | undefined, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConflictException(message);
  }
  return value.trim();
}

function optionalApprovalIdentity(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConflictException("付款申请审批动作包含无效的被代表身份");
  }
  return value.trim();
}

function requiredUuid(value: string): string {
  const normalized = requiredText(value, "幂等键不能为空");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)) {
    throw new BadRequestException("幂等键必须是 UUIDv4");
  }
  return normalized.toLowerCase();
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

function fingerprint(action: string, value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ action, value })))
    .digest("hex");
}

function jsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return canonical(value) as Prisma.InputJsonObject;
}

function safeAmount(value: bigint, message: string): bigint {
  if (value <= 0n) throw new BadRequestException(message);
  return value;
}

function sameDate(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function delegationIdentitySet(
  userId: string,
  delegations: readonly ActiveFundMovementDelegation[]
): Set<string> {
  const identities = new Set([userId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const delegation of delegations) {
      if (identities.has(delegation.fromUserId) && !identities.has(delegation.toUserId)) {
        identities.add(delegation.toUserId);
        changed = true;
      }
      if (identities.has(delegation.toUserId) && !identities.has(delegation.fromUserId)) {
        identities.add(delegation.fromUserId);
        changed = true;
      }
    }
  }
  return identities;
}

function identitySetsOverlap(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  for (const identity of left) {
    if (right.has(identity)) return true;
  }
  return false;
}

@Injectable()
export class FundMovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly audit: AuditService,
    private readonly ledger: OperatingLedgerService,
    private readonly funding: ProjectFundingAvailabilityService = new ProjectFundingAvailabilityService()
  ) {}

  async list(actorUserId: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const rows = await this.prisma.fundMovement.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        kind: true,
        status: true,
        revision: true,
        sourceProjectId: true,
        beneficiaryProjectId: true,
        sourceCompanyEntityId: true,
        beneficiaryCompanyEntityId: true,
        paymentAmountCents: true,
        projectFundUsedCents: true,
        companyAdvanceCents: true,
        createdAt: true,
        submittedAt: true,
        confirmedAt: true,
        legs: { select: { id: true, legNo: true, role: true, projectId: true, operatingFactId: true } }
      }
    });
    return rows.map((row) => ({
      ...row,
      paymentAmountCents: row.paymentAmountCents.toString(),
      projectFundUsedCents: row.projectFundUsedCents.toString(),
      companyAdvanceCents: row.companyAdvanceCents.toString(),
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null
    }));
  }

  async get(actorUserId: string, movementId: string) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const row = await this.prisma.fundMovement.findUnique({
      where: { id: requiredText(movementId, "资金移动标识不能为空") },
      include: {
        legs: { orderBy: { legNo: "asc" } },
        relationshipEntries: { orderBy: { createdAt: "asc" } }
      }
    });
    if (!row) throw new NotFoundException("资金移动不存在");
    return this.readModel(row);
  }

  async create(actorUserId: string, input: CreateFundMovementInput) {
    await this.assertGlobalFinanceWriter(actorUserId);
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    const sourceProjectId = requiredText(input.sourceProjectId, "来源项目不能为空");
    const beneficiaryProjectId = requiredText(input.beneficiaryProjectId, "受益项目不能为空");
    const sourceCompanyEntityId = requiredText(input.sourceCompanyEntityId, "来源公司不能为空");
    const beneficiaryCompanyEntityId = requiredText(input.beneficiaryCompanyEntityId, "受益公司不能为空");
    const paymentExecutionId = input.paymentExecutionId === undefined
      ? undefined
      : requiredText(input.paymentExecutionId, "实际付款标识不能为空");
    const adjustsRelationshipEntryId = input.adjustsRelationshipEntryId === undefined
      ? undefined
      : requiredText(input.adjustsRelationshipEntryId, "被调整往来标识不能为空");
    const reversalKind = input.kind === "temporary_project_fund_return" ||
      input.kind === "company_advance_recovery";
    if (reversalKind && !adjustsRelationshipEntryId) {
      throw new BadRequestException("归还或收回必须引用被调整往来");
    }
    if (!reversalKind && adjustsRelationshipEntryId) {
      throw new BadRequestException("只有归还或收回可以调整往来");
    }
    if (input.kind !== "cross_project_payment" && paymentExecutionId) {
      throw new BadRequestException("只有跨项目支付可以绑定既有实际付款");
    }
    const paymentAmountCents = safeAmount(input.paymentAmountCents, "资金移动金额必须大于零");
    const payload = {
      ...input,
      idempotencyKey,
      paymentExecutionId,
      sourceProjectId,
      beneficiaryProjectId,
      sourceCompanyEntityId,
      beneficiaryCompanyEntityId,
      paymentAmountCents,
      adjustsRelationshipEntryId,
      legs: input.legs
    };
    const payloadFingerprint = fingerprint("fund_movement.create", payload);

    assertFundMovementAmountConservation({
      paymentAmountCents,
      projectFundUsedCents: input.projectFundUsedCents,
      companyAdvanceCents: input.companyAdvanceCents
    });
    assertFundMovementFundingComposition({
      kind: input.kind,
      paymentAmountCents,
      projectFundUsedCents: input.projectFundUsedCents,
      companyAdvanceCents: input.companyAdvanceCents
    });
    if (input.kind === "profit_distribution_execution") {
      // #109 is the only authority for this operation.  It is still open, so
      // accepting a client-provided authorization id would be fail-open.
      throw new ConflictException("利润分配执行必须等待 #109 提供服务端生效授权");
    }
    assertFundMovementPurpose({
      kind: input.kind,
      sourceProjectId,
      beneficiaryProjectId,
      sourceCompanyId: sourceCompanyEntityId,
      beneficiaryCompanyId: beneficiaryCompanyEntityId,
      amountCents: paymentAmountCents
    });
    assertFundMovementLegSet({
      kind: input.kind,
      paymentAmountCents,
      sourceProjectId,
      beneficiaryProjectId,
      sourceCompanyId: sourceCompanyEntityId,
      beneficiaryCompanyId: beneficiaryCompanyEntityId,
      legs: input.legs
    });

    return this.serializable(() => this.prisma.$transaction(async (tx) => {
      await this.authorizeFundMovementWriteContext(tx, actorUserId);
      await this.lockIdempotency(tx, idempotencyKey);
      const transactionActorRoles = await this.assertGlobalFinanceWriterInTransaction(tx, actorUserId);
      const existing = await tx.fundMovementCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) {
          throw new ConflictException("幂等键已用于不同资金移动载荷");
        }
        return existing.responseSnapshot;
      }

      if (input.kind === "cross_project_payment") {
        const paymentExecutionId = requiredText(input.paymentExecutionId, "跨项目支付必须绑定实际付款");
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "PaymentExecution"
          WHERE "id" = ${paymentExecutionId}
          FOR UPDATE
        `);
        const execution = await tx.paymentExecution.findUnique({
          where: { id: paymentExecutionId },
          select: { id: true, amountCents: true }
        });
        if (!execution || BigInt(execution.amountCents) !== paymentAmountCents) {
          throw new ConflictException("跨项目支付的实际付款不存在或金额不一致");
        }
        const alreadyUsed = await tx.fundMovement.findFirst({
          where: { paymentExecutionId },
          select: { id: true }
        });
        if (alreadyUsed) throw new ConflictException("同一实际付款只能登记一条资金移动");
      }

      let originalRelationship: {
        id: string;
        entryKind: string;
        direction: string;
        status: string;
        sourceProjectId: string;
        beneficiaryProjectId: string;
        debtorCompanyEntityId: string;
        creditorCompanyEntityId: string;
        amountCents: bigint;
      } | null = null;
      if (adjustsRelationshipEntryId) {
        originalRelationship = await tx.fundMovementRelationshipEntry.findUnique({
          where: { id: adjustsRelationshipEntryId },
          select: {
            id: true,
            entryKind: true,
            direction: true,
            status: true,
            sourceProjectId: true,
            beneficiaryProjectId: true,
            debtorCompanyEntityId: true,
            creditorCompanyEntityId: true,
            amountCents: true
          }
        });
        const expectedEntryKind = input.kind === "temporary_project_fund_return"
          ? "temporary_project_fund_use"
          : "company_advance";
        if (
          !originalRelationship ||
          originalRelationship.status !== "confirmed" ||
          originalRelationship.direction !== "increase" ||
          originalRelationship.entryKind !== expectedEntryKind ||
          originalRelationship.sourceProjectId !== sourceProjectId ||
          originalRelationship.beneficiaryProjectId !== beneficiaryProjectId ||
          originalRelationship.debtorCompanyEntityId !== beneficiaryCompanyEntityId ||
          originalRelationship.creditorCompanyEntityId !== sourceCompanyEntityId
        ) {
          throw new ConflictException("被调整往来不存在、未确认或主体范围不一致");
        }
        const consumed = await tx.fundMovementRelationshipEntry.aggregate({
          where: { adjustsEntryId: originalRelationship.id, status: "confirmed", direction: "decrease" },
          _sum: { amountCents: true }
        });
        const consumedAmount = consumed._sum.amountCents ?? 0n;
        if (consumedAmount + paymentAmountCents > originalRelationship.amountCents) {
          throw new ConflictException("归还或收回金额超过未结往来余额");
        }
      }

      const movement = await tx.fundMovement.create({
        data: {
          id: randomUUID(),
          kind: input.kind,
          status: "draft",
          revision: 1,
          paymentExecutionId,
          sourceProjectId,
          beneficiaryProjectId,
          sourceCompanyEntityId,
          beneficiaryCompanyEntityId,
          paymentAmountCents,
          projectFundUsedCents: input.projectFundUsedCents,
          companyAdvanceCents: input.companyAdvanceCents,
          profitAuthorizationId: input.profitAuthorizationId,
          payloadFingerprint,
          idempotencyKey,
          createdByUserId: actorUserId
        },
        select: { id: true, revision: true, status: true }
      });

      const legRows: Array<{ id: string; role: FundMovementLegRole; projectId: string; companyEntityId: string }> = [];
      for (const [index, leg] of input.legs.entries()) {
        const legId = randomUUID();
        const legSourceSnapshot = {
          authority: "fund_movement_draft",
          status: "pending_server_resolution",
          movementId: movement.id,
          legId,
          role: leg.role,
          projectId: leg.projectId,
          companyEntityId: leg.companyEntityId,
          amountCents: leg.amountCents.toString(),
          sourceType: leg.sourceType ?? null,
          sourceAggregateId: leg.sourceAggregateId ?? null,
          sourceAllocationCount: leg.sourceAllocationCount ?? null,
          sourceAllocationAmountCents: leg.sourceAllocationAmountCents?.toString() ?? null,
          contractId: leg.contractId ?? null,
          contractVersionId: leg.contractVersionId ?? null
        };
        if ((leg.contractId && !leg.contractVersionId) || (!leg.contractId && leg.contractVersionId)) {
          throw new BadRequestException("合同及合同版本必须成对冻结");
        }
        const created = await tx.fundMovementLeg.create({
          data: {
            id: legId,
            movementId: movement.id,
            legNo: index + 1,
            role: leg.role,
            projectId: leg.projectId,
            companyEntityId: leg.companyEntityId,
            counterpartyProjectId: leg.counterpartyProjectId,
            counterpartyCompanyEntityId: leg.counterpartyCompanyEntityId,
            direction: leg.direction,
            amountCents: leg.amountCents,
            projectFundUsedCents: leg.role === "source" ? input.projectFundUsedCents : 0n,
            companyAdvanceCents: leg.role === "source" ? input.companyAdvanceCents : 0n,
            paymentExecutionId,
            sourceType: leg.sourceType,
            sourceAggregateId: leg.sourceAggregateId,
            sourceAllocationCount: leg.sourceAllocationCount,
            sourceAllocationAmountCents: leg.sourceAllocationAmountCents,
            contractId: leg.contractId,
            contractVersionId: leg.contractVersionId,
            sourceSnapshot: jsonObject(legSourceSnapshot),
            idempotencyKey: randomUUID(),
            createdByUserId: actorUserId
          },
          select: { id: true, role: true, projectId: true, companyEntityId: true }
        });
        legRows.push({
          ...created,
          role: created.role as FundMovementLegRole
        });
      }

      let relationshipId: string | null = null;
      if (input.kind !== "same_project_company_transfer") {
        const sourceLeg = legRows.find((leg) => leg.role === "source");
        const beneficiaryLeg = legRows.find((leg) => leg.role === "beneficiary");
        if (!sourceLeg || !beneficiaryLeg) throw new ConflictException("资金移动分腿不完整");
        const relationshipKind = input.kind === "cross_project_payment"
          ? "project_internal_receivable"
          : input.kind;
        const sourceInput = input.legs.find((leg) => leg.role === "source");
        if (!sourceInput) throw new ConflictException("资金移动来源腿缺失");
        const relationship = await tx.fundMovementRelationshipEntry.create({
          data: {
            id: randomUUID(),
            movementId: movement.id,
            legId: sourceLeg.id,
            entryKind: relationshipKind,
            direction: originalRelationship ? "decrease" : "increase",
            status: "draft",
            adjustsEntryId: originalRelationship?.id,
            sourceProjectId,
            beneficiaryProjectId,
            debtorCompanyEntityId: beneficiaryCompanyEntityId,
            creditorCompanyEntityId: sourceCompanyEntityId,
            sourceType: sourceInput.sourceType,
            sourceAggregateId: sourceInput.sourceAggregateId,
            sourceAllocationCount: sourceInput.sourceAllocationCount,
            sourceAllocationAmountCents: sourceInput.sourceAllocationAmountCents,
            contractId: sourceInput.contractId,
            contractVersionId: sourceInput.contractVersionId,
            amountCents: paymentAmountCents,
            sourceSnapshot: jsonObject({
              authority: "fund_movement_draft",
              status: "pending_server_resolution",
              movementId: movement.id,
              sourceLegId: sourceLeg.id,
              beneficiaryLegId: beneficiaryLeg.id,
              sourceProjectId,
              beneficiaryProjectId,
              sourceCompanyEntityId,
              beneficiaryCompanyEntityId,
              amountCents: paymentAmountCents.toString(),
              sourceType: sourceInput.sourceType ?? null,
              sourceAggregateId: sourceInput.sourceAggregateId ?? null,
              sourceAllocationCount: sourceInput.sourceAllocationCount ?? null,
              sourceAllocationAmountCents: sourceInput.sourceAllocationAmountCents?.toString() ?? null,
              contractId: sourceInput.contractId ?? null,
              contractVersionId: sourceInput.contractVersionId ?? null,
              adjustsEntryId: originalRelationship?.id ?? null
            }),
            payloadFingerprint: fingerprint("fund_movement.relationship", {
              movementId: movement.id,
              sourceLegId: sourceLeg.id,
              amountCents: paymentAmountCents
            }),
            idempotencyKey: randomUUID(),
            createdByUserId: actorUserId
          }
        });
        relationshipId = relationship.id;
        await tx.fundMovementLeg.update({
          where: { id: sourceLeg.id },
          data: { relationshipEntryId: relationship.id }
        });
      }

      const response = {
        movementId: movement.id,
        status: movement.status,
        revision: movement.revision
      };
      await tx.fundMovementCommandReceipt.create({
        data: {
          id: randomUUID(),
          idempotencyKey,
          payloadFingerprint,
          action: "create",
          movementId: movement.id,
          responseSnapshot: response
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "fund_movement.create",
        businessType: "fund_movement",
        businessId: movement.id,
        metadata: {
          kind: input.kind,
          status: "draft",
          roleKeys: transactionActorRoles,
          scope: {
            sourceProjectId,
            beneficiaryProjectId,
            sourceCompanyEntityId,
            beneficiaryCompanyEntityId
          },
          amounts: {
            paymentAmountCents: paymentAmountCents.toString(),
            projectFundUsedCents: input.projectFundUsedCents.toString(),
            companyAdvanceCents: input.companyAdvanceCents.toString()
          },
          paymentExecutionIdFingerprint: paymentExecutionId
            ? fingerprint("payment_execution", paymentExecutionId)
            : null,
          legFingerprints: legRows.map((leg) => fingerprint("fund_movement.leg", leg.id)),
          relationshipFingerprints: relationshipId
            ? [fingerprint("fund_movement.relationship", relationshipId)]
            : [],
          payloadFingerprint,
          idempotencyKeyFingerprint: fingerprint("idempotency", idempotencyKey)
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async submit(actorUserId: string, input: FundMovementCommandInput) {
    const movementId = requiredText(input.movementId, "资金移动标识不能为空");
    await this.assertGlobalFinanceWriter(actorUserId);
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    return this.serializable(() => this.prisma.$transaction(async (tx) => {
      await this.authorizeFundMovementWriteContext(tx, actorUserId);
      await this.lockIdempotency(tx, idempotencyKey);
      const transactionActorRoles = await this.assertGlobalFinanceWriterInTransaction(tx, actorUserId);
      const transactionIdentity = {
        roleKeys: transactionActorRoles,
        representedUserId: actorUserId,
        delegatorUserId: null
      };
      const movement = await this.lockMovement(tx, movementId);
      const activeDelegations = await this.loadActiveFundMovementDelegations(tx);
      const actorIdentityIds = delegationIdentitySet(actorUserId, activeDelegations);
      const payloadFingerprint = fingerprint("fund_movement.submit", {
        actorUserId,
        movementId: movement.id,
        expectedRevision: input.expectedRevision
      });
      const existing = await tx.fundMovementCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) throw new ConflictException("幂等键已用于不同资金移动载荷");
        return existing.responseSnapshot;
      }
      if (movement.revision !== input.expectedRevision || movement.status !== "draft") {
        throw new ConflictException("资金移动版本或状态已变化，请刷新后重试");
      }
      if (
        identitySetsOverlap(
          actorIdentityIds,
          delegationIdentitySet(movement.createdByUserId, activeDelegations)
        )
      ) throw new ForbiddenException("创建人不能提交后确认自己的资金移动");
      const now = new Date();
      const updated = await tx.fundMovement.update({
        where: { id: movement.id },
        data: { status: "submitted", revision: { increment: 1 }, submittedByUserId: actorUserId, submittedAt: now },
        select: { id: true, status: true, revision: true }
      });
      const response = { movementId: updated.id, status: updated.status, revision: updated.revision };
      await tx.fundMovementCommandReceipt.create({
        data: { id: randomUUID(), idempotencyKey, payloadFingerprint, action: "submit", movementId: updated.id, responseSnapshot: response }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "fund_movement.submit",
        businessType: "fund_movement",
        businessId: updated.id,
        metadata: {
          status: updated.status,
          revision: updated.revision,
          roleKeys: transactionActorRoles,
          representedUserIdFingerprint: transactionIdentity.representedUserId !== actorUserId
            ? fingerprint("represented_user", transactionIdentity.representedUserId)
            : null,
          delegatorUserIdFingerprint: transactionIdentity.delegatorUserId
            ? fingerprint("delegator_user", transactionIdentity.delegatorUserId)
            : null,
          delegatedIdentityFingerprints: [...actorIdentityIds]
            .filter((identityId) => identityId !== actorUserId)
            .map((identityId) => fingerprint("delegated_identity", identityId)),
          payloadFingerprint,
          idempotencyKeyFingerprint: fingerprint("idempotency", idempotencyKey)
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  async confirm(actorUserId: string, input: FundMovementCommandInput) {
    const movementId = requiredText(input.movementId, "资金移动标识不能为空");
    await this.assertGlobalFinanceDirector(actorUserId);
    const idempotencyKey = requiredUuid(input.idempotencyKey);
    return this.serializable(() => this.prisma.$transaction(async (tx) => {
      await this.authorizeFundMovementWriteContext(tx, actorUserId);
      await this.lockIdempotency(tx, idempotencyKey);
      const payloadFingerprint = fingerprint("fund_movement.confirm", {
        actorUserId,
        movementId: input.movementId,
        expectedRevision: input.expectedRevision
      });
      const existing = await tx.fundMovementCommandReceipt.findUnique({
        where: { idempotencyKey },
        select: { payloadFingerprint: true, responseSnapshot: true }
      });
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) throw new ConflictException("幂等键已用于不同资金移动载荷");
        return existing.responseSnapshot;
      }
      const transactionActorRoles = await this.assertGlobalFinanceDirectorInTransaction(tx, actorUserId);
      const transactionIdentity = {
        roleKeys: transactionActorRoles,
        representedUserId: actorUserId,
        delegatorUserId: null
      };
      const movementScope = await tx.fundMovement.findUnique({
        where: { id: movementId },
        select: {
          id: true,
          kind: true,
          status: true,
          revision: true,
          paymentExecutionId: true,
          sourceProjectId: true,
          beneficiaryProjectId: true,
          sourceCompanyEntityId: true,
          beneficiaryCompanyEntityId: true,
          paymentAmountCents: true,
          projectFundUsedCents: true,
          companyAdvanceCents: true,
          createdByUserId: true,
          submittedByUserId: true
        }
      });
      if (!movementScope) {
        throw new NotFoundException("资金移动不存在");
      }
      const activeDelegations = await this.loadActiveFundMovementDelegations(tx);
      const actorIdentityIds = delegationIdentitySet(actorUserId, activeDelegations);
      let paymentExecutionContext: PaymentExecutionContext | null = null;
      if (movementScope.kind === "cross_project_payment") {
        paymentExecutionContext = await this.lockAndValidatePaymentExecution(
          tx,
          movementScope,
          actorUserId,
          activeDelegations
        );
      } else if (movementScope.paymentExecutionId) {
        throw new ConflictException("非跨项目支付不得绑定实际付款");
      }
      // The aggregate lock follows the payment/source rows and precedes all
      // project/funding locks.  This is the fixed #106 order: idempotency ->
      // payment/approval/source -> movement -> projects/funds -> relations.
      // It also prevents two confirmations from observing the same mutable
      // movement revision while they race for project funding rows.
      const movement = await this.lockMovement(tx, movementId, true);
      if (
        movement.id !== movementScope.id ||
        movement.kind !== movementScope.kind ||
        movement.status !== movementScope.status ||
        movement.revision !== movementScope.revision ||
        movement.paymentExecutionId !== movementScope.paymentExecutionId ||
        movement.paymentAmountCents !== movementScope.paymentAmountCents ||
        movement.sourceProjectId !== movementScope.sourceProjectId ||
        movement.beneficiaryProjectId !== movementScope.beneficiaryProjectId ||
        movement.sourceCompanyEntityId !== movementScope.sourceCompanyEntityId ||
        movement.beneficiaryCompanyEntityId !== movementScope.beneficiaryCompanyEntityId
      ) {
        throw new ConflictException("资金移动范围或版本已变化，请刷新后重试");
      }
      if (movement.revision !== input.expectedRevision || movement.status !== "submitted") {
        throw new ConflictException("资金移动版本或状态已变化，请刷新后重试");
      }
      const separationParticipants = [
        movement.createdByUserId,
        movement.submittedByUserId,
        paymentExecutionContext?.execution.executedByUserId,
        paymentExecutionContext?.approval.approvedByUserId,
        paymentExecutionContext?.approval.representedUserId
      ];
      this.assertFundMovementSeparation(
        actorIdentityIds,
        separationParticipants,
        activeDelegations,
        "职责分离冲突：确认人不能兼任创建人、提交人、付款执行人或最终审批人及其委托身份"
      );
      if (
        movement.createdByUserId === actorUserId ||
        movement.submittedByUserId === actorUserId ||
        movement.createdByUserId === transactionIdentity.representedUserId ||
        movement.submittedByUserId === transactionIdentity.representedUserId
      ) {
        throw new ForbiddenException("创建人和提交人不能确认自己的资金移动");
      }
      if (movement.kind === "profit_distribution_execution") {
        throw new ConflictException("利润分配执行必须等待 #109 提供服务端生效授权");
      }
      await this.lockFundingContexts(tx, movement);
      const legs = await tx.fundMovementLeg.findMany({
        where: { movementId: movement.id },
        orderBy: { legNo: "asc" }
      });
      assertFundMovementLegSet({
        kind: movement.kind as FundMovementKind,
        paymentAmountCents: movement.paymentAmountCents,
        sourceProjectId: movement.sourceProjectId,
        beneficiaryProjectId: movement.beneficiaryProjectId,
        sourceCompanyId: movement.sourceCompanyEntityId,
        beneficiaryCompanyId: movement.beneficiaryCompanyEntityId,
        legs: legs.map((leg) => ({
          role: leg.role as FundMovementLegRole,
          amountCents: leg.amountCents,
          projectId: leg.projectId,
          companyEntityId: leg.companyEntityId,
          direction: leg.direction as FundMovementDirection
        }))
      });
      assertFundMovementFundingComposition({
        kind: movement.kind as FundMovementKind,
        paymentAmountCents: movement.paymentAmountCents,
        projectFundUsedCents: movement.projectFundUsedCents,
        companyAdvanceCents: movement.companyAdvanceCents
      });

      if (movement.kind === "cross_project_payment") {
        if (!paymentExecutionContext) throw new ConflictException("跨项目支付缺少已锁定的实际付款");
        this.assertCrossPaymentSourceSnapshots(movement, legs, paymentExecutionContext);
      }

      const relationships = await tx.fundMovementRelationshipEntry.findMany({
        where: { movementId: movement.id },
        orderBy: { createdAt: "asc" }
      });
      if (relationships.length) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "FundMovementRelationshipEntry"
          WHERE "movementId" = ${movement.id}
          ORDER BY "id" ASC
          FOR UPDATE
        `);
      }
      this.assertRelationshipLineage(movement, legs, relationships);
      await this.assertRelationshipAdjustmentsAvailable(tx, movement, relationships);
      if (movement.kind === "cross_project_payment") {
        if (!paymentExecutionContext) throw new ConflictException("跨项目支付来源事实未锁定");
        this.assertCrossPaymentRelationshipSnapshot(relationships, paymentExecutionContext);
        const sourceSnapshot = jsonObject({
          ...paymentExecutionContext.source.sourceSnapshot,
          payableSettlementCaseFingerprint: fingerprint(
            "payable_settlement_case",
            paymentExecutionContext.payable.settlementCaseId
          ),
          payableSettlementCaseRevision: paymentExecutionContext.payable.caseRevision,
          payableAllocationFingerprints: paymentExecutionContext.payable.allocationIds.map((id) =>
            fingerprint("payable_settlement_allocation", id)
          ),
          payableRefFingerprints: paymentExecutionContext.payable.payableRefs.map((ref) =>
            fingerprint("wage_payable_ref", ref)
          )
        });
        await tx.$executeRaw(
          Prisma.sql`SELECT set_config('app.fund_movement_snapshot_projection', ${`${movement.id}:${actorUserId}`}, true)`
        );
        for (const leg of legs) {
          await tx.fundMovementLeg.update({
            where: { id: leg.id },
            data: { sourceSnapshot }
          });
        }
        for (const relationship of relationships) {
          await tx.fundMovementRelationshipEntry.update({
            where: { id: relationship.id },
            data: { sourceSnapshot }
          });
        }
      }
      const confirmationAt = new Date();
      const occurredAt = paymentExecutionContext?.execution.paidAt ?? confirmationAt;
      await this.applyFundingProjection(tx, movement, relationships, actorUserId, occurredAt);
      for (const leg of legs) {
        const fact = await this.appendLegFact(
          tx,
          movement,
          leg,
          actorUserId,
          occurredAt,
          confirmationAt,
          paymentExecutionContext
        );
        await tx.fundMovementLeg.update({ where: { id: leg.id }, data: { operatingFactId: fact.id } });
      }
      for (const relationship of relationships) {
        await tx.fundMovementRelationshipEntry.update({
          where: { id: relationship.id },
          data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: confirmationAt }
        });
      }
      const updated = await tx.fundMovement.update({
        where: { id: movement.id },
        data: {
          status: "confirmed",
          revision: { increment: 1 },
          confirmedByUserId: actorUserId,
          confirmedAt: confirmationAt
        },
        select: { id: true, status: true, revision: true }
      });
      const response = { movementId: updated.id, status: updated.status, revision: updated.revision };
      await tx.fundMovementCommandReceipt.create({
        data: { id: randomUUID(), idempotencyKey, payloadFingerprint, action: "confirm", movementId: updated.id, responseSnapshot: response }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "fund_movement.confirm",
        businessType: "fund_movement",
        businessId: updated.id,
        metadata: {
          status: updated.status,
          revision: updated.revision,
          revisionBefore: movement.revision,
          revisionAfter: updated.revision,
          roleKeys: transactionActorRoles,
          representedUserIdFingerprint: transactionIdentity.representedUserId !== actorUserId
            ? fingerprint("represented_user", transactionIdentity.representedUserId)
            : null,
          delegatorUserIdFingerprint: transactionIdentity.delegatorUserId
            ? fingerprint("delegator_user", transactionIdentity.delegatorUserId)
            : null,
          delegatedIdentityFingerprints: [...actorIdentityIds]
            .filter((identityId) => identityId !== actorUserId)
            .map((identityId) => fingerprint("delegated_identity", identityId)),
          payloadFingerprint,
          scope: {
            sourceProjectId: movement.sourceProjectId,
            beneficiaryProjectId: movement.beneficiaryProjectId,
            sourceCompanyEntityId: movement.sourceCompanyEntityId,
            beneficiaryCompanyEntityId: movement.beneficiaryCompanyEntityId
          },
          amounts: {
            paymentAmountCents: movement.paymentAmountCents.toString(),
            projectFundUsedCents: movement.projectFundUsedCents.toString(),
            companyAdvanceCents: movement.companyAdvanceCents.toString()
          },
          paymentExecutionIdFingerprint: movement.paymentExecutionId
            ? fingerprint("payment_execution", movement.paymentExecutionId)
            : null,
          ...(paymentExecutionContext
            ? {
                approvalInstanceFingerprint: fingerprint(
                  "payment_request.approval",
                  paymentExecutionContext.approval.approvalInstanceId
                ),
                approvalRevisionFingerprint: paymentExecutionContext.approval.approvalRevision,
                approvedByUserFingerprint: paymentExecutionContext.approval.approvedByUserId
                  ? fingerprint("approval_actor", paymentExecutionContext.approval.approvedByUserId)
                  : null,
                approvalRepresentedUserFingerprint: paymentExecutionContext.approval.representedUserId
                  ? fingerprint("approval_represented_user", paymentExecutionContext.approval.representedUserId)
                  : null,
                approvedRoleKey: paymentExecutionContext.approval.approvedRoleKey,
                approvedPayerCompanyFingerprint: fingerprint(
                  "approved_payer_company",
                  paymentExecutionContext.approvedPayerCompanyId
                ),
                actualPayerCompanyFingerprint: fingerprint(
                  "actual_payer_company",
                  paymentExecutionContext.payerCompanyEntityId
                ),
                payerAttestationFingerprint: paymentExecutionContext.execution.payerAttestationFingerprint
                  ? fingerprint("payer_attestation", paymentExecutionContext.execution.payerAttestationFingerprint)
                  : null,
                payableSettlementCaseFingerprint: fingerprint(
                  "payable_settlement_case",
                  paymentExecutionContext.payable.settlementCaseId
                ),
                payableAllocationFingerprints: paymentExecutionContext.payable.allocationIds.map((id) =>
                  fingerprint("payable_settlement_allocation", id)
                ),
                payableRefFingerprints: paymentExecutionContext.payable.payableRefs.map((ref) =>
                  fingerprint("wage_payable_ref", ref)
                ),
                proxyRelationshipFingerprint: paymentExecutionContext.payable.proxyRelationshipId
                  ? fingerprint("inter_entity_proxy_payment", paymentExecutionContext.payable.proxyRelationshipId)
                  : null
              }
            : {}),
          legFingerprints: legs.map((leg) => fingerprint("fund_movement.leg", leg.id)),
          relationshipFingerprints: relationships.map((entry) =>
            fingerprint("fund_movement.relationship", entry.id)
          ),
          idempotencyKeyFingerprint: fingerprint("idempotency", idempotencyKey),
          legCount: legs.length,
          relationshipCount: relationships.length
        }
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async lockFundingContexts(
    tx: Prisma.TransactionClient,
    movement: Pick<MovementScope, "sourceProjectId" | "beneficiaryProjectId">
  ): Promise<void> {
    const projectIds = [...new Set([movement.sourceProjectId, movement.beneficiaryProjectId])]
      .sort((left, right) => left.localeCompare(right));
    for (const projectId of projectIds) {
      await this.funding.lockFundingContext(tx, projectId);
      // The availability service protects the project/quota roots.  Lock the
      // append-only allocation rows as well so the read/check/projected write
      // sequence is explicit and deterministic under concurrent confirmation.
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "ProjectFundingAllocation"
        WHERE "projectId" = ${projectId}
        ORDER BY "sourceKey" ASC, "direction" ASC, "reversalKey" ASC, "id" ASC
        FOR UPDATE
      `);
    }
  }

  private async lockAndValidatePaymentExecution(
    tx: Prisma.TransactionClient,
    movement: MovementScope,
    actorUserId: string,
    activeDelegations: readonly ActiveFundMovementDelegation[] = []
  ): Promise<PaymentExecutionContext> {
    const paymentExecutionId = requiredText(movement.paymentExecutionId ?? undefined, "跨项目支付缺少实际付款");
    // The fixed #106 order starts with the approval/source request.  The
    // initial execution read is only a pointer lookup; the execution row is
    // locked after its PaymentRequest so a request/project/approval change
    // cannot race the confirmation lock set.
    const executionPointer = await tx.paymentExecution.findUnique({
      where: { id: paymentExecutionId },
      select: { id: true, paymentRequestId: true }
    });
    if (!executionPointer) throw new ConflictException("实际付款不存在或已失效");

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PaymentRequest"
      WHERE "id" = ${executionPointer.paymentRequestId}
      FOR UPDATE
    `);
    const request = await tx.paymentRequest.findUnique({
      where: { id: executionPointer.paymentRequestId },
      select: {
        id: true,
        projectId: true,
        contractId: true,
        contractVersionId: true,
        paymentTermsVersionId: true,
        sourceType: true,
        status: true,
        paymentSubjectType: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true,
        abandonedAt: true,
        settlementId: true
      }
    });
    if (
      !request ||
      // PaymentRequest/Allocation/Settlement are the beneficiary project's
      // payable authority.  The source project is only the funding side of
      // this projection and must not be used to select the payable source.
      request.projectId !== movement.beneficiaryProjectId ||
      request.paymentSubjectType !== "our_company" ||
      request.abandonedAt !== null ||
      !["approved_pending_payment", "partially_paid", "paid"].includes(request.status)
    ) {
      throw new ConflictException("实际付款申请项目、主体或审批状态不一致");
    }
    const approvedAmountCents = request.approvedAmountCents ?? request.requestedAmountCents;
    if (BigInt(approvedAmountCents) <= 0n) {
      throw new ConflictException("实际付款申请批复金额无效");
    }

    // A paid request is only a valid source when its immutable approval
    // instance is complete.  Lock every matching approved instance before
    // locking the execution row so a stale/parallel approval cannot be used
    // as a funding authority.
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "ApprovalInstance"
      WHERE "businessType" = 'payment_request'
        AND "businessId" = ${request.id}
        AND "flowType" = 'payment.approve'
        AND "status" = 'approved'
      ORDER BY "updatedAt" DESC, "id" DESC
      FOR UPDATE
    `);
    const approvalInstances = await tx.approvalInstance.findMany({
      where: {
        businessType: "payment_request",
        businessId: request.id,
        flowType: "payment.approve",
        status: "approved"
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true, status: true, currentNodeIndex: true, frozenNodes: true, updatedAt: true }
    });
    if (approvalInstances.length !== 1) {
      throw new ConflictException("付款申请缺少唯一有效的审批版本");
    }
    const approvalInstance = approvalInstances[0];
    const frozenNodes = Array.isArray(approvalInstance.frozenNodes)
      ? approvalInstance.frozenNodes
      : [];
    if (
      approvalInstance.status !== "approved" ||
      frozenNodes.length === 0 ||
      approvalInstance.currentNodeIndex < frozenNodes.length
    ) {
      throw new ConflictException("付款申请审批尚未完整结束");
    }
    const approvalAction = await tx.approvalActionLog.findFirst({
      where: { approvalInstanceId: approvalInstance.id, action: "approve" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { actorUserId: true, representedUserId: true, approvedRoleKey: true }
    });
    if (!approvalAction) {
      throw new ConflictException("付款申请缺少可验证的审批动作记录");
    }
    const approvalActorUserId = requiredApprovalText(
      approvalAction.actorUserId,
      "付款申请审批动作包含无效的审批人"
    );
    const approvalRoleKey = requiredApprovalText(
      approvalAction.approvedRoleKey,
      "付款申请审批动作包含无效的审批岗位"
    );
    const approvalRepresentedUserId = optionalApprovalIdentity(approvalAction.representedUserId);
    const approvalContext: PaymentExecutionApprovalContext = {
      approvalInstanceId: approvalInstance.id,
      approvalRevision: fingerprint("payment_request.approval", {
        id: approvalInstance.id,
        currentNodeIndex: approvalInstance.currentNodeIndex,
        updatedAt: approvalInstance.updatedAt,
        frozenNodes
      }),
      approvedByUserId: approvalActorUserId,
      representedUserId: approvalRepresentedUserId,
      approvedRoleKey: approvalRoleKey
    };

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PaymentExecution"
      WHERE "id" = ${paymentExecutionId}
      FOR UPDATE
    `);
    const execution = await tx.paymentExecution.findUnique({
      where: { id: paymentExecutionId },
      select: {
        id: true,
        amountCents: true,
        paymentRequestId: true,
        settlementId: true,
        paymentSubjectType: true,
        companyEntityIdSnapshot: true,
        executedByUserId: true,
        paidAt: true,
        payerAttestationFingerprint: true
      }
    });
    if (
      !execution ||
      execution.paymentRequestId !== request.id ||
      execution.settlementId !== request.settlementId ||
      BigInt(execution.amountCents) !== movement.paymentAmountCents
    ) {
      throw new ConflictException("实际付款金额、申请或状态已变化");
    }
    if (
      execution.paymentSubjectType !== "our_company" ||
      !(execution.paidAt instanceof Date) ||
      Number.isNaN(execution.paidAt.getTime())
    ) {
      throw new ConflictException("实际付款主体或付款时间无效");
    }
    const executionAmountCents = BigInt(execution.amountCents);
    const paidAmountCents = BigInt(request.paidAmountCents);
    if (paidAmountCents < executionAmountCents || paidAmountCents > BigInt(approvedAmountCents)) {
      throw new ConflictException("付款申请实付累计与实际付款事实不一致");
    }
    const paidBeforeExecutionCents = paidAmountCents - executionAmountCents;
    if (executionAmountCents > BigInt(approvedAmountCents) - paidBeforeExecutionCents) {
      throw new ConflictException("实际付款金额超过付款申请批复金额");
    }
    this.assertFundMovementSeparation(
      delegationIdentitySet(actorUserId, activeDelegations),
      [
        movement.createdByUserId,
        movement.submittedByUserId,
        execution.executedByUserId,
        approvalContext.approvedByUserId,
        approvalContext.representedUserId
      ],
      activeDelegations,
      "职责分离冲突：确认人不能兼任创建人、提交人、付款执行人或最终审批人及其委托身份"
    );

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Contract"
      WHERE "id" = ${request.contractId}
      FOR UPDATE
    `);
    const contract = await tx.contract.findUnique({
      where: { id: request.contractId },
      select: { id: true, projectId: true, voidedAt: true }
    });
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "ContractVersion"
      WHERE "id" = ${request.contractVersionId}
      FOR UPDATE
    `);
    const contractVersion = await tx.contractVersion.findUnique({
      where: { id: request.contractVersionId },
      select: {
        id: true,
        contractId: true,
        status: true,
        effectiveAt: true,
        endedAt: true,
        signingSubjectType: true,
        companyEntityIdSnapshot: true,
        companyEntityVersionId: true
      }
    });
    if (
      !contract ||
      contract.projectId !== request.projectId ||
      contract.voidedAt ||
      !contractVersion ||
      contractVersion.contractId !== request.contractId ||
      contractVersion.status !== "effective" ||
      contractVersion.signingSubjectType !== "our_company" ||
      !contractVersion.companyEntityIdSnapshot ||
      !contractVersion.companyEntityVersionId ||
      !contractVersion.effectiveAt ||
      contractVersion.effectiveAt > execution.paidAt ||
      (contractVersion.endedAt !== null && contractVersion.endedAt <= execution.paidAt)
    ) {
      throw new ConflictException("实际付款合同或合同版本来源不存在、已失效或范围不一致");
    }

    const approvedPayerCompanyId = contractVersion.companyEntityIdSnapshot;
    if (
      !execution.payerAttestationFingerprint &&
      execution.companyEntityIdSnapshot !== approvedPayerCompanyId
    ) {
      throw new ConflictException("实际付款主体与付款审批主体不一致，缺少受控代付核验");
    }

    let payerCompanyEntityId = execution.companyEntityIdSnapshot;
    if (execution.payerAttestationFingerprint) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "PaymentExecutionPayerAttestation"
        WHERE "paymentExecutionId" = ${execution.id}
        FOR UPDATE
      `);
      const attestation = await tx.paymentExecutionPayerAttestation.findUnique({
        where: { paymentExecutionId: execution.id },
        select: {
          holderCompanyEntityId: true,
          bankAccountReference: true,
          proxyAuthorizationReason: true,
          proxyAuthorizationEvidenceFileId: true,
          reauthorizationReference: true,
          reauthorizedByUserId: true,
          reauthorizedAt: true
        }
      });
      const attestationFingerprint = attestation
        ? createHash("sha256")
            .update(JSON.stringify({
              bankAccountReference: attestation.bankAccountReference,
              authorization: attestation.proxyAuthorizationReason
                ? {
                    reason: attestation.proxyAuthorizationReason,
                    evidenceFileId: attestation.proxyAuthorizationEvidenceFileId,
                    reauthorizationReference: attestation.reauthorizationReference,
                    reauthorizedByUserId: attestation.reauthorizedByUserId,
                    reauthorizedAt: attestation.reauthorizedAt?.toISOString()
                  }
                : null
            }))
            .digest("hex")
        : null;
      if (!attestation || attestationFingerprint !== execution.payerAttestationFingerprint) {
        throw new ConflictException("实际付款主体核验凭证不存在或已变化");
      }
      payerCompanyEntityId = attestation.holderCompanyEntityId;
    }
    if (payerCompanyEntityId !== movement.sourceCompanyEntityId) {
      throw new ConflictException("实际付款主体与来源公司快照不一致");
    }

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PaymentExecutionAllocation"
      WHERE "paymentExecutionId" = ${execution.id}
      ORDER BY "id" ASC
      FOR UPDATE
    `);
    const allocations = await tx.paymentExecutionAllocation.findMany({
      where: { paymentExecutionId: execution.id },
      orderBy: [{ allocationOrder: "asc" }, { id: "asc" }],
      select: {
        paymentRequestId: true,
        projectId: true,
        contractId: true,
        contractVersionId: true,
        settlementId: true,
        sourceType: true,
        allocationType: true,
        sourceRowId: true,
        paymentTermsVersionId: true,
        stageId: true,
        sourcePayableAmountCents: true,
        amountCents: true
      }
    });
    let source: PaymentExecutionContext["source"];
    if (allocations.length) {
      const sourceType = allocations[0].sourceType.trim();
      const sourceAllocationAmountCents = allocations.reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
      const allowedAllocationTypes = sourceType === "contract_due"
        ? new Set(["contract_due_payment", "advance_deduction"])
        : sourceType === "settlement"
          ? new Set(["settlement", "contract_due_payment", "advance_deduction"])
          : new Set<string>();
      if (
        !sourceType ||
        !["contract_due", "settlement"].includes(sourceType) ||
        request.sourceType !== sourceType ||
        sourceAllocationAmountCents !== movement.paymentAmountCents ||
        allocations.some((row) =>
          row.paymentRequestId !== execution.paymentRequestId ||
          row.projectId !== request.projectId ||
          row.contractId !== request.contractId ||
          row.contractVersionId !== request.contractVersionId ||
          row.sourceType.trim() !== sourceType ||
          !allowedAllocationTypes.has(row.allocationType) ||
          row.paymentTermsVersionId !== request.paymentTermsVersionId ||
          !row.sourceRowId.trim() ||
          BigInt(row.amountCents) <= 0n ||
          BigInt(row.sourcePayableAmountCents) < BigInt(row.amountCents) ||
          (row.settlementId !== null && row.settlementId !== request.settlementId && request.settlementId !== null) ||
          (sourceType === "settlement" && row.settlementId !== request.settlementId) ||
          (sourceType === "contract_due" && row.settlementId === null &&
            (!row.stageId || row.sourceRowId !== `contract:${row.paymentTermsVersionId}:${row.stageId}`)) ||
          (sourceType === "contract_due" && row.settlementId !== null &&
            !row.sourceRowId.startsWith(`${row.settlementId}:`))
        )
      ) {
        throw new ConflictException("实际付款来源分摊快照无效");
      }
      const settlementIds = [...new Set(
        allocations.flatMap((row) => row.settlementId ? [row.settlementId] : [])
      )].sort((left, right) => left.localeCompare(right));
      const settlements = new Map<string, {
        id: string;
        projectId: string;
        contractId: string;
        contractVersionId: string;
        status: string;
        payableAmountCents: bigint;
      }>();
      for (const settlementId of settlementIds) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "Settlement"
          WHERE "id" = ${settlementId}
          FOR UPDATE
        `);
        const settlement = await tx.settlement.findUnique({
          where: { id: settlementId },
          select: {
            id: true,
            projectId: true,
            contractId: true,
            contractVersionId: true,
            status: true,
            payableAmountCents: true
          }
        });
        if (
          !settlement ||
          settlement.projectId !== request.projectId ||
          settlement.contractId !== request.contractId ||
          settlement.contractVersionId !== request.contractVersionId ||
          !["effective", "partially_paid", "paid"].includes(settlement.status)
        ) {
          throw new ConflictException("实际付款结算来源不存在、已失效或范围不一致");
        }
        settlements.set(settlement.id, {
          ...settlement,
          payableAmountCents: BigInt(settlement.payableAmountCents)
        });
      }
      const allocatedBySettlement = new Map<string, bigint>();
      for (const allocation of allocations) {
        if (!allocation.settlementId) continue;
        const amountCents = BigInt(allocation.amountCents);
        const total = (allocatedBySettlement.get(allocation.settlementId) ?? 0n) + amountCents;
        if (total > (settlements.get(allocation.settlementId)?.payableAmountCents ?? 0n)) {
          throw new ConflictException("实际付款来源分摊超过结算应付金额");
        }
        allocatedBySettlement.set(allocation.settlementId, total);
      }
      if (sourceType === "contract_due") {
        const syntheticStageIds = [...new Set(
          allocations.flatMap((row) => row.settlementId || !row.stageId ? [] : [row.stageId])
        )].sort((left, right) => left.localeCompare(right));
        for (const stageId of syntheticStageIds) {
          const stage = await tx.paymentTermsStage.findUnique({
            where: { id: stageId },
            select: { id: true, paymentTermsVersionId: true }
          });
          if (!stage || stage.paymentTermsVersionId !== request.paymentTermsVersionId) {
            throw new ConflictException("实际付款合同付款阶段来源不存在或版本不一致");
          }
        }
      }
      const normalizedAllocations: PaymentExecutionSourceAllocation[] = allocations.map((row) => ({
        allocationType: row.allocationType,
        sourceRowId: row.sourceRowId,
        settlementId: row.settlementId,
        contractVersionId: row.contractVersionId,
        paymentTermsVersionId: row.paymentTermsVersionId,
        sourcePayableAmountCents: BigInt(row.sourcePayableAmountCents),
        amountCents: BigInt(row.amountCents)
      }));
      source = {
        sourceType,
        sourceAggregateId: allocations[0].sourceRowId,
        allowedAggregateIds: allocations.map((row) => row.sourceRowId),
        sourceAllocationCount: allocations.length,
        sourceAllocationAmountCents,
        contractId: request.contractId,
        contractVersionId: request.contractVersionId,
        allocations: normalizedAllocations,
        sourceSnapshot: {
          authority: "payment_execution_source",
          paymentExecutionId: execution.id,
          paymentRequestId: request.id,
          projectId: request.projectId,
          sourceType,
          contractId: request.contractId,
          contractVersionId: request.contractVersionId,
          paymentTermsVersionId: request.paymentTermsVersionId,
          settlementId: request.settlementId,
          sourceAllocationCount: normalizedAllocations.length,
          sourceAllocationAmountCents: sourceAllocationAmountCents.toString(),
          allocations: normalizedAllocations.map((row) => ({
            allocationType: row.allocationType,
            sourceRowId: row.sourceRowId,
            settlementId: row.settlementId,
            contractVersionId: row.contractVersionId,
            paymentTermsVersionId: row.paymentTermsVersionId,
            sourcePayableAmountCents: row.sourcePayableAmountCents.toString(),
            amountCents: row.amountCents.toString()
          }))
        }
      };
    } else {
      const settlementId = requiredText(execution.settlementId ?? undefined, "实际付款缺少结算来源");
      if (request.settlementId !== settlementId || request.sourceType !== "settlement") {
        throw new ConflictException("实际付款缺少精确结算来源");
      }
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "Settlement"
        WHERE "id" = ${settlementId}
        FOR UPDATE
      `);
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId },
        select: {
          id: true,
          projectId: true,
          contractId: true,
          contractVersionId: true,
          status: true,
          payableAmountCents: true
        }
      });
      if (
        !settlement ||
        settlement.projectId !== request.projectId ||
        settlement.contractId !== request.contractId ||
        settlement.contractVersionId !== request.contractVersionId ||
        !["effective", "partially_paid", "paid"].includes(settlement.status)
      ) {
        throw new ConflictException("实际付款结算来源不存在、已失效或范围不一致");
      }
      source = {
        sourceType: "settlement",
        sourceAggregateId: settlement.id,
        allowedAggregateIds: [settlement.id],
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: movement.paymentAmountCents,
        contractId: request.contractId,
        contractVersionId: request.contractVersionId,
        allocations: [{
          allocationType: "settlement",
          sourceRowId: settlement.id,
          settlementId: settlement.id,
          contractVersionId: request.contractVersionId,
          paymentTermsVersionId: request.paymentTermsVersionId,
          sourcePayableAmountCents: BigInt(settlement.payableAmountCents ?? movement.paymentAmountCents),
          amountCents: movement.paymentAmountCents
        }],
        sourceSnapshot: {
          authority: "payment_execution_source",
          paymentExecutionId: execution.id,
          paymentRequestId: request.id,
          projectId: request.projectId,
          sourceType: "settlement",
          contractId: request.contractId,
          contractVersionId: request.contractVersionId,
          paymentTermsVersionId: request.paymentTermsVersionId,
          settlementId: settlement.id,
          sourceAllocationCount: 1,
          sourceAllocationAmountCents: movement.paymentAmountCents.toString(),
          allocations: [{
            allocationType: "settlement",
            sourceRowId: settlement.id,
            settlementId: settlement.id,
            contractVersionId: request.contractVersionId,
            paymentTermsVersionId: request.paymentTermsVersionId,
            sourcePayableAmountCents: BigInt(settlement.payableAmountCents ?? movement.paymentAmountCents).toString(),
            amountCents: movement.paymentAmountCents.toString()
          }]
        }
      };
    }

    const payable = await this.lockAndValidatePayableSettlement(
      tx,
      execution.id,
      request,
      movement,
      payerCompanyEntityId,
      approvedPayerCompanyId
    );

    return {
      execution: {
        id: execution.id,
        amountCents: BigInt(execution.amountCents),
        paymentRequestId: execution.paymentRequestId,
        settlementId: execution.settlementId,
        paymentSubjectType: execution.paymentSubjectType,
        companyEntityIdSnapshot: execution.companyEntityIdSnapshot,
        executedByUserId: execution.executedByUserId,
        paidAt: execution.paidAt,
        payerAttestationFingerprint: execution.payerAttestationFingerprint
      },
      request,
      approval: approvalContext,
      approvedPayerCompanyId,
      payerCompanyEntityId,
      source,
      payable
    };
  }

  private async lockAndValidatePayableSettlement(
    tx: Prisma.TransactionClient,
    paymentExecutionId: string,
    request: PaymentExecutionContext["request"],
    movement: MovementScope,
    actualPayerCompanyId: string,
    approvedPayerCompanyId: string
  ): Promise<PaymentExecutionPayableContext> {
    // #220 is the only accepted payable authority for a fund movement.  The
    // case/allocation/ref rows are locked in stable order before the movement
    // and funding rows are touched, so a competing settlement cannot change
    // the source between validation and projection.
    // #220 and #222 share one lock order: payable refs are acquired before
    // settlement cases/allocations. This makes a registry allocation and a
    // fund-movement confirmation wait in the same direction instead of
    // deadlocking on the case/ref pair.
    const payableRefRows = await tx.payableSettlementAllocation.findMany({
      where: { paymentExecutionId },
      select: { payableRef: true },
      orderBy: [{ payableRef: "asc" }, { id: "asc" }]
    });
    const payableRefsForLock = Array.from(new Set(payableRefRows.map(({ payableRef }) => payableRef)))
      .sort((left, right) => left.localeCompare(right));
    for (const payableRef of payableRefsForLock) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "WagePayableRef"
        WHERE "id" = ${payableRef} OR "adjustsPayableRefId" = ${payableRef}
        ORDER BY "id" ASC
        FOR UPDATE
      `);
    }
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PayableSettlementCase"
      WHERE "paymentExecutionId" = ${paymentExecutionId}
        AND "status" = 'confirmed'
      ORDER BY "revision" DESC, "id" DESC
      FOR UPDATE
    `);
    const cases = await tx.payableSettlementCase.findMany({
      where: { paymentExecutionId, status: "confirmed" },
      orderBy: [{ revision: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true, paymentExecutionId: true, status: true, revision: true, confirmedByUserId: true, confirmedAt: true }
    });
    if (cases.length !== 1 || cases[0].paymentExecutionId !== paymentExecutionId) {
      throw new ConflictException("实际付款缺少唯一已确认的应付核销案件");
    }
    const settlementCase = cases[0];
    if (!settlementCase.confirmedByUserId || !settlementCase.confirmedAt) {
      throw new ConflictException("应付核销案件缺少确认快照");
    }

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PayableSettlementAllocation"
      WHERE "settlementCaseId" = ${settlementCase.id}
      ORDER BY "payableRef" ASC, "id" ASC
      FOR UPDATE
    `);
    const allocations = await tx.payableSettlementAllocation.findMany({
      where: { settlementCaseId: settlementCase.id },
      orderBy: [{ payableRef: "asc" }, { id: "asc" }],
      select: {
        id: true,
        settlementCaseId: true,
        paymentExecutionId: true,
        payableRef: true,
        sourceType: true,
        sourceAggregateId: true,
        sourceLineId: true,
        confirmedVersionId: true,
        debtorCompanyId: true,
        payeeSubjectType: true,
        payeeSubjectId: true,
        currencyCode: true,
        beneficiaryProjectId: true,
        sourceSnapshot: true,
        confirmedAmountCents: true,
        amountCents: true
      }
    });
    if (!allocations.length) {
      throw new ConflictException("已确认核销案件缺少应付分摊");
    }
    const payableAmountCents = allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountCents), 0n);
    if (
      payableAmountCents !== movement.paymentAmountCents ||
      allocations.some((allocation) =>
        allocation.settlementCaseId !== settlementCase.id ||
        allocation.paymentExecutionId !== paymentExecutionId ||
        allocation.beneficiaryProjectId !== movement.beneficiaryProjectId ||
        allocation.debtorCompanyId !== movement.beneficiaryCompanyEntityId ||
        allocation.currencyCode !== "CNY" ||
        !allocation.payableRef.trim() ||
        !allocation.sourceType.trim() ||
        !allocation.sourceAggregateId.trim() ||
        !allocation.sourceLineId.trim() ||
        !allocation.confirmedVersionId.trim() ||
        BigInt(allocation.amountCents) <= 0n ||
        BigInt(allocation.confirmedAmountCents) < BigInt(allocation.amountCents)
      )
    ) {
      throw new ConflictException("应付核销分摊项目、债务主体或金额快照不一致");
    }

    const payableRefs = [...new Set(allocations.map((allocation) => allocation.payableRef))]
      .sort((left, right) => left.localeCompare(right));
    const wageRefs = await tx.wagePayableRef.findMany({
      where: { id: { in: payableRefs } },
      select: {
        id: true,
        confirmedVersionId: true,
        projectAllocationId: true,
        creditorBreakdownId: true,
        projectId: true,
        debtorCompanyId: true,
        debtorCompanySnapshot: true,
        projectSnapshot: true,
        creditorSnapshot: true,
        amountCents: true,
        direction: true,
        adjustsPayableRefId: true,
        confirmedVersion: { select: { status: true } },
        creditorBreakdown: {
          select: {
            creditorSubjectType: true,
            creditorUserId: true,
            creditorBusinessPartyVersionId: true,
            creditorSubjectIdentityKey: true,
            creditorNameSnapshot: true,
            creditorUnifiedIdentitySnapshot: true,
            creditorVersionFingerprint: true
          }
        },
        adjustments: { select: { direction: true, amountCents: true } }
      },
      orderBy: { id: "asc" }
    });
    const wageRefById = new Map(wageRefs.map((ref) => [ref.id, ref]));
    const registeredByRef = new Map<string, RegisteredPayable>();
    try {
      for (const ref of wageRefs) {
        registeredByRef.set(
          ref.id,
          payableSourceAdapterRegistry.require("wage_payable_ref").toRegisteredPayable(ref)
        );
      }
    } catch {
      throw new ConflictException("应付引用不存在、已更正或与核销快照不一致");
    }
    if (
      wageRefs.length !== payableRefs.length ||
      allocations.some((allocation) => {
        const ref = wageRefById.get(allocation.payableRef);
        const registered = registeredByRef.get(allocation.payableRef);
        return !ref ||
          !registered ||
          ref.projectId !== movement.beneficiaryProjectId ||
          ref.debtorCompanyId !== movement.beneficiaryCompanyEntityId ||
          allocation.sourceType !== registered.sourceType ||
          allocation.sourceAggregateId !== registered.sourceAggregateId ||
          allocation.sourceLineId !== registered.sourceLineId ||
          allocation.confirmedVersionId !== registered.confirmedVersionId ||
          allocation.debtorCompanyId !== registered.debtorCompanyId ||
          allocation.payeeSubjectType !== registered.payeeSubjectType ||
          allocation.payeeSubjectId !== registered.payeeSubjectId ||
          allocation.currencyCode !== registered.currencyCode ||
          allocation.beneficiaryProjectId !== registered.beneficiaryProjectId ||
          BigInt(allocation.confirmedAmountCents) !== registered.confirmedAmountCents ||
          BigInt(allocation.amountCents) <= 0n ||
          BigInt(allocation.amountCents) > registered.confirmedAmountCents;
      })
    ) {
      throw new ConflictException("应付引用不存在、已更正或与核销快照不一致");
    }

    for (const payableRef of payableRefs) {
      const ref = wageRefById.get(payableRef);
      const registered = registeredByRef.get(payableRef);
      if (!ref || !registered) {
        throw new ConflictException("应付引用不存在、已更正或与核销快照不一致");
      }
      const effectiveAmountCents = deriveEffectiveWagePayableAmount(
        BigInt(ref.amountCents),
        ref.adjustments.map((adjustment) => ({
          direction: adjustment.direction,
          amountCents: BigInt(adjustment.amountCents)
        }))
      );
      const settled = await tx.payableSettlementAllocation.aggregate({
        where: {
          payableRef,
          settlementCase: {
            id: { not: settlementCase.id },
            status: "confirmed"
          }
        },
        _sum: { amountCents: true }
      });
      const currentCaseAmountCents = allocations
        .filter((allocation) => allocation.payableRef === payableRef)
        .reduce((total, allocation) => total + BigInt(allocation.amountCents), 0n);
      const validSettledAmountCents = BigInt(settled._sum.amountCents ?? 0n) + currentCaseAmountCents;
      const balance = derivePayableSettlementBalance({
        effectiveAmountCents,
        validSettledAmountCents
      });
      if (balance.settlementReconciliationRequired) {
        throw new ConflictException("工资应付已超额核销，必须先完成核对");
      }
    }

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PaymentExecutionWagePayableBinding"
      WHERE "paymentExecutionId" = ${paymentExecutionId}
      ORDER BY "wagePayableRefId" ASC, "id" ASC
      FOR UPDATE
    `);
    const bindings = await tx.paymentExecutionWagePayableBinding.findMany({
      where: { paymentExecutionId },
      orderBy: [{ wagePayableRefId: "asc" }, { id: "asc" }],
      select: {
        id: true,
        wagePayableRefId: true,
        debtorCompanyId: true,
        debtorCompanySnapshot: true,
        projectId: true,
        projectSnapshot: true,
        creditorSubjectType: true,
        creditorUserId: true,
        creditorBusinessPartyVersionId: true,
        creditorSubjectIdentityKey: true,
        creditorNameSnapshot: true,
        creditorUnifiedIdentitySnapshot: true,
        creditorVersionFingerprint: true,
        creditorSnapshot: true,
        currencyCode: true,
        amountCents: true
      }
    });
    const bindingByRef = new Map(bindings.map((binding) => [binding.wagePayableRefId, binding]));
    if (
      bindings.length !== payableRefs.length ||
      allocations.some((allocation) => {
        const binding = bindingByRef.get(allocation.payableRef);
        const ref = wageRefById.get(allocation.payableRef);
        const registered = registeredByRef.get(allocation.payableRef);
        const creditorBreakdown = ref?.creditorBreakdown;
        return !binding ||
          !ref ||
          !registered ||
          !creditorBreakdown ||
          binding.debtorCompanyId !== allocation.debtorCompanyId ||
          binding.projectId !== allocation.beneficiaryProjectId ||
          binding.debtorCompanyId !== ref.debtorCompanyId ||
          fingerprint("debtor_company_snapshot", binding.debtorCompanySnapshot) !==
            fingerprint("debtor_company_snapshot", ref.debtorCompanySnapshot) ||
          fingerprint("project_snapshot", binding.projectSnapshot) !==
            fingerprint("project_snapshot", ref.projectSnapshot) ||
          binding.creditorSubjectType !== creditorBreakdown.creditorSubjectType ||
          binding.creditorUserId !== creditorBreakdown.creditorUserId ||
          binding.creditorBusinessPartyVersionId !== creditorBreakdown.creditorBusinessPartyVersionId ||
          binding.creditorSubjectIdentityKey !== creditorBreakdown.creditorSubjectIdentityKey ||
          binding.creditorNameSnapshot !== creditorBreakdown.creditorNameSnapshot ||
          (binding.creditorUnifiedIdentitySnapshot ?? null) !==
            (creditorBreakdown.creditorUnifiedIdentitySnapshot ?? null) ||
          (binding.creditorVersionFingerprint ?? null) !==
            (creditorBreakdown.creditorVersionFingerprint ?? null) ||
          binding.creditorSnapshot === null ||
          fingerprint("creditor_snapshot", binding.creditorSnapshot) !==
            fingerprint("creditor_snapshot", ref.creditorSnapshot) ||
          binding.currencyCode !== registered.currencyCode ||
          BigInt(binding.amountCents) < BigInt(allocation.amountCents);
      })
    ) {
      throw new ConflictException("实际付款缺少与应付引用对应的工资债权绑定");
    }

    let proxyRelationshipId: string | null = null;
    const originalDebtorCompanyId = allocations[0].debtorCompanyId;
    if (actualPayerCompanyId !== originalDebtorCompanyId) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "InterEntityRelationshipEntry"
        WHERE "paymentExecutionId" = ${paymentExecutionId}
          AND "settlementCaseId" = ${settlementCase.id}
          AND "entryKind" = 'proxy_payment'
          AND "direction" = 'increase'
          AND "status" = 'confirmed'
        ORDER BY "id" ASC
        FOR UPDATE
      `);
      const proxies = await tx.interEntityRelationshipEntry.findMany({
        where: {
          paymentExecutionId,
          settlementCaseId: settlementCase.id,
          entryKind: "proxy_payment",
          direction: "increase",
          status: "confirmed"
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          originalDebtorCompanyId: true,
          creditorCompanyId: true,
          amountCents: true,
          currencyCode: true,
          projectId: true,
          contractId: true,
          contractVersionId: true,
          approvedPayerCompanyId: true,
          sourceType: true,
          sourceAggregateId: true,
          sourceAllocationCount: true,
          sourceAllocationAmountCents: true
        }
      });
      const matching = proxies.filter((proxy) =>
        proxy.originalDebtorCompanyId === originalDebtorCompanyId &&
        proxy.creditorCompanyId === actualPayerCompanyId &&
        proxy.approvedPayerCompanyId === approvedPayerCompanyId &&
        proxy.amountCents === movement.paymentAmountCents &&
        proxy.currencyCode === "CNY" &&
        proxy.projectId === movement.beneficiaryProjectId &&
        proxy.contractId === request.contractId &&
        proxy.contractVersionId === request.contractVersionId &&
        proxy.sourceType === "wage_payable_ref" &&
        proxy.sourceAllocationCount === allocations.length &&
        proxy.sourceAllocationAmountCents === payableAmountCents
      );
      if (matching.length !== 1) {
        throw new ConflictException("跨主体实际付款缺少唯一已确认代付往来");
      }
      proxyRelationshipId = matching[0].id;
    }

    return {
      settlementCaseId: settlementCase.id,
      caseRevision: settlementCase.revision,
      allocationIds: allocations.map((allocation) => allocation.id),
      payableRefs,
      amountCents: payableAmountCents,
      beneficiaryProjectId: movement.beneficiaryProjectId,
      debtorCompanyIds: [...new Set(allocations.map((allocation) => allocation.debtorCompanyId))],
      proxyRelationshipId
    };
  }

  private assertCrossPaymentSourceSnapshots(
    movement: MovementRow,
    legs: readonly MovementLegRow[],
    context: PaymentExecutionContext
  ): void {
    // Only allocation/source row ids resolved and locked from the actual
    // PaymentExecution are valid.  Parent request, contract, and settlement
    // ids are never interchangeable with a source row id.
    const allowedAggregateIds = new Set(context.source.allowedAggregateIds);
    for (const leg of legs) {
      if (
        leg.paymentExecutionId !== context.execution.id ||
        leg.sourceType !== context.source.sourceType ||
        leg.sourceAllocationCount !== context.source.sourceAllocationCount ||
        leg.sourceAllocationAmountCents !== context.source.sourceAllocationAmountCents ||
        leg.contractId !== context.source.contractId ||
        leg.contractVersionId !== context.source.contractVersionId ||
        !leg.sourceAggregateId ||
        !allowedAggregateIds.has(leg.sourceAggregateId)
      ) {
        throw new ConflictException("跨项目支付来源、合同或分摊快照与既有付款事实不一致");
      }
    }
    if (movement.paymentExecutionId !== context.execution.id) {
      throw new ConflictException("资金移动实际付款引用已变化");
    }
  }

  private assertCrossPaymentRelationshipSnapshot(
    relationships: readonly Prisma.FundMovementRelationshipEntryGetPayload<Prisma.FundMovementRelationshipEntryDefaultArgs>[],
    context: PaymentExecutionContext
  ): void {
    if (relationships.length !== 1) return;
    const relationship = relationships[0];
    if (
      relationship.sourceType !== context.source.sourceType ||
      relationship.sourceAllocationCount !== context.source.sourceAllocationCount ||
      relationship.sourceAllocationAmountCents !== context.source.sourceAllocationAmountCents ||
      relationship.contractId !== context.source.contractId ||
      relationship.contractVersionId !== context.source.contractVersionId ||
      !relationship.sourceAggregateId ||
      !context.source.allowedAggregateIds.includes(relationship.sourceAggregateId)
    ) {
      throw new ConflictException("资金移动往来来源、合同或分摊快照与既有付款事实不一致");
    }
  }

  private paymentExecutionLegSnapshot(
    leg: Pick<MovementLegRow, "id" | "role" | "projectId" | "companyEntityId" | "amountCents" | "sourceAggregateId">,
    context: PaymentExecutionContext
  ): Record<string, unknown> {
    return {
      ...context.source.sourceSnapshot,
      legId: leg.id,
      role: leg.role,
      projectId: leg.projectId,
      companyEntityId: leg.companyEntityId,
      sourceAggregateId: leg.sourceAggregateId,
      amountCents: leg.amountCents.toString()
    };
  }

  private async applyFundingProjection(
    tx: Prisma.TransactionClient,
    movement: MovementRow,
    relationships: readonly Prisma.FundMovementRelationshipEntryGetPayload<Prisma.FundMovementRelationshipEntryDefaultArgs>[],
    actorUserId: string,
    occurredAt: Date
  ): Promise<void> {
    const amountCents = movement.projectFundUsedCents;
    if (amountCents <= 0n) return;

    if (movement.kind === "cross_project_payment") {
      // A bank payment's project-funding allocation belongs to the payment
      // execution's beneficiary project.  This movement is a separate source
      // project projection and must append its own debit, never reinterpret
      // or reuse the payment-execution allocation as the source debit.
      await this.funding.allocateExecution(tx, {
        projectId: movement.sourceProjectId,
        executionType: "fund_movement",
        executionId: movement.id,
        businessType: "fund_movement",
        businessId: movement.id,
        amountCents,
        occurredAt,
        actorUserId
      });
      return;
    }

    if (movement.kind === "same_project_company_transfer") {
      await this.assertProjectFundingAvailable(tx, movement.sourceProjectId, amountCents);
      return;
    }

    if (movement.kind === "temporary_project_fund_use") {
      await this.funding.allocateExecution(tx, {
        projectId: movement.sourceProjectId,
        executionType: "fund_movement",
        executionId: movement.id,
        businessType: "fund_movement",
        businessId: movement.id,
        amountCents,
        occurredAt,
        actorUserId
      });
      return;
    }

    if (movement.kind === "company_advance") {
      // A company advance is intentionally kept in the gross inter-company
      // payable ledger.  It does not consume a project-funding allocation.
      return;
    }

    if (movement.kind === "temporary_project_fund_return") {
      const relationship = relationships.find((entry) => entry.direction === "decrease");
      const originalId = relationship?.adjustsEntryId;
      if (!originalId) throw new ConflictException("资金归还缺少原始往来资金事实");
      const original = await tx.fundMovementRelationshipEntry.findUnique({
        where: { id: originalId },
        select: { movementId: true }
      });
      if (!original) throw new ConflictException("资金归还原始往来不存在");
      await this.funding.reverseExecution(tx, {
        projectId: movement.sourceProjectId,
        executionType: "fund_movement",
        executionId: original.movementId,
        amountCents,
        occurredAt,
        reversalKey: movement.id,
        reason: movement.kind === "temporary_project_fund_return" ? "临时使用归还" : "公司垫资收回",
        actorUserId
      });
      return;
    }

    if (movement.kind === "company_advance_recovery") {
      // Recovery spends project funds and reduces the outstanding advance. It
      // is a new debit for this movement, never a reversal of the original
      // company-advance movement (which deliberately had no project-funding
      // allocation).
      await this.funding.allocateExecution(tx, {
        projectId: movement.beneficiaryProjectId,
        executionType: "fund_movement",
        executionId: movement.id,
        businessType: "fund_movement",
        businessId: movement.id,
        amountCents,
        occurredAt,
        actorUserId
      });
      return;
    }

    throw new ConflictException("资金移动用途未配置项目资金投影");
  }

  private async assertProjectFundingAvailable(
    tx: Prisma.TransactionClient,
    projectId: string,
    amountCents: bigint
  ): Promise<void> {
    const coverage = await this.funding.assertPersistedProjectFundingLedgerCoverage(tx, projectId);
    const projectCashAvailable = coverage.projectCashSourceAmountCents -
      (coverage.allocationSummary.netUsedBySource.get("project_cash") ?? 0n);
    const quotas = await tx.projectFinancingQuota.findMany({
      where: { projectId, status: "approved", OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
      select: { id: true, amountCents: true }
    });
    const quotaAvailable = quotas.reduce((total, quota) => {
      const key = `financing_quota:${quota.id}`;
      return total + BigInt(quota.amountCents) - (coverage.allocationSummary.netUsedBySource.get(key) ?? 0n);
    }, 0n);
    if (amountCents > projectCashAvailable + quotaAvailable) {
      throw new ConflictException("项目可用资金不足，不能确认资金移动");
    }
  }

  private async appendLegFact(
    tx: Prisma.TransactionClient,
    movement: MovementRow,
    leg: MovementLegRow,
    actorUserId: string,
    occurredAt: Date,
    confirmedAt: Date,
    paymentExecutionContext: PaymentExecutionContext | null
  ) {
    const [project, affiliate, participant, sourceCompanyParticipant, beneficiaryCompanyParticipant] = await Promise.all([
      tx.project.findUnique({ where: { id: leg.projectId }, select: { isActive: true, operatingLedgerEffectiveDate: true } }),
      tx.projectAffiliateAssignment.findFirst({
        where: { projectId: leg.projectId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
        select: { id: true, businessPartyVersionId: true, affiliateNameSnapshot: true, affiliateCreditCodeSnapshot: true }
      }),
      tx.projectParticipatingCompany.findFirst({
        where: { projectId: leg.projectId, companyEntityId: leg.companyEntityId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { companyEntityId: true }
      }),
      tx.projectParticipatingCompany.findFirst({
        where: { projectId: leg.projectId, companyEntityId: movement.sourceCompanyEntityId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { companyEntityId: true }
      }),
      tx.projectParticipatingCompany.findFirst({
        where: { projectId: leg.projectId, companyEntityId: movement.beneficiaryCompanyEntityId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { companyEntityId: true }
      })
    ]);
    if (!project?.isActive || !project.operatingLedgerEffectiveDate) throw new ConflictException("项目尚未启用经营账，不能确认资金移动");
    if (!affiliate) throw new ConflictException("项目缺少当前有效施工企业快照，不能确认资金移动");
    if (!participant) throw new ConflictException("资金移动公司未在项目事实日参与，请刷新后重试");

    // The fact envelope must keep the canonical payer identities.  Replacing
    // a payer that is outside this leg's project with the leg participant
    // would create a false debtor/creditor and make the operating fact lie
    // about who paid or approved the payment.  Refuse the projection instead.
    const actualPayerCompanyId = paymentExecutionContext?.payerCompanyEntityId ?? movement.sourceCompanyEntityId;
    const approvedPayerCompanyId = paymentExecutionContext?.approvedPayerCompanyId ?? movement.sourceCompanyEntityId;
    const actualPayer = actualPayerCompanyId === movement.sourceCompanyEntityId && sourceCompanyParticipant
      ? actualPayerCompanyId
      : actualPayerCompanyId === movement.beneficiaryCompanyEntityId && beneficiaryCompanyParticipant
        ? actualPayerCompanyId
        : null;
    // The beneficiary company is the only canonical payee for a movement
    // fact.  Falling back to the leg participant would silently substitute a
    // different debtor/payee when that company is not participating in the
    // project, which would make the operating fact claim a false subject.
    if (!beneficiaryCompanyParticipant) {
      throw new ConflictException("受益付款主体无法在项目事实范围表达");
    }
    const payee = movement.beneficiaryCompanyEntityId;
    const approvedPayer = approvedPayerCompanyId === movement.sourceCompanyEntityId && sourceCompanyParticipant
      ? approvedPayerCompanyId
      : approvedPayerCompanyId === movement.beneficiaryCompanyEntityId && beneficiaryCompanyParticipant
        ? approvedPayerCompanyId
        : null;
    if (!actualPayer) {
      throw new ConflictException("实际付款主体无法在项目事实范围表达");
    }
    if (!approvedPayer) {
      throw new ConflictException("批准付款主体无法在项目事实范围表达");
    }
    const debtor = payee;
    const creditor = actualPayer;
    const costBearingCompany = leg.role === "source" ? actualPayer : payee;

    const sourceBusinessId = leg.id;
    const direction = leg.direction === "decrease" ? "outflow" : leg.direction === "increase" ? "inflow" : "neutral";
    const impacts: OperatingImpactInput[] = [];
    // Only the source project-fund component changes the project-funds
    // balance for inter-project/temporary/advance movements. A same-project
    // holding transfer is the one exception: both legs carry equal and
    // opposite holder-location impacts so the project consolidated balance
    // remains unchanged.
    const projectFundsImpactAmount = movement.kind === "same_project_company_transfer"
      ? leg.amountCents
      : movement.kind === "company_advance_recovery"
        ? leg.role === "beneficiary" ? movement.projectFundUsedCents : 0n
      : leg.role === "source"
        ? movement.projectFundUsedCents
        : 0n;
    if (projectFundsImpactAmount > 0n && leg.direction === "decrease") {
      impacts.push({
        idempotencyKey: `fund_movement:${leg.id}:funds`,
        sourceImpactKey: "project_funds",
        impactKind: "company_project_funds_decrease",
        amountCents: projectFundsImpactAmount,
        direction: "decrease",
        subjectRole: "actual_payer",
        subject: { kind: "participating_company", id: leg.companyEntityId },
        description: "项目资金移动",
        impactSnapshot: jsonObject({ movementId: movement.id, legId: leg.id, role: leg.role })
      });
    } else if (projectFundsImpactAmount > 0n && leg.direction === "increase") {
      impacts.push({
        idempotencyKey: `fund_movement:${leg.id}:funds`,
        sourceImpactKey: "project_funds",
        impactKind: "company_project_funds_increase",
        amountCents: projectFundsImpactAmount,
        direction: "increase",
        subjectRole: "payee",
        subject: { kind: "participating_company", id: leg.companyEntityId },
        description: "项目资金移动",
        impactSnapshot: jsonObject({ movementId: movement.id, legId: leg.id, role: leg.role })
      });
    }
    const carriesRelationship = movement.kind !== "same_project_company_transfer" &&
      movement.kind !== "profit_distribution_execution";
    if (carriesRelationship && leg.direction !== "neutral") {
      impacts.push({
        idempotencyKey: `fund_movement:${leg.id}:relationship`,
        sourceImpactKey: "internal_relationship",
        impactKind: leg.direction === "decrease"
          ? "inter_subject_balance_increase"
          : "inter_subject_balance_decrease",
        amountCents: leg.amountCents,
        direction: leg.direction === "decrease" ? "increase" : "decrease",
        subjectRole: leg.role === "source" ? "actual_payer" : "payee",
        subject: { kind: "participating_company", id: leg.companyEntityId },
        description: movement.kind === "cross_project_payment" ? "项目间往来移动" : "项目内主体往来移动",
        impactSnapshot: jsonObject({ movementId: movement.id, legId: leg.id, role: leg.role })
      });
      if (
        leg.role === "beneficiary" &&
        (movement.kind === "company_advance" || movement.kind === "company_advance_recovery")
      ) {
        impacts.push({
          idempotencyKey: `fund_movement:${leg.id}:payable`,
          sourceImpactKey: "company_advance_payable",
          impactKind: leg.direction === "increase" ? "payable_increase" : "payable_decrease",
          amountCents: leg.amountCents,
          direction: leg.direction === "increase" ? "increase" : "decrease",
          subjectRole: "payee",
          subject: { kind: "participating_company", id: leg.companyEntityId },
          description: movement.kind === "company_advance" ? "公司垫资形成内部应付" : "公司垫资收回冲减内部应付",
          impactSnapshot: jsonObject({ movementId: movement.id, legId: leg.id })
        });
      }
      if (leg.role === "beneficiary" && movement.kind === "cross_project_payment") {
        impacts.push({
          idempotencyKey: `fund_movement:${leg.id}:payable`,
          sourceImpactKey: "payable_settlement",
          impactKind: "payable_decrease",
          amountCents: leg.amountCents,
          direction: "decrease",
          subjectRole: "payee",
          subject: { kind: "participating_company", id: leg.companyEntityId },
          description: "受益项目核销应付",
          impactSnapshot: jsonObject({ movementId: movement.id, legId: leg.id })
        });
      }
    }

    const factSourceSnapshot = paymentExecutionContext
      ? this.paymentExecutionLegSnapshot(leg, paymentExecutionContext)
      : {
          authority: "fund_movement",
          movementId: movement.id,
          legId: leg.id,
          kind: movement.kind,
          role: leg.role,
          projectId: leg.projectId,
          companyEntityId: leg.companyEntityId,
          amountCents: leg.amountCents.toString()
        };
    const input: AppendOperatingFactInput = {
      projectId: leg.projectId,
      sourceType: "fund_movement_leg",
      sourceBusinessId,
      sourceBusinessCode: `FUND-${movement.id.slice(0, 8)}-${leg.legNo}`,
      sourceVersion: movement.revision,
      idempotencyKey: `fund_movement:${leg.id}`,
      occurredAt,
      confirmedAt,
      confirmedByUserId: actorUserId,
      factKind: "fund_movement",
      operatingLevel: "inter_subject",
      evidenceLevel: "A",
      amountCents: leg.amountCents,
      currencyCode: "CNY",
      direction,
      isBeforeOperatingLedgerEffectiveDate: !sameDate(occurredAt, project.operatingLedgerEffectiveDate) && occurredAt < project.operatingLedgerEffectiveDate,
      affiliateAssignmentId: affiliate.id,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.affiliateNameSnapshot,
      affiliateCreditCodeSnapshot: affiliate.affiliateCreditCodeSnapshot ?? undefined,
      sourceSnapshot: jsonObject({
        movementId: movement.id,
        legId: leg.id,
        kind: movement.kind,
        role: leg.role,
        projectId: leg.projectId,
        companyEntityId: leg.companyEntityId,
        amountCents: leg.amountCents.toString(),
        sourceSnapshot: factSourceSnapshot
      }),
      // `fund_movement` facts use the frozen movement envelope rather than
      // copying the same leg company into every subject slot.  Each leg keeps
      // the source/beneficiary relation in the ledger-safe project scope.
      subjects: {
        debtor: { kind: "participating_company", id: debtor },
        creditor: { kind: "participating_company", id: creditor },
        approvedPayer: { kind: "participating_company", id: approvedPayer },
        actualPayer: { kind: "participating_company", id: actualPayer },
        payee: { kind: "participating_company", id: payee },
        costBearingCompany: { kind: "participating_company", id: costBearingCompany }
      },
      impacts
    };
    return this.ledger.appendConfirmedSourceInTransaction(tx, input, actorUserId);
  }

  private assertRelationshipLineage(
    movement: MovementRow,
    legs: readonly MovementLegRow[],
    relationships: readonly Prisma.FundMovementRelationshipEntryGetPayload<Prisma.FundMovementRelationshipEntryDefaultArgs>[]
  ) {
    if (movement.kind === "same_project_company_transfer") {
      if (relationships.length > 0) {
        throw new ConflictException("同项目持有调拨不得形成主体间往来");
      }
      return;
    }
    if (relationships.length !== 1) {
      throw new ConflictException("资金移动必须恰好有一条往来分录");
    }
    const relationship = relationships[0];
    const sourceLeg = legs.find((leg) => leg.role === "source");
    if (
      !sourceLeg ||
      relationship.legId !== sourceLeg.id ||
      sourceLeg.relationshipEntryId !== relationship.id ||
      relationship.status !== "draft" ||
      relationship.sourceProjectId !== movement.sourceProjectId ||
      relationship.beneficiaryProjectId !== movement.beneficiaryProjectId ||
      relationship.amountCents !== movement.paymentAmountCents ||
      relationship.debtorCompanyEntityId !== movement.beneficiaryCompanyEntityId ||
      relationship.creditorCompanyEntityId !== movement.sourceCompanyEntityId
    ) {
      throw new ConflictException("资金移动往来主体、项目或金额快照不一致");
    }
    const expectedRelationship = movement.kind === "cross_project_payment"
      ? { entryKind: "project_internal_receivable", direction: "increase", adjusts: false }
      : movement.kind === "temporary_project_fund_use"
        ? { entryKind: "temporary_project_fund_use", direction: "increase", adjusts: false }
        : movement.kind === "temporary_project_fund_return"
          ? { entryKind: "temporary_project_fund_return", direction: "decrease", adjusts: true }
          : movement.kind === "company_advance"
            ? { entryKind: "company_advance", direction: "increase", adjusts: false }
            : { entryKind: "company_advance_recovery", direction: "decrease", adjusts: true };
    if (
      relationship.entryKind !== expectedRelationship.entryKind ||
      relationship.direction !== expectedRelationship.direction ||
      (expectedRelationship.adjusts
        ? relationship.adjustsEntryId === null
        : relationship.adjustsEntryId !== null)
    ) {
      throw new ConflictException("资金移动往来类型、方向或调整链不一致");
    }
    if (movement.kind === "cross_project_payment") {
      if (
        relationship.sourceType === null ||
        relationship.sourceAggregateId === null ||
        relationship.sourceAllocationCount === null ||
        relationship.sourceAllocationAmountCents !== relationship.amountCents ||
        relationship.contractId === null ||
        relationship.contractVersionId === null
      ) {
        throw new ConflictException("跨项目支付往来缺少来源、合同或分摊快照");
      }
    }
  }

  private async assertRelationshipAdjustmentsAvailable(
    tx: Prisma.TransactionClient,
    movement: MovementRow,
    relationships: readonly Prisma.FundMovementRelationshipEntryGetPayload<Prisma.FundMovementRelationshipEntryDefaultArgs>[]
  ) {
    for (const relationship of relationships) {
      if (relationship.direction !== "decrease") continue;
      if (!relationship.adjustsEntryId) {
        throw new ConflictException("负向往来必须引用原始往来");
      }
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "FundMovementRelationshipEntry"
        WHERE "id" = ${relationship.adjustsEntryId}
        FOR UPDATE
      `);
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "FundMovementRelationshipEntry"
        WHERE "adjustsEntryId" = ${relationship.adjustsEntryId}
        ORDER BY "id" ASC
        FOR UPDATE
      `);
      const original = await tx.fundMovementRelationshipEntry.findUnique({
        where: { id: relationship.adjustsEntryId },
        select: {
          id: true,
          movementId: true,
          entryKind: true,
          direction: true,
          status: true,
          sourceProjectId: true,
          beneficiaryProjectId: true,
          debtorCompanyEntityId: true,
          creditorCompanyEntityId: true,
          amountCents: true
        }
      });
      const expectedKind = movement.kind === "temporary_project_fund_return"
        ? "temporary_project_fund_use"
        : movement.kind === "company_advance_recovery"
          ? "company_advance"
          : null;
      if (
        !original ||
        original.status !== "confirmed" ||
        original.direction !== "increase" ||
        (expectedKind !== null && original.entryKind !== expectedKind) ||
        original.sourceProjectId !== relationship.sourceProjectId ||
        original.beneficiaryProjectId !== relationship.beneficiaryProjectId ||
        original.debtorCompanyEntityId !== relationship.debtorCompanyEntityId ||
        original.creditorCompanyEntityId !== relationship.creditorCompanyEntityId
      ) {
        throw new ConflictException("被调整往来不存在、未确认或主体范围不一致");
      }
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "FundMovement"
        WHERE "id" = ${original.movementId}
        FOR UPDATE
      `);
      const consumed = await tx.fundMovementRelationshipEntry.aggregate({
        where: {
          adjustsEntryId: original.id,
          status: "confirmed",
          direction: "decrease",
          id: { not: relationship.id }
        },
        _sum: { amountCents: true }
      });
      if ((consumed._sum.amountCents ?? 0n) + relationship.amountCents > original.amountCents) {
        throw new ConflictException("归还或收回金额超过未结往来余额");
      }
    }
  }

  private async lockMovement(tx: Prisma.TransactionClient, movementId: string, includeRelations = false): Promise<MovementRow> {
    const id = requiredText(movementId, "资金移动标识不能为空");
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "FundMovement" WHERE "id" = ${id} FOR UPDATE`);
    if (!rows.length) throw new NotFoundException("资金移动不存在");
    return tx.fundMovement.findUniqueOrThrow({
      where: { id },
      include: includeRelations ? { legs: { orderBy: { legNo: "asc" } }, relationshipEntries: { orderBy: { createdAt: "asc" } } } : undefined
    }) as Promise<MovementRow>;
  }

  private async lockIdempotency(tx: Prisma.TransactionClient, idempotencyKey: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fund-movement:${idempotencyKey}`}, 0))`);
  }

  /**
   * Read only the existing global standing delegations.  Scoped approval
   * assignments are already frozen on ApprovalActionLog; this query covers
   * the standing identity relationship used by the #106 SoD rule.  Both ends
   * must still be active at the command transaction's read point.
   */
  private async loadActiveFundMovementDelegations(
    tx: Prisma.TransactionClient
  ): Promise<ActiveFundMovementDelegation[]> {
    const now = new Date();
    const rows = await tx.approvalDelegation.findMany({
      where: {
        actionKey: null,
        resourceType: null,
        resourceId: null,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      select: { fromUserId: true, toUserId: true }
    });
    if (!rows.length) return [];

    const userIds = Array.from(new Set(rows.flatMap((row) => [row.fromUserId, row.toUserId])));
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, isActive: true }
    });
    const activeUserIds = new Set(
      users.filter((user) => user.isActive).map((user) => user.id)
    );
    return rows.filter((row) => activeUserIds.has(row.fromUserId) && activeUserIds.has(row.toUserId));
  }

  private assertFundMovementSeparation(
    actorIdentityIds: ReadonlySet<string>,
    participants: readonly (string | null | undefined)[],
    activeDelegations: readonly ActiveFundMovementDelegation[],
    message: string
  ): void {
    const participantIdentityIds = new Set<string>();
    for (const participant of participants) {
      if (!participant) continue;
      for (const identity of delegationIdentitySet(participant, activeDelegations)) {
        participantIdentityIds.add(identity);
      }
    }
    if (identitySetsOverlap(actorIdentityIds, participantIdentityIds)) {
      throw new ForbiddenException(message);
    }
  }

  private async authorizeFundMovementWriteContext(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ): Promise<void> {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (!secret) {
      throw new ForbiddenException("资金移动受控写入密钥未配置");
    }
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${requiredText(actorUserId, "资金移动操作人不能为空")}, ${secret})`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_movement_actor', ${requiredText(actorUserId, "资金移动操作人不能为空")}, true)`
    );
  }

  private async assertGlobalFinanceWriter(actorUserId: string): Promise<string[]> {
    let roleKeys: readonly string[];
    try {
      roleKeys = await this.roles.resolveActiveRoleScopes(actorUserId);
    } catch {
      throw new ForbiddenException("当前账号不具备全系统财务资金移动权限");
    }
    if (roleKeys.includes("super_admin") || !roleKeys.some((role) => role === "finance_staff" || role === "finance_director")) {
      throw new ForbiddenException("只有全系统财务人员可以办理资金移动");
    }
    return [...roleKeys];
  }

  /**
   * Re-resolve the actor from the transaction snapshot immediately before a
   * command may write.  The request guard and the injected resolver are only
   * a preflight; they cannot protect against a role revocation racing the
   * command transaction.  Deliberately read global UserPosition rows only so
   * a project-scoped finance position can never authorize this aggregate.
   */
  private async assertGlobalFinanceWriterInTransaction(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ): Promise<string[]> {
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { isActive: true }
    });
    if (!actor?.isActive) {
      throw new ForbiddenException("当前账号不具备全系统财务资金移动权限");
    }

    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null },
      select: { positionId: true }
    });
    const positionIds = [...new Set(assignments.map((assignment) => assignment.positionId))];
    if (!positionIds.length) {
      throw new ForbiddenException("当前账号不具备全系统财务资金移动权限");
    }
    const positions = await tx.position.findMany({
      where: { id: { in: positionIds } },
      select: { id: true, key: true }
    });
    if (positions.length !== positionIds.length) {
      throw new ForbiddenException("当前账号岗位数据异常，不能办理资金移动");
    }
    const positionById = new Map(positions.map((position) => [position.id, position.key]));
    const roleKeys = positionIds.map((positionId) => positionById.get(positionId));
    if (roleKeys.some((roleKey) =>
      typeof roleKey !== "string" || !GLOBAL_USER_POSITION_ROLE_KEYS.includes(roleKey as RoleKey)
    )) {
      throw new ForbiddenException("当前账号岗位数据异常，不能办理资金移动");
    }
    const resolved = [...new Set(roleKeys as RoleKey[])].sort();
    if (
      resolved.includes("super_admin") ||
      !resolved.some((role) => role === "finance_staff" || role === "finance_director")
    ) {
      throw new ForbiddenException("只有全系统财务人员可以办理资金移动");
    }
    return resolved;
  }

  private async assertGlobalFinanceDirector(actorUserId: string): Promise<string[]> {
    const roles = await this.assertGlobalFinanceWriter(actorUserId);
    if (!roles.includes("finance_director")) throw new ForbiddenException("只有全系统财务负责人可以确认资金移动");
    return roles;
  }

  private async assertGlobalFinanceDirectorInTransaction(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ): Promise<string[]> {
    const roles = await this.assertGlobalFinanceWriterInTransaction(tx, actorUserId);
    if (!roles.includes("finance_director")) {
      throw new ForbiddenException("只有全系统财务负责人可以确认资金移动");
    }
    return roles;
  }

  private async serializable<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException("资金移动并发写入未能完成，请刷新后重试");
  }

  private readModel(row: MovementRow) {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      revision: row.revision,
      sourceProjectId: row.sourceProjectId,
      beneficiaryProjectId: row.beneficiaryProjectId,
      sourceCompanyEntityId: row.sourceCompanyEntityId,
      beneficiaryCompanyEntityId: row.beneficiaryCompanyEntityId,
      paymentAmountCents: row.paymentAmountCents.toString(),
      projectFundUsedCents: row.projectFundUsedCents.toString(),
      companyAdvanceCents: row.companyAdvanceCents.toString(),
      paymentExecutionId: row.paymentExecutionId,
      legs: (row.legs ?? []).map((leg) => ({
        id: leg.id,
        legNo: leg.legNo,
        role: leg.role,
        projectId: leg.projectId,
        companyEntityId: leg.companyEntityId,
        direction: leg.direction,
        amountCents: leg.amountCents.toString(),
        operatingFactId: leg.operatingFactId
      })),
      relationshipEntries: (row.relationshipEntries ?? []).map((entry) => ({
        id: entry.id,
        entryKind: entry.entryKind,
        direction: entry.direction,
        status: entry.status,
        amountCents: entry.amountCents.toString()
      })),
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null
    };
  }
}
