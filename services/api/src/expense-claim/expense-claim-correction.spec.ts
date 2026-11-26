import { ForbiddenException } from "@nestjs/common";
import { ExpenseClaimCorrectionService } from "./expense-claim-correction.service";

const CLAIM = {
  id: "claim-1",
  code: "LXFY-2026-11-23-001",
  claimType: "incidental_expense",
  status: "paid",
  projectId: "project-1",
  companyEntityId: "company-1",
  companyEntityNameSnapshot: "我方公司",
  incidentalExpenseCategory: "other_incidental",
  payeeNameSnapshot: "合成收款方",
  companyPayableAmountCents: 1000000n,
  fundedAmountCents: 1000000n,
  handledByUserId: "handler-1",
  applicantUserId: "handler-1",
  approvedAt: new Date("2026-11-20T00:00:00.000Z")
};

const ORIGINAL_FACT = {
  id: "operating-fact-1",
  projectId: "project-1",
  sourceType: "expense_claim_approval",
  sourceBusinessId: CLAIM.id,
  numericProtocolVersion: 1,
  operatingLedgerEffectiveDateSnapshot: new Date("2026-01-01T00:00:00.000Z"),
  affiliateAssignmentId: "assignment-1",
  affiliateBusinessPartyVersionId: "party-version-1",
  affiliateNameSnapshot: "施工企业",
  affiliateCreditCodeSnapshot: "91350000TEST405",
  sourceSnapshot: {},
  basisSnapshot: {}
};

function correctionFixture(options: {
  roles?: string[];
  bearingChoice?: string | null;
  originalFact?: Record<string, unknown> | null;
  correctionFact?: Record<string, unknown> | null;
  fundedCents?: bigint;
  refundedCents?: bigint;
} = {}) {
  const claimUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...CLAIM, ...data }));
  const append = jest.fn().mockResolvedValue({ id: "correction-fact-1" });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ ...CLAIM, ...(options.bearingChoice === undefined ? {} : {
      costBearingCompanySpecified: true, costBearingCompanyEntityId: options.bearingChoice
    }) }]),
    expenseClaim: { update: claimUpdate },
    expenseClaimPaymentExecution: {
      findMany: jest.fn().mockResolvedValue([{ id: "exec-1", amountCents: options.fundedCents ?? 1000000n }])
    },
    paymentExecutionRefund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: options.refundedCents ?? 0n } })
    },
    operatingFact: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { sourceType_sourceBusinessId: { sourceBusinessId: string } } }) => {
        if (where.sourceType_sourceBusinessId.sourceBusinessId.includes(":correction:")) {
          return options.correctionFact ?? null;
        }
        return options.originalFact === undefined ? ORIGINAL_FACT : options.originalFact;
      })
    }
  };
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const auth = {
    confirmPassword: jest.fn(async (_userId: string, password: string) => {
      if (password !== "current-password") throw new Error("当前密码不正确");
    })
  };
  const ledger = { appendConfirmedSourceInTransaction: append };
  const service = new ExpenseClaimCorrectionService(prisma as never, audit as never, auth as never, ledger as never);
  (service as unknown as { roles: { resolveActiveRoleScopesInTransaction: jest.Mock } }).roles = {
    resolveActiveRoleScopesInTransaction: jest.fn().mockResolvedValue(options.roles ?? ["finance_director"])
  };
  return { service, tx, audit, auth, ledger, append, claimUpdate };
}

const CORRECTION_INPUT = {
  correctedAmountCents: "800000",
  reason: "供应商折让，实际应为 8k",
  confirmationPassword: "current-password",
  idempotencyKey: "correction-key-1"
};

