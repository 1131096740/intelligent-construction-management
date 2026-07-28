import { createHash } from "node:crypto";
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
    pricingNature?: string;
    amountLimitType?: string;
    taxMode?: string;
    defaultTaxRatePercent?: string | null;
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
      unitPriceScale: options.unitPriceScale ?? 2,
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
      pricingNature: options.pricingNature ?? "fixed_total",
      amountLimitType: options.amountLimitType ?? "capped",
      taxMode: options.taxMode ?? "single_rate",
      defaultTaxRatePercent:
        options.defaultTaxRatePercent === null
          ? null
          : new Prisma.Decimal(options.defaultTaxRatePercent ?? "13"),
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
        deleteMany: jest.fn().mockImplementation(({ where }: { where: { rowKey: string | { in: string[] } } }) => {
          const keys = typeof where.rowKey === "string" ? [where.rowKey] : where.rowKey.in;
          const before = rows.length;
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (keys.includes(String(rows[index].rowKey))) rows.splice(index, 1);
          }
          return Promise.resolve({ count: before - rows.length });
        })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn()
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
    quantity: "3.33",
    unitPrice: "100.12",
    taxRatePercent: "13",
    customData: {}
  };

  function batchRow(clientRowKey: string, rowKey?: string, overrides: Record<string, unknown> = {}) {
    return {
      clientRowKey,
      ...(rowKey ? { rowKey } : {}),
      sortOrder: 999,
      itemName: "钢筋",
      unit: "t",
      quantity: "3.33",
      unitPrice: "100.12",
      taxRatePercent: "13",
      customData: {},
      ...overrides
    };
  }

  function existingRow(index: number) {
    return {
      id: `row-${index}`,
      contractBillId: "bill-1",
      rowKey: `key-${index}`,
      sortOrder: index,
      itemCode: null,
      itemName: "钢筋",
      specification: null,
      unit: "t",
      quantity: new Prisma.Decimal("3.33"),
      unitPrice: new Prisma.Decimal("100.12"),
      taxRate: new Prisma.Decimal("13"),
      taxRateSource: "version_default",
      pricingFactStatus: "confirmed",
      precisionPolicy: "two_decimal",
      taxInclusiveAmountCents: 33340n,
      taxExclusiveAmountCents: 29504n,
      taxAmountCents: 3836n,
      isProvisional: false,
      settlementBasis: null,
      customData: {}
    };
  }

  function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  it("adds a row and calculates exact amounts", async () => {
    const { service, tx } = fixture();

    const result = await service.addRow("bill-1", "owner-1", rowInput);

    expect(tx.contractBillRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractBillId: "bill-1",
        rowKey: expect.any(String),
        taxInclusiveAmountCents: 33340n,
        taxExclusiveAmountCents: 29504n,
        taxAmountCents: 3836n,
        taxRate: "13",
        taxRateSource: "version_default",
        pricingFactStatus: "confirmed",
        precisionPolicy: "two_decimal"
      })
    });
    expect(result.bill!.taxInclusiveAmountCents).toBe("33340");
    expect(result.rows[0].quantity).toBe("3.33");
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

  it("keeps the authoritative 750,000 yuan net total independent from its displayed unit price", async () => {
    const { service, tx, version } = fixture();
    version.defaultTaxRatePercent = new Prisma.Decimal("9");

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      quantity: "2000",
      unitPrice: "375",
      taxRatePercent: "9"
    });

    expect(tx.contractBillRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taxInclusiveAmountCents: 75_000_000n,
        taxExclusiveAmountCents: 68_807_339n,
        taxAmountCents: 6_192_661n
      })
    });
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
    ).rejects.toThrow("合同清单已变化或当前状态不可编辑，请刷新后重试");
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not mutate rows when the parent editable-owner CAS fails", async () => {
    const { service, tx } = fixture();
    tx.contractVersion.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.addRow("bill-1", "owner-1", rowInput)).rejects.toThrow(
      "合同草稿已变化，请刷新后重试"
    );
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("binds row lookup to the requested bill", async () => {
    const { service, tx } = fixture();

    await expect(
      service.updateRow("bill-1", "foreign-key", "owner-1", rowInput)
    ).rejects.toThrow("合同清单行不存在");
    expect(tx.contractBillRow.findFirst).toHaveBeenCalledWith({
      where: { contractBillId: "bill-1", rowKey: "foreign-key" }
    });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("inherits the version tax rate in single-rate mode and rejects a forged rate", async () => {
    const { service, rows } = fixture();

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      taxRatePercent: undefined
    });
    await expect(
      service.addRow("bill-1", "owner-1", {
        ...rowInput,
        expectedBillRevision: 3,
        taxRatePercent: "6"
      })
    ).rejects.toThrow("单一税率合同的清单税率必须与合同默认税率一致");

    expect(rows.map((row) => String(row.taxRate))).toEqual(["13"]);
  });

  it("allows an explicit row override only in multiple-rate mode", async () => {
    const { service, rows } = fixture({ taxMode: "multiple_rate" });

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      taxRatePercent: "6",
      taxRateSource: "row_override"
    });

    expect(rows[0]).toMatchObject({
      taxRate: "6",
      taxRateSource: "row_override",
      pricingFactStatus: "confirmed"
    });
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
    ).rejects.toThrow("排序行必须与当前清单行完全一致");
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
    ).rejects.toThrow("数量最多保留 2 位小数");
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unit-price precision beyond the bill schema", async () => {
    const { service, tx } = fixture({ unitPriceScale: 2 });

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, unitPrice: "100.123" })
    ).rejects.toThrow("含税单价最多保留 2 位小数");
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-canonical or unsafe decimal inputs", async () => {
    const { service } = fixture();

    for (const invalid of ["1e2", "NaN", "-1", "01", " 1"]) {
      await expect(
        service.addRow("bill-1", "owner-1", { ...rowInput, quantity: invalid })
      ).rejects.toThrow("数量必须是规范的非负数字");
    }
    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, taxRatePercent: "100.000001" })
    ).rejects.toThrow("税率不能超过 100");
    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, taxRatePercent: "0" })
    ).rejects.toThrow("税率必须大于 0");
  });

  it("requires positive quantity for ordinary contracts", async () => {
    const { service } = fixture();

    await expect(
      service.addRow("bill-1", "owner-1", {
        ...rowInput,
        quantity: "0"
      })
    ).rejects.toThrow("数量必须大于 0");
  });

  it("allows an unlimited framework row without estimated quantity", async () => {
    const { service, tx, rows, version } = fixture({
      pricingNature: "framework",
      amountLimitType: "unlimited"
    });

    await service.addRow("bill-1", "owner-1", {
      ...rowInput,
      quantity: ""
    });

    expect(rows[0]).toMatchObject({
      quantity: null,
      taxInclusiveAmountCents: null,
      taxExclusiveAmountCents: null,
      taxAmountCents: null,
      pricingFactStatus: "confirmed"
    });
    expect(version.amountCents).toBe(0n);
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("preserves an unchanged legacy value but requires two decimals when pricing changes", async () => {
    const existing = {
      id: "row-1",
      contractBillId: "bill-1",
      rowKey: "legacy",
      sortOrder: 0,
      quantity: new Prisma.Decimal("1.123"),
      unitPrice: new Prisma.Decimal("2.345"),
      taxRate: new Prisma.Decimal("13"),
      taxRateSource: "version_default",
      pricingFactStatus: "confirmed",
      precisionPolicy: "legacy",
      taxInclusiveAmountCents: 264n,
      taxExclusiveAmountCents: 234n,
      taxAmountCents: 30n,
      customData: {}
    };
    const { service, rows } = fixture({ rows: [existing] });

    await service.updateRow("bill-1", "legacy", "owner-1", {
      ...rowInput,
      quantity: "1.123",
      unitPrice: "2.345",
      itemName: "仅修改名称"
    });
    expect(rows[0].precisionPolicy).toBe("legacy");

    await expect(
      service.updateRow("bill-1", "legacy", "owner-1", {
        ...rowInput,
        expectedBillRevision: 3,
        quantity: "1.123",
        unitPrice: "2.35"
      })
    ).rejects.toThrow("数量最多保留 2 位小数");

    await service.updateRow("bill-1", "legacy", "owner-1", {
      ...rowInput,
      expectedBillRevision: 3,
      quantity: "1.12",
      unitPrice: "2.35"
    });
    expect(rows[0].precisionPolicy).toBe("two_decimal");
  });

  it("requires plain customData and required non-empty custom columns", async () => {
    const schemaSnapshot = {
      columns: [{ key: "brand", label: "品牌", type: "text", required: true }]
    };
    const { service } = fixture({ schemaSnapshot });

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, customData: { brand: "" } })
    ).rejects.toThrow("必填自定义字段未填写：brand");
    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, customData: [] as never })
    ).rejects.toThrow("自定义字段数据必须是普通对象");
  });

  it("requires only dynamic schema columns in customData when the snapshot repeats core fields", async () => {
    const schemaSnapshot = { columns: [
      { key: "itemName", label: "名称", required: true },
      { key: "quantity", label: "数量", required: true },
      { key: "taxInclusiveAmount", label: "含税金额", required: true },
      { key: "brand", label: "品牌", required: true }
    ] };
    const { service } = fixture({ schemaSnapshot });

    await expect(service.addRow("bill-1", "owner-1", {
      ...rowInput, customData: { brand: "建龙" }
    })).resolves.toEqual(expect.objectContaining({ rows: expect.any(Array) }));
    await expect(service.addRow("bill-1", "owner-1", {
      ...rowInput, expectedBillRevision: 3, customData: {}
    })).rejects.toThrow("必填自定义字段未填写：brand");
  });

  it("normalizes every supported schema boolean value and rejects invalid values by column key", async () => {
    const schemaSnapshot = { columns: [
      { key: "fuelIncluded", label: "是否含燃油", type: "boolean", required: true },
      { key: "operatorIncluded", label: "是否带操作人员", type: "boolean", required: true }
    ] };
    const valid = fixture({ schemaSnapshot });

    await valid.service.addRow("bill-1", "owner-1", {
      ...rowInput,
      customData: { fuelIncluded: " YES ", operatorIncluded: 0 }
    });
    expect(valid.tx.contractBillRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customData: { fuelIncluded: "true", operatorIncluded: "false" }
      })
    });

    const legacyCandidate = fixture({ schemaSnapshot });
    await expect(legacyCandidate.service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "legacy-boolean-candidate",
      rows: [batchRow("legacy-boolean", undefined, {
        customData: { fuelIncluded: "1", operatorIncluded: "0" }
      })]
    })).resolves.toEqual(expect.objectContaining({
      bill: expect.any(Object),
      rows: expect.any(Array)
    }));
    expect(legacyCandidate.tx.contractBillRow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customData: { fuelIncluded: "true", operatorIncluded: "false" }
      })
    });

    const invalid = fixture({ schemaSnapshot });
    await expect(invalid.service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "invalid-boolean-custom-data",
      rows: [batchRow("invalid-fuel", undefined, {
        customData: { fuelIncluded: "enabled", operatorIncluded: "false" }
      })]
    })).rejects.toMatchObject({
      response: {
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        rowErrors: [expect.objectContaining({
          clientRowKey: "invalid-fuel",
          field: "fuelIncluded",
          message: "自定义字段“是否含燃油”必须选择“是”或“否”"
        })]
      }
    });
    expect(invalid.tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(invalid.tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("sums complete rows but does not publish a contract amount while priced rows are incomplete", async () => {
    const { service, tx, bill } = fixture({
      rows: [
        {
          id: "row-complete",
          contractBillId: "bill-1",
          rowKey: "complete",
          sortOrder: 0,
          pricingFactStatus: "confirmed",
          taxInclusiveAmountCents: 100n,
          taxExclusiveAmountCents: 88n,
          taxAmountCents: 12n
        },
        {
          id: "row-incomplete",
          contractBillId: "bill-1",
          rowKey: "incomplete",
          sortOrder: 1,
          pricingFactStatus: "unconfirmed",
          taxInclusiveAmountCents: null,
          taxExclusiveAmountCents: null,
          taxAmountCents: null
        }
      ]
    });

    await service.reorderRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      rowKeys: ["incomplete", "complete"]
    });

    expect(bill).toMatchObject({
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 88n,
      taxAmountCents: 12n
    });
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("keeps an identical aggregate bill snapshot stable without rewriting rows", async () => {
    const row = existingRow(0);
    const { service, tx, bill, version } = fixture({ rows: [row] });

    const result = await service.replaceRowsInTransaction(
      tx as never,
      "owner-1",
      version,
      bill,
      {
        expectedRevision: 2,
        rows: [batchRow("aggregate-row", "key-0")]
      } as never
    );

    expect(result).toMatchObject({ changed: false, revision: 2 });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("updates an aggregate bill inside the caller transaction without publishing the contract amount", async () => {
    const row = existingRow(0);
    const { service, tx, bill, version } = fixture({ rows: [row] });

    const result = await service.replaceRowsInTransaction(
      tx as never,
      "owner-1",
      version,
      bill,
      {
        expectedRevision: 2,
        rows: [
          batchRow("aggregate-row", "key-0", {
            itemName: "更新后的钢筋"
          })
        ]
      } as never
    );

    expect(result).toMatchObject({ changed: true, revision: 3 });
    expect(tx.contractBill.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.contractBillRow.update).toHaveBeenCalledTimes(1);
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("不向用户暴露 not JSON 内部哨兵", async () => {
    const { service } = fixture();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(
      service.addRow("bill-1", "owner-1", { ...rowInput, customData: cyclic })
    ).rejects.toThrow("自定义字段数据包含无法保存的内容");
  });

  it("批量保存将非 JSON 自定义数据定位到具体行且不写入", async () => {
    const { service, tx } = fixture();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "invalid-json-custom-data",
      rows: [batchRow("cyclic-custom-data", undefined, { customData: cyclic })]
    })).rejects.toMatchObject({
      response: {
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        rowErrors: [{
          clientRowKey: "cyclic-custom-data",
          field: "customData",
          message: "自定义字段数据包含无法保存的内容"
        }]
      }
    });
    expect(tx.auditLog.findFirst).not.toHaveBeenCalled();
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
      taxRatePercent: undefined
    });

    expect(version.amountCents).toBe(300n);
  });

  it("replaces 101 rows with one revision, a mixed diff, and one audit receipt", async () => {
    const retained = Array.from({ length: 40 }, (_, index) => existingRow(index));
    const updated = Array.from({ length: 30 }, (_, index) => existingRow(index + 40));
    const deleted = Array.from({ length: 6 }, (_, index) => existingRow(index + 70));
    const { service, tx } = fixture({ rows: [...retained, ...updated, ...deleted] });
    const input = {
      expectedBillRevision: 2,
      idempotencyKey: "batch-save-101-rows",
      rows: [
        ...retained.map((row, index) => batchRow(`retained-${index}`, String(row.rowKey))),
        ...updated.map((row, index) => batchRow(`updated-${index}`, String(row.rowKey), {
          itemName: `更新后的钢筋-${index}`
        })),
        ...Array.from({ length: 31 }, (_, index) => batchRow(`new-${index}`))
      ]
    };

    const result = await service.replaceRows("bill-1", "owner-1", input);

    expect(result.bill!.revision).toBe(3);
    expect(tx.contractBill.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.contractBill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revision: 2 }),
      data: { revision: { increment: 1 } }
    }));
    expect(tx.contractBillRow.create).toHaveBeenCalledTimes(31);
    expect(tx.contractBillRow.update).toHaveBeenCalledTimes(30);
    expect(tx.contractBillRow.deleteMany).toHaveBeenCalledWith({
      where: { contractBillId: "bill-1", rowKey: { in: deleted.map((row) => row.rowKey) } }
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.bill.rows.replace",
      businessId: "bill-1",
      metadata: expect.objectContaining({
        idempotencyKeyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        createdCount: 31,
        updatedCount: 30,
        deletedCount: 6,
        previousBillRevision: 2,
        nextBillRevision: 3
      })
    }));
  });

  it("reports every invalid row before writing any row", async () => {
    const { service, tx } = fixture();

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "invalid-batch-save",
      rows: [
        batchRow("local-1"),
        batchRow("local-2", undefined, { quantity: "12.345" })
      ]
    })).rejects.toMatchObject({
      response: {
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        rowErrors: [{
          clientRowKey: "local-2",
          field: "quantity",
          message: expect.any(String)
        }]
      }
    });
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("aggregates primitive batch rows into structured row errors without writes", async () => {
    const { service, tx } = fixture();
    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2, idempotencyKey: "primitive-row-errors", rows: [null, "bad"]
    })).rejects.toMatchObject({ response: { code: "CONTRACT_BILL_VALIDATION_FAILED", rowErrors: [
      expect.objectContaining({ clientRowKey: "row-1", field: "row" }),
      expect.objectContaining({ clientRowKey: "row-2", field: "row" })
    ] } });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("reports explicit batch fields without guessing from validation messages", async () => {
    const { service, tx } = fixture();

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "explicit-field-errors",
      rows: [
        batchRow("invalid-source", undefined, { taxRateSource: "unsupported" }),
        batchRow("invalid-item-code", undefined, { itemCode: 100 }),
        batchRow("invalid-provisional", undefined, { isProvisional: "yes" }),
        batchRow("invalid-custom-envelope", undefined, { customData: [] }),
        { ...batchRow("invalid-row-key"), rowKey: "" },
        batchRow("invalid-sort", undefined, { sortOrder: 1.5 })
      ]
    })).rejects.toMatchObject({
      response: {
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        rowErrors: expect.arrayContaining([
          expect.objectContaining({ clientRowKey: "invalid-source", field: "taxRateSource" }),
          expect.objectContaining({ clientRowKey: "invalid-item-code", field: "itemCode" }),
          expect.objectContaining({ clientRowKey: "invalid-provisional", field: "isProvisional" }),
          expect.objectContaining({ clientRowKey: "invalid-custom-envelope", field: "customData" }),
          expect.objectContaining({ clientRowKey: "invalid-row-key", field: "rowKey" }),
          expect.objectContaining({ clientRowKey: "invalid-sort", field: "sortOrder" })
        ])
      }
    });
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("maps missing required dynamic custom data to its schema column key without writes", async () => {
    const { service, tx } = fixture({
      schemaSnapshot: {
        columns: [{ key: "brand", label: "品牌", type: "text", required: true }]
      }
    });

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "missing-required-custom-data",
      rows: [batchRow("missing-brand")]
    })).rejects.toMatchObject({
      response: {
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        rowErrors: [expect.objectContaining({
          clientRowKey: "missing-brand",
          field: "brand",
          message: "必填自定义字段未填写：brand"
        })]
      }
    });
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a revision mismatch before writing any row", async () => {
    const { service, tx } = fixture();
    tx.contractBill.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "revision-mismatch-save",
      rows: [batchRow("local-1")]
    })).rejects.toThrow("合同清单已变化或当前状态不可编辑，请刷新后重试");
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
  });

  it("returns the authoritative result for an identical idempotent receipt without writes", async () => {
    const { service, tx } = fixture({ rows: [existingRow(1)] });
    const input = {
      expectedBillRevision: 2,
      idempotencyKey: "idempotent-batch-save",
      rows: [batchRow("local-1", "key-1")]
    };
    const requestDigest = createHash("sha256")
      .update(canonicalJson({
      expectedBillRevision: 2,
        rows: [{ ...input.rows[0], expectedBillRevision: 2, sortOrder: 0 }]
      }))
      .digest("hex");
    tx.auditLog.findFirst.mockResolvedValueOnce({
      metadata: { requestDigest }
    });

    await expect(service.replaceRows("bill-1", "owner-1", input)).resolves.toMatchObject({
      bill: { id: "bill-1" },
      rows: [{ rowKey: "key-1" }]
    });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not update numerically equivalent Decimal row facts", async () => {
    const existing = {
      ...existingRow(0),
      quantity: new Prisma.Decimal("3.30"),
      unitPrice: new Prisma.Decimal("100.10"),
      taxRate: new Prisma.Decimal("13.00"),
      taxInclusiveAmountCents: 33033n,
      taxExclusiveAmountCents: 29233n,
      taxAmountCents: 3800n
    };
    const { service, tx } = fixture({ rows: [existing] });

    await service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "equivalent-decimal-row",
      rows: [batchRow("equivalent", "key-0", {
        quantity: "3.3",
        unitPrice: "100.1",
        taxRatePercent: "13.0"
      })]
    });

    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
  });

  it("returns a matching receipt before current tax and schema facts are parsed", async () => {
    const { service, tx, bill, version } = fixture({ rows: [existingRow(1)] });
    const input = {
      expectedBillRevision: 2,
      idempotencyKey: "retry-after-facts-changed",
      rows: [batchRow("local-1", "key-1")]
    };
    const requestDigest = createHash("sha256")
      .update(canonicalJson({
        expectedBillRevision: 2,
        rows: [{ ...input.rows[0], expectedBillRevision: 2, sortOrder: 0 }]
      }))
      .digest("hex");
    tx.auditLog.findFirst.mockResolvedValueOnce({ metadata: { requestDigest } });
    version.defaultTaxRatePercent = new Prisma.Decimal("6");
    bill.schemaSnapshot = {
      columns: [{ key: "newRequired", label: "新增列", type: "text", required: true }]
    };

    await expect(service.replaceRows("bill-1", "owner-1", input)).resolves.toMatchObject({
      bill: { id: "bill-1" }, rows: [{ rowKey: "key-1" }]
    });
    expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key for a different request without row writes", async () => {
    const { service, tx } = fixture();
    tx.auditLog.findFirst.mockResolvedValueOnce({ metadata: { requestDigest: "another-request" } });

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: "reused-batch-save",
      rows: [batchRow("local-1")]
    })).rejects.toThrow("幂等键已被另一份清单使用，请重新保存");
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["recalculation", "audit"])("rejects the transaction when %s fails", async (failure) => {
    const { service, tx } = fixture();
    if (failure === "audit") audit.record.mockRejectedValueOnce(new Error("audit failed"));
    if (failure === "recalculation") {
      const findMany = tx.contractBillRow.findMany.getMockImplementation();
      tx.contractBillRow.findMany
        .mockImplementationOnce(findMany!)
        .mockRejectedValueOnce(new Error("sum failed"));
    }

    await expect(service.replaceRows("bill-1", "owner-1", {
      expectedBillRevision: 2,
      idempotencyKey: `failure-batch-${failure}`,
      rows: [batchRow("local-1")]
    })).rejects.toThrow(failure === "audit" ? "audit failed" : "sum failed");
  });
});
