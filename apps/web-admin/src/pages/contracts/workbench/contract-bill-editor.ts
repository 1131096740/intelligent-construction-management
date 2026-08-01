import {
  isContractBillCustomColumn,
  normalizeTaxRatePercent,
  type DetailActionReadModel
} from "@jiangkong/shared-domain";

export interface WorkbenchBillColumn {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
}

export interface WorkbenchBillRow {
  rowKey: string;
  itemCode?: string | null;
  itemName?: string | null;
  specification?: string | null;
  unit?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  taxRate?: string | null;
  taxRatePercent?: string | null;
  taxRateSource?: "version_default" | "row_override" | null;
  pricingFactStatus?: string | null;
  precisionPolicy?: string | null;
  initialQuantity?: string | null;
  initialUnitPrice?: string | null;
  taxInclusiveAmountCents?: string | null;
  taxExclusiveAmountCents?: string | null;
  taxAmountCents?: string | null;
  taxExclusiveUnitPrice?: string | null;
  settlementBasis?: string | null;
  isProvisional?: boolean;
  customData?: Record<string, unknown>;
  availableActions?: DetailActionReadModel[];
  remainderCancellation?: WorkbenchBillRemainderCancellationFacts;
  [key: string]: unknown;
}

export interface WorkbenchBillRemainderCancellationFacts {
  expectedBillRevision: number;
  expectedDraftRevision: number;
  expectedOccupancyToken: string;
  historicalQuantity: string;
  historicalAmountCents: string;
}

export interface WorkbenchBill {
  id: string;
  billKey: string;
  name: string;
  revision: number;
  amountRole?: string;
  pricingMode?: string;
  pricingNature?: string;
  amountLimitType?: string;
  taxMode?: "single_rate" | "multiple_rate";
  defaultTaxRatePercent?: string | null;
  taxInclusiveAmountCents?: string | null;
  taxExclusiveAmountCents?: string | null;
  taxAmountCents?: string | null;
  schemaSnapshot?: { columns?: WorkbenchBillColumn[] } | Record<string, unknown>;
  rows: WorkbenchBillRow[];
}

export interface WorkbenchDocument {
  id: string;
  status: string;
  sourceRevision: number;
  purpose?: string;
  createdAt?: string;
  completedAt?: string | null;
  warnings?: unknown;
  inputSnapshot?: unknown;
  docxFileId?: string | null;
  pdfFileId?: string | null;
  [key: string]: unknown;
}

