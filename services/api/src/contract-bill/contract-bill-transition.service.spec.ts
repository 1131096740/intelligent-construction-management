import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ContractBillTransitionService } from "./contract-bill-transition.service";

const sourceVersion = {
  id: "version-1",
  contractId: "contract-1",
  status: "effective",
  baseVersionId: null,
  draftRevision: 1
};

const targetVersion = {
  id: "version-2",
  contractId: "contract-1",
  status: "draft",
  changeType: "change",
  baseVersionId: "version-1",
  draftRevision: 4
};

function context(
  targetOverrides: Partial<typeof targetVersion> = {},
  boundaryOverrides: Partial<{
    hasSignedFormalFile: boolean;
    hasActiveSealTask: boolean;
    hasArchiveFile: boolean;
    hasSettlement: boolean;
    hasPaymentRequest: boolean;
  }> = {}
) {
  const selectedTargetVersion = { ...targetVersion, ...targetOverrides };
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: "contract-1", ownerUserId: "handler-1" }])
      .mockResolvedValueOnce([{ ...selectedTargetVersion }])
      .mockResolvedValueOnce([{
        hasSignedFormalFile: false,
        hasActiveSealTask: false,
        hasArchiveFile: false,
        hasSettlement: false,
        hasPaymentRequest: false,
        ...boundaryOverrides
      }])
      .mockResolvedValue([]),
    contractVersion: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === selectedTargetVersion.id
            ? selectedTargetVersion
            : sourceVersion
        )
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contract: { findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "handler-1" }) },
    contractBillRow: { findMany: jest.fn() },
    contractBill: { findMany: jest.fn() },
    contractBillRowTransition: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: "transition-1" })
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn() },
    settlementLine: { findMany: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    ...tx
  };
  return { tx, prisma, service: new ContractBillTransitionService(prisma as never, { record: jest.fn((client, input) => client.auditLog.create({ data: input })) } as never) };
}

type TestContext = ReturnType<typeof context>;
type MutationKind = "save" | "confirm" | "discard";

function expectDraftBoundaryLockOrder(
  query: jest.Mock,
  expectFormalEvidenceQuery = true
) {
  const statements = query.mock.calls
    .slice(0, 3)
    .map(([sql]) => (sql?.strings as string[] | undefined)?.join(" ") ?? "");
  expect(statements[0]).toContain('FROM "Contract" c');
  expect(statements[0]).toContain("FOR UPDATE OF c");
  expect(statements[1]).toContain('FROM "ContractVersion" cv');
  expect(statements[1]).toContain("FOR UPDATE OF cv");
  if (expectFormalEvidenceQuery) {
    expect(statements[2]).toContain('FROM "ContractFormalFile"');
  }
}

function prepareSuccessfulMutation(current: TestContext, kind: MutationKind) {
  if (kind === "save") {
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row", contractBillId: "source-bill", unit: "m" },
      { id: "target-row", contractBillId: "target-bill", unit: "m" }
    ]);
    current.tx.contractBill.findMany.mockResolvedValue([
      { id: "source-bill", contractVersionId: "version-1" },
      { id: "target-bill", contractVersionId: "version-2" }
    ]);
    current.tx.contractBillRowTransition.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    return;
  }
  if (kind === "confirm") {
    current.tx.userPosition.findMany.mockResolvedValue([
      { positionId: "position-contract-director" }
    ]);
    current.tx.position.findMany.mockResolvedValue([
      { id: "position-contract-director", key: "contract_director" }
    ]);
    current.tx.contractBillRowTransition.findMany
      .mockResolvedValueOnce([{
        id: "transition-1",
        sourceContractBillRowId: "source-row",
        targetContractBillRowId: "target-row",
        sourceSettledQuantityAllocated: new Prisma.Decimal("30"),
        targetOpeningQuantity: new Prisma.Decimal("30"),
        settledAmountAllocatedCents: 3000n
      }])
      .mockResolvedValueOnce([]);
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row", contractBillId: "source-bill", unit: "m" }
    ]);
    current.tx.settlement.findMany.mockResolvedValue([{ id: "settlement-1" }]);
    current.tx.settlementLine.findMany.mockResolvedValue([{
      contractBillRowId: "source-row",
      quantity: new Prisma.Decimal("30"),
      amountCents: 3000n
    }]);
    current.tx.contractBillRowTransition.updateMany.mockResolvedValue({
      count: 1
    });
    return;
  }
  current.tx.contractBillRowTransition.updateMany.mockResolvedValue({
    count: 1
  });
  current.tx.contractBillRowTransition.findMany.mockResolvedValue([]);
}

