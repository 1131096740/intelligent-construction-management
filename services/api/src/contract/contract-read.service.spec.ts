import { ContractReadService } from "./contract-read.service";

describe("ContractReadService", () => {
  it("builds contract ledger rows and summary from persisted contracts", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-2026-009",
            temporaryCode: null,
            name: "幕墙分包合同",
            counterparty: "幕墙分包单位",
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-2",
            contractId: "contract-1",
            versionNo: 2,
            status: "effective",
            amountCents: 98650000n
          }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-2",
            contractId: "contract-1",
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
    const service = new ContractReadService(prisma as never);

    const ledger = await service.listRecent(50);

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      take: 50,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "HT-2026-009",
      contractNo: "HT-2026-009",
      name: "幕墙分包合同",
      project: "总部综合楼",
      amount: "¥986,500.00",
      version: "v2",
      currentNode: "可发起结算",
      ownerDepartment: "系统归档",
      paymentTermsVersion: "v2"
    });
    expect(ledger.summary).toEqual({
      total: 1,
      inApproval: 0,
      pendingSeal: 0,
      pendingArchive: 0,
      effective: 1
    });
  });

  it("filters contract ledger by visible projects", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findMany: jest.fn()
      },
      paymentTermsVersion: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("lists business contract options for settlement and payment creation", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-historical",
            projectId: "project-1",
            source: "historical_takeover",
            code: "HT-LS-001",
            temporaryCode: null,
            name: "历史材料合同",
            counterparty: "历史供应商",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T08:00:00.000Z")
          },
          {
            id: "contract-draft",
            projectId: "project-1",
            source: "system",
            code: "HT-DRAFT-001",
            temporaryCode: null,
            name: "未生效合同",
            counterparty: "分包单位",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T09:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-historical",
            contractId: "contract-historical",
            versionNo: 1,
            status: "effective",
            amountCents: 100000000n
          },
          {
            id: "version-draft",
            contractId: "contract-draft",
            versionNo: 1,
            status: "draft",
            amountCents: 200000000n
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-historical",
            takeoverLevel: "B",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: new Date("2026-07-03T10:00:00.000Z"),
            balanceSourceSummary: "财务台账"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-effective",
            projectId: "project-1",
            contractId: "contract-historical",
            code: "JS-001",
            periodLabel: "2026-06",
            status: "effective",
            amountCents: 30000000,
            payableAmountCents: 24000000,
            paidAmountCents: 0,
            createdAt: new Date("2026-07-03T11:00:00.000Z")
          },
          {
            id: "settlement-paid",
            projectId: "project-1",
            contractId: "contract-historical",
            code: "JS-000",
            periodLabel: "2026-05",
            status: "paid",
            amountCents: 20000000,
            payableAmountCents: 16000000,
            paidAmountCents: 16000000,
            createdAt: new Date("2026-07-02T11:00:00.000Z")
          }
        ])
      }
    };
    const service = new ContractReadService(prisma as never);

    const options = await service.listCreateOptions("project-1");

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      orderBy: [{ code: "asc" }, { temporaryCode: "asc" }, { updatedAt: "desc" }]
    });
    expect(options[0]).toMatchObject({
      contractId: "contract-historical",
      contractVersionId: "version-historical",
      contractNo: "HT-LS-001",
      contractName: "历史材料合同",
      counterparty: "历史供应商",
      amountCents: 100000000,
      versionLabel: "合同 v1",
      contractStatusLabel: "已生效",
      source: "historical_takeover",
      sourceLabel: "历史接管 · 财务台账",
      takeoverLevel: "B",
      takeoverStatusLabel: "已接管",
      canCreateSettlement: true,
      settlementUnavailableReason: null,
      canCreatePayment: true,
      paymentUnavailableReason: null
    });
    expect(options[0].historicalBalanceConfirmedAt).toBe("2026-07-03T10:00:00.000Z");
    expect(options[0].settlements).toEqual([
      {
        settlementId: "settlement-effective",
        settlementNo: "JS-001",
        periodLabel: "2026-06",
        amountCents: 30000000,
        payableAmountCents: 24000000,
        paidAmountCents: 0,
        status: "effective",
        statusLabel: "审批通过",
        canCreatePayment: true,
        unavailableReason: null
      },
      {
        settlementId: "settlement-paid",
        settlementNo: "JS-000",
        periodLabel: "2026-05",
        amountCents: 20000000,
        payableAmountCents: 16000000,
        paidAmountCents: 16000000,
        status: "paid",
        statusLabel: "审批通过",
        canCreatePayment: false,
        unavailableReason: "结算未生效或已付款完成"
      }
    ]);
    expect(options[1]).toMatchObject({
      contractId: "contract-draft",
      contractVersionId: null,
      contractStatusLabel: "草拟中",
      canCreateSettlement: false,
      settlementUnavailableReason: "合同尚未生效，不能发起结算",
      canCreatePayment: false,
      paymentUnavailableReason: "合同状态为草拟中，不能发起付款"
    });
  });

  it("blocks payment option for historical contracts before balance confirmation", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-historical",
            projectId: "project-1",
            source: "historical_takeover",
            code: "HT-LS-002",
            temporaryCode: null,
            name: "待确认历史合同",
            counterparty: "历史供应商",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T08:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-historical",
            contractId: "contract-historical",
            versionNo: 1,
            status: "effective",
            amountCents: 100000000
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-historical",
            takeoverLevel: "C",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: null,
            balanceSourceSummary: null
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const [option] = await service.listCreateOptions("project-1");

    expect(option.canCreateSettlement).toBe(true);
    expect(option.canCreatePayment).toBe(false);
    expect(option.paymentUnavailableReason).toBe("历史余额尚未确认，不能发起付款");
  });

  it("displays temporaryCode when contract has no formal code and tolerates empty payment stages", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-draft-1",
          projectId: "project-1",
          code: null,
          temporaryCode: "草稿-20260625-12345678",
          name: "",
          counterparty: ""
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-version-draft-1",
          versionNo: 1,
          status: "draft",
          amountCents: 0n
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-draft-1",
          versionNo: 1,
          status: "draft"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("contract-draft-1");

    expect(detail.id).toBe("草稿-20260625-12345678");
    expect(detail.title).toBe("草稿-20260625-12345678 · ");
    expect(detail.paymentTermStages).toEqual([]);
    expect(detail.baseInfo).toContainEqual({ label: "合同金额", value: "¥0.00" });
  });

  it("builds contract detail from persisted contract version and payment terms", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "幕墙分包单位"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-version-2",
          versionNo: 2,
          status: "effective",
          amountCents: 98650000
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            basis: "current_settlement",
            ratioBps: 8500,
            dueDays: 20,
            triggerEvent: "结算归档确认生效"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031",
            periodLabel: "2026年6月",
            status: "effective",
            amountCents: 30000000,
            payableAmountCents: 30000000,
            updatedAt: new Date("2026-06-30T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-009");

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "HT-2026-009" }, { code: "HT-2026-009" }] }
    });
    expect(detail.id).toBe("HT-2026-009");
    expect(detail.contractVersionId).toBe("contract-version-2");
    expect(detail.title).toBe("HT-2026-009 · 幕墙分包合同");
    expect(detail.baseInfo).toContainEqual({ label: "项目", value: "总部综合楼" });
    expect(detail.baseInfo).toContainEqual({ label: "合同金额", value: "¥986,500.00" });
    expect(detail.paymentTermStages[0]).toMatchObject({
      id: "stage-progress",
      version: "v2",
      paymentTermsVersion: "v2",
      status: "已生效",
      contractVersion: "合同 v2",
      basis: "当期结算",
      ratio: "85%",
      accountPeriod: "20天",
      triggerEvent: "结算归档确认生效"
    });
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts",
      "/settlements/JS-2026-031",
      "/archives",
      "/audit"
    ]);
  });

  it("summarizes contract settlement and payment ledger without inventing payment term availability", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "幕墙分包单位"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-version-2",
          versionNo: 2,
          status: "effective",
          amountCents: 100000000
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-001",
            periodLabel: "第1期",
            status: "effective",
            amountCents: 30000000,
            payableAmountCents: 30000000,
            updatedAt: new Date("2026-06-20T08:00:00.000Z"),
            createdAt: new Date("2026-06-20T08:00:00.000Z")
          },
          {
            id: "settlement-2",
            code: "JS-2026-002",
            periodLabel: "第2期",
            status: "approval_pending",
            amountCents: 10000000,
            payableAmountCents: 10000000,
            updatedAt: new Date("2026-06-29T08:00:00.000Z"),
            createdAt: new Date("2026-06-29T08:00:00.000Z")
          },
          {
            id: "settlement-3",
            code: "JS-2026-003",
            periodLabel: "第3期",
            status: "paid",
            amountCents: 2000000,
            payableAmountCents: 2000000,
            updatedAt: new Date("2026-07-01T08:00:00.000Z"),
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            status: "confirmed",
            confirmedAt: new Date("2026-06-21T08:00:00.000Z"),
            createdAt: new Date("2026-06-21T08:00:00.000Z")
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            settlementId: "settlement-1",
            code: "FK-2026-001",
            status: "paid",
            requestedAmountCents: 25000000,
            approvedAmountCents: 22000000,
            paidAmountCents: 20000000,
            updatedAt: new Date("2026-06-25T08:00:00.000Z")
          },
          {
            id: "payment-2",
            settlementId: "settlement-1",
            code: "FK-2026-002",
            status: "approved_pending_payment",
            requestedAmountCents: 5000000,
            approvedAmountCents: 5000000,
            paidAmountCents: 0,
            updatedAt: new Date("2026-06-30T08:00:00.000Z")
          },
          {
            id: "payment-3",
            settlementId: "settlement-3",
            code: "FK-2026-003",
            status: "approval_pending",
            requestedAmountCents: 1000000,
            approvedAmountCents: null,
            paidAmountCents: 0,
            updatedAt: new Date("2026-07-02T08:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            paymentRequestId: "payment-1",
            amountCents: 22000000,
            paidAt: new Date("2026-06-26T08:00:00.000Z"),
            voucherFileId: "voucher-1"
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", amountCents: BigInt(1000000) }
        ])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-009");

    expect(detail.settlementPayment.summary).toEqual([
      { label: "累计生效结算", value: "¥320,000.00", tone: "success" },
      { label: "保守可申请余额", value: "¥30,000.00", tone: "warning" },
      { label: "审批中占用", value: "¥10,000.00", tone: "warning" },
      { label: "已批待付", value: "¥50,000.00", tone: "warning" },
      { label: "已实付", value: "¥220,000.00", tone: "success" },
      { label: "总包代付", value: "¥10,000.00", tone: "success" },
      { label: "累计已支付", value: "¥230,000.00", tone: "success" },
      { label: "最新合同剩余额度", value: "¥680,000.00", tone: "primary" }
    ]);
    expect(detail.settlementPayment.settlementRows.map((row) => row.settlementNo)).toEqual([
      "JS-2026-001",
      "JS-2026-002",
      "JS-2026-003"
    ]);
    expect(detail.settlementPayment.settlementRows[1]).toMatchObject({
      currentAmount: "¥100,000.00",
      cumulativeBeforeAmount: "¥300,000.00",
      cumulativeAfterAmount: "¥300,000.00",
      approvalStatus: "审批中"
    });
    expect(detail.settlementPayment.settlementRows[2]).toMatchObject({
      currentAmount: "¥20,000.00",
      cumulativeBeforeAmount: "¥300,000.00",
      cumulativeAfterAmount: "¥320,000.00",
      approvalStatus: "审批通过"
    });
    expect(detail.settlementPayment.settlementRows[0].archiveStatus).toBe("已归档确认");
    expect(
      detail.settlementPayment.paymentRows.find((row) => row.paymentNo === "FK-2026-001")
    ).toMatchObject({
      paymentNo: "FK-2026-001",
      paidAmount: "¥220,000.00",
      paymentDate: "2026/6/26 16:00:00",
      paymentStatus: "已付款",
      voucherStatus: "已上传"
    });
    expect(
      detail.settlementPayment.paymentRows.find((row) => row.paymentNo === "FK-2026-003")
    ).toMatchObject({
      paymentNo: "FK-2026-003",
      approvedAmount: "待审批",
      approvalStatus: "审批中",
      paymentStatus: "未付款"
    });
    expect(detail.settlementPayment.calculationNote).toContain("系统内金额与历史接管余额分列");
  });

  it("separates historical takeover amounts in contract settlement payment summary", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-HIS-001",
          name: "历史幕墙分包合同",
          counterparty: "幕墙分包单位"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1,
          status: "effective",
          amountCents: 100_000_000
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-041",
            periodLabel: "第4期",
            status: "effective",
            amountCents: 10_000_000,
            payableAmountCents: 10_000_000,
            updatedAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(20_000_000),
          historicalApprovalPendingPaymentCents: BigInt(1_000_000),
          historicalApprovedPendingPaymentCents: BigInt(2_000_000),
          historicalPaidCents: BigInt(5_000_000),
          historicalProxyPaidCents: BigInt(1_500_000),
          historicalAdvancePaidCents: BigInt(4_000_000),
          historicalAdvanceDeductedCents: BigInt(1_000_000),
          otherConfirmedOccupancyCents: BigInt(500_000)
        })
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-HIS-001");

    expect(detail.settlementPayment.summary).toEqual(
      expect.arrayContaining([
        { label: "累计生效结算", value: "¥300,000.00", tone: "success" },
        { label: "系统内累计生效结算", value: "¥100,000.00", tone: "default" },
        { label: "历史累计生效结算", value: "¥200,000.00", tone: "success" },
        { label: "保守可申请余额", value: "¥0.00", tone: "warning" },
        { label: "历史审批中占用", value: "¥10,000.00", tone: "warning" },
        { label: "历史已批待付", value: "¥20,000.00", tone: "warning" },
        { label: "历史已实付", value: "¥50,000.00", tone: "success" },
        { label: "历史总包代付", value: "¥15,000.00", tone: "success" },
        { label: "历史其他确认占用", value: "¥5,000.00", tone: "warning" },
        { label: "历史预付款已付", value: "¥40,000.00", tone: "success" },
        { label: "历史预付款已扣回", value: "¥10,000.00", tone: "default" },
        { label: "最新合同剩余额度", value: "¥700,000.00", tone: "primary" }
      ])
    );
  });

  it("labels contract advance payment rows without settlement", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "幕墙分包单位"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1,
          status: "effective",
          amountCents: 100000000
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-advance-1",
            settlementId: null,
            sourceType: "contract_advance",
            code: "FK-YF-2026-001",
            status: "paid",
            requestedAmountCents: 10000000,
            approvedAmountCents: 10000000,
            paidAmountCents: 10000000,
            updatedAt: new Date("2026-07-20T08:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-advance-1",
            paymentRequestId: "payment-advance-1",
            amountCents: 10000000,
            paidAt: new Date("2026-07-21T08:00:00.000Z"),
            voucherFileId: "voucher-advance-1"
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-009");

    expect(detail.settlementPayment.paymentRows[0]).toMatchObject({
      paymentNo: "FK-YF-2026-001",
      settlementNo: "合同预付款",
      paidAmount: "¥100,000.00",
      paymentStatus: "已付款",
      voucherStatus: "已上传"
    });
  });
});
