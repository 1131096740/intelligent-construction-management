import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthController } from "./auth.controller";
import { EmployeeOnboardingController } from "../organization/employee-onboarding.controller";
import { EmployeeOnboardingService } from "../organization/employee-onboarding.service";
import { AccountSecurityController } from "./account-security.controller";
import { AuthService } from "./auth.service";
import { AccountSecurityService } from "./account-security.service";
import { SmsVerificationService } from "./sms-verification.service";
import { AuthRateLimitService } from "./auth-rate-limit.service";
import { JwtTokenService } from "./jwt-token.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

// Only persistence and the SMS network boundary are synthetic. Controllers,
// validation, account policies, crypto, tokens and guards are the real modules.
type Row = Record<string, unknown>;
type Filter = { where: Row };
type Mutation = Filter & { data: Row };
type Upsert = Filter & { create: Row; update: Row };
function memoryPersistence() {
  const users: Row[] = [], challenges: Row[] = [], refresh: Row[] = [], applications: Row[] = [];
  const pendingPhones = new Set<string>();
  let lockConflict = false;
  const roles = new Map<string, string[]>();
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) return value.some(condition => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const condition = value as Row;
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      if (Object.hasOwn(condition, "not")) return row[key] !== condition.not;
      if (condition.gt instanceof Date) return row[key] instanceof Date && row[key] > condition.gt;
    }
    return row[key] === value;
  });
  const update = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value
        ? Number(row[key] ?? 0) + Number(value.increment) : value;
    }
    return { ...row };
  };
  const operations = {
    user: {
      findUnique: async ({ where }: Filter) => { const row = users.find(row => matches(row, where)); return row ? { ...row } : null; },
      findUniqueOrThrow: async ({ where }: Filter) => { const row = users.find(row => matches(row, where)); if (!row) throw { code: "P2025" }; return { ...row }; },
      update: async ({ where, data }: Mutation) => {
        const row = users.find(row => matches(row, where)); if (!row) throw { code: "P2025" };
        if (data.phone && users.some(other => other.id !== row.id && other.phone === data.phone)) throw { code: "P2002" };
        return update(row, data);
      },
      updateMany: async ({ where, data }: Mutation) => { const rows = users.filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; }
    },
    refreshToken: {
      create: async ({ data }: { data: Row }) => { const row = { id: randomUUID(), revokedAt: null, ...data }; refresh.push(row); return row; },
      updateMany: async ({ where, data }: Mutation) => { const rows = refresh.filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; },
      findUnique: async ({ where }: Filter) => { const row = refresh.find(row => matches(row, where)); return row ? { ...row, user: users.find(user => user.id === row.userId) } : null; },
      update: async ({ where, data }: Mutation) => { const row = refresh.find(row => matches(row, where)); if (!row) throw { code: "P2025" }; return update(row, data); }
    },
    smsChallenge: {
      findFirst: async ({ where }: Filter) => challenges.filter(row => matches(row, where)).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null,
      findUnique: async ({ where }: Filter) => challenges.find(row => matches(row, where.phone_purpose as Row)) ?? null,
      upsert: async ({ where, create, update: data }: Upsert) => { const row = challenges.find(row => matches(row, where.phone_purpose as Row)); if (row) return update(row, data); challenges.push({ ...create }); return create; },
      update: async ({ where, data }: Mutation) => update(challenges.find(row => matches(row, where))!, data),
      updateMany: async ({ where, data }: Mutation) => { const rows = challenges.filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; }
    },
    authRateLimit: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({ hits: 1 }) },
    employeeRegistration: {
      findFirst: async ({ where }: Filter) => applications.find(row => matches(row, where)) ?? (pendingPhones.has(String(where.phone)) ? { id: "pending", userId: null } : null),
      findUnique: async ({ where }: Filter) => { const row = applications.find(row => matches(row, where)); return row ? { ...row } : null; },
      findUniqueOrThrow: async ({ where }: Filter) => { const row = applications.find(row => matches(row, where)); if (!row) throw { code: "P2025" }; return { ...row }; },
      update: async ({ where, data }: Mutation) => update(applications.find(row => matches(row, where))!, data),
      updateMany: async ({ where, data }: Mutation) => { const rows = applications.filter(row => matches(row, where)); rows.forEach(row => update(row, data)); return { count: rows.length }; }
    },
    personnelChange: { findFirst: async () => null, create: async ({ data }: { data: Row }) => data },
    userPosition: { findMany: async ({ where }: Filter) => (roles.get(String(where.userId)) ?? []).map(key => ({ positionId: key, projectId: null })).filter(() => (where.projectId as Row | undefined)?.not !== null) },
    position: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(key => ({ id: key, key })) },
    projectMember: { findMany: async () => [] },
    auditLog: { create: async ({ data }: { data: Row }) => data },
    $executeRaw: async () => {
      if (lockConflict) { lockConflict = false; throw new Prisma.PrismaClientKnownRequestError("synthetic serialization failure", { code: "P2010", clientVersion: "5.22.0", meta: { code: "40001" } }); }
      return 0;
    },
    $queryRaw: async () => []
  };
  const db = { ...operations, $transaction: async <T>(callback: (tx: typeof operations) => Promise<T>) => callback(operations) };
  return { db: db as unknown as PrismaService, failNextPhoneLock() { lockConflict = true; }, reservePhone(phone: string) { pendingPhones.add(phone); },
    async addApplication(id: string, phone: string) {
      applications.push({ id, phone, name: "合成申请人", passwordHash: await bcrypt.hash("synthetic-current-password", 4),
        status: "pending", mustChangePassword: true, credentialVersion: 0, revision: 0, temporaryPasswordExpiresAt: null, createdAt: new Date() });
    },
    async add(id: string, phone: string, role: string, mustChangePassword = false, isActive = true) {
      users.push({ id, phone, name: "合成人员", isActive, passwordHash: await bcrypt.hash("synthetic-current-password", 4),
        sessionVersion: 0, mustChangePassword, temporaryPasswordExpiresAt: null }); roles.set(id, [role]);
    }
  };
}

