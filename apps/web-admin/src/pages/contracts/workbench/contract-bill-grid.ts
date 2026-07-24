import { normalizeTaxRatePercent } from "@jiangkong/shared-domain";
import type {
  ContractBillBatchSaveRowReadModel,
  ContractBillRowValidationError,
  ReplaceContractBillRowsInput,
  ReplaceContractBillRowsReadModel
} from "../../../api/contract-workbench.api";
import type { WorkbenchBill, WorkbenchBillColumn, WorkbenchBillRow } from "./contract-bill-editor";

export interface ContractBillCandidateRow {
  clientRowKey: string;
  rowKey?: string;
  itemCode: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  taxRateSource: "version_default" | "row_override";
  isProvisional: boolean;
  settlementBasis: string;
  customData: Record<string, string>;
}

export interface ContractBillCellError {
  clientRowKey: string;
  field: string;
  message: string;
}

export type CandidateTotals =
  | {
      kind: "calculated";
      taxInclusiveAmountCents: string;
      taxExclusiveAmountCents: string;
      taxAmountCents: string;
    }
  | {
      kind: "not_calculable";
      clientRowKey: string;
      field: "quantity" | "unitPrice" | "taxRatePercent";
    };

export interface BillCandidateTotalsOptions {
  defaultTaxRatePercent?: string | null;
  taxMode?: WorkbenchBill["taxMode"];
}

export interface ReplaceBillRowsOptions {
  expectedBillRevision: number;
  idempotencyKey: string;
}

const CORE_ROW_KEYS = new Set([
  "itemCode",
  "itemName",
  "specification",
  "unit",
  "quantity",
  "unitPrice",
  "taxRatePercent"
]);

/**
 * The optional key makes this factory deterministic. `addBillCandidateRow` supplies
 * a collision-free key from the current candidate set; import/read paths retain
 * their supplied stable keys.
 */
export function emptyBillCandidateRow(clientRowKey = "local-new"): ContractBillCandidateRow {
  return {
    clientRowKey,
    itemCode: "",
    itemName: "",
    specification: "",
    unit: "",
    quantity: "",
    unitPrice: "",
    taxRatePercent: "",
    taxRateSource: "version_default",
    isProvisional: false,
    settlementBasis: "",
    customData: {}
  };
}

export function fromWorkbenchBill(bill: WorkbenchBill): ContractBillCandidateRow[] {
  const usedKeys = new Set<string>();
  return bill.rows.map((row, index) => {
    const clientRowKey = uniqueServerClientKey(row.rowKey, index, usedKeys);
    return candidateFromWorkbenchRow(row, clientRowKey);
  });
}

export function addBillCandidateRow(rows: ContractBillCandidateRow[]): ContractBillCandidateRow[] {
  return [...rows, emptyBillCandidateRow(nextLocalClientRowKey(rows))];
}

export function copyBillCandidateRow(
  rows: ContractBillCandidateRow[],
  clientRowKey: string
): ContractBillCandidateRow[] {
  const source = rows.find((row) => row.clientRowKey === clientRowKey);
  if (!source) return rows;
  return [
    ...rows,
    {
      ...source,
      clientRowKey: nextLocalClientRowKey(rows),
      rowKey: undefined,
      customData: { ...source.customData }
    }
  ];
}

export function removeBillCandidateRow(
  rows: ContractBillCandidateRow[],
  clientRowKey: string
): ContractBillCandidateRow[] {
  if (!rows.some((row) => row.clientRowKey === clientRowKey)) return rows;
  return rows.filter((row) => row.clientRowKey !== clientRowKey);
}

