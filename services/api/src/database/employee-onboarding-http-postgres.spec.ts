import { verifyApprovedPdf } from "./approval-pdf-acceptance.test-support";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";
import * as bcrypt from "bcryptjs";
import { TencentSmsGateway } from "../auth/tencent-sms.gateway";
import { spawn } from "node:child_process";
import * as path from "node:path";

const describePostgres = process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;

describePostgres("员工入职公开 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let sequence = 10;
  const password = "Local-Onboarding-01";
  const sent: Array<{ phone: string; code: string }> = [];

  async function request(path: string, method = "GET", body?: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  async function actor(role: string) {
    const db = app.get(PrismaService);
    const phone = `1391000${String(sequence++).padStart(4, "0")}`;
    const user = await db.user.create({ data: { name: "合成审核人", phone,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "合成岗位" } });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    const login = await request("/auth/login", "POST", { phone, password });
    expect(login.status).toBe(201);
    const signature = new FormData();
    signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "验收签名.png");
    expect((await fetch(`${base}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${login.body.tokens.accessToken}` }, body: signature })).status).toBe(201);
    return { id: user.id, token: login.body.tokens.accessToken as string, phone };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/onboarding") {
      throw new Error("仅允许本机一次性 onboarding 数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TencentSmsGateway).useValue({ send: async (phone: string, code: string) => { sent.push({ phone, code }); } }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const [role] = await app.get(PrismaService).$queryRaw<Array<{ name: string; superuser: boolean; canDeleteApplications: boolean; canWriteLedger: boolean; canReadSecret: boolean }>>`
      SELECT current_user AS name, rolsuper AS superuser,
        has_table_privilege(current_user, 'public."EmployeeRegistration"', 'DELETE') AS "canDeleteApplications",
        has_table_privilege(current_user, 'public."OperatingFact"', 'INSERT') AS "canWriteLedger",
        has_table_privilege(current_user, 'public."OperatingLedgerWriteSecret"', 'SELECT') AS "canReadSecret"
      FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ name: "onboarding_runtime", superuser: false, canDeleteApplications: false, canWriteLedger: false, canReadSecret: false });
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it("员工提交注册后只能查看本人待审核申请，不能读取公司业务", async () => {
    const response = await fetch(`${base}/employee-onboarding/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "合成入职员工", phone: "13910000001", password: "Local-Onboarding-01" })
    });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.application).toMatchObject({ name: "合成入职员工", status: "pending" });
    expect(result.tokens).toBeUndefined();
    const business = await fetch(`${base}/projects`, { headers: { Authorization: `Bearer ${result.applicationToken}` } });
    expect(business.status).toBe(401);
    const own = await fetch(`${base}/employee-onboarding/mine`, { headers: { Authorization: `Bearer ${result.applicationToken}` } });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ status: "pending", name: "合成入职员工" });
    const login = await request("/employee-onboarding/login", "POST", { phone: "13910000001", password });
    expect(login.status).toBe(201);
    expect(login.body.applicationToken).toEqual(expect.any(String));
    const audits = () => app.get(PrismaService).auditLog.findMany({ where: {
      action: "auth.application.login", businessId: result.application.id
    } });
    expect(await audits()).toEqual([expect.objectContaining({ actorUserId: null,
      businessType: "employee_registration", metadata: { credentialVersion: 0, temporaryPasswordUsed: false } })]);
    expect((await request("/employee-onboarding/login", "POST", { phone: "13910000001", password: "Wrong-Password-01" })).status).toBe(401);
    expect(await audits()).toHaveLength(1);
  });

  it("综合部跨部门开通普通员工，财务岗位转董事长且仅批准一次", async () => {
    const comprehensive = await actor("comprehensive_director");
    const chairman = await actor("chairman");
    const technical = await actor("super_admin");
    const db = app.get(PrismaService);
    const department = await db.department.create({ data: { name: "合成入职部门" } });
    await db.position.upsert({ where: { key: "contract_staff" }, update: {}, create: { key: "contract_staff", name: "合同经办" } });
    await db.position.upsert({ where: { key: "finance_staff" }, update: {}, create: { key: "finance_staff", name: "财务经办" } });
    const ordinary = await request("/employee-onboarding/register", "POST", { name: "合成合同经办", phone: "13910000002", password });
    const body = { revision: 1, decision: "approve", departmentId: department.id,
      roles: [{ roleKey: "contract_staff" }], identityVerified: true, confirmationPassword: password };
    expect((await request(`/employee-onboarding/applications/${ordinary.body.application.id}/review`, "POST", body, comprehensive.token)).status).toBe(201);
    await verifyApprovedPdf({ db, baseUrl: base, token: comprehensive.token, password,
      businessType: "employee_registration", businessId: ordinary.body.application.id,
      roles: ["comprehensive_director"], label: "员工入职-综合部审批" });
    const login = await request("/auth/login", "POST", { phone: "13910000002", password });
    expect(login.body.user).toMatchObject({ name: "合成合同经办", mustChangePassword: false, roleKeys: ["contract_staff"] });
    const financial = await request("/employee-onboarding/register", "POST", { name: "合成财务经办", phone: "13910000003", password });
    const financialBody = { ...body, roles: [{ roleKey: "finance_staff" }] };
    const path = `/employee-onboarding/applications/${financial.body.application.id}/review`;
    for (const forbidden of [comprehensive, technical]) {
      expect((await request(path, "POST", financialBody, forbidden.token)).status).toBe(403);
    }
    const referred = await request(path, "POST", { ...financialBody, decision: "refer" }, comprehensive.token);
    expect(referred.status).toBe(201);
    expect(referred.body).toMatchObject({ status: "chairman_review", revision: 2 });
    expect((await request(path, "POST", { ...body, revision: 2 }, comprehensive.token)).status).toBe(403);
    const decision = { ...financialBody, revision: 2 };
    const concurrent = await Promise.all([request(path, "POST", decision, chairman.token), request(path, "POST", decision, chairman.token)]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([201, 409]);
    const financeLogin = await request("/auth/login", "POST", { phone: "13910000003", password });
    expect(financeLogin.body.user.roleKeys).toEqual(["finance_staff"]);
    expect((await request(path, "POST", decision, chairman.token)).status).toBe(409);
  });

  it("退回后本人原申请重提，其他凭证和已存在或停用账号不能绕过审核", async () => {
    const manager = await actor("comprehensive_director");
    const registered = await request("/employee-onboarding/register", "POST", { name: "待补姓名", phone: "13910000004", password });
    const id = registered.body.application.id;
    const returned = await request(`/employee-onboarding/applications/${id}/review`, "POST", {
      revision: 1, decision: "return", reason: "请核对真实姓名", confirmationPassword: password
    }, manager.token);
    expect(returned.status).toBe(201);
    expect((await request("/employee-onboarding/mine", "POST", { name: "已核对姓名", revision: 2 }, manager.token)).status).toBe(401);
    const retry = await request("/employee-onboarding/mine", "POST", { name: "已核对姓名", revision: 2 }, registered.body.applicationToken);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ id, name: "已核对姓名", status: "pending", revision: 3 });
    expect((await request("/employee-onboarding/mine", "POST", { name: "再次修改", revision: 2 }, registered.body.applicationToken)).status).toBe(409);
    for (const isActive of [true, false]) {
      await app.get(PrismaService).user.update({ where: { id: manager.id }, data: { isActive } });
      expect((await request("/employee-onboarding/register", "POST", { name: "重复账号", phone: manager.phone, password })).status).toBe(409);
    }
    expect((await request("/employee-onboarding/applications", "GET", undefined, registered.body.applicationToken)).status).toBe(401);
  });

  it("管理员重置按岗位分权，临时密码须修改，所有旧会话立即失效", async () => {
    const manager = await actor("comprehensive_director");
    const chairman = await actor("chairman");
    const ordinary = await actor("contract_staff");
    const finance = await actor("finance_staff");
    const oldLogin = await request("/auth/login", "POST", { phone: ordinary.phone, password });
    const input = { confirmationPassword: password, identityVerified: true };
    expect((await request(`/account-security/users/${finance.id}/reset-password`, "POST", input, manager.token)).status).toBe(403);
    expect((await request(`/account-security/users/${manager.id}/reset-password`, "POST", input, manager.token)).status).toBe(403);
    const reset = await request(`/account-security/users/${ordinary.id}/reset-password`, "POST", input, manager.token);
    expect(reset.status).toBe(201);
    expect(typeof reset.body.temporaryPassword).toBe("string");
    expect((await request("/projects", "GET", undefined, ordinary.token)).status).toBe(401);
    expect((await request("/auth/refresh", "POST", { refreshToken: oldLogin.body.tokens.refreshToken })).status).toBe(401);
    expect((await request("/auth/login", "POST", { phone: ordinary.phone, password })).status).toBe(401);
    const temporary = await request("/auth/login", "POST", { phone: ordinary.phone, password: reset.body.temporaryPassword });
    expect(temporary.body.user.mustChangePassword).toBe(true);
    expect((await request("/projects", "GET", undefined, temporary.body.tokens.accessToken)).status).toBe(403);
    const changed = await request("/auth/change-password", "POST", { name: "合成合同人员", oldPassword: reset.body.temporaryPassword, newPassword: "Local-Changed-02" }, temporary.body.tokens.accessToken);
    expect(changed.status).toBe(201);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await request("/projects", "GET", undefined, ordinary.token)).status).toBe(401);
    expect((await request("/projects", "GET", undefined, temporary.body.tokens.accessToken)).status).toBe(401);
    expect((await request(`/account-security/users/${finance.id}/reset-password`, "POST", input, chairman.token)).status).toBe(201);
  });

  it("代建和调岗入口不能绕过财务审核，普通账号可由综合部跨部门管理", async () => {
    const manager = await actor("comprehensive_director");
    const finance = await actor("finance_staff");
    const db = app.get(PrismaService);
    const department = await db.department.create({ data: { name: "综合部管理跨部门测试" } });
    const body = { phone: "13910000005", name: "合成人员", departmentId: department.id,
      initialRoleKey: "contract_staff", confirmationPassword: password };
    const created = await request("/organization/users", "POST", body, manager.token);
    expect(created.status).toBe(201);
    expect((await request("/organization/users", "POST", { ...body, phone: "13910000006", initialRoleKey: "finance_staff" }, manager.token)).status).toBe(403);
    expect((await request(`/organization/users/${finance.id}`, "PATCH", { departmentId: department.id, confirmationPassword: password }, manager.token)).status).toBe(403);
    expect((await request("/organization/role-additions/preview", "POST", { operation: "add", userId: created.body.id, scope: "global", roleKey: "finance_staff" }, manager.token)).status).toBe(403);
  });

  it("换手机号不能占用待审核申请，申请的身份与密码归属不会混淆", async () => {
    const person = await actor("employee");
    const pendingPhone = "13910000009";
    const registered = await request("/employee-onboarding/register", "POST", { phone: pendingPhone, name: "独立待审核申请人", password });
    expect(registered.status).toBe(201);
    expect((await request("/auth/profile", "PATCH", { name: "改号员工", phone: pendingPhone, currentPassword: password }, person.token)).status).toBe(409);
    expect((await app.get(PrismaService).user.findUniqueOrThrow({ where: { id: person.id } })).phone).toBe(person.phone);
  });

  it("董事长恢复码仅能使用一次，不恢复停用账号", async () => {
    const chairman = await actor("chairman");
    const generated = await request("/account-security/recovery-code", "POST", { confirmationPassword: password }, chairman.token);
    expect(generated.status).toBe(201);
    const input = { phone: chairman.phone, recoveryCode: generated.body.recoveryCode, newPassword: "Recovered-Password-02" };
    expect((await request("/account-security/recover", "POST", input)).status).toBe(201);
    expect((await request("/account-security/recover", "POST", input)).status).toBe(401);
    expect((await request("/projects", "GET", undefined, chairman.token)).status).toBe(401);
  });

  it("短信尚未配置时公开状态准确，不能伪造验证码重置或假装已经发送", async () => {
    const options = await request("/account-security/options");
    expect(options.status).toBe(200);
    expect(options.body.smsEnabled).toBe(false);
    expect((await request("/account-security/sms", "POST", { phone: "13910000007", purpose: "register" })).status).toBe(503);
    expect((await request("/account-security/reset-with-sms", "POST", { phone: "13910000007", code: "123456", newPassword: password })).status).toBe(503);
  });

  it("验证码绑定用途、一次消费且并发重发限流；注册验证不代替入职审核", async () => {
    const previous = { ...process.env };
    Object.assign(process.env, { SMS_ENABLED: "true", SMS_SECRET_ID: "local-only", SMS_SECRET_KEY: "local-only",
      SMS_SDK_APP_ID: "local-only", SMS_SIGN_NAME: "合成测试", SMS_TEMPLATE_ID: "local-only", SMS_CODE_SECRET: "local-only-code-secret-32-characters-long" });
    try {
      const phone = "13910000008";
      const concurrent = await Promise.all([1, 2].map(() => request("/account-security/sms", "POST", { phone, purpose: "register" })));
      expect(concurrent.map((result) => result.status).sort()).toEqual([201, 429]);
      expect(sent.filter((item) => item.phone === phone)).toHaveLength(1);
      const code = sent.find((item) => item.phone === phone)!.code;
      expect((await request("/account-security/reset-with-sms", "POST", { phone, code, newPassword: password })).status).toBe(400);
      const inputs = { name: "验证码注册员工", phone, code, password };
      const responses = await Promise.all([request("/employee-onboarding/register", "POST", inputs), request("/employee-onboarding/register", "POST", inputs)]);
      expect(responses.map((result) => result.status).sort()).toEqual([201, 400]);
      const row = await app.get(PrismaService).smsChallenge.findUniqueOrThrow({ where: { phone_purpose: { phone, purpose: "register" } } });
      expect(row.codeHash).not.toContain(code);
      expect(row.consumedAt).not.toBeNull();
      expect(responses.find((result) => result.status === 201)!.body.application).toMatchObject({ phoneVerified: true, status: "pending" });
      expect(await app.get(PrismaService).user.findUnique({ where: { phone } })).toBeNull();
    } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
  });

  it("验证码错误次数持久化，短信找回不重新启用账号，正确找回废止旧会话", async () => {
    const ordinary = await actor("employee");
    await app.get(PrismaService).user.update({ where: { id: ordinary.id }, data: { mustChangePassword: true } });
    const previous = { ...process.env };
    Object.assign(process.env, { SMS_ENABLED: "true", SMS_SECRET_ID: "local-only", SMS_SECRET_KEY: "local-only",
      SMS_SDK_APP_ID: "local-only", SMS_SIGN_NAME: "合成测试", SMS_TEMPLATE_ID: "local-only", SMS_CODE_SECRET: "local-only-code-secret-32-characters-long" });
    try {
      expect((await request("/account-security/sms", "POST", { phone: ordinary.phone, purpose: "reset" })).status).toBe(201);
      const code = sent.find((item) => item.phone === ordinary.phone)!.code;
      const input = { phone: ordinary.phone, code, newPassword: "Reset-By-Sms-01" };
      expect((await request("/account-security/reset-with-sms", "POST", input)).status).toBe(201);
      expect((await request("/projects", "GET", undefined, ordinary.token)).status).toBe(401);
      const ownPasswordLogin = await request("/auth/login", "POST", { phone: ordinary.phone, password: input.newPassword });
      expect(ownPasswordLogin.status).toBe(201);
      expect(ownPasswordLogin.body.user.mustChangePassword).toBe(false);
      const locked = await actor("employee");
      expect((await request("/account-security/sms", "POST", { phone: locked.phone, purpose: "reset" })).status).toBe(201);
      const lockedCode = sent.find((item) => item.phone === locked.phone)!.code;
      const wrongCode = lockedCode === "000000" ? "000001" : "000000";
      for (let n = 0; n < 5; n++) expect((await request("/account-security/reset-with-sms", "POST", { ...input, phone: locked.phone, code: wrongCode })).status).toBe(400);
      expect((await request("/account-security/reset-with-sms", "POST", { ...input, phone: locked.phone, code: lockedCode })).status).toBe(400);
      const db = app.get(PrismaService);
      expect((await db.smsChallenge.findUniqueOrThrow({ where: { phone_purpose: { phone: locked.phone, purpose: "reset" } } })).attempts).toBe(5);
      await db.user.update({ where: { id: locked.id }, data: { isActive: false } });
      expect((await request("/account-security/reset-with-sms", "POST", { ...input, phone: locked.phone, code: lockedCode })).status).toBe(400);
      expect((await db.user.findUniqueOrThrow({ where: { id: locked.id } })).isActive).toBe(false);
    } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
  });

  it("过期验证码与申请临时密码不能使用，重置后的本人设置密码仍需审核", async () => {
    const chairman = await actor("chairman");
    const phone = "13910000090";
    const registration = await request("/employee-onboarding/register", "POST", { phone, name: "临时密码验收", password });
    const id = registration.body.application.id;
    const resetInput = { confirmationPassword: password, identityVerified: true };
    const reset = await request(`/account-security/applications/${id}/reset-password`, "POST", resetInput, chairman.token);
    expect(reset.status).toBe(201);
    expect((await request("/employee-onboarding/mine", "GET", undefined, registration.body.applicationToken)).status).toBe(401);
    const temporary = await request("/employee-onboarding/login", "POST", { phone, password: reset.body.temporaryPassword });
    expect(temporary.body.application.mustChangePassword).toBe(true);
    const changed = await request("/employee-onboarding/mine/password", "POST", { newPassword: "Applicant-Own-Password" }, temporary.body.applicationToken);
    expect(changed.status).toBe(201);
    expect(changed.body.application).toMatchObject({ status: "pending", mustChangePassword: false });
    expect((await request("/projects", "GET", undefined, changed.body.applicationToken)).status).toBe(401);
    const resetAgain = await request(`/account-security/applications/${id}/reset-password`, "POST", resetInput, chairman.token);
    const db = app.get(PrismaService);
    await db.employeeRegistration.update({ where: { id }, data: { temporaryPasswordExpiresAt: new Date(Date.now() - 1) } });
    expect((await request("/employee-onboarding/login", "POST", { phone, password: resetAgain.body.temporaryPassword })).status).toBe(401);

    const previous = { ...process.env };
    Object.assign(process.env, { SMS_ENABLED: "true", SMS_SECRET_ID: "local-only", SMS_SECRET_KEY: "local-only",
      SMS_SDK_APP_ID: "local-only", SMS_SIGN_NAME: "合成测试", SMS_TEMPLATE_ID: "local-only", SMS_CODE_SECRET: "local-only-code-secret-32-characters-long" });
    try {
      const smsPhone = "13910000091";
      expect((await request("/account-security/sms", "POST", { phone: smsPhone, purpose: "register" })).status).toBe(201);
      const code = sent.find((item) => item.phone === smsPhone)!.code;
      await db.smsChallenge.update({ where: { phone_purpose: { phone: smsPhone, purpose: "register" } }, data: { expiresAt: new Date(Date.now() - 1) } });
      expect((await request("/employee-onboarding/register", "POST", { phone: smsPhone, name: "过期核验", password, code })).status).toBe(400);
      expect(await db.employeeRegistration.findFirst({ where: { phone: smsPhone, status: { not: "approved" } } })).toBeNull();
    } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
  });

  it("桌面和手机以真实页面完成隔离数据库入职与密码重置", async () => {
    const chairman = await actor("chairman");
    await app.get(PrismaService).department.create({ data: { name: "入职浏览器验收部门" } });
    const browserEnv: NodeJS.ProcessEnv = { ...process.env, ONBOARDING_API_URL: base, ONBOARDING_MANAGER_PHONE: chairman.phone };
    delete browserEnv.JEST_WORKER_ID;
    const output = await new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.employee-onboarding-real.config.ts"], {
        cwd: path.resolve(__dirname, "../../../.."),
        env: browserEnv,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (data) => { output += String(data); });
      child.stderr.on("data", (data) => { output += String(data); });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, output }));
    });
    if (output.status !== 0) throw new Error(output.output);
    console.info(output.output);
  }, 120_000);
});
