import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const describePostgres = process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;

describePostgres("项目花名册维护 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let base: string;
  let sequence = 1;
  const password = "Local-Roster-Only-01";

  async function request(route: string, token: string, body?: unknown) {
    const response = await fetch(`${base}${route}`, { method: body ? "POST" : "GET", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${token}`
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }

  async function login(phone: string) {
    const result = await request("/auth/login", "", { phone, password });
    expect(result.status).toBe(201);
    return result.body.tokens.accessToken as string;
  }

  async function person(role?: string) {
    const db = app.get(PrismaService);
    const user = await db.user.create({ data: { name: `花名册合成人员${sequence}`, phone: `1391200${String(sequence++).padStart(4, "0")}`,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    if (role) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role === "finance_staff" ? "财务经办" : role } });
      await db.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    }
    return { ...user, token: await login(user.phone!) };
  }

  async function project() {
    return app.get(PrismaService).project.create({ data: { code: `ROSTER-${sequence}`, name: `花名册合成空项目${sequence++}` } });
  }

  async function assign(userId: string, projectId: string, positionKey: string) {
    const db = app.get(PrismaService);
    await db.position.upsert({ where: { key: positionKey }, update: {}, create: { key: positionKey, name: positionKey } });
    await db.projectMember.create({ data: { userId, projectId, positionKey } });
  }

  async function apply(token: string, body: unknown, snapshotHash: string, confirmationPassword = password) {
    return request("/organization/project-roster/apply", token, { ...body as object, snapshotHash, confirmationPassword });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/onboarding") {
      throw new Error("仅允许本机一次性 onboarding 数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it("综合部将普通人员调入空项目并调出，其他项目保留，旧会话立即失效", async () => {
    const manager = await person("comprehensive_director");
    const employee = await person();
    const first = await project();
    const second = await project();
    const options = await request("/organization/project-roster/options", manager.token);
    expect(options.status).toBe(200);
    expect(options.body.projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id })]));
    for (const target of [first, second]) {
      const body = { operation: "join", projectId: target.id, userId: employee.id, reason: "合成岗位安排" };
      const preview = await request("/organization/project-roster/preview", manager.token, body);
      expect(preview.status).toBe(201);
      expect(preview.body.canApply).toBe(true);
      expect((await request("/organization/project-roster/apply", manager.token,
        { ...body, snapshotHash: preview.body.snapshotHash, confirmationPassword: password })).status).toBe(201);
    }
    expect((await request("/projects", employee.token)).status).toBe(401);
    const token = await login(employee.phone!);
    const body = { operation: "leave", projectId: first.id, userId: employee.id, reason: "合成项目调出" };
    const preview = await request("/organization/project-roster/preview", manager.token, body);
    expect(preview.body.canApply).toBe(true);
    expect((await request("/organization/project-roster/apply", manager.token,
      { ...body, snapshotHash: preview.body.snapshotHash, confirmationPassword: password })).status).toBe(201);
    expect((await request("/projects", token)).status).toBe(401);
    const projects = await request("/projects", await login(employee.phone!));
    expect(projects.body.map((row: { id: string }) => row.id)).toEqual([second.id]);
    const roster = await request("/projects/roster", manager.token);
    const own = roster.body.filter((row: { userId: string }) => row.userId === employee.id);
    expect(own).toEqual([expect.objectContaining({ projectId: second.id, projectPositionNames: [] })]);
  });

  it("重要岗位和曾任重要岗位人员仅董事长可操作，调出保留账号及其他项目", async () => {
    const chairman = await person("chairman");
    const manager = await person("comprehensive_director");
    const employee = await person();
    const first = await project();
    const second = await project();
    await assign(employee.id, first.id, "project_manager");
    await assign(employee.id, first.id, "contract_staff");
    await assign(employee.id, second.id, "employee");
    const body = { operation: "leave", projectId: first.id, userId: employee.id, reason: "调往另一项目" };
    expect((await request("/organization/project-roster/preview", manager.token, body)).status).toBe(403);
    const preview = await request("/organization/project-roster/preview", chairman.token, body);
    expect(preview.body.projectRoleKeys).toEqual(["contract_staff", "project_manager"]);
    expect((await apply(chairman.token, body, preview.body.snapshotHash)).status).toBe(201);
    const roster = await request("/projects/roster", chairman.token);
    expect(roster.body.filter((row: { userId: string }) => row.userId === employee.id)).toEqual([
      expect.objectContaining({ projectId: second.id, projectPositionNames: ["员工"] })
    ]);
    expect((await request("/projects/roster", await login(employee.phone!))).status).toBe(200);
    // 曾任重要岗位不能通过先调出、再由综合部调入绕过董事长管理。
    expect((await request("/organization/project-roster/preview", manager.token,
      { ...body, operation: "join" })).status).toBe(403);
    for (const role of ["finance_staff", "finance_director", "super_admin"]) {
      const protectedPerson = await person(role);
      expect((await request("/organization/project-roster/preview", manager.token,
        { ...body, operation: "join", userId: protectedPerson.id })).status).toBe(403);
      if (role === "finance_staff") {
        const join = { ...body, operation: "join", userId: protectedPerson.id };
        const allowed = await request("/organization/project-roster/preview", chairman.token, join);
        expect((await apply(chairman.token, join, allowed.body.snapshotHash)).status).toBe(201);
        const leave = await request("/organization/project-roster/preview", chairman.token, { ...join, operation: "leave" });
        expect(leave.body).toMatchObject({ canApply: true, retainsGlobalAccess: true });
      }
    }
  });

  it("项目经理、技术管理员和普通员工不能维护，管理员不能调整本人", async () => {
    const target = await person();
    const projectRow = await project();
    const body = { operation: "join", projectId: projectRow.id, userId: target.id, reason: "权限边界测试" };
    for (const role of ["project_manager", "super_admin", "employee"]) {
      const actor = await person(role === "project_manager" ? undefined : role);
      if (role === "project_manager") await assign(actor.id, projectRow.id, role);
      expect((await request("/organization/project-roster/options", actor.token)).status).toBe(403);
      expect((await request("/organization/project-roster/preview", actor.token, body)).status).toBe(403);
      expect((await apply(actor.token, body, `sha256:${"a".repeat(64)}`)).status).toBe(403);
    }
    const manager = await person("comprehensive_director");
    expect((await request("/organization/project-roster/preview", manager.token, { ...body, userId: manager.id })).status).toBe(403);
  });

  it("密码错误、过期预览和并发重复调入不产生重复成员或无效撤销", async () => {
    const manager = await person("comprehensive_director");
    const employee = await person();
    const projectRow = await project();
    const body = { operation: "join", projectId: projectRow.id, userId: employee.id, reason: "调入合成项目" };
    const preview = await request("/organization/project-roster/preview", manager.token, body);
    expect((await apply(manager.token, body, preview.body.snapshotHash, "Incorrect-Password")).status).toBe(400);
    expect((await apply(manager.token, { ...body, reason: "篡改确认内容" }, preview.body.snapshotHash)).status).toBe(409);
    const outcomes = await Promise.all([apply(manager.token, body, preview.body.snapshotHash), apply(manager.token, body, preview.body.snapshotHash)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([201, 409]);
    const roster = await request("/projects/roster", manager.token);
    expect(roster.body.filter((row: { userId: string }) => row.userId === employee.id)).toHaveLength(1);
    expect((await request("/organization/project-roster/preview", manager.token, body)).body.canApply).toBe(false);
  });

  it("新增待办使旧预览失效，唯一项目经理需先交接，接替后可调出且待办保留", async () => {
    const db = app.get(PrismaService);
    const chairman = await person("chairman");
    const employee = await person();
    const successor = await person();
    const applicant = await person();
    const projectRow = await project();
    await assign(employee.id, projectRow.id, "project_manager");
    const body = { operation: "leave", projectId: projectRow.id, userId: employee.id, reason: "项目经理交接" };
    const oldPreview = await request("/organization/project-roster/preview", chairman.token, body);
    expect(oldPreview.body.canApply).toBe(true);
    const expense = await db.projectExpenseRequest.create({ data: { projectId: projectRow.id, code: `ROSTER-EXP-${sequence++}`,
      expenseType: "comprehensive_expense", expenseSubtype: "travel", paymentSubject: "合成费用", reason: "仅隔离测试",
      requestedAmountCents: 100n, paymentMethod: "bank_transfer", handlerUserId: applicant.id, applicantUserId: applicant.id, status: "approval_pending" } });
    const approval = await db.approvalInstance.create({ data: { flowType: "project_expense", businessType: "project_expense_request",
      businessId: expense.id, status: "in_progress", currentNodeIndex: 0, applicantUserId: applicant.id,
      frozenNodes: [{ name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }] } });
    expect((await apply(chairman.token, body, oldPreview.body.snapshotHash)).status).toBe(409);
    const blocked = await request("/organization/project-roster/preview", chairman.token, body);
    expect(blocked.body).toMatchObject({ canApply: false, affectedApprovals: 1 });
    expect((await apply(chairman.token, body, blocked.body.snapshotHash)).status).toBe(409);
    await assign(successor.id, projectRow.id, "project_manager");
    const ready = await request("/organization/project-roster/preview", chairman.token, body);
    expect(ready.body.canApply).toBe(true);
    expect((await apply(chairman.token, body, ready.body.snapshotHash)).status).toBe(201);
    expect(await db.approvalInstance.findUnique({ where: { id: approval.id } })).toMatchObject({ status: "in_progress", businessId: expense.id });
    expect(await db.auditLog.count({ where: { actorUserId: chairman.id, action: "project.roster.leave", businessId: projectRow.id } })).toBe(1);
  });

  it("人员停用、项目停用、旧任职关系及维护冻结均阻止写入", async () => {
    const db = app.get(PrismaService);
    const chairman = await person("chairman");
    const employee = await person();
    const projectRow = await project();
    const body = { operation: "join", projectId: projectRow.id, userId: employee.id, reason: "状态边界测试" };
    const preview = await request("/organization/project-roster/preview", chairman.token, body);
    await db.user.update({ where: { id: employee.id }, data: { isActive: false } });
    expect((await apply(chairman.token, body, preview.body.snapshotHash)).status).toBe(409);
    await db.user.update({ where: { id: employee.id }, data: { isActive: true } });
    await db.project.update({ where: { id: projectRow.id }, data: { isActive: false } });
    expect((await request("/organization/project-roster/preview", chairman.token, body)).status).toBe(404);
    await db.project.update({ where: { id: projectRow.id }, data: { isActive: true } });
    const position = await db.position.upsert({ where: { key: "employee" }, update: {}, create: { key: "employee", name: "员工" } });
    await db.userPosition.create({ data: { userId: employee.id, projectId: projectRow.id, positionId: position.id } });
    expect((await request("/organization/project-roster/preview", chairman.token, { ...body, operation: "leave" })).body.canApply).toBe(false);
    const previous = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "all";
    try { expect((await apply(chairman.token, body, preview.body.snapshotHash)).status).toBe(503); }
    finally { if (previous === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE; else process.env.OPERATIONAL_WRITE_FREEZE_MODE = previous; }
  });

  it("电脑和手机通过真实页面完成普通员工调入、调出", async () => {
    const manager = await person("comprehensive_director");
    const employee = await person();
    const projectRow = await project();
    const env: NodeJS.ProcessEnv = { ...process.env, ROSTER_API_URL: base, ROSTER_MANAGER_PHONE: manager.phone!,
      ROSTER_EMPLOYEE_PHONE: employee.phone!, ROSTER_PROJECT_NAME: projectRow.name };
    delete env.JEST_WORKER_ID;
    const output = await new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.project-roster-real.config.ts"], {
        cwd: path.resolve(__dirname, "../../../.."), env, stdio: ["ignore", "pipe", "pipe"]
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
