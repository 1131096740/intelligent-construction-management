import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  RequestMethod
} from "@nestjs/common";
import {
  METHOD_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { CreateProcurementDiscrepancyDto } from "./dto/create-procurement-discrepancy.dto";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import {
  calculateFinancialFacts,
  type SettlementPaymentLockRow,
  SpotProcurementSettlementService
} from "./spot-procurement-settlement.service";
import { SpotProcurementController } from "./spot-procurement.controller";

type TestDiscrepancy = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  receiptId: string;
  receiptRevisionNo: number;
  receiptReviewId: string;
  status: string;
  approvedAmountCentsSnapshot: bigint;
  actualCostCentsSnapshot: bigint;
  shortageAmountCents: bigint;
  canceledUnexecutedAmountCents: bigint;
  paidAmountCentsSnapshot: bigint;
  supplierBalanceUsedAmountCentsSnapshot: bigint;
  overpaidAmountCents: bigint;
  resolutionType: string | null;
  supplierBalanceEntryId: string | null;
  note: string | null;
  createdByUserId: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  invalidatedAt: Date | null;
};

type TestRefund = {
  id: string;
  discrepancyId: string;
  procurementId: string;
  amountCents: bigint;
  receivedAt: Date;
  refundMethod: string;
  voucherFileId: string;
  recordedByUserId: string;
  idempotencyKey: string;
};

const ACTORS = {
  handler: "handler-1",
  materialDirector: "material-director-1",
  financeStaff: "finance-staff-1",
  financeDirector: "finance-director-1"
} as const;

function paymentRow(
  overrides: Partial<SettlementPaymentLockRow> = {}
): SettlementPaymentLockRow {
  return {
    id: "payment-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    status: "approved_pending_payment",
    settlementAmountCents: 10_000n,
    supplierBalanceAmountCents: 0n,
    companyPaymentAmountCents: 10_000n,
    paidAmountCents: 0n,
    executedSupplierBalanceAmountCents: 0n,
    canceledAmountCents: 0n,
    canceledCompanyPaymentAmountCents: 0n,
    canceledSupplierBalanceAmountCents: 0n,
    invalidatedAt: null,
    createdAt: new Date("2026-07-17T08:00:00.000Z"),
    ...overrides
  };
}

function discrepancyRow(
  overrides: Partial<TestDiscrepancy> = {}
): TestDiscrepancy {
  return {
    id: "discrepancy-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    receiptId: "receipt-1",
    receiptRevisionNo: 1,
    receiptReviewId: "review-1",
    status: "pending_resolution",
    approvedAmountCentsSnapshot: 10_000n,
    actualCostCentsSnapshot: 8_000n,
    shortageAmountCents: 2_000n,
    canceledUnexecutedAmountCents: 0n,
    paidAmountCentsSnapshot: 0n,
    supplierBalanceUsedAmountCentsSnapshot: 0n,
    overpaidAmountCents: 0n,
    resolutionType: null,
    supplierBalanceEntryId: null,
    note: null,
    createdByUserId: ACTORS.handler,
    resolvedAt: null,
    resolvedByUserId: null,
    invalidatedAt: null,
    ...overrides
  };
}

function refundRow(
  overrides: Partial<TestRefund> = {}
): TestRefund {
  return {
    id: "refund-1",
    discrepancyId: "discrepancy-1",
    procurementId: "procurement-1",
    amountCents: 1_000n,
    receivedAt: new Date("2020-01-02T03:04:05.000Z"),
    refundMethod: "bank_transfer",
    voucherFileId: "refund-voucher-1",
    recordedByUserId: ACTORS.financeStaff,
    idempotencyKey: "refund-key-1",
    ...overrides
  };
}

function sqlText(query: unknown) {
  return (
    query as { strings?: readonly string[] }
  ).strings?.join("?") ?? String(query);
}

