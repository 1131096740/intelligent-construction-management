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
    expect(detail.settlementPayment.calculationNote).toContain("未纳入账期");
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
