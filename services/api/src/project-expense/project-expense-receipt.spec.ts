import { ProjectExpenseService } from "./project-expense.service";

const RECEIPT_IDEMPOTENCY_KEY =
  "7b5e5a60-4f7c-46b7-8f57-6ebd71573af4";
const EXPENSE_UPDATED_AT = new Date("2026-07-31T03:00:00.000Z");
const COMMITTED_UPDATED_AT = new Date("2026-07-31T03:00:02.000Z");
const CONFIRMED_AT = new Date("2026-07-31T03:00:01.000Z");

function committedReceiptFact(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "expense-1",
    projectId: "project-1",
    receiptConfirmedByUserId: "material-1",
    receiptConfirmedAt: CONFIRMED_AT,
    receiptConfirmationIdempotencyKey:
      RECEIPT_IDEMPOTENCY_KEY,
    receiptConfirmationNote: "数量无误",
    updatedAt: COMMITTED_UPDATED_AT,
    ...overrides
  };
}

function receiptInput(
  overrides: Partial<{
    expectedExpenseUpdatedAt: string;
    idempotencyKey: string;
    confirmationPassword: string;
    note: string;
  }> = {}
) {
  return {
    expectedExpenseUpdatedAt: EXPENSE_UPDATED_AT.toISOString(),
    idempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
    confirmationPassword: "current-password",
    note: "数量无误",
    ...overrides
  };
}

function receiptFixture({
  status = "approved_pending_payment",
  applicantUserId = "material-1",
  actorActive = true,
  actorRoleKeys = ["material_staff"],
  purchaseExecutedAt = new Date("2026-07-31T02:00:00.000Z"),
  receiptConfirmedAt = null,
  receiptConfirmedByUserId = null,
  receiptConfirmationIdempotencyKey = null,
  receiptConfirmationNote = null,
  updatedAt = EXPENSE_UPDATED_AT,
  transactionError = null,
  concurrentReceipt = null
}: {
  status?: string;
  applicantUserId?: string;
  actorActive?: boolean;
  actorRoleKeys?: readonly string[];
  purchaseExecutedAt?: Date | null;
  receiptConfirmedAt?: Date | null;
  receiptConfirmedByUserId?: string | null;
  receiptConfirmationIdempotencyKey?: string | null;
  receiptConfirmationNote?: string | null;
  updatedAt?: Date;
  transactionError?: unknown;
  concurrentReceipt?: Record<string, unknown> | null;
} = {}) {
  const row = {
    id: "expense-1",
    projectId: "project-1",
    code: "CG-2026-005",
    expenseType: "spot_purchase",
    status,
    requestedAmountCents: 50_000n,
    approvedAmountCents: 50_000n,
    paidAmountCents:
      status === "approved_pending_payment" ? 0n : 20_000n,
    applicantUserId,
    purchaseExecutedAt,
    receiptConfirmedByUserId,
    receiptConfirmedAt,
    receiptConfirmationIdempotencyKey,
    receiptConfirmationNote,
    updatedAt
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "material-1",
        isActive: actorActive
      })
    },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(
        actorRoleKeys.map((positionKey) => ({ positionKey }))
      )
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    projectExpenseRequest: {
      update: jest.fn().mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...row,
            ...data,
            updatedAt: COMMITTED_UPDATED_AT
          })
      )
    }
  };
  const prisma = {
    projectExpenseRequest: {
      findFirst: jest.fn().mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            "receiptConfirmationIdempotencyKey" in where
              ? concurrentReceipt
              : {
                  id: row.id,
                  projectId: row.projectId
                }
          )
      )
    },
    $transaction: jest.fn(
      async (
        callback: (transaction: typeof tx) => Promise<unknown>
      ) => {
        if (transactionError) throw transactionError;
        return callback(tx);
      }
    )
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const auth = {
    confirmPassword: jest.fn().mockResolvedValue({ ok: true })
  };
  const service = new ProjectExpenseService(
    prisma as never,
    audit as never,
    auth as never
  );
  return { service, prisma, tx, audit, auth, row };
}