function createHarness(options?: {
  actualCostCents?: bigint;
  payments?: SettlementPaymentLockRow[];
  discrepancy?: TestDiscrepancy | null;
  refund?: TestRefund | null;
  procurementStatus?: string;
  supplierBalanceEntry?: Record<string, unknown> | null;
  supplierBalanceReservation?: Record<string, unknown> | null;
}) {
  const actualCostCents = options?.actualCostCents ?? 8_000n;
  const payments = options?.payments ?? [paymentRow()];
  let activeDiscrepancy = options?.discrepancy ?? null;
  let storedRefund = options?.refund ?? null;
  const events: string[] = [];
  const procurement = {
    id: "procurement-1",
    projectId: "project-1",
    code: "LXCG-2026-0001",
    supplierPartyId: "party-1",
    supplierKey: "party:party-1",
    supplierNameSnapshot: "供应商甲",
    handlerUserId: ACTORS.handler,
    currentVersionId: "version-1",
    status: options?.procurementStatus ?? "approved_in_progress",
    approvedAmountCents: 10_000n,
    actualCostCents
  };
  const version = {
    id: "version-1",
    procurementId: "procurement-1",
    status: "approved",
    handlerUserId: ACTORS.handler,
    supplierPartyId: "party-1",
    supplierKey: "party:party-1",
    supplierNameSnapshot: "供应商甲",
    totalAmountCents: 10_000n
  };
  const receipt = {
    id: "receipt-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    status: "reviewed",
    currentRevisionNo: 1,
    handlerUserId: ACTORS.handler,
    actualCostCents
  };
  const revision = {
    id: "revision-1",
    receiptId: "receipt-1",
    revisionNo: 1,
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    handlerUserId: ACTORS.handler,
    actualCostCents
  };
  const review = {
    id: "review-1",
    receiptId: "receipt-1",
    receiptRevisionNo: 1,
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    sequenceNo: 1,
    decision: "approved"
  };
  const roles: Record<string, string> = {
    [ACTORS.handler]: "material_staff",
    [ACTORS.materialDirector]: "material_director",
    [ACTORS.financeStaff]: "finance_staff",
    [ACTORS.financeDirector]: "finance_director"
  };

  const sqlRows = (query: unknown) => {
    const text = sqlText(query);
    if (
      text.includes(
        'FROM "SpotProcurementPayment" payment'
      )
    ) {
      return [
        {
          id: version.id,
          procurementId: version.procurementId,
          projectId: procurement.projectId,
          currentVersionId: procurement.currentVersionId,
          rootStatus: procurement.status,
          status: version.status,
          supplierKey: version.supplierKey
        }
      ];
    }
    if (
      text.includes(
        'FROM "SpotProcurementPaymentExecution"'
      )
    ) {
      return payments.flatMap((payment) =>
        payment.paidAmountCents > 0n
          ? [
              {
                id: `execution-${payment.id}`,
                paymentId: payment.id,
                amountCents: payment.paidAmountCents
              }
            ]
          : []
      );
    }
    if (text.includes('FROM "SpotProcurementPayment"')) {
      return payments.map((payment) => ({ ...payment }));
    }
    if (
      text.includes('FROM "SpotProcurementDiscrepancy"')
    ) {
      return activeDiscrepancy
        ? [{ ...activeDiscrepancy }]
        : [];
    }
    if (
      text.includes(
        'FROM "SpotProcurementReceiptRevision"'
      )
    ) {
      return [revision];
    }
    if (
      text.includes('FROM "SpotProcurementReceiptReview"')
    ) {
      return [review];
    }
    if (
      text.includes('FROM "SpotProcurementReceiptLine"')
    ) {
      return [{ actualCostCents }];
    }
    if (text.includes('FROM "SpotProcurementReceipt"')) {
      return [receipt];
    }
    if (text.includes('FROM "SpotProcurementVersion"')) {
      return [version];
    }
    if (text.includes('FROM "Project"')) {
      events.push("project-lock");
      return [{ id: "project-1", isActive: true }];
    }
    if (text.includes('FROM "SpotProcurement"')) {
      return [procurement];
    }
    throw new Error(`unexpected SQL in test: ${text}`);
  };

  const tx = {
    $queryRaw: jest.fn().mockImplementation(sqlRows),
    user: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            isActive: true
          })
      )
    },
    userPosition: {
      findMany: jest.fn().mockImplementation(
        ({
          where
        }: {
          where: { userId: string; projectId: string | null };
        }) =>
          Promise.resolve(
            where.projectId === "project-1" &&
              roles[where.userId]
              ? [
                  {
                    positionId: `position:${where.userId}`
                  }
                ]
              : []
          )
      )
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    position: {
      findMany: jest.fn().mockImplementation(
        ({
          where
        }: {
          where: { id: { in: string[] } };
        }) =>
          Promise.resolve(
            where.id.in.map((id) => {
              const userId = id.slice("position:".length);
              return { id, key: roles[userId] };
            })
          )
      )
    },
    spotProcurementDiscrepancy: {
      create: jest.fn().mockImplementation(
        ({ data }: { data: Omit<TestDiscrepancy, "id"> }) => {
          activeDiscrepancy = {
            ...data,
            id: "discrepancy-created",
            supplierBalanceEntryId: null,
            resolvedAt: null,
            resolvedByUserId: null,
            invalidatedAt: null
          };
          return Promise.resolve({ ...activeDiscrepancy });
        }
      ),
      updateMany: jest.fn().mockImplementation(
        ({
          where,
          data
        }: {
          where: { id: string; status?: string };
          data: Partial<TestDiscrepancy>;
        }) => {
          if (
            !activeDiscrepancy ||
            activeDiscrepancy.id !== where.id ||
            (where.status &&
              activeDiscrepancy.status !== where.status)
          ) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(activeDiscrepancy, data);
          return Promise.resolve({ count: 1 });
        }
      ),
      findUniqueOrThrow: jest.fn().mockImplementation(() => {
        if (!activeDiscrepancy) {
          return Promise.reject(new Error("missing discrepancy"));
        }
        return Promise.resolve({ ...activeDiscrepancy });
      }),
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve(
          activeDiscrepancy?.status === "pending_resolution"
            ? { id: activeDiscrepancy.id }
            : null
        )
      )
    },
    spotProcurementPayment: {
      updateMany: jest.fn().mockImplementation(
        ({
          where,
          data
        }: {
          where: { id: string };
          data: Partial<SettlementPaymentLockRow>;
        }) => {
          const payment = payments.find(
            (candidate) => candidate.id === where.id
          );
          if (!payment) return Promise.resolve({ count: 0 });
          Object.assign(payment, data);
          return Promise.resolve({ count: 1 });
        }
      )
    },
    spotProcurementRefund: {
      findUnique: jest.fn().mockImplementation(
        ({
          where
        }: {
          where: {
            idempotencyKey?: string;
            discrepancyId?: string;
          };
        }) =>
          Promise.resolve(
            storedRefund &&
              ((where.idempotencyKey &&
                storedRefund.idempotencyKey ===
                  where.idempotencyKey) ||
                (where.discrepancyId &&
                  storedRefund.discrepancyId ===
                    where.discrepancyId))
              ? { ...storedRefund }
              : null
          )
      ),
      create: jest.fn().mockImplementation(
        ({ data }: { data: Omit<TestRefund, "id"> }) => {
          storedRefund = {
            id: "refund-created",
            ...data
          };
          return Promise.resolve({ ...storedRefund });
        }
      )
    },
    supplierBalanceEntry: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options?.supplierBalanceEntry ?? null
        ),
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.supplierBalanceEntry ?? null
        )
    },
    supplierBalanceReservation: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options?.supplierBalanceReservation ?? null
        )
    }
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(
      (
        operation: (client: typeof tx) => Promise<unknown>
      ) => operation(tx)
    ),
    spotProcurementRefund: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { idempotencyKey: string } }) =>
          Promise.resolve(
            storedRefund?.idempotencyKey ===
              where.idempotencyKey
              ? { ...storedRefund }
              : null
          )
      )
    }
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const pilot = { assertEnabled: jest.fn() };
  const balances = {
    releaseForShortage: jest.fn().mockResolvedValue({
      releasedAmountCents: 0n,
      remainingAmountCents: 0n,
      status: "reserved"
    }),
    creditFromDiscrepancy: jest.fn().mockResolvedValue({
      accountId: "balance-account-1",
      entryId: "balance-credit-entry-1",
      amountCents: 1_000n
    }),
    executeReservation: jest.fn().mockResolvedValue({
      accountId: "balance-account-1",
      reservationId: "reservation-1",
      entryId: "balance-execution-entry-1",
      amountCents: 2_000n
    })
  };
  const auth = {
    confirmPassword: jest.fn().mockResolvedValue(undefined)
  };
  const files = {
    assertCanDownloadFileById: jest
      .fn()
      .mockResolvedValue(undefined),
    assertFileHasNoBusinessBinding: jest
      .fn()
      .mockImplementation(() => {
        events.push("file-unbound-lock");
        return Promise.resolve();
      }),
    assertCanDownloadFile: jest
      .fn()
      .mockImplementation(() => {
        events.push("file-download-lock");
        return Promise.resolve();
      })
  };
  const approvalForms = {
    tryRefreshLatestForBusiness: jest
      .fn()
      .mockResolvedValue(undefined)
  };
  const closure = {
    recalculateAndClose: jest.fn().mockResolvedValue({ closed: false })
  };
  const service = new SpotProcurementSettlementService(
    prisma as never,
    audit as never,
    pilot as never,
    balances as never,
    auth as never,
    files as never,
    approvalForms as never,
    closure as never
  );

  return {
    service,
    prisma,
    tx,
    audit,
    balances,
    auth,
    files,
    approvalForms,
    events,
    payments,
    getDiscrepancy: () => activeDiscrepancy,
    getRefund: () => storedRefund
  };
}

