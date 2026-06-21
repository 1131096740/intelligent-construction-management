import { SettlementReadService } from "./settlement-read.service";

describe("SettlementReadService", () => {
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
      }
    };
    const service = new SettlementReadService(prisma as never);

    const detail = await service.getDetail("JS-2026-031");

    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }] }
    });
    expect(detail.id).toBe("JS-2026-031");
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
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts/HT-2026-009",
      "/payments/FK-2026-011",
      "/archives",
      "/audit"
    ]);
  });
});
