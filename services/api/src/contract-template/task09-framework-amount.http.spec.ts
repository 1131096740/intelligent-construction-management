import { randomUUID } from "node:crypto";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

describe("task09 framework draft amount over guarded save and reread HTTP", () => {
  it.each([
    { limit: "capped" as const, quantity: "1", expected: "1.5340", cents: "153" },
    { limit: "unlimited" as const, quantity: "1", expected: null, cents: null },
    { limit: "capped" as const, quantity: null, expected: null, cents: null },
    { limit: "capped" as const, quantity: "no_rows", expected: null, cents: null }
  ])("retains known capped money and separates unlimited or unknown facts (%j)", async ({ limit, quantity, expected, cents }) => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const draft = await createTask09Draft(server, limit);
      const beforeResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json();
      const response = await fetch(draft.base, { method: "PUT",
        headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken },
        body: JSON.stringify({
          idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: before.version.draftRevision,
          changedSections: ["draft", "bills"],
          draft: { numericProtocolVersion: 2, pricingNature: "framework", amountSource: "bill_sum",
            draftData: { contractName: "Known capped framework", contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } },
            clauses: [], taxFacts: { invoiceType: "vat_special", taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" } },
          parties: [], bills: before.bills.map((bill: { billKey: string; revision: number }, index: number) => ({
            billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
            rows: index === 0 && quantity !== "no_rows" ? [{ clientRowKey: "known-row", sortOrder: 0, itemName: "Known material", unit: "t", quantity, unitPrice: "1.5340", taxRatePercent: "13", customData: {} }] : []
          })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
        }) });
      const saved = await response.json();
      expect({ status: response.status, message: saved.message }).toEqual({ status: 200, message: undefined });
      const readResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(readResponse.status).toBe(200);
      const read = await readResponse.json();
      if (quantity !== "no_rows") expect(read.bills[0].taxInclusiveAmountYuan).toBe(quantity === null ? null : "1.5340");
      expect(saved.versionAmount).toMatchObject({ amountYuan: expected, amountCents: cents });
      expect(read.version).toMatchObject({ amountLimitType: limit, pricingNature: "framework", amountYuan: expected, amountCents: cents, status: "draft" });
    } finally { await server.app.close(); }
  });
});
