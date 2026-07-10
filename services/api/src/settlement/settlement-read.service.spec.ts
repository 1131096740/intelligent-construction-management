import { SettlementReadService } from "./settlement-read.service";

describe("SettlementReadService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-08T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
            amountCents: 58000000n,
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
            amountCents: 62000000n,
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
      ownerDepartment: "合同部主管",
      pendingOwner: "合同部主管",
      stalledFor: "7天",
      returnReason: "-",
      nextAction: "主管确认归档"
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

  it("does not expose internal settlement status values in read model labels", () => {
    const service = new SettlementReadService({} as never);
    const statusView = (service as unknown as { statusView(status: string): { label: string } })
      .statusView;

    expect(statusView.call(service, "internal_status").label).toBe("结算状态未读取");
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
          sourceType: "historical_takeover",
          amountCents: 58000000n,
          payableAmountCents: 46400000n
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
            requiresInvoice: true,
            triggerEvent: "结算归档确认生效"
          }
        ])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          code: "FK-2026-011",
          status: "approved_pending_payment"
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            status: "approved_pending_payment",
            requestedAmountCents: 20000000n,
            paidAmountCents: 5000000n
          },
          {
            id: "payment-void",
            status: "rejected",
            requestedAmountCents: 1000000n,
            paidAmountCents: 0n
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 5000000n }])
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "line-1",
            sourceType: "contract_bill_row",
            name: "钢筋材料",
            unit: "吨",
            quantity: { toString: () => "10.000000" },
            unitPriceCents: 320000n,
            amountCents: 3200000n,
            reason: null,
            remark: "本期完成量"
          },
          {
            id: "line-2",
            sourceType: "manual_adjustment",
            name: "现场扣款",
            unit: null,
            quantity: null,
            unitPriceCents: null,
            amountCents: -200000n,
            reason: "项目确认扣款",
            remark: null
          }
        ])
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
    expect(detail.baseInfo).toContainEqual({ label: "结算性质", value: "历史接管期初结算" });
    expect(detail.baseInfo).toContainEqual({ label: "结算金额", value: "¥580,000.00" });
    expect(detail.paymentRules[0]).toMatchObject({
      id: "stage-progress",
      stage: "进度款",
      ratio: "85%",
      accountPeriod: "20天",
      invoiceRequirement: "需提供发票",
      triggerCondition: "结算归档确认生效",
      paymentRequestStatus: "approved_pending_payment"
    });
    expect(detail.payableCalculation.items).toEqual([
      { label: "本期结算金额", value: "¥580,000.00" },
      { label: "本期可付金额", value: "¥464,000.00", tone: "success" },
      { label: "已申请付款", value: "¥200,000.00", tone: "warning" },
      { label: "已实付金额", value: "¥50,000.00" },
      { label: "剩余可申请", value: "¥264,000.00", tone: "primary" }
    ]);
    expect(detail.settlementLines).toEqual([
      {
        id: "line-1",
        sourceType: "contract_bill_row",
        sourceLabel: "合同清单项",
        name: "钢筋材料",
        unit: "吨",
        quantity: "10",
        unitPrice: "¥3,200.00",
        amount: "¥32,000.00",
        amountCents: "3200000",
        reason: "-",
        remark: "本期完成量"
      },
      {
        id: "line-2",
        sourceType: "manual_adjustment",
        sourceLabel: "手工调整项",
        name: "现场扣款",
        unit: "-",
        quantity: "-",
        unitPrice: "-",
        amount: "¥-2,000.00",
        amountCents: "-200000",
        reason: "项目确认扣款",
        remark: "-"
      }
    ]);
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

  it("keeps pending settlement archive files unavailable for download", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "archive_pending",
          amountCents: 58000000n
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
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "user-upload",
            confirmedByUserId: null,
            confirmedAt: null,
            status: "pending_confirm",
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
        findMany: jest.fn().mockResolvedValue([{ id: "user-upload", name: "合同员" }])
      }
    };
    const service = new SettlementReadService(prisma as never);

    const detail = await service.getDetail("JS-2026-031");

    expect(detail.archiveFiles).toContainEqual(
      expect.objectContaining({
        fileId: "file-settlement-1",
        status: "pending_confirm",
        statusLabel: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      })
    );
  });

  it("does not expose internal user accounts when settlement archive operator names are unavailable", async () => {
    const prisma = {
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "upload-internal-id",
            confirmedByUserId: "confirm-internal-id",
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
            originalName: "签章结算单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new SettlementReadService(prisma as never);
    const archiveFiles = await (
      service as unknown as {
        settlementArchiveFilesForSettlement(id: string): Promise<
          Array<{ uploadedByName: string; confirmedByName: string | null }>
        >;
      }
    ).settlementArchiveFilesForSettlement("settlement-1");

    expect(archiveFiles[0]).toMatchObject({
      uploadedByName: "上传人未读取",
      confirmedByName: "确认人未读取"
    });
  });

  it("exposes enabled payment creation action for effective settlements", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective",
          amountCents: 58000000n
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
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["project_manager"])
    };
    const service = new SettlementReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("JS-2026-031", undefined, "user-pm");

    expect(projectVisibility.effectiveRoleKeys).toHaveBeenCalledWith("user-pm", "project-1");
    expect(detail.primaryAction).toBe("create_payment");
    expect(detail.availableActions).toContainEqual({
      key: "create_payment",
      label: "发起付款申请",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredAction: "payment.create"
    });
    expect(detail.disabledReasons).toEqual([]);
  });

  it("does not expose settlement detail outside visible projects", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new SettlementReadService(prisma as never);

    await expect(service.getDetail("JS-2026-031", ["project-1"])).rejects.toThrow(
      "未找到该结算单，请刷新结算台账后重试"
    );
    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }],
        projectId: { in: ["project-1"] }
      }
    });
  });

  it("uses Chinese business errors when settlement detail related records are missing", async () => {
    function prismaWithMissingRelated(overrides: {
      contract?: unknown;
      contractVersion?: unknown;
      terms?: unknown;
    }) {
      return {
        settlement: {
          findFirst: jest.fn().mockResolvedValue({
            id: "settlement-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "effective",
            sourceType: "settlement",
            amountCents: 1000000n,
            payableAmountCents: 800000n
          })
        },
        contract: {
          findUnique: jest
            .fn()
            .mockResolvedValue("contract" in overrides ? overrides.contract : { id: "contract-1" })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue(
            "contractVersion" in overrides
              ? overrides.contractVersion
              : { id: "contract-version-1" }
          )
        },
        paymentTermsVersion: {
          findUnique: jest
            .fn()
            .mockResolvedValue("terms" in overrides ? overrides.terms : { id: "terms-version-1" })
        },
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentExecution: {
          findMany: jest.fn().mockResolvedValue([])
        }
      };
    }

    await expect(
      new SettlementReadService(
        prismaWithMissingRelated({ contract: null }) as never
      ).getDetail("JS-2026-031")
    ).rejects.toThrow("未找到结算关联合同，请刷新结算台账后重试");

    await expect(
      new SettlementReadService(
        prismaWithMissingRelated({ contractVersion: null }) as never
      ).getDetail("JS-2026-031")
    ).rejects.toThrow("未找到结算关联合同版本，请刷新结算台账后重试");

    await expect(
      new SettlementReadService(prismaWithMissingRelated({ terms: null }) as never).getDetail(
        "JS-2026-031"
      )
    ).rejects.toThrow("未找到结算绑定的付款条款版本，请刷新结算台账后重试");
  });
});
