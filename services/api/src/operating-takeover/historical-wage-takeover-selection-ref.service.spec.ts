import {
  HistoricalWageTakeoverSelectionRefService,
  type HistoricalWageSelectionBinding
} from "./historical-wage-takeover-selection-ref.service";

const HASH = "a".repeat(64);
const TYPE_COORDINATES = [{
  projectId: "project-1",
  sourceType: "project_wage" as const,
  sourceBusinessId: "legacy-wage-1",
  sourceVersion: 1,
  sourceFingerprint: "d".repeat(64)
}];

// @ts-expect-error Grade C is not a valid signed shape without its mandatory negative-authority frontier.
const MISSING_C_NEGATIVE_FRONTIER: HistoricalWageSelectionBinding = {
  actorUserId: "finance-1",
  selectionFingerprint: HASH,
  grade: "C",
  legacyCoordinates: TYPE_COORDINATES
};
// @ts-expect-error Grade C must not carry an A/B authority coordinate.
const MIXED_C_AUTHORITY_COORDINATES: HistoricalWageSelectionBinding = {
  actorUserId: "finance-1",
  selectionFingerprint: HASH,
  grade: "C",
  negativeAuthorityFrontierFingerprint: "e".repeat(64),
  summaryFingerprint: "f".repeat(64),
  legacyCoordinates: TYPE_COORDINATES
};
void MISSING_C_NEGATIVE_FRONTIER;
void MIXED_C_AUTHORITY_COORDINATES;

describe("HistoricalWageTakeoverSelectionRefService", () => {
  const binding = {
    actorUserId: "finance-1",
    selectionFingerprint: HASH,
    grade: "A" as const,
    sourceVersionId: "approved-source-1",
    sourceFingerprint: "b".repeat(64),
    sourceClosureFingerprint: "c".repeat(64),
    legacyCoordinates: [{
      projectId: "project-1",
      sourceType: "project_wage" as const,
      sourceBusinessId: "legacy-wage-1",
      sourceVersion: 1,
      sourceFingerprint: "d".repeat(64)
    }]
  };

  it("binds the opaque selection to actor, exact server coordinates, and a short expiry", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const selectionRef = service.issue(binding, now);

    expect(service.read(selectionRef, now)).toEqual(binding);
    expect(service.read(selectionRef, new Date("2026-09-04T00:11:00.000Z"))).toBeNull();
  });

  it("fails closed if a client changes any source fact embedded in the signed reference", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const issued = service.issue(binding, now);
    const [prefix, expiry, payload, signature] = issued.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    decoded.legacyCoordinates[0].sourceBusinessId = "client-substituted";
    const tampered = `${prefix}.${expiry}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect(service.read(tampered, now)).toBeNull();
  });

  it("lets only an internal scope continuation rebind the short-lived command ref to a distinct reviewer", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const source = service.issue({ ...binding, delegatorUserId: "delegator-1", atomicScopeVersionId: "scope-1" }, now);
    const reviewerRef = service.issueScopedForActor(source, "finance-2", undefined, now);

    expect(service.read(reviewerRef, now)).toEqual({
      ...binding,
      actorUserId: "finance-2",
      atomicScopeVersionId: "scope-1"
    });
    expect(() => service.issueScopedForActor(service.issue(binding, now), "finance-2", undefined, now)).toThrow("原子范围");
  });

  it("round-trips and reissues an exact C binding without losing its negative-authority frontier", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const cBinding = {
      actorUserId: "finance-1",
      selectionFingerprint: HASH,
      grade: "C" as const,
      negativeAuthorityFrontierFingerprint: "e".repeat(64),
      atomicScopeVersionId: "scope-1",
      legacyCoordinates: TYPE_COORDINATES
    };
    const issued = service.issue(cBinding, now);
    const reviewer = service.issueScopedForActor(issued, "finance-2", undefined, now);

    expect(service.read(issued, now)).toEqual(cBinding);
    expect(service.read(reviewer, now)).toEqual({ ...cBinding, actorUserId: "finance-2" });
  });

  it("rejects missing or mixed grade-specific authority coordinates at signing time", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const base = {
      actorUserId: "finance-1",
      selectionFingerprint: HASH,
      grade: "C" as const,
      legacyCoordinates: TYPE_COORDINATES
    };

    expect(() => service.issue(base as unknown as HistoricalWageSelectionBinding, now)).toThrow("负权威前沿");
    expect(() => service.issue({
      ...base,
      negativeAuthorityFrontierFingerprint: "e".repeat(64),
      summaryFingerprint: "f".repeat(64)
    } as unknown as HistoricalWageSelectionBinding, now)).toThrow("不得携带");
  });

  it("rejects non-canonical expiry text and surrounding whitespace even when parseInt would preserve the value", () => {
    const service = new HistoricalWageTakeoverSelectionRefService({ secret: "s".repeat(48) });
    const now = new Date("2026-09-04T00:00:00.000Z");
    const [prefix, expiry, payload, signature] = service.issue(binding, now).split(".");
    const nonCanonicalExpiry = `${prefix}.${expiry}!.${payload}.${signature}`;
    const padded = ` ${prefix}.${expiry}.${payload}.${signature} `;

    expect(service.read(nonCanonicalExpiry, now)).toBeNull();
    expect(service.read(padded, now)).toBeNull();
  });
});
