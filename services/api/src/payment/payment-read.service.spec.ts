import { PaymentReadService } from "./payment-read.service";

describe("PaymentReadService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-08T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds payment ledger rows and summary from persisted requests and executions", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            projectId: "project-1",
            settlementId: "settlement-1",
            code: "FK-2026-011",
            status: "approved_pending_payment",
            requestedAmountCents: 49300000,
            approvedAmountCents: 49300000,
            paidAmountCents: 0,
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          },
          {
            id: "payment-2",
            projectId: "project-1",
            settlementId: "settlement-2",
            code: "FK-2026-012",
            status: "paid",
            requestedAmountCents: 20000000,
            approvedAmountCents: 20000000,
            paidAmountCents: 0,
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031"
          },
          {
            id: "settlement-2",
            code: "JS-2026-032"
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
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentRequestId: "payment-2",
            amountCents: 20000000
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "FK-2026-011",
      paymentNo: "FK-2026-011",
      settlementNo: "JS-2026-031",
      project: "总部综合楼",
      requestedAmount: "¥493,000.00",
      approvalStatus: "已通过",
      paymentStatus: "已批待付",
      currentNode: "出纳付款登记",
      ownerDepartment: "出纳/财务",
      pendingOwner: "出纳/财务",
      stalledFor: "7天",
      returnReason: "-",
      nextAction: "出纳付款登记"
    });
    expect(ledger.rows[1]).toMatchObject({
      paymentNo: "FK-2026-012",
      paymentStatus: "已付款",
      currentNode: "财务入账归档"
    });
    expect(ledger.summary).toEqual({
      total: 2,
      pendingApproval: 0,
      orSign: 0,
      pendingPayment: 1,
      paid: 1
    });
  });

  it("filters payment ledger by visible projects", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn()
      },
      paymentExecution: {
        findMany: jest.fn()
      }
    };
    const service = new PaymentReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.paymentRequest.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("builds payment ledger rows for contract advance requests without settlement", async () => {
    const prisma = {
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-advance-1",
            projectId: "project-1",
            settlementId: null,
            sourceType: "contract_advance",
            code: "FK-YF-2026-001",
            status: "approval_pending",
            requestedAmountCents: 10000000,
            approvedAmountCents: null,
            paidAmountCents: 0,
            updatedAt: new Date("2026-07-20T10:00:00.000Z")
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "总部综合楼"
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const ledger = await service.listRecent(20);

    expect(prisma.settlement.findMany).not.toHaveBeenCalled();
    expect(ledger.rows[0]).toMatchObject({
      paymentNo: "FK-YF-2026-001",
      settlementNo: "合同预付款",
      project: "总部综合楼",
      requestedAmount: "¥100,000.00",
      approvalStatus: "审批中"
    });
  });

  it("builds payment detail from persisted payment request and executions", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "FK-2026-011",
          status: "approved_pending_payment",
          requestedAmountCents: 49300000,
          approvedAmountCents: 49300000,
          paidAmountCents: 12000000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective"
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
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8500,
          dueDays: 20
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            amountCents: 12000000,
            voucherFileId: "file-voucher-1",
            executedByUserId: "user-cashier",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 5000000 }])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pdf-document-1",
            fileId: "file-pdf-1",
            templateKey: "payment_finance_archive",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-voucher-1",
            originalName: "FK-2026-011-银行回单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            uploadedByUserId: "user-cashier",
            createdAt: new Date("2026-07-01T08:55:00.000Z")
          },
          {
            id: "file-pdf-1",
            originalName: "FK-2026-011-财务归档.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            uploadedByUserId: "user-finance",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-cashier", name: "出纳" },
          { id: "user-finance", name: "财务" }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-011");

    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "FK-2026-011" }, { code: "FK-2026-011" }] }
    });
    expect(detail.id).toBe("FK-2026-011");
    expect(detail.title).toBe("FK-2026-011 · 2026-06付款申请");
    expect(detail.baseInfo).toContainEqual({ label: "申请金额", value: "¥493,000.00" });
    expect(detail.baseInfo).toContainEqual({ label: "已付金额", value: "¥120,000.00" });
    expect(detail.approvalSteps.map((step) => step.label)).toEqual([
      "付款申请",
      "项目经理审批",
      "合同结算部/预算部审批",
      "财务复核",
      "董事长/总经理或签",
      "审批通过"
    ]);
    expect(detail.executionSteps.map((step) => step.label)).toContain("付款凭证上传");
    expect(detail.approvalSteps.at(-1)).toMatchObject({
      label: "审批通过",
      status: "已批待付",
      tone: "warning"
    });
    expect(detail.executionSteps.at(-1)).toMatchObject({
      label: "付款完成",
      status: "未完成",
      tone: "danger"
    });
    expect(detail.evidenceFiles).toEqual([
      {
        recordId: "execution-1",
        fileId: "file-voucher-1",
        fileName: "FK-2026-011-银行回单.pdf",
        purpose: "付款凭证",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "uploaded",
        statusLabel: "已上传",
        uploadedByName: "出纳",
        uploadedAt: "2026-07-01T09:00:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: true,
        disabledReason: null
      },
      {
        recordId: "pdf-document-1",
        fileId: "file-pdf-1",
        fileName: "FK-2026-011-财务归档.pdf",
        purpose: "付款财务归档 PDF",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        status: "archived",
        statusLabel: "已归档",
        uploadedByName: "财务",
        uploadedAt: "2026-07-01T10:00:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: true,
        disabledReason: null
      }
    ]);
    expect(detail.executionCoverages).toEqual([
      {
        id: "execution-1",
        executionCode: "FK-2026-011 · 第1笔",
        paidAt: "2026-07-01T09:00:00.000Z",
        paidAmount: "¥120,000.00",
        voucherName: "FK-2026-011-银行回单.pdf",
        financeRecordedAmount: "¥50,000.00",
        unrecordedAmount: "¥70,000.00",
        coverageStatus: "部分入账"
      }
    ]);
    expect(detail.traceRules).toContain("审批通过不等于实际付款完成");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/settlements/JS-2026-031",
      "/archives",
      "/audit"
    ]);
  });

  it("exposes enabled payment execution action for cashier after approval", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "FK-2026-011",
          status: "approved_pending_payment",
          requestedAmountCents: 49300000,
          approvedAmountCents: 49300000,
          paidAmountCents: 0
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-011", undefined, "user-cashier");

    expect(projectVisibility.effectiveRoleKeys).toHaveBeenCalledWith("user-cashier", "project-1");
    expect(detail.primaryAction).toBe("record_execution");
    expect(detail.availableActions).toContainEqual({
      key: "record_execution",
      label: "登记实际付款",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredAction: "payment.execution",
      requiresPassword: true,
      requiresFile: true
    });
    expect(detail.disabledReasons).toEqual([]);
  });

  it("does not expose payment detail outside visible projects", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new PaymentReadService(prisma as never);

    await expect(service.getDetail("FK-2026-011", ["project-1"])).rejects.toThrow("Payment request not found");
    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "FK-2026-011" }, { code: "FK-2026-011" }],
        projectId: { in: ["project-1"] }
      }
    });
  });

  it("builds contract advance payment detail without requiring settlement", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          sourceType: "contract_advance",
          settlementId: null,
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-YF-2026-001",
          status: "approved_pending_payment",
          requestedAmountCents: 10000000,
          approvedAmountCents: 10000000,
          paidAmountCents: 0
        })
      },
      settlement: {
        findUnique: jest.fn()
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
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-advance",
          name: "预付款",
          ratioBps: 1000,
          dueDays: 30
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-YF-2026-001");

    expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentTermsStage.findFirst).toHaveBeenCalledWith({
      where: {
        paymentTermsVersionId: "terms-version-1",
        stageType: "advance",
        basis: "contract_amount",
        triggerAnchor: "contract_effective"
      },
      orderBy: { createdAt: "asc" }
    });
    expect(detail.title).toBe("FK-YF-2026-001 · 合同预付款申请");
    expect(detail.baseInfo).toContainEqual({ label: "付款来源", value: "合同预付款" });
    expect(detail.baseInfo).toContainEqual({ label: "关联合同", value: "HT-2026-009 · 幕墙分包合同" });
    expect(detail.traceRules).toContain("预付款按合同生效日和账期计算，不依赖结算单");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts/HT-2026-009",
      "/archives",
      "/audit"
    ]);
  });

  it("builds contract-level due payment detail with execution allocation ledger rows", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          sourceType: "contract_due",
          settlementId: null,
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-HT-2026-001",
          status: "paid",
          requestedAmountCents: 100_000,
          approvedAmountCents: 100_000,
          paidAmountCents: 100_000
        })
      },
      settlement: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031",
            periodLabel: "2026-06"
          },
          {
            id: "settlement-2",
            code: "JS-2026-032",
            periodLabel: "2026-07"
          }
        ])
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
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8000,
          dueDays: 0
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 100_000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "allocation-0",
            settlementId: "settlement-1",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "advance_deduction",
            amountCents: 10_000,
            allocationOrder: 0
          },
          {
            id: "allocation-1",
            settlementId: "settlement-1",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "contract_due_payment",
            amountCents: 60_000,
            allocationOrder: 1
          },
          {
            id: "allocation-2",
            settlementId: "settlement-2",
            stageName: "进度款",
            stageType: "progress",
            allocationType: "contract_due_payment",
            amountCents: 40_000,
            allocationOrder: 2
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-HT-2026-001");

    expect(prisma.settlement.findUnique).not.toHaveBeenCalled();
    expect(prisma.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: { paymentRequestId: "payment-due-1" },
      orderBy: [{ createdAt: "asc" }, { allocationOrder: "asc" }]
    });
    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["settlement-1", "settlement-2"] } },
      select: { id: true, code: true, periodLabel: true }
    });
    expect(detail.title).toBe("FK-HT-2026-001 · 合同累计结算付款申请");
    expect(detail.executionAllocations).toEqual([
      {
        id: "allocation-0",
        executionCode: "FK-HT-2026-001 · 第1笔",
        settlementNo: "JS-2026-031 · 2026-06",
        stageName: "进度款",
        allocationType: "预付款扣回",
        amountCents: 10_000
      },
      {
        id: "allocation-1",
        executionCode: "FK-HT-2026-001 · 第2笔",
        settlementNo: "JS-2026-031 · 2026-06",
        stageName: "进度款",
        allocationType: "合同累计结算付款分摊",
        amountCents: 60_000
      },
      {
        id: "allocation-2",
        executionCode: "FK-HT-2026-001 · 第3笔",
        settlementNo: "JS-2026-032 · 2026-07",
        stageName: "进度款",
        allocationType: "合同累计结算付款分摊",
        amountCents: 40_000
      }
    ]);
    expect(detail.traceRules).toContain(
      "付款申请按合同下全部已生效结算累计计算，实付后自动生成分摊台账"
    );
  });

  it("does not show actual payment block message before approval passes", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-012",
          status: "approval_pending",
          requestedAmountCents: 5000000,
          approvedAmountCents: null,
          paidAmountCents: 0
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-032",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "stage-progress",
          name: "进度款",
          ratioBps: 8000,
          dueDays: 30
        })
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-012");

    expect(detail.executionBlockMessage).toContain("付款申请仍在审批中");
    expect(detail.executionBlockMessage).not.toContain("付款审批已通过");
  });

  it("shows partial payment execution as payable instead of waiting for approval", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-013",
          status: "partially_paid",
          requestedAmountCents: 5000000,
          approvedAmountCents: 5000000,
          paidAmountCents: 2000000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-033",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 2000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-013");

    expect(detail.meta).toContainEqual({ label: "实付状态", value: "部分付款", tone: "warning" });
    expect(detail.meta).toContainEqual({ label: "下一步动作", value: "继续出纳付款登记", tone: "warning" });
    expect(detail.approvalSteps.at(-1)).toMatchObject({
      label: "审批通过",
      status: "已批待付",
      tone: "warning"
    });
    expect(detail.executionBlockMessage).toContain("已登记部分实际付款");
  });

  it("exposes finance entry for partially paid requests", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-013",
          status: "partially_paid",
          requestedAmountCents: 5000000,
          approvedAmountCents: 5000000,
          paidAmountCents: 2000000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-033",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 2000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-013", undefined, "user-finance");

    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "record_finance",
        label: "财务入账",
        enabled: true,
        disabledReason: null,
        requiredAction: "payment.finance_record"
      })
    );
  });

  it("keeps payment pdf archive disabled until finance records cover paid amount", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-014",
          status: "paid",
          requestedAmountCents: 5000000,
          approvedAmountCents: 5000000,
          paidAmountCents: 5000000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-034",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 5000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-014", undefined, "user-finance");

    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "record_finance",
        enabled: true,
        disabledReason: null
      })
    );
    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "archive_pdf",
        enabled: false,
        disabledReason: "财务入账未完成"
      })
    );
  });

  it("enables approval review for a standing delegation recipient", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-015",
          status: "approval_pending",
          requestedAmountCents: 5000000,
          approvedAmountCents: null,
          paidAmountCents: 0
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-035",
          periodLabel: "2026-06",
          status: "effective"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-1", versionNo: 1 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-1", versionNo: 1 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          frozenNodes: [{ roleKeys: ["finance_director"] }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-director-1" }])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockImplementation((userId: string) => {
        if (userId === "finance-director-1") return ["finance_director"];
        return [];
      })
    };
    const service = new PaymentReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("FK-2026-015", undefined, "delegatee-1");

    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: { businessType: "payment_request", businessId: "payment-1", status: "in_progress" },
      orderBy: { createdAt: "desc" },
      select: { frozenNodes: true, currentNodeIndex: true }
    });
    expect(detail.primaryAction).toBe("review_approval");
    expect(detail.availableActions).toContainEqual(
      expect.objectContaining({
        key: "review_approval",
        enabled: true,
        disabledReason: null
      })
    );
  });

  it("shows finance entry as recorded after finance records cover paid amount", async () => {
    const prisma = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          settlementId: "settlement-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-014",
          status: "paid",
          requestedAmountCents: 5000000,
          approvedAmountCents: 5000000,
          paidAmountCents: 5000000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-034",
          periodLabel: "2026-06",
          status: "partially_paid"
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          versionNo: 1
        })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 5000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-1", amountCents: 5000000 }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const detail = await service.getDetail("FK-2026-014");

    expect(detail.executionSteps).toContainEqual({
      label: "财务入账",
      status: "已入账",
      owner: "财务部",
      tone: "success"
    });
  });

  it("builds a contract-level payment application preview from all effective settlements", async () => {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: 1_000_000,
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: 1_000_000
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          projectId: "project-1"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-1"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-due",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 10_000,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-06-10T00:00:00.000Z"),
            updatedAt: new Date("2026-06-10T00:00:00.000Z")
          },
          {
            id: "settlement-not-due",
            code: "JS-2026-032",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 50_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
            updatedAt: new Date("2026-07-10T00:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-due",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          },
          {
            settlementId: "settlement-not-due",
            confirmedAt: new Date("2026-07-10T00:00:00.000Z")
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            paymentTermsVersionId: "terms-version-1",
            name: "进度款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认",
            dueDays: 30,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          },
          {
            id: "stage-advance",
            paymentTermsVersionId: "terms-version-1",
            name: "预付款",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            triggerEvent: "合同生效",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-due",
            sourceType: "settlement",
            paymentTermsVersionId: "terms-version-1",
            status: "approved_pending_payment",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 0
          },
          {
            settlementId: null,
            sourceType: "contract_advance",
            paymentTermsVersionId: "terms-version-1",
            status: "paid",
            requestedAmountCents: 50_000,
            approvedAmountCents: 50_000,
            paidAmountCents: 50_000
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            amountCents: 5_000n
          }
        ])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const preview = await service.getContractApplication(
      "contract-version-1",
      "2026-07-20T00:00:00.000Z"
    );

    expect(prisma.settlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: "contract-1" })
      })
    );
    expect(preview.contract).toEqual({
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      contractNo: "HT-2026-009",
      contractName: "幕墙分包合同",
      contractVersion: "合同 v1",
      projectId: "project-1",
      projectName: "总部综合楼"
    });
    expect(preview.capacity).toMatchObject({
      cumulativeEffectiveSettlementCents: 150_000,
      duePayableCents: 80_000,
      occupiedCents: 45_000,
      proxyPaidCents: 5_000,
      advanceDeductionCents: 20_000,
      maxRequestableCents: 15_000
    });
    expect(preview.capacityExplanation).toEqual([
      expect.objectContaining({
        label: "当前累计可付款金额",
        amountCents: 80_000,
        operator: "add"
      }),
      expect.objectContaining({
        label: "扣已实际付款",
        amountCents: 10_000,
        operator: "subtract"
      }),
      expect.objectContaining({
        label: "扣审批中占用",
        amountCents: 0,
        operator: "subtract"
      }),
      expect.objectContaining({
        label: "扣已批待付款占用",
        amountCents: 30_000,
        operator: "subtract"
      }),
      expect.objectContaining({
        label: "扣总包代付",
        amountCents: 5_000,
        operator: "subtract"
      }),
      expect.objectContaining({
        label: "扣本次应扣回预付款",
        amountCents: 20_000,
        operator: "subtract"
      }),
      expect.objectContaining({
        label: "本次最多可申请",
        amountCents: 15_000,
        operator: "result"
      })
    ]);
    expect(prisma.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: {
        voidedAt: null,
        OR: [
          { contractId: "contract-1" },
          { settlementId: { in: ["settlement-due", "settlement-not-due"] } }
        ]
      },
      select: { amountCents: true }
    });
    expect(preview.advanceDeduction).toMatchObject({
      paidAdvanceCents: 50_000,
      currentDeductionCents: 20_000,
      remainingAdvanceToDeductCents: 30_000
    });
    expect(preview.sections.map((section) => section.type)).toEqual(["advance", "progress"]);
    expect(preview.sections[1]).toMatchObject({
      type: "progress",
      title: "进度款"
    });
    expect(preview.sections[1].rows).toEqual([
      expect.objectContaining({
        source: "JS-2026-031 · 2026-06",
        currentSettlementAmountCents: 100_000,
        cumulativeBeforeAmountCents: 0,
        cumulativeAfterAmountCents: 100_000,
        expectedPayableAt: "2026-07-01",
        isDue: true,
        includableAmountCents: 80_000
      }),
      expect.objectContaining({
        source: "JS-2026-032 · 2026-07",
        cumulativeBeforeAmountCents: 100_000,
        cumulativeAfterAmountCents: 150_000,
        expectedPayableAt: "2026-08-09",
        isDue: false,
        includableAmountCents: 0
      })
    ]);
    expect(preview.formula).toContain(
      "当前累计可付款金额（系统内 + 历史接管）"
    );
  });

  it("builds contract payment application preview with historical takeover balance breakdown", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-HIS-001",
          temporaryCode: null,
          name: "历史幕墙分包合同"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1" }])
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(200_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(20_000),
          historicalPaidCents: BigInt(50_000),
          historicalProxyPaidCents: BigInt(10_000),
          historicalAdvancePaidCents: BigInt(40_000),
          historicalAdvanceDeductedCents: BigInt(10_000),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-041",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 10_000,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            isFinal: false,
            createdAt: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            paymentTermsVersionId: "terms-version-1",
            name: "进度款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          },
          {
            id: "stage-advance",
            paymentTermsVersionId: "terms-version-1",
            name: "预付款",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            triggerEvent: "合同生效",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            sourceType: "settlement",
            paymentTermsVersionId: "terms-version-1",
            status: "approved_pending_payment",
            requestedAmountCents: 10_000,
            approvedAmountCents: 10_000,
            paidAmountCents: 0
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new PaymentReadService(prisma as never);

    const preview = await service.getContractApplication(
      "contract-version-1",
      "2026-07-20T00:00:00.000Z"
    );

    expect(preview.capacity).toMatchObject({
      systemCumulativeEffectiveSettlementCents: 100_000,
      historicalSettledCents: 200_000,
      cumulativeEffectiveSettlementCents: 300_000,
      duePayableCents: 80_000,
      actualPaidCents: 10_000,
      approvedPendingCents: 10_000,
      proxyPaidCents: 0,
      historicalPaidCents: 50_000,
      historicalApprovedPendingCents: 20_000,
      historicalProxyPaidCents: 10_000,
      historicalOccupiedCents: 80_000,
      advanceDeductionCents: 10_000,
      maxRequestableCents: 0
    });
    expect(preview.historicalBalance).toEqual({
      settledCents: 200_000,
      approvalPendingPaymentCents: 0,
      approvedPendingPaymentCents: 20_000,
      paidCents: 50_000,
      proxyPaidCents: 10_000,
      advancePaidCents: 40_000,
      advanceDeductedCents: 10_000,
      otherConfirmedOccupancyCents: 0
    });
    expect(preview.advanceDeduction).toMatchObject({
      paidAdvanceCents: 40_000,
      systemPaidAdvanceCents: 0,
      historicalAdvancePaidCents: 40_000,
      historicalAdvanceDeductedCents: 10_000,
      currentDeductionCents: 10_000,
      remainingAdvanceToDeductCents: 20_000
    });
    expect(preview.capacityExplanation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "扣已实际付款",
          amountCents: 60_000,
          note: "含历史接管已付款"
        }),
        expect.objectContaining({
          label: "扣已批待付款占用",
          amountCents: 30_000,
          note: "含历史接管已批待付款"
        }),
        expect.objectContaining({
          label: "扣总包代付",
          amountCents: 10_000,
          note: "含历史接管总包代付"
        }),
        expect.objectContaining({
          label: "本次最多可申请",
          amountCents: 0,
          tone: "warning"
        })
      ])
    );
  });
});