describe("任务04公开账号安全接口（内存持久层、模拟短信，无PG）", () => {
  let app: INestApplication;
  let base: string;
  let state: ReturnType<typeof memoryPersistence>;
  let environment: NodeJS.ProcessEnv;
  let sms: SmsVerificationService;
  let sentCode: string;
  function enableSms() {
    process.env.SMS_ENABLED = "true";
    for (const key of ["SMS_SECRET_ID", "SMS_SECRET_KEY", "SMS_SDK_APP_ID", "SMS_SIGN_NAME", "SMS_TEMPLATE_ID", "SMS_CODE_SECRET"]) process.env[key] = randomUUID();
  }
  async function request(path: string, body?: object, token?: string, method = "POST") {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5_000) });
    return { status: response.status, body: await response.json() };
  }
  async function login(phone = "13800000001", password = "synthetic-current-password") {
    return request("/auth/login", { phone, password });
  }
  beforeEach(async () => {
    environment = { ...process.env };
    process.env.JWT_ACCESS_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
    process.env.SMS_ENABLED = "false";
    state = memoryPersistence(); await state.add("employee", "13800000001", "employee"); await state.add("manager", "13800000002", "chairman");
    const tokens = new JwtTokenService();
    sms = new SmsVerificationService(state.db, new AuthRateLimitService(state.db), { send: async (_phone: string, code: string) => { sentCode = code; } } as never);
    const auth = new AuthService(state.db, tokens, new AuditService(), sms);
    const security = new AccountSecurityService(state.db, auth, new AuditService(), sms);
    const module = await Test.createTestingModule({ controllers: [AuthController, AccountSecurityController, EmployeeOnboardingController],
      providers: [{ provide: EmployeeOnboardingService, useValue: new EmployeeOnboardingService(state.db, auth, tokens, new AuditService(), sms) }, { provide: AuthService, useValue: auth }, { provide: AccountSecurityService, useValue: security }] }).compile();
    app = module.createNestApplication({ logger: false }); app.useGlobalPipes(createApiValidationPipe());
    const reflector = new Reflector(); app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, state.db), new PermissionGuard(reflector, state.db));
    await app.listen(0, "127.0.0.1"); base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); process.env = environment; jest.useRealTimers(); });

  it("短信不可用时拒绝更换本人手机号，旧号仍可登录", async () => {
    const session = await login();
    const changed = await request("/auth/profile", { name: "合成人员", phone: "13900000001", currentPassword: "synthetic-current-password" }, session.body.tokens.accessToken, "PATCH");
    expect(changed.status).toBe(503);
    expect((await login()).status).toBe(201);
    expect((await login("13900000001")).status).toBe(401);
  });
  it("管理员重置为受控初始策略，不返回密码，旧会话失效且首次改密前不能业务", async () => {
    process.env.INITIAL_USER_TEMPORARY_PASSWORD = "synthetic-controlled-initial";
    const previous = await login();
    const manager = await login("13800000002");
    const reset = await request("/account-security/users/employee/reset-password", {
      identityVerified: true, confirmationPassword: "synthetic-current-password"
    }, manager.body.tokens.accessToken);
    expect(reset.status).toBe(201);
    expect(reset.body).toEqual({ ok: true, mustChangePassword: true });
    expect((await login()).status).toBe(401);
    expect((await request("/auth/refresh", { refreshToken: previous.body.tokens.refreshToken })).status).toBe(401);
    const initial = await login("13800000001", "synthetic-controlled-initial");
    expect(initial.status).toBe(201);
    expect(initial.body.user.mustChangePassword).toBe(true);
    const profile = { name: "合成人员", phone: "13800000001", currentPassword: "synthetic-controlled-initial" };
    expect((await request("/auth/profile", profile, previous.body.tokens.accessToken, "PATCH")).status).toBe(401);
    expect((await request("/auth/profile", profile, initial.body.tokens.accessToken, "PATCH")).status).toBe(403);
  });

  it("管理员代办必须验证新号码，保持人员身份，旧号和原会话停用", async () => {
    enableSms();
    const employee = await login(); const manager = await login("13800000002"); const token = manager.body.tokens.accessToken;
    const sent = await request("/account-security/users/employee/phone-change-sms", { phone: "13900000001" }, token);
    expect(sent.status).toBe(201);
    const result = await request("/account-security/users/employee/change-phone", {
      phone: "13900000001", code: sentCode, confirmationPassword: "synthetic-current-password"
    }, token);
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ ok: true });
    expect((await login()).status).toBe(401);
    const newSession = await login("13900000001");
    expect(newSession.status).toBe(201);
    expect(newSession.body.user.id).toBe(employee.body.user.id);
    expect((await request("/auth/profile", { name: "旧会话", phone: "13900000001", currentPassword: "synthetic-current-password" }, employee.body.tokens.accessToken, "PATCH")).status).toBe(401);
  });

  it("首次改密不能沿用初始密码；设置本人密码后才能办理业务", async () => {
    await state.add("first-login", "13800000003", "employee", true);
    const session = await login("13800000003");
    const first = { name: "合成人员", oldPassword: "synthetic-current-password", newPassword: "synthetic-current-password" };
    const token = session.body.tokens.accessToken;
    expect((await request("/auth/change-password", first, token)).status).toBe(400);
    const changed = await request("/auth/change-password", { ...first, newPassword: "synthetic-personal-password" }, token);
    expect(changed.status).toBe(201);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect(changed.body.user.id).toBe(session.body.user.id);
    expect((await request("/auth/profile", { name: "本人确认", phone: "13800000003", currentPassword: "synthetic-personal-password" }, changed.body.tokens.accessToken, "PATCH")).status).toBe(200);
  });

  it("本人验证新号后身份不变，旧号码不可再登录，新号码可用于忘密", async () => {
    enableSms();
    jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "performance", "hrtime"] }); const session = await login(); const token = session.body.tokens.accessToken;
    expect((await request("/account-security/phone-change-sms", { phone: "13900000001" }, token)).status).toBe(201);
    const changed = await request("/auth/profile", { name: "本人确认", phone: "13900000001", currentPassword: "synthetic-current-password", code: sentCode }, token, "PATCH");
    expect(changed.status).toBe(200);
    expect(changed.body.user.id).toBe(session.body.user.id);
    expect((await login()).status).toBe(401);
    expect((await login("13900000001")).status).toBe(201);
    jest.setSystemTime(Date.now() + 60_001);
    const reset = await request("/account-security/sms", { phone: "13900000001", purpose: "reset" });
    expect(reset.status).toBe(201);
  });

  it("忘密验证码只使用一次；新密码生效且旧密码和会话失效", async () => {
    enableSms(); const session = await login();
    expect((await request("/account-security/sms", { phone: "13800000001", purpose: "reset" })).status).toBe(201);
    const input = { phone: "13800000001", code: sentCode, newPassword: "synthetic-reset-password" };
    expect((await request("/account-security/reset-with-sms", input)).status).toBe(201);
    expect((await request("/account-security/reset-with-sms", { ...input, newPassword: "synthetic-replay-password" })).status).toBe(400);
    expect((await login()).status).toBe(401);
    expect((await request("/auth/refresh", { refreshToken: session.body.tokens.refreshToken })).status).toBe(401);
    expect((await login("13800000001", "synthetic-reset-password")).status).toBe(201);
    expect((await request("/auth/profile", { name: "失效会话", phone: "13800000001", currentPassword: "synthetic-reset-password" }, session.body.tokens.accessToken, "PATCH")).status).toBe(401);
  });

  it("超过五分钟的验证码不能找回密码", async () => {
    enableSms();
    jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "performance", "hrtime"] });
    await request("/account-security/sms", { phone: "13800000001", purpose: "reset" });
    const code = sentCode; jest.setSystemTime(Date.now() + 300_001);
    expect((await request("/account-security/reset-with-sms", { phone: "13800000001", code, newPassword: "synthetic-reset-password" })).status).toBe(400);
    expect((await login()).status).toBe(201);
  });

  it("连续五次输错后即使输入正确验证码也被拒绝", async () => {
    enableSms(); await request("/account-security/sms", { phone: "13800000001", purpose: "reset" });
    const correct = sentCode; const wrong = correct === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) expect((await request("/account-security/reset-with-sms", { phone: "13800000001", code: wrong, newPassword: "synthetic-reset-password" })).status).toBe(400);
    expect((await request("/account-security/reset-with-sms", { phone: "13800000001", code: correct, newPassword: "synthetic-reset-password" })).status).toBe(400);
    expect((await login()).status).toBe(201);
  });

  it("已有号码和普通员工的管理员代办请求不能变更他人账号", async () => {
    enableSms(); const session = await login(); const token = session.body.tokens.accessToken;
    expect((await request("/account-security/users/manager/phone-change-sms", { phone: "13900000001" }, token)).status).toBe(403);
    expect((await request("/account-security/users/manager/change-phone", { phone: "13900000001", code: "000000", confirmationPassword: "synthetic-current-password" }, token)).status).toBe(403);
    expect((await request("/auth/profile", { name: "合成人员", phone: "13800000002", currentPassword: "synthetic-current-password", code: "000000" }, token, "PATCH")).status).toBe(400);
    expect((await login()).body.user.id).toBe(session.body.user.id);
  });

  it("停用账号不能登录、忘密或由管理员修改号码及重置", async () => {
    enableSms(); await state.add("disabled", "13800000004", "employee", false, false);
    expect((await login("13800000004")).status).toBe(401);
    await request("/account-security/sms", { phone: "13800000004", purpose: "reset" });
    expect((await request("/account-security/reset-with-sms", { phone: "13800000004", code: "000000", newPassword: "synthetic-reset-password" })).status).toBe(400);
    const manager = await login("13800000002"); const token = manager.body.tokens.accessToken;
    expect((await request("/account-security/users/disabled/phone-change-sms", { phone: "13900000004" }, token)).status).toBe(400);
    process.env.INITIAL_USER_TEMPORARY_PASSWORD = "synthetic-controlled-initial";
    expect((await request("/account-security/users/disabled/reset-password", { identityVerified: true, confirmationPassword: "synthetic-current-password" }, token)).status).toBe(400);
  });

  it("新号码被并发占用时拒绝改号，原账号仍能登录", async () => {
    enableSms(); const session = await login(); const token = session.body.tokens.accessToken;
    await request("/account-security/phone-change-sms", { phone: "13900000001" }, token);
    const code = sentCode; await state.add("concurrent", "13900000001", "employee");
    expect((await request("/auth/profile", { name: "合成人员", phone: "13900000001", currentPassword: "synthetic-current-password", code }, token, "PATCH")).status).toBe(409);
    expect((await login()).body.user.id).toBe(session.body.user.id);
  });

  it("管理员代办验证码不能由另一管理员使用，综合主管不能代办财务账号", async () => {
    enableSms(); await state.add("other-manager", "13800000005", "chairman"); await state.add("director", "13800000006", "comprehensive_director");
    await state.add("finance", "13800000007", "finance_staff");
    const manager = await login("13800000002"); const other = await login("13800000005");
    await request("/account-security/users/employee/phone-change-sms", { phone: "13900000001" }, manager.body.tokens.accessToken);
    expect((await request("/account-security/users/employee/change-phone", { phone: "13900000001", code: sentCode, confirmationPassword: "synthetic-current-password" }, other.body.tokens.accessToken)).status).toBe(400);
    expect((await login()).status).toBe(201);
    const director = await login("13800000006");
    expect((await request("/account-security/users/finance/phone-change-sms", { phone: "13900000007" }, director.body.tokens.accessToken)).status).toBe(403);
  });

  it("未批准入职申请的号码保持占用，短信关闭也不能绕过既有号码冲突", async () => {
    state.reservePhone("13900000001"); const session = await login();
    const result = await request("/auth/profile", { name: "合成人员", phone: "13900000001", currentPassword: "synthetic-current-password" }, session.body.tokens.accessToken, "PATCH");
    expect(result.status).toBe(409);
    expect((await login()).status).toBe(201);
  });

  it("待审核申请重置后的首次改密也不能沿用原密码，改密不自动开通业务", async () => {
    await state.addApplication("application", "13800000008");
    process.env.INITIAL_USER_TEMPORARY_PASSWORD = "synthetic-controlled-initial";
    const manager = await login("13800000002");
    const reset = await request("/account-security/applications/application/reset-password", { identityVerified: true, confirmationPassword: "synthetic-current-password" }, manager.body.tokens.accessToken);
    expect(reset.status).toBe(201);
    expect(reset.body).toEqual({ ok: true, mustChangePassword: true });
    const session = await request("/employee-onboarding/login", { phone: "13800000008", password: "synthetic-controlled-initial" });
    expect(session.status).toBe(201);
    expect((await request("/employee-onboarding/mine/password", { newPassword: "synthetic-controlled-initial" }, session.body.applicationToken)).status).toBe(400);
    const changed = await request("/employee-onboarding/mine/password", { newPassword: "synthetic-applicant-password" }, session.body.applicationToken);
    expect(changed.status).toBe(201);
    expect(changed.body.application).toMatchObject({ id: "application", status: "pending", mustChangePassword: false });
    expect((await request("/auth/profile", { name: "未开通申请", phone: "13800000008", currentPassword: "synthetic-applicant-password" }, changed.body.applicationToken, "PATCH")).status).toBe(401);
  });

  it("初始密码受控配置缺失时重置失败关闭，原密码仍有效", async () => {
    delete process.env.INITIAL_USER_TEMPORARY_PASSWORD;
    const manager = await login("13800000002");
    const result = await request("/account-security/users/employee/reset-password", { identityVerified: true, confirmationPassword: "synthetic-current-password" }, manager.body.tokens.accessToken);
    expect(result.status).toBe(503);
    expect((await login()).status).toBe(201);
  });

  it("管理员改号遇到号码锁序列化冲突时返回中文可重试冲突且原号保留", async () => {
    enableSms(); const manager = await login("13800000002");
    await request("/account-security/users/employee/phone-change-sms", { phone: "13900000001" }, manager.body.tokens.accessToken);
    const code = sentCode; state.failNextPhoneLock();
    const result = await request("/account-security/users/employee/change-phone", { phone: "13900000001", code, confirmationPassword: "synthetic-current-password" }, manager.body.tokens.accessToken);
    expect(result.status).toBe(409);
    expect(result.body.message).toBe("账号或申请状态已变化，请刷新后重新操作");
    expect((await login()).status).toBe(201);
  });

  it("管理员重置的初始凭据保留24小时有效期，到期不能再登录", async () => {
    process.env.INITIAL_USER_TEMPORARY_PASSWORD = "synthetic-controlled-initial";
    const manager = await login("13800000002");
    expect((await request("/account-security/users/employee/reset-password", { identityVerified: true, confirmationPassword: "synthetic-current-password" }, manager.body.tokens.accessToken)).status).toBe(201);
    expect((await login("13800000001", "synthetic-controlled-initial")).status).toBe(201);
    jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "performance", "hrtime"] });
    jest.setSystemTime(Date.now() + 86_400_001);
    expect((await login("13800000001", "synthetic-controlled-initial")).status).toBe(401);
  });

});
