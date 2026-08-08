import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  addCalendarMonths,
  ContractEndedApplicationRetentionService
} from "./contract-ended-retention.service";

describe("ContractEndedApplicationRetentionService", () => {
  const terminalAt = new Date("2026-08-31T10:15:00.000Z");

  it("uses Shanghai calendar dates for the three-month ended-retention deadline", () => {
    expect(addCalendarMonths(new Date("2026-02-28T16:00:00.000Z"), 3)).toEqual(
      new Date("2026-05-31T16:00:00.000Z")
    );
  });

  function prisma(overrides: Record<string, unknown> = {}) {
    const client = {
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }])
      },
      contractVersion: {
        count: jest.fn().mockResolvedValue(1),
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
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-ended",
          projectId: "project-1"
        }),
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

  function projectVisibility() {
    return {
      effectiveRoleKeysByProject: jest.fn().mockImplementation(
        async (_actorUserId: string, projectIds: string[]) => new Map(
          projectIds.map((projectId) => [projectId, ["contract_director"]])
        )
      )
    };
  }

  it("previews only terminal applications that expire within thirty days using three calendar months", async () => {
    const client = prisma();
    const service = new ContractEndedApplicationRetentionService(client as never, {
      record: jest.fn()
    } as never, projectVisibility() as never);

    const result = await service.preview(
      "director-1",
      undefined,
      undefined,
      new Date("2026-10-31T10:15:00.000Z")
    );

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
        status: { in: ["abandoned", "approval_rejected"] },
        OR: [
          { endedAt: { not: null } },
          { firstSubmittedAt: { not: null } }
        ],
        contractId: { in: ["contract-ended"] }
      },
      orderBy: [{ endedAt: "asc" }, { id: "asc" }],
      skip: 0,
      take: 50
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
    const service = new ContractEndedApplicationRetentionService(
      client as never,
      audit as never,
      projectVisibility() as never
    );

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
    } as never, projectVisibility() as never);

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
    const service = new ContractEndedApplicationRetentionService(
      client as never,
      audit as never,
      projectVisibility() as never
    );

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
    } as never, projectVisibility() as never);

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
        count: jest.fn().mockResolvedValue(2),
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
    } as never, projectVisibility() as never);

    const preview = await service.preview(
      "director-1",
      undefined,
      undefined,
      new Date("2026-10-31T10:15:00.000Z")
    );

    expect(preview.candidates).toEqual([
      expect.objectContaining({ contractVersionId: "version-ended" })
    ]);
    await expect(
      service.createHold("version-cleanup", "director-1", { reason: "不应允许" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.contractEndedApplicationRetentionHold.create).not.toHaveBeenCalled();
  });

  it("pages only the current director's project records and denies a cross-project hold", async () => {
    const crossProjectVersion = {
      id: "version-project-2",
      contractId: "contract-project-2",
      status: "approval_rejected",
      endedAt: terminalAt,
      firstSubmittedAt: terminalAt,
      abandonReason: null,
      abandonedAt: null
    };
    const client = prisma({
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1" },
          { id: "project-2" }
        ])
      },
      contractVersion: {
        count: jest.fn().mockResolvedValue(501),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-ended",
            contractId: "contract-ended",
            status: "approval_rejected",
            endedAt: terminalAt,
            firstSubmittedAt: terminalAt,
            abandonReason: null,
            abandonedAt: null
          }
        ]),
        findUnique: jest.fn().mockResolvedValue(crossProjectVersion)
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-ended",
            projectId: "project-1",
            code: "HT-ENDED",
            name: "结束申请",
            counterparty: "测试相对方"
          }
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-project-2",
          projectId: "project-2"
        })
      }
    });
    const projectVisibility = {
      effectiveRoleKeysByProject: jest.fn().mockResolvedValue(new Map([
        ["project-1", ["contract_director"]],
        ["project-2", []]
      ]))
    };
    const service = new ContractEndedApplicationRetentionService(
      client as never,
      { record: jest.fn() } as never,
      projectVisibility as never
    );

    const preview = await service.preview(
      "project-director-1",
      "501",
      "1",
      new Date("2026-10-31T10:15:00.000Z")
    );

    expect(preview).toMatchObject({
      page: 501,
      limit: 1,
      total: 501,
      hasMore: false,
      candidates: [expect.objectContaining({ contractVersionId: "version-ended" })]
    });
    expect(client.contractVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contractId: { in: ["contract-ended"] }
      }),
      skip: 500,
      take: 1
    }));
    await expect(
      service.createHold("version-project-2", "project-director-1", { reason: "越权保留" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.contractEndedApplicationRetentionHold.create).not.toHaveBeenCalled();
  });
});
