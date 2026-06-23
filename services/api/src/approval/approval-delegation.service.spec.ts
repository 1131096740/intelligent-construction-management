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
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

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
    ).rejects.toThrow("Approval delegation target is invalid");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("rejects a delegation window that does not end after it starts", async () => {
    const prisma = {
      approvalDelegation: { create: jest.fn() }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    await expect(
      service.create("user-a", {
        toUserId: "user-b",
        startsAt: "2026-07-23T00:00:00.000Z",
        endsAt: "2026-06-23T00:00:00.000Z"
      })
    ).rejects.toThrow("Approval delegation must end after it starts");
    expect(prisma.approvalDelegation.create).not.toHaveBeenCalled();
  });

  it("lists delegations where the user is delegator or delegate", async () => {
    const prisma = {
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ id: "delegation-1" }])
      }
    };
    const service = new ApprovalDelegationService(prisma as never, audit as never);

    const result = await service.listForUser("user-a");

    expect(result).toEqual([{ id: "delegation-1" }]);
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: { OR: [{ fromUserId: "user-a" }, { toUserId: "user-a" }] },
      orderBy: { createdAt: "desc" }
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
      "Only the delegator can revoke an approval delegation"
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
          { fromUserId: "user-c" }
        ])
      }
    };
    const service = new ApprovalDelegationService();

    const result = await service.activeDelegatorIds(client as never, "user-b", now);

    expect(result).toEqual(["user-a", "user-c"]);
    expect(client.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        toUserId: "user-b",
        enabled: true,
        startsAt: { lte: now },
        endsAt: { gte: now }
      }
    });
  });
});
