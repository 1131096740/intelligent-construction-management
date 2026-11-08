import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import PizZip from "pizzip";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 custom neutral amount fields through public draft body HTTP", () => {
  it("labels both amount bases in an owned custom source without overwriting ordinary edits", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const original = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(original).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      // Separate owned custom input, not adoption or mutation of the formal file.
      // Only its total paragraph changes; other ZIP members/styles/tables remain.
      const zip = new PizZip(original);
      const word = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "application/xml");
      const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const paragraph = Array.from(word.getElementsByTagNameNS(namespace, "p")).find(node =>
        Array.from(node.getElementsByTagNameNS(namespace, "t")).map(text => text.textContent ?? "").join("") === "1.本合同暂定总价（含税）：{合同金额大写}。适用税率：{税率}%。");
      expect(paragraph).toBeDefined();
      const texts = Array.from(paragraph!.getElementsByTagNameNS(namespace, "t"));
      texts[0].textContent = "1.双方约定金额：{合同金额}元（大写：{合同金额大写}）。税务另行确认。";
      for (const text of texts.slice(1)) text.textContent = "";
      zip.file("word/document.xml", new XMLSerializer().serializeToString(word), { date: new Date("2026-11-05T00:00:00Z") });
      const source = zip.generate({ type: "nodebuffer" });
      const originalZip = new PizZip(original), customZip = new PizZip(source);
      for (const name of Object.keys(originalZip.files).filter(name => name !== "word/document.xml" && !originalZip.files[name].dir)) {
        expect(customZip.file(name)!.asNodeBuffer()).toEqual(originalZip.file(name)!.asNodeBuffer());
      }
      expect(createHash("sha256").update(source).digest("hex")).not.toBe(createHash("sha256").update(original).digest("hex"));
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
      const total = after.blocks.find(block => block.text.startsWith("1.双方约定金额"))!;
      console.info("未知custom实际正文金额句", JSON.stringify({ sourceSha256: layout.sha256, text: total.text }));
      expect(total.text).toMatch(/[：；（]含税金额：待确定/u);
      expect(total.text).toMatch(/[：；（]不含税金额：1\.5340/u);
      expect(total.text).toMatch(/[：；（]含税大写：待确定/u);
      expect(total.text).toMatch(/[：；（]不含税大写：人民币壹元伍角叁分肆厘/u);
      expect(total.text).not.toContain("双方约定金额：1.5340元");
      expect(total.editable).toBe(false);
      const table = after.flow.find((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table")!;
      expect(table.rows).toHaveLength(2);
      const cellText = (index: number) => table.rows[1].cells[index].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
      expect(cellText(4)).toBe("1");
      expect(cellText(5)).toBe("待确定"); // Source heading is explicitly 含税单价; raw net price cannot fill it.
      expect(cellText(6)).toBe("待补充");
      expect(cellText(7)).toBe("待确定");
      expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe(manualText);
      expect(after.sourceSha256).toBe(layout.sha256);
      expect(createHash("sha256").update(await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"))).digest("hex"))
        .toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
    } finally { await server.app.close(); }
  });
});
