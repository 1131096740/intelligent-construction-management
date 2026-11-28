import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 adopted forty-five-row complete body through public aggregate HTTP", () => {
  it("reads the forty-five saved rows as one material grid and preserves the ordinary edited clause", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-45-body-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
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
          contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
          documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manualText }] }
        }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: index ? [] : Array.from({ length: 45 }, (_, i) => ({ clientRowKey: "long-row-" + String(i + 1).padStart(3, "0"), sortOrder: i, itemName: "长表材料" + String(i + 1).padStart(3, "0"), unit: "项", quantity: "1", unitPrice: String(i + 1) + ".0000", taxRatePercent: "0", customData: {} })) })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
      const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(factResponse.status).toBe(200);
      const facts = await factResponse.json() as { version: { amountYuan: string | null; draftData: Record<string, unknown> }; bills: Array<Record<string, unknown>> };
      expect(facts.version).toMatchObject({ amountYuan: "1035.0000", draftData: {
        contractBasics: { amountBasis: "tax_inclusive" }
      } });
      expect(facts.bills[0]).toMatchObject({ pricingMode: "tax_inclusive", taxExclusiveAmountYuan: "1035.0000", taxInclusiveAmountYuan: "1035.0000", taxAmountYuan: "0.0000" });
      const savedRows = facts.bills[0].rows as Array<Record<string, unknown>>;
      expect(savedRows).toHaveLength(45);
      for (const [index, row] of savedRows.entries()) {
        expect(row).toMatchObject({ numericProtocolVersion: 2, numericSource: "decimal_input", itemName: "长表材料" + String(index + 1).padStart(3, "0"),
          quantity: "1", taxRatePercent: "0", taxInclusiveAmountYuan: String(index + 1) + ".0000", taxExclusiveAmountYuan: String(index + 1) + ".0000", taxAmountYuan: "0.0000" });
      }
      console.info("净税公开保存事实", JSON.stringify({ versionAmountYuan: facts.version.amountYuan, contractBasics: facts.version.draftData.contractBasics,
        bill: { pricingMode: facts.bills[0].pricingMode, gross: facts.bills[0].taxInclusiveAmountYuan, net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan } }));
      const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(reread.status).toBe(200);
      const after = await reread.json() as Body & { flow: ContractBodyFlow[]; draftRevision: number };
      const total = after.blocks.find(block => block.text.startsWith("1.本合同暂定总价"))!;
      console.info("净税实际正文总价句", total.text);
      expect(total.text).toContain("本合同暂定总价（含税）：人民币壹仟零叁拾伍元整");
      expect(total.text).toContain("适用税率：0%");
      expect(total.text).not.toContain("待确定");
      const table = after.flow.find((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table")!;
      const renderedTables = after.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table");
      const summary = { sourceSha256: after.sourceSha256, tableCount: renderedTables.length,
        tableRows: renderedTables.map(node => node.rows.length), tableColumns: renderedTables.map(node => node.columns.length),
        firstNamePresent: after.blocks.some(block => block.text.trim() === "\u957f\u8868\u6750\u6599001"),
        lastNamePresent: after.blocks.some(block => block.text.trim() === "\u957f\u8868\u6750\u6599045"),
        uniqueMaterialNames: [...new Set(after.blocks.map(block => block.text.trim()).filter(text => /^\u957f\u8868\u6750\u6599\d{3}$/u.test(text)))].length };
      console.info("Public45BodyStructure", JSON.stringify(summary));
      await writeFile(join(directory, "public-body-summary.json"), JSON.stringify(summary, null, 2));
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(after, null, 2));
      expect(table.rows).toHaveLength(46);
      const cellText = (index: number) => table.rows[1].cells[index].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
      expect(cellText(4)).toBe("1");
      expect(cellText(5)).toBe("1");
      expect(cellText(6)).toBe("0%");
      expect(cellText(7)).toBe("1.0000");
      expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe(manualText);
      expect(after.sourceSha256).toBe(layout.sha256);
      expect(renderedTables).toHaveLength(2);
      expect(renderedTables[1].columns).toHaveLength(2);
      expect(renderedTables[1].rows).toHaveLength(1);
      for (let index = 1; index <= 45; index++) {
        const name = table.rows[index].cells[1].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
        expect(name).toBe("长表材料" + String(index).padStart(3, "0"));
      }
    } finally { await server.app.close(); }
  }, 150_000);
});