export interface ClauseTextBlock {
  type: "paragraph";
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ClauseListBlock {
  type: "list";
  items: string[];
}

export interface ClauseTableBlock {
  type: "table";
  rows: string[][];
}

export type ClauseBlock = ClauseTextBlock | ClauseListBlock | ClauseTableBlock;

export interface ClauseDocument {
  text: string;
  blocks: ClauseBlock[];
}

export interface ImportPreviewCounts {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: number;
}

const COUNT_KEYS = {
  added: ["added", "addedCount"],
  updated: ["updated", "updatedCount"],
  removed: ["removed", "removedCount"],
  skipped: ["skipped", "skippedCount"],
  errors: ["errors", "errorCount"]
} as const;

export const coreBillColumns: WorkbenchBillColumn[] = [
  { key: "itemName", label: "名称", required: true },
  { key: "specification", label: "规格" },
  { key: "unit", label: "单位", required: true },
  { key: "quantity", label: "数量", required: true },
  { key: "unitPrice", label: "含税单价", required: true },
  { key: "taxRatePercent", label: "税率", required: true }
];

const UNSAVED_BILL_ROW_PREFIX = "local-new-";

export function createUnsavedBillRow(
  id: string,
  defaultTaxRatePercent = ""
): WorkbenchBillRow {
  return {
    rowKey: `${UNSAVED_BILL_ROW_PREFIX}${id}`,
    itemName: "",
    specification: "",
    unit: "",
    quantity: "",
    unitPrice: "",
    taxRatePercent: defaultTaxRatePercent,
    taxRateSource: "version_default",
    customData: {}
  };
}

export function isUnsavedBillRow(row: Pick<WorkbenchBillRow, "rowKey">): boolean {
  return row.rowKey.startsWith(UNSAVED_BILL_ROW_PREFIX);
}

export function billTabs(bills: WorkbenchBill[]) {
  return bills.map((bill) => ({ label: bill.name, value: bill.billKey }));
}

export function selectedBillForDownload(bills: WorkbenchBill[], billKey: string) {
  return bills.find((bill) => bill.billKey === billKey) ?? bills[0] ?? null;
}

export function billColumns(bill: WorkbenchBill): WorkbenchBillColumn[] {
  const customColumns = Array.isArray(bill.schemaSnapshot?.columns)
    ? bill.schemaSnapshot.columns
    : [];
  return [
    ...coreBillColumns.map((column) =>
      column.key === "quantity" && isUnlimitedFrameworkBill(bill)
        ? { ...column, label: "预计数量", required: false }
        : column
    ),
    ...customColumns.filter((column) => isContractBillCustomColumn(column.key))
  ];
}

export function isUnlimitedFrameworkBill(bill: WorkbenchBill): boolean {
  return bill.pricingNature === "framework" && bill.amountLimitType === "unlimited";
}

export function inheritedTaxRateText(bill: WorkbenchBill): string {
  return bill.defaultTaxRatePercent
    ? `继承合同税率（${bill.defaultTaxRatePercent}%）`
    : "合同税率尚未填写";
}

export function billRowValidationMessage(
  row: WorkbenchBillRow,
  bill: WorkbenchBill
): string {
  if (!rowValue(row, "itemName").trim()) return "请填写项目名称";
  if (!rowValue(row, "unit").trim()) return "请填写单位";

  const quantity = rowValue(row, "quantity").trim();
  if (!quantity && !isUnlimitedFrameworkBill(bill)) return "请填写数量";
  if (quantity) {
    const error = positiveTwoDecimalMessage(quantity, "数量");
    if (error && !legacyValueUnchanged(row, "quantity", quantity)) return error;
  }

  const unitPrice = rowValue(row, "unitPrice").trim();
  if (!unitPrice) return "请填写含税单价";
  const unitPriceError = positiveTwoDecimalMessage(unitPrice, "含税单价");
  if (unitPriceError && !legacyValueUnchanged(row, "unitPrice", unitPrice)) {
    return unitPriceError;
  }

  const source = row.taxRateSource ?? "version_default";
  const rate =
    bill.taxMode === "multiple_rate" && source === "row_override"
      ? rowValue(row, "taxRatePercent").trim()
      : bill.defaultTaxRatePercent?.trim() ?? "";
  if (!rate) {
    return source === "row_override" ? "请填写例外税率" : "请先填写合同税率";
  }
  try {
    normalizeTaxRatePercent(rate);
  } catch (error) {
    return error instanceof Error ? error.message : "税率填写不正确";
  }
  return "";
}

export function updateRowPreservingKey(
  rows: WorkbenchBillRow[],
  rowKey: string,
  patch: Partial<WorkbenchBillRow>
): WorkbenchBillRow[] {
  return rows.map((row) =>
    row.rowKey === rowKey ? { ...row, ...patch, rowKey } : row
  );
}

export function mergeFocusedBillAggregate(
  base: WorkbenchBill,
  aggregate: {
    expectedRevision: number;
    rows: Array<Record<string, unknown>>;
  }
): WorkbenchBill {
  const authoritativeRows = new Map(
    base.rows.map((row) => [row.rowKey, row])
  );
  return {
    ...base,
    revision: aggregate.expectedRevision,
    rows: aggregate.rows.map((source) => {
      const draftRow = { ...source };
      delete draftRow["availableActions"];
      delete draftRow["remainderCancellation"];
      const rowKey = typeof draftRow["rowKey"] === "string"
        ? draftRow["rowKey"]
        : "";
      const authoritative = authoritativeRows.get(rowKey);
      const customData =
        draftRow["customData"] !== null &&
        typeof draftRow["customData"] === "object" &&
        !Array.isArray(draftRow["customData"])
          ? { ...draftRow["customData"] as Record<string, unknown> }
          : {};
      return {
        ...authoritative,
        ...draftRow,
        customData,
        ...(authoritative?.availableActions
          ? {
              availableActions: authoritative.availableActions.map(
                (action) => ({ ...action })
              )
            }
          : {}),
        ...(authoritative?.remainderCancellation
          ? {
              remainderCancellation: {
                ...authoritative.remainderCancellation
              }
            }
          : {})
      } as WorkbenchBillRow;
    })
  };
}

export function rowValue(row: WorkbenchBillRow, key: string): string {
  const value = key in row ? row[key] : row.customData?.[key];
  return value === null || value === undefined ? "" : String(value);
}

export function importPreviewCounts(preview: unknown): ImportPreviewCounts {
  const source = objectValue(objectValue(preview).summary ?? preview);
  return {
    added: readCount(source, COUNT_KEYS.added),
    updated: readCount(source, COUNT_KEYS.updated),
    removed: readCount(source, COUNT_KEYS.removed),
    skipped: readCount(source, COUNT_KEYS.skipped),
    errors: readCount(source, COUNT_KEYS.errors)
  };
}

export function importPreviewErrors(preview: unknown): string[] {
  const source = objectValue(preview);
  const summary = objectValue(source.summary);
  return stringsFromUnknown(source.errors).concat(stringsFromUnknown(summary.errors));
}

export function importPreviewRows(preview: unknown): Record<string, unknown>[] {
  const source = objectValue(preview);
  const summary = objectValue(source.summary);
  for (const value of [
    source.rows,
    source.changedRows,
    source.previewRows,
    summary.rows,
    summary.changedRows,
    summary.added,
    summary.updated,
    summary.removed
  ]) {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const row = objectValue(item);
        return Object.keys(row).length ? [row] : [];
      });
    }
  }
  return [];
}