export function moveBillCandidateRow(
  rows: ContractBillCandidateRow[],
  clientRowKey: string,
  offset: -1 | 1
): ContractBillCandidateRow[] {
  const index = rows.findIndex((row) => row.clientRowKey === clientRowKey);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function toReplaceBillRowsInput(
  rows: ContractBillCandidateRow[],
  options: ReplaceBillRowsOptions
): ReplaceContractBillRowsInput {
  return {
    expectedBillRevision: options.expectedBillRevision,
    idempotencyKey: options.idempotencyKey,
    rows: rows.map((row, sortOrder) => ({
      clientRowKey: row.clientRowKey,
      ...(optionalText(row.rowKey) ? { rowKey: optionalText(row.rowKey) } : {}),
      sortOrder,
      ...(optionalText(row.itemCode) ? { itemCode: optionalText(row.itemCode) } : {}),
      itemName: row.itemName.trim(),
      ...(optionalText(row.specification) ? { specification: optionalText(row.specification) } : {}),
      unit: row.unit.trim(),
      ...(optionalText(row.quantity) ? { quantity: optionalText(row.quantity) } : {}),
      unitPrice: row.unitPrice.trim(),
      ...(optionalText(row.taxRatePercent)
        ? { taxRatePercent: optionalText(row.taxRatePercent) }
        : {}),
      taxRateSource: row.taxRateSource,
      isProvisional: row.isProvisional,
      ...(optionalText(row.settlementBasis)
        ? { settlementBasis: optionalText(row.settlementBasis) }
        : {}),
      customData: { ...row.customData }
    }))
  };
}

export function mapServerBillCellErrors(
  errors: readonly ContractBillRowValidationError[]
): ContractBillCellError[] {
  return errors.map((error) => ({
    clientRowKey: error.clientRowKey,
    field: error.field,
    message: error.message
  }));
}

export function applyExcelCandidateRows(
  currentRows: ContractBillCandidateRow[],
  importedRows: ContractBillCandidateRow[],
  confirmed: boolean
): ContractBillCandidateRow[] {
  if (!confirmed) return currentRows;
  return importedRows.map(cloneCandidateRow);
}

export function fromBatchSaveReadModel(
  response: ReplaceContractBillRowsReadModel
): ContractBillCandidateRow[] {
  const usedKeys = new Set<string>();
  return response.rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.sortOrder - right.row.sortOrder || left.index - right.index)
    .map(({ row, index }) =>
      candidateFromBatchSaveRow(row, uniqueServerClientKey(row.rowKey, index, usedKeys))
    );
}

export function validateBillCandidateRows(
  rows: ContractBillCandidateRow[],
  bill: WorkbenchBill
): ContractBillCellError[] {
  const errors: ContractBillCellError[] = [];
  const requiredCustomColumns = billColumns(bill).filter(
    (column) => column.required && !CORE_ROW_KEYS.has(column.key)
  );

  for (const row of rows) {
    if (!row.itemName.trim()) addCellError(errors, row, "itemName", "请填写项目名称");
    if (!row.unit.trim()) addCellError(errors, row, "unit", "请填写单位");

    const quantity = row.quantity.trim();
    if (!quantity && !isUnlimitedFrameworkBill(bill)) {
      addCellError(errors, row, "quantity", "请填写数量");
    } else if (quantity) {
      const message = positiveTwoDecimalMessage(quantity, "数量");
      if (message) addCellError(errors, row, "quantity", message);
    }

    const unitPrice = row.unitPrice.trim();
    if (!unitPrice) {
      addCellError(errors, row, "unitPrice", "请填写含税单价");
    } else {
      const message = positiveTwoDecimalMessage(unitPrice, "含税单价");
      if (message) addCellError(errors, row, "unitPrice", message);
    }

    const taxRate = effectiveTaxRate(row, bill);
    if (!taxRate) {
      addCellError(
        errors,
        row,
        "taxRatePercent",
        row.taxRateSource === "row_override" ? "请填写例外税率" : "请先填写合同税率"
      );
    } else {
      try {
        normalizeTaxRatePercent(taxRate);
      } catch (error) {
        addCellError(
          errors,
          row,
          "taxRatePercent",
          error instanceof Error ? error.message : "税率填写不正确"
        );
      }
    }

    for (const column of requiredCustomColumns) {
      if (!row.customData[column.key]?.trim()) {
        addCellError(errors, row, column.key, `请填写${column.label}`);
      }
    }
  }
  return errors;
}

export function candidateTotals(
  rows: ContractBillCandidateRow[],
  options: BillCandidateTotalsOptions = {}
): CandidateTotals {
  let taxInclusiveAmountCents = 0n;
  let taxExclusiveAmountCents = 0n;

  for (const row of rows) {
    const quantity = parsePositiveDecimal(row.quantity);
    if (!quantity) return notCalculable(row, "quantity");
    const unitPrice = parsePositiveDecimal(row.unitPrice);
    if (!unitPrice) return notCalculable(row, "unitPrice");
    const taxRateText = effectiveTaxRate(row, options);
    let taxRate: Decimal;
    try {
      taxRate = parseTaxRate(taxRateText);
    } catch {
      return notCalculable(row, "taxRatePercent");
    }

    const rowInclusiveCents = decimalToCents(multiplyDecimals(quantity, unitPrice));
    const rowExclusiveCents = divideAndRoundHalfUp(
      rowInclusiveCents * 100n * pow10(taxRate.scale),
      100n * pow10(taxRate.scale) + taxRate.coefficient
    );
    taxInclusiveAmountCents += rowInclusiveCents;
    taxExclusiveAmountCents += rowExclusiveCents;
  }

  return {
    kind: "calculated",
    taxInclusiveAmountCents: taxInclusiveAmountCents.toString(),
    taxExclusiveAmountCents: taxExclusiveAmountCents.toString(),
    taxAmountCents: (taxInclusiveAmountCents - taxExclusiveAmountCents).toString()
  };
}

