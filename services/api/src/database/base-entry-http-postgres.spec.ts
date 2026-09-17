import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
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

  async function actor(role: string) {
    const prisma = app.get(PrismaService);
    const actorPhone = `137${String(Date.now()).slice(-8)}`;
    const user = await prisma.user.create({ data: {
      name: "合作单位合成岗位", phone: actorPhone,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false
    } });
    const position = await prisma.position.upsert({
      where: { key: role }, create: { key: role, name: "合成岗位" }, update: {}
    });
    await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    const login = await request("/auth/login", "POST", { phone: actorPhone, password });
    expect(login.status).toBe(201);
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
