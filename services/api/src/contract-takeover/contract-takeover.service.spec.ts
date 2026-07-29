import { ContractTakeoverService } from "./contract-takeover.service";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";

describe("ContractTakeoverService", () => {
  const audit = {
    record: jest.fn()
  };
  const auth = {
    confirmPassword: jest.fn()
  };
  const files = {
    assertCanDownloadFile: jest.fn(),
    assertCanAttachUnlinkedFile: jest.fn(),
    assertCanUseHistoricalTakeoverFile: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
    files.assertCanDownloadFile.mockReset();
    files.assertCanDownloadFile.mockResolvedValue({ id: "file-1" });
    files.assertCanAttachUnlinkedFile.mockReset();
    files.assertCanAttachUnlinkedFile.mockResolvedValue({ id: "file-1" });
    files.assertCanUseHistoricalTakeoverFile.mockReset();
    files.assertCanUseHistoricalTakeoverFile.mockResolvedValue({ id: "file-1" });
  });

  it("M58 constrains takeover company entity correction status, target and one pending request", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260718110000_contract_takeover_company_entity_corrections/migration.sql"
      ),
      "utf8"
    );

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ContractTakeoverCorrection_pending_company_entity_key"[\s\S]*?WHERE "correctionType" = 'company_entity' AND "status" = 'submitted'/u
    );
    expect(migration).toMatch(
      /CONSTRAINT "ContractTakeoverCorrection_status_check"[\s\S]*?'submitted'[\s\S]*?'confirmed'[\s\S]*?'rejected'/u
    );
    expect(migration).toMatch(
      /CONSTRAINT "ContractTakeoverCorrection_company_entity_target_check"[\s\S]*?"targetCompanyEntityId" IS NOT NULL[\s\S]*?"submittedByUserId" = "createdByUserId"[\s\S]*?"reviewedByUserId" <> "createdByUserId"/u
    );
    expect(migration).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\(candidate_file_id, 74289103\)\)/u
    );
    expect(migration).toContain(
      'CREATE TRIGGER "User_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "signatureFileId"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ApprovalActionLog_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "signatureFileIdSnapshot"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "PaymentExecution_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "voucherFileId"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ContractVersion_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "taxFactEvidenceFileId"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ContractTaxFactRevision_company_entity_correction_file_guard" BEFORE INSERT OR UPDATE OF "evidenceFileId"'
    );

    // M58 is immutable and can only cover references that existed when it was
    // created. The current combined schema manifest is verified independently
    // by unified-file-business-binding-guard.spec.ts.
    expect(migration).toMatch(
      /IF NEW\."correctionType" <> 'company_entity'[\s\S]*?pg_advisory_xact_lock|pg_advisory_xact_lock[\s\S]*?IF NEW\."correctionType" <> 'company_entity'/u
    );
    expect(migration).toMatch(
      /NEW\."correctionType" <> 'company_entity'[\s\S]*?"correctionType" = 'company_entity'[\s\S]*?"id" <> NEW\."id"/u
    );
    expect(migration).toContain(
      `EXECUTE FUNCTION "guard_other_binding_from_company_entity_correction"('id', 'supersedesFileObjectId')`
    );
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
      status: "confirmed",
      targetCompanyEntityId: null,
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
      submittedByUserId: "contract-user",
      submittedAt: new Date("2026-07-04T09:00:00.000Z"),
      reviewedByUserId: "contract-director-1",
      reviewedAt: new Date("2026-07-04T09:00:00.000Z"),
      reviewComment: null,
      createdAt: new Date("2026-07-04T09:00:00.000Z")
    };
  }

  function contractSideInput(overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
      signedAt: "2026-01-10",
      performanceStatus: "performing",
      historicalSettledCents: "700000",
      settlementEvidenceSummary: "历史结算台账和双方确认资料齐全。",
      settlementEvidenceFileIds: ["file-2", "file-1"],
      paymentTerms: {
        originalText: "按历史累计结算余额继续办理后续付款。",
        stages: [
          {
            name: "历史结算尾款",
            ratioBps: 10000,
            dueDays: 0,
            requiresInvoice: false,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ]
      },
      contractFacts: {
        contractNo: "HT-LS-001",
        contractName: "历史材料合同",
        contractTypeKey: "material_purchase",
        counterparty: "历史供应商",
        originalAmountCents: "100000000",
        settlementCutoffDate: "2026-06-30",
        zeroSettlementDeclared: false
      },
      ...overrides
    };
  }

  function contractSideTransaction(options: {
    contractFacts?: Record<string, unknown> | null;
    financeFacts?: Record<string, unknown> | null;
    receipt?: Record<string, unknown> | null;
    takeover?: Record<string, unknown>;
    positionKeys?: readonly string[];
  } = {}) {
    const contractFacts =
      options.contractFacts === undefined
        ? {
            takeoverId: "takeover-1",
            revision: 3,
            financeBasisRevision: 4,
            signedAt: new Date("2026-01-10T00:00:00.000Z"),
            historicalSettledCents: 600000n,
            zeroSettlementDeclared: false,
            performanceStatus: "performing",
            settlementEvidenceSummary: "旧结算依据。",
            paymentTermsSnapshot: {
              originalText: "旧付款条款。",
              stages: []
            },
            contractFactsSnapshot: {
              contractNo: "HT-LS-001",
              contractName: "历史材料合同",
              contractTypeKey: "material_purchase",
              counterparty: "历史供应商",
              originalAmountCents: "100000000",
              settlementCutoffDate: "2026-06-30",
              zeroSettlementDeclared: false
            },
            confirmedRevision: 3,
            confirmedByUserId: "contract-director",
            confirmedAt: new Date("2026-07-28T00:00:00.000Z"),
            updatedByUserId: "contract-user"
          }
        : options.contractFacts;
    const financeFacts =
      options.financeFacts === undefined
        ? {
            takeoverId: "takeover-1",
            revision: 2,
            basedOnContractRevision: 3,
            basedOnFinanceBasisRevision: 4,
            zeroPaymentDeclared: false,
            excessTreatment: null,
            excessReason: null,
            confirmedRevision: 2,
            confirmedContractRevision: 3,
            confirmedFinanceBasisRevision: 4,
            confirmedByUserId: "finance-director",
            confirmedAt: new Date("2026-07-28T00:00:00.000Z"),
            updatedByUserId: "finance-user"
          }
        : options.financeFacts;
    const lockedRows = [
      [options.takeover ?? takeoverRecord()],
      contractFacts ? [contractFacts] : [],
      financeFacts ? [financeFacts] : []
    ];
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(lockedRows.shift() ?? [])),
      contractTakeover: {
        update: jest.fn().mockResolvedValue(takeoverRecord())
      },
      contractTakeoverContractFacts: {
        upsert: jest.fn().mockImplementation(({ create, update }) =>
          Promise.resolve({
            ...(contractFacts ?? create),
            ...update,
            revision: contractFacts ? Number(contractFacts.revision) + 1 : 1,
            financeBasisRevision: update.financeBasisRevision ?? create.financeBasisRevision,
            updatedAt: new Date("2026-07-29T01:00:00.000Z")
          })
        )
      },
      contractTakeoverFinanceFacts: {
        updateMany: jest.fn().mockResolvedValue({ count: financeFacts ? 1 : 0 })
      },
      contractTakeoverSettlementEvidence: {
        findMany: jest.fn().mockResolvedValue([
          { fileId: "file-1" }
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 })
      },
      contractTakeoverSideSaveRequest: {
        findUnique: jest.fn().mockResolvedValue(options.receipt ?? null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue(
          (options.positionKeys ?? ["contract_staff"]).map((key) => ({
            positionId: `position-${key}`
          }))
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue(
          (options.positionKeys ?? ["contract_staff"]).map((key) => ({ key }))
        )
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    return tx;
  }

  it("saves contract-side facts once, invalidates confirmations, and advances finance basis", async () => {
    const tx = contractSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const result = await service.saveContractFacts(
      "project-1",
      "takeover-1",
      contractSideInput() as never,
      "contract-user"
    );

    expect(result).toMatchObject({
      takeoverId: "takeover-1",
      side: "contract",
      revision: 4,
      financeBasisRevision: 5,
      confirmedRevision: null,
      financeConfirmationInvalidated: true
    });
    expect(tx.contractTakeoverContractFacts.upsert).toHaveBeenCalledTimes(1);
    expect(tx.contractTakeoverContractFacts.upsert).toHaveBeenCalledWith({
      where: { takeoverId: "takeover-1" },
      create: expect.objectContaining({
        takeoverId: "takeover-1",
        revision: 1,
        financeBasisRevision: 1,
        historicalSettledCents: 700000n,
        confirmedRevision: null,
        updatedByUserId: "contract-user"
      }),
      update: expect.objectContaining({
        revision: 4,
        financeBasisRevision: 5,
        historicalSettledCents: 700000n,
        confirmedRevision: null,
        confirmedByUserId: null,
        confirmedAt: null
      })
    });
    expect(tx.contractTakeoverFinanceFacts.updateMany).toHaveBeenCalledWith({
      where: { takeoverId: "takeover-1" },
      data: {
        confirmedRevision: null,
        confirmedContractRevision: null,
        confirmedFinanceBasisRevision: null,
        confirmedByUserId: null,
        confirmedAt: null
      }
    });
    expect(tx.contractTakeoverSettlementEvidence.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ fileId: "file-2", displayOrder: 0 }),
        expect.objectContaining({ fileId: "file-1", displayOrder: 1 })
      ]
    });
    expect(files.assertCanDownloadFile).toHaveBeenNthCalledWith(
      1,
      tx,
      "file-1",
      "contract-user"
    );
    expect(files.assertCanDownloadFile).toHaveBeenNthCalledWith(
      2,
      tx,
      "file-2",
      "contract-user"
    );
    expect(files.assertCanAttachUnlinkedFile).toHaveBeenCalledTimes(1);
    expect(files.assertCanAttachUnlinkedFile).toHaveBeenCalledWith(
      tx,
      "file-2",
      "contract-user"
    );
    expect(tx.contractTakeoverSideSaveRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        takeoverId: "takeover-1",
        side: "contract",
        expectedRevision: 3,
        resultRevision: 4,
        requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        expiresAt: expect.any(Date)
      })
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("preserves finance confirmation when only non-basis display facts change", async () => {
    const tx = contractSideTransaction({
      contractFacts: {
        takeoverId: "takeover-1",
        revision: 3,
        financeBasisRevision: 4,
        signedAt: new Date("2026-01-10T00:00:00.000Z"),
        historicalSettledCents: 700000n,
        zeroSettlementDeclared: false,
        performanceStatus: "performing",
        settlementEvidenceSummary: "旧结算依据。",
        paymentTermsSnapshot: contractSideInput().paymentTerms,
        contractFactsSnapshot: {
          ...contractSideInput().contractFacts,
          contractName: "旧展示名称"
        },
        confirmedRevision: 3,
        confirmedByUserId: "contract-director",
        confirmedAt: new Date("2026-07-28T00:00:00.000Z"),
        updatedByUserId: "contract-user"
      }
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const result = await service.saveContractFacts(
      "project-1",
      "takeover-1",
      contractSideInput() as never,
      "contract-user"
    );

    expect(result).toMatchObject({
      revision: 4,
      financeBasisRevision: 4,
      financeConfirmationInvalidated: false
    });
    expect(tx.contractTakeoverFinanceFacts.updateMany).not.toHaveBeenCalled();
  });

  it("replays the same contract-side request without increasing revision or writing audit", async () => {
    const responseSnapshot = {
      takeoverId: "takeover-1",
      side: "contract",
      revision: 4,
      financeBasisRevision: 5,
      confirmedRevision: null,
      financeConfirmationInvalidated: true
    };
    const tx = contractSideTransaction({
      receipt: {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        takeoverId: "takeover-1",
        side: "contract",
        requestSha256: "placeholder",
        responseSnapshot
      }
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );
    const input = contractSideInput();
    const requestSha256 = (service as unknown as {
      takeoverSideRequestSha256(value: unknown): string;
    }).takeoverSideRequestSha256(input);
    tx.contractTakeoverSideSaveRequest.findUnique.mockResolvedValue({
      idempotencyKey: input.idempotencyKey,
      takeoverId: "takeover-1",
      side: "contract",
      requestSha256,
      responseSnapshot
    });

    await expect(
      service.saveContractFacts(
        "project-1",
        "takeover-1",
        input as never,
        "contract-user"
      )
    ).resolves.toEqual(responseSnapshot);
    expect(tx.contractTakeoverContractFacts.upsert).not.toHaveBeenCalled();
    expect(tx.contractTakeoverSettlementEvidence.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractTakeoverSideSaveRequest.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("fails closed on idempotency-key payload mismatch", async () => {
    const tx = contractSideTransaction();
    tx.contractTakeoverSideSaveRequest.findUnique.mockResolvedValue({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      takeoverId: "takeover-1",
      side: "contract",
      requestSha256: "different-request",
      responseSnapshot: {}
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
      service.saveContractFacts(
        "project-1",
        "takeover-1",
        contractSideInput() as never,
        "contract-user"
      )
    ).rejects.toThrow("保存幂等键已用于其他请求");
    expect(tx.contractTakeoverContractFacts.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["stale revision", { expectedRevision: 2 }, {}, "合同侧资料已被其他人更新"],
    [
      "activated takeover",
      {},
      { takeover: takeoverRecord({ activatedAt: new Date("2026-07-28T00:00:00.000Z") }) },
      "历史接管已激活"
    ],
    [
      "non-contract role",
      {},
      { positionKeys: ["finance_director"] },
      "当前岗位不能编辑合同侧接管资料"
    ]
  ] as const)(
    "rejects %s before any contract-side write",
    async (_label, inputOverrides, txOptions, message) => {
      const tx = contractSideTransaction(txOptions);
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
        service.saveContractFacts(
          "project-1",
          "takeover-1",
          contractSideInput(inputOverrides) as never,
          "actor-1"
        )
      ).rejects.toThrow(message);
      expect(tx.contractTakeoverContractFacts.upsert).not.toHaveBeenCalled();
      expect(tx.contractTakeoverSettlementEvidence.deleteMany).not.toHaveBeenCalled();
      expect(tx.contractTakeoverSideSaveRequest.create).not.toHaveBeenCalled();
    }
  );

  it("requires an explicit zero-settlement declaration and basis", async () => {
    const tx = contractSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
      service.saveContractFacts(
        "project-1",
        "takeover-1",
        contractSideInput({
          historicalSettledCents: "0",
          contractFacts: {
            ...contractSideInput().contractFacts,
            zeroSettlementDeclared: false
          }
        }) as never,
        "contract-user"
      )
    ).rejects.toThrow("历史累计结算为零时必须明确声明并填写依据");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects inaccessible settlement evidence before replacing bindings", async () => {
    files.assertCanDownloadFile.mockRejectedValueOnce(new Error("forbidden"));
    const tx = contractSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
      service.saveContractFacts(
        "project-1",
        "takeover-1",
        contractSideInput() as never,
        "contract-user"
      )
    ).rejects.toThrow("结算依据文件不可用、无权访问或已绑定其他业务");
    expect(tx.contractTakeoverSettlementEvidence.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractTakeoverContractFacts.upsert).not.toHaveBeenCalled();
  });

  function financeSideInput(overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
      basedOnContractRevision: 3,
      basedOnFinanceBasisRevision: 4,
      zeroPaymentDeclared: false,
      excessTreatment: "historical_advance",
      excessReason: "超出历史累计结算的部分经核对为历史预付款。",
      excessEvidenceFileIds: ["excess-file-1"],
      payments: [
        {
          rowKey: "row-b",
          amountCents: "500000",
          paidAt: "2026-02-02",
          payerName: "项目公司",
          payeeName: "历史供应商",
          bankReference: "BANK-B",
          paymentMethod: "bank_transfer",
          note: "第二笔",
          voucherFileIds: ["voucher-b-2", "voucher-b-1"]
        },
        {
          rowKey: "row-a",
          amountCents: "400000",
          paidAt: "2026-02-01",
          payerName: "项目公司",
          payeeName: "历史供应商",
          bankReference: "BANK-A",
          paymentMethod: "bank_transfer",
          note: "第一笔",
          voucherFileIds: ["voucher-a-1"]
        }
      ],
      ...overrides
    };
  }

  function financeSideTransaction(options: {
    contractFacts?: Record<string, unknown> | null;
    financeFacts?: Record<string, unknown> | null;
    receipt?: Record<string, unknown> | null;
    takeover?: Record<string, unknown>;
    positionKeys?: readonly string[];
    existingPayments?: Record<string, unknown>[];
    existingVouchers?: Record<string, unknown>[];
    existingExcessEvidence?: Record<string, unknown>[];
  } = {}) {
    const contractFacts =
      options.contractFacts === undefined
        ? {
            takeoverId: "takeover-1",
            revision: 3,
            financeBasisRevision: 4,
            historicalSettledCents: 600000n,
            confirmedRevision: 3
          }
        : options.contractFacts;
    const financeFacts =
      options.financeFacts === undefined
        ? {
            takeoverId: "takeover-1",
            revision: 2,
            basedOnContractRevision: 3,
            basedOnFinanceBasisRevision: 4,
            zeroPaymentDeclared: false,
            excessTreatment: null,
            excessReason: null,
            confirmedRevision: 2,
            confirmedContractRevision: 3,
            confirmedFinanceBasisRevision: 4,
            confirmedByUserId: "finance-director",
            confirmedAt: new Date("2026-07-28T00:00:00.000Z")
          }
        : options.financeFacts;
    const existingPayments = options.existingPayments ?? [];
    const existingVouchers = options.existingVouchers ?? [];
    const lockedRows = [
      [options.takeover ?? takeoverRecord()],
      contractFacts ? [contractFacts] : [],
      financeFacts ? [financeFacts] : [],
      existingPayments,
      existingVouchers
    ];
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() =>
        Promise.resolve(lockedRows.shift() ?? [])
      ),
      contractTakeover: {
        update: jest.fn().mockResolvedValue(takeoverRecord())
      },
      contractTakeoverFinanceFacts: {
        upsert: jest.fn().mockImplementation(({ create, update }) =>
          Promise.resolve({
            ...(financeFacts ?? create),
            ...update,
            revision: financeFacts ? Number(financeFacts.revision) + 1 : 1,
            updatedAt: new Date("2026-07-29T02:00:00.000Z")
          })
        )
      },
      contractTakeoverHistoricalPaymentAllocation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverHistoricalPaymentVoucher: {
        deleteMany: jest.fn().mockResolvedValue({ count: existingVouchers.length }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverHistoricalPayment: {
        deleteMany: jest.fn().mockResolvedValue({ count: existingPayments.length }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `payment-${data.rowKey}`,
            ...data
          })
        )
      },
      contractTakeoverExcessEvidence: {
        findMany: jest.fn().mockResolvedValue(
          options.existingExcessEvidence ?? []
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverSideSaveRequest: {
        findUnique: jest.fn().mockResolvedValue(options.receipt ?? null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue(
          (options.positionKeys ?? ["finance_staff"]).map((key) => ({
            positionId: `position-${key}`
          }))
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue(
          (options.positionKeys ?? ["finance_staff"]).map((key) => ({ key }))
        )
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        create: jest.fn()
      },
      paymentRequest: {
        create: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      },
      contractTakeoverBalanceAccount: {
        create: jest.fn()
      }
    };
    return tx;
  }

  it("saves finance facts by payment item and derives stable allocation previews", async () => {
    const tx = financeSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const result = await service.saveFinanceFacts(
      "project-1",
      "takeover-1",
      financeSideInput() as never,
      "finance-user"
    );

    expect(result).toMatchObject({
      takeoverId: "takeover-1",
      side: "finance",
      revision: 3,
      basedOnContractRevision: 3,
      basedOnFinanceBasisRevision: 4,
      totalPaidCents: "900000",
      settlementAllocatedCents: "600000",
      excessAllocatedCents: "300000",
      confirmedRevision: null
    });
    expect(tx.contractTakeoverFinanceFacts.upsert).toHaveBeenCalledWith({
      where: { takeoverId: "takeover-1" },
      create: expect.objectContaining({
        revision: 1,
        basedOnContractRevision: 3,
        basedOnFinanceBasisRevision: 4,
        confirmedRevision: null
      }),
      update: expect.objectContaining({
        revision: 3,
        basedOnContractRevision: 3,
        basedOnFinanceBasisRevision: 4,
        confirmedRevision: null,
        confirmedContractRevision: null,
        confirmedFinanceBasisRevision: null
      })
    });
    expect(tx.contractTakeoverHistoricalPayment.create).toHaveBeenNthCalledWith(
      1,
      {
        data: expect.objectContaining({
          rowKey: "row-a",
          sequenceNo: 1,
          amountCents: 400000n
        })
      }
    );
    expect(tx.contractTakeoverHistoricalPayment.create).toHaveBeenNthCalledWith(
      2,
      {
        data: expect.objectContaining({
          rowKey: "row-b",
          sequenceNo: 2,
          amountCents: 500000n
        })
      }
    );
    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.createMany
    ).toHaveBeenNthCalledWith(1, {
      data: [
        {
          historicalPaymentId: "payment-row-a",
          allocationType: "settlement",
          amountCents: 400000n,
          allocationOrder: 0
        }
      ]
    });
    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.createMany
    ).toHaveBeenNthCalledWith(2, {
      data: [
        {
          historicalPaymentId: "payment-row-b",
          allocationType: "settlement",
          amountCents: 200000n,
          allocationOrder: 0
        },
        {
          historicalPaymentId: "payment-row-b",
          allocationType: "historical_advance",
          amountCents: 300000n,
          allocationOrder: 1
        }
      ]
    });
    expect(files.assertCanUseHistoricalTakeoverFile.mock.calls.map((call) => call[1]))
      .toEqual([
        "excess-file-1",
        "voucher-a-1",
        "voucher-b-1",
        "voucher-b-2"
      ]);
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: { historicalPaidCents: 900000n }
    });
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.contractTakeoverBalanceAccount.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "full contract revision",
      { basedOnContractRevision: 2 },
      "合同侧资料已变化，请刷新后重新核对"
    ],
    [
      "finance basis revision",
      { basedOnFinanceBasisRevision: 3 },
      "合同侧财务基线已变化，请刷新后重新核对"
    ]
  ] as const)(
    "rejects stale %s before any finance write",
    async (_label, inputOverrides, message) => {
      const tx = financeSideTransaction();
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
        service.saveFinanceFacts(
          "project-1",
          "takeover-1",
          financeSideInput(inputOverrides) as never,
          "finance-user"
        )
      ).rejects.toThrow(message);
      expect(tx.contractTakeoverFinanceFacts.upsert).not.toHaveBeenCalled();
      expect(tx.contractTakeoverHistoricalPayment.create).not.toHaveBeenCalled();
      expect(tx.contractTakeoverSideSaveRequest.create).not.toHaveBeenCalled();
    }
  );

  it("rejects one voucher reused across historical payment rows", async () => {
    const tx = financeSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );
    const payments = financeSideInput().payments.map((payment) => ({
      ...payment,
      voucherFileIds: ["shared-voucher"]
    }));

    await expect(
      service.saveFinanceFacts(
        "project-1",
        "takeover-1",
        financeSideInput({ payments }) as never,
        "finance-user"
      )
    ).rejects.toThrow("同一付款凭证不能重复使用或绑定到多笔历史实付");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a historical payment total outside PostgreSQL bigint range", async () => {
    const tx = financeSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );
    const payments = [
      {
        rowKey: "row-a",
        amountCents: "9223372036854775807",
        paidAt: "2026-02-01",
        voucherFileIds: ["voucher-a"]
      },
      {
        rowKey: "row-b",
        amountCents: "1",
        paidAt: "2026-02-02",
        voucherFileIds: ["voucher-b"]
      }
    ];

    await expect(
      service.saveFinanceFacts(
        "project-1",
        "takeover-1",
        financeSideInput({ payments }) as never,
        "finance-user"
      )
    ).rejects.toThrow("历史实付合计超出系统可保存范围");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "blank zero-payment declaration",
      { payments: [], zeroPaymentDeclared: false },
      "没有历史实付时必须明确提交零付款声明"
    ],
    [
      "zero declaration with payments",
      { zeroPaymentDeclared: true },
      "存在历史实付时不能提交零付款声明"
    ],
    [
      "payment without voucher",
      {
        payments: [
          {
            rowKey: "row-a",
            amountCents: "100",
            paidAt: "2026-02-01",
            voucherFileIds: []
          }
        ],
        excessTreatment: undefined,
        excessReason: undefined,
        excessEvidenceFileIds: []
      },
      "每笔历史实付至少需要一份付款凭证"
    ]
  ] as const)(
    "validates %s before opening a transaction",
    async (_label, inputOverrides, message) => {
      const tx = financeSideTransaction();
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
        service.saveFinanceFacts(
          "project-1",
          "takeover-1",
          financeSideInput(inputOverrides as Record<string, unknown>) as never,
          "finance-user"
        )
      ).rejects.toThrow(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      { excessTreatment: undefined },
      "历史实付超出累计结算时必须选择超额分类"
    ],
    [
      { excessReason: " " },
      "历史实付超出累计结算时必须填写分类原因"
    ],
    [
      { excessEvidenceFileIds: [] },
      "历史实付超出累计结算时必须上传独立分类依据"
    ],
    [
      { excessEvidenceFileIds: ["voucher-a-1"] },
      "超额分类依据不能复用付款凭证"
    ]
  ] as const)(
    "requires independent excess classification evidence",
    async (inputOverrides, message) => {
      const tx = financeSideTransaction();
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
        service.saveFinanceFacts(
          "project-1",
          "takeover-1",
          financeSideInput(inputOverrides as Record<string, unknown>) as never,
          "finance-user"
        )
      ).rejects.toThrow(message);
      expect(tx.contractTakeoverFinanceFacts.upsert).not.toHaveBeenCalled();
    }
  );

  it("replays the same finance request and rejects the same key with another request", async () => {
    const responseSnapshot = {
      takeoverId: "takeover-1",
      side: "finance",
      revision: 3,
      totalPaidCents: "900000"
    };
    const tx = financeSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );
    const input = financeSideInput();
    const requestSha256 = (service as unknown as {
      takeoverSideRequestSha256(value: unknown): string;
    }).takeoverSideRequestSha256(input);
    tx.contractTakeoverSideSaveRequest.findUnique.mockResolvedValue({
      idempotencyKey: input.idempotencyKey,
      takeoverId: "takeover-1",
      side: "finance",
      requestSha256,
      responseSnapshot
    });

    await expect(
      service.saveFinanceFacts(
        "project-1",
        "takeover-1",
        input as never,
        "finance-user"
      )
    ).resolves.toEqual(responseSnapshot);
    expect(tx.contractTakeoverFinanceFacts.upsert).not.toHaveBeenCalled();

    tx.contractTakeoverSideSaveRequest.findUnique.mockResolvedValue({
      idempotencyKey: input.idempotencyKey,
      takeoverId: "takeover-1",
      side: "finance",
      requestSha256: "different-request",
      responseSnapshot
    });
    tx.$queryRaw.mockResolvedValueOnce([takeoverRecord()]);
    await expect(
      service.saveFinanceFacts(
        "project-1",
        "takeover-1",
        input as never,
        "finance-user"
      )
    ).rejects.toThrow("保存幂等键已用于其他请求");
  });

  it.each([
    [
      "stale finance revision",
      { expectedRevision: 1 },
      {},
      "财务侧资料已被其他人更新"
    ],
    [
      "activated takeover",
      {},
      {
        takeover: takeoverRecord({
          activatedAt: new Date("2026-07-28T00:00:00.000Z")
        })
      },
      "历史接管已激活"
    ],
    [
      "non-finance role",
      {},
      { positionKeys: ["contract_director"] },
      "当前岗位不能编辑财务侧接管资料"
    ]
  ] as const)(
    "rejects %s before replacing historical payments",
    async (_label, inputOverrides, txOptions, message) => {
      const tx = financeSideTransaction(txOptions);
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
        service.saveFinanceFacts(
          "project-1",
          "takeover-1",
          financeSideInput(inputOverrides) as never,
          "actor-1"
        )
      ).rejects.toThrow(message);
      expect(tx.contractTakeoverHistoricalPayment.deleteMany).not.toHaveBeenCalled();
      expect(tx.contractTakeoverFinanceFacts.upsert).not.toHaveBeenCalled();
    }
  );

  it("rejects an inaccessible or cross-bound voucher before replacing finance facts", async () => {
    files.assertCanUseHistoricalTakeoverFile.mockRejectedValueOnce(
      new Error("bound")
    );
    const tx = financeSideTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
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
      service.saveFinanceFacts(
        "project-1",
        "takeover-1",
        financeSideInput() as never,
        "finance-user"
      )
    ).rejects.toThrow("历史付款凭证或超额依据不可用、无权访问或已绑定其他业务");
    expect(tx.contractTakeoverHistoricalPayment.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractTakeoverFinanceFacts.upsert).not.toHaveBeenCalled();
  });

  function sideConfirmationTransaction(options: {
    contractFacts?: Record<string, unknown>;
    financeFacts?: Record<string, unknown>;
    takeover?: Record<string, unknown>;
    positionKey?: string;
    event?: Record<string, unknown> | null;
  } = {}) {
    const contractFacts = options.contractFacts ?? {
      takeoverId: "takeover-1",
      revision: 3,
      financeBasisRevision: 4,
      confirmedRevision: null,
      confirmedByUserId: null,
      confirmedAt: null
    };
    const financeFacts = options.financeFacts ?? {
      takeoverId: "takeover-1",
      revision: 2,
      basedOnContractRevision: 3,
      basedOnFinanceBasisRevision: 4,
      confirmedRevision: null,
      confirmedContractRevision: null,
      confirmedFinanceBasisRevision: null,
      confirmedByUserId: null,
      confirmedAt: null
    };
    const lockedRows = [
      [options.takeover ?? takeoverRecord()],
      [contractFacts],
      [financeFacts],
      [],
      [],
      [{ id: "contract-1" }],
      [{ id: "contract-version-1" }],
      [{ id: "terms-version-1" }]
    ];
    const positionKey = options.positionKey ?? "contract_director";
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() =>
        Promise.resolve(lockedRows.shift() ?? [])
      ),
      contractTakeoverContractFacts: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverFinanceFacts: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverConfirmationEvent: {
        findUnique: jest.fn().mockResolvedValue(options.event ?? null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: "event-1", ...data })
        )
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([
          { positionId: `position-${positionKey}` }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: positionKey }])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    return tx;
  }

  function confirmSideInput(overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 3,
      currentPassword: "not-a-real-password",
      ...overrides
    };
  }

  it("lets only the contract director confirm the current contract revision without early activation", async () => {
    const tx = sideConfirmationTransaction();
    const prisma = {
      $transaction: jest.fn(
        async (
          callback: (client: typeof tx) => unknown
        ) => callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    const result = await service.confirmContractSide(
      "project-1",
      "takeover-1",
      confirmSideInput() as never,
      "contract-director"
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "contract-director",
      "not-a-real-password"
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    expect(tx.contractTakeoverContractFacts.updateMany).toHaveBeenCalledWith({
      where: {
        takeoverId: "takeover-1",
        revision: 3,
        confirmedRevision: null
      },
      data: expect.objectContaining({
        confirmedRevision: 3,
        confirmedByUserId: "contract-director",
        confirmedAt: expect.any(Date)
      })
    });
    expect(result).toMatchObject({
      side: "contract",
      revision: 3,
      confirmed: true,
      activated: false,
      activationStatus: "awaiting_finance_confirmation"
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract_takeover.contract_side.confirm",
        metadata: expect.not.objectContaining({
          currentPassword: expect.anything()
        })
      })
    );
    expect(JSON.stringify(audit.record.mock.calls.at(-1))).not.toContain(
      "not-a-real-password"
    );
  });

  it("confirms finance basis and invokes activation coordination inside the same transaction", async () => {
    const tx = sideConfirmationTransaction({
      positionKey: "finance_director",
      contractFacts: {
        takeoverId: "takeover-1",
        revision: 4,
        financeBasisRevision: 4,
        confirmedRevision: 4,
        confirmedByUserId: "contract-director",
        confirmedAt: new Date("2026-07-29T01:00:00.000Z")
      }
    });
    const prisma = {
      $transaction: jest.fn(
        async (
          callback: (client: typeof tx) => unknown
        ) => callback(tx)
      )
    };
    const activate = jest.fn().mockResolvedValue({
      activated: true,
      activationStatus: "activated"
    });
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never,
      { tryActivateInTransaction: activate } as never
    );

    const result = await service.confirmFinanceSide(
      "project-1",
      "takeover-1",
      confirmSideInput({
        expectedRevision: 2,
        basedOnContractRevision: 3,
        basedOnFinanceBasisRevision: 4
      }) as never,
      "finance-director"
    );

    expect(tx.contractTakeoverFinanceFacts.updateMany).toHaveBeenCalledWith({
      where: {
        takeoverId: "takeover-1",
        revision: 2,
        confirmedRevision: null
      },
      data: expect.objectContaining({
        confirmedRevision: 2,
        confirmedContractRevision: 3,
        confirmedFinanceBasisRevision: 4,
        confirmedByUserId: "finance-director"
      })
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(
      tx,
      "takeover-1",
      "finance-director",
      "33333333-3333-4333-8333-333333333333"
    );
    expect(result).toMatchObject({
      side: "finance",
      confirmed: true,
      activated: true,
      activationStatus: "activated"
    });
  });

  it.each([
    [
      "contract staff",
      "contract",
      { positionKey: "contract_staff" },
      confirmSideInput(),
      "仅合同部主管可以确认合同侧接管资料"
    ],
    [
      "finance staff",
      "finance",
      { positionKey: "finance_staff" },
      confirmSideInput({
        expectedRevision: 2,
        basedOnContractRevision: 3,
        basedOnFinanceBasisRevision: 4
      }),
      "仅财务主管可以确认财务侧接管资料"
    ],
    [
      "stale contract revision",
      "contract",
      {},
      confirmSideInput({ expectedRevision: 2 }),
      "合同侧确认修订已过期"
    ],
    [
      "stale finance basis",
      "finance",
      { positionKey: "finance_director" },
      confirmSideInput({
        expectedRevision: 2,
        basedOnContractRevision: 3,
        basedOnFinanceBasisRevision: 3
      }),
      "财务确认所依据的合同基线已过期"
    ]
  ] as const)(
    "rejects %s without a confirmation write",
    async (_label, side, txOptions, input, message) => {
      const tx = sideConfirmationTransaction(txOptions);
      const prisma = {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx)
        )
      };
      const service = new ContractTakeoverService(
        prisma as never,
        audit as never,
        auth as never,
        files as never
      );

      const operation = side === "contract"
        ? service.confirmContractSide(
            "project-1",
            "takeover-1",
            input as never,
            "actor-1"
          )
        : service.confirmFinanceSide(
            "project-1",
            "takeover-1",
            input as never,
            "actor-1"
          );
      await expect(operation).rejects.toThrow(message);
      expect(tx.contractTakeoverContractFacts.updateMany).not.toHaveBeenCalled();
      expect(tx.contractTakeoverFinanceFacts.updateMany).not.toHaveBeenCalled();
      expect(tx.contractTakeoverConfirmationEvent.create).not.toHaveBeenCalled();
    }
  );

  it("withdraws only the current side confirmation with a reason and rejects withdrawal after activation", async () => {
    const tx = sideConfirmationTransaction({
      contractFacts: {
        takeoverId: "takeover-1",
        revision: 3,
        financeBasisRevision: 4,
        confirmedRevision: 3,
        confirmedByUserId: "contract-director",
        confirmedAt: new Date("2026-07-29T01:00:00.000Z")
      }
    });
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.withdrawContractSideConfirmation(
        "project-1",
        "takeover-1",
        {
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
          expectedRevision: 3,
          currentPassword: "not-a-real-password",
          reason: "发现合同编号仍需核对。"
        } as never,
        "contract-director"
      )
    ).resolves.toMatchObject({
      side: "contract",
      revision: 3,
      confirmed: false
    });
    expect(tx.contractTakeoverContractFacts.updateMany).toHaveBeenCalledWith({
      where: {
        takeoverId: "takeover-1",
        revision: 3,
        confirmedRevision: 3
      },
      data: {
        confirmedRevision: null,
        confirmedByUserId: null,
        confirmedAt: null
      }
    });
    expect(tx.contractTakeoverFinanceFacts.updateMany).not.toHaveBeenCalled();
    expect(tx.contractTakeoverConfirmationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "withdraw",
        reason: "发现合同编号仍需核对。"
      })
    });

    const activatedTx = sideConfirmationTransaction({
      takeover: takeoverRecord({
        activatedAt: new Date("2026-07-29T02:00:00.000Z")
      })
    });
    const activatedService = new ContractTakeoverService(
      {
        $transaction: jest.fn(
          async (callback: (client: typeof activatedTx) => unknown) =>
            callback(activatedTx)
        )
      } as never,
      audit as never,
      auth as never,
      files as never
    );
    await expect(
      activatedService.withdrawContractSideConfirmation(
        "project-1",
        "takeover-1",
        {
          idempotencyKey: "55555555-5555-4555-8555-555555555555",
          expectedRevision: 3,
          currentPassword: "not-a-real-password",
          reason: "尝试撤回。"
        } as never,
        "contract-director"
      )
    ).rejects.toThrow("历史接管已激活，不能撤回部门确认");
  });

  it("replays the first confirmation response by action idempotency key", async () => {
    const responseSnapshot = {
      side: "contract",
      revision: 3,
      confirmed: true,
      activated: false
    };
    const tx = sideConfirmationTransaction({
      event: {
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        takeoverId: "takeover-1",
        side: "contract",
        action: "confirm",
        revision: 3,
        observedOtherSideRevision: 2,
        observedFinanceBasisRevision: 4,
        reason: null,
        actorUserId: "contract-director",
        responseSnapshot
      }
    });
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.confirmContractSide(
        "project-1",
        "takeover-1",
        confirmSideInput() as never,
        "contract-director"
      )
    ).resolves.toEqual(responseSnapshot);
    expect(tx.contractTakeoverContractFacts.updateMany).not.toHaveBeenCalled();
    expect(tx.contractTakeoverConfirmationEvent.create).not.toHaveBeenCalled();
  });

  it("lists active, inactive and legacy-incomplete company entities for historical matching", async () => {
    const candidates = [
      {
        id: "entity-active",
        name: "在用主体",
        unifiedSocialCreditCode: "91530100ACTIVE",
        dataStatus: "complete",
        isActive: true
      },
      {
        id: "entity-inactive",
        name: "历史停用主体",
        unifiedSocialCreditCode: null,
        dataStatus: "legacy_incomplete",
        isActive: false
      }
    ];
    const prisma = {
      companyEntity: { findMany: jest.fn().mockResolvedValue(candidates) }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never);

    await expect(service.listCompanyEntityCandidates()).resolves.toEqual(candidates);
    expect(prisma.companyEntity.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        unifiedSocialCreditCode: true,
        dataStatus: true,
        isActive: true
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }]
    });
  });

  it("validates a selected historical company entity while preserving the original name", async () => {
    const tx = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "entity-inactive" }) },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract-1" }) },
      contractVersion: { create: jest.fn().mockResolvedValue({ id: "contract-version-1" }) },
      paymentTermsVersion: { create: jest.fn().mockResolvedValue({ id: "terms-version-1" }) },
      paymentTermsStage: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contractTakeover: { create: jest.fn().mockResolvedValue(takeoverRecord()) }
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never);

    await service.create("project-1", {
      code: "HT-ENTITY-001",
      name: "历史主体匹配合同",
      counterparty: "历史供应商",
      companyEntityId: "entity-inactive",
      companyEntityName: "扫描件原文：云南旧公司",
      amountCents: "10000",
      signedAt: "2026-01-10",
      takeoverLevel: "A",
      lifecycleStatus: "in_progress",
      reviewComment: "历史资料完整，确认按A级接管"
    }, "contract-user");

    expect(tx.companyEntity.findUnique).toHaveBeenCalledWith({
      where: { id: "entity-inactive" },
      select: { id: true }
    });
    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyEntityId: "entity-inactive",
        companyEntityName: "扫描件原文：云南旧公司"
      })
    });
  });

  it("rejects an unknown company entity before creating historical contract facts", async () => {
    const tx = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      companyEntity: { findUnique: jest.fn().mockResolvedValue(null) },
      contract: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never);

    await expect(service.create("project-1", {
      code: "HT-ENTITY-002",
      name: "错误主体匹配合同",
      counterparty: "历史供应商",
      companyEntityId: "missing-entity",
      companyEntityName: "原文主体",
      amountCents: "10000",
      signedAt: "2026-01-10",
      takeoverLevel: "A",
      lifecycleStatus: "in_progress",
      reviewComment: "历史资料完整，确认按A级接管"
    }, "contract-user")).rejects.toThrow("所选我方签约主体不存在，请重新选择");
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("creates a historical contract takeover draft on existing contract tables", async () => {
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({ id: "entity-historical-1" })
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
            responsibleUserId: "contract-user",
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
        amountCents: "1000000",
        signedAt: "2026-01-10",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "Monthly settlement, pay 80% after archive.",
        historicalSettledCents: "600000",
        historicalApprovalPendingPaymentCents: "40000",
        historicalApprovedPendingPaymentCents: "100000",
        historicalPaidCents: "300000",
        historicalProxyPaidCents: "20000",
        historicalAdvancePaidCents: "50000",
        historicalAdvanceDeductedCents: "10000",
        historicalRetentionWithheldCents: "30000",
        historicalRetentionReleasedCents: "0",
        otherConfirmedOccupancyCents: "5000",
        balanceSourceSummary: "Finance ledger checked.",
        evidenceSummary: "Signed scan and finance ledger.",
        takeoverCutoffDate: "2026-06-30",
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
      responsibleUserId: "contract-user",
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
        responsibleUserId: "contract-user",
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

  it("persists manually entered direct payment stages for a generic contract takeover", async () => {
    const tx = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract-1" }) },
      contractVersion: { create: jest.fn().mockResolvedValue({ id: "contract-version-1" }) },
      paymentTermsVersion: { create: jest.fn().mockResolvedValue({ id: "terms-version-1" }) },
      paymentTermsStage: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      contractTakeover: {
        create: jest.fn().mockResolvedValue(takeoverRecord())
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.create(
      "project-1",
      {
        code: "HT-TY-001",
        name: "历史通用合同",
        counterparty: "供应商A",
        contractTypeKey: "generic_contract",
        amountCents: "1000000",
        signedAt: "2026-01-10",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "合同生效后付预算款，验收后付尾款。",
        paymentStages: [
          {
            name: "首期合同款",
            ratioBps: 3000,
            dueDays: 7,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: false
          },
          {
            name: "验收尾款",
            fixedAmountCents: "700000",
            dueDays: 30,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ],
        historicalSettledCents: "0",
        historicalPaidCents: "0",
        balanceSourceSummary: "已核对原合同。",
        evidenceSummary: "原合同扫描件。"
      },
      "contract-user"
    );

    expect(result).toMatchObject({
      contractTypeKey: "generic_contract",
      paymentStages: [
        expect.objectContaining({ name: "首期合同款", ratioBps: 3000 }),
        expect.objectContaining({ name: "验收尾款", fixedAmountCents: "700000" })
      ]
    });

    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-version-1",
          name: "首期合同款",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: 3000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 7,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: false
        }),
        expect.objectContaining({
          name: "验收尾款",
          ratioBps: null,
          fixedAmountCents: 700000n,
          dueDays: 30,
          allowsInstallments: true
        })
      ]
    });
  });

  it("rejects generic takeover without explicit direct stages and settlement contracts with them", async () => {
    const tx = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract-1" }) },
      contractVersion: { create: jest.fn().mockResolvedValue({ id: "contract-version-1" }) },
      paymentTermsVersion: { create: jest.fn().mockResolvedValue({ id: "terms-version-1" }) },
      paymentTermsStage: { createMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);
    const base = {
      code: "HT-001",
      name: "历史合同",
      counterparty: "供应商A",
      amountCents: "1000000",
      signedAt: "2026-01-10",
      takeoverLevel: "A" as const,
      lifecycleStatus: "in_progress" as const,
      historicalSettledCents: "0",
      historicalPaidCents: "0",
      balanceSourceSummary: "已核对。",
      evidenceSummary: "已核对。"
    };

    await expect(
      service.create("project-1", { ...base, contractTypeKey: "generic_contract" }, "user-1")
    ).rejects.toThrow("必须按原合同条款录入至少一个直接付款阶段");
    await expect(
      service.create(
        "project-1",
        {
          ...base,
          contractTypeKey: "material_purchase",
          paymentStages: [{
            name: "合同款",
            ratioBps: 5000,
            dueDays: 0,
            requiresInvoice: false,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }]
        },
        "user-1"
      )
    ).rejects.toThrow("必须依据生效结算付款");
  });

  it.each([
    "material_purchase",
    "equipment_rental",
    "labor_subcontract",
    "professional_subcontract"
  ])("keeps the current-settlement initial stage for %s takeover", async (contractTypeKey) => {
    const tx = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract-1" }) },
      contractVersion: { create: jest.fn().mockResolvedValue({ id: "contract-version-1" }) },
      paymentTermsVersion: { create: jest.fn().mockResolvedValue({ id: "terms-version-1" }) },
      paymentTermsStage: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contractTakeover: { create: jest.fn().mockResolvedValue(takeoverRecord()) },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await service.create(
      "project-1",
      {
        code: `HT-${contractTypeKey}`,
        name: "历史结算类合同",
        counterparty: "供应商A",
        contractTypeKey,
        amountCents: "1000000",
        signedAt: "2026-01-10",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "按生效结算付款。",
        historicalSettledCents: "0",
        historicalPaidCents: "0",
        balanceSourceSummary: "已核对。",
        evidenceSummary: "已核对。"
      },
      "contract-user"
    );

    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: "接管期初结算款",
          basis: "current_settlement",
          ratioBps: 10000,
          triggerAnchor: "settlement_effective"
        })
      ]
    });
  });

  it("preserves historical tax gaps and creates unconfirmed pricing facts without guessing", async () => {
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
      contractBill: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: "bill-1" })
      },
      contractBillRow: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 2 })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeover: {
        create: jest.fn().mockResolvedValue(takeoverRecord())
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await service.create(
      "project-1",
      {
        code: "HT-HIS-TAX-001",
        name: "历史含税计价合同",
        counterparty: "历史供应商",
        amountCents: "0",
        signedAt: "2026-01-10",
        takeoverLevel: "B",
        lifecycleStatus: "in_progress",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        pricingItems: [
          {
            billKey: "main",
            billName: "历史清单",
            rowKey: "row-complete",
            itemName: "已知项目",
            unit: "项",
            estimatedQuantity: "2",
            taxInclusiveUnitPrice: "100"
          },
          {
            billKey: "main",
            billName: "历史清单",
            rowKey: "row-missing",
            itemName: "原合同未明确价格的项目",
            unit: "项"
          }
        ]
      },
      "contract-user"
    );

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceType: null,
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        taxFactStatus: "unconfirmed",
        pricingNature: "framework",
        amountLimitType: "unlimited",
        amountSource: "bill_sum"
      })
    });
    expect(tx.contractBill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "contract-version-1",
        billKey: "main",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        taxInclusiveAmountCents: 20_000n,
        taxExclusiveAmountCents: 17_699n,
        taxAmountCents: 2_301n
      })
    });
    expect(tx.contractBillRow.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          contractBillId: "bill-1",
          rowKey: "row-complete",
          quantity: "2",
          unitPrice: "100",
          taxRate: "13",
          taxRateSource: "version_default",
          pricingFactStatus: "unconfirmed",
          precisionPolicy: "two_decimal",
          taxInclusiveAmountCents: 20_000n,
          taxExclusiveAmountCents: 17_699n,
          taxAmountCents: 2_301n
        }),
        expect.objectContaining({
          contractBillId: "bill-1",
          rowKey: "row-missing",
          quantity: null,
          unitPrice: null,
          taxRate: "13",
          pricingFactStatus: "unconfirmed",
          taxInclusiveAmountCents: null,
          taxExclusiveAmountCents: null,
          taxAmountCents: null
        })
      ]
    });
  });

  it("returns a Chinese business error for an invalid historical contract tax rate", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(
      service.create(
        "project-1",
        {
          code: "HT-HIS-TAX-INVALID",
          name: "历史税率异常合同",
          counterparty: "历史供应商",
          amountCents: "100",
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          defaultTaxRatePercent: "13.1234567"
        },
        "contract-user"
      )
    ).rejects.toThrow("默认税率必须是 0 到 100 之间且最多 6 位小数的数字");
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
          amountCents: "1000000",
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          historicalSettledCents: "-1"
        },
        "contract-user"
      )
    ).rejects.toThrow("历史累计结算必须填写 0 或更大的金额");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("requires adjustment reason when takeover level differs from system suggestion", async () => {
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
          amountCents: "1000000",
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          historicalApprovedPendingPaymentCents: "20000",
          balanceSourceSummary: "Finance ledger checked.",
          evidenceSummary: "Signed scan and finance ledger."
        },
        "contract-user"
      )
    ).rejects.toThrow("接管等级与系统建议不一致，请填写等级调整说明");

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
          amountCents: "1000000",
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
          amountCents: "1000000",
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
          amountCents: "2000000",
          signedAt: "2026-01-11",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress"
        },
        {
          code: "HT-HIS-READY",
          name: "Ready contract",
          counterparty: "Supplier D",
          amountCents: "3000000",
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
          amountCents: -1n,
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
      warningRows: 4,
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

  it("blocks generic contract batch import because direct stages require manual verification", async () => {
    const prisma = { contract: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-GENERIC-001",
          name: "历史通用合同",
          counterparty: "供应商A",
          contractTypeKey: "generic_contract",
          amountCents: "1000000",
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按原合同阶段付款。",
          balanceSourceSummary: "已核对。",
          evidenceSummary: "已核对。",
          evidenceChecklist: "原合同扫描件",
          issueSummary: "无"
        }
      ]
    });

    expect(result.rows[0]).toMatchObject({ status: "blocked" });
    expect(result.rows[0]?.issues).toContainEqual(
      expect.objectContaining({
        field: "contractTypeKey",
        level: "error",
        message: expect.stringContaining("手工录入直接付款阶段")
      })
    );
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
          amountCents: 0n,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          historicalSettledCents: -1n
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
          message: "合同金额必须大于 0；无总价框架合同可填写 0，但必须提供计价清单"
        })
      ])
    );
  });

  it("accepts the PostgreSQL BIGINT maximum in import precheck money fields", async () => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);
    const max = "9223372036854775807";

    const result = await service.precheckImport("project-1", {
      rows: [
        {
          code: "HT-HIS-MAX",
          name: "历史金额上限合同",
          counterparty: "历史供应商",
          amountCents: max,
          signedAt: "2026-01-10",
          takeoverLevel: "B",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款",
          balanceSourceSummary: "财务台账已核对",
          evidenceSummary: "合同扫描件和付款凭证已归档",
          evidenceChecklist: "合同扫描件、历史结算台账、付款凭证",
          historicalApprovalPendingPaymentCents: max,
          historicalApprovedPendingPaymentCents: max,
          historicalProxyPaidCents: max,
          historicalRetentionWithheldCents: max,
          otherConfirmedOccupancyCents: max
        }
      ]
    });

    expect(result).toMatchObject({ readyRows: 1, blockedRows: 0 });
    expect(result.rows[0]).toMatchObject({ status: "ready", amountCents: max });
    expect(result.rows[0].issues.filter((item) => item.level === "error")).toEqual([]);
  });

  it.each([
    "amountCents",
    "historicalApprovalPendingPaymentCents",
    "historicalApprovedPendingPaymentCents",
    "historicalProxyPaidCents",
    "historicalRetentionWithheldCents",
    "otherConfirmedOccupancyCents"
  ])("turns an out-of-range import %s into a blocked row issue", async (field) => {
    const prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    for (const value of ["9223372036854775808", "9".repeat(1000)]) {
      const result = await service.precheckImport("project-1", {
        rows: [
          {
            code: `HT-HIS-${field}`,
            name: "历史金额越界合同",
            counterparty: "历史供应商",
            amountCents: "1000000",
            signedAt: "2026-01-10",
            takeoverLevel: "B",
            lifecycleStatus: "in_progress",
            paymentTermsOriginalText: "按月结算付款",
            balanceSourceSummary: "财务台账已核对",
            evidenceSummary: "合同扫描件和付款凭证已归档",
            evidenceChecklist: "合同扫描件、历史结算台账、付款凭证",
            [field]: value
          }
        ]
      });

      expect(result).toMatchObject({ readyRows: 0, blockedRows: 1 });
      expect(result.rows[0]).toMatchObject({ status: "blocked" });
      expect(result.rows[0].issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ field, level: "error" })])
      );
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("does not write import drafts when an out-of-range row is blocked by precheck", async () => {
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
          takeoverCutoffDate: "2026-07-10",
          responsibleUserId: "contract-director-1",
          reviewComment: "合同部已完成预检。",
          acceptanceConclusion: "越界行不能生成草稿。",
          rows: [
            {
              code: "HT-HIS-OVERFLOW",
              name: "历史金额越界合同",
              counterparty: "历史供应商",
              amountCents: "9223372036854775808",
              signedAt: "2026-01-10",
              takeoverLevel: "B",
              lifecycleStatus: "in_progress"
            }
          ]
        },
        "contract-user"
      )
    ).rejects.toThrow("导入预检仍有错误行，请先修正后再生成接管草稿");
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
          amountCents: "1000000",
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
          amountCents: "1000000",
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
          amountCents: "1000000",
          signedAt: "2026-01-10",
          takeoverLevel: "A",
          lifecycleStatus: "in_progress",
          paymentTermsOriginalText: "按月结算付款",
          historicalApprovedPendingPaymentCents: "20000",
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
          amountCents: "1000000",
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
          amountCents: "1000000",
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
              amountCents: "1000000",
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
          amountCents: "1000000",
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
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({ id: "entity-historical-1" })
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
        create: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverStatus: "draft",
            takeoverLevel: "A",
            suggestedTakeoverLevel: "B",
            takeoverLevelAdjustmentReason: "发票待补，财务复核时重点确认",
            historicalApprovedPendingPaymentCents: 100_000n
          })
        )
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
          warningRows: 1,
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
            companyEntityId: "entity-historical-1",
            companyEntityName: "建工智管公司",
            amountCents: "1000000",
            signedAt: "2026-01-10",
            takeoverLevel: "A",
            lifecycleStatus: "in_progress",
            paymentTermsOriginalText: "按月结算，归档后付款。",
            historicalSettledCents: "600000",
            historicalApprovedPendingPaymentCents: "100000",
            historicalPaidCents: "300000",
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
      riskText: "存在资料或风险提醒，复核时重点核对。",
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
        warningRows: 1,
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
        companyEntityId: "entity-historical-1",
        companyEntityName: "建工智管公司",
        ownerUserId: "contract-user"
      })
    });
    expect(tx.contractTakeover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        historicalSettledCents: BigInt(600_000),
        historicalApprovedPendingPaymentCents: BigInt(100_000),
        historicalPaidCents: BigInt(300_000),
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: "发票待补，财务复核时重点确认",
        balanceSourceSummary: "财务台账核对。",
        evidenceSummary: "合同扫描件和付款台账齐全。",
        reviewComment: "发票待补，财务复核时重点确认",
        takeoverBatchId: "batch-1",
        importRowNo: 2
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "contract_takeover.create",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        projectId: "project-1",
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: "发票待补，财务复核时重点确认",
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
            amountCents: "1000000",
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
        amountCents: "1000000",
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
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-user", name: "合同负责人" }])
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.listImportBatches("project-1");

    expect(prisma.contractTakeoverBatch.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" }
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["contract-user"] } },
      select: { id: true, name: true }
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
        responsibleUserName: "合同负责人",
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
              amountCents: 1_000_000n,
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
        contractTypeKey: "generic_contract",
        companyEntityName: "建工智管公司",
        amountCents: "1200000",
        signedAt: "2026-02-01",
        takeoverLevel: "C",
        lifecycleStatus: "disputed",
        paymentTermsOriginalText: "Updated terms.",
        paymentStages: [
          {
            name: "历史合同尾款",
            ratioBps: 2500,
            dueDays: 15,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ],
        historicalSettledCents: "700000",
        historicalApprovalPendingPaymentCents: "50000",
        historicalApprovedPendingPaymentCents: "100000",
        historicalPaidCents: "350000",
        historicalProxyPaidCents: "20000",
        historicalAdvancePaidCents: "50000",
        historicalAdvanceDeductedCents: "10000",
        historicalRetentionWithheldCents: "30000",
        historicalRetentionReleasedCents: "0",
        otherConfirmedOccupancyCents: "5000",
        balanceSourceSummary: "Updated balance.",
        evidenceSummary: "Updated evidence."
      },
      "contract-user"
    );

    expect(result).toMatchObject({
      contractNo: "HT-HIS-EDIT",
      contractName: "Edited historical contract",
      companyEntityName: "建工智管公司",
      contractTypeKey: "generic_contract",
      paymentTermsOriginalText: "Updated terms.",
      paymentStages: [
        expect.objectContaining({ name: "历史合同尾款", ratioBps: 2500, dueDays: 15 })
      ],
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
        companyEntityName: "建工智管公司",
        contractTypeKey: "generic_contract"
      })
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: {
        amountCents: BigInt(1_200_000),
        pricingNature: "fixed_total",
        amountLimitType: "capped",
        amountSource: "manual"
      }
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
          name: "历史合同尾款",
          basis: "contract_amount",
          ratioBps: 2500,
          triggerAnchor: "contract_effective",
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

  it("records takeover level adjustment reason separately from review comment", async () => {
    const adjustmentReason = "合同部确认资料可控，按 A级继续跟踪付款限制。";
    const reviewComment = "预算和财务已复核历史余额，后续按资料清单继续补齐。";
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
            reviewComment,
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
        amountCents: "1200000",
        signedAt: "2026-02-01",
        takeoverLevel: "A",
        lifecycleStatus: "in_progress",
        paymentTermsOriginalText: "Updated terms.",
        historicalApprovedPendingPaymentCents: "100000",
        balanceSourceSummary: "Finance ledger checked.",
        evidenceSummary: "Signed scan and finance ledger.",
        takeoverLevelAdjustmentReason: adjustmentReason,
        reviewComment
      },
      "contract-user"
    );

    expect(result).toMatchObject({
      takeoverLevel: "A",
      suggestedTakeoverLevel: "B",
      takeoverLevelAdjustmentReason: adjustmentReason,
      reviewComment
    });
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: expect.objectContaining({
        takeoverLevel: "A",
        suggestedTakeoverLevel: "B",
        takeoverLevelAdjustmentReason: adjustmentReason,
        reviewComment
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
          amountCents: "1200000",
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

  it("历史付款凭证不能通过合同岗的通用资料入口补充", async () => {
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
        { fileId: "file-1", purpose: "historical_payment_voucher" },
        "contract-user"
      )
    ).rejects.toThrow("历史付款凭证只能由财务部成员或财务部主管在专用入口补充");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("财务只能在待补充状态补充确有付款事实的历史付款凭证", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "needs_supplement" }))
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-record-payment-1" })
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", code: "HT-HIS-001", temporaryCode: null, name: "历史合同", counterparty: "供应商" }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-version-1", amountCents: 1_000_000n }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await service.attachHistoricalPaymentVoucher(
      "project-1",
      "takeover-1",
      { fileId: "file-1" },
      "finance-user"
    );

    expect(tx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "contract_takeover",
        businessId: "takeover-1",
        fileId: "file-1",
        departmentScope: "historical_payment_voucher"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-user",
      action: "contract_takeover.payment_evidence.attach",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        archiveRecordId: "archive-record-payment-1",
        purpose: "historical_payment_voucher"
      })
    });
  });

  it("财务不能绕过主管退回直接补充历史付款凭证", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
      },
      archiveRecord: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(
      service.attachHistoricalPaymentVoucher(
        "project-1",
        "takeover-1",
        { fileId: "file-1" },
        "finance-user"
      )
    ).rejects.toThrow("历史付款凭证只能在主管退回补充后由财务补充");
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
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

  it("合同员提交已确认接管的主体更正时冻结改前改后事实且不修改合同", async () => {
    const takeover = takeoverRecord({ takeoverStatus: "confirmed" });
    const tx = {
      contractTakeover: { findUnique: jest.fn().mockResolvedValue(takeover) },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          companyEntityId: "entity-before",
          companyEntityName: "扫描件原文主体"
        }),
        update: jest.fn()
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-after",
          name: "匹配后的主体",
          dataStatus: "legacy_incomplete",
          isActive: false
        })
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "responsible-1", isActive: true }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeoverCorrection: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "correction-entity-1" })
      }
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never, files as never);

    await expect(service.submitCompanyEntityCorrection("project-1", "takeover-1", {
      targetCompanyEntityId: "entity-after",
      reason: "原主体匹配错误",
      responsibleUserId: "responsible-1",
      attachmentFileId: "file-1",
      currentPassword: "current-password"
    }, "contract-user")).resolves.toEqual({
      id: "correction-entity-1",
      status: "submitted",
      message: "主体更正已提交，等待合同部主管确认"
    });

    expect(tx.contractTakeoverCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        takeoverId: "takeover-1",
        correctionType: "company_entity",
        status: "submitted",
        targetCompanyEntityId: "entity-after",
        beforeSnapshot: {
          companyEntityId: "entity-before",
          companyEntityName: "扫描件原文主体"
        },
        afterSnapshot: {
          companyEntityId: "entity-after",
          companyEntityName: "匹配后的主体",
          dataStatus: "legacy_incomplete",
          isActive: false
        },
        reason: "原主体匹配错误",
        responsibleUserId: "responsible-1",
        attachmentFileId: "file-1",
        createdByUserId: "contract-user",
        submittedByUserId: "contract-user",
        submittedAt: expect.any(Date)
      })
    });
    expect(files.assertCanAttachUnlinkedFile).toHaveBeenCalledWith(
      tx,
      "file-1",
      "contract-user"
    );
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "contract-user",
      action: "contract_takeover.company_entity_correction.submit",
      businessId: "takeover-1"
    }));
  });

  it("合同部主管只有主管岗位时不能代替合同员发起主体更正", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-director" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.submitCompanyEntityCorrection("project-1", "takeover-1", {
      targetCompanyEntityId: "entity-after",
      reason: "原主体匹配错误",
      responsibleUserId: "responsible-1",
      attachmentFileId: "file-1",
      currentPassword: "current-password"
    }, "contract-director")).rejects.toThrow("仅该项目合同员可以发起历史主体更正");
    expect(files.assertCanAttachUnlinkedFile).not.toHaveBeenCalled();
  });

  it("已绑定其他业务的文件不能提交为主体更正依据", async () => {
    files.assertCanAttachUnlinkedFile.mockRejectedValue(
      new Error("该文件已用于其他业务，请重新上传专用的更正依据附件")
    );
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeoverCorrection: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.submitCompanyEntityCorrection("project-1", "takeover-1", {
      targetCompanyEntityId: "entity-after",
      reason: "原主体匹配错误",
      responsibleUserId: "responsible-1",
      attachmentFileId: "file-bound",
      currentPassword: "current-password"
    }, "contract-user")).rejects.toThrow(
      "该文件已用于其他业务，请重新上传专用的更正依据附件"
    );
    expect(tx.contractTakeoverCorrection.create).not.toHaveBeenCalled();
  });

  it("数据库互斥触发器拒绝并发绑定时返回稳定中文且不泄露表名", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          companyEntityId: "entity-before",
          companyEntityName: "原主体"
        })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-after",
          name: "新主体",
          dataStatus: "complete",
          isActive: true
        })
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "responsible-1", isActive: true }) },
      contractTakeoverCorrection: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({
          code: "P2004",
          meta: {
            database_error:
              '23514: 该文件已用于其他业务，请重新上传专用的更正依据附件; relation="PaymentExecution"'
          }
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    let thrown: unknown;
    try {
      await service.submitCompanyEntityCorrection("project-1", "takeover-1", {
        targetCompanyEntityId: "entity-after",
        reason: "原主体匹配错误",
        responsibleUserId: "responsible-1",
        attachmentFileId: "file-raced",
        currentPassword: "current-password"
      }, "contract-user");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as Error).message).toBe(
      "该文件已用于其他业务，请重新上传专用的更正依据附件"
    );
    expect((thrown as Error).message).not.toContain("PaymentExecution");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("合同部主管确认主体更正时只更新主体ID并保留原始名称", async () => {
    const tx = {
      contractTakeover: { findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" })) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-director" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeoverCorrection: {
        findUnique: jest.fn().mockResolvedValue({
          id: "correction-entity-1",
          projectId: "project-1",
          takeoverId: "takeover-1",
          correctionType: "company_entity",
          status: "submitted",
          targetCompanyEntityId: "entity-after",
          beforeSnapshot: { companyEntityId: "entity-before", companyEntityName: "扫描件原文主体" },
          createdByUserId: "contract-user"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          companyEntityId: "entity-before",
          companyEntityName: "扫描件原文主体"
        }),
        update: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "entity-after" }) }
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never, files as never);

    await expect(service.reviewCompanyEntityCorrection("project-1", "takeover-1", "correction-entity-1", {
      decision: "approve",
      currentPassword: "current-password",
      comment: "主体资料核对无误"
    }, "contract-director")).resolves.toEqual({
      id: "correction-entity-1",
      status: "confirmed",
      message: "主体更正已确认"
    });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      data: { companyEntityId: "entity-after" }
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("contract-director", "current-password");
    expect(tx.contractTakeoverCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: "correction-entity-1", status: "submitted" },
      data: {
        status: "confirmed",
        reviewedByUserId: "contract-director",
        reviewedAt: expect.any(Date),
        reviewComment: "主体资料核对无误"
      }
    });
  });

  it("服务层拒绝合同员、跨项目或仅全局非主管岗位处理主体更正", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeoverCorrection: { findUnique: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.reviewCompanyEntityCorrection(
      "project-1",
      "takeover-1",
      "correction-entity-1",
      {
        decision: "approve",
        currentPassword: "current-password"
      },
      "contract-staff"
    )).rejects.toThrow("仅该项目合同部主管可以处理历史主体更正");
    expect(tx.contractTakeoverCorrection.findUnique).not.toHaveBeenCalled();
  });

  it("主体更正驳回不修改合同，且跨项目、重复处理和自审均失败关闭", async () => {
    const baseCorrection = {
      id: "correction-entity-1",
      projectId: "project-1",
      takeoverId: "takeover-1",
      correctionType: "company_entity",
      status: "submitted",
      targetCompanyEntityId: "entity-after",
      beforeSnapshot: { companyEntityId: "entity-before" },
      createdByUserId: "contract-user"
    };
    const makeService = (correction: Record<string, unknown> | null) => {
      const tx = {
        contractTakeover: { findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" })) },
        userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-director" }]) },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
        projectMember: { findMany: jest.fn().mockResolvedValue([]) },
        contractTakeoverCorrection: {
          findUnique: jest.fn().mockResolvedValue(correction),
          updateMany: jest.fn().mockResolvedValue({ count: 1 })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({ id: "contract-1", companyEntityId: "entity-before", companyEntityName: "原文" }),
          update: jest.fn()
        },
        companyEntity: { findUnique: jest.fn() }
      };
      const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
      return { tx, service: new ContractTakeoverService(prisma as never, audit as never, auth as never, files as never) };
    };

    const rejected = makeService(baseCorrection);
    await rejected.service.reviewCompanyEntityCorrection("project-1", "takeover-1", "correction-entity-1", {
      decision: "reject",
      currentPassword: "current-password",
      comment: "依据不足"
    }, "contract-director");
    expect(rejected.tx.contract.update).not.toHaveBeenCalled();
    expect(rejected.tx.contractTakeoverCorrection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "rejected" })
    }));

    const crossProject = makeService({ ...baseCorrection, projectId: "project-2" });
    await expect(crossProject.service.reviewCompanyEntityCorrection("project-1", "takeover-1", "correction-entity-1", {
      decision: "approve",
      currentPassword: "current-password"
    }, "contract-director")).rejects.toThrow("未找到该接管合同的主体更正");

    const repeated = makeService({ ...baseCorrection, status: "confirmed" });
    await expect(repeated.service.reviewCompanyEntityCorrection("project-1", "takeover-1", "correction-entity-1", {
      decision: "approve",
      currentPassword: "current-password"
    }, "contract-director")).rejects.toThrow("主体更正已处理或发生变化，请刷新后重试");

    const selfReview = makeService(baseCorrection);
    await expect(selfReview.service.reviewCompanyEntityCorrection("project-1", "takeover-1", "correction-entity-1", {
      decision: "approve",
      currentPassword: "current-password"
    }, "contract-user")).rejects.toThrow("主体更正提交人与确认人不能是同一人");
  });

  it("主体更正确认和驳回都必须先验证当前密码", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.reviewCompanyEntityCorrection(
      "project-1",
      "takeover-1",
      "correction-1",
      { decision: "approve", currentPassword: "" },
      "contract-director"
    )).rejects.toThrow("请填写当前登录密码后再处理主体更正");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001" } }
  ])("主体更正并发冲突 $code 返回稳定业务提示", async (transactionError) => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(transactionError)
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.reviewCompanyEntityCorrection(
      "project-1",
      "takeover-1",
      "correction-1",
      { decision: "approve", currentPassword: "current-password" },
      "contract-director"
    )).rejects.toThrow("主体更正已处理或发生变化，请刷新后重试");
    expect(auth.confirmPassword).toHaveBeenCalledWith("contract-director", "current-password");
  });

  it("主体更正CAS未取得待处理记录时不修改合同", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "confirmed" }))
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-director" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeoverCorrection: {
        findUnique: jest.fn().mockResolvedValue({
          id: "correction-1",
          projectId: "project-1",
          takeoverId: "takeover-1",
          correctionType: "company_entity",
          status: "submitted",
          targetCompanyEntityId: "entity-after",
          beforeSnapshot: { companyEntityId: "entity-before" },
          createdByUserId: "contract-user"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          companyEntityId: "entity-before",
          companyEntityName: "原始名称"
        }),
        update: jest.fn()
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "entity-after" }) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      auth as never,
      files as never
    );

    await expect(service.reviewCompanyEntityCorrection(
      "project-1",
      "takeover-1",
      "correction-1",
      { decision: "approve", currentPassword: "current-password" },
      "contract-director"
    )).rejects.toThrow("主体更正已处理或发生变化，请刷新后重试");
    expect(tx.contract.update).not.toHaveBeenCalled();
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
          amountCents: "1000000",
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
          amountCents: "1000000",
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

  it("returns a pending takeover for supplement with a required reason and audit", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "pending_review" })),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({ takeoverStatus: "needs_supplement" })
        )
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
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const result = await service.returnForSupplement(
      "project-1",
      "takeover-1",
      { reason: " 缺少历史付款凭证，请补齐后重新提交 " },
      "contract-director-1"
    );

    expect(result.takeoverStatus).toBe("needs_supplement");
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: { takeoverStatus: "needs_supplement" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-director-1",
      action: "contract_takeover.return_for_supplement",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        projectId: "project-1",
        fromStatus: "pending_review",
        toStatus: "needs_supplement",
        reason: "缺少历史付款凭证，请补齐后重新提交"
      }
    });
  });

  it("does not return a takeover that is no longer pending review", async () => {
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
      service.returnForSupplement(
        "project-1",
        "takeover-1",
        { reason: "资料不完整" },
        "contract-director-1"
      )
    ).rejects.toThrow("只有待复核的接管记录可以退回补充");
    expect(tx.contractTakeover.update).not.toHaveBeenCalled();
  });

  it("confirms generic takeover only with a persisted direct stage and preserves historical settlement facts", async () => {
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
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-1",
            name: "历史合同款",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 30,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ])
      },
      settlement: {
        create: jest.fn().mockResolvedValue({})
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          code: "HT-HIS-001",
          temporaryCode: null,
          contractTypeKey: "generic_contract"
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
        amountCents: 600_000n,
        payableAmountCents: 600_000n,
        paidAmountCents: 300_000n,
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

  it("fails closed before confirmation when a generic takeover has no valid direct stage", async () => {
    const service = new ContractTakeoverService({} as never, audit as never, auth as never);
    const internal = service as unknown as {
      assertTakeoverPaymentStages(
        tx: unknown,
        takeover: ReturnType<typeof takeoverRecord>
      ): Promise<void>;
    };
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "invalid-stage",
            name: "错误结算阶段",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            requiresInvoice: false,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
        ])
      }
    };

    await expect(
      internal.assertTakeoverPaymentStages.call(service, tx, takeoverRecord())
    ).rejects.toThrow("直接付款阶段未完整录入");
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

  it("rejects a runtime number before evaluating the historical settlement evidence checklist", async () => {
    const takeover = takeoverRecord();
    let historicalSettledReads = 0;
    Object.defineProperty(takeover, "historicalSettledCents", {
      enumerable: true,
      get: () => (historicalSettledReads++ === 0 ? 600_000 : 600_000n)
    });
    const prisma = {
      contractTakeover: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([takeover])
          .mockResolvedValueOnce([takeoverRecord({ historicalSettledCents: 0n })])
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
      }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await expect(service.list("project-1")).rejects.toThrow(
      "历史接管金额必须为 bigint 分值"
    );

    const [zeroSettlementTakeover] = await service.list("project-1");
    expect(zeroSettlementTakeover.evidenceChecklist).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: "historical_settlement_ledger" })
      ])
    );
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
            counterparty: "Supplier A",
            contractTypeKey: "generic_contract"
          }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-version-1", amountCents: 1_000_000n }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-direct-1",
            paymentTermsVersionId: "terms-version-1",
            name: "历史合同款",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 30,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }
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
        contractTypeKey: "generic_contract",
        paymentStages: [
          expect.objectContaining({
            id: "stage-direct-1",
            name: "历史合同款",
            ratioBps: 8000,
            dueDays: 30
          })
        ],
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
    const [row] = await service.list("project-1", "contract-user");
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
        status: "confirmed",
        statusLabel: "已确认",
        targetCompanyEntityId: null,
        reason: "补充历史付款凭证复核说明",
        beforeSummary:
          "改前：接管等级 B级；历史累计结算 ¥10,000.00；历史累计已付 ¥4,000.00；证据说明：原接管资料：合同扫描件、结算台账。",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        responsibleUserName: "合同负责人",
        createdByName: "合同经办",
        submittedByName: "合同经办",
        submittedAt: new Date("2026-07-04T09:00:00.000Z"),
        reviewedByName: "合同负责人",
        reviewedAt: new Date("2026-07-04T09:00:00.000Z"),
        reviewComment: null,
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

  function baselineTx(input?: {
    director?: boolean;
    casCount?: number;
    existing?: bigint | null;
    root?: Record<string, unknown>;
    takeoverStatus?: string;
  }) {
    return {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ contractId: "contract-1", contractVersionId: "contract-version-1" }])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{
          id: "contract-version-1",
          baseVersionId: null,
          changeType: "historical_takeover",
          status: "effective",
          effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
          pricingNature: "fixed_total",
          amountLimitType: "capped",
          originalBaseAmountCents: input?.existing ?? null,
          ...input?.root
        }])
        .mockResolvedValueOnce([{ id: "takeover-1", takeoverStatus: input?.takeoverStatus ?? "confirmed" }])
        .mockResolvedValueOnce(input?.director === false ? [] : [{ userId: "director-1" }]),
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: input?.casCount ?? 1 })
      }
    };
  }

  it("confirms the historical change baseline once with password, global role, bigint and audit", async () => {
    const tx = baselineTx();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const authForTest = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const auditForTest = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractTakeoverService(
      prisma as never,
      auditForTest as never,
      authForTest as never
    );

    await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
      originalSignedAmountCents: "9223372036854775807",
      preTakeoverPositiveIncreaseCents: "100000",
      currentPassword: "current password"
    })).resolves.toEqual({
      takeoverId: "takeover-1",
      contractVersionId: "contract-version-1",
      changeBaselineConfirmed: true,
      originalBaseAmountCents: "9223372036854775807",
      preTakeoverPositiveIncreaseCents: "100000"
    });
    expect(authForTest.confirmPassword).toHaveBeenCalledWith("director-1", "current password");
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "contract-version-1", originalBaseAmountCents: null },
      data: {
        originalBaseAmountCents: 9223372036854775807n,
        cumulativeIncreaseCents: 100000n
      }
    });
    expect(auditForTest.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract_takeover.change_baseline.confirm",
      businessId: "takeover-1",
      metadata: expect.objectContaining({
        originalBaseAmountCents: "9223372036854775807",
        preTakeoverPositiveIncreaseCents: "100000"
      })
    }));
  });

  it("rejects non-directors and CAS conflicts without writing baseline audit", async () => {
    for (const scenario of [
      { tx: baselineTx({ director: false }), message: "只有公司级合同部主管" },
      { tx: baselineTx({ casCount: 0 }), message: "已经确认，不能重复覆盖" }
    ]) {
      const auditForTest = { record: jest.fn() };
      const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof scenario.tx) => unknown) => callback(scenario.tx))
      };
      const service = new ContractTakeoverService(
        prisma as never,
        auditForTest as never,
        { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) } as never
      );

      await expect(service.confirmChangeBaseline("project-1", "takeover-1", "actor-1", {
        originalSignedAmountCents: "1000000",
        preTakeoverPositiveIncreaseCents: "0",
        currentPassword: "current password"
      })).rejects.toThrow(scenario.message);
      expect(auditForTest.record).not.toHaveBeenCalled();
    }
  });

  it("accepts a superseded historical root and allows zero only for an unlimited framework", async () => {
    for (const root of [
      { status: "superseded" },
      { pricingNature: "framework", amountLimitType: "unlimited" }
    ]) {
      const tx = baselineTx({ root });
      const service = new ContractTakeoverService({
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
      } as never, { record: jest.fn() } as never, {
        confirmPassword: jest.fn().mockResolvedValue({ ok: true })
      } as never);
      await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
        originalSignedAmountCents: root.status === "superseded" ? "100000" : "0",
        preTakeoverPositiveIncreaseCents: "0",
        currentPassword: "secret"
      })).resolves.toMatchObject({ changeBaselineConfirmed: true });
    }
  });

  it.each([
    ["capped zero", { root: {} }, "0"],
    ["non historical root", { root: { changeType: "original" } }, "100000"],
    ["non-root version", { root: { baseVersionId: "older" } }, "100000"],
    ["never effective", { root: { effectiveAt: null } }, "100000"],
    ["unconfirmed takeover", { takeoverStatus: "pending_review" }, "100000"]
  ])("rejects %s baseline confirmation", async (_label, options, amount) => {
    const tx = baselineTx(options);
    const auditForTest = { record: jest.fn() };
    const service = new ContractTakeoverService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as never, auditForTest as never, {
      confirmPassword: jest.fn().mockResolvedValue({ ok: true })
    } as never);
    await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
      originalSignedAmountCents: amount,
      preTakeoverPositiveIncreaseCents: "0",
      currentPassword: "secret"
    })).rejects.toBeDefined();
    expect(auditForTest.record).not.toHaveBeenCalled();
  });

  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001" } }
  ])("maps baseline serialization conflicts to stable Chinese", async (details) => {
    const service = new ContractTakeoverService({
      $transaction: jest.fn().mockRejectedValue(Object.assign(new Error("serialization"), details))
    } as never, audit as never, {
      confirmPassword: jest.fn().mockResolvedValue({ ok: true })
    } as never);
    await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
      originalSignedAmountCents: "100000",
      preTakeoverPositiveIncreaseCents: "0",
      currentPassword: "secret"
    })).rejects.toThrow("历史变更基线正在被更新，请刷新后重试");
  });

  it("rolls the baseline transaction back when audit writing fails and never audits the password", async () => {
    const tx = baselineTx();
    const auditForTest = { record: jest.fn().mockRejectedValue(new Error("audit unavailable")) };
    const transaction = jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const service = new ContractTakeoverService({ $transaction: transaction } as never,
      auditForTest as never, { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) } as never);
    await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
      originalSignedAmountCents: "100000",
      preTakeoverPositiveIncreaseCents: "0",
      currentPassword: "top-secret"
    })).rejects.toThrow("audit unavailable");
    expect(JSON.stringify(auditForTest.record.mock.calls)).not.toContain("top-secret");
  });

  it("rejects a historical baseline outside PostgreSQL bigint before password or database access", async () => {
    const prisma = { $transaction: jest.fn() };
    const authForTest = { confirmPassword: jest.fn() };
    const service = new ContractTakeoverService(
      prisma as never,
      audit as never,
      authForTest as never
    );

    await expect(service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
      originalSignedAmountCents: "9223372036854775808",
      preTakeoverPositiveIncreaseCents: "0",
      currentPassword: "current password"
    })).rejects.toThrow("原始签约含税金额必须是大于等于 0 的整数分值");
    expect(authForTest.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("exposes baseline status and nullable facts in the takeover read model", async () => {
    const prisma = {
      contractTakeover: { findMany: jest.fn().mockResolvedValue([
        takeoverRecord({ takeoverStatus: "confirmed" })
      ]) },
      contract: { findMany: jest.fn().mockResolvedValue([{
        id: "contract-1", code: "HT-HIS-001", temporaryCode: null,
        name: "Historical contract", counterparty: "Supplier"
      }]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([{
        id: "contract-version-1",
        amountCents: 1_200_000n,
        originalBaseAmountCents: 1_000_000n,
        cumulativeIncreaseCents: 200_000n
      }]) }
    };
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    const [row] = await service.list("project-1");

    expect(row).toMatchObject({
      changeBaselineConfirmed: true,
      originalBaseAmountCents: "1000000",
      preTakeoverPositiveIncreaseCents: "200000"
    });
    expect(row).toMatchObject({
      lifecycleKind: "formal_record",
      availableActions: [],
      lifecycleBlockers: expect.arrayContaining(["接管已确认"])
    });
  });

  function abandonmentTx(record = takeoverRecord()) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([record]),
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(record),
        findMany: jest.fn().mockResolvedValue([record]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverBatch: { findFirst: jest.fn(), findUnique: jest.fn() },
      archiveRecord: { count: jest.fn().mockResolvedValue(0) },
      contractTakeoverCorrection: { count: jest.fn().mockResolvedValue(0) },
      settlement: { count: jest.fn().mockResolvedValue(0) },
      paymentRequest: { count: jest.fn().mockResolvedValue(0) },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      paymentTermsVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    };
  }

  it("closes a pristine takeover and its generated draft version without deleting facts", async () => {
    const record = takeoverRecord();
    const tx = abandonmentTx(record);
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never);

    const result = await service.abandonDraft(
      "project-1",
      "takeover-1",
      {
        expectedUpdatedAt: record.updatedAt.toISOString(),
        action: "delete_pristine_draft"
      },
      "contract-user"
    );

    expect(result).toMatchObject({ status: "abandoned", action: "delete_pristine_draft" });
    expect(tx.contractTakeover.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ takeoverStatus: "abandoned", abandonReason: null })
    }));
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "abandoned" })
    }));
    expect(tx.paymentTermsVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "terms-version-1", status: "draft" },
      data: { status: "voided" }
    });
    expect((tx.contractTakeover as Record<string, unknown>).delete).toBeUndefined();
  });

  it("keeps evidence and requires abandonment semantics for a reviewed takeover", async () => {
    const record = takeoverRecord({
      takeoverStatus: "needs_supplement",
      submittedAt: new Date("2026-07-03T01:00:00.000Z")
    });
    const tx = abandonmentTx(record);
    tx.archiveRecord.count.mockResolvedValue(1);
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractTakeoverService(prisma as never, audit as never);

    await expect(service.abandonDraft(
      "project-1", "takeover-1",
      { expectedUpdatedAt: record.updatedAt.toISOString(), action: "delete_pristine_draft" },
      "contract-user"
    )).rejects.toThrow("只能放弃申请");

    await expect(service.abandonDraft(
      "project-1", "takeover-1",
      {
        expectedUpdatedAt: record.updatedAt.toISOString(),
        action: "abandon_application",
        reason: "资料无法补齐"
      },
      "contract-user"
    )).resolves.toMatchObject({ status: "abandoned", action: "abandon_application" });
    expect(tx.archiveRecord.count).toHaveBeenCalled();
  });

  it("returns a stable batch preview hash and rejects an apply with a stale hash", async () => {
    const record = takeoverRecord({ takeoverBatchId: "batch-1", importRowNo: 1 });
    const batch = { id: "batch-1", projectId: "project-1", batchNo: "BATCH-1" };
    const previewTx = abandonmentTx(record);
    previewTx.contractTakeoverBatch.findFirst.mockResolvedValue(batch);
    const previewPrisma = { $transaction: jest.fn(async (callback) => callback(previewTx)) };
    const previewService = new ContractTakeoverService(previewPrisma as never, audit as never);

    const first = await previewService.previewBatchAbandonment(
      "project-1", "batch-1", "contract-user"
    );
    const second = await previewService.previewBatchAbandonment(
      "project-1", "batch-1", "contract-user"
    );
    expect(first).toMatchObject({ total: 1, eligible: 1, blocked: 0 });
    expect(first.previewHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.previewHash).toBe(first.previewHash);

    const applyTx = abandonmentTx(record);
    applyTx.$queryRaw = jest.fn()
      .mockResolvedValueOnce([batch])
      .mockResolvedValueOnce([]);
    const applyPrisma = { $transaction: jest.fn(async (callback) => callback(applyTx)) };
    const applyService = new ContractTakeoverService(applyPrisma as never, audit as never);
    await expect(applyService.applyBatchAbandonment(
      "project-1",
      "batch-1",
      { previewHash: "0".repeat(64), reason: "整批录入错误" },
      "contract-user"
    )).rejects.toThrow("预览后已发生变化");
    expect(applyTx.contractTakeover.updateMany).not.toHaveBeenCalled();
  });
});
