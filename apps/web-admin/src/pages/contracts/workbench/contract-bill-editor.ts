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
  settlementBasis?: string | null;
  isProvisional?: boolean;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkbenchBill {
  id: string;
  billKey: string;
  name: string;
  revision: number;
  taxInclusiveAmountCents?: string | number;
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
  { key: "unitPrice", label: "单价", required: true },
  { key: "taxRatePercent", label: "税率%", required: true }
];

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
  const coreKeys = new Set(coreBillColumns.map((column) => column.key));
  return [
    ...coreBillColumns,
    ...customColumns.filter((column) => !coreKeys.has(column.key))
  ];
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
