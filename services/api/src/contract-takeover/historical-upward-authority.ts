import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  readAffiliateSnapshot,
  type FrozenAffiliateSnapshot
} from "../operating-ledger/formal-operating-source.helpers";

type HistoricalUpwardAuthority = {
  affiliate: FrozenAffiliateSnapshot;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyName: string;
};

export function isHistoricalUpwardDraft(draftData: Prisma.JsonValue): draftData is Prisma.JsonObject {
  return Boolean(draftData && typeof draftData === "object" && !Array.isArray(draftData) &&
    draftData.historicalTakeover === true && draftData.relationship === "upward");
}

export function requireHistoricalUpwardAuthority(draftData: Prisma.JsonObject): HistoricalUpwardAuthority {
  const frozen = draftData.historicalUpwardAuthority;
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen) ||
      typeof frozen.companyEntityId !== "string" || !frozen.companyEntityId ||
      typeof frozen.companyEntityVersionId !== "string" || !frozen.companyEntityVersionId ||
      typeof frozen.companyName !== "string" || !frozen.companyName) {
    throw new BadRequestException("对上历史合同缺少已核实的我方签约主体");
  }
  const affiliate = frozen.affiliate;
  if (!affiliate || typeof affiliate !== "object" || Array.isArray(affiliate) ||
      typeof affiliate.assignmentId !== "string" || !affiliate.assignmentId ||
      typeof affiliate.businessPartyVersionId !== "string" || !affiliate.businessPartyVersionId ||
      typeof affiliate.name !== "string" || !affiliate.name) {
    throw new BadRequestException("对上历史合同缺少已核实的施工企业");
  }
  return {
    affiliate: { assignmentId: affiliate.assignmentId, businessPartyVersionId: affiliate.businessPartyVersionId,
      name: affiliate.name, ...(typeof affiliate.creditCode === "string" ? { creditCode: affiliate.creditCode } : {}) },
    companyEntityId: frozen.companyEntityId,
    companyEntityVersionId: frozen.companyEntityVersionId,
    companyName: frozen.companyName
  };
}

export async function freezeHistoricalUpwardAuthority(
  tx: Prisma.TransactionClient,
  input: { projectId: string; signedAt: Date; companyEntityId: string | null; counterparty: string }
): Promise<HistoricalUpwardAuthority> {
  if (!input.companyEntityId) throw new BadRequestException("请先确认对上历史合同的我方签约公司");
  const [affiliate, participants] = await Promise.all([
    readAffiliateSnapshot(tx, { projectId: input.projectId, occurredAt: input.signedAt }),
    tx.projectParticipatingCompany.findMany({
      where: { projectId: input.projectId, companyEntityId: input.companyEntityId,
        effectiveFrom: { lte: input.signedAt }, OR: [{ endedAt: null }, { endedAt: { gt: input.signedAt } }] },
      select: { companyEntityId: true, companyEntityVersionId: true, companyNameSnapshot: true },
      take: 2
    })
  ]);
  if (affiliate.name !== input.counterparty) {
    throw new BadRequestException("对上历史合同相对方与签订日的施工企业不一致");
  }
  if (participants.length !== 1) throw new BadRequestException("对上历史合同签订日缺少唯一的我方参与公司");
  const company = participants[0];
  return { affiliate, companyEntityId: company.companyEntityId,
    companyEntityVersionId: company.companyEntityVersionId, companyName: company.companyNameSnapshot };
}
