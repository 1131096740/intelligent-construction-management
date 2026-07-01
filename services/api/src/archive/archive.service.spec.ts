import { ArchiveService } from "./archive.service";

describe("ArchiveService", () => {
  it("lists contract archives, payment vouchers, and pdf archives as one ledger", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-archive-1",
            contractVersionId: "version-1",
            fileId: "file-contract",
            uploadedByUserId: "user-contract",
            confirmedByUserId: "user-director",
            confirmedAt: new Date("2026-07-01T09:00:00.000Z"),
            status: "confirmed",
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            paymentRequestId: "payment-1",
            voucherFileId: "file-voucher",
            executedByUserId: "user-finance",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "archive-record-1",
            businessType: "payment_request",
            businessId: "payment-1",
            fileId: "file-pdf",
            departmentScope: "finance",
            createdAt: new Date("2026-07-01T11:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "version-1", contractId: "contract-1", versionNo: 1 }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-001",
            temporaryCode: null,
            name: "材料采购合同"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: "payment-1", projectId: "project-1", code: "FK-001" }])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-contract", originalName: "盖章合同.pdf" },
          { id: "file-voucher", originalName: "银行回单.pdf" },
          { id: "file-pdf", originalName: "付款留档.pdf" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-director", name: "合同主管" },
          { id: "user-finance", name: "出纳" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20);

    expect(prisma.archiveRecord.findMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { createdAt: "desc" }
    });
    expect(result.rows.map((row) => row.documentType)).toEqual([
      "付款PDF留档",
      "付款凭证",
      "合同归档件"
    ]);
    expect(result.rows[2]).toMatchObject({
      businessRef: "HT-001 / v1",
      project: "一号项目",
      archiveStatus: "已确认",
      confirmedBy: "合同主管"
    });
    expect(result.summary).toMatchObject({
      total: 3,
      contractArchives: 1,
      paymentFiles: 2
    });
  });
});