describe("ExpenseClaimCorrectionService", () => {
  it("only lets the current finance director confirm a cost correction", async () => {
    const { service } = correctionFixture({ roles: ["finance_staff"] });
    await expect(service.correctConfirmedAmount(CLAIM.id, "actor-1", CORRECTION_INPUT))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires the confirming password and does not touch facts before it passes", async () => {
    const { service, append, tx } = correctionFixture();
    await expect(service.correctConfirmedAmount(CLAIM.id, "director-1", { ...CORRECTION_INPUT, confirmationPassword: "wrong" }))
      .rejects.toThrow("当前密码不正确");
    expect(append).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
  });

  it("requires a self-review reason when the director also handled the claim", async () => {
    const { service } = correctionFixture();
    await expect(service.correctConfirmedAmount(CLAIM.id, "handler-1", CORRECTION_INPUT))
      .rejects.toThrow("自审原因");
  });

  it("appends a correction to the confirmed cost and payable without rewriting the original fact", async () => {
    const { service, append, claimUpdate, audit, tx } = correctionFixture();
    const result = await service.correctConfirmedAmount(CLAIM.id, "director-1", CORRECTION_INPUT);
    expect(result).toMatchObject({
      claimId: CLAIM.id,
      originalAmountCents: "1000000",
      correctedAmountCents: "800000",
      correctionDeltaCents: "-200000",
      netPaidCents: "1000000",
      overpaidCents: "200000",
      status: "paid",
      replayed: false
    });
    expect(claimUpdate).toHaveBeenCalledWith({
      where: { id: CLAIM.id },
      data: { companyPayableAmountCents: 800000n, status: "paid" }
    });
    expect(append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: "project-1",
      sourceType: "expense_claim_approval",
      sourceBusinessId: `${CLAIM.id}:correction:correction-key-1`,
      adjustsFactId: ORIGINAL_FACT.id,
      amountCents: 200000n,
      direction: "inflow",
      factKind: "expense",
      affiliateAssignmentId: "assignment-1",
      impacts: [
        expect.objectContaining({ impactKind: "confirmed_cost", direction: "decrease", amountCents: 200000n, costCategoryCode: "other_project_cost" }),
        expect.objectContaining({ impactKind: "payable_decrease", direction: "decrease", amountCents: 200000n })
      ]
    }), "director-1", "correction");
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "incidental_expense.correction.confirmed",
      businessType: "incidental_expense",
      businessId: CLAIM.id
    }));
    expect(tx.operatingFact.findUnique).toHaveBeenCalled();
  });

  it("increases the cost and reopens the remaining payable when corrected upward", async () => {
    const { service, append } = correctionFixture();
    const result = await service.correctConfirmedAmount(CLAIM.id, "director-1", { ...CORRECTION_INPUT, correctedAmountCents: "1200000" });
    expect(result).toMatchObject({
      correctionDeltaCents: "200000",
      remainingPayableCents: "200000",
      status: "partially_paid"
    });
    expect(append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      direction: "outflow",
      impacts: [
        expect.objectContaining({ impactKind: "confirmed_cost", direction: "increase" }),
        expect.objectContaining({ impactKind: "payable_increase", direction: "increase" })
      ]
    }), "director-1", "correction");
  });

  it.each([null, "bearing-company"])("keeps the independent bearing choice %s when adjusting the original cost", async bearingChoice => {
    const { service, append } = correctionFixture({ bearingChoice });
    await service.correctConfirmedAmount(CLAIM.id, "director-1", CORRECTION_INPUT);
    const [, adjustment] = append.mock.calls[0];
    const expected = bearingChoice === null ? undefined : { kind: "participating_company", id: bearingChoice };
    expect(adjustment.subjects.costBearingCompany).toEqual(expected);
    expect(adjustment.impacts[0].subject).toEqual(expected);
    expect(adjustment.impacts[0].amountCents).toBe(200000n);
  });

  it("replays the same idempotency key instead of appending a second correction", async () => {
    const { service, append, claimUpdate } = correctionFixture();
    const first = await service.correctConfirmedAmount(CLAIM.id, "director-1", CORRECTION_INPUT);
    expect(first.replayed).toBe(false);
    const fingerprint = (service as unknown as { fingerprint: (value: Record<string, unknown>) => string }).fingerprint({
      kind: "expense_claim_correction",
      claimId: CLAIM.id,
      actorUserId: "director-1",
      correctedAmountCents: "800000",
      reason: CORRECTION_INPUT.reason,
      selfReviewReason: null
    });
    const existing = {
      id: "correction-fact-1",
      sourceSnapshot: {
        claimId: CLAIM.id,
        originalAmountCents: "1000000",
        correctedAmountCents: "800000",
        deltaCents: "-200000",
        fingerprint
      }
    };
    const replays = correctionFixture({ correctionFact: existing });
    const replay = await replays.service.correctConfirmedAmount(CLAIM.id, "director-1", CORRECTION_INPUT);
    expect(replay.replayed).toBe(true);
    expect(replays.append).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);
    expect(claimUpdate).toHaveBeenCalledTimes(1);
  });

  it("refuses to correct when the confirmed cost fact is missing", async () => {
    const { service } = correctionFixture({ originalFact: null });
    await expect(service.correctConfirmedAmount(CLAIM.id, "director-1", CORRECTION_INPUT))
      .rejects.toThrow("费用成本尚未确认");
  });

  it("refuses a correction that does not change the confirmed amount", async () => {
    const { service } = correctionFixture();
    await expect(service.correctConfirmedAmount(CLAIM.id, "director-1", { ...CORRECTION_INPUT, correctedAmountCents: "1000000" }))
      .rejects.toThrow("更正后金额与原金额相同");
  });
});
