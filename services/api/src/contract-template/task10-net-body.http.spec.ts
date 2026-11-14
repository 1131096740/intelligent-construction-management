import { randomUUID } from "node:crypto";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createReviewedMaterialFixture, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 net-basis document facts through public aggregate and body HTTP", () => {
  let fixture: Awaited<ReturnType<typeof createReviewedMaterialFixture>>;
  let draft: Awaited<ReturnType<typeof createTask09Draft>>;
  beforeAll(async () => {
    fixture = await createReviewedMaterialFixture();
    const { server, layout } = fixture;
    draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
  }, 10_000);
  afterAll(async () => { await fixture?.close(); });

  it("labels the reviewed eight-column source net total honestly and retains an ordinary manual clause with unknown tax", async () => {
    const { layout } = fixture;
    const beforeResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json() as Body;
    const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"))!;
    expect(ordinary).toBeDefined();
    const manualText = `${ordinary.text}双方人工补充约定应当保留。`;
    const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as {
      version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }>
    };
    const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
      idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "bills"],
      draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
        contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_exclusive", invoiceStatus: "pending" },
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manualText }] }
      }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
      taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
      parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
      bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
        rows: index ? [] : [{ clientRowKey: "net-row", sortOrder: 0, itemName: "净口径材料", unit: "吨", quantity: "1", unitPrice: "1.5340", customData: {} }] })),
      paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }) });
    expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
    const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(factResponse.status).toBe(200);
    const facts = await factResponse.json() as { version: { amountYuan: string | null; draftData: Record<string, unknown> }; bills: Array<Record<string, unknown>> };
    expect(facts.version).toMatchObject({ amountYuan: "1.5340", draftData: {
      contractBasics: { amountBasis: "tax_exclusive" }
    } });
    expect(facts.bills[0]).toMatchObject({ pricingMode: "tax_exclusive", taxExclusiveAmountYuan: "1.5340", taxInclusiveAmountYuan: null, taxAmountYuan: null });
    console.info("净税公开保存事实", JSON.stringify({ versionAmountYuan: facts.version.amountYuan, contractBasics: facts.version.draftData.contractBasics,
      bill: { pricingMode: facts.bills[0].pricingMode, gross: facts.bills[0].taxInclusiveAmountYuan, net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan } }));
    const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
    expect(reread.status).toBe(200);
    const after = await reread.json() as Body & { flow: ContractBodyFlow[] };
    const total = after.blocks.find(block => block.text.startsWith("1.本合同暂定总价"))!;
    console.info("净税实际正文总价句", total.text);
    expect(total.text).toContain("本合同暂定总价（不含税）：人民币壹元伍角叁分肆厘");
    expect(total.text).toContain("适用税率：待补充");
    expect(total.text).not.toContain("（含税）：人民币壹元伍角叁分肆厘");
    const table = after.flow.find((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table")!;
    expect(table.rows).toHaveLength(2);
    const cellText = (index: number) => table.rows[1].cells[index].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
    expect(cellText(4)).toBe("1");
    expect(cellText(5)).toBe("待确定"); // Source heading is explicitly 含税单价; raw net price cannot fill it.
    expect(cellText(6)).toBe("待补充");
    expect(cellText(7)).toBe("待确定");
    expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe(manualText);
    expect(after.sourceSha256).toBe(layout.sha256);
  }, 10_000);
});