describe("Spot procurement settlement contracts", () => {
  it("requires an explicit initiate or confirm operation and rejects client-derived amounts", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        {},
        {
          type: "body",
          metatype: CreateProcurementDiscrepancyDto
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "差异处理操作不正确"
        ])
      }
    });

    for (const operation of ["initiate", "confirm"] as const) {
      await expect(
        pipe.transform(
          { operation },
          {
            type: "body",
            metatype: CreateProcurementDiscrepancyDto
          }
        )
      ).resolves.toMatchObject({ operation });
    }

    await expect(
      pipe.transform(
        {
          operation: "initiate",
          shortageAmountCents: "1",
          overpaidAmountCents: "1"
        },
        {
          type: "body",
          metatype: CreateProcurementDiscrepancyDto
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "shortageAmountCents 不是允许提交的字段",
          "overpaidAmountCents 不是允许提交的字段"
        ])
      }
    });
  });

  it("exposes the four settlement routes with exact project actions", () => {
    const expectations = [
      [
        SpotProcurementController,
        "createOrConfirmDiscrepancy",
        ":procurementId/discrepancy",
        "spot_procurement.discrepancy.create"
      ],
      [
        SpotProcurementController,
        "recordRefund",
        ":procurementId/refunds",
        "spot_procurement.refund.record"
      ],
      [
        SpotProcurementController,
        "creditSupplierBalance",
        ":procurementId/supplier-balance-credit",
        "spot_procurement.balance.execute"
      ],
      [
        SpotProcurementPaymentController,
        "executeSupplierBalance",
        ":paymentId/balance-execution",
        "spot_procurement.balance.execute"
      ]
    ] as const;

    for (const [controller, method, path, action] of expectations) {
      const target = (
        controller.prototype as unknown as Record<
          string,
          object
        >
      )[method];
      expect(
        Reflect.getMetadata(METHOD_METADATA, target)
      ).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(
        path
      );
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          target
        )
      ).toBe(action);
    }
  });
});

