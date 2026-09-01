import {
  AFFILIATE_ASSIGNED_WAGE_SOURCE_DISCRIMINATOR,
  assertAuthorityCoverage,
  assertDateRange,
  assertGuaranteeWithholdingWithinCap,
  assertMoneyWithinPostgresBigInt,
  assertNoCrossSourceConflict,
  buildAuthorityFingerprint,
  buildGuaranteeGovernedSubjectKey,
  buildWageGovernedSubjectKey,
  normalizeWageMonth,
  remainingGuaranteeCapacity
} from "./affiliate-clearing-authority.domain";

describe("affiliate clearing authority domain", () => {
  it("normalizes only an exact YYYY-MM wage month to the first day", () => {
    expect(normalizeWageMonth("2026-08")).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(() => normalizeWageMonth("2026-8")).toThrow("工资月份必须是 YYYY-MM");
    expect(() => normalizeWageMonth("2026-13")).toThrow("工资月份不是有效月份");
  });

  it("keeps PERSON and ROLE_SUMMARY coverage mutually exclusive", () => {
    expect(
      assertAuthorityCoverage({
        coverageKind: "PERSON",
        personAuthorityKey: "user-1",
        roleCategoryKey: null
      })
    ).toEqual({ coverageKind: "PERSON", coverageKey: "person:user-1" });

    expect(
      assertAuthorityCoverage({
        coverageKind: "ROLE_SUMMARY",
        personAuthorityKey: null,
        roleCategoryKey: "carpenter"
      })
    ).toEqual({ coverageKind: "ROLE_SUMMARY", coverageKey: "role:carpenter" });

    expect(() =>
      assertAuthorityCoverage({
        coverageKind: "ROLE_SUMMARY",
        personAuthorityKey: "user-1",
        roleCategoryKey: "carpenter"
      })
    ).toThrow("岗位汇总不得带人员身份");
  });

  it("builds stable governed subject keys from server-side coordinates", () => {
    expect(
      buildWageGovernedSubjectKey({
        projectId: "project-1",
        assignmentId: "assignment-1",
        authorityVersionId: "authority-1",
        month: new Date("2026-08-01T00:00:00.000Z"),
        coverageKey: "person:user-1"
      })
    ).toBe("construction_enterprise_assigned_wage/project-1/assignment-1/authority-1/2026-08-01/person:user-1");
    expect(buildGuaranteeGovernedSubjectKey("project-1", "assignment-1", "OBL-001")).toBe(
      "construction_enterprise_guarantee/project-1/assignment-1/OBL-001"
    );
    expect(AFFILIATE_ASSIGNED_WAGE_SOURCE_DISCRIMINATOR).not.toBe("wage_statement_version");
  });

  it("enforces half-open authority ranges and bigint money", () => {
    expect(() => assertDateRange(new Date("2026-09-01"), new Date("2026-09-01"))).toThrow(
      "有效期必须满足 effectiveFrom < effectiveTo"
    );
    expect(() => assertDateRange(new Date("2026-09-01"), new Date("2026-08-01"))).toThrow(
      "有效期必须满足 effectiveFrom < effectiveTo"
    );
    expect(assertMoneyWithinPostgresBigInt("9223372036854775807")).toBe(9223372036854775807n);
    expect(() => assertMoneyWithinPostgresBigInt("9223372036854775808")).toThrow("金额超过数据库整数分上限");
  });

  it("does not allow a new source to overlap an existing source for the same governed subject", () => {
    expect(() =>
      assertNoCrossSourceConflict({
        sourceDiscriminator: AFFILIATE_ASSIGNED_WAGE_SOURCE_DISCRIMINATOR,
        governedSubjectKey: "project-1/2026-08/person:user-1",
        existing: [{ sourceDiscriminator: "wage_statement_version", governedSubjectKey: "project-1/2026-08/person:user-1" }]
      })
    ).toThrow("同项目同人同月跨来源冲突，必须整组阻断");
  });

  it("keeps remaining guarantee capacity non-negative and fail closed", () => {
    expect(remainingGuaranteeCapacity(10000n, [2000n, 3000n])).toBe(5000n);
    expect(() => remainingGuaranteeCapacity(10000n, [9000n, 2000n])).toThrow("保证金累计金额超过权威上限");
  });

  it("rejects a guarantee tranche that would exceed the remaining server cap", () => {
    expect(() => assertGuaranteeWithholdingWithinCap(10000n, 7000n, 3001n)).toThrow("保证金暂扣累计金额超过权威上限");
    expect(() => assertGuaranteeWithholdingWithinCap(10000n, 7000n, 3000n)).not.toThrow();
  });

  it("fingerprints canonical fields deterministically", () => {
    const first = buildAuthorityFingerprint({ b: 2, a: "one" });
    const second = buildAuthorityFingerprint({ a: "one", b: 2 });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
