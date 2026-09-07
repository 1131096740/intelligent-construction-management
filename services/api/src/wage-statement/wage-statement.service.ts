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
  canPerform,
  WAGE_COST_COMPONENT_CODES,
  WAGE_CREDITOR_CATEGORIES
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { lockWageConflictBuckets } from "../clearing/wage-conflict-lock";
import { PrismaService } from "../database/prisma.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import {
  assertBalancedWageStatementDraft,
  type WagePersonLineInput,
  type WageProjectCostComponentAllocationInput,
  type WageProjectCreditorAllocationInput
} from "./wage-statement.domain";
import type {
  ApprovedWagePersonDto,
  CreateApprovedWageSourceDto,
  CreateWageStatementDraftDto,
  CreateWageStatementRevisionDto,
  ReturnWageStatementDto,
  UpdateWageStatementDraftDto,
  WageStatementWorkbenchQueryDto,
  WageStatementCommandDto
} from "./wage-statement.dto";

type Tx = Prisma.TransactionClient;

const SHA256 = /^[0-9a-f]{64}$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_WAGE_PERSON_LINES = 500;
const MAX_WAGE_DETAIL_ROWS_PER_PERSON = 100;
const MAX_WAGE_MATRIX_CELLS_PER_PERSON = 10_000;

type ActiveApprovalDelegationEdge = { fromUserId: string; toUserId: string };

