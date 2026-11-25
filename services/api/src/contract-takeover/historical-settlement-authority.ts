import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { readAffiliateSnapshot } from "../operating-ledger/formal-operating-source.helpers";

type HistoricalDownstreamRelationship = "inside" | "outside";

export function historicalDownstreamRelationship(draftData: Prisma.JsonValue): HistoricalDownstreamRelationship | null {
  if (!draftData || typeof draftData !== "object" || Array.isArray(draftData) || draftData.historicalTakeover !== true) return null;
  const { relationship } = draftData;
  return relationship === "inside" || relationship === "outside" ? relationship : null;
}

export function historicalSettlementPartySelections(snapshot: Prisma.JsonValue | undefined) {
  const facts = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
  return {
    counterparty: typeof facts.counterparty === "string" ? facts.counterparty : null,
    counterpartyVersionId: typeof facts.counterpartyVersionId === "string" ? facts.counterpartyVersionId : null,
    signingPartyVersionId: typeof facts.signingPartyVersionId === "string" ? facts.signingPartyVersionId : null
  };
}

export async function freezeHistoricalDownstreamSettlementAuthority(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    signedAt: Date;
    relationship: HistoricalDownstreamRelationship;
    companyEntityId: string | null;
    counterparty: string;
    counterpartyVersionId: string | null;
    signingPartyVersionId: string | null;
  }
) {
  const { relationship, counterpartyVersionId, signingPartyVersionId, companyEntityId } = input;
  const unresolved = { status: "unresolved", relationship } as const;
  if (!counterpartyVersionId || (relationship === "outside" && !signingPartyVersionId)) {
    return unresolved;
  }

  const counterparty = await tx.businessPartyVersion.findUnique({
    where: { id: counterpartyVersionId }, select: { businessPartyId: true, snapshot: true }
  });
  const snapshot = counterparty?.snapshot;
  if (!counterparty || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.name !== input.counterparty) {
    throw new BadRequestException("相对方版本与原合同相对方不一致");
  }
  const affiliate = await readAffiliateSnapshot(tx, {
    projectId: input.projectId, occurredAt: input.signedAt
  });
  const source = {
    status: "verified" as const,
    relationship,
    counterpartyKind: "downstream_counterparty" as const,
    counterparty: input.counterparty,
    counterpartyVersionId,
    affiliateAssignmentId: affiliate.assignmentId,
    affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId
  };

  if (relationship === "outside") {
    if (signingPartyVersionId !== affiliate.businessPartyVersionId) {
      throw new BadRequestException("原签约施工企业与合同签订日的施工企业版本不一致");
    }
    const signingParty = await tx.businessPartyVersion.findUnique({
      where: { id: signingPartyVersionId }, select: { businessPartyId: true }
    });
    if (!signingParty || signingParty.businessPartyId === counterparty.businessPartyId) {
      throw new BadRequestException("请核对原签约施工企业和表外合同相对方");
    }
    return {
      ...source, signingParty: affiliate.name,
      payerKind: "construction_enterprise", payerVersionId: signingPartyVersionId,
      companyEntityId: null
    };
  }

  if (!companyEntityId) return unresolved;
  const participants = await tx.projectParticipatingCompany.findMany({
    where: {
      projectId: input.projectId, companyEntityId, effectiveFrom: { lte: input.signedAt },
      OR: [{ endedAt: null }, { endedAt: { gt: input.signedAt } }]
    },
    select: { companyEntityVersionId: true, companyNameSnapshot: true }, take: 2
  });
  if (participants.length !== 1) return unresolved;
  return {
    ...source, signingParty: participants[0].companyNameSnapshot,
    payerKind: "participating_company", payerVersionId: participants[0].companyEntityVersionId,
    companyEntityId
  };
}
