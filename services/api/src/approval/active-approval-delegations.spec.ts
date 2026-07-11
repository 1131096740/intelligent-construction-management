import { activeApprovalDelegatorIds } from "./active-approval-delegations";

const NOW = new Date("2026-07-12T08:00:00.000Z");

function client(
  delegations: Array<{ fromUserId: string }>,
  users: Array<{ id: string; isActive: boolean }>
) {
  return {
    approvalDelegation: { findMany: jest.fn().mockResolvedValue(delegations) },
    user: { findMany: jest.fn().mockResolvedValue(users) }
  };
}

describe("activeApprovalDelegatorIds", () => {
  it("双端启用时按首次出现顺序返回去重委托人并固定时间窗查询", async () => {
    const prisma = client(
      [
        { fromUserId: "from-2" },
        { fromUserId: "from-1" },
        { fromUserId: "from-2" }
      ],
      [
        { id: "to-1", isActive: true },
        { id: "from-1", isActive: true },
        { id: "from-2", isActive: true }
      ]
    );

    await expect(
      activeApprovalDelegatorIds(prisma as never, "to-1", NOW)
    ).resolves.toEqual(["from-2", "from-1"]);
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        toUserId: "to-1",
        enabled: true,
        startsAt: { lte: NOW },
        endsAt: { gte: NOW }
      },
      select: { fromUserId: true }
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["to-1", "from-2", "from-1"] } },
      select: { id: true, isActive: true }
    });
  });

  it("排除缺失或停用的委托人", async () => {
    const prisma = client(
      [
        { fromUserId: "from-active" },
        { fromUserId: "from-inactive" },
        { fromUserId: "from-missing" }
      ],
      [
        { id: "to-1", isActive: true },
        { id: "from-active", isActive: true },
        { id: "from-inactive", isActive: false }
      ]
    );

    await expect(
      activeApprovalDelegatorIds(prisma as never, "to-1", NOW)
    ).resolves.toEqual(["from-active"]);
  });

  it.each([
    ["缺失", []],
    ["停用", [{ id: "to-1", isActive: false }]]
  ])("受托人%s时返回空", async (_label, users) => {
    const prisma = client([{ fromUserId: "from-active" }], [
      ...users,
      { id: "from-active", isActive: true }
    ]);

    await expect(
      activeApprovalDelegatorIds(prisma as never, "to-1", NOW)
    ).resolves.toEqual([]);
  });
});