function invokeMutation(current: TestContext, kind: MutationKind) {
  if (kind === "save") {
    return current.service.saveDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4,
      mappings: [{
        sourceContractBillRowId: "source-row",
        targetContractBillRowId: "target-row",
        sourceSettledQuantityAllocated: "30",
        targetOpeningQuantity: "30",
        settledAmountAllocatedCents: "3000"
      }]
    });
  }
  if (kind === "confirm") {
    return current.service.confirmDraftMappings("version-2", "director-1", {
      expectedTargetVersionRevision: 4
    });
  }
  return current.service.discardDraftMappings("version-2", "handler-1", {
    fromContractVersionId: "version-1",
    expectedTargetVersionRevision: 4
  });
}

describe("ContractBillTransitionService", () => {
  it.each<MutationKind>(["save", "confirm", "discard"])(
    "rejects %s after hard formal evidence without writes or audit",
    async (kind) => {
      const current = context({}, { hasSignedFormalFile: true });
      prepareSuccessfulMutation(current, kind);

      await expect(invokeMutation(current, kind)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expectDraftBoundaryLockOrder(current.tx.$queryRaw);
      expect(current.tx.contractBillRowTransition.updateMany).not.toHaveBeenCalled();
      expect(current.tx.contractBillRowTransition.upsert).not.toHaveBeenCalled();
      expect(current.tx.contractVersion.updateMany).not.toHaveBeenCalled();
      expect(current.tx.auditLog.create).not.toHaveBeenCalled();
    }
  );

  it.each<MutationKind>(["save", "confirm", "discard"])(
    "rejects %s for a historical takeover without writes or audit",
    async (kind) => {
      const current = context({ changeType: "historical_takeover" });
      prepareSuccessfulMutation(current, kind);

      await expect(invokeMutation(current, kind)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expectDraftBoundaryLockOrder(current.tx.$queryRaw, false);
      expect(current.tx.contractBillRowTransition.updateMany).not.toHaveBeenCalled();
      expect(current.tx.contractBillRowTransition.upsert).not.toHaveBeenCalled();
      expect(current.tx.contractVersion.updateMany).not.toHaveBeenCalled();
      expect(current.tx.auditLog.create).not.toHaveBeenCalled();
    }
  );

  it("lets the draft owner replace automatic same-row mappings with an explicit split", async () => {
    const current = context();
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row", contractBillId: "source-bill", unit: "m" },
      { id: "target-row-a", contractBillId: "target-bill", unit: "m" },
      { id: "target-row-b", contractBillId: "target-bill", unit: "m" }
    ]);
    current.tx.contractBill.findMany.mockResolvedValue([
      { id: "source-bill", contractVersionId: "version-1" },
      { id: "target-bill", contractVersionId: "version-2" }
    ]);
    current.tx.contractBillRowTransition.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await current.service.saveDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4,
      mappings: [
        {
          sourceContractBillRowId: "source-row",
          targetContractBillRowId: "target-row-a",
          sourceSettledQuantityAllocated: "10",
          targetOpeningQuantity: "10",
          settledAmountAllocatedCents: "1000"
        },
        {
          sourceContractBillRowId: "source-row",
          targetContractBillRowId: "target-row-b",
          sourceSettledQuantityAllocated: "20",
          targetOpeningQuantity: "20",
          settledAmountAllocatedCents: "2000"
        }
      ]
    });

    expect(current.tx.contractBillRowTransition.upsert).toHaveBeenCalledTimes(2);
    expect(current.tx.contractBillRowTransition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ relationType: "split", matchBasis: "manual", status: "draft" })
    }));
    expect(current.tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "version-2", draftRevision: 4 })
    }));
  });

  it("classifies two source rows carried into one target row as a merge", async () => {
    const current = context();
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row-a", contractBillId: "source-bill", unit: "m" },
      { id: "source-row-b", contractBillId: "source-bill", unit: "m" },
      { id: "target-row", contractBillId: "target-bill", unit: "m" }
    ]);
    current.tx.contractBill.findMany.mockResolvedValue([
      { id: "source-bill", contractVersionId: "version-1" },
      { id: "target-bill", contractVersionId: "version-2" }
    ]);
    current.tx.contractBillRowTransition.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await current.service.saveDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4,
      mappings: [
        {
          sourceContractBillRowId: "source-row-a",
          targetContractBillRowId: "target-row",
          sourceSettledQuantityAllocated: "10",
          targetOpeningQuantity: "10",
          settledAmountAllocatedCents: "1000"
        },
        {
          sourceContractBillRowId: "source-row-b",
          targetContractBillRowId: "target-row",
          sourceSettledQuantityAllocated: "20",
          targetOpeningQuantity: "20",
          settledAmountAllocatedCents: "2000"
        }
      ]
    });

    expect(current.tx.contractBillRowTransition.upsert).toHaveBeenCalledTimes(2);
    expect(current.tx.contractBillRowTransition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ relationType: "merge", matchBasis: "manual", status: "draft" })
    }));
  });

  it("rejects a many-to-many mapping mesh before writing any draft mapping", async () => {
    const current = context();
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row-a", contractBillId: "source-bill", unit: "m" },
      { id: "source-row-b", contractBillId: "source-bill", unit: "m" },
      { id: "target-row-a", contractBillId: "target-bill", unit: "m" },
      { id: "target-row-b", contractBillId: "target-bill", unit: "m" }
    ]);
    current.tx.contractBill.findMany.mockResolvedValue([
      { id: "source-bill", contractVersionId: "version-1" },
      { id: "target-bill", contractVersionId: "version-2" }
    ]);

    await expect(current.service.saveDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4,
      mappings: [
        { sourceContractBillRowId: "source-row-a", targetContractBillRowId: "target-row-a", sourceSettledQuantityAllocated: "10", targetOpeningQuantity: "10", settledAmountAllocatedCents: "1000" },
        { sourceContractBillRowId: "source-row-a", targetContractBillRowId: "target-row-b", sourceSettledQuantityAllocated: "20", targetOpeningQuantity: "20", settledAmountAllocatedCents: "2000" },
        { sourceContractBillRowId: "source-row-b", targetContractBillRowId: "target-row-a", sourceSettledQuantityAllocated: "30", targetOpeningQuantity: "30", settledAmountAllocatedCents: "3000" }
      ]
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(current.tx.contractBillRowTransition.upsert).not.toHaveBeenCalled();
  });

  it("rejects a draft mapping that tries to overwrite a director-confirmed mapping", async () => {
    const current = context();
    current.tx.contractBillRow.findMany.mockResolvedValue([
      { id: "source-row", contractBillId: "source-bill", unit: "m" },
      { id: "target-row", contractBillId: "target-bill", unit: "m" }
    ]);
    current.tx.contractBill.findMany.mockResolvedValue([
      { id: "source-bill", contractVersionId: "version-1" },
      { id: "target-bill", contractVersionId: "version-2" }
    ]);
    current.tx.contractBillRowTransition.findMany.mockResolvedValue([{ id: "confirmed-manual" }]);

    await expect(current.service.saveDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4,
      mappings: [{
        sourceContractBillRowId: "source-row",
        targetContractBillRowId: "target-row",
        sourceSettledQuantityAllocated: "30",
        targetOpeningQuantity: "30",
        settledAmountAllocatedCents: "3000"
      }]
    })).rejects.toBeInstanceOf(ConflictException);
    expect(current.tx.contractBillRowTransition.upsert).not.toHaveBeenCalled();
  });

  it("allows only a contract director to confirm a conserved mapping group", async () => {
    const current = context();
    current.tx.userPosition.findMany.mockResolvedValue([{ positionId: "position-contract-director" }]);
    current.tx.position.findMany.mockResolvedValue([{ id: "position-contract-director", key: "contract_director" }]);
    current.tx.contractBillRowTransition.findMany
      .mockResolvedValueOnce([{
        id: "transition-a",
        sourceContractBillRowId: "source-row",
        targetContractBillRowId: "target-row-a",
        sourceSettledQuantityAllocated: new Prisma.Decimal("10"),
        targetOpeningQuantity: new Prisma.Decimal("10"),
        settledAmountAllocatedCents: 1000n
      }, {
        id: "transition-b",
        sourceContractBillRowId: "source-row",
        targetContractBillRowId: "target-row-b",
        sourceSettledQuantityAllocated: new Prisma.Decimal("20"),
        targetOpeningQuantity: new Prisma.Decimal("20"),
        settledAmountAllocatedCents: 2000n
      }])
      .mockResolvedValueOnce([]);
    current.tx.contractBillRowTransition.updateMany.mockResolvedValue({ count: 2 });
    current.tx.contractBillRow.findMany.mockResolvedValue([{ id: "source-row", contractBillId: "source-bill", unit: "m" }]);
    current.tx.settlement.findMany.mockResolvedValue([{ id: "settlement-1" }]);
    current.tx.settlementLine.findMany.mockResolvedValue([{
      contractBillRowId: "source-row",
      quantity: new Prisma.Decimal("30"),
      amountCents: 3000n
    }]);

    await current.service.confirmDraftMappings("version-2", "director-1", {
      expectedTargetVersionRevision: 4
    });

    expect(current.tx.contractBillRowTransition.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["transition-a", "transition-b"] }, status: "draft" },
      data: expect.objectContaining({ status: "confirmed", confirmedByUserId: "director-1" })
    }));
  });

  it("lets the draft owner revoke only unconfirmed manual mappings", async () => {
    const current = context();
    current.tx.contractBillRowTransition.updateMany.mockResolvedValueOnce({ count: 2 });
    current.tx.contractBillRowTransition.findMany.mockResolvedValue([]);

    await current.service.discardDraftMappings("version-2", "handler-1", {
      fromContractVersionId: "version-1",
      expectedTargetVersionRevision: 4
    });

    expect(current.tx.contractBillRowTransition.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        fromContractVersionId: "version-1",
        toContractVersionId: "version-2",
        status: "draft",
        matchBasis: "manual"
      }),
      data: { status: "invalidated", revision: { increment: 1 } }
    });
  });

  it("fails closed when a second director confirmation loses the version revision CAS", async () => {
    const current = context();
    current.tx.userPosition.findMany.mockResolvedValue([{ positionId: "position-contract-director" }]);
    current.tx.position.findMany.mockResolvedValue([{ id: "position-contract-director", key: "contract_director" }]);
    current.tx.contractBillRowTransition.findMany.mockResolvedValueOnce([{
      id: "transition-1", sourceContractBillRowId: "source-row", targetContractBillRowId: "target-row",
      sourceSettledQuantityAllocated: new Prisma.Decimal("30"), targetOpeningQuantity: new Prisma.Decimal("30"), settledAmountAllocatedCents: 3000n
    }]);
    current.tx.contractBillRow.findMany.mockResolvedValue([{ id: "source-row", contractBillId: "source-bill", unit: "m" }]);
    current.tx.settlement.findMany.mockResolvedValue([{ id: "settlement-1" }]);
    current.tx.settlementLine.findMany.mockResolvedValue([{ contractBillRowId: "source-row", quantity: new Prisma.Decimal("30"), amountCents: 3000n }]);
    current.tx.contractBillRowTransition.updateMany.mockResolvedValue({ count: 1 });
    current.tx.contractVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(current.service.confirmDraftMappings("version-2", "director-1", {
      expectedTargetVersionRevision: 4
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
