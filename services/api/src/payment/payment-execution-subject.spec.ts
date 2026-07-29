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
      signingSubjectType: "affiliate",
      status: "approved_pending_payment",
      requestedAmountCents: 10000n,
      approvedAmountCents: 10000n,
      paidAmountCents: 0n
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([payment]),
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new PaymentRequestService(
      { assertCanRequest: jest.fn() } as never,
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      service.recordExecution("payment-1", "finance-1", {
        amountCents: "10000",
        paidAt: "2026-07-28T00:00:00.000Z",
        voucherFileId: "voucher-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("该合同冻结为挂靠企业签约，不能创建或登记我方付款");

    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });
});
