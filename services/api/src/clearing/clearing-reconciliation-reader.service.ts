import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  reduceClearingReconciliationRisk
} from "@jiangkong/shared-domain";

import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";

type ReaderInput = {
  projectId: string;
  asOf?: Date;
};

@Injectable()
export class ClearingReconciliationReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService
  ) {}

  async readClearingReconciliationRiskForActor(
    actorUserId: string,
    input: ReaderInput
  ) {
    assertReaderInput(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const roleScopes = await this.roles.resolveActiveRoleScopesInTransaction(
        tx,
        actorUserId
      );
      if (!canPerform("clearing.read", roleScopes)) {
        throw new ForbiddenException("当前岗位无权读取清算核对风险");
      }
      const result = await this.readClearingReconciliationRiskInTransaction(tx, input);
      return {
        projectId: result.projectId,
        asOf: result.asOf,
        relationshipCompleteness: result.relationshipCompleteness,
        relationshipCompletenessLabel: completenessLabel(
          result.relationshipCompleteness
        ),
        openPendingGrossCents: centsOrNull(result.openPendingGrossCents),
        openCoveredCents: centsOrNull(result.openCoveredCents),
        openUncoveredCents: centsOrNull(result.openUncoveredCents),
        continuedWithheldRetainedCents: centsOrNull(
          result.continuedWithheldRetainedCents
        ),
        items: result.items.map((item) => ({
          openAmountCents: item.openAmountCents.toString(),
          openCoveredCents: item.openCoveredCents.toString(),
          openUncoveredCents: item.openUncoveredCents.toString(),
          status: item.status,
          statusLabel: itemStatusLabel(item.status)
        }))
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }

  async readClearingReconciliationRiskInTransaction(
    tx: Prisma.TransactionClient,
    input: ReaderInput
  ) {
    assertReaderInput(input);
    const asOf = input.asOf ?? (await tx.$queryRaw<Array<{ asOf: Date }>>(Prisma.sql`
      SELECT CURRENT_TIMESTAMP AS "asOf"
    `))[0]?.asOf;
    if (!asOf) throw new ConflictException("数据库未返回核对读取时点");
    const projectFilter = {
      clearingCase: { projectId: input.projectId },
      confirmedAt: { lte: asOf }
    };
    const [
      legacyPendingEvents,
      revisions,
      coverages,
      resolutions,
      resolutionLines,
      definitionReversals
    ] = await Promise.all([
      tx.clearingEventVersion.findMany({
        where: {
          clearingEvent: {
            kind: "pending_reconciliation",
            clearingCase: { projectId: input.projectId }
          },
          confirmation: { confirmedAt: { lte: asOf } }
        },
        select: {
          id: true,
          confirmation: { select: { confirmedAt: true } }
        },
        orderBy: { id: "asc" }
      }),
      tx.clearingReconciliationRevision.findMany({
        where: projectFilter,
        select: {
          id: true,
          itemId: true,
          decisionEventVersionId: true,
          adoptsLegacyPendingEventVersionId: true,
          revisionNo: true,
          kind: true,
          amountCents: true,
          replacesRevisionId: true,
          confirmedAt: true,
          effectiveCaseRevision: true
        },
        orderBy: [
          { confirmedAt: "asc" },
          { effectiveCaseRevision: "asc" },
          { id: "asc" }
        ]
      }),
      tx.clearingReconciliationCoverage.findMany({
        where: projectFilter,
        select: {
          id: true,
          reconciliationRevisionId: true,
          withheldEventVersionId: true,
          amountCents: true,
          confirmedAt: true,
          effectiveCaseRevision: true
        },
        orderBy: [
          { confirmedAt: "asc" },
          { effectiveCaseRevision: "asc" },
          { id: "asc" }
        ]
      }),
      tx.clearingReconciliationResolution.findMany({
        where: projectFilter,
        select: {
          id: true,
          reconciliationRevisionId: true,
          itemId: true,
          entryKind: true,
          resultKind: true,
          amountCents: true,
          reversesResolutionId: true,
          confirmedAt: true,
          effectiveCaseRevision: true
        },
        orderBy: [
          { confirmedAt: "asc" },
          { effectiveCaseRevision: "asc" },
          { id: "asc" }
        ]
      }),
      tx.clearingReconciliationResolutionLine.findMany({
        where: {
          clearingCase: { projectId: input.projectId },
          resolution: { confirmedAt: { lte: asOf } }
        },
        select: {
          id: true,
          resolutionId: true,
          sourceKind: true,
          coverageId: true,
          amountCents: true,
          reversesResolutionLineId: true
        },
        orderBy: [{ resolutionId: "asc" }, { intentLineNo: "asc" }, { id: "asc" }]
      }),
      tx.clearingReconciliationDefinitionReversal.findMany({
        where: projectFilter,
        select: {
          id: true,
          targetRevisionId: true,
          confirmedAt: true,
          effectiveCaseRevision: true
        },
        orderBy: [
          { confirmedAt: "asc" },
          { effectiveCaseRevision: "asc" },
          { id: "asc" }
        ]
      })
    ]);

    const result = reduceClearingReconciliationRisk({
      asOf: asOf.toISOString(),
      legacyPendingEvents: legacyPendingEvents.map((row) => ({
        eventVersionId: row.id,
        confirmedAt: row.confirmation!.confirmedAt.toISOString()
      })),
      revisions: revisions.map((row) => ({
        ...row,
        kind: reconciliationRevisionKind(row.kind),
        confirmedAt: row.confirmedAt.toISOString()
      })),
      coverages: coverages.map((row) => ({
        ...row,
        confirmedAt: row.confirmedAt.toISOString()
      })),
      resolutions: resolutions.map((row) => ({
        ...row,
        entryKind: reconciliationEntryKind(row.entryKind),
        resultKind: reconciliationResultKind(row.resultKind),
        confirmedAt: row.confirmedAt.toISOString()
      })),
      resolutionLines: resolutionLines.map((row) => ({
        ...row,
        sourceKind: reconciliationSourceKind(row.sourceKind)
      })),
      definitionReversals: definitionReversals.map((row) => ({
        ...row,
        confirmedAt: row.confirmedAt.toISOString()
      }))
    });
    return { projectId: input.projectId, ...result };
  }
}

function assertReaderInput(input: ReaderInput): void {
  if (!input.projectId.trim()) throw new BadRequestException("项目不能为空");
  if (
    input.asOf !== undefined &&
    (!(input.asOf instanceof Date) || !Number.isFinite(input.asOf.getTime()))
  ) {
    throw new BadRequestException("asOf 时间无效");
  }
}

function reconciliationRevisionKind(value: string): "open" | "replace" {
  if (value !== "open" && value !== "replace") {
    throw new ConflictException("核对 revision kind 完整性冲突");
  }
  return value;
}

function reconciliationEntryKind(value: string): "resolution" | "technical_reversal" {
  if (value !== "resolution" && value !== "technical_reversal") {
    throw new ConflictException("核对 resolution entryKind 完整性冲突");
  }
  return value;
}

function reconciliationResultKind(
  value: string
): "final_confirmed" | "real_return" | "continued_withheld" {
  if (
    value !== "final_confirmed" &&
    value !== "real_return" &&
    value !== "continued_withheld"
  ) {
    throw new ConflictException("核对 resolution resultKind 完整性冲突");
  }
  return value;
}

function reconciliationSourceKind(
  value: string
): "withheld_coverage" | "authority_cap" | "prior_economic_event" {
  if (
    value !== "withheld_coverage" &&
    value !== "authority_cap" &&
    value !== "prior_economic_event"
  ) {
    throw new ConflictException("核对 resolution sourceKind 完整性冲突");
  }
  return value;
}

function centsOrNull(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function completenessLabel(
  value: "complete" | "coverage_incomplete" | "legacy_unmodeled" | "integrity_conflict"
): string {
  return {
    complete: "核对关系完整",
    coverage_incomplete: "覆盖尚不完整",
    legacy_unmodeled: "存在尚未建模的历史待核对",
    integrity_conflict: "核对关系完整性冲突"
  }[value];
}

function itemStatusLabel(
  value: "open" | "partially_resolved" | "resolved" | "definition_reversed_error"
): string {
  return {
    open: "待解决",
    partially_resolved: "部分解决",
    resolved: "已解决",
    definition_reversed_error: "定义已技术反向"
  }[value];
}
