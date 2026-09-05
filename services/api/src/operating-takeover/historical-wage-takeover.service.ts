import { createHash, randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  WAGE_COST_COMPONENT_CODES,
  WAGE_CREDITOR_CATEGORIES,
  type RoleKey
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { lockWageConflictBuckets } from "../clearing/wage-conflict-lock";
import { PrismaService } from "../database/prisma.service";
import {
  WageStatementService,
  type HistoricalWageTakeoverPlan
} from "../wage-statement/wage-statement.service";
import {
  HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS,
  HistoricalWageTakeoverAdapter,
  type HistoricalWageLegacySource
} from "./historical-wage-takeover.adapter";
import {
  computePol219HistoricalWageSourceVersionFingerprint,
  computePol219HistoricalWageAuthorityFingerprint,
  computePol219VerifiedPaymentExecutionSet,
  strictJcs,
  type Pol219EvidenceCoordinate,
  type Pol219EvidenceReference
} from "./historical-wage-takeover-fingerprint";
import {
  finalizeHistoricalWageBalanceTarget,
  historicalWageSummarySelectionFingerprint,
  historicalWageSummarySelectionSnapshot,
  parseHistoricalWageSummarySnapshot,
  type HistoricalWagePaymentSourceTarget,
  type HistoricalWageSummaryLineR2,
  type HistoricalWageSummarySnapshotR2,
  type HistoricalWageSummaryTargetSource
} from "./historical-wage-takeover-r2";
import {
  HistoricalWageTakeoverSelectionRefService,
  type HistoricalWageSelectionBinding
} from "./historical-wage-takeover-selection-ref.service";
import { fingerprint } from "./operating-takeover.utils";

type Tx = Prisma.TransactionClient;

const SHA256 = /^[0-9a-f]{64}$/iu;
const MAPPER_NAME = "historical_wage_takeover";
const MAPPER_VERSION = 1;
const SCHEMA_VERSION = 1;
const INVALID_C_FRONTIER_INPUT_MESSAGE = "C级负权威前沿包含非法或不完整的服务端权威输入";
const HISTORICAL_WAGE_APPROVED_SOURCE_SELECT = {
  id: true,
  employmentCompanyId: true,
  wageMonth: true,
  periodStart: true,
  periodEnd: true,
  sourceType: true,
  externalReference: true,
  sourceVersion: true,
  basisDate: true,
  evidenceFileId: true,
  evidenceSha256: true,
  sourceFingerprint: true,
  sourceSnapshot: true
} as const;
const HISTORICAL_WAGE_PRIOR_VERSION_DEPENDENCY_SELECT = {
  id: true,
  statementId: true,
  revision: true,
  kind: true,
  status: true,
  projectionOrigin: true,
  sourceVersionId: true,
  sourceSnapshot: true,
  operatingProjectionSnapshot: true,
  personLines: {
    select: {
      id: true,
      employeeId: true,
      employmentSnapshotId: true,
      costComponents: {
        select: {
          id: true,
          componentCode: true,
          amountCents: true,
          projectAllocations: {
            select: { id: true, projectAllocationId: true, amountCents: true },
            orderBy: { id: "asc" as const }
          }
        },
        orderBy: { id: "asc" as const }
      },
      creditorBreakdowns: {
        select: {
          id: true,
          creditorSubjectType: true,
          creditorSubjectIdentityKey: true,
          creditorCategory: true,
          amountCents: true,
          projectAllocations: {
            select: { id: true, projectAllocationId: true, amountCents: true },
            orderBy: { id: "asc" as const }
          }
        },
        orderBy: { id: "asc" as const }
      },
      projectAllocations: {
        select: {
          id: true,
          projectId: true,
          serviceSnapshotId: true,
          amountCents: true,
          componentAllocations: {
            select: {
              id: true,
              costComponentId: true,
              amountCents: true,
              costComponent: { select: { id: true, componentCode: true } }
            },
            orderBy: { id: "asc" as const }
          },
          creditorAllocations: {
            select: {
              id: true,
              creditorBreakdownId: true,
              amountCents: true,
              creditorBreakdown: {
                select: {
                  id: true,
                  creditorSubjectType: true,
                  creditorSubjectIdentityKey: true,
                  creditorCategory: true
                }
              }
            },
            orderBy: { id: "asc" as const }
          }
        },
        orderBy: { id: "asc" as const }
      }
    },
    orderBy: { id: "asc" as const }
  }
} as const;
const HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT = {
  id: true,
  receiptId: true,
  rowMappingId: true,
  projectId: true,
  lineNo: true,
  decision: true,
  entryKind: true,
  amountCents: true,
  targetKind: true,
  targetRef: true,
  causalOrdinal: true,
  reversesLineId: true,
  causesLineId: true,
  causalityFingerprint: true,
  lineSnapshot: true,
  createdAt: true
} as const;
const HISTORICAL_WAGE_OCCUPANCY_RECEIPT_SELECT = {
  id: true,
  manifestVersionId: true,
  atomicScopeVersionId: true,
  idempotencyKey: true,
  action: true,
  expectedRevision: true,
  actorUserId: true,
  delegatorUserId: true,
  actorSetSnapshot: true,
  permissionSnapshotFingerprint: true,
  fingerprint: true,
  status: true,
  commandSnapshotSchemaVersion: true,
  commandSnapshot: true,
  resultSnapshot: true,
  causalityFingerprint: true,
  createdTransactionId: true,
  causesReceiptId: true,
  createdAt: true,
  lines: {
    select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT,
    orderBy: { id: "asc" as const }
  }
} as const;
const HISTORICAL_WAGE_PRIOR_SUMMARY_REVERSE_MAPPING_SELECT = {
  id: true,
  manifestVersionId: true,
  projectId: true,
  adapterKind: true,
  rowNo: true,
  historicalWageSummaryAuthorityVersionId: true,
  receiptLines: {
    select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT,
    orderBy: { id: "asc" as const }
  }
} satisfies Prisma.OperatingTakeoverRowMappingSelect;
const HISTORICAL_WAGE_PRIOR_SUMMARY_REVERSE_MANIFEST_SELECT = {
  id: true,
  projectId: true,
  atomicScopeVersionId: true,
  adapterKind: true,
  status: true,
  manifestFingerprint: true,
  rows: {
    select: HISTORICAL_WAGE_PRIOR_SUMMARY_REVERSE_MAPPING_SELECT,
    orderBy: [{ rowNo: "asc" as const }, { id: "asc" as const }]
  },
  receipts: {
    select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_SELECT,
    orderBy: [{ expectedRevision: "asc" as const }, { id: "asc" as const }]
  }
} satisfies Prisma.OperatingTakeoverManifestVersionSelect;
const HISTORICAL_WAGE_PRIOR_SUMMARY_AUTHORITY_SELECT = {
  id: true,
  atomicScopeVersionId: true,
  summaryBucketKey: true,
  employmentCompanyId: true,
  projectId: true,
  wageMonth: true,
  catalogVersion: true,
  positionCategoryCode: true,
  positionCategoryLabelSnapshot: true,
  evidenceCoordinate: true,
  sourceSchemaVersion: true,
  sourcePayload: true,
  sourceVersionFingerprint: true,
  authoritySchemaVersion: true,
  authorityPayload: true,
  authorityFingerprint: true,
  assignedWageExclusionSchemaVersion: true,
  assignedWageExclusionPayload: true,
  assignedWageExclusionSetFingerprint: true,
  scopeCreatorIdentitySnapshot: true,
  permissionScopeFingerprint: true,
  revision: true,
  supersedesVersionId: true,
  lineageRootAuthorityVersionId: true,
  sourceDeltaFingerprint: true,
  rootClosureFingerprint: true,
  declaredByUserId: true,
  declaredDelegatorUserId: true,
  createdTransactionId: true,
  createdAt: true,
  creditorLines: {
    select: {
      id: true,
      atomicScopeVersionId: true,
      authorityVersionId: true,
      revision: true,
      stableBucketKey: true,
      stableBucketKeyFingerprint: true,
      employmentCompanyId: true,
      projectId: true,
      wageMonth: true,
      positionCategoryCode: true,
      wageCreditorCategoryCode: true,
      wageCreditorCategoryLabelSnapshot: true,
      creditorIdentityKind: true,
      creditorPartyVersionId: true,
      controlledScopeCode: true,
      controlledScopeDescription: true,
      controlledScopeEvidenceCoordinate: true,
      currencyCode: true,
      debtStatus: true,
      grossDebtCents: true,
      historicallySettledCents: true,
      outstandingBalanceCents: true,
      isTombstone: true,
      targetKind: true,
      targetSchemaVersion: true,
      targetBusinessKey: true,
      targetPayload: true,
      targetFingerprint: true,
      signedGrossDeltaCents: true,
      signedHistoricallySettledDeltaCents: true,
      signedOutstandingBalanceDeltaCents: true,
      deltaFingerprint: true,
      rootCreditorLineId: true,
      rootPayableRefId: true,
      createdTransactionId: true,
      createdAt: true
    },
    orderBy: [{ stableBucketKey: "asc" }, { id: "asc" }]
  },
  attestations: {
    select: {
      id: true,
      atomicScopeVersionId: true,
      authorityVersionId: true,
      summaryBucketKey: true,
      receiptId: true,
      actorUserId: true,
      delegatorUserId: true,
      permissionScopeFingerprint: true,
      attestationOrdinal: true,
      createdTransactionId: true,
      createdAt: true
    },
    orderBy: [{ attestationOrdinal: "asc" }, { id: "asc" }]
  },
  takeoverMappings: {
    select: {
      id: true,
      manifestVersionId: true,
      projectId: true,
      adapterKind: true,
      rowNo: true,
      sourceType: true,
      sourceBusinessId: true,
      sourceVersion: true,
      sourceFingerprint: true,
      amountCents: true,
      evidenceLevel: true,
      entryKind: true,
      mappingDecision: true,
      sourceDiscriminator: true,
      historicalWageSummaryAuthorityVersionId: true,
      readSetSnapshot: true,
      mappingFingerprint: true,
      createdAt: true,
      receiptLines: {
        select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT,
        orderBy: { id: "asc" as const }
      },
      manifest: {
        select: {
          id: true,
          projectId: true,
          atomicScopeVersionId: true,
          adapterKind: true,
          status: true,
          manifestFingerprint: true
        }
      }
    },
    orderBy: [{ projectId: "asc" }, { rowNo: "asc" }, { id: "asc" }]
  },
  atomicScope: {
    select: {
      id: true,
      scopeKind: true,
      authoritySourceRef: true,
      authoritySourceFingerprint: true,
      sourceClosureFingerprint: true,
      reservedWageStatementVersionId: true,
      candidateBaselineSha: true,
      permissionSnapshotFingerprint: true,
      readSetFingerprint: true,
      createdByUserId: true,
      createdTransactionId: true,
      createdAt: true,
      projects: {
        select: {
          id: true,
          atomicScopeVersionId: true,
          projectId: true,
          manifestVersionId: true,
          createdTransactionId: true,
          createdAt: true,
          manifest: {
            select: HISTORICAL_WAGE_PRIOR_SUMMARY_REVERSE_MANIFEST_SELECT
          }
        },
        orderBy: [{ projectId: "asc" }, { id: "asc" }]
      },
      manifests: {
        select: HISTORICAL_WAGE_PRIOR_SUMMARY_REVERSE_MANIFEST_SELECT,
        orderBy: [{ projectId: "asc" }, { id: "asc" }]
      },
      historicalSummaryAuthorities: {
        select: {
          id: true,
          atomicScopeVersionId: true,
          summaryBucketKey: true,
          revision: true
        },
        orderBy: [{ revision: "asc" }, { id: "asc" }]
      },
      receipts: {
        select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_SELECT,
        orderBy: [{ expectedRevision: "asc" }, { id: "asc" }]
      }
    }
  }
} satisfies Prisma.HistoricalWageSummaryAuthorityVersionSelect;
const HISTORICAL_WAGE_PRIOR_SUMMARY_PAYABLE_SELECT = {
  id: true,
  atomicScopeVersionId: true,
  authorityVersionId: true,
  authorityCreditorLineId: true,
  rowMappingId: true,
  stableBucketKey: true,
  employmentCompanyId: true,
  projectId: true,
  wageMonth: true,
  positionCategoryCode: true,
  wageCreditorCategoryCode: true,
  wageCreditorCategoryLabelSnapshot: true,
  creditorIdentityKind: true,
  creditorPartyVersionId: true,
  controlledScopeCode: true,
  controlledScopeDescription: true,
  controlledScopeEvidenceCoordinate: true,
  currencyCode: true,
  debtStatus: true,
  grossDebtCents: true,
  historicallySettledCents: true,
  outstandingBalanceCents: true,
  targetKind: true,
  targetBusinessKey: true,
  targetPayload: true,
  targetFingerprint: true,
  historicalWageBalanceReconciliationVersionId: true,
  usageScope: true,
  newPaymentAllowed: true,
  settlementAllocationAllowed: true,
  direction: true,
  deltaAmountCents: true,
  adjustsSummaryPayableRefId: true,
  deltaFingerprint: true,
  createdTransactionId: true,
  createdAt: true,
  eligibilityRevocations: {
    select: {
      id: true,
      summaryPayableRefId: true,
      compensationReceiptId: true,
      reason: true,
      createdTransactionId: true,
      createdAt: true
    },
    orderBy: { id: "asc" }
  }
} satisfies Prisma.HistoricalWageSummaryPayableRefSelect;
const HISTORICAL_WAGE_ACTION_POLICY = {
  prepare: {
    actionKey: "clearing.prepare",
    positions: ["finance_staff", "finance_director"]
  },
  attest: {
    actionKey: "clearing.attest",
    positions: ["finance_director"]
  },
  activate: {
    actionKey: "clearing.confirm",
    positions: ["finance_director"]
  },
  compensate: {
    actionKey: "clearing.confirm",
    positions: ["finance_director"]
  }
} as const satisfies Record<string, { actionKey: "clearing.prepare" | "clearing.attest" | "clearing.confirm"; positions: readonly RoleKey[] }>;

type HistoricalWageAction = keyof typeof HISTORICAL_WAGE_ACTION_POLICY;

export type HistoricalWageTakeoverCommand = {
  selectionRef: string;
  idempotencyKey: string;
  expectedRevision: number;
  businessReason: string;
  evidenceRefs?: string[];
  delegatorUserId?: string;
};

/** No source facts may cross this boundary; it only rebinds an existing scope. */
export type HistoricalWageTakeoverSelectionRenewal = {
  selectionRef: string;
  delegatorUserId?: string;
};

export type HistoricalWageTakeoverOption = {
  selectionRef: string;
  grade: "A" | "B" | "C";
  label: string;
  projectCount: number;
  legacyFactCount: number;
};

type Identity = {
  actualUserId: string;
  delegatorUserId?: string;
  actualRoles: RoleKey[];
  delegatorRoles?: RoleKey[];
  actorIds: string[];
  actorSetSnapshot: Prisma.InputJsonValue;
};

type ResolvedLegacy = HistoricalWageLegacySource & {
  factId: string;
  legacyWageMonth: string | null;
  employmentCompanyId: string | null;
  entryKind: "original" | "correction" | "reversal";
  direction: "increase" | "decrease";
  adjustsFactId: string | null;
  adjustmentRoot: {
    factId: string;
    sourceBusinessId: string;
    sourceVersion: number;
    sourceFingerprint: string;
    legacyWageMonth: string | null;
    employmentCompanyId: string | null;
  } | null;
  legacySnapshot: Prisma.InputJsonValue;
  costImpactSnapshot: Prisma.InputJsonValue;
  payableImpactSnapshot: Prisma.InputJsonValue;
};

type HistoricalAdjustmentRootProof = {
  legacyFactId: string;
  rootFactId: string;
  bridgeId: string;
  bridgeTargetFingerprint: string;
  envelopeId: string;
  envelopeCanonicalFingerprint: string;
  wageStatementVersionId: string;
  wageApprovedSourceVersionId: string;
  payableRefIds: string[];
};

type HistoricalPriorVersionEligibilityProof = {
  priorVersionId: string;
  priorSourceVersionId: string;
  priorAtomicScopeVersionId: string;
  priorSourceClosureFingerprint: string;
  activationReceiptId: string;
  activationReceiptCausalityFingerprint: string;
  activationLineIds: string[];
  activeEnvelopes: Array<{
    envelopeId: string;
    rowMappingId: string;
    projectId: string;
    canonicalFingerprint: string;
    bridgeId: string;
    bridgeTargetFingerprint: string;
  }>;
  priorCanonicalGraph: HistoricalPriorCanonicalGraph;
  priorCanonicalGraphFingerprint: string;
};

type HistoricalPriorCanonicalGraph = {
  schemaVersion: 1;
  reservation: {
    id: string;
    atomicScopeVersionId: string;
    targetWageStatementId: string;
    expectedCurrentRevision: number;
    reservedRevision: number;
    versionKind: string;
    priorConfirmedVersionId: string | null;
    priorSourceVersionId: string | null;
    sourceDeltaFingerprint: string;
    canonicalRootClosureFingerprint: string;
    createdAt: string;
    mappings: Array<{
      id: string;
      manifestVersionId: string;
      projectId: string;
      rowNo: number;
      wageStatementReservationId: string | null;
    }>;
  };
  scope: {
    id: string;
    scopeKind: string;
    authoritySourceRef: string;
    authoritySourceFingerprint: string;
    sourceClosureFingerprint: string;
    reservedWageStatementVersionId: string | null;
    candidateBaselineSha: string;
    permissionSnapshotFingerprint: string;
    readSetFingerprint: string;
    createdByUserId: string;
    createdTransactionId: string;
    createdAt: string;
    manifests: Array<{
      id: string;
      projectId: string;
      atomicScopeVersionId: string | null;
      rows: Array<{
        id: string;
        manifestVersionId: string;
        projectId: string;
        rowNo: number;
        wageStatementReservationId: string | null;
      }>;
    }>;
    projects: Array<{
      id: string;
      atomicScopeVersionId: string;
      projectId: string;
      manifestVersionId: string;
      createdTransactionId: string;
      createdAt: string;
      manifest: {
        id: string;
        projectId: string;
        atomicScopeVersionId: string | null;
        adapterKind: string;
        manifestNo: string;
        version: number;
        status: string;
        sourceScopeFingerprint: string;
        mapperName: string;
        mapperVersion: number;
        schemaVersion: number;
        candidateBaselineSha: string;
        permissionSnapshotFingerprint: string;
        readSetFingerprint: string;
        manifestFingerprint: string;
        createdByUserId: string;
        createdAt: string;
      };
    }>;
  };
  envelopes: Array<{
    id: string;
    atomicScopeVersionId: string;
    manifestVersionId: string;
    rowMappingId: string;
    wageStatementVersionId: string;
    projectId: string;
    legacySourceType: string;
    legacySourceBusinessId: string;
    legacySourceVersion: number;
    legacySourceFingerprint: string;
    legacyImpactSnapshot: unknown;
    projectionOrigin: string;
    deltaDirection: string;
    canonicalFingerprint: string;
    createdTransactionId: string;
    createdAt: string;
    manifestOwnership: { id: string; atomicScopeVersionId: string | null; projectId: string };
    mappingOwnership: {
      id: string;
      manifestVersionId: string;
      projectId: string;
      rowNo: number;
      adapterKind: string;
      sourceType: string;
      sourceBusinessId: string;
      sourceVersion: number;
      sourceFingerprint: string;
      sourceCoordinate: string;
      normalizedRowHash: string;
      amountCents: string;
      evidenceLevel: string;
      coverageKind: string | null;
      coverageKey: string | null;
      periodStart: string | null;
      entryKind: string;
      mappingDecision: string;
      conflictGroupKey: string;
      adjustmentTargetRef: string | null;
      sourceDiscriminator: string | null;
      governedSubjectKey: string | null;
      authorityCategory: string | null;
      authoritySnapshotRef: string | null;
      authorityFingerprint: string | null;
      authorityVersionId: string | null;
      authorityLineId: string | null;
      authorityLineFingerprint: string | null;
      obligationId: string | null;
      authoritativeGrossCapCents: string | null;
      currencyCode: string | null;
      wageApprovedSourceVersionId: string | null;
      wageStatementReservationId: string | null;
      historicalWageSummaryAuthorityVersionId: string | null;
      authoritySnapshot: unknown;
      legacySourceSnapshot: unknown;
      readSetSnapshot: unknown;
      mappingFingerprint: string;
      createdAt: string;
    };
    reservationOwnership: { id: string; atomicScopeVersionId: string };
    costCells: Array<{ id: string; envelopeId: string; costCellId: string; direction: string; amountCents: string }>;
    payableRefs: Array<{ id: string; envelopeId: string; payableRefId: string; direction: string; amountCents: string }>;
    legacyImpactBridges: Array<{
      id: string;
      envelopeId: string | null;
      summaryAuthorityVersionId: string | null;
      rowMappingId: string;
      projectId: string;
      legacyImpactEntryId: string;
      impactKind: string;
      direction: string;
      amountCents: string;
      sourceFingerprint: string;
      createdTransactionId: string;
      createdAt: string;
    }>;
    eligibilityRevocations: [];
  }>;
  legacySourceBridges: Array<{
    id: string;
    projectId: string;
    rowMappingId: string;
    sourceType: string;
    sourceBusinessId: string;
    sourceVersion: number;
    sourceFingerprint: string;
    targetKind: string;
    targetRef: string;
    targetFingerprint: string;
    mappingDecision: string;
    createdByUserId: string;
    createdTransactionId: string | null;
    createdAt: string;
  }>;
  receipts: Array<{
    id: string;
    manifestVersionId: string | null;
    atomicScopeVersionId: string | null;
    idempotencyKey: string;
    action: string;
    expectedRevision: number;
    actorUserId: string;
    delegatorUserId: string | null;
    actorSetSnapshot: unknown;
    permissionSnapshotFingerprint: string;
    fingerprint: string;
    status: string;
    resultSnapshot: unknown;
    causalityFingerprint: string;
    createdTransactionId: string;
    causesReceiptId: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      receiptId: string;
      rowMappingId: string;
      projectId: string | null;
      lineNo: number;
      decision: string;
      entryKind: string;
      amountCents: string;
      targetKind: string | null;
      targetRef: string | null;
      causalOrdinal: number;
      reversesLineId: string | null;
      causesLineId: string | null;
      causalityFingerprint: string;
      lineSnapshot: unknown;
      createdAt: string;
    }>;
  }>;
  compensationReceipts: [];
  causeSuccessors: [];
};

type HistoricalWageEvidenceFileReadSet = {
  expectedFileObjectId: string;
  expectedContentSha256: string;
  actual: { id: string; storageStatus: string; contentSha256: string | null } | null;
};

type HistoricalWageCMaterializationDependencyReadSet = {
  schemaVersion: 1;
  expected: {
    employmentCompanyId: string;
    employeeIds: string[];
    projectIds: string[];
    serviceBasisBindings: Array<{
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      evidenceSha256: string;
    }>;
    businessPartyVersionIds: string[];
  };
  actual: {
    employmentCompany: { id: string } | null;
    employees: Array<{ id: string; name: string; departmentId: string | null }>;
    projects: Array<{ id: string; code: string; name: string }>;
    serviceBasisBindings: Array<{
      id: string;
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      evidenceSha256: string;
      authorityFingerprint: string;
    }>;
    businessPartyVersions: Array<{
      id: string;
      businessPartyId: string;
      versionNo: number;
      snapshot: Prisma.JsonValue;
    }>;
  };
};

type HistoricalWageCApprovedSourceProbe = {
  sourceVersionId: string;
  employmentCompanyId: string;
  wageMonth: string;
  periodStart: string | null;
  periodEnd: string | null;
  sourceType: string | null;
  externalReference: string | null;
  sourceVersion: string | null;
  basisDate: string | null;
  sourceFingerprint: string;
  sourceSnapshotFingerprint: string;
  evidenceFile: HistoricalWageEvidenceFileReadSet;
  materializationDependencyReadSet: HistoricalWageCMaterializationDependencyReadSet;
  plannerInput: {
    sourceVersionId: string;
    sourceFingerprint: string;
    reservedTargetWageStatementId: string;
  };
  plannerOutcome:
    | { status: "planned"; result: HistoricalWageTakeoverPlan }
    | { status: "rejected"; reasonCode: "CANONICAL_WAGE_PLANNER_CONFLICT" };
  plannerDependencyReadSet: Record<string, unknown>;
  closureFingerprint: string | null;
  closureLegacyCoordinates: string[];
  stablePlan: {
    statement: { id: string; currentRevision: number } | null;
    plannerResult: HistoricalWageTakeoverPlan;
    projectIds: string[];
    projectDeltas: Array<{ projectId: string; direction: "increase" | "decrease"; amountCents: bigint }>;
    adjustmentRootProofs: HistoricalAdjustmentRootProof[];
    priorVersionEligibilityProof: HistoricalPriorVersionEligibilityProof | null;
    sourceDeltaFingerprint: string;
    expectedCurrentRevision: number;
    reservedRevision: number;
    versionKind: "base" | "correction" | "reversal";
    priorConfirmedVersionId: string | null;
    priorSourceVersionId: string | null;
    canonicalRootClosureFingerprint: string;
    canonicalRootPayableRefIds: string[];
    materializationAuthorityReadSet: MaterializationAuthorityReadSet;
    conflictReadSet: ScopePlan["conflictReadSet"] | null;
  } | null;
  outcome: "incomplete" | "canonical_ineligible" | "cross_source_blocked" | "eligible";
  blockedReason: string | null;
};

type HistoricalWageCSummaryProbe = {
  summaryFingerprint: string | null;
  summarySourceVersionFingerprint: string | null;
  evidenceFiles: HistoricalWageEvidenceFileReadSet[];
  stablePlan: {
    summaryBucketKey: string;
    revision: number;
    supersedesVersionId: string | null;
    lineageRootAuthorityVersionId: string | null;
    sourceDeltaFingerprint: string;
    rootClosureFingerprint: string;
    lineDeltaFingerprints: string[];
  } | null;
  priorLineageProof: HistoricalWageSummaryPriorLineageProof;
  outcome: "absent_or_invalid" | "authority_ineligible" | "cross_source_blocked" | "eligible";
  blockedReason: string | null;
};

type HistoricalWagePriorSummaryAuthority = Prisma.HistoricalWageSummaryAuthorityVersionGetPayload<{
  select: typeof HISTORICAL_WAGE_PRIOR_SUMMARY_AUTHORITY_SELECT;
}>;

type HistoricalWagePriorSummaryPayableRef = Prisma.HistoricalWageSummaryPayableRefGetPayload<{
  select: typeof HISTORICAL_WAGE_PRIOR_SUMMARY_PAYABLE_SELECT;
}>;

type HistoricalWageSummaryPriorLineageState = "none" | "active" | "inactive_compensated" | "invalid";

type HistoricalWageSummaryPriorLineageProof = {
  schemaVersion: 1;
  summaryBucketKey: string | null;
  state: HistoricalWageSummaryPriorLineageState;
  reasonCode: string;
  activePriorAuthorityId: string | null;
  readSetFingerprint: string;
  readSet: {
    authorities: HistoricalWagePriorSummaryAuthority[];
    payableRefs: HistoricalWagePriorSummaryPayableRef[];
  };
};

type HistoricalWageCConflictFrontier = {
  employmentCompanyId: string;
  wageMonth: string;
  projectIds: string[];
  contracts: Array<{
    id: string;
    projectId: string;
    companyEntityId: string;
    companyEntityVersionId: string;
    requestFingerprint: string;
    fileContentSha256Snapshot: string;
  }>;
  authorities: Array<{
    id: string;
    affiliateCompanyContractId: string;
    authorityFingerprint: string;
  }>;
  lines: Array<{
    id: string;
    authorityVersionId: string;
    projectId: string;
    coverageKind: string;
    personAuthorityKey: string | null;
    lineFingerprint: string;
  }>;
};

type HistoricalWageCFocusOccupancyReadSet = {
  state: "unoccupied" | "occupied";
  bridges: Array<Record<string, unknown>>;
  mappings: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  manifests: Array<Record<string, unknown>>;
  scopes: Array<Record<string, unknown>>;
  scopeProjects: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  manifestReceipts: Array<Record<string, unknown>>;
  mappingReceiptLines: Array<Record<string, unknown>>;
  activationCausedByLines: Array<Record<string, unknown>>;
  activationReversedByLines: Array<Record<string, unknown>>;
  compensationReceipts: Array<Record<string, unknown>>;
  causalSuccessors: Array<Record<string, unknown>>;
};

type HistoricalWageCNegativeAuthorityFrontier = {
  schemaVersion: 1;
  authorityScope: {
    state: "resolved" | "unresolved";
    employmentCompanyId: string | null;
    wageMonth: string | null;
    focusProjectId: string;
    focusLegacyCoordinate: string;
  };
  legacyNamespace: ReturnType<typeof legacyReadSet>[];
  canonicalWageDependencyReadSet: Record<string, unknown>;
  approvedSourceProbes: HistoricalWageCApprovedSourceProbe[];
  summaryDependencyReadSet: Record<string, unknown>;
  summaryProbe: HistoricalWageCSummaryProbe;
  focusConflictReadSet: HistoricalWageCConflictFrontier | null;
  focusOccupancyReadSet: HistoricalWageCFocusOccupancyReadSet;
  resolution: {
    eligibleASourceVersionIds: string[];
    ambiguousA: boolean;
    eligibleB: boolean;
    focusOccupied: boolean;
    reasonCode:
      | "LEGACY_AUTHORITY_COORDINATE_UNRESOLVED"
      | "A_AUTHORITY_AMBIGUOUS"
      | "A_AUTHORITY_CROSS_SOURCE_BLOCKED"
      | "B_AUTHORITY_CROSS_SOURCE_BLOCKED"
      | "NO_COMPLETE_A_OR_B_AUTHORITY";
  };
};

type HistoricalWageApprovedSourceCandidate = {
  id: string;
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
  sourceSnapshot: Prisma.JsonValue;
};

type MaterializationAuthorityReadSet = {
  schemaVersion: 1;
  employmentCompany: { id: string };
  employees: Array<{ id: string; name: string; departmentId: string | null }>;
  projects: Array<{ id: string; code: string; name: string }>;
  serviceBasisBindings: Array<{
    id: string;
    projectId: string;
    serviceSnapshotId: string;
    serviceMonth: string;
    evidenceSha256: string;
    authorityFingerprint: string;
  }>;
  businessPartyVersions: Array<{
    id: string;
    businessPartyId: string;
    versionNo: number;
    snapshot: Prisma.JsonValue;
  }>;
};

type ScopePlan = {
  grade: "A" | "B" | "C";
  sourceVersionId?: string;
  sourceFingerprint?: string;
  sourceClosureFingerprint?: string;
  projectIds?: string[];
  projectDeltas?: Array<{ projectId: string; direction: "increase" | "decrease"; amountCents: bigint }>;
  adjustmentRootProofs?: HistoricalAdjustmentRootProof[];
  priorVersionEligibilityProof?: HistoricalPriorVersionEligibilityProof | null;
  materializationAuthorityReadSet?: MaterializationAuthorityReadSet;
  negativeAuthorityFrontier?: HistoricalWageCNegativeAuthorityFrontier;
  negativeAuthorityFrontierFingerprint?: string;
  conflictReadSet?: HistoricalWageCConflictFrontier & {
    employeeIdsByProject?: Array<{ projectId: string; employeeIds: string[] }>;
  };
  wageReservation?: {
    targetWageStatementId: string;
    expectedCurrentRevision: number;
    reservedRevision: number;
    versionKind: "base" | "correction" | "reversal";
    priorConfirmedVersionId: string | null;
    priorSourceVersionId: string | null;
    sourceDeltaFingerprint: string;
    canonicalRootClosureFingerprint: string;
  };
  summary?: HistoricalSummaryPlannedLine[];
  summaryAuthority?: {
    authorityFingerprint?: string;
    sourceVersionFingerprint: string;
    employmentCompanyId: string;
    projectId: string;
    wageMonth: string;
    catalogVersion: string;
    positionCategoryCode: HistoricalWageSummarySnapshotR2["positionCategoryCode"];
    positionCategoryLabel: string;
    evidenceCoordinate: Pol219EvidenceCoordinate;
    revision: number;
    supersedesVersionId: string | null;
    lineageRootAuthorityVersionId: string | null;
    sourceDeltaFingerprint: string;
    rootClosureFingerprint: string;
    sourceSnapshot: Prisma.InputJsonValue;
    snapshot: HistoricalWageSummarySnapshotR2;
    priorLineageProof: HistoricalWageSummaryPriorLineageProof;
  };
  blockedReason?: string;
};

type HistoricalSummaryLine = HistoricalWageSummaryLineR2;

type HistoricalSummaryPlannedLine = HistoricalSummaryLine & {
  stableBucketKey: string;
  signedGrossDeltaCents: bigint;
  signedHistoricallySettledDeltaCents: bigint;
  signedOutstandingBalanceDeltaCents: bigint;
  deltaFingerprint: string;
  rootCreditorLineId: string | null;
  rootPayableRefId: string | null;
  finalTargetFingerprint?: string;
};

type HistoricalSummaryTarget = HistoricalWageSummaryTargetSource;
type HistoricalPaymentExecutionEvidence = HistoricalWagePaymentSourceTarget["paymentExecutions"][number];
type HistoricalEvidenceCoordinate = Pol219EvidenceReference;
type HistoricalSummarySnapshot = HistoricalWageSummarySnapshotR2;

type FinalizedHistoricalSummaryLine = {
  id: string;
  planned: HistoricalSummaryPlannedLine;
  targetPayload: Record<string, unknown>;
  targetFingerprint: string;
  balanceTarget: ReturnType<typeof finalizeHistoricalWageBalanceTarget>;
};

type FinalizedHistoricalSummaryAuthority = {
  id: string;
  payload: ReturnType<typeof computePol219HistoricalWageAuthorityFingerprint>["payload"];
  fingerprint: string;
  lines: FinalizedHistoricalSummaryLine[];
};

type ScopeMapping = {
  id: string;
  manifestId: string;
  projectId: string;
  mappingDecision: string;
  evidenceLevel: string;
  sourceDiscriminator: string | null;
  legacy: ResolvedLegacy;
};

type TakeoverTarget = {
  targetKind: string;
  targetRef: string;
  targetFingerprint: string;
  decision: "FORMAL" | "GAP";
};

/**
 * #219's adapter owns only historical wage selection and linking. It never
 * writes OperatingFact/OperatingImpactEntry, payment, or settlement data.
 * All authorization reads occur through the transaction client supplied by
 * `serializable`, avoiding the root-client TOCTOU path used by older flows.
 */
@Injectable()
export class HistoricalWageTakeoverService {
  private readonly adapter = new HistoricalWageTakeoverAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyRoles: CompanyRoleResolverService,
    private readonly selectionRefs: HistoricalWageTakeoverSelectionRefService,
    private readonly wageStatements: WageStatementService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  /**
   * Returns server-derived opaque candidates. `projectId` is display filtering
   * only: it never enters the signed authority binding or narrows an A closure.
   */
  async options(actorUserId: string, projectId?: string, now = new Date()) {
    const projectFilter = projectId?.trim() || undefined;
    return this.serializable(async (tx) => {
      await this.resolveIdentityInTransaction(tx, actorUserId, undefined, "prepare", "options", now);
      const facts = await tx.operatingFact.findMany({
        where: {
          factKind: "project_wage",
          status: "confirmed"
        },
        include: { impacts: true },
        orderBy: [{ projectId: "asc" }, { sourceType: "asc" }, { sourceBusinessId: "asc" }]
      });
      const factById = new Map(facts.map((fact) => [fact.id, fact]));
      const legacy = facts.flatMap((fact) => {
        const candidate = historicalWageOptionLegacy(fact, fact.adjustsFactId ? factById.get(fact.adjustsFactId) : undefined);
        return candidate ? [candidate] : [];
      });
      const sources = await tx.wageApprovedSourceVersion.findMany({
        select: HISTORICAL_WAGE_APPROVED_SOURCE_SELECT,
        orderBy: [{ wageMonth: "desc" }, { id: "asc" }]
      });
      if (
        new Set(sources.map((source) => source.id)).size !== sources.length ||
        sources.some((source) => !validCApprovedSourceCandidate(source))
      ) {
        throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE);
      }
      const options: HistoricalWageTakeoverOption[] = [];
      const assignedLegacyKeys = new Set<string>();
      const ambiguousLegacyKeys = new Set<string>();
      const aCandidates: Array<{
        binding: HistoricalWageSelectionBinding;
        closure: ResolvedLegacy[];
        projectCount: number;
      }> = [];

      for (const source of sources) {
        if (!SHA256.test(source.sourceFingerprint)) continue;
        const people = approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256);
        if (!people.length || people.some((person) => !validApprovedPerson(person))) continue;
        const totals = new Map<string, bigint>();
        for (const person of people) {
          for (const allocation of person.projectAllocations) {
            totals.set(allocation.projectId, (totals.get(allocation.projectId) ?? 0n) + allocation.amountCents);
          }
        }
        let comparisonTotals = new Map<string, bigint>();
        const employmentCompanyIds = sortedUnique(people.map((person) => person.employmentCompanyId));
        if (employmentCompanyIds.length !== 1) continue;
        const statement = await tx.wageStatement.findUnique({
          where: {
            employmentCompanyId_wageMonth: {
              employmentCompanyId: employmentCompanyIds[0]!,
              wageMonth: source.wageMonth
            }
          },
          select: { id: true, currentRevision: true }
        });
        if (statement) {
          const prior = await tx.wageStatementVersion.findFirst({
            where: { statementId: statement.id, revision: statement.currentRevision, status: "confirmed" },
            select: { id: true, sourceSnapshot: true }
          });
          if (!prior) continue;
          const previousPeople = approvedSourcePeople(prior.sourceSnapshot);
          if (!previousPeople.length || previousPeople.some((person) => !validApprovedPerson(person)) || !sameStrings(approvedIdentityKeys(people), approvedIdentityKeys(previousPeople))) continue;
          comparisonTotals = approvedProjectTotals(previousPeople);
          if (!sameStrings(sortedUnique([...totals.keys()]), sortedUnique([...comparisonTotals.keys()]))) continue;
        }
        const deltas = [...totals.entries()].map(([sourceProjectId, amountCents]) => {
          const signed = amountCents - (comparisonTotals.get(sourceProjectId) ?? 0n);
          return {
            sourceProjectId,
            amountCents: signed < 0n ? -signed : signed,
            direction: (signed >= 0n ? "increase" : "decrease") as "increase" | "decrease",
            signed
          };
        }).filter((delta) => delta.signed !== 0n);
        const closure: ResolvedLegacy[] = [];
        let complete = totals.size > 0 && deltas.length > 0;
        for (const { sourceProjectId, amountCents, direction } of deltas.sort((left, right) => left.sourceProjectId.localeCompare(right.sourceProjectId))) {
          const matches = legacy.filter((item) =>
            item.projectId === sourceProjectId &&
            item.legacyWageMonth === source.wageMonth &&
            item.employmentCompanyId === employmentCompanyIds[0] &&
            item.amountCents === amountCents &&
            item.direction === direction
          );
          if (matches.length !== 1) {
            complete = false;
            break;
          }
          closure.push(matches[0]!);
        }
        if (!complete || closure.length !== deltas.length) continue;
        const sortedClosure = [...closure].sort((left, right) => legacyCoordinateKey(left).localeCompare(legacyCoordinateKey(right)));
        const sourceClosureFingerprint = fingerprint({
          sourceVersionId: source.id,
          sourceFingerprint: source.sourceFingerprint,
          projectIds: [...totals.keys()].sort((left, right) => left.localeCompare(right)),
          legacy: sortedClosure.map(legacyReadSet)
        });
        let binding: HistoricalWageSelectionBinding = {
          actorUserId,
          selectionFingerprint: fingerprint({
            policy: "pol219-historical-wage-selection-v1",
            grade: "A",
            sourceVersionId: source.id,
            sourceFingerprint: source.sourceFingerprint,
            sourceClosureFingerprint,
            legacy: sortedClosure.map(legacyReadSet)
          }),
          grade: "A",
          sourceVersionId: source.id,
          sourceFingerprint: source.sourceFingerprint,
          sourceClosureFingerprint,
          legacyCoordinates: sortedClosure.map(legacyCoordinate)
        };
        const plan = await this.preflightPlan(tx, binding, sortedClosure);
        if (plan.grade !== "A") continue;
        if (!plan.materializationAuthorityReadSet) continue;
        binding = {
          ...binding,
          selectionFingerprint: aSelectionFingerprint(
            source.id,
            source.sourceFingerprint,
            sourceClosureFingerprint,
            sortedClosure,
            plan.materializationAuthorityReadSet,
            plan.priorVersionEligibilityProof?.priorCanonicalGraphFingerprint ?? null
          )
        };
        if (projectFilter && !(plan.projectIds ?? []).includes(projectFilter)) continue;
        aCandidates.push({ binding, closure: sortedClosure, projectCount: totals.size });
      }

      const aCandidateCounts = new Map<string, number>();
      for (const candidate of aCandidates) {
        for (const item of candidate.closure) {
          const key = legacyCoordinateKey(item);
          aCandidateCounts.set(key, (aCandidateCounts.get(key) ?? 0) + 1);
        }
      }
      for (const candidate of aCandidates) {
        const hasAmbiguity = candidate.closure.some((item) => (aCandidateCounts.get(legacyCoordinateKey(item)) ?? 0) !== 1);
        if (hasAmbiguity) {
          for (const item of candidate.closure) ambiguousLegacyKeys.add(legacyCoordinateKey(item));
          continue;
        }
        options.push({
          selectionRef: this.selectionRefs.issue(candidate.binding, now),
          grade: "A",
          label: `A级逐人工资权威（${candidate.projectCount}个项目）`,
          projectCount: candidate.projectCount,
          legacyFactCount: candidate.closure.length
        });
        for (const item of candidate.closure) assignedLegacyKeys.add(legacyCoordinateKey(item));
      }

      for (const item of legacy) {
        if (assignedLegacyKeys.has(legacyCoordinateKey(item))) continue;
        if (ambiguousLegacyKeys.has(legacyCoordinateKey(item))) continue;
        if (projectFilter && item.projectId !== projectFilter) continue;
        const summary = parseHistoricalWageSummarySnapshot(item.legacySnapshot);
        if (!summary) continue;
        const summaryFingerprint = historicalWageSummarySelectionFingerprint(summary);
        let binding: HistoricalWageSelectionBinding = {
          actorUserId,
          selectionFingerprint: fingerprint({
            policy: "pol219-historical-wage-selection-v1",
            grade: "B",
            summaryFingerprint,
            legacy: [legacyReadSet(item)]
          }),
          grade: "B",
          summaryFingerprint,
          legacyCoordinates: [legacyCoordinate(item)]
        };
        const plan = await this.preflightPlan(tx, binding, [item]);
        if (plan.grade !== "B" || !plan.summaryAuthority) continue;
        binding = {
          ...binding,
          selectionFingerprint: bSelectionFingerprint(
            summaryFingerprint,
            [item],
            plan.summaryAuthority.priorLineageProof
          )
        };
        options.push({
          selectionRef: this.selectionRefs.issue(binding, now),
          grade: "B",
          label: "B级历史工资汇总权威（1个项目）",
          projectCount: 1,
          legacyFactCount: 1
        });
        assignedLegacyKeys.add(legacyCoordinateKey(item));
      }

      for (const item of legacy) {
        if (assignedLegacyKeys.has(legacyCoordinateKey(item))) continue;
        if (projectFilter && item.projectId !== projectFilter) continue;
        const negativeAuthorityFrontier = await this.resolveCNegativeAuthorityFrontier(tx, item, {
          legacy,
          sources
        });
        if (
          negativeAuthorityFrontier.resolution.focusOccupied ||
          (negativeAuthorityFrontier.resolution.eligibleASourceVersionIds.length === 1 &&
            !negativeAuthorityFrontier.resolution.ambiguousA) ||
          (negativeAuthorityFrontier.resolution.eligibleB && !negativeAuthorityFrontier.resolution.ambiguousA)
        ) continue;
        const negativeAuthorityFrontierFingerprint = fingerprint(negativeAuthorityFrontier);
        const binding: HistoricalWageSelectionBinding = {
          actorUserId,
          selectionFingerprint: cSelectionFingerprint(item, negativeAuthorityFrontierFingerprint),
          grade: "C",
          negativeAuthorityFrontierFingerprint,
          legacyCoordinates: [legacyCoordinate(item)]
        };
        options.push({
          selectionRef: this.selectionRefs.issue(binding, now),
          grade: "C",
          label: "C级待补证工资缺口（1个项目）",
          projectCount: 1,
          legacyFactCount: 1
        });
      }

      return { options };
    });
  }

  async createScope(
    actorUserId: string,
    input: HistoricalWageTakeoverCommand,
    now = new Date()
  ) {
    // Activation uses this internal seam; keeping the dependency explicit here
    // documents that #219 never reaches wage tables through a public command.
    void this.wageStatements;
    assertCreateCommand(input);
    const binding = this.readActorSelection(actorUserId, input.selectionRef, now);
    assertDelegatorBinding(binding, input.delegatorUserId);
    const commandSnapshot = canonicalCommandSnapshot(
      "historical_wage_takeover.scope.create",
      actorUserId,
      binding,
      input
    );
    const commandFingerprint = fingerprint(commandSnapshot);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(
        tx,
        actorUserId,
        input.delegatorUserId,
        "prepare",
        `selection:${binding.selectionFingerprint}`,
        now
      );
      await this.lock(tx, `pol219:idempotency:${input.idempotencyKey}`);
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;

      // The legacy graph and A closure are fully re-read before the first
      // scope/manifest/receipt/audit write. A drift can only fall to C; it
      // cannot leave a prepared A canonical target behind.
      const legacy = await this.resolveLegacyClosure(tx, binding);
      const plan = await this.preflightPlan(tx, binding, legacy);
      if (
        binding.grade === "A" &&
        plan.grade === "A" &&
        (
          !binding.sourceVersionId ||
          !binding.sourceFingerprint ||
          !binding.sourceClosureFingerprint ||
          !plan.materializationAuthorityReadSet ||
          binding.selectionFingerprint !== aSelectionFingerprint(
            binding.sourceVersionId,
            binding.sourceFingerprint,
            binding.sourceClosureFingerprint,
            legacy,
            plan.materializationAuthorityReadSet,
            plan.priorVersionEligibilityProof?.priorCanonicalGraphFingerprint ?? null
          )
        )
      ) {
        throw new ConflictException("A级权威来源已漂移、冲突或不再完整，必须零写入失败并重新获取 selectionRef");
      }
      if (binding.grade === "A" && plan.grade !== "A") {
        throw new ConflictException("A级权威来源已漂移、冲突或不再完整，必须零写入失败并重新获取 selectionRef");
      }
      if (
        binding.grade === "B" &&
        plan.grade === "B" &&
        (
          !binding.summaryFingerprint ||
          !plan.summaryAuthority ||
          binding.selectionFingerprint !== bSelectionFingerprint(
            binding.summaryFingerprint,
            legacy,
            plan.summaryAuthority.priorLineageProof
          )
        )
      ) {
        throw new ConflictException("B级汇总权威已漂移、冲突或不再完整，必须零写入失败并重新获取 selectionRef");
      }
      if (binding.grade === "B" && plan.grade !== "B") {
        throw new ConflictException("B级汇总权威已漂移、冲突或不再完整，必须零写入失败并重新获取 selectionRef");
      }
      const scopePermissionFingerprint = permissionScopeFingerprint(binding);
      const reservedScopeId = randomUUID();
      const reservedWageStatementVersionId = plan.grade === "A" ? randomUUID() : undefined;
      const finalizedSummary = plan.grade === "B" && plan.summaryAuthority
        ? finalizeHistoricalSummaryAuthority(
            reservedScopeId,
            plan,
            legacy,
            identity,
            scopePermissionFingerprint
          )
        : undefined;
      if (plan.summaryAuthority && finalizedSummary) {
        plan.summaryAuthority.authorityFingerprint = finalizedSummary.fingerprint;
        for (const line of finalizedSummary.lines) {
          line.planned.finalTargetFingerprint = line.targetFingerprint;
        }
      }
      const baselineSha = candidateBaselineSha();
      const readSetFingerprint = fingerprint({
        binding: selectionSourceReadSet(binding),
        legacy: legacy.map((item) => legacyReadSet(item)),
        plan: planReadSet(plan)
      });
      const scope = await tx.operatingTakeoverAtomicScopeVersion.create({
        data: {
          id: reservedScopeId,
          scopeKind: "historical_wage",
          authoritySourceRef: plan.sourceVersionId ?? `legacy:${binding.selectionFingerprint}`,
          authoritySourceFingerprint: plan.sourceFingerprint ?? plan.negativeAuthorityFrontierFingerprint ?? fingerprint(legacy.map(legacyReadSet)),
          sourceClosureFingerprint: plan.sourceClosureFingerprint ?? fingerprint(legacy.map(legacyReadSet)),
          ...(reservedWageStatementVersionId ? { reservedWageStatementVersionId } : {}),
          candidateBaselineSha: baselineSha,
          permissionSnapshotFingerprint: scopePermissionFingerprint,
          readSetFingerprint,
          createdByUserId: identity.actualUserId
        }
      });
      if (reservedWageStatementVersionId) {
        const reservation = plan.wageReservation;
        if (!reservation) throw new ConflictException("A级历史工资接管缺少工资版本规划，不能预留正式版本");
        await tx.wageTakeoverWageStatementReservation.create({
          data: {
            id: reservedWageStatementVersionId,
            atomicScopeVersionId: scope.id,
            targetWageStatementId: reservation.targetWageStatementId,
            expectedCurrentRevision: reservation.expectedCurrentRevision,
            reservedRevision: reservation.reservedRevision,
            versionKind: reservation.versionKind,
            priorConfirmedVersionId: reservation.priorConfirmedVersionId,
            priorSourceVersionId: reservation.priorSourceVersionId,
            sourceDeltaFingerprint: reservation.sourceDeltaFingerprint,
            canonicalRootClosureFingerprint: reservation.canonicalRootClosureFingerprint
          }
        });
      }

      let summaryAuthorityId: string | undefined;
      if (plan.grade === "B" && plan.summaryAuthority && finalizedSummary) {
        await tx.historicalWageSummaryAuthorityVersion.create({
          data: {
            id: finalizedSummary.id,
            atomicScopeVersionId: scope.id,
            summaryBucketKey: summaryBucketKey(plan.summaryAuthority),
            employmentCompanyId: plan.summaryAuthority.employmentCompanyId,
            projectId: plan.summaryAuthority.projectId,
            wageMonth: plan.summaryAuthority.wageMonth,
            catalogVersion: plan.summaryAuthority.catalogVersion,
            positionCategoryCode: plan.summaryAuthority.positionCategoryCode,
            positionCategoryLabelSnapshot: plan.summaryAuthority.positionCategoryLabel,
            evidenceCoordinate: jsonInput(plan.summaryAuthority.evidenceCoordinate),
            sourceSchemaVersion: 1,
            sourcePayload: jsonInput(plan.summaryAuthority.snapshot.sourceVersionPayload),
            sourceVersionFingerprint: plan.summaryAuthority.sourceVersionFingerprint,
            authoritySchemaVersion: 1,
            authorityPayload: jsonInput(finalizedSummary.payload),
            authorityFingerprint: finalizedSummary.fingerprint,
            assignedWageExclusionSchemaVersion: 1,
            assignedWageExclusionPayload: jsonInput({
              schemaVersion: 1,
              assignedWageExclusions: plan.summaryAuthority.snapshot.assignedWageExclusions
            }),
            assignedWageExclusionSetFingerprint: plan.summaryAuthority.snapshot.assignedWageExclusionSetFingerprint,
            scopeCreatorIdentitySnapshot: identity.actorSetSnapshot,
            permissionScopeFingerprint: scopePermissionFingerprint,
            revision: plan.summaryAuthority.revision,
            supersedesVersionId: plan.summaryAuthority.supersedesVersionId,
            lineageRootAuthorityVersionId: plan.summaryAuthority.lineageRootAuthorityVersionId,
            sourceDeltaFingerprint: plan.summaryAuthority.sourceDeltaFingerprint,
            rootClosureFingerprint: plan.summaryAuthority.rootClosureFingerprint,
            declaredByUserId: identity.actualUserId,
            declaredDelegatorUserId: identity.delegatorUserId
          }
        });
        summaryAuthorityId = finalizedSummary.id;
        for (const finalizedLine of finalizedSummary.lines) {
          const line = finalizedLine.planned;
          await tx.historicalWageSummaryAuthorityCreditorLine.create({
            data: {
              id: finalizedLine.id,
              atomicScopeVersionId: scope.id,
              authorityVersionId: finalizedSummary.id,
              revision: plan.summaryAuthority.revision,
              stableBucketKey: line.stableBucketKey,
              stableBucketKeyFingerprint: stableBucketKeyFingerprint(line.stableBucketKey),
              employmentCompanyId: plan.summaryAuthority.employmentCompanyId,
              projectId: plan.summaryAuthority.projectId,
              wageMonth: plan.summaryAuthority.wageMonth,
              positionCategoryCode: plan.summaryAuthority.positionCategoryCode,
              wageCreditorCategoryCode: line.creditorCategoryCode,
              wageCreditorCategoryLabelSnapshot: line.creditorCategoryLabel,
              creditorIdentityKind: line.creditorIdentityKind,
              creditorPartyVersionId: line.creditorPartyVersionId,
              controlledScopeCode: line.controlledScopeCode,
              controlledScopeDescription: line.controlledScopeDescription,
              controlledScopeEvidenceCoordinate: line.controlledScopeEvidenceCoordinate
                ? jsonInput(line.controlledScopeEvidenceCoordinate)
                : undefined,
              currencyCode: "CNY",
              debtStatus: line.debtStatus,
              grossDebtCents: line.grossDebtCents,
              historicallySettledCents: line.historicallySettledCents,
              outstandingBalanceCents: line.outstandingBalanceCents,
              isTombstone: line.grossDebtCents === 0n,
              targetKind: line.target.kind,
              targetSchemaVersion: 1,
              targetBusinessKey: line.targetBusinessKey,
              targetPayload: jsonInput(finalizedLine.targetPayload),
              targetFingerprint: finalizedLine.targetFingerprint,
              signedGrossDeltaCents: line.signedGrossDeltaCents,
              signedHistoricallySettledDeltaCents: line.signedHistoricallySettledDeltaCents,
              signedOutstandingBalanceDeltaCents: line.signedOutstandingBalanceDeltaCents,
              deltaFingerprint: line.deltaFingerprint,
              rootCreditorLineId: line.rootCreditorLineId,
              rootPayableRefId: line.rootPayableRefId
            }
          });
        }
      }

      const manifests = new Map<string, { id: string; rows: Array<{ id: string; legacy: ResolvedLegacy }> }>();
      for (const projectId of plan.projectIds ?? sortedUnique(legacy.map((item) => item.projectId))) {
        const manifest = await tx.operatingTakeoverManifestVersion.create({
          data: {
            id: randomUUID(),
            projectId,
            atomicScopeVersionId: scope.id,
            adapterKind: "historical_wage",
            manifestNo: `OT219-${scope.id.slice(0, 8)}-${projectId.slice(0, 8)}`,
            version: 1,
            status: "prepared",
            sourceScopeFingerprint: fingerprint(legacy.filter((item) => item.projectId === projectId).map(legacyReadSet)),
            mapperName: MAPPER_NAME,
            mapperVersion: MAPPER_VERSION,
            schemaVersion: SCHEMA_VERSION,
            candidateBaselineSha: baselineSha,
            permissionSnapshotFingerprint: scopePermissionFingerprint,
            readSetFingerprint,
            manifestFingerprint: fingerprint({ scopeId: scope.id, projectId, plan: planReadSet(plan), rows: legacy.filter((item) => item.projectId === projectId).map(legacyReadSet) }),
            createdByUserId: identity.actualUserId
          }
        });
        await tx.operatingTakeoverAtomicScopeProject.create({
          data: { id: randomUUID(), atomicScopeVersionId: scope.id, projectId, manifestVersionId: manifest.id }
        });
        manifests.set(projectId, { id: manifest.id, rows: [] });
      }

      const mappings: Array<{ id: string; legacy: ResolvedLegacy; manifestId: string }> = [];
      for (const [index, item] of legacy.entries()) {
        const child = manifests.get(item.projectId);
        if (!child) throw new ConflictException("历史工资接管缺少项目子 manifest，不能继续");
        const isFormal = plan.grade === "A" || plan.grade === "B";
        const mapping = await tx.operatingTakeoverRowMapping.create({
          data: {
            id: randomUUID(),
            manifestVersionId: child.id,
            projectId: item.projectId,
            adapterKind: "historical_wage",
            rowNo: index + 1,
            sourceType: item.sourceType,
            sourceBusinessId: item.sourceBusinessId,
            sourceVersion: item.sourceVersion,
            sourceFingerprint: item.sourceFingerprint,
            sourceCoordinate: `${item.sourceType}:${item.sourceBusinessId}:${item.sourceVersion}`,
            normalizedRowHash: fingerprint(legacyReadSet(item)),
            amountCents: item.amountCents,
            evidenceLevel: plan.grade,
            entryKind: isFormal ? "formal" : "gap",
            // C has exactly one persistence meaning: an append-only gap. A
            // conflict reason is frozen in its read-set snapshot, but it never
            // becomes a disguised formal/blocked payable target.
            mappingDecision: isFormal ? "FORMAL" : "GAP",
            conflictGroupKey: wageConflictGroupKey(item.projectId, plan),
            adjustmentTargetRef: item.adjustsFactId,
            sourceDiscriminator: plan.grade === "A" ? "wage_statement_version" : plan.grade === "B" ? "historical_wage_summary" : null,
            wageApprovedSourceVersionId: plan.grade === "A" ? plan.sourceVersionId : null,
            wageStatementReservationId: plan.grade === "A" ? reservedWageStatementVersionId : null,
            historicalWageSummaryAuthorityVersionId: plan.grade === "B" ? summaryAuthorityId : null,
            authoritySnapshot: jsonInput(plan.summaryAuthority ?? {}),
            legacySourceSnapshot: jsonInput({
              ...legacyReadSet(item),
              costImpactSnapshot: item.costImpactSnapshot,
              costImpactFingerprint: historicalWageLegacyImpactFingerprint(item, "confirmed_cost", item.costImpactSnapshot),
              payableImpactSnapshot: item.payableImpactSnapshot,
              payableImpactFingerprint: historicalWageLegacyImpactFingerprint(
                item,
                item.direction === "increase" ? "payable_increase" : "payable_decrease",
                item.payableImpactSnapshot
              ),
              businessReason: input.businessReason.trim(),
              evidenceRefs: normalizedEvidenceRefs(input.evidenceRefs)
            }),
            readSetSnapshot: jsonInput({ readSetFingerprint, plan: planReadSet(plan), legacy: legacyReadSet(item) }),
            mappingFingerprint: fingerprint({ scopeId: scope.id, projectId: item.projectId, plan: planReadSet(plan), legacy: legacyReadSet(item) })
          }
        });
        child.rows.push({ id: mapping.id, legacy: item });
        mappings.push({ id: mapping.id, legacy: item, manifestId: child.id });
      }

      const result = {
        atomicScopeVersionId: scope.id,
        grade: plan.grade,
        status: "prepared",
        projectCount: manifests.size,
        rowCount: mappings.length,
        commandSelectionRef: this.selectionRefs.issue({ ...binding, atomicScopeVersionId: scope.id }, now)
      };
      const receipt = await this.writeScopeReceipt(
        tx,
        scope.id,
        input.idempotencyKey,
        "historical_wage_takeover.scope.create",
        input.expectedRevision,
        identity,
        scopePermissionFingerprint,
        commandSnapshot,
        "prepared",
        result,
        mappings
      );
      if (summaryAuthorityId) {
        // This is the declarer's first immutable attestation. A later
        // `scope.attest` must be a different effective identity before B can
        // activate; database triggers bind each receipt/attestation to one tx.
        await tx.historicalWageSummaryAuthorityAttestation.create({
          data: {
            id: randomUUID(),
            atomicScopeVersionId: scope.id,
            authorityVersionId: summaryAuthorityId,
            summaryBucketKey: plan.summaryAuthority ? summaryBucketKey(plan.summaryAuthority) : "",
            receiptId: receipt.id,
            actorUserId: identity.actualUserId,
            delegatorUserId: identity.delegatorUserId,
            permissionScopeFingerprint: scopePermissionFingerprint
          }
        });
      }
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.create",
        businessType: "operating_takeover_atomic_scope",
        businessId: scope.id,
        metadata: jsonInput({ grade: plan.grade, projectCount: manifests.size, rowCount: mappings.length, readSetFingerprint })
      });
      return result;
    });
  }

  /**
   * A B declaration, its independent reviewer, and the later activator can
   * never share an actor-bound token. This performs no business write: after
   * transaction-scoped authorization and full read-set revalidation, it
   * returns a fresh short-lived ref whose only changed data is effective
   * identity. It deliberately accepts no project, month, person, amount, or
   * source discriminator from the client.
   */
  async issueScopedCommandSelection(
    actorUserId: string,
    input: HistoricalWageTakeoverSelectionRenewal,
    now = new Date()
  ) {
    assertSelectionRenewal(input);
    const sourceBinding = this.selectionRefs.read(input.selectionRef, now);
    if (!sourceBinding?.atomicScopeVersionId) {
      throw new ForbiddenException("历史工资接管范围引用无效、过期或不能续签");
    }
    const commandSelectionRef = this.selectionRefs.issueScopedForActor(
      input.selectionRef,
      actorUserId,
      input.delegatorUserId,
      now
    );
    const binding = this.readScopedSelection(actorUserId, commandSelectionRef, now);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(
        tx,
        actorUserId,
        input.delegatorUserId,
        "prepare",
        binding.atomicScopeVersionId!,
        now
      );
      const context = await this.loadAndRevalidateScope(tx, binding);
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.selection_ref.reissue",
        businessType: "operating_takeover_atomic_scope",
        businessId: context.scope.id,
        metadata: jsonInput({
          delegated: Boolean(identity.delegatorUserId),
          sourceSelectionFingerprint: binding.selectionFingerprint
        })
      });
      return {
        atomicScopeVersionId: context.scope.id,
        commandSelectionRef
      };
    });
  }

  /**
   * Dry-run apply is deliberately receipt-only. It re-reads the entire scope
   * under Serializable isolation but does not call WageStatementModule and
   * cannot change a canonical payable balance.
   */
  async apply(actorUserId: string, input: HistoricalWageTakeoverCommand, now = new Date()) {
    assertScopedCommand(input);
    const binding = this.readScopedSelection(actorUserId, input.selectionRef, now);
    assertDelegatorBinding(binding, input.delegatorUserId);
    const commandSnapshot = canonicalCommandSnapshot("historical_wage_takeover.scope.apply", actorUserId, binding, input);
    const commandFingerprint = fingerprint(commandSnapshot);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(tx, actorUserId, input.delegatorUserId, "prepare", binding.atomicScopeVersionId!, now);
      await this.lock(tx, `pol219:idempotency:${input.idempotencyKey}`);
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const context = await this.loadAndRevalidateScope(tx, binding);
      this.assertRevision(context, input.expectedRevision);
      this.assertNotActivated(context);
      const result = {
        atomicScopeVersionId: context.scope.id,
        grade: context.plan.grade,
        status: "inactive_applied",
        revision: context.receipts.length + 1,
        rowCount: context.mappings.length
      };
      await this.writeScopeReceipt(
        tx, context.scope.id, input.idempotencyKey, "historical_wage_takeover.scope.apply", input.expectedRevision,
        identity, context.scope.permissionSnapshotFingerprint, commandSnapshot, "inactive_applied", result, context.mappings
      );
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.apply",
        businessType: "operating_takeover_atomic_scope",
        businessId: context.scope.id,
        metadata: jsonInput({ grade: context.plan.grade, inactive: true, rowCount: context.mappings.length })
      });
      return result;
    });
  }

  /** B requires an immutable declaration plus one distinct effective reviewer. */
  async attest(actorUserId: string, input: HistoricalWageTakeoverCommand, now = new Date()) {
    assertScopedCommand(input);
    const binding = this.readScopedSelection(actorUserId, input.selectionRef, now);
    assertDelegatorBinding(binding, input.delegatorUserId);
    const commandSnapshot = canonicalCommandSnapshot("historical_wage_takeover.scope.attest", actorUserId, binding, input);
    const commandFingerprint = fingerprint(commandSnapshot);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(tx, actorUserId, input.delegatorUserId, "attest", binding.atomicScopeVersionId!, now);
      await this.lock(tx, `pol219:idempotency:${input.idempotencyKey}`);
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const context = await this.loadAndRevalidateScope(tx, binding);
      this.assertRevision(context, input.expectedRevision);
      this.assertInactiveApply(context);
      if (context.plan.grade !== "B" || context.authorities.length !== 1) {
        throw new ConflictException("只有已冻结的 B 级历史工资汇总权威可以进入双人确认");
      }
      const authority = context.authorities[0]!;
      if (authority.attestations.length !== 1) {
        throw new ConflictException("B级历史工资汇总必须恰有一份声明，不能重复或跳过复核");
      }
      assertDisjointEffectiveIdentities(identity.actorIds, authority.attestations.map((attestation) => [attestation.actorUserId, attestation.delegatorUserId]));
      const result = {
        atomicScopeVersionId: context.scope.id,
        grade: "B" as const,
        status: "attested",
        revision: context.receipts.length + 1,
        authorityVersionId: authority.id
      };
      const receipt = await this.writeScopeReceipt(
        tx, context.scope.id, input.idempotencyKey, "historical_wage_takeover.scope.attest", input.expectedRevision,
        identity, context.scope.permissionSnapshotFingerprint, commandSnapshot, "attested", result, context.mappings
      );
      await tx.historicalWageSummaryAuthorityAttestation.create({
        data: {
          id: randomUUID(),
          atomicScopeVersionId: context.scope.id,
          authorityVersionId: authority.id,
          summaryBucketKey: authority.summaryBucketKey,
          receiptId: receipt.id,
          actorUserId: identity.actualUserId,
          delegatorUserId: identity.delegatorUserId,
          permissionScopeFingerprint: context.scope.permissionSnapshotFingerprint
        }
      });
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.attest",
        businessType: "historical_wage_summary_authority_version",
        businessId: authority.id,
        metadata: jsonInput({ atomicScopeVersionId: context.scope.id, summaryBucketKey: authority.summaryBucketKey })
      });
      return result;
    });
  }

  /**
   * The only formalization path. Every source, authority, #214 line set and
   * baseline is revalidated before the first canonical/envelope/gap write.
   */
  async activate(actorUserId: string, input: HistoricalWageTakeoverCommand, now = new Date()) {
    assertScopedCommand(input);
    const binding = this.readScopedSelection(actorUserId, input.selectionRef, now);
    assertDelegatorBinding(binding, input.delegatorUserId);
    const commandSnapshot = canonicalCommandSnapshot("historical_wage_takeover.scope.activate", actorUserId, binding, input);
    const commandFingerprint = fingerprint(commandSnapshot);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(tx, actorUserId, input.delegatorUserId, "activate", binding.atomicScopeVersionId!, now);
      await this.lock(tx, `pol219:idempotency:${input.idempotencyKey}`);
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const context = await this.loadAndRevalidateScope(tx, binding);
      this.assertRevision(context, input.expectedRevision);
      this.assertInactiveApply(context);
      this.assertNotActivated(context);
      this.assertActivationSeparation(context, identity);

      const targets = new Map<string, TakeoverTarget>();
      if (context.plan.grade === "A") {
        const reservation = context.scope.wageStatementReservation;
        if (!reservation) throw new ConflictException("A级历史工资接管缺少服务端预留版本");
        const confirmation = await this.wageStatements.confirmHistoricalTakeoverInTransaction(tx, {
          atomicScopeVersionId: context.scope.id,
          reservedVersionId: requiredText(reservation.id, "A级历史工资接管缺少服务端预留版本 ID"),
          sourceVersionId: requiredText(context.plan.sourceVersionId, "A级历史工资接管缺少权威来源版本"),
          sourceFingerprint: requiredText(context.plan.sourceFingerprint, "A级历史工资接管缺少权威来源指纹"),
          expectedProjectIds: sortedUnique(context.scope.projects.map((project) => project.projectId)),
          sourceClosureFingerprint: requiredText(context.plan.sourceClosureFingerprint, "A级历史工资接管缺少完整项目闭合指纹"),
          targetWageStatementId: reservation.targetWageStatementId,
          expectedCurrentRevision: reservation.expectedCurrentRevision,
          reservedRevision: reservation.reservedRevision,
          versionKind: reservation.versionKind as "base" | "correction" | "reversal",
          priorConfirmedVersionId: reservation.priorConfirmedVersionId,
          priorSourceVersionId: reservation.priorSourceVersionId,
          sourceDeltaFingerprint: reservation.sourceDeltaFingerprint,
          canonicalRootClosureFingerprint: reservation.canonicalRootClosureFingerprint,
          actorUserId: identity.actualUserId
        });
        if (confirmation.versionId !== context.scope.wageStatementReservation?.id) {
          throw new ConflictException("A级历史工资确认结果未使用当前 scope 的 exact reservation UUID");
        }
        for (const mapping of context.mappings) {
          targets.set(mapping.id, await this.materializeAEnvelope(tx, context.scope.id, mapping, confirmation.versionId, confirmation.decision, identity.actualUserId));
        }
      } else if (context.plan.grade === "B") {
        const authority = context.authorities[0];
        if (!authority || authority.attestations.length !== 2) {
          throw new ConflictException("B级历史工资汇总缺少两名不同有效身份的声明与复核，禁止激活");
        }
        const target = await this.materializeBSummaryRefs(tx, context, authority, identity.actualUserId);
        for (const mapping of context.mappings) targets.set(mapping.id, target);
      } else {
        for (const mapping of context.mappings) {
          targets.set(mapping.id, await this.materializeCGap(tx, context, mapping, identity.actualUserId));
        }
      }

      for (const mapping of context.mappings) {
        const target = targets.get(mapping.id);
        if (!target) throw new ConflictException("历史工资接管缺少可审计的正式目标，禁止激活");
        const bridge = await this.ensureLegacyBridge(tx, mapping, target, identity.actualUserId);
        targets.set(mapping.id, bridge);
      }
      const result = {
        atomicScopeVersionId: context.scope.id,
        grade: context.plan.grade,
        status: "activated",
        revision: context.receipts.length + 1,
        rows: context.mappings.map((mapping) => ({
          projectId: mapping.projectId,
          decision: targets.get(mapping.id)!.decision,
          targetKind: targets.get(mapping.id)!.targetKind,
          targetRef: targets.get(mapping.id)!.targetRef
        }))
      };
      await this.writeScopeReceipt(
        tx, context.scope.id, input.idempotencyKey, "historical_wage_takeover.scope.activate", input.expectedRevision,
        identity, context.scope.permissionSnapshotFingerprint, commandSnapshot, "activated", result, context.mappings,
        {
          lineTargets: targets,
          ...(context.plan.priorVersionEligibilityProof
            ? { causesReceiptId: context.plan.priorVersionEligibilityProof.activationReceiptId }
            : {})
        }
      );
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.activate",
        businessType: "operating_takeover_atomic_scope",
        businessId: context.scope.id,
        metadata: jsonInput({ grade: context.plan.grade, targets: result.rows })
      });
      return result;
    });
  }

  /**
   * This is eligibility compensation, never a wage correction or a reversal
   * of pre-existing project_wage facts/impacts. Downstream consumers must be
   * absent (or reverse themselves first) before the link can be revoked.
   */
  async compensate(actorUserId: string, input: HistoricalWageTakeoverCommand, now = new Date()) {
    assertScopedCommand(input);
    const binding = this.readScopedSelection(actorUserId, input.selectionRef, now);
    assertDelegatorBinding(binding, input.delegatorUserId);
    const commandSnapshot = canonicalCommandSnapshot("historical_wage_takeover.scope.compensate", actorUserId, binding, input);
    const commandFingerprint = fingerprint(commandSnapshot);
    return this.serializable(async (tx) => {
      const identity = await this.resolveIdentityInTransaction(tx, actorUserId, input.delegatorUserId, "compensate", binding.atomicScopeVersionId!, now);
      await this.lock(tx, `pol219:idempotency:${input.idempotencyKey}`);
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const context = await this.loadAndRevalidateScope(tx, binding);
      this.assertRevision(context, input.expectedRevision);
      const activation = context.receipts.find((receipt) => receipt.action === "historical_wage_takeover.scope.activate" && receipt.status === "activated");
      if (!activation) throw new ConflictException("历史工资接管尚未激活，不能执行补偿式资格回退");
      assertDisjointEffectiveIdentities(
        identity.actorIds,
        [[activation.actorUserId, activation.delegatorUserId]],
        "历史工资接管职责分离失败：激活人与补偿人的有效身份不得重叠"
      );
      if (context.receipts.some((receipt) => receipt.action === "historical_wage_takeover.scope.compensate")) {
        throw new ConflictException("历史工资接管资格回退已经登记，不能重复执行");
      }
      await this.assertNoDownstreamConsumption(tx, context);
      const activationLinesByMappingId = new Map(
        activation.lines.map((line) => [line.rowMappingId, line] as const)
      );
      if (
        activationLinesByMappingId.size !== context.mappings.length ||
        context.mappings.some((mapping) => {
          const line = activationLinesByMappingId.get(mapping.id);
          return !line ||
            line.projectId !== mapping.projectId ||
            line.amountCents !== mapping.legacy.amountCents ||
            !Number.isInteger(line.causalOrdinal) ||
            line.causalOrdinal < 1;
        })
      ) {
        throw new ConflictException("历史工资接管 activation line 因果闭合已漂移，禁止补偿");
      }
      const result = {
        atomicScopeVersionId: context.scope.id,
        grade: context.plan.grade,
        status: "compensated",
        revision: context.receipts.length + 1,
        causesReceiptId: activation.id
      };
      const receipt = await this.writeScopeReceipt(
        tx, context.scope.id, input.idempotencyKey, "historical_wage_takeover.scope.compensate", input.expectedRevision,
        identity, context.scope.permissionSnapshotFingerprint, commandSnapshot, "compensated", result, context.mappings,
        { causesReceiptId: activation.id, causeLinesByMappingId: activationLinesByMappingId }
      );
      await this.writeEligibilityRevocations(tx, context, receipt.id, input.businessReason.trim());
      await this.audit.record(tx, {
        actorUserId: identity.actualUserId,
        action: "operating_takeover.historical_wage.scope.compensate",
        businessType: "operating_takeover_atomic_scope",
        businessId: context.scope.id,
        metadata: jsonInput({ causesReceiptId: activation.id, rollbackKind: "eligibility_only" })
      });
      return result;
    });
  }

  private readActorSelection(actorUserId: string, selectionRef: string, now: Date) {
    const binding = this.selectionRefs.read(selectionRef, now);
    if (!binding || binding.actorUserId !== actorUserId || binding.atomicScopeVersionId) {
      throw new ForbiddenException("历史工资接管候选无效、过期或不属于当前账号");
    }
    return binding;
  }

  private readScopedSelection(actorUserId: string, selectionRef: string, now: Date) {
    const binding = this.selectionRefs.read(selectionRef, now);
    if (!binding || binding.actorUserId !== actorUserId || !binding.atomicScopeVersionId) {
      throw new ForbiddenException("历史工资接管范围引用无效、过期或不属于当前账号");
    }
    return binding;
  }

  private async loadAndRevalidateScope(tx: Tx, binding: HistoricalWageSelectionBinding) {
    const scopeId = requiredText(binding.atomicScopeVersionId, "历史工资接管范围引用缺失");
    await this.lock(tx, `pol219:scope:${scopeId}`);
    const scope = await tx.operatingTakeoverAtomicScopeVersion.findUnique({
      where: { id: scopeId },
      include: {
        projects: {
          include: {
            manifest: { include: { rows: { orderBy: { rowNo: "asc" } } } }
          }
        },
        historicalSummaryAuthorities: {
          include: {
            attestations: { orderBy: { createdAt: "asc" } },
            payableRefs: { orderBy: { wageCreditorCategoryCode: "asc" } },
            creditorLines: { orderBy: { wageCreditorCategoryCode: "asc" } }
          }
        },
        wageStatementReservation: true,
        receipts: { include: { lines: { orderBy: { lineNo: "asc" } } }, orderBy: { createdAt: "asc" } }
      }
    });
    if (!scope || scope.scopeKind !== "historical_wage") {
      throw new ConflictException("历史工资接管原子范围不存在或类型不匹配");
    }
    const activationReceipts = scope.receipts.filter(
      (receipt) => receipt.action === "historical_wage_takeover.scope.activate" && receipt.status === "activated"
    );
    if (activationReceipts.length) {
      if (activationReceipts.length !== 1) {
        throw new ConflictException("历史工资接管冻结范围存在多个 activation receipt，必须失败关闭");
      }
      if (scope.permissionSnapshotFingerprint !== permissionScopeFingerprint(binding)) {
        throw new ConflictException("历史工资接管冻结范围与当前服务端 selectionRef 的权限范围不一致");
      }
      const frozenRows = scope.projects.flatMap((project) =>
        project.manifest.rows.map((row) => ({ project, row }))
      );
      if (!frozenRows.length) {
        throw new ConflictException("历史工资接管冻结范围缺少项目子 manifest 行");
      }
      const firstReadSet = jsonRecord(frozenRows[0]!.row.readSetSnapshot, "历史工资接管冻结 read-set 无效");
      const frozenPlanReadSet = jsonRecord(firstReadSet.plan, "历史工资接管冻结 plan read-set 无效");
      const frozenGrade = frozenPlanReadSet.grade;
      if (frozenGrade !== "A" && frozenGrade !== "B" && frozenGrade !== "C") {
        throw new ConflictException("历史工资接管冻结等级无效");
      }
      const mappings: ScopeMapping[] = frozenRows.map(({ project, row }) => {
        const readSet = jsonRecord(row.readSetSnapshot, "历史工资接管冻结 mapping read-set 无效");
        const planReadSetValue = jsonRecord(readSet.plan, "历史工资接管冻结 mapping plan 无效");
        const legacyReadSetValue = jsonRecord(readSet.legacy, "历史工资接管冻结 legacy read-set 无效");
        if (fingerprint(planReadSetValue) !== fingerprint(frozenPlanReadSet)) {
          throw new ConflictException("历史工资接管项目子 manifest 的冻结 plan 不一致");
        }
        const item = resolvedLegacyFromFrozenReadSet(legacyReadSetValue);
        const expectedDecision = frozenGrade === "C" ? "GAP" : "FORMAL";
        if (
          project.projectId !== row.projectId ||
          row.adapterKind !== "historical_wage" ||
          row.evidenceLevel !== frozenGrade ||
          row.mappingDecision !== expectedDecision ||
          row.sourceType !== item.sourceType ||
          row.sourceBusinessId !== item.sourceBusinessId ||
          row.sourceVersion !== item.sourceVersion ||
          row.sourceFingerprint !== item.sourceFingerprint ||
          row.amountCents !== item.amountCents ||
          row.mappingFingerprint !== fingerprint({
            scopeId: scope.id,
            projectId: item.projectId,
            plan: frozenPlanReadSet,
            legacy: legacyReadSetValue
          })
        ) {
          throw new ConflictException("历史工资接管冻结 mapping、来源坐标或指纹不一致");
        }
        return {
          id: row.id,
          manifestId: project.manifest.id,
          projectId: row.projectId,
          mappingDecision: row.mappingDecision,
          evidenceLevel: row.evidenceLevel,
          sourceDiscriminator: row.sourceDiscriminator,
          legacy: item
        };
      }).sort((left, right) => legacyCoordinateKey(left.legacy).localeCompare(legacyCoordinateKey(right.legacy)));
      const legacy = mappings.map((mapping) => mapping.legacy);
      if (
        new Set(mappings.map((mapping) => mapping.id)).size !== mappings.length ||
        !sameStrings(
          binding.legacyCoordinates.map((coordinate) => `${coordinate.projectId}:${coordinate.sourceType}:${coordinate.sourceBusinessId}:${coordinate.sourceVersion}:${coordinate.sourceFingerprint}`).sort(),
          legacy.map((item) => `${item.projectId}:${item.sourceType}:${item.sourceBusinessId}:${item.sourceVersion}:${item.sourceFingerprint}`).sort()
        ) ||
        scope.readSetFingerprint !== fingerprint({
          binding: selectionSourceReadSet(binding),
          legacy: legacy.map((item) => legacyReadSet(item)),
          plan: frozenPlanReadSet
        })
      ) {
        throw new ConflictException("历史工资接管冻结 scope 与 selectionRef 或 read-set 不一致");
      }
      const activation = activationReceipts[0]!;
      if (
        activation.lines.length !== mappings.length ||
        new Set(activation.lines.map((line) => line.rowMappingId)).size !== mappings.length ||
        activation.lines.some((line) =>
          !mappings.some((mapping) => mapping.id === line.rowMappingId) ||
          line.decision !== (frozenGrade === "C" ? "GAP" : "FORMAL") ||
          !line.targetKind ||
          !line.targetRef
        )
      ) {
        throw new ConflictException("历史工资接管 activation receipt 与冻结 mapping/target 不闭合");
      }
      return {
        scope,
        mappings,
        legacy,
        plan: { grade: frozenGrade } as ScopePlan,
        authorities: scope.historicalSummaryAuthorities,
        receipts: scope.receipts
      };
    }
    if (scope.candidateBaselineSha.toLowerCase() !== candidateBaselineSha()) {
      throw new ConflictException("历史工资接管候选基线已漂移，必须零写入失败");
    }
    const legacy = await this.resolveLegacyClosure(tx, binding);
    const plan = await this.preflightPlan(
      tx,
      binding,
      legacy,
      scope.wageStatementReservation?.targetWageStatementId,
      scope.id
    );
    let finalizedSummary: FinalizedHistoricalSummaryAuthority | undefined;
    if (plan.grade === "B") {
      if (scope.historicalSummaryAuthorities.length !== 1 || !plan.summaryAuthority || !plan.summary?.length) {
        throw new ConflictException("B级历史工资汇总权威范围不完整或不唯一");
      }
      const authority = scope.historicalSummaryAuthorities[0]!;
      const creatorIdentity = frozenScopeCreatorIdentity(authority.scopeCreatorIdentitySnapshot);
      const createReceipts = scope.receipts.filter(
        (receipt) => receipt.action === "historical_wage_takeover.scope.create" && receipt.status === "prepared"
      );
      if (
        createReceipts.length !== 1 ||
        scope.createdByUserId !== creatorIdentity.actualUserId ||
        authority.declaredByUserId !== creatorIdentity.actualUserId ||
        (authority.declaredDelegatorUserId ?? null) !== (creatorIdentity.delegatorUserId ?? null) ||
        createReceipts[0]!.actorUserId !== creatorIdentity.actualUserId ||
        (createReceipts[0]!.delegatorUserId ?? null) !== (creatorIdentity.delegatorUserId ?? null) ||
        strictJcs(createReceipts[0]!.actorSetSnapshot) !== strictJcs(creatorIdentity.actorSetSnapshot)
      ) {
        throw new ConflictException("B级历史工资 scope creator、声明人或 create receipt 身份闭合已漂移");
      }
      const creditorLineIds = new Map<string, string>();
      const balanceTargetIds = new Map<string, string>();
      for (const line of authority.creditorLines) {
        if (creditorLineIds.has(line.stableBucketKey)) {
          throw new ConflictException("B级历史工资 creditor line 稳定键重复");
        }
        creditorLineIds.set(line.stableBucketKey, line.id);
        if (line.targetKind === "historical_wage_balance_reconciliation_version") {
          const targetPayload = jsonRecord(line.targetPayload, "B级历史工资余额 target payload 无效");
          balanceTargetIds.set(
            line.stableBucketKey,
            requiredText(
              typeof targetPayload.reservedTargetId === "string" ? targetPayload.reservedTargetId : undefined,
              "B级历史工资余额 target 预留 ID 缺失"
            )
          );
        }
      }
      finalizedSummary = finalizeHistoricalSummaryAuthority(
        scope.id,
        plan,
        legacy,
        creatorIdentity,
        scope.permissionSnapshotFingerprint,
        { authorityVersionId: authority.id, creditorLineIds, balanceTargetIds }
      );
      plan.summaryAuthority.authorityFingerprint = finalizedSummary.fingerprint;
      for (const line of finalizedSummary.lines) {
        line.planned.finalTargetFingerprint = line.targetFingerprint;
      }
      if (
        authority.id !== finalizedSummary.id ||
        authority.atomicScopeVersionId !== scope.id ||
        authority.summaryBucketKey !== summaryBucketKey(plan.summaryAuthority) ||
        authority.employmentCompanyId !== plan.summaryAuthority.employmentCompanyId ||
        authority.projectId !== plan.summaryAuthority.projectId ||
        authority.wageMonth !== plan.summaryAuthority.wageMonth ||
        authority.catalogVersion !== plan.summaryAuthority.catalogVersion ||
        authority.positionCategoryCode !== plan.summaryAuthority.positionCategoryCode ||
        authority.positionCategoryLabelSnapshot !== plan.summaryAuthority.positionCategoryLabel ||
        strictJcs(authority.evidenceCoordinate) !== strictJcs(plan.summaryAuthority.evidenceCoordinate) ||
        authority.sourceSchemaVersion !== 1 ||
        strictJcs(authority.sourcePayload) !== strictJcs(plan.summaryAuthority.snapshot.sourceVersionPayload) ||
        authority.sourceVersionFingerprint !== plan.summaryAuthority.sourceVersionFingerprint ||
        authority.authoritySchemaVersion !== 1 ||
        strictJcs(authority.authorityPayload) !== strictJcs(finalizedSummary.payload) ||
        authority.authorityFingerprint !== finalizedSummary.fingerprint ||
        authority.assignedWageExclusionSchemaVersion !== 1 ||
        strictJcs(authority.assignedWageExclusionPayload) !== strictJcs({
          schemaVersion: 1,
          assignedWageExclusions: plan.summaryAuthority.snapshot.assignedWageExclusions
        }) ||
        authority.assignedWageExclusionSetFingerprint !== plan.summaryAuthority.snapshot.assignedWageExclusionSetFingerprint ||
        strictJcs(authority.scopeCreatorIdentitySnapshot) !== strictJcs(finalizedSummary.payload.scopeCreatorIdentity) ||
        authority.permissionScopeFingerprint !== scope.permissionSnapshotFingerprint ||
        authority.revision !== plan.summaryAuthority.revision ||
        (authority.supersedesVersionId ?? null) !== plan.summaryAuthority.supersedesVersionId ||
        (authority.lineageRootAuthorityVersionId ?? null) !== plan.summaryAuthority.lineageRootAuthorityVersionId ||
        authority.sourceDeltaFingerprint !== plan.summaryAuthority.sourceDeltaFingerprint ||
        authority.rootClosureFingerprint !== plan.summaryAuthority.rootClosureFingerprint
      ) {
        throw new ConflictException("B级历史工资持久 authority DAG、身份或来源快照已漂移");
      }
      const persistedLines = new Map(authority.creditorLines.map((line) => [line.stableBucketKey, line]));
      for (const finalizedLine of finalizedSummary.lines) {
        const planned = finalizedLine.planned;
        const persisted = persistedLines.get(planned.stableBucketKey);
        if (
          !persisted ||
          persisted.id !== finalizedLine.id ||
          persisted.atomicScopeVersionId !== scope.id ||
          persisted.authorityVersionId !== authority.id ||
          persisted.revision !== plan.summaryAuthority.revision ||
          persisted.stableBucketKeyFingerprint !== stableBucketKeyFingerprint(planned.stableBucketKey) ||
          persisted.employmentCompanyId !== plan.summaryAuthority.employmentCompanyId ||
          persisted.projectId !== plan.summaryAuthority.projectId ||
          persisted.wageMonth !== plan.summaryAuthority.wageMonth ||
          persisted.positionCategoryCode !== plan.summaryAuthority.positionCategoryCode ||
          persisted.wageCreditorCategoryCode !== planned.creditorCategoryCode ||
          persisted.wageCreditorCategoryLabelSnapshot !== planned.creditorCategoryLabel ||
          persisted.creditorIdentityKind !== planned.creditorIdentityKind ||
          (persisted.creditorPartyVersionId ?? null) !== planned.creditorPartyVersionId ||
          (persisted.controlledScopeCode ?? null) !== planned.controlledScopeCode ||
          (persisted.controlledScopeDescription ?? null) !== planned.controlledScopeDescription ||
          strictJcs(persisted.controlledScopeEvidenceCoordinate ?? null) !== strictJcs(planned.controlledScopeEvidenceCoordinate) ||
          persisted.currencyCode !== "CNY" ||
          persisted.debtStatus !== planned.debtStatus ||
          persisted.grossDebtCents !== planned.grossDebtCents ||
          persisted.historicallySettledCents !== planned.historicallySettledCents ||
          persisted.outstandingBalanceCents !== planned.outstandingBalanceCents ||
          persisted.isTombstone !== (planned.grossDebtCents === 0n) ||
          persisted.targetKind !== planned.target.kind ||
          persisted.targetSchemaVersion !== 1 ||
          persisted.targetBusinessKey !== planned.targetBusinessKey ||
          strictJcs(persisted.targetPayload) !== strictJcs(finalizedLine.targetPayload) ||
          persisted.targetFingerprint !== finalizedLine.targetFingerprint ||
          persisted.signedGrossDeltaCents !== planned.signedGrossDeltaCents ||
          persisted.signedHistoricallySettledDeltaCents !== planned.signedHistoricallySettledDeltaCents ||
          persisted.signedOutstandingBalanceDeltaCents !== planned.signedOutstandingBalanceDeltaCents ||
          persisted.deltaFingerprint !== planned.deltaFingerprint ||
          (persisted.rootCreditorLineId ?? null) !== planned.rootCreditorLineId ||
          (persisted.rootPayableRefId ?? null) !== planned.rootPayableRefId
        ) {
          throw new ConflictException("B级历史工资 creditor line、target 或 canonical lineage 已漂移");
        }
      }
    }
    const readSetFingerprint = fingerprint({
      binding: selectionSourceReadSet(binding),
      legacy: legacy.map((item) => legacyReadSet(item)),
      plan: planReadSet(plan)
    });
    if (scope.readSetFingerprint !== readSetFingerprint) {
      throw new ConflictException("历史工资接管来源、权威、冲突组或证据读集已漂移，必须零写入失败");
    }
    const authoritySourceRef = plan.sourceVersionId ?? `legacy:${binding.selectionFingerprint}`;
    const authoritySourceFingerprint = plan.sourceFingerprint ?? plan.negativeAuthorityFrontierFingerprint ?? fingerprint(legacy.map(legacyReadSet));
    const sourceClosureFingerprint = plan.sourceClosureFingerprint ?? fingerprint(legacy.map(legacyReadSet));
    if (
      scope.authoritySourceRef !== authoritySourceRef ||
      scope.authoritySourceFingerprint !== authoritySourceFingerprint ||
      scope.sourceClosureFingerprint !== sourceClosureFingerprint ||
      scope.permissionSnapshotFingerprint !== permissionScopeFingerprint(binding)
    ) {
      throw new ConflictException("历史工资接管原子范围的权威、闭合范围或权限快照已漂移");
    }
    const projects = plan.projectIds ?? sortedUnique(legacy.map((item) => item.projectId));
    if (!sameStrings(projects, sortedUnique(scope.projects.map((project) => project.projectId)))) {
      throw new ConflictException("历史工资接管项目子 manifest 范围已漂移，必须零写入失败");
    }
    const rows = scope.projects.flatMap((project) => project.manifest.rows.map((row) => ({ project, row })));
    if (rows.length !== legacy.length) {
      throw new ConflictException("历史工资接管子 manifest 行集不完整，必须零写入失败");
    }
    const legacyByCoordinate = new Map(legacy.map((item) => [legacyCoordinateKey(item), item]));
    const mappings: ScopeMapping[] = rows.map(({ project, row }) => {
      const coordinate = `${row.projectId}:${row.sourceType}:${row.sourceBusinessId}:${row.sourceVersion}`;
      const item = legacyByCoordinate.get(coordinate);
      if (
        !item || project.projectId !== row.projectId || row.adapterKind !== "historical_wage" ||
        row.sourceFingerprint !== item.sourceFingerprint || row.amountCents !== item.amountCents ||
        row.mappingFingerprint !== fingerprint({ scopeId: scope.id, projectId: item.projectId, plan: planReadSet(plan), legacy: legacyReadSet(item) })
      ) {
        throw new ConflictException("历史工资接管映射行、来源指纹或项目闭合范围已漂移，必须零写入失败");
      }
      const expectedDecision = plan.grade === "A" || plan.grade === "B" ? "FORMAL" : "GAP";
      if (row.mappingDecision !== expectedDecision || row.evidenceLevel !== plan.grade) {
        throw new ConflictException("历史工资接管映射等级已漂移，禁止把 gap 重新解释为正式工资事实");
      }
      if (plan.grade === "A" && (
        row.sourceDiscriminator !== "wage_statement_version" ||
        row.wageApprovedSourceVersionId !== plan.sourceVersionId ||
        row.wageStatementReservationId !== scope.wageStatementReservation?.id ||
        row.historicalWageSummaryAuthorityVersionId !== null
      )) {
        throw new ConflictException("A级历史工资接管映射未绑定同 scope 的权威来源与预留版本");
      }
      if (plan.grade === "B" && (
        row.sourceDiscriminator !== "historical_wage_summary" ||
        row.wageApprovedSourceVersionId !== null ||
        row.wageStatementReservationId !== null ||
        row.historicalWageSummaryAuthorityVersionId !== finalizedSummary?.id
      )) {
        throw new ConflictException("B级历史工资接管映射权威范围不完整或混入A级预留");
      }
      if (plan.grade === "C" && (
        row.sourceDiscriminator !== null ||
        row.wageApprovedSourceVersionId !== null ||
        row.wageStatementReservationId !== null ||
        row.historicalWageSummaryAuthorityVersionId !== null
      )) {
        throw new ConflictException("C级历史工资缺口不得携带任何正式工资权威目标");
      }
      return {
        id: row.id,
        manifestId: project.manifest.id,
        projectId: row.projectId,
        mappingDecision: row.mappingDecision,
        evidenceLevel: row.evidenceLevel,
        sourceDiscriminator: row.sourceDiscriminator,
        legacy: item
      };
    }).sort((left, right) => legacyCoordinateKey(left.legacy).localeCompare(legacyCoordinateKey(right.legacy)));
    if (new Set(mappings.map((mapping) => mapping.id)).size !== mappings.length) {
      throw new ConflictException("历史工资接管映射行不唯一，必须零写入失败");
    }
    if (plan.grade === "A" && (
      !scope.reservedWageStatementVersionId ||
      !scope.wageStatementReservation ||
      scope.wageStatementReservation.id !== scope.reservedWageStatementVersionId ||
      scope.wageStatementReservation.atomicScopeVersionId !== scope.id ||
      !plan.wageReservation ||
      scope.wageStatementReservation.targetWageStatementId !== plan.wageReservation.targetWageStatementId ||
      scope.wageStatementReservation.expectedCurrentRevision !== plan.wageReservation.expectedCurrentRevision ||
      scope.wageStatementReservation.reservedRevision !== plan.wageReservation.reservedRevision ||
      scope.wageStatementReservation.versionKind !== plan.wageReservation.versionKind ||
      scope.wageStatementReservation.priorConfirmedVersionId !== plan.wageReservation.priorConfirmedVersionId ||
      scope.wageStatementReservation.priorSourceVersionId !== plan.wageReservation.priorSourceVersionId ||
      scope.wageStatementReservation.sourceDeltaFingerprint !== plan.wageReservation.sourceDeltaFingerprint ||
      scope.wageStatementReservation.canonicalRootClosureFingerprint !== plan.wageReservation.canonicalRootClosureFingerprint ||
      !sameStrings(sortedUnique((plan.projectDeltas ?? []).map((delta) => delta.projectId)), sortedUnique(mappings.map((mapping) => mapping.projectId)))
    )) {
      throw new ConflictException("A级历史工资接管缺少同 scope 的不可变预留或完整项目闭合范围");
    }
    if (plan.grade !== "A" && (scope.reservedWageStatementVersionId || scope.wageStatementReservation)) {
      throw new ConflictException("非A级历史工资接管不得携带工资版本预留");
    }
    const authorities = scope.historicalSummaryAuthorities;
    if (plan.grade === "B") {
      if (authorities.length !== 1 || !plan.summaryAuthority || !finalizedSummary) {
        throw new ConflictException("B级历史工资汇总权威范围不完整或不唯一");
      }
      const authority = authorities[0]!;
      if (
        authority.id !== finalizedSummary.id ||
        authority.authorityFingerprint !== finalizedSummary.fingerprint ||
        authority.summaryBucketKey !== summaryBucketKey(plan.summaryAuthority) ||
        authority.permissionScopeFingerprint !== scope.permissionSnapshotFingerprint
      ) {
        throw new ConflictException("B级历史工资汇总权威或权限快照已漂移");
      }
    } else if (authorities.length) {
      throw new ConflictException("非 B 级历史工资接管不得携带汇总债权权威");
    }
    return { scope, mappings, legacy, plan, authorities, receipts: scope.receipts };
  }

  private async resolveLegacyClosure(tx: Tx, binding: HistoricalWageSelectionBinding): Promise<ResolvedLegacy[]> {
    const resolved: ResolvedLegacy[] = [];
    for (const coordinate of binding.legacyCoordinates) {
      await this.lock(tx, `pol219:legacy:${coordinate.projectId}:${coordinate.sourceType}:${coordinate.sourceBusinessId}:${coordinate.sourceVersion}`);
      const fact = await tx.operatingFact.findUnique({
        where: { sourceType_sourceBusinessId: { sourceType: coordinate.sourceType, sourceBusinessId: coordinate.sourceBusinessId } },
        include: { impacts: true }
      });
      if (
        !fact ||
        fact.projectId !== coordinate.projectId ||
        fact.sourceType !== coordinate.sourceType ||
        fact.sourceVersion !== coordinate.sourceVersion ||
        fact.factKind !== "project_wage" ||
        !["original", "correction", "reversal"].includes(fact.entryKind) ||
        fact.status !== "confirmed" ||
        fact.amountCents <= 0n
      ) {
        throw new ConflictException("历史 project_wage 来源已变化或不完整，必须零写入失败");
      }
      if (binding.grade === "B") {
        assertNoMalformedCSummaryAuthority(fact.sourceSnapshot);
      }
      const directions = sortedUnique(fact.impacts
        .filter((impact) => impact.impactKind === "confirmed_cost" || impact.impactKind === "payable_increase" || impact.impactKind === "payable_decrease")
        .map((impact) => impact.direction));
      if (directions.length !== 1 || (directions[0] !== "increase" && directions[0] !== "decrease")) {
        throw new ConflictException("历史 project_wage 成本与应付影响方向不一致，不能猜测 adjustment lineage");
      }
      const direction = directions[0] as "increase" | "decrease";
      const costImpacts = fact.impacts.filter((impact) => impact.impactKind === "confirmed_cost" && impact.direction === direction && impact.amountCents === fact.amountCents);
      const payableKind = direction === "increase" ? "payable_increase" : "payable_decrease";
      const payableImpacts = fact.impacts.filter((impact) => impact.impactKind === payableKind && impact.direction === direction && impact.amountCents === fact.amountCents);
      if (costImpacts.length !== 1 || payableImpacts.length !== 1) {
        throw new ConflictException("历史 project_wage 必须具备唯一且金额闭合的成本/应付影响，不能猜测 bridge");
      }
      const authorityCoordinates = legacyWageAuthorityCoordinates(fact);
      let adjustmentRoot: ResolvedLegacy["adjustmentRoot"] = null;
      if (fact.entryKind === "original") {
        if (direction !== "increase" || fact.adjustsFactId) {
          throw new ConflictException("历史 project_wage 原始事实不得伪装为 adjustment");
        }
      } else {
        if (!fact.adjustsFactId || (fact.entryKind === "reversal" && direction !== "decrease")) {
          throw new ConflictException("历史 project_wage 更正或冲销缺少原始事实 lineage");
        }
        const root = await tx.operatingFact.findUnique({ where: { id: fact.adjustsFactId }, include: { impacts: true } });
        if (
          !root || root.entryKind !== "original" || root.status !== "confirmed" || root.factKind !== "project_wage" ||
          root.sourceType !== "project_wage" || root.projectId !== fact.projectId || root.adjustsFactId
        ) {
          throw new ConflictException("历史 project_wage 更正或冲销未唯一指向同项目原始事实");
        }
        adjustmentRoot = {
          factId: root.id,
          sourceBusinessId: root.sourceBusinessId,
          sourceVersion: root.sourceVersion,
          sourceFingerprint: historicalWageLegacyFingerprint(root),
          ...legacyWageAuthorityCoordinates(root)
        };
      }
      const sourceFingerprint = historicalWageLegacyFingerprint(fact);
      if (sourceFingerprint !== coordinate.sourceFingerprint) {
        throw new ConflictException("历史 project_wage 指纹已漂移，必须零写入失败");
      }
      resolved.push({
        sourceType: "project_wage",
        sourceBusinessId: fact.sourceBusinessId,
        sourceVersion: fact.sourceVersion,
        sourceFingerprint,
        projectId: fact.projectId,
        ...authorityCoordinates,
        costImpactId: costImpacts[0]!.id,
        payableImpactId: payableImpacts[0]!.id,
        amountCents: fact.amountCents,
        factId: fact.id,
        entryKind: fact.entryKind as "original" | "correction" | "reversal",
        direction,
        adjustsFactId: fact.adjustsFactId ?? null,
        adjustmentRoot,
        legacySnapshot: jsonInput(fact.sourceSnapshot),
        costImpactSnapshot: jsonInput(costImpacts[0]!.impactSnapshot),
        payableImpactSnapshot: jsonInput(payableImpacts[0]!.impactSnapshot)
      });
    }
    return resolved.sort((left, right) => legacyCoordinateKey(left).localeCompare(legacyCoordinateKey(right)));
  }

  private async preflightPlan(
    tx: Tx,
    binding: HistoricalWageSelectionBinding,
    legacy: ResolvedLegacy[],
    reservedTargetWageStatementId?: string,
    currentAtomicScopeVersionId?: string
  ): Promise<ScopePlan> {
    if (binding.grade === "A") {
      const plan = await this.preflightA(tx, binding, legacy, reservedTargetWageStatementId);
      if (plan) {
        const conflict = await this.crossSourceConflict(tx, plan, legacy);
        return conflict ? { grade: "C", blockedReason: conflict } : plan;
      }
      return { grade: "C", blockedReason: "A_CANONICAL_CLOSURE_DRIFT" };
    }
    if (binding.grade === "B") {
      const plan = await this.preflightB(tx, binding, legacy, currentAtomicScopeVersionId);
      if (plan) {
        const conflict = await this.crossSourceConflict(tx, plan, legacy);
        return conflict ? { grade: "C", blockedReason: conflict } : plan;
      }
      return { grade: "C", blockedReason: "B_SUMMARY_AUTHORITY_DRIFT" };
    }
    return this.preflightC(tx, binding, legacy);
  }

  private async preflightC(
    tx: Tx,
    binding: HistoricalWageSelectionBinding,
    legacy: ResolvedLegacy[]
  ): Promise<ScopePlan> {
    if (legacy.length !== 1 || !binding.negativeAuthorityFrontierFingerprint) {
      throw new ConflictException("C级负权威前沿不完整，必须重新获取服务端 selectionRef");
    }
    const negativeAuthorityFrontier = await this.resolveCNegativeAuthorityFrontier(tx, legacy[0]!);
    const negativeAuthorityFrontierFingerprint = fingerprint(negativeAuthorityFrontier);
    const hasSingleEligibleA =
      negativeAuthorityFrontier.resolution.eligibleASourceVersionIds.length === 1 &&
      !negativeAuthorityFrontier.resolution.ambiguousA;
    if (
      negativeAuthorityFrontierFingerprint !== binding.negativeAuthorityFrontierFingerprint ||
      cSelectionFingerprint(legacy[0]!, negativeAuthorityFrontierFingerprint) !== binding.selectionFingerprint ||
      hasSingleEligibleA ||
      (negativeAuthorityFrontier.resolution.eligibleB && !negativeAuthorityFrontier.resolution.ambiguousA)
    ) {
      throw new ConflictException("C级负权威前沿已漂移，必须零写入失败并重新获取 selectionRef");
    }
    return {
      grade: "C",
      projectIds: [legacy[0]!.projectId],
      negativeAuthorityFrontier,
      negativeAuthorityFrontierFingerprint,
      blockedReason: negativeAuthorityFrontier.resolution.reasonCode
    };
  }

  private async resolveCNegativeAuthorityFrontier(
    tx: Tx,
    focus: ResolvedLegacy,
    cache?: { legacy: ResolvedLegacy[]; sources: HistoricalWageApprovedSourceCandidate[] }
  ): Promise<HistoricalWageCNegativeAuthorityFrontier> {
    assertNoMalformedCSummaryAuthority(focus.legacySnapshot);
    const focusLegacyCoordinate = legacyCoordinateKey(focus);
    const focusOccupancyReadSet = await this.readCFocusOccupancy(tx, focus);
    if (!focus.employmentCompanyId || !focus.legacyWageMonth) {
      return {
        schemaVersion: 1,
        authorityScope: {
          state: "unresolved",
          employmentCompanyId: null,
          wageMonth: null,
          focusProjectId: focus.projectId,
          focusLegacyCoordinate
        },
        legacyNamespace: [legacyReadSet(focus)],
        canonicalWageDependencyReadSet: { statement: null, currentVersion: null, rootPayableRefs: [], envelopes: [] },
        approvedSourceProbes: [],
        summaryDependencyReadSet: { summaryBucketKey: null, authorities: [], payableRefs: [] },
        summaryProbe: emptyCSummaryProbe(),
        focusConflictReadSet: null,
        focusOccupancyReadSet,
        resolution: {
          eligibleASourceVersionIds: [],
          ambiguousA: false,
          eligibleB: false,
          focusOccupied: focusOccupancyReadSet.state === "occupied",
          reasonCode: "LEGACY_AUTHORITY_COORDINATE_UNRESOLVED"
        }
      };
    }

    let allLegacy = cache?.legacy;
    if (!allLegacy) {
      const facts = await tx.operatingFact.findMany({
        where: { sourceType: "project_wage", factKind: "project_wage", status: "confirmed" },
        include: { impacts: true },
        orderBy: [{ projectId: "asc" }, { sourceType: "asc" }, { sourceBusinessId: "asc" }]
      });
      const factsById = new Map(facts.map((fact) => [fact.id, fact]));
      allLegacy = facts.flatMap((fact) => {
        const item = historicalWageOptionLegacy(
          fact,
          fact.adjustsFactId ? factsById.get(fact.adjustsFactId) : undefined
        );
        return item ? [item] : [];
      });
    }
    const legacyNamespace = allLegacy
      .filter((item) =>
        item.employmentCompanyId === focus.employmentCompanyId &&
        item.legacyWageMonth === focus.legacyWageMonth
      )
      .sort((left, right) => legacyCoordinateKey(left).localeCompare(legacyCoordinateKey(right)));
    if (!legacyNamespace.some((item) => legacyCoordinateKey(item) === focusLegacyCoordinate)) {
      throw new ConflictException("C级负权威前沿未包含当前 legacy 坐标");
    }

    const sources = (cache?.sources ?? await tx.wageApprovedSourceVersion.findMany({
      where: {
        employmentCompanyId: focus.employmentCompanyId,
        wageMonth: focus.legacyWageMonth
      },
      select: HISTORICAL_WAGE_APPROVED_SOURCE_SELECT,
      orderBy: { id: "asc" }
    }))
      .filter((source) =>
        source.employmentCompanyId === focus.employmentCompanyId &&
        source.wageMonth === focus.legacyWageMonth
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      new Set(sources.map((source) => source.id)).size !== sources.length ||
      sources.some((source) => !validCApprovedSourceCandidate(source))
    ) {
      throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE);
    }
    const statement = await tx.wageStatement.findUnique({
      where: {
        employmentCompanyId_wageMonth: {
          employmentCompanyId: focus.employmentCompanyId,
          wageMonth: focus.legacyWageMonth
        }
      },
      select: { id: true, currentRevision: true }
    });
    const stableTargetWageStatementId = statement?.id ??
      `unmaterialized:${focus.employmentCompanyId}:${focus.legacyWageMonth}`;
    const canonicalWageDependencyReadSet = await this.readCanonicalWageDependencyFrontier(tx, statement);
    const approvedSourceProbes: HistoricalWageCApprovedSourceProbe[] = [];
    for (const source of sources) {
      approvedSourceProbes.push(await this.probeCApprovedSource(
        tx,
        source,
        legacyNamespace,
        statement,
        stableTargetWageStatementId,
        canonicalWageDependencyReadSet
      ));
    }
    const summaryProbe = await this.probeCSummary(tx, focus);
    const summaryDependencyReadSet = summaryProbe.priorLineageProof.readSet;
    const focusConflictReadSet = await this.readCConflictFrontier(tx, {
      employmentCompanyId: focus.employmentCompanyId,
      wageMonth: focus.legacyWageMonth,
      projectIds: [focus.projectId],
      companyScoped: true
    });
    const eligibleASourceVersionIds = approvedSourceProbes
      .filter((probe) =>
        probe.outcome === "eligible" &&
        probe.closureLegacyCoordinates.includes(focusLegacyCoordinate)
      )
      .map((probe) => probe.sourceVersionId)
      .sort((left, right) => left.localeCompare(right));
    const ambiguousA = eligibleASourceVersionIds.length > 1;
    const eligibleB = summaryProbe.outcome === "eligible";
    const reasonCode = ambiguousA
      ? "A_AUTHORITY_AMBIGUOUS"
      : approvedSourceProbes.some((probe) => probe.outcome === "cross_source_blocked")
        ? "A_AUTHORITY_CROSS_SOURCE_BLOCKED"
        : summaryProbe.outcome === "cross_source_blocked"
          ? "B_AUTHORITY_CROSS_SOURCE_BLOCKED"
          : "NO_COMPLETE_A_OR_B_AUTHORITY";
    return {
      schemaVersion: 1,
      authorityScope: {
        state: "resolved",
        employmentCompanyId: focus.employmentCompanyId,
        wageMonth: focus.legacyWageMonth,
        focusProjectId: focus.projectId,
        focusLegacyCoordinate
      },
      legacyNamespace: legacyNamespace.map(legacyReadSet),
      canonicalWageDependencyReadSet,
      approvedSourceProbes,
      summaryDependencyReadSet,
      summaryProbe,
      focusConflictReadSet,
      focusOccupancyReadSet,
      resolution: {
        eligibleASourceVersionIds,
        ambiguousA,
        eligibleB,
        focusOccupied: focusOccupancyReadSet.state === "occupied",
        reasonCode
      }
    };
  }

  private async readCFocusOccupancy(
    tx: Tx,
    focus: ResolvedLegacy
  ): Promise<HistoricalWageCFocusOccupancyReadSet> {
    const empty: HistoricalWageCFocusOccupancyReadSet = {
      state: "unoccupied",
      bridges: [],
      mappings: [],
      reservations: [],
      manifests: [],
      scopes: [],
      scopeProjects: [],
      gaps: [],
      receipts: [],
      manifestReceipts: [],
      mappingReceiptLines: [],
      activationCausedByLines: [],
      activationReversedByLines: [],
      compensationReceipts: [],
      causalSuccessors: []
    };
    const queriedBridges = await tx.operatingTakeoverLegacySourceBridge.findMany({
      where: {
        projectId: focus.projectId,
        sourceType: focus.sourceType,
        sourceBusinessId: focus.sourceBusinessId,
        sourceVersion: focus.sourceVersion
      },
      select: {
        id: true,
        projectId: true,
        rowMappingId: true,
        sourceType: true,
        sourceBusinessId: true,
        sourceVersion: true,
        sourceFingerprint: true,
        targetKind: true,
        targetRef: true,
        targetFingerprint: true,
        mappingDecision: true,
        createdByUserId: true,
        createdTransactionId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    const bridges = queriedBridges.filter((bridge) =>
      bridge.projectId === focus.projectId &&
      bridge.sourceType === focus.sourceType &&
      bridge.sourceBusinessId === focus.sourceBusinessId &&
      bridge.sourceVersion === focus.sourceVersion
    );
    if (!bridges.length) return empty;
    if (bridges.length !== 1) {
      throw new ConflictException("C级 focus legacy 存在重复 #219 bridge，禁止签发候选");
    }
    const bridge = bridges[0]!;
    if (bridge.targetKind !== "unresolved_wage_payable_gap") {
      if (
        !["wage_takeover_projection_envelope", "historical_wage_summary_authority_version"].includes(bridge.targetKind) ||
        bridge.sourceFingerprint !== focus.sourceFingerprint ||
        bridge.mappingDecision !== "FORMAL" ||
        !text(bridge.targetRef) ||
        !SHA256.test(bridge.targetFingerprint)
      ) {
        throw new ConflictException("C级 focus legacy 已存在无效的正式 #219 bridge");
      }
      return {
        state: "occupied",
        bridges: [{
          ...bridge,
          createdTransactionId: bridge.createdTransactionId?.toString() ?? null,
          createdAt: bridge.createdAt.toISOString()
        }],
        mappings: [],
        reservations: [],
        manifests: [],
        scopes: [],
        scopeProjects: [],
        gaps: [],
        receipts: [],
        manifestReceipts: [],
        mappingReceiptLines: [],
        activationCausedByLines: [],
        activationReversedByLines: [],
        compensationReceipts: [],
        causalSuccessors: []
      };
    }
    const mappings = await tx.operatingTakeoverRowMapping.findMany({
      where: { id: { in: [bridge.rowMappingId] } },
      select: {
        id: true,
        manifestVersionId: true,
        projectId: true,
        adapterKind: true,
        rowNo: true,
        sourceType: true,
        sourceBusinessId: true,
        sourceVersion: true,
        sourceFingerprint: true,
        sourceCoordinate: true,
        normalizedRowHash: true,
        amountCents: true,
        evidenceLevel: true,
        coverageKind: true,
        coverageKey: true,
        periodStart: true,
        entryKind: true,
        mappingDecision: true,
        conflictGroupKey: true,
        adjustmentTargetRef: true,
        sourceDiscriminator: true,
        governedSubjectKey: true,
        authorityCategory: true,
        authoritySnapshotRef: true,
        authorityFingerprint: true,
        authorityVersionId: true,
        authorityLineId: true,
        authorityLineFingerprint: true,
        obligationId: true,
        authoritativeGrossCapCents: true,
        currencyCode: true,
        wageApprovedSourceVersionId: true,
        wageStatementReservationId: true,
        historicalWageSummaryAuthorityVersionId: true,
        authoritySnapshot: true,
        legacySourceSnapshot: true,
        readSetSnapshot: true,
        mappingFingerprint: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    if (mappings.length !== 1) {
      throw new ConflictException("C级 focus legacy bridge 未唯一指向 #219 mapping");
    }
    const mapping = mappings[0]!;
    const manifests = await tx.operatingTakeoverManifestVersion.findMany({
      where: { id: { in: [mapping.manifestVersionId] } },
      select: {
        id: true,
        projectId: true,
        atomicScopeVersionId: true,
        adapterKind: true,
        manifestNo: true,
        version: true,
        status: true,
        sourceScopeFingerprint: true,
        mapperName: true,
        mapperVersion: true,
        schemaVersion: true,
        candidateBaselineSha: true,
        permissionSnapshotFingerprint: true,
        readSetFingerprint: true,
        manifestFingerprint: true,
        createdByUserId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    if (manifests.length !== 1 || !manifests[0]!.atomicScopeVersionId) {
      throw new ConflictException("C级 focus legacy mapping 未唯一归属 #219 manifest/scope");
    }
    const manifest = manifests[0]!;
    const scopes = await tx.operatingTakeoverAtomicScopeVersion.findMany({
      where: { id: { in: [manifest.atomicScopeVersionId!] } },
      select: {
        id: true,
        scopeKind: true,
        authoritySourceRef: true,
        authoritySourceFingerprint: true,
        sourceClosureFingerprint: true,
        reservedWageStatementVersionId: true,
        candidateBaselineSha: true,
        permissionSnapshotFingerprint: true,
        readSetFingerprint: true,
        createdByUserId: true,
        createdTransactionId: true,
        createdAt: true,
        projects: {
          select: {
            id: true,
            atomicScopeVersionId: true,
            projectId: true,
            manifestVersionId: true,
            createdTransactionId: true,
            createdAt: true
          },
          orderBy: { id: "asc" }
        },
        manifests: {
          select: {
            id: true,
            projectId: true,
            atomicScopeVersionId: true,
            adapterKind: true,
            manifestNo: true,
            version: true,
            status: true,
            sourceScopeFingerprint: true,
            mapperName: true,
            mapperVersion: true,
            schemaVersion: true,
            candidateBaselineSha: true,
            permissionSnapshotFingerprint: true,
            readSetFingerprint: true,
            manifestFingerprint: true,
            createdByUserId: true,
            createdAt: true,
            rows: {
              select: {
                id: true,
                manifestVersionId: true,
                projectId: true,
                adapterKind: true,
                rowNo: true,
                sourceType: true,
                sourceBusinessId: true,
                sourceVersion: true,
                sourceFingerprint: true,
                sourceCoordinate: true,
                normalizedRowHash: true,
                amountCents: true,
                evidenceLevel: true,
                coverageKind: true,
                coverageKey: true,
                periodStart: true,
                entryKind: true,
                mappingDecision: true,
                conflictGroupKey: true,
                adjustmentTargetRef: true,
                sourceDiscriminator: true,
                governedSubjectKey: true,
                authorityCategory: true,
                authoritySnapshotRef: true,
                authorityFingerprint: true,
                authorityVersionId: true,
                authorityLineId: true,
                authorityLineFingerprint: true,
                obligationId: true,
                authoritativeGrossCapCents: true,
                currencyCode: true,
                wageApprovedSourceVersionId: true,
                wageStatementReservationId: true,
                historicalWageSummaryAuthorityVersionId: true,
                authoritySnapshot: true,
                legacySourceSnapshot: true,
                readSetSnapshot: true,
                mappingFingerprint: true,
                createdAt: true
              },
              orderBy: [{ rowNo: "asc" }, { id: "asc" }]
            }
          },
          orderBy: { id: "asc" }
        },
        wageStatementReservation: {
          select: {
            id: true,
            atomicScopeVersionId: true,
            targetWageStatementId: true,
            expectedCurrentRevision: true,
            reservedRevision: true,
            versionKind: true,
            priorConfirmedVersionId: true,
            priorSourceVersionId: true,
            sourceDeltaFingerprint: true,
            canonicalRootClosureFingerprint: true,
            createdAt: true,
            mappings: {
              select: {
                id: true,
                manifestVersionId: true,
                projectId: true,
                adapterKind: true,
                rowNo: true,
                sourceType: true,
                sourceBusinessId: true,
                sourceVersion: true,
                sourceFingerprint: true,
                sourceCoordinate: true,
                normalizedRowHash: true,
                amountCents: true,
                evidenceLevel: true,
                coverageKind: true,
                coverageKey: true,
                periodStart: true,
                entryKind: true,
                mappingDecision: true,
                conflictGroupKey: true,
                adjustmentTargetRef: true,
                sourceDiscriminator: true,
                governedSubjectKey: true,
                authorityCategory: true,
                authoritySnapshotRef: true,
                authorityFingerprint: true,
                authorityVersionId: true,
                authorityLineId: true,
                authorityLineFingerprint: true,
                obligationId: true,
                authoritativeGrossCapCents: true,
                currencyCode: true,
                wageApprovedSourceVersionId: true,
                wageStatementReservationId: true,
                historicalWageSummaryAuthorityVersionId: true,
                authoritySnapshot: true,
                legacySourceSnapshot: true,
                readSetSnapshot: true,
                mappingFingerprint: true,
                createdAt: true
              },
              orderBy: [{ rowNo: "asc" }, { id: "asc" }]
            }
          }
        }
      },
      orderBy: { id: "asc" }
    });
    const gaps = await tx.unresolvedWagePayableGap.findMany({
      where: { atomicScopeVersionId: manifest.atomicScopeVersionId! },
      select: {
        id: true,
        atomicScopeVersionId: true,
        manifestVersionId: true,
        rowMappingId: true,
        projectId: true,
        wageMonth: true,
        reasonCode: true,
        sourceFingerprint: true,
        gapSnapshot: true,
        createdTransactionId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    const scope = scopes[0];
    if (scopes.length !== 1 || !scope || gaps.length !== 1) {
      throw new ConflictException("C级 focus legacy occupancy 缺少唯一 scope 或 gap");
    }
    const gap = gaps[0]!;
    const reverseBridges = await tx.operatingTakeoverLegacySourceBridge.findMany({
      where: {
        OR: [
          { rowMappingId: mapping.id },
          { targetKind: "unresolved_wage_payable_gap", targetRef: gap.id }
        ]
      },
      select: {
        id: true,
        projectId: true,
        rowMappingId: true,
        sourceType: true,
        sourceBusinessId: true,
        sourceVersion: true,
        sourceFingerprint: true,
        targetKind: true,
        targetRef: true,
        targetFingerprint: true,
        mappingDecision: true,
        createdByUserId: true,
        createdTransactionId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    const manifestReceipts = await tx.operatingTakeoverCommandReceipt.findMany({
      where: { manifestVersionId: manifest.id },
      select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_SELECT,
      orderBy: { id: "asc" }
    });
    const receipts = await tx.operatingTakeoverCommandReceipt.findMany({
      where: { atomicScopeVersionId: scope.id },
      select: {
        id: true,
        manifestVersionId: true,
        atomicScopeVersionId: true,
        idempotencyKey: true,
        action: true,
        expectedRevision: true,
        actorUserId: true,
        delegatorUserId: true,
        actorSetSnapshot: true,
        permissionSnapshotFingerprint: true,
        fingerprint: true,
        status: true,
        commandSnapshotSchemaVersion: true,
        commandSnapshot: true,
        resultSnapshot: true,
        causalityFingerprint: true,
        createdTransactionId: true,
        causesReceiptId: true,
        createdAt: true,
        lines: {
          select: {
            id: true,
            receiptId: true,
            rowMappingId: true,
            projectId: true,
            lineNo: true,
            decision: true,
            entryKind: true,
            amountCents: true,
            targetKind: true,
            targetRef: true,
            causalOrdinal: true,
            reversesLineId: true,
            causesLineId: true,
            causalityFingerprint: true,
            lineSnapshot: true,
            createdAt: true
          },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { id: "asc" }
    });
    const lifecycle = new Map(receipts.map((receipt) => [receipt.action, receipt]));
    const createReceipt = lifecycle.get("historical_wage_takeover.scope.create");
    const applyReceipt = lifecycle.get("historical_wage_takeover.scope.apply");
    const activationReceipt = lifecycle.get("historical_wage_takeover.scope.activate");
    const compensationReceipt = lifecycle.get("historical_wage_takeover.scope.compensate");
    const causalSuccessors = activationReceipt
      ? await tx.operatingTakeoverCommandReceipt.findMany({
          where: { causesReceiptId: activationReceipt.id },
          select: {
            id: true,
            manifestVersionId: true,
            atomicScopeVersionId: true,
            idempotencyKey: true,
            action: true,
            expectedRevision: true,
            actorUserId: true,
            delegatorUserId: true,
            actorSetSnapshot: true,
            permissionSnapshotFingerprint: true,
            fingerprint: true,
            status: true,
            commandSnapshotSchemaVersion: true,
            commandSnapshot: true,
            resultSnapshot: true,
            causalityFingerprint: true,
            createdTransactionId: true,
            causesReceiptId: true,
            createdAt: true,
            lines: {
              select: {
                id: true,
                receiptId: true,
                rowMappingId: true,
                projectId: true,
                lineNo: true,
                decision: true,
                entryKind: true,
                amountCents: true,
                targetKind: true,
                targetRef: true,
                causalOrdinal: true,
                reversesLineId: true,
                causesLineId: true,
                causalityFingerprint: true,
                lineSnapshot: true,
                createdAt: true
              },
              orderBy: { id: "asc" }
            }
          },
          orderBy: { id: "asc" }
        })
      : [];
    const activationLine = activationReceipt?.lines[0];
    const mappingReceiptLines = await tx.operatingTakeoverCommandReceiptLine.findMany({
      where: { rowMappingId: mapping.id },
      select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT,
      orderBy: { id: "asc" }
    });
    const activationReverseLines = activationLine
      ? await tx.operatingTakeoverCommandReceiptLine.findMany({
          where: {
            OR: [
              { causesLineId: activationLine.id },
              { reversesLineId: activationLine.id }
            ]
          },
          select: HISTORICAL_WAGE_OCCUPANCY_RECEIPT_LINE_SELECT,
          orderBy: { id: "asc" }
        })
      : [];
    const activationCausedByLines = activationReverseLines.filter(
      (line) => line.causesLineId === activationLine?.id
    );
    const activationReversedByLines = activationReverseLines.filter(
      (line) => line.reversesLineId === activationLine?.id
    );
    const scopeProject = scope.projects[0];
    const exactLifecycleCount = compensationReceipt ? 4 : 3;
    const reverseManifestRows = scope.manifests.flatMap((candidate) => candidate.rows);
    const allReceiptLines = receipts.flatMap((receipt) => receipt.lines);
    const receiptActorIds = (receipt: typeof receipts[number]) => {
      if (!isPriorGraphSnapshot(receipt.actorSetSnapshot)) return [];
      const actorIds = receipt.actorSetSnapshot.actorIds;
      return Array.isArray(actorIds) && actorIds.every((value) => typeof value === "string")
        ? actorIds
        : [];
    };
    const activationActorIds = activationReceipt ? receiptActorIds(activationReceipt) : [];
    const expectedCausalSuccessorIds = compensationReceipt ? [compensationReceipt.id] : [];
    const mappingReadSet = isPriorGraphSnapshot(mapping.readSetSnapshot)
      ? mapping.readSetSnapshot
      : null;
    const storedPlan = mappingReadSet && isPriorGraphSnapshot(mappingReadSet.plan)
      ? mappingReadSet.plan
      : null;
    const storedLegacy = mappingReadSet && isPriorGraphSnapshot(mappingReadSet.legacy)
      ? mappingReadSet.legacy
      : null;
    const gapSnapshot = isPriorGraphSnapshot(gap.gapSnapshot) ? gap.gapSnapshot : null;
    const storedLegacySource = isPriorGraphSnapshot(mapping.legacySourceSnapshot)
      ? mapping.legacySourceSnapshot
      : null;
    const storedLegacySourceCore = storedLegacySource
      ? {
          factId: storedLegacySource.factId,
          projectId: storedLegacySource.projectId,
          sourceType: storedLegacySource.sourceType,
          sourceBusinessId: storedLegacySource.sourceBusinessId,
          sourceVersion: storedLegacySource.sourceVersion,
          sourceFingerprint: storedLegacySource.sourceFingerprint,
          legacyWageMonth: storedLegacySource.legacyWageMonth,
          employmentCompanyId: storedLegacySource.employmentCompanyId,
          amountCents: storedLegacySource.amountCents,
          entryKind: storedLegacySource.entryKind,
          direction: storedLegacySource.direction,
          adjustsFactId: storedLegacySource.adjustsFactId,
          adjustmentRoot: storedLegacySource.adjustmentRoot,
          costImpactId: storedLegacySource.costImpactId,
          payableImpactId: storedLegacySource.payableImpactId
        }
      : null;
    const storedEvidenceRefs = storedLegacySource?.evidenceRefs;
    const storedCostImpactFingerprint = stringOrEmpty(storedLegacySource?.costImpactFingerprint);
    const storedPayableImpactFingerprint = stringOrEmpty(storedLegacySource?.payableImpactFingerprint);
    const storedLegacySourceIsValid = Boolean(
      storedLegacySource &&
      storedLegacySourceCore &&
      fingerprint(storedLegacySourceCore) === fingerprint(legacyReadSet(focus)) &&
      Object.prototype.hasOwnProperty.call(storedLegacySource, "costImpactSnapshot") &&
      Object.prototype.hasOwnProperty.call(storedLegacySource, "payableImpactSnapshot") &&
      fingerprint(storedLegacySource.costImpactSnapshot) === fingerprint(focus.costImpactSnapshot) &&
      fingerprint(storedLegacySource.payableImpactSnapshot) === fingerprint(focus.payableImpactSnapshot) &&
      SHA256.test(storedCostImpactFingerprint) &&
      storedCostImpactFingerprint === fingerprint({
        legacySourceFingerprint: focus.sourceFingerprint,
        legacyImpactEntryId: focus.costImpactId,
        impactKind: "confirmed_cost",
        direction: focus.direction,
        amountCents: focus.amountCents,
        impactSnapshot: storedLegacySource.costImpactSnapshot
      }) &&
      SHA256.test(storedPayableImpactFingerprint) &&
      storedPayableImpactFingerprint === fingerprint({
        legacySourceFingerprint: focus.sourceFingerprint,
        legacyImpactEntryId: focus.payableImpactId,
        impactKind: focus.direction === "increase" ? "payable_increase" : "payable_decrease",
        direction: focus.direction,
        amountCents: focus.amountCents,
        impactSnapshot: storedLegacySource.payableImpactSnapshot
      }) &&
      text(storedLegacySource.businessReason) &&
      Array.isArray(storedEvidenceRefs) &&
      storedEvidenceRefs.every((value): value is string => typeof value === "string" && text(value)) &&
      sameStrings(storedEvidenceRefs, sortedUnique(storedEvidenceRefs))
    );
    const expectedCPlanKeys = [
      "adjustmentRootProofs",
      "blockedReason",
      "conflictReadSet",
      "grade",
      "negativeAuthorityFrontier",
      "negativeAuthorityFrontierFingerprint",
      "projectDeltas",
      "projectIds",
      "sourceClosureFingerprint",
      "sourceFingerprint",
      "sourceVersionId",
      "summaryAuthorityFingerprint",
      "summarySourceVersionFingerprint",
      "wageReservation"
    ].sort((left, right) => left.localeCompare(right));
    const storedNegativeFrontier = storedPlan && isPriorGraphSnapshot(storedPlan.negativeAuthorityFrontier)
      ? storedPlan.negativeAuthorityFrontier
      : null;
    const storedFrontierAuthorityScope = storedNegativeFrontier && isPriorGraphSnapshot(storedNegativeFrontier.authorityScope)
      ? storedNegativeFrontier.authorityScope
      : null;
    const storedFrontierOccupancy = storedNegativeFrontier && isPriorGraphSnapshot(storedNegativeFrontier.focusOccupancyReadSet)
      ? storedNegativeFrontier.focusOccupancyReadSet
      : null;
    const storedFrontierResolution = storedNegativeFrontier && isPriorGraphSnapshot(storedNegativeFrontier.resolution)
      ? storedNegativeFrontier.resolution
      : null;
    const storedFrontierLegacyNamespace = storedNegativeFrontier?.legacyNamespace;
    const storedNegativeFrontierFingerprint = stringOrEmpty(storedPlan?.negativeAuthorityFrontierFingerprint);
    const storedFrontierAuthorityScopeIsValid = Boolean(
      storedFrontierAuthorityScope &&
      storedFrontierAuthorityScope.focusProjectId === focus.projectId &&
      storedFrontierAuthorityScope.focusLegacyCoordinate === legacyCoordinateKey(focus) &&
      (
        (
          storedFrontierAuthorityScope.state === "resolved" &&
          Boolean(focus.employmentCompanyId) &&
          Boolean(focus.legacyWageMonth) &&
          storedFrontierAuthorityScope.employmentCompanyId === focus.employmentCompanyId &&
          storedFrontierAuthorityScope.wageMonth === focus.legacyWageMonth
        ) ||
        (
          storedFrontierAuthorityScope.state === "unresolved" &&
          (!focus.employmentCompanyId || !focus.legacyWageMonth) &&
          storedFrontierAuthorityScope.employmentCompanyId === null &&
          storedFrontierAuthorityScope.wageMonth === null
        )
      )
    );
    const storedCPlanIsValid = Boolean(
      storedPlan &&
      sameStrings(Object.keys(storedPlan).sort((left, right) => left.localeCompare(right)), expectedCPlanKeys) &&
      storedPlan.grade === "C" &&
      storedPlan.sourceVersionId === null &&
      storedPlan.sourceFingerprint === null &&
      storedPlan.sourceClosureFingerprint === null &&
      Array.isArray(storedPlan.projectIds) &&
      storedPlan.projectIds.length === 1 &&
      storedPlan.projectIds[0] === focus.projectId &&
      Array.isArray(storedPlan.projectDeltas) && storedPlan.projectDeltas.length === 0 &&
      Array.isArray(storedPlan.adjustmentRootProofs) && storedPlan.adjustmentRootProofs.length === 0 &&
      storedPlan.wageReservation === null &&
      storedPlan.conflictReadSet === null &&
      storedPlan.summaryAuthorityFingerprint === null &&
      storedPlan.summarySourceVersionFingerprint === null &&
      storedPlan.blockedReason === gap.reasonCode &&
      storedNegativeFrontier &&
      SHA256.test(storedNegativeFrontierFingerprint) &&
      fingerprint(storedNegativeFrontier) === storedNegativeFrontierFingerprint &&
      storedNegativeFrontier.schemaVersion === 1 &&
      storedFrontierAuthorityScopeIsValid &&
      Array.isArray(storedFrontierLegacyNamespace) &&
      storedFrontierLegacyNamespace.some((candidate) =>
        isPriorGraphSnapshot(candidate) && fingerprint(candidate) === fingerprint(legacyReadSet(focus))
      ) &&
      storedFrontierOccupancy?.state === "unoccupied" &&
      storedFrontierResolution?.focusOccupied === false &&
      storedFrontierResolution.reasonCode === gap.reasonCode &&
      scope.authoritySourceFingerprint === storedNegativeFrontierFingerprint &&
      gapSnapshot?.negativeAuthorityFrontierFingerprint === storedNegativeFrontierFingerprint
    );
    const receiptResultIsInvalid = (receipt: typeof receipts[number]) => {
      if (!isPriorGraphSnapshot(receipt.resultSnapshot)) return true;
      const result = receipt.resultSnapshot;
      if (
        result.atomicScopeVersionId !== scope.id ||
        result.grade !== "C" ||
        result.status !== receipt.status
      ) return true;
      if (receipt.action === "historical_wage_takeover.scope.create") {
        return result.projectCount !== 1 || result.rowCount !== 1 || !text(result.commandSelectionRef);
      }
      if (receipt.action === "historical_wage_takeover.scope.apply") {
        return result.revision !== 2 || result.rowCount !== 1;
      }
      if (receipt.action === "historical_wage_takeover.scope.activate") {
        return result.revision !== 3 ||
          !Array.isArray(result.rows) ||
          fingerprint(result.rows) !== fingerprint([{
            projectId: focus.projectId,
            decision: "GAP",
            targetKind: "unresolved_wage_payable_gap",
            targetRef: gap.id
          }]);
      }
      return receipt.action !== "historical_wage_takeover.scope.compensate" ||
        result.revision !== 4 ||
        result.causesReceiptId !== activationReceipt?.id;
    };
    const receiptLineIsInvalid = (receipt: typeof receipts[number]) => {
      if (receipt.lines.length !== 1) return true;
      const line = receipt.lines[0]!;
      const isActivation = receipt.action === "historical_wage_takeover.scope.activate";
      const isCompensation = receipt.action === "historical_wage_takeover.scope.compensate";
      const expectedDecision = receipt.action === "historical_wage_takeover.scope.create"
        ? "PREPARED"
        : receipt.action === "historical_wage_takeover.scope.apply"
          ? "inactive_applied"
          : isActivation
            ? "GAP"
            : "compensated";
      const expectedCauseLine = isCompensation ? activationLine : null;
      return line.receiptId !== receipt.id ||
        line.rowMappingId !== mapping.id ||
        line.projectId !== focus.projectId ||
        line.lineNo !== 1 ||
        line.decision !== expectedDecision ||
        line.entryKind !== "historical_wage" ||
        line.amountCents !== focus.amountCents ||
        (isActivation
          ? line.targetKind !== "unresolved_wage_payable_gap" || line.targetRef !== gap.id
          : line.targetKind !== null || line.targetRef !== null) ||
        line.causalOrdinal !== 1 ||
        line.reversesLineId !== null ||
        line.causesLineId !== (expectedCauseLine?.id ?? null) ||
        line.causalityFingerprint !== fingerprint({
          receiptId: receipt.id,
          mappingId: mapping.id,
          causalOrdinal: 1,
          causesLineId: expectedCauseLine?.id ?? null,
          causeLineFingerprint: expectedCauseLine?.causalityFingerprint ?? null
        }) ||
        fingerprint(line.lineSnapshot) !== fingerprint(legacyReadSet(focus)) ||
        !validPriorGraphDate(line.createdAt);
    };
    const receiptLinesById = new Map(allReceiptLines.map((line) => [line.id, line] as const));
    const compensationLineIds = compensationReceipt
      ? compensationReceipt.lines.map((line) => line.id)
      : [];
    if (
      manifestReceipts.length !== 0 ||
      receipts.length !== exactLifecycleCount ||
      lifecycle.size !== receipts.length ||
      hasDuplicateValues(receipts.map((receipt) => receipt.id)) ||
      hasDuplicateValues(receipts.map((receipt) => receipt.action)) ||
      hasDuplicateValues(allReceiptLines.map((line) => line.id)) ||
      hasDuplicateValues(allReceiptLines.map((line) => `${line.receiptId}:${line.lineNo}`)) ||
      hasDuplicateValues(allReceiptLines.map((line) => `${line.receiptId}:${line.causalOrdinal}`)) ||
      hasDuplicateValues(mappingReceiptLines.map((line) => line.id)) ||
      hasDuplicateValues(mappingReceiptLines.map((line) => `${line.receiptId}:${line.lineNo}`)) ||
      !sameStrings(
        mappingReceiptLines.map((line) => line.id).sort((left, right) => left.localeCompare(right)),
        allReceiptLines.map((line) => line.id).sort((left, right) => left.localeCompare(right))
      ) ||
      mappingReceiptLines.some((line) => {
        const lifecycleLine = receiptLinesById.get(line.id);
        return !lifecycleLine || fingerprint(line) !== fingerprint(lifecycleLine);
      }) ||
      hasDuplicateValues(activationReverseLines.map((line) => line.id)) ||
      activationReversedByLines.length !== 0 ||
      !sameStrings(activationCausedByLines.map((line) => line.id), compensationLineIds) ||
      activationCausedByLines.some((line) => {
        const compensationLine = compensationReceipt?.lines.find((candidate) => candidate.id === line.id);
        return !compensationLine || fingerprint(line) !== fingerprint(compensationLine);
      }) ||
      hasDuplicateValues(scope.projects.map((project) => project.id)) ||
      hasDuplicateValues(scope.projects.map((project) => project.projectId)) ||
      hasDuplicateValues(scope.projects.map((project) => project.manifestVersionId)) ||
      hasDuplicateValues(scope.manifests.map((candidate) => candidate.id)) ||
      hasDuplicateValues(reverseManifestRows.map((candidate) => candidate.id)) ||
      hasDuplicateValues(reverseManifestRows.map((candidate) => `${candidate.manifestVersionId}:${candidate.rowNo}`)) ||
      hasDuplicateValues(gaps.map((candidate) => candidate.id)) ||
      hasDuplicateValues(gaps.map((candidate) => candidate.rowMappingId)) ||
      hasDuplicateValues(causalSuccessors.map((receipt) => receipt.id)) ||
      reverseBridges.length !== 1 ||
      reverseBridges[0]?.id !== bridge.id ||
      fingerprint(reverseBridges[0]) !== fingerprint(bridge) ||
      hasDuplicateValues(reverseBridges.map((candidate) => candidate.id)) ||
      hasDuplicateValues(reverseBridges.map((candidate) => candidate.rowMappingId)) ||
      hasDuplicateValues(reverseBridges.map((candidate) =>
        `${candidate.projectId}:${candidate.sourceType}:${candidate.sourceBusinessId}:${candidate.sourceVersion}`
      )) ||
      hasDuplicateValues(reverseBridges.map((candidate) =>
        `${candidate.projectId}:${candidate.targetKind}:${candidate.targetRef}`
      )) ||
      !sameStrings(causalSuccessors.map((receipt) => receipt.id), expectedCausalSuccessorIds) ||
      causalSuccessors.some((receipt) =>
        !compensationReceipt || fingerprint(receipt) !== fingerprint(compensationReceipt)
      ) ||
      bridge.projectId !== focus.projectId ||
      bridge.sourceType !== focus.sourceType ||
      bridge.sourceBusinessId !== focus.sourceBusinessId ||
      bridge.sourceVersion !== focus.sourceVersion ||
      bridge.sourceFingerprint !== focus.sourceFingerprint ||
      bridge.rowMappingId !== mapping.id ||
      bridge.targetKind !== "unresolved_wage_payable_gap" ||
      bridge.targetRef !== gap.id ||
      bridge.mappingDecision !== "GAP" ||
      !text(bridge.createdByUserId) ||
      (bridge.createdTransactionId !== null && typeof bridge.createdTransactionId !== "bigint") ||
      !validPriorGraphDate(bridge.createdAt) ||
      bridge.targetFingerprint !== fingerprint({
        targetKind: "unresolved_wage_payable_gap",
        targetRef: gap.id,
        sourceFingerprint: focus.sourceFingerprint
      }) ||
      mapping.manifestVersionId !== manifest.id ||
      mapping.projectId !== focus.projectId ||
      mapping.adapterKind !== "historical_wage" ||
      mapping.sourceType !== focus.sourceType ||
      mapping.sourceBusinessId !== focus.sourceBusinessId ||
      mapping.sourceVersion !== focus.sourceVersion ||
      mapping.sourceFingerprint !== focus.sourceFingerprint ||
      mapping.sourceCoordinate !== `${focus.sourceType}:${focus.sourceBusinessId}:${focus.sourceVersion}` ||
      mapping.normalizedRowHash !== fingerprint(legacyReadSet(focus)) ||
      mapping.amountCents !== focus.amountCents ||
      mapping.evidenceLevel !== "C" ||
      mapping.coverageKind !== null ||
      mapping.coverageKey !== null ||
      mapping.periodStart !== null ||
      mapping.entryKind !== "gap" ||
      mapping.mappingDecision !== "GAP" ||
      mapping.conflictGroupKey !== `wage:${focus.projectId}:unresolved` ||
      mapping.adjustmentTargetRef !== focus.adjustsFactId ||
      mapping.sourceDiscriminator !== null ||
      mapping.governedSubjectKey !== null ||
      mapping.authorityCategory !== null ||
      mapping.authoritySnapshotRef !== null ||
      mapping.authorityFingerprint !== null ||
      mapping.authorityVersionId !== null ||
      mapping.authorityLineId !== null ||
      mapping.authorityLineFingerprint !== null ||
      mapping.obligationId !== null ||
      mapping.authoritativeGrossCapCents !== null ||
      mapping.currencyCode !== null ||
      mapping.wageApprovedSourceVersionId !== null ||
      mapping.wageStatementReservationId !== null ||
      mapping.historicalWageSummaryAuthorityVersionId !== null ||
      strictJcs(mapping.authoritySnapshot) !== strictJcs({}) ||
      !mappingReadSet ||
      mappingReadSet.readSetFingerprint !== scope.readSetFingerprint ||
      !storedPlan ||
      storedPlan.grade !== "C" ||
      !storedCPlanIsValid ||
      !storedLegacy ||
      fingerprint(storedLegacy) !== fingerprint(legacyReadSet(focus)) ||
      !storedLegacySourceIsValid ||
      mapping.mappingFingerprint !== fingerprint({
        scopeId: scope.id,
        projectId: focus.projectId,
        plan: storedPlan,
        legacy: legacyReadSet(focus)
      }) ||
      !validPriorGraphDate(mapping.createdAt) ||
      manifest.projectId !== focus.projectId ||
      manifest.atomicScopeVersionId !== scope.id ||
      manifest.adapterKind !== "historical_wage" ||
      !text(manifest.manifestNo) ||
      manifest.version !== 1 ||
      manifest.status !== "prepared" ||
      manifest.sourceScopeFingerprint !== fingerprint([legacyReadSet(focus)]) ||
      manifest.mapperName !== MAPPER_NAME ||
      manifest.mapperVersion !== MAPPER_VERSION ||
      manifest.schemaVersion !== SCHEMA_VERSION ||
      manifest.candidateBaselineSha !== scope.candidateBaselineSha ||
      manifest.permissionSnapshotFingerprint !== scope.permissionSnapshotFingerprint ||
      manifest.readSetFingerprint !== scope.readSetFingerprint ||
      manifest.manifestFingerprint !== fingerprint({
        scopeId: scope.id,
        projectId: focus.projectId,
        plan: storedPlan,
        rows: [legacyReadSet(focus)]
      }) ||
      manifest.createdByUserId !== scope.createdByUserId ||
      !validPriorGraphDate(manifest.createdAt) ||
      scope.scopeKind !== "historical_wage" ||
      !text(scope.authoritySourceRef) ||
      !SHA256.test(scope.authoritySourceFingerprint) ||
      scope.sourceClosureFingerprint !== fingerprint([legacyReadSet(focus)]) ||
      scope.reservedWageStatementVersionId !== null ||
      !/^[0-9a-f]{40}$/iu.test(scope.candidateBaselineSha) ||
      !SHA256.test(scope.permissionSnapshotFingerprint) ||
      !SHA256.test(scope.readSetFingerprint) ||
      !text(scope.createdByUserId) ||
      typeof scope.createdTransactionId !== "bigint" ||
      !validPriorGraphDate(scope.createdAt) ||
      scope.wageStatementReservation !== null ||
      scope.manifests.length !== 1 ||
      scope.manifests[0]?.id !== manifest.id ||
      scope.manifests[0]?.atomicScopeVersionId !== scope.id ||
      scope.manifests[0]?.rows.length !== 1 ||
      scope.manifests[0]?.rows[0]?.id !== mapping.id ||
      scope.manifests[0]?.rows[0]?.manifestVersionId !== manifest.id ||
      scope.projects.length !== 1 ||
      !scopeProject ||
      scopeProject.atomicScopeVersionId !== scope.id ||
      scopeProject.projectId !== focus.projectId ||
      scopeProject.manifestVersionId !== manifest.id ||
      typeof scopeProject.createdTransactionId !== "bigint" ||
      !validPriorGraphDate(scopeProject.createdAt) ||
      gap.atomicScopeVersionId !== scope.id ||
      gap.manifestVersionId !== manifest.id ||
      gap.rowMappingId !== mapping.id ||
      gap.projectId !== focus.projectId ||
      gap.wageMonth !== focus.legacyWageMonth ||
      !text(gap.reasonCode) ||
      gap.sourceFingerprint !== focus.sourceFingerprint ||
      !gapSnapshot ||
      gapSnapshot.reasonCode !== gap.reasonCode ||
      !isPriorGraphSnapshot(gapSnapshot.legacy) ||
      fingerprint(gapSnapshot.legacy) !== fingerprint(legacyReadSet(focus)) ||
      !SHA256.test(stringOrEmpty(gapSnapshot.negativeAuthorityFrontierFingerprint)) ||
      gapSnapshot.readSetFingerprint !== scope.readSetFingerprint ||
      typeof gap.createdTransactionId !== "bigint" ||
      !validPriorGraphDate(gap.createdAt) ||
      !createReceipt ||
      createReceipt.status !== "prepared" ||
      createReceipt.expectedRevision !== 0 ||
      !applyReceipt ||
      applyReceipt.status !== "inactive_applied" ||
      applyReceipt.expectedRevision !== 1 ||
      !activationReceipt ||
      activationReceipt.status !== "activated" ||
      activationReceipt.expectedRevision !== 2 ||
      !activationLine ||
      activationReceipt.lines.length !== 1 ||
      activationLine.receiptId !== activationReceipt.id ||
      activationLine.rowMappingId !== mapping.id ||
      activationLine.projectId !== focus.projectId ||
      activationLine.decision !== "GAP" ||
      activationLine.entryKind !== "historical_wage" ||
      activationLine.amountCents !== focus.amountCents ||
      activationLine.targetKind !== "unresolved_wage_payable_gap" ||
      activationLine.targetRef !== gap.id ||
      activationLine.causalOrdinal !== 1 ||
      receipts.some((receipt) =>
        receipt.atomicScopeVersionId !== scope.id ||
        receipt.manifestVersionId !== null ||
        !uuid(receipt.idempotencyKey) ||
        !text(receipt.actorUserId) ||
        (receipt.delegatorUserId !== null && !text(receipt.delegatorUserId)) ||
        !priorReceiptActorSetMatches(receipt) ||
        receipt.permissionSnapshotFingerprint !== scope.permissionSnapshotFingerprint ||
        !priorReceiptCommandSnapshotMatches(receipt) ||
        receipt.causalityFingerprint !== fingerprint({
          action: receipt.action,
          atomicScopeVersionId: scope.id,
          commandFingerprint: receipt.fingerprint,
          mappings: [mapping.id]
        }) ||
        typeof receipt.createdTransactionId !== "bigint" ||
        !validPriorGraphDate(receipt.createdAt) ||
        receiptResultIsInvalid(receipt) ||
        receiptLineIsInvalid(receipt)
      ) ||
      activationReceipt.atomicScopeVersionId !== scope.id ||
      activationReceipt.manifestVersionId !== null ||
      activationReceipt.causesReceiptId !== null ||
      !activationActorIds.length ||
      [createReceipt, applyReceipt].some((receipt) =>
        receipt.causesReceiptId !== null ||
        receiptActorIds(receipt).some((actorId) => activationActorIds.includes(actorId))
      ) ||
      (compensationReceipt && (
        compensationReceipt.status !== "compensated" ||
        compensationReceipt.expectedRevision !== 3 ||
        compensationReceipt.causesReceiptId !== activationReceipt.id ||
        compensationReceipt.lines.length !== 1 ||
        compensationReceipt.lines[0]!.rowMappingId !== mapping.id ||
        compensationReceipt.lines[0]!.causesLineId !== activationLine.id ||
        receiptActorIds(compensationReceipt).some((actorId) => activationActorIds.includes(actorId))
      ))
    ) {
      throw new ConflictException("C级 focus legacy occupancy 的所有权、FK 或因果闭合无效");
    }
    const normalizeLine = (line: typeof mappingReceiptLines[number]) => ({
      ...line,
      amountCents: line.amountCents.toString(),
      createdAt: line.createdAt.toISOString()
    });
    const normalizeReceipt = (receipt: typeof receipts[number]) => ({
        ...receipt,
        createdTransactionId: receipt.createdTransactionId.toString(),
        createdAt: receipt.createdAt.toISOString(),
        lines: [...receipt.lines]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(normalizeLine)
      });
    const normalizedReceipts = receipts
      .filter((receipt) => receipt.action !== "historical_wage_takeover.scope.compensate")
      .map(normalizeReceipt)
      .sort((left, right) => left.id.localeCompare(right.id));
    const normalizedCompensationReceipts = receipts
      .filter((receipt) => receipt.action === "historical_wage_takeover.scope.compensate")
      .map(normalizeReceipt)
      .sort((left, right) => left.id.localeCompare(right.id));
    const normalizedCausalSuccessors = causalSuccessors
      .map(normalizeReceipt)
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      state: "occupied",
      bridges: reverseBridges.map((candidate) => ({
        ...candidate,
        createdTransactionId: candidate.createdTransactionId?.toString() ?? null,
        createdAt: candidate.createdAt.toISOString()
      })),
      mappings: [{
        ...mapping,
        amountCents: mapping.amountCents.toString(),
        authoritativeGrossCapCents: null,
        periodStart: null,
        createdAt: mapping.createdAt.toISOString()
      }],
      reservations: [],
      manifests: [{ ...manifest, createdAt: manifest.createdAt.toISOString() }],
      scopes: [{
        id: scope.id,
        scopeKind: scope.scopeKind,
        authoritySourceRef: scope.authoritySourceRef,
        authoritySourceFingerprint: scope.authoritySourceFingerprint,
        sourceClosureFingerprint: scope.sourceClosureFingerprint,
        reservedWageStatementVersionId: scope.reservedWageStatementVersionId,
        candidateBaselineSha: scope.candidateBaselineSha,
        permissionSnapshotFingerprint: scope.permissionSnapshotFingerprint,
        readSetFingerprint: scope.readSetFingerprint,
        createdByUserId: scope.createdByUserId,
        createdTransactionId: scope.createdTransactionId.toString(),
        createdAt: scope.createdAt.toISOString()
      }],
      scopeProjects: scope.projects.map((project) => ({
        ...project,
        createdTransactionId: project.createdTransactionId.toString(),
        createdAt: project.createdAt.toISOString()
      })),
      gaps: [{
        ...gap,
        createdTransactionId: gap.createdTransactionId.toString(),
        createdAt: gap.createdAt.toISOString()
      }],
      receipts: normalizedReceipts,
      manifestReceipts: [],
      mappingReceiptLines: mappingReceiptLines.map(normalizeLine).sort((left, right) => left.id.localeCompare(right.id)),
      activationCausedByLines: activationCausedByLines.map(normalizeLine).sort((left, right) => left.id.localeCompare(right.id)),
      activationReversedByLines: [],
      compensationReceipts: normalizedCompensationReceipts,
      causalSuccessors: normalizedCausalSuccessors
    };
  }

  private async readCanonicalWageDependencyFrontier(
    tx: Tx,
    statement: { id: string; currentRevision: number } | null
  ): Promise<Record<string, unknown>> {
    if (!statement) {
      return { statement: null, currentVersion: null, rootPayableRefs: [], envelopes: [] };
    }
    const currentVersion = statement.currentRevision > 0
      ? await tx.wageStatementVersion.findFirst({
          where: { statementId: statement.id, revision: statement.currentRevision },
          select: HISTORICAL_WAGE_PRIOR_VERSION_DEPENDENCY_SELECT
        })
      : null;
    const rootPayableRefs = await tx.wagePayableRef.findMany({
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
        confirmedVersionId: true,
        direction: true,
        amountCents: true,
        debtorCompanyId: true,
        costBearingCompanyId: true,
        projectId: true,
        confirmedVersion: {
          select: {
            id: true,
            revision: true,
            status: true,
            projectionOrigin: true
          }
        },
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
    });
    if (cCanonicalWageDependencyStructuralReason(statement, currentVersion, rootPayableRefs)) {
      throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE);
    }
    const envelopes = await tx.wageTakeoverProjectionEnvelope.findMany({
      where: { wageStatementVersion: { statementId: statement.id } },
      select: {
        id: true,
        atomicScopeVersionId: true,
        wageStatementVersionId: true,
        projectId: true,
        legacySourceType: true,
        legacySourceBusinessId: true,
        legacySourceVersion: true,
        legacySourceFingerprint: true,
        projectionOrigin: true,
        deltaDirection: true,
        canonicalFingerprint: true,
        payableRefs: { select: { payableRefId: true }, orderBy: { payableRefId: "asc" } },
        eligibilityRevocations: {
          select: { id: true, compensationReceiptId: true },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { id: "asc" }
    });
    return {
      statement,
      currentVersion: currentVersion
        ? {
            id: currentVersion.id,
            statementId: currentVersion.statementId,
            revision: currentVersion.revision,
            kind: currentVersion.kind,
            status: currentVersion.status,
            projectionOrigin: currentVersion.projectionOrigin,
            sourceVersionId: currentVersion.sourceVersionId,
            sourceSnapshotFingerprint: fingerprint(currentVersion.sourceSnapshot),
            operatingProjectionFingerprint: currentVersion.operatingProjectionSnapshot
              ? fingerprint(currentVersion.operatingProjectionSnapshot)
              : null,
            personLines: [...currentVersion.personLines]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((person) => ({
                id: person.id,
                employeeId: person.employeeId,
                employmentSnapshotId: person.employmentSnapshotId,
                costComponents: [...person.costComponents]
                  .sort((left, right) => left.id.localeCompare(right.id))
                  .map((component) => ({
                    ...component,
                    projectAllocations: [...component.projectAllocations]
                      .sort((left, right) => left.id.localeCompare(right.id))
                  })),
                creditorBreakdowns: [...person.creditorBreakdowns]
                  .sort((left, right) => left.id.localeCompare(right.id))
                  .map((creditor) => ({
                    ...creditor,
                    projectAllocations: [...creditor.projectAllocations]
                      .sort((left, right) => left.id.localeCompare(right.id))
                  })),
                projectAllocations: [...person.projectAllocations]
                  .sort((left, right) => left.id.localeCompare(right.id))
                  .map((allocation) => ({
                    ...allocation,
                    componentAllocations: [...allocation.componentAllocations]
                      .sort((left, right) => left.id.localeCompare(right.id)),
                    creditorAllocations: [...allocation.creditorAllocations]
                      .sort((left, right) => left.id.localeCompare(right.id))
                  }))
              }))
          }
        : null,
      rootPayableRefs: [...rootPayableRefs]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((root) => ({
          ...root,
          adjustments: [...root.adjustments]
            .sort((left, right) => left.id.localeCompare(right.id))
        })),
      envelopes
    };
  }

  private async readSummaryPriorLineageProof(
    tx: Tx,
    snapshot: HistoricalWageSummarySnapshotR2,
    currentAtomicScopeVersionId?: string
  ): Promise<HistoricalWageSummaryPriorLineageProof> {
    const bucketKey = summaryBucketKey(snapshot);
    const authorities = await tx.historicalWageSummaryAuthorityVersion.findMany({
      where: {
        summaryBucketKey: bucketKey,
        ...(currentAtomicScopeVersionId
          ? { atomicScopeVersionId: { not: currentAtomicScopeVersionId } }
          : {})
      },
      select: HISTORICAL_WAGE_PRIOR_SUMMARY_AUTHORITY_SELECT,
      orderBy: [{ revision: "asc" }, { id: "asc" }]
    });
    const authorityVersionIds = authorities.map((authority) => authority.id);
    const authorityCreditorLineIds = authorities.flatMap((authority) =>
      (authority.creditorLines ?? []).map((line) => line.id)
    );
    const atomicScopeVersionIds = sortedUnique(authorities.map((authority) => authority.atomicScopeVersionId));
    const rowMappingIds = authorities.flatMap((authority) =>
      (authority.takeoverMappings ?? []).map((mapping) => mapping.id)
    );
    const rootPayableRefIds = authorities.flatMap((authority) =>
      (authority.creditorLines ?? []).flatMap((line) => line.rootPayableRefId ? [line.rootPayableRefId] : [])
    );
    const payableOwnershipSelectors = [
      ...(authorityVersionIds.length ? [{ authorityVersionId: { in: authorityVersionIds } }] : []),
      ...(authorityCreditorLineIds.length
        ? [{ authorityCreditorLineId: { in: authorityCreditorLineIds } }]
        : []),
      ...(atomicScopeVersionIds.length ? [{ atomicScopeVersionId: { in: atomicScopeVersionIds } }] : []),
      ...(rowMappingIds.length ? [{ rowMappingId: { in: rowMappingIds } }] : []),
      ...(rootPayableRefIds.length ? [{ id: { in: rootPayableRefIds } }] : [])
    ];
    const ownedPayableRefs = payableOwnershipSelectors.length ? await tx.historicalWageSummaryPayableRef.findMany({
      where: {
        OR: payableOwnershipSelectors,
        ...(currentAtomicScopeVersionId
          ? { atomicScopeVersionId: { not: currentAtomicScopeVersionId } }
          : {})
      },
      select: HISTORICAL_WAGE_PRIOR_SUMMARY_PAYABLE_SELECT,
      orderBy: { id: "asc" }
    }) : [];
    const linkedPayableRefIds = sortedUnique([
      ...ownedPayableRefs.map((ref) => ref.id),
      ...ownedPayableRefs.flatMap((ref) => ref.adjustsSummaryPayableRefId
        ? [ref.adjustsSummaryPayableRefId]
        : [])
    ]);
    const reversePayableRefs = linkedPayableRefIds.length
      ? await tx.historicalWageSummaryPayableRef.findMany({
          where: {
            OR: [
              { id: { in: linkedPayableRefIds } },
              { adjustsSummaryPayableRefId: { in: linkedPayableRefIds } }
            ],
            ...(currentAtomicScopeVersionId
              ? { atomicScopeVersionId: { not: currentAtomicScopeVersionId } }
              : {})
          },
          select: HISTORICAL_WAGE_PRIOR_SUMMARY_PAYABLE_SELECT,
          orderBy: { id: "asc" }
        })
      : [];
    const payableRefs: HistoricalWagePriorSummaryPayableRef[] = [];
    for (const ref of [...ownedPayableRefs, ...reversePayableRefs]) {
      const existing = payableRefs.find((candidate) => candidate.id === ref.id);
      if (!existing || fingerprint(existing) !== fingerprint(ref)) payableRefs.push(ref);
    }
    payableRefs.sort((left, right) => left.id.localeCompare(right.id));
    const readSet = { authorities, payableRefs };
    const analysis = analyzeHistoricalWageSummaryPriorLineage(bucketKey, authorities, payableRefs);
    return {
      schemaVersion: 1,
      summaryBucketKey: bucketKey,
      state: analysis.state,
      reasonCode: analysis.reasonCode,
      activePriorAuthorityId: analysis.state === "active" ? authorities.at(-1)?.id ?? null : null,
      readSetFingerprint: fingerprint(readSet),
      readSet
    };
  }

  private async probeCApprovedSource(
    tx: Tx,
    source: HistoricalWageApprovedSourceCandidate,
    legacyNamespace: ResolvedLegacy[],
    statement: { id: string; currentRevision: number } | null,
    stableTargetWageStatementId: string,
    plannerDependencyReadSet: Record<string, unknown>
  ): Promise<HistoricalWageCApprovedSourceProbe> {
    const plannerInput = {
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      reservedTargetWageStatementId: stableTargetWageStatementId
    };
    const evidence = await tx.fileObject.findUnique({
      where: { id: source.evidenceFileId },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    const materializationDependencyReadSet = await this.readCMaterializationDependencyFrontier(tx, source);
    const base = {
      sourceVersionId: source.id,
      employmentCompanyId: source.employmentCompanyId,
      wageMonth: source.wageMonth,
      periodStart: source.periodStart?.toISOString() ?? null,
      periodEnd: source.periodEnd?.toISOString() ?? null,
      sourceType: source.sourceType ?? null,
      externalReference: source.externalReference ?? null,
      sourceVersion: source.sourceVersion ?? null,
      basisDate: source.basisDate?.toISOString() ?? null,
      sourceFingerprint: source.sourceFingerprint,
      sourceSnapshotFingerprint: fingerprint(source.sourceSnapshot),
      evidenceFile: evidenceFileReadSet(source.evidenceFileId, source.evidenceSha256, evidence),
      materializationDependencyReadSet,
      plannerInput,
      plannerDependencyReadSet
    };
    let rawWagePlan: Awaited<ReturnType<WageStatementService["planHistoricalTakeoverInTransaction"]>>;
    try {
      rawWagePlan = await this.wageStatements.planHistoricalTakeoverInTransaction(tx, plannerInput);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      return {
        ...base,
        plannerOutcome: {
          status: "rejected",
          reasonCode: "CANONICAL_WAGE_PLANNER_CONFLICT"
        },
        closureFingerprint: null,
        closureLegacyCoordinates: [],
        stablePlan: null,
        outcome: "canonical_ineligible",
        blockedReason: "CANONICAL_WAGE_PLANNER_CONFLICT"
      };
    }
    const wagePlan = canonicalCNegativePlannerResult(
      rawWagePlan,
      approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256)
    );
    const plannerOutcome = { status: "planned" as const, result: wagePlan };
    const projectDeltas: NonNullable<ScopePlan["projectDeltas"]> = [];
    let validDeltas = true;
    for (const project of wagePlan.projects) {
      let costDelta: bigint;
      let payableDelta: bigint;
      try {
        costDelta = BigInt(project.signedCostDeltaCents);
        payableDelta = BigInt(project.signedPayableDeltaCents);
      } catch {
        validDeltas = false;
        break;
      }
      if (costDelta !== payableDelta) {
        validDeltas = false;
        break;
      }
      if (costDelta !== 0n) {
        projectDeltas.push({
          projectId: project.projectId,
          direction: costDelta > 0n ? "increase" : "decrease",
          amountCents: costDelta > 0n ? costDelta : -costDelta
        });
      }
    }
    const closure: ResolvedLegacy[] = [];
    if (validDeltas && projectDeltas.length) {
      for (const delta of projectDeltas) {
        const matches = legacyNamespace.filter((item) =>
          item.projectId === delta.projectId &&
          item.direction === delta.direction &&
          item.amountCents === delta.amountCents
        );
        if (matches.length !== 1) {
          validDeltas = false;
          break;
        }
        closure.push(matches[0]!);
      }
    } else {
      validDeltas = false;
    }
    const projectIds = sortedUnique(wagePlan.projects.map((project) => project.projectId));
    const sortedClosure = closure.sort((left, right) => legacyCoordinateKey(left).localeCompare(legacyCoordinateKey(right)));
    if (!validDeltas || sortedClosure.length !== projectDeltas.length) {
      return {
        ...base,
        plannerOutcome,
        closureFingerprint: null,
        closureLegacyCoordinates: sortedClosure.map(legacyCoordinateKey),
        stablePlan: null,
        outcome: "incomplete",
        blockedReason: "A_LEGACY_CLOSURE_INCOMPLETE"
      };
    }
    const closureFingerprint = fingerprint({
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      projectIds,
      legacy: sortedClosure.map(legacyReadSet)
    });
    const probeBinding: HistoricalWageSelectionBinding = {
      actorUserId: "server-c-negative-probe",
      selectionFingerprint: fingerprint({
        policy: "pol219-c-negative-a-probe-v1",
        sourceVersionId: source.id,
        sourceFingerprint: source.sourceFingerprint,
        closureFingerprint
      }),
      grade: "A",
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      sourceClosureFingerprint: closureFingerprint,
      legacyCoordinates: sortedClosure.map(legacyCoordinate)
    };
    const plan = await this.preflightA(tx, probeBinding, sortedClosure, stableTargetWageStatementId);
    if (!plan?.wageReservation) {
      return {
        ...base,
        plannerOutcome,
        closureFingerprint,
        closureLegacyCoordinates: sortedClosure.map(legacyCoordinateKey),
        stablePlan: null,
        outcome: "canonical_ineligible",
        blockedReason: "A_CANONICAL_CLOSURE_DRIFT"
      };
    }
    const conflict = await this.crossSourceConflict(tx, plan, sortedClosure);
    return {
      ...base,
      plannerOutcome,
      closureFingerprint,
      closureLegacyCoordinates: sortedClosure.map(legacyCoordinateKey),
      stablePlan: {
        statement,
        plannerResult: wagePlan,
        projectIds: plan.projectIds ?? [],
        projectDeltas: plan.projectDeltas ?? [],
        adjustmentRootProofs: plan.adjustmentRootProofs ?? [],
        priorVersionEligibilityProof: plan.priorVersionEligibilityProof ?? null,
        sourceDeltaFingerprint: plan.wageReservation.sourceDeltaFingerprint,
        expectedCurrentRevision: plan.wageReservation.expectedCurrentRevision,
        reservedRevision: plan.wageReservation.reservedRevision,
        versionKind: plan.wageReservation.versionKind,
        priorConfirmedVersionId: plan.wageReservation.priorConfirmedVersionId,
        priorSourceVersionId: plan.wageReservation.priorSourceVersionId,
        canonicalRootClosureFingerprint: plan.wageReservation.canonicalRootClosureFingerprint,
        canonicalRootPayableRefIds: sortedUnique(wagePlan.canonicalRootPayableRefIds),
        materializationAuthorityReadSet: plan.materializationAuthorityReadSet!,
        conflictReadSet: plan.conflictReadSet ?? null
      },
      outcome: conflict ? "cross_source_blocked" : "eligible",
      blockedReason: conflict
    };
  }

  private async readCMaterializationDependencyFrontier(
    tx: Tx,
    source: HistoricalWageApprovedSourceCandidate
  ): Promise<HistoricalWageCMaterializationDependencyReadSet> {
    const people = approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256);
    const employeeIds = sortedUnique(people.map((person) => person.employeeId).filter(text));
    const projectIds = sortedUnique(people.flatMap((person) =>
      person.projectAllocations.map((allocation) => allocation.projectId)
    ).filter(text));
    const serviceBasisBindings = people
      .flatMap((person) => person.projectAllocations.map((allocation) => ({
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        serviceMonth: allocation.serviceMonth,
        evidenceSha256: allocation.serviceEvidenceSha256
      })))
      .sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)));
    const businessPartyVersionIds = materializationBusinessPartyVersionIds(source.sourceSnapshot);
    const [employmentCompany, employees, projects, actualServiceBasisBindings, businessPartyVersions] = await Promise.all([
      tx.companyEntity.findUnique({
        where: { id: source.employmentCompanyId, isActive: true },
        select: { id: true }
      }),
      tx.user.findMany({
        where: { id: { in: employeeIds }, isActive: true },
        select: { id: true, name: true, departmentId: true },
        orderBy: { id: "asc" }
      }),
      tx.project.findMany({
        where: { id: { in: projectIds }, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { id: "asc" }
      }),
      tx.wageServiceBasisBinding.findMany({
        where: { sourceVersionId: source.id },
        select: {
          id: true,
          projectId: true,
          serviceSnapshotId: true,
          serviceMonth: true,
          evidenceSha256: true,
          authorityFingerprint: true
        },
        orderBy: [{ projectId: "asc" }, { serviceSnapshotId: "asc" }, { id: "asc" }]
      }),
      tx.businessPartyVersion.findMany({
        where: { id: { in: businessPartyVersionIds } },
        select: { id: true, businessPartyId: true, versionNo: true, snapshot: true },
        orderBy: { id: "asc" }
      })
    ]);
    return {
      schemaVersion: 1,
      expected: {
        employmentCompanyId: source.employmentCompanyId,
        employeeIds,
        projectIds,
        serviceBasisBindings,
        businessPartyVersionIds
      },
      actual: {
        employmentCompany,
        employees: [...employees].sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
        projects: [...projects].sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
        serviceBasisBindings: [...actualServiceBasisBindings]
          .sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
        businessPartyVersions: [...businessPartyVersions]
          .sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
      }
    };
  }

  private async probeCSummary(tx: Tx, focus: ResolvedLegacy): Promise<HistoricalWageCSummaryProbe> {
    const snapshot = parseHistoricalWageSummarySnapshot(focus.legacySnapshot);
    if (!snapshot) return emptyCSummaryProbe();
    const evidenceFiles = await this.readEvidenceFileSet(tx, historicalSummaryEvidence(snapshot));
    const summaryFingerprint = historicalWageSummarySelectionFingerprint(snapshot);
    const priorLineageProof = await this.readSummaryPriorLineageProof(tx, snapshot);
    const probeBinding: HistoricalWageSelectionBinding = {
      actorUserId: "server-c-negative-probe",
      selectionFingerprint: fingerprint({
        policy: "pol219-c-negative-b-probe-v1",
        summaryFingerprint,
        legacy: legacyReadSet(focus)
      }),
      grade: "B",
      summaryFingerprint,
      legacyCoordinates: [legacyCoordinate(focus)]
    };
    const plan = await this.preflightB(tx, probeBinding, [focus], undefined, priorLineageProof);
    if (!plan?.summaryAuthority) {
      return {
        summaryFingerprint,
        summarySourceVersionFingerprint: snapshot.sourceVersionFingerprint,
        evidenceFiles,
        stablePlan: null,
        priorLineageProof,
        outcome: "authority_ineligible",
        blockedReason: priorLineageProof.state === "invalid" || priorLineageProof.state === "inactive_compensated"
          ? priorLineageProof.reasonCode
          : "B_SUMMARY_AUTHORITY_DRIFT"
      };
    }
    const conflict = await this.crossSourceConflict(tx, plan, [focus]);
    return {
      summaryFingerprint,
      summarySourceVersionFingerprint: snapshot.sourceVersionFingerprint,
      evidenceFiles,
      stablePlan: {
        summaryBucketKey: summaryBucketKey(plan.summaryAuthority),
        revision: plan.summaryAuthority.revision,
        supersedesVersionId: plan.summaryAuthority.supersedesVersionId,
        lineageRootAuthorityVersionId: plan.summaryAuthority.lineageRootAuthorityVersionId,
        sourceDeltaFingerprint: plan.summaryAuthority.sourceDeltaFingerprint,
        rootClosureFingerprint: plan.summaryAuthority.rootClosureFingerprint,
        lineDeltaFingerprints: (plan.summary ?? [])
          .map((line) => line.deltaFingerprint)
          .sort((left, right) => left.localeCompare(right))
      },
      priorLineageProof,
      outcome: conflict ? "cross_source_blocked" : "eligible",
      blockedReason: conflict
    };
  }

  private async readCConflictFrontier(
    tx: Tx,
    input: {
      employmentCompanyId: string;
      wageMonth: string;
      projectIds: string[];
      companyScoped: boolean;
    }
  ): Promise<HistoricalWageCConflictFrontier> {
    const projectIds = sortedUnique(input.projectIds);
    await lockWageConflictBuckets(tx, projectIds.map((projectId) => ({ projectId, wageMonth: input.wageMonth })));
    const contracts = await tx.projectAffiliateCompanyContract.findMany({
      where: {
        ...(input.companyScoped ? { companyEntityId: input.employmentCompanyId } : {}),
        projectId: { in: projectIds },
        status: "confirmed"
      },
      select: {
        id: true,
        projectId: true,
        companyEntityId: true,
        companyEntityVersionId: true,
        requestFingerprint: true,
        fileContentSha256Snapshot: true
      },
      orderBy: { id: "asc" }
    });
    const authorities = contracts.length ? await tx.affiliateClearingAuthorityVersion.findMany({
      where: {
        projectId: { in: projectIds },
        affiliateCompanyContractId: { in: contracts.map((contract) => contract.id) },
        status: "confirmed"
      },
      select: { id: true, affiliateCompanyContractId: true, authorityFingerprint: true },
      orderBy: { id: "asc" }
    }) : [];
    const candidateLines = authorities.length ? await tx.assignedWageAuthorityLine.findMany({
      where: {
        projectId: { in: projectIds },
        authorityVersionId: { in: authorities.map((authority) => authority.id) },
        wageMonth: new Date(`${input.wageMonth}-01T00:00:00.000Z`)
      },
      select: {
        id: true,
        authorityVersionId: true,
        projectId: true,
        coverageKind: true,
        personAuthorityKey: true,
        lineFingerprint: true
      },
      orderBy: { id: "asc" }
    }) : [];
    const mappings = candidateLines.length ? await tx.operatingTakeoverRowMapping.findMany({
      where: {
        adapterKind: "construction_enterprise_clearing",
        sourceDiscriminator: "construction_enterprise_assigned_wage",
        authorityVersionId: { in: authorities.map((authority) => authority.id) },
        authorityLineId: { in: candidateLines.map((line) => line.id) }
      },
      select: {
        id: true,
        manifestVersionId: true,
        authorityVersionId: true,
        authorityLineId: true
      },
      orderBy: { id: "asc" }
    }) : [];
    const activationReceipts = mappings.length ? await tx.operatingTakeoverCommandReceipt.findMany({
      where: {
        manifestVersionId: { in: sortedUnique(mappings.map((mapping) => mapping.manifestVersionId)) },
        action: "manifest.activate",
        status: "activated"
      },
      select: {
        id: true,
        manifestVersionId: true,
        lines: {
          where: {
            rowMappingId: { in: mappings.map((mapping) => mapping.id) },
            decision: "FORMAL"
          },
          select: { id: true, rowMappingId: true }
        },
        causedReceipts: {
          where: { action: "manifest.compensate", status: "compensated" },
          select: {
            id: true,
            causesReceiptId: true,
            lines: {
              select: { rowMappingId: true, reversesLineId: true }
            }
          }
        }
      },
      orderBy: { id: "asc" }
    }) : [];
    const activeMappingIds = new Set<string>();
    for (const receipt of activationReceipts) {
      const activationLinesById = new Map(receipt.lines.map((line) => [line.id, line]));
      const reversedActivationLineIds = new Set(receipt.causedReceipts
        .filter((compensation) => compensation.causesReceiptId === receipt.id)
        .flatMap((compensation) => compensation.lines)
        .flatMap((line) => {
          const activationLine = line.reversesLineId
            ? activationLinesById.get(line.reversesLineId)
            : undefined;
          return activationLine && activationLine.rowMappingId === line.rowMappingId
            ? [activationLine.id]
            : [];
        }));
      for (const line of receipt.lines) {
        if (!reversedActivationLineIds.has(line.id)) activeMappingIds.add(line.rowMappingId);
      }
    }
    const activeLineIds = new Set(mappings
      .filter((mapping) => activeMappingIds.has(mapping.id))
      .map((mapping) => mapping.authorityLineId)
      .filter((lineId): lineId is string => Boolean(lineId)));
    const lines = candidateLines.filter((line) => activeLineIds.has(line.id));
    const activeAuthorityIds = new Set(lines.map((line) => line.authorityVersionId));
    const activeAuthorities = authorities.filter((authority) => activeAuthorityIds.has(authority.id));
    const activeContractIds = new Set(activeAuthorities.map((authority) => authority.affiliateCompanyContractId));
    const activeContracts = contracts.filter((contract) => activeContractIds.has(contract.id));
    return {
      employmentCompanyId: input.employmentCompanyId,
      wageMonth: input.wageMonth,
      projectIds,
      contracts: activeContracts.sort((left, right) => left.id.localeCompare(right.id)),
      authorities: activeAuthorities.sort((left, right) => left.id.localeCompare(right.id)),
      lines: lines
        .map((line) => ({ ...line, personAuthorityKey: line.personAuthorityKey ?? null }))
        .sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  private async readEvidenceFileSet(
    tx: Tx,
    evidence: HistoricalEvidenceCoordinate[]
  ): Promise<HistoricalWageEvidenceFileReadSet[]> {
    const unique = [...new Map(evidence.map((item) => [
      `${item.fileObjectId}:${item.contentSha256}`,
      item
    ])).values()].sort((left, right) =>
      `${left.fileObjectId}:${left.contentSha256}`.localeCompare(`${right.fileObjectId}:${right.contentSha256}`)
    );
    const files = unique.length ? await tx.fileObject.findMany({
      where: { id: { in: sortedUnique(unique.map((item) => item.fileObjectId)) } },
      select: { id: true, storageStatus: true, contentSha256: true }
    }) : [];
    return unique.map((item) => evidenceFileReadSet(
      item.fileObjectId,
      item.contentSha256,
      files.find((file) => file.id === item.fileObjectId) ?? null
    ));
  }

  private async preflightA(
    tx: Tx,
    binding: HistoricalWageSelectionBinding,
    legacy: ResolvedLegacy[],
    reservedTargetWageStatementId?: string
  ): Promise<ScopePlan | null> {
    if (!binding.sourceVersionId || !binding.sourceFingerprint || !binding.sourceClosureFingerprint) return null;
    await this.lock(tx, `pol219:wage-source:${binding.sourceVersionId}`);
    const source = await tx.wageApprovedSourceVersion.findUnique({
      where: { id: binding.sourceVersionId },
      select: HISTORICAL_WAGE_APPROVED_SOURCE_SELECT
    });
    if (!source || source.sourceFingerprint !== binding.sourceFingerprint) return null;
    const evidence = await tx.fileObject.findUnique({
      where: { id: source.evidenceFileId },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    if (!evidence || evidence.storageStatus !== "active" || evidence.contentSha256 !== source.evidenceSha256) return null;
    const people = approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256);
    if (!people.length) return null;
    if (people.some((person) => !validApprovedPerson(person))) return null;
    const employmentCompanyIds = sortedUnique(people.map((person) => person.employmentCompanyId));
    if (employmentCompanyIds.length !== 1 || (source.employmentCompanyId && source.employmentCompanyId !== employmentCompanyIds[0])) return null;
    const materializationAuthorityReadSet = await this.readAMaterializationAuthorityCompany(
      tx,
      employmentCompanyIds[0]!,
      sortedUnique(people.map((person) => person.employeeId)),
      sortedUnique(people.flatMap((person) => person.projectAllocations.map((allocation) => allocation.projectId))),
      people,
      source.id,
      source.evidenceSha256,
      source.sourceSnapshot
    );
    if (!materializationAuthorityReadSet) return null;
    if (legacy.some((item) =>
      item.legacyWageMonth !== source.wageMonth ||
      item.employmentCompanyId !== employmentCompanyIds[0] ||
      (item.adjustmentRoot !== null && (
        item.adjustmentRoot.legacyWageMonth !== item.legacyWageMonth ||
        item.adjustmentRoot.employmentCompanyId !== item.employmentCompanyId
      ))
    )) return null;
    let wagePlan: Awaited<ReturnType<WageStatementService["planHistoricalTakeoverInTransaction"]>>;
    try {
      wagePlan = await this.wageStatements.planHistoricalTakeoverInTransaction(tx, {
        sourceVersionId: source.id,
        sourceFingerprint: source.sourceFingerprint,
        ...(reservedTargetWageStatementId ? { reservedTargetWageStatementId } : {})
      });
    } catch (error) {
      if (error instanceof ConflictException) return null;
      throw error;
    }
    wagePlan = canonicalCNegativePlannerResult(wagePlan, people);
    const sourceProjects = sortedUnique(wagePlan.projects.map((project) => project.projectId));
    if (!sourceProjects.length || sourceProjects.length !== wagePlan.projects.length) return null;
    const projectDeltas: NonNullable<ScopePlan["projectDeltas"]> = [];
    for (const project of wagePlan.projects) {
      let costDelta: bigint;
      let payableDelta: bigint;
      try {
        costDelta = BigInt(project.signedCostDeltaCents);
        payableDelta = BigInt(project.signedPayableDeltaCents);
      } catch {
        return null;
      }
      if (costDelta !== payableDelta) return null;
      if (costDelta !== 0n) {
        projectDeltas.push({
          projectId: project.projectId,
          direction: costDelta > 0n ? "increase" : "decrease",
          amountCents: costDelta > 0n ? costDelta : -costDelta
        });
      }
    }
    if (
      projectDeltas.length !== legacy.length ||
      projectDeltas.some((delta) => legacy.filter((item) => item.projectId === delta.projectId && item.direction === delta.direction && item.amountCents === delta.amountCents).length !== 1) ||
      legacy.some((item) => projectDeltas.filter((delta) => delta.projectId === item.projectId).length !== 1)
    ) return null;
    if (wagePlan.versionKind === "base" && legacy.some((item) => item.entryKind !== "original" || item.adjustmentRoot)) return null;
    if (wagePlan.versionKind !== "base" && legacy.some((item) => item.entryKind === "original" || !item.adjustmentRoot)) return null;
    const priorVersionEligibilityProof = wagePlan.versionKind === "base"
      ? null
      : await this.proveHistoricalPriorVersionEligibility(tx, wagePlan);
    if (wagePlan.versionKind !== "base" && !priorVersionEligibilityProof) return null;
    const adjustmentRootProofs = await this.proveHistoricalAdjustmentRoots(tx, legacy, wagePlan);
    if (!adjustmentRootProofs) return null;
    const sourceClosureFingerprint = fingerprint({
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      projectIds: sourceProjects,
      legacy: legacy.map(legacyReadSet)
    });
    if (sourceClosureFingerprint !== binding.sourceClosureFingerprint) return null;
    return {
      grade: "A",
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      sourceClosureFingerprint,
      projectIds: sourceProjects,
      projectDeltas,
      adjustmentRootProofs,
      priorVersionEligibilityProof,
      materializationAuthorityReadSet,
      wageReservation: {
        targetWageStatementId: wagePlan.targetWageStatementId,
        expectedCurrentRevision: wagePlan.expectedCurrentRevision,
        reservedRevision: wagePlan.reservedRevision,
        versionKind: wagePlan.versionKind,
        priorConfirmedVersionId: wagePlan.priorConfirmedVersionId,
        priorSourceVersionId: wagePlan.priorSourceVersionId,
        sourceDeltaFingerprint: wagePlan.sourceDeltaFingerprint,
        canonicalRootClosureFingerprint: wagePlan.canonicalRootClosureFingerprint
      }
    };
  }

  private async readAMaterializationAuthorityCompany(
    tx: Tx,
    employmentCompanyId: string,
    employeeIds: string[],
    projectIds: string[],
    people: ReturnType<typeof approvedSourcePeople>,
    sourceVersionId: string,
    sourceEvidenceSha256: string,
    sourceSnapshot: Prisma.JsonValue
  ): Promise<MaterializationAuthorityReadSet | null> {
    const expectedServiceBasisBindings = new Map<string, {
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      evidenceSha256: string;
    }>();
    for (const person of people) {
      for (const allocation of person.projectAllocations) {
        const key = materializationServiceBindingKey(allocation);
        const definition = {
          projectId: allocation.projectId,
          serviceSnapshotId: allocation.serviceSnapshotId,
          serviceMonth: allocation.serviceMonth,
          evidenceSha256: allocation.serviceEvidenceSha256
        };
        const existing = expectedServiceBasisBindings.get(key);
        if (
          !text(definition.serviceMonth) ||
          !SHA256.test(definition.evidenceSha256) ||
          definition.evidenceSha256.toLowerCase() !== sourceEvidenceSha256.toLowerCase() ||
          (existing && fingerprint(existing) !== fingerprint(definition))
        ) return null;
        expectedServiceBasisBindings.set(key, definition);
      }
    }
    const businessPartyVersionIds = materializationBusinessPartyVersionIds(sourceSnapshot);
    const [company, employees, projects, serviceBasisBindings, businessPartyVersions] = await Promise.all([
      tx.companyEntity.findUnique({
        where: { id: employmentCompanyId, isActive: true },
        select: { id: true }
      }),
      tx.user.findMany({
        where: { id: { in: employeeIds }, isActive: true },
        select: { id: true, name: true, departmentId: true },
        orderBy: { id: "asc" }
      }),
      tx.project.findMany({
        where: { id: { in: projectIds }, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { id: "asc" }
      }),
      tx.wageServiceBasisBinding.findMany({
        where: { sourceVersionId },
        select: {
          id: true,
          projectId: true,
          serviceSnapshotId: true,
          serviceMonth: true,
          evidenceSha256: true,
          authorityFingerprint: true
        },
        orderBy: [{ projectId: "asc" }, { serviceSnapshotId: "asc" }, { id: "asc" }]
      }),
      tx.businessPartyVersion.findMany({
        where: { id: { in: businessPartyVersionIds } },
        select: { id: true, businessPartyId: true, versionNo: true, snapshot: true },
        orderBy: { id: "asc" }
      })
    ]);
    const normalizedEmployees = [...employees].sort((left, right) => left.id.localeCompare(right.id));
    const normalizedProjects = [...projects].sort((left, right) => left.id.localeCompare(right.id));
    const normalizedServiceBasisBindings = [...serviceBasisBindings].sort((left, right) =>
      materializationServiceBindingKey(left).localeCompare(materializationServiceBindingKey(right))
    );
    const actualServiceBindingKeys = normalizedServiceBasisBindings.map(materializationServiceBindingKey);
    const normalizedBusinessPartyVersions = [...businessPartyVersions]
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      !company ||
      company.id !== employmentCompanyId ||
      employeeIds.length === 0 ||
      normalizedEmployees.length !== employeeIds.length ||
      new Set(normalizedEmployees.map((employee) => employee.id)).size !== employeeIds.length ||
      !sameStrings(normalizedEmployees.map((employee) => employee.id), employeeIds) ||
      projectIds.length === 0 ||
      normalizedProjects.length !== projectIds.length ||
      new Set(normalizedProjects.map((project) => project.id)).size !== projectIds.length ||
      !sameStrings(normalizedProjects.map((project) => project.id), projectIds) ||
      normalizedServiceBasisBindings.length !== expectedServiceBasisBindings.size ||
      new Set(actualServiceBindingKeys).size !== actualServiceBindingKeys.length ||
      new Set(normalizedServiceBasisBindings.map((binding) => binding.id)).size !== normalizedServiceBasisBindings.length ||
      normalizedServiceBasisBindings.some((binding) => {
        const expected = expectedServiceBasisBindings.get(materializationServiceBindingKey(binding));
        return !text(binding.id) ||
          !expected ||
          binding.projectId !== expected.projectId ||
          binding.serviceSnapshotId !== expected.serviceSnapshotId ||
          binding.serviceMonth !== expected.serviceMonth ||
          binding.evidenceSha256.toLowerCase() !== expected.evidenceSha256.toLowerCase() ||
          !SHA256.test(binding.authorityFingerprint) ||
          binding.authorityFingerprint !== fingerprint({
            sourceVersionId,
            projectId: binding.projectId,
            serviceSnapshotId: binding.serviceSnapshotId,
            serviceMonth: binding.serviceMonth,
            evidenceSha256: binding.evidenceSha256
          });
      }) ||
      normalizedBusinessPartyVersions.length !== businessPartyVersionIds.length ||
      new Set(normalizedBusinessPartyVersions.map((version) => version.id)).size !== businessPartyVersionIds.length ||
      !sameStrings(normalizedBusinessPartyVersions.map((version) => version.id), businessPartyVersionIds) ||
      normalizedBusinessPartyVersions.some((version) =>
        !text(version.businessPartyId) ||
        !Number.isInteger(version.versionNo) ||
        version.versionNo < 1 ||
        version.snapshot === null ||
        typeof version.snapshot !== "object"
      )
    ) return null;
    return {
      schemaVersion: 1,
      employmentCompany: { id: company.id },
      employees: normalizedEmployees,
      projects: normalizedProjects,
      serviceBasisBindings: normalizedServiceBasisBindings,
      businessPartyVersions: normalizedBusinessPartyVersions
    };
  }

  private async proveHistoricalPriorVersionEligibility(
    tx: Tx,
    wagePlan: Awaited<ReturnType<WageStatementService["planHistoricalTakeoverInTransaction"]>>
  ): Promise<HistoricalPriorVersionEligibilityProof | null> {
    if (
      wagePlan.versionKind === "base" ||
      !wagePlan.priorConfirmedVersionId ||
      !wagePlan.priorSourceVersionId ||
      wagePlan.expectedCurrentRevision < 1
    ) return null;
    const anchor = await tx.wageTakeoverWageStatementReservation.findUnique({
      where: { id: wagePlan.priorConfirmedVersionId },
      select: { id: true, atomicScopeVersionId: true }
    });
    if (!anchor) return null;
    await this.lock(tx, `pol219:scope:${anchor.atomicScopeVersionId}`);
    const reservation = await tx.wageTakeoverWageStatementReservation.findUnique({
      where: { id: wagePlan.priorConfirmedVersionId },
      select: {
        id: true,
        atomicScopeVersionId: true,
        targetWageStatementId: true,
        expectedCurrentRevision: true,
        reservedRevision: true,
        versionKind: true,
        priorConfirmedVersionId: true,
        priorSourceVersionId: true,
        sourceDeltaFingerprint: true,
        canonicalRootClosureFingerprint: true,
        createdAt: true,
        mappings: {
          select: {
            id: true,
            manifestVersionId: true,
            projectId: true,
            rowNo: true,
            wageStatementReservationId: true
          },
          orderBy: [{ manifestVersionId: "asc" }, { rowNo: "asc" }, { id: "asc" }]
        },
        atomicScope: {
          select: {
            id: true,
            scopeKind: true,
            authoritySourceRef: true,
            authoritySourceFingerprint: true,
            sourceClosureFingerprint: true,
            reservedWageStatementVersionId: true,
            candidateBaselineSha: true,
            permissionSnapshotFingerprint: true,
            readSetFingerprint: true,
            createdByUserId: true,
            createdTransactionId: true,
            createdAt: true,
            projects: {
              select: {
                id: true,
                atomicScopeVersionId: true,
                projectId: true,
                manifestVersionId: true,
                createdTransactionId: true,
                createdAt: true,
                manifest: {
                  select: {
                    id: true,
                    projectId: true,
                    atomicScopeVersionId: true,
                    adapterKind: true,
                    manifestNo: true,
                    version: true,
                    status: true,
                    sourceScopeFingerprint: true,
                    mapperName: true,
                    mapperVersion: true,
                    schemaVersion: true,
                    candidateBaselineSha: true,
                    permissionSnapshotFingerprint: true,
                    readSetFingerprint: true,
                    manifestFingerprint: true,
                    createdByUserId: true,
                    createdAt: true
                  }
                }
              },
              orderBy: [{ projectId: "asc" }, { id: "asc" }]
            },
            manifests: {
              select: {
                id: true,
                projectId: true,
                atomicScopeVersionId: true,
                rows: {
                  select: {
                    id: true,
                    manifestVersionId: true,
                    projectId: true,
                    rowNo: true,
                    wageStatementReservationId: true
                  },
                  orderBy: [{ rowNo: "asc" }, { id: "asc" }]
                }
              },
              orderBy: [{ projectId: "asc" }, { id: "asc" }]
            },
            receipts: {
              select: {
                id: true,
                manifestVersionId: true,
                atomicScopeVersionId: true,
                idempotencyKey: true,
                action: true,
                expectedRevision: true,
                actorUserId: true,
                delegatorUserId: true,
                actorSetSnapshot: true,
                permissionSnapshotFingerprint: true,
                fingerprint: true,
                status: true,
                commandSnapshotSchemaVersion: true,
                commandSnapshot: true,
                resultSnapshot: true,
                causesReceiptId: true,
                causalityFingerprint: true,
                createdTransactionId: true,
                createdAt: true,
                causedReceipts: {
                  select: {
                    id: true,
                    action: true,
                    status: true,
                    atomicScopeVersionId: true,
                    causesReceiptId: true
                  }
                },
                lines: {
                  select: {
                    id: true,
                    receiptId: true,
                    rowMappingId: true,
                    projectId: true,
                    lineNo: true,
                    amountCents: true,
                    causalOrdinal: true,
                    decision: true,
                    entryKind: true,
                    targetKind: true,
                    targetRef: true,
                    reversesLineId: true,
                    causesLineId: true,
                    causalityFingerprint: true,
                    lineSnapshot: true,
                    createdAt: true,
                    rowMapping: {
                      select: { id: true, manifestVersionId: true, projectId: true }
                    }
                  },
                  orderBy: [{ causalOrdinal: "asc" }, { lineNo: "asc" }, { id: "asc" }]
                }
              },
              orderBy: { id: "asc" }
            },
            wageProjectionEnvelopes: {
              select: {
                id: true,
                atomicScopeVersionId: true,
                manifestVersionId: true,
                wageStatementVersionId: true,
                rowMappingId: true,
                projectId: true,
                legacySourceType: true,
                legacySourceBusinessId: true,
                legacySourceVersion: true,
                canonicalFingerprint: true,
                legacySourceFingerprint: true,
                legacyImpactSnapshot: true,
                projectionOrigin: true,
                deltaDirection: true,
                createdTransactionId: true,
                createdAt: true,
                manifest: { select: { id: true, atomicScopeVersionId: true, projectId: true } },
                rowMapping: {
                  select: {
                    id: true,
                    manifestVersionId: true,
                    projectId: true,
                    rowNo: true,
                    adapterKind: true,
                    sourceType: true,
                    sourceBusinessId: true,
                    sourceVersion: true,
                    sourceFingerprint: true,
                    sourceCoordinate: true,
                    normalizedRowHash: true,
                    amountCents: true,
                    evidenceLevel: true,
                    coverageKind: true,
                    coverageKey: true,
                    periodStart: true,
                    entryKind: true,
                    mappingDecision: true,
                    conflictGroupKey: true,
                    adjustmentTargetRef: true,
                    sourceDiscriminator: true,
                    governedSubjectKey: true,
                    authorityCategory: true,
                    authoritySnapshotRef: true,
                    authorityFingerprint: true,
                    authorityVersionId: true,
                    authorityLineId: true,
                    authorityLineFingerprint: true,
                    obligationId: true,
                    authoritativeGrossCapCents: true,
                    currencyCode: true,
                    wageApprovedSourceVersionId: true,
                    wageStatementReservationId: true,
                    historicalWageSummaryAuthorityVersionId: true,
                    authoritySnapshot: true,
                    legacySourceSnapshot: true,
                    readSetSnapshot: true,
                    mappingFingerprint: true,
                    createdAt: true
                  }
                },
                reservation: { select: { id: true, atomicScopeVersionId: true } },
                costCells: {
                  select: { id: true, envelopeId: true, costCellId: true, direction: true, amountCents: true }
                },
                payableRefs: {
                  select: { id: true, envelopeId: true, payableRefId: true, direction: true, amountCents: true }
                },
                legacyImpactBridges: {
                  select: {
                    id: true,
                    envelopeId: true,
                    summaryAuthorityVersionId: true,
                    rowMappingId: true,
                    projectId: true,
                    legacyImpactEntryId: true,
                    impactKind: true,
                    direction: true,
                    amountCents: true,
                    sourceFingerprint: true,
                    createdTransactionId: true,
                    createdAt: true
                  }
                },
                eligibilityRevocations: {
                  select: {
                    id: true,
                    envelopeId: true,
                    compensationReceiptId: true,
                    reason: true,
                    createdTransactionId: true,
                    createdAt: true
                  }
                }
              },
              orderBy: { id: "asc" }
            }
          }
        }
      }
    });
    if (
      !reservation ||
      reservation.id !== wagePlan.priorConfirmedVersionId ||
      reservation.atomicScopeVersionId !== anchor.atomicScopeVersionId ||
      reservation.atomicScope.id !== anchor.atomicScopeVersionId ||
      reservation.atomicScope.scopeKind !== "historical_wage" ||
      reservation.targetWageStatementId !== wagePlan.targetWageStatementId ||
      reservation.reservedRevision !== wagePlan.expectedCurrentRevision ||
      reservation.atomicScope.authoritySourceRef !== wagePlan.priorSourceVersionId ||
      !SHA256.test(reservation.atomicScope.authoritySourceFingerprint) ||
      !SHA256.test(reservation.atomicScope.sourceClosureFingerprint) ||
      reservation.atomicScope.reservedWageStatementVersionId !== reservation.id ||
      !/^[0-9a-f]{40}$/iu.test(reservation.atomicScope.candidateBaselineSha) ||
      !SHA256.test(reservation.atomicScope.permissionSnapshotFingerprint) ||
      !SHA256.test(reservation.atomicScope.readSetFingerprint) ||
      !text(reservation.atomicScope.createdByUserId) ||
      typeof reservation.atomicScope.createdTransactionId !== "bigint" ||
      !validPriorGraphDate(reservation.atomicScope.createdAt) ||
      !Number.isInteger(reservation.expectedCurrentRevision) ||
      reservation.expectedCurrentRevision !== reservation.reservedRevision - 1 ||
      !["base", "correction", "reversal"].includes(reservation.versionKind) ||
      !SHA256.test(reservation.sourceDeltaFingerprint) ||
      !SHA256.test(reservation.canonicalRootClosureFingerprint) ||
      !validPriorGraphDate(reservation.createdAt) ||
      hasDuplicateValues(reservation.atomicScope.projects.map((project) => project.id)) ||
      hasDuplicateValues(reservation.atomicScope.projects.map((project) => project.projectId)) ||
      hasDuplicateValues(reservation.atomicScope.projects.map((project) => project.manifestVersionId)) ||
      reservation.atomicScope.projects.some((project) =>
        project.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        project.manifestVersionId !== project.manifest.id ||
        project.manifest.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        project.manifest.projectId !== project.projectId
      ) ||
      hasDuplicateValues(reservation.atomicScope.manifests.map((manifest) => manifest.id)) ||
      hasDuplicateValues(reservation.mappings.map((mapping) => mapping.id)) ||
      reservation.mappings.some((mapping) =>
        mapping.wageStatementReservationId !== reservation.id ||
        !Number.isInteger(mapping.rowNo) ||
        mapping.rowNo < 1 ||
        !reservation.atomicScope.manifests.some((manifest) =>
          manifest.id === mapping.manifestVersionId &&
          manifest.projectId === mapping.projectId
        )
      ) ||
      reservation.atomicScope.manifests.some((manifest) =>
        manifest.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        hasDuplicateValues(manifest.rows.map((mapping) => mapping.id)) ||
        manifest.rows.some((mapping) =>
          mapping.manifestVersionId !== manifest.id ||
          mapping.projectId !== manifest.projectId ||
          mapping.wageStatementReservationId !== reservation.id
        )
      ) ||
      hasDuplicateValues(
        reservation.atomicScope.manifests.flatMap((manifest) => manifest.rows.map((mapping) => mapping.id))
      ) ||
      hasDuplicateValues(reservation.atomicScope.receipts.map((receipt) => receipt.id))
    ) return null;
    const expectedLifecycle = [
      { action: "historical_wage_takeover.scope.create", status: "prepared", expectedRevision: 0 },
      { action: "historical_wage_takeover.scope.apply", status: "inactive_applied", expectedRevision: 1 },
      { action: "historical_wage_takeover.scope.activate", status: "activated", expectedRevision: 2 }
    ] as const;
    const sortedLifecycleReceipts = [...reservation.atomicScope.receipts].sort((left, right) =>
      left.expectedRevision - right.expectedRevision || left.action.localeCompare(right.action) || left.id.localeCompare(right.id)
    );
    if (
      sortedLifecycleReceipts.length !== expectedLifecycle.length ||
      hasDuplicateValues(sortedLifecycleReceipts.map((receipt) => receipt.action)) ||
      sortedLifecycleReceipts.some((receipt, index) =>
        receipt.action !== expectedLifecycle[index]!.action ||
        receipt.status !== expectedLifecycle[index]!.status ||
        receipt.expectedRevision !== expectedLifecycle[index]!.expectedRevision
      )
    ) return null;
    const [createReceipt, applyReceipt, activation] = sortedLifecycleReceipts;
    if (
      !createReceipt ||
      !applyReceipt ||
      !activation ||
      createReceipt.causesReceiptId !== null ||
      applyReceipt.causesReceiptId !== null ||
      (reservation.versionKind === "base"
        ? activation.causesReceiptId !== null
        : !text(activation.causesReceiptId)) ||
      sortedLifecycleReceipts.some((receipt) =>
        receipt.causedReceipts.length !== 0 ||
        receipt.manifestVersionId !== null ||
        receipt.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        !text(receipt.idempotencyKey) ||
        !text(receipt.actorUserId) ||
        (receipt.delegatorUserId !== null && !text(receipt.delegatorUserId)) ||
        !isPriorGraphSnapshot(receipt.actorSetSnapshot) ||
        !priorReceiptActorSetMatches(receipt) ||
        receipt.permissionSnapshotFingerprint !== reservation.atomicScope.permissionSnapshotFingerprint ||
        !priorReceiptCommandSnapshotMatches(receipt) ||
        !isPriorGraphSnapshot(receipt.resultSnapshot) ||
        !SHA256.test(receipt.causalityFingerprint) ||
        typeof receipt.createdTransactionId !== "bigint" ||
        !validPriorGraphDate(receipt.createdAt)
      )
    ) return null;
    const envelopes = reservation.atomicScope.wageProjectionEnvelopes;
    if (
      envelopes.length === 0 ||
      hasDuplicateValues(envelopes.map((envelope) => envelope.id)) ||
      hasDuplicateValues(envelopes.map((envelope) => envelope.rowMappingId)) ||
      hasDuplicateValues(envelopes.map((envelope) => `${envelope.projectId}:${envelope.legacySourceType}:${envelope.legacySourceBusinessId}:${envelope.legacySourceVersion}`)) ||
      envelopes.some((envelope) =>
        envelope.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        envelope.manifestVersionId !== envelope.manifest.id ||
        envelope.manifest.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        envelope.manifest.projectId !== envelope.projectId ||
        envelope.rowMappingId !== envelope.rowMapping.id ||
        envelope.rowMapping.manifestVersionId !== envelope.manifestVersionId ||
        envelope.rowMapping.projectId !== envelope.projectId ||
        !Number.isInteger(envelope.rowMapping.rowNo) ||
        envelope.rowMapping.rowNo < 1 ||
        envelope.rowMapping.adapterKind !== "historical_wage" ||
        envelope.rowMapping.sourceType !== envelope.legacySourceType ||
        envelope.rowMapping.sourceBusinessId !== envelope.legacySourceBusinessId ||
        envelope.rowMapping.sourceVersion !== envelope.legacySourceVersion ||
        envelope.rowMapping.sourceFingerprint !== envelope.legacySourceFingerprint ||
        envelope.rowMapping.evidenceLevel !== "A" ||
        envelope.rowMapping.mappingDecision !== "FORMAL" ||
        envelope.rowMapping.sourceDiscriminator !== "wage_statement_version" ||
        envelope.rowMapping.wageApprovedSourceVersionId !== reservation.atomicScope.authoritySourceRef ||
        envelope.rowMapping.wageStatementReservationId !== reservation.id ||
        envelope.rowMapping.historicalWageSummaryAuthorityVersionId !== null ||
        !isPriorGraphSnapshot(envelope.rowMapping.authoritySnapshot) ||
        !isPriorGraphSnapshot(envelope.rowMapping.legacySourceSnapshot) ||
        !isPriorGraphSnapshot(envelope.rowMapping.readSetSnapshot) ||
        !SHA256.test(envelope.rowMapping.mappingFingerprint) ||
        !validPriorGraphDate(envelope.rowMapping.createdAt) ||
        envelope.reservation.id !== reservation.id ||
        envelope.reservation.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        envelope.wageStatementVersionId !== wagePlan.priorConfirmedVersionId ||
        envelope.wageStatementVersionId !== reservation.id ||
        envelope.legacySourceType !== "project_wage" ||
        envelope.projectionOrigin !== "historical_takeover_legacy_link" ||
        !["increase", "decrease"].includes(envelope.deltaDirection) ||
        envelope.eligibilityRevocations.length !== 0 ||
        !SHA256.test(envelope.canonicalFingerprint) ||
        !SHA256.test(envelope.legacySourceFingerprint) ||
        !isPriorGraphSnapshot(envelope.legacyImpactSnapshot) ||
        typeof envelope.createdTransactionId !== "bigint" ||
        !validPriorGraphDate(envelope.createdAt) ||
        !text(envelope.legacySourceType) ||
        !text(envelope.legacySourceBusinessId) ||
        !Number.isInteger(envelope.legacySourceVersion) ||
        envelope.legacySourceVersion < 1 ||
        envelope.costCells.length === 0 ||
        envelope.payableRefs.length === 0 ||
        envelope.legacyImpactBridges.length !== 2
      ) ||
      activation.lines.length !== envelopes.length
    ) return null;
    const orderedEnvelopes = [...envelopes].sort((left, right) =>
      left.rowMapping.rowNo - right.rowMapping.rowNo || left.rowMapping.id.localeCompare(right.rowMapping.id)
    );
    if (
      hasDuplicateValues(orderedEnvelopes.map((envelope) => String(envelope.rowMapping.rowNo))) ||
      orderedEnvelopes.some((envelope, index) => envelope.rowMapping.rowNo !== index + 1)
    ) return null;
    const priorMappingReadSets = new Map<string, {
      legacy: ResolvedLegacy;
      legacyReadSetValue: ReturnType<typeof legacyReadSet>;
      planReadSetValue: Record<string, unknown>;
    }>();
    for (const envelope of orderedEnvelopes) {
      const mappingSnapshot = envelope.rowMapping.legacySourceSnapshot as Record<string, unknown>;
      const mappingReadSet = envelope.rowMapping.readSetSnapshot as Record<string, unknown>;
      const envelopeImpactSnapshot = envelope.legacyImpactSnapshot as Record<string, unknown>;
      if (
        !isPriorGraphSnapshot(mappingReadSet.plan) ||
        !isPriorGraphSnapshot(mappingReadSet.legacy) ||
        mappingReadSet.readSetFingerprint !== reservation.atomicScope.readSetFingerprint
      ) return null;
      let legacy: ResolvedLegacy;
      try {
        legacy = resolvedLegacyFromFrozenReadSet(mappingSnapshot);
      } catch {
        return null;
      }
      const legacyReadSetValue = legacyReadSet(legacy);
      const frozenLegacyReadSet = mappingReadSet.legacy as Record<string, unknown>;
      const mappingImpactSnapshot = {
        factId: mappingSnapshot.factId,
        costImpactId: mappingSnapshot.costImpactId,
        costImpactSnapshot: mappingSnapshot.costImpactSnapshot,
        costImpactFingerprint: mappingSnapshot.costImpactFingerprint,
        payableImpactId: mappingSnapshot.payableImpactId,
        payableImpactSnapshot: mappingSnapshot.payableImpactSnapshot,
        payableImpactFingerprint: mappingSnapshot.payableImpactFingerprint
      };
      if (
        envelope.rowMapping.amountCents !== legacy.amountCents ||
        legacy.projectId !== envelope.projectId ||
        legacy.sourceType !== envelope.legacySourceType ||
        legacy.sourceBusinessId !== envelope.legacySourceBusinessId ||
        legacy.sourceVersion !== envelope.legacySourceVersion ||
        legacy.sourceFingerprint !== envelope.legacySourceFingerprint ||
        legacy.direction !== envelope.deltaDirection ||
        envelope.rowMapping.sourceCoordinate !== `${legacy.sourceType}:${legacy.sourceBusinessId}:${legacy.sourceVersion}` ||
        envelope.rowMapping.normalizedRowHash !== fingerprint(legacyReadSetValue) ||
        envelope.rowMapping.coverageKind !== null ||
        envelope.rowMapping.coverageKey !== null ||
        envelope.rowMapping.periodStart !== null ||
        envelope.rowMapping.entryKind !== "formal" ||
        envelope.rowMapping.conflictGroupKey !== `wage:${envelope.projectId}:${reservation.atomicScope.authoritySourceRef}` ||
        envelope.rowMapping.adjustmentTargetRef !== legacy.adjustsFactId ||
        envelope.rowMapping.governedSubjectKey !== null ||
        envelope.rowMapping.authorityCategory !== null ||
        envelope.rowMapping.authoritySnapshotRef !== null ||
        envelope.rowMapping.authorityFingerprint !== null ||
        envelope.rowMapping.authorityVersionId !== null ||
        envelope.rowMapping.authorityLineId !== null ||
        envelope.rowMapping.authorityLineFingerprint !== null ||
        envelope.rowMapping.obligationId !== null ||
        envelope.rowMapping.authoritativeGrossCapCents !== null ||
        envelope.rowMapping.currencyCode !== null ||
        strictJcs(envelope.rowMapping.authoritySnapshot) !== strictJcs({}) ||
        envelope.rowMapping.mappingFingerprint !== fingerprint({
          scopeId: reservation.atomicScopeVersionId,
          projectId: envelope.projectId,
          plan: mappingReadSet.plan,
          legacy: legacyReadSetValue
        }) ||
        !isPriorGraphSnapshot(mappingSnapshot.costImpactSnapshot) ||
        !isPriorGraphSnapshot(mappingSnapshot.payableImpactSnapshot) ||
        !isPriorGraphSnapshot(envelopeImpactSnapshot.costImpactSnapshot) ||
        !isPriorGraphSnapshot(envelopeImpactSnapshot.payableImpactSnapshot) ||
        !SHA256.test(stringOrEmpty(mappingSnapshot.costImpactFingerprint)) ||
        !SHA256.test(stringOrEmpty(mappingSnapshot.payableImpactFingerprint)) ||
        fingerprint(frozenLegacyReadSet) !== fingerprint(legacyReadSetValue) ||
        strictJcs(mappingImpactSnapshot) !== strictJcs(envelopeImpactSnapshot)
      ) return null;
      priorMappingReadSets.set(envelope.rowMappingId, {
        legacy,
        legacyReadSetValue,
        planReadSetValue: mappingReadSet.plan as Record<string, unknown>
      });
    }
    const frozenPlanReadSet = priorMappingReadSets.get(orderedEnvelopes[0]!.rowMappingId)!.planReadSetValue;
    if (
      frozenPlanReadSet.grade !== "A" ||
      frozenPlanReadSet.sourceVersionId !== reservation.atomicScope.authoritySourceRef ||
      frozenPlanReadSet.sourceFingerprint !== reservation.atomicScope.authoritySourceFingerprint ||
      frozenPlanReadSet.sourceClosureFingerprint !== reservation.atomicScope.sourceClosureFingerprint ||
      orderedEnvelopes.some((envelope) =>
        fingerprint(priorMappingReadSets.get(envelope.rowMappingId)!.planReadSetValue) !== fingerprint(frozenPlanReadSet)
      )
    ) return null;
    const scopeProjects = reservation.atomicScope.projects;
    const sortedScopeProjects = [...scopeProjects].sort((left, right) =>
      left.projectId.localeCompare(right.projectId) || left.id.localeCompare(right.id)
    );
    const scopeManifests = reservation.atomicScope.manifests;
    const sortedScopeManifests = [...scopeManifests].sort((left, right) =>
      left.projectId.localeCompare(right.projectId) || left.id.localeCompare(right.id)
    );
    const expectedProjectIds = sortedUnique(orderedEnvelopes.map((envelope) => envelope.projectId));
    const mappingOwnershipKey = (mapping: {
      id: string;
      manifestVersionId: string;
      projectId: string;
      rowNo: number;
      wageStatementReservationId: string | null;
    }) => strictJcs({
      id: mapping.id,
      manifestVersionId: mapping.manifestVersionId,
      projectId: mapping.projectId,
      rowNo: mapping.rowNo,
      wageStatementReservationId: mapping.wageStatementReservationId
    });
    const compareMappingOwnership = (
      left: Parameters<typeof mappingOwnershipKey>[0],
      right: Parameters<typeof mappingOwnershipKey>[0]
    ) => mappingOwnershipKey(left).localeCompare(mappingOwnershipKey(right));
    const reverseReservationMappings = [...reservation.mappings].sort(compareMappingOwnership);
    const reverseManifestMappings = sortedScopeManifests
      .flatMap((manifest) => manifest.rows)
      .sort(compareMappingOwnership)
      .map((mapping) => ({ ...mapping }));
    const envelopeMappingOwnership = orderedEnvelopes.map((envelope) => ({
      id: envelope.rowMapping.id,
      manifestVersionId: envelope.rowMapping.manifestVersionId,
      projectId: envelope.rowMapping.projectId,
      rowNo: envelope.rowMapping.rowNo,
      wageStatementReservationId: envelope.rowMapping.wageStatementReservationId
    })).sort(compareMappingOwnership);
    if (
      scopeProjects.length === 0 ||
      scopeManifests.length !== scopeProjects.length ||
      scopeManifests.some((manifest) => manifest.atomicScopeVersionId !== reservation.atomicScopeVersionId) ||
      !sameStrings(
        sortedScopeManifests.map((manifest) => strictJcs({
          id: manifest.id,
          projectId: manifest.projectId,
          atomicScopeVersionId: manifest.atomicScopeVersionId
        })),
        sortedScopeProjects.map((project) => strictJcs({
          id: project.manifest.id,
          projectId: project.manifest.projectId,
          atomicScopeVersionId: project.manifest.atomicScopeVersionId
        }))
      ) ||
      !sameStrings(
        reverseReservationMappings.map(mappingOwnershipKey),
        envelopeMappingOwnership.map(mappingOwnershipKey)
      ) ||
      !sameStrings(
        reverseManifestMappings.map(mappingOwnershipKey),
        envelopeMappingOwnership.map(mappingOwnershipKey)
      ) ||
      !sameStrings(sortedScopeProjects.map((project) => project.projectId), expectedProjectIds) ||
      !Array.isArray(frozenPlanReadSet.projectIds) ||
      frozenPlanReadSet.projectIds.length !== expectedProjectIds.length ||
      frozenPlanReadSet.projectIds.some((value) => typeof value !== "string") ||
      !sameStrings(sortedUnique(frozenPlanReadSet.projectIds.filter((value): value is string => typeof value === "string")), expectedProjectIds) ||
      sortedScopeProjects.some((project) => {
        const projectEnvelopes = orderedEnvelopes.filter((envelope) => envelope.projectId === project.projectId);
        const projectLegacy = projectEnvelopes.map((envelope) => priorMappingReadSets.get(envelope.rowMappingId)!.legacyReadSetValue);
        return project.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
          project.manifestVersionId !== project.manifest.id ||
          typeof project.createdTransactionId !== "bigint" ||
          !validPriorGraphDate(project.createdAt) ||
          project.manifest.projectId !== project.projectId ||
          project.manifest.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
          project.manifest.adapterKind !== "historical_wage" ||
          !text(project.manifest.manifestNo) ||
          project.manifest.version !== 1 ||
          project.manifest.status !== "prepared" ||
          project.manifest.sourceScopeFingerprint !== fingerprint(projectLegacy) ||
          project.manifest.mapperName !== MAPPER_NAME ||
          project.manifest.mapperVersion !== MAPPER_VERSION ||
          project.manifest.schemaVersion !== SCHEMA_VERSION ||
          project.manifest.candidateBaselineSha !== reservation.atomicScope.candidateBaselineSha ||
          project.manifest.permissionSnapshotFingerprint !== reservation.atomicScope.permissionSnapshotFingerprint ||
          project.manifest.readSetFingerprint !== reservation.atomicScope.readSetFingerprint ||
          project.manifest.manifestFingerprint !== fingerprint({
            scopeId: reservation.atomicScopeVersionId,
            projectId: project.projectId,
            plan: frozenPlanReadSet,
            rows: projectLegacy
          }) ||
          project.manifest.createdByUserId !== reservation.atomicScope.createdByUserId ||
          !validPriorGraphDate(project.manifest.createdAt) ||
          projectEnvelopes.some((envelope) => envelope.manifestVersionId !== project.manifestVersionId);
      })
    ) return null;
    const allCostCells = envelopes.flatMap((envelope) => envelope.costCells);
    const allPayableRefs = envelopes.flatMap((envelope) => envelope.payableRefs);
    const allImpactBridges = envelopes.flatMap((envelope) => envelope.legacyImpactBridges);
    if (
      hasDuplicateValues(allCostCells.map((cell) => cell.id)) ||
      hasDuplicateValues(allCostCells.map((cell) => cell.costCellId)) ||
      hasDuplicateValues(allPayableRefs.map((ref) => ref.id)) ||
      hasDuplicateValues(allPayableRefs.map((ref) => ref.payableRefId)) ||
      hasDuplicateValues(allImpactBridges.map((bridge) => bridge.id)) ||
      hasDuplicateValues(allImpactBridges.map((bridge) => bridge.legacyImpactEntryId)) ||
      hasDuplicateValues(allImpactBridges.map((bridge) => `${bridge.envelopeId}:${bridge.impactKind}`))
    ) return null;
    const envelopeIds = envelopes.map((envelope) => envelope.id);
    const rowMappingIds = envelopes.map((envelope) => envelope.rowMappingId);
    const bridges = await tx.operatingTakeoverLegacySourceBridge.findMany({
      where: {
        OR: [
          { rowMappingId: { in: rowMappingIds } },
          { targetKind: "wage_takeover_projection_envelope", targetRef: { in: envelopeIds } }
        ]
      },
      select: {
        id: true,
        projectId: true,
        rowMappingId: true,
        sourceType: true,
        sourceBusinessId: true,
        sourceVersion: true,
        sourceFingerprint: true,
        targetKind: true,
        targetRef: true,
        targetFingerprint: true,
        mappingDecision: true,
        createdByUserId: true,
        createdTransactionId: true,
        createdAt: true
      },
      orderBy: { id: "asc" }
    });
    if (
      bridges.length !== envelopes.length ||
      hasDuplicateValues(bridges.map((bridge) => bridge.id)) ||
      hasDuplicateValues(bridges.map((bridge) => bridge.rowMappingId)) ||
      hasDuplicateValues(bridges.map((bridge) => `${bridge.projectId}:${bridge.sourceType}:${bridge.sourceBusinessId}:${bridge.sourceVersion}`)) ||
      hasDuplicateValues(bridges.map((bridge) => `${bridge.projectId}:${bridge.targetKind}:${bridge.targetRef}`))
    ) return null;
    const sortedEnvelopes = [...envelopes].sort((left, right) => left.id.localeCompare(right.id));
    const sortedActivationLines = [...activation.lines].sort((left, right) =>
      left.causalOrdinal - right.causalOrdinal || left.lineNo - right.lineNo || left.id.localeCompare(right.id)
    );
    if (
      hasDuplicateValues(sortedActivationLines.map((line) => line.id)) ||
      hasDuplicateValues(sortedActivationLines.map((line) => line.rowMappingId)) ||
      hasDuplicateValues(sortedActivationLines.map((line) => String(line.lineNo))) ||
      hasDuplicateValues(sortedActivationLines.map((line) => String(line.causalOrdinal))) ||
      sortedActivationLines.some((line, index) => line.lineNo !== index + 1 || line.causalOrdinal !== index + 1)
    ) return null;
    const activeEnvelopes: HistoricalPriorVersionEligibilityProof["activeEnvelopes"] = [];
    for (const envelope of sortedEnvelopes) {
      const bridge = bridges.find((candidate) => candidate.targetRef === envelope.id);
      const activationLine = sortedActivationLines.find((line) => line.targetRef === envelope.id);
      const expectedTargetFingerprint = historicalWageEnvelopeTargetFingerprint(envelope);
      const impactSnapshot = envelope.legacyImpactSnapshot as Record<string, unknown>;
      const costImpactId = typeof impactSnapshot.costImpactId === "string" ? impactSnapshot.costImpactId : "";
      const payableImpactId = typeof impactSnapshot.payableImpactId === "string" ? impactSnapshot.payableImpactId : "";
      const costImpactFingerprint = typeof impactSnapshot.costImpactFingerprint === "string" ? impactSnapshot.costImpactFingerprint : "";
      const payableImpactFingerprint = typeof impactSnapshot.payableImpactFingerprint === "string" ? impactSnapshot.payableImpactFingerprint : "";
      const costBridge = envelope.legacyImpactBridges.find((candidate) => candidate.impactKind === "confirmed_cost");
      const payableImpactKind = envelope.deltaDirection === "increase" ? "payable_increase" : "payable_decrease";
      const payableBridge = envelope.legacyImpactBridges.find((candidate) => candidate.impactKind === payableImpactKind);
      const expectedCostImpactFingerprint = costBridge
        ? fingerprint({
            legacySourceFingerprint: envelope.legacySourceFingerprint,
            legacyImpactEntryId: costImpactId,
            impactKind: "confirmed_cost",
            direction: envelope.deltaDirection,
            amountCents: costBridge.amountCents,
            impactSnapshot: impactSnapshot.costImpactSnapshot
          })
        : "";
      const expectedPayableImpactFingerprint = payableBridge
        ? fingerprint({
            legacySourceFingerprint: envelope.legacySourceFingerprint,
            legacyImpactEntryId: payableImpactId,
            impactKind: payableImpactKind,
            direction: envelope.deltaDirection,
            amountCents: payableBridge.amountCents,
            impactSnapshot: impactSnapshot.payableImpactSnapshot
          })
        : "";
      if (
        !bridge ||
        bridge.mappingDecision !== "FORMAL" ||
        bridge.targetKind !== "wage_takeover_projection_envelope" ||
        bridge.projectId !== envelope.projectId ||
        bridge.rowMappingId !== envelope.rowMappingId ||
        bridge.sourceType !== envelope.legacySourceType ||
        bridge.sourceBusinessId !== envelope.legacySourceBusinessId ||
        bridge.sourceVersion !== envelope.legacySourceVersion ||
        bridge.sourceFingerprint !== envelope.legacySourceFingerprint ||
        bridge.targetFingerprint !== expectedTargetFingerprint ||
        !text(bridge.createdByUserId) ||
        (bridge.createdTransactionId !== null && typeof bridge.createdTransactionId !== "bigint") ||
        !validPriorGraphDate(bridge.createdAt) ||
        !costBridge ||
        !payableBridge ||
        !text(impactSnapshot.factId) ||
        !text(costImpactId) ||
        !text(payableImpactId) ||
        costImpactId === payableImpactId ||
        !isPriorGraphSnapshot(impactSnapshot.costImpactSnapshot) ||
        !isPriorGraphSnapshot(impactSnapshot.payableImpactSnapshot) ||
        !SHA256.test(costImpactFingerprint) ||
        !SHA256.test(payableImpactFingerprint) ||
        costImpactFingerprint !== expectedCostImpactFingerprint ||
        payableImpactFingerprint !== expectedPayableImpactFingerprint ||
        costBridge.sourceFingerprint !== expectedCostImpactFingerprint ||
        payableBridge.sourceFingerprint !== expectedPayableImpactFingerprint ||
        costBridge.envelopeId !== envelope.id ||
        payableBridge.envelopeId !== envelope.id ||
        costBridge.summaryAuthorityVersionId !== null ||
        payableBridge.summaryAuthorityVersionId !== null ||
        costBridge.rowMappingId !== envelope.rowMappingId ||
        payableBridge.rowMappingId !== envelope.rowMappingId ||
        costBridge.projectId !== envelope.projectId ||
        payableBridge.projectId !== envelope.projectId ||
        costBridge.legacyImpactEntryId !== costImpactId ||
        payableBridge.legacyImpactEntryId !== payableImpactId ||
        costBridge.direction !== envelope.deltaDirection ||
        payableBridge.direction !== envelope.deltaDirection ||
        costBridge.amountCents !== payableBridge.amountCents ||
        typeof costBridge.createdTransactionId !== "bigint" ||
        typeof payableBridge.createdTransactionId !== "bigint" ||
        !validPriorGraphDate(costBridge.createdAt) ||
        !validPriorGraphDate(payableBridge.createdAt) ||
        envelope.costCells.some((cell) =>
          cell.envelopeId !== envelope.id ||
          !text(cell.id) ||
          !text(cell.costCellId) ||
          !["increase", "decrease"].includes(cell.direction) ||
          cell.amountCents <= 0n
        ) ||
        envelope.payableRefs.some((ref) =>
          ref.envelopeId !== envelope.id ||
          !text(ref.id) ||
          !text(ref.payableRefId) ||
          !["increase", "decrease"].includes(ref.direction) ||
          ref.amountCents <= 0n
        ) ||
        signedPriorGraphTotal(envelope.costCells) !== signedPriorGraphAmount(envelope.deltaDirection, costBridge.amountCents) ||
        signedPriorGraphTotal(envelope.payableRefs) !== signedPriorGraphAmount(envelope.deltaDirection, payableBridge.amountCents) ||
        !activationLine ||
        activationLine.receiptId !== activation.id ||
        activationLine.rowMappingId !== envelope.rowMappingId ||
        activationLine.rowMapping.id !== envelope.rowMappingId ||
        activationLine.rowMapping.manifestVersionId !== envelope.manifestVersionId ||
        activationLine.rowMapping.projectId !== envelope.projectId ||
        activationLine.projectId !== envelope.projectId ||
        activationLine.decision !== "FORMAL" ||
        activationLine.entryKind !== "historical_wage" ||
        activationLine.amountCents !== costBridge.amountCents ||
        activationLine.targetKind !== "wage_takeover_projection_envelope" ||
        activationLine.targetRef !== envelope.id ||
        activationLine.reversesLineId !== null ||
        activationLine.causesLineId !== null ||
        !SHA256.test(activationLine.causalityFingerprint) ||
        !isPriorGraphSnapshot(activationLine.lineSnapshot) ||
        !validPriorGraphDate(activationLine.createdAt)
      ) return null;
      activeEnvelopes.push({
        envelopeId: envelope.id,
        rowMappingId: envelope.rowMappingId,
        projectId: envelope.projectId,
        canonicalFingerprint: envelope.canonicalFingerprint,
        bridgeId: bridge.id,
        bridgeTargetFingerprint: bridge.targetFingerprint
      });
    }
    const allReceiptLines = sortedLifecycleReceipts.flatMap((receipt) => receipt.lines);
    if (hasDuplicateValues(allReceiptLines.map((line) => line.id))) return null;
    for (const receipt of sortedLifecycleReceipts) {
      const sortedLines = [...receipt.lines].sort((left, right) =>
        left.lineNo - right.lineNo || left.causalOrdinal - right.causalOrdinal || left.id.localeCompare(right.id)
      );
      if (
        sortedLines.length !== orderedEnvelopes.length ||
        hasDuplicateValues(sortedLines.map((line) => line.rowMappingId)) ||
        hasDuplicateValues(sortedLines.map((line) => String(line.lineNo))) ||
        hasDuplicateValues(sortedLines.map((line) => String(line.causalOrdinal))) ||
        receipt.causalityFingerprint !== fingerprint({
          action: receipt.action,
          atomicScopeVersionId: reservation.atomicScopeVersionId,
          commandFingerprint: receipt.fingerprint,
          mappings: orderedEnvelopes.map((envelope) => envelope.rowMappingId)
        })
      ) return null;
      for (const [index, line] of sortedLines.entries()) {
        const envelope = orderedEnvelopes[index]!;
        const mappingReadSet = priorMappingReadSets.get(envelope.rowMappingId)!;
        const isActivation = receipt.action === "historical_wage_takeover.scope.activate";
        if (
          line.receiptId !== receipt.id ||
          line.rowMappingId !== envelope.rowMappingId ||
          line.rowMapping.id !== envelope.rowMappingId ||
          line.rowMapping.manifestVersionId !== envelope.manifestVersionId ||
          line.rowMapping.projectId !== envelope.projectId ||
          line.projectId !== envelope.projectId ||
          line.lineNo !== index + 1 ||
          line.causalOrdinal !== index + 1 ||
          line.decision !== (receipt.action === "historical_wage_takeover.scope.create"
            ? "PREPARED"
            : receipt.action === "historical_wage_takeover.scope.apply"
              ? "inactive_applied"
              : "FORMAL") ||
          line.entryKind !== "historical_wage" ||
          line.amountCents !== mappingReadSet.legacy.amountCents ||
          (isActivation
            ? line.targetKind !== "wage_takeover_projection_envelope" || line.targetRef !== envelope.id
            : line.targetKind !== null || line.targetRef !== null) ||
          line.reversesLineId !== null ||
          line.causesLineId !== null ||
          line.causalityFingerprint !== fingerprint({
            receiptId: receipt.id,
            mappingId: envelope.rowMappingId,
            causalOrdinal: index + 1,
            causesLineId: null,
            causeLineFingerprint: null
          }) ||
          fingerprint(line.lineSnapshot) !== fingerprint(mappingReadSet.legacyReadSetValue) ||
          !validPriorGraphDate(line.createdAt)
        ) return null;
      }
      const result = receipt.resultSnapshot as Record<string, unknown>;
      if (
        result.atomicScopeVersionId !== reservation.atomicScopeVersionId ||
        result.grade !== "A" ||
        result.status !== receipt.status ||
        (receipt.action === "historical_wage_takeover.scope.create" && (
          result.projectCount !== sortedScopeProjects.length ||
          result.rowCount !== orderedEnvelopes.length ||
          !text(result.commandSelectionRef)
        )) ||
        (receipt.action === "historical_wage_takeover.scope.apply" && (
          result.revision !== 2 ||
          result.rowCount !== orderedEnvelopes.length
        )) ||
        (receipt.action === "historical_wage_takeover.scope.activate" && (
          result.revision !== 3 ||
          !Array.isArray(result.rows) ||
          fingerprint(result.rows) !== fingerprint(orderedEnvelopes.map((envelope) => ({
            projectId: envelope.projectId,
            decision: "FORMAL",
            targetKind: "wage_takeover_projection_envelope",
            targetRef: envelope.id
          })))
        ))
      ) return null;
    }
    const priorCanonicalGraph: HistoricalPriorCanonicalGraph = {
      schemaVersion: 1,
      reservation: {
        id: reservation.id,
        atomicScopeVersionId: reservation.atomicScopeVersionId,
        targetWageStatementId: reservation.targetWageStatementId,
        expectedCurrentRevision: reservation.expectedCurrentRevision,
        reservedRevision: reservation.reservedRevision,
        versionKind: reservation.versionKind,
        priorConfirmedVersionId: reservation.priorConfirmedVersionId,
        priorSourceVersionId: reservation.priorSourceVersionId,
        sourceDeltaFingerprint: reservation.sourceDeltaFingerprint,
        canonicalRootClosureFingerprint: reservation.canonicalRootClosureFingerprint,
        createdAt: reservation.createdAt.toISOString(),
        mappings: reverseReservationMappings.map((mapping) => ({ ...mapping }))
      },
      scope: {
        id: reservation.atomicScope.id,
        scopeKind: reservation.atomicScope.scopeKind,
        authoritySourceRef: reservation.atomicScope.authoritySourceRef,
        authoritySourceFingerprint: reservation.atomicScope.authoritySourceFingerprint,
        sourceClosureFingerprint: reservation.atomicScope.sourceClosureFingerprint,
        reservedWageStatementVersionId: reservation.atomicScope.reservedWageStatementVersionId,
        candidateBaselineSha: reservation.atomicScope.candidateBaselineSha,
        permissionSnapshotFingerprint: reservation.atomicScope.permissionSnapshotFingerprint,
        readSetFingerprint: reservation.atomicScope.readSetFingerprint,
        createdByUserId: reservation.atomicScope.createdByUserId,
        createdTransactionId: reservation.atomicScope.createdTransactionId.toString(),
        createdAt: reservation.atomicScope.createdAt.toISOString(),
        manifests: sortedScopeManifests.map((manifest) => ({
          id: manifest.id,
          projectId: manifest.projectId,
          atomicScopeVersionId: manifest.atomicScopeVersionId,
          rows: [...manifest.rows]
            .sort(compareMappingOwnership)
            .map((mapping) => ({ ...mapping }))
        })),
        projects: sortedScopeProjects.map((project) => ({
          id: project.id,
          atomicScopeVersionId: project.atomicScopeVersionId,
          projectId: project.projectId,
          manifestVersionId: project.manifestVersionId,
          createdTransactionId: project.createdTransactionId.toString(),
          createdAt: project.createdAt.toISOString(),
          manifest: {
            ...project.manifest,
            createdAt: project.manifest.createdAt.toISOString()
          }
        }))
      },
      envelopes: sortedEnvelopes.map((envelope) => ({
        id: envelope.id,
        atomicScopeVersionId: envelope.atomicScopeVersionId,
        manifestVersionId: envelope.manifestVersionId,
        rowMappingId: envelope.rowMappingId,
        wageStatementVersionId: envelope.wageStatementVersionId,
        projectId: envelope.projectId,
        legacySourceType: envelope.legacySourceType,
        legacySourceBusinessId: envelope.legacySourceBusinessId,
        legacySourceVersion: envelope.legacySourceVersion,
        legacySourceFingerprint: envelope.legacySourceFingerprint,
        legacyImpactSnapshot: envelope.legacyImpactSnapshot,
        projectionOrigin: envelope.projectionOrigin,
        deltaDirection: envelope.deltaDirection,
        canonicalFingerprint: envelope.canonicalFingerprint,
        createdTransactionId: envelope.createdTransactionId.toString(),
        createdAt: envelope.createdAt.toISOString(),
        manifestOwnership: envelope.manifest,
        mappingOwnership: {
          ...envelope.rowMapping,
          amountCents: envelope.rowMapping.amountCents.toString(),
          periodStart: envelope.rowMapping.periodStart?.toISOString() ?? null,
          authoritativeGrossCapCents: envelope.rowMapping.authoritativeGrossCapCents?.toString() ?? null,
          createdAt: envelope.rowMapping.createdAt.toISOString()
        },
        reservationOwnership: envelope.reservation,
        costCells: [...envelope.costCells]
          .sort((left, right) => left.costCellId.localeCompare(right.costCellId) || left.id.localeCompare(right.id))
          .map((cell) => ({ ...cell, amountCents: cell.amountCents.toString() })),
        payableRefs: [...envelope.payableRefs]
          .sort((left, right) => left.payableRefId.localeCompare(right.payableRefId) || left.id.localeCompare(right.id))
          .map((ref) => ({ ...ref, amountCents: ref.amountCents.toString() })),
        legacyImpactBridges: [...envelope.legacyImpactBridges]
          .sort((left, right) => left.impactKind.localeCompare(right.impactKind) || left.id.localeCompare(right.id))
          .map((impactBridge) => ({
            ...impactBridge,
            amountCents: impactBridge.amountCents.toString(),
            createdTransactionId: impactBridge.createdTransactionId.toString(),
            createdAt: impactBridge.createdAt.toISOString()
          })),
        eligibilityRevocations: []
      })),
      legacySourceBridges: [...bridges]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((bridge) => ({
          ...bridge,
          createdTransactionId: bridge.createdTransactionId?.toString() ?? null,
          createdAt: bridge.createdAt.toISOString()
        })),
      receipts: sortedLifecycleReceipts.map((receipt) => ({
        id: receipt.id,
        manifestVersionId: receipt.manifestVersionId,
        atomicScopeVersionId: receipt.atomicScopeVersionId,
        idempotencyKey: receipt.idempotencyKey,
        action: receipt.action,
        expectedRevision: receipt.expectedRevision,
        actorUserId: receipt.actorUserId,
        delegatorUserId: receipt.delegatorUserId,
        actorSetSnapshot: receipt.actorSetSnapshot,
        permissionSnapshotFingerprint: receipt.permissionSnapshotFingerprint,
        fingerprint: receipt.fingerprint,
        status: receipt.status,
        resultSnapshot: receipt.resultSnapshot,
        causalityFingerprint: receipt.causalityFingerprint,
        createdTransactionId: receipt.createdTransactionId.toString(),
        causesReceiptId: receipt.causesReceiptId,
        createdAt: receipt.createdAt.toISOString(),
        lines: [...receipt.lines]
          .sort((left, right) => left.lineNo - right.lineNo || left.causalOrdinal - right.causalOrdinal || left.id.localeCompare(right.id))
          .map((line) => ({
            id: line.id,
            receiptId: line.receiptId,
            rowMappingId: line.rowMappingId,
            projectId: line.projectId,
            lineNo: line.lineNo,
            decision: line.decision,
            entryKind: line.entryKind,
            amountCents: line.amountCents.toString(),
            targetKind: line.targetKind,
            targetRef: line.targetRef,
            causalOrdinal: line.causalOrdinal,
            reversesLineId: line.reversesLineId,
            causesLineId: line.causesLineId,
            causalityFingerprint: line.causalityFingerprint,
            lineSnapshot: line.lineSnapshot,
            createdAt: line.createdAt.toISOString()
          }))
      })),
      compensationReceipts: [],
      causeSuccessors: []
    };
    const priorCanonicalGraphFingerprint = fingerprint(priorCanonicalGraph);
    return {
      priorVersionId: wagePlan.priorConfirmedVersionId,
      priorSourceVersionId: wagePlan.priorSourceVersionId,
      priorAtomicScopeVersionId: reservation.atomicScopeVersionId,
      priorSourceClosureFingerprint: reservation.atomicScope.sourceClosureFingerprint,
      activationReceiptId: activation.id,
      activationReceiptCausalityFingerprint: activation.causalityFingerprint,
      activationLineIds: sortedActivationLines.map((line) => line.id),
      activeEnvelopes: activeEnvelopes.sort((left, right) => left.envelopeId.localeCompare(right.envelopeId)),
      priorCanonicalGraph,
      priorCanonicalGraphFingerprint
    };
  }

  private async proveHistoricalAdjustmentRoots(
    tx: Tx,
    legacy: ResolvedLegacy[],
    wagePlan: Awaited<ReturnType<WageStatementService["planHistoricalTakeoverInTransaction"]>>
  ): Promise<HistoricalAdjustmentRootProof[] | null> {
    const canonicalRootPayableRefIds = sortedUnique(wagePlan.canonicalRootPayableRefIds);
    if (canonicalRootPayableRefIds.length !== wagePlan.canonicalRootPayableRefIds.length) return null;
    if (wagePlan.versionKind === "base") {
      return canonicalRootPayableRefIds.length === 0 && legacy.every((item) => item.adjustmentRoot === null)
        ? []
        : null;
    }
    if (
      canonicalRootPayableRefIds.length === 0 ||
      !wagePlan.priorConfirmedVersionId ||
      !wagePlan.priorSourceVersionId ||
      legacy.some((item) => !item.adjustmentRoot) ||
      new Set(legacy.map((item) => item.adjustmentRoot!.factId)).size !== legacy.length
    ) return null;

    const expectedRootRefs = new Set(canonicalRootPayableRefIds);
    const coveredRootRefs = new Set<string>();
    const proofs: HistoricalAdjustmentRootProof[] = [];
    for (const item of legacy) {
      const root = item.adjustmentRoot!;
      const bridge = await tx.operatingTakeoverLegacySourceBridge.findFirst({
        where: {
          projectId: item.projectId,
          sourceType: "project_wage",
          sourceBusinessId: root.sourceBusinessId,
          sourceVersion: root.sourceVersion,
          sourceFingerprint: root.sourceFingerprint
        },
        select: {
          id: true,
          targetKind: true,
          targetRef: true,
          targetFingerprint: true,
          mappingDecision: true
        }
      });
      if (
        !bridge ||
        bridge.mappingDecision !== "FORMAL" ||
        bridge.targetKind !== "wage_takeover_projection_envelope" ||
        !text(bridge.targetRef)
      ) return null;
      const envelope = await tx.wageTakeoverProjectionEnvelope.findFirst({
        where: { id: bridge.targetRef },
        select: {
          id: true,
          wageStatementVersionId: true,
          projectId: true,
          legacySourceType: true,
          legacySourceBusinessId: true,
          legacySourceVersion: true,
          legacySourceFingerprint: true,
          projectionOrigin: true,
          deltaDirection: true,
          canonicalFingerprint: true,
          payableRefs: { select: { payableRefId: true }, orderBy: { payableRefId: "asc" } },
          eligibilityRevocations: { select: { id: true } },
          wageStatementVersion: {
            select: {
              id: true,
              statementId: true,
              revision: true,
              kind: true,
              sourceVersionId: true,
              projectionOrigin: true,
              status: true
            }
          }
        }
      });
      if (
        !envelope ||
        envelope.id !== bridge.targetRef ||
        envelope.projectId !== item.projectId ||
        envelope.legacySourceType !== "project_wage" ||
        envelope.legacySourceBusinessId !== root.sourceBusinessId ||
        envelope.legacySourceVersion !== root.sourceVersion ||
        envelope.legacySourceFingerprint !== root.sourceFingerprint ||
        envelope.projectionOrigin !== "historical_takeover_legacy_link" ||
        envelope.deltaDirection !== "increase" ||
        !SHA256.test(envelope.canonicalFingerprint) ||
        envelope.eligibilityRevocations.length !== 0 ||
        envelope.wageStatementVersionId !== envelope.wageStatementVersion.id ||
        envelope.wageStatementVersion.statementId !== wagePlan.targetWageStatementId ||
        envelope.wageStatementVersion.revision !== 1 ||
        envelope.wageStatementVersion.kind !== "base" ||
        envelope.wageStatementVersion.status !== "confirmed" ||
        envelope.wageStatementVersion.projectionOrigin !== "historical_takeover_legacy_link" ||
        !text(envelope.wageStatementVersion.sourceVersionId)
      ) return null;
      const expectedTargetFingerprint = historicalWageEnvelopeTargetFingerprint(envelope);
      if (bridge.targetFingerprint !== expectedTargetFingerprint) return null;
      const payableRefIds = envelope.payableRefs.map((ref) => ref.payableRefId);
      if (
        payableRefIds.length === 0 ||
        sortedUnique(payableRefIds).length !== payableRefIds.length ||
        payableRefIds.some((payableRefId) =>
          !expectedRootRefs.has(payableRefId) || coveredRootRefs.has(payableRefId)
        )
      ) return null;
      for (const payableRefId of payableRefIds) {
        coveredRootRefs.add(payableRefId);
      }
      proofs.push({
        legacyFactId: item.factId,
        rootFactId: root.factId,
        bridgeId: bridge.id,
        bridgeTargetFingerprint: bridge.targetFingerprint,
        envelopeId: envelope.id,
        envelopeCanonicalFingerprint: envelope.canonicalFingerprint,
        wageStatementVersionId: envelope.wageStatementVersionId,
        wageApprovedSourceVersionId: envelope.wageStatementVersion.sourceVersionId!,
        payableRefIds
      });
    }
    if (!sameStrings(sortedUnique([...coveredRootRefs]), canonicalRootPayableRefIds)) return null;
    if (
      new Set(proofs.map((proof) => proof.bridgeId)).size !== proofs.length ||
      new Set(proofs.map((proof) => proof.envelopeId)).size !== proofs.length
    ) return null;
    return proofs.sort((left, right) => left.legacyFactId.localeCompare(right.legacyFactId));
  }

  private async preflightB(
    tx: Tx,
    binding: HistoricalWageSelectionBinding,
    legacy: ResolvedLegacy[],
    currentAtomicScopeVersionId?: string,
    frozenPriorLineageProof?: HistoricalWageSummaryPriorLineageProof
  ): Promise<ScopePlan | null> {
    if (!binding.summaryFingerprint || legacy.length !== 1) return null;
    assertNoMalformedCSummaryAuthority(legacy[0]!.legacySnapshot);
    const snapshot = parseHistoricalWageSummarySnapshot(legacy[0]!.legacySnapshot);
    if (!snapshot || historicalWageSummarySelectionFingerprint(snapshot) !== binding.summaryFingerprint) return null;
    if (
      legacy[0]!.legacyWageMonth !== snapshot.wageMonth ||
      legacy[0]!.employmentCompanyId !== snapshot.employmentCompanyId ||
      (legacy[0]!.adjustmentRoot !== null && (
        legacy[0]!.adjustmentRoot.legacyWageMonth !== legacy[0]!.legacyWageMonth ||
        legacy[0]!.adjustmentRoot.employmentCompanyId !== legacy[0]!.employmentCompanyId
      ))
    ) return null;
    const mapped = this.adapter.map({
      selectionRefFingerprint: binding.selectionFingerprint,
      grade: "B",
      summary: snapshot,
      legacy: legacy[0]!
    });
    if (mapped.grade !== "B" || mapped.decision !== "FORMAL") return null;
    if (!await this.summaryEvidenceIsActive(tx, snapshot)) return null;
    try {
      for (const line of snapshot.lines) {
        await this.validateBSummaryTarget(tx, snapshot, line);
      }
    } catch (error) {
      if (error instanceof ConflictException) return null;
      throw error;
    }
    const bucketKey = summaryBucketKey(snapshot);
    await this.lock(tx, `pol219:summary:${bucketKey}`);
    const priorLineageProof = frozenPriorLineageProof ??
      await this.readSummaryPriorLineageProof(tx, snapshot, currentAtomicScopeVersionId);
    if (
      priorLineageProof.summaryBucketKey !== bucketKey ||
      priorLineageProof.readSetFingerprint !== fingerprint(priorLineageProof.readSet) ||
      priorLineageProof.state === "inactive_compensated"
    ) return null;
    if (priorLineageProof.state === "invalid") {
      throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE);
    }
    const prior = priorLineageProof.state === "active"
      ? priorLineageProof.readSet.authorities.find(
          (authority) => authority.id === priorLineageProof.activePriorAuthorityId
        ) ?? null
      : null;
    if (priorLineageProof.state === "active" && !prior) return null;
    if (
      prior &&
      (!legacy[0]!.adjustmentRoot || !priorSummaryLineageOwnsAdjustmentRoot(
        priorLineageProof.readSet.authorities[0]!,
        legacy[0]!.adjustmentRoot
      ))
    ) return null;
    if (prior && (prior.revision < 1 || prior.sourceVersionFingerprint === snapshot.sourceVersionFingerprint)) return null;
    const priorLines = new Map((prior?.creditorLines ?? []).map((line) => [line.stableBucketKey, line]));
    const currentStableKeys = snapshot.lines.map((line) => line.creditorStableKey).sort((left, right) => left.localeCompare(right));
    if (prior && !sameStrings(currentStableKeys, [...priorLines.keys()].sort((left, right) => left.localeCompare(right)))) return null;

    const existingRefs = prior ? priorLineageProof.readSet.payableRefs : [];
    const priorCreditorLines = new Map((prior?.creditorLines ?? []).map((line) => [line.stableBucketKey, line]));
    const rootReadSet: Array<Record<string, unknown>> = [];
    const plannedLines: HistoricalSummaryPlannedLine[] = [];
    for (const line of [...snapshot.lines].sort((left, right) => left.creditorStableKey.localeCompare(right.creditorStableKey))) {
      const previous = priorLines.get(line.creditorStableKey);
      const signedGrossDeltaCents = line.grossDebtCents - (previous?.grossDebtCents ?? 0n);
      const signedHistoricallySettledDeltaCents = line.historicallySettledCents - (previous?.historicallySettledCents ?? 0n);
      const signedOutstandingBalanceDeltaCents = line.outstandingBalanceCents - (previous?.outstandingBalanceCents ?? 0n);
      const stableBucketKey = line.creditorStableKey;
      let rootCreditorLineId: string | null = null;
      let rootPayableRefId: string | null = null;
      if (prior) {
        const priorLine = priorCreditorLines.get(line.creditorStableKey);
        if (!priorLine) return null;
        rootCreditorLineId = priorLine.rootCreditorLineId ?? priorLine.id;
        const roots = existingRefs.filter((ref) => ref.stableBucketKey === stableBucketKey && ref.direction === "increase" && ref.adjustsSummaryPayableRefId === null);
        if (roots.length > 1 || ((previous?.grossDebtCents ?? 0n) > 0n && roots.length !== 1)) return null;
        if (roots.length === 1) {
          const root = roots[0]!;
          const adjustments = existingRefs
            .filter((ref) => ref.adjustsSummaryPayableRefId === root.id)
            .sort((left, right) => left.id.localeCompare(right.id));
          const effective = root.deltaAmountCents + adjustments.reduce(
            (sum, adjustment) => sum + (adjustment.direction === "increase" ? adjustment.deltaAmountCents : -adjustment.deltaAmountCents),
            0n
          );
          if (effective < 0n || effective + signedGrossDeltaCents < 0n) return null;
          rootPayableRefId = root.id;
          rootReadSet.push({
            id: root.id,
            stableBucketKey,
            deltaAmountCents: root.deltaAmountCents,
            effectiveAmountCents: effective,
            adjustments: adjustments.map(({ id, direction, deltaAmountCents }) => ({ id, direction, deltaAmountCents }))
          });
        }
      }
      const deltaFingerprint = fingerprint({
        bucketKey,
        creditorStableKey: line.creditorStableKey,
        priorAuthorityVersionId: prior?.id ?? null,
        currentAuthoritySourceVersionFingerprint: snapshot.sourceVersionFingerprint,
        signedGrossDeltaCents,
        signedHistoricallySettledDeltaCents,
        signedOutstandingBalanceDeltaCents,
        rootCreditorLineId,
        rootPayableRefId
      });
      plannedLines.push({
        ...line,
        stableBucketKey,
        signedGrossDeltaCents,
        signedHistoricallySettledDeltaCents,
        signedOutstandingBalanceDeltaCents,
        deltaFingerprint,
        rootCreditorLineId,
        rootPayableRefId
      });
    }
    const signedGrossTotal = plannedLines.reduce((sum, line) => sum + line.signedGrossDeltaCents, 0n);
    const legacySignedAmount = legacy[0]!.direction === "increase" ? legacy[0]!.amountCents : -legacy[0]!.amountCents;
    if (signedGrossTotal !== legacySignedAmount) return null;
    if (!prior && legacy[0]!.entryKind !== "original") return null;
    if (prior && (legacy[0]!.entryKind === "original" || !legacy[0]!.adjustmentRoot)) return null;
    const revision = (prior?.revision ?? 0) + 1;
    const sourceDeltaFingerprint = fingerprint({
      bucketKey,
      revision,
      supersedesVersionId: prior?.id ?? null,
      sourceVersionFingerprint: snapshot.sourceVersionFingerprint,
      lines: plannedLines.map((line) => ({
        creditorCategoryCode: line.creditorCategoryCode,
        signedGrossDeltaCents: line.signedGrossDeltaCents,
        signedHistoricallySettledDeltaCents: line.signedHistoricallySettledDeltaCents,
        signedOutstandingBalanceDeltaCents: line.signedOutstandingBalanceDeltaCents,
        deltaFingerprint: line.deltaFingerprint
      }))
    });
    const rootClosureFingerprint = fingerprint(rootReadSet.sort((left, right) => String(left.id).localeCompare(String(right.id))));
    return {
      grade: "B",
      projectIds: [snapshot.projectId],
      summary: plannedLines,
      summaryAuthority: {
        sourceVersionFingerprint: snapshot.sourceVersionFingerprint,
        employmentCompanyId: snapshot.employmentCompanyId,
        projectId: snapshot.projectId,
        wageMonth: snapshot.wageMonth,
        catalogVersion: snapshot.catalogVersion,
        positionCategoryCode: snapshot.positionCategoryCode,
        positionCategoryLabel: snapshot.positionCategoryLabel,
        evidenceCoordinate: snapshot.evidenceCoordinate,
        revision,
        supersedesVersionId: prior?.id ?? null,
        lineageRootAuthorityVersionId: prior ? (prior.lineageRootAuthorityVersionId ?? prior.id) : null,
        sourceDeltaFingerprint,
        rootClosureFingerprint,
        sourceSnapshot: jsonInput(snapshot.raw),
        snapshot,
        priorLineageProof
      }
    };
  }

  private async crossSourceConflict(tx: Tx, plan: ScopePlan, legacy: ResolvedLegacy[]): Promise<string | null> {
    const projectIds = sortedUnique(
      plan.grade === "A" ? (plan.projectIds ?? []) : legacy.map((item) => item.projectId)
    );
    if (!projectIds.length) return "WAGE_PROJECT_SCOPE_UNRESOLVED";
    const source = plan.grade === "A"
      ? await tx.wageApprovedSourceVersion.findUnique({
          where: { id: plan.sourceVersionId! },
          select: HISTORICAL_WAGE_APPROVED_SOURCE_SELECT
        })
      : null;
    const month = source?.wageMonth ?? plan.summaryAuthority?.wageMonth;
    const sourcePeople = source ? approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256) : [];
    const sourceEmploymentCompanyIds = sortedUnique(sourcePeople.map((person) => person.employmentCompanyId));
    const employmentCompanyId = source?.employmentCompanyId ??
      (sourceEmploymentCompanyIds.length === 1 ? sourceEmploymentCompanyIds[0] : undefined) ??
      plan.summaryAuthority?.employmentCompanyId;
    if (!month) return "WAGE_MONTH_UNRESOLVED";
    if (!employmentCompanyId) return "WAGE_EMPLOYMENT_COMPANY_UNRESOLVED";
    if (source && sourcePeople.length > 0 && (
      sourceEmploymentCompanyIds.length !== 1 ||
      sourceEmploymentCompanyIds[0] !== employmentCompanyId
    )) return "WAGE_EMPLOYMENT_COMPANY_UNRESOLVED";
    const conflictFrontier = await this.readCConflictFrontier(tx, {
      employmentCompanyId,
      wageMonth: month,
      projectIds,
      companyScoped: plan.grade !== "A"
    });
    const lines = conflictFrontier.lines;
    plan.conflictReadSet = {
      ...conflictFrontier
    };
    if (plan.grade === "A") {
      if (!lines.length) return null;
      const employeeIdsByProject = new Map<string, Set<string>>();
      for (const person of sourcePeople) {
        for (const allocation of person.projectAllocations) {
          const employeeIds = employeeIdsByProject.get(allocation.projectId) ?? new Set<string>();
          employeeIds.add(person.employeeId);
          employeeIdsByProject.set(allocation.projectId, employeeIds);
        }
      }
      plan.conflictReadSet.employeeIdsByProject = projectIds.map((projectId) => ({
        projectId,
        employeeIds: [...(employeeIdsByProject.get(projectId) ?? [])]
          .sort((left, right) => left.localeCompare(right))
      }));
      if (lines.some((line) => line.coverageKind === "ROLE_SUMMARY" || (
        line.coverageKind === "PERSON" &&
        Boolean(line.personAuthorityKey) &&
        employeeIdsByProject.get(line.projectId)?.has(line.personAuthorityKey!)
      ))) {
        return "CROSS_SOURCE_WAGE_BLOCK";
      }
      return null;
    }
    if (!plan.summaryAuthority) return "B_SUMMARY_AUTHORITY_DRIFT";
    if (lines.some((line) => line.coverageKind === "ROLE_SUMMARY")) return "CROSS_SOURCE_ROLE_SUMMARY_BLOCK";
    const exclusions = new Map(plan.summaryAuthority.snapshot.assignedWageExclusions.map((proof) => [proof.lineId, proof]));
    const personLines = lines.filter((line) => line.coverageKind === "PERSON");
    const exact = exclusions.size === personLines.length && personLines.every((line) => {
      const proof = exclusions.get(line.id);
      return proof && proof.authorityVersionId === line.authorityVersionId && proof.lineFingerprint === line.lineFingerprint;
    });
    if (!exact) return "CROSS_SOURCE_PERSON_EXCLUSION_SET_DRIFT";
    if (personLines.length && !await this.evidenceFilesAreActive(tx, [...exclusions.values()])) {
      return "CROSS_SOURCE_PERSON_EXCLUSION_MISSING";
    }
    return null;
  }

  private async summaryEvidenceIsActive(tx: Tx, snapshot: HistoricalSummarySnapshot) {
    return this.evidenceFilesAreActive(tx, historicalSummaryEvidence(snapshot));
  }

  private async evidenceFilesAreActive(tx: Tx, evidence: HistoricalEvidenceCoordinate[]) {
    if (!evidence.length || evidence.some((item) => !text(item.fileObjectId) || !SHA256.test(item.contentSha256))) return false;
    const unique = [...new Map(evidence.map((item) => [`${item.fileObjectId}:${item.contentSha256}`, item])).values()];
    const files = await tx.fileObject.findMany({
      where: { id: { in: unique.map((item) => item.fileObjectId) } },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    return unique.every((item) => files.some((file) => file.id === item.fileObjectId && file.storageStatus === "active" && file.contentSha256 === item.contentSha256));
  }

  private async validateBSummaryTarget(
    tx: Tx,
    authority: Pick<
      HistoricalSummarySnapshot,
      | "sourceVersionFingerprint"
      | "employmentCompanyId"
      | "projectId"
      | "wageMonth"
      | "catalogVersion"
      | "positionCategoryCode"
      | "positionCategoryLabel"
    >,
    line: HistoricalSummaryLine
  ): Promise<HistoricalSummaryTarget> {
    if (HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS[line.creditorCategoryCode] !== line.creditorCategoryLabel) {
      throw new ConflictException("B级历史工资汇总债权类别或范围不完整，禁止生成受控对账引用");
    }
    if (line.target.kind === "historical_wage_balance_reconciliation_version") {
      const target = line.target;
      if (
        target.sourceVersionFingerprint !== authority.sourceVersionFingerprint ||
        target.employmentCompanyId !== authority.employmentCompanyId ||
        target.projectId !== authority.projectId ||
        target.wageMonth !== authority.wageMonth ||
        target.catalogVersion !== authority.catalogVersion ||
        target.positionCategoryCode !== authority.positionCategoryCode ||
        target.positionCategoryLabelSnapshot !== authority.positionCategoryLabel ||
        target.wageCreditorCategoryCode !== line.creditorCategoryCode ||
        target.wageCreditorCategoryLabelSnapshot !== line.creditorCategoryLabel ||
        target.currencyCode !== "CNY" ||
        target.debtStatus !== line.debtStatus ||
        target.grossDebtCents !== line.grossDebtCents ||
        target.historicallySettledCents !== line.historicallySettledCents ||
        target.outstandingBalanceCents !== line.outstandingBalanceCents ||
        !validDateOnly(target.asOfDate) ||
        !await this.evidenceFilesAreActive(tx, target.evidence) ||
        (line.creditorCategoryCode === "other_controlled_payee" && !line.controlledScopeEvidenceCoordinate)
      ) {
        throw new ConflictException("B级历史工资余额对账版本的公司、项目、月份、金额或证据未完整闭合");
      }
      return target;
    }
    const target = line.target;
    if (
      line.debtStatus !== "settled" || line.historicallySettledCents !== line.grossDebtCents || line.outstandingBalanceCents !== 0n ||
      target.paymentExecutionIds.length !== target.paymentExecutions.length ||
      new Set(target.paymentExecutionIds).size !== target.paymentExecutionIds.length ||
      target.paymentExecutionIds.some((id, index) => id !== target.paymentExecutions[index]?.paymentExecutionId)
    ) {
      throw new ConflictException("既有已核验付款执行集合只能完整证明一条已结清 B 级债权类别，禁止推断切片");
    }
    const verified: HistoricalPaymentExecutionEvidence[] = [];
    for (const evidence of target.paymentExecutions) {
      verified.push(await this.verifyHistoricalPaymentExecution(tx, authority, line, evidence));
    }
    const computed = computePol219VerifiedPaymentExecutionSet(verified);
    if (
      verified.reduce((sum, item) => sum + BigInt(item.amountCents), 0n) !== line.grossDebtCents ||
      target.paymentExecutionSetFingerprint !== computed.fingerprint ||
      strictJcs(target.paymentExecutionIds) !== strictJcs(computed.payload.paymentExecutionIds) ||
      strictJcs(target.paymentExecutions) !== strictJcs(computed.payload.paymentExecutions)
    ) {
      throw new ConflictException("既有已核验付款执行集合金额或集合指纹未与 B 级债权类别完整闭合");
    }
    return {
      kind: "existing_verified_payment_execution_set",
      paymentExecutionIds: computed.payload.paymentExecutionIds,
      paymentExecutionSetFingerprint: computed.fingerprint,
      paymentExecutions: computed.payload.paymentExecutions
    };
  }

  private async verifyHistoricalPaymentExecution(
    tx: Tx,
    authority: Pick<HistoricalSummarySnapshot, "employmentCompanyId" | "projectId">,
    line: HistoricalSummaryLine,
    evidence: HistoricalPaymentExecutionEvidence
  ): Promise<HistoricalPaymentExecutionEvidence> {
    const execution = await tx.paymentExecution.findUnique({
      where: { id: evidence.paymentExecutionId },
      select: {
        id: true,
        paymentRequestId: true,
        paymentSubjectType: true,
        companyEntityIdSnapshot: true,
        companyEntityNameSnapshot: true,
        companyEntityCreditCodeSnapshot: true,
        amountCents: true,
        paidAt: true,
        voucherFileId: true,
        payerAttestationFingerprint: true
      }
    });
    if (!execution) throw new ConflictException("B级既有付款执行不存在，不能伪造历史结清证明");
    const [request, payerAttestation, claim, voucher] = await Promise.all([
      tx.paymentRequest.findUnique({
        where: { id: execution.paymentRequestId },
        select: { id: true, sourceType: true, projectId: true, paymentSubjectType: true, contractId: true, contractVersionId: true, paymentTermsVersionId: true, paymentTermsStageId: true, status: true, requestedAmountCents: true, approvedAmountCents: true, code: true }
      }),
      tx.paymentExecutionPayerAttestation.findUnique({ where: { paymentExecutionId: execution.id } }),
      tx.bankTransactionClaim.findUnique({ where: { paymentExecutionId: execution.id } }),
      tx.fileObject.findUnique({ where: { id: execution.voucherFileId }, select: { id: true, storageStatus: true, contentSha256: true } })
    ]);
    if (!request || !payerAttestation || !claim || !voucher || voucher.storageStatus !== "active") {
      throw new ConflictException("B级既有付款执行缺少付款申请、付款主体、银行认领或凭证链，不能用于历史工资结清");
    }
    const [observation, verificationEvidence, transactionEvidence] = await Promise.all([
      tx.verifiedBankTransactionObservation.findUnique({ where: { id: claim.observationId } }),
      tx.fileObject.findUnique({ where: { id: payerAttestation.verificationEvidenceFileId }, select: { id: true, storageStatus: true, contentSha256: true } }),
      tx.fileObject.findUnique({ where: { id: evidence.transactionEvidenceFileId }, select: { id: true, storageStatus: true, contentSha256: true } })
    ]);
    if (!observation || !verificationEvidence || !transactionEvidence || verificationEvidence.storageStatus !== "active" || transactionEvidence.storageStatus !== "active") {
      throw new ConflictException("B级既有付款执行缺少有效银行 observation/claim 证据链，不能用于历史工资结清");
    }
    const requestFingerprint = historicalPaymentRequestFingerprint(request);
    const executionFingerprint = historicalPaymentExecutionFingerprint(execution);
    if (
      execution.paymentRequestId !== evidence.paymentRequestId ||
      request.id !== evidence.paymentRequestId || request.sourceType !== evidence.paymentRequestSourceType || request.projectId !== evidence.paymentRequestProjectId ||
      request.projectId !== authority.projectId || execution.companyEntityIdSnapshot !== authority.employmentCompanyId ||
      execution.paymentSubjectType !== evidence.paymentSubjectType || execution.amountCents !== BigInt(evidence.amountCents) ||
      execution.companyEntityIdSnapshot !== evidence.payerCompanyId || execution.companyEntityNameSnapshot !== evidence.payerCompanyNameSnapshot || execution.companyEntityCreditCodeSnapshot !== evidence.payerCompanyCreditCodeSnapshot ||
      execution.voucherFileId !== evidence.voucherFileId || voucher.contentSha256 !== evidence.voucherContentSha256 ||
      requestFingerprint !== evidence.paymentRequestFingerprint || executionFingerprint !== evidence.paymentExecutionFingerprint ||
      payerAttestation.id !== evidence.payerAttestationId || payerAttestation.payerVerificationId !== evidence.payerVerificationId || payerAttestation.bankAccountReference !== evidence.bankAccountReference ||
      payerAttestation.holderCompanyEntityId !== evidence.legalAccountHolderCompanyId || payerAttestation.holderNameSnapshot !== evidence.legalAccountHolderNameSnapshot || payerAttestation.holderCreditCodeSnapshot !== evidence.legalAccountHolderCreditCodeSnapshot ||
      payerAttestation.verificationEvidenceFileId !== evidence.verificationEvidenceFileId || payerAttestation.verificationEvidenceContentSha256 !== evidence.verificationEvidenceContentSha256 || verificationEvidence.contentSha256 !== evidence.verificationEvidenceContentSha256 ||
      claim.id !== evidence.bankTransactionClaimId || claim.targetType !== "payment_execution" || claim.paymentExecutionId !== execution.id ||
      observation.id !== evidence.bankObservationId || observation.transactionSourceType !== evidence.transactionSourceType || observation.transactionSourceId !== evidence.transactionSourceId || observation.transactionSourceIdentity !== evidence.transactionSourceIdentity ||
      observation.amountCents !== BigInt(evidence.transactionAmountCents) || observation.amountCents !== execution.amountCents || observation.currencyCode !== evidence.currencyCode || observation.currencyCode !== "CNY" || observation.direction !== evidence.direction ||
      observation.transactionEvidenceFileId !== evidence.transactionEvidenceFileId || observation.transactionEvidenceContentSha256 !== evidence.transactionEvidenceContentSha256 || transactionEvidence.contentSha256 !== evidence.transactionEvidenceContentSha256 ||
      observation.payloadFingerprint !== evidence.observationPayloadFingerprint || !sameInstant(execution.paidAt, evidence.paidAt) || !sameInstant(observation.occurredAt, evidence.occurredAt) ||
      !line.controlledScopeEvidenceCoordinate ||
      strictJcs(evidence.creditorScopeEvidenceCoordinate) !== strictJcs(line.controlledScopeEvidenceCoordinate)
    ) {
      throw new ConflictException("B级既有付款执行的公司、项目、金额、付款主体或银行事实链与冻结证据不一致");
    }
    return evidence;
  }

  private async resolveIdentityInTransaction(
    tx: Tx,
    actorUserId: string,
    delegatorUserId: string | undefined,
    action: HistoricalWageAction,
    resourceId: string,
    now: Date
  ): Promise<Identity> {
    const policy = HISTORICAL_WAGE_ACTION_POLICY[action];
    if (delegatorUserId && delegatorUserId === actorUserId) {
      throw new ForbiddenException("历史工资接管经办人不能与委托人相同");
    }
    const actualRoles = sortedUnique(
      await this.companyRoles.resolveActiveRoleScopesInTransaction(tx, actorUserId)
    ) as RoleKey[];
    assertActions(actualRoles, action);
    let delegatorRoles: RoleKey[] | undefined;
    if (delegatorUserId) {
      const eligible = await activeScopedApprovalDelegatorIds(tx, actorUserId, {
        actionKey: policy.actionKey,
        resourceType: "historical_wage_takeover_scope",
        resourceId
      }, now);
      if (!eligible.includes(delegatorUserId)) {
        throw new ForbiddenException("委托身份未在当前历史工资接管范围内生效");
      }
      delegatorRoles = sortedUnique(
        await this.companyRoles.resolveActiveRoleScopesInTransaction(tx, delegatorUserId)
      ) as RoleKey[];
      assertActions(delegatorRoles, action);
    }
    const actorIds = sortedUnique([actorUserId, ...(delegatorUserId ? [delegatorUserId] : [])]);
    return {
      actualUserId: actorUserId,
      ...(delegatorUserId ? { delegatorUserId } : {}),
      actualRoles,
      ...(delegatorRoles ? { delegatorRoles } : {}),
      actorIds,
      actorSetSnapshot: jsonInput({
        actualUserId: actorUserId,
        actualRoles,
        delegatorUserId: delegatorUserId ?? null,
        delegatorRoles: delegatorRoles ?? null,
        actorIds
      })
    };
  }

  private assertRevision(context: { receipts: Array<{ action: string; status: string }> }, expectedRevision: number) {
    if (expectedRevision !== context.receipts.length) {
      throw new ConflictException("历史工资接管范围版本已变化，请重新读取服务端 selectionRef 后再操作");
    }
  }

  private assertInactiveApply(context: { receipts: Array<{ action: string; status: string }> }) {
    if (!context.receipts.some((receipt) => receipt.action === "historical_wage_takeover.scope.apply" && receipt.status === "inactive_applied")) {
      throw new ConflictException("历史工资接管必须先完成 inactive apply，才能确认或激活");
    }
  }

  private assertNotActivated(context: { receipts: Array<{ action: string; status: string }> }) {
    if (context.receipts.some((receipt) => receipt.action === "historical_wage_takeover.scope.activate" && receipt.status === "activated")) {
      throw new ConflictException("历史工资接管范围已经激活；请使用幂等回执或补偿路径，不能二次激活");
    }
  }

  private assertActivationSeparation(
    context: {
      receipts: Array<{ action: string; actorUserId: string; delegatorUserId: string | null }>;
      authorities: Array<{ attestations: Array<{ actorUserId: string; delegatorUserId: string | null }> }>;
    },
    identity: Identity
  ) {
    const preparationActors = context.receipts
      .filter((receipt) => ["historical_wage_takeover.scope.create", "historical_wage_takeover.scope.apply"].includes(receipt.action))
      .map((receipt) => [receipt.actorUserId, receipt.delegatorUserId]);
    const attestationActors = context.authorities.flatMap((authority) => authority.attestations.map((attestation) => [attestation.actorUserId, attestation.delegatorUserId]));
    assertDisjointEffectiveIdentities(identity.actorIds, [...preparationActors, ...attestationActors]);
  }

  private async materializeAEnvelope(
    tx: Tx,
    scopeId: string,
    mapping: ScopeMapping,
    wageStatementVersionId: string,
    confirmationDecision: "FORMAL",
    actorUserId: string
  ): Promise<TakeoverTarget> {
    const existing = await tx.wageTakeoverProjectionEnvelope.findFirst({
      where: {
        projectId: mapping.projectId,
        legacySourceType: mapping.legacy.sourceType,
        legacySourceBusinessId: mapping.legacy.sourceBusinessId,
        legacySourceVersion: mapping.legacy.sourceVersion
      }
    });
    const [version, allocations, payableRefs] = await Promise.all([
      tx.wageStatementVersion.findUnique({
        where: { id: wageStatementVersionId },
        select: { id: true, projectionOrigin: true, operatingProjectionSnapshot: true }
      }),
      tx.wageProjectAllocation.findMany({
        where: { projectId: mapping.projectId, personLine: { statementVersionId: wageStatementVersionId } },
        include: { componentAllocations: true, creditorAllocations: true }
      }),
      tx.wagePayableRef.findMany({
        where: { confirmedVersionId: wageStatementVersionId, projectId: mapping.projectId },
        select: { id: true, amountCents: true, projectAllocationId: true, creditorBreakdownId: true, direction: true }
      })
    ]);
    if (!version || version.projectionOrigin !== "historical_takeover_legacy_link") {
      throw new ConflictException("A级工资 canonical version 不属于 historical takeover projection");
    }
    const projection = historicalWageProjectProjection(
      version.operatingProjectionSnapshot,
      wageStatementVersionId,
      mapping.projectId,
      allocations,
      payableRefs
    );
    const legacySignedAmount = mapping.legacy.direction === "increase"
      ? mapping.legacy.amountCents
      : -mapping.legacy.amountCents;
    const costTotal = signedProjectionTotal(projection.costs);
    const payableTotal = signedProjectionTotal(projection.payables);
    if (
      !projection.costs.length ||
      !projection.payables.length ||
      costTotal !== legacySignedAmount ||
      payableTotal !== legacySignedAmount
    ) {
      throw new ConflictException("A级工资 canonical matrix 与 legacy project_wage 的成本、应付金额未逐分一对一闭合");
    }
    const canonicalFingerprint = fingerprint({
      wageStatementVersionId,
      projectId: mapping.projectId,
      costCells: projection.costs.map((cell) => ({
        id: cell.id,
        amountCents: cell.amountCents,
        direction: cell.direction
      })),
      payableRefs: projection.payables.map((ref) => ({
        id: ref.id,
        payableCellId: ref.payableCellId,
        amountCents: ref.amountCents,
        direction: ref.direction
      }))
    });
    if (existing) {
      throw new ConflictException("A级历史工资 envelope 在非幂等回放前已存在，禁止跨事务 LINK 或重投影");
    }
    const envelope = await tx.wageTakeoverProjectionEnvelope.create({
      data: {
        id: randomUUID(),
        atomicScopeVersionId: scopeId,
        manifestVersionId: mapping.manifestId,
        rowMappingId: mapping.id,
        wageStatementVersionId,
        projectId: mapping.projectId,
        legacySourceType: mapping.legacy.sourceType,
        legacySourceBusinessId: mapping.legacy.sourceBusinessId,
        legacySourceVersion: mapping.legacy.sourceVersion,
        legacySourceFingerprint: mapping.legacy.sourceFingerprint,
        legacyImpactSnapshot: jsonInput({
          factId: mapping.legacy.factId,
          costImpactId: mapping.legacy.costImpactId,
          costImpactSnapshot: mapping.legacy.costImpactSnapshot,
          costImpactFingerprint: historicalWageLegacyImpactFingerprint(mapping.legacy, "confirmed_cost", mapping.legacy.costImpactSnapshot),
          payableImpactId: mapping.legacy.payableImpactId,
          payableImpactSnapshot: mapping.legacy.payableImpactSnapshot,
          payableImpactFingerprint: historicalWageLegacyImpactFingerprint(
            mapping.legacy,
            mapping.legacy.direction === "increase" ? "payable_increase" : "payable_decrease",
            mapping.legacy.payableImpactSnapshot
          )
        }),
        projectionOrigin: "historical_takeover_legacy_link",
        deltaDirection: mapping.legacy.direction,
        canonicalFingerprint
      }
    });
    for (const impact of [
      {
        legacyImpactEntryId: mapping.legacy.costImpactId,
        impactKind: "confirmed_cost",
        snapshot: mapping.legacy.costImpactSnapshot
      },
      {
        legacyImpactEntryId: mapping.legacy.payableImpactId,
        impactKind: mapping.legacy.direction === "increase" ? "payable_increase" : "payable_decrease",
        snapshot: mapping.legacy.payableImpactSnapshot
      }
    ]) {
      await tx.wageTakeoverLegacyImpactBridge.create({
        data: {
          id: randomUUID(),
          envelopeId: envelope.id,
          rowMappingId: mapping.id,
          projectId: mapping.projectId,
          legacyImpactEntryId: impact.legacyImpactEntryId,
          impactKind: impact.impactKind,
          direction: mapping.legacy.direction,
          amountCents: mapping.legacy.amountCents,
          sourceFingerprint: historicalWageLegacyImpactFingerprint(mapping.legacy, impact.impactKind, impact.snapshot)
        }
      });
    }
    for (const cell of projection.costs) {
      await tx.wageTakeoverProjectionEnvelopeCostCell.create({
        data: { id: randomUUID(), envelopeId: envelope.id, costCellId: cell.id, direction: cell.direction, amountCents: cell.amountCents }
      });
    }
    for (const ref of projection.payables) {
      await tx.wageTakeoverProjectionEnvelopePayableRef.create({
        data: { id: randomUUID(), envelopeId: envelope.id, payableRefId: ref.id, direction: ref.direction, amountCents: ref.amountCents }
      });
    }
    void actorUserId; // The envelope itself is immutable provenance; the receipt/audit owns command actor identity.
    return {
      targetKind: "wage_takeover_projection_envelope",
      targetRef: envelope.id,
      targetFingerprint: historicalWageEnvelopeTargetFingerprint(envelope),
      decision: confirmationDecision
    };
  }

  private async materializeBSummaryRefs(
    tx: Tx,
    context: Awaited<ReturnType<HistoricalWageTakeoverService["loadAndRevalidateScope"]>>,
    authority: Awaited<ReturnType<HistoricalWageTakeoverService["loadAndRevalidateScope"]>>["authorities"][number],
    actorUserId: string
  ): Promise<TakeoverTarget> {
    if (context.mappings.length !== 1 || !context.plan.summary || !context.plan.summaryAuthority) {
      throw new ConflictException("B级历史工资汇总必须精确对应一个 legacy project_wage 与一个受控 bucket");
    }
    const mapping = context.mappings[0]!;
    const existing = await tx.historicalWageSummaryPayableRef.findMany({
      where: { authorityVersionId: authority.id },
      orderBy: { wageCreditorCategoryCode: "asc" }
    });
    if (existing.length) {
      throw new ConflictException("既有 B 级历史工资汇总目标已存在，当前新命令禁止跨范围 LINK");
    }
    const persistedLines = new Map(authority.creditorLines.map((line) => [line.stableBucketKey, line]));
    if (
      persistedLines.size !== authority.creditorLines.length ||
      persistedLines.size !== context.plan.summary.length
    ) {
      throw new ConflictException("B级历史工资汇总 creditor snapshot 不完整或不唯一，禁止激活");
    }
    const validated = [] as Array<{
      line: HistoricalSummaryPlannedLine;
      creditorLine: (typeof authority.creditorLines)[number];
      target: HistoricalSummaryTarget;
      finalizedTarget: NonNullable<ReturnType<typeof finalizePersistedSummaryTarget>>;
    }>;
    for (const line of [...context.plan.summary].sort((left, right) => left.stableBucketKey.localeCompare(right.stableBucketKey))) {
      const creditorLine = persistedLines.get(line.stableBucketKey);
      const finalizedTarget = creditorLine
        ? finalizePersistedSummaryTarget(line, creditorLine.targetPayload, creditorLine.targetFingerprint)
        : null;
      if (
        !creditorLine ||
        !finalizedTarget ||
        creditorLine.revision !== context.plan.summaryAuthority.revision ||
        creditorLine.stableBucketKey !== line.stableBucketKey ||
        creditorLine.stableBucketKeyFingerprint !== stableBucketKeyFingerprint(line.stableBucketKey) ||
        creditorLine.employmentCompanyId !== context.plan.summaryAuthority.employmentCompanyId ||
        creditorLine.projectId !== context.plan.summaryAuthority.projectId ||
        creditorLine.wageMonth !== context.plan.summaryAuthority.wageMonth ||
        creditorLine.positionCategoryCode !== context.plan.summaryAuthority.positionCategoryCode ||
        creditorLine.wageCreditorCategoryLabelSnapshot !== line.creditorCategoryLabel ||
        creditorLine.creditorIdentityKind !== line.creditorIdentityKind ||
        creditorLine.creditorPartyVersionId !== line.creditorPartyVersionId ||
        creditorLine.controlledScopeCode !== line.controlledScopeCode ||
        creditorLine.controlledScopeDescription !== line.controlledScopeDescription ||
        strictJcs(creditorLine.controlledScopeEvidenceCoordinate) !== strictJcs(line.controlledScopeEvidenceCoordinate) ||
        creditorLine.currencyCode !== "CNY" ||
        creditorLine.debtStatus !== line.debtStatus ||
        creditorLine.grossDebtCents !== line.grossDebtCents ||
        creditorLine.historicallySettledCents !== line.historicallySettledCents ||
        creditorLine.outstandingBalanceCents !== line.outstandingBalanceCents ||
        creditorLine.isTombstone !== (line.grossDebtCents === 0n) ||
        creditorLine.targetKind !== line.target.kind ||
        creditorLine.targetSchemaVersion !== 1 ||
        creditorLine.targetBusinessKey !== line.targetBusinessKey ||
        creditorLine.targetFingerprint !== finalizedTarget.fingerprint ||
        strictJcs(creditorLine.targetPayload) !== strictJcs(finalizedTarget.payload) ||
        creditorLine.signedGrossDeltaCents !== line.signedGrossDeltaCents ||
        creditorLine.signedHistoricallySettledDeltaCents !== line.signedHistoricallySettledDeltaCents ||
        creditorLine.signedOutstandingBalanceDeltaCents !== line.signedOutstandingBalanceDeltaCents ||
        creditorLine.deltaFingerprint !== line.deltaFingerprint ||
        creditorLine.rootCreditorLineId !== line.rootCreditorLineId ||
        creditorLine.rootPayableRefId !== line.rootPayableRefId
      ) {
        throw new ConflictException("B级历史工资汇总 creditor snapshot、signed delta 或原根已漂移，禁止激活");
      }
      validated.push({
        line,
        creditorLine,
        target: await this.validateBSummaryTarget(tx, context.plan.summaryAuthority, line),
        finalizedTarget
      });
    }
    const refIds: string[] = [];
    const creditorLineIds: string[] = [];
    for (const { line, creditorLine, target, finalizedTarget } of validated) {
      creditorLineIds.push(creditorLine.id);
      if (line.signedGrossDeltaCents === 0n) continue;
      const balanceVersion = finalizedTarget.balanceTarget
        ? await tx.historicalWageBalanceReconciliationVersion.create({
            data: balanceReconciliationData(
              context.scope.id,
              authority.id,
              creditorLine.id,
              line,
              finalizedTarget.balanceTarget
            )
          })
        : null;
      const ref = await tx.historicalWageSummaryPayableRef.create({
        data: {
          id: randomUUID(),
          atomicScopeVersionId: context.scope.id,
          authorityVersionId: authority.id,
          authorityCreditorLineId: creditorLine.id,
          rowMappingId: mapping.id,
          stableBucketKey: line.stableBucketKey,
          employmentCompanyId: context.plan.summaryAuthority.employmentCompanyId,
          projectId: context.plan.summaryAuthority.projectId,
          wageMonth: context.plan.summaryAuthority.wageMonth,
          positionCategoryCode: context.plan.summaryAuthority.positionCategoryCode,
          wageCreditorCategoryCode: line.creditorCategoryCode,
          wageCreditorCategoryLabelSnapshot: line.creditorCategoryLabel,
          creditorIdentityKind: line.creditorIdentityKind,
          creditorPartyVersionId: line.creditorPartyVersionId,
          controlledScopeCode: line.controlledScopeCode,
          controlledScopeDescription: line.controlledScopeDescription,
          controlledScopeEvidenceCoordinate: line.controlledScopeEvidenceCoordinate
            ? jsonInput(line.controlledScopeEvidenceCoordinate)
            : undefined,
          debtStatus: line.debtStatus,
          grossDebtCents: line.grossDebtCents,
          historicallySettledCents: line.historicallySettledCents,
          outstandingBalanceCents: line.outstandingBalanceCents,
          targetKind: target.kind,
          targetBusinessKey: line.targetBusinessKey,
          targetPayload: jsonInput(finalizedTarget.payload),
          targetFingerprint: finalizedTarget.fingerprint,
          ...(balanceVersion ? { historicalWageBalanceReconciliationVersionId: balanceVersion.id } : {}),
          usageScope: "historical_reconciliation_only",
          newPaymentAllowed: false,
          settlementAllocationAllowed: false,
          direction: line.signedGrossDeltaCents > 0n ? "increase" : "decrease",
          deltaAmountCents: line.signedGrossDeltaCents > 0n ? line.signedGrossDeltaCents : -line.signedGrossDeltaCents,
          adjustsSummaryPayableRefId: line.rootPayableRefId,
          deltaFingerprint: line.deltaFingerprint
        }
      });
      refIds.push(ref.id);
      if (target.kind === "existing_verified_payment_execution_set") {
        for (const [index, evidence] of target.paymentExecutions.entries()) {
          await tx.historicalWageSummaryPaymentExecutionLink.create({
            data: {
              id: randomUUID(),
              authorityCreditorLineId: creditorLine.id,
              summaryPayableRefId: ref.id,
              paymentExecutionId: evidence.paymentExecutionId,
              paymentExecutionFingerprint: evidence.paymentExecutionFingerprint,
              paymentExecutionSetFingerprint: target.paymentExecutionSetFingerprint,
              targetFingerprint: finalizedTarget.fingerprint,
              paymentEvidenceSnapshot: jsonInput(evidence),
              amountCents: BigInt(evidence.amountCents),
              ordinal: index + 1
            }
          });
        }
      }
    }
    for (const impact of [
      {
        legacyImpactEntryId: mapping.legacy.costImpactId,
        impactKind: "confirmed_cost",
        snapshot: mapping.legacy.costImpactSnapshot
      },
      {
        legacyImpactEntryId: mapping.legacy.payableImpactId,
        impactKind: mapping.legacy.direction === "increase" ? "payable_increase" : "payable_decrease",
        snapshot: mapping.legacy.payableImpactSnapshot
      }
    ]) {
      await tx.wageTakeoverLegacyImpactBridge.create({
        data: {
          id: randomUUID(),
          envelopeId: null,
          summaryAuthorityVersionId: authority.id,
          rowMappingId: mapping.id,
          projectId: mapping.projectId,
          legacyImpactEntryId: impact.legacyImpactEntryId,
          impactKind: impact.impactKind,
          direction: mapping.legacy.direction,
          amountCents: mapping.legacy.amountCents,
          sourceFingerprint: historicalWageLegacyImpactFingerprint(mapping.legacy, impact.impactKind, impact.snapshot)
        }
      });
    }
    void actorUserId;
    return {
      targetKind: "historical_wage_summary_authority_version",
      targetRef: authority.id,
      targetFingerprint: fingerprint({
        targetKind: "historical_wage_summary_authority_version",
        targetRef: authority.id,
        creditorLineIds: creditorLineIds.sort(),
        refIds: [...refIds].sort(),
        authorityFingerprint: authority.authorityFingerprint
      }),
      decision: "FORMAL"
    };
  }

  private async materializeCGap(
    tx: Tx,
    context: Awaited<ReturnType<HistoricalWageTakeoverService["loadAndRevalidateScope"]>>,
    mapping: ScopeMapping,
    actorUserId: string
  ): Promise<TakeoverTarget> {
    const existing = await tx.unresolvedWagePayableGap.findUnique({ where: { rowMappingId: mapping.id } });
    if (existing) {
      throw new ConflictException("既有历史工资 gap 已存在，当前新命令禁止跨范围 LINK");
    }
    const gap = await tx.unresolvedWagePayableGap.create({
      data: {
        id: randomUUID(),
        atomicScopeVersionId: context.scope.id,
        manifestVersionId: mapping.manifestId,
        rowMappingId: mapping.id,
        projectId: mapping.projectId,
        ...(wageMonthForPlan(context.plan) ? { wageMonth: wageMonthForPlan(context.plan) } : {}),
        reasonCode: context.plan.blockedReason ?? "UNRESOLVED_WAGE_AUTHORITY",
        sourceFingerprint: mapping.legacy.sourceFingerprint,
        gapSnapshot: jsonInput({
          reasonCode: context.plan.blockedReason ?? "UNRESOLVED_WAGE_AUTHORITY",
          legacy: legacyReadSet(mapping.legacy),
          negativeAuthorityFrontierFingerprint: context.plan.negativeAuthorityFrontierFingerprint ?? null,
          readSetFingerprint: context.scope.readSetFingerprint
        })
      }
    });
    void actorUserId;
    return {
      targetKind: "unresolved_wage_payable_gap",
      targetRef: gap.id,
      targetFingerprint: fingerprint({ targetKind: "unresolved_wage_payable_gap", targetRef: gap.id, sourceFingerprint: mapping.legacy.sourceFingerprint }),
      decision: "GAP"
    };
  }

  private async ensureLegacyBridge(tx: Tx, mapping: ScopeMapping, target: TakeoverTarget, actorUserId: string): Promise<TakeoverTarget> {
    const existing = await tx.operatingTakeoverLegacySourceBridge.findFirst({
      where: {
        projectId: mapping.projectId,
        sourceType: mapping.legacy.sourceType,
        sourceBusinessId: mapping.legacy.sourceBusinessId,
        sourceVersion: mapping.legacy.sourceVersion
      }
    });
    if (existing) {
      throw new ConflictException("legacy project_wage 已存在接管 bridge，当前新命令禁止跨范围 SKIP");
    }
    try {
      await tx.operatingTakeoverLegacySourceBridge.create({
        data: {
          id: randomUUID(),
          projectId: mapping.projectId,
          rowMappingId: mapping.id,
          sourceType: mapping.legacy.sourceType,
          sourceBusinessId: mapping.legacy.sourceBusinessId,
          sourceVersion: mapping.legacy.sourceVersion,
          sourceFingerprint: mapping.legacy.sourceFingerprint,
          targetKind: target.targetKind,
          targetRef: target.targetRef,
          targetFingerprint: target.targetFingerprint,
          mappingDecision: target.decision,
          createdByUserId: actorUserId
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("legacy project_wage 正在被另一串行接管事务链接，必须重新读取候选");
      }
      throw error;
    }
    return target;
  }

  private async assertNoDownstreamConsumption(
    tx: Tx,
    context: Awaited<ReturnType<HistoricalWageTakeoverService["loadAndRevalidateScope"]>>
  ) {
    const activation = context.receipts.find(
      (receipt) => receipt.action === "historical_wage_takeover.scope.activate" && receipt.status === "activated"
    );
    if (!activation) {
      throw new ConflictException("历史工资接管缺少可供补偿的 activation receipt");
    }
    const causalSuccessors = await tx.operatingTakeoverCommandReceipt.findMany({
      where: { causesReceiptId: activation.id },
      select: {
        id: true,
        action: true,
        status: true,
        atomicScopeVersionId: true,
        lines: {
          select: {
            id: true,
            rowMappingId: true,
            projectId: true,
            amountCents: true,
            causalOrdinal: true
          },
          orderBy: { causalOrdinal: "asc" }
        },
        causedReceipts: {
          select: {
            id: true,
            action: true,
            status: true,
            atomicScopeVersionId: true,
            causesReceiptId: true,
            lines: {
              select: {
                rowMappingId: true,
                projectId: true,
                amountCents: true,
                causalOrdinal: true,
                causesLineId: true
              },
              orderBy: { causalOrdinal: "asc" }
            }
          }
        }
      }
    });
    if (causalSuccessors.some((successor) => !isCompletelyCompensatedHistoricalActivation(successor))) {
      throw new ConflictException("CAUSAL_SUCCESSOR_EXISTS：必须先按逆因果补偿全部下游消费，#219 才能撤销接管资格");
    }
    const envelopes = await tx.wageTakeoverProjectionEnvelope.findMany({
      where: { atomicScopeVersionId: context.scope.id },
      include: { payableRefs: { select: { payableRefId: true } }, eligibilityRevocations: true }
    });
    if (envelopes.some((envelope) => envelope.eligibilityRevocations.length)) {
      throw new ConflictException("历史工资 legacy envelope 已被补偿撤销，不能重复处理");
    }
    const payableRefIds = envelopes.flatMap((envelope) => envelope.payableRefs.map((ref) => ref.payableRefId));
    if (payableRefIds.length) {
      const bindings = await tx.paymentExecutionWagePayableBinding.findMany({
        where: { wagePayableRefId: { in: payableRefIds } },
        select: { id: true }
      });
      if (bindings.length) {
        throw new ConflictException("已有下游付款/核销因果绑定；必须先由下游范围按逆因果补偿，#219 不得越权回退");
      }
    }
    const summaryRefs = await tx.historicalWageSummaryPayableRef.findMany({
      where: { atomicScopeVersionId: context.scope.id },
      include: { eligibilityRevocations: true }
    });
    if (summaryRefs.some((ref) => ref.eligibilityRevocations.length)) {
      throw new ConflictException("B级历史工资汇总债权资格已经撤销，不能重复处理");
    }
  }

  private async writeEligibilityRevocations(
    tx: Tx,
    context: Awaited<ReturnType<HistoricalWageTakeoverService["loadAndRevalidateScope"]>>,
    compensationReceiptId: string,
    reason: string
  ) {
    const envelopes = await tx.wageTakeoverProjectionEnvelope.findMany({ where: { atomicScopeVersionId: context.scope.id } });
    for (const envelope of envelopes) {
      await tx.wageTakeoverProjectionEnvelopeEligibilityRevocation.create({
        data: { id: randomUUID(), envelopeId: envelope.id, compensationReceiptId, reason }
      });
    }
    const summaryRefs = await tx.historicalWageSummaryPayableRef.findMany({ where: { atomicScopeVersionId: context.scope.id } });
    for (const ref of summaryRefs) {
      await tx.historicalWageSummaryPayableRefEligibilityRevocation.create({
        data: { id: randomUUID(), summaryPayableRefId: ref.id, compensationReceiptId, reason }
      });
    }
  }

  private async writeScopeReceipt(
    tx: Tx,
    atomicScopeVersionId: string,
    idempotencyKey: string,
    action: string,
    expectedRevision: number,
    identity: Identity,
    permissionSnapshotFingerprint: string,
    commandSnapshot: ReturnType<typeof canonicalCommandSnapshot>,
    status: string,
    resultSnapshot: Record<string, unknown>,
    mappings: Array<{ id: string; legacy: ResolvedLegacy; manifestId: string }>,
    options: {
      lineTargets?: Map<string, TakeoverTarget>;
      causesReceiptId?: string;
      causeLinesByMappingId?: Map<string, {
        id: string;
        projectId: string | null;
        amountCents: bigint;
        causalOrdinal: number;
        causalityFingerprint: string;
      }>;
    } = {}
  ) {
    const commandFingerprint = fingerprint(commandSnapshot);
    const receipt = await tx.operatingTakeoverCommandReceipt.create({
      data: {
        id: randomUUID(),
        atomicScopeVersionId,
        idempotencyKey,
        action,
        expectedRevision,
        actorUserId: identity.actualUserId,
        delegatorUserId: identity.delegatorUserId ?? null,
        actorSetSnapshot: identity.actorSetSnapshot,
        permissionSnapshotFingerprint,
        fingerprint: commandFingerprint,
        status,
        commandSnapshotSchemaVersion: 1,
        commandSnapshot: jsonInput(commandSnapshot),
        resultSnapshot: jsonInput(resultSnapshot),
        ...(options.causesReceiptId ? { causesReceiptId: options.causesReceiptId } : {}),
        causalityFingerprint: fingerprint({ action, atomicScopeVersionId, commandFingerprint, mappings: mappings.map((mapping) => mapping.id) })
      },
      select: { id: true }
    });
    for (const [index, mapping] of mappings.entries()) {
      const target = options.lineTargets?.get(mapping.id);
      const causeLine = options.causeLinesByMappingId?.get(mapping.id);
      if (options.causeLinesByMappingId && !causeLine) {
        throw new ConflictException("历史工资接管补偿 receipt line 缺少 exact activation predecessor");
      }
      const causalOrdinal = causeLine?.causalOrdinal ?? index + 1;
      await tx.operatingTakeoverCommandReceiptLine.create({
        data: {
          id: randomUUID(),
          receiptId: receipt.id,
          rowMappingId: mapping.id,
          projectId: mapping.legacy.projectId,
          lineNo: index + 1,
          decision: target?.decision ?? (status === "prepared" ? "PREPARED" : status),
          entryKind: "historical_wage",
          amountCents: mapping.legacy.amountCents,
          ...(target ? { targetKind: target.targetKind, targetRef: target.targetRef } : {}),
          causalOrdinal,
          ...(causeLine ? { causesLineId: causeLine.id } : {}),
          causalityFingerprint: fingerprint({
            receiptId: receipt.id,
            mappingId: mapping.id,
            causalOrdinal,
            causesLineId: causeLine?.id ?? null,
            causeLineFingerprint: causeLine?.causalityFingerprint ?? null
          }),
          lineSnapshot: jsonInput(legacyReadSet(mapping.legacy))
        }
      });
    }
    return receipt;
  }

  private async replay(tx: Tx, idempotencyKey: string, commandFingerprint: string) {
    const existing = await tx.operatingTakeoverCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!existing) return null;
    if (existing.fingerprint !== commandFingerprint) {
      throw new ConflictException("同一幂等键不能用于不同历史工资接管命令");
    }
    return existing.resultSnapshot;
  }

  private async lock(tx: Tx, key: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export function historicalWageLegacyFingerprint(fact: {
  id?: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  amountCents: bigint;
  occurredAt?: Date | string | null;
  costBearingCompanySubjectKind?: string | null;
  costBearingCompanySubjectId?: string | null;
  entryKind: string;
  adjustsFactId?: string | null;
  status: string;
  sourceSnapshot: unknown;
  impacts: Array<{ id: string; impactKind: string; amountCents: bigint; direction: string; sourceImpactKey: string; impactSnapshot?: unknown }>;
}) {
  return fingerprint({
    factId: fact.id ?? null,
    projectId: fact.projectId,
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    sourceVersion: fact.sourceVersion,
    amountCents: fact.amountCents,
    occurredAt: fact.occurredAt instanceof Date
      ? fact.occurredAt.toISOString()
      : typeof fact.occurredAt === "string"
        ? fact.occurredAt
        : null,
    costBearingCompanySubjectKind: fact.costBearingCompanySubjectKind ?? null,
    costBearingCompanySubjectId: fact.costBearingCompanySubjectId ?? null,
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId ?? null,
    status: fact.status,
    sourceSnapshot: fact.sourceSnapshot,
    impacts: [...fact.impacts]
      .map((impact) => ({
        id: impact.id,
        impactKind: impact.impactKind,
        amountCents: impact.amountCents,
        direction: impact.direction,
        sourceImpactKey: impact.sourceImpactKey,
        impactSnapshot: impact.impactSnapshot ?? null
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function assertCreateCommand(input: HistoricalWageTakeoverCommand) {
  if (!input || typeof input !== "object" || input.expectedRevision !== 0 || !text(input.selectionRef) || !uuid(input.idempotencyKey) || !text(input.businessReason)) {
    throw new ConflictException("历史工资接管创建命令仅接受有效 selectionRef、幂等键、初始版本与业务理由");
  }
}

function assertScopedCommand(input: HistoricalWageTakeoverCommand) {
  if (!input || typeof input !== "object" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || !text(input.selectionRef) || !uuid(input.idempotencyKey) || !text(input.businessReason)) {
    throw new ConflictException("历史工资接管命令仅接受有效 selectionRef、幂等键、版本与业务理由");
  }
}

function assertSelectionRenewal(input: HistoricalWageTakeoverSelectionRenewal) {
  if (!input || typeof input !== "object" || !text(input.selectionRef) || (input.delegatorUserId !== undefined && !uuid(input.delegatorUserId))) {
    throw new ConflictException("历史工资接管续签仅接受有效 scope selectionRef 和可选委托身份");
  }
}

function canonicalCommandSnapshot(action: string, actorUserId: string, binding: HistoricalWageSelectionBinding, input: HistoricalWageTakeoverCommand) {
  return {
    action,
    actorUserId,
    binding,
    expectedRevision: input.expectedRevision,
    businessReason: input.businessReason.trim(),
    evidenceRefs: normalizedEvidenceRefs(input.evidenceRefs),
    delegatorUserId: input.delegatorUserId ?? null
  };
}

function assertDelegatorBinding(binding: HistoricalWageSelectionBinding, inputDelegatorUserId: string | undefined) {
  if ((binding.delegatorUserId ?? null) !== (inputDelegatorUserId ?? null)) {
    throw new ForbiddenException("历史工资接管 selectionRef 的委托身份与当前命令不一致");
  }
}

/**
 * Actor, delegator and atomic scope are authorization/transport properties,
 * never authoritative source facts. Excluding them lets a separately
 * authorized reviewer receive a fresh command ref without changing the
 * immutable source read-set saved on the scope.
 */
function selectionSourceReadSet(binding: HistoricalWageSelectionBinding) {
  return {
    selectionFingerprint: binding.selectionFingerprint,
    grade: binding.grade,
    sourceVersionId: binding.sourceVersionId ?? null,
    sourceFingerprint: binding.sourceFingerprint ?? null,
    sourceClosureFingerprint: binding.sourceClosureFingerprint ?? null,
    summaryFingerprint: binding.summaryFingerprint ?? null,
    negativeAuthorityFrontierFingerprint: binding.negativeAuthorityFrontierFingerprint ?? null,
    legacyCoordinates: binding.legacyCoordinates
  };
}

function assertActions(roles: RoleKey[], action: HistoricalWageAction) {
  const policy = HISTORICAL_WAGE_ACTION_POLICY[action];
  const allowedPositions: readonly RoleKey[] = policy.positions;
  if (
    !roles.some((role) => allowedPositions.includes(role)) ||
    !canPerform(policy.actionKey, roles) ||
    !canPerform("wage_sensitive_read", roles)
  ) {
    if (action !== "prepare") {
      throw new ForbiddenException("历史工资接管复核、激活与补偿仅允许公司级财务负责人执行");
    }
    throw new ForbiddenException("当前岗位无权执行历史工资接管或读取其受控工资事实");
  }
}

function candidateBaselineSha() {
  const sha = process.env.BUILD_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  if (!sha || !/^[0-9a-f]{40}$/iu.test(sha)) {
    throw new ConflictException("历史工资接管缺少精确候选基线 SHA，必须失败关闭");
  }
  return sha.toLowerCase();
}

function approvedSourcePeople(snapshot: unknown, sourceEvidenceSha256 = ""): Array<{
  employeeId: string;
  employmentSnapshotId: string;
  employmentCompanyId: string;
  approvedAmountCents: bigint;
  evidenceSha256: string;
  projectAllocations: Array<{
    projectId: string;
    serviceSnapshotId: string;
    serviceMonth: string;
    serviceEvidenceSha256: string;
    amountCents: bigint;
  }>;
}> {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as { approvedPersonLines?: unknown }).approvedPersonLines)) return [];
  const rows: Array<{
    employeeId: string;
    employmentSnapshotId: string;
    employmentCompanyId: string;
    approvedAmountCents: bigint;
    evidenceSha256: string;
    projectAllocations: Array<{
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      serviceEvidenceSha256: string;
      amountCents: bigint;
    }>;
  }> = [];
  for (const value of (snapshot as { approvedPersonLines: unknown[] }).approvedPersonLines) {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (
      Array.isArray(row.projectAllocations) &&
      row.projectAllocations.some((allocation) =>
        !allocation || typeof allocation !== "object" || Array.isArray(allocation)
      )
    ) return [];
    const allocations = Array.isArray(row.projectAllocations)
      ? row.projectAllocations.map((allocation) => {
          const item = allocation as Record<string, unknown>;
          return {
            projectId: stringOrEmpty(item.projectId),
            serviceSnapshotId: stringOrEmpty(item.serviceSnapshotId),
            serviceMonth: stringOrEmpty(item.serviceMonth),
            serviceEvidenceSha256: stringOrEmpty(item.serviceEvidenceSha256),
            amountCents: nonNegativeBigInt(item.amountCents)
          };
        })
      : [];
    rows.push({
      employeeId: stringOrEmpty(row.employeeId),
      employmentSnapshotId: stringOrEmpty(row.employmentSnapshotId),
      employmentCompanyId: stringOrEmpty(row.employmentCompanyId),
      approvedAmountCents: nonNegativeBigInt(row.approvedAmountCents),
      evidenceSha256: stringOrEmpty(row.evidenceSha256) ||
        stringOrEmpty(((snapshot as Record<string, unknown>).evidence as Record<string, unknown> | undefined)?.sha256) ||
        stringOrEmpty((snapshot as Record<string, unknown>).evidenceSha256) ||
        sourceEvidenceSha256,
      projectAllocations: allocations
    });
  }
  return rows;
}

type CApprovedSourceStructuralReason =
  | "PERSON_HEADER_INVALID"
  | "COST_COMPONENT_INVALID"
  | "CREDITOR_BREAKDOWN_INVALID"
  | "PROJECT_ALLOCATION_INVALID"
  | "MATRIX_MISSING_OR_INCOMPLETE"
  | "DUPLICATE_COST_IDENTITY"
  | "DUPLICATE_PAYABLE_IDENTITY"
  | "MATRIX_REFERENCE_INVALID"
  | "MATRIX_BALANCE_INVALID";

type CCanonicalWageDependencyStructuralReason =
  | "PRIOR_VERSION_MISSING_OR_INELIGIBLE"
  | "PRIOR_PERSON_MATRIX_INVALID"
  | "PRIOR_COST_REFERENCE_INVALID"
  | "PRIOR_CREDITOR_REFERENCE_INVALID"
  | "PRIOR_MATRIX_BALANCE_INVALID"
  | "ROOT_PAYABLE_INVALID"
  | "ROOT_ADJUSTMENT_INVALID";

function cRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cNonNegativeBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}

function cCanonicalWageDependencyStructuralReason(
  statement: { id: string; currentRevision: number },
  currentVersionValue: unknown,
  rootPayableRefsValue: unknown
): CCanonicalWageDependencyStructuralReason | null {
  const currentVersion = cRecord(currentVersionValue);
  if (
    statement.currentRevision > 0 && (
      !currentVersion ||
      currentVersion.statementId !== statement.id ||
      currentVersion.revision !== statement.currentRevision ||
      currentVersion.status !== "confirmed" ||
      currentVersion.projectionOrigin !== "historical_takeover_legacy_link" ||
      !canonicalCText(currentVersion.sourceVersionId)
    )
  ) return "PRIOR_VERSION_MISSING_OR_INELIGIBLE";
  if (currentVersion) {
    if (!Array.isArray(currentVersion.personLines) || !currentVersion.personLines.length) {
      return "PRIOR_PERSON_MATRIX_INVALID";
    }
    const personKeys = new Set<string>();
    let versionCostTotal = 0n;
    let versionCreditorTotal = 0n;
    let versionProjectTotal = 0n;
    for (const rawPerson of currentVersion.personLines) {
      const person = cRecord(rawPerson);
      if (
        !person ||
        !canonicalCText(person.id) ||
        !canonicalCText(person.employeeId) ||
        !canonicalCText(person.employmentSnapshotId) ||
        !Array.isArray(person.costComponents) || !person.costComponents.length ||
        !Array.isArray(person.creditorBreakdowns) || !person.creditorBreakdowns.length ||
        !Array.isArray(person.projectAllocations) || !person.projectAllocations.length
      ) return "PRIOR_PERSON_MATRIX_INVALID";
      const personKey = `${person.employeeId}:${person.employmentSnapshotId}`;
      if (personKeys.has(personKey)) return "PRIOR_PERSON_MATRIX_INVALID";
      personKeys.add(personKey);

      const costById = new Map<string, Record<string, unknown>>();
      for (const rawCost of person.costComponents) {
        const cost = cRecord(rawCost);
        if (
          !cost ||
          !canonicalCText(cost.id) ||
          !canonicalCText(cost.componentCode) ||
          !WAGE_COST_COMPONENT_CODES.includes(cost.componentCode as never) ||
          !cNonNegativeBigInt(cost.amountCents) ||
          !Array.isArray(cost.projectAllocations) ||
          costById.has(cost.id)
        ) return "PRIOR_PERSON_MATRIX_INVALID";
        costById.set(cost.id, cost);
      }
      const creditorById = new Map<string, Record<string, unknown>>();
      const creditorSemanticKeys = new Set<string>();
      for (const rawCreditor of person.creditorBreakdowns) {
        const creditor = cRecord(rawCreditor);
        if (
          !creditor ||
          !canonicalCText(creditor.id) ||
          (creditor.creditorSubjectType !== "employee_user" && creditor.creditorSubjectType !== "business_party") ||
          !canonicalCText(creditor.creditorSubjectIdentityKey) ||
          !canonicalCText(creditor.creditorCategory) ||
          !WAGE_CREDITOR_CATEGORIES.includes(creditor.creditorCategory as never) ||
          !cNonNegativeBigInt(creditor.amountCents) ||
          !Array.isArray(creditor.projectAllocations) ||
          creditorById.has(creditor.id)
        ) return "PRIOR_PERSON_MATRIX_INVALID";
        const semanticKey = [
          creditor.creditorSubjectType,
          creditor.creditorSubjectIdentityKey,
          creditor.creditorCategory
        ].join(":");
        if (creditorSemanticKeys.has(semanticKey)) return "PRIOR_CREDITOR_REFERENCE_INVALID";
        creditorSemanticKeys.add(semanticKey);
        creditorById.set(creditor.id, creditor);
      }
      const projectAllocationIds = new Set<string>();
      const projectCostCells = new Map<string, { id: string; amountCents: bigint }>();
      const projectCreditorCells = new Map<string, { id: string; amountCents: bigint }>();
      const costTotalsById = new Map<string, bigint>();
      const creditorTotalsById = new Map<string, bigint>();
      let personProjectTotal = 0n;
      for (const rawAllocation of person.projectAllocations) {
        const allocation = cRecord(rawAllocation);
        if (
          !allocation ||
          !canonicalCText(allocation.id) ||
          !canonicalCText(allocation.projectId) ||
          !canonicalCText(allocation.serviceSnapshotId) ||
          !cNonNegativeBigInt(allocation.amountCents) ||
          projectAllocationIds.has(allocation.id) ||
          !Array.isArray(allocation.componentAllocations) ||
          !Array.isArray(allocation.creditorAllocations)
        ) return "PRIOR_PERSON_MATRIX_INVALID";
        projectAllocationIds.add(allocation.id);
        personProjectTotal += allocation.amountCents;
        const componentReferences = new Set<string>();
        let projectCostTotal = 0n;
        for (const rawCell of allocation.componentAllocations) {
          const cell = cRecord(rawCell);
          const component = cRecord(cell?.costComponent);
          const expected = cell && canonicalCText(cell.costComponentId)
            ? costById.get(cell.costComponentId)
            : null;
          if (
            !cell || !component || !expected ||
            !canonicalCText(cell.id) ||
            !cNonNegativeBigInt(cell.amountCents) ||
            componentReferences.has(cell.costComponentId as string) ||
            component.id !== cell.costComponentId ||
            component.componentCode !== expected.componentCode
          ) return "PRIOR_COST_REFERENCE_INVALID";
          componentReferences.add(cell.costComponentId as string);
          projectCostTotal += cell.amountCents;
          costTotalsById.set(
            cell.costComponentId as string,
            (costTotalsById.get(cell.costComponentId as string) ?? 0n) + cell.amountCents
          );
          projectCostCells.set(`${allocation.id}:${cell.costComponentId}`, {
            id: cell.id as string,
            amountCents: cell.amountCents
          });
        }
        if (
          componentReferences.size !== costById.size ||
          [...costById.keys()].some((id) => !componentReferences.has(id))
        ) return "PRIOR_COST_REFERENCE_INVALID";
        const creditorReferences = new Set<string>();
        let projectCreditorTotal = 0n;
        for (const rawCell of allocation.creditorAllocations) {
          const cell = cRecord(rawCell);
          const creditor = cRecord(cell?.creditorBreakdown);
          const expected = cell && canonicalCText(cell.creditorBreakdownId)
            ? creditorById.get(cell.creditorBreakdownId)
            : null;
          if (
            !cell || !creditor || !expected ||
            !canonicalCText(cell.id) ||
            !cNonNegativeBigInt(cell.amountCents) ||
            creditorReferences.has(cell.creditorBreakdownId as string) ||
            creditor.id !== cell.creditorBreakdownId ||
            creditor.creditorSubjectType !== expected.creditorSubjectType ||
            creditor.creditorSubjectIdentityKey !== expected.creditorSubjectIdentityKey ||
            creditor.creditorCategory !== expected.creditorCategory
          ) return "PRIOR_CREDITOR_REFERENCE_INVALID";
          creditorReferences.add(cell.creditorBreakdownId as string);
          projectCreditorTotal += cell.amountCents;
          creditorTotalsById.set(
            cell.creditorBreakdownId as string,
            (creditorTotalsById.get(cell.creditorBreakdownId as string) ?? 0n) + cell.amountCents
          );
          projectCreditorCells.set(`${allocation.id}:${cell.creditorBreakdownId}`, {
            id: cell.id as string,
            amountCents: cell.amountCents
          });
        }
        if (
          creditorReferences.size !== creditorById.size ||
          [...creditorById.keys()].some((id) => !creditorReferences.has(id))
        ) return "PRIOR_CREDITOR_REFERENCE_INVALID";
        if (
          projectCostTotal !== allocation.amountCents ||
          projectCreditorTotal !== allocation.amountCents
        ) return "PRIOR_MATRIX_BALANCE_INVALID";
      }
      let personCostTotal = 0n;
      for (const [costId, cost] of costById) {
        const reverseCells = cost.projectAllocations as unknown[];
        const reverseProjectIds = new Set<string>();
        for (const rawReverseCell of reverseCells) {
          const reverseCell = cRecord(rawReverseCell);
          const projectAllocationId = reverseCell?.projectAllocationId;
          const expectedCell = canonicalCText(projectAllocationId)
            ? projectCostCells.get(`${projectAllocationId}:${costId}`)
            : null;
          if (
            !reverseCell || !expectedCell ||
            !canonicalCText(reverseCell.id) ||
            !cNonNegativeBigInt(reverseCell.amountCents) ||
            reverseProjectIds.has(projectAllocationId as string) ||
            reverseCell.id !== expectedCell.id ||
            reverseCell.amountCents !== expectedCell.amountCents
          ) return "PRIOR_COST_REFERENCE_INVALID";
          reverseProjectIds.add(projectAllocationId as string);
        }
        if (
          reverseProjectIds.size !== projectAllocationIds.size ||
          [...projectAllocationIds].some((id) => !reverseProjectIds.has(id)) ||
          costTotalsById.get(costId) !== cost.amountCents
        ) return "PRIOR_MATRIX_BALANCE_INVALID";
        personCostTotal += cost.amountCents as bigint;
      }
      let personCreditorTotal = 0n;
      for (const [creditorId, creditor] of creditorById) {
        const reverseCells = creditor.projectAllocations as unknown[];
        const reverseProjectIds = new Set<string>();
        for (const rawReverseCell of reverseCells) {
          const reverseCell = cRecord(rawReverseCell);
          const projectAllocationId = reverseCell?.projectAllocationId;
          const expectedCell = canonicalCText(projectAllocationId)
            ? projectCreditorCells.get(`${projectAllocationId}:${creditorId}`)
            : null;
          if (
            !reverseCell || !expectedCell ||
            !canonicalCText(reverseCell.id) ||
            !cNonNegativeBigInt(reverseCell.amountCents) ||
            reverseProjectIds.has(projectAllocationId as string) ||
            reverseCell.id !== expectedCell.id ||
            reverseCell.amountCents !== expectedCell.amountCents
          ) return "PRIOR_CREDITOR_REFERENCE_INVALID";
          reverseProjectIds.add(projectAllocationId as string);
        }
        if (
          reverseProjectIds.size !== projectAllocationIds.size ||
          [...projectAllocationIds].some((id) => !reverseProjectIds.has(id)) ||
          creditorTotalsById.get(creditorId) !== creditor.amountCents
        ) return "PRIOR_MATRIX_BALANCE_INVALID";
        personCreditorTotal += creditor.amountCents as bigint;
      }
      if (
        personCostTotal !== personCreditorTotal ||
        personCostTotal !== personProjectTotal
      ) return "PRIOR_MATRIX_BALANCE_INVALID";
      versionCostTotal += personCostTotal;
      versionCreditorTotal += personCreditorTotal;
      versionProjectTotal += personProjectTotal;
    }
    if (
      versionCostTotal !== versionCreditorTotal ||
      versionCostTotal !== versionProjectTotal
    ) {
      return "PRIOR_MATRIX_BALANCE_INVALID";
    }
  }

  if (!Array.isArray(rootPayableRefsValue)) return "ROOT_PAYABLE_INVALID";
  const rootIds = new Set<string>();
  for (const rawRoot of rootPayableRefsValue) {
    const root = cRecord(rawRoot);
    const confirmedVersion = cRecord(root?.confirmedVersion);
    const projectAllocation = cRecord(root?.projectAllocation);
    const personLine = cRecord(root?.personLine);
    const creditorBreakdown = cRecord(root?.creditorBreakdown);
    if (
      !root || !confirmedVersion || !projectAllocation || !personLine || !creditorBreakdown ||
      !canonicalCText(root.id) || rootIds.has(root.id) ||
      root.direction !== "increase" ||
      !cNonNegativeBigInt(root.amountCents) ||
      !canonicalCText(root.confirmedVersionId) ||
      confirmedVersion.id !== root.confirmedVersionId ||
      !Number.isSafeInteger(confirmedVersion.revision) ||
      (confirmedVersion.revision as number) < 1 ||
      (confirmedVersion.revision as number) > statement.currentRevision ||
      confirmedVersion.status !== "confirmed" ||
      confirmedVersion.projectionOrigin !== "historical_takeover_legacy_link" ||
      !canonicalCText(root.debtorCompanyId) ||
      !canonicalCText(root.costBearingCompanyId) ||
      !canonicalCText(root.projectId) ||
      !canonicalCText(projectAllocation.serviceSnapshotId) ||
      !canonicalCText(personLine.employeeId) ||
      !canonicalCText(personLine.employmentSnapshotId) ||
      (creditorBreakdown.creditorSubjectType !== "employee_user" &&
        creditorBreakdown.creditorSubjectType !== "business_party") ||
      !canonicalCText(creditorBreakdown.creditorSubjectIdentityKey) ||
      !canonicalCText(creditorBreakdown.creditorCategory) ||
      !WAGE_CREDITOR_CATEGORIES.includes(creditorBreakdown.creditorCategory as never) ||
      !Array.isArray(root.adjustments)
    ) return "ROOT_PAYABLE_INVALID";
    rootIds.add(root.id);
    const adjustmentIds = new Set<string>();
    let effectiveAmountCents = root.amountCents;
    for (const rawAdjustment of root.adjustments) {
      const adjustment = cRecord(rawAdjustment);
      if (
        !adjustment ||
        !canonicalCText(adjustment.id) ||
        adjustmentIds.has(adjustment.id) ||
        (adjustment.direction !== "increase" && adjustment.direction !== "decrease") ||
        !cNonNegativeBigInt(adjustment.amountCents)
      ) return "ROOT_ADJUSTMENT_INVALID";
      adjustmentIds.add(adjustment.id);
      effectiveAmountCents += adjustment.direction === "increase"
        ? adjustment.amountCents
        : -adjustment.amountCents;
    }
    if (effectiveAmountCents < 0n) return "ROOT_ADJUSTMENT_INVALID";
  }
  return null;
}

function cCreditorIdentity(
  value: Record<string, unknown>,
  employeeId: string
): { key: string; category: string } | null {
  const subjectType = value.creditorSubjectType;
  const category = value.creditorCategory;
  if (
    (subjectType !== "employee_user" && subjectType !== "business_party") ||
    !canonicalCText(category) ||
    !WAGE_CREDITOR_CATEGORIES.includes(category as never)
  ) return null;
  if (subjectType === "employee_user") {
    if (
      category !== "employee_net_pay" ||
      value.creditorUserId !== employeeId ||
      Boolean(value.creditorBusinessPartyVersionId)
    ) return null;
    return { key: `employee_user:${employeeId}:${category}`, category };
  }
  if (
    category === "employee_net_pay" ||
    !canonicalCText(value.creditorBusinessPartyVersionId) ||
    Boolean(value.creditorUserId)
  ) return null;
  return {
    key: `business_party:${value.creditorBusinessPartyVersionId}:${category}`,
    category
  };
}

function cApprovedSourceStructuralReason(
  source: HistoricalWageApprovedSourceCandidate
): CApprovedSourceStructuralReason | null {
  const snapshot = source.sourceSnapshot as Record<string, unknown>;
  const rawLines = snapshot.approvedPersonLines;
  if (!Array.isArray(rawLines) || !rawLines.length) return "PERSON_HEADER_INVALID";
  const periodStart = source.periodStart.toISOString().slice(0, 10);
  const periodEnd = source.periodEnd.toISOString().slice(0, 10);
  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      return "PERSON_HEADER_INVALID";
    }
    const line = rawLine as Record<string, unknown>;
    if (
      !canonicalCText(line.employeeId) ||
      !canonicalCText(line.employmentSnapshotId) ||
      line.employmentCompanyId !== source.employmentCompanyId ||
      line.employmentPeriodStart !== periodStart ||
      line.employmentPeriodEnd !== periodEnd ||
      !canonicalCText(line.positionCategory) ||
      !canonicalCNonNegativeInteger(line.approvedAmountCents)
    ) return "PERSON_HEADER_INVALID";
    const employeeId = line.employeeId;
    const approvedAmountCents = BigInt(line.approvedAmountCents);
    const costRows = line.costComponents;
    const creditorRows = line.creditorBreakdowns;
    const projectRows = line.projectAllocations;
    const projectCostRows = line.projectCostComponentAllocations;
    const projectCreditorRows = line.projectCreditorAllocations;
    if (!Array.isArray(costRows) || !costRows.length) return "COST_COMPONENT_INVALID";
    if (!Array.isArray(creditorRows) || !creditorRows.length) return "CREDITOR_BREAKDOWN_INVALID";
    if (!Array.isArray(projectRows) || !projectRows.length) return "PROJECT_ALLOCATION_INVALID";
    if (
      !Array.isArray(projectCostRows) || !projectCostRows.length ||
      !Array.isArray(projectCreditorRows) || !projectCreditorRows.length
    ) return "MATRIX_MISSING_OR_INCOMPLETE";

    const costAmounts = new Map<string, bigint>();
    for (const rawCost of costRows) {
      if (!rawCost || typeof rawCost !== "object" || Array.isArray(rawCost)) {
        return "COST_COMPONENT_INVALID";
      }
      const cost = rawCost as Record<string, unknown>;
      if (
        !canonicalCText(cost.componentCode) ||
        !WAGE_COST_COMPONENT_CODES.includes(cost.componentCode as never) ||
        !canonicalCNonNegativeInteger(cost.amountCents)
      ) return "COST_COMPONENT_INVALID";
      if (costAmounts.has(cost.componentCode)) return "COST_COMPONENT_INVALID";
      costAmounts.set(cost.componentCode, BigInt(cost.amountCents));
    }

    const creditorAmounts = new Map<string, bigint>();
    let employeeNetPayCount = 0;
    for (const rawCreditor of creditorRows) {
      if (!rawCreditor || typeof rawCreditor !== "object" || Array.isArray(rawCreditor)) {
        return "CREDITOR_BREAKDOWN_INVALID";
      }
      const creditor = rawCreditor as Record<string, unknown>;
      const identity = cCreditorIdentity(creditor, employeeId);
      if (!identity || !canonicalCNonNegativeInteger(creditor.amountCents)) {
        return "CREDITOR_BREAKDOWN_INVALID";
      }
      if (identity.category === "employee_net_pay") employeeNetPayCount += 1;
      if (creditorAmounts.has(identity.key)) return "CREDITOR_BREAKDOWN_INVALID";
      creditorAmounts.set(identity.key, BigInt(creditor.amountCents));
    }
    if (employeeNetPayCount !== 1) return "CREDITOR_BREAKDOWN_INVALID";

    const projectAmounts = new Map<string, bigint>();
    for (const rawProject of projectRows) {
      if (!rawProject || typeof rawProject !== "object" || Array.isArray(rawProject)) {
        return "PROJECT_ALLOCATION_INVALID";
      }
      const project = rawProject as Record<string, unknown>;
      if (
        !canonicalCText(project.projectId) ||
        !canonicalCText(project.serviceSnapshotId) ||
        project.serviceMonth !== source.wageMonth ||
        project.serviceEvidenceSha256 !== source.evidenceSha256 ||
        !canonicalCNonNegativeInteger(project.amountCents)
      ) return "PROJECT_ALLOCATION_INVALID";
      const key = `${project.projectId}:${project.serviceSnapshotId}`;
      if (projectAmounts.has(key)) return "PROJECT_ALLOCATION_INVALID";
      projectAmounts.set(key, BigInt(project.amountCents));
    }

    const costCellAmounts = new Map<string, bigint>();
    const costTotalsByProject = new Map<string, bigint>();
    const costTotalsByComponent = new Map<string, bigint>();
    for (const rawCell of projectCostRows) {
      if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) {
        return "MATRIX_REFERENCE_INVALID";
      }
      const cell = rawCell as Record<string, unknown>;
      if (
        !canonicalCText(cell.projectId) ||
        !canonicalCText(cell.serviceSnapshotId) ||
        !canonicalCText(cell.componentCode) ||
        !canonicalCNonNegativeInteger(cell.amountCents)
      ) return "MATRIX_REFERENCE_INVALID";
      const projectKey = `${cell.projectId}:${cell.serviceSnapshotId}`;
      if (!projectAmounts.has(projectKey) || !costAmounts.has(cell.componentCode)) {
        return "MATRIX_REFERENCE_INVALID";
      }
      const key = `${projectKey}:${cell.componentCode}`;
      if (costCellAmounts.has(key)) return "DUPLICATE_COST_IDENTITY";
      const amount = BigInt(cell.amountCents);
      costCellAmounts.set(key, amount);
      costTotalsByProject.set(projectKey, (costTotalsByProject.get(projectKey) ?? 0n) + amount);
      costTotalsByComponent.set(cell.componentCode, (costTotalsByComponent.get(cell.componentCode) ?? 0n) + amount);
    }

    const payableCellAmounts = new Map<string, bigint>();
    const payableTotalsByProject = new Map<string, bigint>();
    const payableTotalsByCreditor = new Map<string, bigint>();
    for (const rawCell of projectCreditorRows) {
      if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) {
        return "MATRIX_REFERENCE_INVALID";
      }
      const cell = rawCell as Record<string, unknown>;
      if (
        !canonicalCText(cell.projectId) ||
        !canonicalCText(cell.serviceSnapshotId) ||
        !canonicalCNonNegativeInteger(cell.amountCents)
      ) return "MATRIX_REFERENCE_INVALID";
      const projectKey = `${cell.projectId}:${cell.serviceSnapshotId}`;
      const identity = cCreditorIdentity(cell, employeeId);
      if (!projectAmounts.has(projectKey) || !identity || !creditorAmounts.has(identity.key)) {
        return "MATRIX_REFERENCE_INVALID";
      }
      const key = `${projectKey}:${identity.key}`;
      if (payableCellAmounts.has(key)) return "DUPLICATE_PAYABLE_IDENTITY";
      const amount = BigInt(cell.amountCents);
      payableCellAmounts.set(key, amount);
      payableTotalsByProject.set(projectKey, (payableTotalsByProject.get(projectKey) ?? 0n) + amount);
      payableTotalsByCreditor.set(identity.key, (payableTotalsByCreditor.get(identity.key) ?? 0n) + amount);
    }

    const expectedCostKeys = [...projectAmounts.keys()].flatMap((projectKey) =>
      [...costAmounts.keys()].map((componentCode) => `${projectKey}:${componentCode}`)
    );
    const expectedPayableKeys = [...projectAmounts.keys()].flatMap((projectKey) =>
      [...creditorAmounts.keys()].map((creditorKey) => `${projectKey}:${creditorKey}`)
    );
    if (
      costCellAmounts.size !== expectedCostKeys.length ||
      expectedCostKeys.some((key) => !costCellAmounts.has(key)) ||
      payableCellAmounts.size !== expectedPayableKeys.length ||
      expectedPayableKeys.some((key) => !payableCellAmounts.has(key))
    ) return "MATRIX_MISSING_OR_INCOMPLETE";
    if (
      [...costAmounts.values()].reduce((sum, amount) => sum + amount, 0n) !== approvedAmountCents ||
      [...creditorAmounts.values()].reduce((sum, amount) => sum + amount, 0n) !== approvedAmountCents ||
      [...projectAmounts.values()].reduce((sum, amount) => sum + amount, 0n) !== approvedAmountCents ||
      [...projectAmounts].some(([key, amount]) =>
        costTotalsByProject.get(key) !== amount || payableTotalsByProject.get(key) !== amount
      ) ||
      [...costAmounts].some(([key, amount]) => costTotalsByComponent.get(key) !== amount) ||
      [...creditorAmounts].some(([key, amount]) => payableTotalsByCreditor.get(key) !== amount)
    ) return "MATRIX_BALANCE_INVALID";
  }
  return null;
}

function validCApprovedSourceCandidate(source: HistoricalWageApprovedSourceCandidate) {
  if (
    !canonicalCText(source.id) ||
    !canonicalCText(source.employmentCompanyId) ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(source.wageMonth) ||
    !validCPlannerDate(source.periodStart) ||
    !validCPlannerDate(source.periodEnd) ||
    source.sourceType !== "external_approved_wage" ||
    !canonicalCText(source.externalReference) ||
    !canonicalCText(source.sourceVersion) ||
    !validCPlannerDate(source.basisDate) ||
    !canonicalCText(source.evidenceFileId) ||
    !/^[0-9a-f]{64}$/u.test(source.evidenceSha256) ||
    !/^[0-9a-f]{64}$/u.test(source.sourceFingerprint) ||
    !source.sourceSnapshot ||
    typeof source.sourceSnapshot !== "object" ||
    Array.isArray(source.sourceSnapshot) ||
    fingerprint(source.sourceSnapshot) !== source.sourceFingerprint
  ) return false;
  const snapshot = source.sourceSnapshot as Record<string, unknown>;
  const company = snapshot.employmentCompany;
  const evidence = snapshot.evidence;
  if (
    !company ||
    typeof company !== "object" ||
    Array.isArray(company) ||
    (company as Record<string, unknown>).id !== source.employmentCompanyId ||
    snapshot.wageMonth !== source.wageMonth ||
    snapshot.periodStart !== source.periodStart.toISOString().slice(0, 10) ||
    snapshot.periodEnd !== source.periodEnd.toISOString().slice(0, 10) ||
    snapshot.externalReference !== source.externalReference ||
    snapshot.sourceVersion !== source.sourceVersion ||
    snapshot.basisDate !== source.basisDate.toISOString().slice(0, 10) ||
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    (evidence as Record<string, unknown>).fileId !== source.evidenceFileId ||
    (evidence as Record<string, unknown>).sha256 !== source.evidenceSha256
  ) return false;
  const rawLines = snapshot.approvedPersonLines;
  if (!Array.isArray(rawLines) || !rawLines.length) return false;
  const people = approvedSourcePeople(source.sourceSnapshot, source.evidenceSha256);
  if (people.length !== rawLines.length || people.some((person) => !validApprovedPerson(person))) return false;
  const personKeys = new Set<string>();
  let total = 0n;
  for (const [index, rawLine] of rawLines.entries()) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) return false;
    const line = rawLine as Record<string, unknown>;
    const person = people[index]!;
    if (
      !canonicalCText(line.employeeId) ||
      !canonicalCText(line.employmentSnapshotId) ||
      line.employmentCompanyId !== source.employmentCompanyId ||
      !canonicalCNonNegativeInteger(line.approvedAmountCents)
    ) return false;
    const personKey = `${person.employeeId}:${person.employmentSnapshotId}`;
    if (personKeys.has(personKey)) return false;
    personKeys.add(personKey);
    total += person.approvedAmountCents;
    if (!Array.isArray(line.projectAllocations) || line.projectAllocations.length !== person.projectAllocations.length) return false;
    const allocationKeys = new Set<string>();
    for (const allocation of line.projectAllocations) {
      if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) return false;
      const item = allocation as Record<string, unknown>;
      if (
        !canonicalCText(item.projectId) ||
        !canonicalCText(item.serviceSnapshotId) ||
        item.serviceMonth !== source.wageMonth ||
        item.serviceEvidenceSha256 !== source.evidenceSha256 ||
        !canonicalCNonNegativeInteger(item.amountCents)
      ) return false;
      const allocationKey = `${item.projectId}:${item.serviceSnapshotId}`;
      if (allocationKeys.has(allocationKey)) return false;
      allocationKeys.add(allocationKey);
    }
  }
  return total > 0n && cApprovedSourceStructuralReason(source) === null;
}

function canonicalCNegativePlannerResult(
  value: unknown,
  people: ReturnType<typeof approvedSourcePeople>
): HistoricalWageTakeoverPlan {
  const fail = (): never => { throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const plan = value as Record<string, unknown>;
  const expectedKeys = [
    "canonicalRootClosureFingerprint",
    "canonicalRootPayableRefIds",
    "expectedCurrentRevision",
    "priorConfirmedVersionId",
    "priorSourceVersionId",
    "projects",
    "reservedRevision",
    "sourceDeltaFingerprint",
    "targetWageStatementId",
    "versionKind"
  ].sort();
  if (!sameStrings(Object.keys(plan).sort(), expectedKeys)) return fail();
  if (
    !canonicalCText(plan.targetWageStatementId) ||
    !Number.isSafeInteger(plan.expectedCurrentRevision) ||
    (plan.expectedCurrentRevision as number) < 0 ||
    !Number.isSafeInteger(plan.reservedRevision) ||
    plan.reservedRevision !== (plan.expectedCurrentRevision as number) + 1 ||
    typeof plan.versionKind !== "string" ||
    !["base", "correction", "reversal"].includes(plan.versionKind) ||
    typeof plan.sourceDeltaFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(plan.sourceDeltaFingerprint) ||
    typeof plan.canonicalRootClosureFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(plan.canonicalRootClosureFingerprint) ||
    !Array.isArray(plan.canonicalRootPayableRefIds) ||
    !Array.isArray(plan.projects)
  ) return fail();
  const expectedCurrentRevision = plan.expectedCurrentRevision as number;
  const versionKind = plan.versionKind as HistoricalWageTakeoverPlan["versionKind"];
  if (
    (expectedCurrentRevision === 0 && (
      versionKind !== "base" ||
      plan.priorConfirmedVersionId !== null ||
      plan.priorSourceVersionId !== null
    )) ||
    (expectedCurrentRevision > 0 && (
      versionKind === "base" ||
      !canonicalCText(plan.priorConfirmedVersionId) ||
      !canonicalCText(plan.priorSourceVersionId)
    ))
  ) return fail();
  const canonicalRootPayableRefIds = plan.canonicalRootPayableRefIds as unknown[];
  if (
    canonicalRootPayableRefIds.some((id) => !canonicalCText(id)) ||
    new Set(canonicalRootPayableRefIds).size !== canonicalRootPayableRefIds.length
  ) return fail();
  const projects = (plan.projects as unknown[]).map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fail();
    const project = candidate as Record<string, unknown>;
    if (!sameStrings(Object.keys(project).sort(), ["projectId", "signedCostDeltaCents", "signedPayableDeltaCents"])) return fail();
    if (
      !canonicalCText(project.projectId) ||
      !canonicalCSignedInteger(project.signedCostDeltaCents) ||
      !canonicalCSignedInteger(project.signedPayableDeltaCents) ||
      project.signedCostDeltaCents !== project.signedPayableDeltaCents
    ) return fail();
    return {
      projectId: project.projectId,
      signedCostDeltaCents: project.signedCostDeltaCents,
      signedPayableDeltaCents: project.signedPayableDeltaCents
    } as HistoricalWageTakeoverPlan["projects"][number];
  });
  const expectedProjectIds = sortedUnique(people.flatMap((person) =>
    person.projectAllocations.map((allocation) => allocation.projectId)
  ));
  const actualProjectIds = projects.map((project) => project.projectId);
  if (
    !projects.length ||
    new Set(actualProjectIds).size !== actualProjectIds.length ||
    !sameStrings([...actualProjectIds].sort((left, right) => left.localeCompare(right)), expectedProjectIds)
  ) return fail();
  return {
    targetWageStatementId: plan.targetWageStatementId as string,
    expectedCurrentRevision,
    reservedRevision: plan.reservedRevision as number,
    versionKind,
    priorConfirmedVersionId: plan.priorConfirmedVersionId as string | null,
    priorSourceVersionId: plan.priorSourceVersionId as string | null,
    sourceDeltaFingerprint: plan.sourceDeltaFingerprint as string,
    canonicalRootClosureFingerprint: plan.canonicalRootClosureFingerprint as string,
    canonicalRootPayableRefIds: (canonicalRootPayableRefIds as string[])
      .sort((left, right) => left.localeCompare(right)),
    projects: projects.sort((left, right) => left.projectId.localeCompare(right.projectId))
  };
}

function canonicalCText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() && !/\p{Cc}/u.test(value);
}

function canonicalCNonNegativeInteger(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function canonicalCSignedInteger(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|-?[1-9][0-9]*)$/u.test(value);
}

function validCPlannerDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime()) && value.toISOString().endsWith("T00:00:00.000Z");
}

function materializationServiceBindingKey(value: { projectId: string; serviceSnapshotId: string }) {
  return `${value.projectId}:${value.serviceSnapshotId}`;
}

function materializationBusinessPartyVersionIds(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as { approvedPersonLines?: unknown }).approvedPersonLines)) {
    return [];
  }
  return sortedUnique((snapshot as { approvedPersonLines: unknown[] }).approvedPersonLines.flatMap((person) => {
    if (!person || typeof person !== "object") return [];
    const creditors = (person as { creditorBreakdowns?: unknown }).creditorBreakdowns;
    if (!Array.isArray(creditors)) return [];
    return creditors.flatMap((creditor) => {
      if (!creditor || typeof creditor !== "object") return [];
      const id = stringOrEmpty((creditor as { creditorBusinessPartyVersionId?: unknown }).creditorBusinessPartyVersionId);
      return id ? [id] : [];
    });
  }));
}

function validApprovedPerson(person: ReturnType<typeof approvedSourcePeople>[number]) {
  return text(person.employeeId) && text(person.employmentSnapshotId) && text(person.employmentCompanyId) && person.approvedAmountCents >= 0n && SHA256.test(person.evidenceSha256) && person.projectAllocations.length > 0 && person.projectAllocations.every((allocation) => text(allocation.projectId) && text(allocation.serviceSnapshotId) && allocation.amountCents >= 0n) && person.projectAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n) === person.approvedAmountCents;
}

function approvedProjectTotals(people: ReturnType<typeof approvedSourcePeople>) {
  const totals = new Map<string, bigint>();
  for (const person of people) {
    for (const allocation of person.projectAllocations) {
      totals.set(allocation.projectId, (totals.get(allocation.projectId) ?? 0n) + allocation.amountCents);
    }
  }
  return totals;
}

function approvedIdentityKeys(people: ReturnType<typeof approvedSourcePeople>) {
  return people.flatMap((person) => person.projectAllocations.map((allocation) => [
    person.employeeId,
    person.employmentSnapshotId,
    person.employmentCompanyId,
    allocation.projectId,
    allocation.serviceSnapshotId
  ].join(":"))).sort((left, right) => left.localeCompare(right));
}

function balanceReconciliationData(
  atomicScopeVersionId: string,
  authorityVersionId: string,
  authorityCreditorLineId: string,
  line: HistoricalSummaryLine,
  target: NonNullable<ReturnType<typeof finalizeHistoricalWageBalanceTarget>>
) {
  return {
    id: target.reservedTargetId,
    atomicScopeVersionId,
    authorityVersionId,
    authorityCreditorLineId,
    reconciliationAuthorityVersionId: target.reconciliationAuthorityVersionId,
    reconciliationReference: target.reconciliationReference,
    schemaVersion: target.schemaVersion,
    canonicalPayload: jsonInput(target.canonicalPayload),
    sourceVersionFingerprint: target.sourceVersionFingerprint,
    reconciliationFingerprint: target.reconciliationFingerprint,
    asOfDate: new Date(`${target.asOfDate}T00:00:00.000Z`),
    employmentCompanyId: target.employmentCompanyId,
    employmentCompanyNameSnapshot: target.employmentCompanyNameSnapshot,
    employmentCompanyCreditCodeSnapshot: target.employmentCompanyCreditCodeSnapshot,
    projectId: target.projectId,
    projectCodeSnapshot: target.projectCodeSnapshot,
    projectNameSnapshot: target.projectNameSnapshot,
    wageMonth: target.wageMonth,
    catalogVersion: target.catalogVersion,
    positionCategoryCode: target.positionCategoryCode,
    positionCategoryLabelSnapshot: target.positionCategoryLabelSnapshot,
    wageCreditorCategoryCode: target.wageCreditorCategoryCode,
    wageCreditorCategoryLabelSnapshot: target.wageCreditorCategoryLabelSnapshot,
    creditorIdentityKind: line.creditorIdentityKind,
    creditorPartyVersionId: line.creditorPartyVersionId,
    controlledScopeCode: line.controlledScopeCode,
    controlledScopeDescription: line.controlledScopeDescription,
    targetBusinessKey: line.targetBusinessKey,
    currencyCode: "CNY",
    debtStatus: target.debtStatus,
    grossDebtCents: target.grossDebtCents,
    historicallySettledCents: target.historicallySettledCents,
    outstandingBalanceCents: target.outstandingBalanceCents,
    evidenceSnapshot: jsonInput({
      reconciliationReference: target.reconciliationReference,
      evidence: target.evidence,
      controlledScopeEvidenceCoordinate: line.controlledScopeEvidenceCoordinate,
      creditorCategoryCode: line.creditorCategoryCode
    })
  };
}

function finalizePersistedSummaryTarget(
  line: HistoricalSummaryPlannedLine,
  persistedPayload: Prisma.JsonValue,
  persistedFingerprint: string
) {
  if (line.target.kind === "historical_wage_balance_reconciliation_version") {
    const payload = jsonRecord(persistedPayload, "B级历史工资余额 target payload 无效");
    const reservedTargetId = stringOrEmpty(payload.reservedTargetId);
    if (!uuid(reservedTargetId)) return null;
    const target = finalizeHistoricalWageBalanceTarget(line, reservedTargetId);
    if (
      !target ||
      target.reconciliationFingerprint !== persistedFingerprint ||
      strictJcs(target.canonicalPayload) !== strictJcs(persistedPayload)
    ) return null;
    return {
      payload: target.canonicalPayload,
      fingerprint: target.reconciliationFingerprint,
      balanceTarget: target
    };
  }
  const target = computePol219VerifiedPaymentExecutionSet(line.target.paymentExecutions);
  if (
    target.fingerprint !== persistedFingerprint ||
    strictJcs(target.payload) !== strictJcs(persistedPayload)
  ) return null;
  return { payload: target.payload, fingerprint: target.fingerprint, balanceTarget: null };
}

function historicalPaymentRequestFingerprint(request: {
  id: string;
  sourceType: string;
  projectId: string;
  paymentSubjectType: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  paymentTermsStageId: string | null;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  code: string;
}) {
  return fingerprint({
    id: request.id,
    sourceType: request.sourceType,
    projectId: request.projectId,
    paymentSubjectType: request.paymentSubjectType,
    contractId: request.contractId,
    contractVersionId: request.contractVersionId,
    paymentTermsVersionId: request.paymentTermsVersionId,
    paymentTermsStageId: request.paymentTermsStageId,
    status: request.status,
    requestedAmountCents: request.requestedAmountCents,
    approvedAmountCents: request.approvedAmountCents,
    code: request.code
  });
}

function historicalPaymentExecutionFingerprint(execution: {
  id: string;
  paymentRequestId: string;
  paymentSubjectType: string;
  companyEntityIdSnapshot: string;
  companyEntityNameSnapshot: string;
  companyEntityCreditCodeSnapshot: string;
  amountCents: bigint;
  paidAt: Date;
  voucherFileId: string;
  payerAttestationFingerprint: string | null;
}) {
  return fingerprint({
    id: execution.id,
    paymentRequestId: execution.paymentRequestId,
    paymentSubjectType: execution.paymentSubjectType,
    companyEntityIdSnapshot: execution.companyEntityIdSnapshot,
    companyEntityNameSnapshot: execution.companyEntityNameSnapshot,
    companyEntityCreditCodeSnapshot: execution.companyEntityCreditCodeSnapshot,
    amountCents: execution.amountCents,
    paidAt: execution.paidAt.toISOString(),
    voucherFileId: execution.voucherFileId,
    payerAttestationFingerprint: execution.payerAttestationFingerprint
  });
}

type HistoricalCanonicalCostProjection = {
  id: string;
  amountCents: bigint;
  direction: "increase" | "decrease";
};

type HistoricalCanonicalPayableProjection = HistoricalCanonicalCostProjection & {
  payableCellId: string;
};

function historicalWageProjectProjection(
  snapshot: unknown,
  wageStatementVersionId: string,
  projectId: string,
  allocations: Array<{
    id: string;
    componentAllocations: Array<{ id: string; amountCents: bigint }>;
    creditorAllocations: Array<{
      id: string;
      projectAllocationId: string;
      creditorBreakdownId: string;
      amountCents: bigint;
    }>;
  }>,
  payableRefs: Array<{
    id: string;
    amountCents: bigint;
    projectAllocationId: string;
    creditorBreakdownId: string;
    direction: string;
  }>
): { costs: HistoricalCanonicalCostProjection[]; payables: HistoricalCanonicalPayableProjection[] } {
  const root = jsonRecord(snapshot, "A级工资 canonical projection snapshot 缺失或格式无效");
  if (
    stringOrEmpty(root.projectionOrigin) !== "historical_takeover_legacy_link" ||
    stringOrEmpty(root.wageStatementVersionId) !== wageStatementVersionId
  ) {
    throw new ConflictException("A级工资 canonical projection snapshot 与确认版本不一致");
  }
  const projects = jsonRecord(root.projects, "A级工资 canonical projection 缺少项目闭合");
  const project = jsonRecord(projects[projectId], "A级工资 canonical projection 缺少目标项目差额");
  const costCells = new Map(
    allocations.flatMap((allocation) => allocation.componentAllocations).map((cell) => [cell.id, cell])
  );
  const payableCells = new Map(
    allocations.flatMap((allocation) => allocation.creditorAllocations).map((cell) => [cell.id, cell])
  );
  const refs = new Map(payableRefs.map((ref) => [ref.id, ref]));
  if (refs.size !== payableRefs.length) {
    throw new ConflictException("A级工资 canonical payable ref 存在重复身份");
  }

  const costDeltaRows = Array.isArray(project.canonicalCostDeltas)
    ? project.canonicalCostDeltas
    : null;
  const payableDeltaRows = Array.isArray(project.canonicalPayableDeltas)
    ? project.canonicalPayableDeltas
    : null;
  if ((costDeltaRows === null) !== (payableDeltaRows === null)) {
    throw new ConflictException("A级工资 canonical 成本与应付差额形态不一致");
  }
  if (costDeltaRows && payableDeltaRows) {
    if (stringOrEmpty(root.wageVersionKind) === "base") {
      throw new ConflictException("A级工资基础版本不能使用后续版本差额投影");
    }
    const costs = costDeltaRows.map((value) => {
      const item = jsonRecord(value, "A级工资 canonical cost delta 格式无效");
      const id = stringOrEmpty(item.costCellId);
      const amountCents = positiveBigInt(item.amountCents);
      const direction = historicalProjectionDirection(item.direction);
      if (!text(id) || amountCents < 0n || !costCells.has(id)) {
        throw new ConflictException("A级工资 canonical cost delta 与正式矩阵不一致");
      }
      return { id, amountCents, direction };
    });
    const payables = payableDeltaRows.map((value) => {
      const item = jsonRecord(value, "A级工资 canonical payable delta 格式无效");
      const payableCellId = stringOrEmpty(item.payableCellId);
      const id = stringOrEmpty(item.payableRefId);
      const amountCents = positiveBigInt(item.amountCents);
      const direction = historicalProjectionDirection(item.direction);
      const cell = payableCells.get(payableCellId);
      const ref = refs.get(id);
      if (
        !text(payableCellId) ||
        !text(id) ||
        amountCents < 0n ||
        !cell ||
        !ref ||
        ref.projectAllocationId !== cell.projectAllocationId ||
        ref.creditorBreakdownId !== cell.creditorBreakdownId ||
        ref.amountCents !== amountCents ||
        ref.direction !== direction
      ) {
        throw new ConflictException("A级工资 canonical payable delta 与正式应付引用不一致");
      }
      return { id, payableCellId, amountCents, direction };
    });
    assertUniqueProjectionIds(costs.map((item) => item.id), "成本差额");
    assertUniqueProjectionIds(payables.map((item) => item.id), "应付引用");
    assertUniqueProjectionIds(payables.map((item) => item.payableCellId), "应付矩阵差额");
    if (!sameStrings(sortedUnique([...refs.keys()]), sortedUnique(payables.map((item) => item.id)))) {
      throw new ConflictException("A级工资 canonical payable delta 未完整覆盖该版本正式应付引用");
    }
    return {
      costs: costs.sort((left, right) => left.id.localeCompare(right.id)),
      payables: payables.sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  if (stringOrEmpty(root.wageVersionKind) !== "base") {
    throw new ConflictException("A级工资后续版本缺少 signed canonical delta projection");
  }
  const costIds = stringArray(project.canonicalCostCellIds, "A级工资基础版本成本矩阵闭合无效");
  const payableCellIds = stringArray(project.canonicalPayableCellIds, "A级工资基础版本应付矩阵闭合无效");
  const payableRefIds = stringArray(project.payableRefIds, "A级工资基础版本应付引用闭合无效");
  assertUniqueProjectionIds(costIds, "成本矩阵");
  assertUniqueProjectionIds(payableCellIds, "应付矩阵");
  assertUniqueProjectionIds(payableRefIds, "应付引用");
  const positiveCostIds = sortedUnique([...costCells.values()]
    .filter((cell) => cell.amountCents > 0n)
    .map((cell) => cell.id));
  if (!sameStrings(positiveCostIds, sortedUnique(costIds))) {
    throw new ConflictException("A级工资基础版本成本矩阵闭合不完整");
  }
  if (!sameStrings(sortedUnique([...refs.keys()]), sortedUnique(payableRefIds))) {
    throw new ConflictException("A级工资基础版本应付引用闭合不完整");
  }
  const allowedPayableCells = new Set(payableCellIds);
  const payables = payableRefIds.map((id) => {
    const ref = refs.get(id)!;
    const matches = [...payableCells.values()].filter((cell) =>
      allowedPayableCells.has(cell.id) &&
      cell.projectAllocationId === ref.projectAllocationId &&
      cell.creditorBreakdownId === ref.creditorBreakdownId
    );
    if (matches.length !== 1 || ref.amountCents <= 0n || ref.direction !== "increase") {
      throw new ConflictException("A级工资基础版本应付引用未唯一对应正式矩阵单元");
    }
    return {
      id,
      payableCellId: matches[0]!.id,
      amountCents: ref.amountCents,
      direction: "increase" as const
    };
  });
  if (!sameStrings(sortedUnique(payables.map((item) => item.payableCellId)), sortedUnique(payableCellIds))) {
    throw new ConflictException("A级工资基础版本应付矩阵闭合不完整");
  }
  return {
    costs: costIds.map((id) => {
      const cell = costCells.get(id);
      if (!cell || cell.amountCents <= 0n) {
        throw new ConflictException("A级工资基础版本成本矩阵单元不存在或金额无效");
      }
      return { id, amountCents: cell.amountCents, direction: "increase" as const };
    }).sort((left, right) => left.id.localeCompare(right.id)),
    payables: payables.sort((left, right) => left.id.localeCompare(right.id))
  };
}

function jsonRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException(message);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, message: string) {
  if (!Array.isArray(value) || value.some((item) => !text(item))) {
    throw new ConflictException(message);
  }
  return value.map((item) => item.trim());
}

function frozenScopeCreatorIdentity(value: unknown): Identity {
  const item = jsonRecord(value, "B级历史工资 scope creator identity 快照无效");
  const allowedKeys = ["actualRoles", "actualUserId", "actorIds", "delegatorRoles", "delegatorUserId"];
  if (!sameStrings(Object.keys(item).sort(), [...allowedKeys].sort())) {
    throw new ConflictException("B级历史工资 scope creator identity 字段集合已漂移");
  }
  const actualUserId = requiredText(
    typeof item.actualUserId === "string" ? item.actualUserId : undefined,
    "B级历史工资实际声明人缺失"
  );
  const actualRoles = sortedUnique(stringArray(item.actualRoles, "B级历史工资实际声明人权限快照无效")) as RoleKey[];
  const delegatorUserId = item.delegatorUserId === null
    ? undefined
    : requiredText(
        typeof item.delegatorUserId === "string" ? item.delegatorUserId : undefined,
        "B级历史工资委托人身份快照无效"
      );
  const delegatorRoles = item.delegatorRoles === null
    ? undefined
    : sortedUnique(stringArray(item.delegatorRoles, "B级历史工资委托人权限快照无效")) as RoleKey[];
  const actorIds = sortedUnique(stringArray(item.actorIds, "B级历史工资有效身份集合无效"));
  const expectedActorIds = sortedUnique([actualUserId, ...(delegatorUserId ? [delegatorUserId] : [])]);
  if (
    !actualRoles.length ||
    (Boolean(delegatorUserId) !== Boolean(delegatorRoles)) ||
    (delegatorRoles !== undefined && !delegatorRoles.length) ||
    !sameStrings(actorIds, expectedActorIds)
  ) {
    throw new ConflictException("B级历史工资 scope creator、委托权限或有效身份集合不闭合");
  }
  const actorSetSnapshot = jsonInput({
    actualUserId,
    actualRoles,
    delegatorUserId: delegatorUserId ?? null,
    delegatorRoles: delegatorRoles ?? null,
    actorIds
  });
  if (strictJcs(value) !== strictJcs(actorSetSnapshot)) {
    throw new ConflictException("B级历史工资 scope creator identity 不是 canonical 快照");
  }
  return {
    actualUserId,
    ...(delegatorUserId ? { delegatorUserId } : {}),
    actualRoles,
    ...(delegatorRoles ? { delegatorRoles } : {}),
    actorIds,
    actorSetSnapshot
  };
}

function historicalProjectionDirection(value: unknown): "increase" | "decrease" {
  if (value !== "increase" && value !== "decrease") {
    throw new ConflictException("A级工资 canonical delta 方向无效");
  }
  return value;
}

function assertUniqueProjectionIds(ids: readonly string[], label: string) {
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new ConflictException(`A级工资 canonical ${label}闭合为空或存在重复身份`);
  }
}

function signedProjectionTotal(
  values: ReadonlyArray<{ amountCents: bigint; direction: "increase" | "decrease" }>
) {
  return values.reduce(
    (total, value) => total + (value.direction === "increase" ? value.amountCents : -value.amountCents),
    0n
  );
}

/* The pre-R2 permissive parsers below are intentionally unreachable while the
 * R2 integration is landed. They are removed once all call sites use the exact
 * parser above. */
/*
function summarySnapshot(snapshot: Prisma.InputJsonValue): HistoricalSummarySnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const parent = snapshot as Record<string, unknown>;
  return summaryAuthorityValue(parent.historicalWageSummaryAuthority);
}

function summaryAuthorityValue(candidate: unknown): HistoricalSummarySnapshot | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  const lines = Array.isArray(value.lines) ? value.lines.map(parseSummaryLine) : [];
  if (!lines.length || lines.some((line) => !line)) return null;
  const exclusions = Array.isArray(value.assignedWageExclusions)
    ? value.assignedWageExclusions.map(parseAssignedWageExclusion)
    : [];
  if (exclusions.some((proof) => !proof)) return null;
  const authorityVersionId = stringOrEmpty(value.authorityVersionId);
  const authorityFingerprint = stringOrEmpty(value.authorityFingerprint);
  const sourceVersionFingerprint = stringOrEmpty(value.sourceVersionFingerprint);
  const employmentCompanyId = stringOrEmpty(value.employmentCompanyId);
  const projectId = stringOrEmpty(value.projectId);
  const wageMonth = stringOrEmpty(value.wageMonth);
  const catalogVersion = stringOrEmpty(value.catalogVersion);
  const positionCategoryCode = stringOrEmpty(value.positionCategoryCode);
  const positionCategoryLabel = stringOrEmpty(value.positionCategoryLabel);
  const evidenceCoordinate = stringOrEmpty(value.evidenceCoordinate);
  if (
    !text(authorityVersionId) || !SHA256.test(authorityFingerprint) || !SHA256.test(sourceVersionFingerprint) || !text(employmentCompanyId) || !text(projectId) ||
    !validWageMonth(wageMonth) || !text(catalogVersion) || !text(positionCategoryCode) || !text(positionCategoryLabel) || !text(evidenceCoordinate)
  ) return null;
  return {
    authorityVersionId,
    authorityFingerprint,
    sourceVersionFingerprint,
    employmentCompanyId,
    projectId,
    wageMonth,
    catalogVersion,
    positionCategoryCode,
    positionCategoryLabel,
    evidenceCoordinate,
    lines: lines as HistoricalSummaryLine[],
    assignedWageExclusions: exclusions as AssignedWageExclusion[],
    ...(SHA256.test(stringOrEmpty(value.assignedWageExclusionSetFingerprint)) ? { assignedWageExclusionSetFingerprint: stringOrEmpty(value.assignedWageExclusionSetFingerprint) } : {}),
    raw: value
  };
}

function parseSummaryLine(value: unknown): HistoricalSummaryLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const creditorCategoryCode = stringOrEmpty(item.creditorCategoryCode) as keyof typeof HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS;
  const creditorCategoryLabel = stringOrEmpty(item.creditorCategoryLabel);
  const grossDebtCents = nonNegativeBigInt(item.grossDebtCents);
  const historicallySettledCents = nonNegativeBigInt(item.historicallySettledCents);
  const outstandingBalanceCents = nonNegativeBigInt(item.outstandingBalanceCents);
  const debtStatus = stringOrEmpty(item.debtStatus) as HistoricalSummaryLine["debtStatus"];
  const target = parseSummaryTarget(item.target);
  if (
    !(creditorCategoryCode in HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS) ||
    HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS[creditorCategoryCode] !== creditorCategoryLabel ||
    !target || grossDebtCents < 0n || grossDebtCents !== historicallySettledCents + outstandingBalanceCents ||
    !validDebtStatus(debtStatus, historicallySettledCents, outstandingBalanceCents)
  ) return null;
  return { creditorCategoryCode, creditorCategoryLabel, grossDebtCents, historicallySettledCents, outstandingBalanceCents, debtStatus, target };
}

function parseSummaryTarget(value: unknown): HistoricalSummaryTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const kind = stringOrEmpty(item.kind);
  if (kind === "existing_verified_payment_execution_set") {
    const paymentExecutionIds = Array.isArray(item.paymentExecutionIds) ? item.paymentExecutionIds.map(stringOrEmpty) : [];
    const paymentExecutions = Array.isArray(item.paymentExecutions) ? item.paymentExecutions.map(parseHistoricalPaymentExecutionEvidence) : [];
    const paymentExecutionSetFingerprint = stringOrEmpty(item.paymentExecutionSetFingerprint);
    if (
      !paymentExecutionIds.length || paymentExecutionIds.some((id) => !text(id)) || !SHA256.test(paymentExecutionSetFingerprint) ||
      paymentExecutions.length !== paymentExecutionIds.length || paymentExecutions.some((evidence) => !evidence)
    ) return null;
    return {
      kind,
      paymentExecutionIds,
      paymentExecutionSetFingerprint,
      paymentExecutions: paymentExecutions as HistoricalPaymentExecutionEvidence[]
    };
  }
  if (kind !== "historical_wage_balance_reconciliation_version") return null;
  const evidence = Array.isArray(item.evidence) ? item.evidence.map(parseHistoricalEvidenceCoordinate) : [];
  const creditorCategoryCode = stringOrEmpty(item.wageCreditorCategoryCode) as keyof typeof HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS;
  const debtStatus = stringOrEmpty(item.debtStatus) as BalanceReconciliationTarget["debtStatus"];
  const target: BalanceReconciliationTarget = {
    kind,
    reconciliationAuthorityVersionId: stringOrEmpty(item.reconciliationAuthorityVersionId),
    reconciliationReference: stringOrEmpty(item.reconciliationReference),
    schemaVersion: stringOrEmpty(item.schemaVersion),
    sourceVersionFingerprint: stringOrEmpty(item.sourceVersionFingerprint),
    reconciliationFingerprint: stringOrEmpty(item.reconciliationFingerprint),
    asOfDate: stringOrEmpty(item.asOfDate),
    employmentCompanyId: stringOrEmpty(item.employmentCompanyId),
    employmentCompanyNameSnapshot: stringOrEmpty(item.employmentCompanyNameSnapshot),
    employmentCompanyCreditCodeSnapshot: stringOrEmpty(item.employmentCompanyCreditCodeSnapshot),
    projectId: stringOrEmpty(item.projectId),
    projectCodeSnapshot: stringOrEmpty(item.projectCodeSnapshot),
    projectNameSnapshot: stringOrEmpty(item.projectNameSnapshot),
    wageMonth: stringOrEmpty(item.wageMonth),
    catalogVersion: stringOrEmpty(item.catalogVersion),
    positionCategoryCode: stringOrEmpty(item.positionCategoryCode),
    positionCategoryLabelSnapshot: stringOrEmpty(item.positionCategoryLabelSnapshot),
    wageCreditorCategoryCode: creditorCategoryCode,
    wageCreditorCategoryLabelSnapshot: stringOrEmpty(item.wageCreditorCategoryLabelSnapshot),
    currencyCode: stringOrEmpty(item.currencyCode) as "CNY",
    debtStatus,
    grossDebtCents: nonNegativeBigInt(item.grossDebtCents),
    historicallySettledCents: nonNegativeBigInt(item.historicallySettledCents),
    outstandingBalanceCents: nonNegativeBigInt(item.outstandingBalanceCents),
    evidence: evidence as HistoricalEvidenceCoordinate[],
    ...(text(item.controlledScopeEvidenceCoordinate) ? { controlledScopeEvidenceCoordinate: item.controlledScopeEvidenceCoordinate.trim() } : {})
  };
  if (
    !text(target.reconciliationAuthorityVersionId) || !text(target.reconciliationReference) || !text(target.schemaVersion) ||
    !SHA256.test(target.sourceVersionFingerprint) || !SHA256.test(target.reconciliationFingerprint) || !validDateOnly(target.asOfDate) ||
    !text(target.employmentCompanyId) || !text(target.employmentCompanyNameSnapshot) || !text(target.employmentCompanyCreditCodeSnapshot) ||
    !text(target.projectId) || !text(target.projectCodeSnapshot) || !text(target.projectNameSnapshot) || !validWageMonth(target.wageMonth) ||
    !text(target.catalogVersion) || !text(target.positionCategoryCode) || !text(target.positionCategoryLabelSnapshot) ||
    !(target.wageCreditorCategoryCode in HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS) ||
    HISTORICAL_WAGE_CREDITOR_CATEGORY_LABELS[target.wageCreditorCategoryCode] !== target.wageCreditorCategoryLabelSnapshot ||
    target.currencyCode !== "CNY" || target.grossDebtCents < 0n ||
    target.grossDebtCents !== target.historicallySettledCents + target.outstandingBalanceCents ||
    !validDebtStatus(target.debtStatus, target.historicallySettledCents, target.outstandingBalanceCents) ||
    !target.evidence.length || target.evidence.some((item) => !item)
  ) return null;
  return target;
}

function parseHistoricalPaymentExecutionEvidence(value: unknown): HistoricalPaymentExecutionEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const evidence: HistoricalPaymentExecutionEvidence = {
    paymentExecutionId: stringOrEmpty(item.paymentExecutionId),
    paymentExecutionFingerprint: stringOrEmpty(item.paymentExecutionFingerprint),
    paymentRequestId: stringOrEmpty(item.paymentRequestId),
    paymentRequestSourceType: stringOrEmpty(item.paymentRequestSourceType),
    paymentRequestProjectId: stringOrEmpty(item.paymentRequestProjectId),
    paymentRequestFingerprint: stringOrEmpty(item.paymentRequestFingerprint),
    paymentSubjectType: stringOrEmpty(item.paymentSubjectType),
    payerCompanyId: stringOrEmpty(item.payerCompanyId),
    payerCompanyNameSnapshot: stringOrEmpty(item.payerCompanyNameSnapshot),
    payerCompanyCreditCodeSnapshot: stringOrEmpty(item.payerCompanyCreditCodeSnapshot),
    amountCents: positiveBigInt(item.amountCents),
    paidAt: stringOrEmpty(item.paidAt),
    voucherFileId: stringOrEmpty(item.voucherFileId),
    voucherContentSha256: stringOrEmpty(item.voucherContentSha256),
    payerAttestationId: stringOrEmpty(item.payerAttestationId),
    payerVerificationId: stringOrEmpty(item.payerVerificationId),
    bankAccountReference: stringOrEmpty(item.bankAccountReference),
    legalAccountHolderCompanyId: stringOrEmpty(item.legalAccountHolderCompanyId),
    legalAccountHolderNameSnapshot: stringOrEmpty(item.legalAccountHolderNameSnapshot),
    legalAccountHolderCreditCodeSnapshot: stringOrEmpty(item.legalAccountHolderCreditCodeSnapshot),
    verificationEvidenceFileId: stringOrEmpty(item.verificationEvidenceFileId),
    verificationEvidenceContentSha256: stringOrEmpty(item.verificationEvidenceContentSha256),
    bankTransactionClaimId: stringOrEmpty(item.bankTransactionClaimId),
    bankObservationId: stringOrEmpty(item.bankObservationId),
    transactionSourceType: stringOrEmpty(item.transactionSourceType),
    transactionSourceId: stringOrEmpty(item.transactionSourceId),
    transactionSourceIdentity: stringOrEmpty(item.transactionSourceIdentity),
    transactionAmountCents: positiveBigInt(item.transactionAmountCents),
    currencyCode: stringOrEmpty(item.currencyCode) as "CNY",
    direction: stringOrEmpty(item.direction),
    occurredAt: stringOrEmpty(item.occurredAt),
    transactionEvidenceFileId: stringOrEmpty(item.transactionEvidenceFileId),
    transactionEvidenceContentSha256: stringOrEmpty(item.transactionEvidenceContentSha256),
    observationPayloadFingerprint: stringOrEmpty(item.observationPayloadFingerprint),
    creditorScopeEvidenceCoordinate: stringOrEmpty(item.creditorScopeEvidenceCoordinate)
  };
  if (
    Object.values(evidence).some((value) => typeof value === "string" && !text(value)) || evidence.amountCents <= 0n || evidence.transactionAmountCents <= 0n ||
    !SHA256.test(evidence.paymentExecutionFingerprint) || !SHA256.test(evidence.paymentRequestFingerprint) || !SHA256.test(evidence.voucherContentSha256) ||
    !SHA256.test(evidence.verificationEvidenceContentSha256) || !SHA256.test(evidence.transactionEvidenceContentSha256) || !SHA256.test(evidence.observationPayloadFingerprint) ||
    evidence.currencyCode !== "CNY" || !validInstant(evidence.paidAt) || !validInstant(evidence.occurredAt)
  ) return null;
  return evidence;
}

function parseHistoricalEvidenceCoordinate(value: unknown): HistoricalEvidenceCoordinate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const evidence = {
    fileObjectId: stringOrEmpty(item.fileObjectId),
    contentSha256: stringOrEmpty(item.contentSha256),
    evidenceCoordinate: stringOrEmpty(item.evidenceCoordinate)
  };
  return text(evidence.fileObjectId) && SHA256.test(evidence.contentSha256) && text(evidence.evidenceCoordinate) ? evidence : null;
}

function parseAssignedWageExclusion(value: unknown): AssignedWageExclusion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const evidence = parseHistoricalEvidenceCoordinate(item);
  if (!evidence) return null;
  const proof = {
    lineId: stringOrEmpty(item.lineId),
    authorityVersionId: stringOrEmpty(item.authorityVersionId),
    lineFingerprint: stringOrEmpty(item.lineFingerprint),
    ...evidence
  };
  return text(proof.lineId) && text(proof.authorityVersionId) && SHA256.test(proof.lineFingerprint) ? proof : null;
}

function summaryExclusionProofs(snapshot: Prisma.InputJsonValue | undefined) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return new Map<string, AssignedWageExclusion>();
  const values = (snapshot as Record<string, unknown>).assignedWageExclusions;
  const proofs = Array.isArray(values) ? values.map(parseAssignedWageExclusion).filter((proof): proof is AssignedWageExclusion => Boolean(proof)) : [];
  return new Map(proofs.map((proof) => [proof.lineId, proof]));
}

*/
function legacyReadSet(legacy: ResolvedLegacy) {
  return {
    factId: legacy.factId,
    projectId: legacy.projectId,
    sourceType: legacy.sourceType,
    sourceBusinessId: legacy.sourceBusinessId,
    sourceVersion: legacy.sourceVersion,
    sourceFingerprint: legacy.sourceFingerprint,
    legacyWageMonth: legacy.legacyWageMonth,
    employmentCompanyId: legacy.employmentCompanyId,
    amountCents: legacy.amountCents,
    entryKind: legacy.entryKind,
    direction: legacy.direction,
    adjustsFactId: legacy.adjustsFactId,
    adjustmentRoot: legacy.adjustmentRoot,
    costImpactId: legacy.costImpactId,
    payableImpactId: legacy.payableImpactId
  };
}

function historicalWageLegacyImpactFingerprint(
  legacy: Pick<ResolvedLegacy, "sourceFingerprint" | "costImpactId" | "payableImpactId" | "direction" | "amountCents">,
  impactKind: string,
  impactSnapshot: Prisma.InputJsonValue
) {
  const legacyImpactEntryId = impactKind === "confirmed_cost" ? legacy.costImpactId : legacy.payableImpactId;
  return fingerprint({
    legacySourceFingerprint: legacy.sourceFingerprint,
    legacyImpactEntryId,
    impactKind,
    direction: legacy.direction,
    amountCents: legacy.amountCents,
    impactSnapshot
  });
}

function stableBucketKeyFingerprint(stableBucketKey: string) {
  return createHash("sha256").update(stableBucketKey, "utf8").digest("hex");
}

function finalizeHistoricalSummaryAuthority(
  atomicScopeVersionId: string,
  plan: ScopePlan,
  legacy: ResolvedLegacy[],
  identity: Identity,
  permissionScopeFingerprintValue: string,
  reservations?: {
    authorityVersionId: string;
    creditorLineIds: Map<string, string>;
    balanceTargetIds: Map<string, string>;
  }
): FinalizedHistoricalSummaryAuthority {
  if (
    plan.grade !== "B" ||
    !plan.summaryAuthority ||
    !plan.summary?.length ||
    !plan.conflictReadSet
  ) {
    throw new ConflictException("B级历史工资汇总缺少完整 authority closure，不能预留正式目标");
  }
  const expectedStableKeys = plan.summary.map((line) => line.stableBucketKey);
  const expectedBalanceStableKeys = plan.summary
    .filter((line) => line.target.kind === "historical_wage_balance_reconciliation_version")
    .map((line) => line.stableBucketKey);
  if (reservations && (
    !uuid(reservations.authorityVersionId) ||
    reservations.creditorLineIds.size !== expectedStableKeys.length ||
    reservations.balanceTargetIds.size !== expectedBalanceStableKeys.length ||
    !sameStrings([...reservations.creditorLineIds.keys()].sort(), [...expectedStableKeys].sort()) ||
    !sameStrings([...reservations.balanceTargetIds.keys()].sort(), [...expectedBalanceStableKeys].sort()) ||
    new Set(reservations.creditorLineIds.values()).size !== reservations.creditorLineIds.size ||
    new Set(reservations.balanceTargetIds.values()).size !== reservations.balanceTargetIds.size ||
    [...reservations.creditorLineIds.values()].some((id) => !uuid(id)) ||
    [...reservations.balanceTargetIds.values()].some((id) => !uuid(id))
  )) {
    throw new ConflictException("B级历史工资服务端预留 ID 集合不完整、不唯一或已漂移");
  }
  const authorityVersionId = reservations?.authorityVersionId ?? randomUUID();
  const finalizedLines = plan.summary.map((planned): FinalizedHistoricalSummaryLine => {
    const id = reservations
      ? requiredText(reservations.creditorLineIds.get(planned.stableBucketKey), "B级历史工资 creditor line 预留 ID 缺失")
      : randomUUID();
    if (!uuid(id)) throw new ConflictException("B级历史工资 creditor line 预留 ID 无效");
    if (planned.target.kind === "historical_wage_balance_reconciliation_version") {
      const reservedTargetId = reservations
        ? requiredText(reservations.balanceTargetIds.get(planned.stableBucketKey), "B级历史工资余额 target 预留 ID 缺失")
        : randomUUID();
      const balanceTarget = finalizeHistoricalWageBalanceTarget(planned, reservedTargetId);
      if (!balanceTarget) throw new ConflictException("B级历史工资余额 target 预留失败");
      return {
        id,
        planned,
        targetPayload: balanceTarget.canonicalPayload,
        targetFingerprint: balanceTarget.reconciliationFingerprint,
        balanceTarget
      };
    }
    const paymentTarget = computePol219VerifiedPaymentExecutionSet(planned.target.paymentExecutions);
    if (
      paymentTarget.fingerprint !== planned.target.paymentExecutionSetFingerprint ||
      strictJcs(paymentTarget.payload.paymentExecutionIds) !== strictJcs(planned.target.paymentExecutionIds)
    ) {
      throw new ConflictException("B级历史工资付款 target 已漂移，不能预留正式目标");
    }
    return {
      id,
      planned,
      targetPayload: paymentTarget.payload,
      targetFingerprint: paymentTarget.fingerprint,
      balanceTarget: null
    };
  });
  if (new Set(finalizedLines.map((line) => line.id)).size !== finalizedLines.length) {
    throw new ConflictException("B级历史工资 creditor line 预留 ID 不唯一");
  }
  const authority = plan.summaryAuthority;
  const computed = computePol219HistoricalWageAuthorityFingerprint({
    schemaVersion: 1,
    authorityVersionId,
    atomicScopeVersionId,
    sourceVersionFingerprint: authority.sourceVersionFingerprint,
    summaryBucketKey: summaryBucketKey(authority),
    authorityHeader: authority.snapshot.sourceHeader,
    revision: authority.revision,
    supersedesVersionId: authority.supersedesVersionId,
    lineageRootAuthorityVersionId: authority.lineageRootAuthorityVersionId,
    sourceDeltaFingerprint: authority.sourceDeltaFingerprint,
    rootClosureFingerprint: authority.rootClosureFingerprint,
    creditorLines: finalizedLines.map(({ id, planned, targetPayload, targetFingerprint }) => ({
      authorityCreditorLineId: id,
      stableBucketKey: planned.stableBucketKey,
      categoryCode: planned.creditorCategoryCode,
      categoryLabelSnapshot: planned.creditorCategoryLabel,
      creditorIdentityKind: planned.creditorIdentityKind,
      creditorPartyVersionId: planned.creditorPartyVersionId,
      controlledScopeCode: planned.controlledScopeCode,
      controlledScopeDescription: planned.controlledScopeDescription,
      controlledScopeEvidenceCoordinate: planned.controlledScopeEvidenceCoordinate,
      grossDebtCents: planned.grossDebtCents.toString(),
      historicallySettledCents: planned.historicallySettledCents.toString(),
      outstandingBalanceCents: planned.outstandingBalanceCents.toString(),
      debtStatus: planned.debtStatus,
      targetKind: planned.target.kind,
      targetBusinessKey: planned.targetBusinessKey,
      targetPayload,
      targetFingerprint,
      signedGrossDeltaCents: planned.signedGrossDeltaCents.toString(),
      signedHistoricallySettledDeltaCents: planned.signedHistoricallySettledDeltaCents.toString(),
      signedOutstandingBalanceDeltaCents: planned.signedOutstandingBalanceDeltaCents.toString(),
      deltaFingerprint: planned.deltaFingerprint,
      rootCreditorLineId: planned.rootCreditorLineId,
      rootPayableRefId: planned.rootPayableRefId
    })),
    legacySources: legacy.map((item) => ({
      factId: item.factId,
      factFingerprint: item.sourceFingerprint,
      costImpactId: item.costImpactId,
      costImpactFingerprint: historicalWageLegacyImpactFingerprint(item, "confirmed_cost", item.costImpactSnapshot),
      payableImpactId: item.payableImpactId,
      payableImpactFingerprint: historicalWageLegacyImpactFingerprint(
        item,
        item.direction === "increase" ? "payable_increase" : "payable_decrease",
        item.payableImpactSnapshot
      )
    })),
    assignedWageExclusions: authority.snapshot.assignedWageExclusions,
    assignedWageExclusionSetFingerprint: authority.snapshot.assignedWageExclusionSetFingerprint,
    verifiedPaymentExecutionSets: finalizedLines
      .filter((line) => line.planned.target.kind === "existing_verified_payment_execution_set")
      .map((line) => ({ paymentExecutionSetFingerprint: line.targetFingerprint, payload: line.targetPayload })),
    conflictReadSet: plan.conflictReadSet,
    scopeCreatorIdentity: {
      actualUserId: identity.actualUserId,
      actualRoles: identity.actualRoles,
      delegatorUserId: identity.delegatorUserId ?? null,
      delegatorRoles: identity.delegatorRoles ?? null,
      actorIds: identity.actorIds
    },
    permissionScopeFingerprint: permissionScopeFingerprintValue
  });
  return {
    id: authorityVersionId,
    payload: computed.payload,
    fingerprint: computed.fingerprint,
    lines: finalizedLines
  };
}

function resolvedLegacyFromFrozenReadSet(value: Record<string, unknown>): ResolvedLegacy {
  const factId = stringOrEmpty(value.factId);
  const projectId = stringOrEmpty(value.projectId);
  const sourceType = stringOrEmpty(value.sourceType);
  const sourceBusinessId = stringOrEmpty(value.sourceBusinessId);
  const sourceFingerprint = stringOrEmpty(value.sourceFingerprint);
  const legacyWageMonth = value.legacyWageMonth === null ? null : stringOrEmpty(value.legacyWageMonth);
  const employmentCompanyId = value.employmentCompanyId === null ? null : stringOrEmpty(value.employmentCompanyId);
  const costImpactId = stringOrEmpty(value.costImpactId);
  const payableImpactId = stringOrEmpty(value.payableImpactId);
  const sourceVersion = value.sourceVersion;
  const entryKind = value.entryKind;
  const direction = value.direction;
  const amountCents = positiveBigInt(value.amountCents);
  const adjustsFactId = value.adjustsFactId === null ? null : stringOrEmpty(value.adjustsFactId);
  let adjustmentRoot: ResolvedLegacy["adjustmentRoot"] = null;
  if (value.adjustmentRoot !== null) {
    const root = jsonRecord(value.adjustmentRoot, "历史工资接管冻结 adjustment root 无效");
    adjustmentRoot = {
      factId: stringOrEmpty(root.factId),
      sourceBusinessId: stringOrEmpty(root.sourceBusinessId),
      sourceVersion: typeof root.sourceVersion === "number" ? root.sourceVersion : -1,
      sourceFingerprint: stringOrEmpty(root.sourceFingerprint),
      legacyWageMonth: root.legacyWageMonth === null ? null : stringOrEmpty(root.legacyWageMonth),
      employmentCompanyId: root.employmentCompanyId === null ? null : stringOrEmpty(root.employmentCompanyId)
    };
  }
  if (
    !factId || !projectId || sourceType !== "project_wage" || !sourceBusinessId ||
    typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion) || sourceVersion < 1 ||
    !SHA256.test(sourceFingerprint) || amountCents <= 0n || !costImpactId || !payableImpactId ||
    (entryKind !== "original" && entryKind !== "correction" && entryKind !== "reversal") ||
    (direction !== "increase" && direction !== "decrease") ||
    (entryKind === "original" && (adjustsFactId !== null || adjustmentRoot !== null)) ||
    (entryKind !== "original" && (!adjustsFactId || !adjustmentRoot || adjustmentRoot.factId !== adjustsFactId ||
      !adjustmentRoot.sourceBusinessId || adjustmentRoot.sourceVersion < 1 || !SHA256.test(adjustmentRoot.sourceFingerprint)))
  ) {
    throw new ConflictException("历史工资接管冻结 legacy read-set 缺失或不合法");
  }
  return {
    factId,
    projectId,
    sourceType: "project_wage",
    sourceBusinessId,
    sourceVersion,
    sourceFingerprint,
    legacyWageMonth,
    employmentCompanyId,
    amountCents,
    entryKind,
    direction,
    adjustsFactId,
    adjustmentRoot,
    costImpactId,
    payableImpactId,
    legacySnapshot: {},
    costImpactSnapshot: {},
    payableImpactSnapshot: {}
  };
}

function legacyCoordinate(legacy: ResolvedLegacy) {
  return {
    projectId: legacy.projectId,
    sourceType: "project_wage" as const,
    sourceBusinessId: legacy.sourceBusinessId,
    sourceVersion: legacy.sourceVersion,
    sourceFingerprint: legacy.sourceFingerprint
  };
}

function legacyWageAuthorityCoordinates(fact: {
  occurredAt?: unknown;
  costBearingCompanySubjectKind?: string | null;
  costBearingCompanySubjectId?: string | null;
}) {
  const occurredAt = fact.occurredAt instanceof Date
    ? fact.occurredAt
    : typeof fact.occurredAt === "string"
      ? new Date(fact.occurredAt)
      : null;
  const legacyWageMonth = occurredAt && Number.isFinite(occurredAt.getTime())
    ? occurredAt.toISOString().slice(0, 7)
    : null;
  const employmentCompanyId = fact.costBearingCompanySubjectKind === "participating_company" &&
    text(fact.costBearingCompanySubjectId ?? "")
    ? fact.costBearingCompanySubjectId!.trim()
    : null;
  return { legacyWageMonth, employmentCompanyId };
}

function historicalWageOptionLegacy(fact: {
  id: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  factKind: string;
  amountCents: bigint;
  occurredAt?: Date | string | null;
  costBearingCompanySubjectKind?: string | null;
  costBearingCompanySubjectId?: string | null;
  entryKind: string;
  adjustsFactId?: string | null;
  status: string;
  sourceSnapshot: unknown;
  impacts: Array<{
    id: string;
    impactKind: string;
    amountCents: bigint;
    direction: string;
    sourceImpactKey: string;
    impactSnapshot?: unknown;
  }>;
}, root?: {
  id: string;
  projectId: string;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  factKind: string;
  amountCents: bigint;
  occurredAt?: Date | string | null;
  costBearingCompanySubjectKind?: string | null;
  costBearingCompanySubjectId?: string | null;
  entryKind: string;
  adjustsFactId?: string | null;
  status: string;
  sourceSnapshot: unknown;
  impacts: Array<{ id: string; impactKind: string; amountCents: bigint; direction: string; sourceImpactKey: string; impactSnapshot?: unknown }>;
}): ResolvedLegacy | null {
  if (
    fact.sourceType !== "project_wage" ||
    fact.factKind !== "project_wage" ||
    !["original", "correction", "reversal"].includes(fact.entryKind) ||
    fact.status !== "confirmed" ||
    fact.amountCents <= 0n
  ) return null;
  const directions = sortedUnique(fact.impacts
    .filter((impact) => impact.impactKind === "confirmed_cost" || impact.impactKind === "payable_increase" || impact.impactKind === "payable_decrease")
    .map((impact) => impact.direction));
  if (directions.length !== 1 || (directions[0] !== "increase" && directions[0] !== "decrease")) return null;
  const direction = directions[0] as "increase" | "decrease";
  const costImpacts = fact.impacts.filter((impact) => impact.impactKind === "confirmed_cost" && impact.direction === direction && impact.amountCents === fact.amountCents);
  const payableImpacts = fact.impacts.filter((impact) => impact.impactKind === (direction === "increase" ? "payable_increase" : "payable_decrease") && impact.direction === direction && impact.amountCents === fact.amountCents);
  if (costImpacts.length !== 1 || payableImpacts.length !== 1) return null;
  const authorityCoordinates = legacyWageAuthorityCoordinates(fact);
  let adjustmentRoot: ResolvedLegacy["adjustmentRoot"] = null;
  if (fact.entryKind === "original") {
    if (direction !== "increase" || fact.adjustsFactId) return null;
  } else {
    if (!fact.adjustsFactId || !root || root.id !== fact.adjustsFactId || root.projectId !== fact.projectId || root.sourceType !== "project_wage" || root.factKind !== "project_wage" || root.entryKind !== "original" || root.status !== "confirmed" || root.adjustsFactId || (fact.entryKind === "reversal" && direction !== "decrease")) return null;
    adjustmentRoot = {
      factId: root.id,
      sourceBusinessId: root.sourceBusinessId,
      sourceVersion: root.sourceVersion,
      sourceFingerprint: historicalWageLegacyFingerprint(root),
      ...legacyWageAuthorityCoordinates(root)
    };
  }
  return {
    sourceType: "project_wage",
    sourceBusinessId: fact.sourceBusinessId,
    sourceVersion: fact.sourceVersion,
    sourceFingerprint: historicalWageLegacyFingerprint(fact),
    projectId: fact.projectId,
    ...authorityCoordinates,
    costImpactId: costImpacts[0]!.id,
    payableImpactId: payableImpacts[0]!.id,
    amountCents: fact.amountCents,
    factId: fact.id,
    entryKind: fact.entryKind as "original" | "correction" | "reversal",
    direction,
    adjustsFactId: fact.adjustsFactId ?? null,
    adjustmentRoot,
    legacySnapshot: jsonInput(fact.sourceSnapshot),
    costImpactSnapshot: jsonInput(costImpacts[0]!.impactSnapshot ?? {}),
    payableImpactSnapshot: jsonInput(payableImpacts[0]!.impactSnapshot ?? {})
  };
}

function cSelectionFingerprint(
  legacy: ResolvedLegacy,
  negativeAuthorityFrontierFingerprint: string
) {
  return fingerprint({
    policy: "pol219-historical-wage-selection-v1",
    grade: "C",
    negativeAuthorityFrontierFingerprint,
    legacy: [legacyReadSet(legacy)]
  });
}

function bSelectionFingerprint(
  summaryFingerprint: string,
  legacy: ResolvedLegacy[],
  priorLineageProof: HistoricalWageSummaryPriorLineageProof
) {
  return fingerprint({
    policy: "pol219-historical-wage-selection-v1",
    grade: "B",
    summaryFingerprint,
    priorLineageProofFingerprint: fingerprint(priorLineageProof),
    legacy: legacy.map(legacyReadSet)
  });
}

function aSelectionFingerprint(
  sourceVersionId: string,
  sourceFingerprint: string,
  sourceClosureFingerprint: string,
  legacy: ResolvedLegacy[],
  materializationAuthorityReadSet: MaterializationAuthorityReadSet,
  priorCanonicalGraphFingerprint: string | null
) {
  return fingerprint({
    policy: "pol219-historical-wage-selection-v1",
    grade: "A",
    sourceVersionId,
    sourceFingerprint,
    sourceClosureFingerprint,
    materializationAuthorityReadSetFingerprint: fingerprint(materializationAuthorityReadSet),
    priorCanonicalGraphFingerprint,
    legacy: legacy.map(legacyReadSet)
  });
}

function emptyCSummaryProbe(): HistoricalWageCSummaryProbe {
  const readSet = { authorities: [], payableRefs: [] };
  return {
    summaryFingerprint: null,
    summarySourceVersionFingerprint: null,
    evidenceFiles: [],
    stablePlan: null,
    priorLineageProof: {
      schemaVersion: 1,
      summaryBucketKey: null,
      state: "none",
      reasonCode: "NO_SUMMARY_AUTHORITY",
      activePriorAuthorityId: null,
      readSetFingerprint: fingerprint(readSet),
      readSet
    },
    outcome: "absent_or_invalid",
    blockedReason: null
  };
}

function analyzeHistoricalWageSummaryPriorLineage(
  bucketKey: string,
  authorities: HistoricalWagePriorSummaryAuthority[],
  payableRefs: HistoricalWagePriorSummaryPayableRef[]
): { state: HistoricalWageSummaryPriorLineageState; reasonCode: string } {
  const invalid = (reasonCode: string) => ({ state: "invalid" as const, reasonCode });
  if (!authorities.length) {
    return { state: "none", reasonCode: "NO_PRIOR_B_AUTHORITY" };
  }
  if (
    new Set(authorities.map((authority) => authority.id)).size !== authorities.length ||
    new Set(authorities.map((authority) => authority.revision)).size !== authorities.length ||
    new Set(payableRefs.map((ref) => ref.id)).size !== payableRefs.length ||
    new Set(payableRefs.map((ref) => ref.authorityCreditorLineId)).size !== payableRefs.length
  ) return invalid("B_PRIOR_DUPLICATE_ID_OR_REVISION");

  const authorityById = new Map(authorities.map((authority) => [authority.id, authority]));
  const revisionByAuthorityId = new Map(authorities.map((authority) => [authority.id, authority.revision]));
  const allLineIds = new Set(authorities.flatMap((authority) => authority.creditorLines.map((line) => line.id)));
  if (allLineIds.size !== authorities.reduce((sum, authority) => sum + authority.creditorLines.length, 0)) {
    return invalid("B_PRIOR_DUPLICATE_CREDITOR_LINE_ID");
  }
  if (payableRefs.some((ref) => !authorityById.has(ref.authorityVersionId) || !allLineIds.has(ref.authorityCreditorLineId))) {
    return invalid("B_PRIOR_PAYABLE_FOREIGN_KEY_MISMATCH");
  }

  let priorLines = new Map<string, HistoricalWagePriorSummaryAuthority["creditorLines"][number]>();
  let stableKeys: string[] | null = null;
  const rootLineIds = new Map<string, string>();
  const rootPayableIds = new Map<string, string>();
  for (const [index, authority] of authorities.entries()) {
    const expectedRevision = index + 1;
    const priorAuthority = index > 0 ? authorities[index - 1]! : null;
    if (
      !uuid(authority.id) ||
      !uuid(authority.atomicScopeVersionId) ||
      authority.summaryBucketKey !== bucketKey ||
      authority.revision !== expectedRevision ||
      (authority.supersedesVersionId ?? null) !== (priorAuthority?.id ?? null) ||
      (authority.lineageRootAuthorityVersionId ?? null) !== (priorAuthority ? authorities[0]!.id : null) ||
      authority.sourceSchemaVersion !== 1 ||
      authority.authoritySchemaVersion !== 1 ||
      authority.assignedWageExclusionSchemaVersion !== 1 ||
      !SHA256.test(authority.sourceVersionFingerprint) ||
      !SHA256.test(authority.authorityFingerprint) ||
      !SHA256.test(authority.assignedWageExclusionSetFingerprint) ||
      !SHA256.test(authority.sourceDeltaFingerprint) ||
      !SHA256.test(authority.rootClosureFingerprint)
    ) return invalid("B_PRIOR_AUTHORITY_HEADER_OR_DAG_INVALID");

    try {
      const source = computePol219HistoricalWageSourceVersionFingerprint(authority.sourcePayload);
      const computed = computePol219HistoricalWageAuthorityFingerprint(authority.authorityPayload);
      if (
        strictJcs(source.payload) !== strictJcs(authority.sourcePayload) ||
        source.fingerprint !== authority.sourceVersionFingerprint ||
        strictJcs(computed.payload) !== strictJcs(authority.authorityPayload) ||
        computed.fingerprint !== authority.authorityFingerprint ||
        computed.payload.authorityVersionId !== authority.id ||
        computed.payload.atomicScopeVersionId !== authority.atomicScopeVersionId ||
        computed.payload.summaryBucketKey !== authority.summaryBucketKey ||
        computed.payload.sourceVersionFingerprint !== authority.sourceVersionFingerprint ||
        computed.payload.revision !== authority.revision ||
        computed.payload.supersedesVersionId !== (authority.supersedesVersionId ?? null) ||
        computed.payload.lineageRootAuthorityVersionId !== (authority.lineageRootAuthorityVersionId ?? null) ||
        computed.payload.sourceDeltaFingerprint !== authority.sourceDeltaFingerprint ||
        computed.payload.rootClosureFingerprint !== authority.rootClosureFingerprint ||
        computed.payload.authorityHeader.employmentCompanyId !== authority.employmentCompanyId ||
        computed.payload.authorityHeader.projectId !== authority.projectId ||
        computed.payload.authorityHeader.wageMonth !== authority.wageMonth ||
        computed.payload.authorityHeader.catalogVersion !== authority.catalogVersion ||
        computed.payload.authorityHeader.positionCategoryCode !== authority.positionCategoryCode ||
        computed.payload.authorityHeader.positionCategoryLabelSnapshot !== authority.positionCategoryLabelSnapshot ||
        strictJcs(source.payload.sourceObjectCoordinate) !== strictJcs(authority.evidenceCoordinate) ||
        strictJcs(authority.assignedWageExclusionPayload) !== strictJcs({
          schemaVersion: 1,
          assignedWageExclusions: computed.payload.assignedWageExclusions
        }) ||
        computed.payload.assignedWageExclusionSetFingerprint !== authority.assignedWageExclusionSetFingerprint ||
        strictJcs(computed.payload.scopeCreatorIdentity) !== strictJcs(authority.scopeCreatorIdentitySnapshot) ||
        computed.payload.permissionScopeFingerprint !== authority.permissionScopeFingerprint
      ) return invalid("B_PRIOR_AUTHORITY_PAYLOAD_OR_FINGERPRINT_INVALID");

      const payloadLines = new Map(
        computed.payload.creditorLines.map((line) => [line.authorityCreditorLineId, line])
      );
      if (
        payloadLines.size !== authority.creditorLines.length ||
        new Set(authority.creditorLines.map((line) => line.stableBucketKey)).size !== authority.creditorLines.length
      ) return invalid("B_PRIOR_CREDITOR_LINE_SET_INVALID");
      for (const line of authority.creditorLines) {
        const payloadLine = payloadLines.get(line.id);
        if (
          !uuid(line.id) ||
          !payloadLine ||
          line.atomicScopeVersionId !== authority.atomicScopeVersionId ||
          line.authorityVersionId !== authority.id ||
          line.revision !== authority.revision ||
          line.stableBucketKeyFingerprint !== stableBucketKeyFingerprint(line.stableBucketKey) ||
          line.employmentCompanyId !== authority.employmentCompanyId ||
          line.projectId !== authority.projectId ||
          line.wageMonth !== authority.wageMonth ||
          line.positionCategoryCode !== authority.positionCategoryCode ||
          line.wageCreditorCategoryCode !== payloadLine.categoryCode ||
          line.wageCreditorCategoryLabelSnapshot !== payloadLine.categoryLabelSnapshot ||
          line.creditorIdentityKind !== payloadLine.creditorIdentityKind ||
          (line.creditorPartyVersionId ?? null) !== payloadLine.creditorPartyVersionId ||
          (line.controlledScopeCode ?? null) !== payloadLine.controlledScopeCode ||
          (line.controlledScopeDescription ?? null) !== payloadLine.controlledScopeDescription ||
          strictJcs(line.controlledScopeEvidenceCoordinate ?? null) !== strictJcs(payloadLine.controlledScopeEvidenceCoordinate) ||
          line.currencyCode !== "CNY" ||
          line.debtStatus !== payloadLine.debtStatus ||
          line.grossDebtCents !== BigInt(payloadLine.grossDebtCents) ||
          line.historicallySettledCents !== BigInt(payloadLine.historicallySettledCents) ||
          line.outstandingBalanceCents !== BigInt(payloadLine.outstandingBalanceCents) ||
          line.isTombstone !== (line.grossDebtCents === 0n) ||
          line.targetKind !== payloadLine.targetKind ||
          line.targetSchemaVersion !== 1 ||
          line.targetBusinessKey !== payloadLine.targetBusinessKey ||
          strictJcs(line.targetPayload) !== strictJcs(payloadLine.targetPayload) ||
          line.targetFingerprint !== payloadLine.targetFingerprint ||
          line.signedGrossDeltaCents !== BigInt(payloadLine.signedGrossDeltaCents) ||
          line.signedHistoricallySettledDeltaCents !== BigInt(payloadLine.signedHistoricallySettledDeltaCents) ||
          line.signedOutstandingBalanceDeltaCents !== BigInt(payloadLine.signedOutstandingBalanceDeltaCents) ||
          line.deltaFingerprint !== payloadLine.deltaFingerprint ||
          (line.rootCreditorLineId ?? null) !== payloadLine.rootCreditorLineId ||
          (line.rootPayableRefId ?? null) !== payloadLine.rootPayableRefId
        ) return invalid("B_PRIOR_CREDITOR_LINE_PAYLOAD_INVALID");
      }
    } catch {
      return invalid("B_PRIOR_AUTHORITY_PAYLOAD_OR_FINGERPRINT_INVALID");
    }

    const orderedLines = [...authority.creditorLines]
      .sort((left, right) => left.stableBucketKey.localeCompare(right.stableBucketKey));
    const currentStableKeys = orderedLines.map((line) => line.stableBucketKey);
    if (!stableKeys) stableKeys = currentStableKeys;
    else if (!sameStrings(stableKeys, currentStableKeys)) return invalid("B_PRIOR_CREDITOR_STABLE_KEY_DRIFT");

    const priorRefs = payableRefs.filter((ref) =>
      (revisionByAuthorityId.get(ref.authorityVersionId) ?? Number.MAX_SAFE_INTEGER) < authority.revision
    );
    const currentRefs = payableRefs.filter((ref) => ref.authorityVersionId === authority.id);
    const rootReadSet: Array<Record<string, unknown>> = [];
    for (const line of orderedLines) {
      const previous = priorLines.get(line.stableBucketKey);
      const expectedRootCreditorLineId = previous
        ? rootLineIds.get(line.stableBucketKey) ?? previous.rootCreditorLineId ?? previous.id
        : null;
      if (!previous) rootLineIds.set(line.stableBucketKey, line.id);
      const roots = priorRefs.filter((ref) =>
        ref.stableBucketKey === line.stableBucketKey &&
        ref.direction === "increase" &&
        ref.adjustsSummaryPayableRefId === null
      );
      if (roots.length > 1) return invalid("B_PRIOR_MULTIPLE_PAYABLE_ROOTS");
      const expectedRootPayableRefId = roots[0]?.id ?? null;
      if (expectedRootPayableRefId) rootPayableIds.set(line.stableBucketKey, expectedRootPayableRefId);
      const signedGrossDeltaCents = line.grossDebtCents - (previous?.grossDebtCents ?? 0n);
      const signedHistoricallySettledDeltaCents = line.historicallySettledCents - (previous?.historicallySettledCents ?? 0n);
      const signedOutstandingBalanceDeltaCents = line.outstandingBalanceCents - (previous?.outstandingBalanceCents ?? 0n);
      const expectedDeltaFingerprint = fingerprint({
        bucketKey,
        creditorStableKey: line.stableBucketKey,
        priorAuthorityVersionId: priorAuthority?.id ?? null,
        currentAuthoritySourceVersionFingerprint: authority.sourceVersionFingerprint,
        signedGrossDeltaCents,
        signedHistoricallySettledDeltaCents,
        signedOutstandingBalanceDeltaCents,
        rootCreditorLineId: expectedRootCreditorLineId,
        rootPayableRefId: expectedRootPayableRefId
      });
      if (
        line.signedGrossDeltaCents !== signedGrossDeltaCents ||
        line.signedHistoricallySettledDeltaCents !== signedHistoricallySettledDeltaCents ||
        line.signedOutstandingBalanceDeltaCents !== signedOutstandingBalanceDeltaCents ||
        (line.rootCreditorLineId ?? null) !== expectedRootCreditorLineId ||
        (line.rootPayableRefId ?? null) !== expectedRootPayableRefId ||
        line.deltaFingerprint !== expectedDeltaFingerprint
      ) return invalid("B_PRIOR_CANONICAL_DELTA_OR_ROOT_INVALID");
      if (roots.length === 1) {
        const root = roots[0]!;
        const adjustments = priorRefs
          .filter((ref) => ref.adjustsSummaryPayableRefId === root.id)
          .sort((left, right) => left.id.localeCompare(right.id));
        const effectiveAmountCents = root.deltaAmountCents + adjustments.reduce(
          (sum, adjustment) => sum + (adjustment.direction === "increase" ? adjustment.deltaAmountCents : -adjustment.deltaAmountCents),
          0n
        );
        if (effectiveAmountCents !== (previous?.grossDebtCents ?? 0n) || effectiveAmountCents < 0n) {
          return invalid("B_PRIOR_EFFECTIVE_ROOT_BALANCE_INVALID");
        }
        rootReadSet.push({
          id: root.id,
          stableBucketKey: line.stableBucketKey,
          deltaAmountCents: root.deltaAmountCents,
          effectiveAmountCents,
          adjustments: adjustments.map(({ id, direction, deltaAmountCents }) => ({ id, direction, deltaAmountCents }))
        });
      } else if ((previous?.grossDebtCents ?? 0n) !== 0n) {
        return invalid("B_PRIOR_PAYABLE_ROOT_MISSING");
      }

      const lineRefs = currentRefs.filter((ref) => ref.authorityCreditorLineId === line.id);
      if (lineRefs.length !== (line.signedGrossDeltaCents === 0n ? 0 : 1)) {
        return invalid("B_PRIOR_PAYABLE_DELTA_CARDINALITY_INVALID");
      }
      if (lineRefs.length === 1) {
        const ref = lineRefs[0]!;
        const rootPayableRefId = expectedRootPayableRefId ?? ref.id;
        if (!expectedRootPayableRefId) rootPayableIds.set(line.stableBucketKey, ref.id);
        if (
          ref.atomicScopeVersionId !== authority.atomicScopeVersionId ||
          ref.authorityVersionId !== authority.id ||
          ref.authorityCreditorLineId !== line.id ||
          ref.stableBucketKey !== line.stableBucketKey ||
          ref.employmentCompanyId !== line.employmentCompanyId ||
          ref.projectId !== line.projectId ||
          ref.wageMonth !== line.wageMonth ||
          ref.positionCategoryCode !== line.positionCategoryCode ||
          ref.wageCreditorCategoryCode !== line.wageCreditorCategoryCode ||
          ref.wageCreditorCategoryLabelSnapshot !== line.wageCreditorCategoryLabelSnapshot ||
          ref.creditorIdentityKind !== line.creditorIdentityKind ||
          (ref.creditorPartyVersionId ?? null) !== (line.creditorPartyVersionId ?? null) ||
          (ref.controlledScopeCode ?? null) !== (line.controlledScopeCode ?? null) ||
          (ref.controlledScopeDescription ?? null) !== (line.controlledScopeDescription ?? null) ||
          strictJcs(ref.controlledScopeEvidenceCoordinate ?? null) !== strictJcs(line.controlledScopeEvidenceCoordinate ?? null) ||
          ref.currencyCode !== "CNY" ||
          ref.debtStatus !== line.debtStatus ||
          ref.grossDebtCents !== line.grossDebtCents ||
          ref.historicallySettledCents !== line.historicallySettledCents ||
          ref.outstandingBalanceCents !== line.outstandingBalanceCents ||
          ref.targetKind !== line.targetKind ||
          ref.targetBusinessKey !== line.targetBusinessKey ||
          strictJcs(ref.targetPayload) !== strictJcs(line.targetPayload) ||
          ref.targetFingerprint !== line.targetFingerprint ||
          ref.usageScope !== "historical_reconciliation_only" ||
          ref.newPaymentAllowed ||
          ref.settlementAllocationAllowed ||
          ref.direction !== (line.signedGrossDeltaCents > 0n ? "increase" : "decrease") ||
          ref.deltaAmountCents !== (line.signedGrossDeltaCents > 0n ? line.signedGrossDeltaCents : -line.signedGrossDeltaCents) ||
          (ref.adjustsSummaryPayableRefId ?? null) !== (expectedRootPayableRefId ?? null) ||
          ref.deltaFingerprint !== line.deltaFingerprint ||
          rootPayableIds.get(line.stableBucketKey) !== rootPayableRefId
        ) return invalid("B_PRIOR_PAYABLE_DELTA_INVALID");
      }
    }
    const expectedSourceDeltaFingerprint = fingerprint({
      bucketKey,
      revision: authority.revision,
      supersedesVersionId: priorAuthority?.id ?? null,
      sourceVersionFingerprint: authority.sourceVersionFingerprint,
      lines: orderedLines.map((line) => ({
        creditorCategoryCode: line.wageCreditorCategoryCode,
        signedGrossDeltaCents: line.signedGrossDeltaCents,
        signedHistoricallySettledDeltaCents: line.signedHistoricallySettledDeltaCents,
        signedOutstandingBalanceDeltaCents: line.signedOutstandingBalanceDeltaCents,
        deltaFingerprint: line.deltaFingerprint
      }))
    });
    if (
      authority.sourceDeltaFingerprint !== expectedSourceDeltaFingerprint ||
      authority.rootClosureFingerprint !== fingerprint(
        rootReadSet.sort((left, right) => String(left.id).localeCompare(String(right.id)))
      )
    ) return invalid("B_PRIOR_SOURCE_DELTA_OR_ROOT_CLOSURE_INVALID");
    priorLines = new Map(orderedLines.map((line) => [line.stableBucketKey, line]));

    const lifecycle = analyzeHistoricalWageSummaryPriorLifecycle(authority, currentRefs);
    if (lifecycle.state === "invalid") return lifecycle;
    if (lifecycle.state === "inactive_compensated" && index !== authorities.length - 1) {
      return invalid("B_PRIOR_COMPENSATED_AUTHORITY_HAS_SUCCESSOR");
    }
    if (index === authorities.length - 1) return lifecycle;
  }
  return invalid("B_PRIOR_LINEAGE_EMPTY_AFTER_VALIDATION");
}

function priorSummaryLineageOwnsAdjustmentRoot(
  rootAuthority: HistoricalWagePriorSummaryAuthority,
  adjustmentRoot: NonNullable<ResolvedLegacy["adjustmentRoot"]>
) {
  try {
    const computed = computePol219HistoricalWageAuthorityFingerprint(rootAuthority.authorityPayload);
    return computed.payload.legacySources.length === 1 &&
      computed.payload.legacySources[0]!.factId === adjustmentRoot.factId &&
      computed.payload.legacySources[0]!.factFingerprint === adjustmentRoot.sourceFingerprint;
  } catch {
    return false;
  }
}

function analyzeHistoricalWageSummaryPriorLifecycle(
  authority: HistoricalWagePriorSummaryAuthority,
  authorityPayableRefs: HistoricalWagePriorSummaryPayableRef[]
): { state: "active" | "inactive_compensated" | "invalid"; reasonCode: string } {
  const invalid = (reasonCode: string) => ({ state: "invalid" as const, reasonCode });
  const scope = authority.atomicScope;
  if (
    !scope ||
    scope.id !== authority.atomicScopeVersionId ||
    scope.scopeKind !== "historical_wage" ||
    scope.permissionSnapshotFingerprint !== authority.permissionScopeFingerprint ||
    scope.createdByUserId !== authority.declaredByUserId ||
    scope.reservedWageStatementVersionId !== null ||
    scope.projects.length !== 1 ||
    scope.projects[0]!.atomicScopeVersionId !== scope.id ||
    scope.projects[0]!.projectId !== authority.projectId ||
    scope.projects[0]!.manifest.atomicScopeVersionId !== scope.id ||
    scope.projects[0]!.manifest.id !== scope.projects[0]!.manifestVersionId ||
    scope.projects[0]!.manifest.projectId !== authority.projectId ||
    scope.projects[0]!.manifest.adapterKind !== "historical_wage" ||
    scope.manifests.length !== 1 ||
    scope.manifests[0]!.id !== scope.projects[0]!.manifestVersionId ||
    scope.manifests[0]!.atomicScopeVersionId !== scope.id ||
    scope.manifests[0]!.projectId !== authority.projectId ||
    scope.manifests[0]!.adapterKind !== "historical_wage" ||
    scope.historicalSummaryAuthorities.length !== 1 ||
    scope.historicalSummaryAuthorities[0]!.id !== authority.id ||
    scope.historicalSummaryAuthorities[0]!.atomicScopeVersionId !== scope.id ||
    scope.historicalSummaryAuthorities[0]!.summaryBucketKey !== authority.summaryBucketKey ||
    scope.historicalSummaryAuthorities[0]!.revision !== authority.revision ||
    authority.takeoverMappings.length !== 1
  ) return invalid("B_PRIOR_SCOPE_OR_MANIFEST_OWNERSHIP_INVALID");
  const mapping = authority.takeoverMappings[0]!;
  if (
    mapping.historicalWageSummaryAuthorityVersionId !== authority.id ||
    mapping.projectId !== authority.projectId ||
    mapping.manifestVersionId !== scope.projects[0]!.manifestVersionId ||
    mapping.manifest.id !== mapping.manifestVersionId ||
    mapping.manifest.atomicScopeVersionId !== scope.id ||
    mapping.manifest.projectId !== mapping.projectId ||
    mapping.manifest.adapterKind !== "historical_wage" ||
    mapping.adapterKind !== "historical_wage" ||
    mapping.evidenceLevel !== "B" ||
    mapping.entryKind !== "formal" ||
    mapping.mappingDecision !== "FORMAL" ||
    mapping.sourceDiscriminator !== "historical_wage_summary"
  ) return invalid("B_PRIOR_MAPPING_OWNERSHIP_INVALID");
  const reverseManifest = scope.manifests[0]!;
  const projectManifest = scope.projects[0]!.manifest;
  const reverseRows = reverseManifest.rows ?? [];
  const projectRows = projectManifest.rows ?? [];
  const reverseManifestReceipts = reverseManifest.receipts ?? [];
  const projectManifestReceipts = projectManifest.receipts ?? [];
  if (
    reverseRows.length !== 1 ||
    projectRows.length !== 1 ||
    reverseRows[0]!.id !== mapping.id ||
    projectRows[0]!.id !== mapping.id ||
    reverseRows[0]!.manifestVersionId !== reverseManifest.id ||
    projectRows[0]!.manifestVersionId !== projectManifest.id ||
    reverseRows[0]!.projectId !== authority.projectId ||
    projectRows[0]!.projectId !== authority.projectId ||
    reverseRows[0]!.historicalWageSummaryAuthorityVersionId !== authority.id ||
    projectRows[0]!.historicalWageSummaryAuthorityVersionId !== authority.id ||
    reverseManifestReceipts.length !== 0 ||
    projectManifestReceipts.length !== 0
  ) return invalid("B_PRIOR_REVERSE_MANIFEST_OWNERSHIP_INVALID");

  const receiptsByAction = new Map<string, HistoricalWagePriorSummaryAuthority["atomicScope"]["receipts"]>();
  for (const receipt of scope.receipts) {
    const group = receiptsByAction.get(receipt.action) ?? [];
    group.push(receipt);
    receiptsByAction.set(receipt.action, group);
  }
  const required = [
    ["historical_wage_takeover.scope.create", "prepared", 0],
    ["historical_wage_takeover.scope.apply", "inactive_applied", 1],
    ["historical_wage_takeover.scope.attest", "attested", 2],
    ["historical_wage_takeover.scope.activate", "activated", 3]
  ] as const;
  for (const [action, status, expectedRevision] of required) {
    const receipts = receiptsByAction.get(action) ?? [];
    if (
      receipts.length !== 1 ||
      receipts[0]!.status !== status ||
      receipts[0]!.expectedRevision !== expectedRevision ||
      receipts[0]!.atomicScopeVersionId !== scope.id ||
      receipts[0]!.permissionSnapshotFingerprint !== scope.permissionSnapshotFingerprint ||
      receipts[0]!.causesReceiptId !== null
    ) return invalid("B_PRIOR_LIFECYCLE_RECEIPT_INVALID");
  }
  if (scope.receipts.some((receipt) => ![
    ...required.map(([action]) => action),
    "historical_wage_takeover.scope.compensate"
  ].includes(receipt.action))) return invalid("B_PRIOR_UNKNOWN_LIFECYCLE_RECEIPT");
  const createReceipt = receiptsByAction.get(required[0][0])![0]!;
  const applyReceipt = receiptsByAction.get(required[1][0])![0]!;
  const attestReceipt = receiptsByAction.get(required[2][0])![0]!;
  const activationReceipt = receiptsByAction.get(required[3][0])![0]!;
  const activationReceiptLine = activationReceipt.lines[0];
  const mappingReadSet = isPriorGraphSnapshot(mapping.readSetSnapshot)
    ? mapping.readSetSnapshot
    : null;
  const frozenLegacy = mappingReadSet && isPriorGraphSnapshot(mappingReadSet.legacy)
    ? mappingReadSet.legacy
    : null;
  const frozenPlan = mappingReadSet && isPriorGraphSnapshot(mappingReadSet.plan)
    ? mappingReadSet.plan
    : null;
  if (
    !mappingReadSet ||
    !frozenLegacy ||
    !frozenPlan ||
    mappingReadSet.readSetFingerprint !== scope.readSetFingerprint ||
    mapping.mappingFingerprint !== fingerprint({
      scopeId: scope.id,
      projectId: mapping.projectId,
      plan: frozenPlan,
      legacy: frozenLegacy
    })
  ) return invalid("B_PRIOR_MAPPING_READ_SET_INVALID");
  const receiptResultIsInvalid = (
    receipt: HistoricalWagePriorSummaryAuthority["atomicScope"]["receipts"][number]
  ) => {
    if (!isPriorGraphSnapshot(receipt.resultSnapshot)) return true;
    const result = receipt.resultSnapshot;
    const common = result.atomicScopeVersionId === scope.id &&
      result.grade === "B" &&
      result.status === receipt.status;
    if (!common) return true;
    if (receipt.action === "historical_wage_takeover.scope.create") {
      return !sameStrings(Object.keys(result).sort(), [
        "atomicScopeVersionId",
        "commandSelectionRef",
        "grade",
        "projectCount",
        "rowCount",
        "status"
      ].sort()) || result.projectCount !== 1 || result.rowCount !== 1 || !text(result.commandSelectionRef);
    }
    if (receipt.action === "historical_wage_takeover.scope.apply") {
      return !sameStrings(Object.keys(result).sort(), [
        "atomicScopeVersionId",
        "grade",
        "revision",
        "rowCount",
        "status"
      ].sort()) || result.revision !== 2 || result.rowCount !== 1;
    }
    if (receipt.action === "historical_wage_takeover.scope.attest") {
      return !sameStrings(Object.keys(result).sort(), [
        "atomicScopeVersionId",
        "authorityVersionId",
        "grade",
        "revision",
        "status"
      ].sort()) || result.revision !== 3 || result.authorityVersionId !== authority.id;
    }
    if (receipt.action === "historical_wage_takeover.scope.activate") {
      return !sameStrings(Object.keys(result).sort(), [
        "atomicScopeVersionId",
        "grade",
        "revision",
        "rows",
        "status"
      ].sort()) || result.revision !== 4 || !Array.isArray(result.rows) || fingerprint(result.rows) !== fingerprint([{
        projectId: authority.projectId,
        decision: "FORMAL",
        targetKind: "historical_wage_summary_authority_version",
        targetRef: authority.id
      }]);
    }
    return receipt.action !== "historical_wage_takeover.scope.compensate" ||
      !sameStrings(Object.keys(result).sort(), [
        "atomicScopeVersionId",
        "causesReceiptId",
        "grade",
        "revision",
        "status"
      ].sort()) ||
      result.revision !== 5 ||
      result.causesReceiptId !== activationReceipt.id;
  };
  const receiptLineIsInvalid = (
    receipt: HistoricalWagePriorSummaryAuthority["atomicScope"]["receipts"][number]
  ) => {
    if (receipt.lines.length !== 1) return true;
    const line = receipt.lines[0]!;
    const isActivation = receipt.action === "historical_wage_takeover.scope.activate";
    const isCompensation = receipt.action === "historical_wage_takeover.scope.compensate";
    const expectedDecision = receipt.action === "historical_wage_takeover.scope.create"
      ? "PREPARED"
      : receipt.action === "historical_wage_takeover.scope.apply"
        ? "inactive_applied"
        : receipt.action === "historical_wage_takeover.scope.attest"
          ? "attested"
          : isActivation
            ? "FORMAL"
            : "compensated";
    const causeLine = isCompensation ? activationReceiptLine : null;
    return !uuid(line.id) ||
      line.receiptId !== receipt.id ||
      line.rowMappingId !== mapping.id ||
      line.projectId !== authority.projectId ||
      line.lineNo !== 1 ||
      line.decision !== expectedDecision ||
      line.entryKind !== "historical_wage" ||
      line.amountCents !== mapping.amountCents ||
      (isActivation
        ? line.targetKind !== "historical_wage_summary_authority_version" || line.targetRef !== authority.id
        : line.targetKind !== null || line.targetRef !== null) ||
      line.causalOrdinal !== 1 ||
      line.reversesLineId !== null ||
      line.causesLineId !== (causeLine?.id ?? null) ||
      line.causalityFingerprint !== fingerprint({
        receiptId: receipt.id,
        mappingId: mapping.id,
        causalOrdinal: 1,
        causesLineId: causeLine?.id ?? null,
        causeLineFingerprint: causeLine?.causalityFingerprint ?? null
      }) ||
      fingerprint(line.lineSnapshot) !== fingerprint(frozenLegacy) ||
      !validPriorGraphDate(line.createdAt);
  };
  const scopeReceiptLines = scope.receipts.flatMap((receipt) => receipt.lines);
  const mappingReceiptLines = mapping.receiptLines ?? [];
  const reverseMappingReceiptLines = reverseRows[0]!.receiptLines ?? [];
  const projectMappingReceiptLines = projectRows[0]!.receiptLines ?? [];
  const scopeReceiptLineById = new Map(scopeReceiptLines.map((line) => [line.id, line] as const));
  if (
    new Set(scopeReceiptLines.map((line) => line.id)).size !== scopeReceiptLines.length ||
    !sameStrings(mappingReceiptLines.map((line) => line.id).sort(), scopeReceiptLines.map((line) => line.id).sort()) ||
    !sameStrings(reverseMappingReceiptLines.map((line) => line.id).sort(), scopeReceiptLines.map((line) => line.id).sort()) ||
    !sameStrings(projectMappingReceiptLines.map((line) => line.id).sort(), scopeReceiptLines.map((line) => line.id).sort()) ||
    [mappingReceiptLines, reverseMappingReceiptLines, projectMappingReceiptLines].some((lines) =>
      lines.some((line) => {
        const scopeLine = scopeReceiptLineById.get(line.id);
        return !scopeLine || fingerprint(line) !== fingerprint(scopeLine);
      })
    )
  ) return invalid("B_PRIOR_REVERSE_RECEIPT_LINE_OWNERSHIP_INVALID");
  if (scope.receipts.some((receipt) => {
    const isCompensation = receipt.action === "historical_wage_takeover.scope.compensate";
    return !uuid(receipt.id) ||
      receipt.manifestVersionId !== null ||
      receipt.atomicScopeVersionId !== scope.id ||
      !uuid(receipt.idempotencyKey) ||
      !text(receipt.actorUserId) ||
      (receipt.delegatorUserId !== null && !text(receipt.delegatorUserId)) ||
      !priorReceiptActorSetMatches(receipt) ||
      receipt.permissionSnapshotFingerprint !== scope.permissionSnapshotFingerprint ||
      !priorReceiptCommandSnapshotMatches(receipt) ||
      receipt.causalityFingerprint !== fingerprint({
        action: receipt.action,
        atomicScopeVersionId: scope.id,
        commandFingerprint: receipt.fingerprint,
        mappings: [mapping.id]
      }) ||
      typeof receipt.createdTransactionId !== "bigint" ||
      !validPriorGraphDate(receipt.createdAt) ||
      receipt.causesReceiptId !== (isCompensation ? activationReceipt.id : null) ||
      receiptResultIsInvalid(receipt) ||
      receiptLineIsInvalid(receipt);
  })) return invalid("B_PRIOR_LIFECYCLE_RECEIPT_OR_LINE_INVALID");
  let creatorIdentity: Identity;
  try {
    creatorIdentity = frozenScopeCreatorIdentity(authority.scopeCreatorIdentitySnapshot);
  } catch {
    return invalid("B_PRIOR_CREATOR_IDENTITY_INVALID");
  }
  if (
    authority.declaredByUserId !== creatorIdentity.actualUserId ||
    (authority.declaredDelegatorUserId ?? null) !== (creatorIdentity.delegatorUserId ?? null) ||
    createReceipt.actorUserId !== creatorIdentity.actualUserId ||
    (createReceipt.delegatorUserId ?? null) !== (creatorIdentity.delegatorUserId ?? null) ||
    strictJcs(createReceipt.actorSetSnapshot) !== strictJcs(creatorIdentity.actorSetSnapshot)
  ) return invalid("B_PRIOR_DECLARER_OR_CREATE_IDENTITY_INVALID");

  if (
    authority.attestations.length !== 2 ||
    !sameStrings(authority.attestations.map((attestation) => String(attestation.attestationOrdinal)), ["1", "2"])
  ) return invalid("B_PRIOR_TWO_ATTESTATIONS_REQUIRED");
  const expectedAttestationReceipts = [createReceipt, attestReceipt];
  for (const [index, attestation] of authority.attestations.entries()) {
    const receipt = expectedAttestationReceipts[index]!;
    if (
      !uuid(attestation.id) ||
      attestation.atomicScopeVersionId !== scope.id ||
      attestation.authorityVersionId !== authority.id ||
      attestation.summaryBucketKey !== authority.summaryBucketKey ||
      attestation.receiptId !== receipt.id ||
      attestation.actorUserId !== receipt.actorUserId ||
      (attestation.delegatorUserId ?? null) !== (receipt.delegatorUserId ?? null) ||
      attestation.permissionScopeFingerprint !== scope.permissionSnapshotFingerprint ||
      attestation.attestationOrdinal !== index + 1 ||
      attestation.createdTransactionId !== receipt.createdTransactionId ||
      !validPriorGraphDate(attestation.createdAt)
    ) return invalid("B_PRIOR_ATTESTATION_RECEIPT_LINK_INVALID");
  }
  const attestationIdentities = authority.attestations.map((attestation) =>
    sortedUnique([attestation.actorUserId, ...(attestation.delegatorUserId ? [attestation.delegatorUserId] : [])])
  );
  if (
    effectiveIdentitySetsOverlap(attestationIdentities[0]!, attestationIdentities[1]!) ||
    effectiveIdentitySetsOverlap(
      sortedUnique([activationReceipt.actorUserId, ...(activationReceipt.delegatorUserId ? [activationReceipt.delegatorUserId] : [])]),
      sortedUnique([
        createReceipt.actorUserId,
        ...(createReceipt.delegatorUserId ? [createReceipt.delegatorUserId] : []),
        applyReceipt.actorUserId,
        ...(applyReceipt.delegatorUserId ? [applyReceipt.delegatorUserId] : []),
        ...attestationIdentities.flat()
      ])
    )
  ) return invalid("B_PRIOR_EFFECTIVE_IDENTITY_OVERLAP");

  if (
    activationReceipt.lines.length !== 1 ||
    activationReceipt.lines[0]!.rowMappingId !== mapping.id ||
    activationReceipt.lines[0]!.projectId !== authority.projectId ||
    activationReceipt.lines[0]!.decision !== "FORMAL" ||
    activationReceipt.lines[0]!.entryKind !== "historical_wage" ||
    activationReceipt.lines[0]!.targetKind !== "historical_wage_summary_authority_version" ||
    activationReceipt.lines[0]!.targetRef !== authority.id ||
    activationReceipt.lines[0]!.causalOrdinal !== 1 ||
    activationReceipt.lines[0]!.causesLineId !== null ||
    activationReceipt.lines[0]!.reversesLineId !== null
  ) return invalid("B_PRIOR_ACTIVATION_LINE_INVALID");
  if (authorityPayableRefs.some((ref) => ref.rowMappingId !== mapping.id)) {
    return invalid("B_PRIOR_PAYABLE_MAPPING_FK_INVALID");
  }

  const compensationReceipts = receiptsByAction.get("historical_wage_takeover.scope.compensate") ?? [];
  if (!compensationReceipts.length) {
    if (authorityPayableRefs.some((ref) => ref.eligibilityRevocations.length !== 0)) {
      return invalid("B_PRIOR_REVOCATION_WITHOUT_COMPENSATION");
    }
    return { state: "active", reasonCode: "B_PRIOR_ACTIVE" };
  }
  if (compensationReceipts.length !== 1) return invalid("B_PRIOR_COMPENSATION_CARDINALITY_INVALID");
  const compensation = compensationReceipts[0]!;
  const activationLine = activationReceipt.lines[0]!;
  if (
    compensation.status !== "compensated" ||
    compensation.expectedRevision !== 4 ||
    compensation.atomicScopeVersionId !== scope.id ||
    compensation.permissionSnapshotFingerprint !== scope.permissionSnapshotFingerprint ||
    compensation.causesReceiptId !== activationReceipt.id ||
    compensation.lines.length !== 1 ||
    compensation.lines[0]!.rowMappingId !== mapping.id ||
    compensation.lines[0]!.projectId !== authority.projectId ||
    compensation.lines[0]!.amountCents !== activationLine.amountCents ||
    compensation.lines[0]!.causalOrdinal !== activationLine.causalOrdinal ||
    compensation.lines[0]!.causesLineId !== activationLine.id ||
    compensation.lines[0]!.reversesLineId !== null ||
    effectiveIdentitySetsOverlap(
      sortedUnique([activationReceipt.actorUserId, ...(activationReceipt.delegatorUserId ? [activationReceipt.delegatorUserId] : [])]),
      sortedUnique([compensation.actorUserId, ...(compensation.delegatorUserId ? [compensation.delegatorUserId] : [])])
    ) ||
    authorityPayableRefs.some((ref) =>
      ref.eligibilityRevocations.length !== 1 ||
      ref.eligibilityRevocations[0]!.summaryPayableRefId !== ref.id ||
      ref.eligibilityRevocations[0]!.compensationReceiptId !== compensation.id
    )
  ) return invalid("B_PRIOR_COMPENSATION_OR_REVOCATION_INCOMPLETE");
  return { state: "inactive_compensated", reasonCode: "B_PRIOR_FULLY_COMPENSATED" };
}

function effectiveIdentitySetsOverlap(left: readonly string[], right: readonly string[]) {
  const rightIds = new Set(right);
  return left.some((id) => rightIds.has(id));
}

function assertNoMalformedCSummaryAuthority(snapshot: unknown) {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    Object.prototype.hasOwnProperty.call(snapshot, "historicalWageSummaryAuthority") &&
    !parseHistoricalWageSummarySnapshot(snapshot)
  ) {
    throw new ConflictException(INVALID_C_FRONTIER_INPUT_MESSAGE);
  }
}

function evidenceFileReadSet(
  expectedFileObjectId: string,
  expectedContentSha256: string,
  actual: { id: string; storageStatus: string; contentSha256: string | null } | null
): HistoricalWageEvidenceFileReadSet {
  return {
    expectedFileObjectId,
    expectedContentSha256,
    actual: actual
      ? {
          id: actual.id,
          storageStatus: actual.storageStatus,
          contentSha256: actual.contentSha256 ?? null
        }
      : null
  };
}

function historicalSummaryEvidence(snapshot: HistoricalSummarySnapshot): HistoricalEvidenceCoordinate[] {
  return [
    ...snapshot.evidence,
    ...snapshot.assignedWageExclusions,
    ...snapshot.lines.flatMap((line) => line.target.kind === "historical_wage_balance_reconciliation_version"
      ? line.target.evidence
      : line.target.paymentExecutions.flatMap((payment) => [
          {
            fileObjectId: payment.voucherFileId,
            contentSha256: payment.voucherContentSha256,
            evidenceCoordinate: payment.creditorScopeEvidenceCoordinate
          },
          {
            fileObjectId: payment.verificationEvidenceFileId,
            contentSha256: payment.verificationEvidenceContentSha256,
            evidenceCoordinate: payment.creditorScopeEvidenceCoordinate
          },
          {
            fileObjectId: payment.transactionEvidenceFileId,
            contentSha256: payment.transactionEvidenceContentSha256,
            evidenceCoordinate: payment.creditorScopeEvidenceCoordinate
          }
        ]))
  ];
}

function planReadSet(plan: ScopePlan) {
  return {
    grade: plan.grade,
    sourceVersionId: plan.sourceVersionId ?? null,
    sourceFingerprint: plan.sourceFingerprint ?? null,
    sourceClosureFingerprint: plan.sourceClosureFingerprint ?? null,
    projectIds: plan.projectIds ?? [],
    projectDeltas: plan.projectDeltas ?? [],
    adjustmentRootProofs: plan.adjustmentRootProofs ?? [],
    ...(plan.grade === "A"
      ? { materializationAuthorityReadSet: plan.materializationAuthorityReadSet ?? null }
      : {}),
    ...(plan.grade === "A"
      ? { priorVersionEligibilityProof: plan.priorVersionEligibilityProof ?? null }
      : {}),
    negativeAuthorityFrontierFingerprint: plan.negativeAuthorityFrontierFingerprint ?? null,
    negativeAuthorityFrontier: plan.negativeAuthorityFrontier ?? null,
    wageReservation: plan.wageReservation ?? null,
    conflictReadSet: plan.conflictReadSet ?? null,
    summaryAuthorityFingerprint: plan.summaryAuthority?.authorityFingerprint ?? null,
    summarySourceVersionFingerprint: plan.summaryAuthority?.sourceVersionFingerprint ?? null,
    ...(plan.summaryAuthority ? {
      summaryBucketKey: summaryBucketKey(plan.summaryAuthority),
      summarySelectionSnapshot: historicalWageSummarySelectionSnapshot(plan.summaryAuthority.snapshot),
      summaryRevision: plan.summaryAuthority.revision,
      summarySupersedesVersionId: plan.summaryAuthority.supersedesVersionId,
      summaryLineageRootAuthorityVersionId: plan.summaryAuthority.lineageRootAuthorityVersionId,
      summarySourceDeltaFingerprint: plan.summaryAuthority.sourceDeltaFingerprint,
      summaryRootClosureFingerprint: plan.summaryAuthority.rootClosureFingerprint,
      summaryPriorLineageProof: plan.summaryAuthority.priorLineageProof,
      summaryLines: [...(plan.summary ?? [])]
        .sort((left, right) => left.creditorCategoryCode.localeCompare(right.creditorCategoryCode))
        .map((line) => ({
          stableBucketKey: line.stableBucketKey,
          wageCreditorCategoryCode: line.creditorCategoryCode,
          grossDebtCents: line.grossDebtCents,
          historicallySettledCents: line.historicallySettledCents,
          outstandingBalanceCents: line.outstandingBalanceCents,
          debtStatus: line.debtStatus,
          targetFingerprint: line.finalTargetFingerprint ?? null,
          signedGrossDeltaCents: line.signedGrossDeltaCents,
          signedHistoricallySettledDeltaCents: line.signedHistoricallySettledDeltaCents,
          signedOutstandingBalanceDeltaCents: line.signedOutstandingBalanceDeltaCents,
          deltaFingerprint: line.deltaFingerprint,
          rootCreditorLineId: line.rootCreditorLineId,
          rootPayableRefId: line.rootPayableRefId
        }))
    } : {}),
    blockedReason: plan.blockedReason ?? null
  };
}

function permissionScopeFingerprint(binding: HistoricalWageSelectionBinding) {
  return fingerprint({
    policy: "pol219-historical-wage-v1",
    selectionFingerprint: binding.selectionFingerprint,
    grade: binding.grade,
    sourceClosureFingerprint: binding.sourceClosureFingerprint ?? null,
    summaryFingerprint: binding.summaryFingerprint ?? null,
    negativeAuthorityFrontierFingerprint: binding.negativeAuthorityFrontierFingerprint ?? null,
    requiredActions: ["clearing.prepare", "clearing.attest", "clearing.confirm", "wage_sensitive_read"]
  });
}

function wageConflictGroupKey(projectId: string, plan: ScopePlan) {
  return `wage:${projectId}:${plan.summaryAuthority?.wageMonth ?? plan.sourceVersionId ?? "unresolved"}`;
}

function summaryBucketKey(authority: Pick<HistoricalSummarySnapshot, "employmentCompanyId" | "projectId" | "wageMonth" | "positionCategoryCode">) {
  return [authority.employmentCompanyId, authority.projectId, authority.wageMonth, authority.positionCategoryCode].join(":");
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function legacyCoordinateKey(legacy: Pick<HistoricalWageLegacySource, "projectId" | "sourceType" | "sourceBusinessId" | "sourceVersion">) {
  return [legacy.projectId, legacy.sourceType, legacy.sourceBusinessId, legacy.sourceVersion].join(":");
}

function normalizedEvidenceRefs(values: string[] | undefined) {
  if (!values) return [];
  if (!Array.isArray(values) || values.some((value) => !text(value))) throw new ConflictException("历史工资接管证据引用格式无效");
  return sortedUnique(values.map((value) => value.trim()));
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveBigInt(value: unknown) {
  try {
    const parsed = BigInt(typeof value === "bigint" ? value : typeof value === "number" || typeof value === "string" ? value : -1);
    return parsed > 0n ? parsed : -1n;
  } catch {
    return -1n;
  }
}

function nonNegativeBigInt(value: unknown) {
  try {
    const parsed = BigInt(typeof value === "bigint" ? value : typeof value === "number" || typeof value === "string" ? value : -1);
    return parsed >= 0n ? parsed : -1n;
  } catch {
    return -1n;
  }
}

function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validPriorGraphDate(value: Date) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPriorGraphSnapshot(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function priorReceiptActorSetMatches(receipt: {
  actorUserId: string;
  delegatorUserId: string | null;
  actorSetSnapshot: unknown;
}) {
  if (!isPriorGraphSnapshot(receipt.actorSetSnapshot)) return false;
  const actorIds = receipt.actorSetSnapshot.actorIds;
  const expectedActorIds = sortedUnique([
    receipt.actorUserId,
    ...(receipt.delegatorUserId ? [receipt.delegatorUserId] : [])
  ]);
  return receipt.actorSetSnapshot.actualUserId === receipt.actorUserId &&
    (receipt.actorSetSnapshot.delegatorUserId ?? null) === receipt.delegatorUserId &&
    Array.isArray(actorIds) &&
    actorIds.every((actorId): actorId is string => typeof actorId === "string") &&
    sameStrings([...actorIds].sort((left, right) => left.localeCompare(right)), expectedActorIds);
}

function priorReceiptCommandSnapshotMatches(receipt: {
  atomicScopeVersionId: string | null;
  action: string;
  expectedRevision: number;
  actorUserId: string;
  delegatorUserId: string | null;
  fingerprint: string;
  commandSnapshotSchemaVersion: number | null;
  commandSnapshot: unknown;
}) {
  if (
    receipt.commandSnapshotSchemaVersion !== 1 ||
    !isPriorGraphSnapshot(receipt.commandSnapshot)
  ) return false;
  const snapshot = receipt.commandSnapshot;
  const expectedKeys = [
    "action",
    "actorUserId",
    "binding",
    "businessReason",
    "delegatorUserId",
    "evidenceRefs",
    "expectedRevision"
  ].sort();
  if (!sameStrings(Object.keys(snapshot).sort(), expectedKeys)) return false;
  if (
    snapshot.action !== receipt.action ||
    snapshot.actorUserId !== receipt.actorUserId ||
    snapshot.expectedRevision !== receipt.expectedRevision ||
    snapshot.delegatorUserId !== receipt.delegatorUserId ||
    !text(snapshot.businessReason) ||
    snapshot.businessReason !== snapshot.businessReason.trim() ||
    !Array.isArray(snapshot.evidenceRefs) ||
    snapshot.evidenceRefs.some((value) => !text(value)) ||
    !sameStrings(
      snapshot.evidenceRefs as string[],
      sortedUnique((snapshot.evidenceRefs as string[]).map((value) => value.trim()))
    ) ||
    !isPriorGraphSnapshot(snapshot.binding) ||
    snapshot.binding.actorUserId !== receipt.actorUserId ||
    (snapshot.binding.delegatorUserId ?? null) !== receipt.delegatorUserId ||
    !SHA256.test(stringOrEmpty(snapshot.binding.selectionFingerprint)) ||
    !Array.isArray(snapshot.binding.legacyCoordinates) ||
    fingerprint(snapshot) !== receipt.fingerprint
  ) return false;
  const commandScopeId = snapshot.binding.atomicScopeVersionId;
  return receipt.action === "historical_wage_takeover.scope.create"
    ? commandScopeId === undefined
    : commandScopeId === receipt.atomicScopeVersionId;
}

function hasDuplicateValues(values: string[]) {
  return new Set(values).size !== values.length;
}

function signedPriorGraphAmount(direction: string, amountCents: bigint) {
  return direction === "increase" ? amountCents : -amountCents;
}

function signedPriorGraphTotal(values: Array<{ direction: string; amountCents: bigint }>) {
  return values.reduce((total, value) => total + signedPriorGraphAmount(value.direction, value.amountCents), 0n);
}

function validInstant(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function sameInstant(value: Date, expected: string) {
  return validInstant(expected) && value.getTime() === new Date(expected).getTime();
}

function requiredText(value: string | null | undefined, message: string) {
  if (!text(value)) throw new ConflictException(message);
  return value;
}

function wageMonthForPlan(plan: ScopePlan) {
  return plan.summaryAuthority?.wageMonth ?? plan.negativeAuthorityFrontier?.authorityScope.wageMonth;
}

function historicalWageEnvelopeTargetFingerprint(envelope: {
  id: string;
  canonicalFingerprint: string;
  legacySourceFingerprint: string;
}) {
  return fingerprint({
    targetKind: "wage_takeover_projection_envelope",
    targetRef: envelope.id,
    canonicalFingerprint: envelope.canonicalFingerprint,
    sourceFingerprint: envelope.legacySourceFingerprint
  });
}

function isCompletelyCompensatedHistoricalActivation(successor: {
  id: string;
  action: string;
  status: string;
  atomicScopeVersionId: string | null;
  lines: Array<{
    id: string;
    rowMappingId: string;
    projectId: string | null;
    amountCents: bigint;
    causalOrdinal: number;
  }>;
  causedReceipts: Array<{
    action: string;
    status: string;
    atomicScopeVersionId: string | null;
    causesReceiptId: string | null;
    lines: Array<{
      rowMappingId: string;
      projectId: string | null;
      amountCents: bigint;
      causalOrdinal: number;
      causesLineId: string | null;
    }>;
  }>;
}) {
  if (
    successor.action !== "historical_wage_takeover.scope.activate" ||
    successor.status !== "activated" ||
    !successor.atomicScopeVersionId ||
    successor.lines.length === 0 ||
    new Set(successor.lines.map((line) => line.id)).size !== successor.lines.length
  ) return false;
  const compensations = successor.causedReceipts.filter((receipt) =>
    receipt.action === "historical_wage_takeover.scope.compensate" &&
    receipt.status === "compensated" &&
    receipt.atomicScopeVersionId === successor.atomicScopeVersionId &&
    receipt.causesReceiptId === successor.id
  );
  if (compensations.length !== 1) return false;
  const compensation = compensations[0]!;
  if (
    compensation.lines.length !== successor.lines.length ||
    new Set(compensation.lines.map((line) => line.causesLineId)).size !== successor.lines.length
  ) return false;
  return successor.lines.every((line) => compensation.lines.some((candidate) =>
    candidate.causesLineId === line.id &&
    candidate.rowMappingId === line.rowMappingId &&
    candidate.projectId === line.projectId &&
    candidate.amountCents === line.amountCents &&
    candidate.causalOrdinal === line.causalOrdinal
  ));
}

function assertDisjointEffectiveIdentities(
  current: readonly string[],
  existing: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  message = "历史工资接管职责分离失败：声明、复核、激活或委托有效身份不得重叠"
) {
  const currentIds = new Set(current.filter(text));
  if (existing.some((identity) => identity.some((id) => id !== null && id !== undefined && currentIds.has(id)))) {
    throw new ForbiddenException(message);
  }
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
