import * as ExcelJS from "exceljs";
import { ContractReadService } from "./contract-read.service";

describe("ContractReadService", () => {
  it("exposes separate governed final-file confirmation and correction actions", () => {
    const service = new ContractReadService({} as never);
    const actions = (service as unknown as {
      contractActions(
        status: string,
        roleKeys: string[],
        approvalReviewAccess: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        archiveFiles: [],
        context: Record<string, unknown>
      ): Array<{ key: string; enabled: boolean }>;
    }).contractActions(
      "pending_archive_confirm",
      ["contract_director"],
      { canAct: false, canReview: false, requiresSelfReviewConfirmation: false },
      [],
      {
        actorUserId: "director-1",
        ownerUserId: "handler-1",
        governed: true,
        sealTask: { handlerUserId: "handler-1" },
        activeFinal: { uploadedByUserId: "handler-1" },
        approvalFormAvailable: true,
        approvalParticipant: false,
        canUploadGovernedFinal: false
      }
    );

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "return_final_contract", enabled: true }),
      expect.objectContaining({ key: "confirm_final_contract", enabled: true })
    ]));
  });

  it("does not expose PDF archive generation before a governed contract is effective", () => {
    const service = new ContractReadService({} as never) as unknown as {
      contractActions(
        status: string,
        roleKeys: string[],
        approvalReviewAccess: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        archiveFiles: [],
        context: Record<string, unknown>
      ): Array<{ key: string }>;
    };
    const approvalAccess = { canAct: false, canReview: false, requiresSelfReviewConfirmation: false };
    const governedContext = {
      actorUserId: "handler-1",
      ownerUserId: "handler-1",
      contractTypeKey: "material_purchase",
      governed: true,
      sealTask: { handlerUserId: "handler-1" },
      activeFinal: null,
      approvalFormAvailable: false,
      approvalParticipant: false,
      canUploadGovernedFinal: false
    };

    expect(service.contractActions("in_seal", ["contract_staff"], approvalAccess, [], governedContext))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "generate_pdf_archive" })]));
    expect(service.contractActions("effective", ["contract_staff"], approvalAccess, [], governedContext))
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: "generate_pdf_archive" })]));
    expect(service.contractActions("in_seal", ["contract_staff"], approvalAccess, [], {
      ...governedContext,
      governed: false
    })).toEqual(expect.arrayContaining([expect.objectContaining({ key: "generate_pdf_archive" })]));
  });
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-08T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not expose internal status values in contract detail labels", () => {
    const service = new ContractReadService({} as never) as unknown as {
      statusView(status: string): { label: string };
      takeoverStatusLabel(status: string): string;
      termsStatusLabel(status: string): string;
      settlementApprovalStatusLabel(status: string): string;
      settlementArchiveFileStatusLabel(archiveFile: {
        status: string;
        confirmedAt: Date | null;
      }): string;
      paymentApprovalStatusLabel(status: string): string;
    };

    expect(service.statusView("internal_contract_status").label).toBe("合同状态未读取");
    expect(service.takeoverStatusLabel("internal_takeover_status")).toBe("接管状态未读取");
    expect(service.termsStatusLabel("internal_terms_status")).toBe("付款条款状态未读取");
    expect(service.settlementApprovalStatusLabel("internal_settlement_status")).toBe(
      "结算审批状态未读取"
    );
    expect(
      service.settlementArchiveFileStatusLabel({
        status: "internal_archive_status",
        confirmedAt: null
      })
    ).toBe("结算归档状态未读取");
    expect(service.paymentApprovalStatusLabel("internal_payment_status")).toBe(
      "付款审批状态未读取"
    );
  });

  it("exports only the visible contract ledger rows and records the export audit", async () => {
    jest.useRealTimers();
    const prisma = {};
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractReadService(
      prisma as never,
      undefined,
      audit as never
    );
    jest.spyOn(service, "listRecent").mockResolvedValue({
      rows: [
        {
          id: "HT-2026-009",
          contractNo: "HT-2026-009",
          name: "幕墙分包合同",
          project: "总部综合楼",
          counterparty: "幕墙分包单位",
          amount: "¥986,500.00",
          version: "v2",
          currentNode: "可发起结算",
          nodeTone: "success",
          ownerDepartment: "合同部",
          pendingOwner: "合同部",
          stalledFor: "1 天",
          returnReason: "-",
          nextAction: "可发起结算",
          updatedAt: "2026/7/8 08:00:00",
          paymentTermsVersion: "v2"
        }
      ],
      summary: {
        total: 1,
        inApproval: 0,
        pendingSeal: 0,
        pendingArchive: 0,
        effective: 1
      }
    });

    const result = await service.exportLedger(["project-1"], "finance-user");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(service.listRecent).toHaveBeenCalledWith(undefined, ["project-1"], {
      unbounded: true
    });
    expect(result.fileName).toMatch(/^合同台账-\d{8}\.xlsx$/);
    expect(workbook.getWorksheet("合同台账")?.getRow(2).getCell(1).value).toBe(
      "HT-2026-009"
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        actorUserId: "finance-user",
        action: "contract.ledger.export",
        businessType: "contract_ledger"
      })
    );
  });

  it("fails closed when the contract ledger export audit service is unavailable", async () => {
    jest.useRealTimers();
    const service = new ContractReadService({} as never);
    jest.spyOn(service, "listRecent").mockResolvedValue({
      rows: [],
      summary: {
        total: 0,
        inApproval: 0,
        pendingSeal: 0,
        pendingArchive: 0,
        effective: 0
      }
    });

    await expect(service.exportLedger(["project-1"], "finance-user")).rejects.toThrow(
      "合同台账导出审计服务暂不可用"
    );
  });

  it("does not expose contract PDF generation to read-only ledger users", () => {
    const service = new ContractReadService({} as never) as unknown as {
      contractActions(
        status: string,
        roleKeys: string[],
        approvalReviewAccess: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        archiveFiles: []
      ): Array<{ key: string; enabled: boolean }>;
    };

    const actions = service.contractActions(
      "effective",
      ["finance_staff"],
      { canAct: false, canReview: false, requiresSelfReviewConfirmation: false },
      []
    );

    expect(actions.find((action) => action.key === "generate_pdf_archive")?.enabled).toBe(false);
  });

  it("builds contract ledger rows and summary from persisted contracts", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-2026-009",
            temporaryCode: null,
            name: "幕墙分包合同",
            counterparty: "幕墙分包单位",
            updatedAt: new Date("2026-06-30T10:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-2",
            contractId: "contract-1",
            versionNo: 2,
            status: "effective",
            amountCents: 98650000n
          }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "terms-version-2",
            contractId: "contract-1",
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
    const service = new ContractReadService(prisma as never);

    const ledger = await service.listRecent(50);

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      take: 50,
      orderBy: { updatedAt: "desc" }
    });
    expect(ledger.rows[0]).toMatchObject({
      id: "HT-2026-009",
      contractNo: "HT-2026-009",
      name: "幕墙分包合同",
      project: "总部综合楼",
      amount: "¥986,500.00",
      version: "v2",
      currentNode: "可发起结算",
      ownerDepartment: "系统归档",
      pendingOwner: "系统归档",
      stalledFor: "7天",
      returnReason: "-",
      nextAction: "可发起结算",
      paymentTermsVersion: "v2"
    });
    expect(ledger.summary).toEqual({
      total: 1,
      inApproval: 0,
      pendingSeal: 0,
      pendingArchive: 0,
      effective: 1
    });
  });

  it("filters contract ledger by visible projects", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findMany: jest.fn()
      },
      paymentTermsVersion: {
        findMany: jest.fn()
      },
      project: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    await service.listRecent(20, ["project-1"]);

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: { projectId: { in: ["project-1"] } },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
  });

  it("excludes abandoned-only contracts and falls back to the latest non-abandoned version", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", projectId: "project-1", updatedAt: new Date(), name: "保留", counterparty: "乙方", code: "HT-1", temporaryCode: null },
          { id: "contract-2", projectId: "project-1", updatedAt: new Date(), name: "删除", counterparty: "乙方", code: null, temporaryCode: "草稿-2" }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "version-effective", contractId: "contract-1", versionNo: 1, status: "effective", amountCents: 100n }
        ])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "terms-1", contractId: "contract-1", contractVersionId: "version-effective", versionNo: 1 }
        ])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", name: "项目一" }]) }
    };
    const service = new ContractReadService(prisma as never);

    const result = await service.listRecent(50);

    expect(prisma.contractVersion.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ["contract-1", "contract-2"] }, status: { not: "abandoned" } },
      orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ contractNo: "HT-1", version: "v1" });
  });

  it("lists business contract options for settlement and payment creation", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-historical",
            projectId: "project-1",
            contractTypeKey: "material_purchase",
            source: "historical_takeover",
            code: "HT-LS-001",
            temporaryCode: null,
            name: "历史材料合同",
            counterparty: "历史供应商",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T08:00:00.000Z")
          },
          {
            id: "contract-draft",
            projectId: "project-1",
            contractTypeKey: "material_purchase",
            source: "system",
            code: "HT-DRAFT-001",
            temporaryCode: null,
            name: "未生效合同",
            counterparty: "分包单位",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T09:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-historical",
            contractId: "contract-historical",
            versionNo: 1,
            status: "effective",
            amountCents: 100000000n
          },
          {
            id: "version-draft",
            contractId: "contract-draft",
            versionNo: 1,
            status: "draft",
            amountCents: 200000000n
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-historical",
            takeoverLevel: "B",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: new Date("2026-07-03T10:00:00.000Z"),
            balanceSourceSummary: "财务台账"
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-effective",
            projectId: "project-1",
            contractId: "contract-historical",
            code: "JS-001",
            periodLabel: "2026-06",
            status: "effective",
            amountCents: 30000000n,
            payableAmountCents: 24000000n,
            paidAmountCents: 0n,
            createdAt: new Date("2026-07-03T11:00:00.000Z")
          },
          {
            id: "settlement-paid",
            projectId: "project-1",
            contractId: "contract-historical",
            code: "JS-000",
            periodLabel: "2026-05",
            status: "paid",
            amountCents: 20000000n,
            payableAmountCents: 16000000n,
            paidAmountCents: 16000000n,
            createdAt: new Date("2026-07-02T11:00:00.000Z")
          }
        ])
      }
    };
    const service = new ContractReadService(prisma as never);

    const options = await service.listCreateOptions("project-1");

    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      orderBy: [{ code: "asc" }, { temporaryCode: "asc" }, { updatedAt: "desc" }]
    });
    expect(options[0]).toMatchObject({
      contractId: "contract-historical",
      contractVersionId: "version-historical",
      contractNo: "HT-LS-001",
      contractName: "历史材料合同",
      counterparty: "历史供应商",
      amountCents: "100000000",
      versionLabel: "合同 v1",
      contractStatusLabel: "已生效",
      source: "historical_takeover",
      sourceLabel: "历史接管 · 财务台账",
      takeoverLevel: "B",
      takeoverStatusLabel: "已接管",
      canCreateSettlement: true,
      settlementUnavailableReason: null,
      canCreatePayment: true,
      paymentUnavailableReason: null
    });
    expect(options[0].historicalBalanceConfirmedAt).toBe("2026-07-03T10:00:00.000Z");
    expect(options[0].settlements).toEqual([
      {
        settlementId: "settlement-effective",
        settlementNo: "JS-001",
        periodLabel: "2026-06",
        amountCents: "30000000",
        payableAmountCents: "24000000",
        paidAmountCents: "0",
        status: "effective",
        statusLabel: "审批通过",
        canCreatePayment: true,
        unavailableReason: null
      },
      {
        settlementId: "settlement-paid",
        settlementNo: "JS-000",
        periodLabel: "2026-05",
        amountCents: "20000000",
        payableAmountCents: "16000000",
        paidAmountCents: "16000000",
        status: "paid",
        statusLabel: "审批通过",
        canCreatePayment: false,
        unavailableReason: "结算未生效或已付款完成"
      }
    ]);
    expect(options[1]).toMatchObject({
      contractId: "contract-draft",
      contractVersionId: null,
      contractStatusLabel: "草拟中",
      canCreateSettlement: false,
      settlementUnavailableReason: "合同尚未生效，不能发起结算",
      canCreatePayment: false,
      paymentUnavailableReason: "合同状态为草拟中，不能发起付款"
    });
  });

  it("blocks payment option for historical contracts before balance confirmation", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-historical",
            projectId: "project-1",
            contractTypeKey: "material_purchase",
            source: "historical_takeover",
            code: "HT-LS-002",
            temporaryCode: null,
            name: "待确认历史合同",
            counterparty: "历史供应商",
            voidedAt: null,
            updatedAt: new Date("2026-07-03T08:00:00.000Z")
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-historical",
            contractId: "contract-historical",
            versionNo: 1,
            status: "effective",
            amountCents: 100000000n
          }
        ])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-historical",
            takeoverLevel: "C",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: null,
            balanceSourceSummary: null
          }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const [option] = await service.listCreateOptions("project-1");

    expect(option.canCreateSettlement).toBe(true);
    expect(option.canCreatePayment).toBe(false);
    expect(option.paymentUnavailableReason).toBe("历史余额尚未确认，不能发起付款");
  });

  it("blocks settlement but preserves contract payment eligibility for a generic contract", async () => {
    const prisma = {
      contract: { findMany: jest.fn().mockResolvedValue([{
        id: "contract-generic",
        projectId: "project-1",
        source: "system",
        code: "HT-TY-001",
        temporaryCode: null,
        name: "通用服务合同",
        counterparty: "服务单位",
        contractTypeKey: "generic_contract",
        voidedAt: null,
        updatedAt: new Date("2026-07-18")
      }]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([{
        id: "version-generic",
        contractId: "contract-generic",
        versionNo: 1,
        status: "effective",
        amountCents: 100_000n
      }]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ContractReadService(prisma as never);

    const [option] = await service.listCreateOptions("project-1");
    expect(option).toMatchObject({
      canCreateSettlement: false,
      settlementUnavailableReason: "通用合同直接按冻结付款条款申请付款，不办理结算",
      canCreatePayment: true,
      paymentUnavailableReason: null
    });
    expect((service as unknown as {
      settlementBlockMessage(status: string, type: string): string;
    }).settlementBlockMessage("effective", "generic_contract")).toBe(
      "通用合同直接按冻结付款条款申请付款，不办理结算"
    );
    const actions = (service as unknown as {
      contractActions(
        status: string,
        roleKeys: string[],
        approvalAccess: { canAct: boolean; canReview: boolean; requiresSelfReviewConfirmation: boolean },
        archiveFiles: unknown[],
        context: Record<string, unknown>
      ): Array<{ key: string }>;
    }).contractActions(
      "effective",
      ["contract_staff"],
      { canAct: false, canReview: false, requiresSelfReviewConfirmation: false },
      [],
      {
        ownerUserId: "contract-staff-1",
        contractTypeKey: "generic_contract",
        governed: false,
        sealTask: null,
        activeFinal: null,
        approvalFormAvailable: false,
        approvalParticipant: false,
        canUploadGovernedFinal: false
      }
    );
    expect(actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "create_settlement" })
    ]));
  });

  it("displays temporaryCode when contract has no formal code and tolerates empty payment stages", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-draft-1",
          projectId: "project-1",
          code: null,
          temporaryCode: "草稿-20260625-12345678",
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
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-draft-1",
          versionNo: 1,
          status: "draft",
          amountCents: 0n
        }])
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
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("contract-draft-1");

    expect(detail.id).toBe("草稿-20260625-12345678");
    expect(detail.title).toBe("草稿-20260625-12345678 · ");
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-2",
            contractId: "contract-1",
            versionNo: 2,
            status: "effective",
            changeType: "change",
            baseVersionId: "contract-version-1",
            supersedesVersionId: "contract-version-1",
            changeReason: "历史增项",
            changeDirection: "increase",
            changeAmountCents: 8650000n,
            amountCents: 98650000n,
            amountLimitType: "capped",
            originalBaseAmountCents: 90000000n,
            cumulativeIncreaseCents: 8650000n,
            cumulativeDecreaseCents: 0n,
            pricingNature: "fixed_total",
            invoiceType: "vat_special",
            defaultTaxRatePercent: { toString: () => "13" }
          },
          {
            id: "contract-version-1",
            contractId: "contract-1",
            versionNo: 1,
            status: "superseded",
            changeType: "original",
            baseVersionId: null,
            supersedesVersionId: null,
            changeReason: null,
            changeDirection: null,
            changeAmountCents: null,
            amountCents: 90000000n,
            amountLimitType: "capped",
            originalBaseAmountCents: null,
            cumulativeIncreaseCents: 0n,
            cumulativeDecreaseCents: 0n
          }
        ])
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
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "archive-file-pending",
            fileId: "file-pending-contract",
            status: "pending_confirm",
            uploadedByUserId: "contract-staff-1",
            confirmedByUserId: null,
            createdAt: new Date("2026-07-02T08:00:00.000Z"),
            confirmedAt: null
          },
          {
            id: "archive-file-1",
            fileId: "file-signed-contract",
            status: "confirmed",
            uploadedByUserId: "contract-staff-1",
            confirmedByUserId: "contract-director-1",
            createdAt: new Date("2026-07-01T08:00:00.000Z"),
            confirmedAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-signed-contract",
            originalName: "幕墙分包合同-盖章版.pdf",
            mimeType: "application/pdf",
            sizeBytes: 128000
          },
          {
            id: "file-pending-contract",
            originalName: "幕墙分包合同-待确认盖章版.pdf",
            mimeType: "application/pdf",
            sizeBytes: 129000
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-staff-1", name: "王合同员" },
          { id: "contract-director-1", name: "李合同主管" }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-031",
            periodLabel: "2026年6月",
            status: "effective",
            amountCents: 30000000n,
            payableAmountCents: 30000000n,
            updatedAt: new Date("2026-06-30T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
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
    expect(detail.baseInfo).toContainEqual({
      label: "发票类型",
      value: "增值税专用发票"
    });
    expect(detail.baseInfo).toContainEqual({ label: "合同税率", value: "13%" });
    expect(detail.changeVersions?.[0]).toMatchObject({
      approvalRoute: [],
      approvalRouteLabel: "历史路线未冻结"
    });
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
    expect(detail.archiveFiles).toEqual([
      {
        archiveRecordId: "archive-file-pending",
        fileId: "file-pending-contract",
        fileName: "幕墙分包合同-待确认盖章版.pdf",
        mimeType: "application/pdf",
        sizeBytes: 129000,
        status: "pending_confirm",
        statusLabel: "待确认归档",
        uploadedByName: "王合同员",
        createdAt: "2026-07-02T08:00:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: false,
        disabledReason: "归档确认后开放下载"
      },
      {
        archiveRecordId: "archive-file-1",
        fileId: "file-signed-contract",
        fileName: "幕墙分包合同-盖章版.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128000,
        status: "confirmed",
        statusLabel: "已归档确认",
        uploadedByName: "王合同员",
        createdAt: "2026-07-01T08:00:00.000Z",
        confirmedByName: "李合同主管",
        confirmedAt: "2026-07-01T09:00:00.000Z",
        canDownload: true,
        disabledReason: null
      }
    ]);
    expect(detail.chainLinks.map((link) => link.to)).toEqual([
      "/contracts",
      "/settlements/JS-2026-031",
      "/archives",
      "/audit"
    ]);
  });

  it("shows the frozen in-progress change route after a contract director skips self-review", async () => {
    const changeVersion = {
      id: "contract-version-2",
      contractId: "contract-1",
      versionNo: 2,
      status: "in_approval",
      changeType: "change",
      baseVersionId: "contract-version-1",
      supersedesVersionId: null,
      changeReason: "调整工程量",
      changeDirection: "increase",
      changeAmountCents: 1000000n,
      amountCents: 91000000n,
      amountLimitType: "capped",
      originalBaseAmountCents: 90000000n,
      cumulativeIncreaseCents: 1000000n,
      cumulativeDecreaseCents: 0n
    };
    const originalVersion = {
      id: "contract-version-1",
      contractId: "contract-1",
      versionNo: 1,
      status: "effective",
      changeType: "original",
      baseVersionId: null,
      supersedesVersionId: null,
      changeReason: null,
      changeDirection: null,
      changeAmountCents: null,
      amountCents: 90000000n,
      amountLimitType: "capped",
      originalBaseAmountCents: null,
      cumulativeIncreaseCents: 0n,
      cumulativeDecreaseCents: 0n
    };
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-2026-010",
          name: "导演发起变更",
          counterparty: "乙方公司"
        })
      },
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "项目一" }) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([changeVersion, originalVersion]) },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-2", versionNo: 2, status: "draft" })
      },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{
          businessId: changeVersion.id,
          status: "in_progress",
          frozenNodes: [
            { roleKeys: ["project_manager"], candidateUserIds: ["manager-1"] },
            { roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] },
            { roleKeys: ["chairman", "general_manager"], candidateUserIds: ["chairman-1"] }
          ]
        }])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-010");

    expect(prisma.approvalInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["approved", "in_progress"] } }),
      select: { businessId: true, frozenNodes: true, status: true }
    }));
    expect(detail.changeVersions?.[0]).toMatchObject({
      approvalRouteLabel: "合同变更",
      approvalRoute: ["project_manager", "finance_director", "chairman_or_general_manager"]
    });
  });

  it("exposes enabled archive confirmation action for contract directors", async () => {
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
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "总部综合楼" })
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-2",
          contractId: "contract-1",
          versionNo: 2,
          status: "pending_archive_confirm",
          amountCents: 98650000n
        }])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["contract_director"])
    };
    const service = new ContractReadService(prisma as never, projectVisibility as never);

    const detail = await service.getDetail("HT-2026-009", undefined, "user-director");

    expect(projectVisibility.effectiveRoleKeys).toHaveBeenCalledWith("user-director", "project-1");
    expect(detail.primaryAction).toBe("confirm_archive");
    expect(detail.availableActions).toContainEqual({
      key: "confirm_archive",
      label: "确认合同归档",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiredAction: "contract.archive.confirm",
      requiresPassword: true
    });
    expect(detail.disabledReasons).toEqual([]);
  });

  it("does not expose internal user accounts when contract archive operator names are unavailable", async () => {
    const prisma = {
      contractArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "archive-file-1",
            fileId: "file-signed-contract",
            status: "confirmed",
            uploadedByUserId: "upload-internal-id",
            confirmedByUserId: "confirm-internal-id",
            createdAt: new Date("2026-07-01T08:00:00.000Z"),
            confirmedAt: new Date("2026-07-01T09:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-signed-contract",
            originalName: "盖章合同.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);
    const archiveFiles = await (
      service as unknown as {
        contractArchiveFilesForVersion(id: string): Promise<
          Array<{ uploadedByName: string; confirmedByName: string | null }>
        >;
      }
    ).contractArchiveFilesForVersion("contract-version-1");

    expect(archiveFiles[0]).toMatchObject({
      uploadedByName: "上传人未读取",
      confirmedByName: "确认人未读取"
    });
  });

  it("summarizes contract settlement and payment ledger without inventing payment term availability", async () => {
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
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-2",
          versionNo: 2,
          status: "effective",
          amountCents: 100000000n
        }])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-2",
          versionNo: 2,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-001",
            periodLabel: "第1期",
            status: "effective",
            amountCents: 30000000n,
            payableAmountCents: 30000000n,
            updatedAt: new Date("2026-06-20T08:00:00.000Z"),
            createdAt: new Date("2026-06-20T08:00:00.000Z")
          },
          {
            id: "settlement-2",
            code: "JS-2026-002",
            periodLabel: "第2期",
            status: "approval_pending",
            amountCents: 10000000n,
            payableAmountCents: 10000000n,
            updatedAt: new Date("2026-06-29T08:00:00.000Z"),
            createdAt: new Date("2026-06-29T08:00:00.000Z")
          },
          {
            id: "settlement-3",
            code: "JS-2026-003",
            periodLabel: "第3期",
            status: "paid",
            amountCents: 2000000n,
            payableAmountCents: 2000000n,
            updatedAt: new Date("2026-07-01T08:00:00.000Z"),
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            status: "confirmed",
            confirmedAt: new Date("2026-06-21T08:00:00.000Z"),
            createdAt: new Date("2026-06-21T08:00:00.000Z")
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            settlementId: "settlement-1",
            code: "FK-2026-001",
            status: "paid",
            requestedAmountCents: 25000000n,
            approvedAmountCents: 22000000n,
            paidAmountCents: 20000000n,
            updatedAt: new Date("2026-06-25T08:00:00.000Z")
          },
          {
            id: "payment-2",
            settlementId: "settlement-1",
            code: "FK-2026-002",
            status: "approved_pending_payment",
            requestedAmountCents: 5000000n,
            approvedAmountCents: 5000000n,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-06-30T08:00:00.000Z")
          },
          {
            id: "payment-3",
            settlementId: "settlement-3",
            code: "FK-2026-003",
            status: "approval_pending",
            requestedAmountCents: 1000000n,
            approvedAmountCents: null,
            paidAmountCents: 0n,
            updatedAt: new Date("2026-07-02T08:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            paymentRequestId: "payment-1",
            amountCents: 22000000n,
            paidAt: new Date("2026-06-26T08:00:00.000Z"),
            voucherFileId: "voucher-1"
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", amountCents: BigInt(1000000) }
        ])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-009");

    expect(detail.settlementPayment.summary).toEqual([
      { label: "累计生效结算", value: "¥320,000.00", tone: "success" },
      { label: "保守可申请余额", value: "¥30,000.00", tone: "warning" },
      { label: "审批中占用", value: "¥10,000.00", tone: "warning" },
      { label: "已批待付", value: "¥50,000.00", tone: "warning" },
      { label: "已实付", value: "¥220,000.00", tone: "success" },
      { label: "总包代付", value: "¥10,000.00", tone: "success" },
      { label: "累计已支付", value: "¥230,000.00", tone: "success" },
      { label: "最新合同剩余额度", value: "¥680,000.00", tone: "primary" }
    ]);
    expect(detail.settlementPayment.settlementRows.map((row) => row.settlementNo)).toEqual([
      "JS-2026-001",
      "JS-2026-002",
      "JS-2026-003"
    ]);
    expect(detail.settlementPayment.settlementRows[1]).toMatchObject({
      currentAmount: "¥100,000.00",
      cumulativeBeforeAmount: "¥300,000.00",
      cumulativeAfterAmount: "¥300,000.00",
      approvalStatus: "审批中"
    });
    expect(detail.settlementPayment.settlementRows[2]).toMatchObject({
      currentAmount: "¥20,000.00",
      cumulativeBeforeAmount: "¥300,000.00",
      cumulativeAfterAmount: "¥320,000.00",
      approvalStatus: "审批通过"
    });
    expect(detail.settlementPayment.settlementRows[0].archiveStatus).toBe("已归档确认");
    expect(
      detail.settlementPayment.paymentRows.find((row) => row.paymentNo === "FK-2026-001")
    ).toMatchObject({
      paymentNo: "FK-2026-001",
      paidAmount: "¥220,000.00",
      paymentDate: "2026/6/26 16:00:00",
      paymentStatus: "已付款",
      voucherStatus: "已上传"
    });
    expect(
      detail.settlementPayment.paymentRows.find((row) => row.paymentNo === "FK-2026-003")
    ).toMatchObject({
      paymentNo: "FK-2026-003",
      approvedAmount: "待审批",
      approvalStatus: "审批中",
      paymentStatus: "未付款"
    });
    expect(detail.settlementPayment.calculationNote).toContain("系统内金额与历史接管余额分列");
  });

  it("separates historical takeover amounts in contract settlement payment summary", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          code: "HT-HIS-001",
          name: "历史幕墙分包合同",
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
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-1",
          versionNo: 1,
          status: "effective",
          amountCents: 100_000_000n
        }])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            code: "JS-2026-041",
            periodLabel: "第4期",
            status: "effective",
            amountCents: 10_000_000n,
            payableAmountCents: 10_000_000n,
            updatedAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(20_000_000),
          historicalApprovalPendingPaymentCents: BigInt(1_000_000),
          historicalApprovedPendingPaymentCents: BigInt(2_000_000),
          historicalPaidCents: BigInt(5_000_000),
          historicalProxyPaidCents: BigInt(1_500_000),
          historicalAdvancePaidCents: BigInt(4_000_000),
          historicalAdvanceDeductedCents: BigInt(1_000_000),
          otherConfirmedOccupancyCents: BigInt(500_000)
        })
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-HIS-001");

    expect(detail.settlementPayment.summary).toEqual(
      expect.arrayContaining([
        { label: "累计生效结算", value: "¥300,000.00", tone: "success" },
        { label: "系统内累计生效结算", value: "¥100,000.00", tone: "default" },
        { label: "历史累计生效结算", value: "¥200,000.00", tone: "success" },
        { label: "保守可申请余额", value: "¥0.00", tone: "warning" },
        { label: "历史审批中占用", value: "¥10,000.00", tone: "warning" },
        { label: "历史已批待付", value: "¥20,000.00", tone: "warning" },
        { label: "历史已实付", value: "¥50,000.00", tone: "success" },
        { label: "历史总包代付", value: "¥15,000.00", tone: "success" },
        { label: "历史其他确认占用", value: "¥5,000.00", tone: "warning" },
        { label: "历史预付款已付", value: "¥40,000.00", tone: "success" },
        { label: "历史预付款已扣回", value: "¥10,000.00", tone: "default" },
        { label: "最新合同剩余额度", value: "¥700,000.00", tone: "primary" }
      ])
    );
  });

  it("labels contract advance payment rows without settlement", async () => {
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
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-1",
          versionNo: 1,
          status: "effective",
          amountCents: 100000000n
        }])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          versionNo: 1,
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-advance-1",
            settlementId: null,
            sourceType: "contract_advance",
            code: "FK-YF-2026-001",
            status: "paid",
            requestedAmountCents: 10000000n,
            approvedAmountCents: 10000000n,
            paidAmountCents: 10000000n,
            updatedAt: new Date("2026-07-20T08:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-advance-1",
            paymentRequestId: "payment-advance-1",
            amountCents: 10000000n,
            paidAt: new Date("2026-07-21T08:00:00.000Z"),
            voucherFileId: "voucher-advance-1"
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractReadService(prisma as never);

    const detail = await service.getDetail("HT-2026-009");

    expect(detail.settlementPayment.paymentRows[0]).toMatchObject({
      paymentNo: "FK-YF-2026-001",
      settlementNo: "合同预付款",
      paidAmount: "¥100,000.00",
      paymentStatus: "已付款",
      voucherStatus: "已上传"
    });
  });

  it("does not expose contract detail outside visible projects", async () => {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ContractReadService(prisma as never);

    await expect(service.getDetail("HT-2026-009", ["project-1"])).rejects.toThrow(
      "未找到合同，请刷新合同台账后重试"
    );
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "HT-2026-009" }, { code: "HT-2026-009" }],
        projectId: { in: ["project-1"] }
      }
    });
  });

  it("uses Chinese business errors when contract detail core records are missing", async () => {
    const baseContract = {
      id: "contract-1",
      projectId: "project-1",
      code: "HT-2026-009"
    };
    const project = { findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "总部综合楼" }) };

    await expect(
      new ContractReadService({
        contract: { findFirst: jest.fn().mockResolvedValue(baseContract) },
        project,
        contractVersion: { findMany: jest.fn().mockResolvedValue([]) }
      } as never).getDetail("HT-2026-009")
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");

    await expect(
      new ContractReadService({
        contract: { findFirst: jest.fn().mockResolvedValue(baseContract) },
        project,
        contractVersion: {
          findMany: jest.fn().mockResolvedValue([{ id: "version-1", contractId: "contract-1" }])
        },
        paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) }
      } as never).getDetail("HT-2026-009")
    ).rejects.toThrow("未找到合同付款条款版本，请刷新合同台账后重试");
  });

  it("为本人发起的董事长终审节点返回精确自审访问标记", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "leader-1",
          frozenNodes: [{ roleKeys: ["chairman", "general_manager"] }],
          currentNodeIndex: 0
        })
      }
    };
    const service = new ContractReadService(prisma as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<unknown>;
      contractActions(
        status: string,
        roleKeys: never[],
        access: unknown,
        archiveFiles: never[]
      ): Array<Record<string, unknown>>;
    };

    const access = await service.canReviewCurrentApproval(
      "contract_version",
      "contract-version-1",
      "project-1",
      ["chairman"],
      "leader-1"
    );
    expect(access).toEqual({
      canAct: true,
      canReview: true,
      requiresSelfReviewConfirmation: true
    });
    expect(service.contractActions("approval_pending", ["chairman"] as never[], access, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_approval",
          enabled: true,
          requiresSelfReviewConfirmation: true
        }),
        expect.objectContaining({ key: "transfer_approval", enabled: true }),
        expect.objectContaining({ key: "delegate_approval", enabled: true })
      ])
    );
    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: {
        businessType: "contract_version",
        businessId: "contract-version-1",
        status: "in_progress"
      },
      orderBy: { createdAt: "desc" },
      select: { applicantUserId: true, frozenNodes: true, currentNodeIndex: true }
    });
  });

  it.each([
    ["双端启用", true, true],
    ["委托人停用", false, false],
    ["受托人停用", false, true]
  ] as const)("standing delegation 在%s时 canReview=%s", async (_label, expected, delegatorActive) => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{ roleKeys: ["contract_director"] }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegator-1", isActive: delegatorActive },
          { id: "delegatee-1", isActive: _label !== "受托人停用" }
        ])
      }
    };
    const projectVisibility = {
      effectiveRoleKeys: jest.fn().mockImplementation((userId: string) =>
        userId === "delegator-1" ? ["contract_director"] : []
      )
    };
    const service = new ContractReadService(prisma as never, projectVisibility as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "contract_version",
      "contract-version-1",
      "project-1",
      [],
      "delegatee-1"
    );

    expect(access.canReview).toBe(expected);
  });

  it("keeps frozen assignment review without consulting standing delegation", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [
            {
              roleKeys: ["contract_director"],
              assignments: [{ fromRoleKey: "contract_director", toUserId: "assigned-1" }]
            }
          ],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: { findMany: jest.fn() }
    };
    const service = new ContractReadService(prisma as never, {} as never) as unknown as {
      canReviewCurrentApproval(
        businessType: string,
        businessId: string,
        projectId: string,
        roleKeys: string[],
        actorUserId: string
      ): Promise<{ canReview: boolean }>;
    };

    const access = await service.canReviewCurrentApproval(
      "contract_version",
      "contract-version-1",
      "project-1",
      [],
      "assigned-1"
    );

    expect(access.canReview).toBe(true);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["冻结候选调岗后", "contract-director-1", [], true],
    ["同岗位非冻结候选", "contract-director-2", ["contract_director"], false]
  ] as const)("受治理合同节点%s保持冻结人员口径", async (_label, actorUserId, roleKeys, expected) => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          applicantUserId: "applicant-1",
          frozenNodes: [{
            roleKeys: ["contract_director"],
            candidateUserIdsByRole: { contract_director: ["contract-director-1"] },
            candidateUserIds: ["contract-director-1"]
          }],
          currentNodeIndex: 0
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ContractReadService(prisma as never, {
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
      "contract_version",
      "contract-version-1",
      "project-1",
      [...roleKeys],
      actorUserId
    );

    expect(access.canAct).toBe(expected);
    expect(access.canReview).toBe(expected);
  });
  it("paginates mutually exclusive lifecycle views with full visible counts", async () => {
    const now = new Date("2026-07-20T01:00:00.000Z");
    const contracts = [
      { id: "c1", projectId: "p1", code: "HT-1", temporaryCode: null, name: "变更后合同", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now },
      { id: "c2", projectId: "p1", code: null, temporaryCode: "CG-2", name: "纯草稿", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now },
      { id: "c3", projectId: "p1", code: "HT-3", temporaryCode: null, name: "退回合同", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now },
      { id: "c4", projectId: "p1", code: "HT-4", temporaryCode: null, name: "作废合同", counterparty: "乙方", ownerUserId: "u2", voidedAt: now, updatedAt: now },
      { id: "c5", projectId: "p1", code: null, temporaryCode: "CG-5", name: "删除的纯草稿", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now },
      { id: "c6", projectId: "p1", code: "HT-6", temporaryCode: null, name: "作废版本之上的放弃变更", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now }
    ];
    const version = (contractId: string, id: string, versionNo: number, status: string) => ({
      id, contractId, versionNo, status, amountCents: 100n, amountLimitType: "capped",
      pricingNature: "fixed_total", changeType: versionNo > 1 ? "change" : "original",
      draftRevision: 3, updatedAt: now,
      abandonedAt: status === "abandoned" ? now : null,
      abandonReason: status === "abandoned" ? "不再继续" : null
    });
    const versions = [
      version("c1", "c1-v2", 2, "abandoned"), version("c1", "c1-v1", 1, "effective"),
      version("c2", "c2-v1", 1, "draft"), version("c3", "c3-v1", 1, "approval_rejected"),
      version("c4", "c4-v1", 1, "effective"), version("c5", "c5-v1", 1, "abandoned"),
      version("c6", "c6-v2", 2, "abandoned"), version("c6", "c6-v1", 1, "voided")
    ];
    const prisma = {
      contract: { findMany: jest.fn().mockResolvedValue(contracts) },
      contractVersion: { findMany: jest.fn().mockResolvedValue(versions) },
      paymentTermsVersion: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "项目一" }]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      contractFormalFile: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersionAuthorizationLink: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ContractReadService(prisma as never);

    const ended = await service.lifecycleLedger("ended", 1, 10, ["p1"], "u1");
    expect(ended.summary).toEqual({ formal_ledger: 1, my_drafts: 1, returned_for_revision: 1, ended: 4 });
    expect(ended.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ contractVersionId: "c1-v2", lifecycleKind: "approval_draft", abandonReason: "不再继续" }),
      expect.objectContaining({ contractVersionId: "c4-v1", lifecycleKind: "formal_record" }),
      expect.objectContaining({ contractVersionId: "c5-v1", lifecycleKind: "pristine_draft", copyAvailable: true }),
      expect.objectContaining({ contractVersionId: "c6-v2", lifecycleKind: "approval_draft" })
    ]));
    const formal = await service.lifecycleLedger("formal_ledger", 1, 1, ["p1"], "u1");
    expect(formal.meta).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect(formal.rows[0]).toEqual(expect.objectContaining({ contractVersionId: "c1-v1" }));
  });

  it("projects contract-root workbench status views without changing legacy lifecycle views", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const contracts = [
      { id: "c1", projectId: "p1", code: "HT-1", temporaryCode: null, name: "草稿合同", counterparty: "乙方", ownerUserId: "u1", voidedAt: null, updatedAt: now },
      { id: "c2", projectId: "p1", code: "HT-2", temporaryCode: null, name: "审批合同", counterparty: "乙方", ownerUserId: "u2", voidedAt: null, updatedAt: now },
      { id: "c3", projectId: "p1", code: "HT-3", temporaryCode: null, name: "用章合同", counterparty: "乙方", ownerUserId: "u2", voidedAt: null, updatedAt: now },
      { id: "c4", projectId: "p1", code: "HT-4", temporaryCode: null, name: "归档合同", counterparty: "乙方", ownerUserId: "u2", voidedAt: null, updatedAt: now },
      { id: "c5", projectId: "p1", code: "HT-5", temporaryCode: null, name: "生效合同", counterparty: "乙方", ownerUserId: "u2", voidedAt: null, updatedAt: now }
    ];
    const version = (contractId: string, id: string, status: string) => ({
      id, contractId, versionNo: 1, status, amountCents: 100n, amountLimitType: "capped",
      pricingNature: "fixed_total", changeType: "original", draftRevision: 1, updatedAt: now,
      abandonedAt: null, abandonReason: null
    });
    const prisma = {
      contract: { findMany: jest.fn().mockResolvedValue(contracts) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([
        version("c1", "c1-v1", "draft"), version("c2", "c2-v1", "in_approval"),
        version("c3", "c3-v1", "approved_pending_seal"),
        version("c4", "c4-v1", "pending_archive_confirm"), version("c5", "c5-v1", "effective")
      ]) },
      paymentTermsVersion: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "项目一" }]) }
    };
    const service = new ContractReadService(prisma as never);

    const pendingArchive = await service.workbenchLedger("pending_archive", 1, 20, ["p1"], "u1");

    expect(pendingArchive.summary).toEqual({
      my_drafts: 1, in_approval: 1, pending_seal: 1, pending_archive: 1, effective: 1, all: 5
    });
    expect(pendingArchive.rows).toEqual([
      expect.objectContaining({ contractVersionId: "c4-v1", contractNo: "HT-4", currentNode: "合同部主管确认双方最终版" })
    ]);
  });
});
