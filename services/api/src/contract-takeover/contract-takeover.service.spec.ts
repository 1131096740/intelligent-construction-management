import { ContractTakeoverService } from "./contract-takeover.service";

describe("ContractTakeoverService", () => {
  const audit = {
    record: jest.fn()
  };
  const auth = {
    confirmPassword: jest.fn()
  };
  const files = {
    assertCanDownloadFile: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
    files.assertCanDownloadFile.mockReset();
    files.assertCanDownloadFile.mockResolvedValue({ id: "file-1" });
  });

  function takeoverRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "takeover-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      paymentTermsVersionId: "terms-version-1",
      takeoverLevel: "A",
      suggestedTakeoverLevel: "A",
      takeoverLevelAdjustmentReason: null,
      takeoverStatus: "draft",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2026-01-10T00:00:00.000Z"),
      historicalSettledCents: 600_000n,
      historicalApprovalPendingPaymentCents: 40_000n,
      historicalApprovedPendingPaymentCents: 100_000n,
      historicalPaidCents: 300_000n,
      historicalProxyPaidCents: 20_000n,
      historicalAdvancePaidCents: 50_000n,
      historicalAdvanceDeductedCents: 10_000n,
      historicalRetentionWithheldCents: 30_000n,
      historicalRetentionReleasedCents: 0n,
      otherConfirmedOccupancyCents: 5_000n,
      balanceSourceSummary: "Finance ledger checked.",
      evidenceSummary: "Signed scan and finance ledger.",
      takeoverCutoffDate: null,
      responsibleUserId: null,
      reviewComment: null,
      acceptanceConclusion: null,
      createdByUserId: "contract-user",
      submittedByUserId: null,
      submittedAt: null,
      confirmedByUserId: null,
      confirmedAt: null,
      historicalBalanceConfirmedByUserId: null,
      historicalBalanceConfirmedAt: null,
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
      ...overrides
    };
  }

  function takeoverEvidenceRecords(purposes: string[]) {
    return purposes.map((purpose, index) => ({
      id: `archive-record-${index + 1}`,
      businessId: "takeover-1",
      businessType: "contract_takeover",
      fileId: `file-${index + 1}`,
      departmentScope: purpose,
      createdAt: new Date(`2026-07-03T00:0${index}:00.000Z`)
    }));
  }

  function takeoverEvidenceFiles(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `file-${index + 1}`,
      originalName: `接管资料-${index + 1}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      uploadedByUserId: "contract-user",
      createdAt: new Date(`2026-07-03T00:0${index}:00.000Z`)
    }));
  }

  function takeoverCorrectionRecord() {
    return {
      id: "takeover-correction-1",
      projectId: "project-1",
      takeoverId: "takeover-1",
      correctionType: "evidence",
      beforeSnapshot: {
        takeoverLevel: "B",
        historicalSettledCents: "1000000",
        historicalPaidCents: "400000",
        evidenceSummary: "原接管资料：合同扫描件、结算台账。"
      },
      afterSnapshot: {
        summary: "补充历史付款凭证，确认历史已付金额不变。"
      },
      reason: "补充历史付款凭证复核说明",
      responsibleUserId: "contract-director-1",
      attachmentFileId: "file-1",
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-04T09:00:00.000Z")
    };
  }

  it("creates a historical contract takeover draft on existing contract tables", async () => {
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      contract: {
        create: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({ id: "contract-version-1" })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeover: {
        create: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "draft",
            suggestedTakeoverLevel: "B",
            takeoverLevelAdjustmentReason: "预算和财务已完成期初复核。",
            takeoverCutoffDate: new Date("2026-06-30T00:00:00.000Z"),
            responsibleUserId: "contract-director-1",
            reviewComment: "预算和财务已完成期初复核。",
            acceptanceConclusion: "作为第一批 A 级活跃合同继续办理后续结算付款。"
          })
        )
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.create(
      "project-1",
      {
        code: "HT-HIS-001",
        name: "Historical material contract",
        counterparty: "Supplier A",
        contractTypeKey: "material_purchase",
        amountCents: 1_000_000,
        signedAt: "2026-01-10",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "Monthly settlement, pay 80% after archive.",
        historicalSettledCents: 600_000,
        historicalApprovalPendingPaymentCents: 40_000,
        historicalApprovedPendingPaymentCents: 100_000,
        historicalPaidCents: 300_000,
        historicalProxyPaidCents: 20_000,
        historicalAdvancePaidCents: 50_000,
        historicalAdvanceDeductedCents: 10_000,
        historicalRetentionWithheldCents: 30_000,
        historicalRetentionReleasedCents: 0,
        otherConfirmedOccupancyCents: 5_000,
        balanceSourceSummary: "Finance ledger checked.",
        evidenceSummary: "Signed scan and finance ledger.",
        takeoverCutoffDate: "2026-06-30",
        responsibleUserId: "contract-director-1",
        reviewComment: "预算和财务已完成期初复核。",
        acceptanceConclusion: "作为第一批 A 级活跃合同继续办理后续结算付款。"
      },
      "contract-user"
    );

    expect(result.takeoverStatus).toBe("draft");
    expect(result).toMatchObject({
      id: "takeover-1",
      contractNo: "HT-HIS-001",
      contractName: "Historical material contract",
      counterparty: "Supplier A",
      amountCents: "1000000",
      historicalPaidCents: "300000",
      suggestedTakeoverLevel: "B",
      takeoverLevelAdjustmentReason: "预算和财务已完成期初复核。",
      takeoverCutoffDate: new Date("2026-06-30T00:00:00.000Z"),
      responsibleUserId: "contract-director-1",
      reviewComment: "预算和财务已完成期初复核。",
      acceptanceConclusion: "作为第一批 A 级活跃合同继续办理后续结算付款。"
    });
    expect(result).not.toHaveProperty("contractVersionId");
    expect(result).not.toHaveProperty("paymentTermsVersionId");
    expect(result).not.toHaveProperty("createdByUserId");
    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        code: "HT-HIS-001",
        source: "historical_takeover",
        ownerUserId: "contract-user"
      })
    });
    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "contract-1",
        status: "draft",
        amountCents: BigInt(1_000_000),
        changeType: "historical_takeover"
      })
    });
    expect(tx.paymentTermsVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        status: "draft",
        originalText: "Monthly settlement, pay 80% after archive."
      })
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-version-1",
          name: "接管期初结算款",
          basis: "current_settlement",
          ratioBps: 10000,
          triggerEvent: "接管确认后形成期初有效结算",
          dueDays: 0,
          originalText: "Monthly settlement, pay 80% after archive."
        })
      ]
    });
    expect(tx.contractTakeover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: "预算和财务已完成期初复核。",
        takeoverStatus: "draft",
        lifecycleStatus: "in_progress",
        takeoverCutoffDate: new Date("2026-06-30T00:00:00.000Z"),
        responsibleUserId: "contract-director-1",
        reviewComment: "预算和财务已完成期初复核。",
        acceptanceConclusion: "作为第一批 A 级活跃合同继续办理后续结算付款。",
        historicalApprovalPendingPaymentCents: BigInt(40_000),
        historicalPaidCents: BigInt(300_000),
        createdByUserId: "contract-user"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.create",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: "预算和财务已完成期初复核。"
      })
    });
  });

  it("rejects negative historical balance values before writing", async () => {
    const tx = {
      project: {
        findUnique: jest.fn()
      },
      contract: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-1",
        {
          code: "HT-HIS-002",
          name: "Bad balance",
          counterparty: "Supplier B",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          historicalSettledCents: -1
        },
        "contract-user"
      )
    ).rejects.toThrow("历史累计结算必须填写 0 或更大的金额");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("requires review comment when takeover level differs from system suggestion", async () => {
    const tx = {
      contract: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-1",
        {
          code: "HT-HIS-LEVEL-001",
          name: "Level mismatch",
          counterparty: "Supplier B",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          historicalApprovedPendingPaymentCents: 20_000,
          balanceSourceSummary: "Finance ledger checked.",
          evidenceSummary: "Signed scan and finance ledger."
        },
        "contract-user"
      )
    ).rejects.toThrow("接管等级与系统建议不一致，请在复核意见说明调整原因");

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("uses a business message when the takeover project cannot be used", async () => {
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contract: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-missing",
        {
          code: "HT-HIS-005",
          name: "历史合同",
          counterparty: "历史供应商",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress"
        },
        "contract-user"
      )
    ).rejects.toThrow("项目不存在或已停用，请重新选择项目");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it.each([
    ["缺少导入行", {} as never, "请粘贴需要预检的历史合同导入行"],
    ["没有导入数据", { rows: [] }, "请至少保留一行导入数据"],
    [
      "超过单次上限",
      { rows: Array.from({ length: 201 }, () => ({})) },
      "单次导入预检最多支持 200 行，请分批处理"
    ],
    ["行格式错误", { rows: ["HT-HIS-001"] as never }, "第 1 行导入数据格式不正确，请重新粘贴"]
  ])("uses a business message when import precheck input is invalid: %s", async (_, input, message) => {
    const prisma = {
      contract: {
        findMany: jest.fn()
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(service.precheckImport("project-1", input)).rejects.toThrow(message);
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });

  it("prechecks historical takeover import rows without writing business records", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { code: "HT-HIS-EXISTING", temporaryCode: null },
          { code: null, temporaryCode: "TMP-EXISTING" }
        ])
      },
      contractTakeover: {
        create: jest.fn()
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          rowNo: 8,
          code: "HT-HIS-EXISTING",
          name: "Existing contract",
          counterparty: "Supplier A",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "Pay after archive.",
          balanceSourceSummary: "Finance ledger",
          evidenceSummary: "Signed scan",
          evidenceChecklist: "Signed contract scan; settlement ledger; payment vouchers"
        },
        {
          code: "HT-HIS-DUP",
          name: "Duplicate 1",
          counterparty: "Supplier B",
          amountCents: 2_000_000,
          signedAt: "2026-01-11",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress"
        },
        {
          code: "HT-HIS-READY",
          name: "Ready contract",
          counterparty: "Supplier D",
          amountCents: 3_000_000,
          signedAt: "2026-01-12",
          takeoverLevel: "C",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "Monthly payment.",
          balanceSourceSummary: "Finance ledger",
          evidenceSummary: "Signed scan",
          evidenceChecklist: "Signed contract scan",
          issueSummary: "Missing payment voucher, finance owner tracking"
        },
        {
          code: "HT-HIS-DUP",
          name: "",
          counterparty: "Supplier C",
          amountCents: -1,
          signedAt: "2026-02-31",
          takeoverLevel: "D",
          lifecycleStatus: "bad-status",
          historicalPaidCents: null
        }
      ]
    });

    expect(result).toMatchObject({
      projectId: "project-1",
      totalRows: 4,
      readyRows: 1,
      blockedRows: 3,
      warningRows: 2,
      existingCodes: ["HT-HIS-EXISTING"],
      duplicatedCodes: ["HT-HIS-DUP"]
    });
    expect(result.rows[0]).toMatchObject({
      rowNo: 8,
      code: "HT-HIS-EXISTING",
      status: "blocked"
    });
    expect(result.rows[1]).toMatchObject({
      rowNo: 2,
      status: "blocked"
    });
    expect(result.rows[2]).toMatchObject({
      rowNo: 3,
      status: "ready"
    });
    expect(result.rows[3].issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        "code",
        "name",
        "amountCents",
        "signedAt",
        "takeoverLevel",
        "lifecycleStatus",
        "historicalPaidCents"
      ])
    );
    expect(result.rows[3].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "signedAt",
          message: "签订日期不正确，请按“年-月-日”填写，例如 2026-01-10"
        })
      ])
    );
    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { code: { in: ["HT-HIS-EXISTING", "HT-HIS-DUP", "HT-HIS-READY"] } },
          { temporaryCode: { in: ["HT-HIS-EXISTING", "HT-HIS-DUP", "HT-HIS-READY"] } }
        ]
      },
      select: { code: true, temporaryCode: true }
    });
    expect(prisma.contractTakeover.create).not.toHaveBeenCalled();
  });

  it("uses business labels for invalid amount cells in import precheck", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-AMOUNT",
          name: "历史金额异常合同",
          counterparty: "历史供应商",
          amountCents: 0,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          historicalSettledCents: -1
        }
      ]
    });

    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "historicalSettledCents",
          message: "历史累计结算必须填写 0 或更大的金额"
        }),
        expect.objectContaining({
          field: "amountCents",
          message: "合同金额必须填写大于 0 的金额"
        })
      ])
    );
  });

  it("accepts Chinese takeover level labels in import precheck", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-LEVEL",
          name: "中文等级历史合同",
          counterparty: "历史供应商",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "B级",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款",
          balanceSourceSummary: "财务台账",
          evidenceSummary: "合同扫描件",
          evidenceChecklist: "合同扫描件、历史结算台账、付款凭证"
        }
      ]
    });

    expect(result.rows[0]).toMatchObject({
      status: "ready",
      takeoverLevel: "B"
    });
  });

  it("uses Chinese business guidance for invalid takeover level in import precheck", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-LEVEL-INVALID",
          name: "接管等级错误合同",
          counterparty: "历史供应商",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "D级",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款"
        }
      ]
    });

    expect(result.rows[0]).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({
          field: "takeoverLevel",
          message: "接管等级请选择 A级、B级或C级"
        })
      ])
    });
  });

  it("warns when import takeover level differs from system suggestion", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-LEVEL-SUGGESTION",
          name: "等级建议不一致合同",
          counterparty: "历史供应商",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款",
          historicalApprovedPendingPaymentCents: 20_000,
          balanceSourceSummary: "财务台账已核对",
          evidenceSummary: "合同扫描件和付款凭证已归档",
          evidenceChecklist: "合同扫描件、历史结算台账、付款凭证"
        }
      ]
    });

    expect(result).toMatchObject({ readyRows: 1, blockedRows: 0, warningRows: 1 });
    expect(result.rows[0]).toMatchObject({ status: "ready", takeoverLevel: "A" });
    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "takeoverLevel",
          level: "warning",
          message: "接管等级与系统建议不一致，请在问题清单或批次复核意见说明调整原因"
        })
      ])
    );
  });

  it("warns when takeover import precheck lacks evidence checklist or issue summary", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractTakeover: {
        create: jest.fn()
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-A",
          name: "A级有问题合同",
          counterparty: "Supplier A",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "Pay after archive.",
          balanceSourceSummary: "Finance ledger",
          evidenceSummary: "Signed scan",
          evidenceChecklist: "Signed contract scan",
          issueSummary: "Missing invoice"
        },
        {
          code: "HT-HIS-C",
          name: "C级缺问题合同",
          counterparty: "Supplier C",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "C",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "Pay after archive.",
          balanceSourceSummary: "Finance ledger",
          evidenceSummary: "Signed scan"
        }
      ]
    });

    expect(result.warningRows).toBe(2);
    expect(result.rows[0]).toMatchObject({
      evidenceChecklist: "Signed contract scan",
      issueSummary: "Missing invoice"
    });
    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "issueSummary",
          message: "A级合同存在问题清单，请确认是否应降级或先补齐资料"
        })
      ])
    );
    expect(result.rows[1].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "evidenceChecklist",
          message: "未填写资料清单，无法判断合同扫描件、结算依据和付款凭证是否齐全"
        }),
        expect.objectContaining({
          field: "issueSummary",
          message: "C级合同应填写问题清单，说明缺口、责任人和是否影响付款"
        })
      ])
    );
  });

  it("uses business guidance for invalid takeover cutoff date before creating import drafts", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.createDraftsFromImport(
        "project-1",
        {
          takeoverCutoffDate: "2026-02-31",
          responsibleUserId: "contract-director-1",
          reviewComment: "合同部已完成预检，提交预算和财务复核。",
          acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
          rows: [
            {
              code: "HT-HIS-CUTOFF",
              name: "接管截止日错误合同",
              counterparty: "历史供应商",
              amountCents: 1_000_000,
              signedAt: "2026-01-10",
              takeoverLevel: "B",
              lifecycleStatus: "in_progress",
              paymentTermsOriginalText: "按月结算付款",
              balanceSourceSummary: "财务台账",
              evidenceSummary: "合同扫描件",
              evidenceChecklist: "合同扫描件、历史结算台账、付款凭证"
            }
          ]
        },
        "contract-user"
      )
    ).rejects.toThrow("接管截止日不正确，请按“年-月-日”填写，例如 2026-01-10");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["takeoverCutoffDate", "请填写接管截止日后再生成接管草稿"],
    ["responsibleUserId", "请填写接管责任人后再生成接管草稿"],
    ["reviewComment", "请填写批次复核意见后再生成接管草稿"],
    ["acceptanceConclusion", "请填写批次验收结论后再生成接管草稿"]
  ] as const)("requires import batch %s before creating drafts", async (field, message) => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);
    const body = {
      takeoverCutoffDate: "2026-07-10",
      responsibleUserId: "contract-director-1",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
      rows: [
        {
          code: "HT-HIS-BATCH",
          name: "接管批次必填合同",
          counterparty: "历史供应商",
          amountCents: 1_000_000,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款",
          balanceSourceSummary: "财务台账",
          evidenceSummary: "合同扫描件",
          evidenceChecklist: "合同扫描件、历史结算台账、付款凭证"
        }
      ]
    };
    delete body[field];

    await expect(service.createDraftsFromImport("project-1", body, "contract-user")).rejects.toThrow(
      message
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates takeover drafts from ready import rows after precheck", async () => {
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({ id: "contract-version-1" })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeover: {
        create: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
      },
      contractTakeoverBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "batch-1",
          projectId: "project-1",
          batchNo: "接管批次-20260710-TEST0001",
          status: "drafts_generated",
          takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
          responsibleUserId: "contract-director-1",
          reviewComment: "合同部已完成预检，提交预算和财务复核。",
          acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
          importFingerprint: "fingerprint",
          totalRows: 1,
          readyRows: 1,
          blockedRows: 0,
          warningRows: 0,
          createdCount: 1,
          skippedCount: 0,
          createdByUserId: "contract-user",
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
          updatedAt: new Date("2026-07-10T00:00:00.000Z")
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      contract: tx.contract,
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.createDraftsFromImport(
      "project-1",
      {
        takeoverCutoffDate: "2026-07-10",
        responsibleUserId: "contract-director-1",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
        rows: [
          {
            rowNo: 2,
            code: "HT-HIS-001",
            name: "历史材料合同",
            counterparty: "供应商A",
            companyEntityName: "建工智管公司",
            amountCents: 1_000_000,
            signedAt: "2026-01-10",
            takeoverLevel: "A",
            lifecycleStatus: "in_progress",
            paymentTermsOriginalText: "按月结算，归档后付款。",
            historicalSettledCents: 600_000,
            historicalPaidCents: 300_000,
            balanceSourceSummary: "财务台账核对。",
            evidenceSummary: "合同扫描件和付款台账齐全。",
            evidenceChecklist: "合同扫描件、结算台账、付款凭证",
            issueSummary: "发票待补，财务复核时重点确认"
          }
        ]
      },
      "contract-user"
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.batch).toMatchObject({
      batchNo: "接管批次-20260710-TEST0001",
      status: "drafts_generated",
      statusLabel: "已生成草稿",
      riskText: "预检通过，等待资料核验和复核确认。",
      responsibleUserId: "contract-director-1",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
      createdCount: 1
    });
    expect(result.createdRows).toEqual([2]);
    expect(tx.contractTakeoverBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        batchNo: expect.stringMatching(/^接管批次-/),
        status: "drafts_generated",
        takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
        responsibleUserId: "contract-director-1",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
        totalRows: 1,
        readyRows: 1,
        createdCount: 1,
        createdByUserId: "contract-user"
      })
    });
    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        source: "historical_takeover",
        code: "HT-HIS-001",
        name: "历史材料合同",
        ownerUserId: "contract-user"
      })
    });
    expect(tx.contractTakeover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        historicalSettledCents: BigInt(600_000),
        historicalPaidCents: BigInt(300_000),
        balanceSourceSummary: "财务台账核对。",
        evidenceSummary: "合同扫描件和付款台账齐全。",
        reviewComment: "发票待补，财务复核时重点确认",
        takeoverBatchId: "batch-1",
        importRowNo: 2
      })
    });
  });

  it("reuses an existing import batch instead of creating duplicate takeover drafts", async () => {
    const existingBatch = {
      id: "batch-1",
      projectId: "project-1",
      batchNo: "接管批次-20260710-TEST0001",
      status: "drafts_generated",
      takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
      responsibleUserId: "contract-user",
      reviewComment: "导入预检通过后生成接管草稿，待多部门复核。",
      acceptanceConclusion: "待主管确认后形成接管结论。",
      importFingerprint: "fingerprint",
      totalRows: 1,
      readyRows: 1,
      blockedRows: 0,
      warningRows: 0,
      createdCount: 1,
      skippedCount: 0,
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z")
    };
    const tx = {
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-version-1", amountCents: 1_000_000n }])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1", originalText: "按月结算" }])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({
            takeoverBatchId: "batch-1",
            importRowNo: 2,
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1"
          })
        ])
      },
      contractTakeoverBatch: {
        findUnique: jest.fn().mockResolvedValue(existingBatch),
        create: jest.fn()
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      contract: tx.contract,
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.createDraftsFromImport(
      "project-1",
      {
        takeoverCutoffDate: "2026-07-10",
        responsibleUserId: "contract-director-1",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
        rows: [
          {
            rowNo: 2,
            code: "HT-HIS-001",
            name: "历史材料合同",
            counterparty: "供应商A",
            amountCents: 1_000_000,
            signedAt: "2026-01-10",
            takeoverLevel: "A",
            lifecycleStatus: "in_progress",
            paymentTermsOriginalText: "按月结算",
            balanceSourceSummary: "财务台账核对。",
            evidenceSummary: "合同扫描件齐全。",
            evidenceChecklist: "合同扫描件"
          }
        ]
      },
      "contract-user"
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.batch.batchNo).toBe("接管批次-20260710-TEST0001");
    expect(result.createdRows).toEqual([2]);
    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(tx.contractTakeoverBatch.create).not.toHaveBeenCalled();
  });

  it("includes import batch facts in duplicate detection fingerprint", async () => {
    const existingBatch = {
      id: "batch-1",
      projectId: "project-1",
      batchNo: "接管批次-20260710-TEST0001",
      status: "drafts_generated",
      takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
      responsibleUserId: "contract-director-1",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
      importFingerprint: "fingerprint",
      totalRows: 1,
      readyRows: 1,
      blockedRows: 0,
      warningRows: 0,
      createdCount: 1,
      skippedCount: 0,
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z")
    };
    const tx = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-version-1", amountCents: 1_000_000n }])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1", originalText: "按月结算" }])
      },
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({
            takeoverBatchId: "batch-1",
            importRowNo: 2,
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1"
          })
        ])
      },
      contractTakeoverBatch: {
        findUnique: jest.fn().mockResolvedValue(existingBatch)
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      contract: tx.contract,
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);
    const baseRows = [
      {
        rowNo: 2,
        code: "HT-HIS-001",
        name: "历史材料合同",
        counterparty: "供应商A",
        amountCents: 1_000_000,
        signedAt: "2026-01-10",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "按月结算",
        balanceSourceSummary: "财务台账核对。",
        evidenceSummary: "合同扫描件齐全。",
        evidenceChecklist: "合同扫描件"
      }
    ];

    await service.createDraftsFromImport(
      "project-1",
      {
        takeoverCutoffDate: "2026-07-10",
        responsibleUserId: "contract-director-1",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
        rows: baseRows
      },
      "contract-user"
    );
    await service.createDraftsFromImport(
      "project-1",
      {
        takeoverCutoffDate: "2026-07-11",
        responsibleUserId: "finance-director-1",
        reviewComment: "财务重新核对接管口径。",
        acceptanceConclusion: "本批次按新的截止日重新生成接管草稿。",
        rows: baseRows
      },
      "contract-user"
    );

    const firstFingerprint =
      tx.contractTakeoverBatch.findUnique.mock.calls[0][0].where.projectId_importFingerprint
        .importFingerprint;
    const secondFingerprint =
      tx.contractTakeoverBatch.findUnique.mock.calls[1][0].where.projectId_importFingerprint
        .importFingerprint;
    expect(firstFingerprint).not.toBe(secondFingerprint);
  });

  it("lists takeover import batches for a project as business read models", async () => {
    const prisma = {
      contractTakeoverBatch: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "batch-1",
            projectId: "project-1",
            batchNo: "接管批次-20260710-TEST0001",
            status: "drafts_generated",
            takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
            responsibleUserId: "contract-user",
            reviewComment: "合同、预算和财务待复核。",
            acceptanceConclusion: "待主管确认。",
            importFingerprint: "fingerprint",
            totalRows: 20,
            readyRows: 18,
            blockedRows: 0,
            warningRows: 4,
            createdCount: 18,
            skippedCount: 2,
            createdByUserId: "contract-user",
            createdAt: new Date("2026-07-10T01:00:00.000Z"),
            updatedAt: new Date("2026-07-10T01:00:00.000Z")
          }
        ])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.listImportBatches("project-1");

    expect(prisma.contractTakeoverBatch.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" }
    });
    expect(result).toEqual([
      {
        id: "batch-1",
        batchNo: "接管批次-20260710-TEST0001",
        status: "drafts_generated",
        statusLabel: "已生成草稿",
        riskText: "存在资料或风险提醒，复核时重点核对。",
        takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
        responsibleUserId: "contract-user",
        reviewComment: "合同、预算和财务待复核。",
        acceptanceConclusion: "待主管确认。",
        totalRows: 20,
        readyRows: 18,
        blockedRows: 0,
        warningRows: 4,
        createdCount: 18,
        skippedCount: 2
      }
    ]);
  });

  it("submits a generated takeover import batch for review", async () => {
    const batch = {
      id: "batch-1",
      projectId: "project-1",
      batchNo: "接管批次-20260710-TEST0001",
      status: "drafts_generated",
      takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
      responsibleUserId: "contract-director-1",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。",
      importFingerprint: "fingerprint",
      totalRows: 20,
      readyRows: 18,
      blockedRows: 0,
      warningRows: 4,
      createdCount: 18,
      skippedCount: 2,
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-10T01:00:00.000Z"),
      updatedAt: new Date("2026-07-10T01:00:00.000Z")
    };
    const tx = {
      contractTakeoverBatch: {
        findFirst: jest.fn().mockResolvedValue(batch),
        update: jest.fn().mockResolvedValue({ ...batch, status: "under_review" })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.reviewImportBatch(
      "project-1",
      "batch-1",
      {
        status: "under_review",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
      },
      "contract-director-1"
    );

    expect(result).toMatchObject({
      id: "batch-1",
      status: "under_review",
      statusLabel: "复核中",
      riskText: "批次正在复核，请合同、预算和财务核对资料与金额口径。"
    });
    expect(tx.contractTakeoverBatch.findFirst).toHaveBeenCalledWith({
      where: { id: "batch-1", projectId: "project-1" }
    });
    expect(tx.contractTakeoverBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: {
        status: "under_review",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "contract_takeover_batch.review",
      businessType: "contract_takeover_batch",
      businessId: "batch-1",
      metadata: {
        projectId: "project-1",
        batchNo: "接管批次-20260710-TEST0001",
        fromStatus: "drafts_generated",
        toStatus: "under_review"
      }
    });
  });

  it("records a takeover import batch acceptance result after review", async () => {
    const batch = {
      id: "batch-1",
      projectId: "project-1",
      batchNo: "接管批次-20260710-TEST0001",
      status: "under_review",
      takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
      responsibleUserId: "contract-director-1",
      reviewComment: "预算和财务已完成复核。",
      acceptanceConclusion: "待主管确认。",
      importFingerprint: "fingerprint",
      totalRows: 20,
      readyRows: 18,
      blockedRows: 0,
      warningRows: 0,
      createdCount: 18,
      skippedCount: 0,
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-10T01:00:00.000Z"),
      updatedAt: new Date("2026-07-10T01:00:00.000Z")
    };
    const tx = {
      contractTakeoverBatch: {
        findFirst: jest.fn().mockResolvedValue(batch),
        update: jest.fn().mockResolvedValue({
          ...batch,
          status: "limited_accepted",
          reviewComment: "预算和财务已完成复核。",
          acceptanceConclusion: "付款前需补齐发票和付款凭证。"
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
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.reviewImportBatch(
      "project-1",
      "batch-1",
      {
        status: "limited_accepted",
        reviewComment: "预算和财务已完成复核。",
        acceptanceConclusion: "付款前需补齐发票和付款凭证。"
      },
      "contract-director-1"
    );

    expect(result).toMatchObject({
      status: "limited_accepted",
      statusLabel: "受限验收",
      riskText: "批次为受限验收，缺口未补齐前系统仍会限制或阻断付款。",
      acceptanceConclusion: "付款前需补齐发票和付款凭证。"
    });
  });

  it("explains that disputed takeover import batches cannot release payment", async () => {
    const batch = {
      id: "batch-1",
      projectId: "project-1",
      batchNo: "接管批次-20260710-TEST0001",
      status: "under_review",
      takeoverCutoffDate: new Date("2026-07-10T00:00:00.000Z"),
      responsibleUserId: "contract-director-1",
      reviewComment: "预算和财务发现历史付款凭证存在争议。",
      acceptanceConclusion: "待补充双方确认材料。",
      importFingerprint: "fingerprint",
      totalRows: 20,
      readyRows: 18,
      blockedRows: 0,
      warningRows: 4,
      createdCount: 18,
      skippedCount: 0,
      createdByUserId: "contract-user",
      createdAt: new Date("2026-07-10T01:00:00.000Z"),
      updatedAt: new Date("2026-07-10T01:00:00.000Z")
    };
    const tx = {
      contractTakeoverBatch: {
        findFirst: jest.fn().mockResolvedValue(batch),
        update: jest.fn().mockResolvedValue({
          ...batch,
          status: "disputed",
          reviewComment: "预算和财务发现历史付款凭证存在争议。",
          acceptanceConclusion: "待补充双方确认材料。"
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
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.reviewImportBatch(
      "project-1",
      "batch-1",
      {
        status: "disputed",
        reviewComment: "预算和财务发现历史付款凭证存在争议。",
        acceptanceConclusion: "待补充双方确认材料。"
      },
      "contract-director-1"
    );

    expect(result).toMatchObject({
      status: "disputed",
      statusLabel: "存在争议",
      riskText: "批次存在争议，争议解决前不能作为付款放行依据。",
      acceptanceConclusion: "待补充双方确认材料。"
    });
  });

  it("rejects takeover import batch acceptance before review", async () => {
    const tx = {
      contractTakeoverBatch: {
        findFirst: jest.fn().mockResolvedValue({
          id: "batch-1",
          projectId: "project-1",
          batchNo: "接管批次-20260710-TEST0001",
          status: "drafts_generated"
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.reviewImportBatch(
        "project-1",
        "batch-1",
        {
          status: "accepted",
          reviewComment: "预算和财务已完成复核。",
          acceptanceConclusion: "同意本批次验收。"
        },
        "contract-director-1"
      )
    ).rejects.toThrow("当前批次为“已生成草稿”，不能直接变更为“已验收”");
    expect(tx.contractTakeoverBatch.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects takeover import batch review result without business conclusion", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.reviewImportBatch(
        "project-1",
        "batch-1",
        {
          status: "under_review",
          reviewComment: " ",
          acceptanceConclusion: "待主管确认。"
        },
        "contract-director-1"
      )
    ).rejects.toThrow("请填写批次复核意见后再提交复核结果");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not create import drafts while precheck still has error rows", async () => {
    const tx = {
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      contract: tx.contract,
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.createDraftsFromImport(
        "project-1",
        {
          rows: [
            {
              rowNo: 2,
              code: "",
              name: "历史材料合同",
              counterparty: "供应商A",
              amountCents: 1_000_000,
              signedAt: "2026-01-10",
              takeoverLevel: "A",
              lifecycleStatus: "in_progress"
            }
          ]
        },
        "contract-user"
      )
    ).rejects.toThrow("导入预检仍有错误行");

    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("updates an editable takeover draft and keeps linked contract facts in sync", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" })),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverLevel: "C",
            suggestedTakeoverLevel: "C",
            takeoverLevelAdjustmentReason: null,
            lifecycleStatus: "disputed",
            historicalPaidCents: 350_000n
          })
        )
      },
      contract: { update: jest.fn() },
      contractVersion: { update: jest.fn() },
      paymentTermsVersion: { update: jest.fn() },
      paymentTermsStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.updateDraft(
      "project-1",
      "takeover-1",
      {
        code: "HT-HIS-EDIT",
        name: "Edited historical contract",
        counterparty: "Supplier B",
        companyEntityName: "建工智管公司",
        amountCents: 1_200_000,
        signedAt: "2026-02-01",
        takeoverLevel: "C",
        lifecycleStatus: "disputed",
        paymentTermsOriginalText: "Updated terms.",
        historicalSettledCents: 700_000,
        historicalApprovalPendingPaymentCents: 50_000,
        historicalApprovedPendingPaymentCents: 100_000,
        historicalPaidCents: 350_000,
        historicalProxyPaidCents: 20_000,
        historicalAdvancePaidCents: 50_000,
        historicalAdvanceDeductedCents: 10_000,
        historicalRetentionWithheldCents: 30_000,
        historicalRetentionReleasedCents: 0,
        otherConfirmedOccupancyCents: 5_000,
        balanceSourceSummary: "Updated balance.",
        evidenceSummary: "Updated evidence."
      },
      "contract-user"
    );

    expect(result).toMatchObject({
      contractNo: "HT-HIS-EDIT",
      contractName: "Edited historical contract",
      companyEntityName: "建工智管公司",
      paymentTermsOriginalText: "Updated terms.",
      takeoverLevel: "C",
      suggestedTakeoverLevel: "C",
      takeoverLevelAdjustmentReason: null,
      lifecycleStatus: "disputed",
      historicalPaidCents: "350000"
    });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      data: expect.objectContaining({
        code: "HT-HIS-EDIT",
        name: "Edited historical contract",
        counterparty: "Supplier B",
        companyEntityName: "建工智管公司"
      })
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { amountCents: BigInt(1_200_000) }
    });
    expect(tx.paymentTermsVersion.update).toHaveBeenCalledWith({
      where: { id: "terms-version-1" },
      data: { originalText: "Updated terms." }
    });
    expect(tx.paymentTermsStage.deleteMany).toHaveBeenCalledWith({
      where: { paymentTermsVersionId: "terms-version-1" }
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-version-1",
          name: "接管期初结算款",
          basis: "current_settlement",
          ratioBps: 10000,
          originalText: "Updated terms."
        })
      ]
    });
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: expect.objectContaining({
        takeoverLevel: "C",
        suggestedTakeoverLevel: "C",
        takeoverLevelAdjustmentReason: null,
        lifecycleStatus: "disputed",
        historicalPaidCents: BigInt(350_000)
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.update_draft",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        projectId: "project-1",
        fromStatus: "draft",
        fromTakeoverLevel: "A",
        toTakeoverLevel: "C",
        suggestedTakeoverLevel: "C",
        takeoverLevelAdjustmentReason: null
      })
    });
  });

  it("records takeover level adjustment reason when editing a draft away from system suggestion", async () => {
    const adjustmentReason = "合同部确认资料可控，按 A级继续跟踪付款限制。";
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "draft",
            takeoverLevel: "B",
            suggestedTakeoverLevel: "B"
          })
        ),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverLevel: "A",
            suggestedTakeoverLevel: "B",
            takeoverLevelAdjustmentReason: adjustmentReason,
            reviewComment: adjustmentReason,
            historicalApprovedPendingPaymentCents: 100_000n
          })
        )
      },
      contract: { update: jest.fn() },
      contractVersion: { update: jest.fn() },
      paymentTermsVersion: { update: jest.fn() },
      paymentTermsStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.updateDraft(
      "project-1",
      "takeover-1",
      {
        code: "HT-HIS-EDIT-LEVEL",
        name: "Edited historical contract level",
        counterparty: "Supplier B",
        amountCents: 1_200_000,
        signedAt: "2026-02-01",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "Updated terms.",
        historicalApprovedPendingPaymentCents: 100_000,
        balanceSourceSummary: "Finance ledger checked.",
        evidenceSummary: "Signed scan and finance ledger.",
        reviewComment: adjustmentReason
      },
      "contract-user"
    );

    expect(result).toMatchObject({
      takeoverLevel: "A",
      suggestedTakeoverLevel: "B",
      takeoverLevelAdjustmentReason: adjustmentReason,
      reviewComment: adjustmentReason
    });
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: expect.objectContaining({
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: adjustmentReason,
        reviewComment: adjustmentReason
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.update_draft",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        projectId: "project-1",
        fromStatus: "draft",
        fromTakeoverLevel: "B",
        toTakeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: adjustmentReason
      })
    });
  });

  it("rejects editing takeover records after review submission", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "pending_review" }))
      },
      contract: { update: jest.fn() },
      contractVersion: { update: jest.fn() },
      paymentTermsVersion: { update: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.updateDraft(
        "project-1",
        "takeover-1",
        {
          code: "HT-HIS-EDIT",
          name: "Edited historical contract",
          counterparty: "Supplier B",
          amountCents: 1_200_000,
          signedAt: "2026-02-01",
          takeoverLevel: "C",
          lifecycleStatus: "disputed",
          paymentTermsOriginalText: "Updated terms.",
          balanceSourceSummary: "Updated balance.",
          evidenceSummary: "Updated evidence."
        },
        "contract-user"
      )
    ).rejects.toThrow("当前接管记录不能编辑，请确认仍处于草稿或待补充状态");
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it("attaches evidence files to editable takeover drafts", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1" })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-record-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          code: "HT-HIS-001",
          temporaryCode: null
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A",
            companyEntityName: "建工智管公司"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-version-1", amountCents: 1_000_000n }])
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "terms-version-1", originalText: "Monthly terms" }])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await service.attachEvidenceFile(
      "project-1",
      "takeover-1",
      { fileId: "file-1", purpose: "historical_contract_scan" },
      "contract-user"
    );

    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(tx, "file-1", "contract-user");
    expect(tx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "contract_takeover",
        businessId: "takeover-1",
        fileId: "file-1",
        departmentScope: "historical_contract_scan"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.evidence.attach",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        archiveRecordId: "archive-record-1",
        fileId: "file-1",
        purpose: "historical_contract_scan"
      })
    });
  });

  it("接管资料文件必填", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachEvidenceFile(
        "project-1",
        "takeover-1",
        { fileId: "   ", purpose: "historical_contract_scan" },
        "contract-user"
      )
    ).rejects.toThrow("请先选择要挂接的接管资料文件");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("接管资料类型不正确时直接拒绝", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachEvidenceFile(
        "project-1",
        "takeover-1",
        { fileId: "file-1", purpose: "invalid" as never },
        "contract-user"
      )
    ).rejects.toThrow("接管资料类型不正确，请重新选择资料类型");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("接管记录状态不允许时不能挂接资料", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "pending_review" }))
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachEvidenceFile(
        "project-1",
        "takeover-1",
        { fileId: "file-1", purpose: "historical_contract_scan" },
        "contract-user"
      )
    ).rejects.toThrow("当前接管记录不能继续挂接资料，请确认仍处于草稿或待补充状态");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("已确认接管资料不能静默补充，必须走更正记录", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachEvidenceFile(
        "project-1",
        "takeover-1",
        { fileId: "file-1", purpose: "historical_contract_scan" },
        "contract-user"
      )
    ).rejects.toThrow(
      "已完成主管确认，接管资料不能静默补充，请发起更正记录并保留原因、责任人和附件"
    );
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects takeover evidence when the actor cannot read the file", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    files.assertCanDownloadFile.mockRejectedValueOnce(new Error("当前账号无权下载该文件"));
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachEvidenceFile(
        "project-1",
        "takeover-1",
        { fileId: "file-other", purpose: "historical_contract_scan" },
        "contract-user"
      )
    ).rejects.toThrow("当前账号无权读取该接管资料文件");
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("已确认接管事实更正必须记录改前改后、原因、责任人、附件和审计", async () => {
    const takeover = takeoverRecord({
      takeoverStatus: "confirmed",
      evidenceSummary: "原接管资料：合同扫描件、结算台账。",
      historicalSettledCents: 1_000_000n,
      historicalPaidCents: 400_000n
    });
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeover)
      },
      contractTakeoverCorrection: {
        create: jest.fn().mockResolvedValue({ id: "takeover-correction-1" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const result = await service.recordCorrection(
      "project-1",
      "takeover-1",
      {
        correctionType: "evidence",
        reason: "补充历史付款凭证复核说明",
        responsibleUserId: "contract-director-1",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        attachmentFileId: "file-1",
        currentPassword: "current-password"
      },
      "contract-user"
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("contract-user", "current-password");
    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(tx, "file-1", "contract-user");
    expect(tx.contractTakeoverCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        takeoverId: "takeover-1",
        correctionType: "evidence",
        reason: "补充历史付款凭证复核说明",
        responsibleUserId: "contract-director-1",
        attachmentFileId: "file-1",
        createdByUserId: "contract-user",
        beforeSnapshot: expect.objectContaining({
          evidenceSummary: "原接管资料：合同扫描件、结算台账。",
          historicalSettledCents: "1000000",
          historicalPaidCents: "400000"
        }),
        afterSnapshot: expect.objectContaining({
          summary: "补充历史付款凭证，确认历史已付金额不变。"
        })
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.correction.record",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        projectId: "project-1",
        correctionId: "takeover-correction-1",
        correctionType: "evidence",
        attachmentFileId: "file-1",
        responsibleUserId: "contract-director-1"
      })
    });
    expect(result).toEqual({
      id: "takeover-correction-1",
      message: "接管更正记录已保存，后续复核可查看原因、责任人和附件"
    });
  });

  it("接管更正记录必须先填写当前登录密码", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.recordCorrection(
        "project-1",
        "takeover-1",
        {
          correctionType: "evidence",
          reason: "补充历史付款凭证复核说明",
          responsibleUserId: "contract-director-1",
          afterSummary: "补充历史付款凭证。",
          attachmentFileId: "file-1",
          currentPassword: ""
        },
        "contract-user"
      )
    ).rejects.toThrow("请填写当前登录密码后再保存接管更正记录");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("未确认接管记录不走更正记录", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
      },
      contractTakeoverCorrection: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.recordCorrection(
        "project-1",
        "takeover-1",
        {
          correctionType: "evidence",
          reason: "补充历史付款凭证复核说明",
          responsibleUserId: "contract-director-1",
          afterSummary: "补充历史付款凭证。",
          attachmentFileId: "file-1",
          currentPassword: "current-password"
        },
        "contract-user"
      )
    ).rejects.toThrow("接管尚未主管确认，请直接在草稿或待补充阶段修改资料");
    expect(auth.confirmPassword).toHaveBeenCalledWith("contract-user", "current-password");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.contractTakeoverCorrection.create).not.toHaveBeenCalled();
  });

  it("rejects missing signed date before writing", async () => {
    const tx = {
      project: {
        findUnique: jest.fn()
      },
      contract: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-1",
        {
          code: "HT-HIS-003",
          name: "Missing date",
          counterparty: "Supplier C",
          amountCents: 1_000_000,
          signedAt: null as never,
          takeoverLevel: "B",
          lifecycleStatus: "in_progress"
        },
        "contract-user"
      )
    ).rejects.toThrow("签订日期不正确，请按“年-月-日”填写，例如 2026-01-10");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("rejects normalized impossible signed dates before writing", async () => {
    const tx = {
      project: {
        findUnique: jest.fn()
      },
      contract: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-1",
        {
          code: "HT-HIS-004",
          name: "Bad date",
          counterparty: "Supplier C",
          amountCents: 1_000_000,
          signedAt: "2026-02-31",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress"
        },
        "contract-user"
      )
    ).rejects.toThrow("签订日期不正确，请按“年-月-日”填写，例如 2026-01-10");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("submits a draft takeover for review and records audit", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" })),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "pending_review",
            submittedAt: new Date("2026-07-03T01:00:00.000Z")
          })
        )
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          code: "HT-HIS-001",
          temporaryCode: null
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.submitReview("project-1", "takeover-1", "contract-user");

    expect(result.takeoverStatus).toBe("pending_review");
    expect(result).not.toHaveProperty("contractVersionId");
    expect(result).not.toHaveProperty("submittedByUserId");
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: {
        takeoverStatus: "pending_review",
        submittedByUserId: "contract-user",
        submittedAt: expect.any(Date)
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.submit_review",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        fromStatus: "draft",
        toStatus: "pending_review"
      })
    });
  });

  it("接管记录不存在时不能提交复核", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.submitReview("project-1", "takeover-missing", "contract-user")
    ).rejects.toThrow("未找到历史合同接管记录，请刷新接管工作台后重试");
    expect(tx.contractTakeover.update).not.toHaveBeenCalled();
  });

  it("接管记录状态不允许时不能提交复核", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" })),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.submitReview("project-1", "takeover-1", "contract-user")
    ).rejects.toThrow("当前接管记录不能提交复核，请确认仍处于草稿或待补充状态");
    expect(tx.contractTakeover.update).not.toHaveBeenCalled();
  });

  it("confirms takeover with second confirmation and makes version and terms effective", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(
          takeoverRecord({ takeoverStatus: "pending_review" })
        ),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "confirmed",
            confirmedAt: new Date("2026-07-03T02:00:00.000Z"),
            historicalBalanceConfirmedAt: new Date("2026-07-03T02:00:00.000Z")
          })
        )
      },
      contractVersion: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      paymentTermsVersion: {
        update: jest.fn().mockResolvedValue({})
      },
      settlement: {
        create: jest.fn().mockResolvedValue({})
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ code: "HT-HIS-001", temporaryCode: null }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue(
          takeoverEvidenceRecords([
            "historical_contract_scan",
            "historical_settlement_ledger",
            "historical_payment_voucher"
          ])
        )
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue(takeoverEvidenceFiles(3))
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-user", name: "合同员" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.confirm("project-1", "takeover-1", "director-1", {
      confirmationPassword: "current-password"
    });

    expect(result.takeoverStatus).toBe("confirmed");
    expect(result).not.toHaveProperty("contractVersionId");
    expect(result).not.toHaveProperty("confirmedByUserId");
    expect(auth.confirmPassword).toHaveBeenCalledWith("director-1", "current-password");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "effective", effectiveAt: expect.any(Date) }
    });
    expect(tx.paymentTermsVersion.update).toHaveBeenCalledWith({
      where: { id: "terms-version-1" },
      data: { status: "effective" }
    });
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "HT-HIS-001-期初结算",
        periodLabel: "历史期初",
        status: "effective",
        amountCents: 600_000,
        payableAmountCents: 600_000,
        paidAmountCents: 300_000,
        sourceType: "historical_takeover",
        sourceTakeoverId: "takeover-1"
      })
    });
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: expect.objectContaining({
        takeoverStatus: "confirmed",
        confirmedByUserId: "director-1",
        confirmedAt: expect.any(Date),
        historicalBalanceConfirmedByUserId: "director-1",
        historicalBalanceConfirmedAt: expect.any(Date)
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "director-1",
      action: "contract_takeover.confirm",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        fromStatus: "pending_review",
        toStatus: "confirmed",
        contractVersionId: "contract-version-1"
      })
    });
  });

  it("确认接管时必须填写当前登录密码", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.confirm("project-1", "takeover-1", "director-1", {
        confirmationPassword: ""
      })
    ).rejects.toThrow("确认历史合同接管需要当前登录密码");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("接管记录状态不允许时不能主管确认", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" })),
        update: jest.fn()
      },
      contractVersion: {
        update: jest.fn()
      },
      paymentTermsVersion: {
        update: jest.fn()
      },
      settlement: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.confirm("project-1", "takeover-1", "director-1", {
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("当前接管记录尚不能确认，请先提交复核并完成资料核验");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentTermsVersion.update).not.toHaveBeenCalled();
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("rejects takeover confirmation when required evidence is missing", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(
          takeoverRecord({ takeoverStatus: "pending_review" })
        ),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "confirmed",
            confirmedAt: new Date("2026-07-03T02:00:00.000Z"),
            historicalBalanceConfirmedAt: new Date("2026-07-03T02:00:00.000Z")
          })
        )
      },
      contractVersion: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      paymentTermsVersion: {
        update: jest.fn()
      },
      settlement: {
        create: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ code: "HT-HIS-001", temporaryCode: null }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue(takeoverEvidenceRecords(["historical_contract_scan"]))
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue(takeoverEvidenceFiles(1))
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-user", name: "合同员" }])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.confirm("project-1", "takeover-1", "director-1", {
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("接管资料未补齐");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentTermsVersion.update).not.toHaveBeenCalled();
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.contractTakeover.update).not.toHaveBeenCalled();
  });

  it("lists historical takeover rows as business read models without internal IDs", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({
            takeoverStatus: "pending_review",
            responsibleUserId: "contract-director-1"
          })
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-director-1", name: "合同负责人" }])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1")).resolves.toEqual([
      expect.objectContaining({
        id: "takeover-1",
        contractNo: "HT-HIS-001",
        contractName: "Historical material contract",
        counterparty: "Supplier A",
        amountCents: "1000000",
        responsibleUserId: "contract-director-1",
        responsibleUserName: "合同负责人",
        levelRiskText: "A级资料较完整，可作为首批活跃合同接管，仍需保留原始资料备查。",
        paymentBlockingHint: "尚未完成主管确认，后续付款申请会被系统阻断。",
        evidenceGapSummary:
          "缺少：历史合同扫描件、历史结算台账、历史付款凭证。补齐前会影响主管确认和后续付款核验。",
        evidenceChecklist: [
          expect.objectContaining({
            purpose: "historical_contract_scan",
            purposeLabel: "历史合同扫描件",
            uploaded: false,
            statusLabel: "待补齐"
          }),
          expect.objectContaining({
            purpose: "historical_settlement_ledger",
            purposeLabel: "历史结算台账",
            uploaded: false,
            statusLabel: "待补齐"
          }),
          expect.objectContaining({
            purpose: "historical_payment_voucher",
            purposeLabel: "历史付款凭证",
            uploaded: false,
            statusLabel: "待补齐"
          })
        ],
        takeoverStatus: "pending_review",
        historicalSettledCents: "600000"
      })
    ]);
    const [row] = await service.list("project-1");
    expect(row).not.toHaveProperty("contractVersionId");
    expect(row).not.toHaveProperty("paymentTermsVersionId");
    expect(row).not.toHaveProperty("createdByUserId");
    expect(row).not.toHaveProperty("submittedByUserId");
    expect(row).not.toHaveProperty("confirmedByUserId");
    expect(row).not.toHaveProperty("historicalBalanceConfirmedByUserId");
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["contract-director-1"] } },
      select: { id: true, name: true }
    });
  });

  it("lists takeover correction records with business summaries and attachment names", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([takeoverRecord({ takeoverStatus: "confirmed" })])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      contractTakeoverCorrection: {
        findMany: jest.fn().mockResolvedValue([takeoverCorrectionRecord()])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue(takeoverEvidenceFiles(1))
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "contract-director-1", name: "合同负责人" },
            { id: "contract-user", name: "合同经办" }
          ])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const [row] = await service.list("project-1");

    expect(row.corrections).toEqual([
      {
        id: "takeover-correction-1",
        correctionType: "evidence",
        correctionTypeLabel: "资料更正",
        reason: "补充历史付款凭证复核说明",
        beforeSummary:
          "改前：接管等级 B级；历史累计结算 ¥10,000.00；历史累计已付 ¥4,000.00；证据说明：原接管资料：合同扫描件、结算台账。",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        responsibleUserName: "合同负责人",
        createdByName: "合同经办",
        attachmentFileId: "file-1",
        attachmentFileName: "接管资料-1.pdf",
        createdAt: new Date("2026-07-04T09:00:00.000Z")
      }
    ]);
    expect(row.corrections[0]).not.toHaveProperty("beforeSnapshot");
    expect(row.corrections[0]).not.toHaveProperty("afterSnapshot");
  });

  it("summarizes post-confirmation verification facts after takeover", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({
            takeoverStatus: "confirmed",
            confirmedAt: new Date("2026-07-05T10:00:00.000Z")
          })
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-new-1",
            contractVersionId: "contract-version-1",
            sourceType: "system",
            sourceTakeoverId: null,
            status: "effective"
          },
          {
            id: "settlement-initial-1",
            contractVersionId: "contract-version-1",
            sourceType: "historical_takeover",
            sourceTakeoverId: "takeover-1",
            status: "effective"
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-request-1", contractVersionId: "contract-version-1", status: "paid" }
        ])
      },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-execution-1", paymentRequestId: "payment-request-1" }
        ])
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-record-1", paymentRequestId: "payment-request-1" }
        ])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const [row] = await service.list("project-1");

    expect(row.postConfirmationVerification).toEqual({
      statusLabel: "已形成闭环",
      summaryText:
        "已看到接管后的新结算、付款申请、实付凭证和财务入账，可作为试运行核验证据继续抽查审计记录。",
      newSettlementCount: 1,
      paymentRequestCount: 1,
      paymentExecutionCount: 1,
      financeRecordCount: 1
    });
  });

  it("does not expose uploader internal account when takeover evidence uploader name is unavailable", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([takeoverRecord()])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-001",
            temporaryCode: null,
            name: "Historical material contract",
            counterparty: "Supplier A"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      archiveRecord: {
        findMany: jest.fn().mockResolvedValue(takeoverEvidenceRecords(["historical_contract_scan"]))
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...takeoverEvidenceFiles(1)[0],
            uploadedByUserId: "uploader-internal-id"
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const [row] = await service.list("project-1");

    expect(row.evidenceFiles).toEqual([
      expect.objectContaining({
        fileName: "接管资料-1.pdf",
        uploadedByName: "上传人未读取"
      })
    ]);
    expect(row.evidenceFiles[0]?.uploadedByName).not.toBe("uploader-internal-id");
  });

  it("explains C level takeover payment risk after confirmation", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({ takeoverLevel: "C", takeoverStatus: "confirmed" })
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            code: "HT-HIS-C",
            temporaryCode: null,
            name: "C level historical contract",
            counterparty: "Supplier C"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const [row] = await service.list("project-1");

    expect(row).toMatchObject({
      levelRiskText: "C级资料缺口明显或存在争议，只能作为受限期初事实，付款前必须重点核验。",
      paymentBlockingHint: "C级资料缺口明显，付款前必须补齐影响金额的资料和争议说明。"
    });
  });
});
