import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type {
  AppendOperatingFactInput,
  OperatingImpactInput,
  OperatingLedgerTransaction,
  OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";
import type { ContractTakeoverCorrectionScope } from "./dto/submit-contract-takeover-correction.dto";

const CORRECTION_SOURCE_AUTHORITY =
  "contract_takeover_append_only_correction";

export type StoredOperatingFact = Prisma.OperatingFactGetPayload<{
  include: { impacts: true };
}>;

export interface ContractTakeoverCorrectionProjection {
  id: string;
  originalFactId: string;
  correctionOperation: string | null;
  correctionScope: ContractTakeoverCorrectionScope;
  targetHistoricalPaymentId: string | null;
  beforeSnapshot: Prisma.JsonValue;
  deltaSnapshot: Prisma.JsonValue | null;
  applicationIdempotencyKey: string;
  appliedByUserId: string;
  appliedAt: Date;
}

export interface ContractTakeoverCorrectionSourceRow {
  id: string;
  takeoverId: string;
  correctionScope: string | null;
  correctionOperation: string | null;
  targetHistoricalPaymentId: string | null;
  beforeSnapshot: Prisma.JsonValue;
  deltaSnapshot: Prisma.JsonValue | null;
  applicationIdempotencyKey: string | null;
  appliedByUserId: string | null;
  appliedAt: Date | null;
}

type CorrectionSourceResolver = (
  tx: OperatingLedgerTransaction,
  row: ContractTakeoverCorrectionSourceRow
) => Promise<string | null>;

export function buildContractTakeoverOperatingCorrectionSnapshot(
  original: OperatingSourceSnapshot,
  projection: ContractTakeoverCorrectionProjection,
  entryKind: "correction" | "reversal"
): OperatingSourceSnapshot {
  return {
    projectId: original.projectId,
    sourceType: original.sourceType,
    sourceBusinessId: projection.id,
    sourceBusinessCode: `${original.sourceBusinessCode}/更正/${projection.id}`,
    sourceVersion: original.sourceVersion,
    status: "confirmed",
    sourceSnapshot: {
      authority: CORRECTION_SOURCE_AUTHORITY,
      correctionId: projection.id,
      correctionOperation: projection.correctionOperation,
      correctionScope: projection.correctionScope,
      entryKind,
      originalFactId: projection.originalFactId,
      originalSourceType: original.sourceType,
      originalSourceBusinessId: original.sourceBusinessId,
      targetHistoricalPaymentId: projection.targetHistoricalPaymentId,
      applicationIdempotencyKey: projection.applicationIdempotencyKey,
      appliedByUserId: projection.appliedByUserId,
      appliedAt: projection.appliedAt.toISOString(),
      beforeSnapshot: projection.beforeSnapshot,
      deltaSnapshot: projection.deltaSnapshot,
      originalSnapshot: original
    } as unknown as Prisma.InputJsonObject
  };
}

export async function readContractTakeoverCorrectionSnapshots(
  tx: OperatingLedgerTransaction,
  projectId: string,
  sourceType: string,
  scopes: readonly ContractTakeoverCorrectionScope[],
  resolveSourceBusinessId: CorrectionSourceResolver
): Promise<readonly OperatingSourceSnapshot[]> {
  const rows = await tx.contractTakeoverCorrection.findMany({
    where: {
      projectId,
      status: "applied",
      correctionScope: { in: [...scopes] },
      appliedAt: { not: null },
      appliedByUserId: { not: null }
    },
    orderBy: [{ appliedAt: "asc" }, { id: "asc" }]
  });
  const snapshots = await Promise.all(
    rows.map((row) =>
      correctionSnapshotFromRow(
        tx,
        projectId,
        sourceType,
        scopes,
        row,
        resolveSourceBusinessId
      )
    )
  );
  return snapshots.filter(
    (snapshot): snapshot is OperatingSourceSnapshot => snapshot !== null
  );
}

export async function readContractTakeoverCorrectionSnapshot(
  tx: OperatingLedgerTransaction,
  locator: { projectId: string; sourceType: string; sourceBusinessId: string },
  scopes: readonly ContractTakeoverCorrectionScope[],
  resolveSourceBusinessId: CorrectionSourceResolver
): Promise<OperatingSourceSnapshot | null> {
  const row = await tx.contractTakeoverCorrection.findUnique({
    where: { id: locator.sourceBusinessId }
  });
  if (
    !row ||
    row.projectId !== locator.projectId ||
    row.status !== "applied" ||
    !scopes.includes(row.correctionScope as ContractTakeoverCorrectionScope)
  ) {
    return null;
  }
  return correctionSnapshotFromRow(
    tx,
    locator.projectId,
    locator.sourceType,
    scopes,
    row,
    resolveSourceBusinessId
  );
}

async function correctionSnapshotFromRow(
  tx: OperatingLedgerTransaction,
  projectId: string,
  sourceType: string,
  scopes: readonly ContractTakeoverCorrectionScope[],
  row: ContractTakeoverCorrectionSourceRow,
  resolveSourceBusinessId: CorrectionSourceResolver
): Promise<OperatingSourceSnapshot | null> {
  const correctionScope = row.correctionScope as ContractTakeoverCorrectionScope;
  if (!scopes.includes(correctionScope)) return null;
  const sourceBusinessId = await resolveSourceBusinessId(tx, row);
  if (!sourceBusinessId) {
    throw new BadRequestException("历史更正缺少可追溯的原经营来源");
  }
  const original = await tx.operatingFact.findUnique({
    where: {
      sourceType_sourceBusinessId: { sourceType, sourceBusinessId }
    },
    select: {
      id: true,
      projectId: true,
      sourceType: true,
      sourceBusinessId: true,
      sourceVersion: true,
      sourceBusinessCode: true,
      sourceSnapshot: true,
      entryKind: true
    }
  });
  if (!original || original.projectId !== projectId || original.entryKind !== "original") {
    throw new BadRequestException("历史更正对应的原经营事实不存在");
  }
  if (!row.appliedAt || !row.appliedByUserId || !row.applicationIdempotencyKey) {
    throw new BadRequestException("历史更正缺少应用确认快照");
  }
  const originalSnapshot: OperatingSourceSnapshot = {
    projectId: original.projectId,
    sourceType: original.sourceType,
    sourceBusinessId: original.sourceBusinessId,
    sourceBusinessCode: original.sourceBusinessCode,
    sourceVersion: original.sourceVersion,
    status: "confirmed",
    sourceSnapshot: original.sourceSnapshot as Prisma.InputJsonObject
  };
  const projection: ContractTakeoverCorrectionProjection = {
    id: row.id,
    originalFactId: original.id,
    correctionOperation: row.correctionOperation,
    correctionScope,
    targetHistoricalPaymentId: row.targetHistoricalPaymentId,
    beforeSnapshot: row.beforeSnapshot,
    deltaSnapshot: row.deltaSnapshot,
    applicationIdempotencyKey: row.applicationIdempotencyKey,
    appliedByUserId: row.appliedByUserId,
    appliedAt: row.appliedAt
  };
  return buildContractTakeoverOperatingCorrectionSnapshot(
    originalSnapshot,
    projection,
    row.correctionOperation === "reversal" ? "reversal" : "correction"
  );
}

export function parseContractTakeoverOperatingCorrectionSnapshot(
  value: Prisma.InputJsonValue
): {
  originalSnapshot: OperatingSourceSnapshot;
  projection: Omit<ContractTakeoverCorrectionProjection, "appliedAt" | "appliedByUserId"> & {
    appliedAt: Date;
    appliedByUserId: string;
  };
  entryKind: "correction" | "reversal";
} | null {
  const source = asRecord(value, "历史更正经营来源");
  if (source.authority !== CORRECTION_SOURCE_AUTHORITY) return null;
  const original = asRecord(source.originalSnapshot, "历史更正原经营来源");
  const entryKind = source.entryKind;
  if (entryKind !== "correction" && entryKind !== "reversal") {
    throw new BadRequestException("历史更正经营来源登记类型不正确");
  }
  const correctionScope = source.correctionScope;
  if (
    correctionScope !== "historical_settlement" &&
    correctionScope !== "historical_payment" &&
    correctionScope !== "historical_advance" &&
    correctionScope !== "abnormal_overpay"
  ) {
    throw new BadRequestException("历史更正经营来源范围不正确");
  }
  const appliedAt = requiredDate(source, "appliedAt", "历史更正经营来源");
  const appliedByUserId = requiredText(
    source,
    "appliedByUserId",
    "历史更正经营来源"
  );
  if (source.beforeSnapshot === undefined) {
    throw new BadRequestException("历史更正经营来源缺少更正前快照");
  }
  return {
    originalSnapshot: original as unknown as OperatingSourceSnapshot,
    entryKind,
    projection: {
      id: requiredText(source, "correctionId", "历史更正经营来源"),
      originalFactId: requiredText(
        source,
        "originalFactId",
        "历史更正经营来源"
      ),
      correctionOperation:
        typeof source.correctionOperation === "string"
          ? source.correctionOperation
          : null,
      correctionScope,
      targetHistoricalPaymentId:
        typeof source.targetHistoricalPaymentId === "string"
          ? source.targetHistoricalPaymentId
          : null,
      beforeSnapshot: source.beforeSnapshot as Prisma.JsonValue,
      deltaSnapshot:
        source.deltaSnapshot === null || source.deltaSnapshot === undefined
          ? null
          : (source.deltaSnapshot as Prisma.JsonValue),
      applicationIdempotencyKey: requiredText(
        source,
        "applicationIdempotencyKey",
        "历史更正经营来源"
      ),
      appliedAt,
      appliedByUserId
    }
  };
}

export function operatingInputFromStoredFact(
  fact: StoredOperatingFact
): AppendOperatingFactInput {
  return {
    projectId: fact.projectId,
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    sourceBusinessCode: fact.sourceBusinessCode,
    sourceVersion: fact.sourceVersion,
    idempotencyKey: fact.idempotencyKey,
    occurredAt: fact.occurredAt,
    confirmedAt: fact.confirmedAt,
    confirmedByUserId: fact.confirmedByUserId,
    factKind: fact.factKind as AppendOperatingFactInput["factKind"],
    operatingLevel: fact.operatingLevel as AppendOperatingFactInput["operatingLevel"],
    evidenceLevel: fact.evidenceLevel as AppendOperatingFactInput["evidenceLevel"],
    amountCents: fact.amountCents,
    currencyCode: fact.currencyCode,
    direction: fact.direction as AppendOperatingFactInput["direction"],
    isBeforeOperatingLedgerEffectiveDate: fact.isBeforeOperatingLedgerEffectiveDate,
    affiliateAssignmentId: fact.affiliateAssignmentId,
    affiliateBusinessPartyVersionId: fact.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: fact.affiliateNameSnapshot,
    ...(fact.affiliateCreditCodeSnapshot
      ? { affiliateCreditCodeSnapshot: fact.affiliateCreditCodeSnapshot }
      : {}),
    ...(fact.historicalTakeoverBatchId
      ? { historicalTakeoverBatchId: fact.historicalTakeoverBatchId }
      : {}),
    sourceSnapshot: fact.sourceSnapshot as Prisma.InputJsonObject,
    ...(fact.basisSnapshot
      ? { basisSnapshot: fact.basisSnapshot as Prisma.InputJsonObject }
      : {}),
    subjects: {
      ...(fact.debtorSubjectKind && fact.debtorSubjectId
        ? {
            debtor: {
              kind: fact.debtorSubjectKind as OperatingSubjectReference["kind"],
              id: fact.debtorSubjectId
            }
          }
        : {}),
      ...(fact.creditorSubjectKind && fact.creditorSubjectId
        ? {
            creditor: {
              kind: fact.creditorSubjectKind as OperatingSubjectReference["kind"],
              id: fact.creditorSubjectId
            }
          }
        : {}),
      ...(fact.approvedPayerSubjectKind && fact.approvedPayerSubjectId
        ? {
            approvedPayer: {
              kind: fact.approvedPayerSubjectKind as OperatingSubjectReference["kind"],
              id: fact.approvedPayerSubjectId
            }
          }
        : {}),
      ...(fact.actualPayerSubjectKind && fact.actualPayerSubjectId
        ? {
            actualPayer: {
              kind: fact.actualPayerSubjectKind as OperatingSubjectReference["kind"],
              id: fact.actualPayerSubjectId
            }
          }
        : {}),
      ...(fact.payeeSubjectKind && fact.payeeSubjectId
        ? {
            payee: {
              kind: fact.payeeSubjectKind as OperatingSubjectReference["kind"],
              id: fact.payeeSubjectId
            }
          }
        : {}),
      ...(fact.costBearingCompanySubjectKind && fact.costBearingCompanySubjectId
        ? {
            costBearingCompany: {
              kind: fact.costBearingCompanySubjectKind as OperatingSubjectReference["kind"],
              id: fact.costBearingCompanySubjectId
            }
          }
        : {})
    },
    impacts: fact.impacts.map((impact) => ({
      idempotencyKey: impact.idempotencyKey,
      sourceImpactKey: impact.sourceImpactKey,
      impactKind: impact.impactKind as OperatingImpactInput["impactKind"],
      amountCents: impact.amountCents,
      direction: impact.direction as OperatingImpactInput["direction"],
      ...(impact.subjectRole && impact.subjectKind && impact.subjectId
        ? {
            subjectRole: impact.subjectRole as OperatingImpactInput["subjectRole"],
            subject: {
              kind: impact.subjectKind as OperatingSubjectReference["kind"],
              id: impact.subjectId
            }
          }
        : {}),
      ...(impact.costCategoryCode
        ? { costCategoryCode: impact.costCategoryCode as OperatingImpactInput["costCategoryCode"] }
        : {}),
      ...(impact.fundPurpose ? { fundPurpose: impact.fundPurpose } : {}),
      ...(impact.description ? { description: impact.description } : {}),
      impactSnapshot: impact.impactSnapshot as Prisma.InputJsonObject
    }))
  };
}

export function buildOperatingCorrectionInput(
  original: AppendOperatingFactInput,
  originalSnapshot: OperatingSourceSnapshot,
  projection: ContractTakeoverCorrectionProjection,
  entryKind: "correction" | "reversal"
): AppendOperatingFactInput & { adjustsFactId: string } {
  const delta = correctionDelta(projection.deltaSnapshot);
  const before = asRecord(projection.beforeSnapshot, "历史更正前快照");
  const allocationType =
    typeof before.allocationType === "string" ? before.allocationType : null;
  const reclassification =
    projection.correctionOperation === "reclassification"
      ? asRecord(projection.deltaSnapshot, "历史重分类差额")
      : null;
  const impacts = operatingCorrectionImpacts(
    original.impacts,
    projection.correctionScope,
    allocationType ?? projection.correctionScope,
    delta,
    reclassification,
    projection.id
  );
  if (!impacts.length) {
    throw new BadRequestException("历史更正没有可投影的经营影响");
  }
  return {
    projectId: original.projectId,
    sourceType: original.sourceType,
    sourceBusinessId: projection.id,
    sourceBusinessCode: `${original.sourceBusinessCode}/更正/${projection.id}`,
    sourceVersion: original.sourceVersion,
    idempotencyKey: `${projection.applicationIdempotencyKey}:operating:${entryKind}`,
    occurredAt: projection.appliedAt,
    confirmedAt: projection.appliedAt,
    confirmedByUserId: projection.appliedByUserId,
    factKind: original.factKind,
    operatingLevel: original.operatingLevel,
    evidenceLevel: original.evidenceLevel,
    amountCents: absBigInt(delta),
    currencyCode: original.currencyCode,
    direction: correctionDirection(original.direction, delta),
    isBeforeOperatingLedgerEffectiveDate:
      original.isBeforeOperatingLedgerEffectiveDate,
    affiliateAssignmentId: original.affiliateAssignmentId,
    affiliateBusinessPartyVersionId: original.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: original.affiliateNameSnapshot,
    ...(original.affiliateCreditCodeSnapshot
      ? { affiliateCreditCodeSnapshot: original.affiliateCreditCodeSnapshot }
      : {}),
    ...(original.historicalTakeoverBatchId
      ? { historicalTakeoverBatchId: original.historicalTakeoverBatchId }
      : {}),
    sourceSnapshot: buildContractTakeoverOperatingCorrectionSnapshot(
      originalSnapshot,
      projection,
      entryKind
    ).sourceSnapshot,
    basisSnapshot: {
      authority: "contract_takeover_correction_review",
      correctionId: projection.id
    },
    subjects: original.subjects,
    impacts,
    adjustsFactId: projection.originalFactId
  };
}

function operatingCorrectionImpacts(
  originalImpacts: readonly OperatingImpactInput[],
  scope: ContractTakeoverCorrectionScope,
  allocationType: string | null,
  delta: bigint,
  reclassification: Prisma.InputJsonObject | null,
  correctionId: string
): OperatingImpactInput[] {
  if (scope === "historical_settlement") {
    return originalImpacts
      .filter((impact) => impact.impactKind !== "invoice_reference")
      .map((impact) => signedImpact(impact, delta, correctionId));
  }

  const balance = originalImpacts.find((impact) =>
    allocationType === "settlement"
      ? impact.sourceImpactKey.startsWith("inter_subject_balance:")
      : impact.sourceImpactKey === allocationType
  );
  const payable = originalImpacts.find((impact) =>
    impact.sourceImpactKey.startsWith("payable:")
  );
  if (reclassification && balance) {
    const from = typeof reclassification.from === "string" ? reclassification.from : null;
    const to = typeof reclassification.to === "string" ? reclassification.to : null;
    if (!from || !to) throw new BadRequestException("历史重分类缺少来源或目标余额");
    const amountCents = jsonMoney(reclassification, "amountCents", "历史重分类差额");
    return [
      {
        ...signedImpact(
          { ...balance, impactKind: inverseImpactKind(balance.impactKind) as OperatingImpactInput["impactKind"] },
          amountCents,
          correctionId
        ),
        sourceImpactKey: `reclassification:${from}`
      },
      {
        ...signedImpact(balance, amountCents, correctionId),
        sourceImpactKey: `reclassification:${to}`,
        impactKind: balanceImpactKind(to, balance.impactKind)
      }
    ];
  }

  const impacts: OperatingImpactInput[] = [];
  if (allocationType === "settlement") {
    if (payable) impacts.push(signedImpact(payable, delta, correctionId));
    if (balance) impacts.push(signedImpact(balance, delta, correctionId));
  } else if (balance && allocationType) {
    impacts.push(signedImpact(balance, delta, correctionId));
  }
  return impacts;
}

function signedImpact(
  impact: OperatingImpactInput,
  delta: bigint,
  correctionId: string
): OperatingImpactInput {
  const positive = delta >= 0n;
  const amountCents = absBigInt(delta);
  return {
    ...impact,
    idempotencyKey: `correction:${correctionId}:${impact.sourceImpactKey}:${positive ? "increase" : "decrease"}`,
    sourceImpactKey: `correction:${impact.sourceImpactKey}`,
    impactKind: (positive ? impact.impactKind : inverseImpactKind(impact.impactKind)) as OperatingImpactInput["impactKind"],
    amountCents,
    direction: positive ? "increase" : "decrease",
    description: `历史更正：${impact.description ?? impact.sourceImpactKey}`,
    impactSnapshot: impact.impactSnapshot ?? {}
  };
}

function inverseImpactKind(kind: string): string {
  if (kind.endsWith("_increase")) return `${kind.slice(0, -9)}_decrease`;
  if (kind.endsWith("_decrease")) return `${kind.slice(0, -9)}_increase`;
  return kind;
}

function balanceImpactKind(balanceType: string, originalKind: string): OperatingImpactInput["impactKind"] {
  if (balanceType === "historical_advance") {
    return originalKind.includes("company_advance")
      ? "company_advance_for_project_increase"
      : "inter_subject_balance_increase";
  }
  return originalKind.includes("company_returnable")
    ? "company_returnable_to_project_increase"
    : "inter_subject_balance_increase";
}

function correctionDirection(
  direction: string,
  delta: bigint
): AppendOperatingFactInput["direction"] {
  if (delta >= 0n) return direction as AppendOperatingFactInput["direction"];
  if (direction === "outflow") return "inflow";
  if (direction === "inflow") return "outflow";
  return "neutral";
}

function correctionDelta(value: Prisma.JsonValue | null): bigint {
  return jsonMoney(value, "amountCents", "历史更正差额");
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function asRecord(value: unknown, label: string): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label}结构无效`);
  }
  return value as Prisma.InputJsonObject;
}

function requiredText(record: Prisma.InputJsonObject, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}缺少${key}`);
  }
  return value.trim();
}

function requiredDate(record: Prisma.InputJsonObject, key: string, label: string): Date {
  const value = requiredText(record, key, label);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}${key}日期格式不正确`);
  return date;
}

function jsonMoney(record: Prisma.JsonValue | Prisma.InputJsonObject, key: string, label: string): bigint {
  const object = asRecord(record, label);
  const raw = object[key];
  if (typeof raw !== "string" || !/^-?(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new BadRequestException(`${label}结构无效`);
  }
  return BigInt(raw);
}
