/**
 * Fields represented by the contract-bill row itself (including calculated and
 * transport-only columns). Everything else in a schema snapshot is custom data.
 */
export const CONTRACT_BILL_NON_CUSTOM_COLUMN_KEYS = [
  "itemCode",
  "itemName",
  "specification",
  "unit",
  "quantity",
  "unitPrice",
  "taxRatePercent",
  "taxExclusiveUnitPrice",
  "taxInclusiveAmount",
  "taxExclusiveAmount",
  "taxAmount",
  "isProvisional",
  "settlementBasis",
  "__rowKey"
] as const;

const NON_CUSTOM_COLUMN_KEYS = new Set<string>(CONTRACT_BILL_NON_CUSTOM_COLUMN_KEYS);

export function isContractBillCustomColumn(key: string): boolean {
  return !NON_CUSTOM_COLUMN_KEYS.has(key);
}

export type ContractBillBooleanValue = "true" | "false";

export function normalizeContractBillBoolean(
  value: unknown
): ContractBillBooleanValue | null {
  if (value === true || value === 1) return "true";
  if (value === false || value === 0) return "false";
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "是" || normalized === "1" || normalized === "yes") {
    return "true";
  }
  if (
    normalized === "false" ||
    normalized === "否" ||
    normalized === "0" ||
    normalized === "no"
  ) {
    return "false";
  }
  return null;
}
