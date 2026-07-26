import { classifyContractBillImportDiff } from "./contract-bill-import-diff";

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
});
