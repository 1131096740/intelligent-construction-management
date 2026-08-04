import {
  isContractBillCustomColumn,
  normalizeTaxRatePercent,
  type DetailActionReadModel
} from "@jiangkong/shared-domain";
import type {
  ContractBillBatchSaveRowReadModel,
  ContractBillRowValidationError,
  ReplaceContractBillRowsInput,
  ReplaceContractBillRowsReadModel
} from "../../../api/contract-workbench.api";
import type {
  WorkbenchBill,
  WorkbenchBillColumn,
  WorkbenchBillRemainderCancellationFacts,
  WorkbenchBillRow
} from "./contract-bill-editor";

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
  precisionPolicy?: "legacy" | "two_decimal";
  initialQuantity?: string;
  initialUnitPrice?: string;
  initialTaxRatePercent?: string;
  taxExclusiveUnitPrice?: string | null;
  taxInclusiveAmountCents?: string | null;
  taxExclusiveAmountCents?: string | null;
  taxAmountCents?: string | null;
  isProvisional: boolean;
  settlementBasis: string;
  customData: Record<string, string>;
  availableActions?: DetailActionReadModel[];
  remainderCancellation?: WorkbenchBillRemainderCancellationFacts;
}

export interface ContractBillCellError {
  clientRowKey: string;
  field: string;
  message: string;
}

export type AuthoritativeBillTotals =
  | {
      kind: "authoritative";
      taxInclusiveAmountCents: string;
      taxExclusiveAmountCents: string;
      taxAmountCents: string;
    }
  | { kind: "unavailable" };

export interface BillCandidateTotalsOptions {
  defaultTaxRatePercent?: string | null;
  taxMode?: WorkbenchBill["taxMode"];
}

export interface ReplaceBillRowsOptions extends BillCandidateTotalsOptions {
  expectedBillRevision: number;
  idempotencyKey: string;
}

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
    const suppliedClientRowKey =
      typeof row.clientRowKey === "string" ? row.clientRowKey.trim() : "";
    const clientRowKey = uniqueClientKey(
      suppliedClientRowKey || `server-${row.rowKey}`,
      index,
      usedKeys
    );
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
  const copied = {
    ...source,
    clientRowKey: nextLocalClientRowKey(rows),
    rowKey: undefined,
    customData: { ...source.customData }
  };
  delete copied.precisionPolicy;
  delete copied.initialQuantity;
  delete copied.initialUnitPrice;
  delete copied.initialTaxRatePercent;
  delete copied.taxExclusiveUnitPrice;
  delete copied.taxInclusiveAmountCents;
  delete copied.taxExclusiveAmountCents;
  delete copied.taxAmountCents;
  delete copied.availableActions;
  delete copied.remainderCancellation;
  return [
    ...rows,
    copied
  ];
}

export function removeBillCandidateRow(
  rows: ContractBillCandidateRow[],
  clientRowKey: string
): ContractBillCandidateRow[] {
  const selected = rows.find((row) => row.clientRowKey === clientRowKey);
  if (!selected || rowHasRemainderCancellationCapability(selected)) return rows;
  return rows.filter((row) => row.clientRowKey !== clientRowKey);
}

export function rowHasRemainderCancellationCapability(
  row: Pick<
    ContractBillCandidateRow,
    "availableActions" | "remainderCancellation"
  >
): boolean {
  return Boolean(
    row.remainderCancellation ||
    row.availableActions?.some(
      (action) => action.key === "contract-bill.remainder-cancellation"
    )
  );
}

export function preservesGovernedBillRowKeys(
  currentRows: readonly ContractBillCandidateRow[],
  candidateRows: readonly ContractBillCandidateRow[]
): boolean {
  const candidateRowKeyCounts = new Map<string, number>();
  for (const row of candidateRows) {
    const rowKey = row.rowKey?.trim();
    if (!rowKey) continue;
    candidateRowKeyCounts.set(rowKey, (candidateRowKeyCounts.get(rowKey) ?? 0) + 1);
  }
  return currentRows.every((row) => {
    if (!rowHasRemainderCancellationCapability(row)) return true;
    const rowKey = row.rowKey?.trim();
    return Boolean(rowKey && candidateRowKeyCounts.get(rowKey) === 1);
  });
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
    rows: rows.map((row, sortOrder) => {
      const tax = replaceTaxFact(row, options);
      return {
      clientRowKey: row.clientRowKey,
      ...(optionalText(row.rowKey) ? { rowKey: optionalText(row.rowKey) } : {}),
      sortOrder,
      ...(optionalText(row.itemCode) ? { itemCode: optionalText(row.itemCode) } : {}),
      itemName: row.itemName.trim(),
      ...(optionalText(row.specification) ? { specification: optionalText(row.specification) } : {}),
      unit: row.unit.trim(),
      ...(optionalText(row.quantity) ? { quantity: optionalText(row.quantity) } : {}),
      unitPrice: row.unitPrice.trim(),
      ...(tax.taxRatePercent
        ? { taxRatePercent: tax.taxRatePercent }
        : {}),
      taxRateSource: tax.taxRateSource,
      isProvisional: row.isProvisional,
      ...(optionalText(row.settlementBasis)
        ? { settlementBasis: optionalText(row.settlementBasis) }
        : {}),
      customData: { ...row.customData }
      };
    })
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
  if (!confirmed || !preservesGovernedBillRowKeys(currentRows, importedRows)) {
    return currentRows;
  }
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
      candidateFromBatchSaveRow(
        row,
        uniqueClientKey(`server-${row.rowKey}`, index, usedKeys)
      )
    );
}

