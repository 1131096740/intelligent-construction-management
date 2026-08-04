import { Prisma, type SettlementDraft } from "@prisma/client";

export type SettlementDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

export type SettlementDraftLifecycleKind =
  | "pristine_draft"
  | "approval_draft"
  | "formal_record";

export type SettlementDraftLifecycleSubject = Pick<
  SettlementDraft,
  | "id"
  | "projectId"
  | "contractId"
  | "contractVersionId"
  | "code"
  | "processId"
  | "status"
  | "submittedSettlementId"
  | "submittedAt"
  | "abandonReason"
>;

export interface SettlementDraftLifecycleFacts {
  historicalEvidenceCount: number;
  draftApprovalInstanceCount: number;
  formalSettlementIds: string[];
  processSettlementId: string | null;
  paymentRequestCount: number;
  formalApprovalInstanceCount: number;
}

export interface SettlementDraftLifecycleClassification {
  lifecycleKind: SettlementDraftLifecycleKind;
  expectedAction: SettlementDraftLifecycleAction | null;
  blockers: string[];
}

export interface SettlementDraftLifecycleSnapshot
  extends SettlementDraftLifecycleClassification {
  facts: SettlementDraftLifecycleFacts;
}

type SettlementDraftLifecycleClient = Pick<
  Prisma.TransactionClient,
  | "settlementDraft"
  | "contractSettlementProcess"
  | "settlementSignedDocument"
  | "settlement"
  | "paymentRequest"
  | "approvalInstance"
>;

type SettlementCoordinate = {
  id: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  code: string;
  processId: string | null;
};

const EVIDENCE_PURPOSES = [
  "frozen_counterparty_copy",
  "counterparty_signed_original"
] as const;

export function classifySettlementDraftLifecycle(
  draft: SettlementDraftLifecycleSubject,
  facts: SettlementDraftLifecycleFacts
): SettlementDraftLifecycleClassification {
  const blockers = [
    ...(draft.status === "submitted" ||
    Boolean(draft.submittedSettlementId) ||
    Boolean(draft.submittedAt)
      ? ["结算草稿已标记提交"]
      : []),
    ...(facts.formalSettlementIds.length > 0 ||
    Boolean(facts.processSettlementId)
      ? ["存在正式结算"]
      : []),
    ...(facts.paymentRequestCount > 0 ? ["存在关联付款申请"] : []),
    ...(facts.formalApprovalInstanceCount > 0
      ? ["存在正式结算审批"]
      : []),
    ...(facts.draftApprovalInstanceCount > 0 ? ["存在草稿审批记录"] : []),
    ...(facts.historicalEvidenceCount > 0
      ? ["存在冻结或签章文件"]
      : [])
  ];
  const hasFormalFacts =
    draft.status === "submitted" ||
    Boolean(draft.submittedSettlementId) ||
    Boolean(draft.submittedAt) ||
    facts.formalSettlementIds.length > 0 ||
    Boolean(facts.processSettlementId) ||
    facts.paymentRequestCount > 0 ||
    facts.formalApprovalInstanceCount > 0;

  if (hasFormalFacts || !new Set(["draft", "abandoned"]).has(draft.status)) {
    return {
      lifecycleKind: "formal_record",
      expectedAction: null,
      blockers
    };
  }

  const hasApplicationEvidence =
    facts.historicalEvidenceCount > 0 ||
    facts.draftApprovalInstanceCount > 0 ||
    Boolean(draft.abandonReason);

  if (draft.status === "abandoned") {
    return {
      lifecycleKind: hasApplicationEvidence
        ? "approval_draft"
        : "pristine_draft",
      expectedAction: null,
      blockers
    };
  }

  return hasApplicationEvidence
    ? {
        lifecycleKind: "approval_draft",
        expectedAction: "abandon_application",
        blockers
      }
    : {
        lifecycleKind: "pristine_draft",
        expectedAction: "delete_pristine_draft",
        blockers
      };
}

export async function loadSettlementDraftLifecycle(
  client: SettlementDraftLifecycleClient,
  draft: SettlementDraftLifecycleSubject,
  options: { includeFormalDownstreamFacts?: boolean } = {}
): Promise<SettlementDraftLifecycleSnapshot> {
  const snapshots = await loadSettlementDraftLifecycles(
    client,
    [draft],
    options
  );
  return snapshots.get(draft.id)!;
}

