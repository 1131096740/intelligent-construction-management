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
        create: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "draft"
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
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "draft"
        }),
        update: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "pending_review"
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

    const result = await service.submitReview("project-1", "takeover-1", "contract-user");

    expect(result.takeoverStatus).toBe("pending_review");
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
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "pending_review"
        }),
        update: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "confirmed"
        })
      },
      contractVersion: {
        update: jest.fn().mockResolvedValue({})
      },
      paymentTermsVersion: {
        update: jest.fn().mockResolvedValue({})
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
});
