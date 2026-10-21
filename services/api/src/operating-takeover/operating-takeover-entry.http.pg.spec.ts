import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { hash } from "bcryptjs";
import * as ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { OperatingTakeoverExcelService } from "./operating-takeover-excel.service";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";
const run = enabled ? it : it.skip;

describe("历史经营接管真实授权 / HTTP / PostgreSQL 16", () => {
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  let projectId: string;
  let otherProjectId: string;
  let director: { id: string; token: string };
  let staff: { id: string; token: string };
  let outsider: { id: string; token: string };
  let administrator: { id: string; token: string };
  let browserSession: unknown;
  let browserPassword: string;
  let browserPhone: string;
  let preservedBatch: unknown;
  let preservedBatchId: string;
  const suffix = randomUUID();
  const prefix = () => `/projects/${projectId}/operating-takeovers`;

  async function request(path: string, actor = director, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }
  async function actor(role: string, scope?: string) {
    const password = randomUUID();
    const user = await db.user.create({ data: { name: `接管合成${role}`, phone: `ot-${randomUUID()}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: scope } });
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) });
    expect(response.status).toBe(201);
    const session = await response.json();
    if (role === "contract_director") { browserSession = session; browserPhone = user.phone!; browserPassword = password; }
    return { id: user.id, token: session.tokens.accessToken as string };
  }
  async function facts() {
    return { batches: await db.operatingTakeoverBatch.count(), rows: await db.operatingTakeoverRow.count(), files: await db.fileObject.count(), audit: await db.auditLog.count(), facts: await db.operatingFact.count(), approvals: await db.approvalInstance.count(), payments: await db.paymentExecution.count(), confirmations: await db.operatingTakeoverConfirmation.count(), activations: await db.operatingTakeoverActivation.count() };
  }
  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_entry_test") throw new Error("仅允许新建本机隔离接管验收库");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1"); base = await app.getUrl(); db = app.get(PrismaService);
    projectId = (await db.project.create({ data: { code: `OT-${suffix}`, name: "本次接管合成项目" } })).id;
    otherProjectId = (await db.project.create({ data: { code: `OT-OTHER-${suffix}`, name: "其他合成项目" } })).id;
    director = await actor("contract_director"); staff = await actor("contract_staff", projectId);
    outsider = await actor("contract_staff", otherProjectId); administrator = await actor("super_admin");
    const oldBatch = await db.operatingTakeoverBatch.create({ data: {
      batchNo: `OT-PRESERVE-${suffix}`, projectId, sceneKeys: ["owner_settlement"], importFingerprint: suffix, createdByUserId: director.id,
      status: "under_review", totalRows: 0, readyRows: 0, blockedRows: 0, warningRows: 0
    } });
    preservedBatch = oldBatch; preservedBatchId = oldBatch.id;
  }, 60_000);
  afterAll(async () => { await app?.close(); });

  function row(sceneKey = "owner_settlement") {
    return { sceneKey, values: { businessRef: `OT-${randomUUID()}`, occurredAt: "2026-10-20", amountYuan: "0.01", counterpartyName: "仅验收合成相对方", evidenceLevel: "C", sourceDescription: "仅本次合成草稿，不确认、不激活、无真实交易" } };
  }
  async function workbook() {
    const service = app.get(OperatingTakeoverExcelService);
    const template = await service.exportTemplate("owner_settlement");
    const book = new ExcelJS.Workbook();
    // ExcelJS uses a pre-generic Buffer declaration; retain its runtime buffer.
    await book.xlsx.load(template.buffer as never);
    const values: Record<string, string> = { 业务整理编号: `OT-${randomUUID()}`, 发生日期: "2026-10-20", 金额: "0.01", 相对方: "仅验收合成相对方", 证据等级: "C", 资料来源: "仅合成资料，禁止确认或激活" };
    const sheet = book.worksheets[0]!;
    sheet.getRow(1).eachCell((cell, index) => { sheet.getRow(2).getCell(index).value = values[cell.text] ?? ""; });
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  async function upload(path: string, bytes: Buffer, name: string, mimeType: string) {
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), name);
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${director.token}` }, body: form });
    return { status: response.status, body: await response.json() };
  }

  run("实际DI授权通过零写入预检→未确认批次→XLSX绑定→PDF关联→删除与审计，零正式事实", async () => {
    const baseline = await facts(); const xlsx = await workbook();
    const checked = await upload(`${prefix()}/precheck-xlsx`, xlsx, "本次合成原始文件.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(checked.status).toBe(201);
    expect(checked.body).toMatchObject({ zeroWrites: true, summary: { totalRows: 1, blockedRows: 0 } });
    expect(await facts()).toEqual(baseline);
    const source = await upload(`${prefix()}/files`, xlsx, "本次合成原始文件.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(source.status).toBe(201);
    expect(await db.fileObject.findUnique({ where: { id: source.body.id } })).toMatchObject({ contentSha256: createHash("sha256").update(xlsx).digest("hex"), uploadedByUserId: director.id });
    const rows = checked.body.rows.map((r: { sceneKey: string; definitionVersion: number; values: unknown }) => ({ sceneKey: r.sceneKey, definitionVersion: r.definitionVersion, values: r.values }));
    const created = await request(prefix(), director, { batchNo: `OT-${suffix}`, sourceFileId: source.body.id, rows });
    expect(created.status).toBe(201);
    const batch = created.body;
    expect(batch).toMatchObject({ status: "under_review", sourceFileId: source.body.id, canDeleteDraft: true });
    const pdf = await PDFDocument.create(); pdf.addPage([100, 100]); const bytes = Buffer.from(await pdf.save());
    const file = await upload(`${prefix()}/files`, bytes, "本次合成附件.pdf", "application/pdf"); expect(file.status).toBe(201);
    const linked = await request(`${prefix()}/${batch.id}/attachments`, director, { purpose: "本次合成PDF依据", fileIds: [file.body.id] }); expect(linked.status).toBe(201);
    expect(await db.fileObject.findUnique({ where: { id: file.body.id } })).toMatchObject({ contentSha256: createHash("sha256").update(bytes).digest("hex"), uploadedByUserId: director.id });
    const detail = await request(`${prefix()}/${batch.id}`); expect(detail.status).toBe(200);
    expect((await request(`${prefix()}/${batch.id}/draft-deletion`, staff, { expectedRevision: detail.body.revision })).status).toBe(409);
    expect((await request(`${prefix()}/${batch.id}/draft-deletion`, director, { expectedRevision: detail.body.revision + 1 })).status).toBe(409);
    expect((await request(`${prefix()}/${batch.id}/draft-deletion`, director, { expectedRevision: detail.body.revision })).status).toBe(201);
    expect((await request(`${prefix()}/${batch.id}`)).status).toBe(404);
    expect((await request(prefix())).body.some((item: { id: string }) => item.id === batch.id)).toBe(false);
    const audits = await db.auditLog.findMany({ where: { businessId: batch.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(["operating_takeover.batch.create", "operating_takeover.file.attach", "operating_takeover.draft.delete"]));
    expect(audits.every(a => a.actorUserId === director.id)).toBe(true);
    expect(audits.find(a => a.action === "operating_takeover.draft.delete")?.metadata).toMatchObject({ sourceFileId: source.body.id, previousStatus: "under_review", projectId, deletedReferences: { rowIds: batch.rows.map((r: { id: string }) => r.id) } });
    expect(await db.fileObject.count({ where: { id: { in: [source.body.id, file.body.id] } } })).toBe(2);
    expect(await db.operatingTakeoverBatch.findUnique({ where: { id: preservedBatchId } })).toEqual(preservedBatch);
    const end = await facts();
    for (const key of ["batches", "rows", "facts", "approvals", "payments", "confirmations", "activations"] as const) expect(end[key]).toBe(baseline[key]);
  }, 60_000);

  run("原项目岗位、跨项目、管理员、缺失目标和无效行均保持拒绝，且失败零持久写入", async () => {
    const baseline = await facts(); const input = { rows: [row()] };
    expect((await request(`${prefix()}/precheck`, staff, input)).status).toBe(201);
    for (const unauthorized of [outsider, administrator]) expect((await request(`${prefix()}/precheck`, unauthorized, input)).status).toBe(403);
    expect((await request(prefix(), staff, input)).status).toBe(403);
    const bad = await request(`${prefix()}/precheck`, director, { rows: [{ ...row(), values: { ...row().values, amountYuan: "-1" } }] });
    expect(bad.status).toBe(201); expect(bad.body.summary.blockedRows).toBe(1);
    expect((await request(prefix(), director, { rows: [{ ...row(), values: {} }] })).status).toBe(400);
    const mismatched = await request(`/business-entry-definitions/owner_settlement/validate?projectId=${projectId}`, director, { target: { entityType: "operating_takeover_row", entityId: otherProjectId }, values: row().values, operation: "import" });
    expect(mismatched.status).toBe(400);
    expect(await facts()).toEqual(baseline);
  }, 60_000);

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("真实桌面/手机页面预检、原始文件绑定、上传失败保留及取消/删除与审计", async () => {
    const baseline = await facts();
    const pdf = await PDFDocument.create(); pdf.addPage([100, 100]);
    const xlsxBase64 = (await workbook()).toString("base64"); const pdfBase64 = Buffer.from(await pdf.save()).toString("base64");
    await new Promise<void>((done, reject) => {
      const env = { ...process.env, POL115_API_URL: base, POL115_BROWSER_SESSION: JSON.stringify(browserSession),
        POL115_BROWSER_SPEC: "operating-takeover-real.e2e.ts", OT_PROJECT_ID: projectId, OT_LOGIN_PHONE: browserPhone, OT_LOGIN_PASSWORD: browserPassword,
        OT_XLSX_BASE64: xlsxBase64, OT_PDF_BASE64: pdfBase64 };
      delete (env as NodeJS.ProcessEnv).JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject); child.on("exit", code => code === 0 ? done() : reject(new Error("接管真实页面回归失败")));
    });
    const end = await facts();
    for (const key of ["batches", "rows", "facts", "approvals", "payments", "confirmations", "activations"] as const) expect(end[key]).toBe(baseline[key]);
    expect(await db.auditLog.count({ where: { actorUserId: director.id, action: "operating_takeover.draft.delete" } })).toBe(3);
  }, 150_000);
});
