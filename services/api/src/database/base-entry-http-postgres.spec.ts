import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../app.module";
import { PrismaService } from "./prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";

const describePostgres = process.env.RUN_POL113_HTTP_PG16 === "1" ? describe : describe.skip;

describePostgres("基础资料公开 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let userId: string;
  let token: string;
  const sessions = new Map<string, unknown>();
  let participatingCompanyId: string;
  const password = `Local-${randomUUID()}`;
  const phone = `139${String(Date.now()).slice(-8)}`;

  async function request(path: string, method = "GET", body?: unknown, accessToken = token) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Connection: "close", Authorization: `Bearer ${accessToken}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/pol113") {
      throw new Error("仅允许本机一次性 pol113 数据库");
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    // Only synthetic account bootstrap; all behavior under test uses real HTTP.
    const user = await app.get(PrismaService).user.create({ data: {
      name: "资料测试经办人", phone, passwordHash: await bcrypt.hash(password, 4),
      mustChangePassword: false
    } });
    userId = user.id;
    const login = await request("/auth/login", "POST", { phone, password });
    expect(login.status).toBe(201);
    token = login.body.tokens.accessToken;
  });

  afterAll(async () => { await app?.close(); });

  async function actor(role: string, projectId?: string) {
    const prisma = app.get(PrismaService);
    const actorPhone = `137${String(Date.now()).slice(-8)}`;
    const user = await prisma.user.create({ data: {
      name: "合作单位合成岗位", phone: actorPhone,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false
    } });
    const position = await prisma.position.upsert({
      where: { key: role }, create: { key: role, name: "合成岗位" }, update: {}
    });
    await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId } });
    const login = await request("/auth/login", "POST", { phone: actorPhone, password });
    expect(login.status).toBe(201);
    sessions.set(login.body.tokens.accessToken, login.body);
    return login.body.tokens.accessToken as string;
  }

  async function partyIntent(accessToken: string, name: string, idempotencyKey = randomUUID()) {
    // Public creation protocol's canonical payload: alphabetical keys, no optional credit code.
    const fingerprint = createHash("sha256").update(JSON.stringify({ attachments: [], name, type: "organization" })).digest("hex");
    const probe = await request("/business-entry-definitions/business-party/create/probe", "POST", { idempotencyKey, fingerprint }, accessToken);
    expect(probe.status).toBe(201);
    const query = new URLSearchParams({ operation: "edit", targetEntityType: "business_party", targetCreateTarget: probe.body.createTarget });
    const definition = await request(`/business-entry-definitions/business_party?${query}`, "GET", undefined, accessToken);
    expect(definition.status).toBe(200);
    const submission = await request("/business-entry-definitions/business-party/create/submission-target", "POST", {
      idempotencyKey, fingerprint, probe: probe.body.createTarget
    }, accessToken);
    expect(submission.status).toBe(201);
    return { fingerprint, body: {
      target: submission.body.target, definitionKey: definition.body.key,
      definitionVersion: definition.body.version, idempotencyKey, values: { name }
    } };
  }

  async function participatingCompany() {
    if (participatingCompanyId) return participatingCompanyId;
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().replaceAll("-", "");
    // Synthetic master-data bootstrap only: the retired company write route stays unavailable.
    const company = await prisma.companyEntity.create({ data: {
      name: "参与主体合成验收公司",
      unifiedSocialCreditCode: `POL113${suffix.slice(0, 12)}`,
      dataStatus: "complete", currentVersionNo: 1, isActive: true
    } });
    await prisma.companyEntityVersion.create({ data: {
      companyEntityId: company.id, versionNo: 1, name: company.name,
      unifiedSocialCreditCode: company.unifiedSocialCreditCode,
      isActive: true, action: "test_master", actorUserId: userId
    } });
    const contract = await actor("contract_staff");
    const activeCompanies = await request("/company-entities", "GET", undefined, contract);
    expect(activeCompanies.status).toBe(200);
    expect(activeCompanies.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: company.id, name: company.name })
    ]));
    participatingCompanyId = company.id;
    return participatingCompanyId;
  }

  it("项目创建能力返回统一定义，原创建事务冻结真实项目目标", async () => {
    const chairman = await actor("chairman");
    const capability = await request("/projects/create-capability", "GET", undefined, chairman);
    expect(capability.status).toBe(200);
    expect(capability.body.definition).toMatchObject({ key: "project_create", entityType: "project", version: 1 });
    const values = { code: `P113-${randomUUID()}`, name: "创建快照合成项目" };
    const created = await request("/projects", "POST", { ...values, definitionVersion: capability.body.definition.version }, chairman);
    expect(created.status).toBe(201);
    expect(created.body.entrySnapshot).toMatchObject({
      sceneKey: "project_create", target: { entityType: "project", entityId: created.body.id },
      revision: 1, values
    });
  });

  it("项目预检无写，空字段过时定义及冻结故障不留下项目审计快照", async () => {
    const chairman = await actor("chairman");
    const prisma = app.get(PrismaService);
    const values = { code: `P113-${randomUUID()}`, name: "创建失败零残留验收" };
    for (const denied of [await actor("super_admin"), await actor("finance_staff")]) {
      expect((await request("/projects/create-validation", "POST", values, denied)).status).toBe(403);
      expect((await request("/projects", "POST", values, denied)).status).toBe(403);
    }
    const counts = async () => ({ projects: await prisma.project.count(), snapshots: await prisma.businessEntrySubmissionSnapshot.count(), audits: await prisma.auditLog.count() });
    const before = await counts();
    expect((await request("/projects/create-validation", "POST", { ...values, definitionVersion: 1 }, chairman)).body.valid).toBe(true);
    expect(await counts()).toEqual(before);
    for (const invalid of [{ ...values, code: "  " }, { ...values, name: "  " }, { ...values, definitionVersion: 999 }]) {
      expect((await request("/projects", "POST", invalid, chairman)).status).toBe(400);
      expect(await counts()).toEqual(before);
    }
    const fault = `pol113_fault_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."sceneKey" = 'project_create' AND NEW."valuesSnapshot"->>'code' = '${values.code}' THEN
          RAISE EXCEPTION 'POL113 synthetic snapshot persistence failure';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "BusinessEntrySubmissionSnapshot" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      expect((await request("/projects", "POST", values, chairman)).status).toBe(500);
      expect((await request("/projects", "GET", undefined, chairman)).body.some((project: { code: string }) => project.code === values.code)).toBe(false);
      expect(await counts()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fault}" ON "BusinessEntrySubmissionSnapshot"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
    }
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_trigger WHERE tgname = ${fault}`).toEqual([{ count: 0n }]);
    const saved = await request("/projects", "POST", values, chairman);
    expect(saved.status).toBe(201);
    const history = await request(`/projects/${saved.body.id}/operating-profile`, "GET", undefined, chairman);
    expect(history.body.entrySnapshots).toEqual(expect.arrayContaining([expect.objectContaining({ sceneLabel: "新建项目", values })]));
  });

  it("停止参与按真实参与关系冻结，项目归属来自服务端锁行", async () => {
    const chairman = await actor("chairman");
    const created = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "停止参与快照合成项目" }, chairman);
    const projectId = created.body.id as string;
    const finance = await actor("finance_staff", projectId);
    const companyEntityId = await participatingCompany();
    const added = await request(`/projects/${projectId}/participating-companies`, "POST", {
      companyEntityId, effectiveFrom: "2026-01-01", changeReason: "合成停止验收"
    }, finance);
    expect(added.status).toBe(201);
    const admin = await actor("super_admin");
    for (const [scene, entityType, entityId, allowed, denied, values] of [
      ["project_create", "project", projectId, chairman, finance, { code: "测试编号", name: "测试项目" }],
      ["project_participating_company_deactivate", "project_participating_company", added.body.id, finance, chairman, { endedOn: "2026-09-17", changeReason: "授权预检" }]
    ] as const) {
      const query = new URLSearchParams({ projectId, operation: "edit", targetEntityType: entityType, targetEntityId: entityId });
      const definitionPath = `/business-entry-definitions/${scene}?${query}`;
      expect((await request(definitionPath, "GET", undefined, allowed)).status).toBe(200);
      for (const actorToken of [denied, admin]) expect((await request(definitionPath, "GET", undefined, actorToken)).status).toBe(403);
      const payload = { target: { entityType, entityId }, definitionVersion: 1, operation: "edit", values };
      const validationPath = `/business-entry-definitions/${scene}/validate?projectId=${projectId}`;
      expect((await request(validationPath, "POST", payload, allowed)).body.valid).toBe(true);
      expect((await request(validationPath, "POST", { ...payload, target: { entityType, entityId: randomUUID() } }, allowed)).status).toBe(400);
      expect((await request(validationPath, "POST", { ...payload, target: { entityType: "company_entity", entityId } }, allowed)).status).toBe(400);
      const frozen = await request(`/business-entry-definitions/${scene}/freeze?projectId=${projectId}`, "POST", payload, allowed);
      expect(frozen.status).toBe(400);
      expect(frozen.body.message).toBe("该场景须通过原领域提交入口在同一事务中冻结");
    }
    const profilePath = `/projects/${projectId}/operating-profile`;
    const profile = await request(profilePath, "GET", undefined, finance);
    expect(profile.body.deactivationDefinition).toMatchObject({ key: "project_participating_company_deactivate" });
    const input = { endedOn: "2026-09-17", changeReason: "合成停止完成", definitionVersion: profile.body.deactivationDefinition.version };
    const path = `/projects/${projectId}/participating-companies/${added.body.id}/deactivation`;
    expect((await request(`${path}/validate`, "POST", input, finance)).body.valid).toBe(true);
    const stopped = await request(path, "PATCH", input, finance);
    expect(stopped.status).toBe(200);
    expect(stopped.body.entrySnapshot).toMatchObject({
      sceneKey: "project_participating_company_deactivate",
      target: { entityType: "project_participating_company", entityId: added.body.id }, revision: 1,
      values: { endedOn: input.endedOn, changeReason: input.changeReason }
    });
    expect((await request(path, "PATCH", input, finance)).status).toBe(400);
    const persisted = await request(profilePath, "GET", undefined, finance);
    const historyJson = JSON.stringify(persisted.body.entrySnapshots);
    expect(historyJson).not.toContain(added.body.id);
    expect(historyJson).not.toContain(projectId);
    expect(historyJson).not.toContain("definitionSnapshot");
    expect(historyJson).not.toContain("valuesSnapshot");
    expect(historyJson).not.toContain("snapshotId");
    expect(persisted.body.entrySnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ sceneLabel: "停止新增业务", companyName: "参与主体合成验收公司",
        values: { endedOn: "2026-09-17", changeReason: "合成停止完成" } })
    ]));
  });

  it("停止参与拒绝错岗位、跨项目、伪归属及过时定义，失败不改变关系或冻结历史", async () => {
    const chairman = await actor("chairman");
    const created = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "停止参与负向合成项目" }, chairman);
    const projectId = created.body.id as string;
    const finance = await actor("finance_staff", projectId);
    const added = await request(`/projects/${projectId}/participating-companies`, "POST", {
      companyEntityId: await participatingCompany(), effectiveFrom: "2026-01-01", changeReason: "合成负向验收"
    }, finance);
    const path = `/projects/${projectId}/participating-companies/${added.body.id}/deactivation`;
    const input = { endedOn: "2026-09-17", changeReason: "合成负向停止", definitionVersion: 1 };
    for (const denied of [chairman, await actor("super_admin"), await actor("finance_staff")]) {
      expect((await request(`${path}/validate`, "POST", input, denied)).status).toBe(403);
      expect((await request(path, "PATCH", input, denied)).status).toBe(403);
    }
    for (const key of ["projectId", "companyEntityId", "companyEntityVersionId"]) {
      expect((await request(path, "PATCH", { ...input, [key]: randomUUID() }, finance)).status).toBe(400);
    }
    expect((await request(path, "PATCH", { ...input, definitionVersion: 999 }, finance)).status).toBe(400);
    const other = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "跨项目停止验收" }, chairman);
    const otherFinance = await actor("finance_staff", other.body.id);
    expect((await request(`/projects/${other.body.id}/participating-companies/${added.body.id}/deactivation`, "PATCH", input, otherFinance)).status).toBe(404);
    const profile = await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance);
    expect(profile.body.participatingCompanies).toEqual(expect.arrayContaining([expect.objectContaining({ id: added.body.id, endedAt: null })]));
    expect(profile.body.entrySnapshots.filter((snapshot: { sceneLabel: string }) => snapshot.sceneLabel === "停止新增业务")).toEqual([]);
  });

  it("停止参与审计故障回滚状态及快照，清理注入后原请求成功", async () => {
    const chairman = await actor("chairman");
    const created = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "停止回滚验收" }, chairman);
    const projectId = created.body.id as string;
    const finance = await actor("finance_staff", projectId);
    const added = await request(`/projects/${projectId}/participating-companies`, "POST", {
      companyEntityId: await participatingCompany(), effectiveFrom: "2026-01-01", changeReason: "回滚前原因"
    }, finance);
    const path = `/projects/${projectId}/participating-companies/${added.body.id}/deactivation`;
    const profilePath = `/projects/${projectId}/operating-profile`;
    const input = { endedOn: "2026-09-17", changeReason: "回滚后停止", definitionVersion: 1 };
    const prisma = app.get(PrismaService);
    const beforeAudits = await prisma.auditLog.count({ where: { businessId: added.body.id } });
    const beforeProfile = (await request(profilePath, "GET", undefined, finance)).body;
    expect((await request(`${path}/validate`, "POST", input, finance)).body.valid).toBe(true);
    expect((await request(profilePath, "GET", undefined, finance)).body).toEqual(beforeProfile);
    expect(await prisma.auditLog.count({ where: { businessId: added.body.id } })).toBe(beforeAudits);
    const fault = `pol113_fault_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'project.participating_company.deactivate' AND NEW."businessId" = '${added.body.id}' THEN
          RAISE EXCEPTION 'POL113 synthetic deactivation audit failure';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      expect((await request(path, "PATCH", input, finance)).status).toBe(500);
      expect((await request(profilePath, "GET", undefined, finance)).body).toEqual(beforeProfile);
      expect(await prisma.businessEntrySubmissionSnapshot.count({ where: { entityId: added.body.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { businessId: added.body.id } })).toBe(beforeAudits);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fault}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
    }
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_trigger WHERE tgname = ${fault}`).toEqual([{ count: 0n }]);
    expect((await request(path, "PATCH", input, finance)).status).toBe(200);
    const current = (await request(profilePath, "GET", undefined, finance)).body;
    expect(current.participatingCompanies).toEqual(expect.arrayContaining([expect.objectContaining({ id: added.body.id, endedAt: "2026-09-17" })]));
    expect(current.entrySnapshots.filter((snapshot: { sceneLabel: string }) => snapshot.sceneLabel === "停止新增业务")).toHaveLength(1);
  });

  it("当前项目财务可预检并保存同一经营档案字段，其他项目及全局财务不可借用权限", async () => {
    const chairman = await actor("chairman");
    const created = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "统一档案合成项目" }, chairman);
    expect(created.status).toBe(201);
    const projectId = created.body.id as string;
    const finance = await actor("finance_staff", projectId);
    const globalFinance = await actor("finance_staff");
    const otherProject = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "其他合成项目" }, chairman);
    expect(otherProject.status).toBe(201);
    const otherFinance = await actor("finance_director", otherProject.body.id);
    const target = { entityType: "project", entityId: projectId };
    const query = new URLSearchParams({ projectId, operation: "edit", targetEntityType: "project", targetEntityId: projectId });
    const definition = await request(`/business-entry-definitions/project_operating_profile?${query}`, "GET", undefined, finance);
    expect(definition.status).toBe(200);
    expect(definition.body.fields.map((field: { key: string }) => field.key)).toEqual([
      "operatingLedgerEffectiveDate", "takeoverCompletedDate", "takeoverStatus"
    ]);
    const values = { operatingLedgerEffectiveDate: null, takeoverCompletedDate: null, takeoverStatus: "balance_review" };
    const payload = { definitionVersion: definition.body.version, target, values, operation: "edit" };
    const validationPath = `/business-entry-definitions/project_operating_profile/validate?projectId=${projectId}`;
    const validation = await request(validationPath, "POST", payload, finance);
    expect(validation.status).toBe(201);
    expect(validation.body.valid).toBe(true);
    for (const deniedActor of [globalFinance, otherFinance, chairman]) {
      expect((await request(validationPath, "POST", payload, deniedActor)).status).toBe(403);
      expect((await request(`/projects/${projectId}/operating-profile`, "PATCH", values, deniedActor)).status).toBe(403);
    }
    const invalid = await request(validationPath, "POST", { ...payload, values: { ...values, takeoverStatus: "takeover_completed" } }, finance);
    expect(invalid.body.valid).toBe(false);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body.takeoverStatus).toBe("preparing");
    const saved = await request(`/projects/${projectId}/operating-profile`, "PATCH", validation.body.values, finance);
    expect(saved.status).toBe(200);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body).toMatchObject(values);
    if (process.env.RUN_POL113_PROJECT_BROWSER === "1") {
      const prisma = app.get(PrismaService);
      const withdrawalFinance = await actor("finance_staff", projectId);
      const financeSession = sessions.get(withdrawalFinance) as { user: { id: string } };
      const financePosition = await prisma.position.findUniqueOrThrow({ where: { key: "finance_staff" } });
      const retainedProject = await request("/projects", "POST", {
        code: `P113-${randomUUID()}`, name: "撤权不受影响合成项目"
      }, chairman);
      expect(retainedProject.status).toBe(201);
      await prisma.userPosition.create({ data: {
        userId: financeSession.user.id, positionId: financePosition.id, projectId: retainedProject.body.id
      } });
      const callbackSecret = randomUUID();
      const roleFixture = createServer(async (incoming, response) => {
        if (incoming.url === `/${callbackSecret}/revoke` && incoming.method === "POST") {
          await prisma.userPosition.deleteMany({ where: {
            userId: financeSession.user.id, positionId: financePosition.id, projectId
          } });
          response.writeHead(204).end();
          return;
        }
        if (incoming.url === `/${callbackSecret}/restore` && incoming.method === "POST") {
          await prisma.userPosition.upsert({
            where: { userId_positionId_projectId: {
              userId: financeSession.user.id, positionId: financePosition.id, projectId
            } },
            create: { userId: financeSession.user.id, positionId: financePosition.id, projectId },
            update: {}
          });
          response.writeHead(204).end();
          return;
        }
        response.writeHead(404).end();
      });
      await new Promise<void>((resolveListen) => roleFixture.listen(0, "127.0.0.1", resolveListen));
      const fixtureAddress = roleFixture.address();
      if (!fixtureAddress || typeof fixtureAddress === "string") throw new Error("撤权夹具未监听本机端口");
      const settingsAccounts: Record<string, { phone: string; newPhone: string; password: string }> = {};
      const participantProjects: Record<string, { id: string; code: string; name: string }> = {};
      const constructionProjects: Record<string, { id: string; code: string; name: string }> = {};
      for (const [index, browser] of ["desktop", "mobile"].entries()) {
        const isolated = await request("/projects", "POST", { code: `PB113-${browser}-${randomUUID()}`, name: `参与停止独立${browser}项目` }, chairman);
        expect(isolated.status).toBe(201);
        participantProjects[browser] = isolated.body;
        const construction = await request("/projects", "POST", { code: `CE113-${browser}-${randomUUID()}`, name: `施工企业独立${browser}项目` }, chairman);
        expect(construction.status).toBe(201);
        constructionProjects[browser] = construction.body;
        // Synthetic role bootstrap only; project and participant facts use original HTTP.
        const session = sessions.get(finance) as { user: { id: string } };
        await prisma.userPosition.create({ data: { userId: session.user.id, positionId: financePosition.id, projectId: isolated.body.id } });
        await prisma.userPosition.create({ data: { userId: session.user.id, positionId: financePosition.id, projectId: construction.body.id } });
        const suffix = `${String(Date.now()).slice(-7)}${index}`;
        const account = { phone: `136${suffix}`, newPhone: `135${suffix}`, password: `Local-${randomUUID()}` };
        // Account bootstrap only; profile mutations and observations use public HTTP.
        await app.get(PrismaService).user.create({ data: {
          name: "本人资料浏览器合成账号", phone: account.phone,
          passwordHash: await bcrypt.hash(account.password, 4), mustChangePassword: false
        } });
        settingsAccounts[browser] = account;
      }
      await participatingCompany();
      const contract = await actor("contract_staff");
      const enterpriseIntent = await partyIntent(contract, "浏览器施工企业验收");
      expect((await request("/business-parties", "POST", enterpriseIntent.body, contract)).status).toBe(201);
      try {
        await new Promise<void>((done, reject) => {
          const browserEnv: NodeJS.ProcessEnv = { ...process.env, POL113_API_URL: base, POL113_PROJECT_ID: projectId, POL113_BROWSER_SESSION: JSON.stringify(sessions.get(finance)), POL113_RENAME_SESSION: JSON.stringify(sessions.get(chairman)), POL113_SETTINGS_ACCOUNTS: JSON.stringify(settingsAccounts) };
          delete browserEnv.JEST_WORKER_ID;
          browserEnv.POL113_PARTY_SESSION = JSON.stringify(sessions.get(contract));
          browserEnv.POL113_WITHDRAWAL_SESSION = JSON.stringify(sessions.get(withdrawalFinance));
          browserEnv.POL113_ROLE_FIXTURE_URL = `http://127.0.0.1:${fixtureAddress.port}/${callbackSecret}`;
          browserEnv.POL113_RETAINED_PROJECT_ID = retainedProject.body.id;
          browserEnv.POL113_PARTICIPANT_PROJECTS = JSON.stringify(participantProjects);
          browserEnv.POL113_CONSTRUCTION_PROJECTS = JSON.stringify(constructionProjects);
          const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol113-project-real.config.ts"], {
            cwd: resolve(__dirname, "../../../../apps/web-admin"),
            env: browserEnv,
            stdio: "inherit"
          });
          child.on("error", reject);
          child.on("exit", (code) => code === 0 ? done() : reject(new Error("项目档案真实浏览器验证失败")));
        });
      } finally {
        await new Promise<void>((resolveClose, rejectClose) => roleFixture.close((error) => error ? rejectClose(error) : resolveClose()));
      }
    }
  }, 210_000);

  it("项目名称沿用原董事长总经理岗位范围，空白名称不写入且有效名称可回读", async () => {
    const chairman = await actor("chairman");
    const project = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "重命名前合成项目" }, chairman);
    expect(project.status).toBe(201);
    const projectId = project.body.id as string;
    const query = new URLSearchParams({ projectId, operation: "edit", targetEntityType: "project", targetEntityId: projectId });
    const definition = await request(`/business-entry-definitions/project_rename?${query}`, "GET", undefined, chairman);
    expect(definition.status).toBe(200);
    expect(definition.body.fields.map((field: { key: string }) => field.key)).toEqual(["name"]);
    const target = { entityType: "project", entityId: projectId };
    const payload = { definitionVersion: definition.body.version, target, operation: "edit", values: { name: "  新项目名称  " } };
    const path = `/business-entry-definitions/project_rename/validate?projectId=${projectId}`;
    const scopedManager = await actor("general_manager", projectId);
    const other = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "其他重命名项目" }, chairman);
    const otherManager = await actor("general_manager", other.body.id);
    const admin = await actor("super_admin");
    for (const denied of [otherManager, admin]) {
      expect((await request(path, "POST", payload, denied)).status).toBe(403);
      expect((await request(`/projects/${projectId}`, "PATCH", payload.values, denied)).status).toBe(403);
    }
    const invalid = await request(path, "POST", { ...payload, values: { name: "  " } }, chairman);
    expect(invalid.body.valid).toBe(false);
    expect((await request("/projects", "GET", undefined, chairman)).body.find((entry: { id: string }) => entry.id === projectId).name).toBe("重命名前合成项目");
    for (const allowed of [chairman, scopedManager]) {
      const valid = await request(path, "POST", payload, allowed);
      expect(valid.status).toBe(201);
      expect(valid.body.valid).toBe(true);
      expect((await request(`/projects/${projectId}`, "PATCH", valid.body.values, allowed)).status).toBe(200);
    }
    expect((await request("/projects", "GET", undefined, chairman)).body.find((entry: { id: string }) => entry.id === projectId).name).toBe("新项目名称");
  });

  it("项目财务按统一字段绑定施工企业，空白原因零写入且保存沿原事务回读", async () => {
    const chairman = await actor("chairman");
    const project = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "施工企业绑定合成项目" }, chairman);
    expect(project.status).toBe(201);
    const projectId = project.body.id as string;
    const finance = await actor("finance_director", projectId);
    const contract = await actor("contract_staff");
    const intent = await partyIntent(contract, `施工企业合成${randomUUID()}`);
    const party = await request("/business-parties", "POST", intent.body, contract);
    expect(party.status).toBe(201);
    const options = await request(`/projects/${projectId}/construction-enterprise-options`, "GET", undefined, finance);
    expect(options.body.some((entry: { id: string }) => entry.id === party.body.version.id)).toBe(true);
    const target = { entityType: "project", entityId: projectId };
    const query = new URLSearchParams({ projectId, operation: "edit", targetEntityType: "project", targetEntityId: projectId });
    const definition = await request(`/business-entry-definitions/project_construction_enterprise?${query}`, "GET", undefined, finance);
    expect(definition.status).toBe(200);
    expect(definition.body.fields.map((field: { key: string }) => field.key)).toEqual(["businessPartyVersionId", "effectiveFrom", "changeReason"]);
    const values = { businessPartyVersionId: party.body.version.id, effectiveFrom: "2026-01-01", changeReason: "首次绑定验收" };
    const payload = { definitionVersion: definition.body.version, target, operation: "edit", values };
    const validatePath = `/business-entry-definitions/project_construction_enterprise/validate?projectId=${projectId}`;
    const globalFinance = await actor("finance_director");
    for (const denied of [chairman, globalFinance]) {
      expect((await request(validatePath, "POST", payload, denied)).status).toBe(403);
      expect((await request(`/projects/${projectId}/construction-enterprise`, "POST", values, denied)).status).toBe(403);
    }
    const invalid = await request(validatePath, "POST", { ...payload, values: { ...values, changeReason: " " } }, finance);
    expect(invalid.body.valid).toBe(false);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body.constructionEnterprise).toBeNull();
    const valid = await request(validatePath, "POST", payload, finance);
    expect(valid.body.valid).toBe(true);
    expect((await request(`/projects/${projectId}/construction-enterprise`, "POST", { ...valid.body.values, effectiveFrom: `${values.effectiveFrom}T00:00:00.000Z` }, finance)).status).toBe(201);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body.constructionEnterprise).toMatchObject({ businessPartyVersionId: party.body.version.id, effectiveFrom: "2026-01-01", isLocked: false });
  });

  it("项目财务通过统一字段加入完整公司，空白原因不新增并按原关系回读", async () => {
    const chairman = await actor("chairman");
    const created = await request("/projects", "POST", { code: `P113-${randomUUID()}`, name: "参与公司合成项目" }, chairman);
    expect(created.status).toBe(201);
    const projectId = created.body.id as string;
    const finance = await actor("finance_staff", projectId);
    const companyEntityId = await participatingCompany();
    const query = new URLSearchParams({ projectId, operation: "edit", targetEntityType: "project", targetEntityId: projectId });
    const definition = await request(`/business-entry-definitions/project_participating_company_add?${query}`, "GET", undefined, finance);
    expect(definition.status).toBe(200);
    expect(definition.body.fields.map((field: { key: string }) => field.key)).toEqual(["companyEntityId", "effectiveFrom", "changeReason"]);
    const values = { companyEntityId, effectiveFrom: "2026-01-01", changeReason: "加入项目验收" };
    const payload = { definitionVersion: definition.body.version, target: { entityType: "project", entityId: projectId }, operation: "edit", values };
    const validationPath = `/business-entry-definitions/project_participating_company_add/validate?projectId=${projectId}`;
    const path = `/projects/${projectId}/participating-companies`;
    const globalFinance = await actor("finance_staff");
    for (const denied of [chairman, globalFinance]) {
      expect((await request(validationPath, "POST", payload, denied)).status).toBe(403);
      expect((await request(path, "POST", values, denied)).status).toBe(403);
    }
    const invalid = await request(validationPath, "POST", { ...payload, values: { ...values, changeReason: " " } }, finance);
    expect(invalid.body.valid).toBe(false);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body.participatingCompanies).toEqual([]);
    const valid = await request(validationPath, "POST", payload, finance);
    expect(valid.body.valid).toBe(true);
    const added = await request(path, "POST", valid.body.values, finance);
    expect(added.status).toBe(201);
    expect((await request(`/projects/${projectId}/operating-profile`, "GET", undefined, finance)).body.participatingCompanies).toEqual([
      expect.objectContaining({ id: added.body.id, companyEntityId, effectiveFrom: "2026-01-01", changeReason: "加入项目验收", status: "active" })
    ]);
    expect((await request(path, "POST", valid.body.values, finance)).status).toBe(400);
  });

  it("本人字段定义和服务端预检拒绝原账号规则不接受的手机号", async () => {
    const target = { entityType: "user_self_profile", entityId: userId };
    const query = new URLSearchParams({
      operation: "edit", targetEntityType: target.entityType, targetEntityId: userId
    });
    const definition = await request(`/business-entry-definitions/user_self_profile?${query}`);
    expect(definition.status).toBe(200);
    const validation = await request("/business-entry-definitions/user_self_profile/validate", "POST", {
      definitionVersion: definition.body.version, target,
      values: { name: "资料测试经办人", phone: "123" }, operation: "edit"
    });
    expect(validation.status).toBe(201);
    expect(validation.body).toMatchObject({ valid: false, errors: [
      expect.objectContaining({ fieldKey: "phone" })
    ] });
  });

  it("姓名沿用 Unicode 字符边界，资料保存后原认证接口回读新姓名手机号", async () => {
    const target = { entityType: "user_self_profile", entityId: userId };
    const query = new URLSearchParams({ operation: "edit", targetEntityType: target.entityType, targetEntityId: userId });
    const definition = await request(`/business-entry-definitions/user_self_profile?${query}`);
    const name = "𠮷".repeat(100);
    const newPhone = `138${phone.slice(3)}`;
    for (const [value, valid] of [[name, true], ["𠮷".repeat(101), false], ["  ", false]] as const) {
      const validation = await request("/business-entry-definitions/user_self_profile/validate", "POST", {
        definitionVersion: definition.body.version, target,
        values: { name: value, phone: newPhone }, operation: "edit"
      });
      expect(validation.body.valid).toBe(valid);
    }
    const denied = await request("/auth/profile", "PATCH", { name, phone: newPhone, currentPassword: "wrong-password" });
    expect(denied.status).toBe(400);
    expect((await request("/auth/login", "POST", { phone, password })).body.user.name).toBe("资料测试经办人");
    const saved = await request("/auth/profile", "PATCH", { name, phone: newPhone, currentPassword: password });
    expect(saved.status).toBe(200);
    expect(saved.body.user).toMatchObject({ id: userId, name, phone: newPhone });
    token = saved.body.tokens.accessToken;
    expect((await request("/auth/login", "POST", { phone: newPhone, password })).body.user)
      .toMatchObject({ id: userId, name, phone: newPhone });
    expect((await request("/auth/login", "POST", { phone, password })).status).toBe(401);
  });

  it("合同岗沿专用创建链成功，重放与并发只返回一个可回读合作单位", async () => {
    const accessToken = await actor("contract_staff");
    expect((await request("/business-parties/create-capability", "GET", undefined, accessToken)).status).toBe(200);
    const name = `合作单位并发验收${randomUUID()}`;
    const intent = await partyIntent(accessToken, name);
    const resultPath = `/business-parties/creation-result?${new URLSearchParams({ idempotencyKey: intent.body.idempotencyKey, fingerprint: intent.fingerprint })}`;
    expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "missing" });
    const validation = await request("/business-entry-definitions/business-party/create/validate", "POST", {
      definitionVersion: intent.body.definitionVersion, target: intent.body.target, values: intent.body.values
    }, accessToken);
    expect(validation.body.valid).toBe(true);
    expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "missing" });
    const results = await Promise.all([0, 1].map(() => request("/business-parties", "POST", intent.body, accessToken)));
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const partyId = results[0].body.party.id;
    expect(results[1].body.party.id).toBe(partyId);
    expect((await request("/business-parties", "POST", intent.body, accessToken)).body.party.id).toBe(partyId);
    expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "completed", partyId });
    const list = await request(`/business-parties?query=${encodeURIComponent(name)}`, "GET", undefined, accessToken);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: partyId, name });
  });

  it.each([
    "chairman", "general_manager", "engineering_department_director", "finance_staff",
    "finance_director", "budget_director", "material_director", "comprehensive_director", "super_admin"
  ])("%s 无法签发或提交合作单位创建", async (role) => {
    const accessToken = await actor(role);
    expect((await request("/business-parties/create-capability", "GET", undefined, accessToken)).status).toBe(403);
    expect((await request("/business-entry-definitions/business-party/create/probe", "POST", {
      idempotencyKey: randomUUID(), fingerprint: "a".repeat(64)
    }, accessToken)).status).toBe(403);
    expect((await request("/business-parties", "POST", { values: { name: "未授权合成单位" } }, accessToken)).status).toBe(403);
  });

  it("目标过期、定义漂移、不同用户和异指纹均拒绝且没有创建结果", async () => {
    const accessToken = await actor("contract_director");
    const other = await actor("contract_staff");
    const name = `合作单位拒绝验收${randomUUID()}`;
    const intent = await partyIntent(accessToken, name);
    const resultPath = `/business-parties/creation-result?${new URLSearchParams({ idempotencyKey: intent.body.idempotencyKey, fingerprint: intent.fingerprint })}`;
    expect((await request("/business-parties", "POST", {
      ...intent.body, definitionVersion: intent.body.definitionVersion + 1
    }, accessToken)).status).toBe(400);
    expect((await request("/business-parties", "POST", intent.body, other)).status).toBe(400);
    expect((await request("/business-parties", "POST", {
      ...intent.body, values: { name: `${name}改动` }
    }, accessToken)).status).toBe(400);
    // Time is an external boundary; signed targets and real HTTP/services stay intact.
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now + 301_000);
    try {
      expect((await request("/business-parties", "POST", intent.body, accessToken)).status).toBe(400);
      const expired = await request("/business-entry-definitions/business-party/create/validate", "POST", {
        target: intent.body.target, definitionVersion: intent.body.definitionVersion, values: intent.body.values
      }, accessToken);
      expect(expired.status).toBe(400);
    } finally { clock.mockRestore(); }
    expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "missing" });
    expect((await request(`/business-parties?query=${encodeURIComponent(name)}`, "GET", undefined, accessToken)).body).toEqual([]);
  });

  it("审计持久化故障令创建原子回滚，移除本用例故障后同一请求可成功", async () => {
    const accessToken = await actor("contract_staff");
    const name = `合作单位回滚验收${randomUUID()}`;
    const intent = await partyIntent(accessToken, name);
    const resultPath = `/business-parties/creation-result?${new URLSearchParams({ idempotencyKey: intent.body.idempotencyKey, fingerprint: intent.fingerprint })}`;
    const prisma = app.get(PrismaService);
    const fault = `pol113_fault_${randomUUID().replaceAll("-", "")}`;
    // Database system-boundary fault injection, scoped to this synthetic intent.
    // Existing triggers and domain services remain untouched.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fault}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'business_party.create' AND NEW.metadata->>'idempotencyKey' = '${intent.body.idempotencyKey}' THEN
          RAISE EXCEPTION 'POL113 synthetic audit persistence failure';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${fault}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${fault}"()`);
      expect((await request("/business-parties", "POST", intent.body, accessToken)).status).toBe(500);
      expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "missing" });
      expect((await request(`/business-parties?query=${encodeURIComponent(name)}`, "GET", undefined, accessToken)).body).toEqual([]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fault}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${fault}"()`);
    }
    const residual = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_trigger WHERE tgname = ${fault}`;
    expect(residual[0].count).toBe(0n);
    const saved = await request("/business-parties", "POST", intent.body, accessToken);
    expect(saved.status).toBe(201);
    expect((await request(resultPath, "GET", undefined, accessToken)).body).toEqual({ status: "completed", partyId: saved.body.party.id });
  });
});