function delegationIdentitySet(
  userId: string,
  delegations: ActiveApprovalDelegationEdge[]
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

// Aggregate reads select only category snapshots and allocation-row identifiers to
// derive counts. Employee identities, monetary values, attachments and source
// snapshots never enter these queries or their API projections.
const WAGE_AGGREGATE_SELECT = {
  id: true,
  employmentCompanyId: true,
  wageMonth: true,
  currentRevision: true,
  updatedAt: true,
  versions: {
    select: {
      revision: true,
      status: true,
      reviewDisposition: true,
      reviewReturnedAt: true,
      sourceVersion: { select: { externalReference: true, sourceVersion: true } },
      personLines: {
        select: {
          positionCategorySnapshot: true,
          projectAllocations: { select: { id: true, projectId: true } }
        }
      }
    }
  }
} satisfies Prisma.WageStatementSelect;

type WageAggregateStatement = Prisma.WageStatementGetPayload<{ select: typeof WAGE_AGGREGATE_SELECT }>;

// The paged workbench never hydrates person/allocation rows.  It needs only
// the current header and, at most, its immediately preceding returned header;
// counts are computed by one grouped PostgreSQL query below.
const WAGE_WORKBENCH_SELECT = {
  id: true,
  employmentCompanyId: true,
  wageMonth: true,
  currentRevision: true,
  updatedAt: true,
  versions: {
    orderBy: { revision: "desc" as const },
    take: 2,
    select: {
      id: true,
      revision: true,
      status: true,
      reviewDisposition: true,
      reviewReturnedAt: true,
      sourceVersion: { select: { externalReference: true, sourceVersion: true } }
    }
  }
} satisfies Prisma.WageStatementSelect;

type WageWorkbenchStatement = Prisma.WageStatementGetPayload<{ select: typeof WAGE_WORKBENCH_SELECT }>;
type WageWorkbenchCountRow = {
  statementVersionId: string;
  personLineCount: bigint;
  positionCategoryCount: bigint;
  projectAllocationCount: bigint;
};

const WAGE_CONFIRMATION_INCLUDE = {
  sourceVersion: true,
  personLines: {
    include: {
      costComponents: { include: { projectAllocations: true } },
      creditorBreakdowns: { include: { projectAllocations: true } },
      projectAllocations: {
        include: {
          componentAllocations: { include: { costComponent: true } },
          creditorAllocations: { include: { creditorBreakdown: true } }
        }
      }
    }
  }
} satisfies Prisma.WageStatementVersionInclude;

type WageConfirmationVersion = Prisma.WageStatementVersionGetPayload<{
  include: typeof WAGE_CONFIRMATION_INCLUDE;
}>;
type WageConfirmationPerson = WageConfirmationVersion["personLines"][number];
type WageConfirmationAllocation = WageConfirmationPerson["projectAllocations"][number];
type WageConfirmationCostCell = WageConfirmationAllocation["componentAllocations"][number];
type WageConfirmationCreditorCell = WageConfirmationAllocation["creditorAllocations"][number];
type WageConfirmationCreditor = WageConfirmationPerson["creditorBreakdowns"][number];
type WageProjection = {
  amount: bigint;
  direction: "increase" | "decrease";
  kind: WageVersionKind;
  refs: string[];
  costs: Array<{ allocation: WageConfirmationAllocation; cell: WageConfirmationCostCell }>;
  payables: Array<{
    allocation: WageConfirmationAllocation;
    cell: WageConfirmationCreditorCell;
    ref: { id: string };
  }>;
};

type WagePayableRefAdjustmentTarget = {
  id: string;
  debtorCompanyId: string;
  costBearingCompanyId: string;
  projectId: string;
  projectAllocation: { serviceSnapshotId: string };
  personLine: { employeeId: string; employmentSnapshotId: string };
  creditorBreakdown: {
    creditorSubjectType: string | null;
    creditorSubjectIdentityKey: string | null;
    creditorCategory: string;
    creditorNameSnapshot: string | null;
    creditorUnifiedIdentitySnapshot: string | null;
    creditorVersionFingerprint: string | null;
  };
};

type WageVersionKind = "base" | "supplemental" | "correction" | "reversal";
type WageProjectionOrigin = "ordinary" | "historical_takeover_legacy_link";

export type HistoricalWageTakeoverPlanInput = {
  sourceVersionId: string;
  sourceFingerprint: string;
  /** Reuse the scope-frozen logical aggregate id while its base is unmaterialized. */
  reservedTargetWageStatementId?: string;
};

export type HistoricalWageTakeoverPlan = {
  targetWageStatementId: string;
  expectedCurrentRevision: number;
  reservedRevision: number;
  versionKind: "base" | "correction" | "reversal";
  priorConfirmedVersionId: string | null;
  priorSourceVersionId: string | null;
  sourceDeltaFingerprint: string;
  canonicalRootClosureFingerprint: string;
  canonicalRootPayableRefIds: string[];
  projects: Array<{
    projectId: string;
    signedCostDeltaCents: string;
    signedPayableDeltaCents: string;
  }>;
};

type HistoricalWageSemanticCell = {
  key: string;
  projectId: string;
  amountCents: bigint;
};

type HistoricalWageSemanticMatrix = {
  projectIds: string[];
  costs: Map<string, HistoricalWageSemanticCell>;
  payables: Map<string, HistoricalWageSemanticCell>;
};

type HistoricalWageRootRead = {
  id: string;
  amountCents: bigint;
  debtorCompanyId: string;
  costBearingCompanyId: string;
  projectId: string;
  projectAllocation: { serviceSnapshotId: string };
  personLine: { employeeId: string; employmentSnapshotId: string };
  creditorBreakdown: {
    creditorSubjectType: string | null;
    creditorSubjectIdentityKey: string | null;
    creditorCategory: string;
  };
  adjustments: Array<{ id: string; direction: string; amountCents: bigint }>;
};

/**
 * Internal-only confirmation contract consumed by OperatingTakeoverModule.
 * It deliberately accepts no client wage rows: the complete canonical matrix
 * is re-read from the frozen WageApprovedSourceVersion inside the caller's
 * already-open Serializable transaction.
 */
export type HistoricalWageTakeoverConfirmationInput = {
  atomicScopeVersionId: string;
  reservedVersionId: string;
  sourceVersionId: string;
  sourceFingerprint: string;
  expectedProjectIds: string[];
  sourceClosureFingerprint: string;
  targetWageStatementId: string;
  expectedCurrentRevision: number;
  reservedRevision: number;
  versionKind: "base" | "correction" | "reversal";
  priorConfirmedVersionId: string | null;
  priorSourceVersionId: string | null;
  sourceDeltaFingerprint: string;
  canonicalRootClosureFingerprint: string;
  actorUserId: string;
};

type HistoricalWageProjectionContext = Pick<
  HistoricalWageTakeoverConfirmationInput,
  | "atomicScopeVersionId"
  | "sourceVersionId"
  | "expectedProjectIds"
  | "sourceClosureFingerprint"
  | "targetWageStatementId"
  | "expectedCurrentRevision"
  | "reservedRevision"
  | "versionKind"
  | "priorConfirmedVersionId"
  | "priorSourceVersionId"
  | "sourceDeltaFingerprint"
  | "canonicalRootClosureFingerprint"
>;

type WageCostCellIdentity = {
  person: WageConfirmationPerson;
  allocation: WageConfirmationAllocation;
  cell: WageConfirmationCostCell;
  amountCents: bigint;
};
type WagePayableCellIdentity = {
  person: WageConfirmationPerson;
  allocation: WageConfirmationAllocation;
  cell: WageConfirmationCreditorCell;
  creditor: WageConfirmationCreditor;
  amountCents: bigint;
};
type WageDeltaProjection = {
  refs: string[];
  costs: Array<WageCostCellIdentity & { direction: "increase" | "decrease" }>;
  payables: Array<WagePayableCellIdentity & { direction: "increase" | "decrease"; ref: { id: string } }>;
};

type FullReversalBinding = {
  statementId: string;
  priorConfirmedVersionId: string;
  priorConfirmedRevision: number;
  priorSourceVersionId: string;
  rootClosureFingerprint: string;
  rootPayableRefIds: string[];
};

@Injectable()
export class WageStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyRoles: CompanyRoleResolverService,
    private readonly audit: AuditService = new AuditService(),
    private readonly operatingLedger?: OperatingLedgerService,
    private readonly projectVisibility?: ProjectVisibilityService
  ) {}

  /**
   * Read-only planning seam for #219 prepare. The caller runs this inside the
   * same Serializable transaction that will freeze the returned reservation.
   * No scope, receipt, wage version, matrix row, or payable reference is
   * written here, so an invalid lineage can safely be classified as C.
   */
  async planHistoricalTakeoverInTransaction(
    tx: Tx,
    input: HistoricalWageTakeoverPlanInput
  ): Promise<HistoricalWageTakeoverPlan> {
    if (!input.sourceVersionId.trim() || !SHA256.test(input.sourceFingerprint)) {
      throw new ConflictException("历史工资接管权威来源无效，不能规划 A 级闭合");
    }
    if (input.reservedTargetWageStatementId !== undefined && !input.reservedTargetWageStatementId.trim()) {
      throw new ConflictException("历史工资接管已冻结的目标工资承担单 ID 无效");
    }
    const source = await tx.wageApprovedSourceVersion.findUnique({
      where: { id: input.sourceVersionId }
    });
    if (!source || source.sourceFingerprint !== input.sourceFingerprint) {
      throw new ConflictException("历史工资接管权威来源已变化或不存在，不能规划 A 级闭合");
    }
    const sourceLines = historicalApprovedSourceLines(source);
    const evidence = await tx.fileObject.findUnique({
      where: { id: source.evidenceFileId },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    assertSourceEvidenceActive(source, evidence);
    const current = authorityMatrixIdentities(sourceLines);
    if (!current.projectIds.length) {
      throw new ConflictException("历史工资接管权威来源缺少完整项目闭合，不能规划 A 级闭合");
    }
    const target = await tx.wageStatement.findUnique({
      where: {
        employmentCompanyId_wageMonth: {
          employmentCompanyId: source.employmentCompanyId,
          wageMonth: source.wageMonth
        }
      },
      select: { id: true, currentRevision: true }
    });
    if (target && input.reservedTargetWageStatementId && target.id !== input.reservedTargetWageStatementId) {
      throw new ConflictException("历史工资接管已冻结的目标工资承担单已漂移");
    }
    const statement = target
      ? await this.lockStatement(tx, target.id)
      : {
          id: input.reservedTargetWageStatementId ?? randomUUID(),
          employmentCompanyId: source.employmentCompanyId,
          wageMonth: source.wageMonth,
          currentRevision: 0
        };
    if (target && (
      statement.employmentCompanyId !== source.employmentCompanyId ||
      statement.wageMonth !== source.wageMonth ||
      statement.currentRevision !== target.currentRevision
    )) {
      throw new ConflictException("历史工资接管目标工资承担单已漂移，不能规划 A 级闭合");
    }

    let prior: WageConfirmationVersion | null = null;
    if (statement.currentRevision > 0) {
      prior = await tx.wageStatementVersion.findUnique({
        where: {
          statementId_revision: {
            statementId: statement.id,
            revision: statement.currentRevision
          }
        },
        include: WAGE_CONFIRMATION_INCLUDE
      }) as WageConfirmationVersion | null;
      if (
        !prior ||
        prior.status !== "confirmed" ||
        prior.projectionOrigin !== "historical_takeover_legacy_link" ||
        !prior.sourceVersionId
      ) {
        throw new ConflictException("历史工资接管前置工资版本缺失或未确认，不能规划 A 级闭合");
      }
      for (const person of prior.personLines) this.assertCompleteStoredMatrices(person);
    }

    const previous = prior ? semanticMatrixFromConfirmedVersion(prior) : emptyHistoricalWageSemanticMatrix();
    if (prior) {
      assertExactHistoricalWageIdentities(current.costs, previous.costs, "成本组成");
      assertExactHistoricalWageIdentities(current.payables, previous.payables, "债权人");
    }
    const deltas = historicalWageSignedDeltas(current, previous);
    if (!prior && deltas.payables.every((delta) => delta.amountCents === 0n)) {
      throw new ConflictException("历史工资接管基础版本不能是全零权威快照");
    }
    const versionKind: HistoricalWageTakeoverPlan["versionKind"] = !prior
      ? "base"
      : [...current.costs.values(), ...current.payables.values()].every((cell) => cell.amountCents === 0n)
        ? "reversal"
        : "correction";

    const roots = prior
      ? await tx.wagePayableRef.findMany({
          where: {
            adjustsPayableRefId: null,
            direction: "increase",
            confirmedVersion: {
              statementId: statement.id,
              revision: { lte: statement.currentRevision },
              status: "confirmed",
              projectionOrigin: "historical_takeover_legacy_link"
            }
          },
          select: {
            id: true,
            amountCents: true,
            debtorCompanyId: true,
            costBearingCompanyId: true,
            projectId: true,
            projectAllocation: { select: { serviceSnapshotId: true } },
            personLine: { select: { employeeId: true, employmentSnapshotId: true } },
            creditorBreakdown: {
              select: {
                creditorSubjectType: true,
                creditorSubjectIdentityKey: true,
                creditorCategory: true
              }
            },
            adjustments: {
              select: { id: true, direction: true, amountCents: true },
              orderBy: { id: "asc" }
            }
          },
          orderBy: { id: "asc" }
        }) as HistoricalWageRootRead[]
      : [];
    const usedRoots = new Map<string, HistoricalWageRootRead & { effectiveAmountCents: bigint }>();
    for (const delta of deltas.payables) {
      if (delta.amountCents === 0n) continue;
      const matching = roots.filter((root) =>
        root.debtorCompanyId === source.employmentCompanyId &&
        root.costBearingCompanyId === source.employmentCompanyId &&
        wageRootIdentity(root) === delta.key
      );
      if (prior && matching.length !== 1) {
        throw new ConflictException("历史工资更正或冲销必须唯一指向同一不可变原始应付引用");
      }
      const root = matching[0];
      if (!root) continue;
      const effectiveAmountCents = historicalWageRootEffectiveAmount(root);
      if (effectiveAmountCents < 0n || effectiveAmountCents + delta.amountCents < 0n) {
        throw new ConflictException("历史工资更正或冲销会使原始应付引用有效金额低于零");
      }
      usedRoots.set(root.id, { ...root, effectiveAmountCents });
    }
    const rootClosure = [...usedRoots.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((root) => historicalWageRootReadSet(root));
    const projects = current.projectIds.map((projectId) => {
      const signedCostDeltaCents = historicalWageProjectDelta(deltas.costs, projectId);
      const signedPayableDeltaCents = historicalWageProjectDelta(deltas.payables, projectId);
      if (signedCostDeltaCents !== signedPayableDeltaCents) {
        throw new ConflictException("历史工资相邻版本的项目成本与债权差额未逐分闭合，不能规划 A 级闭合");
      }
      if (
        signedCostDeltaCents === 0n &&
        (deltas.costs.some((delta) => delta.projectId === projectId) ||
          deltas.payables.some((delta) => delta.projectId === projectId))
      ) {
        throw new ConflictException("历史工资相邻版本在同一项目存在净额为零的混合变动，无法一对一链接 legacy 影响");
      }
      return {
        projectId,
        signedCostDeltaCents: signedCostDeltaCents.toString(),
        signedPayableDeltaCents: signedPayableDeltaCents.toString()
      };
    });
    const priorConfirmedVersionId = prior?.id ?? null;
    const priorSourceVersionId = prior?.sourceVersionId ?? null;
    return {
      targetWageStatementId: statement.id,
      expectedCurrentRevision: statement.currentRevision,
      reservedRevision: statement.currentRevision + 1,
      versionKind,
      priorConfirmedVersionId,
      priorSourceVersionId,
      sourceDeltaFingerprint: historicalWageSourceDeltaFingerprint({
        targetWageStatementId: statement.id,
        priorConfirmedVersionId,
        priorSourceVersionId,
        sourceVersionId: source.id,
        projectIds: current.projectIds,
        deltas,
        current
      }),
      canonicalRootClosureFingerprint: fingerprint(rootClosure),
      canonicalRootPayableRefIds: [...usedRoots.keys()].sort((left, right) => left.localeCompare(right)),
      projects
    };
  }

  /**
   * This is not an application command and is intentionally not reachable
   * from WageStatementController. It can only be called by a historical
   * takeover atomic-scope activation that has already authenticated and
   * locked its selection read-set in the same transaction.
   */
  async confirmHistoricalTakeoverInTransaction(
    tx: Tx,
    input: HistoricalWageTakeoverConfirmationInput
  ): Promise<{
    decision: "FORMAL";
    statementId: string;
    versionId: string;
    projectionOrigin: "historical_takeover_legacy_link";
  }> {
    if (
      !SHA256.test(input.sourceFingerprint) ||
      !SHA256.test(input.sourceClosureFingerprint) ||
      !SHA256.test(input.sourceDeltaFingerprint) ||
      !SHA256.test(input.canonicalRootClosureFingerprint)
    ) {
      throw new ConflictException("历史工资接管来源指纹或闭合范围无效，不能确认");
    }
    if (
      !Number.isSafeInteger(input.expectedCurrentRevision) ||
      input.expectedCurrentRevision < 0 ||
      input.reservedRevision !== input.expectedCurrentRevision + 1 ||
      (input.expectedCurrentRevision === 0 && (
        input.versionKind !== "base" ||
        input.priorConfirmedVersionId !== null ||
        input.priorSourceVersionId !== null
      )) ||
      (input.expectedCurrentRevision > 0 && (
        !["correction", "reversal"].includes(input.versionKind) ||
        !input.priorConfirmedVersionId ||
        !input.priorSourceVersionId
      ))
    ) {
      throw new ConflictException("历史工资接管预留版本的目标修订链无效，不能确认");
    }
    const expectedProjectIds = uniqueSorted(input.expectedProjectIds);
    const reservation = await tx.wageTakeoverWageStatementReservation.findUnique({
      where: { id: input.reservedVersionId },
      include: {
        atomicScope: {
          include: {
            projects: { select: { projectId: true } }
          }
        },
        mappings: {
          include: {
            manifest: { select: { atomicScopeVersionId: true, projectId: true } }
          }
        }
      }
    });
    if (
      !reservation ||
      reservation.atomicScopeVersionId !== input.atomicScopeVersionId ||
      reservation.atomicScope.id !== input.atomicScopeVersionId ||
      reservation.atomicScope.reservedWageStatementVersionId !== reservation.id
    ) {
      throw new ConflictException("历史工资接管预留版本不属于当前原子范围，不能确认");
    }
    if (
      reservation.atomicScope.authoritySourceRef !== input.sourceVersionId ||
      reservation.atomicScope.authoritySourceFingerprint !== input.sourceFingerprint ||
      reservation.atomicScope.sourceClosureFingerprint !== input.sourceClosureFingerprint ||
      reservation.targetWageStatementId !== input.targetWageStatementId ||
      reservation.expectedCurrentRevision !== input.expectedCurrentRevision ||
      reservation.reservedRevision !== input.reservedRevision ||
      reservation.versionKind !== input.versionKind ||
      reservation.priorConfirmedVersionId !== input.priorConfirmedVersionId ||
      reservation.priorSourceVersionId !== input.priorSourceVersionId ||
      reservation.sourceDeltaFingerprint !== input.sourceDeltaFingerprint ||
      reservation.canonicalRootClosureFingerprint !== input.canonicalRootClosureFingerprint
    ) {
      throw new ConflictException("历史工资接管预留版本的权威来源或闭合指纹已漂移，不能确认");
    }
    const reservedProjectIds = uniqueSorted(reservation.atomicScope.projects.map((project) => project.projectId));
    if (
      !expectedProjectIds.length ||
      reservedProjectIds.length !== expectedProjectIds.length ||
      reservedProjectIds.some((projectId, index) => projectId !== expectedProjectIds[index]) ||
      reservation.mappings.some((mapping) =>
        !reservedProjectIds.includes(mapping.projectId) ||
        mapping.adapterKind !== "historical_wage" ||
        mapping.evidenceLevel !== "A" ||
        mapping.mappingDecision !== "FORMAL" ||
        mapping.wageApprovedSourceVersionId !== input.sourceVersionId ||
        mapping.wageStatementReservationId !== reservation.id ||
        mapping.manifest.atomicScopeVersionId !== input.atomicScopeVersionId ||
        mapping.manifest.projectId !== mapping.projectId
      )
    ) {
      throw new ConflictException("历史工资接管预留版本缺少完整且同源的 A 级项目映射，不能确认");
    }
    const reservedVersionCollision = await tx.wageStatementVersion.findUnique({
      where: { id: input.reservedVersionId },
      select: { id: true, statementId: true }
    });
    if (reservedVersionCollision) {
      throw new ConflictException("历史工资预留版本在激活前已存在，禁止跨事务改绑、LINK 或重投影");
    }
    const source = await tx.wageApprovedSourceVersion.findUnique({
      where: { id: input.sourceVersionId }
    });
    if (!source || source.sourceFingerprint !== input.sourceFingerprint) {
      throw new ConflictException("历史工资接管权威来源已变化或不存在，不能确认");
    }
    const sourceLines = historicalApprovedSourceLines(source);
    const sourceProjectIds = uniqueSorted(
      sourceLines.flatMap((line) => line.projectAllocations.map((allocation) => allocation.projectId))
    );
    if (
      !sourceProjectIds.length ||
      sourceProjectIds.length !== expectedProjectIds.length ||
      sourceProjectIds.some((projectId, index) => projectId !== expectedProjectIds[index])
    ) {
      throw new ConflictException("历史工资接管必须在同一原子范围覆盖权威工资版本的全部项目分摊");
    }

    const linked = await tx.wageStatementVersion.findFirst({
      where: {
        sourceVersionId: source.id,
        status: "confirmed",
        projectionOrigin: "historical_takeover_legacy_link"
      },
      select: { id: true, statementId: true }
    });
    if (linked) {
      throw new ConflictException("历史工资预留版本在激活前已存在，禁止跨事务改绑、LINK 或重投影");
    }

    let statement: {
      id: string;
      employmentCompanyId: string;
      wageMonth: string;
      currentRevision: number;
    };
    let createBaseStatement = false;
    if (input.expectedCurrentRevision === 0) {
      const [idCollision, companyMonthCollision] = await Promise.all([
        tx.wageStatement.findUnique({
          where: { id: input.targetWageStatementId },
          select: { id: true }
        }),
        tx.wageStatement.findUnique({
          where: {
            employmentCompanyId_wageMonth: {
              employmentCompanyId: source.employmentCompanyId,
              wageMonth: source.wageMonth
            }
          },
          select: { id: true }
        })
      ]);
      if (idCollision || companyMonthCollision) {
        throw new ConflictException("历史工资接管基础版本的预留工资承担单已被占用，不能确认");
      }
      statement = {
        id: input.targetWageStatementId,
        employmentCompanyId: source.employmentCompanyId,
        wageMonth: source.wageMonth,
        currentRevision: 0
      };
      createBaseStatement = true;
    } else {
      statement = await this.lockStatement(tx, input.targetWageStatementId);
    }
    if (
      statement.employmentCompanyId !== source.employmentCompanyId ||
      statement.wageMonth !== source.wageMonth ||
      statement.currentRevision !== input.expectedCurrentRevision
    ) {
      throw new ConflictException("历史工资接管目标工资承担单或当前版本已漂移，不能确认");
    }
    const prior = input.expectedCurrentRevision === 0
      ? null
      : await tx.wageStatementVersion.findUnique({
          where: {
            statementId_revision: {
              statementId: statement.id,
              revision: input.expectedCurrentRevision
            }
          },
          select: { id: true, sourceVersionId: true, projectionOrigin: true, status: true }
        });
    if (
      (input.expectedCurrentRevision === 0 && prior !== null) ||
      (input.expectedCurrentRevision > 0 && (
        !prior ||
        prior.id !== input.priorConfirmedVersionId ||
        prior.sourceVersionId !== input.priorSourceVersionId ||
        prior.projectionOrigin !== "historical_takeover_legacy_link" ||
        prior.status !== "confirmed"
      ))
    ) {
      throw new ConflictException("历史工资接管前置工资版本已变化或不唯一，不能确认");
    }

    const [company, evidence, employees, projects, serviceBasisBindings, businessPartyVersions] = await Promise.all([
      tx.companyEntity.findUnique({
        where: { id: source.employmentCompanyId, isActive: true },
        select: { id: true }
      }),
      tx.fileObject.findUnique({
        where: { id: source.evidenceFileId },
        select: { id: true, storageStatus: true, contentSha256: true }
      }),
      this.activeEmployees(tx, sourceLines),
      this.activeProjects(tx, sourceLines),
      tx.wageServiceBasisBinding.findMany({
        where: { sourceVersionId: source.id },
        select: { id: true, projectId: true, serviceSnapshotId: true, serviceMonth: true, evidenceSha256: true, authorityFingerprint: true }
      }),
      tx.businessPartyVersion.findMany({
        where: {
          id: {
            in: [...new Set(sourceLines.flatMap((line) => line.creditorBreakdowns
              .map((creditor) => creditor.creditorBusinessPartyVersionId)
              .filter((id): id is string => Boolean(id))))]
          }
        },
        select: { id: true, businessPartyId: true, versionNo: true, snapshot: true }
      })
    ]);
    if (!company) throw new ConflictException("历史工资接管劳动关系公司已失效，不能确认");
    assertSourceEvidenceActive(source, evidence);
    employeeMap(sourceLines, employees);
    const projectById = projectMap(sourceLines, projects);
    const serviceBindingByKey = serviceBasisBindingMap(source.id, sourceLines, serviceBasisBindings, source.evidenceSha256);
    const businessPartyByVersionId = new Map(businessPartyVersions.map((version) => [version.id, version]));
    preflightFrozenCreditorSnapshots(sourceLines, employees, businessPartyByVersionId);

    if (createBaseStatement) {
      try {
        statement = await tx.wageStatement.create({
          data: {
            id: input.targetWageStatementId,
            employmentCompanyId: source.employmentCompanyId,
            wageMonth: source.wageMonth,
            currentRevision: 0,
            createdByUserId: input.actorUserId
          },
          select: { id: true, employmentCompanyId: true, wageMonth: true, currentRevision: true }
        });
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          throw new ConflictException("历史工资接管基础版本的目标工资承担单在确认期间发生并发变化");
        }
        throw error;
      }
      if (
        statement.employmentCompanyId !== source.employmentCompanyId ||
        statement.wageMonth !== source.wageMonth ||
        statement.currentRevision !== 0
      ) {
        throw new ConflictException("历史工资接管目标工资承担单或当前版本已漂移，不能确认");
      }
    }

    const revision = input.reservedRevision;
    const version = await tx.wageStatementVersion.create({
      data: {
        id: input.reservedVersionId,
        statementId: statement.id,
        revision,
        kind: input.versionKind,
        status: "submitted",
        projectionOrigin: "historical_takeover_legacy_link",
        sourceVersionId: source.id,
        sourceSnapshot: jsonValue(source.sourceSnapshot),
        createdByUserId: input.actorUserId,
        lastEditedByUserId: input.actorUserId,
        submittedByUserId: input.actorUserId,
        submittedAt: new Date()
      },
      select: { id: true }
    });
    // `sourceLines` is both the source proof and the persisted matrix input.
    // The adapter cannot replace or subset it with client-provided rows.
    await this.writeVersionLines(
      tx,
      version.id,
      sourceLines,
      source.wageMonth,
      sourceLines,
      employees,
      projectById,
      serviceBindingByKey,
      businessPartyByVersionId
    );
    await tx.wageStatement.update({
      where: { id: statement.id },
      data: { currentRevision: revision }
    });
    await this.projectConfirmedVersion(
      tx,
      version.id,
      source.employmentCompanyId,
      revision,
      input.actorUserId,
      "historical_takeover_legacy_link",
      {
        atomicScopeVersionId: input.atomicScopeVersionId,
        sourceVersionId: input.sourceVersionId,
        expectedProjectIds,
        sourceClosureFingerprint: input.sourceClosureFingerprint,
        targetWageStatementId: input.targetWageStatementId,
        expectedCurrentRevision: input.expectedCurrentRevision,
        reservedRevision: input.reservedRevision,
        versionKind: input.versionKind,
        priorConfirmedVersionId: input.priorConfirmedVersionId,
        priorSourceVersionId: input.priorSourceVersionId,
        sourceDeltaFingerprint: input.sourceDeltaFingerprint,
        canonicalRootClosureFingerprint: input.canonicalRootClosureFingerprint
      }
    );
    await tx.wageStatementVersion.update({
      where: { id: version.id },
      data: {
        status: "confirmed",
        confirmedByUserId: input.actorUserId,
        confirmedAt: new Date()
      }
    });
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action: "wage_statement.historical_takeover.confirm_internal",
      businessType: "wage_statement_version",
      businessId: version.id,
      metadata: jsonValue({
        atomicScopeVersionId: input.atomicScopeVersionId,
        sourceVersionId: source.id,
        sourceClosureFingerprint: input.sourceClosureFingerprint,
        projectionOrigin: "historical_takeover_legacy_link"
      })
    });
    return {
      decision: "FORMAL",
      statementId: statement.id,
      versionId: version.id,
      projectionOrigin: "historical_takeover_legacy_link"
    };
  }

  async listWorkbench(actorUserId: string, query: WageStatementWorkbenchQueryDto = {}) {
    await this.assertReadAuthority(actorUserId);
    const { page, pageSize } = workbenchPage(query);
    const [statements, total] = await Promise.all([
      this.prisma.wageStatement.findMany({
        select: WAGE_WORKBENCH_SELECT,
        orderBy: [{ wageMonth: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.wageStatement.count()
    ]);
    const currentVersionIds = statements.map((statement) => {
      const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
      if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
      return version.id;
    });
    const countRows = currentVersionIds.length
      ? await this.prisma.$queryRaw<WageWorkbenchCountRow[]>(Prisma.sql`
          SELECT
            p."statementVersionId" AS "statementVersionId",
            COUNT(DISTINCT p.id)::BIGINT AS "personLineCount",
            COUNT(DISTINCT p."positionCategorySnapshot"->>'category')::BIGINT AS "positionCategoryCount",
            COUNT(a.id)::BIGINT AS "projectAllocationCount"
          FROM "WagePersonLine" p
          LEFT JOIN "WageProjectAllocation" a ON a."personLineId" = p.id
          WHERE p."statementVersionId" IN (${Prisma.join(currentVersionIds)})
          GROUP BY p."statementVersionId"
        `)
      : [];
    const countsByVersionId = new Map(countRows.map((row) => [row.statementVersionId, row]));
    const companyNames = await this.companyNames(statements.map((statement) => statement.employmentCompanyId));
    return {
      capabilities: await this.capabilities(actorUserId),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: statements.map((statement) => {
        const aggregate = this.workbenchAggregate(statement, companyNames, countsByVersionId);
        return {
          statementId: statement.id,
          employmentCompanyName: aggregate.employmentCompanyName,
          wageMonth: statement.wageMonth,
          status: aggregate.status,
          statusLabel: aggregate.statusLabel,
          revision: statement.currentRevision,
          sourceLabel: aggregate.sourceLabel,
          personLineCount: aggregate.personLineCount,
          positionCategoryCount: aggregate.positionCategoryCount,
          projectAllocationCount: aggregate.projectAllocationCount,
          latestReviewReturn: aggregate.latestReviewReturn,
          updatedAt: statement.updatedAt.toISOString()
        };
      })
    };
  }

  private workbenchAggregate(
    statement: WageWorkbenchStatement,
    companyNames: Map<string, string>,
    countsByVersionId: ReadonlyMap<string, WageWorkbenchCountRow>
  ) {
    const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const counts = countsByVersionId.get(version.id);
    const returned = statement.versions.find((candidate) =>
      candidate.reviewDisposition === "review_returned" && candidate.reviewReturnedAt
    );
    return {
      employmentCompanyName: companyNames.get(statement.employmentCompanyId)!,
      status: workbenchStatus(version.status),
      statusLabel: workbenchStatusLabel(version.status),
      sourceLabel: `外部批准工资资料 ${version.sourceVersion.externalReference}（${version.sourceVersion.sourceVersion}）`,
      personLineCount: Number(counts?.personLineCount ?? 0n),
      positionCategoryCount: Number(counts?.positionCategoryCount ?? 0n),
      projectAllocationCount: Number(counts?.projectAllocationCount ?? 0n),
      latestReviewReturn: returned?.reviewReturnedAt
        ? { revision: returned.revision, returnedAt: returned.reviewReturnedAt.toISOString() }
        : null
    };
  }

  async readSummary(actorUserId: string, statementId: string) {
    await this.assertReadAuthority(actorUserId);
    const statement = await this.aggregateStatement(statementId);
    const aggregate = this.aggregate(statement, await this.companyNames([statement.employmentCompanyId]));
    return {
      capabilities: await this.capabilities(actorUserId),
      employmentCompanyName: aggregate.employmentCompanyName,
      wageMonth: statement.wageMonth,
      statusLabel: aggregate.statusLabel,
      revision: statement.currentRevision,
      sourceLabel: aggregate.sourceLabel,
      personLineCount: aggregate.personLineCount,
      positionCategoryCount: aggregate.positionCategoryCount,
      projectAllocationCount: aggregate.projectAllocationCount,
      latestReviewReturn: aggregate.latestReviewReturn,
      categories: aggregate.categories
    };
  }

  async readImportPreview(actorUserId: string, statementId: string) {
    await this.assertReadAuthority(actorUserId);
    const statement = await this.aggregateStatement(statementId);
    const aggregate = this.aggregate(statement, await this.companyNames([statement.employmentCompanyId]));
    return {
      employmentCompanyName: aggregate.employmentCompanyName,
      wageMonth: statement.wageMonth,
      sourceLabel: aggregate.sourceLabel,
      sourceStatusLabel: "已冻结外部批准来源",
      personLineCount: aggregate.personLineCount,
      positionCategoryCount: aggregate.positionCategoryCount,
      projectAllocationCount: aggregate.projectAllocationCount
    };
  }

  /**
   * A deliberately separate aggregate seam for management roles.  It does not
   * consult, expose, or imply the personal-detail `wage_sensitive_read`
   * action: chairman/GM receive company totals by count only; contract
   * director/project manager receive category counts restricted to their
   * visible projects.
   */
  async readNonSensitiveSummary(actorUserId: string, statementId: string) {
    const access = await this.nonSensitiveSummaryAccess(actorUserId);
    const statement = await this.aggregateStatement(statementId);
    const aggregate = this.aggregate(statement, await this.companyNames([statement.employmentCompanyId]));
    if (access.kind === "company") {
      const projects = this.aggregateProjectSummaries(statement);
      return {
        scope: "company" as const,
        employmentCompanyName: aggregate.employmentCompanyName,
        wageMonth: statement.wageMonth,
        statusLabel: aggregate.statusLabel,
        revision: statement.currentRevision,
        personLineCount: aggregate.personLineCount,
        positionCategoryCount: aggregate.positionCategoryCount,
        projectAllocationCount: aggregate.projectAllocationCount,
        projects
      };
    }
    const categories = this.aggregateProjectCategories(statement, access.projectIds);
    if (!categories.projectAllocationCount) {
      throw new ForbiddenException("当前账号无权查看该工资项目汇总");
    }
    return {
      scope: "project_category" as const,
      wageMonth: statement.wageMonth,
      statusLabel: aggregate.statusLabel,
      revision: statement.currentRevision,
      positionCategoryCount: categories.categories.length,
      projectAllocationCount: categories.projectAllocationCount,
      categories: categories.categories
    };
  }

  /**
   * There is no generated wage export/PDF artifact in this release.  Do not
   * substitute source evidence for an export: after reauthentication, record
   * the explicit controlled request and fail closed until a separately-owned
   * immutable export artifact exists.  Evidence download remains governed by
   * its own `wage_sensitive_download` private-file route.
   */
  async createSensitiveExportTicket(
    actorUserId: string,
    statementId: string,
    downloadReason: string
  ) {
    void downloadReason;
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("wage_sensitive_export", roles)) {
      throw new ForbiddenException("当前公司岗位无权导出工资敏感资料");
    }
    const id = required(statementId, "工资承担单不能为空");
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        actorUserId,
        action: "wage_sensitive_export.denied",
        businessType: "wage_statement",
        businessId: id,
        metadata: jsonValue({ reasonCode: "wage_sensitive_export_artifact_unavailable" })
      });
    });
    throw new ConflictException("工资敏感导出工件尚未生成，暂不能导出");
  }

  private async lockAndValidateFullReversalBinding(
    tx: Tx,
    target: {
      statementId: string;
      priorConfirmedVersionId: string;
      priorConfirmedRevision: number;
      priorSourceVersionId: string;
    },
    zeroLines: WagePersonLineInput[],
    employmentCompanyId: string,
    wageMonth: string,
    evidenceFileId: string,
    expectedCurrentRevision: number,
    preparedRevision = false
  ): Promise<FullReversalBinding> {
    const statement = await this.lockStatement(tx, target.statementId);
    if (
      statement.employmentCompanyId !== employmentCompanyId ||
      statement.wageMonth !== wageMonth ||
      statement.currentRevision !== expectedCurrentRevision ||
      expectedCurrentRevision !== target.priorConfirmedRevision + (preparedRevision ? 1 : 0)
    ) {
      throw new ConflictException("全额冲销目标工资单的公司、月份或当前修订已漂移");
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "CompanyEntity" WHERE id = ${employmentCompanyId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WageStatementVersion" WHERE id = ${target.priorConfirmedVersionId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WageApprovedSourceVersion" WHERE id = ${target.priorSourceVersionId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "FileObject" WHERE id = ${evidenceFileId} FOR UPDATE`);
    const employeeIds = [...new Set(zeroLines.map((line) => line.employeeId))].sort((left, right) => left.localeCompare(right));
    if (employeeIds.length > 0) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(employeeIds)}) ORDER BY id FOR UPDATE`);
    }
    const projectIds = [...new Set(zeroLines.flatMap((line) => line.projectAllocations.map((allocation) => allocation.projectId)))]
      .sort((left, right) => left.localeCompare(right));
    if (projectIds.length > 0) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Project" WHERE id IN (${Prisma.join(projectIds)}) ORDER BY id FOR UPDATE`);
    }
    const creditorVersionIds = [...new Set(zeroLines.flatMap((line) => [
      ...line.creditorBreakdowns,
      ...(line.projectCreditorAllocations ?? [])
    ]).flatMap((creditor) => creditor.creditorSubjectType === "business_party" && creditor.creditorBusinessPartyVersionId
      ? [creditor.creditorBusinessPartyVersionId]
      : []))].sort((left, right) => left.localeCompare(right));
    if (creditorVersionIds.length > 0) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "BusinessPartyVersion" WHERE id IN (${Prisma.join(creditorVersionIds)}) ORDER BY id FOR UPDATE`);
    }
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WagePersonLine" WHERE "statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT c.id FROM "WageCostComponent" c JOIN "WagePersonLine" p ON p.id = c."personLineId" WHERE p."statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY c.id FOR UPDATE OF c`);
    await tx.$queryRaw(Prisma.sql`SELECT c.id FROM "WageCreditorBreakdown" c JOIN "WagePersonLine" p ON p.id = c."personLineId" WHERE p."statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY c.id FOR UPDATE OF c`);
    await tx.$queryRaw(Prisma.sql`SELECT a.id FROM "WageProjectAllocation" a JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY a.id FOR UPDATE OF a`);
    await tx.$queryRaw(Prisma.sql`SELECT m.id FROM "WageProjectCostComponentAllocation" m JOIN "WageProjectAllocation" a ON a.id = m."projectAllocationId" JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY m.id FOR UPDATE OF m`);
    await tx.$queryRaw(Prisma.sql`SELECT m.id FROM "WageProjectCreditorAllocation" m JOIN "WageProjectAllocation" a ON a.id = m."projectAllocationId" JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${target.priorConfirmedVersionId} ORDER BY m.id FOR UPDATE OF m`);
    await tx.$queryRaw(Prisma.sql`SELECT r.id FROM "WagePayableRef" r JOIN "WageStatementVersion" v ON v.id = r."confirmedVersionId" WHERE v."statementId" = ${target.statementId} AND r."adjustsPayableRefId" IS NULL ORDER BY r.id FOR UPDATE OF r`);
    await tx.$queryRaw(Prisma.sql`SELECT a.id FROM "WagePayableRef" a JOIN "WagePayableRef" r ON r.id = a."adjustsPayableRefId" JOIN "WageStatementVersion" v ON v.id = r."confirmedVersionId" WHERE v."statementId" = ${target.statementId} ORDER BY a.id FOR UPDATE OF a`);

    const prior = await tx.wageStatementVersion.findUnique({
      where: { id: target.priorConfirmedVersionId },
      include: WAGE_CONFIRMATION_INCLUDE
    }) as WageConfirmationVersion | null;
    if (
      !prior ||
      prior.statementId !== target.statementId ||
      prior.revision !== target.priorConfirmedRevision ||
      prior.status !== "confirmed" ||
      prior.projectionOrigin !== "ordinary" ||
      prior.sourceVersionId !== target.priorSourceVersionId ||
      prior.sourceVersion.sourcePurpose !== "ordinary"
    ) {
      throw new ConflictException("全额冲销必须绑定当前紧邻的普通已确认工资版本");
    }
    for (const person of prior.personLines) this.assertCompleteStoredMatrices(person);
    const current = authorityMatrixIdentities(zeroLines);
    const previous = semanticMatrixFromConfirmedVersion(prior);
    assertExactHistoricalWageIdentities(current.costs, previous.costs, "成本组成");
    assertExactHistoricalWageIdentities(current.payables, previous.payables, "债权人");
    if (!sameStringSet(current.projectIds, previous.projectIds)) {
      throw new ConflictException("全额冲销的项目与服务快照闭包必须与前置版本完全一致");
    }
    if ([...current.costs.values(), ...current.payables.values()].some((cell) => cell.amountCents !== 0n)) {
      throw new ConflictException("全额冲销必须保留完整身份并显式填写全零金额");
    }
    if (![...previous.costs.values(), ...previous.payables.values()].some((cell) => cell.amountCents > 0n)) {
      throw new ConflictException("全额冲销必须产生至少一项真实负向差额");
    }

    const roots = await tx.wagePayableRef.findMany({
      where: {
        adjustsPayableRefId: null,
        direction: "increase",
        confirmedVersion: { statementId: target.statementId, revision: { lte: target.priorConfirmedRevision }, status: "confirmed", projectionOrigin: "ordinary" }
      },
      select: {
        id: true, amountCents: true, debtorCompanyId: true, costBearingCompanyId: true, projectId: true,
        projectAllocation: { select: { serviceSnapshotId: true } },
        personLine: { select: { employeeId: true, employmentSnapshotId: true } },
        creditorBreakdown: { select: { creditorSubjectType: true, creditorSubjectIdentityKey: true, creditorCategory: true } },
        adjustments: { select: { id: true, direction: true, amountCents: true }, orderBy: { id: "asc" } }
      },
      orderBy: { id: "asc" }
    }) as HistoricalWageRootRead[];
    const usedRoots = new Map<string, HistoricalWageRootRead & { effectiveAmountCents: bigint }>();
    for (const cell of previous.payables.values()) {
      if (cell.amountCents === 0n) continue;
      const matching = roots.filter((root) =>
        root.debtorCompanyId === employmentCompanyId &&
        root.costBearingCompanyId === employmentCompanyId &&
        wageRootIdentity(root) === cell.key
      );
      if (matching.length !== 1) {
        throw new ConflictException("全额冲销必须唯一指向同一不可变原始应付引用");
      }
      const root = matching[0]!;
      const effectiveAmountCents = historicalWageRootEffectiveAmount(root);
      if (effectiveAmountCents !== cell.amountCents || effectiveAmountCents <= 0n) {
        throw new ConflictException("全额冲销原根有效金额与前置版本已漂移");
      }
      usedRoots.set(root.id, { ...root, effectiveAmountCents });
    }
    if (!usedRoots.size) {
      throw new ConflictException("全额冲销缺少可唯一闭合的原始应付引用");
    }
    const rootClosure = [...usedRoots.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((root) => historicalWageRootReadSet(root));
    return {
      statementId: target.statementId,
      priorConfirmedVersionId: target.priorConfirmedVersionId,
      priorConfirmedRevision: target.priorConfirmedRevision,
      priorSourceVersionId: target.priorSourceVersionId,
      rootClosureFingerprint: fingerprint(rootClosure),
      rootPayableRefIds: [...usedRoots.keys()].sort((left, right) => left.localeCompare(right))
    };
  }

  private async lockAndRevalidateFullReversalSource(
    tx: Tx,
    source: {
      id: string;
      employmentCompanyId: string;
      wageMonth: string;
      evidenceFileId: string;
      fullReversalTargetStatementId: string | null;
      fullReversalPriorVersionId: string | null;
      fullReversalPriorRevision: number | null;
      fullReversalPriorSourceVersionId: string | null;
      fullReversalRootClosureFingerprint: string | null;
      sourceSnapshot: unknown;
    },
    lines: WagePersonLineInput[],
    expectedCurrentRevision: number,
    preparedRevision = false
  ) {
    const target = {
      statementId: required(source.fullReversalTargetStatementId, "全额冲销目标工资单缺失"),
      priorConfirmedVersionId: required(source.fullReversalPriorVersionId, "全额冲销前置版本缺失"),
      priorConfirmedRevision: source.fullReversalPriorRevision ?? 0,
      priorSourceVersionId: required(source.fullReversalPriorSourceVersionId, "全额冲销前置来源缺失")
    };
    const rebound = await this.lockAndValidateFullReversalBinding(
      tx,
      target,
      lines,
      source.employmentCompanyId,
      source.wageMonth,
      source.evidenceFileId,
      expectedCurrentRevision,
      preparedRevision
    );
    if (preparedRevision) {
      const current = await this.currentVersion(tx, target.statementId, expectedCurrentRevision);
      if (current.kind !== "reversal" || current.sourceVersionId !== source.id) {
        throw new ConflictException("全额冲销来源与当前已准备冲销修订不一致");
      }
    }
    const snapshot = source.sourceSnapshot as Record<string, unknown>;
    const frozen = snapshot.fullReversalBinding as Record<string, unknown> | undefined;
    if (
      source.fullReversalRootClosureFingerprint !== rebound.rootClosureFingerprint ||
      requiredJsonText(frozen?.statementId) !== rebound.statementId ||
      requiredJsonText(frozen?.priorConfirmedVersionId) !== rebound.priorConfirmedVersionId ||
      frozen?.priorConfirmedRevision !== rebound.priorConfirmedRevision ||
      requiredJsonText(frozen?.priorSourceVersionId) !== rebound.priorSourceVersionId ||
      requiredJsonText(frozen?.rootClosureFingerprint) !== rebound.rootClosureFingerprint ||
      stableJson(frozen?.rootPayableRefIds) !== stableJson(rebound.rootPayableRefIds)
    ) {
      throw new ConflictException("全额冲销的标准原根闭包已漂移");
    }
    return rebound;
  }

  async createApprovedSource(actorUserId: string, input: CreateApprovedWageSourceDto) {
    await this.assertPrepareAuthority(actorUserId);
    const normalized = normalizeApprovedSource(input);
    const fingerprintValue = sourceCommandFingerprint(normalized, actorUserId);
    return this.executeWithReceiptReplay(normalized.idempotencyKey, fingerprintValue, "approved_source", async () => this.serializable(async (tx) => {
      await this.lockIdempotencyKey(tx, "approved_source", normalized.idempotencyKey);
      const replay = await this.replayApprovedSource(tx, normalized.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const authorityLines = normalized.approvedPersonLines.map(authorityFactsOnly);
      const fullReversalBinding = normalized.sourcePurpose === "full_reversal"
        ? await this.lockAndValidateFullReversalBinding(
            tx,
            normalized.fullReversalTarget!,
            normalized.approvedPersonLines as WagePersonLineInput[],
            normalized.employmentCompanyId,
            normalized.wageMonth,
            normalized.evidenceFileId,
            normalized.fullReversalTarget!.priorConfirmedRevision
          )
        : null;
      const [company, evidence, employees] = await Promise.all([
        tx.companyEntity.findUnique({
          where: { id: normalized.employmentCompanyId, isActive: true },
          select: { id: true, name: true }
        }),
        tx.fileObject.findUnique({
          where: { id: normalized.evidenceFileId },
          select: { id: true, storageStatus: true, contentSha256: true }
        }),
        this.activeEmployees(tx, authorityLines)
      ]);
      if (!company) throw new NotFoundException("承担工资的我方公司不存在或已停用");
      if (
        !evidence ||
        evidence.storageStatus !== "active" ||
        typeof evidence.contentSha256 !== "string" ||
        !SHA256.test(evidence.contentSha256)
      ) {
        throw new BadRequestException("外部批准工资资料不存在、不可用或缺少内容校验值");
      }
      employeeMap(authorityLines, employees);
      const sourceSnapshot = jsonValue({
        sourcePurpose: normalized.sourcePurpose,
        employmentCompany: { id: company.id, name: company.name },
        wageMonth: normalized.wageMonth,
        periodStart: normalized.periodStart,
        periodEnd: normalized.periodEnd,
        externalReference: normalized.externalReference,
        sourceVersion: normalized.sourceVersion,
        basisDate: normalized.basisDate,
        evidence: { fileId: evidence.id, sha256: evidence.contentSha256 },
        ...(fullReversalBinding ? { fullReversalBinding } : {}),
        // 普通来源不冻结财务分摊；全额冲销来源则必须冻结完整显式零矩阵。
        approvedPersonLines: normalized.approvedPersonLines
      });
      const sourceFingerprint = fingerprint(sourceSnapshot);
      try {
        const created = await tx.wageApprovedSourceVersion.create({
          data: {
            sourcePurpose: normalized.sourcePurpose,
            employmentCompanyId: normalized.employmentCompanyId,
            wageMonth: normalized.wageMonth,
            periodStart: dateOnly(normalized.periodStart),
            periodEnd: dateOnly(normalized.periodEnd),
            sourceType: "external_approved_wage",
            externalReference: normalized.externalReference,
            sourceVersion: normalized.sourceVersion,
            basisDate: dateOnly(normalized.basisDate),
            evidenceFileId: evidence.id,
            evidenceSha256: evidence.contentSha256,
            sourceFingerprint,
            sourceSnapshot: jsonValue(sourceSnapshot),
            fullReversalTargetStatementId: fullReversalBinding?.statementId,
            fullReversalPriorVersionId: fullReversalBinding?.priorConfirmedVersionId,
            fullReversalPriorRevision: fullReversalBinding?.priorConfirmedRevision,
            fullReversalPriorSourceVersionId: fullReversalBinding?.priorSourceVersionId,
            fullReversalRootClosureFingerprint: fullReversalBinding?.rootClosureFingerprint,
            createdByUserId: actorUserId
          }
        });
        const result = { id: created.id };
        await this.approvedSourceReceipt(tx, normalized, "wage_statement.approved_source.create", created.id, fingerprintValue, actorUserId, result);
        await this.audit.record(tx, {
          actorUserId,
          action: "wage_statement.approved_source.create",
          businessType: "wage_approved_source",
          businessId: created.id,
          metadata: jsonValue({ employmentCompanyId: normalized.employmentCompanyId, wageMonth: normalized.wageMonth, sourceFingerprint })
        });
        return result;
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          throw new WageNaturalKeyRaceError("approved_source", "该我方公司的外部工资来源版本已存在");
        }
        throw error;
      }
    }));
  }

  async createDraft(actorUserId: string, input: CreateWageStatementDraftDto) {
    await this.assertPrepareAuthority(actorUserId);
    validateDraftInput(input);
    assertBalancedWageStatementDraft(input);
    const fingerprintValue = commandFingerprint("wage_statement.draft.create", "new", input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      await this.lockIdempotencyKey(tx, "statement", input.idempotencyKey);
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const source = await tx.wageApprovedSourceVersion.findUnique({
        where: { id: required(input.sourceVersionId, "外部批准工资来源不能为空") }
      });
      if (!source) throw new NotFoundException("外部批准工资来源不存在，请刷新后重试");
      if (approvedSourcePurpose(source) !== "ordinary") {
        throw new BadRequestException("全额冲销批准来源只能创建冲销修订");
      }
      if (source.wageMonth !== input.wageMonth) throw new BadRequestException("工资承担单月份必须与外部批准来源一致");
      const sourceLines = sourcePersonLines(source.sourceSnapshot);
      assertSourceFacts(input.personLines, sourceLines, source.employmentCompanyId, source.wageMonth, source.periodStart, source.periodEnd);
      const [company, evidence, employees, projects, businessPartyVersions] = await Promise.all([
        tx.companyEntity.findUnique({
          where: { id: source.employmentCompanyId, isActive: true },
          select: { id: true }
        }),
        tx.fileObject.findUnique({
          where: { id: source.evidenceFileId },
          select: { id: true, storageStatus: true, contentSha256: true }
        }),
        this.activeEmployees(tx, sourceLines),
        this.activeProjects(tx, input.personLines),
        tx.businessPartyVersion.findMany({
          where: { id: { in: [...new Set(sourceLines.flatMap((line) => line.creditorBreakdowns.map((creditor) => creditor.creditorBusinessPartyVersionId).filter((id): id is string => Boolean(id))))] } },
          // A BusinessPartyVersion is the authority for an institution. Its
          // aggregate identity, immutable version number and frozen snapshot
          // form the fingerprint basis; caller-provided creditor rows never do.
          select: { id: true, businessPartyId: true, versionNo: true, snapshot: true }
        })
      ]);
      if (!company) throw new BadRequestException("承担工资的我方公司不存在或已停用");
      assertSourceEvidenceActive(source, evidence);
      employeeMap(sourceLines, employees);
      const projectById = projectMap(input.personLines, projects);
      const serviceBindingByKey = await this.ensureServiceBasisBindings(tx, source.id, input.personLines, source.evidenceSha256);
      const businessPartyByVersionId = new Map(businessPartyVersions.map((version) => [version.id, version]));
      preflightFrozenCreditorSnapshots(sourceLines, employees, businessPartyByVersionId);
      let statement: { id: string };
      try {
        statement = await tx.wageStatement.create({
          data: {
            employmentCompanyId: source.employmentCompanyId,
            wageMonth: source.wageMonth,
            currentRevision: 1,
            createdByUserId: actorUserId
          },
          select: { id: true }
        });
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          throw new WageNaturalKeyRaceError("statement", "该我方公司本月工资承担单已存在，请通过后续修订流程处理");
        }
        throw error;
      }
      const revision = 1;
      const version = await tx.wageStatementVersion.create({
        data: {
          statementId: statement.id,
          revision,
          kind: "base",
          status: "draft",
          sourceVersionId: source.id,
          sourceSnapshot: jsonValue(source.sourceSnapshot),
          createdByUserId: actorUserId,
          lastEditedByUserId: actorUserId
        },
        select: { id: true }
      });
      await this.writeVersionLines(
        tx,
        version.id,
        sourceLines,
        source.wageMonth,
        input.personLines,
        employees,
        projectById,
        serviceBindingByKey,
        businessPartyByVersionId
      );
      await this.audit.record(tx, {
        actorUserId,
        action: "wage_statement.draft.create",
        businessType: "wage_statement_version",
        businessId: version.id,
        metadata: jsonValue({ statementId: statement.id, revision, sourceVersionId: source.id })
      });
      const result = { statementId: statement.id, versionId: version.id, revision };
      await this.receipt(tx, input, "wage_statement.draft.create", statement.id, fingerprintValue, actorUserId, result);
      return result;
    }));
  }

  /**
   * Creates, but never confirms, a later full revision of an already-confirmed
   * statement.  This is the only public preparation seam for supplemental,
   * correction and reversal dispositions.  It deliberately receives a new
   * approved source and explicit matrices instead of copying or deriving any
   * previous finance decision.
   */
  async createRevision(actorUserId: string, statementId: string, input: CreateWageStatementRevisionDto) {
    await this.assertPrepareAuthority(actorUserId);
    validateRevisionInput(input);
    assertBalancedWageStatementDraft(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.revision.create", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const prior = await this.currentVersion(tx, id, statement.currentRevision);
      if (prior.status !== "confirmed") throw new ConflictException("只有已确认工资承担单可以创建后续修订");
      const source = await tx.wageApprovedSourceVersion.findUnique({ where: { id: required(input.sourceVersionId, "外部批准工资来源不能为空") } });
      if (!source) throw new NotFoundException("外部批准工资来源不存在，请刷新后重试");
      if (source.employmentCompanyId !== statement.employmentCompanyId || source.wageMonth !== input.wageMonth) {
        throw new BadRequestException("后续工资修订的公司和月份必须与原工资承担单一致");
      }
      if (input.disposition === "reversal" && approvedSourcePurpose(source) !== "full_reversal") {
        throw new BadRequestException("冲销修订必须使用全额冲销批准来源");
      }
      if (input.disposition !== "reversal" && approvedSourcePurpose(source) !== "ordinary") {
        throw new BadRequestException("全额冲销批准来源只能用于冲销修订");
      }
      const sourceLines = approvedSourcePurpose(source) === "full_reversal"
        ? fullReversalSourcePersonLines(source.sourceSnapshot)
        : sourcePersonLines(source.sourceSnapshot);
      assertSourceFacts(input.personLines, sourceLines, statement.employmentCompanyId, source.wageMonth, source.periodStart, source.periodEnd);
      if (approvedSourcePurpose(source) === "full_reversal") {
        await this.lockAndRevalidateFullReversalSource(tx, source, input.personLines, statement.currentRevision);
      }
      const [company, evidence, employees, projects, businessPartyVersions] = await Promise.all([
        tx.companyEntity.findUnique({ where: { id: statement.employmentCompanyId, isActive: true }, select: { id: true } }),
        tx.fileObject.findUnique({ where: { id: source.evidenceFileId }, select: { id: true, storageStatus: true, contentSha256: true } }),
        this.activeEmployees(tx, sourceLines),
        this.activeProjects(tx, input.personLines),
        tx.businessPartyVersion.findMany({
          where: { id: { in: [...new Set(sourceLines.flatMap((line) => line.creditorBreakdowns.map((creditor) => creditor.creditorBusinessPartyVersionId).filter((value): value is string => Boolean(value))))] } },
          select: { id: true, businessPartyId: true, versionNo: true, snapshot: true }
        })
      ]);
      if (!company) throw new BadRequestException("承担工资的我方公司不存在或已停用");
      assertSourceEvidenceActive(source, evidence);
      employeeMap(sourceLines, employees);
      const projectById = projectMap(input.personLines, projects);
      const serviceBindingByKey = await this.ensureServiceBasisBindings(tx, source.id, input.personLines, source.evidenceSha256);
      const businessPartyByVersionId = new Map(businessPartyVersions.map((version) => [version.id, version]));
      preflightFrozenCreditorSnapshots(sourceLines, employees, businessPartyByVersionId);
      const revision = statement.currentRevision + 1;
      const version = await tx.wageStatementVersion.create({
        data: {
          statementId: id, revision, kind: input.disposition, status: "draft", sourceVersionId: source.id,
          sourceSnapshot: jsonValue(source.sourceSnapshot), createdByUserId: actorUserId, lastEditedByUserId: actorUserId
        },
        select: { id: true }
      });
      await this.writeVersionLines(tx, version.id, sourceLines, source.wageMonth, input.personLines, employees, projectById, serviceBindingByKey, businessPartyByVersionId);
      await tx.wageStatement.update({ where: { id }, data: { currentRevision: revision } });
      const result = { statementId: id, versionId: version.id, revision, status: "draft", disposition: input.disposition };
      await this.receipt(tx, input, "wage_statement.revision.create", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, {
        actorUserId, action: "wage_statement.revision.create", businessType: "wage_statement_version", businessId: version.id,
        metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision, revision, disposition: input.disposition, sourceVersionId: source.id })
      });
      return result;
    }));
  }

  async updateDraft(actorUserId: string, statementId: string, input: UpdateWageStatementDraftDto) {
    await this.assertPrepareAuthority(actorUserId);
    validateEditableDraftInput(input);
    assertBalancedWageStatementDraft(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.draft.update", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const version = await this.currentVersion(tx, id, statement.currentRevision);
      if (version.status !== "draft") throw new ConflictException("只有当前草稿工资承担单可以编辑");
      const source = await tx.wageApprovedSourceVersion.findUnique({ where: { id: version.sourceVersionId } });
      if (!source) throw new ConflictException("工资草稿绑定的外部批准来源不存在");
      if (source.wageMonth !== input.wageMonth || statement.wageMonth !== input.wageMonth) {
        throw new BadRequestException("工资草稿月份必须与外部批准来源一致");
      }
      const sourceLines = approvedSourcePurpose(source) === "full_reversal"
        ? fullReversalSourcePersonLines(source.sourceSnapshot)
        : sourcePersonLines(source.sourceSnapshot);
      assertSourceFacts(input.personLines, sourceLines, statement.employmentCompanyId, source.wageMonth, source.periodStart, source.periodEnd);
      if (approvedSourcePurpose(source) === "full_reversal") {
        if (version.kind !== "reversal") throw new ConflictException("全额冲销来源已被非冲销版本引用");
        await this.lockAndRevalidateFullReversalSource(tx, source, input.personLines, statement.currentRevision, true);
      }
      const [company, evidence, employees, projects, businessPartyVersions] = await Promise.all([
        tx.companyEntity.findUnique({ where: { id: statement.employmentCompanyId, isActive: true }, select: { id: true } }),
        tx.fileObject.findUnique({ where: { id: source.evidenceFileId }, select: { id: true, storageStatus: true, contentSha256: true } }),
        this.activeEmployees(tx, sourceLines),
        this.activeProjects(tx, input.personLines),
        tx.businessPartyVersion.findMany({
          where: { id: { in: [...new Set(sourceLines.flatMap((line) => line.creditorBreakdowns.map((creditor) => creditor.creditorBusinessPartyVersionId).filter((value): value is string => Boolean(value))))] } },
          select: { id: true, businessPartyId: true, versionNo: true, snapshot: true }
        })
      ]);
      if (!company) throw new BadRequestException("承担工资的我方公司不存在或已停用");
      assertSourceEvidenceActive(source, evidence);
      employeeMap(sourceLines, employees);
      const projectById = projectMap(input.personLines, projects);
      const serviceBindingByKey = await this.ensureServiceBasisBindings(tx, source.id, input.personLines, source.evidenceSha256);
      const businessPartyByVersionId = new Map(businessPartyVersions.map((candidate) => [candidate.id, candidate]));
      preflightFrozenCreditorSnapshots(sourceLines, employees, businessPartyByVersionId);

      await tx.wageProjectCostComponentAllocation.deleteMany({ where: { projectAllocation: { personLine: { statementVersionId: version.id } } } });
      await tx.wageProjectCreditorAllocation.deleteMany({ where: { projectAllocation: { personLine: { statementVersionId: version.id } } } });
      await tx.wageProjectAllocation.deleteMany({ where: { personLine: { statementVersionId: version.id } } });
      await tx.wageCostComponent.deleteMany({ where: { personLine: { statementVersionId: version.id } } });
      await tx.wageCreditorBreakdown.deleteMany({ where: { personLine: { statementVersionId: version.id } } });
      await tx.wagePersonLine.deleteMany({ where: { statementVersionId: version.id } });
      await this.writeVersionLines(tx, version.id, sourceLines, source.wageMonth, input.personLines, employees, projectById, serviceBindingByKey, businessPartyByVersionId);
      await tx.wageStatementVersion.update({ where: { id: version.id }, data: { lastEditedByUserId: actorUserId } });
      const result = { statementId: id, versionId: version.id, revision: statement.currentRevision, status: "draft" };
      await this.receipt(tx, input, "wage_statement.draft.update", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, {
        actorUserId,
        action: "wage_statement.draft.update",
        businessType: "wage_statement_version",
        businessId: version.id,
        metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision })
      });
      return result;
    }));
  }

  private async writeVersionLines(
    tx: Tx,
    versionId: string,
    sourceLines: AuthorityLine[],
    wageMonth: string,
    lines: WagePersonLineInput[],
    employees: Array<{ id: string; name: string; departmentId: string | null }>,
    projectById: ReadonlyMap<string, { id: string; code: string; name: string }>,
    serviceBindingByKey: ReadonlyMap<string, ServiceBasisBinding>,
    businessPartyByVersionId: ReadonlyMap<string, { id: string; businessPartyId: string; versionNo: number; snapshot: Prisma.JsonValue }>
  ) {
    if (sourceLines.length !== lines.length) throw new ConflictException("外部批准工资来源人员事实不完整，不能创建后续修订");
    const personRows: Prisma.WagePersonLineCreateManyInput[] = [];
    const componentRows: Prisma.WageCostComponentCreateManyInput[] = [];
    const creditorRows: Prisma.WageCreditorBreakdownCreateManyInput[] = [];
    const allocationRows: Prisma.WageProjectAllocationCreateManyInput[] = [];
    const componentMatrixRows: Prisma.WageProjectCostComponentAllocationCreateManyInput[] = [];
    const creditorMatrixRows: Prisma.WageProjectCreditorAllocationCreateManyInput[] = [];

    for (const line of lines) {
      const personLineId = randomUUID();
      personRows.push({
        id: personLineId,
        statementVersionId: versionId,
        employeeId: line.employeeId,
        employmentSnapshotId: line.employmentSnapshotId,
        employeeSnapshot: jsonValue({ employeeId: line.employeeId }),
        employmentSnapshot: jsonValue({ id: line.employmentSnapshotId, companyId: line.employmentCompanyId }),
        periodSnapshot: jsonValue({ wageMonth, periodStart: line.employmentPeriodStart, periodEnd: line.employmentPeriodEnd }),
        positionCategorySnapshot: jsonValue({ category: line.positionCategory }),
        approvedAmountCents: BigInt(line.approvedAmountCents)
      });
      const componentByCode = new Map(line.costComponents.map((component) => {
        const id = randomUUID();
        componentRows.push({ id, personLineId, componentCode: component.componentCode, amountCents: BigInt(component.amountCents), sourceSnapshot: jsonValue(component) });
        return [component.componentCode, id] as const;
      }));
      const creditorByKey = new Map(line.creditorBreakdowns.map((creditor) => {
        const id = randomUUID();
        creditorRows.push({
          id,
          personLineId,
          creditorSubjectId: creditor.creditorSubjectId,
          creditorSubjectType: creditor.creditorSubjectType,
          creditorUserId: creditor.creditorUserId,
          creditorBusinessPartyVersionId: creditor.creditorBusinessPartyVersionId,
          creditorSubjectIdentityKey: creditorIdentityKey(creditor),
          creditorNameSnapshot: frozenCreditorName(creditor, employees, businessPartyByVersionId),
          creditorUnifiedIdentitySnapshot: frozenCreditorUnifiedIdentity(creditor, businessPartyByVersionId),
          creditorVersionFingerprint: frozenCreditorFingerprint(creditor, employees, businessPartyByVersionId),
          creditorCategory: creditor.creditorCategory,
          amountCents: BigInt(creditor.amountCents),
          sourceSnapshot: jsonValue(creditor)
        });
        return [creditorIdentityKeyWithCategory(creditor), id] as const;
      }));
      const allocationByKey = new Map(line.projectAllocations.map((allocation) => {
        const id = randomUUID();
        allocationRows.push({
          id,
          personLineId,
          projectId: allocation.projectId,
          serviceSnapshotId: allocation.serviceSnapshotId,
          serviceBasisBindingId: required(serviceBindingByKey.get(serviceBasisKey(allocation))?.id, "工资草稿的服务依据绑定不完整，不能写入"),
          serviceSnapshot: jsonValue({ ...allocation, project: projectById.get(allocation.projectId) }),
          amountCents: BigInt(allocation.amountCents)
        });
        return [serviceBasisKey(allocation), id] as const;
      }));
      if (!line.projectCostComponentAllocations || !line.projectCreditorAllocations) {
        throw new BadRequestException("项目成本组成矩阵和项目债权人矩阵必须同时明确填写");
      }
      componentMatrixRows.push(...line.projectCostComponentAllocations.map((cell) => ({
        id: randomUUID(),
        projectAllocationId: required(allocationByKey.get(`${cell.projectId}:${cell.serviceSnapshotId}`), "工资成本矩阵缺少项目分摊行"),
        costComponentId: required(componentByCode.get(cell.componentCode), "工资成本矩阵缺少成本组成行"),
        amountCents: BigInt(cell.amountCents)
      })));
      creditorMatrixRows.push(...line.projectCreditorAllocations.map((cell) => ({
        id: randomUUID(),
        projectAllocationId: required(allocationByKey.get(`${cell.projectId}:${cell.serviceSnapshotId}`), "工资债权人矩阵缺少项目分摊行"),
        creditorBreakdownId: required(creditorByKey.get(creditorIdentityKeyWithCategory(cell)), "工资债权人矩阵缺少债权人行"),
        amountCents: BigInt(cell.amountCents)
      })));
    }

    await this.writeBatch("人员事实", personRows.length, () => tx.wagePersonLine.createMany({ data: personRows }));
    await this.writeBatch("成本组成", componentRows.length, () => tx.wageCostComponent.createMany({ data: componentRows }));
    await this.writeBatch("债权人拆分", creditorRows.length, () => tx.wageCreditorBreakdown.createMany({ data: creditorRows }));
    await this.writeBatch("项目分摊", allocationRows.length, () => tx.wageProjectAllocation.createMany({ data: allocationRows }));
    await this.writeBatch("项目成本组成矩阵", componentMatrixRows.length, () => tx.wageProjectCostComponentAllocation.createMany({ data: componentMatrixRows }));
    await this.writeBatch("工资项目债权人矩阵", creditorMatrixRows.length, () => tx.wageProjectCreditorAllocation.createMany({ data: creditorMatrixRows }));
  }

  private async writeBatch(label: string, expected: number, write: () => Promise<{ count: number }>) {
    try {
      const result = await write();
      if (result.count !== expected) throw new ConflictException(`${label}批量写入数量不一致，事务已回滚`);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException(`${label}批量写入失败，事务已回滚`);
    }
  }

  async submit(actorUserId: string, statementId: string, input: WageStatementCommandDto) {
    await this.assertAction(actorUserId, "wage_statement.submit", "当前公司岗位无权提交工资承担单");
    validateCommand(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.submit", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const version = await this.currentVersion(tx, statement.id, statement.currentRevision);
      if (version.status !== "draft") throw new ConflictException("只有草稿工资承担单可以提交");
      await tx.wageStatementVersion.update({
        where: { id: version.id },
        data: { status: "submitted", submittedByUserId: actorUserId, submittedAt: new Date(), lastEditedByUserId: actorUserId }
      });
      const result = { statementId: id, versionId: version.id, revision: statement.currentRevision, status: "submitted" };
      await this.receipt(tx, input, "wage_statement.submit", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.submit", businessType: "wage_statement_version", businessId: version.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision }) });
      return result;
    }));
  }

  async returnForReview(actorUserId: string, statementId: string, input: ReturnWageStatementDto) {
    await this.assertAction(actorUserId, "wage_statement.return", "当前公司岗位无权退回工资承担单");
    validateCommand(input);
    const reason = required(input.reason, "退回原因不能为空");
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.return", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const submitted = await tx.wageStatementVersion.findUnique({
        where: { statementId_revision: { statementId: statement.id, revision: statement.currentRevision } },
        include: {
          personLines: {
            include: {
              costComponents: true,
              creditorBreakdowns: true,
              projectAllocations: {
                include: { componentAllocations: true, creditorAllocations: true }
              }
            }
          }
        }
      });
      if (!submitted) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
      if (submitted.status !== "submitted") throw new ConflictException("只有已提交工资承担单可以退回");
      const nextRevision = statement.currentRevision + 1;
      // The returned submitted revision remains an immutable, superseded audit
      // record; the replacement draft carries the next editable revision.
      await tx.wageStatementVersion.update({ where: { id: submitted.id }, data: { status: "superseded", reviewDisposition: "review_returned", reviewReturnedByUserId: actorUserId, reviewReturnedAt: new Date(), reviewReturnReason: reason, supersededAt: new Date() } });
      const replacement = await tx.wageStatementVersion.create({
        data: {
          id: randomUUID(), statementId: id, revision: nextRevision, kind: "base", status: "draft", sourceVersionId: submitted.sourceVersionId,
          sourceSnapshot: jsonValue(submitted.sourceSnapshot), createdByUserId: actorUserId, lastEditedByUserId: actorUserId,
          personLines: {
            create: submitted.personLines.map((line) => {
              const costIds = new Map(line.costComponents.map((component) => [component.id, randomUUID()]));
              const creditorIds = new Map(line.creditorBreakdowns.map((creditor) => [creditor.id, randomUUID()]));
              return {
                id: randomUUID(),
                employeeId: line.employeeId,
                employmentSnapshotId: line.employmentSnapshotId,
                employeeSnapshot: jsonValue(line.employeeSnapshot),
                employmentSnapshot: jsonValue(line.employmentSnapshot),
                periodSnapshot: jsonValue(line.periodSnapshot),
                positionCategorySnapshot: jsonValue(line.positionCategorySnapshot),
                approvedAmountCents: line.approvedAmountCents,
                costComponents: {
                  create: line.costComponents.map((component) => ({
                    id: costIds.get(component.id), componentCode: component.componentCode,
                    amountCents: component.amountCents, sourceSnapshot: jsonValue(component.sourceSnapshot)
                  }))
                },
                creditorBreakdowns: {
                  create: line.creditorBreakdowns.map((creditor) => ({
                    id: creditorIds.get(creditor.id), creditorSubjectId: creditor.creditorSubjectId,
                    creditorSubjectType: creditor.creditorSubjectType, creditorUserId: creditor.creditorUserId,
                    creditorBusinessPartyVersionId: creditor.creditorBusinessPartyVersionId,
                    creditorSubjectIdentityKey: creditor.creditorSubjectIdentityKey,
                    creditorNameSnapshot: creditor.creditorNameSnapshot,
                    creditorUnifiedIdentitySnapshot: creditor.creditorUnifiedIdentitySnapshot,
                    creditorVersionFingerprint: creditor.creditorVersionFingerprint,
                    creditorCategory: creditor.creditorCategory, amountCents: creditor.amountCents,
                    sourceSnapshot: jsonValue(creditor.sourceSnapshot)
                  }))
                },
                projectAllocations: {
                  create: line.projectAllocations.map((allocation) => ({
                    id: randomUUID(), projectId: allocation.projectId,
                    serviceSnapshotId: allocation.serviceSnapshotId,
                    serviceBasisBinding: { connect: { id: allocation.serviceBasisBindingId } },
                    serviceSnapshot: jsonValue(allocation.serviceSnapshot), amountCents: allocation.amountCents,
                    componentAllocations: {
                      create: allocation.componentAllocations.map((cell) => ({
                        costComponent: { connect: { id: costIds.get(cell.costComponentId)! } }, amountCents: cell.amountCents
                      }))
                    },
                    creditorAllocations: {
                      create: allocation.creditorAllocations.map((cell) => ({
                        creditorBreakdown: { connect: { id: creditorIds.get(cell.creditorBreakdownId)! } }, amountCents: cell.amountCents
                      }))
                    }
                  }))
                }
              };
            })
          }
        }, select: { id: true }
      });
      await tx.wageStatement.update({ where: { id }, data: { currentRevision: nextRevision } });
      const result = { statementId: id, versionId: replacement.id, revision: nextRevision, status: "draft" };
      await this.receipt(tx, input, "wage_statement.return", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.return", businessType: "wage_statement_version", businessId: submitted.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision, nextRevision, reason }) });
      return result;
    }));
  }

  async confirm(actorUserId: string, statementId: string, input: WageStatementCommandDto) {
    await this.assertAction(actorUserId, "wage_statement.confirm", "当前公司岗位无权确认工资承担单");
    validateCommand(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.confirm", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const version = await this.currentVersion(tx, statement.id, statement.currentRevision);
      if (version.status !== "submitted") throw new ConflictException("只有已提交工资承担单可以确认");
      // No public adjustment endpoint is exposed. A later controlled lifecycle
      // owner may prepare one of these dispositions, but it can only become
      // effective through this existing segregated confirmation transaction.
      wageVersionKind(version.kind);
      const lockedVersion = await this.lockAndRevalidateConfirmationFacts(tx, statement, version.id);
      await this.assertConfirmationSeparation(tx, actorUserId, version);
      await this.assertNoAssignedWageConflictInTransaction(tx, lockedVersion.id, statement.wageMonth);
      await this.projectConfirmedVersion(tx, lockedVersion.id, statement.employmentCompanyId, statement.currentRevision, actorUserId);
      await tx.wageStatementVersion.update({ where: { id: lockedVersion.id }, data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: new Date() } });
      const result = { statementId: id, versionId: lockedVersion.id, revision: statement.currentRevision, status: "confirmed" };
      await this.receipt(tx, input, "wage_statement.confirm", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.confirm", businessType: "wage_statement_version", businessId: lockedVersion.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision }) });
      return result;
    }));
  }

  private async lockAndRevalidateConfirmationFacts(
    tx: Tx,
    statement: { id: string; employmentCompanyId: string; wageMonth: string; currentRevision: number },
    versionId: string
  ) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WageStatementVersion" WHERE id = ${versionId} FOR UPDATE`);
    const header = await tx.wageStatementVersion.findUnique({ where: { id: versionId }, select: { id: true, sourceVersionId: true, status: true } });
    if (!header || header.status !== "submitted") throw new ConflictException("工资承担单确认前版本状态已漂移");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WageApprovedSourceVersion" WHERE id = ${header.sourceVersionId} FOR UPDATE`);
    const source = await tx.wageApprovedSourceVersion.findUnique({ where: { id: header.sourceVersionId } });
    if (!source) throw new ConflictException("工资承担单批准来源已缺失，不能确认");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "FileObject" WHERE id = ${source.evidenceFileId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WageServiceBasisBinding" WHERE "sourceVersionId" = ${source.id} ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WagePersonLine" WHERE "statementVersionId" = ${versionId} ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT c.id FROM "WageCostComponent" c JOIN "WagePersonLine" p ON p.id = c."personLineId" WHERE p."statementVersionId" = ${versionId} ORDER BY c.id FOR UPDATE OF c`);
    await tx.$queryRaw(Prisma.sql`SELECT c.id FROM "WageCreditorBreakdown" c JOIN "WagePersonLine" p ON p.id = c."personLineId" WHERE p."statementVersionId" = ${versionId} ORDER BY c.id FOR UPDATE OF c`);
    await tx.$queryRaw(Prisma.sql`SELECT a.id FROM "WageProjectAllocation" a JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${versionId} ORDER BY a.id FOR UPDATE OF a`);
    await tx.$queryRaw(Prisma.sql`SELECT m.id FROM "WageProjectCostComponentAllocation" m JOIN "WageProjectAllocation" a ON a.id = m."projectAllocationId" JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${versionId} ORDER BY m.id FOR UPDATE OF m`);
    await tx.$queryRaw(Prisma.sql`SELECT m.id FROM "WageProjectCreditorAllocation" m JOIN "WageProjectAllocation" a ON a.id = m."projectAllocationId" JOIN "WagePersonLine" p ON p.id = a."personLineId" WHERE p."statementVersionId" = ${versionId} ORDER BY m.id FOR UPDATE OF m`);

    const locked = await tx.wageStatementVersion.findUnique({ where: { id: versionId }, include: WAGE_CONFIRMATION_INCLUDE });
    if (!locked || locked.status !== "submitted" || locked.statementId !== statement.id || locked.revision !== statement.currentRevision) {
      throw new ConflictException("工资承担单确认锁后版本已漂移");
    }
    const sourceLines = approvedSourceFacts(source);
    if (stableJson(locked.sourceSnapshot) !== stableJson(source.sourceSnapshot)) {
      throw new ConflictException("工资承担单冻结的批准来源快照已漂移，不能确认");
    }
    const [evidence, employees, bindings] = await Promise.all([
      tx.fileObject.findUnique({ where: { id: source.evidenceFileId }, select: { id: true, storageStatus: true, contentSha256: true } }),
      this.activeEmployees(tx, sourceLines),
      tx.wageServiceBasisBinding.findMany({ where: { sourceVersionId: source.id }, select: { id: true, projectId: true, serviceSnapshotId: true, serviceMonth: true, evidenceSha256: true, authorityFingerprint: true } })
    ]);
    assertSourceEvidenceActive(source, evidence);
    employeeMap(sourceLines, employees);
    const lines = storedDraftLines(locked, sourceLines, bindings);
    assertSourceFacts(lines, sourceLines, statement.employmentCompanyId, statement.wageMonth, source.periodStart, source.periodEnd);
    assertBalancedWageStatementDraft({
      wageMonth: statement.wageMonth,
      sourceTotalCents: sourceLines.reduce((sum, line) => sum + BigInt(line.approvedAmountCents), 0n).toString(),
      personLines: lines
    });
    const projects = await this.activeProjects(tx, lines);
    projectMap(lines, projects);
    serviceBasisBindingMap(source.id, lines, bindings, source.evidenceSha256, false);
    if (approvedSourcePurpose(source) === "full_reversal") {
      if (locked.kind !== "reversal") throw new ConflictException("全额冲销批准来源只能确认冲销版本");
      await this.lockAndRevalidateFullReversalSource(tx, source, lines, statement.currentRevision, true);
    } else if (locked.kind === "reversal") {
      throw new ConflictException("普通批准来源不得确认为冲销版本");
    }
    for (const person of locked.personLines) {
      this.assertCompleteStoredMatrices(person);
      for (const creditor of person.creditorBreakdowns) this.assertFrozenCreditor(creditor, person.employeeId);
    }
    return locked;
  }

  /**
   * Confirmation must stay independent from the complete effective identity
   * sets, rather than merely comparing the session users.  Standing approval
   * delegations are treated as undirected for this segregation check: either a
   * preparer acting through an agent or an agent acting for a preparer would
   * otherwise bypass the same control.  The rows are read in the confirmation
   * transaction so a concurrent delegation change cannot split the decision.
   */
  private async assertConfirmationSeparation(
    tx: Tx,
    actorUserId: string,
    version: Pick<
      Awaited<ReturnType<WageStatementService["currentVersion"]>>,
      "createdByUserId" | "lastEditedByUserId" | "submittedByUserId"
    >
  ) {
    const preparerIds = [
      version.createdByUserId,
      version.lastEditedByUserId,
      version.submittedByUserId
    ].filter((id): id is string => Boolean(id));
    const now = new Date();
    const delegations = await tx.approvalDelegation.findMany({
      where: {
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      select: { fromUserId: true, toUserId: true }
    });
    const effectiveActorIds = delegationIdentitySet(actorUserId, delegations);
    const effectivePreparerIds = new Set(
      preparerIds.flatMap((preparerId) => [...delegationIdentitySet(preparerId, delegations)])
    );
    if ([...effectiveActorIds].some((identityId) => effectivePreparerIds.has(identityId))) {
      throw new ConflictException("职责分离冲突：确认人不得为编制人、编辑人或提交人及其有效委托身份");
    }
  }

  private async assertNoAssignedWageConflictInTransaction(
    tx: Tx,
    statementVersionId: string,
    wageMonth: string
  ) {
    const people = await tx.wagePersonLine.findMany({
      where: { statementVersionId },
      select: {
        employeeId: true,
        projectAllocations: { select: { projectId: true } }
      },
      orderBy: { id: "asc" }
    });
    const employeeIdsByProject = new Map<string, Set<string>>();
    for (const person of people) {
      for (const allocation of person.projectAllocations) {
        const employeeIds = employeeIdsByProject.get(allocation.projectId) ?? new Set<string>();
        employeeIds.add(person.employeeId);
        employeeIdsByProject.set(allocation.projectId, employeeIds);
      }
    }
    const projectIds = [...employeeIdsByProject.keys()].sort((left, right) => left.localeCompare(right));
    if (!projectIds.length) {
      throw new ConflictException("工资确认缺少完整项目人员范围，不能确认");
    }
    await lockWageConflictBuckets(
      tx,
      projectIds.map((projectId) => ({ projectId, wageMonth }))
    );
    const authorities = await tx.affiliateClearingAuthorityVersion.findMany({
      where: { projectId: { in: projectIds }, status: "confirmed" },
      select: { id: true }
    });
    const lines = authorities.length
      ? await tx.assignedWageAuthorityLine.findMany({
          where: {
            authorityVersionId: { in: authorities.map((authority) => authority.id) },
            projectId: { in: projectIds },
            wageMonth: new Date(`${wageMonth}-01T00:00:00.000Z`)
          },
          select: { projectId: true, coverageKind: true, personAuthorityKey: true }
        })
      : [];
    for (const line of lines) {
      if (line.coverageKind === "ROLE_SUMMARY") {
        throw new ConflictException("B级岗位汇总与同项目同月 #105 工资来源重叠，必须整组阻断");
      }
      if (line.coverageKind !== "PERSON" || !line.personAuthorityKey) {
        throw new ConflictException("#214 工资权威覆盖类型或人员身份已漂移，必须失败关闭");
      }
      if (employeeIdsByProject.get(line.projectId)?.has(line.personAuthorityKey)) {
        throw new ConflictException("同人同月跨 #104/#105 工资来源冲突，必须整组阻断");
      }
    }
  }

  /**
   * The confirmation write is deliberately kept inside the caller's
   * Serializable transaction. It materializes immutable payables before the
   * version status flips, then asks the controlled operating ledger to append
   * exactly one no-payee project_wage envelope per project.
   */
  private async projectConfirmedVersion(
    tx: Tx,
    versionId: string,
    employmentCompanyId: string,
    revision: number,
    actorUserId: string,
    projectionOrigin: WageProjectionOrigin = "ordinary",
    historicalContext?: HistoricalWageProjectionContext
  ) {
    const operatingLedger = this.operatingLedger;
    if (projectionOrigin === "ordinary" && !operatingLedger) {
      throw new ConflictException("工资经营投影服务未配置，不能确认工资承担单");
    }
    if (projectionOrigin === "historical_takeover_legacy_link" && !historicalContext) {
      throw new ConflictException("历史工资接管投影缺少原子范围上下文，不能确认");
    }
    const version = await tx.wageStatementVersion.findUnique({
      where: { id: versionId },
      include: WAGE_CONFIRMATION_INCLUDE
    });
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const kind = wageVersionKind(version.kind);
    if (kind !== "base") {
      await this.projectSubsequentVersion(
        tx,
        version,
        employmentCompanyId,
        revision,
        actorUserId,
        kind,
        projectionOrigin,
        historicalContext
      );
      return;
    }
    if (projectionOrigin === "historical_takeover_legacy_link") {
      const context = historicalContext!;
      const current = semanticMatrixFromConfirmedVersion(version);
      const deltas = historicalWageSignedDeltas(current, emptyHistoricalWageSemanticMatrix());
      const projectIds = uniqueSorted(current.projectIds);
      if (
        kind !== "base" ||
        context.versionKind !== "base" ||
        context.targetWageStatementId !== version.statementId ||
        context.expectedCurrentRevision !== 0 ||
        context.reservedRevision !== 1 ||
        revision !== 1 ||
        context.priorConfirmedVersionId !== null ||
        context.priorSourceVersionId !== null ||
        context.sourceVersionId !== version.sourceVersionId ||
        !sameStringSet(projectIds, context.expectedProjectIds) ||
        context.sourceDeltaFingerprint !== historicalWageSourceDeltaFingerprint({
          targetWageStatementId: version.statementId,
          priorConfirmedVersionId: null,
          priorSourceVersionId: null,
          sourceVersionId: version.sourceVersionId,
          projectIds,
          deltas,
          current
        }) ||
        context.canonicalRootClosureFingerprint !== fingerprint([])
      ) {
        throw new ConflictException("历史工资基础版本的预留差额或原根闭合已漂移，不能确认");
      }
    }
    const direction = isWageDecreaseKind(kind) ? "decrease" : "increase";
    const adjustmentTargets: readonly WagePayableRefAdjustmentTarget[] = isWageDecreaseKind(kind)
      ? await tx.wagePayableRef.findMany({
          where: {
            adjustsPayableRefId: null,
            direction: "increase",
            confirmedVersion: {
              statementId: version.statementId,
              revision: { lt: version.revision },
              status: "confirmed"
            }
          },
          select: {
            id: true,
            debtorCompanyId: true,
            costBearingCompanyId: true,
            projectId: true,
            projectAllocation: { select: { serviceSnapshotId: true } },
            personLine: { select: { employeeId: true, employmentSnapshotId: true } },
            creditorBreakdown: {
              select: {
                creditorSubjectType: true,
                creditorSubjectIdentityKey: true,
                creditorCategory: true,
                creditorNameSnapshot: true,
                creditorUnifiedIdentitySnapshot: true,
                creditorVersionFingerprint: true
              }
            }
          }
        })
      : [];
    const occurredAt = version.sourceVersion.periodEnd as Date;
    const confirmedAt = new Date();
    const byProject = new Map<string, WageProjection>();
    for (const person of version.personLines) {
      this.assertCompleteStoredMatrices(person);
      const allocationById = new Map(person.projectAllocations.map((allocation) => [allocation.id, allocation]));
      const costById = new Map(person.costComponents.map((component) => [component.id, component]));
      const creditorById = new Map(person.creditorBreakdowns.map((creditor) => [creditor.id, creditor]));
      for (const creditor of creditorById.values()) this.assertFrozenCreditor(creditor, person.employeeId);
      for (const allocation of allocationById.values()) {
        const costTotal = allocation.componentAllocations.reduce((sum, cell) => sum + cell.amountCents, 0n);
        const creditorTotal = allocation.creditorAllocations.reduce((sum, cell) => sum + cell.amountCents, 0n);
        if (costTotal !== allocation.amountCents || creditorTotal !== allocation.amountCents) {
          throw new ConflictException("工资版本缺少完整交叉矩阵或项目分摊未逐分平衡，不能确认");
        }
        for (const component of costById.values()) {
          const total = [...allocationById.values()].reduce((sum, row) => sum + row.componentAllocations.filter((cell) => cell.costComponentId === component.id).reduce((rowSum, cell) => rowSum + cell.amountCents, 0n), 0n);
          if (total !== component.amountCents) throw new ConflictException("工资成本组成矩阵列合计未逐分平衡，不能确认");
        }
        for (const creditor of creditorById.values()) {
          const total = [...allocationById.values()].reduce((sum, row) => sum + row.creditorAllocations.filter((cell) => cell.creditorBreakdownId === creditor.id).reduce((rowSum, cell) => rowSum + cell.amountCents, 0n), 0n);
          if (total !== creditor.amountCents) throw new ConflictException("工资债权人矩阵列合计未逐分平衡，不能确认");
        }
        const project = byProject.get(allocation.projectId) ?? { amount: 0n, direction, kind, refs: [], costs: [], payables: [] };
        project.amount += allocation.amountCents;
        for (const cell of allocation.componentAllocations) {
          if (!costById.has(cell.costComponentId)) throw new ConflictException("工资成本矩阵引用不属于该人员行");
          if (cell.amountCents > 0n) project.costs.push({ allocation, cell });
        }
        for (const cell of allocation.creditorAllocations) {
          const creditor = creditorById.get(cell.creditorBreakdownId);
          if (!creditor) throw new ConflictException("工资债权人矩阵引用不属于该人员行");
          // A zero matrix cell is a required explicit finance decision, not an
          // accounting impact or payable. WagePayableRef is strictly positive.
          if (cell.amountCents === 0n) continue;
          const matchingTargets = isWageDecreaseKind(kind)
            ? adjustmentTargets.filter((target) =>
                target.debtorCompanyId === employmentCompanyId &&
                target.costBearingCompanyId === employmentCompanyId &&
                target.projectId === allocation.projectId &&
                target.projectAllocation.serviceSnapshotId === allocation.serviceSnapshotId &&
                target.personLine.employeeId === person.employeeId &&
                target.personLine.employmentSnapshotId === person.employmentSnapshotId &&
                target.creditorBreakdown.creditorSubjectType === creditor.creditorSubjectType &&
                target.creditorBreakdown.creditorSubjectIdentityKey === creditor.creditorSubjectIdentityKey &&
                target.creditorBreakdown.creditorCategory === creditor.creditorCategory
              )
            : [];
          if (isWageDecreaseKind(kind) && matchingTargets.length !== 1) {
            throw new ConflictException("工资更正或冲销必须逐笔且唯一地指向同一工资承担单既有正向应付引用");
          }
          const adjustmentTarget = matchingTargets[0];
          const ref = await tx.wagePayableRef.create({
            data: {
              id: randomUUID(), confirmedVersionId: version.id, projectAllocationId: allocation.id,
              creditorBreakdownId: creditor.id, debtorCompanyId: employmentCompanyId,
              costBearingCompanyId: employmentCompanyId, projectId: allocation.projectId, personLineId: person.id,
              debtorCompanySnapshot: jsonValue({ companyId: employmentCompanyId }),
              costBearingCompanySnapshot: jsonValue({ companyId: employmentCompanyId }),
              projectSnapshot: jsonValue({ projectId: allocation.projectId, serviceSnapshotId: allocation.serviceSnapshotId }),
              personSnapshot: jsonValue({ employeeId: person.employeeId, employmentSnapshotId: person.employmentSnapshotId }),
              creditorSnapshot: jsonValue(this.frozenCreditorSnapshot(creditor)),
              amountCents: cell.amountCents,
              direction,
              ...(adjustmentTarget
                ? { adjustsPayableRefId: adjustmentTarget.id, settlementRecheckRequired: true }
                : {})
            },
            select: { id: true }
          });
          project.refs.push(ref.id);
          project.payables.push({ allocation, cell, ref });
        }
        byProject.set(allocation.projectId, project);
      }
    }
    if (projectionOrigin === "historical_takeover_legacy_link") {
      const projects = Object.fromEntries(
        [...byProject.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([projectId, projection]) => [projectId, {
            payableRefIds: projection.refs,
            canonicalCostCellIds: projection.costs.map(({ cell }) => cell.id).sort(),
            canonicalPayableCellIds: projection.payables.map(({ cell }) => cell.id).sort()
          }])
      );
      await tx.wageStatementVersion.update({
        where: { id: version.id },
        data: {
          operatingProjectionSnapshot: jsonValue({
            formalStatus: "confirmed",
            projectionOrigin,
            wageStatementVersionId: version.id,
            sourceVersion: String(revision),
            wageVersionKind: kind,
            historicalTakeover: historicalContext,
            // These identifiers are canonical cells/ref targets for the
            // take-over envelope. No OperatingFact or OperatingImpactEntry is
            // produced from this path.
            projects
          })
        }
      });
      return;
    }
    if (!operatingLedger) {
      throw new ConflictException("工资经营投影服务未配置，不能确认工资承担单");
    }
    const projectWrites: Array<{
      projectId: string;
      projection: WageProjection;
      participant: { companyEntityId: string; companyEntityVersionId: string };
      snapshot: Prisma.InputJsonObject;
    }> = [];
    const projects: Record<string, Prisma.InputJsonObject> = {};
    for (const [projectId, projection] of byProject) {
      // A zero project-allocation row remains in the frozen finance matrix but
      // has no formal ledger impact or positive payable reference to publish.
      if (projection.amount === 0n) continue;
      const projectRecord = await tx.project.findUnique({
        where: { id: projectId },
        select: { operatingLedgerEffectiveDate: true }
      });
      if (!projectRecord?.operatingLedgerEffectiveDate) {
        throw new ConflictException("工资项目尚未启用经营账，不能确认");
      }
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: { projectId, companyEntityId: employmentCompanyId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { companyEntityId: true, companyEntityVersionId: true }
      });
      if (!participant) throw new ConflictException("工资劳动关系公司不是项目事实日有效参与公司，不能确认");
      const affiliate = await tx.projectAffiliateAssignment.findFirst({
        where: { projectId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { id: true, businessPartyVersionId: true, affiliateNameSnapshot: true, affiliateCreditCodeSnapshot: true }
      });
      if (!affiliate) throw new ConflictException("工资项目缺少事实日有效施工企业上下文，不能确认");
      const snapshot = jsonValue({
      formalStatus: "confirmed", projectionOrigin, wageStatementVersionId: version.id, sourceVersion: String(revision), wageVersionKind: kind,
        projectId, occurredAt: occurredAt.toISOString(), confirmedAt: confirmedAt.toISOString(),
        confirmedByUserId: actorUserId, employmentCompanyId,
        operatingLedgerEffectiveDate: projectRecord.operatingLedgerEffectiveDate.toISOString(),
        affiliate: { assignmentId: affiliate.id, businessPartyVersionId: affiliate.businessPartyVersionId, name: affiliate.affiliateNameSnapshot, creditCode: affiliate.affiliateCreditCodeSnapshot ?? undefined },
        payableRefIds: projection.refs,
        costDeltaCells: projection.costs.map(({ cell }) => ({ id: cell.id, direction: "increase" }))
      }) as Prisma.InputJsonObject;
      projects[projectId] = snapshot;
      projectWrites.push({ projectId, projection, participant, snapshot });
    }
    await tx.wageStatementVersion.update({
      where: { id: version.id },
      data: { operatingProjectionSnapshot: jsonValue({ formalStatus: "confirmed", wageStatementVersionId: version.id, sourceVersion: String(revision), wageVersionKind: kind, projects }) }
    });
    for (const { projectId, projection, participant, snapshot } of projectWrites) {
      await operatingLedger.appendConfirmedSourceInTransaction(tx, {
        projectId, sourceType: "wage_statement_version", sourceBusinessId: `${version.id}:${projectId}`,
        sourceBusinessCode: `工资承担单-${revision}`, sourceVersion: revision,
        idempotencyKey: `wage:${version.id}:${projectId}`, occurredAt, confirmedAt, confirmedByUserId: actorUserId,
        factKind: "project_wage", operatingLevel: "participating_company", evidenceLevel: "A",
        amountCents: projection.amount, currencyCode: "CNY", direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredAt.toISOString().slice(0, 10) < (snapshot.operatingLedgerEffectiveDate as string).slice(0, 10),
        affiliateAssignmentId: (snapshot.affiliate as Prisma.InputJsonObject).assignmentId as string,
        affiliateBusinessPartyVersionId: (snapshot.affiliate as Prisma.InputJsonObject).businessPartyVersionId as string,
        affiliateNameSnapshot: (snapshot.affiliate as Prisma.InputJsonObject).name as string,
        affiliateCreditCodeSnapshot: (snapshot.affiliate as Prisma.InputJsonObject).creditCode as string | undefined,
        sourceSnapshot: snapshot,
        subjects: { debtor: { kind: "participating_company", id: participant.companyEntityId }, costBearingCompany: { kind: "participating_company", id: participant.companyEntityId } },
        impacts: [
          ...projection.costs.map(({ cell }) => ({ idempotencyKey: `wage:${version.id}:${cell.id}:cost`, sourceImpactKey: `cost:${cell.id}`, impactKind: "confirmed_cost" as const, amountCents: cell.amountCents, direction: projection.direction, subjectRole: "cost_bearing_company" as const, subject: { kind: "participating_company" as const, id: participant.companyEntityId }, costCategoryCode: "crew_and_labor" as const, impactSnapshot: jsonValue({ wageCostComponentCode: cell.costComponent.componentCode }) as Prisma.InputJsonObject })),
          ...projection.payables.map(({ cell, ref }) => ({ idempotencyKey: `wage:${version.id}:${cell.id}:payable`, sourceImpactKey: `payable:${cell.id}`, impactKind: projection.direction === "increase" ? "payable_increase" as const : "payable_decrease" as const, amountCents: cell.amountCents, direction: projection.direction, impactSnapshot: jsonValue({ wagePayableRefId: ref.id }) as Prisma.InputJsonObject }))
        ]
      }, actorUserId);
    }
  }

  /**
   * Later revisions are complete replacement snapshots, but their formal
   * effects are strictly the signed difference from the immediately preceding
   * confirmed snapshot. Every correction/reversal cell must resolve to exactly
   * one immutable original ref (never an earlier adjustment); ambiguity is an
   * integrity failure rather than a reason to distribute the movement.
   */
  private async projectSubsequentVersion(
    tx: Tx,
    version: WageConfirmationVersion,
    employmentCompanyId: string,
    revision: number,
    actorUserId: string,
    kind: Exclude<WageVersionKind, "base">,
    projectionOrigin: WageProjectionOrigin = "ordinary",
    historicalContext?: HistoricalWageProjectionContext
  ) {
    const prior = projectionOrigin === "historical_takeover_legacy_link"
      ? await tx.wageStatementVersion.findUnique({
          where: {
            statementId_revision: {
              statementId: version.statementId,
              revision: version.revision - 1
            }
          },
          include: WAGE_CONFIRMATION_INCLUDE
        }) as WageConfirmationVersion | null
      : await tx.wageStatementVersion.findFirst({
          where: { statementId: version.statementId, revision: { lt: version.revision }, status: "confirmed" },
          orderBy: { revision: "desc" }, include: WAGE_CONFIRMATION_INCLUDE
        }) as WageConfirmationVersion | null;
    if (!prior) throw new ConflictException("后续工资修订缺少已确认的前置版本，不能确认");
    const current = wageMatrixIdentities(version);
    const previous = wageMatrixIdentities(prior);
    if (projectionOrigin === "historical_takeover_legacy_link") {
      if (
        version.projectionOrigin !== "historical_takeover_legacy_link" ||
        prior.projectionOrigin !== "historical_takeover_legacy_link"
      ) {
        throw new ConflictException("历史工资后续版本与前置版本必须属于同一接管 lineage");
      }
      assertExactHistoricalWageIdentities(current.costs, previous.costs, "成本组成");
      assertExactHistoricalWageIdentities(current.payables, previous.payables, "债权人");
    } else {
      assertRetainedWageIdentities(current.costs, previous.costs, "成本组成");
      assertRetainedWageIdentities(current.payables, previous.payables, "债权人");
    }
    const roots = await tx.wagePayableRef.findMany({
      where: {
        adjustsPayableRefId: null, direction: "increase",
        confirmedVersion: {
          statementId: version.statementId,
          revision: { lt: version.revision },
          status: "confirmed",
          ...(projectionOrigin === "historical_takeover_legacy_link"
            ? { projectionOrigin: "historical_takeover_legacy_link" }
            : {})
        }
      },
      select: {
        id: true, amountCents: true, debtorCompanyId: true, costBearingCompanyId: true, projectId: true,
        projectAllocation: { select: { serviceSnapshotId: true } },
        personLine: { select: { employeeId: true, employmentSnapshotId: true } },
        creditorBreakdown: { select: { creditorSubjectType: true, creditorSubjectIdentityKey: true, creditorCategory: true } },
        adjustments: { select: { id: true, direction: true, amountCents: true }, orderBy: { id: "asc" } }
      }, orderBy: { id: "asc" }
    }) as HistoricalWageRootRead[];
    const rootBalances = roots.map((root) => ({
      ...root,
      remaining: root.amountCents + root.adjustments.reduce((sum, adjustment) => sum + (adjustment.direction === "increase" ? adjustment.amountCents : -adjustment.amountCents), 0n)
    }));
    const currentSemantic = semanticMatrixFromConfirmedVersion(version);
    const previousSemantic = semanticMatrixFromConfirmedVersion(prior);
    const signedDeltas = historicalWageSignedDeltas(currentSemantic, previousSemantic);
    if (
      kind === "reversal" &&
      [...currentSemantic.costs.values(), ...currentSemantic.payables.values()].some((cell) => cell.amountCents !== 0n)
    ) {
      throw new ConflictException("工资全额冲销必须保留完整身份并提交显式零金额快照");
    }
    if (kind === "reversal" && (
      !signedDeltas.costs.some((delta) => delta.amountCents < 0n) ||
      !signedDeltas.payables.some((delta) => delta.amountCents < 0n) ||
      [...signedDeltas.costs, ...signedDeltas.payables].some((delta) => delta.amountCents > 0n)
    )) {
      throw new ConflictException("工资全额冲销必须产生真实负向差额，禁止无效或混合方向冲销");
    }
    const usedRoots = new Map<string, HistoricalWageRootRead & { effectiveAmountCents: bigint }>();
    if (kind !== "supplemental") {
      for (const delta of signedDeltas.payables) {
        const matching = roots.filter((root) =>
          root.debtorCompanyId === employmentCompanyId &&
          root.costBearingCompanyId === employmentCompanyId &&
          wageRootIdentity(root) === delta.key
        );
        if (matching.length !== 1) {
          throw new ConflictException("工资更正或冲销必须唯一指向同一不可变原始应付引用，不能确认");
        }
        const root = matching[0]!;
        const effectiveAmountCents = historicalWageRootEffectiveAmount(root);
        if (effectiveAmountCents < 0n || effectiveAmountCents + delta.amountCents < 0n) {
          throw new ConflictException("工资更正或冲销会使既有应付引用有效金额低于零，不能确认");
        }
        usedRoots.set(root.id, { ...root, effectiveAmountCents });
      }
    }
    if (projectionOrigin === "historical_takeover_legacy_link") {
      const context = historicalContext!;
      const projectIds = uniqueSorted(currentSemantic.projectIds);
      const rootClosureFingerprint = fingerprint(
        [...usedRoots.values()]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((root) => historicalWageRootReadSet(root))
      );
      if (
        context.versionKind !== kind ||
        context.targetWageStatementId !== version.statementId ||
        context.expectedCurrentRevision !== version.revision - 1 ||
        context.reservedRevision !== version.revision ||
        revision !== version.revision ||
        context.priorConfirmedVersionId !== prior.id ||
        context.priorSourceVersionId !== prior.sourceVersionId ||
        context.sourceVersionId !== version.sourceVersionId ||
        prior.status !== "confirmed" ||
        !sameStringSet(projectIds, context.expectedProjectIds) ||
        context.sourceDeltaFingerprint !== historicalWageSourceDeltaFingerprint({
          targetWageStatementId: version.statementId,
          priorConfirmedVersionId: prior.id,
          priorSourceVersionId: prior.sourceVersionId,
          sourceVersionId: version.sourceVersionId,
          projectIds,
          deltas: signedDeltas,
          current: currentSemantic
        }) ||
        context.canonicalRootClosureFingerprint !== rootClosureFingerprint
      ) {
        throw new ConflictException("历史工资后续版本的相邻差额、前置版本或原根闭合已漂移，不能确认");
      }
    }
    const byProject = new Map<string, WageDeltaProjection>();
    const projectFor = (projectId: string) => {
      const existing = byProject.get(projectId);
      if (existing) return existing;
      const next: WageDeltaProjection = { costs: [], payables: [], refs: [] };
      byProject.set(projectId, next);
      return next;
    };
    for (const projectId of currentSemantic.projectIds) projectFor(projectId);
    for (const [key, cell] of current.costs) {
      const previousAmount = previous.costs.get(key)?.amountCents ?? 0n;
      const delta = cell.amountCents - previousAmount;
      if (delta !== 0n) projectFor(cell.allocation.projectId).costs.push({ ...cell, amountCents: abs(delta), direction: delta > 0n ? "increase" : "decrease" });
    }
    for (const [key, cell] of current.payables) {
      const previousAmount = previous.payables.get(key)?.amountCents ?? 0n;
      const delta = cell.amountCents - previousAmount;
      if (delta === 0n) continue;
      const projection = projectFor(cell.allocation.projectId);
      if (kind === "supplemental") {
        if (delta < 0n) {
          throw new ConflictException("补发工资不能减少既有应付引用，须以更正或冲销确认");
        }
        const ref = await this.createWagePayableRef(tx, version.id, employmentCompanyId, cell, delta, "increase");
        projection.refs.push(ref.id);
        projection.payables.push({ ...cell, amountCents: delta, direction: "increase", ref });
        continue;
      }
      const matchingRoots = rootBalances.filter((candidate) =>
        candidate.debtorCompanyId === employmentCompanyId &&
        candidate.costBearingCompanyId === employmentCompanyId &&
        wageRootIdentity(candidate) === key
      );
      if (matchingRoots.length !== 1) {
        throw new ConflictException("工资更正或冲销必须唯一指向同一不可变原始应付引用，不能确认");
      }
      const root = matchingRoots[0]!;
      if (delta > 0n) {
        const ref = await this.createWagePayableRef(tx, version.id, employmentCompanyId, cell, delta, "increase", root.id);
        projection.refs.push(ref.id);
        projection.payables.push({ ...cell, amountCents: delta, direction: "increase", ref });
        continue;
      }
      const amount = -delta;
      if (root.remaining < amount) {
        throw new ConflictException("工资更正或冲销会使既有应付引用有效金额低于零，不能确认");
      }
      const ref = await this.createWagePayableRef(tx, version.id, employmentCompanyId, cell, amount, "decrease", root.id);
      root.remaining -= amount;
      projection.refs.push(ref.id);
      projection.payables.push({ ...cell, amountCents: amount, direction: "decrease", ref });
    }
    if (projectionOrigin === "historical_takeover_legacy_link") {
      if (!historicalContext) {
        throw new ConflictException("历史工资接管投影缺少原子范围上下文，不能确认");
      }
      const projects = Object.fromEntries(
        [...byProject.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([projectId, projection]) => [projectId, {
            canonicalCostDeltas: projection.costs.map((cost) => ({
              costCellId: cost.cell.id,
              amountCents: cost.amountCents.toString(),
              direction: cost.direction
            })),
            canonicalPayableDeltas: projection.payables.map((payable) => ({
              payableCellId: payable.cell.id,
              payableRefId: payable.ref.id,
              amountCents: payable.amountCents.toString(),
              direction: payable.direction
            }))
          }])
      );
      await tx.wageStatementVersion.update({
        where: { id: version.id },
        data: {
          operatingProjectionSnapshot: jsonValue({
            formalStatus: "confirmed",
            projectionOrigin,
            wageStatementVersionId: version.id,
            sourceVersion: String(revision),
            wageVersionKind: kind,
            historicalTakeover: historicalContext,
            projects
          })
        }
      });
      return;
    }
    const occurredAt = version.sourceVersion.periodEnd as Date;
    const confirmedAt = new Date();
    const writes: Array<{ projectId: string; projection: WageDeltaProjection; participant: { companyEntityId: string }; snapshot: Prisma.InputJsonObject }> = [];
    const projects: Record<string, Prisma.InputJsonObject> = {};
    for (const [projectId, projection] of byProject) {
      if (!projection.costs.length && !projection.payables.length) continue;
      const projectRecord = await tx.project.findUnique({ where: { id: projectId }, select: { operatingLedgerEffectiveDate: true } });
      if (!projectRecord?.operatingLedgerEffectiveDate) throw new ConflictException("工资项目尚未启用经营账，不能确认");
      const participant = await tx.projectParticipatingCompany.findFirst({
        where: { projectId, companyEntityId: employmentCompanyId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { companyEntityId: true }
      });
      if (!participant) throw new ConflictException("工资劳动关系公司不是项目事实日有效参与公司，不能确认");
      const affiliate = await tx.projectAffiliateAssignment.findFirst({
        where: { projectId, effectiveFrom: { lte: occurredAt }, OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] },
        select: { id: true, businessPartyVersionId: true, affiliateNameSnapshot: true, affiliateCreditCodeSnapshot: true }
      });
      if (!affiliate) throw new ConflictException("工资项目缺少事实日有效施工企业上下文，不能确认");
      const snapshot = jsonValue({
        formalStatus: "confirmed", projectionOrigin, wageStatementVersionId: version.id, sourceVersion: String(revision), wageVersionKind: kind,
        projectId, occurredAt: occurredAt.toISOString(), confirmedAt: confirmedAt.toISOString(), confirmedByUserId: actorUserId,
        employmentCompanyId, operatingLedgerEffectiveDate: projectRecord.operatingLedgerEffectiveDate.toISOString(),
        affiliate: { assignmentId: affiliate.id, businessPartyVersionId: affiliate.businessPartyVersionId, name: affiliate.affiliateNameSnapshot, creditCode: affiliate.affiliateCreditCodeSnapshot ?? undefined },
        payableRefIds: projection.refs,
        costDeltaCells: projection.costs.map((cost) => ({ id: cost.cell.id, direction: cost.direction }))
      }) as Prisma.InputJsonObject;
      projects[projectId] = snapshot;
      writes.push({ projectId, projection, participant, snapshot });
    }
    await tx.wageStatementVersion.update({
      where: { id: version.id },
      data: { operatingProjectionSnapshot: jsonValue({ formalStatus: "confirmed", wageStatementVersionId: version.id, sourceVersion: String(revision), wageVersionKind: kind, projects }) }
    });
    for (const { projectId, projection, participant, snapshot } of writes) {
      const costTotal = projection.costs.reduce((sum, cell) => sum + cell.amountCents, 0n);
      const payableTotal = projection.payables.reduce((sum, cell) => sum + cell.amountCents, 0n);
      const amountCents = costTotal > payableTotal ? costTotal : payableTotal;
      await this.operatingLedger!.appendConfirmedSourceInTransaction(tx, {
        projectId, sourceType: "wage_statement_version", sourceBusinessId: `${version.id}:${projectId}`, sourceBusinessCode: `工资承担单-${revision}`,
        sourceVersion: revision, idempotencyKey: `wage:${version.id}:${projectId}`, occurredAt, confirmedAt, confirmedByUserId: actorUserId,
        factKind: "project_wage", operatingLevel: "participating_company", evidenceLevel: "A", amountCents, currencyCode: "CNY", direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredAt.toISOString().slice(0, 10) < (snapshot.operatingLedgerEffectiveDate as string).slice(0, 10),
        affiliateAssignmentId: (snapshot.affiliate as Prisma.InputJsonObject).assignmentId as string,
        affiliateBusinessPartyVersionId: (snapshot.affiliate as Prisma.InputJsonObject).businessPartyVersionId as string,
        affiliateNameSnapshot: (snapshot.affiliate as Prisma.InputJsonObject).name as string,
        affiliateCreditCodeSnapshot: (snapshot.affiliate as Prisma.InputJsonObject).creditCode as string | undefined,
        sourceSnapshot: snapshot,
        subjects: { debtor: { kind: "participating_company", id: participant.companyEntityId }, costBearingCompany: { kind: "participating_company", id: participant.companyEntityId } },
        impacts: [
          ...projection.costs.map((cost) => ({ idempotencyKey: `wage:${version.id}:${cost.cell.id}:cost:${cost.direction}`, sourceImpactKey: `cost:${cost.cell.id}:${cost.direction}`, impactKind: "confirmed_cost" as const, amountCents: cost.amountCents, direction: cost.direction, subjectRole: "cost_bearing_company" as const, subject: { kind: "participating_company" as const, id: participant.companyEntityId }, costCategoryCode: "crew_and_labor" as const, impactSnapshot: jsonValue({ wageCostComponentCode: cost.cell.costComponent.componentCode }) as Prisma.InputJsonObject })),
          ...projection.payables.map((payable) => ({ idempotencyKey: `wage:${version.id}:${payable.cell.id}:payable:${payable.ref.id}`, sourceImpactKey: `payable:${payable.cell.id}:${payable.ref.id}`, impactKind: payable.direction === "increase" ? "payable_increase" as const : "payable_decrease" as const, amountCents: payable.amountCents, direction: payable.direction, impactSnapshot: jsonValue({ wagePayableRefId: payable.ref.id }) as Prisma.InputJsonObject }))
        ]
      }, actorUserId);
    }
  }

  private async createWagePayableRef(
    tx: Tx, versionId: string, employmentCompanyId: string, cell: WagePayableCellIdentity, amountCents: bigint,
    direction: "increase" | "decrease", adjustsPayableRefId?: string
  ) {
    return tx.wagePayableRef.create({
      data: {
        id: randomUUID(), confirmedVersionId: versionId, projectAllocationId: cell.allocation.id, creditorBreakdownId: cell.creditor.id,
        debtorCompanyId: employmentCompanyId, costBearingCompanyId: employmentCompanyId, projectId: cell.allocation.projectId, personLineId: cell.person.id,
        debtorCompanySnapshot: jsonValue({ companyId: employmentCompanyId }), costBearingCompanySnapshot: jsonValue({ companyId: employmentCompanyId }),
        projectSnapshot: jsonValue({ projectId: cell.allocation.projectId, serviceSnapshotId: cell.allocation.serviceSnapshotId }),
        personSnapshot: jsonValue({ employeeId: cell.person.employeeId, employmentSnapshotId: cell.person.employmentSnapshotId }),
        creditorSnapshot: jsonValue(this.frozenCreditorSnapshot(cell.creditor)), amountCents, direction,
        ...(adjustsPayableRefId ? { adjustsPayableRefId, settlementRecheckRequired: direction === "decrease" } : {})
      }, select: { id: true }
    });
  }

  /** Confirmation must re-check persisted cells, because pre-confirmation
   * writes may be old, manually malformed, or otherwise outside DTO parsing. */
  private assertCompleteStoredMatrices(person: {
    costComponents: Array<{ id: string }>;
    creditorBreakdowns: Array<{ id: string }>;
    projectAllocations: Array<{
      componentAllocations: Array<{ costComponentId: string }>;
      creditorAllocations: Array<{ creditorBreakdownId: string }>;
    }>;
  }) {
    const costIds = new Set(person.costComponents.map((component) => component.id));
    const creditorIds = new Set(person.creditorBreakdowns.map((creditor) => creditor.id));
    for (const allocation of person.projectAllocations) {
      this.assertCompleteStoredMatrixRow(
        allocation.componentAllocations.map((cell) => cell.costComponentId),
        costIds,
        "成本组成"
      );
      this.assertCompleteStoredMatrixRow(
        allocation.creditorAllocations.map((cell) => cell.creditorBreakdownId),
        creditorIds,
        "债权人"
      );
    }
  }

  private assertCompleteStoredMatrixRow(actualIds: string[], expectedIds: ReadonlySet<string>, kind: string) {
    if (actualIds.length !== expectedIds.size || new Set(actualIds).size !== actualIds.length || actualIds.some((id) => !expectedIds.has(id))) {
      throw new ConflictException(`工资版本缺少完整交叉矩阵：每个项目分摊必须包含全部${kind}单元（含零金额）`);
    }
  }

  private assertFrozenCreditor(creditor: WageConfirmationCreditor, employeeId: string) {
    const employee = creditor.creditorSubjectType === "employee_user" && creditor.creditorUserId;
    const businessParty = creditor.creditorSubjectType === "business_party" && creditor.creditorBusinessPartyVersionId;
    if ((!employee && !businessParty) || !creditor.creditorSubjectIdentityKey || !creditor.creditorNameSnapshot || !creditor.creditorVersionFingerprint) {
      throw new ConflictException("旧工资版本缺少冻结债权人身份，不能确认");
    }
    if (employee && creditor.creditorUserId !== employeeId && creditor.creditorCategory === "employee_net_pay") {
      throw new ConflictException("员工净付债权人必须绑定该人员");
    }
  }

  private frozenCreditorSnapshot(creditor: WageConfirmationCreditor) {
    return {
      subjectType: creditor.creditorSubjectType,
      identityKey: creditor.creditorSubjectIdentityKey,
      name: creditor.creditorNameSnapshot,
      unifiedIdentity: creditor.creditorUnifiedIdentitySnapshot ?? null,
      versionFingerprint: creditor.creditorVersionFingerprint,
      category: creditor.creditorCategory
    };
  }

  private async assertPrepareAuthority(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("wage_statement.prepare", roles)) {
      throw new ForbiddenException("当前公司岗位无权编制工资承担单");
    }
  }

  private async assertReadAuthority(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("wage_sensitive_read", roles)) {
      throw new ForbiddenException("当前公司岗位无权查看工资汇总");
    }
  }

  private async nonSensitiveSummaryAccess(actorUserId: string): Promise<
    | { kind: "company" }
    | { kind: "project_category"; projectIds: string[] }
  > {
    let globalRoles: string[] = [];
    try {
      globalRoles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    } catch {
      // Project-only management positions are intentionally resolved through
      // the visibility seam below, not by treating a missing global role as a
      // company-wide permission.
    }
    if (globalRoles.some((role) => role === "chairman" || role === "general_manager")) {
      return { kind: "company" };
    }
    if (!this.projectVisibility) {
      throw new ForbiddenException("当前账号无权查看工资非敏感汇总");
    }
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(actorUserId);
    const roleKeysByProject = await this.projectVisibility.effectiveRoleKeysByProject(
      actorUserId,
      visibleProjectIds
    );
    const allowedProjectIds = visibleProjectIds.filter((projectId) =>
      (roleKeysByProject.get(projectId) ?? []).some(
        (role) => role === "contract_director" || role === "project_manager"
      )
    );
    if (!allowedProjectIds.length) {
      throw new ForbiddenException("当前账号无权查看工资非敏感汇总");
    }
    return { kind: "project_category", projectIds: allowedProjectIds };
  }

  /**
   * Returns only action booleans derived from the canonical active-role resolver.
   * It is deliberately a separate read seam so clients can re-check immediately
   * before an irreversible command instead of treating aggregate-read hints as authority.
   */
  async capabilities(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    return {
      canPrepare: canPerform("wage_statement.prepare", roles),
      canSubmit: canPerform("wage_statement.submit", roles),
      canReturn: canPerform("wage_statement.return", roles),
      canConfirm: canPerform("wage_statement.confirm", roles),
      canReadSensitive: canPerform("wage_sensitive_read", roles),
      canDownloadSensitive: canPerform("wage_sensitive_download", roles),
      canExportSensitive: canPerform("wage_sensitive_export", roles)
    };
  }

  private async aggregateStatement(statementId: string) {
    const id = required(statementId, "工资承担单不能为空");
    const statement = await this.prisma.wageStatement.findUnique({
      where: { id },
      select: WAGE_AGGREGATE_SELECT
    });
    if (!statement) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    return statement;
  }

  private async companyNames(companyIds: string[]) {
    const ids = [...new Set(companyIds)];
    const companies = ids.length
      ? await this.prisma.companyEntity.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(companies.map((company) => [company.id, company.name]));
    if (names.size !== ids.length) {
      throw new ConflictException("工资承担单关联公司缺失，请停止操作并复核数据");
    }
    return names;
  }

  private aggregate(statement: WageAggregateStatement, companyNames: Map<string, string>) {
    const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const positionCounts = new Map<string, { personLineCount: number; projectAllocationCount: number }>();
    let projectAllocationCount = 0;
    for (const line of version.personLines) {
      const category = positionCategoryKey(line.positionCategorySnapshot);
      const counts = positionCounts.get(category) ?? { personLineCount: 0, projectAllocationCount: 0 };
      counts.personLineCount += 1;
      counts.projectAllocationCount += line.projectAllocations.length;
      projectAllocationCount += line.projectAllocations.length;
      positionCounts.set(category, counts);
    }
    const categories = [...positionCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, counts], index) => ({
        // Upstream categories are free-text authority facts. This global workbench
        // exposes only a stable aggregate bucket, never the raw upstream value.
        positionCategoryLabel: `岗位类别 ${index + 1}`,
        personLineCount: counts.personLineCount,
        projectAllocationCount: counts.projectAllocationCount
      }));
    const returned = statement.versions
      .filter((candidate) => candidate.reviewDisposition === "review_returned" && candidate.reviewReturnedAt)
      .sort((left, right) => right.revision - left.revision)[0];
    return {
      employmentCompanyName: companyNames.get(statement.employmentCompanyId)!,
      status: workbenchStatus(version.status),
      statusLabel: workbenchStatusLabel(version.status),
      sourceLabel: `外部批准工资资料 ${version.sourceVersion.externalReference}（${version.sourceVersion.sourceVersion}）`,
      personLineCount: version.personLines.length,
      positionCategoryCount: categories.length,
      projectAllocationCount,
      categories,
      latestReviewReturn: returned
        ? { revision: returned.revision, returnedAt: returned.reviewReturnedAt!.toISOString() }
        : null
    };
  }

  private aggregateProjectCategories(statement: WageAggregateStatement, projectIds: string[]) {
    const visibleProjectIds = new Set(projectIds);
    const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const categoryCounts = new Map<string, number>();
    let projectAllocationCount = 0;
    for (const line of version.personLines) {
      const visibleAllocations = line.projectAllocations.filter((allocation) => visibleProjectIds.has(allocation.projectId));
      if (!visibleAllocations.length) continue;
      const category = positionCategoryKey(line.positionCategorySnapshot);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + visibleAllocations.length);
      projectAllocationCount += visibleAllocations.length;
    }
    return {
      projectAllocationCount,
      categories: [...categoryCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, count], index) => ({
        positionCategoryLabel: `岗位类别 ${index + 1}`,
        projectAllocationCount: count
      }))
    };
  }

  private aggregateProjectSummaries(statement: WageAggregateStatement) {
    const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const allocationCounts = new Map<string, number>();
    for (const line of version.personLines) {
      for (const allocation of line.projectAllocations) {
        allocationCounts.set(allocation.projectId, (allocationCounts.get(allocation.projectId) ?? 0) + 1);
      }
    }
    return [...allocationCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, projectAllocationCount], index) => ({
      projectLabel: `项目 ${index + 1}`,
      projectAllocationCount
    }));
  }

  private async assertAction(actorUserId: string, action: "wage_statement.submit" | "wage_statement.return" | "wage_statement.confirm", message: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform(action, roles)) throw new ForbiddenException(message);
  }

  private async lockStatement(tx: Tx, statementId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "WageStatement" WHERE id = ${statementId} FOR UPDATE`);
    if (!locked.length) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    const statement = await tx.wageStatement.findUnique({
      where: { id: statementId },
      select: { id: true, employmentCompanyId: true, wageMonth: true, currentRevision: true }
    });
    if (!statement) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    return statement;
  }

  private async currentVersion(tx: Tx, statementId: string, revision: number) {
    const row = await tx.wageStatementVersion.findUnique({
      where: { statementId_revision: { statementId, revision } }
    });
    if (!row) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    return row;
  }

  private async replay(tx: Tx, idempotencyKey: string, fingerprintValue: string) {
    validateIdempotencyKey(idempotencyKey);
    const receipt = await tx.wageCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprintValue) throw new ConflictException("同一幂等键不能用于不同工资承担单命令");
    return receipt.resultSnapshot;
  }

  private async replayApprovedSource(tx: Tx, idempotencyKey: string, fingerprintValue: string) {
    validateIdempotencyKey(idempotencyKey);
    const receipt = await tx.wageApprovedSourceCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprintValue) throw new ConflictException("同一幂等键不能用于不同外部工资来源命令");
    return receipt.resultSnapshot;
  }

  private async receipt(tx: Tx, input: WageStatementCommandDto, action: string, aggregateId: string, fingerprintValue: string, actorUserId: string, result: unknown) {
    try {
      return await tx.wageCommandReceipt.create({ data: { idempotencyKey: input.idempotencyKey, action, aggregateId, expectedRevision: input.expectedRevision, actorUserId, fingerprint: fingerprintValue, resultSnapshot: jsonValue(result) } });
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new WageReceiptRaceError("statement");
      throw error;
    }
  }

  private async approvedSourceReceipt(tx: Tx, input: CreateApprovedWageSourceDto, action: string, aggregateId: string, fingerprintValue: string, actorUserId: string, result: unknown) {
    try {
      return await tx.wageApprovedSourceCommandReceipt.create({ data: { idempotencyKey: input.idempotencyKey, action, aggregateId, expectedRevision: input.expectedRevision, actorUserId, fingerprint: fingerprintValue, resultSnapshot: jsonValue(result) } });
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new WageReceiptRaceError("approved_source");
      throw error;
    }
  }

  private activeEmployees(tx: Tx, lines: Array<Pick<ApprovedWagePersonDto, "employeeId">>) {
    const ids = [...new Set(lines.map((line) => required(line.employeeId, "人员不能为空")))];
    return tx.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, departmentId: true }
    });
  }

  private activeProjects(tx: Tx, lines: WagePersonLineInput[]) {
    const ids = [...new Set(lines.flatMap((line) => line.projectAllocations.map((allocation) => required(allocation.projectId, "分摊项目不能为空"))))];
    return tx.project.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, code: true, name: true }
    });
  }

  private async ensureServiceBasisBindings(
    tx: Tx,
    sourceVersionId: string,
    lines: WagePersonLineInput[],
    evidenceSha256: string
  ) {
    const definitions = serviceBasisDefinitions(lines, evidenceSha256);
    const existing = await tx.wageServiceBasisBinding.findMany({
      where: { sourceVersionId },
      select: { id: true, projectId: true, serviceSnapshotId: true, serviceMonth: true, evidenceSha256: true, authorityFingerprint: true }
    });
    const existingByKey = new Map(existing.map((binding) => [serviceBasisKey(binding), binding]));
    const missing = definitions.filter((definition) => !existingByKey.has(serviceBasisKey(definition))).map((definition) => {
      const id = randomUUID();
      return {
        id,
        sourceVersionId,
        ...definition,
        authorityFingerprint: serviceBasisFingerprint(sourceVersionId, definition)
      };
    });
    if (missing.length) {
      try {
        const result = await tx.wageServiceBasisBinding.createMany({ data: missing });
        if (result.count !== missing.length) throw new ConflictException("服务依据批量写入数量不一致，事务已回滚");
      } catch (error) {
        if (prismaCode(error) === "P2002") throw new WageRetryableRaceError();
        if (isSerializableConflict(error)) throw error;
        if (error instanceof ConflictException) throw error;
        throw new ConflictException("服务依据批量写入失败，事务已回滚");
      }
    }
    const all = [...existing, ...missing];
    return serviceBasisBindingMap(sourceVersionId, lines, all, evidenceSha256, false);
  }

  private async lockIdempotencyKey(tx: Tx, kind: WageReceiptKind, idempotencyKey: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}:${idempotencyKey}`}, 0))::TEXT AS "lockAcquired"
    `);
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // A receipt collision can only happen at the final write of the same command.
  // Its transaction is aborted, so a fresh read is required before returning the
  // winning durable snapshot. Other P2002 errors remain business conflicts.
  private async executeWithReceiptReplay<T>(
    idempotencyKey: string,
    fingerprintValue: string,
    kind: WageReceiptKind,
    work: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (error instanceof WageReceiptRaceError) {
          if (error.kind !== kind) throw error;
          return this.readWinningReceipt<T>(idempotencyKey, fingerprintValue, kind);
        }
        if (error instanceof WageNaturalKeyRaceError) {
          if (error.kind !== kind) throw error;
          return this.readWinningReceipt<T>(idempotencyKey, fingerprintValue, kind, error.message);
        }
        if (error instanceof WageRetryableRaceError || isSerializableConflict(error)) {
          if (attempt < 2) continue;
          throw new ConflictException("工资承担单并发写入未能完成，请刷新后重试");
        }
        throw error;
      }
    }
    throw new ConflictException("工资承担单并发写入未能完成，请刷新后重试");
  }

  private async readWinningReceipt<T>(
    idempotencyKey: string,
    fingerprintValue: string,
    kind: WageReceiptKind,
    missingMessage = "工资承担单幂等命令仍在并发处理中，请使用同一幂等键重试"
  ): Promise<T> {
    const receipt = kind === "statement"
      ? await this.prisma.wageCommandReceipt.findUnique({ where: { idempotencyKey } })
      : await this.prisma.wageApprovedSourceCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) throw new ConflictException(missingMessage);
    if (receipt.fingerprint !== fingerprintValue) {
      throw new ConflictException(kind === "statement" ? "同一幂等键不能用于不同工资承担单命令" : "同一幂等键不能用于不同外部工资来源命令");
    }
    return receipt.resultSnapshot as T;
  }
}

