import { ConflictException } from "@nestjs/common";

import {
  buildAuthorityFingerprint,
  type AuthorityCoverageKind
} from "../clearing/affiliate-clearing-authority.domain";

export type TakeoverHistoricalKind = "assigned_wage" | "guarantee";
export type TakeoverMappingDecision = "FORMAL" | "GAP";

/**
 * This is an internal value produced by AffiliateClearingAuthorityService.
 * No controller or DTO may accept this shape from a client.
 */
export interface ResolvedClearingAuthorityForTakeover {
  projectId: string;
  constructionEnterpriseAssignmentId: string;
  category: "assigned_management_salary" | "deposit";
  governedSubjectKey: string;
  authoritativeGrossCapCents: bigint;
  currencyCode: string;
  authorityVersionId: string;
  authoritySnapshotRef: string;
  sourceDiscriminator: "construction_enterprise_assigned_wage" | "construction_enterprise_guarantee";
  coverageKind: AuthorityCoverageKind;
  coverageKey: string;
  periodStart: Date | null;
  authorityFingerprint: string;
  authorityLineId?: string;
  obligationId?: string;
  personAuthorityKey?: string | null;
}

export interface ConstructionEnterpriseHistoricalRow {
  projectId: string;
  kind: TakeoverHistoricalKind;
  amountCents: bigint;
  evidenceLevel: "A" | "B" | "C";
  periodStart: Date | null;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
  sourceCoordinate: string;
  normalizedRowHash: string;
  authority?: ResolvedClearingAuthorityForTakeover;
}

export interface ConstructionEnterpriseHistoricalMapping {
  decision: TakeoverMappingDecision;
  entryKind: "formal" | "gap";
  projectId: string;
  amountCents: bigint;
  evidenceLevel: "A" | "B" | "C";
  periodStart: Date | null;
  sourceType: string;
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
  sourceCoordinate: string;
  normalizedRowHash: string;
  sourceDiscriminator: string | null;
  governedSubjectKey: string | null;
  conflictGroupKey: string;
  authoritySnapshotRef: string | null;
  authorityFingerprint: string | null;
  authorityVersionId: string | null;
  authorityLineId: string | null;
  obligationId: string | null;
  mappingFingerprint: string;
}

export class ConstructionEnterpriseClearingAdapter {
  map(row: ConstructionEnterpriseHistoricalRow): ConstructionEnterpriseHistoricalMapping {
    assertSourceCoordinates(row);
    if (row.evidenceLevel === "C") {
      return {
        ...baseMapping(row),
        decision: "GAP",
        entryKind: "gap",
        sourceDiscriminator: null,
        governedSubjectKey: null,
        conflictGroupKey: `${row.projectId}|gap|${row.sourceFingerprint}`,
        authoritySnapshotRef: null,
        authorityFingerprint: null,
        authorityVersionId: null,
        authorityLineId: null,
        obligationId: null,
        mappingFingerprint: buildAuthorityFingerprint({ row, decision: "GAP" })
      };
    }

    const authority = row.authority;
    if (!authority) throw new ConflictException("A/B级受治理历史行缺少服务端权威来源，必须失败关闭");
    if (authority.projectId !== row.projectId) throw new ConflictException("历史行与权威项目不一致，必须失败关闭");
    const expectedCategory = row.kind === "assigned_wage" ? "assigned_management_salary" : "deposit";
    if (authority.category !== expectedCategory) throw new ConflictException("历史行与权威业务类别不一致，必须失败关闭");
    const expectedDiscriminator = row.kind === "assigned_wage"
      ? "construction_enterprise_assigned_wage"
      : "construction_enterprise_guarantee";
    if (authority.sourceDiscriminator !== expectedDiscriminator) {
      throw new ConflictException("历史行与权威来源判别器不一致，必须失败关闭");
    }
    if (row.periodStart && authority.periodStart && row.periodStart.getTime() !== authority.periodStart.getTime()) {
      throw new ConflictException("历史行期间与权威期间不一致，必须失败关闭");
    }
    if (row.amountCents > authority.authoritativeGrossCapCents) {
      throw new ConflictException("历史行金额超过服务端权威上限");
    }
    if (authority.coverageKind === "PERSON" && !authority.coverageKey.startsWith("person:")) {
      throw new ConflictException("PERSON 权威来源缺少人员覆盖键");
    }
    if (authority.coverageKind === "ROLE_SUMMARY" && (!authority.coverageKey.startsWith("role:") || authority.personAuthorityKey)) {
      throw new ConflictException("ROLE_SUMMARY 不得伪造人员身份");
    }

    const period = authority.periodStart?.toISOString().slice(0, 10) ?? "obligation";
    return {
      ...baseMapping(row),
      decision: "FORMAL",
      entryKind: "formal",
      sourceDiscriminator: authority.sourceDiscriminator,
      governedSubjectKey: authority.governedSubjectKey,
      conflictGroupKey: `${row.projectId}|${authority.coverageKind}|${authority.coverageKey}|${period}`,
      authoritySnapshotRef: authority.authoritySnapshotRef,
      authorityFingerprint: authority.authorityFingerprint,
      authorityVersionId: authority.authorityVersionId,
      authorityLineId: authority.authorityLineId ?? null,
      obligationId: authority.obligationId ?? null,
      mappingFingerprint: buildAuthorityFingerprint({ row, authority, decision: "FORMAL" })
    };
  }
}

function baseMapping(row: ConstructionEnterpriseHistoricalRow) {
  return {
    projectId: row.projectId,
    amountCents: row.amountCents,
    evidenceLevel: row.evidenceLevel,
    periodStart: row.periodStart,
    sourceType: row.sourceType,
    sourceBusinessId: row.sourceBusinessId,
    sourceVersion: row.sourceVersion,
    sourceFingerprint: row.sourceFingerprint,
    sourceCoordinate: row.sourceCoordinate,
    normalizedRowHash: row.normalizedRowHash
  };
}

function assertSourceCoordinates(row: ConstructionEnterpriseHistoricalRow): void {
  if (!row.projectId.trim()) throw new ConflictException("来源项目不能为空");
  if (!row.sourceType.trim() || !row.sourceBusinessId.trim()) throw new ConflictException("来源业务坐标不能为空");
  if (!Number.isSafeInteger(row.sourceVersion) || row.sourceVersion < 1) throw new ConflictException("来源版本必须是正整数");
  if (!/^[0-9a-f]{64}$/.test(row.sourceFingerprint)) throw new ConflictException("来源指纹必须是 SHA-256");
  if (!/^[0-9a-f]{64}$/.test(row.normalizedRowHash)) throw new ConflictException("规范化行指纹必须是 SHA-256");
  if (!row.sourceCoordinate.trim()) throw new ConflictException("来源行坐标不能为空");
  if (row.amountCents <= 0n) throw new ConflictException("历史行金额必须是正整数分");
}
