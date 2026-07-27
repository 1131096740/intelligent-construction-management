import { Prisma } from "@prisma/client";
import { ContractVersionActivationService } from "./contract-version-activation.service";

const target = {
  id: "version-2",
  contractId: "contract-1",
  status: "pending_archive_confirm",
  changeType: "change",
  baseVersionId: "version-1"
};

const predecessor = {
  id: "version-1",
  contractId: "contract-1",
  status: "effective",
  changeType: "original",
  baseVersionId: null
};

function tx(overrides: Record<string, unknown> = {}) {
  const contractVersion = {
    findUnique: jest.fn()
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(predecessor),
    findFirst: jest.fn().mockResolvedValue({ id: "version-1" }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({ ...target, status: "effective" })
  };
  return {
    $queryRaw: jest.fn(),
    contractVersion,
    paymentTermsVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contractSettlementProcess: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    settlementDraft: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    ...overrides
  };
}

describe("ContractVersionActivationService", () => {
  it("does not run a second activation after another confirmation has made the version effective", async () => {
    const transaction = tx();
    transaction.contractVersion.findUnique.mockReset().mockResolvedValue({ ...target, status: "effective" });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toThrow("当前合同版本尚不能确认归档");
    expect(transaction.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(transaction.contractVersion.update).not.toHaveBeenCalled();
  });

  it("invalidates only an unsubmitted old settlement draft before activating the new version", async () => {
    const transaction = tx({
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([{
          id: "process-1",
          sequenceNo: 1,
          settlementDraftId: "draft-1",
          settlementId: null
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlementDraft: {
        findMany: jest.fn().mockResolvedValue([{
          id: "draft-1",
          code: "JS-001",
          status: "draft",
          submittedSettlementId: null,
          submittedAt: null
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });

    await new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1",
      effectiveAt: new Date("2026-07-27T00:00:00.000Z")
    });

    expect(transaction.contractSettlementProcess.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "process-1", status: "open", settlementId: null },
      data: expect.objectContaining({
        status: "invalidated",
        invalidatedByContractVersionId: "version-2"
      })
    }));
    expect(transaction.settlementDraft.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["draft-1"] }, status: "draft" },
      data: { status: "invalidated" }
    });
    expect(transaction.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1", status: "effective" },
      data: { status: "superseded" }
    });
    expect(transaction.contractVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "version-2" },
      data: expect.objectContaining({ status: "effective", supersedesVersionId: "version-1" })
    }));
  });

  it("returns the stable active-settlement error and leaves version replacement unstarted", async () => {
    const transaction = tx({
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([{
          id: "process-1",
          sequenceNo: 1,
          settlementDraftId: "draft-1",
          settlementId: "settlement-1"
        }]),
        updateMany: jest.fn()
      },
      settlementDraft: {
        findMany: jest.fn().mockResolvedValue([{
          id: "draft-1",
          code: "JS-001",
          status: "submitted",
          submittedSettlementId: "settlement-1",
          submittedAt: new Date()
        }]),
        updateMany: jest.fn()
      }
    });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CONTRACT_VERSION_BLOCKED_BY_ACTIVE_SETTLEMENT" })
    });
    expect(transaction.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(transaction.contractVersion.update).not.toHaveBeenCalled();
  });

  it("freezes confirmed one-to-one historical occupancy into the target carry-forward snapshot", async () => {
    const sourceQuantity = new Prisma.Decimal("30");
    const transitionUpdate = jest.fn();
    const carryForwardCreate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-row", lineageId: "lineage-1", unit: "m" }])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-1", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: sourceQuantity,
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue([{
          id: "transition-1",
          sourceContractBillRowId: "source-row",
          targetContractBillRowId: "target-row",
          relationType: "one_to_one",
          status: "confirmed",
          sourceSettledQuantityAllocated: null,
          targetOpeningQuantity: null,
          settledAmountAllocatedCents: null
        }]),
        update: transitionUpdate
      },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    });

    expect(transitionUpdate).toHaveBeenCalledWith({
      where: { id: "transition-1" },
      data: {
        sourceSettledQuantityAllocated: sourceQuantity,
        targetOpeningQuantity: sourceQuantity,
        settledAmountAllocatedCents: 3000n
      }
    });
    expect(carryForwardCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-2",
        contractBillRowId: "target-row",
        lineageId: "lineage-1",
        priorSettledQuantity: sourceQuantity,
        priorSettledAmountCents: 3000n,
        sourceSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })
    });
  });

  it("blocks activation when an occupied source row has no confirmed cross-version mapping", async () => {
    const carryForwardCreate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-row", lineageId: "lineage-1", unit: "m" }])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-1", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: new Prisma.Decimal("30"),
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
    expect(carryForwardCreate).not.toHaveBeenCalled();
    expect(transaction.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("blocks activation when a confirmed mapping no longer conserves historical occupancy", async () => {
    const carryForwardCreate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-row", lineageId: "lineage-1", unit: "m" }])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-1", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: new Prisma.Decimal("30"),
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue([{
          id: "transition-1",
          sourceContractBillRowId: "source-row",
          targetContractBillRowId: "target-row",
          relationType: "one_to_one",
          status: "confirmed",
          sourceSettledQuantityAllocated: new Prisma.Decimal("29"),
          targetOpeningQuantity: new Prisma.Decimal("29"),
          settledAmountAllocatedCents: 3000n
        }]),
        update: jest.fn()
      },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
    expect(carryForwardCreate).not.toHaveBeenCalled();
    expect(transaction.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("freezes a confirmed split by its director-approved target opening allocations", async () => {
    const sourceQuantity = new Prisma.Decimal("30");
    const carryForwardCreate = jest.fn();
    const transitionUpdate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([
            { id: "target-row-a", lineageId: "lineage-a", unit: "m" },
            { id: "target-row-b", lineageId: "lineage-b", unit: "m" }
          ])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-source", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: sourceQuantity,
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "transition-a",
            sourceContractBillRowId: "source-row",
            targetContractBillRowId: "target-row-a",
            relationType: "split",
            status: "confirmed",
            sourceSettledQuantityAllocated: new Prisma.Decimal("10"),
            targetOpeningQuantity: new Prisma.Decimal("10"),
            settledAmountAllocatedCents: 1000n,
            quantityConversionBasis: null
          },
          {
            id: "transition-b",
            sourceContractBillRowId: "source-row",
            targetContractBillRowId: "target-row-b",
            relationType: "split",
            status: "confirmed",
            sourceSettledQuantityAllocated: new Prisma.Decimal("20"),
            targetOpeningQuantity: new Prisma.Decimal("20"),
            settledAmountAllocatedCents: 2000n,
            quantityConversionBasis: null
          }
        ]),
        update: transitionUpdate
      },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    });

    expect(transitionUpdate).not.toHaveBeenCalled();
    expect(carryForwardCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        contractBillRowId: "target-row-a",
        priorSettledQuantity: new Prisma.Decimal("10"),
        priorSettledAmountCents: 1000n
      })
    });
    expect(carryForwardCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        contractBillRowId: "target-row-b",
        priorSettledQuantity: new Prisma.Decimal("20"),
        priorSettledAmountCents: 2000n
      })
    });
  });

  it("blocks a split when its director-approved monetary allocation leaves a one-cent gap", async () => {
    const carryForwardCreate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([
            { id: "target-row-a", lineageId: "lineage-a", unit: "m" },
            { id: "target-row-b", lineageId: "lineage-b", unit: "m" }
          ])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-source", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: new Prisma.Decimal("30"),
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "transition-a",
            sourceContractBillRowId: "source-row",
            targetContractBillRowId: "target-row-a",
            relationType: "split",
            status: "confirmed",
            sourceSettledQuantityAllocated: new Prisma.Decimal("10"),
            targetOpeningQuantity: new Prisma.Decimal("10"),
            settledAmountAllocatedCents: 1000n,
            quantityConversionBasis: null
          },
          {
            id: "transition-b",
            sourceContractBillRowId: "source-row",
            targetContractBillRowId: "target-row-b",
            relationType: "split",
            status: "confirmed",
            sourceSettledQuantityAllocated: new Prisma.Decimal("20"),
            targetOpeningQuantity: new Prisma.Decimal("20"),
            settledAmountAllocatedCents: 1999n,
            quantityConversionBasis: null
          }
        ]),
        update: jest.fn()
      },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
    expect(carryForwardCreate).not.toHaveBeenCalled();
  });

  it("requires a conversion basis whenever a confirmed manual allocation changes units", async () => {
    const carryForwardCreate = jest.fn();
    const transaction = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill" }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-row", lineageId: "lineage-target", unit: "㎡" }])
          .mockResolvedValueOnce([{ id: "source-row", lineageId: "lineage-source", unit: "m" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([{
          settlementId: "settlement-1",
          contractBillRowId: "source-row",
          quantity: new Prisma.Decimal("30"),
          amountCents: 3000n
        }])
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue([{
          id: "transition-1",
          sourceContractBillRowId: "source-row",
          targetContractBillRowId: "target-row",
          relationType: "merge",
          status: "confirmed",
          sourceSettledQuantityAllocated: new Prisma.Decimal("30"),
          targetOpeningQuantity: new Prisma.Decimal("60"),
          settledAmountAllocatedCents: 3000n,
          quantityConversionBasis: null
        }]),
        update: jest.fn()
      },
      contractBillRowCarryForward: { create: carryForwardCreate }
    });

    await expect(new ContractVersionActivationService().activate(transaction as never, {
      contractVersionId: "version-2",
      actorUserId: "director-1"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED" })
    });
    expect(carryForwardCreate).not.toHaveBeenCalled();
  });
});
