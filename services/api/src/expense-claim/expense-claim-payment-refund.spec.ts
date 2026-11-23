import { ForbiddenException } from "@nestjs/common";
import { ExpenseClaimPaymentRefundService } from "./expense-claim-payment-refund.service";

const CLAIM = {
  id: "claim-1",
  code: "LXFY-2026-11-23-001",
  claimType: "incidental_expense",
  status: "paid",
  projectId: "project-1",
  companyEntityId: "company-1",
  companyEntityNameSnapshot: "我方公司",
  companyPayableAmountCents: 1000000n,
  fundedAmountCents: 1000000n,
  handledByUserId: "handler-1",
  applicantUserId: "handler-1"
};

function refundFixture(options: {
  roles?: string[];
  executionAmountCents?: bigint;
  refundedSoFarCents?: bigint;
  existingRefund?: Record<string, unknown> | null;
  extraExecutions?: Array<{ id: string; amountCents: bigint }>;
} = {}) {
  const execution = {
    id: "exec-1",
    expenseClaimId: CLAIM.id,
    amountCents: options.executionAmountCents ?? 1000000n,
    paidAt: new Date("2026-11-20T00:00:00.000Z"),
    paymentMethod: "bank_transfer",
    voucherFileId: "voucher-1",
    recordedByUserId: "finance-1",
    note: null
  };
  const executions = [{ id: execution.id, amountCents: execution.amountCents }, ...(options.extraExecutions ?? [])];
  let refundedTotal = options.refundedSoFarCents ?? 0n;
  const refundCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    refundedTotal += data.amountCents as bigint;
    return data;
  });
  const claimUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...CLAIM, ...data }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([CLAIM]),
    expenseClaim: {
      findUnique: jest.fn().mockResolvedValue(CLAIM),
      update: claimUpdate
    },
    expenseClaimPaymentExecution: {
      findFirst: jest.fn().mockResolvedValue(execution),
      findMany: jest.fn().mockResolvedValue(executions)
    },
    paymentExecutionRefund: {
      findUnique: jest.fn().mockResolvedValue(options.existingRefund ?? null),
      aggregate: jest.fn(async () => ({ _sum: { amountCents: refundedTotal } })),
      create: refundCreate
    }
  };
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ExpenseClaimPaymentRefundService(prisma as never, audit as never);
  (service as unknown as { roles: { resolveActiveRoleScopesInTransaction: jest.Mock } }).roles = {
    resolveActiveRoleScopesInTransaction: jest.fn().mockResolvedValue(options.roles ?? ["finance_staff"])
  };
  (service as unknown as { appendFunding: jest.Mock }).appendFunding = jest.fn().mockResolvedValue({ accountId: "account-1", registrationId: "registration-2" });
  return { service, tx, audit, refundCreate, claimUpdate, execution };
}

const REFUND_INPUT = {
  amountCents: "200000",
  receivedAt: "2026-11-21",
  reason: "多付款退回",
  accountId: "account-1",
  evidenceReference: "BANK-REFUND-405",
  idempotencyKey: "refund-key-1"
};

