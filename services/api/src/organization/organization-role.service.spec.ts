import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ApplyRoleAdditionDto } from "./dto/apply-role-addition.dto";
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

const globalAdditionInput = {
  operation: "add" as const,
  userId: "target-user",
  scope: "global" as const,
  roleKey: "finance_director" as const,
  snapshotHash: HASH,
  confirmationPassword: "  addition-password  "
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

function additionPreview(overrides: Record<string, unknown> = {}) {
  return {
    change: {
      operation: "add" as const,
      userId: "target-user",
      scope: "global" as const,
      projectId: null,
      roleKey: "finance_director" as const
    },
    evaluatedAt: "2026-07-12T08:00:00.000Z",
    snapshotHash: HASH,
    canApply: true,
    summary: { affectedNodes: 2, blockingNodes: 0 },
    blockingIssues: [],
    impacts: [],
    ...overrides
  };
}

function createHarness(input?: {
  evaluation?: { preview: ReturnType<typeof preview>; targetAssignment: { id: string; source: "user_position" | "project_member" } | null };
  additionEvaluation?: {
    preview: ReturnType<typeof additionPreview>;
    targetCreate:
      | { source: "user_position"; userId: string; projectId: null; roleKey: "finance_director"; positionId: string }
      | { source: "project_member"; userId: string; projectId: string; roleKey: "project_manager" }
      | null;
  };
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
      ),
      findMany: jest.fn().mockResolvedValue([])
    },
    userPosition: {
      findFirst: jest.fn().mockResolvedValue(
        input && "actorAdminAssignment" in input
          ? input.actorAdminAssignment
          : { id: "actor-admin-assignment" }
      ),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ id: "server-global-assignment" }),
      create: jest.fn().mockResolvedValue({ id: "created-global-assignment" })
    },
    projectMember: {
      delete: jest.fn().mockResolvedValue({ id: "server-project-assignment" }),
      create: jest.fn().mockResolvedValue({ id: "created-project-assignment" })
    },
    department: { findMany: jest.fn().mockResolvedValue([]) },
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
    ),
    evaluateRoleAddition: jest.fn().mockResolvedValue(
      input?.additionEvaluation ?? {
        preview: additionPreview(),
        targetCreate: {
          source: "user_position" as const,
          userId: "target-user",
          projectId: null,
          roleKey: "finance_director" as const,
          positionId: "position-finance"
        }
      }
    )
  };
  const Service = OrganizationRoleService as unknown as new (
    prismaService: unknown,
    authService: unknown,
    auditService: unknown,
    permissionImpactService: unknown
  ) => {
    applyRoleRemoval(actorUserId: string, body: ApplyRoleRemovalDto): Promise<unknown>;
    applyRoleAddition(actorUserId: string, body: ApplyRoleAdditionDto): Promise<unknown>;
  };
  return { service: new Service(prisma, auth, audit, impacts), prisma, tx, auth, audit, impacts };
}

