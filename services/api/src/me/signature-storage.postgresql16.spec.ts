import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";

const url = process.env.SIGNATURE_POSTGRESQL16_ACCEPTANCE_URL;
const { assertSyntheticSignatureDatabase } = require("../../prisma/signature-fixture-guard.cjs");
const acceptance = url ? describe : describe.skip;

acceptance("signature with real PostgreSQL16, password login and authenticated HTTP", () => {
  let db: PrismaClient;
  let app: INestApplication;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
  const password = "LocalSynthetic@2026";
  const runId = randomUUID();
  const phoneBase = Number.parseInt(runId.replace(/-/g, "").slice(0, 7), 16) % 99999998;
  const previousEnv = { ...process.env };
  const users: Array<{ id: string; role: string; phone: string }> = [];

  beforeAll(async () => {
    assertSyntheticSignatureDatabase({ url, container: process.env.SIGNATURE_ACCEPTANCE_CONTAINER, runId: process.env.SIGNATURE_ACCEPTANCE_RUN_ID });
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = process.env.SIGNATURE_ACCEPTANCE_STORAGE_ROOT!;
    if (!process.env.FILE_STORAGE_ROOT) throw new Error("isolated storage root required");
    const project = await db.project.create({ data: { code: runId, name: "本次合成签名验收项目" } });
    for (const [i, role] of ["employee", "project_manager"].entries()) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "合成验收岗位" } });
      const user = await db.user.create({ data: { name: "合成签名验收" + role, phone: "137" + String(phoneBase + i).padStart(8, "0"),
        passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
      await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: role === "employee" ? null : project.id } });
      users.push({ id: user.id, role, phone: user.phone! });
    }
    const audit = new AuditService();
    const files = new FileService(db as never, audit, new PrivateFileStorage());
    const me = new MeService(db as never, files, audit);
    const tokens = new JwtTokenService();
    const auth = new AuthService(db as never, tokens, audit);
    const module = await Test.createTestingModule({ controllers: [MeController, AuthController],
      providers: [{ provide: MeService, useValue: me }, { provide: AuthService, useValue: auth }] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalGuards(new JwtAuthGuard(new Reflector(), tokens, db as never));
    await app.listen(0, "127.0.0.1");
  });
  afterAll(async () => { await app?.close(); await db?.$disconnect(); process.env = previousEnv; });
  async function json(path: string, token?: string, body?: unknown) {
    const response = await fetch(await app.getUrl() + path, { method: body ? "POST" : "GET",
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  async function sign(token: string, bytes: Buffer, path = "/me/signature/canvas") {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "synthetic.png");
    const response = await fetch(await app.getUrl() + path, { method: "POST", headers: { authorization: "Bearer " + token }, body });
    return { status: response.status, body: await response.json() };
  }

  it("accepts self-service signing for employees and project managers, versions and audit stay immutable", async () => {
    expect((await sign("invalid", png)).status).toBe(401);
    for (const user of users) {
      const beforePositions = await db.userPosition.findMany({ where: { userId: user.id } });
      const login = await json("/auth/login", undefined, { phone: user.phone, password });
      expect(login.status).toBe(201); expect(login.body.user.roleKeys).toContain(user.role);
      const token = login.body.tokens.accessToken;
      const first = await sign(token, png); expect(first.status).toBe(201);
      const frozen = await db.$transaction(tx => snapshotApprovalSignature(tx, user.id, { required: true }));
      expect(frozen.versionId).toBe(first.body.signatureVersionId);
      const handoff = await json("/me/signature/canvas-handoffs", token, {});
      expect(handoff.status).toBe(201);
      const second = await sign(token, png, "/me/signature/canvas-handoffs/" + handoff.body.token + "/complete");
      expect(second.status).toBe(201); expect(second.body.signatureVersionId).not.toBe(frozen.versionId);
      const original = await db.handwrittenSignatureVersion.findUniqueOrThrow({ where: { id: frozen.versionId! } });
      expect(original.fileId).toBe(frozen.fileId); expect(original.contentSha256).toBe(createHash("sha256").update(png).digest("hex"));
      expect(await db.handwrittenSignatureVersion.count({ where: { userId: user.id } })).toBe(2);
      const events = await db.auditLog.findMany({ where: { actorUserId: user.id, action: "me.signature.canvas.update" } });
      expect(events).toHaveLength(2);
      expect(events.map(x => (x.metadata as { source: string }).source).sort()).toEqual(["direct", "handoff"]);
      expect(await db.auditLog.count({ where: { actorUserId: user.id, action: "file.upload" } })).toBe(2);
      expect(await db.userPosition.findMany({ where: { userId: user.id } })).toEqual(beforePositions);
      expect((await json("/me/signature/canvas-handoffs/" + handoff.body.token, token)).body.completedAt).toBeTruthy();
    }
    expect(await db.approvalActionLog.count()).toBe(0);
  }, 30000);
});
