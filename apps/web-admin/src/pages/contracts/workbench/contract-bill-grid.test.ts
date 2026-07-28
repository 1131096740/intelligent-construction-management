import { describe, expect, it } from "vitest";
import type { ReplaceContractBillRowsReadModel } from "../../../api/contract-workbench.api";
import type { WorkbenchBill } from "./contract-bill-editor";
import {
  addBillCandidateRow,
  applyExcelCandidateRows,
  authoritativeBillTotals,
  copyBillCandidateRow,
  emptyBillCandidateRow,
  fromBatchSaveReadModel,
  fromWorkbenchBill,
  invalidateChangedAuthoritativePricing,
  mapServerBillCellErrors,
  moveBillCandidateRow,
  netUnitPriceDetail,
  netUnitPriceDisplay,
  removeBillCandidateRow,
  toReplaceBillRowsInput,
  validateBillCandidateRows,
  type ContractBillCandidateRow
} from "./contract-bill-grid";

const bill: WorkbenchBill = {
  id: "bill-1",
  billKey: "materials",
  name: "材料清单",
  revision: 7,
  taxMode: "multiple_rate",
  defaultTaxRatePercent: "13",
  schemaSnapshot: {
    columns: [
      { key: "itemName", label: "名称", required: true },
      { key: "unit", label: "单位", required: true },
      { key: "brand", label: "品牌", required: true }
    ]
  },
  rows: [{
    rowKey: "server-row-1",
    itemCode: "A-01",
    itemName: "钢筋",
    specification: "HRB400",
    unit: "吨",
    quantity: "3.00",
    unitPrice: "10.01",
    taxRate: "13",
    taxRateSource: "row_override",
    isProvisional: true,
    settlementBasis: "实测实量",
    customData: { brand: "建龙" }
  }]
};

function validRow(patch: Partial<ContractBillCandidateRow> = {}): ContractBillCandidateRow {
  return {
    ...emptyBillCandidateRow("local-test"),
    itemName: "钢筋",
    unit: "吨",
    quantity: "3",
    unitPrice: "10.01",
    taxRatePercent: "13",
    taxRateSource: "row_override",
    customData: { brand: "建龙" },
    ...patch
  };
}

