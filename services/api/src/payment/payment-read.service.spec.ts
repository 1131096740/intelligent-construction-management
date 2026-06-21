import { PaymentReadService } from "./payment-read.service";

describe("PaymentReadService", () => {
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
    expect(detail.approvalSteps.map((step) => step.label)).toContain("董事长/总经理或签");
    expect(detail.executionSteps.map((step) => step.label)).toContain("付款凭证上传");
    expect(detail.approvalSteps.at(-1)).toMatchObject({
      label: "审批通过",
      status: "approved_pending_payment",
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
});
