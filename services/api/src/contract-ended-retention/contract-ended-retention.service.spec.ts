import { BadRequestException } from "@nestjs/common";
import { ContractEndedApplicationRetentionService } from "./contract-ended-retention.service";

describe("ContractEndedApplicationRetentionService", () => {
  const terminalAt = new Date("2026-08-31T10:15:00.000Z");

  function prisma(overrides: Record<string, unknown> = {}) {
    const client = {
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-ended",
            contractId: "contract-ended",
            status: "approval_rejected",
            changeType: "original",
            versionNo: 1,
            endedAt: terminalAt,
            firstSubmittedAt: terminalAt,
            abandonReason: null,
            abandonedAt: null
          },
          {
            id: "version-effective",
            contractId: "contract-effective",
            status: "effective",
            changeType: "original",
            versionNo: 1,
            endedAt: terminalAt,
            firstSubmittedAt: terminalAt,
            abandonReason: null,
            abandonedAt: null
          }
        ]),
        findUnique: jest.fn()
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-ended",
            projectId: "project-1",
            code: "HT-ENDED",
            name: "已结束合同",
            counterparty: "测试相对方"
          }
        ])
      },
      contractEndedApplicationRetentionHold: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn()
      },
      contractEndedApplicationRetentionPolicy: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-ended-retention-v1",
          activatedAt: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      auditLog: { create: jest.fn() },
      ...overrides
    };
    return {
      ...client,
      $transaction: jest.fn(async (callback) => callback(client))
    };
  }

  it("previews only terminal applications that expire within thirty days using three calendar months", async () => {
    const client = prisma();
    const service = new ContractEndedApplicationRetentionService(client as never, {
      record: jest.fn()
    } as never);

    const result = await service.preview(new Date("2026-10-31T10:15:00.000Z"));

    expect(result).toMatchObject({
      mode: "preview_only",
      executionAllowed: false,
      retention: {
        calendarMonths: 3,
        previewWindowDays: 30
      }
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        contractVersionId: "version-ended",
        terminalAt: "2026-08-31T10:15:00.000Z",
        retentionEndsAt: "2026-11-30T10:15:00.000Z",
        purgeEligibleAt: "2026-11-30T10:15:00.000Z",
        remainingDays: 30
      })
    ]);
    expect(client.contractVersion.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["abandoned", "approval_rejected"] }
      },
      orderBy: [{ endedAt: "asc" }, { id: "asc" }],
      take: 501
    });
  });

  it("records a director hold and gives an overdue release a thirty-day buffer", async () => {
    const hold = {
      id: "hold-1",
      contractVersionId: "version-ended",
      reason: "存在争议",
      createdByUserId: "director-1",
      createdAt: new Date("2026-12-02T10:15:00.000Z"),
      releasedAt: null,
      releasedByUserId: null,
      releaseReason: null
    };
    const client = prisma({
      contractVersion: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-ended",
          contractId: "contract-ended",
          status: "abandoned",
          changeType: "original",
          versionNo: 1,
          endedAt: terminalAt,
          firstSubmittedAt: terminalAt,
          abandonReason: "存在争议",
          abandonedAt: terminalAt
        })
      },
      contractEndedApplicationRetentionHold: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(hold),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const audit = { record: jest.fn() };
    const service = new ContractEndedApplicationRetentionService(client as never, audit as never);

    const result = await service.releaseHold(
      "version-ended",
      "director-1",
      { reason: "争议已结" },
      new Date("2026-12-02T10:15:00.000Z")
    );

    expect(result).toMatchObject({
      contractVersionId: "version-ended",
      holdReleased: true,
      purgeEligibleAt: "2027-01-01T10:15:00.000Z"
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "director-1",
        action: "contract.ended_retention.hold.release",
        businessType: "contract_version",
        businessId: "version-ended",
        metadata: expect.objectContaining({ reason: "争议已结" })
      })
    );
  });

  it("uses policy activation as the legacy terminal clock when releasing a retained application", async () => {
    const hold = {
      id: "hold-legacy",
      contractVersionId: "version-ended",
      reason: "待核对历史材料",
      createdByUserId: "director-1",
      createdAt: new Date("2026-10-15T00:00:00.000Z"),
      releasedAt: null,
      releasedByUserId: null,
      releaseReason: null
    };
    const client = prisma({
      contractVersion: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-ended",
          contractId: "contract-ended",
          status: "approval_rejected",
          changeType: "original",
          versionNo: 1,
          endedAt: null,
          firstSubmittedAt: new Date("2025-01-10T00:00:00.000Z"),
          abandonReason: null,
          abandonedAt: new Date("2025-01-10T00:00:00.000Z")
        })
      },
      contractEndedApplicationRetentionHold: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(hold),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = new ContractEndedApplicationRetentionService(client as never, {
      record: jest.fn()
    } as never);

    const result = await service.releaseHold(
      "version-ended",
      "director-1",
      { reason: "历史材料已核对" },
      new Date("2026-08-02T00:00:00.000Z")
    );

    expect(result).toMatchObject({
      retentionEndsAt: "2026-11-01T00:00:00.000Z",
      releaseBufferUntil: null,
      purgeEligibleAt: "2026-11-01T00:00:00.000Z"
    });
  });

  it("records an active director hold instead of creating a duplicate", async () => {
    const existing = {
      id: "hold-active",
      contractVersionId: "version-ended",
      reason: "等待仲裁",
      createdByUserId: "director-1",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      releasedAt: null,
      releasedByUserId: null,
      releaseReason: null
    };
    const client = prisma({
      contractVersion: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-ended",
          contractId: "contract-ended",
          status: "abandoned",
          changeType: "original",
          versionNo: 1,
          endedAt: terminalAt,
          firstSubmittedAt: terminalAt,
          abandonReason: "等待仲裁",
          abandonedAt: terminalAt
        })
      },
      contractEndedApplicationRetentionHold: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        updateMany: jest.fn()
      }
    });
    const audit = { record: jest.fn() };
    const service = new ContractEndedApplicationRetentionService(client as never, audit as never);

    const result = await service.createHold(
      "version-ended",
      "director-1",
      { reason: "等待仲裁" }
    );

    expect(result).toEqual({
      contractVersionId: "version-ended",
      holdCreated: false,
      idempotent: true,
      holdId: "hold-active",
      reason: "等待仲裁"
    });
    expect(client.contractEndedApplicationRetentionHold.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects holds for effective contracts", async () => {
    const client = prisma({
      contractVersion: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-effective",
          contractId: "contract-effective",
          status: "effective",
          changeType: "original",
          versionNo: 1,
          endedAt: terminalAt,
          firstSubmittedAt: terminalAt,
          abandonReason: null,
          abandonedAt: null
        })
      }
    });
    const service = new ContractEndedApplicationRetentionService(client as never, {
      record: jest.fn()
    } as never);

    await expect(
      service.createHold("version-effective", "director-1", { reason: "不应允许" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("excludes an abandoned record without application evidence from preview and manual holds", async () => {
    const cleanupVersion = {
      id: "version-cleanup",
      contractId: "contract-cleanup",
      status: "abandoned",
      endedAt: null,
      firstSubmittedAt: null,
      abandonReason: "历史技术清理标记",
      abandonedAt: terminalAt
    };
    const client = prisma({
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-ended",
            contractId: "contract-ended",
            status: "abandoned",
            endedAt: terminalAt,
            firstSubmittedAt: terminalAt,
            abandonReason: "业务申请放弃",
            abandonedAt: terminalAt
          },
          cleanupVersion
        ]),
        findUnique: jest.fn().mockResolvedValue(cleanupVersion)
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-ended",
            projectId: "project-1",
            code: "HT-ENDED",
            name: "结束申请",
            counterparty: "测试相对方"
          },
          {
            id: "contract-cleanup",
            projectId: "project-1",
            code: "HT-CLEANUP",
            name: "技术清理草稿",
            counterparty: "测试相对方"
          }
        ])
      }
    });
    const service = new ContractEndedApplicationRetentionService(client as never, {
      record: jest.fn()
    } as never);

    const preview = await service.preview(new Date("2026-10-31T10:15:00.000Z"));

    expect(preview.candidates).toEqual([
      expect.objectContaining({ contractVersionId: "version-ended" })
    ]);
    await expect(
      service.createHold("version-cleanup", "director-1", { reason: "不应允许" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.contractEndedApplicationRetentionHold.create).not.toHaveBeenCalled();
  });
});
