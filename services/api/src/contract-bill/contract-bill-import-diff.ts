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

export function classifyContractBillImportDiff(
  previous: readonly ContractBillImportDiffRow[],
  incoming: readonly ContractBillImportDiffRow[]
): ContractBillImportDiffKind[] {
  const previousByKey = new Map(previous.map((row) => [row.rowKey, row]));
  const incomingByKey = new Map(incoming.map((row) => [row.rowKey, row]));
  const kinds: ContractBillImportDiffKind[] = [];
  for (const row of incoming) {
    const source = previousByKey.get(row.rowKey);
    if (!source) {
      kinds.push("added");
      continue;
    }
    if (sameIdentity(source, row)) kinds.push("unchanged");
    else if (source.unit === row.unit) kinds.push("one_to_one");
    else kinds.push("manual_review");
  }
  for (const row of previous) {
    if (!incomingByKey.has(row.rowKey)) kinds.push("removed");
  }
  return kinds;
}

function sameIdentity(left: ContractBillImportDiffRow, right: ContractBillImportDiffRow) {
  return left.itemCode === right.itemCode &&
    left.itemName === right.itemName &&
    left.specification === right.specification &&
    left.unit === right.unit;
}
