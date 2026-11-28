import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";

function projectFixture(roleKey = "general_manager", active = true, global = true) {
  const state = { roleKey, active, global };
  const projects = [{ id: "p1", code: "P01", name: "原项目", isActive: true }];
  const audit: unknown[] = [];
  const client = {
    user: { findUnique: async () => ({ isActive: state.active }) },
    userPosition: { findMany: async ({ where }: { where: { projectId: string | null } }) => state.global && where.projectId === null ? [{ positionId: "global-position" }] : [] },
    position: { findMany: async () => [{ id: "global-position", key: state.roleKey }] },
    project: {
      findMany: async ({ where }: { where?: { name?: string; code?: { not: string } } } = {}) => projects.filter((p) => (!where?.name || p.name === where.name) && (!where?.code?.not || p.code !== where.code.not)).map((p) => ({ ...p })),
      create: async ({ data }: { data: { code: string; name: string } }) => {
        if (projects.some((p) => p.code === data.code)) throw { code: "P2002" };
        const p = { id: "p2", ...data, isActive: true }; projects.push(p); return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
        const p = projects.find((row) => row.id === where.id)!;
        Object.assign(p, data);
        return { id: p.id, code: p.code, name: p.name };
      }
    },
    businessEntrySubmissionSnapshot: { create: async ({ data }: { data: object }) => ({ id: "snapshot", ...data }) },
    auditLog: { create: async ({ data }: { data: unknown }) => { audit.push(data); return data; } }
  };
  const db = { ...client, $transaction: async (run: (tx: typeof client) => unknown) => run(client) };
  return { service: new ProjectService(db as never), audit, db, state };
}

describe("项目基础资料公开服务 IAM09", () => {
  it("总经理可以读取项目维护列表并改名，保留修改审计", async () => {
    const { service, audit } = projectFixture();
    await expect(service.listForManagement("gm")).resolves.toEqual([
      { id: "p1", code: "P01", name: "原项目", isActive: true }
    ]);
    await expect(service.updateProject("p1", "gm", { name: "新项目" })).resolves.toMatchObject({ name: "新项目" });
    expect(audit).toContainEqual(expect.objectContaining({ actorUserId: "gm", action: "project.update", metadata: expect.objectContaining({ name: "新项目" }) }));
  });
  it("总经理可创建同名不同编号项目，但不能取得停用能力或配置施工企业", async () => {
    const { service } = projectFixture();
    await expect(service.createProject("gm", { code: "P02", name: "原项目" })).resolves.toMatchObject({ id: "p2", name: "原项目" });
    expect(await service.listForManagement("gm")).toHaveLength(2);
    await expect(service.basicCapability("gm", "p1")).resolves.toEqual({ projectId: "p1", availableActions: ["update_project"] });
    await expect(service.updateStatus("p1", "gm", { isActive: false })).rejects.toThrow("不能维护我方公司主体");
    await expect(service.assignAffiliate("p1", "gm", { businessPartyVersionId: "party-version", effectiveFrom: "2026-11-04T00:00:00Z", changeReason: "越权配置" })).rejects.toThrow("不能维护我方公司主体");
  });
  it.each(["material_staff", "project_manager", "super_admin", "contract_director"])("%s不能维护项目基础信息", async (role) => {
    const { service } = projectFixture(role);
    await expect(service.listForManagement("actor")).rejects.toThrow();
    await expect(service.updateProject("p1", "actor", { name: "越权" })).rejects.toThrow();
  });
  it("失岗、停用或项目级伪同岗立即失去基础资料能力", async () => {
    for (const service of [projectFixture("chairman", false).service, projectFixture("general_manager", true, false).service]) {
      await expect(service.basicCapability("actor")).rejects.toThrow();
      await expect(service.createProject("actor", { code: "P02", name: "越权" })).rejects.toThrow();
    }
  });
  it("同名项目预检给出核对提示但仍允许继续，当前编号对应原项目不误报", async () => {
    const { service } = projectFixture();
    await expect(service.validateCreationWithWarnings("gm", { code: "P02", name: "原项目" })).resolves.toMatchObject({ valid: true, warnings: ["已有同名项目，请核对项目编号；确认后仍可继续保存"] });
    await expect(service.validateCreationWithWarnings("gm", { code: "P01", name: "原项目" })).resolves.toMatchObject({ valid: true, warnings: [] });
  });
});

it("公开HTTP实时校验项目三岗，停用/失岗立即拒绝且不把总经理扩成单位档案岗", async () => {
  const fixture = projectFixture();
  const module = await Test.createTestingModule({ controllers: [ProjectController], providers: [{ provide: ProjectService, useValue: fixture.service }] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: "actor" }; next(); });
  app.useGlobalGuards(new PermissionGuard(new Reflector(), fixture.db as never));
  await app.listen(0, "127.0.0.1");
  try {
    const url = await app.getUrl();
    for (const role of ["general_manager", "chairman", "comprehensive_director"]) {
      fixture.state.roleKey = role;
      expect((await fetch(`${url}/projects/management`)).status).toBe(200);
      const capability = await (await fetch(`${url}/projects/p1/update-capability`)).json();
      expect(capability.availableActions).toContain("update_project");
      expect(capability.availableActions.includes("update_project_status")).toBe(role !== "general_manager");
    }
    fixture.state.roleKey = "general_manager";
    const precheck = await fetch(`${url}/projects/create-validation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "P02", name: "原项目" }) });
    expect(precheck.status).toBe(201); expect(await precheck.json()).toMatchObject({ valid: true, warnings: [expect.stringContaining("同名")] });
    expect((await fetch(`${url}/projects/p1/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: false }) })).status).toBe(403);
    for (const state of [{roleKey:"super_admin",active:true,global:true},{roleKey:"chairman",active:false,global:true},{roleKey:"chairman",active:true,global:false},{roleKey:"contract_director",active:true,global:true}]) {
      Object.assign(fixture.state,state);
      expect((await fetch(`${url}/projects/create-capability`)).status).toBe(403);
      expect((await fetch(`${url}/projects/p1`, { method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({name:"越权"}) })).status).toBe(403);
    }
    Object.assign(fixture.state,{roleKey:"general_manager",active:true,global:true});
    expect(await fixture.service.listForManagement("actor")).toEqual([{id:"p1",code:"P01",name:"原项目",isActive:true}]);
  } finally { await app.close(); }
});
