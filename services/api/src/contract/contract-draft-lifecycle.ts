import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ContractLifecycleCapabilities,
  ContractLifecycleStage
} from "@jiangkong/shared-domain";
import type {
  ContractVersionStatus,
  DraftLedgerView
} from "@jiangkong/shared-domain";

export type ContractDraftLifecycleStatus =
  | ContractVersionStatus
  | "approved"
  | "sealed_pending_archive"
  | "abandoned"
  | "final_rejected"
  | "deleting";

export type ContractDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

export interface ContractDraftLifecycleFacts {
  changeType: string;
  versionNo: number;
  status: ContractDraftLifecycleStatus;
  firstSubmittedAt: Date | null;
  approvalInstanceCount: number;
  approvalActionCount: number;
  formalFileCount: number;
  signedFormalFileCount: number;
  activeSignedFormalFileCount: number;
  authorizationCount: number;
  authorizationLinkCount: number;
  sealTaskCount: number;
  activeSealTaskCount: number;
  archiveFileCount: number;
  settlementCount: number;
  paymentRequestCount: number;
}

export interface ContractDraftLifecycleClassification {
  contractLifecycleStage: ContractLifecycleStage;
  capabilities: ContractLifecycleCapabilities;
  lifecycleKind: "pristine_draft" | "approval_draft" | "formal_record";
  blockers: string[];
  expectedAction: ContractDraftLifecycleAction | null;
}

export interface LockedContractDraftMutationBoundary<
  TVersion extends { id: string; contractId: string } = {
    id: string;
    contractId: string;
  },
  TContract extends { id: string } = {
    id: string;
  }
> {
  contractId: string;
  contract: TContract;
  version: TVersion;
  formalBlockers: string[];
}

export interface GenericContractDraftVersionGuardFacts {
  changeType?: string | null;
  hasHistoricalTakeoverRelation?: boolean | null;
}

export interface ContractDraftMutationBoundaryOptions {
  /**
   * Only background processors that inspect a locked version in order to mark
   * their own obsolete job stale may bypass the generic-write rejection.
   */
  allowHistoricalTakeoverInspection?: boolean;
}

export function assertGenericContractDraftVersion(
  version: GenericContractDraftVersionGuardFacts
) {
  if (
    version.changeType !== "historical_takeover" &&
    version.hasHistoricalTakeoverRelation !== true
  ) {
    return;
  }
  throw new BadRequestException({
    statusCode: 400,
    code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
    message: "历史接管草稿必须在历史接管工作台办理",
    projectId: null,
    takeoverId: null
  });
}

const ENDED_STATUSES = new Set(["abandoned", "final_rejected"]);
const ENDED_LEDGER_STATUSES = new Set(["abandoned", "final_rejected", "voided"]);
const PERMANENT_FORMAL_STATUSES = new Set([
  "effective",
  "superseded",
  "voided"
]);

const CONTRACT_DRAFT_LIFECYCLE_STATUSES = new Set<ContractDraftLifecycleStatus>([
  "draft",
  "in_approval",
  "approval_rejected",
  "approved",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "sealed_pending_archive",
  "pending_archive_confirm",
  "effective",
  "superseded",
  "voided",
  "abandoned",
  "final_rejected",
  "deleting"
]);

export function parseContractDraftLifecycleStatus(
  status: string
): ContractDraftLifecycleStatus {
  if (CONTRACT_DRAFT_LIFECYCLE_STATUSES.has(status as ContractDraftLifecycleStatus)) {
    return status as ContractDraftLifecycleStatus;
  }
  throw new ConflictException({
    statusCode: 409,
    code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION",
    message: "合同生命周期状态未知，拒绝继续分类"
  });
}

const LIFECYCLE_CAPABILITIES: Record<
  ContractLifecycleStage,
  ContractLifecycleCapabilities
> = {
  unsubmitted_draft: {
    canView: true,
    canEdit: true,
    canSubmit: true,
    canAbandon: false,
    canPhysicallyDelete: true,
    canDownload: true,
    historyRetention: "none"
  },
  returned_editable: {
    canView: true,
    canEdit: true,
    canSubmit: true,
    canAbandon: true,
    canPhysicallyDelete: false,
    canDownload: true,
    historyRetention: "none"
  },
  ended_retained: {
    canView: true,
    canEdit: false,
    canSubmit: false,
    canAbandon: false,
    canPhysicallyDelete: false,
    canDownload: true,
    historyRetention: "three_calendar_months"
  },
  deleting: {
    canView: false,
    canEdit: false,
    canSubmit: false,
    canAbandon: false,
    canPhysicallyDelete: false,
    canDownload: false,
    historyRetention: "none"
  },
  protected_formal: {
    canView: true,
    canEdit: false,
    canSubmit: false,
    canAbandon: false,
    canPhysicallyDelete: false,
    canDownload: true,
    historyRetention: "active_process"
  }
};

