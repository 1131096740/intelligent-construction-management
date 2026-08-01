import { Prisma } from "@prisma/client";
import { ContractBillLineageService } from "./contract-bill-lineage.service";

describe("ContractBillLineageService remainder cancellation facts", () => {
  const targetRows = [{
    id: "target-row-1",
    lineageId: "lineage-1",
    unit: "m",
    quantity: new Prisma.Decimal("120"),
    remainderDisposition: null
  }];

  function store(options: {
    currentQuantity?: Prisma.Decimal | null;
    currentStatusRows?: Array<{ id: string }>;
    reversibleStatusRows?: Array<{ id: string }>;
    transition?: Record<string, unknown>;
    transitions?: Array<Record<string, unknown>>;
    carryQuantity?: Prisma.Decimal | null;
    carryAmountCents?: bigint;
    missingCarry?: boolean;
    sourceSnapshotHash?: string;
    sourceLineageId?: string | null;
    lineId?: string;
    settlementId?: string;
  } = {}) {
    const transitions = options.transitions ?? [{
      id: "transition-1",
      fromContractVersionId: "version-1",
      toContractVersionId: "version-2",
      sourceContractBillRowId: "source-row-1",
      targetContractBillRowId: "target-row-1",
      relationType: "one_to_one",
      sourceSettledQuantityAllocated: null,
      targetOpeningQuantity: null,
      settledAmountAllocatedCents: null,
      quantityConversionBasis: null,
      status: "confirmed",
      ...options.transition
    }];
    return {
      contractBill: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { contractVersionId: string } }) =>
          Promise.resolve([{
            id: where.contractVersionId === "version-2"
              ? "target-bill-1"
              : "source-bill-1"
          }])
        )
      },
      contractBillRow: {
        findMany: jest.fn().mockImplementation(({ where }: {
          where: { contractBillId: { in: string[] } };
        }) => Promise.resolve(
          where.contractBillId.in.includes("target-bill-1")
            ? targetRows.map((row) => ({ ...row, contractBillId: "target-bill-1" }))
            : [{
                id: "source-row-1",
                contractBillId: "source-bill-1",
                lineageId: options.sourceLineageId === undefined
                  ? "lineage-1"
                  : options.sourceLineageId,
                unit: "m"
              }]
        ))
      },
      contractBillRowTransition: {
        findMany: jest.fn().mockResolvedValue(transitions)
      },
      settlement: {
        findMany: jest.fn().mockImplementation(({ where }: {
          where: { status: { in: readonly string[] } };
        }) => Promise.resolve(
          where.status.in.includes("in_approval")
            ? options.reversibleStatusRows ?? []
            : options.currentStatusRows ?? [{ id: options.settlementId ?? "settlement-1" }]
        ))
      },
      settlementLine: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{
          id: options.lineId ?? "line-1",
          settlementId: options.settlementId ?? "settlement-1",
          contractBillRowId: "source-row-1",
          quantity: options.currentQuantity === undefined
            ? new Prisma.Decimal("30")
            : options.currentQuantity,
          amountCents: 3_000_000n
        }])
      },
      contractBillRowCarryForward: {
        findMany: jest.fn().mockResolvedValue(options.missingCarry ? [] : [{
          contractBillRowId: "source-row-1",
          lineageId: "lineage-1",
          priorSettledQuantity: options.carryQuantity === undefined
            ? new Prisma.Decimal("10")
            : options.carryQuantity,
          priorSettledAmountCents: options.carryAmountCents ?? 1_000_000n,
          sourceSnapshotHash: options.sourceSnapshotHash ?? "a".repeat(64),
          updatedAt: new Date("2026-07-30T00:00:00.000Z")
        }])
      }
    };
  }

  it("derives an automatic one-to-one target quantity from carry-forward plus active base settlements", async () => {
    const tx = store();
    const result = await new ContractBillLineageService().remainderCancellationFacts(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: true,
      historicalQuantity: expect.objectContaining({}),
      historicalAmountCents: 4_000_000n,
      disabledReason: null
    }));
    expect(result.get("target-row-1")?.historicalQuantity?.toString()).toBe("40");
    expect(tx.settlement.findMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: expect.arrayContaining(["effective", "partially_paid", "paid"]) }
      },
      select: { id: true }
    });
  });

  it("does not freeze reversible settlement occupancy and disables cancellation until it resolves", async () => {
    const tx = store({
      currentStatusRows: [],
      reversibleStatusRows: [{ id: "settlement-in-approval" }],
      settlementId: "settlement-in-approval"
    });

    const result = await new ContractBillLineageService().remainderCancellationFacts(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: false,
      historicalQuantity: expect.objectContaining({}),
      historicalAmountCents: 1_000_000n,
      disabledReason: expect.stringContaining("尚未生效的在途结算")
    }));
    expect(result.get("target-row-1")?.historicalQuantity?.toString()).toBe("10");
  });

  it("changes the occupancy token when immutable source evidence changes at equal totals", async () => {
    const service = new ContractBillLineageService();
    const first = await service.remainderCancellationFacts(
      store({ sourceSnapshotHash: "a".repeat(64) }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );
    const second = await service.remainderCancellationFacts(
      store({ sourceSnapshotHash: "b".repeat(64) }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(first.get("target-row-1")?.historicalQuantity?.toString()).toBe("40");
    expect(second.get("target-row-1")?.historicalQuantity?.toString()).toBe("40");
    expect(first.get("target-row-1")?.historicalAmountCents).toBe(4_000_000n);
    expect(second.get("target-row-1")?.historicalAmountCents).toBe(4_000_000n);
    expect(first.get("target-row-1")?.expectedOccupancyToken)
      .not.toBe(second.get("target-row-1")?.expectedOccupancyToken);
  });

  it("changes a legacy manual-mapping token when equal totals come from a different settlement line", async () => {
    const resolve = (lineId: string) => new ContractBillLineageService()
      .remainderCancellationFacts(
        store({
          sourceLineageId: null,
          missingCarry: true,
          lineId,
          transition: {
            relationType: "one_to_one",
            sourceSettledQuantityAllocated: new Prisma.Decimal("30"),
            targetOpeningQuantity: new Prisma.Decimal("30"),
            settledAmountAllocatedCents: 3_000_000n
          }
        }) as never,
        { id: "version-2", baseVersionId: "version-1" },
        targetRows
      );

    const first = await resolve("legacy-line-a");
    const second = await resolve("legacy-line-b");

    expect(first.get("target-row-1")?.historicalQuantity?.toString()).toBe("30");
    expect(second.get("target-row-1")?.historicalAmountCents).toBe(3_000_000n);
    expect(first.get("target-row-1")?.expectedOccupancyToken)
      .not.toBe(second.get("target-row-1")?.expectedOccupancyToken);
  });

  it("uses a conserved manual target allocation instead of guessing across units", async () => {
    const tx = store({
      transition: {
        relationType: "merge",
        sourceSettledQuantityAllocated: new Prisma.Decimal("40"),
        targetOpeningQuantity: new Prisma.Decimal("4"),
        settledAmountAllocatedCents: 4_000_000n,
        quantityConversionBasis: "10 m 折算为 1 组"
      }
    });
    targetRows[0]!.unit = "组";

    const result = await new ContractBillLineageService().remainderCancellationFacts(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")?.historicalQuantity?.toString()).toBe("4");
    expect(result.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: true,
      disabledReason: null
    }));
    targetRows[0]!.unit = "m";
  });

  it("fails closed when an active historical settlement omits quantity", async () => {
    const result = await new ContractBillLineageService().remainderCancellationFacts(
      store({ currentQuantity: null }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: false,
      historicalQuantity: null,
      disabledReason: "历史结算存在未记录数量的明细"
    }));
  });

  it("keeps the workbench readable but disables mapped rows when the carry snapshot is missing", async () => {
    const result = await new ContractBillLineageService().remainderCancellationFacts(
      store({ missingCarry: true }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")).toEqual({
      hasHistoricalOccupancy: true,
      canCancel: false,
      historicalQuantity: null,
      historicalAmountCents: 0n,
      disabledReason: "历史承接快照不完整，请先完成跨版本映射核对",
      expectedOccupancyToken: null
    });
  });

  it("protects every target when carry facts are unresolved and no active edge identifies a different-lineage target", async () => {
    const tx = store({ missingCarry: true, transitions: [] });
    const unrelatedTarget = {
      ...targetRows[0]!,
      lineageId: "different-lineage",
      contractBillId: "target-bill-1"
    };
    tx.contractBillRow.findMany.mockImplementation(({ where }: {
      where: { contractBillId: { in: string[] } };
    }) => Promise.resolve(
      where.contractBillId.in.includes("target-bill-1")
        ? [unrelatedTarget]
        : [{
            id: "source-row-1",
            contractBillId: "source-bill-1",
            lineageId: "lineage-1",
            unit: "m"
          }]
    ));

    await expect(new ContractBillLineageService().assertRowsDeletable(
      tx as never,
      [unrelatedTarget.id],
      { id: "version-2", baseVersionId: "version-1" }
    )).rejects.toThrow("不能普通删除");
  });

  it("does not advertise cancellation when the base version has no active settlement occupancy", async () => {
    const tx = store({ currentStatusRows: [], carryQuantity: new Prisma.Decimal(0), carryAmountCents: 0n });
    tx.settlementLine.findMany.mockResolvedValue([]);

    const result = await new ContractBillLineageService().remainderCancellationFacts(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(result.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: false,
      canCancel: false,
      historicalQuantity: null
    }));
  });

  it("blocks ordinary deletion of a target row that carries mapped historical occupancy", async () => {
    const tx = store();

    await expect(new ContractBillLineageService().assertRowsDeletable(
      tx as never,
      ["target-row-1"],
      { id: "version-2", baseVersionId: "version-1" }
    )).rejects.toThrow("不能普通删除");
  });

  it("requires the dedicated action when an ordinary edit converges to historical quantity", async () => {
    const tx = store();

    await expect(new ContractBillLineageService().assertRowsOrdinarilyMutable(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      [{
        row: targetRows[0]!,
        nextUnit: "m",
        nextQuantity: "40"
      }]
    )).rejects.toThrow("请使用取消未实施余量流程");
  });

  it("allows an ordinary quantity adjustment only while it stays above history and preserves unit", async () => {
    const tx = store();

    await expect(new ContractBillLineageService().assertRowsOrdinarilyMutable(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      [{
        row: targetRows[0]!,
        nextUnit: "m",
        nextQuantity: "100"
      }]
    )).resolves.toBeUndefined();
    await expect(new ContractBillLineageService().assertRowsOrdinarilyMutable(
      tx as never,
      { id: "version-2", baseVersionId: "version-1" },
      [{
        row: targetRows[0]!,
        nextUnit: "组",
        nextQuantity: "100"
      }]
    )).rejects.toThrow("不能通过普通编辑改变单位");
  });

  it("blocks checkpoint row replacement after a remainder disposition before any delete", async () => {
    const tx = {
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{ id: "target-bill-1" }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([{
          ...targetRows[0],
          contractBillId: "target-bill-1",
          remainderDisposition: "cancelled"
        }])
      },
      settlementLine: { findFirst: jest.fn() }
    };

    await expect(new ContractBillLineageService().assertVersionRowsReplaceableByCheckpoint(
      tx as never,
      { id: "version-2", baseVersionId: null }
    )).rejects.toThrow("不能通过保存点重建清单");
    expect(tx.settlementLine.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when an occupied source has lost its target transition edge", async () => {
    const tx = store({ transitions: [] });

    await expect(new ContractBillLineageService().assertRowsDeletable(
      tx as never,
      ["target-row-1"],
      { id: "version-2", baseVersionId: "version-1" }
    )).rejects.toThrow("不能普通删除");
  });

  it("fails closed when a carry snapshot has an unknown zero-amount quantity", async () => {
    const tx = store({
      currentStatusRows: [],
      carryQuantity: null,
      carryAmountCents: 0n
    });
    tx.settlementLine.findMany.mockResolvedValue([]);

    await expect(new ContractBillLineageService().assertRowsDeletable(
      tx as never,
      ["target-row-1"],
      { id: "version-2", baseVersionId: "version-1" }
    )).rejects.toThrow("不能普通删除");
  });

  it("fails closed for unconfirmed or non-conserved manual mappings", async () => {
    const service = new ContractBillLineageService();
    const unconfirmed = await service.remainderCancellationFacts(
      store({ transition: { status: "draft" } }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );
    const nonConserved = await service.remainderCancellationFacts(
      store({
        transition: {
          relationType: "split",
          sourceSettledQuantityAllocated: new Prisma.Decimal("39"),
          targetOpeningQuantity: new Prisma.Decimal("39"),
          settledAmountAllocatedCents: 4_000_000n
        }
      }) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(unconfirmed.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: false,
      disabledReason: "历史清单行映射尚未全部确认"
    }));
    expect(nonConserved.get("target-row-1")).toEqual(expect.objectContaining({
      hasHistoricalOccupancy: true,
      canCancel: false,
      disabledReason: "历史清单行映射数量或金额不守恒"
    }));
  });

  it("derives the same occupancy token regardless of database return order", async () => {
    function ordered(reverse: boolean) {
      const tx = store();
      const sourceRows = [
        { id: "source-row-1", contractBillId: "source-bill-1", lineageId: "lineage-1", unit: "m" },
        { id: "source-row-2", contractBillId: "source-bill-1", lineageId: "lineage-2", unit: "m" }
      ];
      const transitions = sourceRows.map((source, index) => ({
        id: `transition-${index + 1}`,
        fromContractVersionId: "version-1",
        toContractVersionId: "version-2",
        sourceContractBillRowId: source.id,
        targetContractBillRowId: "target-row-1",
        relationType: "merge",
        sourceSettledQuantityAllocated: new Prisma.Decimal("40"),
        targetOpeningQuantity: new Prisma.Decimal("40"),
        settledAmountAllocatedCents: 4_000_000n,
        quantityConversionBasis: null,
        status: "confirmed",
        revision: 1
      }));
      tx.contractBillRow.findMany.mockResolvedValue(reverse ? [...sourceRows].reverse() : sourceRows);
      tx.contractBillRowTransition.findMany.mockResolvedValue(
        reverse ? [...transitions].reverse() : transitions
      );
      tx.settlement.findMany.mockResolvedValue([{ id: "settlement-1" }, { id: "settlement-2" }]);
      const lines = sourceRows.map((source, index) => ({
        settlementId: `settlement-${index + 1}`,
        contractBillRowId: source.id,
        quantity: new Prisma.Decimal("30"),
        amountCents: 3_000_000n
      }));
      tx.settlementLine.findMany.mockResolvedValue(reverse ? [...lines].reverse() : lines);
      const carries = sourceRows.map((source, index) => ({
        contractBillRowId: source.id,
        lineageId: source.lineageId,
        priorSettledQuantity: new Prisma.Decimal("10"),
        priorSettledAmountCents: 1_000_000n,
        sourceSnapshotHash: String(index + 1).repeat(64),
        updatedAt: new Date("2026-07-30T00:00:00.000Z")
      }));
      tx.contractBillRowCarryForward.findMany.mockResolvedValue(
        reverse ? [...carries].reverse() : carries
      );
      return tx;
    }

    const service = new ContractBillLineageService();
    const forward = await service.remainderCancellationFacts(
      ordered(false) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );
    const reversed = await service.remainderCancellationFacts(
      ordered(true) as never,
      { id: "version-2", baseVersionId: "version-1" },
      targetRows
    );

    expect(forward.get("target-row-1")?.historicalQuantity?.toString()).toBe("80");
    expect(reversed.get("target-row-1")?.expectedOccupancyToken)
      .toBe(forward.get("target-row-1")?.expectedOccupancyToken);
  });
});
