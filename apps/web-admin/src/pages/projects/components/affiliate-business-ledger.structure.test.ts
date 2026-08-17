import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./AffiliateBusinessLedgerPanel.vue", import.meta.url), "utf8");
const page = readFileSync(new URL("../ProjectOperatingOverviewPage.vue", import.meta.url), "utf8");

describe("affiliate downstream business ledger structure", () => {
  it("mounts a dedicated contract, settlement and payment takeover tab", () => {
    expect(page).toContain('label="施工企业业务接管"');
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

  it("keeps database ids hidden behind Chinese business references", () => {
    expect(panel).toContain("fetchProjectAffiliateCompanyContracts");
    expect(panel).toMatch(
      /<t-select\s+[^>]*v-model="settlementForm\.affiliateCompanyContractId"[^>]*:options="affiliateCompanyContractOptions"[^>]*\/>/
    );
    expect(panel).not.toMatch(
      /<t-input\s+[^>]*v-model="settlementForm\.affiliateCompanyContractId"/
    );
    expect(panel).not.toContain("拨款链路的施工企业—我方合同档案编号");
    expect(panel).toContain("paymentRequestCode: fact.paymentRequestCode ?? \"\"");
    expect(panel).toContain('v-model="paymentForm.paymentRequestCode"');
    expect(panel).not.toContain('v-model="paymentForm.paymentRequestId"');
    expect(panel).toContain("已发生的紧急或漏录付款不得补造审批");
  });
});
