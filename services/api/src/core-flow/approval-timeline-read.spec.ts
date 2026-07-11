import { approvalTimelineForBusiness } from "./approval-timeline-read";

describe("approvalTimelineForBusiness", () => {
  it("maps approval logs to a detail timeline", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "approve",
            actorUserId: "user-1",
            comment: "同意进入下一步",
            metadata: {
              nodeName: "财务复核",
              approvedRoleKey: "finance_director",
              selfReview: true,
              selfReviewReason: "  紧急业务由本人发起  ",
              confirmationPassword: "must-never-be-exposed"
            },
            createdAt: new Date("2026-07-08T02:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "王财务" }])
      }
    };

    await expect(
      approvalTimelineForBusiness(prisma, "payment_request", "payment-1")
    ).resolves.toEqual([
      {
        id: "log-1",
        action: "approve",
        actionLabel: "同意",
        actorUserId: "user-1",
        actorName: "王财务",
        comment: "同意进入下一步",
        nodeName: "财务复核",
        roleName: "财务主管",
        selfReview: true,
        selfReviewReason: "紧急业务由本人发起",
        createdAt: "2026-07-08T02:00:00.000Z"
      }
    ]);
    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: { businessType: "payment_request", businessId: "payment-1" },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    expect(prisma.approvalActionLog.findMany).toHaveBeenCalledWith({
      where: { approvalInstanceId: "approval-instance-1" },
      orderBy: { createdAt: "asc" }
    });
  });

  it.each([
    { metadata: {}, expectedSelfReview: false, expectedReason: null },
    {
      metadata: { selfReview: "true", selfReviewReason: "不应显示" },
      expectedSelfReview: false,
      expectedReason: null
    },
    {
      metadata: { selfReview: true, selfReviewReason: "   " },
      expectedSelfReview: true,
      expectedReason: null
    }
  ])("maps self-review metadata strictly", async ({ metadata, expectedSelfReview, expectedReason }) => {
    const prisma = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue({ id: "approval-instance-1" }) },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "approve",
            actorUserId: "user-1",
            comment: null,
            metadata,
            createdAt: new Date("2026-07-08T02:00:00.000Z")
          }
        ])
      }
    };

    await expect(
      approvalTimelineForBusiness(prisma, "payment_request", "payment-1")
    ).resolves.toContainEqual(
      expect.objectContaining({
        selfReview: expectedSelfReview,
        selfReviewReason: expectedReason
      })
    );
  });

  it("returns an empty timeline when no approval instance exists", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      approvalActionLog: {
        findMany: jest.fn()
      }
    };

    await expect(
      approvalTimelineForBusiness(prisma, "contract_version", "contract-version-1")
    ).resolves.toEqual([]);
    expect(prisma.approvalActionLog.findMany).not.toHaveBeenCalled();
  });

  it("does not expose internal approval action, actor, or role values", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-1",
            action: "internal_action",
            actorUserId: "internal-user-id",
            comment: null,
            metadata: { approvedRoleKey: "internal_role" },
            createdAt: new Date("2026-07-08T02:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    await expect(
      approvalTimelineForBusiness(prisma, "payment_request", "payment-1")
    ).resolves.toEqual([
      expect.objectContaining({
        action: "internal_action",
        actionLabel: "审批动作未读取",
        actorUserId: "internal-user-id",
        actorName: "审批人未读取",
        roleName: "审批角色未读取"
      })
    ]);
  });
});
