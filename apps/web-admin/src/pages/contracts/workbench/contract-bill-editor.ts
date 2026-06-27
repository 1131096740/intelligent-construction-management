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
  docxFileId?: string | null;
  pdfFileId?: string | null;
  [key: string]: unknown;
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

export function canApplyImport(preview: unknown): boolean {
  return importPreviewCounts(preview).errors === 0;
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