describe("calculateFinancialFacts", () => {
  it("separates shortage from a real overpayment", () => {
    const result = calculateFinancialFacts(
      [
        paymentRow({
          paidAmountCents: 9_000n,
          companyPaymentAmountCents: 10_000n
        })
      ],
      8_000n,
      10_000n
    );

    expect(result).toEqual({
      approvedAmountCents: 10_000n,
      approvedPaymentCoverageAmountCents: 10_000n,
      actualCostCents: 8_000n,
      shortageAmountCents: 2_000n,
      companyPaidAmountCents: 9_000n,
      executedSupplierBalanceAmountCents: 0n,
      grossExecutedAmountCents: 9_000n,
      canceledUnexecutedAmountCents: 0n,
      overpaidAmountCents: 1_000n,
      remainingPayableAmountCents: 0n
    });
  });

  it("does not invent an overpayment or cancellation when approved payment coverage is below actual cost", () => {
    const result = calculateFinancialFacts(
      [
        paymentRow({
          settlementAmountCents: 5_000n,
          companyPaymentAmountCents: 5_000n,
          paidAmountCents: 4_000n
        })
      ],
      8_000n,
      10_000n
    );

    expect(result).toMatchObject({
      approvedPaymentCoverageAmountCents: 5_000n,
      shortageAmountCents: 2_000n,
      grossExecutedAmountCents: 4_000n,
      overpaidAmountCents: 0n,
      canceledUnexecutedAmountCents: 0n,
      remainingPayableAmountCents: 4_000n
    });
  });
});

