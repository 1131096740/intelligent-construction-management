import { PaymentAmountService } from "./payment-amount.service";
import { PaymentRequestService } from "./payment-request.service";

describe("PaymentRequestService", () => {
  const service = new PaymentRequestService(new PaymentAmountService());

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
        findMany: jest.fn().mockResolvedValue([
          {
            requestedAmountCents: 30_000,
            paidAmountCents: 10_000
          }
        ]),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012"
        })
      }
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
    expect(tx.paymentRequest.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        settlementId: "settlement-1",
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
            requestedAmountCents: 30_000,
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
});