type ContractDraftLifecycleClient = Pick<
  Prisma.TransactionClient,
  | "approvalInstance"
  | "approvalActionLog"
  | "contractFormalFile"
  | "contractAuthorization"
  | "contractVersionAuthorizationLink"
  | "contractSealTask"
  | "contractArchiveFile"
  | "settlement"
  | "paymentRequest"
>;

export async function loadContractDraftLifecycle(
  client: ContractDraftLifecycleClient,
  version: Pick<
    ContractDraftLifecycleFacts,
    "changeType" | "versionNo" | "firstSubmittedAt"
  > & { id: string; status: string }
) {
  const approvalInstances = await client.approvalInstance.findMany({
    where: {
      businessType: "contract_version",
      businessId: version.id
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const approvalActionCount = approvalInstances.length
    ? await client.approvalActionLog.count({
        where: {
          approvalInstanceId: {
            in: approvalInstances.map((item) => item.id)
          }
        }
      })
    : 0;
  const formalFiles = await client.contractFormalFile.findMany({
    where: { contractVersionId: version.id },
    orderBy: { createdAt: "asc" },
    select: { purpose: true, status: true }
  });
  const authorizationCount = await client.contractAuthorization.count({
    where: { originContractVersionId: version.id }
  });
  const authorizationLinkCount =
    await client.contractVersionAuthorizationLink.count({
      where: {
        contractVersionId: version.id,
        authorizationId: { not: null }
      }
    });
  const sealTasks = await client.contractSealTask.findMany({
    where: { contractVersionId: version.id },
    orderBy: { createdAt: "asc" },
    select: { status: true }
  });
  const archiveFileCount = await client.contractArchiveFile.count({
    where: { contractVersionId: version.id }
  });
  const settlementCount = await client.settlement.count({
    where: { contractVersionId: version.id }
  });
  const paymentRequestCount = await client.paymentRequest.count({
    where: { contractVersionId: version.id }
  });
  const facts: ContractDraftLifecycleFacts = {
    changeType: version.changeType,
    versionNo: version.versionNo,
    status: parseContractDraftLifecycleStatus(version.status),
    firstSubmittedAt: version.firstSubmittedAt,
    approvalInstanceCount: approvalInstances.length,
    approvalActionCount,
    formalFileCount: formalFiles.length,
    signedFormalFileCount: formalFiles.filter(
      (file) => file.purpose === "mutually_signed_final"
    ).length,
    activeSignedFormalFileCount: formalFiles.filter(
      (file) =>
        file.purpose === "mutually_signed_final" && file.status === "active"
    ).length,
    authorizationCount,
    authorizationLinkCount,
    sealTaskCount: sealTasks.length,
    activeSealTaskCount: sealTasks.filter(
      (task) => task.status !== "cancelled"
    ).length,
    archiveFileCount,
    settlementCount,
    paymentRequestCount
  };
  return {
    facts,
    approvalInstanceIds: approvalInstances.map((item) => item.id),
    ...classifyContractDraftLifecycle(facts)
  };
}

/**
 * Locks the parent contract before the exact version and evaluates the
 * irreversible business facts while both rows are held. Every generic draft
 * mutation must cross this boundary so a stale `draft` status cannot reopen a
 * version that has already reached signing, seal, archive or downstream use.
 */
export async function lockContractDraftMutationBoundary<
  TVersion extends { id: string; contractId: string } = {
    id: string;
    contractId: string;
  },
  TContract extends { id: string } = {
    id: string;
  }
>(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  contractVersionId: string,
  options: ContractDraftMutationBoundaryOptions = {}
): Promise<
  LockedContractDraftMutationBoundary<
    TVersion & GenericContractDraftVersionGuardFacts,
    TContract
  > | null
> {
  const [contractLock] = await client.$queryRaw<Array<TContract>>(Prisma.sql`
    SELECT c.*
    FROM "Contract" c
    INNER JOIN "ContractVersion" cv ON cv."contractId" = c."id"
    WHERE cv."id" = ${contractVersionId}
    FOR UPDATE OF c
  `);
  if (!contractLock) return null;

  const [versionLock] = await client.$queryRaw<Array<
    TVersion & GenericContractDraftVersionGuardFacts
  >>(Prisma.sql`
    SELECT
      cv.*,
      EXISTS (
        SELECT 1
        FROM "ContractTakeover" takeover
        WHERE takeover."contractVersionId" = cv."id"
      ) AS "hasHistoricalTakeoverRelation"
    FROM "ContractVersion" cv
    WHERE cv."id" = ${contractVersionId}
    FOR UPDATE OF cv
  `);
  if (!versionLock) return null;
  if (!options.allowHistoricalTakeoverInspection) {
    assertGenericContractDraftVersion(versionLock);
  }

  // This must be a separate statement after the version lock. Under
  // READ COMMITTED PostgreSQL gives it a fresh snapshot, so a transaction
  // that completed a formal record while we waited for the row lock cannot be
  // hidden by the pre-lock statement snapshot. Serializable callers keep their
  // original snapshot; supported formalization paths also update this locked
  // ContractVersion, so that race fails closed with a serialization conflict.
  const [formalFacts] = await client.$queryRaw<Array<{
    hasSignedFormalFile: boolean;
    hasActiveSealTask: boolean;
    hasArchiveFile: boolean;
    hasSettlement: boolean;
    hasPaymentRequest: boolean;
  }>>(Prisma.sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM "ContractFormalFile" f
        WHERE f."contractVersionId" = ${contractVersionId}
          AND f."purpose" = 'mutually_signed_final'
          AND f."status" = 'active'
      ) AS "hasSignedFormalFile",
      EXISTS (
        SELECT 1
        FROM "ContractSealTask" s
        WHERE s."contractVersionId" = ${contractVersionId}
          AND s."status" <> 'cancelled'
      ) AS "hasActiveSealTask",
      EXISTS (
        SELECT 1
        FROM "ContractArchiveFile" a
        WHERE a."contractVersionId" = ${contractVersionId}
      ) AS "hasArchiveFile",
      EXISTS (
        SELECT 1
        FROM "Settlement" st
        WHERE st."contractVersionId" = ${contractVersionId}
      ) AS "hasSettlement",
      EXISTS (
        SELECT 1
        FROM "PaymentRequest" p
        WHERE p."contractVersionId" = ${contractVersionId}
      ) AS "hasPaymentRequest"
  `);

  return {
    contractId:
      versionLock.contractId ??
      contractLock.id,
    contract: contractLock,
    version: versionLock,
    formalBlockers: [
      ...(formalFacts?.hasSignedFormalFile ? ["存在双方签署正式文件"] : []),
      ...(formalFacts?.hasActiveSealTask ? ["存在有效用印任务"] : []),
      ...(formalFacts?.hasArchiveFile ? ["存在归档记录"] : []),
      ...(formalFacts?.hasSettlement ? ["存在关联结算"] : []),
      ...(formalFacts?.hasPaymentRequest ? ["存在关联付款"] : [])
    ]
  };
}

export function classifyContractDraftLifecycle(
  facts: ContractDraftLifecycleFacts
): ContractDraftLifecycleClassification {
  const isHistoricalTakeover = facts.changeType === "historical_takeover";
  const isDerivedVersion = facts.changeType !== "original" || facts.versionNo !== 1;
  const hasApprovalFacts =
    Boolean(facts.firstSubmittedAt) ||
    facts.approvalInstanceCount > 0 ||
    facts.approvalActionCount > 0;
  const formalBlockers = [
    ...(facts.activeSignedFormalFileCount > 0 ? ["存在正式合同文件"] : []),
    ...(facts.activeSealTaskCount > 0 ? ["存在用印记录"] : []),
    ...(facts.archiveFileCount > 0 ? ["存在归档记录"] : []),
    ...(facts.settlementCount > 0 ? ["存在关联结算"] : []),
    ...(facts.paymentRequestCount > 0 ? ["存在关联付款"] : [])
  ];
  const hasFormalBusinessFacts = formalBlockers.length > 0;
  const contextBlockers = [
    ...(isHistoricalTakeover
      ? ["历史接管须使用专用关闭流程"]
      : isDerivedVersion
      ? ["合同变更或派生版本"]
      : []),
    ...(facts.status !== "draft" || Boolean(facts.firstSubmittedAt)
      ? ["合同曾进入审批"]
      : []),
    ...(facts.approvalInstanceCount > 0 || facts.approvalActionCount > 0
      ? ["存在审批记录"]
      : []),
    ...(facts.formalFileCount > 0 || facts.signedFormalFileCount > 0
      ? ["存在正式合同文件"]
      : []),
    ...(facts.authorizationCount > 0 || facts.authorizationLinkCount > 0
      ? ["存在授权委托书"]
      : []),
    ...(facts.sealTaskCount > 0 ? ["存在用印记录"] : [])
  ];

  if (
    (facts.status === "approval_rejected" || ENDED_STATUSES.has(facts.status)) &&
    !hasApprovalFacts
  ) {
    throw new ConflictException({
      statusCode: 409,
      code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION",
      message: "合同结束或退回状态缺少审批事实，拒绝继续分类"
    });
  }

  if (
    facts.status === "deleting" &&
    (hasApprovalFacts || hasFormalBusinessFacts || isDerivedVersion)
  ) {
    throw new ConflictException({
      statusCode: 409,
      code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION",
      message: "合同生命周期事实冲突，不能进入物理删除中状态"
    });
  }

  if (facts.status === "deleting") {
    return {
      contractLifecycleStage: "deleting",
      capabilities: { ...LIFECYCLE_CAPABILITIES.deleting },
      lifecycleKind: "pristine_draft",
      blockers: [],
      expectedAction: null
    };
  }

  if (isHistoricalTakeover) {
    return {
      contractLifecycleStage: "protected_formal",
      capabilities: { ...LIFECYCLE_CAPABILITIES.protected_formal },
      lifecycleKind: "formal_record",
      blockers: contextBlockers,
      expectedAction: null
    };
  }

  if (hasFormalBusinessFacts) {
    return {
      contractLifecycleStage: "protected_formal",
      capabilities: {
        ...LIFECYCLE_CAPABILITIES.protected_formal,
        historyRetention: "permanent"
      },
      lifecycleKind: "formal_record",
      blockers: formalBlockers,
      expectedAction: null
    };
  }

  if (ENDED_STATUSES.has(facts.status)) {
    return {
      contractLifecycleStage: "ended_retained",
      capabilities: { ...LIFECYCLE_CAPABILITIES.ended_retained },
      lifecycleKind: "approval_draft",
      blockers: contextBlockers,
      expectedAction: null
    };
  }

  const isReturnedEditable =
    facts.status === "approval_rejected" ||
    (facts.status === "draft" && (hasApprovalFacts || isDerivedVersion));
  if (isReturnedEditable) {
    return {
      contractLifecycleStage: "returned_editable",
      capabilities: { ...LIFECYCLE_CAPABILITIES.returned_editable },
      lifecycleKind: "approval_draft",
      blockers: contextBlockers,
      expectedAction: "abandon_application"
    };
  }

  if (facts.status === "draft" && !isDerivedVersion) {
    return {
      contractLifecycleStage: "unsubmitted_draft",
      capabilities: { ...LIFECYCLE_CAPABILITIES.unsubmitted_draft },
      lifecycleKind: "pristine_draft",
      blockers: [],
      expectedAction: "delete_pristine_draft"
    };
  }

  const permanentRetention = PERMANENT_FORMAL_STATUSES.has(facts.status);
  return {
    contractLifecycleStage: "protected_formal",
    capabilities: {
      ...LIFECYCLE_CAPABILITIES.protected_formal,
      historyRetention: permanentRetention ? "permanent" : "active_process"
    },
    lifecycleKind: "formal_record",
    blockers: contextBlockers,
    expectedAction: null
  };
}

export function projectContractDraftLifecycleViews<
  V extends { id: string; status: string; changeType?: string | null }
>(
  contract: { ownerUserId: string | null; voidedAt: Date | null },
  versions: V[],
  lifecycleByVersion: ReadonlyMap<string, ContractDraftLifecycleClassification>,
  actorUserId: string
) {
  const latest = versions[0];
  const latestVisible = versions.find(
    (candidate) => !["abandoned", "final_rejected", "deleting"].includes(candidate.status)
  );
  const latestFormal = versions.find((candidate) =>
    candidate.changeType !== "historical_takeover" &&
    candidate.status !== "voided" &&
    candidate.status !== "deleting" &&
    lifecycleByVersion.get(candidate.id)?.contractLifecycleStage ===
      "protected_formal"
  );
  const latestDraftLifecycle = latestVisible
    ? lifecycleByVersion.get(latestVisible.id)
    : undefined;
  const matches: Record<DraftLedgerView, boolean> = {
    formal_ledger: Boolean(
      latest && !contract.voidedAt && latest.status !== "voided" && latestFormal
    ),
    my_drafts: Boolean(
      latestVisible?.status === "draft" &&
      latestDraftLifecycle?.contractLifecycleStage === "unsubmitted_draft" &&
      contract.ownerUserId === actorUserId
    ),
    returned_for_revision: Boolean(
      latestVisible &&
      ["draft", "approval_rejected"].includes(latestVisible.status) &&
      latestDraftLifecycle?.contractLifecycleStage === "returned_editable" &&
      contract.ownerUserId === actorUserId
    ),
    ended: Boolean(
      latest && (contract.voidedAt || ENDED_LEDGER_STATUSES.has(latest.status))
    )
  };
  return {
    matches,
    versionByView: {
      formal_ledger: latestFormal,
      my_drafts: latestVisible,
      returned_for_revision: latestVisible,
      ended: latest && ENDED_LEDGER_STATUSES.has(latest.status)
        ? latest
        : latestVisible
    } satisfies Record<DraftLedgerView, V | undefined>
  };
}