type WageReceiptKind = "statement" | "approved_source";

class WageReceiptRaceError extends Error {
  constructor(readonly kind: WageReceiptKind) {
    super("wage receipt unique-key race");
  }
}

class WageNaturalKeyRaceError extends Error {
  constructor(readonly kind: WageReceiptKind, message: string) {
    super(message);
  }
}

class WageRetryableRaceError extends Error {
  constructor() {
    super("retryable wage natural-key race");
  }
}

function normalizeApprovedSource(input: CreateApprovedWageSourceDto) {
  validateIdempotencyKey(input.idempotencyKey);
  if (input.expectedRevision !== 0) throw new ConflictException("新建外部工资来源的 expectedRevision 必须为 0");
  const sourcePurpose = input.sourcePurpose;
  if (sourcePurpose !== "ordinary" && sourcePurpose !== "full_reversal") {
    throw new BadRequestException("外部批准工资来源用途必须明确为普通工资或全额冲销");
  }
  const wageMonth = required(input.wageMonth, "工资月份不能为空");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(wageMonth)) throw new BadRequestException("工资月份必须使用 YYYY-MM 格式");
  const periodStart = validDateOnly(input.periodStart, "工资期间开始日不正确");
  const periodEnd = validDateOnly(input.periodEnd, "工资期间结束日不正确");
  const [year, month] = wageMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (periodStart !== `${wageMonth}-01` || periodEnd !== `${wageMonth}-${String(lastDay).padStart(2, "0")}`) {
    throw new BadRequestException("外部批准工资来源必须覆盖完整自然月");
  }
  const lines = input.approvedPersonLines;
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("外部批准工资来源至少需要一条人员事实");
  if (lines.length > MAX_WAGE_PERSON_LINES) throw new BadRequestException(`外部批准工资来源人员不能超过 ${MAX_WAGE_PERSON_LINES} 条`);
  const keys = new Set<string>();
  let total = 0n;
  const employmentCompanyId = required(input.employmentCompanyId, "我方公司不能为空");
  const context = {
    employmentCompanyId,
    periodStart,
    periodEnd,
    wageMonth
  };
  const approvedPersonLines = lines.map((line) => {
    const normalized = sourcePurpose === "full_reversal"
      ? normalizeFullReversalPersonLine(line, context)
      : normalizeAuthorityPersonLine(line, context);
    const employeeId = normalized.employeeId;
    const employmentSnapshotId = normalized.employmentSnapshotId;
    const key = `${employeeId}:${employmentSnapshotId}`;
    if (keys.has(key)) throw new BadRequestException("同一人员劳动关系快照不能重复");
    keys.add(key);
    const approvedAmountCents = BigInt(normalized.approvedAmountCents);
    total += approvedAmountCents;
    return normalized;
  });
  if (sourcePurpose === "ordinary" && total === 0n) {
    throw new BadRequestException("普通外部批准工资来源总额必须大于零");
  }
  if (sourcePurpose === "full_reversal" && total !== 0n) {
    throw new BadRequestException("全额冲销批准来源总额必须恰为零");
  }
  const fullReversalTarget = sourcePurpose === "full_reversal"
    ? normalizeFullReversalTarget(input.fullReversalTarget)
    : undefined;
  if (sourcePurpose === "ordinary" && input.fullReversalTarget !== undefined) {
    throw new BadRequestException("普通工资来源不得绑定全额冲销目标");
  }
  if (sourcePurpose === "full_reversal") {
    assertBalancedWageStatementDraft({ wageMonth, sourceTotalCents: "0", personLines: approvedPersonLines as WagePersonLineInput[] });
  }
  return {
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    sourcePurpose,
    fullReversalTarget,
    employmentCompanyId,
    wageMonth,
    periodStart,
    periodEnd,
    externalReference: required(input.externalReference, "外部批准资料编号不能为空"),
    sourceVersion: required(input.sourceVersion, "外部批准资料版本不能为空"),
    basisDate: validDateOnly(input.basisDate, "批准依据日期不正确"),
    evidenceFileId: required(input.evidenceFileId, "外部批准资料附件不能为空"),
    approvedPersonLines
  };
}

