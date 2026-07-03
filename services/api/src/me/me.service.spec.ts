import { MeService } from "./me.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("MeService", () => {
  it("uploads a PNG signature and records it on the user", async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-9" }) };
    const service = new MeService(prisma as never, files as never);

    const result = await service.setSignature("user-1", {
      originalName: "sig.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    });

    expect(result.signatureFileId).toBe("file-9");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { signatureFileId: "file-9" }
    });
  });

  it("rejects a non-image disguised as an image mime type", async () => {
    const prisma = { user: { update: jest.fn() } };
    const files = { uploadPrivateFile: jest.fn() };
    const service = new MeService(prisma as never, files as never);

    await expect(
      service.setSignature("user-1", {
        originalName: "evil.png",
        mimeType: "image/png",
        sizeBytes: 4,
        buffer: Buffer.from("notpng")
      })
    ).rejects.toThrow("PNG or JPEG");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("builds workbench cards only from projects where the user has matching roles", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "contract_staff" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      contractTakeover: {
        count: jest.fn().mockImplementation(({ where }: {
          where: {
            projectId: unknown;
            OR?: unknown;
            historicalBalanceConfirmedAt?: unknown;
          };
        }) => {
          expect(where.projectId).toEqual({ in: ["project-1"] });
          if (where.OR) return 1;
          if (where.historicalBalanceConfirmedAt === null) return 1;
          return 2;
        })
      },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.visibleProjectCount).toBe(1);
    expect(summary.cards.map((card) => [card.id, card.count])).toEqual([
      ["contract_takeover_todo", 2],
      ["historical_balance_missing", 1],
      ["payment_blocked", 1]
    ]);
    expect(prisma.contractTakeover.count).toHaveBeenCalledTimes(3);
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });

  it("counts only current approval nodes in visible projects", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn().mockResolvedValue(0) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "settlement",
            businessId: "settlement-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["finance_director"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-2",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-1", projectId: "project-1" },
          { id: "payment-2", projectId: "project-2" }
        ]),
        count: jest.fn()
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    const approvalCard = summary.cards.find((card) => card.id === "approval_todo");
    expect(approvalCard).toMatchObject({
      count: 1,
      description: "合同 0 · 结算 1 · 付款 0",
      targetPath: "/结算管理"
    });
  });

  it("returns no workbench cards when the user has no relevant business permission", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "employee" }])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn() },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.cards).toEqual([]);
    expect(prisma.contractTakeover.count).not.toHaveBeenCalled();
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });
});
