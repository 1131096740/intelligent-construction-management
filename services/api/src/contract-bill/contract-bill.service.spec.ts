import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ContractBillService } from "./contract-bill.service";

describe("ContractBillService", () => {
  const audit = { record: jest.fn().mockResolvedValue({}) };

  beforeEach(() => audit.record.mockClear());

  function fixture(options: {
    pricingMode?: "tax_inclusive" | "tax_exclusive";
    amountRole?: string;
    amountSource?: string;
    quantityScale?: number;
    unitPriceScale?: number;
    schemaSnapshot?: unknown;
    rows?: Array<Record<string, unknown>>;
    otherBills?: Array<Record<string, unknown>>;
  } = {}) {
    const bill = {
      id: "bill-1",
      contractVersionId: "version-1",
      revision: 2,
      pricingMode: options.pricingMode ?? "tax_inclusive",
      amountRole: options.amountRole ?? "included",
      quantityScale: options.quantityScale ?? 3,
      unitPriceScale: options.unitPriceScale ?? 4,
      schemaSnapshot: options.schemaSnapshot ?? { columns: [] },
      taxInclusiveAmountCents: 0n,
      taxExclusiveAmountCents: 0n,
      taxAmountCents: 0n
    };
    const version = {
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 5,
      amountSource: options.amountSource ?? "bill_sum",
      amountCents: 0n
    };
    const contract = {
      id: "contract-1",
      ownerUserId: "owner-1",
      voidedAt: null
    };
    const rows = [...(options.rows ?? [])];
    const bills = [bill, ...(options.otherBills ?? [])];
    const tx = {
      contractBill: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...bill })),
        findMany: jest.fn().mockImplementation(() => Promise.resolve(bills.map((row) => ({ ...row })))),
        updateMany: jest.fn().mockImplementation(({ where }: { where: { revision: number } }) => {
          if (where.revision !== bill.revision) return Promise.resolve({ count: 0 });
          bill.revision += 1;
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, bigint> }) => {
          Object.assign(bill, data);
          return Promise.resolve({ ...bill });
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        updateMany: jest.fn().mockImplementation(
          ({ where }: { where: { draftRevision?: number } }) => {
            if (
              where.draftRevision !== undefined &&
              where.draftRevision !== version.draftRevision
            ) {
              return Promise.resolve({ count: 0 });
            }
            if (where.draftRevision !== undefined) version.draftRevision += 1;
            return Promise.resolve({ count: 1 });
          }
        ),
        update: jest.fn().mockImplementation(({ data }: { data: { amountCents: bigint } }) => {
          version.amountCents = data.amountCents;
          return Promise.resolve(version);
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBillRow: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { rowKey: string } }) =>
          Promise.resolve(rows.find((row) => row.rowKey === where.rowKey) ?? null)
        ),
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(rows.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)))
        ),
        count: jest.fn().mockImplementation(() => Promise.resolve(rows.length)),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `row-${rows.length + 1}`, ...data };
          rows.push(row);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: {
          where: { rowKey: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((item) => item.rowKey === where.rowKey);
          if (!row) return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn().mockImplementation(({ where, data }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return Promise.resolve({});
        }),
        deleteMany: jest.fn().mockImplementation(({ where }: { where: { rowKey: string } }) => {
          const index = rows.findIndex((row) => row.rowKey === where.rowKey);
          if (index < 0) return Promise.resolve({ count: 0 });
          rows.splice(index, 1);
          return Promise.resolve({ count: 1 });
        })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    return { service: new ContractBillService(prisma, audit as never), tx, bill, version, rows };
  }

  const rowInput = {
    expectedBillRevision: 2,
    itemName: "钢筋",
    unit: "t",
    quantity: "3.333",
    unitPrice: "100.1234",
    taxRatePercent: "13",
    customData: {}
  };

  it("adds a row and calculates exact amounts", async () => {
    const { service, tx } = fixture();

    const result = await service.addRow("bill-1", "owner-1", rowInput);

    expect(tx.contractBillRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractBillId: "bill-1",
        rowKey: expect.any(String),
        taxInclusiveAmountCents: 33371n,
        taxExclusiveAmountCents: 29532n,
        taxAmountCents: 3839n
      })
    });
    expect(result.bill!.taxInclusiveAmountCents).toBe(33371);
    expect(result.rows[0].quantity).toBe("3.333");
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 6 }
      },
      data: { status: "stale" }
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("updates a row only when bill revision matches", async () => {
    const existing = {
      id: "row-1",
      contractBillId: "bill-1",
      rowKey: "key-1",
      sortOrder: 0,
      quantity: new Prisma.Decimal("1"),
      unitPrice: new Prisma.Decimal("1"),
      taxRate: new Prisma.Decimal("13"),
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 88n,
      taxAmountCents: 12n,
      customData: {}
    };
    const { service, tx } = fixture({ rows: [existing] });
    tx.contractBill.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.updateRow("bill-1", "key-1", "owner-1", rowInput)
    ).rejects.toThrow("Contract bill revision/status conflict");
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not mutate rows when the parent editable-owner CAS fails", async () => {
    const { service, tx } = fixture();
    tx.contractVersion.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.addRow("bill-1", "owner-1", rowInput)).rejects.toThrow(
      "Contract draft revision/status conflict"
    );
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("binds row lookup to the requested bill", async () => {
    const { service, tx } = fixture();

    await expect(
      service.updateRow("bill-1", "foreign-key", "owner-1", rowInput)
    ).rejects.toThrow("Contract bill row not found");
    expect(tx.contractBillRow.findFirst).toHaveBeenCalledWith({
      where: { contractBillId: "bill-1", rowKey: "foreign-key" }
    });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("allows different row tax rates in the same bill", async () => {
    const { service, rows } = fixture();

    await service.addRow("bill-1", "owner-1", { ...rowInput, taxRatePercent: "13" });
    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      expectedBillRevision: 3,
      taxRatePercent: "6"
    });

    expect(rows.map((row) => String(row.taxRate))).toEqual(["13", "6"]);
  });

  it("reorders rows without changing row keys", async () => {
    const rows = [
      {
        id: "row-1",
        contractBillId: "bill-1",
        rowKey: "a",
        sortOrder: 0,
        taxInclusiveAmountCents: 0n,
        taxExclusiveAmountCents: 0n,
        taxAmountCents: 0n
      },
      {
        id: "row-2",
        contractBillId: "bill-1",
        rowKey: "b",
        sortOrder: 1,
        taxInclusiveAmountCents: 0n,
        taxExclusiveAmountCents: 0n,
        taxAmountCents: 0n
      }
    ];
    const { service } = fixture({ rows });

    const result = await service.reorderRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      rowKeys: ["b", "a"]
    });

    expect(result.rows.map((row: { rowKey: string }) => row.rowKey)).toEqual(["b", "a"]);
  });

  it("rejects reorder keys with duplicates, omissions, or another bill's key", async () => {
    const { service, tx } = fixture({
      rows: [
        { id: "row-1", contractBillId: "bill-1", rowKey: "a", sortOrder: 0 },
        { id: "row-2", contractBillId: "bill-1", rowKey: "b", sortOrder: 1 }
      ]
    });

    await expect(
      service.reorderRows("bill-1", "owner-1", {
        expectedBillRevision: 2,
        rowKeys: ["a", "a"]
      })
    ).rejects.toThrow("rowKeys must exactly match");
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("deletes a draft row and recalculates totals", async () => {
    const { service, bill } = fixture({
      rows: [
        {
          id: "row-1",
          contractBillId: "bill-1",
          rowKey: "a",
          sortOrder: 0,
          taxInclusiveAmountCents: 100n,
          taxExclusiveAmountCents: 90n,
          taxAmountCents: 10n
        },
        {
          id: "row-2",
          contractBillId: "bill-1",
          rowKey: "b",
          sortOrder: 1,
          taxInclusiveAmountCents: 200n,
          taxExclusiveAmountCents: 180n,
          taxAmountCents: 20n
        }
      ]
    });

    await service.deleteRow("bill-1", "a", "owner-1", 2);

    expect(bill.taxInclusiveAmountCents).toBe(200n);
    expect(bill.taxExclusiveAmountCents).toBe(180n);
    expect(bill.taxAmountCents).toBe(20n);
  });

  it("rejects quantity precision beyond the bill schema", async () => {
    const { service, tx } = fixture({ quantityScale: 2 });

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, quantity: "1.001" })
    ).rejects.toThrow("quantity exceeds scale 2");
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unit-price precision beyond the bill schema", async () => {
    const { service, tx } = fixture({ unitPriceScale: 2 });

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, unitPrice: "100.123" })
    ).rejects.toThrow("unitPrice exceeds scale 2");
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-canonical or unsafe decimal inputs", async () => {
    const { service } = fixture();

    for (const invalid of ["1e2", "NaN", "-1", "01", " 1"]) {
      await expect(
        service.addRow("bill-1", "owner-1", { ...rowInput, quantity: invalid })
      ).rejects.toThrow("quantity must be a canonical non-negative decimal string");
    }
    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, taxRatePercent: "100.000001" })
    ).rejects.toThrow("taxRatePercent must be between 0 and 100");
  });

  it("allows zero quantity for provisional or not-yet-priced draft rows", async () => {
    const { service, rows } = fixture();

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      quantity: "0",
      unitPrice: "0"
    });

    expect(rows[0].taxInclusiveAmountCents).toBe(0n);
  });

  it("requires plain customData and required non-empty custom columns", async () => {
    const schemaSnapshot = {
      columns: [{ key: "brand", label: "品牌", type: "text", required: true }]
    };
    const { service } = fixture({ schemaSnapshot });

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, customData: { brand: "" } })
    ).rejects.toThrow("Required custom column is missing: brand");
    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, customData: [] as never })
    ).rejects.toThrow("customData must be a plain object");
  });

  it("sums only included and provisional bills into contract amount", async () => {
    const { service, version } = fixture({
      amountRole: "included",
      otherBills: [
        { amountRole: "provisional", taxInclusiveAmountCents: 200n },
        { amountRole: "reference", taxInclusiveAmountCents: 900n },
        { amountRole: "non_priced", taxInclusiveAmountCents: 800n }
      ]
    });

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      quantity: "1",
      unitPrice: "1",
      taxRatePercent: "0"
    });

    expect(version.amountCents).toBe(300n);
  });
});
