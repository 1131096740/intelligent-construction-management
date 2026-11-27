import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bcrypt from "bcryptjs";
import * as ExcelJS from "exceljs";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const describePg = process.env.RUN_TEMPLATE_WORKBENCH_PG16 === "1" ? describe : describe.skip;

describePg("结算模板工作台公开HTTP / PG16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let token: string;
  let sourceBuffer: Buffer;
  const sessions = new Map<string, unknown>();
  const password = `Local-${randomUUID()}`;

  async function request(path: string, method = "GET", body?: unknown, accessToken = token) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json", Connection: "close", Authorization: `Bearer ${accessToken}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }

  async function actor(role: string, projectId?: string) {
    const prisma = app.get(PrismaService);
    const phone = `136${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
    const user = await prisma.user.create({ data: { name: "模板合成岗位", phone,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: "合成岗位" }, update: {} });
    await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId } });
    const login = await request("/auth/login", "POST", { phone, password }, "");
    expect(login.status).toBe(201);
    sessions.set(login.body.tokens.accessToken, login.body);
    return login.body.tokens.accessToken as string;
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    const ownedRun = process.env.TASK_POL115_WORKBENCH_290_RUN_ID;
    const dedicated = ownedRun === undefined ? url.pathname === "/template_workbench" :
      /^[a-f0-9]{32}$/u.test(ownedRun) && process.env.NODE_ENV === "test" &&
      url.protocol === "postgresql:" && url.username === "jg_task01_owner" && !!url.port &&
      url.pathname === `/jg_task01_${ownedRun}` && url.searchParams.getAll("sslmode").join(",") === "require" &&
      url.searchParams.getAll("sslaccept").join(",") === "strict" &&
      /^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(url.searchParams.getAll("sslcert").join(","));
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !dedicated) {
      throw new Error("仅允许本机一次性模板工作台数据库");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    if (ownedRun !== undefined) {
      const current320 = process.env.TASK_POL115_WORKBENCH_EXACT_320 === "1";
      const textDirect = process.env.TASK_POL115_WORKBENCH_TEXT_DIRECT_330 === "1";
      const paymentRemainder = process.env.TASK_POL115_WORKBENCH_PAYMENT_REMAINDER_331 === "1";
      const upwardArchive = process.env.TASK_POL115_WORKBENCH_UPWARD_ARCHIVE_332 === "1";
      const historicalSettlement = process.env.TASK_POL115_WORKBENCH_HISTORICAL_SETTLEMENT_334 === "1";
      const expenseWitness = process.env.TASK_POL115_WORKBENCH_EXPENSE_WITNESS_346 === "1";
      const precision = process.env.TASK_POL115_WORKBENCH_EXPENSE_WITNESS_349 === "1";
      const company = process.env.TASK_POL115_WORKBENCH_COMPANY_HISTORY_352 === "1";
      const count = company ? 352 : precision ? 349 : expenseWitness ? 346 : historicalSettlement ? 334 : upwardArchive ? 332 : paymentRemainder ? 331 : textDirect ? 330 : current320 ? 329 : 295;
      const [witness] = await app.get(PrismaService).$queryRaw<Array<{ accepted: boolean }>>`
        SELECT (d.datname = ${url.pathname.slice(1)} AND d.datdba = 10 AND
          current_user = 'jg_task01_owner' AND current_user::regrole::oid = 10 AND current_user = session_user AND
          inet_server_addr() = '127.0.0.1'::inet AND inet_client_addr() = '127.0.0.1'::inet AND
          inet_server_port() = ${Number(url.port)}::integer AND
          EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) AND
          (SELECT COUNT(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = ${count} AND
          EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261119003500_fund_balance_correction_controlled_round'
            AND checksum = '8ea8b2a9c78210a7c4e42f4ddf7224fada84b2c4692dfbecc41477d3a8704f60') AND
          EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261119003800_company_transfer_ordinary_loan_multi_witness'
            AND checksum = 'e5b56cb299eb4a51eb094267fbf302b6fa6b40b31c0337c6dfcf628694d5de25') AND
          (NOT ${current320} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261127000000_contract_takeover_pending_finance'
            AND checksum = '0bfe144cae30a7a29973c06dfb51737965fb9709e408db412f8d137d0663db4e')) AND
          (NOT ${textDirect} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261128000000_text_agreement_direct_payment'
            AND checksum = '4d99963155b37e091f37db7a1648d2fed6e6464aee7c643002a3297b4120991c')) AND
          (NOT ${paymentRemainder} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261129000000_payment_remaining_withdrawal'
            AND checksum = '67593637957ba372cbba7633334fb9896ba6adf472b0c1b9b6f1482c0d645fc2')) AND
          (NOT ${upwardArchive} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261129001000_contract_upward_archive_verifier_pin_forward'
            AND checksum = '4e8e6e23267f525ca2bff68719e2989126fff82e5bd0d0ba344abc2c4c8d4da3')) AND
          (NOT ${historicalSettlement} OR (
            EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
              AND migration_name = '20261129002000_contract_takeover_no_grade_handover_checks'
              AND checksum = '4e41179d32a8e46eae83685eb8c071a112de5426e9ec5f6a6e6d320b4ef95f77') AND
            EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
              AND migration_name = '20261129003000_historical_signed_settlement_continuation'
              AND checksum = '9df6dc654b8b0ea21713cc1c1dbcc73a8a74fd49f0df84da3b1556e85215ad5f'))) AND
          (NOT ${expenseWitness} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261129015000_expense_public_cash_operating_source'
            AND checksum = 'd2f1419df6337020ad7dc5385b4b52a2997f276656dd3ff90f71d8c62f5c8b9a')) AND
          (NOT ${precision} OR EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            AND migration_name = '20261129018000_reimbursement_exact_cash_cost_links'
            AND checksum = '58b3cc0404a85a97dbb484654245d4bd042e5fb2014f32997244b2597cb5110b')) AND
          (NOT ${company} OR (
            EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
              AND migration_name = '20261129019000_signed_settlement_exact_operating_cost'
              AND checksum = '86ad90ea7fad6231f1d8b24dd8e4eb25d5ba0b1696d3544f5999680ebaa4c6e4') AND
            EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
              AND migration_name = '20261129021000_company_history_expense'
              AND checksum = '8cb43f1ae6a6fb6108280f1ea08df4d2d2edf7c060b39b37dfbeeaff7ae368e5')))) AS accepted
        FROM pg_catalog.pg_database d WHERE d.datname = current_database()
      `;
      if (witness?.accepted !== true) throw new Error("POL115_WORKBENCH_OWNED_282_DATABASE");
    }
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    token = await actor("contract_director");
  });

  afterAll(async () => { await app?.close(); });

  async function sourceFile() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("本期结算明细");
    sheet.addRow(["清单编码/行号", "清单项名称", "是否本期结算", "合同数量", "合同单价", "前期已结算数量", "本期数量", "累计结算数量", "剩余可结算数量", "本期结算金额(分)", "人工调整金额(分)", "调整原因", "证据说明", "异常说明", "备注"]);
    sheet.getCell("A6").value = "经办人签字：";
    sheet.getCell("H6").value = "审核人签字：";
    sheet.pageSetup.printArea = "A1:O6";
    sourceBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(sourceBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "结算模板合成样张.xlsx");
    const response = await fetch(`${base}/files`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Connection: "close" }, body: form });
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  async function createTemplate() {
    const xlsxFileId = await sourceFile();
    const values = { name: "结算工作台合成模板", code: `TW-${randomUUID()}`, xlsxFileId,
      compatibleContractTypeKeys: [], compatibleAmountRoles: [], compatiblePricingModes: [],
      columnSchema: { sheetName: "本期结算明细" }, printRules: {}, evidenceRules: { requiredColumns: ["证据说明"] }, anomalyRules: {}, definitionVersion: 2 };
    const created = await request("/settlement-template-workbench/templates", "POST", values);
    expect(created.status).toBe(201);
    return { ...created.body, values };
  }

  it("新工作台提供统一字段定义，原模板写路由继续退役", async () => {
    const capability = await request("/settlement-template-workbench/capability");
    expect(capability.status).toBe(200);
    expect(capability.body.definition).toMatchObject({ key: "settlement_template_version", version: 2 });
    expect(capability.body.definition.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "name", label: "模板名称", required: true }),
      expect.objectContaining({ key: "compatibleAmountRoles", type: "multi_select" })
    ]));
    expect((await request("/settlement-templates", "POST", {})).status).toBe(410);
  });

  it("新建沿用私有文件和字段规则，检查与真实双格式预览后冻结提交发布并回读", async () => {
    const created = await createTemplate();
    const versionId = created.version.id;
    const action = { expectedRevision: 1, definitionVersion: 2 };
    const path = `/settlement-template-workbench/versions/${versionId}`;
    const capability = await request(`${path}/capability`);
    expect(capability.status).toBe(200);
    expect(capability.body.workbenchActions).toContain("inspect");
    expect(capability.body.workbenchActions).not.toContain("publish");
    expect((await request(`${path}/submission`, "POST", action)).status).toBe(400);
    const inspected = await request(`${path}/inspection`, "POST", action);
    expect(inspected.status).toBe(201);
    expect(inspected.body.blockingErrors).toEqual([]);
    const preview = await request(`${path}/preview-generation`, "POST", action);
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ status: "succeeded", hasPreviewXlsx: true, hasPreviewPdf: true });
    const submitted = await request(`${path}/submission`, "POST", action);
    expect(submitted.status).toBe(201);
    const published = await request(`${path}/publication`, "POST", { ...action, changeSummary: "本机模板发布验收" });
    expect(published.status).toBe(201);
    const publishedCapability = await request(`${path}/capability`);
    expect(publishedCapability.body.workbenchActions).toEqual(expect.arrayContaining(["stop", "clone"]));
    expect(publishedCapability.body.workbenchActions).not.toContain("submit");
    const detail = await request(`/settlement-template-workbench/templates/${created.template.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.versions[0]).toMatchObject({ status: "published",
      submissionEntrySnapshot: { stage: "submission", draftRevision: 1, definitionVersion: 2,
        target: { entityId: versionId }, values: { name: created.values.name, code: created.values.code },
        domainValues: { columnSchema: { sheetName: "本期结算明细" }, printRules: {}, anomalyRules: {} } },
      publicationEntrySnapshot: { stage: "publication", changeSummary: "本机模板发布验收", draftRevision: 1 }
    });
    expect((await request(`/settlement-template-versions/${versionId}/publication`, "POST", { changeSummary: "旧入口" })).status).toBe(410);
  });

  it("创建响应丢失后同一身份原输入重试回读原版本，冲突输入不新建", async () => {
    const created = await createTemplate();
    const retry = await request("/settlement-template-workbench/templates", "POST", created.values);
    expect(retry.status).toBe(201);
    expect(retry.body.template.id).toBe(created.template.id);
    expect(retry.body.version.id).toBe(created.version.id);
    expect((await request("/settlement-template-workbench/templates", "POST", { ...created.values, name: "冲突名称" })).status).toBe(400);
  });

  it("同修订预览倒序完成时提交发布均冻结最终选定的真实样张", async () => {
    const created = await createTemplate();
    const path = `/settlement-template-workbench/versions/${created.version.id}`;
    const action = { expectedRevision: 1, definitionVersion: 2 };
    expect((await request(`${path}/inspection`, "POST", action)).status).toBe(201);
    const first = await request(`${path}/preview-generation`, "POST", action);
    const last = await request(`${path}/preview-generation`, "POST", action);
    expect(first.status).toBe(201); expect(last.status).toBe(201);
    const prisma = app.get(PrismaService);
    const a = await prisma.settlementTemplatePreviewJob.findUniqueOrThrow({ where: { id: first.body.id } });
    const b = await prisma.settlementTemplatePreviewJob.findUniqueOrThrow({ where: { id: last.body.id } });
    // Only the completion-order pointer is injected; both XLSX/PDF pairs were produced by the real public API.
    await prisma.settlementTemplateVersion.update({ where: { id: created.version.id }, data: {
      previewXlsxFileId: a.previewXlsxFileId, previewPdfFileId: a.previewPdfFileId
    } });
    expect((await request(`${path}/submission`, "POST", action)).status).toBe(201);
    expect((await request(`${path}/publication`, "POST", { ...action, changeSummary: "样张坐标一致性" })).status).toBe(201);
    const detail = await request(`/settlement-template-workbench/templates/${created.template.id}`);
    for (const key of ["submissionEntrySnapshot", "publicationEntrySnapshot"]) {
      expect(detail.body.versions[0][key].domainValues).toMatchObject({ previewXlsxFileId: b.previewXlsxFileId, previewPdfFileId: b.previewPdfFileId });
    }
  });

  it("岗位隔离、定义修订漂移和冻结状态均在写入前拒绝", async () => {
    const created = await createTemplate();
    const path = `/settlement-template-workbench/versions/${created.version.id}`;
    const action = { expectedRevision: 1, definitionVersion: 2 };
    const denied = await actor("contract_staff");
    expect((await request("/settlement-template-workbench/capability", "GET", undefined, denied)).status).toBe(403);
    expect((await request(`${path}/inspection`, "POST", action, denied)).status).toBe(403);
    const chairman = await actor("chairman");
    const project = await request("/projects", "POST", { code: `TW-P-${randomUUID()}`, name: "模板项目岗位隔离夹具", definitionVersion: 1 }, chairman);
    expect(project.status).toBe(201);
    const projectDirector = await actor("contract_director", project.body.id);
    expect((await request("/settlement-template-workbench/capability", "GET", undefined, projectDirector)).status).toBe(403);
    const otherAdmin = await actor("super_admin");
    expect((await request("/settlement-template-workbench/templates", "POST", { ...created.values, code: `TW-FOREIGN-${randomUUID()}` }, otherAdmin)).status).toBe(403);
    for (const invalid of [{ ...action, definitionVersion: 1 }, { ...action, expectedRevision: 2 }, {}]) {
      expect((await request(`${path}/inspection`, "POST", invalid)).status).toBe(400);
    }
    const oldMode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    try {
      process.env.OPERATIONAL_WRITE_FREEZE_MODE = "all";
      expect((await request(`${path}/inspection`, "POST", action)).status).toBe(503);
      expect((await request(`/settlement-template-workbench/templates/${created.template.id}`)).status).toBe(200);
    } finally {
      if (oldMode === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
      else process.env.OPERATIONAL_WRITE_FREEZE_MODE = oldMode;
    }
    const detail = await request(`/settlement-template-workbench/templates/${created.template.id}`);
    expect(detail.body.versions[0]).toMatchObject({ status: "draft", inspectionReport: null, submissionEntrySnapshot: null });
  });

  it("同一身份重复并发提交发布回读原快照，冲突身份或说明拒绝且快照不可覆盖", async () => {
    const created = await createTemplate();
    const path = `/settlement-template-workbench/versions/${created.version.id}`;
    const action = { expectedRevision: 1, definitionVersion: 2 };
    expect((await request(`${path}/inspection`, "POST", action)).status).toBe(201);
    expect((await request(`${path}/preview-generation`, "POST", action)).status).toBe(201);
    const submit = await Promise.all([request(`${path}/submission`, "POST", action), request(`${path}/submission`, "POST", action)]);
    expect(submit.map(result => result.status)).toEqual([201, 201]);
    const before = await request(`/settlement-template-workbench/templates/${created.template.id}`);
    const snapshot = before.body.versions[0].submissionEntrySnapshot;
    const other = await actor("super_admin");
    expect((await request(`${path}/capability`)).body.workbenchActions).toContain("submit");
    expect((await request(`${path}/capability`, "GET", undefined, other)).body.workbenchActions).not.toContain("submit");
    expect((await request(`${path}/submission`, "POST", action, other)).status).toBe(400);
    const publication = { ...action, changeSummary: "幂等发布回读" };
    const publish = await Promise.all([request(`${path}/publication`, "POST", publication), request(`${path}/publication`, "POST", publication)]);
    expect(publish.map(result => result.status)).toEqual([201, 201]);
    expect(publish[0].body).toEqual(publish[1].body);
    expect((await request(`${path}/capability`)).body.workbenchActions).toContain("publish");
    expect((await request(`${path}/capability`, "GET", undefined, other)).body.workbenchActions).not.toContain("publish");
    expect((await request(`${path}/publication`, "POST", { ...publication, changeSummary: "冲突说明" })).status).toBe(400);
    const after = await request(`/settlement-template-workbench/templates/${created.template.id}`);
    expect(after.body.versions[0].submissionEntrySnapshot).toEqual(snapshot);
    const prisma = app.get(PrismaService);
    await expect(prisma.$executeRaw`UPDATE "SettlementTemplateVersion" SET "submissionEntrySnapshot" = NULL WHERE id = ${created.version.id}`).rejects.toThrow();
    expect((await request(`/settlement-template-workbench/templates/${created.template.id}`)).body.versions[0]).toEqual(after.body.versions[0]);
  });

  it("快照持久化故障整笔回滚，修复后原请求可重试", async () => {
    const created = await createTemplate();
    const path = `/settlement-template-workbench/versions/${created.version.id}`;
    const action = { expectedRevision: 1, definitionVersion: 2 };
    expect((await request(`${path}/inspection`, "POST", action)).status).toBe(201);
    expect((await request(`${path}/preview-generation`, "POST", action)).status).toBe(201);
    const prisma = app.get(PrismaService);
    const fault = `tw_fault_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${created.version.id}' AND NEW."submissionEntrySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF;
      RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE UPDATE ON "SettlementTemplateVersion" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      expect((await request(`${path}/submission`, "POST", action)).status).toBe(500);
      expect((await request(`/settlement-template-workbench/templates/${created.template.id}`)).body.versions[0]).toMatchObject({ status: "draft", submissionEntrySnapshot: null });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fault}" ON "SettlementTemplateVersion"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
    }
    expect((await request(`${path}/submission`, "POST", action)).status).toBe(201);
  });

  it("发布审计故障回滚新版本及旧版本停用，重试后只留一条发布审计", async () => {
    const created = await createTemplate();
    const action = { expectedRevision: 1, definitionVersion: 2 };
    const original = `/settlement-template-workbench/versions/${created.version.id}`;
    for (const step of ["inspection", "preview-generation", "submission"]) expect((await request(`${original}/${step}`, "POST", action)).status).toBe(201);
    expect((await request(`${original}/publication`, "POST", { ...action, changeSummary: "原版本发布" })).status).toBe(201);
    const cloned = await request(`${original}/clone`, "POST", {});
    expect(cloned.status).toBe(201);
    const next = `/settlement-template-workbench/versions/${cloned.body.id}`;
    for (const step of ["inspection", "preview-generation", "submission"]) expect((await request(`${next}/${step}`, "POST", action)).status).toBe(201);
    const prisma = app.get(PrismaService);
    const fault = `tw_audit_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."businessId" = '${cloned.body.id}' AND NEW.action = 'settlement_template.publish' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      expect((await request(`${next}/publication`, "POST", { ...action, changeSummary: "新版本发布" })).status).toBe(500);
      const detail = await request(`/settlement-template-workbench/templates/${created.template.id}`);
      expect(detail.body.versions.find((version: { id: string }) => version.id === created.version.id)).toMatchObject({ status: "published", stoppedAt: null });
      expect(detail.body.versions.find((version: { id: string }) => version.id === cloned.body.id)).toMatchObject({ status: "submitted", publicationEntrySnapshot: null });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fault}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
    }
    const publication = { ...action, changeSummary: "新版本发布" };
    expect((await request(`${next}/publication`, "POST", publication)).status).toBe(201);
    expect((await request(`${next}/publication`, "POST", publication)).status).toBe(201);
    const auditor = await actor("super_admin");
    const audits = await request("/audit-logs?limit=100", "GET", undefined, auditor);
    expect(audits.status).toBe(200);
    const publicationAudits = await prisma.auditLog.findMany({ where: { action: "settlement_template.publish", businessId: cloned.body.id } });
    expect(publicationAudits).toHaveLength(1);
    expect(audits.body.rows.filter((entry: { id: string }) => entry.id === publicationAudits[0].id)).toHaveLength(1);
  });

  it("桌面与390px使用真实API验证取消、失败重试及完整发布历史", async () => {
    const storage = process.env.FILE_STORAGE_ROOT;
    if (!storage || !sourceBuffer) throw new Error("必须使用本轮独立本机文件夹具");
    const sourcePath = resolve(storage, "browser-source.xlsx");
    writeFileSync(sourcePath, sourceBuffer);
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, TEMPLATE_WORKBENCH_API_URL: base,
        TEMPLATE_WORKBENCH_SESSION: JSON.stringify(sessions.get(token)), TEMPLATE_WORKBENCH_SOURCE: sourcePath };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.template-workbench-real.config.ts", ...(process.env.TASK_POL115_WORKBENCH_290_WEB_ROOT ? ["--reporter=json"] : [])], {
        cwd: process.env.TASK_POL115_WORKBENCH_290_WEB_ROOT ?? resolve(__dirname, "../../../../apps/web-admin"),
        env: process.env.TASK_POL115_WORKBENCH_290_WEB_ROOT ? Object.fromEntries(Object.entries(env).filter(([name]) =>
          ["PATH", "HOME", "TMPDIR", "COREPACK_HOME", "PLAYWRIGHT_BROWSERS_PATH",
            "TEMPLATE_WORKBENCH_API_URL", "TEMPLATE_WORKBENCH_SESSION", "TEMPLATE_WORKBENCH_SOURCE", "PLAYWRIGHT_JSON_OUTPUT_FILE"].includes(name))) : env,
        stdio: "inherit"
      });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? done() : reject(new Error("模板工作台真实浏览器验证失败")));
    });
  }, 180_000);
});
