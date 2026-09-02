import { ConflictException } from "@nestjs/common";

import {
  ConstructionEnterpriseClearingAdapter,
  type ResolvedClearingAuthorityForTakeover
} from "./construction-enterprise-clearing.adapter";

const authority: ResolvedClearingAuthorityForTakeover = {
  projectId: "project-1",
  constructionEnterpriseAssignmentId: "assignment-1",
  category: "assigned_management_salary",
  governedSubjectKey: "construction_enterprise_assigned_wage/project-1/assignment-1/authority-1/2026-08-01/person:user-1",
  authoritativeGrossCapCents: 12345n,
  currencyCode: "CNY",
  authorityVersionId: "authority-1",
  authoritySnapshotRef: "acv_snapshot",
  sourceDiscriminator: "construction_enterprise_assigned_wage",
  coverageKind: "PERSON",
  coverageKey: "person:user-1",
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  authorityFingerprint: "a".repeat(64),
  authorityLineId: "line-1"
};

const row = {
  projectId: "project-1",
  kind: "assigned_wage" as const,
  amountCents: 12345n,
  evidenceLevel: "A" as const,
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  sourceType: "legacy_affiliate_deduction",
  sourceBusinessId: "legacy-1",
  sourceVersion: 1,
  sourceFingerprint: "b".repeat(64),
  sourceCoordinate: "工资表!C3",
  normalizedRowHash: "c".repeat(64)
};

describe("ConstructionEnterpriseClearingAdapter", () => {
  const adapter = new ConstructionEnterpriseClearingAdapter();

  it("maps A PERSON rows to a server-authority formal intent", () => {
    const mapped = adapter.map({ ...row, authority });

    expect(mapped).toEqual(expect.objectContaining({
      decision: "FORMAL",
      sourceDiscriminator: "construction_enterprise_assigned_wage",
      governedSubjectKey: authority.governedSubjectKey,
      conflictGroupKey: "project-1|PERSON|person:user-1|2026-08-01",
      authoritySnapshotRef: "acv_snapshot"
    }));
    expect(mapped).not.toHaveProperty("values");
  });

  it("keeps C evidence as a gap and never maps it to formal clearing", () => {
    const mapped = adapter.map({ ...row, evidenceLevel: "C", authority: undefined });

    expect(mapped).toEqual(expect.objectContaining({ decision: "GAP", entryKind: "gap" }));
    expect(mapped.governedSubjectKey).toBeNull();
  });

  it("rejects a role summary that carries a person identity or the wrong authority category", () => {
    expect(() => adapter.map({
      ...row,
      authority: {
        ...authority,
        coverageKind: "ROLE_SUMMARY",
        coverageKey: "role:project_manager",
        personAuthorityKey: "user-1"
      }
    })).toThrow(ConflictException);
  });

  it("requires immutable source coordinates and hashes", () => {
    expect(() => adapter.map({ ...row, sourceFingerprint: "not-a-hash", authority })).toThrow("来源指纹");
    expect(() => adapter.map({ ...row, sourceVersion: 0, authority })).toThrow("来源版本");
  });
});