type AuthorityLine = ApprovedWagePersonDto;

function authorityFactsOnly(line: ApprovedWagePersonDto | WagePersonLineInput): AuthorityLine {
  return {
    employeeId: line.employeeId,
    employmentSnapshotId: line.employmentSnapshotId,
    employmentCompanyId: line.employmentCompanyId,
    employmentPeriodStart: line.employmentPeriodStart,
    employmentPeriodEnd: line.employmentPeriodEnd,
    positionCategory: line.positionCategory,
    approvedAmountCents: line.approvedAmountCents,
    costComponents: line.costComponents,
    creditorBreakdowns: line.creditorBreakdowns
  };
}

function normalizeAuthorityPersonLine(
  line: ApprovedWagePersonDto,
  context: { employmentCompanyId: string; periodStart: string; periodEnd: string; wageMonth: string },
  allowProjectFacts = false
): AuthorityLine {
  const record = line as ApprovedWagePersonDto & Record<string, unknown>;
  if (!allowProjectFacts && (
    Object.hasOwn(record, "projectAllocations") ||
    Object.hasOwn(record, "projectCostComponentAllocations") ||
    Object.hasOwn(record, "projectCreditorAllocations")
  )) {
    throw new BadRequestException("外部批准工资来源不得包含项目分摊或财务矩阵");
  }
  const employeeId = required(line.employeeId, "人员不能为空");
  const employmentSnapshotId = required(line.employmentSnapshotId, "劳动关系快照不能为空");
  const employmentCompanyId = required(line.employmentCompanyId, "劳动关系公司不能为空");
  if (employmentCompanyId !== context.employmentCompanyId) {
    throw new BadRequestException("劳动关系公司必须与工资承担公司一致");
  }
  const employmentPeriodStart = validDateOnly(line.employmentPeriodStart, "劳动关系期间开始日不正确");
  const employmentPeriodEnd = validDateOnly(line.employmentPeriodEnd, "劳动关系期间结束日不正确");
  if (employmentPeriodStart !== context.periodStart || employmentPeriodEnd !== context.periodEnd) {
    throw new BadRequestException("劳动关系期间必须与工资月份期间一致");
  }
  const positionCategory = required(line.positionCategory, "岗位类别不能为空");
  const approvedAmountCents = cents(line.approvedAmountCents, "外部批准人员金额必须是非负整数分");
  const costComponents = normalizeCostComponents(line.costComponents);
  const creditorBreakdowns = normalizeCreditorBreakdowns(line.creditorBreakdowns, employeeId);
  if (sumAmounts(costComponents, "成本组成") !== approvedAmountCents) {
    throw new BadRequestException("成本组成合计必须与外部批准人员金额逐分一致");
  }
  if (sumAmounts(creditorBreakdowns, "债权人拆分") !== approvedAmountCents) {
    throw new BadRequestException("债权人拆分合计必须与外部批准人员金额逐分一致");
  }
  const normalized: AuthorityLine = {
    employeeId,
    employmentSnapshotId,
    employmentCompanyId,
    employmentPeriodStart,
    employmentPeriodEnd,
    positionCategory,
    approvedAmountCents: approvedAmountCents.toString(),
    costComponents,
    creditorBreakdowns
  };
  return normalized;
}