describe("OrganizationRoleService", () => {
  it("暴露独立的岗位新增 apply 入口", () => {
    const { service } = createHarness();
    expect(typeof (service as unknown as { applyRoleAddition?: unknown }).applyRoleAddition).toBe(
      "function"
    );
  });

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
    ["super_admin 岗位字典缺失", { adminPosition: null }, "当前账号没有岗位管理权限"],
    ["actor 已失去规范全局管理员", { actorAdminAssignment: null }, "当前账号没有岗位管理权限"]
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

  describe("岗位新增 apply", () => {
    it("密码失败时零事务零写入，并保留密码原值", async () => {
      const { service, prisma, auth, tx, audit } = createHarness();
      auth.confirmPassword.mockRejectedValueOnce(new ForbiddenException("当前密码不正确"));
      await expect(service.applyRoleAddition("actor-user", globalAdditionInput)).rejects.toThrow(
        "当前密码不正确"
      );
      expect(auth.confirmPassword).toHaveBeenCalledWith("actor-user", "  addition-password  ");
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.userPosition.create).not.toHaveBeenCalled();
      expect(tx.projectMember.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("事务内 actor 已停用时拒绝新增", async () => {
      const { service, tx, impacts } = createHarness({
        actor: { id: "actor-user", isActive: false }
      });
      await expect(service.applyRoleAddition("actor-user", globalAdditionInput)).rejects.toThrow(
        "当前账号已停用，不能执行岗位新增"
      );
      expect(impacts.evaluateRoleAddition).not.toHaveBeenCalled();
      expect(tx.userPosition.create).not.toHaveBeenCalled();
    });

    it.each([
      [
        "全局岗位",
        globalAdditionInput,
        additionPreview(),
        {
          source: "user_position" as const,
          userId: "target-user",
          projectId: null,
          roleKey: "finance_director" as const,
          positionId: "position-finance"
        },
        "userPosition",
        "created-global-assignment"
      ],
      [
        "项目岗位",
        {
          ...globalAdditionInput,
          scope: "project" as const,
          projectId: "project-1",
          roleKey: "project_manager" as const
        },
        additionPreview({
          change: {
            operation: "add",
            userId: "target-user",
            scope: "project",
            projectId: "project-1",
            roleKey: "project_manager"
          }
        }),
        {
          source: "project_member" as const,
          userId: "target-user",
          projectId: "project-1",
          roleKey: "project_manager" as const
        },
        "projectMember",
        "created-project-assignment"
      ]
    ] as const)("同 hash 且 canApply 时精确创建%s", async (_label, body, latestPreview, targetCreate, delegate, assignmentId) => {
      const { service, prisma, tx, impacts, audit } = createHarness({
        additionEvaluation: { preview: latestPreview, targetCreate }
      });
      await expect(service.applyRoleAddition("actor-user", body)).resolves.toEqual({
        change: latestPreview.change,
        assignmentId,
        source: targetCreate.source,
        affectedNodes: 2,
        revokedRefreshTokens: 3
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      expect(impacts.evaluateRoleAddition).toHaveBeenCalledWith(
        tx,
        {
          operation: "add",
          userId: body.userId,
          scope: body.scope,
          ...("projectId" in body && body.projectId !== undefined
            ? { projectId: body.projectId }
            : {}),
          roleKey: body.roleKey
        },
        expect.any(Date)
      );
      if (delegate === "userPosition") {
        expect(tx.userPosition.create).toHaveBeenCalledWith({
          data: { userId: "target-user", positionId: "position-finance", projectId: null },
          select: { id: true }
        });
        expect(tx.projectMember.create).not.toHaveBeenCalled();
      } else {
        expect(tx.projectMember.create).toHaveBeenCalledWith({
          data: {
            userId: "target-user",
            projectId: "project-1",
            positionKey: "project_manager"
          },
          select: { id: true }
        });
        expect(tx.userPosition.create).not.toHaveBeenCalled();
      }
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "target-user", revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorUserId: "actor-user",
        action: "permission.role.add",
        businessType: "role_assignment",
        businessId: assignmentId,
        metadata: {
          userId: "target-user",
          scope: latestPreview.change.scope,
          projectId: latestPreview.change.projectId,
          roleKey: latestPreview.change.roleKey,
          source: targetCreate.source,
          snapshotHash: HASH,
          affectedNodes: 2,
          revokedRefreshTokens: 3
        }
      });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain("addition-password");
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain("impacts");
    });

    it.each([
      ["快照过期", { preview: additionPreview({ snapshotHash: `sha256:${"b".repeat(64)}` }), targetCreate: { source: "user_position" as const, userId: "target-user", projectId: null, roleKey: "finance_director" as const, positionId: "position-finance" } }],
      ["最新阻断", { preview: additionPreview({ canApply: false }), targetCreate: { source: "user_position" as const, userId: "target-user", projectId: null, roleKey: "finance_director" as const, positionId: "position-finance" } }],
      ["目标未解析", { preview: additionPreview(), targetCreate: null }],
      ["来源不匹配", { preview: additionPreview(), targetCreate: { source: "project_member" as const, userId: "target-user", projectId: "project-1", roleKey: "project_manager" as const } }],
      ["坐标不匹配", { preview: additionPreview(), targetCreate: { source: "user_position" as const, userId: "other", projectId: null, roleKey: "finance_director" as const, positionId: "position-finance" } }]
    ] as const)("%s 时 409 且零写入", async (_label, additionEvaluation) => {
      const { service, tx, audit } = createHarness({ additionEvaluation });
      await expect(service.applyRoleAddition("actor-user", globalAdditionInput)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(tx.userPosition.create).not.toHaveBeenCalled();
      expect(tx.projectMember.create).not.toHaveBeenCalled();
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ["P2002", "岗位事实已存在，请刷新后重新预览"],
      ["P2034", "组织或审批数据已变化，请重新预览后再试"]
    ] as const)("新增映射 Prisma %s 并发错误", async (code, message) => {
      const { service, tx } = createHarness();
      tx.userPosition.create.mockRejectedValueOnce(Object.assign(new Error("internal"), { code }));
      await expect(service.applyRoleAddition("actor-user", globalAdditionInput)).rejects.toEqual(
        new ConflictException(message)
      );
    });

    it("审计异常不被吞掉，且三类写操作使用同一 tx client", async () => {
      const { service, tx, audit } = createHarness();
      audit.record.mockRejectedValueOnce(new Error("audit unavailable"));
      await expect(service.applyRoleAddition("actor-user", globalAdditionInput)).rejects.toThrow(
        "audit unavailable"
      );
      expect(tx.userPosition.create).toHaveBeenCalledTimes(1);
      expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(tx, expect.any(Object));
    });
  });
});
