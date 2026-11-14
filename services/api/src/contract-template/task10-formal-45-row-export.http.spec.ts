import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 adopted eight-column forty-five-row actual draft export", () => {
  it("exports all forty-five saved rows without dropping the last material or changing the source table policy", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("长表实际双格式检查需要显式锁定物理检查环境");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-formal-45-row-export-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
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
      upload.mockClear();
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
        bodyDocument: { sourceSha256: layout.sha256, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", pdfEngine: "docx4j-17.3.5" },
        renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.amountBasis": "tax_inclusive",
          "contract.taxExclusiveAmount": "1035.0000", "contract.taxInclusiveAmount": "1035.0000", "contract.taxAmount": "0.0000" } }
      } });
      expect(await server.processor.processNext()).toBe(true);
      const outputResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(outputResponse.status).toBe(200);
      const output = (await outputResponse.json()).find((item: { id: string }) => item.id === generation.generationId);
      expect(output).toMatchObject({ status: "success", purpose: "draft", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
      for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "正式八列四十五行草稿双格式与原表格分页规则核验" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json() as { downloadUrl: string };
        const download = await fetch(`${await server.app.getUrl()}${downloadUrl}`);
        expect(download.status).toBe(200);
        files[format] = Buffer.from(await download.arrayBuffer());
        await writeFile(join(directory, `actual.${format}`), files[format]!);
      }
      const zip = new PizZip(files.docx!), originalZip = new PizZip(source);
      const members = Object.values(zip.files).filter(file => !file.dir).map(file => ({ name: file.name, sha256: createHash("sha256").update(file.asNodeBuffer()).digest("hex") })).sort((a, b) => a.name.localeCompare(b.name));
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ purpose: "draft", legalSigningAcceptance: false, sourceSha256: layout.sha256,
        generation, output, members, docxSha256: createHash("sha256").update(files.docx!).digest("hex"), pdfSha256: createHash("sha256").update(files.pdf!).digest("hex"), verdict: "PENDING" }, null, 2));
      // Only these source members contain bound fields. Watermark replacement
      // is intentional; styles/fontTable/themes/relationships remain byte-equal.
      const boundParts = new Set(["word/document.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const name of Object.keys(originalZip.files).filter(name => !boundParts.has(name) && !originalZip.files[name].dir)) {
        const originalPart = originalZip.file(name)!.asNodeBuffer(), actualPart = zip.file(name)!.asNodeBuffer();
        if (name === "[Content_Types].xml") {
          // Existing docxtemplater round-trips this metadata XML. Only its exact
          // CRLF-to-LF serialization change is allowed, never arbitrary XML edits.
          expect(actualPart).toEqual(Buffer.from(originalPart.toString("utf8").replace(/\r\n/g, "\n")));
          const before = new DOMParser().parseFromString(originalPart.toString("utf8"), "application/xml");
          const after = new DOMParser().parseFromString(actualPart.toString("utf8"), "application/xml");
          expect(new XMLSerializer().serializeToString(after)).toBe(new XMLSerializer().serializeToString(before));
          for (const part of [before, after]) for (const tag of ["t", "instrText"]) expect(part.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", tag).length).toBe(0);
        } else expect(actualPart).toEqual(originalPart);
      }
      expect(zip.file("word/header1.xml")!.asText()).toContain("草稿");
      const xml = zip.file("word/document.xml")!.asText();
      // Actual Word paragraphs may split into runs; compare their visible text,
      // leaving original style and non-document ZIP members untouched.
      const word = new DOMParser().parseFromString(xml, "application/xml");
      const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")).map(p => Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join(""));
      const totalLiteral = "1.本合同暂定总价（含税）：人民币壹仟零叁拾伍元整。适用税率：0%。";
      expect(paragraphs).toContain(totalLiteral);
      expect(paragraphs).toContain(manualText);
      expect(paragraphs).toContain("买方（章）：当前单甲方");
      expect(paragraphs).toContain("卖方（章）：当前单乙方");
      const tables = Array.from(word.getElementsByTagNameNS(ns, "tbl"));
      expect(tables.map(table => table.getElementsByTagNameNS(ns, "tblGrid")[0].getElementsByTagNameNS(ns, "gridCol").length)).toEqual([8, 2]);
      const materialRows = Array.from(tables[0].getElementsByTagNameNS(ns, "tr"));
      expect(materialRows).toHaveLength(46);
      for (const row of materialRows) expect(row.getElementsByTagNameNS(ns, "cantSplit").length).toBe(1);
      expect(tables[0].getElementsByTagNameNS(ns, "tblHeader").length).toBe(0); // Source has no repeating-header declaration.
      expect(tables[1].getElementsByTagNameNS(ns, "tr").length).toBe(1);
      for (let index = 1; index <= 45; index++) expect(paragraphs).toContain("长表材料" + String(index).padStart(3, "0"));
      inspectActualTemplatePdf(files.docx!, files.pdf!, "task10-adopted-material-45-row-draft", output.inputSnapshot?.inspection?.runtime);
      const script = "import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); pages=[{'page':p.number+1,'width':p.rect.width,'height':p.rect.height,'drawnText':''.join(chr(c[0]) for s in p.get_texttrace() for c in s['chars'])} for p in d]; out={'pageCount':len(d),'pages':pages}; open(sys.argv[2],'x').write(json.dumps(out,ensure_ascii=False,indent=2)); print(json.dumps(out,ensure_ascii=False))";
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawnText = actual.pages.map(page => page.drawnText).join("").replace(/\s/gu, "");
      for (const literal of [totalLiteral, manualText, "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "草稿"]) expect(drawnText).toContain(literal.replace(/\s/gu, ""));
      for (let index = 1; index <= 45; index++) expect(drawnText).toContain("长表材料" + String(index).padStart(3, "0"));
      expect(upload.mock.calls).toHaveLength(2);
      expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [index, format] of [[0, "docx"], [1, "pdf"]] as const) expect(createHash("sha256").update(upload.mock.calls[index][0].buffer).digest("hex")).toBe(createHash("sha256").update(files[format]!).digest("hex"));
      expect(createHash("sha256").update(await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"))).digest("hex")).toBe(layout.sha256);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "RUNTIME_AND_LITERAL_GATES_GREEN",
        pageCount: actual.pageCount, remaining: ["independent source-to-drawing full font/size matcher", "signature-region geometry", "formal non-draft signing prerequisites", "actual row-to-page geometry", "formal template family"] }, null, 2));
      console.info(`正式八列四十五行草稿实际双格式证据：${directory}`);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error(`正式八列四十五行草稿实际检查失败，证据 ${directory}`, { cause });
    } finally { upload.mockRestore(); await server.app.close(); }
  }, 150_000);
});
