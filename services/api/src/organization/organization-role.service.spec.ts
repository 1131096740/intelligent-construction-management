import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ApplyRoleRemovalDto } from "./dto/apply-role-removal.dto";
import { OrganizationRoleService } from "./organization-role.service";

const HASH = `sha256:${"a".repeat(64)}`;

const globalInput = {
  operation: "remove" as const,
  userId: "target-user",
  scope: "global" as const,
  roleKey: "finance_director" as const,
  snapshotHash: HASH,
  confirmationPassword: "  original-password  "
};

function preview(overrides: Record<string, unknown> = {}) {
  return {
    change: {
      operation: "remove" as const,
      userId: "target-user",
      scope: "global" as const,
      projectId: null,
      roleKey: "finance_director" as const
    },
    evaluatedAt: "2026-07-12T08:00:00.000Z",
    snapshotHash: HASH,
    canApply: true,
    summary: { affectedInstances: 2, blockingInstances: 0 },
    blockingIssues: [],
    impacts: [],
    ...overrides
  };
}

function createHarness(input?: {
  evaluation?: { preview: ReturnType<typeof preview>; targetAssignment: { id: string; source: "user_position" | "project_member" } | null };
  actor?: { id: string; isActive: boolean } | null;
  adminPosition?: { id: string } | null;
  actorAdminAssignment?: { id: string } | null;
}) {
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        input && "actor" in input ? input.actor : { id: "actor-user", isActive: true }
      )
    },
    position: {
      findUnique: jest.fn().mockResolvedValue(
        input && "adminPosition" in input ? input.adminPosition : { id: "position-admin" }
      )
    },
    userPosition: {
      findFirst: jest.fn().mockResolvedValue(
        input && "actorAdminAssignment" in input
          ? input.actorAdminAssignment
          : { id: "actor-admin-assignment" }
      ),
      delete: jest.fn().mockResolvedValue({ id: "server-global-assignment" })
    },
    projectMember: {
      delete: jest.fn().mockResolvedValue({ id: "server-project-assignment" })
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 3 })
    },
    auditLog: { create: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ id: "actor-user" }) };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const impacts = {
    evaluateRoleRemoval: jest.fn().mockResolvedValue(
      input?.evaluation ?? {
        preview: preview(),
        targetAssignment: { id: "server-global-assignment", source: "user_position" as const }
      }
    )
  };
  const Service = OrganizationRoleService as unknown as new (
    prismaService: unknown,
    authService: unknown,
    auditService: unknown,
    permissionImpactService: unknown
  ) => { applyRoleRemoval(actorUserId: string, body: ApplyRoleRemovalDto): Promise<unknown> };
  return { service: new Service(prisma, auth, audit, impacts), prisma, tx, auth, audit, impacts };
}