describe("ExpenseClaimPaymentRefundService", () => {
  it("refuses refunds from roles outside finance and comprehensive directors", async () => {
    const { service } = refundFixture({ roles: ["employee"] });
    await expect(service.recordRefund(CLAIM.id, "exec-1", "actor-1", REFUND_INPUT))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires a real receipt account and reason", async () => {
    const { service } = refundFixture();
    await expect(service.recordRefund(CLAIM.id, "exec-1", "actor-1", { ...REFUND_INPUT, accountId: "" }))
      .rejects.toThrow("实际收款的资金账户");
    await expect(service.recordRefund(CLAIM.id, "exec-1", "actor-1", { ...REFUND_INPUT, reason: "  " }))
      .rejects.toThrow("退款原因");
  });

  it("caps cumulative refunds at the original execution amount", async () => {
    const { service, refundCreate } = refundFixture({ refundedSoFarCents: 900000n });
    await expect(service.recordRefund(CLAIM.id, "exec-1", "actor-1", REFUND_INPUT))
      .rejects.toThrow("累计退款不得超过原实付");
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("records a refund against the original execution and reopens the payable amount without touching cost", async () => {
    const { service, refundCreate, claimUpdate, audit } = refundFixture();
    const result = await service.recordRefund(CLAIM.id, "exec-1", "finance-1", REFUND_INPUT);
    expect(result).toMatchObject({
      amountCents: "200000",
      fundedAmountCents: "1000000",
      refundedCents: "200000",
      netPaidCents: "800000",
      remainingPayableCents: "200000",
      replayed: false
    });
    expect(refundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionType: "expense_claim_payment_execution",
        expenseClaimPaymentExecutionId: "exec-1",
        projectId: "project-1",
        accountId: "account-1",
        amountCents: 200000n,
        receivedAt: new Date("2026-11-21T00:00:00.000Z"),
        reason: "多付款退回",
        evidenceReference: "BANK-REFUND-405",
        recordedByUserId: "finance-1",
        idempotencyKey: "refund-key-1"
      })
    });
    expect(refundCreate.mock.calls[0][0].data).not.toHaveProperty("paymentRequestId");
    expect(claimUpdate).toHaveBeenCalledWith({
      where: { id: CLAIM.id },
      data: { status: "partially_paid" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "incidental_expense.refund.record",
      businessType: "incidental_expense",
      businessId: CLAIM.id
    }));
  });

  it("replays the same idempotency key instead of registering a second refund", async () => {
    const fingerprint = new ExpenseClaimPaymentRefundService(undefined as never, undefined as never).fingerprint({
      kind: "expense_claim_refund",
      claimId: CLAIM.id,
      executionId: "exec-1",
      actorUserId: "finance-1",
      amountCents: "200000",
      receivedAt: "2026-11-21",
      reason: "多付款退回",
      accountId: "account-1",
      evidenceReference: "BANK-REFUND-405"
    });
    const existingRefund = {
      id: "refund-existing",
      executionType: "expense_claim_payment_execution",
      expenseClaimPaymentExecutionId: "exec-1",
      projectId: "project-1",
      accountId: "account-1",
      amountCents: 200000n,
      receivedAt: new Date("2026-11-21T00:00:00.000Z"),
      reason: "多付款退回",
      evidenceReference: "BANK-REFUND-405",
      recordedByUserId: "finance-1",
      payloadFingerprint: fingerprint
    };
    const { service, refundCreate } = refundFixture({ existingRefund, refundedSoFarCents: 200000n });
    const replay = await service.recordRefund(CLAIM.id, "exec-1", "finance-1", REFUND_INPUT);
    expect(replay).toMatchObject({ id: "refund-existing", replayed: true, netPaidCents: "800000" });
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("rejects reuse of a refund idempotency key for different content", async () => {
    const existingRefund = {
      id: "refund-existing",
      expenseClaimPaymentExecutionId: "exec-1",
      amountCents: 200000n,
      receivedAt: new Date("2026-11-21T00:00:00.000Z"),
      payloadFingerprint: "different"
    };
    const { service } = refundFixture({ existingRefund, refundedSoFarCents: 200000n });
    await expect(service.recordRefund(CLAIM.id, "exec-1", "finance-1", REFUND_INPUT))
      .rejects.toThrow("幂等键已用于不同请求");
  });

  it("refuses to refund an execution that does not belong to the claim", async () => {
    const { service, tx } = refundFixture();
    tx.expenseClaimPaymentExecution.findFirst.mockResolvedValue(null);
    await expect(service.recordRefund(CLAIM.id, "exec-other", "finance-1", REFUND_INPUT))
      .rejects.toThrow("待退款的实付记录不存在");
  });
});