function normalizeFullReversalPersonLine(
  line: ApprovedWagePersonDto,
  context: { employmentCompanyId: string; periodStart: string; periodEnd: string; wageMonth: string }
): WagePersonLineInput {
  const authority = normalizeAuthorityPersonLine(line, context, true);
  return {
    ...authority,
    projectAllocations: normalizeProjectAllocations(line.projectAllocations ?? [], context.wageMonth),
    projectCostComponentAllocations: normalizeProjectCostComponentAllocations(line.projectCostComponentAllocations ?? []),
    projectCreditorAllocations: normalizeProjectCreditorAllocations(line.projectCreditorAllocations ?? [])
  };
}

function normalizeFullReversalTarget(value: CreateApprovedWageSourceDto["fullReversalTarget"]) {
  if (!value || typeof value !== "object") {
    throw new BadRequestException("全额冲销批准来源必须绑定目标工资单和紧邻已确认版本");
  }
  if (!Number.isSafeInteger(value.priorConfirmedRevision) || value.priorConfirmedRevision < 1) {
    throw new BadRequestException("全额冲销目标修订号必须是正整数");
  }
  return {
    statementId: required(value.statementId, "全额冲销目标工资单不能为空"),
    priorConfirmedVersionId: required(value.priorConfirmedVersionId, "全额冲销前置已确认版本不能为空"),
    priorConfirmedRevision: value.priorConfirmedRevision,
    priorSourceVersionId: required(value.priorSourceVersionId, "全额冲销前置来源版本不能为空")
  };
}

