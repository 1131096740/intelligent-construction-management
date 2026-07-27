import {
  classifyContractBillImportDiff,
  describeContractBillImportDiff
} from "./contract-bill-import-diff";

const row = (rowKey: string, unit = "m") => ({
  rowKey,
  itemCode: rowKey,
  itemName: rowKey,
  specification: null,
  unit
});

describe("classifyContractBillImportDiff", () => {
  it("distinguishes unchanged, added, removed, one-to-one, and manual-review rows", () => {
    expect(classifyContractBillImportDiff(
      [row("same"), row("changed"), row("unit-change"), row("removed")],
      [row("same"), { ...row("changed"), itemName: "变更" }, row("unit-change", "t"), row("added")]
    )).toEqual(["unchanged", "one_to_one", "manual_review", "added", "removed"]);
  });

  it("keeps the source and incoming rows for each version-replacement decision", () => {
    const previous = [row("same"), row("changed"), row("unit-change", "m"), row("removed")];
    const incoming = [
      row("same"),
      { ...row("changed"), itemName: "变更" },
      row("unit-change", "t"),
      row("added")
    ];

    expect(describeContractBillImportDiff(previous, incoming)).toEqual([
      expect.objectContaining({ kind: "unchanged", rowKey: "same" }),
      expect.objectContaining({
        kind: "one_to_one",
        rowKey: "changed",
        source: row("changed"),
        incoming: { ...row("changed"), itemName: "变更" }
      }),
      expect.objectContaining({ kind: "manual_review", rowKey: "unit-change" }),
      expect.objectContaining({ kind: "added", rowKey: "added" }),
      expect.objectContaining({ kind: "removed", rowKey: "removed" })
    ]);
  });
});
