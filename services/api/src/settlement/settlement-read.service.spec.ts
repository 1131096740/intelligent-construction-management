import { SettlementReadService } from "./settlement-read.service";

describe("SettlementReadService", () => {
  it("builds settlement ledger rows and summary from persisted settlements", async () => {
    const prisma = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            paymentTermsVersionId: "terms-version-2",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "archive_pending",
            amountCents: 58000000,
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          },
          {
            id: "settlement-2",
            projectId: "project-1",
            contractId: "contract-1",
            paymentTermsVersionId: "terms-version-2",
            code: "JS-2026-032",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 62000000,
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-2026-009",
            temporaryCode: null
          }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-2",
            versionNo: 2
          }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "总部综合楼"
          }
        ])
      }
    };
    const service = new SettlementReadService(prisma as never);

    const ledger = await service.listRecent();

    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      take: 100,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "JS-2026-031",
      settlementNo: "JS-2026-031",
      contractNo: "HT-2026-009",
      project: "总部综合楼",
      period: "2026-06",
      amount: "¥580,000.00",
      paymentTermsVersion: "v2",
      currentNode: "主管确认归档",
      nodeTone: "primary",
      ownerDepartment: "合同部主管"
    });
    expect(ledger.summary).toEqual({
      total: 2,
      inApproval: 0,
      pendingArchive: 1,
      effective: 1,
      payable: 1
    });
  });

  it("filters settlement ledger by visible projects", async () => {
    const prisma = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findMany: jest.fn()
      },
      paymentTermsVersion: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn()
      }
    };
    const service = new SettlementReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("builds settlement detail from persisted settlement and payment terms", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective",
          amountCents: 58000000
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-2",
          versionNo: 2
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            ratioBps: 8500,
            dueDays: 20,
            triggerEvent: "结算归档确认生效"
          }
        ])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          code: "FK-2026-011",
          status: "approved_pending_payment"
        })
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "user-upload",
            confirmedByUserId: "user-confirm",
            confirmedAt: new Date("2026-07-01T10:00:00.000Z"),
            status: "confirmed",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-settlement-1",
            originalName: "JS-2026-031-签章结算单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-upload", name: "合同员" },
          { id: "user-confirm", name: "合同主管" }
        ])
      }
    };
    const service = new SettlementReadService(prisma as never);

    const detail = await service.getDetail("JS-2026-031");

    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }] }
    });
    expect(detail.id).toBe("JS-2026-031");
    expect(detail.settlementId).toBe("settlement-1");
    expect(detail.title).toBe("JS-2026-031 · 2026-06结算单");
    expect(detail.baseInfo).toContainEqual({ label: "关联合同", value: "HT-2026-009 · 幕墙分包合同" });
    expect(detail.baseInfo).toContainEqual({ label: "结算金额", value: "¥580,000.00" });
    expect(detail.paymentRules[0]).toMatchObject({
      id: "stage-progress",
      stage: "进度款",
      ratio: "85%",
      accountPeriod: "20天",
      triggerCondition: "结算归档确认生效",
      paymentRequestStatus: "approved_pending_payment"
    });
    expect(detail.archiveFiles).toEqual([
      {
        recordId: "settlement-archive-1",
        fileId: "file-settlement-1",
        fileName: "JS-2026-031-签章结算单.pdf",
        purpose: "结算签章归档件",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        status: "confirmed",
        statusLabel: "已确认",
        uploadedByName: "合同员",
        uploadedAt: "2026-07-01T09:00:00.000Z",
        confirmedByName: "合同主管",
        confirmedAt: "2026-07-01T10:00:00.000Z",
        canDownload: true,
        disabledReason: null
      }
    ]);
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts/HT-2026-009",
      "/payments/FK-2026-011",
      "/archives",
      "/audit"
    ]);
  });

  it("does not expose settlement detail outside visible projects", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new SettlementReadService(prisma as never);

    await expect(service.getDetail("JS-2026-031", ["project-1"])).rejects.toThrow("Settlement not found");
    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }],
        projectId: { in: ["project-1"] }
      }
    });
  });
});