describe("SpotProcurementSettlementService discrepancy workflow", () => {
  it("derives all discrepancy amounts on the server and replays the same initiate request without a second write", async () => {
    const harness = createHarness({
      actualCostCents: 8_000n,
      payments: [
        paymentRow({
          paidAmountCents: 9_000n,
          companyPaymentAmountCents: 10_000n
        })
      ]
    });
    const input = {
      operation: "initiate" as const,
      resolutionType: "full_refund" as const,
      note: "  数量少于审批量  "
    };

    const first = await harness.service.createOrConfirmDiscrepancy(
      "procurement-1",
      ACTORS.handler,
      input
    );
    const replay =
      await harness.service.createOrConfirmDiscrepancy(
        "procurement-1",
        ACTORS.handler,
        input
      );

    expect(first).toEqual(replay);
    expect(
      harness.tx.spotProcurementDiscrepancy.create
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.tx.spotProcurementDiscrepancy.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approvedAmountCentsSnapshot: 10_000n,
        actualCostCentsSnapshot: 8_000n,
        shortageAmountCents: 2_000n,
        paidAmountCentsSnapshot: 9_000n,
        supplierBalanceUsedAmountCentsSnapshot: 0n,
        overpaidAmountCents: 1_000n,
        resolutionType: "full_refund",
        note: "数量少于审批量"
      })
    });
    expect(
      harness.audit.record.mock.calls.filter(
        ([, input]) =>
          input.action ===
          "spot_procurement.discrepancy.create"
      )
    ).toHaveLength(1);
  });

  it("cancels no approved capacity when partial payment coverage is already below actual cost", async () => {
    const discrepancy = discrepancyRow();
    const harness = createHarness({
      actualCostCents: 8_000n,
      payments: [
        paymentRow({
          settlementAmountCents: 5_000n,
          companyPaymentAmountCents: 5_000n
        })
      ],
      discrepancy
    });

    const result =
      await harness.service.createOrConfirmDiscrepancy(
        "procurement-1",
        ACTORS.materialDirector,
        { operation: "confirm" }
      );

    expect(
      harness.tx.spotProcurementPayment.updateMany
    ).not.toHaveBeenCalled();
    expect(
      harness.balances.releaseForShortage
    ).not.toHaveBeenCalled();
    expect(result.settlement).toMatchObject({
      approvedPaymentCoverageAmountCents: "5000",
      actualCostCents: "8000",
      canceledUnexecutedAmountCents: "0",
      remainingPayableAmountCents: "8000"
    });
  });

  it("cancels only excess approved capacity from the newest payment and company funds before balance", async () => {
    const oldPayment = paymentRow({
      id: "payment-old",
      settlementAmountCents: 5_000n,
      companyPaymentAmountCents: 4_000n,
      supplierBalanceAmountCents: 1_000n,
      createdAt: new Date("2026-07-16T08:00:00.000Z")
    });
    const newestPayment = paymentRow({
      id: "payment-new",
      settlementAmountCents: 5_000n,
      companyPaymentAmountCents: 3_000n,
      supplierBalanceAmountCents: 2_000n,
      createdAt: new Date("2026-07-17T08:00:00.000Z")
    });
    const harness = createHarness({
      actualCostCents: 6_000n,
      payments: [oldPayment, newestPayment],
      discrepancy: discrepancyRow({
        actualCostCentsSnapshot: 6_000n,
        shortageAmountCents: 4_000n
      })
    });

    const result =
      await harness.service.createOrConfirmDiscrepancy(
        "procurement-1",
        ACTORS.materialDirector,
        { operation: "confirm" }
      );

    expect(
      harness.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "payment-new" }),
      data: expect.objectContaining({
        canceledAmountCents: 4_000n,
        canceledCompanyPaymentAmountCents: 3_000n,
        canceledSupplierBalanceAmountCents: 1_000n
      })
    });
    expect(
      harness.balances.releaseForShortage
    ).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        paymentId: "payment-new",
        expectedReservedAmountCents: 2_000n,
        releaseAmountCents: 1_000n
      })
    );
    expect(oldPayment.canceledAmountCents).toBe(0n);
    expect(result.settlement).toMatchObject({
      approvedPaymentCoverageAmountCents: "6000",
      actualCostCents: "6000",
      canceledUnexecutedAmountCents: "4000"
    });
  });

  it.each([
    { code: "P2010", meta: { code: "40P01" } },
    { code: "40P01" }
  ])("maps PostgreSQL deadlock shape %# to a safe 409", async (error) => {
    const harness = createHarness();
    harness.prisma.$transaction.mockRejectedValueOnce(error);

    await expect(
      harness.service.createOrConfirmDiscrepancy(
        "procurement-1",
        ACTORS.handler,
        { operation: "initiate" }
      )
    ).rejects.toEqual(
      new ConflictException(
        "差异、退款或供应商余额已变化，请刷新后重试"
      )
    );
  });
});