function normalizeCostComponents(lines: ApprovedWagePersonDto["costComponents"]) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("成本组成不能为空");
  const keys = new Set<string>();
  return lines.map((line) => {
    const componentCode = required(line.componentCode, "工资成本组成类别不正确");
    if (!WAGE_COST_COMPONENT_CODES.includes(componentCode as never)) throw new BadRequestException("工资成本组成类别不正确");
    if (keys.has(componentCode)) throw new BadRequestException("同一人员工资成本组成不能重复");
    keys.add(componentCode);
    return { componentCode, amountCents: cents(line.amountCents, "成本组成金额必须是非负整数分").toString() };
  }).sort((left, right) => left.componentCode.localeCompare(right.componentCode));
}

function normalizeCreditorBreakdowns(lines: ApprovedWagePersonDto["creditorBreakdowns"], employeeId: string) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("债权人拆分不能为空");
  const keys = new Set<string>();
  let employeeNetPayCount = 0;
  const normalized = lines.map((line) => {
    const creditorCategory = required(line.creditorCategory, "工资债权人类别不正确");
    if (!WAGE_CREDITOR_CATEGORIES.includes(creditorCategory as never)) throw new BadRequestException("工资债权人类别不正确");
    const creditorSubjectType = line.creditorSubjectType;
    if (creditorSubjectType !== "employee_user" && creditorSubjectType !== "business_party") {
      throw new BadRequestException("工资债权人必须明确为员工或机构冻结版本");
    }
    const creditorUserId = creditorSubjectType === "employee_user" ? required(line.creditorUserId, "员工债权人不能为空") : undefined;
    const creditorBusinessPartyVersionId = creditorSubjectType === "business_party" ? required(line.creditorBusinessPartyVersionId, "机构债权人版本不能为空") : undefined;
    if ((creditorSubjectType === "employee_user" && line.creditorBusinessPartyVersionId) || (creditorSubjectType === "business_party" && line.creditorUserId)) {
      throw new BadRequestException("工资债权人只能绑定一种权威身份");
    }
    if (creditorCategory === "employee_net_pay") {
      employeeNetPayCount += 1;
      if (creditorSubjectType !== "employee_user" || creditorUserId !== employeeId) throw new BadRequestException("员工净付债权人必须绑定该员工");
    } else if (creditorSubjectType !== "business_party") {
      throw new BadRequestException("受控机构工资债权人必须绑定机构冻结版本");
    }
    const key = `${creditorSubjectType}:${creditorUserId ?? creditorBusinessPartyVersionId}:${creditorCategory}`;
    if (keys.has(key)) throw new BadRequestException("同一人员工资债权人拆分不能重复");
    keys.add(key);
    return { creditorSubjectType, creditorUserId, creditorBusinessPartyVersionId, creditorCategory, amountCents: cents(line.amountCents, "债权人拆分金额必须是非负整数分").toString() };
  }).sort((left, right) => `${left.creditorSubjectType}:${left.creditorUserId ?? left.creditorBusinessPartyVersionId}:${left.creditorCategory}`.localeCompare(`${right.creditorSubjectType}:${right.creditorUserId ?? right.creditorBusinessPartyVersionId}:${right.creditorCategory}`));
  if (employeeNetPayCount !== 1) throw new BadRequestException("每名员工必须且只能有一项员工净付债权人");
  return normalized;
}

