import { createHash } from "node:crypto";

export const AFFILIATE_ASSIGNED_WAGE_SOURCE_DISCRIMINATOR = "construction_enterprise_assigned_wage" as const;
export const AFFILIATE_GUARANTEE_SOURCE_DISCRIMINATOR = "construction_enterprise_guarantee" as const;
export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export type AuthorityCoverageKind = "PERSON" | "ROLE_SUMMARY";

export type AffiliateDeductionSourceRow = Readonly<{
  id: string;
  projectId: string;
  factType: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  occurredAt: Date;
  amountCents: bigint;
  counterpartyName: string;
  basisType: string;
  deductionCategory: string | null;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
}>;

export type ResolvedAffiliateDeductionSource = Readonly<{
  sourceType: "project_upstream_fund_fact";
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
  normalizedRowHash: string;
  sourceCoordinate: string;
  sourceSnapshot: Record<string, string | null>;
}>;

export function resolveAffiliateDeductionSource(
  row: AffiliateDeductionSourceRow
): ResolvedAffiliateDeductionSource {
  const sourceSnapshot = {
    sourceType: "project_upstream_fund_fact",
    sourceBusinessId: row.id,
    sourceVersion: String(row.documentVersion),
    projectId: row.projectId,
    factType: row.factType,
    entryKind: row.entryKind,
    adjustsFactId: row.adjustsFactId,
    effectDirection: row.effectDirection,
    occurredAt: row.occurredAt.toISOString(),
    amountCents: row.amountCents.toString(),
    counterpartyName: row.counterpartyName,
    basisType: row.basisType,
    deductionCategory: row.deductionCategory,
    affiliateAssignmentId: row.affiliateAssignmentId,
    affiliateBusinessPartyVersionId: row.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: row.affiliateNameSnapshot,
    description: row.description,
    evidenceFileId: row.evidenceFileId,
    documentVersion: String(row.documentVersion),
    fileContentSha256Snapshot: row.fileContentSha256Snapshot,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt?.toISOString() ?? null
  };
  const sourceFingerprint = buildAuthorityFingerprint(sourceSnapshot);
  return {
    sourceType: "project_upstream_fund_fact",
    sourceBusinessId: row.id,
    sourceVersion: row.documentVersion,
    sourceFingerprint,
    normalizedRowHash: buildAuthorityFingerprint({
      projectId: row.projectId,
      sourceBusinessId: row.id,
      sourceVersion: row.documentVersion,
      occurredAt: row.occurredAt.toISOString(),
      amountCents: row.amountCents.toString(),
      deductionCategory: row.deductionCategory,
      affiliateAssignmentId: row.affiliateAssignmentId,
      evidenceFileId: row.evidenceFileId,
      fileContentSha256Snapshot: row.fileContentSha256Snapshot
    }),
    sourceCoordinate: `ProjectUpstreamFundFact/${row.id}/v${row.documentVersion}`,
    sourceSnapshot
  };
}

export function normalizeWageMonth(value: string): Date {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("工资月份必须是 YYYY-MM");
  const month = Number(value.slice(5));
  if (month < 1 || month > 12) throw new Error("工资月份不是有效月份");
  return new Date(`${value}-01T00:00:00.000Z`);
}

export function assertAuthorityCoverage(input: {
  coverageKind: AuthorityCoverageKind;
  personAuthorityKey: string | null | undefined;
  roleCategoryKey: string | null | undefined;
}): { coverageKind: AuthorityCoverageKind; coverageKey: string } {
  if (input.coverageKind === "PERSON") {
    if (!input.personAuthorityKey?.trim()) throw new Error("人员覆盖必须绑定服务端稳定人员身份");
    if (input.roleCategoryKey) throw new Error("人员覆盖不得带岗位汇总");
    return { coverageKind: input.coverageKind, coverageKey: `person:${input.personAuthorityKey.trim()}` };
  }
  if (input.coverageKind !== "ROLE_SUMMARY") throw new Error("覆盖类型必须是 PERSON 或 ROLE_SUMMARY");
  if (input.personAuthorityKey) throw new Error("岗位汇总不得带人员身份");
  if (!input.roleCategoryKey?.trim()) throw new Error("岗位汇总必须绑定封闭岗位类别");
  return { coverageKind: input.coverageKind, coverageKey: `role:${input.roleCategoryKey.trim()}` };
}

export function assertDateRange(effectiveFrom: Date, effectiveTo: Date | null): void {
  if (effectiveTo && effectiveFrom.getTime() >= effectiveTo.getTime()) {
    throw new Error("有效期必须满足 effectiveFrom < effectiveTo");
  }
}

export function assertMoneyWithinPostgresBigInt(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("金额必须是正整数分字符串");
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error("金额必须大于零");
  if (amount > POSTGRES_BIGINT_MAX) throw new Error("金额超过数据库整数分上限");
  return amount;
}

export function buildWageGovernedSubjectKey(input: {
  projectId: string;
  assignmentId: string;
  authorityVersionId: string;
  month: Date;
  coverageKey: string;
}): string {
  const month = input.month.toISOString().slice(0, 10);
  return `${AFFILIATE_ASSIGNED_WAGE_SOURCE_DISCRIMINATOR}/${input.projectId}/${input.assignmentId}/${input.authorityVersionId}/${month}/${input.coverageKey}`;
}

export function buildGuaranteeGovernedSubjectKey(projectId: string, assignmentId: string, obligationId: string): string {
  return `${AFFILIATE_GUARANTEE_SOURCE_DISCRIMINATOR}/${projectId}/${assignmentId}/${obligationId}`;
}

export function assertNoCrossSourceConflict(input: {
  sourceDiscriminator: string;
  governedSubjectKey: string;
  existing: Array<{ sourceDiscriminator: string; governedSubjectKey: string }>;
}): void {
  if (
    input.existing.some(
      (entry) => entry.governedSubjectKey === input.governedSubjectKey && entry.sourceDiscriminator !== input.sourceDiscriminator
    )
  ) {
    throw new Error("同项目同人同月跨来源冲突，必须整组阻断");
  }
}

export function remainingGuaranteeCapacity(cap: bigint, consumed: bigint[]): bigint {
  const used = consumed.reduce((sum, value) => sum + value, 0n);
  if (used > cap) throw new Error("保证金累计金额超过权威上限");
  return cap - used;
}

export function assertGuaranteeWithholdingWithinCap(cap: bigint, currentWithheld: bigint, requested: bigint): void {
  if (currentWithheld < 0n || requested <= 0n || currentWithheld + requested > cap) {
    throw new Error("保证金暂扣累计金额超过权威上限");
  }
}

export function buildAuthorityFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
