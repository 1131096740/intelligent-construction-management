import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(name: string) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("contract section aggregate editing boundary", () => {
  it("routes bill candidates through the global draft without legacy persistence", () => {
    const source = read("./ContractBillFocusEditor.vue");

    expect(source).toContain('emit("update:rows"');
    expect(source).toContain('emit("edited"');
    expect(source).toContain("previewContractDraftBillExcelImport");
    expect(source).toContain("uploadPrivateFile");
    expect(source).not.toContain("replaceContractBillRows");
    expect(source).not.toContain("applyBillExcelImport");
    expect(source).not.toContain("保存全部");
  });

  it("keeps party file upload independent but stages the association in the aggregate", () => {
    const source = read("./ContractPartySection.vue");

    expect(source).toContain("uploadPrivateFile");
    expect(source).toContain('"update:parties"');
    expect(source).toContain('"edited"');
    expect(source).not.toContain("addContractParty");
    expect(source).not.toContain("保存合作单位");
  });

  it("marks the exact aggregate sections at the workbench owner", () => {
    const source = read("../ContractWorkbenchPage.vue");

    expect(source).toContain('@edited="markDirty(\'bills\')"');
    expect(source).toContain('@edited="markDirty(\'parties\')"');
    expect(source).toContain("applyPatch($event, 'payment_terms')");
    expect(source).toContain("updateFocusedBillRows");
    expect(source).toContain("updateParties");
  });

  it.each([
    "ContractPaymentTermsSection.vue",
    "ContractClausesSection.vue"
  ])("keeps %s presentational without direct API persistence", (name) => {
    const source = read(`./${name}`);

    expect(source).not.toMatch(
      /\b(?:save|update|replace|apply|add)Contract(?:Draft|Payment|Clause)/u
    );
    expect(source).not.toMatch(/保存(?:付款|条款|本节|全部)/u);
  });
});