function normalizeProjectCostComponentAllocations(lines: WagePersonLineInput["projectCostComponentAllocations"]): WageProjectCostComponentAllocationInput[] {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("项目成本组成矩阵必须明确填写");
  return lines.map((line) => ({
    projectId: required(line.projectId, "项目不能为空"),
    serviceSnapshotId: required(line.serviceSnapshotId, "服务快照不能为空"),
    componentCode: required(line.componentCode, "工资成本组成类别不正确"),
    amountCents: cents(line.amountCents, "项目成本组成矩阵金额必须是非负整数分").toString()
  })).sort((left, right) => `${left.projectId}:${left.serviceSnapshotId}:${left.componentCode}`.localeCompare(`${right.projectId}:${right.serviceSnapshotId}:${right.componentCode}`));
}

function normalizeProjectCreditorAllocations(lines: WagePersonLineInput["projectCreditorAllocations"]): WageProjectCreditorAllocationInput[] {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("项目债权人矩阵必须明确填写");
  return lines.map((line) => {
    const creditorSubjectType = line.creditorSubjectType;
    if (creditorSubjectType !== "employee_user" && creditorSubjectType !== "business_party") throw new BadRequestException("项目债权人矩阵必须明确债权人身份");
    const creditorUserId = creditorSubjectType === "employee_user" ? required(line.creditorUserId, "员工债权人不能为空") : undefined;
    const creditorBusinessPartyVersionId = creditorSubjectType === "business_party" ? required(line.creditorBusinessPartyVersionId, "机构债权人版本不能为空") : undefined;
    if ((creditorSubjectType === "employee_user" && line.creditorBusinessPartyVersionId) || (creditorSubjectType === "business_party" && line.creditorUserId)) throw new BadRequestException("项目债权人矩阵只能绑定一种权威身份");
    return {
      projectId: required(line.projectId, "项目不能为空"),
      serviceSnapshotId: required(line.serviceSnapshotId, "服务快照不能为空"),
      creditorSubjectType,
      creditorUserId,
      creditorBusinessPartyVersionId,
      creditorCategory: required(line.creditorCategory, "工资债权人类别不正确"),
      amountCents: cents(line.amountCents, "项目债权人矩阵金额必须是非负整数分").toString()
    };
  }).sort((left, right) => `${left.projectId}:${left.serviceSnapshotId}:${left.creditorSubjectType}:${left.creditorUserId ?? left.creditorBusinessPartyVersionId}:${left.creditorCategory}`.localeCompare(`${right.projectId}:${right.serviceSnapshotId}:${right.creditorSubjectType}:${right.creditorUserId ?? right.creditorBusinessPartyVersionId}:${right.creditorCategory}`));
}

function normalizeProjectAllocations(lines: WagePersonLineInput["projectAllocations"], wageMonth: string) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("项目分摊不能为空");
  const keys = new Set<string>();
  return lines.map((line) => {
    const projectId = required(line.projectId, "分摊项目不能为空");
    const serviceSnapshotId = required(line.serviceSnapshotId, "服务依据不能为空");
    const serviceMonth = required(line.serviceMonth, "服务依据月份不能为空");
    if (serviceMonth !== wageMonth) throw new BadRequestException("服务依据月份必须与工资月份一致");
    const serviceEvidenceSha256 = required(line.serviceEvidenceSha256, "服务依据校验值不能为空");
    if (!SHA256.test(serviceEvidenceSha256)) throw new BadRequestException("服务依据校验值必须为 SHA-256");
    const key = `${projectId}:${serviceSnapshotId}`;
    if (keys.has(key)) throw new BadRequestException("同一人员项目分摊不能重复");
    keys.add(key);
    return { projectId, serviceSnapshotId, serviceMonth, serviceEvidenceSha256: serviceEvidenceSha256.toLowerCase(), amountCents: cents(line.amountCents, "项目分摊金额必须是非负整数分").toString() };
  }).sort((left, right) => `${left.projectId}:${left.serviceSnapshotId}`.localeCompare(`${right.projectId}:${right.serviceSnapshotId}`));
}

function sumAmounts(lines: Array<{ amountCents: string }>, label: string) {
  return lines.reduce((total, line) => total + cents(line.amountCents, `${label}金额必须是非负整数分`), 0n);
}

function validateDraftInput(input: CreateWageStatementDraftDto) {
  validateCommand(input);
  if (input.expectedRevision !== 0) throw new ConflictException("新建工资承担单的 expectedRevision 必须为 0");
  required(input.sourceVersionId, "外部批准工资来源不能为空");
  validateDraftSize(input.personLines);
  for (const line of input.personLines ?? []) {
    normalizeCostComponents(line.costComponents);
    normalizeCreditorBreakdowns(line.creditorBreakdowns, required(line.employeeId, "人员不能为空"));
    normalizeProjectAllocations(line.projectAllocations, required(input.wageMonth, "工资月份不能为空"));
    normalizeProjectCostComponentAllocations(line.projectCostComponentAllocations);
    normalizeProjectCreditorAllocations(line.projectCreditorAllocations);
  }
}

function validateRevisionInput(input: CreateWageStatementRevisionDto) {
  validateCommand(input);
  if (input.disposition !== "supplemental" && input.disposition !== "correction" && input.disposition !== "reversal") {
    throw new BadRequestException("后续工资修订必须明确为补发、更正或冲销");
  }
  required(input.sourceVersionId, "外部批准工资来源不能为空");
  validateDraftSize(input.personLines);
  for (const line of input.personLines ?? []) {
    normalizeCostComponents(line.costComponents);
    normalizeCreditorBreakdowns(line.creditorBreakdowns, required(line.employeeId, "人员不能为空"));
    normalizeProjectAllocations(line.projectAllocations, required(input.wageMonth, "工资月份不能为空"));
    normalizeProjectCostComponentAllocations(line.projectCostComponentAllocations);
    normalizeProjectCreditorAllocations(line.projectCreditorAllocations);
  }
}

function validateEditableDraftInput(input: UpdateWageStatementDraftDto) {
  validateCommand(input);
  validateDraftSize(input.personLines);
  for (const line of input.personLines ?? []) {
    normalizeCostComponents(line.costComponents);
    normalizeCreditorBreakdowns(line.creditorBreakdowns, required(line.employeeId, "人员不能为空"));
    normalizeProjectAllocations(line.projectAllocations, required(input.wageMonth, "工资月份不能为空"));
    normalizeProjectCostComponentAllocations(line.projectCostComponentAllocations);
    normalizeProjectCreditorAllocations(line.projectCreditorAllocations);
  }
}

function validateDraftSize(lines: WagePersonLineInput[] | undefined) {
  if (!Array.isArray(lines)) return;
  if (lines.length > MAX_WAGE_PERSON_LINES) throw new BadRequestException(`工资承担单人员不能超过 ${MAX_WAGE_PERSON_LINES} 条`);
  for (const line of lines) {
    if (line.costComponents?.length > MAX_WAGE_DETAIL_ROWS_PER_PERSON) throw new BadRequestException("单人工资成本组成不能超过 100 条");
    if (line.creditorBreakdowns?.length > MAX_WAGE_DETAIL_ROWS_PER_PERSON) throw new BadRequestException("单人工资债权人不能超过 100 条");
    if (line.projectAllocations?.length > MAX_WAGE_DETAIL_ROWS_PER_PERSON) throw new BadRequestException("单人工资项目分摊不能超过 100 条");
    if ((line.projectCostComponentAllocations?.length ?? 0) > MAX_WAGE_MATRIX_CELLS_PER_PERSON) throw new BadRequestException("单人工资成本矩阵不能超过 10000 个单元");
    if ((line.projectCreditorAllocations?.length ?? 0) > MAX_WAGE_MATRIX_CELLS_PER_PERSON) throw new BadRequestException("单人工资债权人矩阵不能超过 10000 个单元");
  }
}

function validateCommand(input: WageStatementCommandDto) {
  validateIdempotencyKey(input.idempotencyKey);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new BadRequestException("expectedRevision 必须是非负整数");
  }
}

function workbenchPage(query: WageStatementWorkbenchQueryDto) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException("工资工作台页码必须是正整数");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new BadRequestException("工资工作台每页条数必须是正整数");
  if (pageSize > 50) throw new BadRequestException("工资工作台每页最多读取 50 条");
  return { page, pageSize };
}

function validateIdempotencyKey(value: string) {
  if (!UUID_V4.test(value ?? "")) throw new BadRequestException("幂等键必须是 UUIDv4");
}

function assertRevision(actualRevision: number, expectedRevision: number) {
  if (actualRevision !== expectedRevision) throw new ConflictException("工资承担单版本已变化，请刷新后重试");
}

function approvedSourcePurpose(source: { sourcePurpose?: unknown }): "ordinary" | "full_reversal" {
  // Rows created before the forward migration are backfilled as ordinary. The
  // fallback also keeps isolated legacy fixtures representative of that state.
  if (source.sourcePurpose === undefined) return "ordinary";
  if (source.sourcePurpose === "ordinary" || source.sourcePurpose === "full_reversal") return source.sourcePurpose;
  throw new ConflictException("外部批准工资来源用途无效");
}

function historicalApprovedSourceLines(source: {
  sourcePurpose?: string;
  employmentCompanyId: string;
  wageMonth: string;
  periodStart: Date;
  periodEnd: Date;
  sourceType: string;
  externalReference: string;
  sourceVersion: string;
  basisDate: Date;
  evidenceFileId: string;
  evidenceSha256: string;
  sourceFingerprint: string;
  sourceSnapshot: unknown;
}): WagePersonLineInput[] {
  if (
    approvedSourcePurpose(source) !== "ordinary" ||
    !source.sourceSnapshot ||
    typeof source.sourceSnapshot !== "object" ||
    Array.isArray(source.sourceSnapshot) ||
    !SHA256.test(source.sourceFingerprint) ||
    fingerprint(source.sourceSnapshot) !== source.sourceFingerprint
  ) {
    throw new ConflictException("历史工资接管权威来源快照指纹已漂移，不能继续");
  }
  const snapshot = source.sourceSnapshot as Record<string, unknown>;
  const company = snapshot.employmentCompany;
  const evidence = snapshot.evidence;
  const companyId = company && typeof company === "object" && !Array.isArray(company)
    ? requiredJsonText((company as Record<string, unknown>).id)
    : "";
  const evidenceFileId = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? requiredJsonText((evidence as Record<string, unknown>).fileId)
    : "";
  const evidenceSha256 = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? requiredJsonText((evidence as Record<string, unknown>).sha256)
    : "";
  if (
    source.sourceType !== "external_approved_wage" ||
    (snapshot.sourcePurpose !== undefined && requiredJsonText(snapshot.sourcePurpose) !== "ordinary") ||
    companyId !== source.employmentCompanyId ||
    requiredJsonText(snapshot.wageMonth) !== source.wageMonth ||
    requiredJsonText(snapshot.periodStart) !== source.periodStart.toISOString().slice(0, 10) ||
    requiredJsonText(snapshot.periodEnd) !== source.periodEnd.toISOString().slice(0, 10) ||
    requiredJsonText(snapshot.externalReference) !== source.externalReference ||
    requiredJsonText(snapshot.sourceVersion) !== source.sourceVersion ||
    requiredJsonText(snapshot.basisDate) !== source.basisDate.toISOString().slice(0, 10) ||
    evidenceFileId !== source.evidenceFileId ||
    evidenceSha256 !== source.evidenceSha256 ||
    !SHA256.test(evidenceSha256)
  ) {
    throw new ConflictException("历史工资接管权威来源快照与公司、月份、期间或证据坐标不一致");
  }
  return historicalSourcePersonLines(snapshot);
}

function approvedSourceFacts(source: {
  sourcePurpose?: string;
  employmentCompanyId: string;
  wageMonth: string;
  periodStart: Date;
  periodEnd: Date;
  sourceType: string;
  externalReference: string;
  sourceVersion: string;
  basisDate: Date;
  evidenceFileId: string;
  evidenceSha256: string;
  sourceFingerprint: string;
  sourceSnapshot: unknown;
}) {
  if (!source.sourceSnapshot || typeof source.sourceSnapshot !== "object" || Array.isArray(source.sourceSnapshot)) {
    throw new ConflictException("外部批准工资来源快照不完整，不能确认");
  }
  if (!SHA256.test(source.sourceFingerprint) || fingerprint(source.sourceSnapshot) !== source.sourceFingerprint) {
    throw new ConflictException("外部批准工资来源快照指纹已漂移，不能确认");
  }
  const snapshot = source.sourceSnapshot as Record<string, unknown>;
  const company = snapshot.employmentCompany as Record<string, unknown> | undefined;
  const evidence = snapshot.evidence as Record<string, unknown> | undefined;
  const purpose = approvedSourcePurpose(source);
  if (
    (snapshot.sourcePurpose !== undefined
      ? requiredJsonText(snapshot.sourcePurpose) !== purpose
      : purpose !== "ordinary") ||
    source.sourceType !== "external_approved_wage" ||
    requiredJsonText(company?.id) !== source.employmentCompanyId ||
    requiredJsonText(snapshot.wageMonth) !== source.wageMonth ||
    requiredJsonText(snapshot.periodStart) !== source.periodStart.toISOString().slice(0, 10) ||
    requiredJsonText(snapshot.periodEnd) !== source.periodEnd.toISOString().slice(0, 10) ||
    requiredJsonText(snapshot.externalReference) !== source.externalReference ||
    requiredJsonText(snapshot.sourceVersion) !== source.sourceVersion ||
    requiredJsonText(snapshot.basisDate) !== source.basisDate.toISOString().slice(0, 10) ||
    requiredJsonText(evidence?.fileId) !== source.evidenceFileId ||
    requiredJsonText(evidence?.sha256) !== source.evidenceSha256
  ) {
    throw new ConflictException("外部批准工资来源列值与冻结快照不一致，不能确认");
  }
  return purpose === "full_reversal"
    ? fullReversalSourcePersonLines(snapshot)
    : sourcePersonLines(snapshot);
}

function storedDraftLines(
  version: WageConfirmationVersion,
  sourceLines: AuthorityLine[],
  bindings: ServiceBasisBinding[]
): WagePersonLineInput[] {
  const sourceByPerson = new Map(sourceLines.map((line) => [`${line.employeeId}:${line.employmentSnapshotId}`, line]));
  const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
  return version.personLines.map((person) => {
    const authority = sourceByPerson.get(`${person.employeeId}:${person.employmentSnapshotId}`);
    if (!authority) throw new ConflictException("工资版本人员事实不属于当前批准来源");
    const componentById = new Map(person.costComponents.map((component) => [component.id, component]));
    const creditorById = new Map(person.creditorBreakdowns.map((creditor) => [creditor.id, creditor]));
    const projectAllocations = person.projectAllocations.map((allocation) => {
      const binding = bindingById.get(allocation.serviceBasisBindingId);
      if (!binding || binding.projectId !== allocation.projectId || binding.serviceSnapshotId !== allocation.serviceSnapshotId) {
        throw new ConflictException("工资项目分摊的服务依据绑定已漂移");
      }
      return {
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        serviceMonth: binding.serviceMonth,
        serviceEvidenceSha256: binding.evidenceSha256,
        amountCents: allocation.amountCents.toString()
      };
    });
    const costComponents = person.costComponents.map((component) => ({ componentCode: component.componentCode, amountCents: component.amountCents.toString() }));
    const creditorBreakdowns = person.creditorBreakdowns.map((creditor) => ({
      creditorSubjectId: creditor.creditorSubjectId ?? undefined,
      creditorSubjectType: creditor.creditorSubjectType as "employee_user" | "business_party" | undefined,
      creditorUserId: creditor.creditorUserId ?? undefined,
      creditorBusinessPartyVersionId: creditor.creditorBusinessPartyVersionId ?? undefined,
      creditorCategory: creditor.creditorCategory,
      amountCents: creditor.amountCents.toString()
    }));
    const projectCostComponentAllocations = person.projectAllocations.flatMap((allocation) => allocation.componentAllocations.map((cell) => {
      const component = componentById.get(cell.costComponentId);
      if (!component) throw new ConflictException("工资成本矩阵引用不属于当前人员");
      return {
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        componentCode: component.componentCode,
        amountCents: cell.amountCents.toString()
      };
    }));
    const projectCreditorAllocations: WageProjectCreditorAllocationInput[] = person.projectAllocations.flatMap((allocation) => allocation.creditorAllocations.map((cell) => {
      const creditor = creditorById.get(cell.creditorBreakdownId);
      if (!creditor || (creditor.creditorSubjectType !== "employee_user" && creditor.creditorSubjectType !== "business_party")) {
        throw new ConflictException("工资债权人矩阵引用不属于当前人员或缺少权威身份");
      }
      return {
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        creditorSubjectType: creditor.creditorSubjectType as "employee_user" | "business_party",
        creditorUserId: creditor.creditorUserId ?? undefined,
        creditorBusinessPartyVersionId: creditor.creditorBusinessPartyVersionId ?? undefined,
        creditorCategory: creditor.creditorCategory,
        amountCents: cell.amountCents.toString()
      };
    }));
    return {
      ...authority,
      costComponents,
      creditorBreakdowns,
      projectAllocations,
      projectCostComponentAllocations,
      projectCreditorAllocations
    };
  });
}

function sourcePersonLines(snapshot: unknown): AuthorityLine[] {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as { approvedPersonLines?: unknown }).approvedPersonLines)) {
    throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  }
  return (snapshot as { approvedPersonLines: unknown[] }).approvedPersonLines.map((line) => {
    if (!line || typeof line !== "object") throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
    const value = line as Record<string, unknown>;
    try {
      return normalizeAuthorityPersonLine({
        employeeId: requiredJsonText(value.employeeId),
        employmentSnapshotId: requiredJsonText(value.employmentSnapshotId),
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        employmentPeriodStart: requiredJsonText(value.employmentPeriodStart),
        employmentPeriodEnd: requiredJsonText(value.employmentPeriodEnd),
        positionCategory: requiredJsonText(value.positionCategory),
        approvedAmountCents: requiredJsonText(value.approvedAmountCents),
        costComponents: jsonArray(value.costComponents),
        creditorBreakdowns: jsonArray(value.creditorBreakdowns)
      }, {
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        periodStart: requiredJsonText(value.employmentPeriodStart),
        periodEnd: requiredJsonText(value.employmentPeriodEnd),
        wageMonth: requiredJsonText(value.employmentPeriodStart).slice(0, 7)
      });
    } catch {
      throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
    }
  });
}

function fullReversalSourcePersonLines(snapshot: unknown): WagePersonLineInput[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new ConflictException("全额冲销批准来源快照不完整");
  }
  const record = snapshot as Record<string, unknown>;
  if (record.sourcePurpose !== "full_reversal" || !Array.isArray(record.approvedPersonLines)) {
    throw new ConflictException("全额冲销批准来源用途或人员矩阵不完整");
  }
  return record.approvedPersonLines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new ConflictException("全额冲销批准来源人员矩阵不完整");
    }
    const value = line as Record<string, unknown>;
    try {
      return normalizeFullReversalPersonLine({
        employeeId: requiredJsonText(value.employeeId),
        employmentSnapshotId: requiredJsonText(value.employmentSnapshotId),
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        employmentPeriodStart: requiredJsonText(value.employmentPeriodStart),
        employmentPeriodEnd: requiredJsonText(value.employmentPeriodEnd),
        positionCategory: requiredJsonText(value.positionCategory),
        approvedAmountCents: requiredJsonText(value.approvedAmountCents),
        costComponents: jsonArray(value.costComponents),
        creditorBreakdowns: jsonArray(value.creditorBreakdowns),
        projectAllocations: jsonArray(value.projectAllocations),
        projectCostComponentAllocations: jsonArray(value.projectCostComponentAllocations),
        projectCreditorAllocations: jsonArray(value.projectCreditorAllocations)
      }, {
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        periodStart: requiredJsonText(value.employmentPeriodStart),
        periodEnd: requiredJsonText(value.employmentPeriodEnd),
        wageMonth: requiredJsonText(record.wageMonth)
      });
    } catch {
      throw new ConflictException("全额冲销批准来源人员矩阵不完整");
    }
  });
}

function historicalSourcePersonLines(snapshot: Record<string, unknown>): WagePersonLineInput[] {
  if (!Array.isArray(snapshot.approvedPersonLines)) {
    throw new ConflictException("历史工资接管权威来源缺少完整项目闭合，不能继续");
  }
  return snapshot.approvedPersonLines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new ConflictException("历史工资接管权威来源缺少完整项目闭合，不能继续");
    }
    const value = line as Record<string, unknown>;
    try {
      const context = {
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        periodStart: requiredJsonText(value.employmentPeriodStart),
        periodEnd: requiredJsonText(value.employmentPeriodEnd),
        wageMonth: requiredJsonText(snapshot.wageMonth)
      };
      const authority = normalizeAuthorityPersonLine({
        employeeId: requiredJsonText(value.employeeId),
        employmentSnapshotId: requiredJsonText(value.employmentSnapshotId),
        employmentCompanyId: context.employmentCompanyId,
        employmentPeriodStart: context.periodStart,
        employmentPeriodEnd: context.periodEnd,
        positionCategory: requiredJsonText(value.positionCategory),
        approvedAmountCents: requiredJsonText(value.approvedAmountCents),
        costComponents: jsonArray(value.costComponents),
        creditorBreakdowns: jsonArray(value.creditorBreakdowns)
      }, context);
      const complete: WagePersonLineInput = {
        ...authority,
        projectAllocations: normalizeProjectAllocations(jsonArray(value.projectAllocations), context.wageMonth),
        projectCostComponentAllocations: normalizeProjectCostComponentAllocations(jsonArray(value.projectCostComponentAllocations)),
        projectCreditorAllocations: normalizeProjectCreditorAllocations(jsonArray(value.projectCreditorAllocations))
      };
      assertBalancedWageStatementDraft({ wageMonth: context.wageMonth, sourceTotalCents: complete.approvedAmountCents, personLines: [complete] });
      return complete;
    } catch {
      throw new ConflictException("历史工资接管权威来源缺少完整项目闭合，不能继续");
    }
  });
}