function candidateFromWorkbenchRow(row: WorkbenchBillRow, clientRowKey: string): ContractBillCandidateRow {
  return {
    clientRowKey,
    rowKey: row.rowKey,
    itemCode: textValue(row.itemCode),
    itemName: textValue(row.itemName),
    specification: textValue(row.specification),
    unit: textValue(row.unit),
    quantity: textValue(row.quantity),
    unitPrice: textValue(row.unitPrice),
    taxRatePercent: textValue(row.taxRatePercent ?? row.taxRate),
    taxRateSource: row.taxRateSource === "row_override" ? "row_override" : "version_default",
    isProvisional: Boolean(row.isProvisional),
    settlementBasis: textValue(row.settlementBasis),
    customData: stringRecord(row.customData)
  };
}

function candidateFromBatchSaveRow(
  row: ContractBillBatchSaveRowReadModel,
  clientRowKey: string
): ContractBillCandidateRow {
  return {
    clientRowKey,
    rowKey: row.rowKey,
    itemCode: textValue(row.itemCode),
    itemName: row.itemName,
    specification: textValue(row.specification),
    unit: row.unit,
    quantity: textValue(row.quantity),
    unitPrice: textValue(row.unitPrice),
    taxRatePercent: textValue(row.taxRate),
    taxRateSource: row.taxRateSource === "row_override" ? "row_override" : "version_default",
    isProvisional: row.isProvisional,
    settlementBasis: textValue(row.settlementBasis),
    customData: stringRecord(row.customData)
  };
}

function uniqueServerClientKey(rowKey: string, index: number, usedKeys: Set<string>): string {
  const base = `server-${rowKey}`;
  let candidate = base;
  let suffix = index + 1;
  while (usedKeys.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

function nextLocalClientRowKey(rows: ContractBillCandidateRow[]): string {
  const used = new Set(rows.map((row) => row.clientRowKey));
  let index = 1;
  while (used.has(`local-new-${index}`)) index += 1;
  return `local-new-${index}`;
}

function cloneCandidateRow(row: ContractBillCandidateRow): ContractBillCandidateRow {
  return { ...row, customData: { ...row.customData } };
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, textValue(entry)]));
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function billColumns(bill: WorkbenchBill): WorkbenchBillColumn[] {
  const snapshot = bill.schemaSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.columns)) return [];
  return snapshot.columns.filter(isWorkbenchBillColumn);
}

function isWorkbenchBillColumn(value: unknown): value is WorkbenchBillColumn {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).key === "string" &&
      typeof (value as Record<string, unknown>).label === "string"
  );
}

function isUnlimitedFrameworkBill(bill: WorkbenchBill): boolean {
  return bill.pricingNature === "framework" && bill.amountLimitType === "unlimited";
}

function positiveTwoDecimalMessage(value: string, label: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) {
    return `${label}必须是最多保留 2 位小数的正数`;
  }
  if (/^0(?:\.0+)?$/u.test(value)) return `${label}必须大于 0`;
  return "";
}

function effectiveTaxRate(
  row: ContractBillCandidateRow,
  options: Pick<WorkbenchBill, "taxMode" | "defaultTaxRatePercent"> | BillCandidateTotalsOptions
): string {
  return options.taxMode !== "single_rate" && row.taxRateSource === "row_override"
    ? row.taxRatePercent.trim()
    : options.defaultTaxRatePercent?.trim() ?? "";
}

function addCellError(
  errors: ContractBillCellError[],
  row: ContractBillCandidateRow,
  field: string,
  message: string
) {
  errors.push({ clientRowKey: row.clientRowKey, field, message });
}

interface Decimal {
  coefficient: bigint;
  scale: number;
}

function parsePositiveDecimal(value: string): Decimal | null {
  const text = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(text);
  if (!match) return null;
  if ((match[2] ?? "").length > 2) return null;
  const coefficient = BigInt(`${match[1]}${match[2] ?? ""}`);
  if (coefficient === 0n) return null;
  return { coefficient, scale: (match[2] ?? "").length };
}

function parseTaxRate(value: string): Decimal {
  const normalized = normalizeTaxRatePercent(value);
  const parsed = parsePositiveDecimal(normalized);
  if (!parsed) throw new Error("invalid tax rate");
  return parsed;
}

function multiplyDecimals(left: Decimal, right: Decimal): Decimal {
  return { coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale };
}

function decimalToCents(value: Decimal): bigint {
  return divideAndRoundHalfUp(value.coefficient * 100n, pow10(value.scale));
}

function divideAndRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function notCalculable(
  row: ContractBillCandidateRow,
  field: "quantity" | "unitPrice" | "taxRatePercent"
): CandidateTotals {
  return { kind: "not_calculable", clientRowKey: row.clientRowKey, field };
}
