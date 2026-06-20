import { PrismaService } from "../database/prisma.service";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

describe("ContractService", () => {
  it("creates a draft contract with initial version and payment terms", async () => {
    const tx = {
      contract: {
        create: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-001"
        })
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({
          id: "version-1",
          versionNo: 1,
          status: "draft"
        })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({
          id: "terms-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma);
    const input: CreateContractDto = {
      projectId: "project-1",
      code: "HT-001",
      name: "钢材采购合同",
      counterparty: "供应商A",
      amountCents: 1_000_000,
      paymentTermsOriginalText: "按月结算后30日内付款",
      paymentStages: [
        {
          name: "月度结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "settlement_effective",
          dueDays: 30,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          originalText: "结算生效并开票后30日内支付80%"
        }
      ]
    };

    const result = await service.createDraft(input);

    expect(result.version.versionNo).toBe(1);
    expect(result.version.status).toBe("draft");
    expect(result.terms.versionNo).toBe(1);
    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNo: 1,
        changeType: "original",
        status: "draft",
        amountCents: input.amountCents
      })
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-1",
          basis: "current_settlement",
          ratioBps: 8000
        })
      ]
    });
  });
});