describe("SpotProcurementSettlementService refund workflow", () => {
  const refundInput = {
    amountCents: "1000",
    receivedAt: "2020-01-02T03:04:05.000Z",
    refundMethod: "bank_transfer" as const,
    voucherFileId: "refund-voucher-1",
    idempotencyKey: "refund-key-1"
  };

  function awaitingRefundDiscrepancy() {
    return discrepancyRow({
      status: "awaiting_refund",
      canceledUnexecutedAmountCents: 1_000n,
      paidAmountCentsSnapshot: 9_000n,
      overpaidAmountCents: 1_000n,
      resolutionType: "full_refund"
    });
  }

  function paidRefundHarness(options?: {
    discrepancy?: TestDiscrepancy;
    refund?: TestRefund | null;
  }) {
    return createHarness({
      actualCostCents: 8_000n,
      payments: [
        paymentRow({
          settlementAmountCents: 10_000n,
          companyPaymentAmountCents: 10_000n,
          paidAmountCents: 9_000n,
          canceledAmountCents: 1_000n,
          canceledCompanyPaymentAmountCents: 1_000n
        })
      ],
      discrepancy:
        options?.discrepancy ??
        awaitingRefundDiscrepancy(),
      refund: options?.refund ?? null
    });
  }

  it("requires the exact full refund, locks the project before files, and replays one immutable fact", async () => {
    const harness = paidRefundHarness();

    await expect(
      harness.service.recordRefund(
        "procurement-1",
        ACTORS.financeStaff,
        { ...refundInput, amountCents: "999" }
      )
    ).rejects.toEqual(
      new BadRequestException(
        "退款到账金额必须等于待退款整笔差额 1000 分"
      )
    );

    harness.events.splice(0);
    const first = await harness.service.recordRefund(
      "procurement-1",
      ACTORS.financeStaff,
      refundInput
    );
    const replay = await harness.service.recordRefund(
      "procurement-1",
      ACTORS.financeStaff,
      refundInput
    );

    expect(first).toEqual(replay);
    expect(harness.events).toEqual([
      "project-lock",
      "file-unbound-lock",
      "file-download-lock"
    ]);
    expect(
      harness.tx.spotProcurementRefund.create
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.tx.spotProcurementDiscrepancy.updateMany
    ).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      refund: { amountCents: "1000" },
      discrepancy: { status: "resolved" },
      settlement: {
        companyPaidAmountCents: "9000",
        refundedAmountCents: "1000",
        fundsSettledAmountCents: "8000",
        overpaidAmountCents: "0"
      }
    });
  });

  it("fails closed when an idempotent refund key points at a dirty cross-table discrepancy", async () => {
    const harness = paidRefundHarness({
      discrepancy: awaitingRefundDiscrepancy(),
      refund: refundRow()
    });
    const discrepancy = harness.getDiscrepancy();
    if (!discrepancy) throw new Error("missing test discrepancy");
    discrepancy.projectId = "project-other";
    discrepancy.status = "resolved";

    await expect(
      harness.service.recordRefund(
        "procurement-1",
        ACTORS.financeStaff,
        refundInput
      )
    ).rejects.toEqual(
      new ConflictException(
        "收货差异与当前采购、收货或复核坐标不一致"
      )
    );
    expect(
      harness.tx.spotProcurementRefund.create
    ).not.toHaveBeenCalled();
    expect(
      harness.files.assertFileHasNoBusinessBinding
    ).not.toHaveBeenCalled();
  });
});