export async function loadSettlementDraftLifecycles(
  client: SettlementDraftLifecycleClient,
  drafts: SettlementDraftLifecycleSubject[],
  options: { includeFormalDownstreamFacts?: boolean } = {}
): Promise<Map<string, SettlementDraftLifecycleSnapshot>> {
  if (!drafts.length) return new Map();

  const draftIds = drafts.map((draft) => draft.id);
  const declaredProcessIds = uniqueStrings(
    drafts.flatMap((draft) => (draft.processId ? [draft.processId] : []))
  );
  const [documents, processes] = await Promise.all([
    client.settlementSignedDocument.findMany({
      where: {
        settlementDraftId: { in: draftIds },
        purpose: { in: [...EVIDENCE_PURPOSES] }
      },
      select: {
        settlementDraftId: true,
        purpose: true,
        status: true
      }
    }),
    client.contractSettlementProcess.findMany({
      where: {
        OR: [
          { settlementDraftId: { in: draftIds } },
          ...(declaredProcessIds.length
            ? [{ id: { in: declaredProcessIds } }]
            : [])
        ]
      },
      select: { id: true, settlementDraftId: true, settlementId: true }
    })
  ]);
  const processSettlementIdByProcessId = new Map(
    processes.map((process) => [process.id, process.settlementId])
  );
  const processSettlementIdByDraftId = new Map(
    processes.flatMap((process) =>
      process.settlementDraftId
        ? [[process.settlementDraftId, process.settlementId] as const]
        : []
    )
  );
  const processIds = uniqueStrings([
    ...declaredProcessIds,
    ...processes.map((process) => process.id)
  ]);
  const knownSettlementIds = uniqueStrings([
    ...drafts.flatMap((draft) =>
      draft.submittedSettlementId ? [draft.submittedSettlementId] : []
    ),
    ...processes.flatMap((process) =>
      process.settlementId ? [process.settlementId] : []
    )
  ]);
  const settlementOr: Prisma.SettlementWhereInput[] = [
    ...(knownSettlementIds.length ? [{ id: { in: knownSettlementIds } }] : []),
    ...(processIds.length ? [{ processId: { in: processIds } }] : [])
  ];
  const settlements = settlementOr.length
    ? await client.settlement.findMany({
        where: { OR: settlementOr },
        select: {
          id: true,
          projectId: true,
          contractId: true,
          contractVersionId: true,
          code: true,
          processId: true
        }
      })
    : [];
  const settlementIds = uniqueStrings([
    ...knownSettlementIds,
    ...settlements.map((settlement) => settlement.id)
  ]);
  const [
    paymentRequests,
    draftApprovalInstances,
    formalApprovalInstances
  ] = await Promise.all([
    options.includeFormalDownstreamFacts !== false && settlementIds.length
      ? client.paymentRequest.findMany({
          where: { settlementId: { in: settlementIds } },
          select: { id: true, settlementId: true }
        })
      : Promise.resolve([]),
    client.approvalInstance.findMany({
      where: {
        businessType: "settlement_draft",
        businessId: { in: draftIds }
      },
      select: { id: true, businessType: true, businessId: true }
    }),
    options.includeFormalDownstreamFacts !== false && settlementIds.length
      ? client.approvalInstance.findMany({
          where: {
            businessType: "settlement",
            businessId: { in: settlementIds }
          },
          select: { id: true, businessType: true, businessId: true }
        })
      : Promise.resolve([])
  ]);

  return new Map(drafts.map((draft) => {
    const processSettlementId =
      processSettlementIdByDraftId.get(draft.id) ??
      (
        draft.processId
          ? processSettlementIdByProcessId.get(draft.processId) ?? null
          : null
      );
    const formalSettlements = settlements.filter((settlement) =>
      settlementMatchesDraft(settlement, draft, processSettlementId)
    );
    const formalSettlementIds = uniqueStrings([
      ...formalSettlements.map((settlement) => settlement.id),
      ...(draft.submittedSettlementId ? [draft.submittedSettlementId] : []),
      ...(processSettlementId ? [processSettlementId] : [])
    ]);
    const formalSettlementIdSet = new Set(formalSettlementIds);
    const facts: SettlementDraftLifecycleFacts = {
      historicalEvidenceCount: documents.filter(
        (document) => document.settlementDraftId === draft.id
      ).length,
      draftApprovalInstanceCount: draftApprovalInstances.filter(
        (instance) =>
          instance.businessId === draft.id &&
          instance.businessType === "settlement_draft"
      ).length,
      formalSettlementIds,
      processSettlementId,
      paymentRequestCount: paymentRequests.filter(
        (request) =>
          request.settlementId !== null &&
          formalSettlementIdSet.has(request.settlementId)
      ).length,
      formalApprovalInstanceCount: formalApprovalInstances.filter(
        (instance) =>
          instance.businessType === "settlement" &&
          formalSettlementIdSet.has(instance.businessId)
      ).length
    };
    return [
      draft.id,
      {
        facts,
        ...classifySettlementDraftLifecycle(draft, facts)
      }
    ];
  }));
}

export async function lockSettlementDraftMutationBoundary(
  client: SettlementDraftLifecycleClient &
    Pick<Prisma.TransactionClient, "$queryRaw">,
  draftId: string
): Promise<{
  draft: SettlementDraft;
  lifecycle: SettlementDraftLifecycleSnapshot;
} | null> {
  const [locked] = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "SettlementDraft"
    WHERE "id" = ${draftId}
    FOR UPDATE
  `);
  if (!locked) return null;

  const draft = await client.settlementDraft.findUnique({
    where: { id: draftId }
  });
  if (!draft) return null;

  return {
    draft,
    lifecycle: await loadSettlementDraftLifecycle(client, draft, {
      includeFormalDownstreamFacts: false
    })
  };
}

export function isSettlementDraftSerializationConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown } | null;
  };
  return (
    candidate.code === "P2034" ||
    candidate.code === "40001" ||
    candidate.code === "40P01" ||
    candidate.meta?.code === "40001" ||
    candidate.meta?.code === "40P01"
  );
}

function settlementMatchesDraft(
  settlement: SettlementCoordinate,
  draft: SettlementDraftLifecycleSubject,
  processSettlementId: string | null
) {
  return (
    settlement.id === draft.submittedSettlementId ||
    settlement.id === processSettlementId ||
    (Boolean(draft.processId) && settlement.processId === draft.processId)
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
