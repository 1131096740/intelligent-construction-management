import { BadRequestException } from "@nestjs/common";

import {
  OperatingProjectionCursorCodec,
  projectionContextFingerprint,
  projectionFingerprintsMatch
} from "./operating-projection-cursor";

describe("OperatingProjectionCursorCodec", () => {
  const now = new Date("2026-09-12T01:00:00.000Z");
  const scope = {
    kind: "project" as const,
    projectId: "project-1",
    projectIds: ["project-1"],
    filters: { sourceType: "owner_settlement" }
  };

  it("round-trips an encrypted cursor bound to actor, scope, filters, and page size", () => {
    const codec = new OperatingProjectionCursorCodec("test-secret", () => now);
    const token = codec.issue({
      actorUserId: "user-1",
      requestedAsOf: null,
      requestScope: scope,
      scope,
      projectionContextFingerprint: "a".repeat(64),
      readAt: now.toISOString(),
      cutoffAt: now.toISOString(),
      pageSize: 50,
      position: {
        phase: "facts",
        occurredAt: "2026-09-11T01:00:00.000Z",
        impactId: "internal-impact-id"
      }
    });

    expect(token).not.toContain("internal-impact-id");
    expect(codec.read(token, { actorUserId: "user-1", scope, pageSize: 50 }))
      .toEqual(expect.objectContaining({
        actorUserId: "user-1",
        readAt: now.toISOString()
      }));
  });

  it("keeps the encrypted cursor bounded when the resolved scope has many projects", () => {
    const codec = new OperatingProjectionCursorCodec("test-secret", () => now);
    const largeScope = {
      ...scope,
      kind: "projects" as const,
      projectId: undefined,
      projectIds: Array.from({ length: 10_000 }, (_, index) => `project-${index}`)
    };
    const token = codec.issue({
      actorUserId: "user-1",
      requestedAsOf: null,
      requestScope: { ...largeScope, projectIds: [] },
      scope: largeScope,
      projectionContextFingerprint: "b".repeat(64),
      readAt: now.toISOString(),
      cutoffAt: now.toISOString(),
      pageSize: 50,
      position: { phase: "done" }
    });

    expect(Buffer.byteLength(token, "utf8")).toBeLessThan(1_000);
    expect(codec.read(token, {
      actorUserId: "user-1",
      scope: { ...largeScope, projectIds: [] },
      pageSize: 50
    }).scopeFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["another actor", { actorUserId: "user-2", scope, pageSize: 50 }],
    ["another page size", { actorUserId: "user-1", scope, pageSize: 20 }],
    ["another filter", {
      actorUserId: "user-1",
      requestedAsOf: null,
      scope: { ...scope, filters: { sourceType: "payment_execution" } },
      pageSize: 50
    }]
  ])("rejects %s", (_label, binding) => {
    const codec = new OperatingProjectionCursorCodec("test-secret", () => now);
    const token = codec.issue({
      actorUserId: "user-1",
      requestedAsOf: null,
      requestScope: scope,
      scope,
      projectionContextFingerprint: "c".repeat(64),
      readAt: now.toISOString(),
      cutoffAt: now.toISOString(),
      pageSize: 50,
      position: { phase: "done" }
    });
    expect(() => codec.read(token, binding)).toThrow(BadRequestException);
  });

  it("rejects tampering and expiry", () => {
    let clock = now;
    const codec = new OperatingProjectionCursorCodec("test-secret", () => clock);
    const token = codec.issue({
      actorUserId: "user-1",
      requestedAsOf: null,
      requestScope: scope,
      scope,
      projectionContextFingerprint: "d".repeat(64),
      readAt: now.toISOString(),
      cutoffAt: now.toISOString(),
      pageSize: 50,
      position: { phase: "done" }
    });
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(() => codec.read(tamperedToken, {
      actorUserId: "user-1", scope, pageSize: 50
    })).toThrow(BadRequestException);
    clock = new Date("2026-09-12T01:16:00.000Z");
    expect(() => codec.read(token, {
      actorUserId: "user-1", scope, pageSize: 50
    })).toThrow(BadRequestException);
  });

  it("compares fixed-length projection context fingerprints", () => {
    const left = projectionContextFingerprint({ projects: [{ id: "project-1" }] });
    const same = projectionContextFingerprint({ projects: [{ id: "project-1" }] });
    const other = projectionContextFingerprint({ projects: [{ id: "project-2" }] });

    expect(projectionFingerprintsMatch(left, same)).toBe(true);
    expect(projectionFingerprintsMatch(left, other)).toBe(false);
    expect(projectionFingerprintsMatch(left, "not-a-fingerprint")).toBe(false);
  });
});