describe("SpotProcurementSettlementService supplier balance workflow", () => {
  it("credits an overpayment once and returns the same terminal fact on replay", async () => {
    const harness = createHarness({
      actualCostCents: 8_000n,
      payments: [
        paymentRow({
          paidAmountCents: 9_000n,
          canceledAmountCents: 1_000n,
          canceledCompanyPaymentAmountCents: 1_000n
        })
      ],
      discrepancy: discrepancyRow({
        status: "awaiting_supplier_balance",
        canceledUnexecutedAmountCents: 1_000n,
        paidAmountCentsSnapshot: 9_000n,
        overpaidAmountCents: 1_000n,
        resolutionType: "full_supplier_balance"
      }),
      supplierBalanceEntry: {
        id: "balance-credit-entry-1",
        accountId: "balance-account-1",
        procurementId: "procurement-1",
        entryType: "credit_from_discrepancy",
        availableDeltaCents: 1_000n,
        reservedDeltaCents: 0n
      }
    });

    const first = await harness.service.creditSupplierBalance(
      "procurement-1",
      ACTORS.financeDirector,
      { confirmationPassword: "password" }
    );
    const replay =
      await harness.service.creditSupplierBalance(
        "procurement-1",
        ACTORS.financeDirector,
        { confirmationPassword: "password" }
      );

    expect(first).toEqual(replay);
    expect(
      harness.balances.creditFromDiscrepancy
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.balances.creditFromDiscrepancy
    ).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        discrepancyId: "discrepancy-1",
        amountCents: 1_000n,
        actorUserId: ACTORS.financeDirector
      })
    );
    expect(first).toMatchObject({
      supplierBalance: {
        accountId: "balance-account-1",
        entryId: "balance-credit-entry-1",
        amountCents: "1000"
      },
      discrepancy: { status: "resolved" },
      settlement: {
        transferredSupplierBalanceAmountCents: "1000",
        fundsSettledAmountCents: "8000",
        overpaidAmountCents: "0"
      }
    });
  });

  it("executes a reserved balance once and returns the verified ledger entry on replay", async () => {
    const balancePayment = paymentRow({
      settlementAmountCents: 2_000n,
      companyPaymentAmountCents: 0n,
      supplierBalanceAmountCents: 2_000n
    });
    const harness = createHarness({
      payments: [balancePayment],
      supplierBalanceReservation: {
        id: "reservation-1",
        accountId: "balance-account-1",
        amountCents: 2_000n,
        releasedAmountCents: 0n,
        status: "executed"
      },
      supplierBalanceEntry: {
        id: "balance-execution-entry-1",
        accountId: "balance-account-1",
        reservationId: "reservation-1",
        procurementId: "procurement-1",
        availableDeltaCents: -2_000n,
        reservedDeltaCents: -2_000n
      }
    });

    const first = await harness.service.executeSupplierBalance(
      "payment-1",
      ACTORS.financeDirector,
      { confirmationPassword: "password" }
    );
    const replay =
      await harness.service.executeSupplierBalance(
        "payment-1",
        ACTORS.financeDirector,
        { confirmationPassword: "password" }
      );

    expect(first).toEqual(replay);
    expect(
      harness.balances.executeReservation
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledTimes(1);
    expect(replay).toMatchObject({
      supplierBalanceExecution: {
        entryId: "balance-execution-entry-1",
        amountCents: "2000"
      },
      payment: {
        id: "payment-1",
        executedSupplierBalanceAmountCents: "2000"
      }
    });
  });
});
