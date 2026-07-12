import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PermissionImpactService } from "./permission-impact.service";

const EVALUATED_AT = new Date("2026-07-12T03:00:00.000Z");

interface Fixture {
  users: Array<{ id: string; isActive: boolean }>;
  positions: Array<{ id: string; key: string }>;
  userPositions: Array<{ id: string; userId: string; positionId: string; projectId: string | null }>;
  projectMembers: Array<{ id: string; userId: string; projectId: string; positionKey: string }>;
  projects: Array<{ id: string }>;
  instances: Array<{
    id: string;
    businessType: string;
    businessId: string;
    applicantUserId: string;
    currentNodeIndex: number;
    frozenNodes: unknown;
  }>;
  settlements: Array<{ id: string; projectId: string }>;
}

function fixture(): Fixture {
  return {
    users: [
      { id: "manager-a", isActive: true },
      { id: "manager-b", isActive: true },
      { id: "applicant", isActive: true }
    ],
    positions: [
      { id: "position-manager", key: "project_manager" },
      { id: "position-finance", key: "finance_director" }
    ],
    userPositions: [],
    projectMembers: [
      { id: "member-a", userId: "manager-a", projectId: "project-1", positionKey: "project_manager" },
      { id: "member-b", userId: "manager-b", projectId: "project-1", positionKey: "project_manager" }
    ],
    projects: [{ id: "project-1" }],
    instances: [
      {
        id: "approval-1",
        businessType: "settlement",
        businessId: "settlement-1",
        applicantUserId: "applicant",
        currentNodeIndex: 0,
        frozenNodes: [{ name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }]
      }
    ],
    settlements: [{ id: "settlement-1", projectId: "project-1" }]
  };
}

function transactionClient(data: Fixture) {
  return {
    user: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.users)) },
    position: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.positions)) },
    userPosition: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.userPositions)) },
    projectMember: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.projectMembers)) },
    project: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.projects)) },
    approvalInstance: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.instances)) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
    contract: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn().mockImplementation(() => Promise.resolve(data.settlements)) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function harness(data = fixture()) {
  const tx = transactionClient(data);
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  };
  return { data, tx, prisma, service: new PermissionImpactService(prisma as never) };
}

const targets = [
  {
    operation: "remove" as const,
    userId: "manager-a",
    scope: "project" as const,
    projectId: "project-1",
    roleKey: "project_manager" as const
  },
  {
    operation: "remove" as const,
    userId: "manager-b",
    scope: "project" as const,
    projectId: "project-1",
    roleKey: "project_manager" as const
  }
];