export function canApplyImport(preview: unknown): boolean {
  return importPreviewCounts(preview).errors === 0;
}

export function normalizeClauseDocument(content: unknown): ClauseDocument {
  if (isClauseDocument(content)) {
    return {
      text: content.text,
      blocks: content.blocks.map((block) => cloneClauseBlock(block))
    };
  }
  const text = contentText(content);
  return {
    text,
    blocks: text ? [{ type: "paragraph", text }] : [{ type: "paragraph", text: "" }]
  };
}

export function clauseDocumentText(document: ClauseDocument): string {
  return document.blocks
    .map((block) => {
      if (block.type === "paragraph") return block.text;
      if (block.type === "list") return block.items.join("\n");
      return block.rows.map((row) => row.join(" | ")).join("\n");
    })
    .join("\n")
    .trim();
}

export function clauseReadinessMessages(readiness: unknown, clauseKey: string) {
  const keyPrefix = `clause.${clauseKey}`;
  return readinessEntries(readiness).filter((entry) => entry.key.startsWith(keyPrefix));
}

export function documentWarnings(document: WorkbenchDocument): string[] {
  const direct = stringsFromUnknown(document.warnings);
  const snapshot = objectValue(document.inputSnapshot);
  return [...direct, ...stringsFromUnknown(snapshot["warnings"])];
}

export function documentsWithStaleFlag(
  documents: WorkbenchDocument[],
  currentRevision: number
) {
  return documents.map((document) => ({
    ...document,
    stale: document.status === "stale" || document.sourceRevision !== currentRevision
  }));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isClauseDocument(value: unknown): value is ClauseDocument {
  const record = objectValue(value);
  return typeof record.text === "string" && Array.isArray(record.blocks);
}

function cloneClauseBlock(block: ClauseBlock): ClauseBlock {
  if (block.type === "list") {
    return { ...block, items: [...block.items] };
  }
  if (block.type === "table") {
    return { ...block, rows: block.rows.map((row) => [...row]) };
  }
  return { ...block };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) return content.map((item) => contentText(item)).join("\n");
  if (typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record["text"] === "string") return record["text"];
    return Object.values(record).map((item) => contentText(item)).join("\n");
  }
  return String(content);
}

function readinessEntries(readiness: unknown): Array<{ key: string; message: string; level: string }> {
  const record = objectValue(readiness);
  const fromStructured = [
    ...readinessEntryList(record["blocking"], "blocking"),
    ...readinessEntryList(record["warnings"], "warning")
  ];
  if (fromStructured.length) return fromStructured;
  return [
    ...readinessMessages(record["blockingMessages"], "blocking"),
    ...readinessMessages(record["warningMessages"], "warning")
  ];
}

function readinessEntryList(value: unknown, level: string) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = objectValue(item);
        return typeof record.key === "string" && typeof record.message === "string"
          ? [{ key: record.key, message: record.message, level }]
          : [];
      })
    : [];
}

function readinessMessages(value: unknown, level: string) {
  return Array.isArray(value)
    ? value
        .filter((message): message is string => typeof message === "string")
        .map((message) => ({ key: "", message, level }))
    : [];
}

function stringsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsFromUnknown(item));
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") return [record.message];
    if (typeof record.text === "string") return [record.text];
  }
  return [];
}

function readCount(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 0;
}

function positiveTwoDecimalMessage(value: string, label: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) {
    return `${label}必须是最多保留 2 位小数的正数`;
  }
  if (/^0(?:\.0+)?$/u.test(value)) {
    return `${label}必须大于 0`;
  }
  return "";
}

function legacyValueUnchanged(
  row: WorkbenchBillRow,
  key: "quantity" | "unitPrice",
  value: string
): boolean {
  if (row.precisionPolicy !== "legacy") {
    return false;
  }
  const initial = key === "quantity" ? row.initialQuantity : row.initialUnitPrice;
  return (
    initial !== null &&
    initial !== undefined &&
    normalizedDecimalComparison(value) === normalizedDecimalComparison(initial)
  );
}

function normalizedDecimalComparison(value: string): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) {
    return value;
  }
  const fraction = (match[2] ?? "").replace(/0+$/u, "");
  return fraction ? `${match[1]}.${fraction}` : match[1];
}