function assertSourceFacts(
  lines: WagePersonLineInput[],
  sourceLines: AuthorityLine[],
  employmentCompanyId: string,
  wageMonth: string,
  periodStart: Date,
  periodEnd: Date
) {
  const expectedStart = periodStart.toISOString().slice(0, 10);
  const expectedEnd = periodEnd.toISOString().slice(0, 10);
  const [year, month] = wageMonth.split("-").map(Number);
  const naturalMonthEnd = `${wageMonth}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/u.test(wageMonth) || expectedStart !== `${wageMonth}-01` || expectedEnd !== naturalMonthEnd) {
    throw new ConflictException("外部批准工资来源公司、月份或期间不一致，不能创建工资承担单");
  }
  const expected = new Map(sourceLines.map((line) => {
    if (line.employmentCompanyId !== employmentCompanyId || line.employmentPeriodStart !== expectedStart || line.employmentPeriodEnd !== expectedEnd) {
      throw new ConflictException("外部批准工资来源公司、月份或期间不一致，不能创建工资承担单");
    }
    return [`${line.employeeId}:${line.employmentSnapshotId}`, stableJson(authorityFactsOnly(line))];
  }));
  if (expected.size !== lines.length) throw new BadRequestException("工资承担单人员事实必须与外部批准来源一致");
  for (const line of lines) {
    const key = `${line.employeeId}:${line.employmentSnapshotId}`;
    const actual = normalizeAuthorityPersonLine({
      employeeId: line.employeeId,
      employmentSnapshotId: line.employmentSnapshotId,
      employmentCompanyId: line.employmentCompanyId,
      employmentPeriodStart: line.employmentPeriodStart,
      employmentPeriodEnd: line.employmentPeriodEnd,
      positionCategory: line.positionCategory,
      approvedAmountCents: line.approvedAmountCents,
      costComponents: line.costComponents,
      creditorBreakdowns: line.creditorBreakdowns
    }, { employmentCompanyId, periodStart: expectedStart, periodEnd: expectedEnd, wageMonth });
    if (expected.get(key) !== stableJson(actual)) {
      throw new BadRequestException("工资承担单人员事实必须与外部批准来源一致");
    }
  }
}

function jsonArray(value: unknown) {
  if (!Array.isArray(value)) throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  return value as never[];
}

function employeeMap(
  lines: Array<Pick<ApprovedWagePersonDto, "employeeId">>,
  employees: Array<{ id: string; name: string; departmentId: string | null }>
) {
  const ids = new Set(lines.map((line) => line.employeeId));
  const byId = new Map(employees.map((employee) => [employee.id, { id: employee.id, name: employee.name, departmentId: employee.departmentId }]));
  if (byId.size !== ids.size || [...ids].some((id) => !byId.has(id))) {
    throw new BadRequestException("工资人员不存在或已停用");
  }
  return byId;
}

function projectMap(
  lines: Array<Pick<WagePersonLineInput, "projectAllocations">>,
  projects: Array<{ id: string; code: string; name: string }>
) {
  const ids = new Set(lines.flatMap((line) => line.projectAllocations.map((allocation) => allocation.projectId)));
  const byId = new Map(projects.map((project) => [project.id, project]));
  if (byId.size !== ids.size || [...ids].some((id) => !byId.has(id))) {
    throw new BadRequestException("分摊项目不存在或已停用");
  }
  return byId;
}

type ServiceBasisBinding = {
  id: string;
  projectId: string;
  serviceSnapshotId: string;
  serviceMonth: string;
  evidenceSha256: string;
  authorityFingerprint: string;
};

function serviceBasisKey(allocation: Pick<WagePersonLineInput["projectAllocations"][number], "projectId" | "serviceSnapshotId">) {
  return `${allocation.projectId}:${allocation.serviceSnapshotId}`;
}

function serviceBasisDefinitions(lines: WagePersonLineInput[], evidenceSha256: string) {
  const definitions = new Map<string, { projectId: string; serviceSnapshotId: string; serviceMonth: string; evidenceSha256: string }>();
  for (const line of lines) {
    for (const allocation of line.projectAllocations) {
      const key = serviceBasisKey(allocation);
      const definition = {
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        serviceMonth: allocation.serviceMonth,
        evidenceSha256: allocation.serviceEvidenceSha256
      };
      const existing = definitions.get(key);
      if (existing && stableJson(existing) !== stableJson(definition)) {
        throw new BadRequestException("同一服务依据不能在外部批准工资来源中漂移");
      }
      if (definition.evidenceSha256 !== evidenceSha256.toLowerCase()) {
        throw new BadRequestException("服务依据必须由同一外部批准工资资料校验值证明");
      }
      definitions.set(key, definition);
    }
  }
  return [...definitions.values()].sort((left, right) => serviceBasisKey(left).localeCompare(serviceBasisKey(right)));
}

function assertSourceEvidenceActive(
  source: { evidenceFileId: string; evidenceSha256: string },
  evidence: { id: string; storageStatus: string; contentSha256: string | null } | null
) {
  if (
    !evidence ||
    evidence.id !== source.evidenceFileId ||
    evidence.storageStatus !== "active" ||
    typeof evidence.contentSha256 !== "string" ||
    evidence.contentSha256.toLowerCase() !== source.evidenceSha256.toLowerCase()
  ) {
    throw new ConflictException("外部批准工资资料证据已失效或校验值漂移，不能创建工资承担单");
  }
}

function serviceBasisBindingMap(
  sourceVersionId: string,
  lines: WagePersonLineInput[],
  bindings: ServiceBasisBinding[],
  evidenceSha256: string,
  requireExactSet = true
) {
  const expected = serviceBasisDefinitions(lines, evidenceSha256);
  const byKey = new Map(bindings.map((binding) => [serviceBasisKey(binding), binding]));
  if (requireExactSet && byKey.size !== expected.length) {
    throw new ConflictException("外部批准工资来源的服务依据绑定不完整，不能创建工资承担单");
  }
  for (const definition of expected) {
    const binding = byKey.get(serviceBasisKey(definition));
    if (
      !binding ||
      binding.serviceMonth !== definition.serviceMonth ||
      binding.evidenceSha256.toLowerCase() !== definition.evidenceSha256 ||
      !SHA256.test(binding.authorityFingerprint) ||
      binding.authorityFingerprint !== serviceBasisFingerprint(sourceVersionId, binding)
    ) {
      throw new ConflictException("外部批准工资来源的服务依据绑定已失效或漂移，不能创建工资承担单");
    }
  }
  return byKey;
}

function serviceBasisFingerprint(
  sourceVersionId: string,
  binding: Pick<ServiceBasisBinding, "projectId" | "serviceSnapshotId" | "serviceMonth" | "evidenceSha256">
) {
  return fingerprint({
    sourceVersionId,
    projectId: binding.projectId,
    serviceSnapshotId: binding.serviceSnapshotId,
    serviceMonth: binding.serviceMonth,
    evidenceSha256: binding.evidenceSha256
  });
}

function creditorIdentityKeyWithCategory(
  creditor: Pick<WageProjectCreditorAllocationInput | WagePersonLineInput["creditorBreakdowns"][number], "creditorSubjectType" | "creditorUserId" | "creditorBusinessPartyVersionId" | "creditorCategory">
) {
  const subjectId = creditor.creditorSubjectType === "employee_user"
    ? creditor.creditorUserId
    : creditor.creditorBusinessPartyVersionId;
  return `${creditor.creditorSubjectType}:${subjectId}:${creditor.creditorCategory}`;
}

function wageMatrixIdentities(version: WageConfirmationVersion) {
  const costs = new Map<string, WageCostCellIdentity>();
  const payables = new Map<string, WagePayableCellIdentity>();
  for (const person of version.personLines) {
    const creditors = new Map(person.creditorBreakdowns.map((creditor) => [creditor.id, creditor]));
    for (const allocation of person.projectAllocations) {
      for (const cell of allocation.componentAllocations) {
        const key = `${allocation.projectId}:${allocation.serviceSnapshotId}:${person.employeeId}:${person.employmentSnapshotId}:${cell.costComponent.componentCode}`;
        if (costs.has(key)) throw new ConflictException("工资版本存在重复的项目成本组成身份，不能确认");
        costs.set(key, { person, allocation, cell, amountCents: cell.amountCents });
      }
      for (const cell of allocation.creditorAllocations) {
        const creditor = creditors.get(cell.creditorBreakdownId);
        if (!creditor) throw new ConflictException("工资债权人矩阵引用不属于该人员行");
        const key = wagePayableIdentity(
          allocation.projectId,
          allocation.serviceSnapshotId,
          person.employeeId,
          person.employmentSnapshotId,
          creditor
        );
        if (payables.has(key)) throw new ConflictException("工资版本存在重复的项目债权人身份，不能确认");
        payables.set(key, { person, allocation, cell, creditor, amountCents: cell.amountCents });
      }
    }
  }
  return { costs, payables };
}

function authorityMatrixIdentities(lines: WagePersonLineInput[]): HistoricalWageSemanticMatrix {
  const projectIds = uniqueSorted(lines.flatMap((line) => line.projectAllocations.map((allocation) => allocation.projectId)));
  const costs = new Map<string, HistoricalWageSemanticCell>();
  const payables = new Map<string, HistoricalWageSemanticCell>();
  for (const line of lines) {
    for (const cell of line.projectCostComponentAllocations ?? []) {
      const key = `${cell.projectId}:${cell.serviceSnapshotId}:${line.employeeId}:${line.employmentSnapshotId}:${cell.componentCode}`;
      if (costs.has(key)) {
        throw new ConflictException("外部批准工资来源存在重复的项目成本组成身份，不能规划 A 级闭合");
      }
      costs.set(key, { key, projectId: cell.projectId, amountCents: BigInt(cell.amountCents) });
    }
    for (const cell of line.projectCreditorAllocations ?? []) {
      const creditorSubjectIdentityKey = cell.creditorSubjectType === "employee_user"
        ? `employee_user:${required(cell.creditorUserId, "员工债权人不能为空")}`
        : `business_party:${required(cell.creditorBusinessPartyVersionId, "机构债权人版本不能为空")}`;
      const key = `${cell.projectId}:${cell.serviceSnapshotId}:${line.employeeId}:${line.employmentSnapshotId}:${cell.creditorSubjectType}:${creditorSubjectIdentityKey}:${cell.creditorCategory}`;
      if (payables.has(key)) {
        throw new ConflictException("外部批准工资来源存在重复的项目债权人身份，不能规划 A 级闭合");
      }
      payables.set(key, { key, projectId: cell.projectId, amountCents: BigInt(cell.amountCents) });
    }
  }
  return { projectIds, costs, payables };
}

function emptyHistoricalWageSemanticMatrix(): HistoricalWageSemanticMatrix {
  return { projectIds: [], costs: new Map(), payables: new Map() };
}

function semanticMatrixFromConfirmedVersion(version: WageConfirmationVersion): HistoricalWageSemanticMatrix {
  const matrix = wageMatrixIdentities(version);
  return {
    projectIds: uniqueSorted(version.personLines.flatMap((person) =>
      person.projectAllocations.map((allocation) => allocation.projectId)
    )),
    costs: new Map([...matrix.costs].map(([key, cell]) => [key, {
      key,
      projectId: cell.allocation.projectId,
      amountCents: cell.amountCents
    }])),
    payables: new Map([...matrix.payables].map(([key, cell]) => [key, {
      key,
      projectId: cell.allocation.projectId,
      amountCents: cell.amountCents
    }]))
  };
}

type HistoricalWageSignedDelta = HistoricalWageSemanticCell;

function historicalWageSignedDeltas(
  current: HistoricalWageSemanticMatrix,
  previous: HistoricalWageSemanticMatrix
) {
  const derive = (
    currentCells: ReadonlyMap<string, HistoricalWageSemanticCell>,
    previousCells: ReadonlyMap<string, HistoricalWageSemanticCell>
  ) => uniqueSorted([...currentCells.keys(), ...previousCells.keys()]).flatMap((key) => {
    const currentCell = currentCells.get(key);
    const priorCell = previousCells.get(key);
    const amountCents = (currentCell?.amountCents ?? 0n) - (priorCell?.amountCents ?? 0n);
    if (amountCents === 0n) return [];
    return [{
      key,
      projectId: currentCell?.projectId ?? required(priorCell?.projectId, "工资相邻版本差额缺少项目身份"),
      amountCents
    }];
  });
  return {
    costs: derive(current.costs, previous.costs),
    payables: derive(current.payables, previous.payables)
  };
}

function historicalWageProjectDelta(deltas: readonly HistoricalWageSignedDelta[], projectId: string) {
  return deltas
    .filter((delta) => delta.projectId === projectId)
    .reduce((total, delta) => total + delta.amountCents, 0n);
}

function historicalWageDeltaReadSet(
  deltas: { costs: HistoricalWageSignedDelta[]; payables: HistoricalWageSignedDelta[] },
  projectIds: readonly string[],
  current: HistoricalWageSemanticMatrix
) {
  const costDeltas = new Map(deltas.costs.map((delta) => [delta.key, delta]));
  const payableDeltas = new Map(deltas.payables.map((delta) => [delta.key, delta]));
  const rows = [
    ...[...current.costs.values()].map((cell) => ({
      dimension: "cost",
      key: cell.key,
      projectId: cell.projectId,
      signedAmountCents: (costDeltas.get(cell.key)?.amountCents ?? 0n).toString()
    })),
    ...[...current.payables.values()].map((cell) => ({
      dimension: "payable",
      key: cell.key,
      projectId: cell.projectId,
      signedAmountCents: (payableDeltas.get(cell.key)?.amountCents ?? 0n).toString()
    }))
  ];
  return [
    ...rows,
    ...projectIds
      .filter((projectId) =>
        !rows.some((row) => row.projectId === projectId)
      )
      .map((projectId) => ({
        dimension: "project_tombstone",
        key: projectId,
        projectId,
        signedAmountCents: "0"
      }))
  ].sort((left, right) =>
    `${left.projectId}:${left.dimension}:${left.key}`.localeCompare(`${right.projectId}:${right.dimension}:${right.key}`)
  );
}

function historicalWageSourceDeltaFingerprint(input: {
  targetWageStatementId: string;
  priorConfirmedVersionId: string | null;
  priorSourceVersionId: string | null;
  sourceVersionId: string;
  projectIds: readonly string[];
  deltas: { costs: HistoricalWageSignedDelta[]; payables: HistoricalWageSignedDelta[] };
  current: HistoricalWageSemanticMatrix;
}) {
  const projectIds = uniqueSorted(input.projectIds);
  return fingerprint({
    targetWageStatementId: input.targetWageStatementId,
    priorConfirmedVersionId: input.priorConfirmedVersionId,
    priorSourceVersionId: input.priorSourceVersionId,
    sourceVersionId: input.sourceVersionId,
    projects: projectIds,
    deltas: historicalWageDeltaReadSet(input.deltas, projectIds, input.current)
  });
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = uniqueSorted(left);
  const normalizedRight = uniqueSorted(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function historicalWageRootEffectiveAmount(root: HistoricalWageRootRead) {
  return root.adjustments.reduce((total, adjustment) => {
    if (adjustment.direction === "increase") return total + adjustment.amountCents;
    if (adjustment.direction === "decrease") return total - adjustment.amountCents;
    throw new ConflictException("工资应付引用存在无效调整方向，不能规划 A 级闭合");
  }, root.amountCents);
}

function historicalWageRootReadSet(root: HistoricalWageRootRead & { effectiveAmountCents: bigint }) {
  return {
    id: root.id,
    identity: wageRootIdentity(root),
    debtorCompanyId: root.debtorCompanyId,
    costBearingCompanyId: root.costBearingCompanyId,
    serviceSnapshotId: root.projectAllocation.serviceSnapshotId,
    amountCents: root.amountCents.toString(),
    effectiveAmountCents: root.effectiveAmountCents.toString(),
    adjustments: [...root.adjustments]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((adjustment) => ({
        id: adjustment.id,
        direction: adjustment.direction,
        amountCents: adjustment.amountCents.toString()
      }))
  };
}

function assertRetainedWageIdentities<T extends { amountCents: bigint }>(
  current: ReadonlyMap<string, T>, previous: ReadonlyMap<string, T>, label: string
) {
  for (const [key, prior] of previous) {
    if (prior.amountCents > 0n && !current.has(key)) {
      throw new ConflictException(`后续工资修订必须显式保留既有${label}身份的零金额交叉单元，不能省略冲销对象`);
    }
  }
}

function assertExactHistoricalWageIdentities<T>(
  current: ReadonlyMap<string, T>, previous: ReadonlyMap<string, T>, label: string
) {
  const currentKeys = uniqueSorted([...current.keys()]);
  const previousKeys = uniqueSorted([...previous.keys()]);
  if (
    currentKeys.length !== previousKeys.length ||
    currentKeys.some((key, index) => key !== previousKeys[index])
  ) {
    throw new ConflictException(`历史工资后续版本的${label}身份集合发生变化，必须保留原完整稳定身份且不得新增身份`);
  }
}

function wagePayableIdentity(
  projectId: string, serviceSnapshotId: string, employeeId: string, employmentSnapshotId: string,
  creditor: Pick<WageConfirmationCreditor, "creditorSubjectType" | "creditorSubjectIdentityKey" | "creditorCategory">
) {
  if (!creditor.creditorSubjectType || !creditor.creditorSubjectIdentityKey) {
    throw new ConflictException("工资债权人缺少冻结身份，不能确认");
  }
  return `${projectId}:${serviceSnapshotId}:${employeeId}:${employmentSnapshotId}:${creditor.creditorSubjectType}:${creditor.creditorSubjectIdentityKey}:${creditor.creditorCategory}`;
}

function wageRootIdentity(root: {
  projectId: string;
  projectAllocation: { serviceSnapshotId: string };
  personLine: { employeeId: string; employmentSnapshotId: string };
  creditorBreakdown: { creditorSubjectType: string | null; creditorSubjectIdentityKey: string | null; creditorCategory: string };
}) {
  if (!root.creditorBreakdown.creditorSubjectType || !root.creditorBreakdown.creditorSubjectIdentityKey) return "";
  return `${root.projectId}:${root.projectAllocation.serviceSnapshotId}:${root.personLine.employeeId}:${root.personLine.employmentSnapshotId}:${root.creditorBreakdown.creditorSubjectType}:${root.creditorBreakdown.creditorSubjectIdentityKey}:${root.creditorBreakdown.creditorCategory}`;
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}

function validDateOnly(value: string, message: string) {
  const text = required(value, message);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new BadRequestException(message);
  return text;
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function cents(value: string, message: string) {
  if (!/^\d+$/u.test(value ?? "")) throw new BadRequestException(message);
  return BigInt(value);
}

function businessPartySnapshotName(snapshot: Prisma.JsonValue | undefined): string | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const name = (snapshot as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function businessPartySnapshotIdentity(snapshot: Prisma.JsonValue | undefined): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>).unifiedSocialCreditCode;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function creditorIdentityKey(creditor: { creditorSubjectType?: string; creditorUserId?: string; creditorBusinessPartyVersionId?: string }) {
  if (creditor.creditorSubjectType === "employee_user") return `employee_user:${required(creditor.creditorUserId, "员工债权人不能为空")}`;
  if (creditor.creditorSubjectType === "business_party") return `business_party:${required(creditor.creditorBusinessPartyVersionId, "机构债权人版本不能为空")}`;
  return null;
}

function frozenCreditorName(
  creditor: { creditorSubjectType?: string; creditorUserId?: string; creditorBusinessPartyVersionId?: string },
  employees: Array<{ id: string; name: string }>,
  businessPartyByVersionId: ReadonlyMap<string, { id: string; businessPartyId: string; versionNo: number; snapshot: Prisma.JsonValue }>
) {
  if (creditor.creditorSubjectType === "employee_user") {
    return required(employees.find((employee) => employee.id === creditor.creditorUserId)?.name, "新工资债权人必须冻结名称");
  }
  if (creditor.creditorSubjectType === "business_party") {
    return required(businessPartySnapshotName(businessPartyByVersionId.get(required(creditor.creditorBusinessPartyVersionId, "机构债权人版本不能为空"))?.snapshot), "新工资债权人必须冻结名称");
  }
  return null;
}

function frozenCreditorUnifiedIdentity(
  creditor: { creditorSubjectType?: string; creditorBusinessPartyVersionId?: string },
  businessPartyByVersionId: ReadonlyMap<string, { id: string; businessPartyId: string; versionNo: number; snapshot: Prisma.JsonValue }>
) {
  if (creditor.creditorSubjectType !== "business_party") return null;
  return businessPartySnapshotIdentity(businessPartyByVersionId.get(required(creditor.creditorBusinessPartyVersionId, "机构债权人版本不能为空"))?.snapshot);
}

function frozenCreditorFingerprint(
  creditor: { creditorSubjectType?: string; creditorUserId?: string; creditorBusinessPartyVersionId?: string },
  employees: Array<{ id: string; name: string }>,
  businessPartyByVersionId: ReadonlyMap<string, { id: string; businessPartyId: string; versionNo: number; snapshot: Prisma.JsonValue }>
) {
  if (creditor.creditorSubjectType === "employee_user") {
    // User has no master-data version model. Freeze the stable user id and the
    // display name observed in this transaction; later profile edits cannot
    // alter this persisted basis or a confirmed wage creditor snapshot.
    return fingerprint({
      subjectType: "employee_user",
      userId: required(creditor.creditorUserId, "员工债权人不能为空"),
      nameSnapshot: required(employees.find((employee) => employee.id === creditor.creditorUserId)?.name, "新工资债权人必须冻结名称")
    });
  }
  if (creditor.creditorSubjectType === "business_party") {
    const version = businessPartyByVersionId.get(required(creditor.creditorBusinessPartyVersionId, "机构债权人版本不能为空"));
    if (!version) throw new BadRequestException("机构债权人冻结版本不存在，请刷新后重试");
    return fingerprint({
      subjectType: "business_party",
      businessPartyVersionId: version.id,
      businessPartyId: version.businessPartyId,
      versionNo: version.versionNo,
      snapshot: version.snapshot
    });
  }
  return null;
}

function preflightFrozenCreditorSnapshots(
  lines: AuthorityLine[],
  employees: Array<{ id: string; name: string }>,
  businessPartyByVersionId: ReadonlyMap<string, {
    id: string;
    businessPartyId: string;
    versionNo: number;
    snapshot: Prisma.JsonValue;
  }>
) {
  for (const line of lines) {
    for (const creditor of line.creditorBreakdowns) {
      creditorIdentityKey(creditor);
      frozenCreditorName(creditor, employees, businessPartyByVersionId);
      frozenCreditorUnifiedIdentity(creditor, businessPartyByVersionId);
      frozenCreditorFingerprint(creditor, employees, businessPartyByVersionId);
    }
  }
}

function required(value: string | undefined | null, message: string) {
  if (!value?.trim()) throw new BadRequestException(message);
  return value.trim();
}

function requiredJsonText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  return value;
}

function positionCategoryKey(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "unknown";
  const category = (snapshot as { category?: unknown }).category;
  return typeof category === "string" && category.trim() ? category : "unknown";
}

function workbenchStatus(status: string): "draft" | "submitted" | "returned" | "confirmed" {
  if (status === "draft" || status === "submitted" || status === "confirmed") return status;
  return "returned";
}

function workbenchStatusLabel(status: string) {
  switch (status) {
    case "draft": return "草稿";
    case "submitted": return "待确认";
    case "confirmed": return "已确认";
    case "review_returned": return "已退回";
    case "superseded": return "已修订";
    default: return "状态待核对";
  }
}

function wageVersionKind(value: string | null | undefined): WageVersionKind {
  // Pre-POL-12B rows and service-level legacy mocks read as the original base
  // disposition. Any explicit unknown value remains fail-closed.
  if (value === undefined || value === null || value === "base") return "base";
  if (value === "supplemental" || value === "correction" || value === "reversal") return value;
  throw new ConflictException("工资版本处置类型不受支持，不能确认");
}

function isWageDecreaseKind(kind: WageVersionKind) {
  return kind === "correction" || kind === "reversal";
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function commandFingerprint(action: string, aggregateId: string, input: unknown, actorUserId: string) {
  return fingerprint({ action, aggregateId, input, actorUserId });
}

function sourceCommandFingerprint(input: CreateApprovedWageSourceDto, actorUserId: string) {
  return fingerprint({
    action: "wage_statement.approved_source.create",
    aggregateId: "new",
    actorUserId,
    expectedRevision: input.expectedRevision,
    payload: {
      employmentCompanyId: input.employmentCompanyId,
      wageMonth: input.wageMonth,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      externalReference: input.externalReference,
      sourceVersion: input.sourceVersion,
      basisDate: input.basisDate,
      evidenceFileId: input.evidenceFileId,
      approvedPersonLines: input.approvedPersonLines
    }
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function prismaCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function isSerializableConflict(error: unknown) {
  if (prismaCode(error) === "P2034") return true;
  if (!error || typeof error !== "object" || !("meta" in error)) return false;
  const meta = error.meta;
  return Boolean(meta && typeof meta === "object" && "code" in meta && meta.code === "40001");
}
