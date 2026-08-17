import { PaymentRequestService } from "./payment-request.service";

describe("PaymentRequestService execution subject", () => {
  it("rejects our-company payment execution for an affiliate-signed contract", async () => {
    const payment = {
      id: "payment-1",
      code: "FK-001",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      paymentTermsVersionId: "terms-1",
      paymentTermsStageId: null,
      settlementId: null,
      sourceType: "settlement",
      updatedAt: new Date("2026-07-31T02:00:00.000Z"),
      paymentSubjectType: "our_company",
      signingSubjectType: "affiliate",
      companyEntityIdSnapshot: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      status: "approved_pending_payment",
      requestedAmountCents: 10000n,
      approvedAmountCents: 10000n,
      paidAmountCents: 0n
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([payment]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1"
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "finance-1",
          isActive: true
        })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { positionKey: "finance_staff" }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecution: {
        findUnique: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const files = {
      assertFileHasNoBusinessBinding: jest.fn()
    };
    const funding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn()
    };
    const service = new PaymentRequestService(
      { assertCanRequest: jest.fn() } as never,
      prisma as never,
      undefined,
      files as never,
      auth as never,
      undefined,
      undefined,
      funding as never
    );

    await expect(
      service.recordExecution("payment-1", "finance-1", {
        expectedPaymentUpdatedAt: "2026-07-31T02:00:00.000Z",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        amountCents: "10000",
        paidAt: "2026-07-28T00:00:00.000Z",
        voucherFileId: "voucher-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("施工企业付款申请不得登记我方实际付款，请登记施工企业外部付款事实");

    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });
});
