import { PaymentReadService } from "./payment-read.service";

describe("PaymentReadService", () => {
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
      ownerDepartment: "出纳/财务"
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
          { id: "execution-1", amountCents: 12000000 }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([])
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
    expect(detail.traceRules).toContain("审批通过不等于实际付款完成");
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/settlements/JS-2026-031",
      "/archives",
      "/audit"
    ]);
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
});
