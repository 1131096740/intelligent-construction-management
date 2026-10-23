import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { AuthService } from "../auth/auth.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const pg = process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;
pg("精简人事办理 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  let seq = 1;
  const password = "Local-Personnel-Only-01";
  const approvalIds = new Set<string>();
  const delegationIds = new Set<string>();
  const node = (candidateUserIds: string[] = []) => ({ name: "合成冻结节点", mode: "any", roleKeys: ["contract_staff"], candidateUserIds });
  async function request(route: string, token: string, body?: unknown, method = body ? "POST" : "GET") {
    const response = await fetch(`${base}${route}`, { method, headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${token}`
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function login(phone: string) {
    return (await request("/auth/login", "", { phone, password })).body.tokens.accessToken as string;
  }
  async function person(role?: string) {
    const db = app.get(PrismaService);
    const user = await db.user.create({ data: { name: `人事合成人员${seq}`, phone: `1397800${String(seq++).padStart(4, "0")}`,
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    if (role) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
      await db.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    }
    return { ...user, token: await login(user.phone!) };
  }
  async function snapshot(userId: string) {
    return {
      user: await db.user.findUniqueOrThrow({ where: { id: userId } }),
      roles: await db.userPosition.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      members: await db.projectMember.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      roster: await db.projectRosterMember.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      periods: await db.employmentPeriod.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      changes: await db.personnelChange.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      tokens: await db.refreshToken.findMany({ where: { userId }, orderBy: { id: "asc" } })
    };
  }
  async function approval(applicantUserId: string, frozenNodes: Prisma.InputJsonValue[], currentNodeIndex = 0) {
    const row = await db.approvalInstance.create({ data: { flowType: "合成人事冻结测试", businessType: "contract",
      businessId: randomUUID(), status: "in_progress", currentNodeIndex, applicantUserId, frozenNodes } });
    approvalIds.add(row.id);
    return row;
  }
  async function offboardCommand(userId: string) {
    return { userId, action: "offboard", reason: "合成离职核实", commandKey: randomUUID() };
  }
  async function apply(token: string, command: object, preview: { snapshotHash: string }) {
    return request("/organization/personnel-changes/apply", token,
      { ...command, snapshotHash: preview.snapshotHash, confirmationPassword: password });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/onboarding") {
      throw new Error("仅允许本机一次性 onboarding 数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1"); base = await app.getUrl();
    db = app.get(PrismaService);
    const [runtime] = await db.$queryRaw<Array<{ name: string; superuser: boolean }>>`
      SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    expect(runtime).toEqual({ name: "onboarding_runtime", superuser: false });
  });
  afterEach(async () => {
    // Only this suite's synthetic responsibilities are closed between cases.
    if (approvalIds.size) await db.approvalInstance.deleteMany({ where: { id: { in: [...approvalIds] } } });
    if (delegationIds.size) await db.approvalDelegation.deleteMany({ where: { id: { in: [...delegationIds] } } });
    approvalIds.clear(); delegationIds.clear();
  });
  afterAll(async () => { await app?.close(); });

  it("普通员工离职停用与返聘沿用原身份；原命令可重放且旧启用接口不能绕过", async () => {
    const manager = await person("comprehensive_director");
    const user = await person();
    const command = { userId: user.id, action: "offboard", reason: "本人确认离职", commandKey: randomUUID() };
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.status).toBe(201);
    expect(preview.body.canApply).toBe(true);
    const apply = { ...command, snapshotHash: preview.body.snapshotHash, confirmationPassword: password };
    const saved = await request("/organization/personnel-changes/apply", manager.token, apply);
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ commandKey: command.commandKey, userId: user.id, action: "offboard" });
    expect((await request("/organization/personnel-changes/apply", manager.token, apply)).body).toEqual(saved.body);
    expect((await request(`/organization/personnel-changes/results/${command.commandKey}`, manager.token)).body).toEqual(saved.body);
    expect((await request("/organization/personnel-changes/apply", manager.token, { ...apply, reason: "换了载荷" })).status).toBe(409);
    expect((await request("/projects", user.token)).status).toBe(401);
    expect((await request(`/organization/users/${user.id}`, manager.token,
      { isActive: true, confirmationPassword: password }, "PATCH")).status).toBe(409);
    const rehire = { userId: user.id, action: "rehire", reason: "返聘确认", commandKey: randomUUID() };
    const next = await request("/organization/personnel-changes/preview", manager.token, rehire);
    expect(next.body.canApply).toBe(true);
    expect((await request("/organization/personnel-changes/apply", manager.token,
      { ...rehire, snapshotHash: next.body.snapshotHash, confirmationPassword: password })).status).toBe(201);
    const history = await request(`/organization/users/${user.id}/employment`, manager.token);
    expect(history.body.periods).toHaveLength(2);
    expect(history.body.periods.filter((period: { endedAt: unknown }) => period.endedAt === null)).toHaveLength(1);
    expect(history.body.changes).toHaveLength(2);
    expect(await app.get(PrismaService).userPosition.count({ where: { userId: user.id } })).toBe(0);
  });

  it("开户的未知任职可首次核实，预览零写，第二次核实拒绝且始终仅一当前任职", async () => {
    const manager = await person("comprehensive_director");
    const department = await db.department.create({ data: { name: "合成首次核实部门" } });
    const created = await request("/organization/users", manager.token, { name: "合成待核实员工",
      phone: `1397800${String(seq++).padStart(4, "0")}`, departmentId: department.id, confirmationPassword: password });
    expect(created.status).toBe(201);
    const userId = created.body.id as string;
    const before = await snapshot(userId);
    expect(before.periods).toEqual([expect.objectContaining({ startedOn: null, verified: false, endedAt: null })]);
    const command = { userId, action: "join", startedOn: "2026-01-01", reason: "本人资料核实", commandKey: randomUUID() };
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.status).toBe(201); expect(preview.body.canApply).toBe(true);
    expect(await snapshot(userId)).toEqual(before);
    expect((await apply(manager.token, command, preview.body)).status).toBe(201);
    const after = await snapshot(userId);
    expect(after.periods).toEqual([expect.objectContaining({ id: before.periods[0].id,
      startedOn: new Date("2026-01-01T00:00:00.000Z"), verified: true, revision: 2, endedAt: null })]);
    expect(after.changes).toHaveLength(2);
    const again = { ...command, commandKey: randomUUID(), startedOn: "2026-01-02" };
    const blocked = await request("/organization/personnel-changes/preview", manager.token, again);
    expect(blocked.body.canApply).toBe(false);
    expect((await apply(manager.token, again, blocked.body)).status).toBe(409);
    expect(await snapshot(userId)).toEqual(after);
    await expect(db.employmentPeriod.create({ data: { userId } })).rejects.toThrow();
  });

  it("相同办理编号并发只提交一次，旧预览重放返回原回执，异载荷和他人查询拒绝", async () => {
    const manager = await person("comprehensive_director"), otherManager = await person("comprehensive_director");
    const user = await person();
    const command = await offboardCommand(user.id);
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    const responses = await Promise.all([apply(manager.token, command, preview.body), apply(manager.token, command, preview.body)]);
    expect(responses.map(row => row.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(await db.personnelChange.count({ where: { commandKey: command.commandKey } })).toBe(1);
    expect(await db.employmentPeriod.count({ where: { userId: user.id } })).toBe(1);
    expect((await apply(manager.token, { ...command, reason: "同编号换内容" }, preview.body)).status).toBe(409);
    expect((await request(`/organization/personnel-changes/results/${command.commandKey}`, otherManager.token)).status).toBe(403);
    const absent = await request(`/organization/personnel-changes/results/${randomUUID()}`, manager.token);
    expect(absent.body).toMatchObject({ found: false });
  });

  it("预览模拟新增后遇到调出阻断，会回滚全部角色、会话、任职和事实", async () => {
    const manager = await person("comprehensive_director"), user = await person();
    const project = await db.project.create({ data: { code: randomUUID(), name: "合成阻断调出项目" } });
    await db.projectMember.create({ data: { userId: user.id, projectId: project.id, positionKey: "contract_staff" } });
    await db.projectRosterMember.create({ data: { userId: user.id, projectId: project.id } });
    const before = await snapshot(user.id);
    const command = { userId: user.id, action: "adjust", commandKey: randomUUID(), reason: "合成原子性验证",
      additions: [{ userId: user.id, operation: "add", scope: "global", roleKey: "engineering_department_member" }],
      rosterChanges: [{ projectId: project.id, operation: "leave" }] };
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.status).toBe(201); expect(preview.body.canApply).toBe(false);
    expect(preview.body.blockingReasons.join("；")).toContain("撤销该项目");
    expect(await snapshot(user.id)).toEqual(before);
    expect((await apply(manager.token, command, preview.body)).status).toBe(409);
    expect(await snapshot(user.id)).toEqual(before);
  });

  it("新增项目岗与同项目调出不能同时通过，避免最终角色和归属相互矛盾", async () => {
    const manager = await person("comprehensive_director"), user = await person();
    const project = await db.project.create({ data: { code: randomUUID(), name: "合成最终安排项目" } });
    const before = await snapshot(user.id);
    const command = { userId: user.id, action: "adjust", commandKey: randomUUID(), reason: "合成冲突安排",
      additions: [{ userId: user.id, operation: "add", scope: "project", roleKey: "contract_staff", projectId: project.id }],
      rosterChanges: [{ projectId: project.id, operation: "leave" }] };
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.status).toBe(400); expect(preview.body.message).toContain("不能同时新增该项目岗位");
    expect((await apply(manager.token, command, { snapshotHash: `sha256:${"0".repeat(64)}` })).status).toBe(409);
    expect(await snapshot(user.id)).toEqual(before);
  });

  it.each(["candidateUserIds", "candidateUserIdsByRole", "selectedUserId", "assignmentTo", "assignmentFrom"])(
    "无当前岗员工仍为当前/未来冻结责任 %s 时离职零写阻断", async field => {
      const manager = await person("comprehensive_director"), applicant = await person(), user = await person();
      expect(await db.userPosition.count({ where: { userId: user.id } })).toBe(0);
      expect(await db.projectMember.count({ where: { userId: user.id } })).toBe(0);
      const responsibility = field === "candidateUserIds" ? { candidateUserIds: [user.id] }
        : field === "candidateUserIdsByRole" ? { candidateUserIdsByRole: { contract_staff: [user.id] } }
          : field === "selectedUserId" ? { selectedUserId: user.id }
            : { assignments: [{ kind: "transfer", fromRoleKey: "contract_staff",
              fromUserId: field === "assignmentFrom" ? user.id : applicant.id,
              toUserId: field === "assignmentTo" ? user.id : applicant.id }] };
      for (const future of [false, true]) {
        const frozen = { ...node(), ...responsibility };
        const row = await approval(applicant.id, future ? [node([applicant.id]), frozen] : [frozen]);
        const before = await snapshot(user.id), command = await offboardCommand(user.id);
        const preview = await request("/organization/personnel-changes/preview", manager.token, command);
        expect(preview.status).toBe(201); expect(preview.body.canApply).toBe(false);
        expect(preview.body.blockingReasons.join("；")).toContain("冻结审批");
        expect((await apply(manager.token, command, preview.body)).status).toBe(409);
        expect(await snapshot(user.id)).toEqual(before);
        await db.approvalInstance.delete({ where: { id: row.id } }); approvalIds.delete(row.id);
      }
    });

  it("本人在审申请和未来委托分别阻断离职，过期委托不再占用责任", async () => {
    const manager = await person("comprehensive_director"), user = await person(), recipient = await person();
    const row = await approval(user.id, [node([recipient.id])]);
    const command = await offboardCommand(user.id), before = await snapshot(user.id);
    const own = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(own.body.canApply).toBe(false); expect(own.body.blockingReasons.join("；")).toContain("本人申请");
    await db.approvalInstance.delete({ where: { id: row.id } }); approvalIds.delete(row.id);
    const delegate = await db.approvalDelegation.create({ data: { fromUserId: user.id, toUserId: recipient.id,
      startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 172_800_000) } });
    delegationIds.add(delegate.id);
    const future = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(future.body.canApply).toBe(false); expect(future.body.blockingReasons.join("；")).toContain("委托");
    expect((await apply(manager.token, command, future.body)).status).toBe(409);
    expect(await snapshot(user.id)).toEqual(before);
    await db.approvalDelegation.update({ where: { id: delegate.id }, data: { startsAt: new Date(Date.now() - 172_800_000), endsAt: new Date(Date.now() - 86_400_000) } });
    expect((await request("/organization/personnel-changes/preview", manager.token, command)).body.canApply).toBe(true);
  });

  it("人事不得自操作，普通经理不得办理历史重要人员，技术管理员须先独立技术交接", async () => {
    const manager = await person("comprehensive_director"), chairman = await person("chairman");
    expect((await request("/organization/personnel-changes/preview", manager.token, await offboardCommand(manager.id))).status).toBe(403);
    const historic = await person();
    await db.user.update({ where: { id: historic.id }, data: { requiresChairmanManagement: true } });
    const before = await snapshot(historic.id), command = await offboardCommand(historic.id);
    expect((await request("/organization/personnel-changes/preview", manager.token, command)).status).toBe(403);
    expect((await request("/organization/personnel-changes/preview", chairman.token, command)).body.canApply).toBe(true);
    expect(await snapshot(historic.id)).toEqual(before);
    const technician = await person("super_admin");
    const technical = await request("/organization/personnel-changes/preview", chairman.token, await offboardCommand(technician.id));
    expect(technical.body.canApply).toBe(false); expect(technical.body.blockingReasons.join("；")).toContain("技术交接");
    expect((await request("/organization/personnel-changes/preview", technician.token, await offboardCommand(historic.id))).status).toBe(403);
  });

  it("预览后增加冻结责任使旧快照失效，错误确认密码也不产生部分写入", async () => {
    const manager = await person("comprehensive_director"), user = await person(), applicant = await person();
    const command = await offboardCommand(user.id), before = await snapshot(user.id);
    for (const invalid of [{ companyEntityId: "" }, { companyEntityId: "  " }, { companyEntityId: null },
      { departmentId: null }, { departmentId: "  " }]) {
      expect((await request("/organization/personnel-changes/preview", manager.token, { ...command, ...invalid })).status).toBe(400);
      expect((await apply(manager.token, { ...command, ...invalid }, { snapshotHash: `sha256:${"0".repeat(64)}` })).status).toBe(400);
      expect(await snapshot(user.id)).toEqual(before);
    }
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.body.canApply).toBe(true);
    expect((await request("/organization/personnel-changes/apply", manager.token,
      { ...command, snapshotHash: preview.body.snapshotHash, confirmationPassword: "Incorrect-Local-Password" })).status).toBe(400);
    await approval(applicant.id, [node([user.id])]);
    expect((await apply(manager.token, command, preview.body)).status).toBe(409);
    expect(await snapshot(user.id)).toEqual(before);
  });

  it("已结束任职在 SQL 层不能改删，返聘不得早于离职日且不恢复旧岗", async () => {
    const chairman = await person("chairman"), user = await person();
    await db.employmentPeriod.create({ data: { userId: user.id, startedOn: new Date("2026-01-01T00:00:00.000Z"), verified: true } });
    const command = await offboardCommand(user.id);
    const preview = await request("/organization/personnel-changes/preview", chairman.token, command);
    expect((await apply(chairman.token, command, preview.body)).status).toBe(201);
    const ended = await db.employmentPeriod.findFirstOrThrow({ where: { userId: user.id } });
    await expect(db.employmentPeriod.update({ where: { id: ended.id }, data: { startedOn: new Date("2026-01-02T00:00:00.000Z"), revision: { increment: 1 } } })).rejects.toThrow("人员历史只能追加");
    // The runtime has no DELETE grant; the SQL trigger also protects ended periods.
    await expect(db.employmentPeriod.delete({ where: { id: ended.id } })).rejects.toThrow();
    const invalid = { userId: user.id, action: "rehire", commandKey: randomUUID(), reason: "合成错误返聘日", startedOn: "2026-01-02" };
    const invalidPreview = await request("/organization/personnel-changes/preview", chairman.token, invalid);
    expect(invalidPreview.body.canApply).toBe(false);
    expect((await apply(chairman.token, invalid, invalidPreview.body)).status).toBe(409);
    expect(await db.employmentPeriod.findUnique({ where: { id: ended.id } })).toEqual(ended);
    const valid = { userId: user.id, action: "rehire", commandKey: randomUUID(), reason: "合成返聘" };
    const validPreview = await request("/organization/personnel-changes/preview", chairman.token, valid);
    expect((await apply(chairman.token, valid, validPreview.body)).status).toBe(201);
    expect(await db.employmentPeriod.count({ where: { userId: user.id, endedAt: null } })).toBe(1);
    expect(await db.employmentPeriod.findUnique({ where: { id: ended.id } })).toEqual(ended);
    expect(await db.projectMember.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.userPosition.count({ where: { userId: user.id } })).toBe(0);
  });

  it("返聘仅核实公司后仍能补核实日期，沿用当前任职并保留公司和已结束历史", async () => {
    const manager = await person("comprehensive_director"), user = await person();
    const company = await db.companyEntity.create({ data: { name: "合成已知用工公司" } });
    const offboard = await offboardCommand(user.id);
    const offboardPreview = await request("/organization/personnel-changes/preview", manager.token, offboard);
    expect((await apply(manager.token, offboard, offboardPreview.body)).status).toBe(201);
    const ended = await db.employmentPeriod.findFirstOrThrow({ where: { userId: user.id } });
    const rehire = { userId: user.id, action: "rehire", reason: "先核实用工公司，日期待查", companyEntityId: company.id, commandKey: randomUUID() };
    const rehirePreview = await request("/organization/personnel-changes/preview", manager.token, rehire);
    expect(rehirePreview.body.canApply).toBe(true);
    expect((await apply(manager.token, rehire, rehirePreview.body)).status).toBe(201);
    const current = await db.employmentPeriod.findFirstOrThrow({ where: { userId: user.id, endedAt: null } });
    expect(current).toMatchObject({ companyEntityId: company.id, startedOn: null, verified: false });
    const verifiedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const verify = { userId: user.id, action: "join", reason: "补核实返聘日期", startedOn: verifiedDate, commandKey: randomUUID() };
    const verifyPreview = await request("/organization/personnel-changes/preview", manager.token, verify);
    expect(verifyPreview.body.canApply).toBe(true);
    expect((await apply(manager.token, verify, verifyPreview.body)).status).toBe(201);
    expect(await db.employmentPeriod.findUnique({ where: { id: current.id } })).toMatchObject({ companyEntityId: company.id,
      startedOn: new Date(`${verifiedDate}T00:00:00.000Z`), verified: true, revision: 2 });
    expect(await db.employmentPeriod.findUnique({ where: { id: ended.id } })).toEqual(ended);
    expect(await db.employmentPeriod.count({ where: { userId: user.id, endedAt: null } })).toBe(1);
  });

  it("已停用但仍有当前任职的员工可直接确认离职，不必先启用账号", async () => {
    const manager = await person("comprehensive_director"), user = await person();
    await db.employmentPeriod.create({ data: { userId: user.id } });
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    const before = await snapshot(user.id), command = await offboardCommand(user.id);
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    expect(preview.body.canApply).toBe(true); expect(await snapshot(user.id)).toEqual(before);
    expect((await apply(manager.token, command, preview.body)).status).toBe(201);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ isActive: false });
    expect(await db.employmentPeriod.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.employmentPeriod.count({ where: { userId: user.id, endedAt: null } })).toBe(0);
  });

  it("外层密码预检之后密码变化，事务内复核拒绝且不提交人员变更", async () => {
    const manager = await person("comprehensive_director"), user = await person();
    const command = await offboardCommand(user.id), before = await snapshot(user.id);
    const preview = await request("/organization/personnel-changes/preview", manager.token, command);
    const auth = app.get(AuthService), confirm = auth.confirmPassword.bind(auth);
    const changedHash = await bcrypt.hash("Changed-Local-Password-01", 4);
    const spy = jest.spyOn(auth, "confirmPassword").mockImplementation(async (id, value, persistence) => {
      const result = await confirm(id, value, persistence);
      if (id === manager.id && persistence === undefined) {
        // Synthetic race injection after the real outer bcrypt check and before the transaction.
        await db.user.update({ where: { id }, data: { passwordHash: changedHash } });
      }
      return result;
    });
    try {
      const result = await apply(manager.token, command, preview.body);
      expect(result.status).toBe(400); expect(result.body.message).toContain("当前密码不正确");
      expect(spy.mock.calls.some(call => call[2] !== undefined)).toBe(true);
      expect(await snapshot(user.id)).toEqual(before);
    } finally { spy.mockRestore(); }
  });

  it("旧停用接口也阻断未来冻结候选、转审、未来委托和待审本人申请，不能绕过人事办理", async () => {
    const manager = await person("comprehensive_director"), applicant = await person();
    for (const responsibility of ["candidate", "transfer", "delegate", "applicant"]) {
      const user = await person();
      let approvalId: string | undefined, delegationId: string | undefined;
      if (responsibility === "delegate") {
        const row = await db.approvalDelegation.create({ data: { fromUserId: applicant.id, toUserId: user.id,
          startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 172_800_000) } });
        delegationId = row.id; delegationIds.add(row.id);
      } else {
        const row = await approval(responsibility === "applicant" ? user.id : applicant.id,
          [node([applicant.id]), responsibility === "transfer" ? { ...node([applicant.id]),
            assignments: [{ kind: "transfer", fromRoleKey: "contract_staff", fromUserId: applicant.id, toUserId: user.id }] }
            : node(responsibility === "candidate" ? [user.id] : [applicant.id])]);
        approvalId = row.id;
        if (responsibility === "applicant") await db.approvalInstance.update({ where: { id: row.id }, data: { status: "approval_pending" } });
      }
      const before = await snapshot(user.id);
      const result = await request(`/organization/users/${user.id}`, manager.token, { isActive: false, confirmationPassword: password }, "PATCH");
      expect(result.status).toBe(400);
      expect(result.body.message).toMatch(/冻结审批|委托|本人申请/u);
      expect(await snapshot(user.id)).toEqual(before);
      if (approvalId) { await db.approvalInstance.delete({ where: { id: approvalId } }); approvalIds.delete(approvalId); }
      if (delegationId) { await db.approvalDelegation.delete({ where: { id: delegationId } }); delegationIds.delete(delegationId); }
    }
  });

  it("同一会签冻结状态下已签岗位可沿原撤岗规则完成停用与离职，未签岗位仍阻断", async () => {
    const chairman = await person("chairman"), signed = await person("contract_director"), pending = await person("finance_director"), applicant = await person();
    await db.employmentPeriod.create({ data: { userId: signed.id } });
    const project = await db.project.create({ data: { code: randomUUID(), name: "合成已签会签项目" } });
    const contract = await db.contract.create({ data: { projectId: project.id, name: "合成会签合同", counterparty: "合成单位" } });
    const version = await db.contractVersion.create({ data: { contractId: contract.id, versionNo: 1, changeType: "original",
      status: "in_approval", amountCents: 100n, draftData: {}, templateSnapshot: {}, clauseSnapshot: {} } });
    // Reachable frozen state after contract director A has signed while finance director B is pending.
    const frozenNodes = [{ name: "合同财务会签", mode: "all", roleKeys: ["contract_director", "finance_director"],
      approvedRoleKeys: ["contract_director"], candidateUserIds: [signed.id, pending.id],
      candidateUserIdsByRole: { contract_director: [signed.id], finance_director: [pending.id] },
      roleScopesByRole: { contract_director: "global", finance_director: "global" } }];
    const active = await db.approvalInstance.create({ data: { flowType: "contract.approve", businessType: "contract_version",
      businessId: version.id, status: "in_progress", currentNodeIndex: 0, applicantUserId: applicant.id, frozenNodes } });
    approvalIds.add(active.id);
    const remove = { operation: "remove", scope: "global", roleKey: "contract_director", userId: signed.id };
    const removal = await request("/organization/role-changes/preview", chairman.token, remove);
    expect(removal.status).toBe(201); expect(removal.body.canApply).toBe(true);
    expect((await request("/organization/role-changes/apply", chairman.token,
      { ...remove, snapshotHash: removal.body.snapshotHash, confirmationPassword: password })).status).toBe(201);
    const pendingBefore = await snapshot(pending.id);
    const pendingCommand = await offboardCommand(pending.id);
    const pendingPreview = await request("/organization/personnel-changes/preview", chairman.token, pendingCommand);
    expect(pendingPreview.body.canApply).toBe(false);
    expect(pendingPreview.body.blockingReasons.join("；")).toContain("冻结审批");
    expect((await request(`/organization/users/${pending.id}`, chairman.token,
      { isActive: false, confirmationPassword: password }, "PATCH")).status).toBe(400);
    expect(await snapshot(pending.id)).toEqual(pendingBefore);
    expect((await request(`/organization/users/${signed.id}`, chairman.token,
      { isActive: false, confirmationPassword: password }, "PATCH")).status).toBe(200);
    const command = await offboardCommand(signed.id);
    const preview = await request("/organization/personnel-changes/preview", chairman.token, command);
    expect(preview.status).toBe(201); expect(preview.body.canApply).toBe(true);
    expect((await apply(chairman.token, command, preview.body)).status).toBe(201);
    expect(await db.employmentPeriod.count({ where: { userId: signed.id, endedAt: null } })).toBe(0);
    expect(await db.userPosition.count({ where: { userId: signed.id } })).toBe(0);
    expect(await db.approvalInstance.findUniqueOrThrow({ where: { id: active.id } })).toMatchObject({ status: "in_progress", frozenNodes });
  });

  it("电脑和手机真实员工详情页面完成入职核实、离职、返聘且原身份与履历一致", async () => {
    const manager = await person("comprehensive_director");
    const employees = { desktop: await person(), mobile: await person() };
    for (const employee of Object.values(employees)) await db.employmentPeriod.create({ data: { userId: employee.id } });
    const rehireDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const env: NodeJS.ProcessEnv = { ...process.env, PERSONNEL_API_URL: base, PERSONNEL_MANAGER_PHONE: manager.phone!,
      PERSONNEL_EMPLOYEES_JSON: JSON.stringify(Object.fromEntries(Object.entries(employees).map(([surface, user]) =>
        [surface, { id: user.id, name: user.name, phone: user.phone }]))), PERSONNEL_REHIRE_DATE: rehireDate };
    delete env.JEST_WORKER_ID;
    const result = await new Promise<{ status: number | null; output: string }>((resolve, reject) => {
      const child = spawn("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.personnel-lifecycle-real.config.ts"], {
        cwd: path.resolve(__dirname, "../../../.."), env, stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (data) => { output += String(data); });
      child.stderr.on("data", (data) => { output += String(data); });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, output }));
    });
    if (result.status !== 0) throw new Error(result.output);
    console.info(result.output);
    for (const employee of Object.values(employees)) {
      expect(await db.user.count({ where: { phone: employee.phone } })).toBe(1);
      expect(await db.user.findUniqueOrThrow({ where: { phone: employee.phone! } })).toMatchObject({ id: employee.id,
        name: employee.name, isActive: true, sessionVersion: employee.sessionVersion + 3 });
      const periods = await db.employmentPeriod.findMany({ where: { userId: employee.id }, orderBy: { createdAt: "asc" } });
      expect(periods).toHaveLength(2);
      expect(periods.filter((period) => period.endedAt === null)).toHaveLength(1);
      expect(periods.find((period) => period.endedAt !== null)).toMatchObject({ startedOn: new Date("2026-01-01T00:00:00.000Z"),
        endedOn: new Date(`${rehireDate}T00:00:00.000Z`), verified: true });
      expect(periods.find((period) => period.endedAt === null)).toMatchObject({ startedOn: new Date(`${rehireDate}T00:00:00.000Z`), verified: true });
      expect((await db.personnelChange.findMany({ where: { userId: employee.id }, orderBy: { sequence: "asc" } })).map((change) => change.action))
        .toEqual(["join", "offboard", "rehire"]);
      expect(await db.userPosition.count({ where: { userId: employee.id } })).toBe(0);
      expect(await db.projectMember.count({ where: { userId: employee.id } })).toBe(0);
      expect(await db.refreshToken.count({ where: { userId: employee.id, revokedAt: null } })).toBe(0);
      expect((await request("/projects", employee.token)).status).toBe(401);
    }
  }, 120_000);
});
