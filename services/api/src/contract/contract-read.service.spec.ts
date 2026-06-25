import { ContractReadService } from "./contract-read.service";

describe("ContractReadService", () => {
  it("displays temporaryCode when contract has no formal code and tolerates empty payment stages", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-draft-1",
          projectId: "project-1",
          code: null,
          temporaryCode: "DRAFT-20260625-ABCDEFGH",
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
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("contract-draft-1");

    expect(detail.id).toBe("DRAFT-20260625-ABCDEFGH");
    expect(detail.title).toBe("DRAFT-20260625-ABCDEFGH · ");
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
        findFirst: jest.fn().mockResolvedValue({
          code: "JS-2026-031"
        })
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
});
