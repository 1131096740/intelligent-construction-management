import { PrismaService } from "../database/prisma.service";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

describe("ContractService", () => {
  const audit = {
    record: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
  });

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
    const service = new ContractService(prisma, audit as never);
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

  it("uploads a signed contract archive file and waits for director confirmation", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "seal_approved_pending_archive"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      contractArchiveFile: {
        create: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "pending_confirm"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.uploadArchiveFile("contract-version-1", {
      fileId: "file-1",
      uploadedByUserId: "user-contract-staff"
    });

    expect(result.status).toBe("pending_confirm");
    expect(tx.contractArchiveFile.create).toHaveBeenCalledWith({
      data: {
        contractVersionId: "contract-version-1",
        fileId: "file-1",
        uploadedByUserId: "user-contract-staff",
        status: "pending_confirm"
      }
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "pending_archive_confirm" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "contract.archive.upload",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fileId: "file-1",
        archiveFileId: "archive-file-1"
      }
    });
  });

  it("confirms a signed contract archive file and makes the version effective", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "effective"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "pending_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "confirmed"
        })
      },
      paymentTermsVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.confirmArchiveFile("contract-version-1", {
      archiveFileId: "archive-file-1",
      confirmedByUserId: "user-contract-director"
    });

    expect(result.status).toBe("effective");
    expect(tx.contractArchiveFile.update).toHaveBeenCalledWith({
      where: { id: "archive-file-1" },
      data: {
        confirmedByUserId: "user-contract-director",
        confirmedAt: expect.any(Date),
        status: "confirmed"
      }
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: {
        status: "effective",
        effectiveAt: expect.any(Date)
      }
    });
    expect(tx.paymentTermsVersion.updateMany).toHaveBeenCalledWith({
      where: { contractVersionId: "contract-version-1" },
      data: { status: "effective" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-director",
      action: "contract.archive.confirm",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        archiveFileId: "archive-file-1"
      }
    });
  });
});
