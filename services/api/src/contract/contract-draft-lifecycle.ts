import { Prisma } from "@prisma/client";

export type ContractDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

export interface ContractDraftLifecycleFacts {
  changeType: string;
  versionNo: number;
  status: string;
  firstSubmittedAt: Date | null;
  approvalInstanceCount: number;
  approvalActionCount: number;
  formalFileCount: number;
  signedFormalFileCount: number;
  authorizationCount: number;
  authorizationLinkCount: number;
  sealTaskCount: number;
  activeSealTaskCount: number;
  archiveFileCount: number;
  settlementCount: number;
  paymentRequestCount: number;
}

export interface ContractDraftLifecycleClassification {
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

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);

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
    "changeType" | "versionNo" | "status" | "firstSubmittedAt"
  > & { id: string }
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
    select: { purpose: true }
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
    status: version.status,
    firstSubmittedAt: version.firstSubmittedAt,
    approvalInstanceCount: approvalInstances.length,
    approvalActionCount,
    formalFileCount: formalFiles.length,
    signedFormalFileCount: formalFiles.filter(
      (file) => file.purpose === "mutually_signed_final"
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
  contractVersionId: string
): Promise<LockedContractDraftMutationBoundary<TVersion, TContract> | null> {
  const [contractLock] = await client.$queryRaw<Array<TContract>>(Prisma.sql`
    SELECT c.*
    FROM "Contract" c
    INNER JOIN "ContractVersion" cv ON cv."contractId" = c."id"
    WHERE cv."id" = ${contractVersionId}
    FOR UPDATE OF c
  `);
  if (!contractLock) return null;

  const [versionLock] = await client.$queryRaw<Array<TVersion>>(Prisma.sql`
    SELECT cv.*
    FROM "ContractVersion" cv
    WHERE cv."id" = ${contractVersionId}
    FOR UPDATE OF cv
  `);
  if (!versionLock) return null;

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
  const blockers = [
    ...(isHistoricalTakeover
      ? ["历史接管须使用专用关闭流程"]
      : facts.changeType !== "original" || facts.versionNo !== 1
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
    ...(facts.sealTaskCount > 0 || facts.activeSealTaskCount > 0
      ? ["存在用印记录"]
      : []),
    ...(facts.archiveFileCount > 0 ? ["存在归档记录"] : []),
    ...(facts.settlementCount > 0 ? ["存在关联结算"] : []),
    ...(facts.paymentRequestCount > 0 ? ["存在关联付款"] : [])
  ];
  const hasFormalBusinessFacts =
    facts.signedFormalFileCount > 0 ||
    facts.activeSealTaskCount > 0 ||
    facts.archiveFileCount > 0 ||
    facts.settlementCount > 0 ||
    facts.paymentRequestCount > 0;
  if (!EDITABLE_STATUSES.has(facts.status) || hasFormalBusinessFacts) {
    return {
      lifecycleKind: "formal_record",
      blockers,
      expectedAction: null
    };
  }
  if (isHistoricalTakeover) {
    return {
      lifecycleKind: "approval_draft",
      blockers,
      expectedAction: null
    };
  }
  return blockers.length === 0
    ? {
        lifecycleKind: "pristine_draft",
        blockers,
        expectedAction: "delete_pristine_draft"
      }
    : {
        lifecycleKind: "approval_draft",
        blockers,
        expectedAction: "abandon_application"
      };
}
