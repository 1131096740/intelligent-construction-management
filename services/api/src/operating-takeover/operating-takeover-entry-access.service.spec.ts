import type { Prisma } from "@prisma/client";
import { OPERATING_TAKEOVER_SCENE_DEFINITIONS, type RoleKey } from "@jiangkong/shared-domain";
import { OperatingTakeoverEntryAccessService } from "./operating-takeover-entry-access.service";

describe("历史经营接管领域授权", () => {
  const context = { sceneKey: "owner_settlement", actorUserId: "actor", projectId: "project", scope: "project" as const, operation: "import" as const, target: { entityType: "operating_takeover_row", entityId: "project" }, values: {} };
  function fixture(roles: RoleKey[]) {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue({ id: "project" }) } };
    const visibility = { effectiveRoleScopes: jest.fn().mockResolvedValue({ globalRoleKeys: [], projectRoleKeys: roles }), effectiveRoleScopesInTransaction: jest.fn().mockResolvedValue({ globalRoleKeys: [], projectRoleKeys: roles }) };
    return { service: new OperatingTakeoverEntryAccessService(prisma as never, visibility as never), prisma, visibility };
  }
  it("主管可按原整批导入规则预检所有场景，未获得其他专业编辑权", async () => {
    const { service } = fixture(["contract_director"]);
    for (const scene of OPERATING_TAKEOVER_SCENE_DEFINITIONS) await expect(service.assertAuthorized({ ...context, sceneKey: scene.key })).resolves.toBeUndefined();
    await expect(service.assertAuthorized({ ...context, sceneKey: "owner_payment", operation: "edit" })).rejects.toThrow("当前岗位无权");
  });
  it.each<[RoleKey, string, boolean]>([
    ["contract_staff", "owner_settlement", true], ["contract_staff", "owner_payment", false],
    ["finance_staff", "owner_payment", true], ["finance_staff", "historical_expense", true],
    ["employee", "owner_settlement", false], ["super_admin", "owner_settlement", false], ["chairman", "owner_settlement", false]
  ])("%s 在 %s 的原专业边界=%s", async (role, sceneKey, allowed) => {
    const call = fixture([role]).service.assertAuthorized({ ...context, sceneKey });
    if (allowed) await expect(call).resolves.toBeUndefined();
    else await expect(call).rejects.toThrow("当前岗位无权");
  });
  it("跨项目、缺失目标、未知场景和停用项目保持拒绝", async () => {
    const { service, prisma } = fixture(["contract_director"]);
    for (const input of [
      { ...context, target: { entityType: "operating_takeover_row", entityId: "other" } },
      { ...context, target: { entityType: "other", entityId: "project" } },
      { ...context, target: { entityType: "operating_takeover_row", createTarget: "fake" } },
      { ...context, sceneKey: "unknown" }, { ...context, projectId: undefined }
    ]) await expect(service.assertAuthorized(input)).rejects.toThrow("目标与当前项目不一致");
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service.assertAuthorized(context)).rejects.toThrow("项目不存在或已停用");
  });
  it("传入事务时仅使用原事务查项目、解析真实操作人的岗位，不回退到独立连接", async () => {
    const { service, prisma, visibility } = fixture(["contract_staff"]);
    const tx = { project: { findUnique: jest.fn().mockResolvedValue({ id: "project" }) } };
    await service.assertAuthorized({ ...context, tx: tx as unknown as Prisma.TransactionClient });
    expect(visibility.effectiveRoleScopesInTransaction).toHaveBeenCalledWith(tx, "actor", "project");
    expect(visibility.effectiveRoleScopes).not.toHaveBeenCalled();
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(tx.project.findUnique).toHaveBeenCalledWith({ where: { id: "project", isActive: true }, select: { id: true } });
  });
});
