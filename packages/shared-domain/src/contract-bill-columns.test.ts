import { describe, expect, it } from "vitest";
import {
  CONTRACT_BILL_NON_CUSTOM_COLUMN_KEYS,
  isContractBillCustomColumn,
  normalizeContractBillBoolean
} from "./contract-bill-columns";

describe("contract bill column classification", () => {
  it("keeps editable, calculated and row-key fields out of custom data", () => {
    expect(CONTRACT_BILL_NON_CUSTOM_COLUMN_KEYS).toEqual(expect.arrayContaining([
      "itemCode", "itemName", "quantity", "unitPrice", "taxRatePercent",
      "taxExclusiveUnitPrice", "taxInclusiveAmount", "taxExclusiveAmount", "taxAmount",
      "isProvisional", "settlementBasis", "__rowKey"
    ]));
    expect(isContractBillCustomColumn("itemName")).toBe(false);
    expect(isContractBillCustomColumn("taxInclusiveAmount")).toBe(false);
    expect(isContractBillCustomColumn("__rowKey")).toBe(false);
  });

  it("keeps actual dynamic fields as custom data", () => {
    expect(isContractBillCustomColumn("brand")).toBe(true);
    expect(isContractBillCustomColumn("route")).toBe(true);
    expect(isContractBillCustomColumn("fuelIncluded")).toBe(true);
    expect(isContractBillCustomColumn("remark")).toBe(true);
  });

  it.each([
    [true, "true"],
    [false, "false"],
    [" TRUE ", "true"],
    [" false ", "false"],
    ["是", "true"],
    ["否", "false"],
    ["1", "true"],
    ["0", "false"],
    [1, "true"],
    [0, "false"],
    ["YeS", "true"],
    ["nO", "false"]
  ])("normalizes the supported contract bill boolean value %p", (input, expected) => {
    expect(normalizeContractBillBoolean(input)).toBe(expected);
  });

  it.each([undefined, null, "", " ", "y", "n", "有", 2, {}, []])(
    "rejects unsupported contract bill boolean value %p",
    (input) => {
      expect(normalizeContractBillBoolean(input)).toBeNull();
    }
  );
});
