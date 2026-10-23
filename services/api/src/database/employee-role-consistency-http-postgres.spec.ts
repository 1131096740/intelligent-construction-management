import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const describePostgres = process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;

describePostgres("人员岗位安排一致性 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  let sequence = 100;
  let chairman: { id: string; token: string };
  let manager: { id: string; token: string };
  const directorUserIds = new Set<string>();
  const password = "Role-Consistency-Local-01";
  const phone = () => `1393000${String(sequence++).padStart(4, "0")}`;

  async function request(route: string, token?: string, body?: unknown, method = "POST") {
    const response = await fetch(`${base}${route}`, { method, headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  async function actor(role: "chairman" | "comprehensive_director") {
    const user = await db.user.create({ data: { name: "岗位一致性合成审核人", phone: phone(),
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    const position = await db.position.findUniqueOrThrow({ where: { key: role } });
    await db.userPosition.create({ data: { userId: user.id, positionId: position.id } });
    const login = await request("/auth/login", undefined, { phone: user.phone, password });
    expect(login.status).toBe(201);
    const token = login.body.tokens.accessToken as string;
    const signature = new FormData();
    signature.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成签名.png");
    expect((await fetch(`${base}/me/signature/canvas`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: signature
    })).status).toBe(201);
    return { id: user.id, token };
  }

  async function application() {
    const selectedPhone = phone();
    const registered = await request("/employee-onboarding/register", undefined, {
      name: "岗位一致性合成员工", phone: selectedPhone, password
    });
    expect(registered.status).toBe(201);
    return { id: registered.body.application.id as string, phone: selectedPhone };
  }

  async function approve(id: string, departmentId: string, roles: unknown[], token = chairman.token) {
    return request(`/employee-onboarding/applications/${id}/review`, token, {
      revision: 1, decision: "approve", departmentId, roles, identityVerified: true, confirmationPassword: password
    });
  }

  async function arrangement() {
    const department = await db.department.create({ data: { name: `岗位一致性合成部门${sequence++}` } });
    const project = await db.project.create({ data: { code: `ROLE-${sequence++}`, name: "岗位一致性合成项目" } });
    return { departmentId: department.id, projectId: project.id };
  }

  async function rememberDirector(applicationId: string) {
    const record = await db.employeeRegistration.findUniqueOrThrow({ where: { id: applicationId } });
    if (record.userId) directorUserIds.add(record.userId);
  }

  async function activeDirectorCount() {
    const position = await db.position.findUniqueOrThrow({ where: { key: "engineering_department_director" } });
    const grants = await db.userPosition.findMany({ where: { positionId: position.id, projectId: null }, select: { userId: true } });
    return db.user.count({ where: { id: { in: grants.map(row => row.userId) }, isActive: true } });
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
    db = app.get(PrismaService);
    const [runtime] = await db.$queryRaw<Array<{ name: string; superuser: boolean }>>`
      SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    expect(runtime).toEqual({ name: "onboarding_runtime", superuser: false });
    for (const key of ["chairman", "comprehensive_director", "contract_staff", "finance_staff", "engineering_department_member", "engineering_department_director"]) {
      await db.position.upsert({ where: { key }, update: {}, create: { key, name: key } });
    }
    chairman = await actor("chairman");
    manager = await actor("comprehensive_director");
  });
  async function clearSyntheticDirectorGrants() {
    // Only this suite's synthetic director grants are removed between cases.
    if (directorUserIds.size) await db.userPosition.deleteMany({ where: { userId: { in: [...directorUserIds] },
      positionId: (await db.position.findUniqueOrThrow({ where: { key: "engineering_department_director" } })).id } });
  }
  beforeEach(clearSyntheticDirectorGrants);
  afterAll(async () => {
    if (db) await clearSyntheticDirectorGrants();
    await app?.close();
  });

  it.each(["contract_staff", "finance_staff"])("入职 %s 的公司/项目范围明确且旧调用兼容，不自动扩大权限", async roleKey => {
    const { departmentId, projectId } = await arrangement();
    for (const selected of [
      { scope: "project", projectId }, { projectId }, { scope: "global" }, {}
    ]) {
      const row = await application();
      const result = await approve(row.id, departmentId, [{ roleKey, ...selected }]);
      expect(result.status).toBe(201);
      const created = await db.user.findUniqueOrThrow({ where: { phone: row.phone } });
      const history = await request(`/organization/users/${created.id}/employment`, chairman.token, undefined, "GET");
      expect(history.status).toBe(200);
      expect(history.body.periods).toHaveLength(1);
      expect(history.body.periods[0]).toMatchObject({ startedOn: null, verified: false, endedAt: null });
      expect(history.body.changes).toEqual([expect.objectContaining({ action: "onboarding_approve" })]);
      const expectedProject = "projectId" in selected;
      expect(await db.projectMember.count({ where: { userId: created.id, projectId, positionKey: roleKey } })).toBe(expectedProject ? 1 : 0);
      expect(await db.userPosition.count({ where: { userId: created.id, projectId: null } })).toBe(expectedProject ? 0 : 1);
      const login = await request("/auth/login", undefined, { phone: row.phone, password });
      expect(login.status).toBe(201);
      const visible = await request("/projects", login.body.tokens.accessToken, undefined, "GET");
      expect(visible.status).toBe(200);
      if (expectedProject) expect(visible.body.map((item: { id: string }) => item.id)).toEqual([projectId]);
    }
    const bad = await application();
    expect((await approve(bad.id, departmentId, [{ roleKey, scope: "global", projectId }])).status).toBe(400);
    expect(await db.user.findUnique({ where: { phone: bad.phone } })).toBeNull();
  });

  it.each(["contract_staff", "finance_staff"])("代建 %s 可以只安排项目，公司范围与项目冲突必须拒绝", async initialRoleKey => {
    const { departmentId, projectId } = await arrangement();
    const result = await request("/organization/users", chairman.token, {
      phone: phone(), departmentId, initialRoleKey, initialRoleScope: "project", projectId, confirmationPassword: password
    });
    expect(result.status).toBe(201);
    const history = await request(`/organization/users/${result.body.id}/employment`, chairman.token, undefined, "GET");
    expect(history.body.periods).toHaveLength(1);
    expect(history.body.periods[0]).toMatchObject({ startedOn: null, verified: false, endedAt: null });
    expect(history.body.changes).toEqual([expect.objectContaining({ action: "account_create" })]);
    expect(await db.projectMember.count({ where: { userId: result.body.id, projectId, positionKey: initialRoleKey } })).toBe(1);
    expect(await db.userPosition.count({ where: { userId: result.body.id, projectId: null } })).toBe(0);
    expect((await request("/organization/users", chairman.token, {
      phone: phone(), departmentId, initialRoleKey, initialRoleScope: "global", projectId, confirmationPassword: password
    })).status).toBe(400);
    const blankProjectPhone = phone();
    expect((await request("/organization/users", chairman.token, {
      phone: blankProjectPhone, departmentId, initialRoleKey, projectId: "  ", confirmationPassword: password
    })).status).toBe(400);
    expect(await db.user.findUnique({ where: { phone: blankProjectPhone } })).toBeNull();
    if (initialRoleKey === "finance_staff") expect((await request("/organization/users", manager.token, {
      phone: phone(), departmentId, initialRoleKey, initialRoleScope: "project", projectId, confirmationPassword: password
    })).status).toBe(403);
  });

  it("综合部批准和代建普通工程成员，无需项目经理且不附加重要岗位", async () => {
    const { departmentId, projectId } = await arrangement();
    const row = await application();
    expect((await approve(row.id, departmentId, [{ roleKey: "engineering_department_member", projectId }], manager.token)).status).toBe(201);
    const member = await db.user.findUniqueOrThrow({ where: { phone: row.phone } });
    expect(member.requiresChairmanManagement).toBe(false);
    expect(await db.projectMember.findMany({ where: { userId: member.id }, select: { positionKey: true } })).toEqual([{ positionKey: "engineering_department_member" }]);
    expect((await request("/organization/users", manager.token, { phone: phone(), departmentId,
      initialRoleKey: "engineering_department_member", projectId, confirmationPassword: password })).status).toBe(201);
  });

  it("工程主管只由董事长批准，不要求工程成员或项目经理，另一启用主管及恢复均受阻", async () => {
    const { departmentId } = await arrangement();
    const first = await application();
    const role = [{ roleKey: "engineering_department_director" }];
    expect((await approve(first.id, departmentId, role, manager.token)).status).toBe(403);
    expect((await approve(first.id, departmentId, role)).status).toBe(201);
    await rememberDirector(first.id);
    const second = await application();
    expect((await approve(second.id, departmentId, role)).status).toBe(409);
    expect(await db.user.findUnique({ where: { phone: second.phone } })).toBeNull();
    const inactive = await db.user.create({ data: { name: "合成待恢复主管", phone: phone(), departmentId,
      isActive: false, requiresChairmanManagement: true } });
    directorUserIds.add(inactive.id);
    await db.userPosition.create({ data: { userId: inactive.id,
      positionId: (await db.position.findUniqueOrThrow({ where: { key: "engineering_department_director" } })).id } });
    expect((await request(`/organization/users/${inactive.id}`, chairman.token,
      { isActive: true, confirmationPassword: password }, "PATCH")).status).toBe(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: inactive.id } })).isActive).toBe(false);
    expect(await activeDirectorCount()).toBe(1);
  });

  it("两个工程主管入职并发批准时至多一位生效，失败申请不产生人员或岗位", async () => {
    const { departmentId } = await arrangement();
    const first = await application();
    const second = await application();
    const results = await Promise.all([first, second].map(row => approve(row.id, departmentId, [{ roleKey: "engineering_department_director" }])));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    await rememberDirector(first.id);
    await rememberDirector(second.id);
    expect(await activeDirectorCount()).toBe(1);
    const failed = results[0].status === 201 ? second : first;
    expect(await db.user.findUnique({ where: { phone: failed.phone } })).toBeNull();
    expect((await db.employeeRegistration.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("pending");
  });

  it("代建与入职并发任命主管共用同一约束，不会各自开通一位", async () => {
    const { departmentId } = await arrangement();
    const row = await application();
    const created = await Promise.all([
      approve(row.id, departmentId, [{ roleKey: "engineering_department_director" }]),
      request("/organization/users", chairman.token, { phone: phone(), departmentId,
        initialRoleKey: "engineering_department_director", confirmationPassword: password })
    ]);
    expect(created.filter(result => result.status === 201)).toHaveLength(1);
    expect(created.filter(result => result.status !== 201).every(result => [400, 409].includes(result.status))).toBe(true);
    await rememberDirector(row.id);
    if (created[1].status === 201) directorUserIds.add(created[1].body.id);
    expect(await activeDirectorCount()).toBe(1);
  });
});
