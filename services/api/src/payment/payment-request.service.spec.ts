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

  it("approves a pending payment request into approved pending payment", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
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
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const approved = await paymentService.reviewApproval("FK-2026-012", {
      decision: "approve",
      approvedAmountCents: 45_000,
      reviewedByUserId: "chairman-1"
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        status: "approved_pending_payment",
        approvedAmountCents: 45_000
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "chairman-1",
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects a pending payment request without making it payable", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
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
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const rejected = await paymentService.reviewApproval("FK-2026-012", {
      decision: "reject",
      reviewedByUserId: "general-manager-1"
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
      paymentService.reviewApproval("FK-2026-012", {
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
          status: "approval_pending",
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
      paymentService.reviewApproval("FK-2026-012", {
        decision: "approve",
        approvedAmountCents: 50_001
      })
    ).rejects.toThrow("Approved amount cannot exceed requested amount");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("records actual payment execution and marks payment and settlement paid", async () => {
    const tx = {
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
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const execution = await paymentService.recordExecution("FK-2026-012", {
      amountCents: 30_000,
      paidAt: "2026-06-22T00:00:00.000Z",
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    });

    expect(execution.id).toBe("execution-1");
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

  it("records partial actual payment execution without completing payment", async () => {
    const tx = {
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
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.recordExecution("FK-2026-012", {
      amountCents: 20_000,
      paidAt: "2026-06-22T00:00:00.000Z",
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
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

  it("rejects actual payment execution before payment approval passes", async () => {
    const tx = {
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
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", {
        amountCents: 20_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      })
    ).rejects.toThrow("Cannot record payment execution from status approval_pending");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution above approved remaining amount", async () => {
    const tx = {
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
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", {
        amountCents: 30_001,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      })
    ).rejects.toThrow("Payment execution exceeds approved remaining amount: 30000");
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
      paymentService.recordExecution("FK-2026-012", {
        amountCents: 0,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: ""
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
      paymentService.recordExecution("FK-2026-012", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: ""
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
      paymentService.recordExecution("FK-2026-012", {
        amountCents: undefined as never,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      })
    ).rejects.toThrow("Payment execution amount must be greater than zero");
    await expect(
      paymentService.recordExecution("FK-2026-012", {
        amountCents: 10_000,
        paidAt: "2026-06-22T00:00:00.000Z",
        executedByUserId: "cashier-1",
        voucherFileId: undefined as never
      })
    ).rejects.toThrow("Payment voucher file is required");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
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

    const record = await paymentService.recordFinance("FK-2026-012", {
      amountCents: 30_000,
      occurredAt: "2026-06-22T00:00:00.000Z",
      createdByUserId: "finance-1"
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
      paymentService.recordFinance("FK-2026-012", {
        amountCents: 10_000,
        occurredAt: "2026-06-22T00:00:00.000Z",
        createdByUserId: "finance-1"
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
      paymentService.recordFinance("FK-2026-012", {
        amountCents: 10_001,
        occurredAt: "2026-06-22T00:00:00.000Z",
        createdByUserId: "finance-1"
      })
    ).rejects.toThrow("Finance record exceeds unrecorded paid amount: 10000");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });
});