describe("contract bill grid candidate model", () => {
  it("maps the workbench read model while keeping server keys, order, and string decimals", () => {
    const rows = fromWorkbenchBill(bill);

    expect(rows).toEqual([expect.objectContaining({
      clientRowKey: "server-server-row-1",
      rowKey: "server-row-1",
      quantity: "3.00",
      unitPrice: "10.01",
      taxRatePercent: "13",
      taxRateSource: "row_override",
      isProvisional: true,
      customData: { brand: "建龙" }
    })]);
  });

  it("preserves aggregate client row keys across controlled prop echoes", () => {
    const rows = fromWorkbenchBill({
      ...bill,
      rows: [{
        ...bill.rows[0]!,
        clientRowKey: "local-new-7"
      }]
    });

    expect(rows[0]?.clientRowKey).toBe("local-new-7");
    expect(rows[0]?.rowKey).toBe("server-row-1");
  });

  it("preserves authoritative net prices for display but never submits them", () => {
    const authoritative = fromWorkbenchBill({
      ...bill,
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339",
      taxAmountCents: "6192661",
      rows: [{
        ...bill.rows[0]!,
        quantity: "2000",
        unitPrice: "375.00",
        taxExclusiveUnitPrice: "344.036695",
        taxInclusiveAmountCents: "75000000",
        taxExclusiveAmountCents: "68807339",
        taxAmountCents: "6192661"
      }]
    })[0]!;

    expect(authoritative.taxExclusiveUnitPrice).toBe("344.036695");
    expect(netUnitPriceDisplay(authoritative.taxExclusiveUnitPrice)).toBe("344.04");
    expect(netUnitPriceDetail(authoritative.taxExclusiveUnitPrice)).toBe("344.036695");
    expect(authoritativeBillTotals({
      ...bill,
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339",
      taxAmountCents: "6192661"
    })).toEqual({
      kind: "authoritative",
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339",
      taxAmountCents: "6192661"
    });

    const payloadRow = toReplaceBillRowsInput([authoritative], {
      expectedBillRevision: 7,
      idempotencyKey: "no-derived-fields",
      taxMode: "multiple_rate",
      defaultTaxRatePercent: "13"
    }).rows[0]!;
    expect(payloadRow).not.toHaveProperty("taxExclusiveUnitPrice");
    expect(payloadRow).not.toHaveProperty("taxInclusiveAmountCents");
    expect(payloadRow).not.toHaveProperty("taxExclusiveAmountCents");
    expect(payloadRow).not.toHaveProperty("taxAmountCents");
  });

  it("clears stale authoritative pricing only when pricing inputs change", () => {
    const current = validRow({
      taxExclusiveUnitPrice: "344.036695",
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: "68807339",
      taxAmountCents: "6192661"
    });

    expect(invalidateChangedAuthoritativePricing(
      [current],
      [{ ...current, itemName: "钢筋（复核）" }]
    )[0]).toMatchObject({
      taxExclusiveUnitPrice: "344.036695",
      taxExclusiveAmountCents: "68807339"
    });

    const repriced = invalidateChangedAuthoritativePricing(
      [current],
      [{ ...current, quantity: "2001" }]
    )[0]!;
    expect(repriced).not.toHaveProperty("taxExclusiveUnitPrice");
    expect(repriced).not.toHaveProperty("taxInclusiveAmountCents");
    expect(repriced).not.toHaveProperty("taxExclusiveAmountCents");
    expect(repriced).not.toHaveProperty("taxAmountCents");
  });

  it("initializes legacy precision metadata from authoritative workbench and batch rows", () => {
    const legacyWorkbench = fromWorkbenchBill({
      ...bill,
      rows: [{ ...bill.rows[0]!, quantity: "1.123", unitPrice: "2.345", precisionPolicy: "legacy" }]
    })[0];
    expect(legacyWorkbench).toMatchObject({
      precisionPolicy: "legacy", initialQuantity: "1.123", initialUnitPrice: "2.345", initialTaxRatePercent: "13"
    });
    const response: ReplaceContractBillRowsReadModel = {
      bill: null,
      rows: [{
        id: "legacy", contractBillId: "bill-1", rowKey: "legacy", sortOrder: 0,
        itemCode: null, itemName: "钢筋", specification: null, unit: "吨", quantity: "1.123",
        unitPrice: "2.345", taxRate: "13", taxRateSource: "row_override", pricingFactStatus: "confirmed",
        precisionPolicy: "legacy", taxInclusiveAmountCents: "263", taxExclusiveAmountCents: "233",
        taxAmountCents: "30", taxExclusiveUnitPrice: "2.074799",
        isProvisional: false, settlementBasis: null, customData: {},
        createdAt: "2026-07-24T00:00:00.000Z", updatedAt: "2026-07-24T00:00:00.000Z"
      }]
    };
    expect(fromBatchSaveReadModel(response)[0]).toMatchObject({
      precisionPolicy: "legacy", initialQuantity: "1.123", initialUnitPrice: "2.345", initialTaxRatePercent: "13"
    });
  });

  it("keeps derived client keys unique even for a malformed duplicate server row key", () => {
    const rows = fromWorkbenchBill({
      ...bill,
      rows: [
        { ...bill.rows[0]!, rowKey: "same" },
        { ...bill.rows[0]!, rowKey: "same" },
        { ...bill.rows[0]!, rowKey: "same-2" }
      ]
    });

    expect(new Set(rows.map((row) => row.clientRowKey)).size).toBe(3);
  });

  it("adds twenty consecutive unique local rows without blocking on unsaved rows", () => {
    let rows: ContractBillCandidateRow[] = [];
    for (let index = 0; index < 20; index += 1) rows = addBillCandidateRow(rows);

    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => row.clientRowKey)).size).toBe(20);
  });

  it("copies only business fields, clearing server and legacy precision metadata", () => {
    const source = validRow({
      clientRowKey: "server-row",
      rowKey: "server-row",
      quantity: "1.123",
      unitPrice: "2.345",
      precisionPolicy: "legacy",
      initialQuantity: "1.123",
      initialUnitPrice: "2.345",
      initialTaxRatePercent: "13"
    });
    const copied = copyBillCandidateRow([source], source.clientRowKey);
    const copiedRow = copied[1]!;

    expect(copied).toHaveLength(2);
    expect(copiedRow).toMatchObject({ itemName: "钢筋", rowKey: undefined });
    expect(copiedRow.clientRowKey).not.toBe(source.clientRowKey);
    expect(copiedRow.customData).not.toBe(source.customData);
    expect(copiedRow.precisionPolicy).toBeUndefined();
    expect(copiedRow.initialQuantity).toBeUndefined();
    expect(copiedRow.initialUnitPrice).toBeUndefined();
    expect(copiedRow.initialTaxRatePercent).toBeUndefined();
    expect(validateBillCandidateRows([source], bill)).toEqual([]);
    expect(validateBillCandidateRows([copiedRow], bill)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" }),
      expect.objectContaining({ field: "unitPrice" })
    ]));
    const unchanged = [source];
    expect(copyBillCandidateRow(unchanged, "missing")).toBe(unchanged);
  });

  it("removes and moves immutably, leaving missing keys and boundaries untouched", () => {
    const first = validRow({ clientRowKey: "one" });
    const second = validRow({ clientRowKey: "two" });
    const rows = [first, second];

    expect(removeBillCandidateRow(rows, "one").map((row) => row.clientRowKey)).toEqual(["two"]);
    expect(removeBillCandidateRow(rows, "missing")).toBe(rows);
    expect(moveBillCandidateRow(rows, "two", -1).map((row) => row.clientRowKey)).toEqual(["two", "one"]);
    expect(moveBillCandidateRow(rows, "one", -1)).toBe(rows);
    expect(moveBillCandidateRow(rows, "two", 1)).toBe(rows);
  });

  it("maps the full candidate set to replace DTO semantics", () => {
    expect(toReplaceBillRowsInput([validRow({ itemCode: " ", specification: "", quantity: "" })], {
      expectedBillRevision: 7,
      idempotencyKey: "save-1"
    })).toEqual({
      expectedBillRevision: 7,
      idempotencyKey: "save-1",
      rows: [{
        clientRowKey: "local-test",
        sortOrder: 0,
        itemName: "钢筋",
        unit: "吨",
        unitPrice: "10.01",
        taxRatePercent: "13",
        taxRateSource: "row_override",
        isProvisional: false,
        customData: { brand: "建龙" }
      }]
    });
  });

  it("submits tax source and rate as one normalized contract fact", () => {
    const common = { expectedBillRevision: 7, idempotencyKey: "tax-source" };
    expect(toReplaceBillRowsInput([validRow({ taxRatePercent: "9", taxRateSource: "version_default" })], {
      ...common, taxMode: "multiple_rate", defaultTaxRatePercent: "13"
    }).rows[0]).toMatchObject({ taxRateSource: "version_default", taxRatePercent: "13" });
    expect(toReplaceBillRowsInput([validRow({ taxRatePercent: "9", taxRateSource: "row_override" })], {
      ...common, taxMode: "single_rate", defaultTaxRatePercent: "13"
    }).rows[0]).toMatchObject({ taxRateSource: "version_default", taxRatePercent: "13" });
    expect(toReplaceBillRowsInput([validRow({ taxRatePercent: "9", taxRateSource: "row_override" })], {
      ...common, taxMode: "multiple_rate", defaultTaxRatePercent: "13"
    }).rows[0]).toMatchObject({ taxRateSource: "row_override", taxRatePercent: "9" });
  });

  it("keeps every structured server cell error, including unknown fields", () => {
    expect(mapServerBillCellErrors([
      { clientRowKey: "local-test", field: "quantity", message: "数量错误" },
      { clientRowKey: "local-test", field: "unexpected_field", message: "未知列" }
    ])).toEqual([
      { clientRowKey: "local-test", field: "quantity", message: "数量错误" },
      { clientRowKey: "local-test", field: "unexpected_field", message: "未知列" }
    ]);
  });

  it("replaces every candidate from Excel only after confirmation and deep copies it", () => {
    const original = [validRow({ clientRowKey: "original" })];
    const imported = [validRow({
      clientRowKey: "import-1",
      precisionPolicy: "legacy",
      initialQuantity: "1.123",
      initialUnitPrice: "2.345",
      initialTaxRatePercent: "13",
      customData: { brand: "进口" }
    })];

    expect(applyExcelCandidateRows(original, imported, false)).toBe(original);
    const confirmed = applyExcelCandidateRows(original, imported, true);
    expect(confirmed).not.toBe(imported);
    expect(confirmed[0]?.clientRowKey).toBe("import-1");
    expect(confirmed[0]?.customData).not.toBe(imported[0]?.customData);
    expect(confirmed[0]?.precisionPolicy).toBeUndefined();
  });

  it("rebuilds authoritative candidates after batch save and discards temporary keys", () => {
    const response: ReplaceContractBillRowsReadModel = {
      bill: null,
      rows: [{
        id: "id-1", contractBillId: "bill-1", rowKey: "server-row-2", sortOrder: 4,
        itemCode: "B", itemName: "水泥", specification: null, unit: "吨", quantity: "2.00",
        unitPrice: "400.00", taxRate: "13", taxRateSource: "row_override", pricingFactStatus: "confirmed",
        precisionPolicy: "two_decimal", taxInclusiveAmountCents: "80000", taxExclusiveAmountCents: "70796",
        taxAmountCents: "9204", taxExclusiveUnitPrice: "353.980000",
        isProvisional: false, settlementBasis: null, customData: { brand: "海螺" },
        createdAt: "2026-07-24T00:00:00.000Z", updatedAt: "2026-07-24T00:00:00.000Z"
      }]
    };

    expect(fromBatchSaveReadModel(response)).toEqual([expect.objectContaining({
      clientRowKey: "server-server-row-2", rowKey: "server-row-2", itemName: "水泥", customData: { brand: "海螺" }
    })]);
  });

  it("preserves unchanged legacy decimals but rejects a changed overprecision value", () => {
    const legacy = validRow({
      rowKey: "legacy-1",
      quantity: "1.123",
      unitPrice: "2.345",
      precisionPolicy: "legacy",
      initialQuantity: "1.1230",
      initialUnitPrice: "2.345",
      initialTaxRatePercent: "13"
    });
    expect(validateBillCandidateRows([legacy], bill)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" }),
      expect.objectContaining({ field: "unitPrice" })
    ]));
    expect(toReplaceBillRowsInput([legacy], {
      expectedBillRevision: 7, idempotencyKey: "legacy", taxMode: "multiple_rate", defaultTaxRatePercent: "13"
    }).rows[0]).toMatchObject({ quantity: "1.123", unitPrice: "2.345" });
    expect(validateBillCandidateRows([{
      ...legacy, quantity: "3.300", initialQuantity: "3.30"
    }], bill)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" })
    ]));
    expect(validateBillCandidateRows([{ ...legacy, quantity: "1.124" }], bill)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" })
    ]));
  });

  it("requires every legacy pricing fact to remain unchanged before retaining precision", () => {
    const legacy = validRow({
      rowKey: "legacy-partial",
      quantity: "1.123",
      unitPrice: "2.345",
      precisionPolicy: "legacy",
      initialQuantity: "1.123",
      initialUnitPrice: "2.345",
      initialTaxRatePercent: "13.00",
      taxRatePercent: "9",
      taxRateSource: "version_default"
    });
    expect(validateBillCandidateRows([legacy], bill)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" }),
      expect.objectContaining({ field: "unitPrice" })
    ]));

    const convertedUnitPrice = { ...legacy, unitPrice: "2.35" };
    expect(validateBillCandidateRows([convertedUnitPrice], bill)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "quantity" })
    ]));

    const convertedQuantity = { ...legacy, quantity: "1.12" };
    expect(validateBillCandidateRows([convertedQuantity], bill)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "unitPrice" })
    ]));
  });

  it("returns stable cell errors for core, tax and required custom columns without rounding input", () => {
    const errors = validateBillCandidateRows([
      validRow({ itemName: "", unit: "", quantity: "1.234", unitPrice: "0", taxRatePercent: "13.0000001", customData: { brand: "" } })
    ], bill);

    expect(errors).toEqual(expect.arrayContaining([
      { clientRowKey: "local-test", field: "itemName", message: "请填写项目名称" },
      { clientRowKey: "local-test", field: "unit", message: "请填写单位" },
      { clientRowKey: "local-test", field: "quantity", message: "数量必须是最多保留 2 位小数的正数" },
      { clientRowKey: "local-test", field: "unitPrice", message: "含税单价必须大于 0" },
      { clientRowKey: "local-test", field: "taxRatePercent", message: "税率最多保留 6 位小数" },
      { clientRowKey: "local-test", field: "brand", message: "请填写品牌" }
    ]));
  });

  it("never invents totals when the backend projection is incomplete", () => {
    expect(authoritativeBillTotals({
      ...bill,
      taxInclusiveAmountCents: "75000000",
      taxExclusiveAmountCents: null,
      taxAmountCents: "6192661"
    })).toEqual({ kind: "unavailable" });
  });
});