export function validateBillCandidateRows(
  rows: ContractBillCandidateRow[],
  bill: WorkbenchBill
): ContractBillCellError[] {
  const errors: ContractBillCellError[] = [];
  const requiredCustomColumns = billColumns(bill).filter(
    (column) => column.required && isContractBillCustomColumn(column.key)
  );

  for (const row of rows) {
    const retainsLegacyPrecision = hasUnchangedLegacyPricingFacts(row, bill);
    if (!row.itemName.trim()) addCellError(errors, row, "itemName", "请填写项目名称");
    if (!row.unit.trim()) addCellError(errors, row, "unit", "请填写单位");

    const quantity = row.quantity.trim();
    if (!quantity && !isUnlimitedFrameworkBill(bill)) {
      addCellError(errors, row, "quantity", "请填写数量");
    } else if (quantity) {
      const message = positiveTwoDecimalMessage(quantity, "数量");
      if (message && !retainsLegacyPrecision) {
        addCellError(errors, row, "quantity", message);
      }
    }

    const unitPrice = row.unitPrice.trim();
    if (!unitPrice) {
      addCellError(errors, row, "unitPrice", "请填写含税单价");
    } else {
      const message = positiveTwoDecimalMessage(unitPrice, "含税单价");
      if (message && !retainsLegacyPrecision) {
        addCellError(errors, row, "unitPrice", message);
      }
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

export function authoritativeBillTotals(
  bill: Pick<
    WorkbenchBill,
    "taxInclusiveAmountCents" | "taxExclusiveAmountCents" | "taxAmountCents"
  >
): AuthoritativeBillTotals {
  const inclusive = bill.taxInclusiveAmountCents;
  const exclusive = bill.taxExclusiveAmountCents;
  const tax = bill.taxAmountCents;
  if (
    typeof inclusive !== "string" ||
    typeof exclusive !== "string" ||
    typeof tax !== "string" ||
    !/^\d+$/u.test(inclusive) ||
    !/^\d+$/u.test(exclusive) ||
    !/^\d+$/u.test(tax)
  ) {
    return { kind: "unavailable" };
  }
  return {
    kind: "authoritative",
    taxInclusiveAmountCents: inclusive,
    taxExclusiveAmountCents: exclusive,
    taxAmountCents: tax
  };
}

export function netUnitPriceDisplay(value: string | null | undefined): string {
  return decimalDisplay(value, 2);
}

export function netUnitPriceDetail(value: string | null | undefined): string {
  return decimalDisplay(value, 6);
}

export function invalidateChangedAuthoritativePricing(
  currentRows: readonly ContractBillCandidateRow[],
  nextRows: readonly ContractBillCandidateRow[]
): ContractBillCandidateRow[] {
  const currentByKey = new Map(
    currentRows.map((row) => [row.clientRowKey, row])
  );
  return nextRows.map((row) => {
    const current = currentByKey.get(row.clientRowKey);
    if (!current || pricingInputsEqual(current, row)) return row;
    const next = { ...row };
    delete next.taxExclusiveUnitPrice;
    delete next.taxInclusiveAmountCents;
    delete next.taxExclusiveAmountCents;
    delete next.taxAmountCents;
    return next;
  });
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
    ...(row.precisionPolicy === "legacy" || row.precisionPolicy === "two_decimal"
      ? { precisionPolicy: row.precisionPolicy }
      : {}),
    ...(row.initialQuantity !== null && row.initialQuantity !== undefined
      ? { initialQuantity: textValue(row.initialQuantity) }
      : { initialQuantity: textValue(row.quantity) }),
    ...(row.initialUnitPrice !== null && row.initialUnitPrice !== undefined
      ? { initialUnitPrice: textValue(row.initialUnitPrice) }
      : { initialUnitPrice: textValue(row.unitPrice) }),
    initialTaxRatePercent: textValue(row.taxRatePercent ?? row.taxRate),
    taxExclusiveUnitPrice: row.taxExclusiveUnitPrice ?? null,
    taxInclusiveAmountCents: row.taxInclusiveAmountCents ?? null,
    taxExclusiveAmountCents: row.taxExclusiveAmountCents ?? null,
    taxAmountCents: row.taxAmountCents ?? null,
    isProvisional: Boolean(row.isProvisional),
    settlementBasis: textValue(row.settlementBasis),
    customData: stringRecord(row.customData),
    ...(Array.isArray(row.availableActions)
      ? { availableActions: row.availableActions.map((action) => ({ ...action })) }
      : {}),
    ...(row.remainderCancellation
      ? { remainderCancellation: { ...row.remainderCancellation } }
      : {})
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
    ...(row.precisionPolicy === "legacy" || row.precisionPolicy === "two_decimal"
      ? { precisionPolicy: row.precisionPolicy }
      : {}),
    initialQuantity: textValue(row.quantity),
    initialUnitPrice: textValue(row.unitPrice),
    initialTaxRatePercent: textValue(row.taxRate),
    taxExclusiveUnitPrice: row.taxExclusiveUnitPrice,
    taxInclusiveAmountCents: row.taxInclusiveAmountCents,
    taxExclusiveAmountCents: row.taxExclusiveAmountCents,
    taxAmountCents: row.taxAmountCents,
    isProvisional: row.isProvisional,
    settlementBasis: textValue(row.settlementBasis),
    customData: stringRecord(row.customData)
  };
}

function uniqueClientKey(base: string, index: number, usedKeys: Set<string>): string {
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
  const candidate = { ...row };
  delete candidate.precisionPolicy;
  delete candidate.initialQuantity;
  delete candidate.initialUnitPrice;
  delete candidate.initialTaxRatePercent;
  delete candidate.taxExclusiveUnitPrice;
  delete candidate.taxInclusiveAmountCents;
  delete candidate.taxExclusiveAmountCents;
  delete candidate.taxAmountCents;
  delete candidate.availableActions;
  delete candidate.remainderCancellation;
  return { ...candidate, customData: { ...candidate.customData } };
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, textValue(entry)]));
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function billColumns(bill: WorkbenchBill): WorkbenchBillColumn[] {
  const snapshot = bill.schemaSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.columns)) return [];
  return snapshot.columns.filter(
    (column): column is WorkbenchBillColumn =>
      isWorkbenchBillColumn(column) && isContractBillCustomColumn(column.key)
  );
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
  if ((value.split(".")[0] ?? "").length > 18) return `${label}整数位数不能超过 18 位`;
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

