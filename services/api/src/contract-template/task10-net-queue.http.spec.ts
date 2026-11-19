import { randomUUID } from "node:crypto";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createReviewedMaterialFixture, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 net-basis preview admission through public aggregate and generation HTTP", () => {
  let fixture: Awaited<ReturnType<typeof createReviewedMaterialFixture>>;
  let draft: Awaited<ReturnType<typeof createTask09Draft>>;
  let edit: { positionId: string; text: string };
  let current: { version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }> };
  beforeAll(async () => {
    fixture = await createReviewedMaterialFixture();
    const { server, layout } = fixture;
    draft = await createTask09Draft(server);
    // A request still in flight when Jest times out must not keep the fixture alive after it finishes.
    Object.assign(draft.headers, { connection: "close" });
    const selected = await saveTask09Draft(server, draft, "material_purchase", layout.id);
    await selected.text();
    expect(selected.status).toBe(200);
    const beforeResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json() as Body;
    const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"))!;
    expect(ordinary).toBeDefined();
    edit = { positionId: ordinary.id, text: `${ordinary.text}双方人工补充约定应当保留。` };
    current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
  }, 10_000);
  afterAll(async () => { await fixture?.close(); });

  it("queues the saved reviewed eight-column net draft with unknown tax and freezes matching money semantics", async () => {
    const { server, layout } = fixture;
    const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
      idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "bills"],
      draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
        contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_exclusive", invoiceStatus: "pending" },
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [edit] }
      }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
      taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
      parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
      bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
        rows: index ? [] : [{ clientRowKey: "net-row", sortOrder: 0, itemName: "净口径材料", unit: "吨", quantity: "1", unitPrice: "1.5340", customData: {} }] })),
      paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    }) });
    const saveResult = await response.text();
    expect(response.status === 200 ? "OK" : saveResult).toBe("OK");
    const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(factResponse.status).toBe(200);
    const facts = await factResponse.json() as { version: { amountYuan: string | null; draftData: Record<string, unknown> }; bills: Array<Record<string, unknown>> };
    expect(facts.version).toMatchObject({ amountYuan: "1.5340", draftData: {
      contractBasics: { amountBasis: "tax_exclusive" }
    } });
    expect(facts.bills[0]).toMatchObject({ pricingMode: "tax_exclusive", taxExclusiveAmountYuan: "1.5340", taxInclusiveAmountYuan: null, taxAmountYuan: null });
    const row = (facts.bills[0].rows as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ numericProtocolVersion: 2, numericSource: "decimal_input", quantity: "1", taxRatePercent: null,
      taxExclusiveAmountYuan: "1.5340", taxInclusiveAmountYuan: null, taxAmountYuan: null });
    expect(row.unitPrice).toMatch(/^1\.5340*$/u);
    expect(row.taxExclusiveUnitPrice).toMatch(/^1\.5340*$/u);
    console.info("净税公开行权威", JSON.stringify({ netUnit: row.unitPrice, exclusiveUnit: row.taxExclusiveUnitPrice, rate: row.taxRatePercent,
      net: row.taxExclusiveAmountYuan, gross: row.taxInclusiveAmountYuan, tax: row.taxAmountYuan }));
    console.info("净税公开保存事实", JSON.stringify({ versionAmountYuan: facts.version.amountYuan, contractBasics: facts.version.draftData.contractBasics,
      bill: { pricingMode: facts.bills[0].pricingMode, gross: facts.bills[0].taxInclusiveAmountYuan, net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan } }));
    const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
    expect(reread.status).toBe(200);
    const after = await reread.json() as Body & { flow: ContractBodyFlow[]; draftRevision: number };
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
    expect(after.blocks.find(block => block.id === edit.positionId)?.text).toBe(edit.text);
    expect(after.sourceSha256).toBe(layout.sha256);
    const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers,
      body: JSON.stringify({ sourceRevision: after.draftRevision }) });
    const queueText = await queued.text();
    console.info("净税公开生成入口", JSON.stringify({ status: queued.status, sourceRevision: after.draftRevision, result: JSON.parse(queueText) }));
    expect(queued.status === 201 ? "OK" : queueText).toBe("OK");
    const generation = JSON.parse(queueText) as { generationId: string; status: string };
    expect(generation).toMatchObject({ generationId: expect.any(String), status: "queued" });
    const list = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
    expect(list.status).toBe(200);
    const documents = await list.json() as Array<{ id: string; status: string; inputSnapshot: Record<string, unknown> }>;
    const document = documents.find(item => item.id === generation.generationId)!;
    expect(document).toMatchObject({ status: "queued", inputSnapshot: {
      bodyDocument: { sourceSha256: layout.sha256, renderSemanticVersion: "contract-money-v1", pdfEngine: "docx4j-17.3.5" },
      renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1", "contract.amountBasis": "tax_exclusive",
        "contract.taxExclusiveAmount": "1.5340", "contract.taxInclusiveAmount": "待确定", "contract.taxAmount": "待确定" } }
    } });
  }, 10_000);
});
