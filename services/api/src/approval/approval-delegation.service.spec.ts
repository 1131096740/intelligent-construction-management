import { ApprovalDelegationService } from "./approval-delegation.service";

describe("ApprovalDelegationService", () => {
  const audit = {
    record: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
  });

  it("creates a standing delegation and records an audit entry", async () => {
    const prisma = {
      approvalDelegation: {
        create: jest.fn().mockResolvedValue({
          id: "delegation-1",
          fromUserId: "user-a",
          toUserId: "user-b"
        })
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "user-b" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    const result = await service.create("user-a", {
      toUserId: "user-b",
      startsAt: "2026-06-23T00:00:00.000Z",
      endsAt: "2026-07-23T00:00:00.000Z"
    });

    expect(result.id).toBe("delegation-1");
    expect(prisma.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "user-a",
        toUserId: "user-b",
        startsAt: new Date("2026-06-23T00:00:00.000Z"),
        endsAt: new Date("2026-07-23T00:00:00.000Z")
      }
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "user-b", isActive: true },
      select: { id: true }
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorUserId: "user-a",
      action: "approval.delegation.create",
      businessType: "approval_delegation",
      businessId: "delegation-1",
      metadata: {
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      }
    });
  });

  it("persists an exact action and resource scope for clearing delegation", async () => {
    const prisma = {
      approvalDelegation: {
        create: jest.fn().mockResolvedValue({
          id: "delegation-scoped-1",
          fromUserId: "user-a",
          toUserId: "user-b"
        })
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "user-b" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await service.create("user-a", {
      toUserId: "user-b",
      startsAt: "2026-06-23T00:00:00.000Z",
      endsAt: "2026-07-23T00:00:00.000Z",
      actionKey: "clearing.confirm",
      resourceType: "clearing_event",
      resourceId: "event-1"
    });

    expect(prisma.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "user-a",
        toUserId: "user-b",
        startsAt: new Date("2026-06-23T00:00:00.000Z"),
        endsAt: new Date("2026-07-23T00:00:00.000Z"),
        actionKey: "clearing.confirm",
        resourceType: "clearing_event",
        resourceId: "event-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      metadata: expect.objectContaining({
        actionKey: "clearing.confirm",
        resourceType: "clearing_event",
        resourceId: "event-1"
      })
    }));
  });

  it("rejects a partially scoped delegation", async () => {
    const prisma = { approvalDelegation: { create: jest.fn() } };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z",
        actionKey: "clearing.confirm"
      })
    ).rejects.toThrow("作用域必须同时包含动作、资源类型和资源标识");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("rejects a delegation target outside the delegator visible projects", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    ).rejects.toThrow("只能委托给同项目可协作人员，请重新选择接收人");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("rejects a delegation that targets the delegator", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(
      service.create("user-a", {
        toUserId: "user-a",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    ).rejects.toThrow("请选择需要委托的审批接收人，不能委托给自己");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("rejects a delegation window that does not end after it starts", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "user-b" }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "2026-07-23T00:00:00.000Z",
        endsAt: "2026-06-23T00:00:00.000Z"
      })
    ).rejects.toThrow("委托结束时间必须晚于开始时间");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("uses a business message when delegation dates are invalid", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "user-b" }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "not-a-date",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    ).rejects.toThrow("委托有效期不正确，请重新选择开始和结束时间");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("rejects a delegation target that is not an active user", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    ).rejects.toThrow("委托接收人不存在或已停用，请重新选择");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("lists delegations where the user is delegator or delegate", async () => {
    const prisma = {
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegation-1", fromUserId: "user-a", toUserId: "user-b" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-a", name: "委托人" },
          { id: "user-b", name: "受托人" }
        ])
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    const result = await service.listForUser("user-a");

    expect(result).toEqual([
      {
        id: "delegation-1",
        fromUserId: "user-a",
        toUserId: "user-b",
        fromUserName: "委托人",
        toUserName: "受托人"
      }
    ]);
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: { OR: [{ fromUserId: "user-a" }, { toUserId: "user-a" }] },
      orderBy: { createdAt: "desc" }
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-a", "user-b"] } },
      select: { id: true, name: true }
    });
  });

  it("does not expose internal accounts when delegation user names are unavailable", async () => {
    const prisma = {
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegation-1", fromUserId: "from-internal-id", toUserId: "to-internal-id" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    const result = await service.listForUser("from-internal-id");

    expect(result).toEqual([
      {
        id: "delegation-1",
        fromUserId: "from-internal-id",
        toUserId: "to-internal-id",
        fromUserName: "委托人未读取",
        toUserName: "受托人未读取"
      }
    ]);
  });

  it("lists same-project active users as delegation targets", async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-b", name: "受托人" }])
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "user-b" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ userId: "user-c" }]) }
    };
    const projectVisibility = {
      visibleProjectIds: jest.fn().mockResolvedValue(["project-1"])
    };
    const service = new ApprovalDelegationService(
      prisma as never,
      audit as never,
      projectVisibility as never
    );

    await expect(service.listActiveUserOptions("user-a")).resolves.toEqual([
      { id: "user-b", name: "受托人" }
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["user-b", "user-c"], not: "user-a" },
        isActive: true
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    });
  });

  it("lets only the delegator revoke a delegation", async () => {
    const prisma = {
      approvalDelegation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "delegation-1",
          fromUserId: "user-a",
          toUserId: "user-b",
          enabled: true
        }),
        update: jest.fn()
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(service.revoke("delegation-1", "user-b")).rejects.toThrow(
      "只有委托发起人可以撤销这条审批委托"
    );
    expect(prisma.approvalDelegation.update).not.toHaveBeenCalled();
  });

  it("uses a business message when the delegation to revoke is missing", async () => {
    const prisma = {
      approvalDelegation: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(service.revoke("delegation-missing", "user-a")).rejects.toThrow(
      "审批委托记录不存在或已被删除"
    );
    expect(prisma.approvalDelegation.update).not.toHaveBeenCalled();
  });

  it("uses a business message when the delegation is already revoked", async () => {
    const prisma = {
      approvalDelegation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "delegation-1",
          fromUserId: "user-a",
          toUserId: "user-b",
          enabled: false
        }),
        update: jest.fn()
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(service.revoke("delegation-1", "user-a")).rejects.toThrow(
      "这条审批委托已撤销，无需重复操作"
    );
    expect(prisma.approvalDelegation.update).not.toHaveBeenCalled();
  });

  it("revokes a delegation by disabling it and records an audit entry", async () => {
    const prisma = {
      approvalDelegation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "delegation-1",
          fromUserId: "user-a",
          toUserId: "user-b",
          enabled: true
        }),
        update: jest.fn().mockResolvedValue({ id: "delegation-1", enabled: false })
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    const result = await service.revoke("delegation-1", "user-a");

    expect(result.enabled).toBe(false);
    expect(prisma.approvalDelegation.update).toHaveBeenCalledWith({
      where: { id: "delegation-1" },
      data: { enabled: false }
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorUserId: "user-a",
      action: "approval.delegation.revoke",
      businessType: "approval_delegation",
      businessId: "delegation-1",
      metadata: { toUserId: "user-b" }
    });
  });

  it("returns distinct active delegator ids for a delegate at a point in time", async () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    const client = {
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { fromUserId: "user-a" },
          { fromUserId: "user-a" },
          { fromUserId: "user-c" },
          { fromUserId: "user-inactive" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-b", isActive: true },
          { id: "user-a", isActive: true },
          { id: "user-c", isActive: true },
          { id: "user-inactive", isActive: false }
        ])
      }
    };
    const service = new ApprovalDelegationService();

    const result = await service.activeDelegatorIds(client as never, "user-b", now);

    expect(result).toEqual(["user-a", "user-c"]);
    expect(client.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        toUserId: "user-b",
        actionKey: null,
        resourceType: null,
        resourceId: null,
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gt: now }
      },
      select: { fromUserId: true }
    });
    expect(client.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-b", "user-a", "user-c", "user-inactive"] } },
      select: { id: true, isActive: true }
    });
  });
});
