import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type AppendOperatingFactInput,
  type OperatingFactEntryKind,
  type OperatingFactSubjects,
  type OperatingImpactInput,
  type OperatingLedgerTransaction
} from "../operating-ledger/operating-ledger.service";
import {
  mapOperatingSourceSnapshot,
  type OperatingSourceAdapter,
  type OperatingSourceFactInput,
  type OperatingSourceLocator,
  type OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const OPERATING_TAKEOVER_SOURCE_TYPE = "operating_takeover";

export class OperatingTakeoverSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = OPERATING_TAKEOVER_SOURCE_TYPE;

  async readProjectSnapshots(tx: OperatingLedgerTransaction, projectId: string): Promise<readonly OperatingSourceSnapshot[]> {
    const facts = await tx.operatingFact.findMany({
      where: { projectId, sourceType: this.sourceType, status: "confirmed" },
      select: { projectId: true, sourceType: true, sourceBusinessId: true, sourceBusinessCode: true, sourceVersion: true, sourceSnapshot: true }
    });
    return facts.map((fact) => ({ ...fact, status: "confirmed" as const, sourceSnapshot: fact.sourceSnapshot as Prisma.InputJsonObject }));
  }

  async readSourceSnapshot(tx: OperatingLedgerTransaction, locator: OperatingSourceLocator): Promise<OperatingSourceSnapshot | null> {
    const fact = await tx.operatingFact.findFirst({
      where: { projectId: locator.projectId, sourceType: this.sourceType, sourceBusinessId: locator.sourceBusinessId, status: "confirmed" },
      select: { projectId: true, sourceType: true, sourceBusinessId: true, sourceBusinessCode: true, sourceVersion: true, sourceSnapshot: true }
    });
    return fact ? { ...fact, status: "confirmed", sourceSnapshot: fact.sourceSnapshot as Prisma.InputJsonObject } : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const fact = object(snapshot.sourceSnapshot.fact);
    const rawEntryKind = fact.entryKind === undefined || fact.entryKind === null ? "original" : String(fact.entryKind);
    if (!OPERATING_FACT_ENTRY_KINDS.has(rawEntryKind as OperatingFactEntryKind)) {
      throw new BadRequestException("历史接管来源快照登记类型不正确");
    }
    const entryKind = rawEntryKind as OperatingFactEntryKind;
    const adjustsFactId = fact.adjustsFactId === undefined || fact.adjustsFactId === null ? undefined : String(fact.adjustsFactId);
    if (entryKind !== "original" && !adjustsFactId) {
      throw new BadRequestException("历史接管来源更正或冲销必须引用原经营事实");
    }
    const subjects = object(fact.subjects) as unknown as OperatingFactSubjects;
    const impacts = Array.isArray(fact.impacts)
      ? fact.impacts.map((impact) => ({
          ...object(impact),
          amountCents: BigInt(String(object(impact).amountCents))
        })) as unknown as OperatingImpactInput[]
      : [];
    const input: AppendOperatingFactInput = {
      projectId: snapshot.projectId,
      sourceType: snapshot.sourceType,
      sourceBusinessId: snapshot.sourceBusinessId,
      sourceBusinessCode: snapshot.sourceBusinessCode,
      sourceVersion: snapshot.sourceVersion,
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:${snapshot.sourceVersion}`,
      occurredAt: new Date(String(fact.occurredAt)),
      confirmedAt: new Date(String(fact.confirmedAt)),
      confirmedByUserId: String(fact.confirmedByUserId),
      factKind: fact.factKind as AppendOperatingFactInput["factKind"],
      operatingLevel: fact.operatingLevel as AppendOperatingFactInput["operatingLevel"],
      evidenceLevel: fact.evidenceLevel as AppendOperatingFactInput["evidenceLevel"],
      amountCents: BigInt(String(fact.amountCents)),
      currencyCode: String(fact.currencyCode),
      direction: fact.direction as AppendOperatingFactInput["direction"],
      isBeforeOperatingLedgerEffectiveDate: Boolean(fact.isBeforeOperatingLedgerEffectiveDate),
      affiliateAssignmentId: String(fact.affiliateAssignmentId),
      affiliateBusinessPartyVersionId: String(fact.affiliateBusinessPartyVersionId),
      affiliateNameSnapshot: String(fact.affiliateNameSnapshot),
      affiliateCreditCodeSnapshot: fact.affiliateCreditCodeSnapshot ? String(fact.affiliateCreditCodeSnapshot) : undefined,
      historicalTakeoverBatchId: fact.historicalTakeoverBatchId ? String(fact.historicalTakeoverBatchId) : undefined,
      sourceSnapshot: snapshot.sourceSnapshot,
      subjects,
      impacts,
      ...(adjustsFactId ? { adjustsFactId } : {})
    };
    if (!input.sourceBusinessCode || !input.confirmedByUserId || Number.isNaN(input.occurredAt.getTime())) {
      throw new BadRequestException("历史接管来源快照不完整，不能重放");
    }
    return { entryKind, input };
  }
}

const OPERATING_FACT_ENTRY_KINDS: ReadonlySet<OperatingFactEntryKind> = new Set<OperatingFactEntryKind>([
  "original",
  "correction",
  "reversal"
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("历史接管来源快照结构不正确");
  return value as Record<string, unknown>;
}

export function assertOperatingTakeoverSourceSnapshot(snapshot: OperatingSourceSnapshot, locator: OperatingSourceLocator) {
  return mapOperatingSourceSnapshot(new OperatingTakeoverSourceAdapter(), snapshot, locator);
}
