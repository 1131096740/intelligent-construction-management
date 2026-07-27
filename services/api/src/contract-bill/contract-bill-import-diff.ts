export type ContractBillImportDiffKind =
  | "unchanged"
  | "added"
  | "removed"
  | "one_to_one"
  | "manual_review";

export interface ContractBillImportDiffRow {
  rowKey: string;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
}

export interface ContractBillImportDiff {
  kind: ContractBillImportDiffKind;
  rowKey: string;
  source?: ContractBillImportDiffRow;
  incoming?: ContractBillImportDiffRow;
}

export function classifyContractBillImportDiff(
  previous: readonly ContractBillImportDiffRow[],
  incoming: readonly ContractBillImportDiffRow[]
): ContractBillImportDiffKind[] {
  return describeContractBillImportDiff(previous, incoming).map((diff) => diff.kind);
}

export function describeContractBillImportDiff(
  previous: readonly ContractBillImportDiffRow[],
  incoming: readonly ContractBillImportDiffRow[]
): ContractBillImportDiff[] {
  const previousByKey = new Map(previous.map((row) => [row.rowKey, row]));
  const incomingByKey = new Map(incoming.map((row) => [row.rowKey, row]));
  const diffs: ContractBillImportDiff[] = [];
  for (const row of incoming) {
    const source = previousByKey.get(row.rowKey);
    if (!source) {
      diffs.push({ kind: "added", rowKey: row.rowKey, incoming: row });
      continue;
    }
    const kind = sameIdentity(source, row)
      ? "unchanged"
      : source.unit === row.unit
        ? "one_to_one"
        : "manual_review";
    diffs.push({ kind, rowKey: row.rowKey, source, incoming: row });
  }
  for (const row of previous) {
    if (!incomingByKey.has(row.rowKey)) {
      diffs.push({ kind: "removed", rowKey: row.rowKey, source: row });
    }
  }
  return diffs;
}

function sameIdentity(left: ContractBillImportDiffRow, right: ContractBillImportDiffRow) {
  return left.itemCode === right.itemCode &&
    left.itemName === right.itemName &&
    left.specification === right.specification &&
    left.unit === right.unit;
}