describe("ProjectExpenseService legacy spot-purchase receipt confirmation", () => {
  it.each([
    "approved_pending_payment",
    "partially_paid",
    "paid",
    "payment_blocked"
  ] as const)(
    "confirms receipt in %s without requiring payment or finance records",
    async (status) => {
      const { service, prisma, tx, audit, auth } = receiptFixture({ status });

      const result = await service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      );

      expect(auth.confirmPassword).toHaveBeenCalledWith(
        "material-1",
        "current-password"
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: "Serializable" })
      );
      expect(tx).not.toHaveProperty("financeRecord");
      expect(tx.projectExpenseRequest.update).toHaveBeenCalledWith({
        where: { id: "expense-1" },
        data: {
          receiptConfirmedByUserId: "material-1",
          receiptConfirmedAt: expect.any(Date),
          receiptConfirmationIdempotencyKey:
            RECEIPT_IDEMPOTENCY_KEY,
          receiptConfirmationNote: "数量无误"
        }
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorUserId: "material-1",
          action: "project_expense.receipt.confirm",
          businessType: "project_expense_request",
          businessId: "expense-1",
          metadata: expect.objectContaining({
            code: "CG-2026-005",
            projectId: "project-1",
            idempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
            confirmedByUserId: "material-1",
            confirmedAt: expect.any(String),
            note: "数量无误",
            statusAtConfirmation: status,
            paymentCompleted: status === "paid",
            expectedExpenseUpdatedAt:
              EXPENSE_UPDATED_AT.toISOString()
          })
        })
      );
      expect(result).toEqual({
        projectId: "project-1",
        expenseRequestId: "expense-1",
        idempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
        confirmedByUserId: "material-1",
        confirmedAt: expect.any(String),
        note: "数量无误",
        updatedAt: COMMITTED_UPDATED_AT.toISOString()
      });
      expect(Object.keys(result)).toEqual([
        "projectId",
        "expenseRequestId",
        "idempotencyKey",
        "confirmedByUserId",
        "confirmedAt",
        "note",
        "updatedAt"
      ]);
    }
  );

  it("replays the same committed fact before evaluating stale CAS", async () => {
    const confirmedAt = new Date("2026-07-31T03:00:01.000Z");
    const { service, tx, audit } = receiptFixture({
      receiptConfirmedAt: confirmedAt,
      receiptConfirmedByUserId: "material-1",
      receiptConfirmationIdempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
      receiptConfirmationNote: "数量无误",
      updatedAt: COMMITTED_UPDATED_AT
    });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).resolves.toEqual({
      projectId: "project-1",
      expenseRequestId: "expense-1",
      idempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
      confirmedByUserId: "material-1",
      confirmedAt: confirmedAt.toISOString(),
      note: "数量无误",
      updatedAt: COMMITTED_UPDATED_AT.toISOString()
    });
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a reused receipt idempotency key with different facts", async () => {
    const { service, tx } = receiptFixture({
      receiptConfirmedAt: new Date("2026-07-31T03:00:01.000Z"),
      receiptConfirmedByUserId: "material-1",
      receiptConfirmationIdempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
      receiptConfirmationNote: "原收货说明",
      updatedAt: COMMITTED_UPDATED_AT
    });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).rejects.toThrow("该收货确认幂等键已绑定不同的持久事实");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
  });

  it("rejects stale parent CAS before creating a new receipt fact", async () => {
    const { service, tx, audit } = receiptFixture({
      updatedAt: COMMITTED_UPDATED_AT
    });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).rejects.toThrow("项目支出申请已变化，请刷新后重试");
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["P2002", { code: "P2002" }],
    ["P2034", { code: "P2034" }],
    [
      "P2010/sqlstate 40001",
      { code: "P2010", meta: { code: "40001" } }
    ]
  ])(
    "returns only the exact receipt winner after %s",
    async (_label, transactionError) => {
      const { service, prisma } = receiptFixture({
        transactionError,
        concurrentReceipt: committedReceiptFact()
      });

      await expect(
        service.confirmPurchaseReceipt(
          "project-1",
          "expense-1",
          "material-1",
          receiptInput()
        )
      ).resolves.toEqual({
        projectId: "project-1",
        expenseRequestId: "expense-1",
        idempotencyKey: RECEIPT_IDEMPOTENCY_KEY,
        confirmedByUserId: "material-1",
        confirmedAt: CONFIRMED_AT.toISOString(),
        note: "数量无误",
        updatedAt: COMMITTED_UPDATED_AT.toISOString()
      });
      expect(
        prisma.projectExpenseRequest.findFirst
      ).toHaveBeenCalledTimes(2);
    }
  );

  it("rejects a non-exact receipt winner after a uniqueness race", async () => {
    const { service } = receiptFixture({
      transactionError: { code: "P2002" },
      concurrentReceipt: committedReceiptFact({
        receiptConfirmationNote: "另一收货事实"
      })
    });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).rejects.toThrow("收货确认幂等键已绑定其他持久事实");
  });

  it("maps a serialization conflict without a receipt winner", async () => {
    const { service } = receiptFixture({
      transactionError: { code: "P2034" },
      concurrentReceipt: null
    });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).rejects.toThrow(
      "项目支出收货确认并发冲突，请刷新后重试"
    );
  });

  it.each([
    ["inactive account", { actorActive: false }],
    ["wrong project role", { actorRoleKeys: ["finance_staff"] }],
    ["non applicant", { applicantUserId: "other-1" }]
  ] as const)("rejects %s inside the write transaction", async (_label, overrides) => {
    const { service, tx } = receiptFixture({ ...overrides });

    await expect(
      service.confirmPurchaseReceipt(
        "project-1",
        "expense-1",
        "material-1",
        receiptInput()
      )
    ).rejects.toThrow();
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
  });

  it.each(["approval_pending", "rejected", "withdrawn", "voided"])(
    "rejects receipt confirmation in %s",
    async (status) => {
      const { service, tx } = receiptFixture({ status });

      await expect(
        service.confirmPurchaseReceipt(
          "project-1",
          "expense-1",
          "material-1",
          receiptInput()
        )
      ).rejects.toThrow("当前项目支出状态不可确认收货");
      expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    }
  );
});
