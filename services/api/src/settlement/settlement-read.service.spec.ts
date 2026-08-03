import { Decimal } from "@prisma/client/runtime/library";
import * as ExcelJS from "exceljs";
import { SettlementReadService } from "./settlement-read.service";

describe("SettlementReadService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-08T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("exports only the visible settlement ledger rows and records the export audit", async () => {
    jest.useRealTimers();
    const prisma = {};
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new SettlementReadService(
      prisma as never,
      undefined,
      audit as never
    );
    jest.spyOn(service, "listRecent").mockResolvedValue({
      rows: [
        {
          id: "JS-2026-031",
          settlementNo: "JS-2026-031",
          contractNo: "HT-2026-009",
          project: "总部综合楼",
          period: "2026-06",
          amount: "¥580,000.00",
          paymentTermsVersion: "v2",
          currentNode: "待归档确认",
          nodeTone: "primary",
          ownerDepartment: "合同部",
          pendingOwner: "合同部",
          stalledFor: "1 天",
          returnReason: "-",
          nextAction: "确认归档",
          updatedAt: "2026/7/8 08:00:00"
        }
      ],
      summary: {
        total: 1,
        inApproval: 0,
        pendingArchive: 1,
        effective: 0,
        payable: 0
      }
    });

    const result = await service.exportLedger(["project-1"], "finance-user");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(service.listRecent).toHaveBeenCalledWith(undefined, ["project-1"], {
      unbounded: true
    });
    expect(result.fileName).toMatch(/^结算台账-\d{8}\.xlsx$/);
    expect(workbook.getWorksheet("结算台账")?.getRow(2).getCell(1).value).toBe(
      "JS-2026-031"
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        actorUserId: "finance-user",
        action: "settlement.ledger.export",
        businessType: "settlement_ledger"
      })
    );
  });

  it("fails closed when the settlement ledger export audit service is unavailable", async () => {
    jest.useRealTimers();
    const service = new SettlementReadService({} as never);
    jest.spyOn(service, "listRecent").mockResolvedValue({
      rows: [],
      summary: {
        total: 0,
        inApproval: 0,
        pendingArchive: 0,
        effective: 0,
        payable: 0
      }
    });

    await expect(service.exportLedger(["project-1"], "finance-user")).rejects.toThrow(
      "结算台账导出审计服务暂不可用"
    );
  });

  it("does not expose settlement PDF generation to read-only ledger users", () => {
    const service = new SettlementReadService({} as never) as unknown as {
      settlementActions(
        status: string,
        roleKeys: string[],
        approvalReviewAccess: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        archiveFiles: []
      ): Array<{ key: string; enabled: boolean }>;
    };

    const actions = service.settlementActions(
      "effective",
      ["finance_staff"],
      { canAct: false, canReview: false, requiresSelfReviewConfirmation: false },
      []
    );

    expect(actions.find((action) => action.key === "generate_pdf_archive")?.enabled).toBe(false);
  });

  it("shows governed counterparty and final evidence without reading legacy archive rows", async () => {
    const prisma = {
      settlementDraft: {
        findFirst: jest.fn().mockResolvedValue({ id: "draft-1" })
      },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "original-1",
            purpose: "counterparty_signed_original",
            fileId: "file-original",
            status: "active",
            generationStatus: "not_applicable",
            uploadedByUserId: "staff-1",
            generatedByUserId: null,
            confirmedByUserId: null,
            confirmedAt: null,
            createdAt: new Date("2026-07-17T01:00:00.000Z")
          },
          {
            id: "final-1",
            purpose: "final_internal_signed_copy",
            fileId: "file-final",
            status: "active",
            generationStatus: "completed",
            uploadedByUserId: null,
            generatedByUserId: "system-user",
            confirmedByUserId: null,
            confirmedAt: null,
            createdAt: new Date("2026-07-17T02:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: { findMany: jest.fn() },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-original",
            originalName: "乙方签章原件.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageStatus: "active"
          },
          {
            id: "file-final",
            originalName: "我方签名合成件.pdf",
            mimeType: "application/pdf",
            sizeBytes: 120,
            storageStatus: "active"
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "staff-1", name: "合同员" },
          { id: "system-user", name: "系统任务" }
        ])
      }
    };
    const service = new SettlementReadService(prisma as never) as unknown as {
      settlementArchiveFilesForSettlement(settlement: {
        id: string;
        governanceVersion: number;
      }): Promise<Array<{
        purposeKey?: string;
        generationStatus?: string;
        canDownload: boolean;
        downloadability?: string;
      }>>;
    };

    const files = await service.settlementArchiveFilesForSettlement({
      id: "settlement-1",
      governanceVersion: 1
    });

    expect(files).toEqual([
      expect.objectContaining({
        purposeKey: "counterparty_signed_original",
        generationStatus: "not_applicable",
        canDownload: true,
        downloadability: "available"
      }),
      expect.objectContaining({
        purposeKey: "final_internal_signed_copy",
        generationStatus: "completed",
        canDownload: true,
        downloadability: "available"
      })
    ]);
    expect(prisma.settlementArchiveFile.findMany).not.toHaveBeenCalled();
  });

  it("does not advertise a governed evidence file when storage is inactive", async () => {
    const prisma = {
      settlementDraft: { findFirst: jest.fn().mockResolvedValue(null) },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "final-1",
            purpose: "final_internal_signed_copy",
            fileId: "file-final",
            status: "active",
            generationStatus: "completed",
            uploadedByUserId: null,
            generatedByUserId: null,
            confirmedByUserId: null,
            confirmedAt: null,
            createdAt: new Date()
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-final",
            originalName: "final.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageStatus: "deleted"
          }
        ])
      }
    };
    const service = new SettlementReadService(prisma as never) as unknown as {
      settlementArchiveFilesForSettlement(settlement: {
        id: string;
        governanceVersion: number;
      }): Promise<Array<{ canDownload: boolean; downloadability?: string }>>;
    };

    await expect(
      service.settlementArchiveFilesForSettlement({
        id: "settlement-1",
        governanceVersion: 1
      })
    ).resolves.toEqual([
      expect.objectContaining({ canDownload: false, downloadability: "unavailable" })
    ]);
  });

  it("gives only the contract director a retry action after governed generation fails", () => {
    const service = new SettlementReadService({} as never) as unknown as {
      settlementActions(
        status: string,
        roleKeys: string[],
        access: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        files: [],
        governanceVersion: number,
        generationFailed: boolean
      ): Array<{ key: string; enabled: boolean }>;
      statusView(status: string, generationFailed?: boolean): { label: string };
      nextActionLabel(status: string, generationFailed?: boolean): string;
    };
    const noApprovalAccess = {
      canAct: false,
      canReview: false,
      requiresSelfReviewConfirmation: false
    };

    const directorActions = service.settlementActions(
      "pending_generation",
      ["contract_director"],
      noApprovalAccess,
      [],
      1,
      true
    );
    const staffActions = service.settlementActions(
      "pending_generation",
      ["contract_staff"],
      noApprovalAccess,
      [],
      1,
      true
    );
    const processingActions = service.settlementActions(
      "pending_generation",
      ["contract_director"],
      noApprovalAccess,
      [],
      1,
      false
    );

    expect(directorActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "retry_signed_document_generation", enabled: true })
      ])
    );
    expect(staffActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "retry_signed_document_generation", enabled: false })
      ])
    );
    expect(processingActions.map((action) => action.key)).not.toContain(
      "retry_signed_document_generation"
    );
    expect(directorActions.map((action) => action.key)).not.toContain("generate_pdf_archive");
    expect(service.statusView("pending_generation", true).label).toBe(
      "最终结算文件生成失败"
    );
    expect(service.nextActionLabel("pending_generation", true)).toContain(
      "审批结果不受影响"
    );
  });

  it("offers generation recovery only for interrupted or stale claims", () => {
    const service = new SettlementReadService({} as never) as unknown as {
      signedDocumentGenerationNeedsRetry(claim: unknown): boolean;
    };
    const now = Date.now();

    expect(service.signedDocumentGenerationNeedsRetry(null)).toBe(true);
    expect(service.signedDocumentGenerationNeedsRetry({
      status: "failed", claimedAt: new Date(now), uploadedFileId: null,
      safeFailureCode: "activation_failed"
    })).toBe(true);
    expect(service.signedDocumentGenerationNeedsRetry({
      status: "uploaded", claimedAt: new Date(now), uploadedFileId: "file-1",
      safeFailureCode: null
    })).toBe(true);
    expect(service.signedDocumentGenerationNeedsRetry({
      status: "pending", claimedAt: new Date(now - 6 * 60 * 1000),
      uploadedFileId: null, safeFailureCode: null
    })).toBe(true);
    expect(service.signedDocumentGenerationNeedsRetry({
      status: "pending", claimedAt: new Date(now), uploadedFileId: null,
      safeFailureCode: null
    })).toBe(false);
  });

  it("builds settlement ledger rows and summary from persisted settlements", async () => {
    const prisma = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            paymentTermsVersionId: "terms-version-2",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "archive_pending",
            amountCents: 58000000n,
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          },
          {
            id: "settlement-2",
            projectId: "project-1",
            contractId: "contract-1",
            paymentTermsVersionId: "terms-version-2",
            code: "JS-2026-032",
            periodLabel: "2026-07",
            status: "effective",
            amountCents: 62000000n,
            updatedAt: new Date("2026-07-01T10:00:00.000Z")
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-2026-009",
            temporaryCode: null
          }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-2",
            versionNo: 2
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
      }
    };
    const service = new SettlementReadService(prisma as never);

    const ledger = await service.listRecent();

    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      take: 100,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "JS-2026-031",
      settlementNo: "JS-2026-031",
      contractNo: "HT-2026-009",
      project: "总部综合楼",
      period: "2026-06",
      amount: "¥580,000.00",
      paymentTermsVersion: "v2",
      currentNode: "主管确认归档",
      nodeTone: "primary",
      ownerDepartment: "合同部主管",
      pendingOwner: "合同部主管",
      stalledFor: "7天",
      returnReason: "-",
      nextAction: "主管确认归档"
    });
    expect(ledger.summary).toEqual({
      total: 2,
      inApproval: 0,
      pendingArchive: 1,
      effective: 1,
      payable: 1
    });
  });

  it("filters settlement ledger by visible projects", async () => {
    const prisma = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findMany: jest.fn()
      },
      paymentTermsVersion: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn()
      }
    };
    const service = new SettlementReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("does not expose internal settlement status values in read model labels", () => {
    const service = new SettlementReadService({} as never);
    const statusView = (service as unknown as { statusView(status: string): { label: string } })
      .statusView;

    expect(statusView.call(service, "internal_status").label).toBe("结算状态未读取");
  });

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
          sourceType: "historical_takeover",
          amountCents: 58000000n,
          payableAmountCents: 46400000n,
          invoiceTypeSnapshot: "vat_special",
          taxFactRevisionSnapshot: 3,
          updatedAt: new Date("2026-07-01T08:00:00.000Z")
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
          versionNo: 2,
          invoiceType: "vat_general",
          taxMode: "single_rate",
          defaultTaxRatePercent: new Decimal("9"),
          taxFactRevision: 4
        })
      },
      contractTaxFactRevision: {
        findFirst: jest.fn().mockResolvedValue({
          revisionNo: 3,
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: new Decimal("13")
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
            requiresInvoice: true,
            triggerEvent: "结算归档确认生效"
          }
        ])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          code: "FK-2026-011",
          status: "approved_pending_payment"
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            status: "approved_pending_payment",
            requestedAmountCents: 20000000n,
            paidAmountCents: 5000000n
          },
          {
            id: "payment-void",
            status: "rejected",
            requestedAmountCents: 1000000n,
            paidAmountCents: 0n
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 5000000n }])
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "line-1",
            sourceType: "contract_bill_row",
            name: "钢筋材料",
            unit: "吨",
            quantity: { toString: () => "1.230000" },
            unitPriceCents: null,
            unitPriceSnapshot: new Decimal("4.56"),
            taxRatePercentSnapshot: new Decimal("13"),
            pricingModeSnapshot: "tax_inclusive",
            calculationMode: "normal_auto",
            amountCents: 561n,
            taxExclusiveAmountCents: 496n,
            taxAmountCents: 65n,
            reason: null,
            overageReason: "现场实际工程量超出预计清单",
            remark: "本期完成量"
          },
          {
            id: "line-2",
            sourceType: "manual_adjustment",
            name: "现场扣款",
            unit: null,
            quantity: null,
            unitPriceCents: null,
            unitPriceSnapshot: null,
            taxRatePercentSnapshot: null,
            pricingModeSnapshot: null,
            calculationMode: "manual_adjustment",
            amountCents: -200000n,
            taxExclusiveAmountCents: null,
            taxAmountCents: null,
            reason: "项目确认扣款",
            remark: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "user-upload",
            confirmedByUserId: "user-confirm",
            confirmedAt: new Date("2026-07-01T10:00:00.000Z"),
            status: "confirmed",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-settlement-1",
            originalName: "JS-2026-031-签章结算单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-upload", name: "合同员" },
          { id: "user-confirm", name: "合同主管" }
        ])
      },
      contractTakeoverBalanceEntry: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: "deduction-1", amountCents: 10_000_000n }
          ])
          .mockResolvedValueOnce([])
      }
    };
    const service = new SettlementReadService(prisma as never);

    const detail = await service.getDetail("JS-2026-031");

    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }] }
    });
    expect(detail.id).toBe("JS-2026-031");
    expect(detail.settlementId).toBe("settlement-1");
    expect(detail.title).toBe("JS-2026-031 · 2026-06结算单");
    expect(detail.baseInfo).toContainEqual({ label: "关联合同", value: "HT-2026-009 · 幕墙分包合同" });
    expect(detail.baseInfo).toContainEqual({ label: "结算性质", value: "历史接管期初结算" });
    expect(detail.baseInfo).toContainEqual({ label: "结算金额", value: "¥580,000.00" });
    expect(detail.taxFactSummary).toEqual([
      { label: "发票类型", value: "增值税专用发票" },
      { label: "税率模式", value: "单一税率" },
      { label: "默认税率", value: "13%" },
      { label: "税务事实修订号", value: "3" }
    ]);
    expect(detail.paymentRules[0]).toMatchObject({
      id: "stage-progress",
      stage: "进度款",
      ratio: "85%",
      accountPeriod: "20天",
      invoiceRequirement: "需提供发票",
      triggerCondition: "结算归档确认生效",
      paymentRequestStatus: "approved_pending_payment"
    });
    expect(detail.payableCalculation.items).toEqual([
      { label: "本期结算金额", value: "¥580,000.00" },
      { label: "本期期初应付", value: "¥564,000.00" },
      {
        label: "历史预付款抵扣",
        value: "¥100,000.00",
        tone: "warning"
      },
      {
        label: "抵扣后可申请金额",
        value: "¥464,000.00",
        tone: "success"
      },
      { label: "已申请付款", value: "¥200,000.00", tone: "warning" },
      { label: "已实付金额", value: "¥50,000.00" },
      { label: "剩余可申请", value: "¥264,000.00", tone: "primary" }
    ]);
    expect(detail.settlementLines).toEqual([
      {
        id: "line-1",
        sourceType: "contract_bill_row",
        sourceLabel: "合同清单项",
        name: "钢筋材料",
        unit: "吨",
        quantity: "1.23",
        unitPrice: "¥4.56（含税）",
        taxInclusiveUnitPrice: "¥4.56",
        taxExclusiveUnitPrice: "¥4.04",
        taxRate: "13%",
        calculationMode: "normal_auto",
        amount: "¥5.61",
        amountCents: "561",
        taxInclusiveAmount: "¥5.61",
        taxExclusiveAmount: "¥4.96",
        taxAmount: "¥0.65",
        taxBreakdownNote: "-",
        reason: "-",
        overageReason: "现场实际工程量超出预计清单",
        remark: "本期完成量"
      },
      {
        id: "line-2",
        sourceType: "manual_adjustment",
        sourceLabel: "手工调整项",
        name: "现场扣款",
        unit: "-",
        quantity: "-",
        unitPrice: "-",
        taxInclusiveUnitPrice: "-",
        taxExclusiveUnitPrice: "-",
        taxRate: "-",
        calculationMode: "manual_adjustment",
        amount: "¥-2,000.00",
        amountCents: "-200000",
        taxInclusiveAmount: "¥-2,000.00",
        taxExclusiveAmount: "-",
        taxAmount: "-",
        taxBreakdownNote: "人工调整，不适用合同单价税额拆分",
        reason: "项目确认扣款",
        overageReason: "-",
        remark: "-"
      }
    ]);
    expect(detail.archiveFiles).toEqual([
      {
        recordId: "settlement-archive-1",
        fileId: "file-settlement-1",
        fileName: "JS-2026-031-签章结算单.pdf",
        purpose: "结算签章归档件",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        status: "confirmed",
        statusLabel: "已确认",
        uploadedByName: "合同员",
        uploadedAt: "2026-07-01T09:00:00.000Z",
        confirmedByName: "合同主管",
        confirmedAt: "2026-07-01T10:00:00.000Z",
        canDownload: true,
        disabledReason: null
      }
    ]);
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts/HT-2026-009",
      "/payments/FK-2026-011",
      "/archives",
      "/audit"
    ]);
  });

  it("keeps pending settlement archive files unavailable for download", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "archive_pending",
          amountCents: 58000000n,
          updatedAt: new Date("2026-07-01T08:00:00.000Z")
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
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "user-upload",
            confirmedByUserId: null,
            confirmedAt: null,
            status: "pending_confirm",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-settlement-1",
            originalName: "JS-2026-031-签章结算单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-upload", name: "合同员" }])
      }
    };
    const service = new SettlementReadService(prisma as never);

    const detail = await service.getDetail("JS-2026-031");

    expect(detail.archiveFiles).toContainEqual(
      expect.objectContaining({
        fileId: "file-settlement-1",
        status: "pending_confirm",
        statusLabel: "待确认",
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      })
    );
  });

  it("does not expose internal user accounts when settlement archive operator names are unavailable", async () => {
    const prisma = {
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-archive-1",
            fileId: "file-settlement-1",
            uploadedByUserId: "upload-internal-id",
            confirmedByUserId: "confirm-internal-id",
            confirmedAt: new Date("2026-07-01T10:00:00.000Z"),
            status: "confirmed",
            createdAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-settlement-1",
            originalName: "签章结算单.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new SettlementReadService(prisma as never);
    const archiveFiles = await (
      service as unknown as {
        settlementArchiveFilesForSettlement(id: string): Promise<
          Array<{ uploadedByName: string; confirmedByName: string | null }>
        >;
      }
    ).settlementArchiveFilesForSettlement("settlement-1");

    expect(archiveFiles[0]).toMatchObject({
      uploadedByName: "上传人未读取",
      confirmedByName: "确认人未读取"
    });
  });

  it("exposes enabled payment and finance recovery actions for effective settlements", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-2",
          paymentTermsVersionId: "terms-version-2",
          code: "JS-2026-031",
          periodLabel: "2026-06",
          status: "effective",
          amountCents: 58000000n,
          updatedAt: new Date("2026-07-01T08:00:00.000Z")
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
        findUnique: jest.fn().mockResolvedValue({ id: "contract-version-2", versionNo: 2 })
      },
      paymentTermsVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "terms-version-2", versionNo: 2 })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["project_manager"])
    };
    const service = new SettlementReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("JS-2026-031", undefined, "user-pm");

    expect(projectVisibility.effectiveRoleKeys).toHaveBeenCalledWith("user-pm", "project-1");
    expect(detail.primaryAction).toBe("create_payment");
    expect(detail.availableActions).toContainEqual({
      key: "create_payment",
      label: "发起付款申请",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredAction: "payment.create"
    });
    expect(detail.availableActionKeys).toContain("create_payment");
    projectVisibility.effectiveRoleKeys.mockResolvedValue(["finance_staff"]);
    const financeDetail = await service.getDetail(
      "JS-2026-031",
      undefined,
      "user-finance"
    );
    expect(financeDetail.availableActionKeys).toEqual(
      expect.arrayContaining(["record_recovery", "reverse_recovery"])
    );
    expect(detail.disabledReasons).toEqual([]);
  });

  it("does not expose settlement detail outside visible projects", async () => {
    const prisma = {
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new SettlementReadService(prisma as never);

    await expect(service.getDetail("JS-2026-031", ["project-1"])).rejects.toThrow(
      "未找到该结算单，请刷新结算台账后重试"
    );
    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "JS-2026-031" }, { code: "JS-2026-031" }],
        projectId: { in: ["project-1"] }
      }
    });
  });

  it("uses Chinese business errors when settlement detail related records are missing", async () => {
    function prismaWithMissingRelated(overrides: {
      contract?: unknown;
      contractVersion?: unknown;
      terms?: unknown;
    }) {
      return {
        settlement: {
          findFirst: jest.fn().mockResolvedValue({
            id: "settlement-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            code: "JS-2026-031",
            periodLabel: "2026-06",
            status: "effective",
            sourceType: "settlement",
            amountCents: 1000000n,
            payableAmountCents: 800000n
          })
        },
        contract: {
          findUnique: jest
            .fn()
            .mockResolvedValue("contract" in overrides ? overrides.contract : { id: "contract-1" })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue(
            "contractVersion" in overrides
              ? overrides.contractVersion
              : { id: "contract-version-1" }
          )
        },
        paymentTermsVersion: {
          findUnique: jest
            .fn()
            .mockResolvedValue("terms" in overrides ? overrides.terms : { id: "terms-version-1" })
        },
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentExecution: {
          findMany: jest.fn().mockResolvedValue([])
        }
      };
    }

    await expect(
      new SettlementReadService(
        prismaWithMissingRelated({ contract: null }) as never
      ).getDetail("JS-2026-031")
    ).rejects.toThrow("未找到结算关联合同，请刷新结算台账后重试");

    await expect(
      new SettlementReadService(
        prismaWithMissingRelated({ contractVersion: null }) as never
      ).getDetail("JS-2026-031")
    ).rejects.toThrow("未找到结算关联合同版本，请刷新结算台账后重试");

    await expect(
      new SettlementReadService(prismaWithMissingRelated({ terms: null }) as never).getDetail(
        "JS-2026-031"
      )
    ).rejects.toThrow("未找到结算绑定的付款条款版本，请刷新结算台账后重试");
  });

  it("结算普通节点不因申请人兼任领导而标记自审确认", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "leader-1",
          frozenNodes: [{ roleKeys: ["budget_director"] }],
          currentNodeIndex: 0
        })
      }
    };
    const service = new SettlementReadService(prisma as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<unknown>;
      settlementActions(
        status: string,
        roleKeys: never[],
        access: unknown,
        archiveFiles: never[]
      ): Array<Record<string, unknown>>;
    };

    const access = await service.canReviewCurrentApproval(
      "settlement",
      "settlement-1",
      "project-1",
      ["chairman", "budget_director"],
      "leader-1"
    );
    expect(access).toEqual({
      canAct: true,
      canReview: false,
      requiresSelfReviewConfirmation: false
    });
    expect(
      service.settlementActions(
        "approval_pending",
        ["chairman", "budget_director"] as never[],
        access,
        []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_approval",
          enabled: false,
          disabledReason: "申请人不能审批自己发起的业务",
          requiresSelfReviewConfirmation: false
        }),
        expect.objectContaining({ key: "transfer_approval", enabled: true }),
        expect.objectContaining({ key: "delegate_approval", enabled: true })
      ])
    );
  });

  it("does not borrow current contract tax facts for a legacy settlement without snapshots", async () => {
    const service = new SettlementReadService({} as never) as unknown as {
      taxFactSummary(
        settlement: {
          contractVersionId: string;
          invoiceTypeSnapshot: string | null;
          taxFactRevisionSnapshot: number | null;
        },
        contractVersion: {
          invoiceType: string | null;
          taxMode: string | null;
          defaultTaxRatePercent: Decimal | null;
          taxFactRevision: number;
        },
        lines: []
      ): Promise<Array<{ label: string; value: string }>>;
    };

    await expect(
      service.taxFactSummary(
        {
          contractVersionId: "contract-version-1",
          invoiceTypeSnapshot: null,
          taxFactRevisionSnapshot: null
        },
        {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: new Decimal("13"),
          taxFactRevision: 4
        },
        []
      )
    ).resolves.toEqual([
      { label: "发票类型", value: "—" },
      { label: "税率模式", value: "—" },
      { label: "默认税率", value: "—" },
      { label: "税务事实修订号", value: "历史结算未保存" }
    ]);
  });

  it.each([
    ["双端启用", true, true],
    ["委托人停用", false, false],
    ["受托人缺失", false, true]
  ] as const)("standing delegation 在%s时 canReview=%s", async (label, expected, delegatorActive) => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{ roleKeys: ["budget_director"] }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegator-1", isActive: delegatorActive },
          ...(label === "受托人缺失" ? [] : [{ id: "delegatee-1", isActive: true }])
        ])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockImplementation((userId: string) =>
        userId === "delegator-1" ? ["budget_director"] : []
      )
    };
    const service = new SettlementReadService(prisma as never, projectVisibility as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "settlement",
      "settlement-1",
      "project-1",
      [],
      "delegatee-1"
    );

    expect(access.canReview).toBe(expected);
  });

  it.each([
    ["冻结候选调岗后", "finance-director-1", [], true],
    ["同岗位非冻结候选", "finance-director-2", ["finance_director"], false]
  ] as const)("受治理结算节点%s保持冻结人员口径", async (_label, actorUserId, roleKeys, expected) => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-director-1"] },
            candidateUserIds: ["finance-director-1"]
          }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new SettlementReadService(prisma as never, {
      effectiveRoleKeys: jest.fn().mockResolvedValue([])
    } as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canAct: boolean; canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "settlement",
      "settlement-1",
      "project-1",
      [...roleKeys],
      actorUserId
    );

    expect(access.canAct).toBe(expected);
    expect(access.canReview).toBe(expected);
  });
  it("aggregates formal settlements and owned drafts without project-by-project reads", async () => {
    const now = new Date("2026-07-20T01:00:00.000Z");
    const settlement = (id: string, status: string, preparedByUserId = "u1") => ({
      id, code: `JS-${id}`, contractId: "c1", projectId: "p1", periodLabel: "2026-07",
      status, amountCents: 100n, paymentTermsVersionId: "terms-1", preparedByUserId, updatedAt: now
    });
    const drafts = [
      { id: "d1", code: "JSC-1", contractId: "c1", projectId: "p1", periodLabel: "2026-07", status: "draft", ownerUserId: "u1", revision: 2, updatedAt: now, abandonedAt: null, abandonReason: null },
      { id: "d2", code: "JSC-2", contractId: "c1", projectId: "p1", periodLabel: "2026-06", status: "abandoned", ownerUserId: "u1", revision: 3, updatedAt: now, abandonedAt: now, abandonReason: "不再继续" }
    ];
    const prisma = {
      settlement: { findMany: jest.fn().mockResolvedValue([settlement("1", "effective"), settlement("2", "approval_rejected"), settlement("3", "voided", "u2")]) },
      settlementDraft: { findMany: jest.fn().mockResolvedValue(drafts) },
      contract: { findMany: jest.fn().mockResolvedValue([{ id: "c1", code: "HT-1", temporaryCode: null }]) },
      paymentTermsVersion: { findMany: jest.fn().mockResolvedValue([{ id: "terms-1", versionNo: 1 }]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "项目一" }]) },
      settlementSignedDocument: { findMany: jest.fn().mockResolvedValue([
        { settlementDraftId: "d1", purpose: "counterparty_signed_original", status: "invalidated" },
        { settlementDraftId: "d2", purpose: "counterparty_signed_original", status: "invalidated" }
      ]) },
      contractSettlementProcess: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new SettlementReadService(prisma as never);
    const result = await service.lifecycleLedger("my_drafts", 1, 20, ["p1"], "u1");

    expect(result.summary).toEqual({ formal_ledger: 1, my_drafts: 1, returned_for_revision: 1, ended: 2 });
    expect(result.rows[0]).toEqual(expect.objectContaining({ id: "d1", lifecycleKind: "approval_draft", revision: 2 }));
    expect(prisma.settlementDraft.findMany).toHaveBeenCalledTimes(1);
    const ended = await service.lifecycleLedger("ended", 1, 20, ["p1"], "u1");
    expect(ended.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "d2",
        projectId: "p1",
        lifecycleKind: "approval_draft",
        abandonReason: "不再继续",
        copyAvailable: true
      })
    ]));
    const formal = await service.lifecycleLedger("formal_ledger", 1, 20, ["p1"], "u1");
    expect(formal.rows[0]).toEqual(expect.objectContaining({ projectId: "p1" }));
  });

  it("does not expose a marker-drift draft after an exact formal settlement shadows it", async () => {
    const now = new Date("2026-07-20T01:00:00.000Z");
    const prisma = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "settlement-1",
          code: "JS-2026-031",
          processId: "process-1",
          contractId: "c1",
          contractVersionId: "v1",
          projectId: "p1",
          periodLabel: "2026-07",
          status: "approval_pending",
          amountCents: 100n,
          paymentTermsVersionId: "terms-1",
          preparedByUserId: "u1",
          updatedAt: now
        }])
      },
      settlementDraft: {
        findMany: jest.fn().mockResolvedValue([{
          id: "draft-shadow",
          code: "JS-2026-031",
          processId: "process-1",
          contractId: "c1",
          contractVersionId: "v1",
          projectId: "p1",
          periodLabel: "2026-07",
          status: "draft",
          ownerUserId: "u1",
          revision: 3,
          submittedSettlementId: null,
          submittedAt: null,
          updatedAt: now,
          abandonedAt: null,
          abandonReason: null
        }])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "c1", code: "HT-1", temporaryCode: null }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-1", versionNo: 1 }])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "项目一" }])
      },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([
          { id: "process-1", settlementId: "settlement-1" }
        ])
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new SettlementReadService(prisma as never);

    const result = await service.lifecycleLedger("my_drafts", 1, 20, ["p1"], "u1");

    expect(result.rows).toEqual([]);
    expect(result.summary.my_drafts).toBe(0);

    const workbench = await service.workbenchLedger(
      "my_drafts",
      1,
      20,
      ["p1"],
      "u1"
    );
    expect(workbench.rows).toEqual([]);
    expect(workbench.summary.my_drafts).toBe(0);
  });

  it("projects settlement root workbench views from authoritative pending work and preserves owned drafts", async () => {
    const now = new Date("2026-07-23T01:00:00.000Z");
    const settlement = (
      id: string,
      status: string,
      preparedByUserId: string | null = "u1"
    ) => ({
      id, code: `JS-${id}`, contractId: "c1", projectId: "p1", periodLabel: "2026-07",
      status, amountCents: 100n, paymentTermsVersionId: "terms-1", preparedByUserId, updatedAt: now
    });
    const prisma = {
      settlement: { findMany: jest.fn().mockResolvedValue([
        settlement("effective", "effective"),
        settlement("approval", "approval_pending"),
        settlement("archive", "pending_archive_confirm"),
        settlement("returned", "approval_rejected"),
        settlement("voided", "voided", "other-user")
      ]) },
      settlementDraft: { findMany: jest.fn().mockResolvedValue([
        { id: "draft-1", code: "JSC-1", contractId: "c1", projectId: "p1", periodLabel: "2026-07", status: "draft", ownerUserId: "u1", revision: 1, updatedAt: now, abandonedAt: null, abandonReason: null },
        { id: "draft-2", code: "JSC-2", contractId: "c1", projectId: "p1", periodLabel: "2026-06", status: "abandoned", ownerUserId: "u1", revision: 2, updatedAt: now, abandonedAt: now, abandonReason: "不再继续" }
      ]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "项目一" }]) },
      contract: { findMany: jest.fn().mockResolvedValue([{ id: "c1", code: "HT-1", temporaryCode: null }]) },
      paymentTermsVersion: { findMany: jest.fn().mockResolvedValue([{ id: "terms-1", versionNo: 1 }]) },
      settlementSignedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      contractSettlementProcess: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const me = {
      getSettlementPendingWorkItems: jest.fn().mockResolvedValue([
        { businessType: "settlement", businessId: "archive" }
      ])
    };
    const service = new SettlementReadService(prisma as never, undefined, undefined, me as never);

    const pending = await service.workbenchLedger("pending_action", 1, 20, ["p1"], "u1");
    expect(pending.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementId: "archive", status: "pending_archive_confirm" }),
      expect.objectContaining({ settlementId: "returned", status: "approval_rejected" })
    ]));
    expect(pending.summary).toEqual({
      pending_action: 2, my_drafts: 1, in_approval: 1, pending_archive: 1, effective: 1, all: 7
    });

    const all = await service.workbenchLedger("all", 1, 20, ["p1"], "u1");
    expect(all.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "draft-2", abandonReason: "不再继续", copyAvailable: true }),
      expect.objectContaining({ settlementId: "voided", status: "voided" })
    ]));
    expect(me.getSettlementPendingWorkItems).toHaveBeenCalledWith("u1");
  });
});
