import { BadRequestException } from "@nestjs/common";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { ProjectUpstreamFundFactCursorCodec } from "./project-upstream-fund-fact-cursor";

describe("ProjectUpstreamFundFactCursorCodec", () => {
  const now = new Date("2026-09-12T01:00:00.000Z");
  const claims = {
    actorUserId: "finance-1",
    projectId: "project-1",
    pageSize: 50,
    readAt: now.toISOString(),
    snapshotRowCount: "20001",
    snapshotStateFingerprint: "ab".repeat(32),
    position: {
      occurredAt: "2026-09-11T01:00:00.000Z",
      createdAt: "2026-09-11T02:00:00.000Z",
      id: "fact-1"
    }
  };

  it("round-trips encrypted coordinates bound to actor, project, and page size", () => {
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => now);
    const token = codec.issue(claims);

    expect(token).not.toContain("fact-1");
    expect(codec.read(token, {
      actorUserId: "finance-1",
      projectId: "project-1",
      pageSize: 50
    })).toEqual(expect.objectContaining(claims));
  });

  it.each([
    ["actor", { actorUserId: "finance-2", projectId: "project-1", pageSize: 50 }],
    ["project", { actorUserId: "finance-1", projectId: "project-2", pageSize: 50 }],
    ["page size", { actorUserId: "finance-1", projectId: "project-1", pageSize: 20 }]
  ])("rejects a cursor rebound to another %s", (_label, binding) => {
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => now);
    const token = codec.issue(claims);
    expect(() => codec.read(token, binding)).toThrow(BadRequestException);
  });

  it("rejects tampering and expiry", () => {
    let clock = now;
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => clock);
    const token = codec.issue(claims);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(() => codec.read(tampered, {
      actorUserId: "finance-1",
      projectId: "project-1",
      pageSize: 50
    })).toThrow(BadRequestException);
    clock = new Date("2026-09-12T01:16:00.000Z");
    expect(() => codec.read(token, {
      actorUserId: "finance-1",
      projectId: "project-1",
      pageSize: 50
    })).toThrow(BadRequestException);
  });

  it.each([
    ["non-string", null],
    ["oversized", "x".repeat(2_049)]
  ])("rejects %s input before decoding", (_label, token) => {
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => now);
    expect(() => codec.read(token, {
      actorUserId: "finance-1",
      projectId: "project-1",
      pageSize: 50
    })).toThrow(BadRequestException);
  });

  it.each([
    ["negative row count", { snapshotRowCount: "-1" }],
    ["non-canonical row count", { snapshotRowCount: "01" }],
    ["invalid fingerprint", { snapshotStateFingerprint: "ABC" }],
    ["oversized position", { position: { ...claims.position, id: "x".repeat(257) } }]
  ])("refuses to issue claims with %s", (_label, override) => {
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => now);
    expect(() => codec.issue({ ...claims, ...override })).toThrow();
  });

  it("rejects a correctly encrypted V1 cursor", () => {
    const legacyPurpose = "project-upstream-fund-fact-cursor/V1";
    const key = createHash("sha256")
      .update(`${legacyPurpose}\u0000test-secret`, "utf8")
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(legacyPurpose, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({
        version: 1,
        purpose: legacyPurpose,
        actorUserId: claims.actorUserId,
        projectId: claims.projectId,
        pageSize: claims.pageSize,
        readAt: claims.readAt,
        position: claims.position,
        expiresAt: new Date(now.getTime() + 60_000).toISOString()
      }), "utf8"),
      cipher.final()
    ]);
    const token = [iv, encrypted, cipher.getAuthTag()]
      .map((value) => value.toString("base64url"))
      .join(".");
    const codec = new ProjectUpstreamFundFactCursorCodec("test-secret", () => now);

    expect(() => codec.read(token, {
      actorUserId: claims.actorUserId,
      projectId: claims.projectId,
      pageSize: claims.pageSize
    })).toThrow(BadRequestException);
  });
});
