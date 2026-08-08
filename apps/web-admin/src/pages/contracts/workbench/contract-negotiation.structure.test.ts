import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../ContractWorkbenchPage.vue", import.meta.url), "utf8");
const documents = readFileSync(new URL("./ContractDocumentsSection.vue", import.meta.url), "utf8");

describe("contract negotiation retirement structure", () => {
  it("removes negotiation UI from the active workbench while keeping the document flow", () => {
    expect(page).toContain("ContractDocumentCanvas");
    expect(page).not.toContain("ContractNegotiationCanvas");
    expect(page).not.toContain("ContractNegotiationSection");
    expect(documents).not.toContain("ContractNegotiationSection");
    expect(page).toContain("ContractCounterpartySignedFilesPanel");
  });
});