function hasUnchangedLegacyPricingFacts(
  row: ContractBillCandidateRow,
  options: Pick<WorkbenchBill, "taxMode" | "defaultTaxRatePercent"> | BillCandidateTotalsOptions
): boolean {
  if (row.precisionPolicy !== "legacy") return false;
  if (
    row.initialQuantity === undefined ||
    row.initialUnitPrice === undefined ||
    row.initialTaxRatePercent === undefined
  ) {
    return false;
  }
  return (
    decimalEquivalent(row.quantity, row.initialQuantity) &&
    decimalEquivalent(row.unitPrice, row.initialUnitPrice) &&
    taxRateEquivalent(effectiveTaxRate(row, options), row.initialTaxRatePercent)
  );
}

function taxRateEquivalent(left: string, right: string): boolean {
  try {
    return normalizeTaxRatePercent(left) === normalizeTaxRatePercent(right);
  } catch {
    return false;
  }
}

function decimalEquivalent(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value.trim());
    if (!match) return null;
    const fraction = (match[2] ?? "").replace(/0+$/u, "");
    return fraction ? `${match[1]}.${fraction}` : match[1];
  };
  const normalizedLeft = normalize(left);
  return normalizedLeft !== null && normalizedLeft === normalize(right);
}

function replaceTaxFact(
  row: ContractBillCandidateRow,
  options: ReplaceBillRowsOptions
): Pick<ContractBillCandidateRow, "taxRatePercent" | "taxRateSource"> {
  if (options.taxMode === "single_rate") {
    return {
      taxRateSource: "version_default",
      taxRatePercent: optionalText(options.defaultTaxRatePercent) ?? ""
    };
  }
  if (options.taxMode === "multiple_rate") {
    if (row.taxRateSource === "row_override") {
      return { taxRateSource: "row_override", taxRatePercent: optionalText(row.taxRatePercent) ?? "" };
    }
    return {
      taxRateSource: "version_default",
      taxRatePercent: optionalText(options.defaultTaxRatePercent) ?? ""
    };
  }
  return {
    taxRateSource: row.taxRateSource,
    taxRatePercent: optionalText(row.taxRatePercent) ?? ""
  };
}

function decimalDisplay(
  value: string | null | undefined,
  scale: number
): string {
  if (typeof value !== "string") return "—";
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return "—";
  const fraction = match[2] ?? "";
  const factor = 10n ** BigInt(scale);
  let scaled =
    BigInt(match[1]) * factor +
    BigInt((fraction.slice(0, scale) || "0").padEnd(scale, "0"));
  if ((fraction[scale] ?? "0") >= "5") scaled += 1n;
  const whole = scaled / factor;
  if (scale === 0) return whole.toString();
  const decimals = (scaled % factor).toString().padStart(scale, "0");
  return `${whole}.${decimals}`;
}

function pricingInputsEqual(
  current: ContractBillCandidateRow,
  next: ContractBillCandidateRow
): boolean {
  return (
    current.quantity === next.quantity &&
    current.unitPrice === next.unitPrice &&
    current.taxRatePercent === next.taxRatePercent &&
    current.taxRateSource === next.taxRateSource
  );
}
