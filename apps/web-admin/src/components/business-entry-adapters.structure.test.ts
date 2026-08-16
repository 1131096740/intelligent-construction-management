import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(name: string) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("business entry adapter components", () => {
  it("shares one field control across form and narrow-screen cards", () => {
    expect(read("./BusinessEntryForm.vue")).toContain("BusinessEntryFieldControl");
    expect(read("./BusinessEntryMobileCards.vue")).toContain("BusinessEntryFieldControl");
  });

  it("uses JgBusinessGrid on desktop, cards on narrow screens, and cell-level errors", () => {
    const source = read("./BusinessEntryGrid.vue");
    expect(source).toContain("<JgBusinessGrid");
    expect(source).toContain("<BusinessEntryMobileCards");
    expect(source).toContain("(max-width: 767px)");
    expect(source).toContain("business-entry-grid__cell--error");
  });

  it("renders readonly values from the frozen definition and requires an import choice", () => {
    expect(read("./BusinessEntryReadonlySnapshot.vue")).toContain("submittedRecord.definition.fields");
    const choice = read("./BusinessEntryImportChoice.vue");
    expect(choice).toContain("新建草稿");
    expect(choice).toContain("追加到当前草稿");
  });
});
