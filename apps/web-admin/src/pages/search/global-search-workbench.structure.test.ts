import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./GlobalSearchPage.vue", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../components/JgWorkbenchShell.vue", import.meta.url), "utf8");
const resultState = readFileSync(new URL("../../components/JgResultState.vue", import.meta.url), "utf8");

describe("global search workbench canary", () => {
  it("uses the shared shell and exposes every result state without changing its read APIs", () => {
    expect(page).toContain("<JgWorkbenchShell");
    expect(page).toContain("<JgResultState");
    expect(page).toContain("fetchContractLedger");
    expect(page).toContain("fetchSettlementLedger");
    expect(page).toContain("fetchPaymentLedger");
    expect(page).toContain("fetchArchives");
    expect(page).not.toContain("fetch(");
  });

  it("keeps shared components on TDesign and existing business compatibility components", () => {
    expect(shell).toContain("<BusinessPageHeader");
    expect(resultState).toContain("<t-loading");
    expect(resultState).toContain("<EmptyBusinessState");
    expect(resultState).toContain("<BusinessFeedback");
  });
});