describe("OrganizationRoleService", () => {
  it("当前密码校验在事务外执行且保留原值，失败时零事务零写入", async () => {
    const { service, prisma, auth, tx, audit } = createHarness();
    auth.confirmPassword.mockRejectedValueOnce(new ForbiddenException("当前密码不正确"));

    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toThrow(
      "当前密码不正确"
    );
    expect(auth.confirmPassword).toHaveBeenCalledWith("actor-user", "  original-password  ");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.projectMember.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["actor 已停用", { actor: { id: "actor-user", isActive: false } }, "当前账号已停用，不能执行岗位撤销"],
    ["actor 不存在", { actor: null }, "当前账号已停用，不能执行岗位撤销"],
    ["super_admin 岗位字典缺失", { adminPosition: null }, "当前账号已不具备全局超级管理员权限"],
    ["actor 已失去规范全局管理员", { actorAdminAssignment: null }, "当前账号已不具备全局超级管理员权限"]
  ] as const)("%s 时事务内再拒绝且零删除", async (_label, harnessInput, message) => {
    const { service, tx, impacts, audit } = createHarness(harnessInput);
    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toThrow(message);
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.projectMember.delete).not.toHaveBeenCalled();
    expect(impacts.evaluateRoleRemoval).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "全局规范事实",
      globalInput,
      { id: "server-global-assignment", source: "user_position" as const },
      "userPosition",
      { operation: "remove", userId: "target-user", scope: "global", projectId: null, roleKey: "finance_director" }
    ],
    [
      "项目规范事实",
      { ...globalInput, scope: "project" as const, projectId: "project-1", roleKey: "project_manager" as const },
      { id: "server-project-assignment", source: "project_member" as const },
      "projectMember",
      { operation: "remove", userId: "target-user", scope: "project", projectId: "project-1", roleKey: "project_manager" }
    ]
  ] as const)("同 hash 且 canApply=true 时只按事务内唯一 ID 删除%s", async (_label, body, targetAssignment, delegateName, change) => {
    const evaluation = {
      preview: preview({ change }),
      targetAssignment
    };
    const { service, prisma, tx, impacts, audit } = createHarness({ evaluation });

    await expect(service.applyRoleRemoval("actor-user", body)).resolves.toEqual({
      change,
      assignmentId: targetAssignment.id,
      source: targetAssignment.source,
      affectedInstances: 2,
      revokedRefreshTokens: 3
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "actor-user" },
      select: { id: true, isActive: true }
    });
    expect(tx.position.findUnique).toHaveBeenCalledWith({
      where: { key: "super_admin" },
      select: { id: true }
    });
    expect(tx.userPosition.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "actor-user",
        positionId: "position-admin",
        projectId: null
      },
      select: { id: true }
    });
    expect(impacts.evaluateRoleRemoval).toHaveBeenCalledWith(
      tx,
      {
        operation: "remove",
        userId: body.userId,
        scope: body.scope,
        ...(body.scope === "project" ? { projectId: body.projectId } : {}),
        roleKey: body.roleKey
      },
      expect.any(Date)
    );
    const deletionDelegate = tx[delegateName];
    expect(deletionDelegate.delete).toHaveBeenCalledWith({ where: { id: targetAssignment.id } });
    expect(tx.userPosition.delete).toHaveBeenCalledTimes(delegateName === "userPosition" ? 1 : 0);
    expect(tx.projectMember.delete).toHaveBeenCalledTimes(delegateName === "projectMember" ? 1 : 0);
    expect((tx.userPosition as Record<string, unknown>).deleteMany).toBeUndefined();
    expect((tx.projectMember as Record<string, unknown>).deleteMany).toBeUndefined();
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-user", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "actor-user",
      action: "permission.role.remove",
      businessType: "role_assignment",
      businessId: targetAssignment.id,
      metadata: {
        userId: "target-user",
        scope: change.scope,
        projectId: change.projectId,
        roleKey: change.roleKey,
        source: targetAssignment.source,
        snapshotHash: HASH,
        affectedInstances: 2,
        revokedRefreshTokens: 3
      }
    });
    const auditJson = JSON.stringify(audit.record.mock.calls[0]);
    expect(auditJson).not.toContain("original-password");
    expect(auditJson).not.toContain("confirmationPassword");
    expect(auditJson).not.toContain("impacts");
    expect(auditJson).not.toContain("tokenHash");
  });

  it("快照 hash 不同时返回 409 并且零删除零审计", async () => {
    const { service, tx, audit } = createHarness({
      evaluation: {
        preview: preview({ snapshotHash: `sha256:${"b".repeat(64)}` }),
        targetAssignment: { id: "server-global-assignment", source: "user_position" }
      }
    });
    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toEqual(
      new ConflictException("组织或审批数据已变化，请重新预览后再试")
    );
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("global apply 携带非 null projectId 时忠实交给评估器拒绝且零写入", async () => {
    const { service, impacts, tx, audit } = createHarness();
    impacts.evaluateRoleRemoval.mockImplementationOnce(
      async (_client: unknown, change: { scope: string; projectId?: string | null }) => {
        if (change.scope === "global" && change.projectId !== undefined && change.projectId !== null) {
          throw new BadRequestException("全局岗位不得提交项目标识");
        }
        return {
          preview: preview(),
          targetAssignment: { id: "server-global-assignment", source: "user_position" }
        };
      }
    );

    await expect(
      service.applyRoleRemoval("actor-user", { ...globalInput, projectId: "project-1" })
    ).rejects.toThrow("全局岗位不得提交项目标识");
    expect(impacts.evaluateRoleRemoval).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ scope: "global", projectId: "project-1" }),
      expect.any(Date)
    );
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.projectMember.delete).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "global 评估返回 project_member",
      globalInput,
      preview(),
      { id: "wrong-project-member", source: "project_member" as const }
    ],
    [
      "project 评估返回 user_position",
      {
        ...globalInput,
        scope: "project" as const,
        projectId: "project-1",
        roleKey: "project_manager" as const
      },
      preview({
        change: {
          operation: "remove",
          userId: "target-user",
          scope: "project",
          projectId: "project-1",
          roleKey: "project_manager"
        }
      }),
      { id: "wrong-user-position", source: "user_position" as const }
    ]
  ] as const)("%s 时 409 fail closed 且零写入", async (_label, body, latestPreview, targetAssignment) => {
    const { service, tx, audit } = createHarness({
      evaluation: { preview: latestPreview, targetAssignment }
    });
    await expect(service.applyRoleRemoval("actor-user", body)).rejects.toEqual(
      new ConflictException("岗位撤销目标来源与范围不一致，请重新预览后再试")
    );
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.projectMember.delete).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["canApply=false", { preview: preview({ canApply: false }), targetAssignment: { id: "server-global-assignment", source: "user_position" as const } }],
    ["目标缺失/重复", { preview: preview({ canApply: false }), targetAssignment: null }],
    ["legacy shadow", { preview: preview({ canApply: false, blockingIssues: [{ code: "legacy_shadow_assignment" }] }), targetAssignment: { id: "server-global-assignment", source: "user_position" as const } }],
    ["最后管理员", { preview: preview({ canApply: false, blockingIssues: [{ code: "last_active_global_super_admin" }] }), targetAssignment: { id: "server-global-assignment", source: "user_position" as const } }],
    ["多岗位 all", { preview: preview({ canApply: false, summary: { affectedInstances: 1, blockingInstances: 1 } }), targetAssignment: { id: "server-global-assignment", source: "user_position" as const } }]
  ] as const)("最新评估为 %s 时 fail closed 且零删除", async (_label, evaluation) => {
    const { service, tx, audit } = createHarness({ evaluation });
    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(tx.userPosition.delete).not.toHaveBeenCalled();
    expect(tx.projectMember.delete).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("删除、token 撤销和审计使用同一 tx client，审计异常不被吞掉", async () => {
    const { service, tx, audit } = createHarness();
    audit.record.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toThrow(
      "audit unavailable"
    );
    expect(tx.userPosition.delete).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.any(Object));
  });

  it.each([
    ["P2025", "岗位事实已变化，请重新预览后再试"],
    ["P2034", "组织或审批数据已变化，请重新预览后再试"]
  ] as const)("映射 Prisma %s 并发中文错误", async (code, message) => {
    const { service, tx } = createHarness();
    tx.userPosition.delete.mockRejectedValueOnce(Object.assign(new Error("internal"), { code }));
    await expect(service.applyRoleRemoval("actor-user", globalInput)).rejects.toEqual(
      new ConflictException(message)
    );
  });
});