describe("PermissionImpactService batch removal preview", () => {
  it("两个目标分别单独撤销都安全", async () => {
    const first = harness();
    const second = harness();

    await expect(
      first.service.evaluateRoleRemoval(first.tx as never, targets[0], EVALUATED_AT)
    ).resolves.toMatchObject({ preview: { canApply: true } });
    await expect(
      second.service.evaluateRoleRemoval(second.tx as never, targets[1], EVALUATED_AT)
    ).resolves.toMatchObject({ preview: { canApply: true } });
  });

  it("在同一一致性读事务和 evaluatedAt 中累计排除前序唯一 assignment", async () => {
    const { prisma, service } = harness();

    const result = await service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
    expect(result).toMatchObject({
      evaluatedAt: EVALUATED_AT.toISOString(),
      canApply: false,
      simulatedTargets: 2,
      blockingTarget: targets[1],
      steps: [
        { sequence: 0, change: targets[0], canApply: true },
        {
          sequence: 1,
          change: targets[1],
          canApply: false,
          impacts: [expect.objectContaining({ blocking: true })]
        }
      ]
    });
    expect(result.combinedSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("所有步骤共享同一 evaluatedAt", async () => {
    const { tx, service } = harness();
    await service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);

    expect(tx.approvalDelegation.findMany).toHaveBeenCalledTimes(1);
    for (const [query] of tx.approvalDelegation.findMany.mock.calls) {
      expect(query).toMatchObject({
        where: {
          enabled: true,
          startsAt: { lte: EVALUATED_AT },
          endsAt: { gte: EVALUATED_AT }
        }
      });
    }
    for (const delegate of Object.values(tx)) {
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
    }
  });

  it("从当前节点扫描到冻结流程末尾并阻断未来无人可批", async () => {
    const data = fixture();
    data.instances[0] = {
      ...data.instances[0],
      frozenNodes: [
        { name: "财务审批", mode: "any", roleKeys: ["finance_director"] },
        { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }
      ]
    };
    const { service } = harness(data);

    const result = await service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);

    expect(result.canApply).toBe(false);
    expect(result.steps[1]?.impacts).toContainEqual(
      expect.objectContaining({ currentNodeIndex: 1, currentNodeName: "项目经理审批", blocking: true })
    );
  });

  it("任一步阻断后立即停止，不伪造后续安全步骤", async () => {
    const data = fixture();
    data.projectMembers = data.projectMembers.filter((member) => member.id !== "member-a");
    const { service } = harness(data);
    const third = { ...targets[0], userId: "manager-c" };

    const result = await service.previewRoleRemovalBatch({ targets: [...targets, third] }, EVALUATED_AT);

    expect(result.simulatedTargets).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.blockingTarget).toEqual(targets[0]);
  });

  it("拒绝规范化后的重复坐标", async () => {
    const { prisma, service } = harness();

    await expect(
      service.previewRoleRemovalBatch(
        { targets: [targets[0], { ...targets[0], userId: " manager-a ", projectId: " project-1 " }] },
        EVALUATED_AT
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["全局岗位夹带项目", { ...targets[0], scope: "global" as const }],
    ["项目岗位缺少项目", { ...targets[0], projectId: null }]
  ])("%s 时在开启读事务前拒绝", async (_label, invalidTarget) => {
    const { prisma, service } = harness();
    await expect(
      service.previewRoleRemovalBatch({ targets: [invalidTarget, targets[1]] }, EVALUATED_AT)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("累计撤销全局管理员时阻止第二步删除最后一人", async () => {
    const data = fixture();
    data.users.push({ id: "admin-a", isActive: true }, { id: "admin-b", isActive: true });
    data.positions.push({ id: "position-admin", key: "super_admin" });
    data.userPositions.push(
      { id: "admin-assignment-a", userId: "admin-a", positionId: "position-admin", projectId: null },
      { id: "admin-assignment-b", userId: "admin-b", positionId: "position-admin", projectId: null }
    );
    const adminTargets = [
      { operation: "remove" as const, userId: "admin-a", scope: "global" as const, roleKey: "super_admin" as const },
      { operation: "remove" as const, userId: "admin-b", scope: "global" as const, roleKey: "super_admin" as const }
    ];

    const result = await harness(data).service.previewRoleRemovalBatch(
      { targets: adminTargets },
      EVALUATED_AT
    );

    expect(result.steps[0]).toMatchObject({ canApply: true });
    expect(result.steps[1]).toMatchObject({
      canApply: false,
      blockingIssues: [expect.objectContaining({ code: "last_active_global_super_admin" })]
    });
  });

  it("任一项目撤岗存在 legacy shadow 时阻断并停止", async () => {
    const data = fixture();
    data.userPositions.push({
      id: "legacy-shadow",
      userId: "manager-a",
      positionId: "position-manager",
      projectId: "project-1"
    });
    const result = await harness(data).service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);

    expect(result).toMatchObject({ canApply: false, simulatedTargets: 1, blockingTarget: targets[0] });
    expect(result.steps[0]?.blockingIssues).toContainEqual(
      expect.objectContaining({ code: "legacy_shadow_assignment" })
    );
  });

  it("服务层二线限制 2..20 条", async () => {
    const { service } = harness();
    await expect(service.previewRoleRemovalBatch({ targets: [targets[0]] }, EVALUATED_AT)).rejects.toThrow(
      "批量撤销至少需要 2 个目标"
    );
    await expect(
      service.previewRoleRemovalBatch(
        { targets: Array.from({ length: 21 }, (_, index) => ({ ...targets[0], userId: `manager-${index}` })) },
        EVALUATED_AT
      )
    ).rejects.toThrow("批量撤销一次最多 20 个目标");
  });

  it("批量预览全程只读，不提供 batch apply 也不调用写方法", async () => {
    const { tx, service } = harness();
    await service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);

    for (const delegate of Object.values(tx)) {
      expect(Object.keys(delegate)).toEqual(["findMany"]);
    }
    expect((service as unknown as { applyRoleRemovalBatch?: unknown }).applyRoleRemovalBatch).toBeUndefined();
  });

  it("组合 hash 绑定目标顺序并对同一输入稳定", async () => {
    const first = await harness().service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);
    const second = await harness().service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);
    const reversed = await harness().service.previewRoleRemovalBatch(
      { targets: [...targets].reverse() },
      EVALUATED_AT
    );

    expect(second.combinedSnapshotHash).toBe(first.combinedSnapshotHash);
    expect(reversed.combinedSnapshotHash).not.toBe(first.combinedSnapshotHash);
  });

  it("组合 hash 绑定服务端解析的 assignment ID", async () => {
    const original = await harness().service.previewRoleRemovalBatch({ targets }, EVALUATED_AT);
    const changedData = fixture();
    changedData.projectMembers = changedData.projectMembers.map((member) =>
      member.id === "member-a" ? { ...member, id: "member-a-recreated" } : member
    );
    const changed = await harness(changedData).service.previewRoleRemovalBatch(
      { targets },
      EVALUATED_AT
    );

    expect(changed.combinedSnapshotHash).not.toBe(original.combinedSnapshotHash);
  });
});
