import * as bcrypt from "bcryptjs";
import { AuditService } from "../audit/audit.service";
import { AccountSecurityService } from "../auth/account-security.service";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { SmsVerificationService } from "../auth/sms-verification.service";
import { TencentSmsGateway } from "../auth/tencent-sms.gateway";
import { EmployeeOnboardingService } from "../organization/employee-onboarding.service";
import { OrganizationService } from "../organization/organization.service";
import { PrismaService } from "./prisma.service";

const describePostgres = process.env.RUN_EMPLOYEE_PHONE_REUSE_PG16 === "1" || process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;

describePostgres("已批准入职历史手机号复用 / 公开服务与 PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let db: PrismaService;
  let auth: AuthService;
  let onboarding: EmployeeOnboardingService;
  let accounts: AccountSecurityService;
  let organization: OrganizationService;
  let sequence = Date.now() % 100_000_000;
  const password = "Local-Phone-Reuse-01";
  const sent: Array<{ phone: string; code: string }> = [];
  const environment = new Map<string, string | undefined>();
  const phone = () => `137${String(sequence++).padStart(8, "0")}`;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !["/phone_reuse", "/onboarding"].includes(url.pathname)) {
      throw new Error("仅允许本机一次性 phone_reuse/onboarding 数据库");
    }
    const settings = { SMS_ENABLED: "false", SMS_SECRET_ID: "local-test", SMS_SECRET_KEY: "local-test",
      SMS_SDK_APP_ID: "local-test", SMS_SIGN_NAME: "合成测试", SMS_TEMPLATE_ID: "local-test",
      SMS_CODE_SECRET: "local-phone-reuse-only-secret-000001", INITIAL_USER_TEMPORARY_PASSWORD: "Local-Initial-Only-01" };
    for (const [key, value] of Object.entries(settings)) { environment.set(key, process.env[key]); process.env[key] = value; }
    db = new PrismaService();
    await db.$connect();
    const [role] = await db.$queryRaw<Array<{ name: string; superuser: boolean }>>`
      SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ name: url.pathname === "/onboarding" ? "onboarding_runtime" : "phone_reuse_runtime", superuser: false });
    const audit = new AuditService(db);
    const tokens = new JwtTokenService();
    const gateway = { send: async (number: string, code: string) => { sent.push({ phone: number, code }); } } as TencentSmsGateway;
    const sms = new SmsVerificationService(db, new AuthRateLimitService(db), gateway);
    auth = new AuthService(db, tokens, audit, sms);
    onboarding = new EmployeeOnboardingService(db, auth, tokens, audit, sms);
    accounts = new AccountSecurityService(db, auth, audit, sms);
    organization = new OrganizationService(db, auth, audit);
  });

  beforeEach(() => { process.env.SMS_ENABLED = "false"; });
  afterAll(async () => {
    await db?.$disconnect();
    for (const [key, value] of environment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  async function user() {
    return db.user.create({ data: { name: "合成号码持有人", phone: phone(),
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
  }

  async function approvedHistory(oldPhone: string) {
    const previousOwner = await user();
    const application = await db.employeeRegistration.create({ data: { name: "原已批准员工", phone: oldPhone,
      passwordHash: await bcrypt.hash("Original-History-Password-01", 4), status: "approved", userId: previousOwner.id,
      revision: 3, credentialVersion: 2, reviewedAt: new Date("2026-10-20T00:00:00.000Z") } });
    return { previousOwner, application };
  }

  async function manager() {
    const actor = await user();
    const position = await db.position.upsert({ where: { key: "chairman" }, update: {}, create: { key: "chairman", name: "合成董事长" } });
    await db.userPosition.create({ data: { userId: actor.id, positionId: position.id } });
    const department = await db.department.create({ data: { name: `合成号码复用部门-${actor.id}` } });
    return { actor, department };
  }

  it("旧持有人已换号后，新持号人可正常注册，已批准历史身份和凭据保持不变", async () => {
    const releasedPhone = phone();
    const { previousOwner, application } = await approvedHistory(releasedPhone);
    const result = await onboarding.register({ name: "新持号人待审核", phone: releasedPhone, password });
    expect(result.application).toMatchObject({ phone: releasedPhone, status: "pending" });
    expect(result.application.id).not.toBe(application.id);
    expect(await db.employeeRegistration.findUnique({ where: { id: application.id } })).toEqual(application);
    expect(await db.user.findUnique({ where: { id: previousOwner.id } })).toEqual(previousOwner);
  });

  it("申请登录、本人查询和短信重置只命中新持号人的未批准申请", async () => {
    const releasedPhone = phone();
    const { application } = await approvedHistory(releasedPhone);
    const current = await onboarding.register({ name: "新持号申请", phone: releasedPhone, password });
    const login = await onboarding.login({ phone: releasedPhone, password });
    expect(login.application.id).toBe(current.application.id);
    expect((await onboarding.mine(`Bearer ${login.applicationToken}`)).id).toBe(current.application.id);
    await expect(onboarding.login({ phone: releasedPhone, password: "Original-History-Password-01" })).rejects.toMatchObject({ status: 401 });
    process.env.SMS_ENABLED = "true";
    await accounts.sendSms({ phone: releasedPhone, purpose: "reset" }, "127.0.0.1");
    const code = [...sent].reverse().find((row) => row.phone === releasedPhone)?.code;
    expect(code).toEqual(expect.any(String));
    await accounts.resetWithSms({ phone: releasedPhone, code: code!, newPassword: "New-Holder-Password-02" });
    expect((await onboarding.login({ phone: releasedPhone, password: "New-Holder-Password-02" })).application.id).toBe(current.application.id);
    expect(await db.employeeRegistration.findUnique({ where: { id: application.id } })).toEqual(application);
  });

  it("注册短信仍核验新持号人，批准历史不阻挡且不改写", async () => {
    const releasedPhone = phone();
    const { application } = await approvedHistory(releasedPhone);
    process.env.SMS_ENABLED = "true";
    await accounts.sendSms({ phone: releasedPhone, purpose: "register" }, "127.0.0.1");
    const code = [...sent].reverse().find((row) => row.phone === releasedPhone)?.code;
    expect(code).toEqual(expect.any(String));
    const result = await onboarding.register({ name: "短信核实新持号人", phone: releasedPhone, password, code });
    expect(result.application).toMatchObject({ status: "pending", phoneVerified: true });
    expect(await db.employeeRegistration.findUnique({ where: { id: application.id } })).toEqual(application);
  });

  it("本人换号与换号短信允许复用已释放历史号，但保留历史申请", async () => {
    const releasedPhone = phone();
    const { application } = await approvedHistory(releasedPhone);
    const actor = await user();
    process.env.SMS_ENABLED = "true";
    await accounts.sendPhoneChange(releasedPhone, actor.id, "127.0.0.1");
    const code = [...sent].reverse().find((row) => row.phone === releasedPhone)?.code;
    expect(code).toEqual(expect.any(String));
    const result = await auth.updateMyProfile(actor, { name: actor.name, phone: releasedPhone, currentPassword: password, code });
    expect(result.user.phone).toBe(releasedPhone);
    expect(await db.employeeRegistration.findUnique({ where: { id: application.id } })).toEqual(application);
  });

  it("代建可复用历史号；未批准申请和停用账号的当前号码继续受保护", async () => {
    const { actor, department } = await manager();
    const releasedPhone = phone();
    const { application } = await approvedHistory(releasedPhone);
    const input = { name: "合成代建员工", phone: releasedPhone, departmentId: department.id, confirmationPassword: password };
    expect(await organization.createUser(actor.id, input)).toMatchObject({ phone: releasedPhone, mustChangePassword: true });
    expect(await db.employeeRegistration.findUnique({ where: { id: application.id } })).toEqual(application);
    const reservedPhone = phone();
    await onboarding.register({ name: "待审核持号人", phone: reservedPhone, password });
    await expect(organization.createUser(actor.id, { ...input, phone: reservedPhone })).rejects.toMatchObject({ status: 409 });
    await expect(auth.updateMyProfile(actor, { name: actor.name, phone: reservedPhone, currentPassword: password })).rejects.toMatchObject({ status: 409 });
    const inactive = await user();
    await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    await expect(onboarding.register({ name: "不能占用停用账号号码", phone: inactive.phone!, password })).rejects.toMatchObject({ status: 409 });
    await expect(organization.createUser(actor.id, { ...input, phone: inactive.phone! })).rejects.toMatchObject({ status: 409 });
    process.env.SMS_ENABLED = "true";
    const count = sent.length;
    await accounts.sendSms({ phone: inactive.phone!, purpose: "register" }, "127.0.0.1");
    const inactiveReset = await user();
    await db.user.update({ where: { id: inactiveReset.id }, data: { isActive: false } });
    await accounts.sendSms({ phone: inactiveReset.phone!, purpose: "reset" }, "127.0.0.1");
    expect(sent).toHaveLength(count);
  });

  it("数据库允许多个批准历史，仍拒绝同号未完成申请及冲突状态回退", async () => {
    const releasedPhone = phone();
    const first = await approvedHistory(releasedPhone);
    await approvedHistory(releasedPhone);
    const result = await onboarding.register({ name: "唯一未批准申请", phone: releasedPhone, password });
    for (const status of ["pending", "chairman_review", "returned"]) {
      await expect(db.employeeRegistration.create({ data: { name: "重复待审", phone: releasedPhone, passwordHash: "synthetic", status } }))
        .rejects.toMatchObject({ code: "P2002" });
    }
    await expect(db.employeeRegistration.update({ where: { id: first.application.id }, data: { status: "returned" } })).rejects.toMatchObject({ code: "P2002" });
    expect(await db.employeeRegistration.findUnique({ where: { id: first.application.id } })).toEqual(first.application);
    expect((await onboarding.login({ phone: releasedPhone, password })).application.id).toBe(result.application.id);
  });

  it("同号注册与代建并发只允许一个占号者，不同时生成账号和待审申请", async () => {
    const { actor, department } = await manager();
    const contestedPhone = phone();
    await approvedHistory(contestedPhone);
    const results = await Promise.allSettled([
      onboarding.register({ name: "并发注册", phone: contestedPhone, password }),
      organization.createUser(actor.id, { name: "并发代建", phone: contestedPhone, departmentId: department.id, confirmationPassword: password })
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((row) => row.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409 });
    const claims = await Promise.all([
      db.user.count({ where: { phone: contestedPhone } }),
      db.employeeRegistration.count({ where: { phone: contestedPhone, status: { not: "approved" } } })
    ]);
    expect(claims[0] + claims[1]).toBe(1);
  });
});
