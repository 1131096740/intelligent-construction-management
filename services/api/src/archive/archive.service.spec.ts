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
          },
          {
            id: "archive-record-expense-1",
            businessType: "project_expense_request",
            businessId: "expense-1",
            fileId: "file-expense-pdf",
            departmentScope: "finance",
            createdAt: new Date("2026-07-01T11:30:00.000Z")
          },
          {
            id: "archive-record-spot-purchase-1",
            businessType: "project_expense_request",
            businessId: "expense-2",
            fileId: "file-spot-purchase-pdf",
            departmentScope: "finance",
            createdAt: new Date("2026-07-01T11:45:00.000Z")
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
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "expense-1", projectId: "project-1", code: "BX-001", expenseType: "reimbursement" },
          { id: "expense-2", projectId: "project-1", code: "CG-001", expenseType: "spot_purchase" }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-contract", originalName: "盖章合同.pdf", sizeBytes: 1024 },
          { id: "file-voucher", originalName: "银行回单.pdf", sizeBytes: 2048 },
          { id: "file-pdf", originalName: "付款留档.pdf", sizeBytes: 4096 },
          { id: "file-expense-pdf", originalName: "报销留档.pdf", sizeBytes: 1024 },
          { id: "file-spot-purchase-pdf", originalName: "零星采购留档.pdf", sizeBytes: 1024 }
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
      "零星采购PDF留档",
      "报销PDF留档",
      "付款PDF留档",
      "付款凭证",
      "合同归档件"
    ]);
    expect(result.rows[0]).toMatchObject({
      businessRef: "CG-001",
      project: "一号项目",
      fileId: "file-spot-purchase-pdf",
      fileSizeBytes: 1024,
      canDownload: true,
      archiveStatus: "已入库"
    });
    expect(result.rows[1]).toMatchObject({
      businessRef: "BX-001",
      project: "一号项目",
      fileId: "file-expense-pdf",
      fileSizeBytes: 1024,
      canDownload: true,
      archiveStatus: "已入库"
    });
    expect(result.rows[4]).toMatchObject({
      businessRef: "HT-001 / v1",
      project: "一号项目",
      fileId: "file-contract",
      fileSizeBytes: 1024,
      canDownload: true,
      disabledReason: null,
      archiveStatus: "已确认",
      confirmedBy: "合同主管"
    });
    expect(result.summary).toMatchObject({
      total: 5,
      contractArchives: 1,
      paymentFiles: 2
    });
  });

  it("does not expose internal user accounts when archive ledger operator names are unavailable", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-archive-1",
            contractVersionId: "version-1",
            fileId: "file-contract",
            uploadedByUserId: "user-contract",
            confirmedByUserId: "confirm-internal-id",
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
            executedByUserId: "executor-internal-id",
            createdAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
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
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-contract", originalName: "盖章合同.pdf", sizeBytes: 1024 },
          { id: "file-voucher", originalName: "银行回单.pdf", sizeBytes: 2048 }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20);

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentType: "付款凭证",
          confirmedBy: "经办人未读取"
        }),
        expect.objectContaining({
          documentType: "合同归档件",
          confirmedBy: "确认人未读取"
        })
      ])
    );
  });

  it("filters archive ledger by visible projects", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-archive-1",
            contractVersionId: "version-1",
            fileId: "file-contract",
            uploadedByUserId: "user-contract",
            confirmedByUserId: null,
            confirmedAt: null,
            status: "confirmed",
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
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
            projectId: "project-hidden",
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
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-contract", originalName: "盖章合同.pdf", sizeBytes: 1024 }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-hidden", name: "隐藏项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, ["project-visible"]);

    expect(result.rows).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it("lists historical takeover evidence by project visibility", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "archive-record-takeover-1",
            businessType: "contract_takeover",
            businessId: "takeover-1",
            fileId: "file-takeover",
            departmentScope: "contract",
            createdAt: new Date("2026-07-01T11:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-OLD-001",
            temporaryCode: null,
            name: "历史幕墙合同"
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "takeover-1",
            projectId: "project-1",
            contractId: "contract-1"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-takeover", originalName: "历史合同扫描件.pdf", sizeBytes: 1024 }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, ["project-1"]);

    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "历史接管资料",
        businessRef: "HT-OLD-001 / 历史接管",
        project: "一号项目",
        fileId: "file-takeover",
        canDownload: true,
        archiveStatus: "已入库"
      })
    ]);
    expect(result.summary.total).toBe(1);
  });

  it("does not let hidden takeover evidence crowd out visible takeover evidence", async () => {
    const archiveRecords = [
      {
        id: "archive-hidden",
        businessType: "contract_takeover",
        businessId: "takeover-hidden",
        fileId: "file-hidden",
        departmentScope: "contract",
        createdAt: new Date("2026-07-01T12:00:00.000Z")
      },
      {
        id: "archive-visible",
        businessType: "contract_takeover",
        businessId: "takeover-visible",
        fileId: "file-visible",
        departmentScope: "contract",
        createdAt: new Date("2026-07-01T11:00:00.000Z")
      }
    ];
    const prisma = {
      contractArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      archiveRecord: {
        findMany: jest.fn(async (args?: { where?: { OR?: Array<{ businessId?: { in: string[] } }> }; take?: number }) => {
          const visibleIds = args?.where?.OR?.flatMap((item) => item.businessId?.in ?? []) ?? [];
          if (visibleIds.length) {
            return archiveRecords.filter((record) => visibleIds.includes(record.businessId));
          }
          return archiveRecords.slice(0, args?.take ?? archiveRecords.length);
        })
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-visible",
            projectId: "project-visible",
            code: "HT-VISIBLE",
            temporaryCode: null,
            name: "可见历史合同"
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn(async (args: { where: { projectId?: { in: string[] }; id?: { in: string[] } } }) => {
          if (args.where.projectId) {
            return [{ id: "takeover-visible", projectId: "project-visible", contractId: "contract-visible" }];
          }
          return [{ id: "takeover-visible", projectId: "project-visible", contractId: "contract-visible" }];
        })
      },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-visible", originalName: "当前项目历史合同.pdf", sizeBytes: 1024 }
        ])
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-visible", name: "可见项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(1, ["project-visible"]);

    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "历史接管资料",
        businessRef: "HT-VISIBLE / 历史接管",
        project: "可见项目",
        fileId: "file-visible"
      })
    ]);
    expect(result.summary.total).toBe(1);
  });

  it("does not mark pending business archive files as downloadable", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-archive-1",
            contractVersionId: "version-1",
            fileId: "file-contract",
            uploadedByUserId: "user-contract",
            confirmedByUserId: null,
            confirmedAt: null,
            status: "pending_confirm",
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            settlementId: "settlement-1",
            fileId: "file-settlement",
            uploadedByUserId: "user-contract",
            confirmedByUserId: null,
            confirmedAt: null,
            status: "pending_confirm",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            code: "JS-001",
            periodLabel: "2026-07"
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-contract", originalName: "盖章合同.pdf", sizeBytes: 1024 },
          { id: "file-settlement", originalName: "签章结算单.pdf", sizeBytes: 2048 }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "一号项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20);

    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "结算归档件",
        archiveStatus: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      }),
      expect.objectContaining({
        documentType: "合同归档件",
        archiveStatus: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      })
    ]);
    expect(result.summary.pending).toBe(2);
  });
});
