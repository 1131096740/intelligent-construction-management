import { PaymentAmountService } from "./payment-amount.service";
import { PaymentRequestService } from "./payment-request.service";

describe("PaymentRequestService", () => {
  const service = new PaymentRequestService(new PaymentAmountService());
  const auth = {
    confirmPassword: jest.fn()
  };
  const audit = {
    record: jest.fn()
  };
  const paymentApprovalNodes = [
    { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
    {
      name: "合同结算部/预算部",
      mode: "any",
      roleKeys: ["contract_director", "budget_director"]
    },
    { name: "财务", mode: "any", roleKeys: ["finance_director"] },
    { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
  ];

  beforeEach(() => {
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
    audit.record.mockReset();
  });

  function approvalRoleTables(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
  }

  function projectCashPoolTables({
    receiptAmountCents = 200_000,
    projectPayments = [],
    projectExpenses = [],
    financingQuotas = [],
    financingUsages = []
  }: {
    receiptAmountCents?: number;
    projectPayments?: Array<{
      status: string;
      requestedAmountCents: number;
      approvedAmountCents?: number | null;
      paidAmountCents: number;
    }>;
    projectExpenses?: Array<{
      status: string;
      requestedAmountCents: number;
      approvedAmountCents?: number | null;
      paidAmountCents: number;
    }>;
    financingQuotas?: Array<{ id: string; amountCents: bigint | number }>;
    financingUsages?: Array<{ quotaId: string; amountCents: bigint | number }>;
  } = {}) {
    return {
      tables: {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1", isActive: true }]),
        projectReceipt: {
          findMany: jest.fn().mockResolvedValue(
            receiptAmountCents > 0 ? [{ amountCents: BigInt(receiptAmountCents) }] : []
          )
        },
        projectFinancingQuota: {
          findMany: jest.fn().mockResolvedValue(financingQuotas)
        },
        projectFinancingQuotaUsage: {
          findMany: jest.fn().mockResolvedValue(financingUsages),
          createMany: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 })
        },
        projectExpenseRequest: {
          findMany: jest.fn().mockResolvedValue(projectExpenses)
        },
        projectExpenseFinancingQuotaUsage: {
          findMany: jest.fn().mockResolvedValue([])
        }
      },
      projectPayments
    };
  }

  function financingUsageUpdates(
    occupiedUsages: Array<{
      id: string;
      quotaId: string;
      projectId: string;
      amountCents: bigint | number;
      status?: string;
    }> = []
  ) {
    const rows = occupiedUsages.map((usage) => ({ status: "occupied", ...usage }));
    return {
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue(rows),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({})
      }
    };
  }

  function paymentExecutionRow(
    overrides: Partial<{
      id: string;
      code: string;
      projectId: string;
      contractId: string;
      settlementId: string | null;
      sourceType: string;
      status: string;
      requestedAmountCents: number;
      approvedAmountCents: number | null;
      paidAmountCents: number;
    }> = {}
  ) {
    return {
      id: "payment-1",
      code: "FK-2026-012",
      projectId: "project-1",
      contractId: "contract-1",
      settlementId: "settlement-1",
      sourceType: "settlement",
      status: "approved_pending_payment",
      requestedAmountCents: 50_000,
      approvedAmountCents: 50_000,
      paidAmountCents: 0,
      ...overrides
    };
  }

  it("rejects payment request before settlement is effective", () => {
    expect(() =>
      service.assertRequestAllowed(
        "approved_pending_archive",
        {
          payableAmountCents: 100_000,
          approvedPendingPaymentCents: 0,
          paidAmountCents: 0
        },
        10_000
      )
    ).toThrow("non-effective settlement");
  });

  it("allows partial payment request within settlement capacity", () => {
    expect(() =>
      service.assertRequestAllowed(
        "effective",
        {
          payableAmountCents: 100_000,
          approvedPendingPaymentCents: 20_000,
          paidAmountCents: 20_000
        },
        60_000
      )
    ).not.toThrow();
  });

  it("allows later payment requests after a settlement is partially paid", () => {
    expect(() =>
      service.assertRequestAllowed(
        "partially_paid",
        {
          payableAmountCents: 100_000,
          approvedPendingPaymentCents: 0,
          paidAmountCents: 50_000
        },
        50_000
      )
    ).not.toThrow();
  });

  it("creates payment request from an effective settlement within remaining capacity", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 20_000
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              status: "approved_pending_payment",
              requestedAmountCents: 30_000,
              approvedAmountCents: 30_000,
              paidAmountCents: 10_000
            }
          ])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012"
        })
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const created = await paymentService.create({
      settlementId: "settlement-1",
      code: "FK-2026-012",
      requestedAmountCents: 50_000
    });

    expect(created.code).toBe("FK-2026-012");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.paymentRequest.findMany.mock.invocationCallOrder[0]
    );
    expect(tx.paymentRequest.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        settlementId: "settlement-1",
        sourceType: "settlement",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "FK-2026-012",
        status: "approval_pending",
        requestedAmountCents: 50_000,
        approvedAmountCents: null,
        paidAmountCents: 0
      }
    });
  });

  it("rejects settlement payment when historical takeover is not confirmed", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "pending_review",
          historicalBalanceConfirmedAt: null
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          settlementId: "settlement-1",
          code: "FK-2026-HIS-001",
          requestedAmountCents: 10_000
        },
        "applicant-1"
      )
    ).rejects.toThrow("Historical contract takeover must be confirmed before creating payment request");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "settlement",
        reason: "takeover_not_confirmed",
        takeoverStatus: "pending_review"
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("deducts contract-level allocations from settlement payment request capacity", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValueOnce([]),
        create: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 80_000 }
        ])
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-099",
        requestedAmountCents: 30_000
      })
    ).rejects.toThrow("remaining settlement capacity: 20000");

    expect(tx.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: "settlement-1",
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("creates a contract advance payment request from an effective contract version without settlement", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
      const tx = {
        settlement: {
          findUnique: jest.fn()
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1"
          })
        },
        contractTakeover: {
          findUnique: jest.fn().mockResolvedValue({
            id: "takeover-1",
            contractVersionId: "contract-version-1",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 30
            }
          ])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn().mockResolvedValue({
            id: "payment-advance-1",
            code: "FK-YF-2026-001"
          })
        },
        ...cashPool.tables
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      const created = await paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-001",
        requestedAmountCents: 100_000
      } as never);

      expect(created.code).toBe("FK-YF-2026-001");
      expect(tx.settlement.findUnique).not.toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.paymentRequest.findMany.mock.invocationCallOrder[0]
      );
      expect(tx.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-1",
          settlementId: null,
          sourceType: "contract_advance",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-YF-2026-001",
          status: "approval_pending",
          requestedAmountCents: 100_000,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects contract advance payment for historical contracts without takeover row", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          source: "historical_takeover"
        })
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          sourceType: "contract_advance",
          contractVersionId: "contract-version-1",
          code: "FK-YF-HIS-001",
          requestedAmountCents: 10_000
        } as never,
        "applicant-1"
      )
    ).rejects.toThrow("Historical contract takeover must be confirmed before creating payment request");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract",
      businessId: "contract-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "contract_advance",
        reason: "takeover_missing",
        takeoverStatus: null
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("creates a contract due payment request from an effective contract version without selecting a settlement", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
      const tx = {
        settlement: {
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              status: "effective",
              amountCents: 100_000,
              paidAmountCents: 0,
              contractVersionId: "contract-version-1",
              isFinal: false,
              paymentTermsVersionId: "terms-version-1"
            }
          ])
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "contract-version-1",
              amountCents: BigInt(1_000_000)
            }
          ])
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1"
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "progress",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              advanceDeductionMode: "none",
              advanceDeductionRatioBps: null,
              advanceDeductionStartRatioBps: null
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string; sourceType?: unknown } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn().mockResolvedValue({
            id: "payment-contract-due-1",
            code: "FK-HT-2026-001"
          })
        },
        ...cashPool.tables
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      const created = await paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-001",
        requestedAmountCents: 80_000
      } as never);

      expect(created.code).toBe("FK-HT-2026-001");
      expect(tx.settlement.findUnique).not.toHaveBeenCalled();
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: { in: ["settlement", "contract_due"] }
          })
        })
      );
      expect(tx.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-1",
          settlementId: null,
          sourceType: "contract_due",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-HT-2026-001",
          status: "approval_pending",
          requestedAmountCents: 80_000,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects contract due payment when historical balance is not confirmed", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
    const tx = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            isFinal: false,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: null
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
          if (args.where?.contractId === "contract-1") {
            return Promise.resolve([]);
          }

          if (args.where?.projectId === "project-1") {
            return Promise.resolve(cashPool.projectPayments);
          }

          return Promise.resolve([]);
        }),
        create: jest.fn()
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          sourceType: "contract_due",
          contractVersionId: "contract-version-1",
          code: "FK-HT-2026-HIS-002",
          requestedAmountCents: 80_000
        } as never,
        "applicant-1"
      )
    ).rejects.toThrow("Historical balance must be confirmed before creating payment request");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "contract_due",
        reason: "historical_balance_not_confirmed",
        takeoverStatus: "confirmed"
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract due payment when confirmed historical balances consume capacity", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const tx = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            isFinal: false,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(0),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(30_000),
          historicalPaidCents: BigInt(40_000),
          historicalProxyPaidCents: BigInt(10_000),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
          if (args.where?.contractId === "contract-1") {
            return Promise.resolve([]);
          }

          if (args.where?.projectId === "project-1") {
            return Promise.resolve(cashPool.projectPayments);
          }

          return Promise.resolve([]);
        }),
        create: jest.fn()
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        code: "FK-HT-HIS-CAP-001",
        requestedAmountCents: 1
      } as never)
    ).rejects.toThrow("合同到期可付额度不足: 0");

    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract due payment requests that still carry a settlement id", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        settlementId: "settlement-in-other-project",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-002",
        requestedAmountCents: 80_000
      } as never)
    ).rejects.toThrow("Settlement must not be provided for contract due payment request");
    expect(tx.contractVersion.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a contract advance payment request before the contract-effective due date", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
      const tx = {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1"
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 30
            }
          ])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        },
        ...cashPool.tables
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          sourceType: "contract_advance",
          contractVersionId: "contract-version-1",
          code: "FK-YF-2026-002",
          requestedAmountCents: 100_000
        } as never)
      ).rejects.toThrow("合同预付款到期可付额度不足: 0");
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects contract advance payment when confirmed historical advance already uses capacity", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(0),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(0),
          historicalPaidCents: BigInt(0),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(100_000),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-HIS-CAP-001",
        requestedAmountCents: 1
      } as never)
    ).rejects.toThrow("合同预付款到期可付额度不足: 0");

    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("freezes payment approval route when payment request is created by an applicant", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.create(
      {
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: 50_000
      },
      "contract-staff-1"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "payment.approve",
        businessType: "payment_request",
        businessId: "payment-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: paymentApprovalNodes,
        applicantUserId: "contract-staff-1"
      })
    });
  });

  it("rejects create payment request from a non-effective settlement", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: 50_000
      })
    ).rejects.toThrow("Cannot create payment request from a non-effective settlement");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects create payment request above remaining settlement capacity", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 20_000
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 0
          }
        ]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: 51_000
      })
    ).rejects.toThrow("Payment request exceeds remaining settlement capacity: 50000");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("blocks payment request creation above contract due payment capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
      const tx = {
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            status: "effective",
            amountCents: 100_000,
            payableAmountCents: 100_000,
            paidAmountCents: 0
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              amountCents: 100_000,
              paidAmountCents: 0,
              paymentTermsVersionId: "terms-version-1",
              status: "effective"
            },
            {
              id: "settlement-2",
              amountCents: 100_000,
              paidAmountCents: 0,
              paymentTermsVersionId: "terms-version-1",
              status: "effective"
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              dueDays: 30
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-01-01T00:00:00.000Z")
            },
            {
              settlementId: "settlement-2",
              confirmedAt: new Date()
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { settlementId?: string; contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([
                {
                  settlementId: "settlement-2",
                  status: "approval_pending",
                  requestedAmountCents: 30_000,
                  approvedAmountCents: null,
                  paidAmountCents: 0
                }
              ]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        },
        ...cashPool.tables
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          settlementId: "settlement-1",
          code: "FK-2026-014",
          requestedAmountCents: 60_000
        })
      ).rejects.toThrow("合同到期可付额度不足: 50000");
      expect(tx.settlement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            contractId: "contract-1",
            status: { in: ["effective", "partially_paid", "paid"] }
          },
          select: expect.objectContaining({
            isFinal: true
          })
        })
      );
      expect(tx.paymentTermsStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            stageType: true,
            triggerAnchor: true
          })
        })
      );
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: { in: ["settlement", "contract_due"] }
          })
        })
      );
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.settlement.findMany.mock.invocationCallOrder[0]
      );
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("deducts paid contract advances from contract due payment capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000 });
      const tx = {
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            status: "effective",
            amountCents: 100_000,
            payableAmountCents: 100_000,
            paidAmountCents: 0
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              amountCents: 100_000,
              paidAmountCents: 0,
              paymentTermsVersionId: "terms-version-1",
              status: "effective",
              isFinal: false
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "progress",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              advanceDeductionMode: null,
              advanceDeductionRatioBps: null,
              advanceDeductionStartRatioBps: null
            },
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 0,
              advanceDeductionMode: "per_settlement_ratio",
              advanceDeductionRatioBps: 2000,
              advanceDeductionStartRatioBps: null
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { settlementId?: string; contractId?: string; projectId?: string; sourceType?: string } }) => {
            if (args.where?.contractId === "contract-1" && args.where?.sourceType === "contract_advance") {
              return Promise.resolve([
                {
                  paymentTermsVersionId: "terms-version-1",
                  status: "paid",
                  requestedAmountCents: 20_000,
                  approvedAmountCents: 20_000,
                  paidAmountCents: 20_000
                }
              ]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        },
        ...cashPool.tables,
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ id: "contract-1" }])
          .mockResolvedValueOnce([{ id: "settlement-1" }])
          .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          settlementId: "settlement-1",
          code: "FK-2026-ADV-DED",
          requestedAmountCents: 61_000
        })
      ).rejects.toThrow("合同到期可付额度不足: 60000");
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: "contract_advance",
            paymentTermsVersionId: { in: ["terms-version-1"] },
            paidAmountCents: { gt: 0 }
          }),
          select: expect.objectContaining({
            paidAmountCents: true
          })
        })
      );
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("blocks payment request creation when project cash pool is insufficient", async () => {
    const cashPool = projectCashPoolTables({
      receiptAmountCents: 100_000,
      projectPayments: [
        {
          status: "paid",
          requestedAmountCents: 80_000,
          approvedAmountCents: 80_000,
          paidAmountCents: 80_000
        },
        {
          status: "approval_pending",
          requestedAmountCents: 10_000,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      ]
    });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 200_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn()
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-013",
        requestedAmountCents: 20_000
      })
    ).rejects.toThrow("项目现金资金池余额不足: 10000");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.projectReceipt.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("occupies approved project financing quota when cash pool is insufficient", async () => {
    const cashPool = projectCashPoolTables({
      receiptAmountCents: 20_000,
      financingQuotas: [{ id: "financing-quota-1", amountCents: BigInt(100_000) }]
    });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 200_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-013"
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await paymentService.create(
      {
        settlementId: "settlement-1",
        code: "FK-2026-013",
        requestedAmountCents: 50_000
      },
      "contract-staff-1"
    );

    expect(tx.projectFinancingQuotaUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          quotaId: "financing-quota-1",
          paymentRequestId: "payment-1",
          projectId: "project-1",
          amountCents: BigInt(30_000),
          status: "occupied"
        }
      ]
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-staff-1",
      action: "payment.financing_quota.occupy",
      businessType: "payment_request",
      businessId: "payment-1",
      metadata: {
        projectId: "project-1",
        allocations: [{ quotaId: "financing-quota-1", amountCents: "30000" }]
      }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalled();
  });

  it("counts approved and partially-paid payment balances against project cash pool", async () => {
    const cashPool = projectCashPoolTables({
      receiptAmountCents: 150_000,
      projectPayments: [
        {
          status: "approved_pending_payment",
          requestedAmountCents: 50_000,
          approvedAmountCents: 40_000,
          paidAmountCents: 0
        },
        {
          status: "partially_paid",
          requestedAmountCents: 80_000,
          approvedAmountCents: 80_000,
          paidAmountCents: 30_000
        }
      ]
    });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 300_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn()
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-014",
        requestedAmountCents: 31_000
      })
    ).rejects.toThrow("项目现金资金池余额不足: 30000");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("counts approved project expense balances against project cash pool", async () => {
    const cashPool = projectCashPoolTables({
      receiptAmountCents: 100_000,
      projectExpenses: [
        {
          status: "approved_pending_payment",
          requestedAmountCents: 90_000,
          approvedAmountCents: 90_000,
          paidAmountCents: 0
        }
      ]
    });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 300_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn()
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-EXP",
        requestedAmountCents: 20_000
      })
    ).rejects.toThrow("项目现金资金池余额不足: 10000");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("counts linked project proxy payments against remaining settlement capacity", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 20_000
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 0
          }
        ]),
        create: jest.fn()
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: BigInt(25_000) }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: 26_000
      })
    ).rejects.toThrow("Payment request exceeds remaining settlement capacity: 25000");
    expect(tx.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("does not treat project proxy payments as project cash receipts", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 0 });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn()
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(90_000) }])
      },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-015",
        requestedAmountCents: 10_000
      })
    ).rejects.toThrow("项目现金资金池余额不足: 0");
    expect(tx.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("approves the first payment node, keeps payment pending, and advances the instance", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending",
          approvedAmountCents: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: paymentApprovalNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const approved = await paymentService.reviewApproval("FK-2026-012", "pm-1", {
      decision: "approve"
    });

    expect(approved.status).toBe("approval_pending");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...paymentApprovalNodes[0],
            approvedRoleKeys: ["project_manager"]
          },
          paymentApprovalNodes[1],
          paymentApprovalNodes[2],
          paymentApprovalNodes[3]
        ],
        status: "in_progress"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "pm-1",
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "pm-1"
      }
    });
  });

  it("rejects setting approved amount before the final payment approval node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: paymentApprovalNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "pm-1", {
        decision: "approve",
        approvedAmountCents: 45_000
      })
    ).rejects.toThrow("Approved amount can only be set on final payment approval node");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("approves the final OR node into approved pending payment", async () => {
    const frozenNodes = [
      { ...paymentApprovalNodes[0], approvedRoleKeys: ["project_manager"] },
      { ...paymentApprovalNodes[1], approvedRoleKeys: ["contract_director"] },
      { ...paymentApprovalNodes[2], approvedRoleKeys: ["finance_director"] },
      paymentApprovalNodes[3]
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 3,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const approved = await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      decision: "approve",
      approvedAmountCents: 45_000
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        status: "approved_pending_payment",
        approvedAmountCents: 45_000
      }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 4,
        frozenNodes: [
          frozenNodes[0],
          frozenNodes[1],
          frozenNodes[2],
          {
            ...paymentApprovalNodes[3],
            approvedRoleKeys: ["chairman"]
          }
        ],
        status: "approved"
      }
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 45_000.5],
    ["non-finite", Number.NaN]
  ])("rejects %s approved amount values", async (_label, approvedAmountCents) => {
    const frozenNodes = [
      { ...paymentApprovalNodes[0], approvedRoleKeys: ["project_manager"] },
      { ...paymentApprovalNodes[1], approvedRoleKeys: ["contract_director"] },
      { ...paymentApprovalNodes[2], approvedRoleKeys: ["finance_director"] },
      paymentApprovalNodes[3]
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 3,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        decision: "approve",
        approvedAmountCents
      })
    ).rejects.toThrow("Approved amount must be a positive integer");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("persists the approver's remark on the approval action log", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...financingUsageUpdates(),
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      decision: "approve",
      comment: "  同意付款  "
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "chairman-1",
        comment: "同意付款"
      }
    });
  });

  it("lets a standing delegate approve a payment node as the delegator's role", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(where.userId === "delegator-1" ? [{ positionKey: "chairman" }] : [])
        )
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const delegations = {
      activeDelegatorIds: jest.fn().mockResolvedValue(["delegator-1"])
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      undefined,
      delegations as never
    );

    const approved = await paymentService.reviewApproval("FK-2026-012", "delegate-user-1", {
      decision: "approve",
      approvedAmountCents: 45_000
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(delegations.activeDelegatorIds).toHaveBeenCalledWith(tx, "delegate-user-1");
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "delegate-user-1",
        action: "payment.approval.approve"
      })
    });
  });

  it("rejects a pending payment request without making it payable", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "rejected",
          approvedAmountCents: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const rejected = await paymentService.reviewApproval("FK-2026-012", "general-manager-1", {
      decision: "reject"
    });

    expect(rejected.status).toBe("rejected");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        status: "rejected",
        approvedAmountCents: null
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.reject",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject",
        actorUserId: "general-manager-1"
      }
    });
  });

  it("rejects unsupported payment approval decisions before the transaction", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        decision: "invalid"
      } as never)
    ).rejects.toThrow("Unsupported payment approval decision");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a payment approval to the previous node and keeps it pending", async () => {
    const frozenNodes = [
      {
        name: "预算部主管",
        mode: "any",
        roleKeys: ["budget_director"],
        approvedRoleKeys: ["budget_director"]
      },
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"],
        approvedRoleKeys: ["chairman"]
      }
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 1,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      decision: "reject_previous"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: []
          },
          {
            ...frozenNodes[1],
            approvedRoleKeys: []
          }
        ],
        status: "in_progress"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject_previous",
        actorUserId: "chairman-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "chairman-1",
        action: "payment.approval.reject_previous",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects returning to a previous node from the first payment approval node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        decision: "reject_previous"
      })
    ).rejects.toThrow("Cannot reject payment approval to previous node from first node");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("returns a payment approval to the applicant as draft and closes the instance", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "draft"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "general-manager-1", {
      decision: "return_to_applicant"
    });

    expect(result.status).toBe("draft");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "draft" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "return_to_applicant",
        actorUserId: "general-manager-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.return_to_applicant",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("transfers the current payment approval node", async () => {
    const frozenNodes = [
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"]
      }
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.transferApproval("FK-2026-012", "chairman-1", {
      toUserId: "transfer-user-1"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        frozenNodes: [
          {
            ...frozenNodes[0],
            assignments: [
              {
                kind: "transfer",
                fromUserId: "chairman-1",
                fromRoleKey: "chairman",
                toUserId: "transfer-user-1"
              }
            ]
          }
        ]
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "transfer",
        actorUserId: "chairman-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "chairman-1",
        action: "payment.approval.transfer",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("lets the transferred user approve a payment as the source role", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "approved_pending_payment"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              assignments: [
                {
                  kind: "transfer",
                  fromUserId: "chairman-1",
                  fromRoleKey: "chairman",
                  toUserId: "transfer-user-1"
                }
              ]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "transfer-user-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_payment");
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "transfer-user-1",
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          approvedRoleKey: "chairman"
        })
      })
    });
  });

  it("delegates the current payment approval node and records delegation ledger", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      approvalDelegation: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.delegateApproval("FK-2026-012", "general-manager-1", {
      toUserId: "agent-user-1"
    });

    expect(tx.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "general-manager-1",
        toUserId: "agent-user-1",
        startsAt: expect.any(Date),
        endsAt: expect.any(Date)
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.delegate",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects approval review unless the payment request is pending approval", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        decision: "approve"
      })
    ).rejects.toThrow("Cannot review payment approval from status approved_pending_payment");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("rejects approved amount above requested amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        })
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        decision: "approve",
        approvedAmountCents: 50_001
      })
    ).rejects.toThrow("Approved amount cannot exceed requested amount");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("records actual payment execution and marks payment and settlement paid", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          paidAmountCents: 20_000
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000,
          paidAmountCents: 20_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "paid",
          paidAmountCents: 50_000
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 50_000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "partially_paid",
          payableAmountCents: 100_000,
          paidAmountCents: 70_000
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-1",
          paymentRequestId: "payment-1",
          amountCents: 30_000,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      amountCents: 30_000,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-1");
    expect(auth.confirmPassword).toHaveBeenCalledWith("cashier-1", "current-password");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.settlement.findUnique.mock.invocationCallOrder[0]
    );
    expect(tx.paymentExecution.create).toHaveBeenCalledWith({
      data: {
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        amountCents: 30_000,
        paidAt: new Date("2026-06-22T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      }
    });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        paidAmountCents: 50_000,
        status: "paid"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: {
        paidAmountCents: 100_000,
        status: "paid"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "cashier-1",
        action: "payment.execution.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects settlement execution when contract-level allocations consumed the settlement capacity", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 40_000
        }),
        update: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 40_000 }
        ])
      },
      paymentExecution: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 30_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("settlement remaining payable amount: 20000");

    expect(tx.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: "settlement-1",
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("records contract advance execution without touching settlement ledger", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-advance-1",
            code: "FK-YF-2026-001",
            settlementId: null,
            sourceType: "contract_advance",
            requestedAmountCents: 100_000,
            approvedAmountCents: 100_000,
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          code: "FK-YF-2026-001",
          settlementId: null,
          status: "approved_pending_payment",
          requestedAmountCents: 100_000,
          approvedAmountCents: 100_000,
          paidAmountCents: 0
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          status: "paid",
          paidAmountCents: 100_000
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 100_000,
          approvedAmountCents: 100_000,
          paidAmountCents: 100_000
        })
      },
      settlement: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-advance-1",
          paymentRequestId: "payment-advance-1",
          amountCents: 100_000,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-YF-2026-001", "cashier-1", {
      amountCents: 100_000,
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-advance-1");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.paymentRequest.update.mock.invocationCallOrder[0]
    );
    expect(tx.settlement.findUnique).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).toHaveBeenCalledWith({
      data: {
        paymentRequestId: "payment-advance-1",
        settlementId: null,
        amountCents: 100_000,
        paidAt: new Date("2026-07-03T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      }
    });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-advance-1" },
      data: {
        paidAmountCents: 100_000,
        status: "paid"
      }
    });
  });

  it("records allocation ledger rows for contract-level due payment executions", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-1",
            code: "FK-HT-2026-001",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 70_000,
            approvedAmountCents: 70_000,
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }, { id: "settlement-2" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          code: "FK-HT-2026-001",
          settlementId: null,
          sourceType: "contract_due",
          status: "approved_pending_payment",
          requestedAmountCents: 70_000,
          approvedAmountCents: 70_000,
          paidAmountCents: 0
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          status: "paid",
          paidAmountCents: 50_000
        }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 70_000,
          approvedAmountCents: 70_000,
          paidAmountCents: 50_000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          },
          {
            id: "settlement-2",
            status: "effective",
            amountCents: 80_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") },
          { settlementId: "settlement-2", confirmedAt: new Date("2026-07-02T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { sourceRowId: "settlement-1:progress:0", amountCents: 30_000 }
        ]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-1",
          paymentRequestId: "payment-due-1",
          amountCents: 50_000,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-HT-2026-001", "cashier-1", {
      amountCents: 50_000,
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-due-1");
    expect(tx.settlement.findUnique).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentExecutionId: "execution-due-1",
          paymentRequestId: "payment-due-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          settlementId: "settlement-1",
          sourceType: "contract_due",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-1:progress:0",
          paymentTermsVersionId: "terms-v1",
          stageType: "progress",
          stageId: "stage-progress",
          stageName: "进度款",
          triggerAnchor: "settlement_effective",
          dueDays: 0,
          ratioBps: 5000,
          fixedAmountCents: null,
          sourceEffectiveAt: new Date("2026-07-01T00:00:00.000Z"),
          expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
          sourcePayableAmountCents: 50_000,
          allocationOrder: 0,
          createdByUserId: "cashier-1",
          amountCents: 20_000
        }),
        expect.objectContaining({
          paymentExecutionId: "execution-due-1",
          paymentRequestId: "payment-due-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          settlementId: "settlement-2",
          sourceType: "contract_due",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-2:progress:0",
          paymentTermsVersionId: "terms-v1",
          stageType: "progress",
          stageId: "stage-progress",
          stageName: "进度款",
          sourcePayableAmountCents: 40_000,
          allocationOrder: 1,
          createdByUserId: "cashier-1",
          amountCents: 30_000
        })
      ]
    });
  });

  it("keeps contract-level execution allocations away from active settlement payment reservations", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-2",
            code: "FK-HT-2026-002",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }, { id: "settlement-2" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-2",
          status: "paid",
          paidAmountCents: 30_000
        }),
        findMany: jest.fn((args: { where?: { sourceType?: string } }) => {
          if (args.where?.sourceType === "settlement") {
            return Promise.resolve([
              {
                settlementId: "settlement-1",
                status: "approved_pending_payment",
                requestedAmountCents: 50_000,
                approvedAmountCents: 50_000,
                paidAmountCents: 0
              }
            ]);
          }

          return Promise.resolve([]);
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 30_000,
          approvedAmountCents: 30_000,
          paidAmountCents: 30_000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          },
          {
            id: "settlement-2",
            status: "effective",
            amountCents: 80_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") },
          { settlementId: "settlement-2", confirmedAt: new Date("2026-07-02T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-2",
          paymentRequestId: "payment-due-2",
          amountCents: 30_000,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-HT-2026-002", "cashier-1", {
      amountCents: 30_000,
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          settlementId: "settlement-2",
          sourceRowId: "settlement-2:progress:0",
          allocationType: "contract_due_payment",
          amountCents: 30_000
        })
      ]
    });
  });

  it("persists advance deduction ledger rows before contract-level execution allocations", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-3",
            code: "FK-HT-2026-003",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 30_000,
            approvedAmountCents: 30_000,
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-3",
          status: "paid",
          paidAmountCents: 30_000
        }),
        findMany: jest.fn((args: { where?: { sourceType?: string } }) => {
          if (args.where?.sourceType === "contract_advance") {
            return Promise.resolve([
              {
                paymentTermsVersionId: "terms-v1",
                status: "paid",
                requestedAmountCents: 50_000,
                approvedAmountCents: 50_000,
                paidAmountCents: 50_000
              }
            ]);
          }

          return Promise.resolve([]);
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 30_000,
          approvedAmountCents: 30_000,
          paidAmountCents: 30_000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000,
            paidAmountCents: 0,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: 1_000_000
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          },
          {
            id: "stage-advance",
            name: "预付款",
            paymentTermsVersionId: "terms-v1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-3",
          paymentRequestId: "payment-due-3",
          amountCents: 30_000,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-HT-2026-003", "cashier-1", {
      amountCents: 30_000,
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          allocationType: "advance_deduction",
          sourceRowId: "settlement-1:progress:0",
          amountCents: 20_000,
          allocationOrder: 0
        }),
        expect.objectContaining({
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-1:progress:0",
          amountCents: 30_000,
          allocationOrder: 1
        })
      ]
    });
  });

  it("records partial actual payment execution without completing payment", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          paidAmountCents: 10_000
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000,
          paidAmountCents: 10_000
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "partially_paid",
          paidAmountCents: 30_000
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 30_000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 10_000
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({ id: "execution-1" })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      amountCents: 20_000,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        paidAmountCents: 30_000,
        status: "partially_paid"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: {
        paidAmountCents: 30_000,
        status: "partially_paid"
      }
    });
  });

  it("moves only the paid financing portion to used on partial execution", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            paidAmountCents: 0
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 0
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "partially_paid",
          paidAmountCents: 30_000
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 30_000
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        }),
        update: jest.fn()
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "financing-quota-1",
            status: "approved",
            validUntil: new Date("2026-12-31T00:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({ id: "execution-1" })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates([
        {
          id: "usage-1",
          quotaId: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(30_000)
        }
      ])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      amountCents: 30_000,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.projectFinancingQuotaUsage.update).toHaveBeenCalledWith({
      where: { id: "usage-1" },
      data: { amountCents: BigInt(20_000) }
    });
    expect(tx.projectFinancingQuotaUsage.create).toHaveBeenCalledWith({
      data: {
        quotaId: "financing-quota-1",
        paymentRequestId: "payment-1",
        projectId: "project-1",
        amountCents: BigInt(10_000),
        status: "used"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "cashier-1",
      action: "payment.financing_quota.use",
      businessType: "payment_request",
      businessId: "payment-1",
      metadata: { usedAmountCents: "10000" }
    });
  });

  it("releases expired financing occupation and blocks actual payment execution", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([paymentExecutionRow({ paidAmountCents: 0 })])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(paymentExecutionRow({ paidAmountCents: 0 })),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        }),
        update: jest.fn()
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "financing-quota-1",
            status: "approved",
            validUntil: new Date("2026-06-21T00:00:00.000Z")
          }
        ])
      },
      paymentExecution: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates([
        {
          id: "usage-1",
          quotaId: "financing-quota-1",
          projectId: "project-1",
          amountCents: BigInt(30_000)
        }
      ])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 30_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("项目垫资额度已失效，请重新提交付款申请");

    expect(tx.projectFinancingQuotaUsage.update).toHaveBeenCalledWith({
      where: { id: "usage-1" },
      data: { status: "released" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "cashier-1",
      action: "payment.financing_quota.release.invalid_before_execution",
      businessType: "payment_request",
      businessId: "payment-1",
      metadata: { releasedAmountCents: "30000" }
    });
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "project inactive",
      [{ id: "project-1", isActive: false }],
      [{ id: "financing-quota-1", status: "approved", validUntil: new Date("2026-12-31T00:00:00.000Z") }]
    ],
    [
      "quota not approved",
      [{ id: "project-1", isActive: true }],
      [{ id: "financing-quota-1", status: "rejected", validUntil: new Date("2026-12-31T00:00:00.000Z") }]
    ],
    ["quota missing", [{ id: "project-1", isActive: true }], []]
  ])(
    "releases invalid financing occupation before execution when %s",
    async (_label, lockedProjects, quotas) => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([paymentExecutionRow({ paidAmountCents: 0 })])
          .mockResolvedValueOnce([{ id: "settlement-1" }])
          .mockResolvedValueOnce(lockedProjects),
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue(paymentExecutionRow({ paidAmountCents: 0 })),
          update: jest.fn()
        },
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            status: "effective",
            payableAmountCents: 100_000,
            paidAmountCents: 0
          }),
          update: jest.fn()
        },
        projectFinancingQuota: {
          findMany: jest.fn().mockResolvedValue(quotas)
        },
        paymentExecution: {
          create: jest.fn()
        },
        auditLog: {
          create: jest.fn()
        },
        ...financingUsageUpdates([
          {
            id: "usage-1",
            quotaId: "financing-quota-1",
            projectId: "project-1",
            amountCents: BigInt(30_000)
          }
        ])
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(
        new PaymentAmountService(),
        prisma as never,
        audit as never,
        undefined,
        auth as never
      );

      await expect(
        paymentService.recordExecution("FK-2026-012", "cashier-1", {
          amountCents: 30_000,
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).rejects.toThrow("项目垫资额度已失效，请重新提交付款申请");

      expect(tx.projectFinancingQuotaUsage.update).toHaveBeenCalledWith({
        where: { id: "usage-1" },
        data: { status: "released" }
      });
      expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    }
  );

  it("rejects actual payment execution before payment approval passes", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          status: "approval_pending",
          approvedAmountCents: null,
          paidAmountCents: 0
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approval_pending",
          approvedAmountCents: null,
          paidAmountCents: 0
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 20_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Cannot record payment execution from status approval_pending");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution with a future paid date", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 20_000,
        paidAt: "2026-07-04T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment execution date cannot be in the future");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution above approved remaining amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          approvedAmountCents: 50_000,
          paidAmountCents: 20_000
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000,
          paidAmountCents: 20_000
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 30_001,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment execution exceeds approved remaining amount: 30000");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when proxy payments consumed settlement capacity after approval", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          requestedAmountCents: 80_000,
          approvedAmountCents: 80_000,
          paidAmountCents: 0
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 80_000,
          requestedAmountCents: 80_000,
          paidAmountCents: 0
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000,
          paidAmountCents: 0
        })
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(80_000) }])
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 80_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment execution exceeds settlement remaining payable amount: 20000");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without positive amount and voucher file", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 0,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "",
        confirmationPassword: ""
      })
    ).rejects.toThrow("Payment execution amount must be greater than zero");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without voucher file", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment voucher file is required");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution with missing runtime fields", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: undefined as never,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment execution amount must be greater than zero");
    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: undefined as never,
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Payment voucher file is required");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without second confirmation password", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: ""
      })
    ).rejects.toThrow("Payment execution confirmation password is required");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when second confirmation fails", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    auth.confirmPassword.mockRejectedValue(new Error("Invalid confirmation password"));
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("Invalid confirmation password");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("records finance outflow after actual payment execution", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          status: "paid",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 20_000 }
        ]),
        create: jest.fn().mockResolvedValue({
          id: "finance-record-1",
          direction: "outflow",
          amountCents: 30_000
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const record = await paymentService.recordFinance("FK-2026-012", "finance-1", {
      amountCents: 30_000,
      occurredAt: "2026-06-22T00:00:00.000Z"
    });

    expect(record.id).toBe("finance-record-1");
    expect(tx.financeRecord.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        direction: "outflow",
        amountCents: 30_000,
        occurredAt: new Date("2026-06-22T00:00:00.000Z"),
        createdByUserId: "finance-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "payment.finance.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects finance record before actual payment execution", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "approved_pending_payment",
          paidAmountCents: 0
        })
      },
      financeRecord: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: 10_000,
        occurredAt: "2026-06-22T00:00:00.000Z"
      })
    ).rejects.toThrow("Cannot record finance entry before actual payment execution");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("rejects finance record above unrecorded paid amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          status: "partially_paid",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 40_000 }
        ]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: 10_001,
        occurredAt: "2026-06-22T00:00:00.000Z"
      })
    ).rejects.toThrow("Finance record exceeds unrecorded paid amount: 10000");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("records payment pdf document and archive after finance entry is complete", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000 }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-1",
          fileId: "file-1"
        })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({
          id: "archive-1",
          fileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
      fileId: "file-1"
    });

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(result.archiveRecord.id).toBe("archive-1");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-1",
        templateKey: "payment_finance_archive"
      }
    });
    expect(tx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-1",
        departmentScope: "finance"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "payment.pdf_archive.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("generates a payment PDF file and records its archive", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          requestedAmountCents: 60_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 50_000 }])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-generated" })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-1",
          fileId: "file-generated"
        })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({
          id: "archive-1",
          fileId: "file-generated"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" })
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    const result = await paymentService.generatePdfArchive("FK-2026-012", "finance-1");

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "FK-2026-012-payment_finance_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "finance-1",
      buffer: expect.any(Buffer)
    });
    const uploadedBuffer = files.uploadPrivateFile.mock.calls[0][0].buffer as Buffer;
    expect(uploadedBuffer.toString("ascii", 0, 8)).toBe("%PDF-1.4");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-generated",
        templateKey: "payment_finance_archive"
      }
    });
  });

  it("rejects payment PDF generation when the PDF archive already exists", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          requestedAmountCents: 60_000,
          approvedAmountCents: 50_000,
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 50_000 }])
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-existing" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("Payment PDF archive already exists");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects payment pdf archive before finance entry covers paid amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 20_000 }
        ])
      },
      fileObject: {
        findUnique: jest.fn()
      },
      pdfDocument: {
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("Cannot archive payment PDF before finance entry is complete");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects payment pdf archive when archive file is missing", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000 }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "missing-file"
      })
    ).rejects.toThrow("Payment archive file not found");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate payment pdf archive for the same template", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000 }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-existing"
        }),
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("Payment PDF archive already exists");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("lets the applicant remind an overdue in-progress payment approval", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-25T00:00:00.000Z"); // +48h, hits the default SLA
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "action-log-1", action: "remind" })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.remindApproval("FK-2026-012", "applicant-1", now);

    expect(result.action).toBe("remind");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "remind",
        actorUserId: "applicant-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "applicant-1",
        action: "payment.approval.remind",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects a payment approval reminder before the SLA has elapsed", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-24T00:00:00.000Z"); // +24h, under the default 48h SLA
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval("FK-2026-012", "applicant-1", now)
    ).rejects.toThrow("not due for a reminder");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a payment approval reminder from a non-applicant", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: new Date("2026-06-23T00:00:00.000Z"),
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval(
        "FK-2026-012",
        "intruder-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("applicant");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("lets the payment approval applicant withdraw before approval completes", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "withdrawn"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.withdrawApproval("FK-2026-012", "applicant-1");

    expect(result.status).toBe("withdrawn");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "applicant-1",
        action: "payment.approval.withdraw",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects payment approval withdrawal from a non-applicant", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "other-user")
    ).rejects.toThrow("Only payment approval applicant can withdraw");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects payment approval withdrawal once it has left approval_pending", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "applicant-1")
    ).rejects.toThrow("Cannot withdraw payment approval from status approved_pending_payment");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });
});
