import { BadRequestException } from "@nestjs/common";
import { Prisma, type ContractBillRow } from "@prisma/client";

// Internal receipt facts only. No lease, credential, or arbitrary model fields.
const decimalFields = ["quantity", "unitPrice", "taxRate", "taxExclusiveUnitPrice", "taxInclusiveAmountYuan", "taxExclusiveAmountYuan", "taxAmountYuan"] as const;
const centFields = ["taxInclusiveAmountCents", "taxExclusiveAmountCents", "taxAmountCents"] as const;
const textFields = ["rowKey", "itemCode", "itemName", "specification", "unit", "taxRateSource", "pricingFactStatus", "precisionPolicy", "numericSource", "numericReviewStatus", "settlementBasis", "lineageId", "remainderDisposition", "remainderDispositionReason", "remainderDispositionByUserId"] as const;
export function freezeDeletedDraftRow(row: ContractBillRow): Prisma.InputJsonObject {
  return {
    ...Object.fromEntries(textFields.map(key => [key, row[key] ?? null])),
    ...Object.fromEntries(decimalFields.map(key => [key, row[key]?.toString() ?? null])),
    ...Object.fromEntries(centFields.map(key => [key, row[key]?.toString() ?? null])),
    remainderDispositionAt: row.remainderDispositionAt?.toISOString() ?? null,
    contractBillId: row.contractBillId,
    numericProtocolVersion: row.numericProtocolVersion,
    isProvisional: row.isProvisional,
    customData: row.customData as Prisma.InputJsonValue,
    sortOrder: row.sortOrder
  };
}
export function readDeletedDraftRow(value: unknown, contractBillId: string): ContractBillRow {
  const fail = () => { throw new BadRequestException("原删除记录无法核对，请保留输入并联系合同经办人"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const input = value as Record<string, unknown>;
  const allowed = new Set<string>([...textFields, ...decimalFields, ...centFields, "numericProtocolVersion", "isProvisional", "customData", "sortOrder", "remainderDispositionAt", "contractBillId"]);
  if (Object.keys(input).some(key => !allowed.has(key)) || Object.keys(input).length !== allowed.size) return fail();
  if (input.contractBillId !== contractBillId) return fail();
  const result: Record<string, unknown> = { contractBillId };
  for (const key of textFields) {
    const item = input[key];
    if (item !== null && typeof item !== "string") return fail();
    result[key] = item;
  }
  if (["rowKey", "itemName", "unit", "taxRateSource", "pricingFactStatus", "precisionPolicy", "numericSource", "numericReviewStatus"].some(key => typeof input[key] !== "string" || !input[key])) return fail();
  for (const key of decimalFields) {
    const item = input[key];
    if (item !== null && (typeof item !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(item))) return fail();
    result[key] = item === null ? null : new Prisma.Decimal(item as string);
  }
  for (const key of centFields) {
    const item = input[key];
    if (item !== null && (typeof item !== "string" || !/^-?\d+$/u.test(item))) return fail();
    result[key] = item === null ? null : BigInt(item as string);
  }
  if (![1, 2].includes(input.numericProtocolVersion as number) || typeof input.isProvisional !== "boolean" || !Number.isInteger(input.sortOrder) || !input.customData || typeof input.customData !== "object" || Array.isArray(input.customData)) return fail();
  const at = input.remainderDispositionAt;
  if (at !== null && (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) return fail();
  result["remainderDispositionAt"] = at === null ? null : new Date(at as string);
  Object.assign(result, { numericProtocolVersion: input.numericProtocolVersion, isProvisional: input.isProvisional, sortOrder: input.sortOrder, customData: input.customData });
  // Row id and creation/update dates are new; business lineage and cancellation
  // facts remain bound to the server receipt.
  return result as unknown as ContractBillRow;
}
export function originalDraftRowNumericData(row: ContractBillRow) {
  return Object.fromEntries([
    ...decimalFields.map(key => [key, row[key]]), ...centFields.map(key => [key, row[key]]),
    ...["numericProtocolVersion", "numericSource", "numericReviewStatus", "precisionPolicy", "pricingFactStatus", "taxRateSource", "lineageId", "remainderDisposition", "remainderDispositionReason", "remainderDispositionByUserId", "remainderDispositionAt"].map(key => [key, row[key as keyof ContractBillRow]])
  ]);
}


export function deletedRowPublicOriginalValues(row: Prisma.InputJsonObject): Prisma.InputJsonObject {
  return {
    itemCode: row["itemCode"] ?? "", itemName: row["itemName"], specification: row["specification"] ?? "", unit: row["unit"],
    quantity: row["quantity"] ?? null, unitPrice: row["unitPrice"] ?? null, taxRatePercent: row["taxRate"] ?? null,
    taxRateSource: row["taxRateSource"], isProvisional: row["isProvisional"], settlementBasis: row["settlementBasis"] ?? "", customData: row["customData"]
  };
}
