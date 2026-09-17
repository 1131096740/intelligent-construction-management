import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const enabled = process.env.RUN_POL115_SPOT_ENTRY_PG16 === "1";
type Session = {
  user: unknown;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
};
type Detail = {
  procurement: { id: string; status: string; statusLabel: string };
  currentVersion: { id: string; versionNo: number; reason: string; status: string };
  versions: Array<{ id: string; versionNo: number; reason: string; status: string }>;
  attachments: Array<{ fileName: string }>;
  approval: { currentNodeName: string | null };
  reviewApprovalContext: null | {
    expectedVersionId: string;
    expectedApprovalInstanceId: string;
    expectedNodeIndex: number;
  };
};

describe("#115 零星采购申请生命周期真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let baseUrl = "";
  let applicant: Session;
  let director: Session;
  let manager: Session;
  const projectIds = { api: randomUUID(), desktop: randomUUID(), mobile: randomUUID() };
  const previousPilot = process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS;

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_spot_entry_test") {
      throw new Error("零采入口测试只允许本机专用 PostgreSQL 数据库");
    }
    process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS = Object.values(projectIds).join(",");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    const prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const password = randomUUID();
    const users = await Promise.all([
      ["零采申请人", "material_staff"],
      ["零采物资主管", "material_director"],
      ["零采项目经理", "project_manager"]
    ].map(async ([name, role]) => ({
      role,
      user: await prisma.user.create({ data: { name, phone: `pol115-spot-${role}-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } })
    })));
    for (const [kind, id] of Object.entries(projectIds)) {
      await prisma.project.create({ data: { id, code: `POL115-SPOT-${kind}-${suffix.slice(0, 6)}`, name: `零采${kind}隔离项目` } });
    }
    for (const { role, user } of users) {
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.createMany({ data: Object.values(projectIds).map((projectId) => ({ userId: user.id, positionId: position.id, projectId })) });
      const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) });
      expect(response.status).toBe(201);
      const session = await response.json() as Session;
      if (role === "material_staff") applicant = session;
      if (role === "material_director") director = session;
      if (role === "project_manager") manager = session;
    }
    for (const session of [director, manager]) {
      const body = new FormData();
      body.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成签名.png");
      expect((await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body })).status).toBe(201);
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (previousPilot === undefined) delete process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS;
    else process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS = previousPilot;
  });

  async function json(path: string, session: Session, method = "GET", body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${session.tokens.accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Detail & { procurementId: string } : null };
  }

  async function createDraft(projectId: string, label: string) {
    const upload = new FormData();
    upload.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), `合成报价-${label}.png`);
    upload.append("idempotencyKey", randomUUID());
    const uploaded = await fetch(`${baseUrl}/spot-procurements/projects/${projectId}/draft-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${applicant.tokens.accessToken}` }, body: upload });
    const uploadText = await uploaded.text();
    if (uploaded.status !== 201) throw new Error(`零采附件上传失败：${uploaded.status} ${uploadText}`);
    const file = JSON.parse(uploadText) as { id: string };
    const created = await json("/spot-procurements", applicant, "POST", {
      projectId, applicationDepartment: "工程部", applicationName: "现场申请人", requestedArrivalAt: "2026-10-01",
      reason: `旧版采购原因-${label}`, lines: [{ materialName: "水泥", specification: "P.O 42.5", unit: "袋", quantity: "10", note: "合成验收" }],
      attachments: [{ fileId: file.id, category: "merchant_quote" }]
    });
    expect(created.status).toBe(201);
    expect(created.body!.procurementId).toEqual(expect.any(String));
    return created.body!.procurementId;
  }

  async function review(id: string, session: Session, decision: "approve" | "return_to_applicant", comment: string) {
    const detail = await json(`/spot-procurements/${id}`, session);
    expect(detail.status).toBe(200);
    expect(detail.body!.reviewApprovalContext).not.toBeNull();
    return json(`/spot-procurements/${id}/approval`, session, "POST", { decision, comment, ...detail.body!.reviewApprovalContext });
  }

  (enabled ? it : it.skip)("公开链保留旧版本并冻结两级审批坐标", async () => {
    const id = await createDraft(projectIds.api, "api");
    expect((await json(`/spot-procurements/${id}`, applicant)).body).toMatchObject({ currentVersion: { versionNo: 1, status: "draft", reason: "旧版采购原因-api" }, attachments: [{ fileName: "合成报价-api.png" }] });
    expect((await json(`/spot-procurements/${id}/submission`, applicant, "POST", {})).status).toBe(201);
    expect((await review(id, director, "return_to_applicant", "请补充现场用途")).status).toBe(201);
    const returned = await json(`/spot-procurements/${id}`, applicant);
    expect(returned.body).toMatchObject({ procurement: { status: "draft" }, currentVersion: { versionNo: 2, status: "draft" }, versions: [{ versionNo: 2 }, { versionNo: 1, reason: "旧版采购原因-api" }] });
    expect((await json(`/spot-procurements/${id}/draft`, applicant, "PATCH", {
      applicationDepartment: "工程部", applicationName: "现场申请人", requestedArrivalAt: "2026-10-02", reason: "新版补充后采购原因",
      lines: [{ materialName: "水泥", specification: "P.O 42.5", unit: "袋", quantity: "12", note: "已补充" }]
    })).status).toBe(200);
    expect((await json(`/spot-procurements/${id}/submission`, applicant, "POST", {})).status).toBe(201);
    expect((await review(id, director, "approve", "物资范围已核对")).status).toBe(201);
    const managerPreflight = await json(`/spot-procurements/${id}`, manager);
    expect(managerPreflight.body).toMatchObject({ approval: { currentNodeName: expect.stringContaining("项目经理") }, reviewApprovalContext: { expectedNodeIndex: 1 } });
    expect((await review(id, manager, "approve", "项目需求确认")).status).toBe(201);
    const final = await json(`/spot-procurements/${id}`, applicant);
    expect(final.body).toMatchObject({ procurement: { status: "approved_in_progress", statusLabel: "采购已批，办理中" }, currentVersion: { versionNo: 2, reason: "新版补充后采购原因" } });
    expect(final.body!.versions.find((version) => version.versionNo === 1)?.reason).toBe("旧版采购原因-api");
  }, 60_000);

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("桌面和手机走真实零采申请页面", async () => {
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, POL115_API_URL: baseUrl, POL115_BROWSER_SESSION: JSON.stringify(applicant), POL115_SPOT_DIRECTOR_SESSION: JSON.stringify(director), POL115_SPOT_MANAGER_SESSION: JSON.stringify(manager), POL115_SPOT_PROJECT_IDS: JSON.stringify({ desktop: projectIds.desktop, mobile: projectIds.mobile }), POL115_BROWSER_SPEC: "pol115-spot-procurement-real.e2e.ts" };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts", "--grep", "零采申请退回修订后完成两级审批"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("零采真实浏览器验证失败")));
    });
  }, 180_000);
});
