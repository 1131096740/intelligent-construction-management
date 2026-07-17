import { ArchiveService } from "./archive.service";

function emptySpotArchivePrisma() {
  return {
    spotProcurement: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementVersion: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementReceipt: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementReceiptReview: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementPaymentInvoice: {
      findMany: jest.fn().mockResolvedValue([])
    },
    invoiceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    invoiceLine: { findMany: jest.fn().mockResolvedValue([]) },
    invoiceAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    noInvoiceConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
    invoiceExceptionConfirmation: {
      findMany: jest.fn().mockResolvedValue([])
    },
    pdfDocument: { findMany: jest.fn().mockResolvedValue([]) },
    approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

describe("ArchiveService", () => {
  it("lists contract archives, payment vouchers, and pdf archives as one ledger", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
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
      ...emptySpotArchivePrisma(),
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

  it("does not expose internal archive status or department values", () => {
    const service = new ArchiveService({} as never);
    const privateMethods = service as unknown as {
      statusLabel(status: string): string;
      departmentLabel(scope: string): string;
    };

    expect(privateMethods.statusLabel("internal_status")).toBe("归档状态未读取");
    expect(privateMethods.departmentLabel("internal_department")).toBe("部门未读取");
  });

  it("filters archive ledger by visible projects", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
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
      ...emptySpotArchivePrisma(),
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
      ...emptySpotArchivePrisma(),
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
      ...emptySpotArchivePrisma(),
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

  it("keeps approved spot PDFs after later invalidation or voiding and excludes approval-pending PDFs", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
      contractArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      archiveRecord: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-procurement-visible",
            projectId: "project-visible",
            code: "LXCG-001",
            supplierNameSnapshot: "甲材料店"
          }
        ])
      },
      spotProcurementVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-version-approved",
            procurementId: "spot-procurement-visible",
            status: "invalidated"
          },
          {
            id: "spot-version-pending",
            procurementId: "spot-procurement-visible",
            status: "approval_pending"
          }
        ])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-approved",
            projectId: "project-visible",
            procurementId: "spot-procurement-visible",
            code: "LXFK-001",
            status: "voided"
          },
          {
            id: "spot-payment-pending",
            projectId: "project-visible",
            procurementId: "spot-procurement-visible",
            code: "LXFK-002",
            status: "approval_pending"
          }
        ])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "spot_procurement_version",
            businessId: "spot-version-approved"
          },
          {
            businessType: "spot_procurement_payment",
            businessId: "spot-payment-approved"
          }
        ])
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pdf-spot-version",
            businessType: "spot_procurement_version",
            businessId: "spot-version-approved",
            fileId: "file-spot-version-pdf",
            templateKey: "approval_form",
            createdAt: new Date("2026-07-17T02:00:00.000Z")
          },
          {
            id: "pdf-spot-payment",
            businessType: "spot_procurement_payment",
            businessId: "spot-payment-approved",
            fileId: "file-spot-payment-pdf",
            templateKey: "approval_form",
            createdAt: new Date("2026-07-17T03:00:00.000Z")
          },
          {
            id: "pdf-spot-version-pending",
            businessType: "spot_procurement_version",
            businessId: "spot-version-pending",
            fileId: "file-spot-version-pending",
            templateKey: "approval_form",
            createdAt: new Date("2026-07-17T03:30:00.000Z")
          },
          {
            id: "pdf-spot-payment-pending",
            businessType: "spot_procurement_payment",
            businessId: "spot-payment-pending",
            fileId: "file-spot-payment-pending",
            templateKey: "approval_form",
            createdAt: new Date("2026-07-17T03:45:00.000Z")
          }
        ])
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-execution-active",
            paymentId: "spot-payment-approved",
            voucherFileId: "file-spot-payment-voucher",
            executedByUserId: "finance-1",
            createdAt: new Date("2026-07-17T04:00:00.000Z"),
            voidedAt: null
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          { id: "file-spot-version-pdf", originalName: "零星采购申请审批单.pdf", sizeBytes: 1024 },
          { id: "file-spot-payment-pdf", originalName: "零星材料付款审批单.pdf", sizeBytes: 2048 },
          { id: "file-spot-payment-voucher", originalName: "银行付款回单.pdf", sizeBytes: 4096 }
        ])
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "finance-1", name: "财务甲" }]) },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-visible", name: "可见项目" }])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, ["project-visible"]);

    expect(prisma.spotProcurement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["spot-procurement-visible"] },
          projectId: { in: ["project-visible"] }
        }
      })
    );
    expect(prisma.spotProcurementVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["spot-version-approved", "spot-version-pending"]
          }
        }
      })
    );
    expect(prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["spot-payment-approved", "spot-payment-pending"]
          },
          projectId: { in: ["project-visible"] }
        }
      })
    );
    expect(prisma.approvalInstance.findMany).toHaveBeenCalledWith({
      where: {
        status: "approved",
        OR: [
          {
            businessType: "spot_procurement_version",
            businessId: { in: ["spot-version-approved", "spot-version-pending"] }
          },
          {
            businessType: "spot_procurement_payment",
            businessId: { in: ["spot-payment-approved", "spot-payment-pending"] }
          }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: 160,
      select: { businessType: true, businessId: true }
    });
    expect(prisma.pdfDocument.findMany).toHaveBeenCalledWith(
      {
        where: {
          OR: [
            {
              templateKey: "approval_form",
              businessType: {
                in: [
                  "spot_procurement_version",
                  "spot_procurement_payment"
                ]
              }
            },
            {
              templateKey: "spot_procurement_receipt_v1",
              businessType: "spot_procurement_receipt"
            }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: 80
      }
    );
    expect(prisma.spotProcurementPaymentExecution.findMany).toHaveBeenCalledWith(
      {
        where: { voidedAt: null },
        orderBy: { createdAt: "desc" },
        take: 80
      }
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "零星材料付款凭证",
        businessRef: "LXFK-001",
        project: "可见项目",
        fileId: "file-spot-payment-voucher",
        confirmedBy: "财务甲"
      }),
      expect.objectContaining({
        documentType: "零星材料付款审批单",
        businessRef: "LXFK-001",
        project: "可见项目",
        fileId: "file-spot-payment-pdf",
        archiveStatus: "审批已完成（后续已作废）"
      }),
      expect.objectContaining({
        documentType: "零星采购申请审批单",
        businessRef: "LXCG-001",
        project: "可见项目",
        fileId: "file-spot-version-pdf",
        archiveStatus: "审批已完成（后续已失效）"
      })
    ]);
    expect(result.rows.every((row) => row.canDownload)).toBe(true);
    expect(result.rows.map((row) => row.fileId)).not.toEqual(
      expect.arrayContaining(["file-spot-version-pending", "file-spot-payment-pending"])
    );
  });

  it("lists only the current formally reviewed receipt PDF and hides returned or revoked receipt pointers", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
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
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([])
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
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pdf-receipt-reviewed",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-reviewed",
            fileId: "file-receipt-reviewed",
            templateKey: "spot_procurement_receipt_v1",
            createdAt: new Date(
              "2026-07-17T10:00:00.000Z"
            )
          },
          {
            id: "pdf-receipt-revoked",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-revoked",
            fileId: "file-receipt-revoked",
            templateKey: "spot_procurement_receipt_v1",
            createdAt: new Date(
              "2026-07-17T09:00:00.000Z"
            )
          }
        ])
      },
      spotProcurementReceipt: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "receipt-reviewed",
            projectId: "project-visible",
            procurementId: "procurement-reviewed",
            status: "reviewed",
            currentRevisionNo: 1
          },
          {
            id: "receipt-revoked",
            projectId: "project-visible",
            procurementId: "procurement-revoked",
            status: "review_revoked",
            currentRevisionNo: 2
          }
        ])
      },
      spotProcurementReceiptReview: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "review-approved",
            receiptId: "receipt-reviewed",
            receiptRevisionNo: 1,
            decision: "approved"
          },
          {
            id: "review-revoked",
            receiptId: "receipt-revoked",
            receiptRevisionNo: 1,
            decision: "revoked"
          }
        ])
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessId: "receipt-reviewed",
            metadata: {
              pdfDocumentId: "pdf-receipt-reviewed",
              newFileId: "file-receipt-reviewed",
              templateKey: "spot_procurement_receipt_v1",
              sourceSnapshotToken: {
                receiptId: "receipt-reviewed",
                receiptStatus: "reviewed",
                currentRevisionNo: 1,
                sourceRevisionNo: 1,
                reviewId: "review-approved",
                latestReviewId: "review-approved"
              }
            }
          }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "procurement-reviewed",
            projectId: "project-visible",
            code: "LXCG-RECEIPT-001",
            supplierNameSnapshot: "甲材料店"
          },
          {
            id: "procurement-revoked",
            projectId: "project-visible",
            code: "LXCG-RECEIPT-002",
            supplierNameSnapshot: "乙材料店"
          }
        ])
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-receipt-reviewed",
            originalName: "项目零星材料收货确认单.pdf",
            sizeBytes: 8192
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "project-visible",
            name: "可见项目"
          }
        ])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, [
      "project-visible"
    ]);

    expect(
      prisma.spotProcurementReceipt.findMany
    ).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["receipt-reviewed", "receipt-revoked"]
        },
        projectId: { in: ["project-visible"] }
      },
      select: {
        id: true,
        projectId: true,
        procurementId: true,
        status: true,
        currentRevisionNo: true
      }
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "项目零星材料收货确认单",
        businessRef: "LXCG-RECEIPT-001",
        project: "可见项目",
        fileId: "file-receipt-reviewed",
        archiveStatus: "收货复核已通过",
        canDownload: true
      })
    ]);
    expect(result.rows.map((row) => row.fileId)).not.toContain(
      "file-receipt-revoked"
    );
  });

  it("archives only allocated active invoices and confirmed invoice evidence in visible projects", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
      contractArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      archiveRecord: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      invoiceRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "invoice-active",
            projectId: "project-visible",
            fileId: "file-invoice-active",
            sourceProcurementId: "procurement-1",
            uploadedByUserId: "finance-uploader",
            createdAt: new Date("2026-07-17T10:00:00.000Z")
          },
          {
            id: "invoice-without-allocation",
            projectId: "project-visible",
            fileId: "file-invoice-without-allocation",
            sourceProcurementId: "procurement-1",
            uploadedByUserId: "finance-uploader",
            createdAt: new Date("2026-07-17T13:00:00.000Z")
          }
        ])
      },
      invoiceLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "invoice-line-active",
            projectId: "project-visible",
            invoiceRecordId: "invoice-active"
          },
          {
            id: "invoice-line-without-allocation",
            projectId: "project-visible",
            invoiceRecordId: "invoice-without-allocation"
          }
        ])
      },
      invoiceAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            invoiceLineId: "invoice-line-active",
            projectId: "project-visible",
            procurementId: "procurement-1"
          }
        ])
      },
      noInvoiceConfirmation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "no-invoice-confirmed",
            projectId: "project-visible",
            procurementId: "procurement-1",
            proofFileId: "file-no-invoice",
            submittedByUserId: "handler-1",
            reviewedByUserId: "finance-director",
            reviewedAt: new Date("2026-07-17T11:00:00.000Z"),
            createdAt: new Date("2026-07-17T10:30:00.000Z")
          }
        ])
      },
      invoiceExceptionConfirmation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "invoice-exception-confirmed",
            projectId: "project-visible",
            procurementId: "procurement-1",
            proofFileId: "file-invoice-exception",
            submittedByUserId: "handler-1",
            reviewedByUserId: "finance-director",
            reviewedAt: new Date("2026-07-17T12:00:00.000Z"),
            createdAt: new Date("2026-07-17T11:30:00.000Z")
          }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "procurement-1",
            projectId: "project-visible",
            code: "LXCG-001",
            supplierNameSnapshot: "甲材料店"
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-invoice-active",
            originalName: "增值税发票.pdf",
            sizeBytes: 1024
          },
          {
            id: "file-no-invoice",
            originalName: "无票替代证明.jpg",
            sizeBytes: 2048
          },
          {
            id: "file-invoice-exception",
            originalName: "票据异常证明.pdf",
            sizeBytes: 4096
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-uploader", name: "财务甲" },
          { id: "finance-director", name: "财务主管" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-visible", name: "可见项目" }
        ])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, ["project-visible"]);

    expect(prisma.invoiceRecord.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        sourceBusinessType: "spot_procurement",
        sourceProcurementId: { not: null },
        projectId: { in: ["project-visible"] }
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        projectId: true,
        fileId: true,
        sourceProcurementId: true,
        uploadedByUserId: true,
        createdAt: true
      }
    });
    expect(prisma.invoiceAllocation.findMany).toHaveBeenCalledWith({
      where: {
        invoiceLineId: {
          in: ["invoice-line-active", "invoice-line-without-allocation"]
        },
        invalidatedAt: null,
        projectId: { in: ["project-visible"] }
      },
      select: {
        invoiceLineId: true,
        projectId: true,
        procurementId: true
      }
    });
    expect(prisma.noInvoiceConfirmation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "confirmed",
          projectId: { in: ["project-visible"] }
        }
      })
    );
    expect(
      prisma.invoiceExceptionConfirmation.findMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "confirmed",
          projectId: { in: ["project-visible"] }
        }
      })
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "零星采购票据异常证明",
        businessRef: "LXCG-001",
        fileId: "file-invoice-exception",
        archiveStatus: "票据异常已确认",
        confirmedBy: "财务主管"
      }),
      expect.objectContaining({
        documentType: "零星采购无票替代证明",
        businessRef: "LXCG-001",
        fileId: "file-no-invoice",
        archiveStatus: "无票已确认",
        confirmedBy: "财务主管"
      }),
      expect.objectContaining({
        documentType: "零星采购发票",
        businessRef: "LXCG-001",
        fileId: "file-invoice-active",
        archiveStatus: "有效发票",
        confirmedBy: "财务甲"
      })
    ]);
    expect(result.rows.map((row) => row.fileId)).not.toContain(
      "file-invoice-without-allocation"
    );
  });

  it("lists a lightweight active payment invoice as a spot-payment archive fact", async () => {
    const prisma = {
      ...emptySpotArchivePrisma(),
      contractArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      archiveRecord: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPaymentInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-invoice-1",
            paymentId: "spot-payment-1",
            fileId: "file-payment-invoice-1",
            uploadedByUserId: "handler-1",
            createdAt: new Date("2026-07-18T04:00:00.000Z")
          }
        ])
      },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-payment-1",
            projectId: "project-visible",
            procurementId: "spot-procurement-1",
            code: "LXFK-2026-001",
            status: "approved_pending_payment"
          }
        ])
      },
      spotProcurement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "spot-procurement-1",
            projectId: "project-visible",
            code: "LXCG-2026-001",
            supplierNameSnapshot: null
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-payment-invoice-1",
            originalName: "商家发票.pdf",
            sizeBytes: 1024
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "handler-1", name: "采购经办人" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-visible", name: "试点项目" }
        ])
      }
    };
    const service = new ArchiveService(prisma as never);

    const result = await service.listRecent(20, ["project-visible"]);

    expect(prisma.spotProcurementPaymentInvoice.findMany).toHaveBeenCalledWith({
      where: { status: "active" },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        paymentId: true,
        fileId: true,
        uploadedByUserId: true,
        createdAt: true
      }
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        documentType: "零星材料付款发票",
        businessRef: "LXFK-2026-001",
        fileId: "file-payment-invoice-1",
        archiveStatus: "已上传",
        confirmedBy: "采购经办人"
      })
    ]);
  });
});
