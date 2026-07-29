import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./AffiliateBusinessLedgerPanel.vue", import.meta.url), "utf8");
const page = readFileSync(new URL("../ProjectOperatingOverviewPage.vue", import.meta.url), "utf8");

describe("affiliate downstream business ledger structure", () => {
  it("mounts a dedicated contract, settlement and payment takeover tab", () => {
    expect(page).toContain('label="挂靠业务接管"');
    expect(page).toContain("<AffiliateBusinessLedgerPanel");
    expect(panel).toContain('value="contract"');
    expect(panel).toContain('value="settlement"');
    expect(panel).toContain('value="payment"');
  });

  it("uses server-owned actions and the project API layer", () => {
    expect(panel).toContain("availableActions");
    expect(panel).toContain("fetchProjectAffiliateBusinessFacts");
    expect(panel).toContain("recordProjectAffiliateContractFact");
    expect(panel).toContain("recordProjectAffiliateSettlementFact");
    expect(panel).toContain("recordProjectAffiliatePaymentFact");
    expect(panel).not.toContain("fetch(");
  });

  it("keeps evidence, confirmation and append-only adjustments explicit", () => {
    expect(panel).toContain("<t-upload");
    expect(panel).toContain("<SensitiveActionDialog");
    expect(panel).toContain('"correction"');
    expect(panel).toContain('"reversal"');
    expect(panel).toContain("supplementProjectAffiliateBusinessEvidence");
  });
});
