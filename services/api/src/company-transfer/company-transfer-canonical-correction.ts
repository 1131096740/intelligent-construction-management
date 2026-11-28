import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import type { OperatingSourceAdapter, OperatingSourceFactInput, OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";

export const COMPANY_TRANSFER_DEBT_CORRECTION_SOURCE = "company_transfer_debt_correction";

interface CorrectionPosting {
  sourceBusinessId: string;
  incomingEventId: string;
  anchorFactId: string;
  projectId: string;
  actorId: string;
  occurredAt: Date;
  confirmedAt: Date;
  amountCents: bigint;
  effectDirection: "increase" | "decrease";
  debtorId: string;
  creditorId: string;
  originalSource: string;
  targetOriginalSource: string;
}

async function readPostingSnapshots(tx: Prisma.TransactionClient, id: string) {
  const postings = await tx.$queryRaw<CorrectionPosting[]>`
    SELECT * FROM public.jg_company_transfer_canonical_correction_plan(${id})
    ORDER BY "sourceBusinessId"
  `;
  return Promise.all(postings.map(async (posting): Promise<OperatingSourceSnapshot> => {
    const anchor = await tx.operatingFact.findUniqueOrThrow({ where: { id: posting.anchorFactId } });
    return {
      projectId: posting.projectId, sourceType: COMPANY_TRANSFER_DEBT_CORRECTION_SOURCE,
      sourceBusinessId: posting.sourceBusinessId, sourceBusinessCode: "公司代付款归还原债更正", sourceVersion: 1, status: "confirmed",
      sourceSnapshot: { correctionId: id, originalIncomingEventId: posting.incomingEventId,
        originalSource: posting.originalSource, targetOriginalSource: posting.targetOriginalSource, contractRelationship: "non_contract",
        anchorFactId: anchor.id, affiliateAssignmentId: anchor.affiliateAssignmentId,
        affiliateBusinessPartyVersionId: anchor.affiliateBusinessPartyVersionId, affiliateNameSnapshot: anchor.affiliateNameSnapshot,
        affiliateCreditCodeSnapshot: anchor.affiliateCreditCodeSnapshot, operatingLedgerEffectiveDate: anchor.operatingLedgerEffectiveDateSnapshot.toISOString(),
        actorId: posting.actorId, occurredAt: posting.occurredAt.toISOString(), confirmedAt: posting.confirmedAt.toISOString(),
        amountCents: posting.amountCents.toString(), effectDirection: posting.effectDirection, debtorId: posting.debtorId, creditorId: posting.creditorId,
      },
    };
  }));
}

export class CompanyTransferCanonicalCorrectionSource implements OperatingSourceAdapter {
  readonly sourceType = COMPANY_TRANSFER_DEBT_CORRECTION_SOURCE;

  async readProjectSnapshots(tx: Prisma.TransactionClient, projectId: string) {
    const [capability] = await tx.$queryRaw<Array<{ available: boolean }>>`
      SELECT to_regprocedure('public.jg_company_transfer_canonical_correction_plan(text)') IS NOT NULL AS available
    `;
    if (!capability.available) return [];
    const corrections = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT correction.id FROM public."CompanyTransferOriginalDebtCorrection" correction
      JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId"
      JOIN public."CompanyTransfer" transfer ON transfer.id = outgoing."transferId"
      WHERE transfer."sourceProjectId" = ${projectId} AND correction.status = 'confirmed'
        AND (correction."originalSource" LIKE 'proxy:%') <> (correction."targetOriginalSource" LIKE 'proxy:%')
      ORDER BY correction.id
    `;
    return (await Promise.all(corrections.map(row => readPostingSnapshots(tx, row.id)))).flat();
  }

  async readSourceSnapshot(tx: Prisma.TransactionClient, locator: { projectId: string; sourceBusinessId: string }) {
    const snapshots = await readPostingSnapshots(tx, locator.sourceBusinessId.split(":")[0]);
    return snapshots.find(snapshot => snapshot.projectId === locator.projectId && snapshot.sourceBusinessId === locator.sourceBusinessId) ?? null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const detail = snapshot.sourceSnapshot as {
      anchorFactId: string; affiliateAssignmentId: string; affiliateBusinessPartyVersionId: string; affiliateNameSnapshot: string;
      affiliateCreditCodeSnapshot: string | null; operatingLedgerEffectiveDate: string; actorId: string; occurredAt: string;
      confirmedAt: string; amountCents: string; effectDirection: "increase" | "decrease"; debtorId: string; creditorId: string;
    };
    const sourceKey = `${this.sourceType}:${snapshot.sourceBusinessId}`;
    const occurredAt = new Date(detail.occurredAt), amountCents = BigInt(detail.amountCents);
    return { entryKind: "correction", input: {
      projectId: snapshot.projectId, sourceType: snapshot.sourceType, sourceBusinessId: snapshot.sourceBusinessId,
      sourceBusinessCode: snapshot.sourceBusinessCode, sourceVersion: snapshot.sourceVersion, idempotencyKey: sourceKey,
      occurredAt, confirmedAt: new Date(detail.confirmedAt), confirmedByUserId: detail.actorId,
      factKind: "company_transfer", operatingLevel: "participating_company", evidenceLevel: "A",
      amountCents, currencyCode: "CNY", direction: "neutral",
      isBeforeOperatingLedgerEffectiveDate: occurredAt < new Date(detail.operatingLedgerEffectiveDate),
      affiliateAssignmentId: detail.affiliateAssignmentId, affiliateBusinessPartyVersionId: detail.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: detail.affiliateNameSnapshot, affiliateCreditCodeSnapshot: detail.affiliateCreditCodeSnapshot ?? undefined,
      adjustsFactId: detail.anchorFactId,
      subjects: { debtor: { kind: "participating_company", id: detail.debtorId },
        actualPayer: { kind: "participating_company", id: detail.creditorId } },
      sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: { authority: "reviewed_company_transfer_debt_correction", originalOperatingFactId: detail.anchorFactId },
      impacts: [{ idempotencyKey: `${sourceKey}:relationship`, sourceImpactKey: "relationship",
        impactKind: `inter_subject_balance_${detail.effectDirection}`, amountCents, direction: detail.effectDirection,
        subjectRole: "actual_payer", subject: { kind: "participating_company", id: detail.creditorId },
        description: detail.effectDirection === "increase" ? "恢复错核销的原代付债务" : "按正确原债核销已到账归还",
        impactSnapshot: { internalTransfer: true },
      }],
    } };
  }
}

export async function appendCompanyTransferCanonicalCorrection(
  tx: Prisma.TransactionClient, ledger: OperatingLedgerService, correction: {
    id: string; originalSource: string; targetOriginalSource: string;
  }, actor: string,
) {
  if (correction.originalSource.startsWith("proxy:") === correction.targetOriginalSource.startsWith("proxy:")) return;
  const postings = await readPostingSnapshots(tx, correction.id);
  if (!postings.length) throw new ConflictException({
    code: "COMPANY_TRANSFER_CORRECTION_REJECTED", message: "原经营账核销依据不完整，不能更正",
  });
  const source = new CompanyTransferCanonicalCorrectionSource();
  for (const posting of postings) {
    const { input } = source.toOperatingFactInput(posting);
    await ledger.appendConfirmedSourceInTransaction(tx, input, actor, "correction");
  }
  await tx.$executeRaw`SET CONSTRAINTS public."CompanyTransferOriginalDebtCorrection_canonical_complete" IMMEDIATE`;
}
