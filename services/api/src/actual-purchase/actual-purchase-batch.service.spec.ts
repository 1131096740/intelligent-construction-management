import type { Prisma } from "@prisma/client";

import { ActualPurchaseBatchService } from "./actual-purchase-batch.service";

it.each(["company_direct", "handler_reimbursement"] as const)(
  "stores only the requested instalment in a %s payment and leaves batch cost to approval",
  async (paymentType) => {
    const createPayment = jest.fn(async ({ data }: { data: Prisma.SpotProcurementPaymentUncheckedCreateInput }) => {
      // Same invariant as the ordered PostgreSQL payment composition check.
      if (data.settlementAmountCents !== BigInt(data.companyPaymentAmountCents ?? 0n) + BigInt(data.supplierBalanceAmountCents ?? 0n)) {
        throw new Error("SpotProcurementPayment_composition_check");
      }
      return { ...data, id: "payment" };
    });
    const ledger = { appendConfirmedSourceInTransaction: jest.fn() };
    const audit = { record: jest.fn() };
    const tx = {
      $queryRaw: jest.fn(),
      actualPurchaseBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: "batch", kind: "spot_material", procurementId: "procurement",
          supplierName: "合成供应商", effectiveTotalAmountCents: 1_000_000n
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "procurement", projectId: "project", currentVersionId: "version", status: "approved_in_progress", code: "LXCG-X"
        })
      },
      spotProcurementVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version", status: "approved", versionNo: 1, handlerUserId: "handler" })
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "handler", isActive: true, name: "合成经办" }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "material_staff" }]) },
      expenseClaim: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPayment: {
        findMany: jest.fn().mockResolvedValue([]), create: createPayment, update: jest.fn()
      },
      spotProcurementPaymentChannel: { create: jest.fn().mockResolvedValue({ id: "channel", isPrimary: true }) },
      spotProcurementPaymentMethodOption: { createMany: jest.fn() }
    };
    const prisma = { $transaction: <T>(run: (client: typeof tx) => Promise<T>) => run(tx) };
    const service = new ActualPurchaseBatchService(prisma as never, audit as never, ledger as never, {} as never);

    await expect(service.createSpotPayment("handler", "batch", {
      requestedAmountCents: "300000",
      paymentType,
      payeeName: "合成供应商",
      paymentMethods: ["bank_transfer"],
      channels: [{ channelType: "bank_transfer", isPrimary: true }],
      idempotencyKey: "synthetic-payment"
    })).resolves.toMatchObject({
      batchId: "batch", requestedAmountCents: "300000", settlementAmountCents: "300000", status: "draft"
    });

    expect(createPayment).toHaveBeenCalledWith({ data: expect.objectContaining({
      actualPurchaseBatchId: "batch", settlementAmountCents: 300_000n, approvalAmountCents: 300_000n,
      companyPaymentAmountCents: 300_000n, supplierBalanceAmountCents: 0n
    }) });
    expect(ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
  }
);
