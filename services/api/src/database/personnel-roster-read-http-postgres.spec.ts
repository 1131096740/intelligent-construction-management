import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const describePostgres = process.env.RUN_EMPLOYEE_PHONE_REUSE_PG16 === "1" || process.env.RUN_EMPLOYEE_ONBOARDING_PG16 === "1" ? describe : describe.skip;

describePostgres("人员目录与花名册一致读取 / 真实 HTTP 与 PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  let sequence = Date.now() % 100_000_000;
  const password = "Local-Roster-Read-01";
  const prefix = randomUUID().slice(0, 8);
  const ownDirectorIds: string[] = [];
  const phone = () => `136${String(sequence++).padStart(8, "0")}`;

  async function request(route: string, token: string) {
    const response = await fetch(`${base}${route}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }

  async function actor(role: string, projectId: string | null = null) {
    const person = await db.user.create({ data: { name: `合成人员-${prefix}`, phone: phone(),
      passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: `合成-${role}` } });
    await db.userPosition.create({ data: { userId: person.id, positionId: position.id, projectId } });
    if (role === "engineering_department_director") ownDirectorIds.push(person.id);
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: person.phone, password }) });
    expect(response.status).toBe(201);
    const login = await response.json();
    return { ...person, token: login.tokens.accessToken as string };
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !["/onboarding", "/phone_reuse"].includes(url.pathname)) {
      throw new Error("仅允许本机一次性人员验收数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    db = app.get(PrismaService);
    const [role] = await db.$queryRaw<Array<{ name: string; superuser: boolean }>>`
      SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ name: url.pathname === "/onboarding" ? "onboarding_runtime" : "phone_reuse_runtime", superuser: false });
    base = await app.getUrl();
  });
  afterAll(async () => {
    try {
      if (db && ownDirectorIds.length) await db.user.updateMany({
        where: { id: { in: ownDirectorIds }, name: `合成人员-${prefix}` }, data: { isActive: false }
      });
    } finally { await app?.close(); }
  });

  it("花名册使用共同可见项目范围，合法公司岗位可读且非法旧全局项目岗不扩权", async () => {
    const projects = await Promise.all([1, 2].map((index) => db.project.create({ data: { code: `${prefix}-${index}`, name: `合成读取项目${index}` } })));
    const member = await db.user.create({ data: { name: "合成项目成员", phone: phone(), passwordHash: await bcrypt.hash(password, 4), mustChangePassword: false } });
    await db.projectRosterMember.createMany({ data: projects.map((project) => ({ projectId: project.id, userId: member.id })) });
    for (const role of ["finance_staff", "engineering_department_director", "chairman", "super_admin"]) {
      const companyActor = await actor(role);
      const result = await request("/projects/roster", companyActor.token);
      expect(result.status).toBe(200);
      expect(result.body.filter((row: { userId: string }) => row.userId === member.id).map((row: { projectId: string }) => row.projectId).sort())
        .toEqual(projects.map((project) => project.id).sort());
    }
    for (const role of ["project_manager", "engineering_director"]) {
      const invalidGlobalActor = await actor(role);
      const result = await request("/projects/roster", invalidGlobalActor.token);
      expect(result.status).toBe(200);
      expect(result.body).toEqual([]);
    }
    const scoped = await actor("project_manager", projects[0].id);
    const result = await request("/projects/roster", scoped.token);
    expect(result.status).toBe(200);
    expect(new Set(result.body.map((row: { projectId: string }) => row.projectId))).toEqual(new Set([projects[0].id]));
    expect((await request("/organization/directory", scoped.token)).status).toBe(403);
  });

  it("仅有旧项目任职的人员在两处一致标待核对，读取不新增规范授权或归属", async () => {
    const project = await db.project.create({ data: { code: `${prefix}-legacy`, name: "合成旧任职项目" } });
    const legacy = await actor("project_manager", project.id);
    const chairman = await actor("chairman");
    const directory = await request("/organization/directory", chairman.token);
    expect(directory.status).toBe(200);
    const person = directory.body.users.find((row: { id: string }) => row.id === legacy.id);
    expect(person.projectPositions).toContainEqual(expect.objectContaining({ projectId: project.id, needsReconciliation: true, legacySource: "user_position" }));
    expect(person.rosterProjects).toContainEqual(expect.objectContaining({ projectId: project.id, needsReconciliation: true, legacySource: "user_position" }));
    const roster = await request("/projects/roster", chairman.token);
    expect(roster.status).toBe(200);
    expect(roster.body).toContainEqual(expect.objectContaining({ projectId: project.id, userId: legacy.id,
      needsReconciliation: true, legacySource: "user_position", legacyPositionKeys: ["project_manager"], positionKeys: [] }));
    expect(await db.projectMember.count({ where: { projectId: project.id, userId: legacy.id } })).toBe(0);
    expect(await db.projectRosterMember.count({ where: { projectId: project.id, userId: legacy.id } })).toBe(0);
  });
});
