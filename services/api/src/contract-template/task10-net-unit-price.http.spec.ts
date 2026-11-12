import { randomUUID } from "node:crypto";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createReviewedMaterialFixture, type Body } from "./task10-body.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

// Expected literals were calculated independently with Decimal precision100 and
// four-place HALF_UP. No rendering or bill product helper computes expectations.
const vectors = [
  { name: "small quantity retains unit price information", quantity: "0.0001", netUnit: "1.5340", rate: "13", net: "0.0002", tax: "0.0000", gross: "0.0002", grossUnit: "1.7334" },
  { name: "non-unit quantity with known rate", quantity: "2.5", netUnit: "1.5340", rate: "13", net: "3.8350", tax: "0.4986", gross: "4.3336", grossUnit: "1.7334" },
  { name: "explicit zero price and zero tax remain known", quantity: "2.5", netUnit: "0.0000", rate: "0", net: "0.0000", tax: "0.0000", gross: "0.0000", grossUnit: "0.0000" },
  { name: "large four-place unit retains precision beyond twenty digits", quantity: "0.0003", netUnit: "987654321987654321.2345", rate: "0.0001", net: "296296296596296.2964", tax: "296296296.5963", gross: "296296592892592.8927", grossUnit: "987655309641976308.8888" }
];

describe("task10 authoritative net unit prices in explicit gross Word columns", () => {
  let fixture: Awaited<ReturnType<typeof createReviewedMaterialFixture>>;
  beforeAll(async () => { fixture = await createReviewedMaterialFixture(); });
  afterAll(async () => { await fixture?.close(); });

  it.each(vectors)("$name through public persistence and body read", async vector => {
    const { server, layout } = fixture;
    const draft = await createTask09Draft(server);
    const currentResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(currentResponse.status).toBe(200);
    const current = await currentResponse.json() as {
      version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }>
    };
    const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
      idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "bills"],
      draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
        contractName: "上游新建当前合同名称",
        contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_exclusive", invoiceStatus: "pending" }
      }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
      taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: vector.rate, source: "contract_document" } },
      parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
      bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
        rows: index ? [] : [{ clientRowKey: "net-price-row", sortOrder: 0, itemName: "净单价材料", unit: "吨", quantity: vector.quantity, unitPrice: vector.netUnit, taxRatePercent: vector.rate, customData: {} }] })),
      paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }) });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(factResponse.status).toBe(200);
    const facts = await factResponse.json();
    expect(facts.version).toMatchObject({ amountYuan: vector.net, draftData: { contractBasics: { amountBasis: "tax_exclusive" } } });
    expect(facts.bills[0]).toMatchObject({ pricingMode: "tax_exclusive", taxInclusiveAmountYuan: vector.gross, taxExclusiveAmountYuan: vector.net, taxAmountYuan: vector.tax });
    const row = facts.bills[0].rows[0];
    const normalized = (value: string) => value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
    expect(normalized(row.unitPrice)).toBe(normalized(vector.netUnit));
    expect(normalized(row.quantity)).toBe(normalized(vector.quantity));
    expect(normalized(row.taxRatePercent)).toBe(normalized(vector.rate));
    console.info("净单价公开保存事实", JSON.stringify({ name: vector.name, netUnit: row.unitPrice, quantity: row.quantity, rate: row.taxRatePercent,
      net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan, gross: facts.bills[0].taxInclusiveAmountYuan }));
    const response = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
    expect(response.status).toBe(200);
    const body = await response.json() as Body & { flow: ContractBodyFlow[] };
    const table = body.flow.find((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table")!;
    expect(table.rows).toHaveLength(2);
    const cell = (index: number) => table.rows[1].cells[index].paragraphIds.map(id => body.blocks.find(block => block.id === id)?.text ?? "").join("");
    console.info("实际含税单价", cell(5));
    expect(cell(5)).toBe(vector.grossUnit);
    expect(cell(4)).toBe(vector.quantity);
    expect(cell(6)).toBe(`${vector.rate}%`);
    expect(cell(7)).toBe(vector.gross);
    expect(body.blocks.find(block => block.text.startsWith("1.本合同暂定总价"))?.text).toContain("本合同暂定总价（不含税）");
    expect(body.sourceSha256).toBe(layout.sha256);
  });
});
