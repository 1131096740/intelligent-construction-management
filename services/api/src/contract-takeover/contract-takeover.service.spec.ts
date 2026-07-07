import { ContractTakeoverService } from "./contract-takeover.service";

describe("ContractTakeoverService", () => {
  const audit = {
    record: jest.fn()
  };
  const auth = {
    confirmPassword: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
  });

  function takeoverRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "takeover-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      paymentTermsVersionId: "terms-version-1",
      takeoverLevel: "A",
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
      contractTakeover: {
        create: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" }))
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
        evidenceSummary: "Signed scan and finance ledger."
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
      historicalPaidCents: "300000"
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
    expect(tx.contractTakeover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        takeoverLevel: "A",
        takeoverStatus: "draft",
        lifecycleStatus: "in_progress",
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
        takeoverLevel: "A"
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
    ).rejects.toThrow("historicalSettledCents must be a non-negative integer");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("updates an editable takeover draft and keeps linked contract facts in sync", async () => {
    const tx = {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(takeoverRecord({ takeoverStatus: "draft" })),
        update: jest.fn().mockResolvedValue(
          takeoverRecord({
            takeoverLevel: "C",
            lifecycleStatus: "disputed",
            historicalPaidCents: 350_000n
          })
        )
      },
      contract: { update: jest.fn() },
      contractVersion: { update: jest.fn() },
      paymentTermsVersion: { update: jest.fn() },
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
    expect(tx.contractTakeover.update).toHaveBeenCalledWith({
      where: { id: "takeover-1" },
      data: expect.objectContaining({
        takeoverLevel: "C",
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
        fromStatus: "draft"
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
    ).rejects.toThrow("Cannot update takeover draft from status pending_review");
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
    const service = new ContractTakeoverService(prisma as never, audit as never, auth as never);

    await service.attachEvidenceFile(
      "project-1",
      "takeover-1",
      { fileId: "file-1", purpose: "historical_contract_scan" },
      "contract-user"
    );

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
    ).rejects.toThrow("signedAt must be a valid date string");

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

  it("lists historical takeover rows as business read models without internal IDs", async () => {
    const prisma = {
      contractTakeover: {
        findMany: jest.fn().mockResolvedValue([
          takeoverRecord({ takeoverStatus: "pending_review" })
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
  });
});
