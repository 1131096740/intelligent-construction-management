import { loginTemplateActor } from "./template-selection.test-support";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import type { ContractDocumentInputSnapshot } from "../contract-document/contract-document.service";
import type { ContractBodyFlow } from "../contract-document/contract-body-document";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

// Explicit independent worked vector: gross 11*i, net 10*i, tax i for 10%.
// Sum i=1..45=1035, so literal totals are 11385 / 10350 / 1035.
const workedRows: ReadonlyArray<readonly [string, string, string]> = [
  ["11.0000", "10.0000", "1.0000"],
  ["22.0000", "20.0000", "2.0000"],
  ["33.0000", "30.0000", "3.0000"],
  ["44.0000", "40.0000", "4.0000"],
  ["55.0000", "50.0000", "5.0000"],
  ["66.0000", "60.0000", "6.0000"],
  ["77.0000", "70.0000", "7.0000"],
  ["88.0000", "80.0000", "8.0000"],
  ["99.0000", "90.0000", "9.0000"],
  ["110.0000", "100.0000", "10.0000"],
  ["121.0000", "110.0000", "11.0000"],
  ["132.0000", "120.0000", "12.0000"],
  ["143.0000", "130.0000", "13.0000"],
  ["154.0000", "140.0000", "14.0000"],
  ["165.0000", "150.0000", "15.0000"],
  ["176.0000", "160.0000", "16.0000"],
  ["187.0000", "170.0000", "17.0000"],
  ["198.0000", "180.0000", "18.0000"],
  ["209.0000", "190.0000", "19.0000"],
  ["220.0000", "200.0000", "20.0000"],
  ["231.0000", "210.0000", "21.0000"],
  ["242.0000", "220.0000", "22.0000"],
  ["253.0000", "230.0000", "23.0000"],
  ["264.0000", "240.0000", "24.0000"],
  ["275.0000", "250.0000", "25.0000"],
  ["286.0000", "260.0000", "26.0000"],
  ["297.0000", "270.0000", "27.0000"],
  ["308.0000", "280.0000", "28.0000"],
  ["319.0000", "290.0000", "29.0000"],
  ["330.0000", "300.0000", "30.0000"],
  ["341.0000", "310.0000", "31.0000"],
  ["352.0000", "320.0000", "32.0000"],
  ["363.0000", "330.0000", "33.0000"],
  ["374.0000", "340.0000", "34.0000"],
  ["385.0000", "350.0000", "35.0000"],
  ["396.0000", "360.0000", "36.0000"],
  ["407.0000", "370.0000", "37.0000"],
  ["418.0000", "380.0000", "38.0000"],
  ["429.0000", "390.0000", "39.0000"],
  ["440.0000", "400.0000", "40.0000"],
  ["451.0000", "410.0000", "41.0000"],
  ["462.0000", "420.0000", "42.0000"],
  ["473.0000", "430.0000", "43.0000"],
  ["484.0000", "440.0000", "44.0000"],
  ["495.0000", "450.0000", "45.0000"],
];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const runtimePath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/runtime-manifest.json";
const inspectionPath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/inspection-manifest.json";
const runtimeSha = "200e2a3be3008e0b9c9c2bca1579024fd1df93d3616613c7fd834c38dd49080a";
const inspectionSha = "c1e9ea341612950b257cc894c5a67fe4c8b9a4b8bdc98962a2cb9d2193edcade";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";

describe("task10 formal mechanical forty-five-hour-row current-revision actual draft export", () => {
  it("exports the saved mechanical 10-percent hours bill and ordinary hand edit through one current-revision private Word/PDF pair", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("长表实际双格式检查需要显式锁定物理检查环境");
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("机械首纵片需要准确任务10 API目录");
    expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
    expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
    expect(sha(await readFile(runtimePath))).toBe(runtimeSha);
    expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(lockSha);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-mechanical-45-export-"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
    const beforeScratch = await readdir(runtime.scratchDirectory);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/equipment-rental-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89");
      const asRunSourcePaths = ["services/api/src/contract-template/task10-formal-mechanical-45-row-export.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/task09-draft-template.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/template-pdf-physical.test-support.ts", "services/api/test-support/inspect-contract-pdf-physical.py"];
      await writeFile(join(directory, "as-run-source-pins.json"), JSON.stringify(await Promise.all(asRunSourcePaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      const layout = await confirmedBodyLayout(server, source, "equipmentRentals", "equipment_rental");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "equipment_rental", layout.id)).status).toBe(200);
      const beforeResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json() as Body;
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("甲方因工程施工需要租赁乙方的机械设备"))!;
      expect(ordinary).toBeDefined();
      const manualText = `${ordinary.text}双方人工补充机械租赁约定应当保留。`;
      const currentResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json() as {
        version: { draftRevision: number; draftData: Record<string, unknown> }; bills: Array<{ billKey: string; revision: number }>
      };
      expect(current.bills.map(bill => bill.billKey)).toEqual(["main"]);
      const response = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData,
          contractBasics: { businessType: "equipment_rental", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" },
          documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: manualText }] }
        }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "10", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: index ? [] : workedRows.map(([gross], i) => ({ clientRowKey: "mechanical-" + String(i + 1).padStart(3, "0"), sortOrder: i, itemName: "长表机械" + String(i + 1).padStart(3, "0"), specification: "M-" + String(i + 1).padStart(3, "0"), unit: "小时", quantity: "1", unitPrice: gross, taxRatePercent: "10", customData: {} })) })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
      const factResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(factResponse.status).toBe(200);
      const facts = await factResponse.json() as { version: { amountYuan: string | null; draftData: Record<string, unknown>; documentContentRevision: number; documentContentFingerprint: string; draftRevision: number }; bills: Array<Record<string, unknown>> };
      expect(facts.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(facts.version.documentContentRevision).toBeGreaterThan(0);
      expect(facts.bills).toHaveLength(1);
      expect(facts.version).toMatchObject({ amountYuan: "11385.0000", draftData: {
        contractBasics: { amountBasis: "tax_inclusive" }
      } });
      expect(facts.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxExclusiveAmountYuan: "10350.0000", taxInclusiveAmountYuan: "11385.0000", taxAmountYuan: "1035.0000" });
      const savedRows = facts.bills[0].rows as Array<Record<string, unknown>>;
      expect(savedRows).toHaveLength(45);
      for (const [index, row] of savedRows.entries()) {
        expect(row).toMatchObject({ numericProtocolVersion: 2, numericSource: "decimal_input", itemName: "长表机械" + String(index + 1).padStart(3, "0"), specification: "M-" + String(index + 1).padStart(3, "0"), unit: "小时",
          quantity: "1", taxRatePercent: "10", taxInclusiveAmountYuan: workedRows[index][0], taxExclusiveAmountYuan: workedRows[index][1], taxAmountYuan: workedRows[index][2] });
      }
      console.info("净税公开保存事实", JSON.stringify({ versionAmountYuan: facts.version.amountYuan, contractBasics: facts.version.draftData.contractBasics,
        bill: { pricingMode: facts.bills[0].pricingMode, gross: facts.bills[0].taxInclusiveAmountYuan, net: facts.bills[0].taxExclusiveAmountYuan, tax: facts.bills[0].taxAmountYuan } }));
      const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(reread.status).toBe(200);
      const after = await reread.json() as Body & { flow: ContractBodyFlow[]; draftRevision: number };
      expect(after.draftRevision).toBe(facts.version.draftRevision);
      expect(after.documentContentRevision).toBe(facts.version.documentContentRevision);
      // document-body publishes R but has no F field; bind F through the real workbench,
      // queue response and listed frozen job without inventing a public field.
      const stableResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(stableResponse.status).toBe(200);
      const stable = await stableResponse.json();
      expect(stable.version).toMatchObject({ draftRevision: after.draftRevision, documentContentRevision: after.documentContentRevision, documentContentFingerprint: facts.version.documentContentFingerprint });
      const totalLiteral = "合同金额大写：人民币壹万壹仟叁佰捌拾伍元整";
      expect(after.blocks.map(block => block.text)).toContain(totalLiteral);
      const renderedTables = after.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table");
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(after, null, 2));
      expect(renderedTables.map(table => [table.rows.length, table.columns.length])).toEqual([[46, 8], [1, 2]]);
      const table = renderedTables[0];
      const cellText = (row: number, col: number) => table.rows[row].cells[col].paragraphIds.map(id => after.blocks.find(block => block.id === id)?.text ?? "").join("");
      for (let i = 0; i < 45; i++) {
        const suffix = String(i + 1).padStart(3, "0");
        expect(table.rows[i + 1].cells.map((_, col) => cellText(i + 1, col))).toEqual([
          "长表机械" + suffix, "M-" + suffix, "1", "小时", workedRows[i][0].replace(/\.0000$/u, ""), "10%", workedRows[i][0], ""
        ]);
        expect(after.blocks.filter(block => block.text.trim() === "长表机械" + suffix)).toHaveLength(1);
      }
      expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe(manualText);
      expect(after.sourceSha256).toBe(layout.sha256);
      upload.mockClear();
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers,
        body: JSON.stringify({ sourceRevision: after.draftRevision }) });
      const queueText = await queued.text();
      console.info("净税公开生成入口", JSON.stringify({ status: queued.status, sourceRevision: after.draftRevision, result: JSON.parse(queueText) }));
      expect(queued.status === 201 ? "OK" : queueText).toBe("OK");
      const generation = JSON.parse(queueText) as { generationId: string; status: string; documentContentRevision: number; documentContentFingerprint: string };
      expect(generation.documentContentRevision).toBe(facts.version.documentContentRevision);
      expect(generation.documentContentFingerprint).toBe(facts.version.documentContentFingerprint);
      expect(generation).toMatchObject({ generationId: expect.any(String), status: "queued" });
      const list = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(list.status).toBe(200);
      const documents = await list.json() as Array<{ id: string; status: string; inputSnapshot: ContractDocumentInputSnapshot }>;
      const document = documents.find(item => item.id === generation.generationId)!;
      expect(document).toMatchObject({ status: "queued", purpose: "draft", layoutTemplateVersionId: layout.id,
        documentContentRevision: facts.version.documentContentRevision, documentContentFingerprint: facts.version.documentContentFingerprint, inputSnapshot: {
        bodyDocument: { sourceSha256: layout.sha256, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", runtimeLockSha256: lockSha, pdfEngine: "docx4j-17.3.5" },
        renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.amountBasis": "tax_inclusive",
          "contract.taxExclusiveAmount": "10350.0000", "contract.taxInclusiveAmount": "11385.0000", "contract.taxAmount": "1035.0000" } }
      } });
      // A deadline records failure only after the real operation has settled.
      const workerStarted = performance.now();
      let workerOverBudget = false;
      const workerTimer = setTimeout(() => { workerOverBudget = true; }, 130_000);
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { clearTimeout(workerTimer); await writeFile(join(directory, "worker-budget.json"), JSON.stringify({ elapsedMs: performance.now() - workerStarted, budgetMs: 130_000, ownedOperationSettled: true })); }
      expect(workerOverBudget).toBe(false);
      expect(performance.now() - workerStarted).toBeLessThanOrEqual(130_000);
      const outputResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(outputResponse.status).toBe(200);
      const output = (await outputResponse.json()).find((item: { id: string }) => item.id === generation.generationId);
      expect(output).toMatchObject({ layoutTemplateVersionId: layout.id, documentContentRevision: facts.version.documentContentRevision, documentContentFingerprint: facts.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: facts.version.documentContentRevision, documentContentFingerprint: facts.version.documentContentFingerprint,
          bodyDocument: { tableLayoutVersion: "body-bill-loop-v2", sourceSha256: layout.sha256, runtimeLockSha256: lockSha },
          inspection: { runtime: { engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 } } } });
      const scratchJobs = (await readdir(runtime.scratchDirectory)).filter(name => !beforeScratch.includes(name));
      expect(scratchJobs).toHaveLength(1);
      const scratch = join(runtime.scratchDirectory, scratchJobs[0]);
      const completed = JSON.parse(await readFile(join(scratch, "completed.json"), "utf8"));
      expect(completed).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      expect((await stat(join(scratch, "output.pdf"))).size).toBeLessThanOrEqual(100_000_000);
      expect(sha(await readFile(join(scratch, "output.pdf")))).toBe(completed.pdfSha256);
      await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(completed, null, 2));
      expect(output).toMatchObject({ status: "success", purpose: "draft", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
      for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const capability = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket-capability`, { headers: draft.headers });
        expect(capability.status).toBe(200);
        expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
        const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "正式机械四十五行草稿双格式与原表格分页规则核验" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json() as { downloadUrl: string };
        const download = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers });
        expect(download.status).toBe(200);
        files[format] = Buffer.from(await download.arrayBuffer());
        await writeFile(join(directory, `actual.${format}`), files[format]!);
      }
      expect(sha(files.docx!)).toBe(output.inputSnapshot.inspection.runtime.exportedDocxSha256);
      expect(sha(files.pdf!)).toBe(output.inputSnapshot.inspection.runtime.exportedPdfSha256);
      expect(files.pdf!.subarray(0, 5).toString()).toBe("%PDF-");
      expect(files.pdf!.length).toBeLessThanOrEqual(100_000_000);
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
      expect(paragraphs).toContain("上游新建当前合同名称");
      expect(paragraphs).toContain(totalLiteral);
      expect(paragraphs).toContain("甲方：当前单甲方");
      expect(paragraphs).toContain("乙方：当前单乙方");
      const compactParagraphs = paragraphs.map(text => text.replace(/\s/gu, ""));
      expect(compactParagraphs).toContain("甲方（承租方）：当前单甲方");
      expect(compactParagraphs).toContain("乙方（出租方）：当前单乙方");
      expect(paragraphs).toContain(manualText);
      expect(paragraphs).toContain("单位名称（章）：当前单甲方");
      expect(paragraphs).toContain("单位名称（章）：当前单乙方");
      const tables = Array.from(word.getElementsByTagNameNS(ns, "tbl"));
      expect(tables.map(table => table.getElementsByTagNameNS(ns, "tblGrid")[0].getElementsByTagNameNS(ns, "gridCol").length)).toEqual([8, 2]);
      const mechanicalRows = Array.from(tables[0].getElementsByTagNameNS(ns, "tr"));
      expect(mechanicalRows).toHaveLength(46);
      for (const row of mechanicalRows) expect(row.getElementsByTagNameNS(ns, "cantSplit").length).toBe(1);
      expect(tables[0].getElementsByTagNameNS(ns, "tblHeader").length).toBe(0); // Source has no repeating-header declaration.
      expect(tables[1].getElementsByTagNameNS(ns, "tr").length).toBe(1);
      expect(tables[1].getElementsByTagNameNS(ns, "cantSplit").length).toBe(1);
      const sectionSizes = Array.from(word.getElementsByTagNameNS(ns, "pgSz"));
      expect(sectionSizes).toHaveLength(2);
      for (const size of sectionSizes) expect([size.getAttributeNS(ns, "w"), size.getAttributeNS(ns, "h")]).toEqual(["11906", "16838"]);
      const grid = (table: ReturnType<typeof word.getElementsByTagNameNS>[number]) => Array.from(table.getElementsByTagNameNS(ns, "tblGrid")[0].getElementsByTagNameNS(ns, "gridCol")).map(col => Number(col.getAttributeNS(ns, "w")));
      expect(grid(tables[0])).toEqual([1361, 935, 680, 680, 1276, 510, 1191, 1871]);
      expect(grid(tables[1])).toEqual([4252, 4252]);
      for (let index = 1; index <= 45; index++) expect(paragraphs.filter(text => text === "长表机械" + String(index).padStart(3, "0"))).toHaveLength(1);
      const wordCellText = (cell: ReturnType<typeof word.getElementsByTagNameNS>[number]) => Array.from(cell.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("");
      for (let i = 0; i < 45; i++) expect(Array.from(mechanicalRows[i + 1].getElementsByTagNameNS(ns, "tc")).map(wordCellText)).toEqual([
        "长表机械" + String(i + 1).padStart(3, "0"), "M-" + String(i + 1).padStart(3, "0"), "1", "小时", workedRows[i][0].replace(/\.0000$/u, ""), "10%", workedRows[i][0], ""
      ]);
      const signatureCells = Array.from(tables[1].getElementsByTagNameNS(ns, "tc"));
      for (const [i, party] of ["当前单甲方", "当前单乙方"].entries()) {
        const text = wordCellText(signatureCells[i]).replace(/\s/gu, "");
        for (const label of ["单位名称（章）：" + party, "单位地址：", "法定代表人:", "委托代理人：", "经办人："]) expect(text).toContain(label);
      }
      const sourceDocument = new DOMParser().parseFromString(originalZip.file("word/document.xml")!.asText(), "application/xml");
      const sourceTitles = Array.from(sourceDocument.getElementsByTagNameNS(ns, "p")).map(p => Array.from(p.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("")).filter(text => /^第[一二三四五六七八九十]+条/u.test(text));
      expect(sourceTitles.length).toBeGreaterThan(0);
      for (const title of sourceTitles) expect(paragraphs).toContain(title);
      inspectActualTemplatePdf(files.docx!, files.pdf!, "task10-formal-mechanical-45-hour-row-draft", output.inputSnapshot?.inspection?.runtime);
      const script = `import pymupdf,sys,json

def text(span):
    return ''.join(chr(c[0]) for c in span['chars'])

d = pymupdf.open(sys.argv[1])
pages = []
for p in d:
    spans = p.get_texttrace()
    projected, pairs = [], []
    i = 0
    while i < len(spans):
        a = spans[i]
        b = spans[i + 1] if i + 1 < len(spans) else None
        # Official get_texttrace2Tr representation: one fill+stroke drawing.
        # No text-only/bbox tolerance/global dedup/visibility filtering.
        same_draw = (b is not None and a['type'] == 0 and b['type'] == 1
            and b['seqno'] == a['seqno'] + 1 and a['opacity'] > 0 and b['opacity'] > 0
            and a.keys() == b.keys()
            and all(a[key] == b[key] for key in a if key not in ('type', 'seqno')))
        projected.append(text(a))
        if same_draw:
            pairs.append({'sourceIndices': [i, i + 1], 'fill': a, 'stroke': b})
            i += 2
        else:
            i += 1
    pages.append({'page': p.number + 1, 'width': p.rect.width, 'height': p.rect.height,
        'drawnText': ''.join(projected), 'rawDrawnText': ''.join(text(s) for s in spans),
        'rawSpans': spans, 'fillStrokePairs': pairs})
out = {'pageCount': len(d), 'pages': pages}
with open(sys.argv[2], 'x') as stream:
    json.dump(out, stream, ensure_ascii=False, indent=2)
# Full raw evidence stays in the owned artifact; bounded stdout contains only
# the text used by the original public-pair assertions, never a changed expected.
print(json.dumps({'pageCount': len(d), 'pages': [{'drawnText': p['drawnText']} for p in pages]}, ensure_ascii=False))`;
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawnText = actual.pages.map(page => page.drawnText).join("").replace(/\s/gu, "");
      for (const literal of ["上游新建当前合同名称", ...sourceTitles, "甲方（承租方）：当前单甲方", "乙方（出租方）：当前单乙方", totalLiteral, manualText, "单位名称（章）：当前单甲方", "单位名称（章）：当前单乙方", "草稿"]) expect(drawnText).toContain(literal.replace(/\s/gu, ""));
      for (let index = 1; index <= 45; index++) expect(drawnText.split("长表机械" + String(index).padStart(3, "0"))).toHaveLength(2);
      expect(upload.mock.calls).toHaveLength(2);
      expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [index, format] of [[0, "docx"], [1, "pdf"]] as const) expect(createHash("sha256").update(upload.mock.calls[index][0].buffer).digest("hex")).toBe(createHash("sha256").update(files[format]!).digest("hex"));
      expect(createHash("sha256").update(await readFile(resolve(__dirname, "../../assets/templates/equipment-rental-real-v1.docx"))).digest("hex")).toBe(layout.sha256);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "RUNTIME_AND_LITERAL_GATES_GREEN",
        pageCount: actual.pageCount, remaining: ["independent source-to-drawing full font/size matcher", "signature-region geometry", "formal non-draft signing prerequisites", "actual row-to-page geometry", "formal template family", "six source-empty paragraphs referencing missing style 2 (source retained)", "native Word pagination"] }, null, 2));
      console.info(`正式机械四十五行草稿实际双格式证据：${directory}`);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error(`正式机械四十五行草稿实际检查失败，证据 ${directory}`, { cause });
    } finally {
      upload.mockRestore();
      const cleanupStarted = performance.now();
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally {
        try { await server.app.close(); appClosed = true; }
        finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - cleanupStarted }, null, 2)); }
      }
    }
  }, 400_000);
});

describe("A07 original ten-column mechanical real source",()=>{
  it("preserves the manual clause while syncing forty-five rows and exports the exact original mechanical source",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"jg-task10-A07-original-mechanical-"));
    const server=await createTemplateTestServer({draftWorkbench:true});
    try{
      const source=await readFile(resolve(__dirname,"../../../../scripts/probes/task08-documents/samples/equipment-rental-real-v1.docx"));expect(sha(source)).toBe("9139d5eb2905cb659e90c00f053c8b17c40d265bca5c660da5d2d8e1028d4c32");
      const layout=await confirmedBodyLayout(server,source,"equipmentRentals","equipment_rental","A07原十列机械技术样张",[["contract.taxExclusiveAmount",["不含税总额"]]]);
      const draft=await createTask09Draft(server,"capped","equipment_rental");expect(draft.contract).toMatchObject({contractTypeKey:"equipment_rental"});expect((await saveTask09Draft(server,draft,"equipment_rental",layout.id)).status).toBe(200);
      const get=async(path:string)=>{const r=await fetch(draft.base+path,{headers:draft.headers});expect(r.status).toBe(200);return r.json();};
      const before=await get("/document-body");const ordinary=before.blocks.find((x:{editable:boolean;text:string})=>x.editable&&x.text.startsWith("甲方因工程施工需要租赁乙方的机械设备"));expect(ordinary).toBeDefined();
      const manualText=ordinary.text+"原十列机械人工补充条款保留。";
      const save=async(final:boolean)=>{
        const wb=await get("/workbench");
        const response=await fetch(draft.base,{method:"PUT",headers:{...draft.headers,"x-contract-draft-lease":draft.leaseToken},body:JSON.stringify({idempotencyKey:randomUUID(),saveKind:"manual",expectedRevision:wb.version.draftRevision,changedSections:["draft","parties","bills"],
          draft:{numericProtocolVersion:2,draftData:{...wb.version.draftData,contractBasics:{businessType:"equipment_rental",relationship:"upward",amountBasis:"tax_inclusive",invoiceStatus:"pending"},documentBody:final?wb.version.draftData.documentBody:{protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:layout.sha256,edits:[{positionId:ordinary.id,text:manualText}]}},clauses:[],pricingNature:"unit_price",amountSource:"bill_sum",layoutTemplateVersionId:layout.id,taxFacts:{invoiceType:null,taxMode:"single_rate",defaultTaxRatePercent:"10",source:"contract_document"}},
          parties:[{roleKey:"party_a",displayOrder:0,snapshot:{name:final?"原机械同步甲方":"原机械初始甲方"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"原机械乙方"}}],
          bills:wb.bills.map((bill:{billKey:string;revision:number})=>({billKey:bill.billKey,expectedRevision:bill.revision,numericProtocolVersion:2,rows:workedRows.map(([gross],i)=>({clientRowKey:"a07-mechanical-"+String(i+1).padStart(3,"0"),sortOrder:i,itemName:"原源机械"+String(i+1).padStart(3,"0"),specification:"M-"+String(i+1).padStart(3,"0"),unit:"小时",quantity:"1",unitPrice:final?gross:"11.0000",taxRatePercent:"10",customData:final&&i===42?{是否含燃油:"按约定",是否带操作人员:"是"}:final&&i===44?{}:{fuelIncluded:i===43||!final&&i===44?null:i%2!==0,operatorIncluded:i===43||!final&&i===44?null:i%2===0}}))})),paymentTerms:null,attachments:[],negotiationDocuments:{referencedGeneratedDocumentIds:[]}})});expect(response.status===200?"OK":await response.text()).toBe("OK");return get("/workbench");
      };
      const initial=await save(false);expect(initial.version.amountYuan).toBe("495.0000");
      const unknownBody=await get("/document-body"),unknownTable=unknownBody.flow.find((x:{kind:string})=>x.kind==="table");
      for(const col of [4,5])expect(unknownTable.rows[47].cells[col].paragraphIds.map((id:string)=>unknownBody.blocks.find((x:{id:string})=>x.id===id)?.text??"").join("")).toBe("");
      const facts=await save(true),body=await get("/document-body");expect(facts.version.amountYuan).toBe("11385.0000");expect(facts.bills[0]).toMatchObject({billKey:"main",taxInclusiveAmountYuan:"11385.0000",taxExclusiveAmountYuan:"10350.0000",taxAmountYuan:"1035.0000"});expect(facts.bills[0].rows).toHaveLength(45);
      expect(facts.version.draftData.documentBody).toEqual(initial.version.draftData.documentBody);expect(body.blocks.find((x:{id:string})=>x.id===ordinary.id)).toMatchObject({text:manualText});
      const stable=await get("/workbench");expect(stable.version).toEqual(facts.version);
      const tables=body.flow.filter((x:{kind:string})=>x.kind==="table");
      await writeFile(join(directory,"public-body-and-facts.json"),JSON.stringify({sourceSha:layout.sha256,typeKey:"equipment_rental",declaredLoop:"equipmentRentals",facts,body},null,2));
      expect(tables.map((x:{rows:unknown[];columns:unknown[]})=>[x.rows.length,x.columns.length])).toEqual([[50,10],[1,2]]);
      const cell=(row:number,col:number)=>tables[0].rows[row].cells[col].paragraphIds.map((id:string)=>body.blocks.find((b:{id:string})=>b.id===id)?.text??"").join("");
      expect(body.blocks.map((x:{text:string})=>x.text).join("")).toContain("10350.0000");
      for(let i=0;i<45;i++){expect(cell(i+3,0)).toBe("原源机械"+String(i+1).padStart(3,"0"));expect(cell(i+3,4)).toBe(i>=43?"":i===42?"按约定":i%2?"是":"否");expect(cell(i+3,5)).toBe(i>=43?"":i===42?"是":i%2?"否":"是");expect(cell(i+3,6)).toBe(workedRows[i][1]);expect(cell(i+3,7)).toBe("10%");expect(cell(i+3,8)).toBe(workedRows[i][0].replace(/\.0000$/u,""));}
      const director = await loginTemplateActor(server, "director");
      const sourceResponse = await fetch((await server.app.getUrl()) + "/contract-layout-template-versions/" + layout.id + "/source-positions", { headers: { authorization: "Bearer " + director } });
      expect(sourceResponse.status).toBe(200);
      const publicSource = await sourceResponse.json();
      expect(publicSource.sourceSha256).toBe(layout.sha256);
      await writeFile(join(directory, "original-master.docx"), source);
      await writeFile(join(directory, "pre-PAGE-public-source-mapping.json"), JSON.stringify(publicSource, null, 2));
      Object.defineProperty(server,"store",{get(){throw new Error("原机械准备结束不得私读store");}});
      const queue=await fetch(draft.base+"/preview-generation",{method:"POST",headers:draft.headers,body:JSON.stringify({sourceRevision:facts.version.draftRevision})});expect(queue.status===201?"OK":await queue.text()).toBe("OK");const queued=await queue.json();expect(queued).toMatchObject({documentContentRevision:facts.version.documentContentRevision,documentContentFingerprint:facts.version.documentContentFingerprint});
      const pendingResponse = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers });
      expect(pendingResponse.status).toBe(200);
      const pending = (await pendingResponse.json()).find((job: { id: string }) => job.id === queued.generationId);
      expect(pending.status).toBe("queued");
      expect(pending.inputSnapshot.inspection).toBeUndefined();
      expect(pending.inputSnapshot.bodyDocument.pageNumberVersion).toBe("reviewed-original-mechanical-page-number-v1");
      expect(pending.inputSnapshot.renderInput.values["contract.pageNumberVersion"]).toBe("reviewed-original-mechanical-page-number-v1");
      await writeFile(join(directory, "PAGE-actual-public-pending.json"), JSON.stringify({ sourceSha: layout.sha256, pending, queued, owner: facts, publicSource, arrangement: "Actual new-PAGE public pending captured before worker" }, null, 2));
      const start=performance.now();expect(await server.processor.processNext()).toBe(true);expect(performance.now()-start).toBeLessThanOrEqual(130000);
      const list=await fetch((await server.app.getUrl())+"/contract-workbench/"+draft.version.id+"/documents",{headers:draft.headers});expect(list.status).toBe(200);const output=(await list.json()).find((x:{id:string})=>x.id===queued.generationId);await writeFile(join(directory,"public-output.json"),JSON.stringify(output,null,2));expect(output).toMatchObject({status:"success",documentContentRevision:facts.version.documentContentRevision,documentContentFingerprint:facts.version.documentContentFingerprint,inputSnapshot:{bodyDocument:{sourceSha256:layout.sha256,runtimeLockSha256:lockSha}}});expect(output.inputSnapshot.inspection.packageMetadataNormalization).toBeUndefined();
      const files:Partial<Record<"docx"|"pdf",Buffer>>={};for(const [format,id]of [["docx",output.docxFileId],["pdf",output.pdfFileId]]as const){const ticket=await fetch((await server.app.getUrl())+"/files/"+id+"/download-ticket",{method:"POST",headers:draft.headers,body:JSON.stringify({confirmationPassword:server.password,downloadReason:"核对原十列机械同修订双格式"})});expect(ticket.status===201?"OK":await ticket.text()).toBe("OK");const value=await ticket.json();const response=await fetch((await server.app.getUrl())+value.downloadUrl);expect(response.status).toBe(200);files[format]=Buffer.from(await response.arrayBuffer());await writeFile(join(directory,"actual."+format),files[format]!);}
      const word=new DOMParser().parseFromString(new PizZip(files.docx!).file("word/document.xml")!.asText(),"application/xml"),ns="http://schemas.openxmlformats.org/wordprocessingml/2006/main";const text=Array.from(word.getElementsByTagNameNS(ns,"t")).map(x=>x.textContent??"").join("");
      const pdfText=inspectActualTemplatePdf(files.docx!,files.pdf!,"A07-original-ten-column-mechanical-45",output.inputSnapshot.inspection.runtime);
      for(const literal of [manualText,"原机械同步甲方","原机械乙方","原源机械001","原源机械045","11385.0000","10350.0000","495","450.0000"]){expect(text).toContain(literal);expect(pdfText.replace(/\s/gu,"")).toContain(literal.replace(/\s/gu,""));}
      expect(text).not.toContain("原机械初始甲方");for(const suffix of ["001","045"]){expect(text.split("原源机械"+suffix)).toHaveLength(2);expect(pdfText.replace(/\s/gu,"").split("原源机械"+suffix)).toHaveLength(2);}
      const actualTables=Array.from(word.getElementsByTagNameNS(ns,"tbl"));expect(actualTables.map(t=>t.getElementsByTagNameNS(ns,"tblGrid")[0].getElementsByTagNameNS(ns,"gridCol").length)).toEqual([10,2]);expect(actualTables[0].getElementsByTagNameNS(ns,"tr").length).toBe(50);
      for (const [column, expected] of [[4, "按约定"], [5, "是"]] as const) {
        const cell = actualTables[0].getElementsByTagNameNS(ns, "tr")[45].getElementsByTagNameNS(ns, "tc")[column];
        expect(Array.from(cell.getElementsByTagNameNS(ns, "t")).map(node => node.textContent ?? "").join("")).toBe(expected);
      }
      for (const rowIndex of [46, 47]) for (const column of [4, 5]) {
        const cell = actualTables[0].getElementsByTagNameNS(ns, "tr")[rowIndex].getElementsByTagNameNS(ns, "tc")[column];
        expect(Array.from(cell.getElementsByTagNameNS(ns, "t")).map(node => node.textContent ?? "").join("")).toBe("");
      }
      const pageFooter = new DOMParser().parseFromString(new PizZip(files.docx!).file("word/footer1.xml")!.asText(), "application/xml");
      expect(pageFooter.getElementsByTagNameNS(ns, "txbxContent").length).toBe(0);
      expect(pageFooter.getElementsByTagNameNS(ns, "instrText").length).toBe(1);
      expect(pageFooter.getElementsByTagNameNS(ns, "instrText").item(0)!.textContent).toBe(" PAGE  \u005c* MERGEFORMAT ");
      expect(pageFooter.getElementsByTagNameNS(ns, "ind").item(0)!.getAttributeNS(ns, "left")).toBe("3493");
      const paginationScript = `import pymupdf,sys,json
pdf=pymupdf.open(sys.argv[1]); pages=[]; rows=[]
for page in pdf:
 chars=[(chr(c[0]),c[3]) for span in page.get_texttrace() for c in span['chars'] if not chr(c[0]).isspace()]
 pages.append((page,''.join(c[0] for c in chars),chars))
for i in range(1,46):
 token=f'原源机械{i:03}'; hits=[]
 for page,text,chars in pages:
  start=text.find(token)
  if start<0: continue
  assert text.count(token)==1
  boxes=[c[1] for c in chars[start:start+len(token)]]
  box=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
  assert 0<=box[0]<box[2]<=page.rect.width and 0<=box[1]<box[3]<=page.rect.height
  band=''.join(c[0] for c in chars if c[1][1]<box[3] and c[1][3]>box[1])
  if i>=44: assert not any(x in band for x in ['是','否','待'])
  if i==43: assert '按约定' in band and '是' in band
  hits.append({'page':page.number+1,'box':box,'visibleBandText':band})
 assert len(hits)==1
 rows.append({'token':token,**hits[0]})
for a,b in zip(rows,rows[1:]):
 assert a['page']<b['page'] or a['page']==b['page'] and a['box'][3]<b['box'][1]
receipt={'pageCount':len(pdf),'rows':rows,'scope':'45_ROW_LABEL_BOUNDS_AND_ORDER_ONLY','pageTextboxNumberVisibility':'UNPROVEN'}
with open(sys.argv[2],'x') as f: json.dump(receipt,f,ensure_ascii=False,indent=2)
print(json.dumps({'pageCount':len(pdf),'rowCount':len(rows)}))`;
      const pagination=JSON.parse((await promisify(execFile)(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON!,["-c",paginationScript,join(directory,"actual.pdf"),join(directory,"row-pagination.json")],{timeout:30000,maxBuffer:1024*1024})).stdout);
      expect(pagination).toEqual({pageCount:output.inputSnapshot.inspection.pageCount,rowCount:45});
      const pageVisibilityScript = `import pymupdf,sys,json
pdf=pymupdf.open(sys.argv[1]); observations=[]
for page in pdf:
 bottom=page.rect.height-72
 visible=[]
 for span in page.get_texttrace():
  if span['type'] not in (0,1) or span['opacity']<=0: continue
  for char in span['chars']:
   text=chr(char[0]); box=char[3]
   if box[1]>=bottom and not text.isspace(): visible.append({'text':text,'origin':char[2],'box':box,'font':span['font'],'size':span['size'],'glyph':char[1]})
 text=''.join(x['text'] for x in visible)
 clip=pymupdf.Rect(0,bottom,page.rect.width,page.rect.height)
 pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2),clip=clip,alpha=False)
 samples=pix.samples
 ink=sum(1 for i in range(0,len(samples),pix.n) if min(samples[i:i+3])<250)
 observations.append({'page':page.number+1,'expected':str(page.number+1),'visibleText':text,'glyphs':visible,'footerInkPixels':ink,'passes':text==str(page.number+1) and ink>0})
receipt={'scope':'Actual PAGE footer-band visibility only; not a glyph-program or original Word bbox equivalence claim','pageCount':len(pdf),'observations':observations,'missingPages':[x['page'] for x in observations if not x['passes']]}
with open(sys.argv[2],'x') as f: json.dump(receipt,f,ensure_ascii=False,indent=2)
print(json.dumps({'pageCount':len(pdf),'missingPages':receipt['missingPages']}))`;
      const pageObservation = JSON.parse((await promisify(execFile)(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON!, ["-c", pageVisibilityScript, join(directory, "actual.pdf"), join(directory, "PAGE-actual-visibility.json")], { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout);
      await writeFile(join(directory, "PAGE-worker-success-before-physical-assert.json"), JSON.stringify({ output, pendingKey: pending.idempotencyKey, docxSha: sha(files.docx!), pdfSha: sha(files.pdf!), pageObservation, scope: "Worker success is distinct from the following native visibility assertion" }, null, 2));
      expect(pageObservation.missingPages).toEqual([]);
      await writeFile(join(directory,"verified-receipt.json"),JSON.stringify({sourceSha:layout.sha256,queued,output,docxSha:sha(files.docx!),pdfSha:sha(files.pdf!),verdict:"ONE_ORIGINAL_SOURCE_ONLY",notNative06Asset:true},null,2));console.info("A07原十列机械证据："+directory);
    }catch(cause){await writeFile(join(directory,"failure.txt"),String(cause instanceof Error?cause.stack:cause));throw new Error("A07原机械失败，证据 "+directory,{cause});}finally{await server.processor.onApplicationShutdown();await server.app.close();}
  },190000);
});

describe("A07 PAGE independent actual pre-product pending oracle", () => {
  it("queues the captured literal legacy key then upgrades the same business owner without rewriting its old success", async () => {
    const referenceDirectory = process.env.TASK10_PAGE_LEGACY_REFERENCE_DIRECTORY;
    if (!referenceDirectory) throw new Error("PAGE历史原件必须显式指定，不从新SAVE伪造历史");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-A07-PAGE-legacy-upgrade-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const originalPendingBytes = await readFile(join(referenceDirectory, "pre-PAGE-actual-public-pending.json"));
      expect(sha(originalPendingBytes)).toBe("3c04a9bda0bf505e418018f0dd2e3adac2c4d2a92b2de1c690eec53d466250a6");
      const reference = JSON.parse(originalPendingBytes.toString("utf8"));
      const owner = reference.owner, snapshot = reference.pending.inputSnapshot;
      const legacyKey = "bef12297ce2e2274dabd2843a7d4c570e647d076358882c6101dcdcb310e5952";
      expect(reference.pending).toMatchObject({ status: "queued", idempotencyKey: legacyKey });
      expect(snapshot.inspection).toBeUndefined();
      expect(Object.hasOwn(snapshot.bodyDocument, "pageNumberVersion")).toBe(false);
      const source = await readFile(join(referenceDirectory, "original-master.docx"));
      expect(sha(source)).toBe("9139d5eb2905cb659e90c00f053c8b17c40d265bca5c660da5d2d8e1028d4c32");
      const layout = await confirmedBodyLayout(server, source, "equipmentRentals", "equipment_rental", "A07原十列机械技术样张", [["contract.taxExclusiveAmount", ["不含税总额"]]]);
      const preparedLayout = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } });
      expect(preparedLayout).not.toBeNull();
      const oldMapping = snapshot.layoutSourceMapping;
      // Explicit synthetic restoration of the captured owner and file relations,
      // not a new SAVE with its server-owned metadata subsequently stripped.
      await server.store.prisma.fileObject.update({ where: { id: preparedLayout!.docxFileId }, data: { id: snapshot.templateFileId } });
      const sourceMapping = { ...oldMapping, confirmation: { sourceFileId: oldMapping.sourceFileId, sourceSha256: oldMapping.sourceSha256,
        draftRevision: oldMapping.draftRevision, mappingFingerprint: oldMapping.fingerprint, previewJobId: "synthetic-confirmation-job", previewPdfFileId: "synthetic-confirmed-preview" } };
      await server.store.prisma.contractLayoutTemplateVersion.update({ where: { id: layout.id }, data: {
        id: owner.version.layoutTemplateVersionId, docxFileId: snapshot.templateFileId,
        placeholderSchema: { bills: [{ key: "equipmentRentals" }], sourceMapping }
      } });
      const shell = await createTask09Draft(server, "capped", "equipment_rental");
      const restored = (record: Record<string, unknown>, omitted: readonly string[] = []) => Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.includes(key)).map(([key, value]) => [key,
        value !== null && typeof value === "string" && key.endsWith("Cents") ? BigInt(value) :
        value !== null && typeof value === "string" && ["createdAt", "updatedAt", "effectiveAt", "firstSubmittedAt", "voidedAt"].includes(key) ? new Date(value) : value]));
      await server.store.prisma.project.update({ where: { id: shell.projectId }, data: { id: owner.contract.projectId } });
      await server.store.prisma.contract.update({ where: { id: shell.contract.id }, data: restored(owner.contract) });
      // Original synthetic increment of an absent taxFactRevision exposed null.
      // Restore finite0 instead: this one explicit non-rendering metadata
      // difference is not a PostgreSQL restoration or an F/key calibration.
      expect(owner.version.taxFactRevision).toBeNull();
      await server.store.prisma.contractVersion.update({ where: { id: shell.version.id }, data: {
        ...restored(owner.version, ["taxFacts", "layoutTemplateSelection", "draftLifecycleKind"]), taxFactRevision: 0
      } });
      await server.store.prisma.contractPartySnapshot.deleteMany({ where: { contractVersionId: shell.version.id } });
      await server.store.prisma.contractBill.deleteMany({ where: { contractVersionId: shell.version.id } });
      for (const party of owner.parties) await server.store.prisma.contractPartySnapshot.create({ data: { status: undefined, draftRevision: undefined, ...restored(party) } });
      for (const bill of owner.bills) {
        await server.store.prisma.contractBill.create({ data: { status: undefined, draftRevision: undefined, ...restored(bill, ["rows"]) } });
        for (const row of bill.rows) await server.store.prisma.contractBillRow.create({ data: restored(row, ["taxRatePercent"]) });
      }
      const baseUrl = await server.app.getUrl(), headers = shell.headers;
      const base = baseUrl + "/contract-drafts/" + owner.version.id;
      const get = async (path: string) => { const response = await fetch(path, { headers }); expect(response.status === 200 ? "OK" : await response.text()).toBe("OK"); return response.json(); };
      const wb = () => get(base + "/workbench");
      const documents = () => get(baseUrl + "/contract-workbench/" + owner.version.id + "/documents");
      const before = await wb();
      for (const key of ["id", "draftRevision", "documentContentRevision", "documentContentFingerprint", "draftData", "templateSnapshot", "amountYuan", "amountCents", "layoutTemplateVersionId"]) expect(before.version[key]).toEqual(owner.version[key]);
      expect(before.version.taxFactRevision).toBe(0);
      expect(before.version.taxFacts).toEqual({ ...owner.version.taxFacts, revision: 0 });
      for (const key of ["parties", "bills"]) {
        // The importer stores the captured original creation times; update time
        // is the new synthetic restoration operation, never the original lifecycle.
        const withoutUpdated = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutUpdated) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== "updatedAt").map(([name, item]) => [name, withoutUpdated(item)])) : value;
        expect(withoutUpdated(before[key])).toEqual(withoutUpdated(owner[key]));
      }
      expect(before.version.draftData.documentRenderProfile).toBeUndefined();
      expect(await wb()).toEqual(before);
      const director = await loginTemplateActor(server, "director");
      const sourceResponse = await fetch(baseUrl + "/contract-layout-template-versions/" + owner.version.layoutTemplateVersionId + "/source-positions", { headers: { authorization: "Bearer " + director } });
      expect(sourceResponse.status).toBe(200); const publicMapping = await sourceResponse.json();
      expect(publicMapping).toMatchObject({ sourceFileId: oldMapping.sourceFileId, sourceSha256: oldMapping.sourceSha256, mappingFingerprint: oldMapping.fingerprint, bindings: oldMapping.bindings });
      Object.defineProperty(server, "store", { get() { throw new Error("PAGE历史准备已封，消费阶段不得私读store"); } });
      const queue = async (revision: number) => {
        const response = await fetch(base + "/preview-generation", { method: "POST", headers, body: JSON.stringify({ sourceRevision: revision }) });
        expect(response.status === 201 ? "OK" : await response.text()).toBe("OK");
        const queued = await response.json(); return (await documents()).find((job: { id: string }) => job.id === queued.generationId);
      };
      const legacyPending = await queue(before.version.draftRevision);
      expect(legacyPending.idempotencyKey).toBe(legacyKey); // Independent pre-product literal, not a private key helper or re-derived tuple.
      expect(legacyPending.inputSnapshot.bodyDocument).toEqual(snapshot.bodyDocument);
      expect(legacyPending.inputSnapshot.layoutSourceMapping).toEqual(snapshot.layoutSourceMapping);
      const oldValues = legacyPending.inputSnapshot.renderInput.values, capturedValues = snapshot.renderInput.values;
      expect(Object.keys(oldValues).sort()).toEqual(Object.keys(capturedValues).sort());
      for (const key of Object.keys(capturedValues)) if (key !== "document.generatedAt") expect(oldValues[key]).toEqual(capturedValues[key]);
      expect(Object.hasOwn(oldValues, "contract.pageNumberVersion")).toBe(false);
      await writeFile(join(directory, "historical-public-pending.json"), JSON.stringify({ referenceKey: legacyKey, before, publicMapping, legacyPending,
        arrangement: "Synthetic restoration of actual captured pre-product pending owner; new job id/clock and finite taxFactRevision0 instead of old mock publicnull; no preinserted generated job and no current SAVE before legacy queue" }, null, 2));
      const consume = async (pending: { id: string }) => {
        const started = performance.now(); expect(await server.processor.processNext()).toBe(true); expect(performance.now() - started).toBeLessThanOrEqual(130000);
        const output = (await documents()).find((job: { id: string }) => job.id === pending.id); expect(output.status).toBe("success"); return output;
      };
      const download = async (output: { docxFileId: string; pdfFileId: string }, prefix: string) => {
        const pair: Partial<Record<"docx" | "pdf", Buffer>> = {};
        for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
          const ticket = await fetch(baseUrl + "/files/" + id + "/download-ticket", { method: "POST", headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对同owner机械PAGE新旧生成守恒" }) });
          expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
          const value = await ticket.json(), response = await fetch(baseUrl + value.downloadUrl); expect(response.status).toBe(200);
          pair[format] = Buffer.from(await response.arrayBuffer()); await writeFile(join(directory, prefix + "." + format), pair[format]!);
        }
        return { docx: pair.docx!, pdf: pair.pdf! };
      };
      const legacyOutput = await consume(legacyPending), legacyPair = await download(legacyOutput, "legacy");
      expect(new PizZip(legacyPair.docx).file("word/footer1.xml")!.asNodeBuffer()).toEqual(new PizZip(source).file("word/footer1.xml")!.asNodeBuffer());
      inspectActualTemplatePdf(legacyPair.docx, legacyPair.pdf, "A07-PAGE-real-legacy-pending", legacyOutput.inputSnapshot.inspection.runtime);
      const savedState = await wb();
      const leaseResponse = await fetch(base + "/edit-lease", { method: "POST", headers }); expect(leaseResponse.status).toBe(201); const lease = await leaseResponse.json();
      const saved = await fetch(base, { method: "PUT", headers: { ...headers, "x-contract-draft-lease": lease.token }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: savedState.version.draftRevision, changedSections: ["draft"],
        draft: { numericProtocolVersion: 2, draftData: savedState.version.draftData, clauses: savedState.version.clauseSnapshot, pricingNature: savedState.version.pricingNature,
          amountSource: savedState.version.amountSource, layoutTemplateVersionId: savedState.version.layoutTemplateVersionId,
          taxFacts: { invoiceType: savedState.version.taxFacts.invoiceType, taxMode: savedState.version.taxFacts.taxMode, defaultTaxRatePercent: savedState.version.taxFacts.defaultTaxRatePercent, source: savedState.version.taxFacts.source } },
        parties: savedState.parties.map((party: { roleKey: string; displayOrder: number; snapshot: unknown }) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder, snapshot: party.snapshot })),
        bills: savedState.bills.map((bill: { billKey: string; revision: number; rows: Array<Record<string, unknown>> }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: bill.rows.map(row => ({ clientRowKey: row.rowKey, rowKey: row.rowKey, sortOrder: row.sortOrder, ...(row.itemCode === null ? {} : { itemCode: row.itemCode }), itemName: row.itemName,
            specification: row.specification, unit: row.unit, quantity: row.quantity, unitPrice: row.unitPrice, taxRatePercent: row.taxRatePercent, customData: row.customData })) })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const upgraded = await wb(); expect(upgraded.version.draftData.documentRenderProfile).toEqual({ pageNumberVersion: "reviewed-original-mechanical-page-number-v1" });
      expect(upgraded.version.draftData.documentBody).toEqual(before.version.draftData.documentBody);
      expect(upgraded.version.documentContentRevision).toBeGreaterThan(before.version.documentContentRevision);
      expect(upgraded.version.documentContentFingerprint).not.toBe(before.version.documentContentFingerprint);
      expect(await wb()).toEqual(upgraded);
      const currentPending = await queue(upgraded.version.draftRevision); expect(currentPending.idempotencyKey).not.toBe(legacyKey);
      expect(currentPending.inputSnapshot.bodyDocument.pageNumberVersion).toBe("reviewed-original-mechanical-page-number-v1");
      expect(currentPending.inputSnapshot.renderInput.values["contract.pageNumberVersion"]).toBe("reviewed-original-mechanical-page-number-v1");
      expect(currentPending.idempotencyKey).toBe(sha(Buffer.from(JSON.stringify([owner.version.id,
        upgraded.version.documentContentRevision, upgraded.version.documentContentFingerprint, owner.version.layoutTemplateVersionId, "draft", [],
        "contract-body-docx4j-v1", "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab", "contract-money-v1", "body-bill-loop-v2",
        "reviewed-original-mechanical-page-number-v1"]))));
      const oldAfterSave = (await documents()).find((job: { id: string }) => job.id === legacyOutput.id);
      expect(oldAfterSave.status).toBe("stale");
      for (const key of ["idempotencyKey", "inputSnapshot", "docxFileId", "pdfFileId", "completedAt"]) expect(oldAfterSave[key]).toEqual(legacyOutput[key]);
      const oldPairAfterSave = await download(oldAfterSave, "legacy-after-save"); expect(oldPairAfterSave).toEqual(legacyPair);
      const currentOutput = await consume(currentPending), currentPair = await download(currentOutput, "current");
      const oldZip = new PizZip(legacyPair.docx), newZip = new PizZip(currentPair.docx);
      expect(Object.keys(newZip.files).sort()).toEqual(Object.keys(oldZip.files).sort());
      for (const name of Object.keys(oldZip.files)) if (!oldZip.files[name].dir && name !== "word/footer1.xml") expect({ name, sha: sha(newZip.file(name)!.asNodeBuffer()) }).toEqual({ name, sha: sha(oldZip.file(name)!.asNodeBuffer()) });
      const oldAfter = (await documents()).find((job: { id: string }) => job.id === legacyOutput.id);
      for (const key of ["idempotencyKey", "inputSnapshot", "completedAt"]) expect(oldAfter[key]).toEqual(legacyOutput[key]);
      // Existing draft-preview replacement deliberately supersedes and unlinks
      // predecessor outputs. PAGE does not rewrite its frozen input or old key.
      expect(oldAfter).toMatchObject({ status: "superseded", docxFileId: null, pdfFileId: null });
      inspectActualTemplatePdf(currentPair.docx, currentPair.pdf, "A07-PAGE-same-owner-upgrade", currentOutput.inputSnapshot.inspection.runtime);
      await writeFile(join(directory, "public-onoff-result.json"), JSON.stringify({ before, upgraded, legacyPending, legacyOutput, currentPending, currentOutput, oldAfterSave, oldAfter,
        keyOracle: legacyKey, onlyChangedDocxMember: "word/footer1.xml", oldDownloadAuthorizedAfterSaveBeforeReplacement: true, orphanCleanup: "existing synthetic reference adapter refuses unmodeled orphan facts; cleanup logs retained, not certified", literalPreproductPendingSha: sha(originalPendingBytes) }, null, 2));
      console.info("A07 PAGE同owner历史升级证据：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause instanceof Error ? cause.stack : cause)); throw new Error("PAGE历史独立oracle失败，证据 " + directory, { cause }); }
    finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 190000);
});

describe("A07 PAGE server-owned public failure boundaries", () => {
  const pageVersion = "reviewed-original-mechanical-page-number-v1";
  async function fixture() {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../../../scripts/probes/task08-documents/samples/equipment-rental-real-v1.docx"));
      const layout = await confirmedBodyLayout(server, source, "equipmentRentals", "equipment_rental");
      const draft = await createTask09Draft(server, "capped", "equipment_rental");
      const save = await saveTask09Draft(server, draft, "equipment_rental", layout.id); expect(save.status === 200 ? "OK" : await save.text()).toBe("OK");
      const response = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(response.status).toBe(200); const wb = await response.json();
      expect(wb.version.draftData.documentRenderProfile).toEqual({ pageNumberVersion: pageVersion });
      return { server, layout, draft, wb };
    } catch (cause) { await server.processor.onApplicationShutdown(); await server.app.close(); throw cause; }
  }
  it.each(["unknown", "null", "mixed"] as const)("refuses persisted %s PAGE profiles even when the client omits metadata", async vector => {
    const { server, layout, draft, wb } = await fixture();
    try {
      const profile = vector === "unknown" ? { pageNumberVersion: "unsupported-page-version" } : vector === "null" ? { pageNumberVersion: null }
        : { pageNumberVersion: pageVersion, typographyVersion: "reviewed-mechanical-primary-secondary-roles-v1" };
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { draftData: { ...wb.version.draftData, documentRenderProfile: profile } } });
      const before = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      const body = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(body.status).toBe(400); expect(await body.text()).toContain("合同文书呈现版本无法核对");
      // Existing save helper deliberately omits the read-only profile. Unknown
      // persisted server metadata cannot silently fall back to legacy or a new grant.
      const saved = await saveTask09Draft(server, draft, "equipment_rental", layout.id); expect(saved.status).toBe(400); expect(await saved.text()).toContain("合同文书呈现版本无法核对");
      const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      for (const key of ["version", "draft", "parties", "bills", "paymentTerms", "attachments"]) expect(after[key]).toEqual(before[key]);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
  it("rejects a forged client profile by the existing round-trip rule and keeps an omitted profile server-owned", async () => {
    const { server, layout, draft, wb } = await fixture();
    try {
      const request = { idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: wb.version.draftRevision, changedSections: ["draft"],
        draft: { numericProtocolVersion: 2, draftData: { ...wb.version.draftData, documentRenderProfile: { pageNumberVersion: "unsupported-page-version" } }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" } },
        parties: wb.parties.map((party: { roleKey: string; displayOrder: number; snapshot: unknown }) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder, snapshot: party.snapshot })),
        bills: wb.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: [] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(request) });
      expect(saved.status).toBe(400); expect(await saved.text()).toContain("合同文书呈现资料由系统维护");
      const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json()); expect(after.version).toEqual(wb.version);
      const omitted = await saveTask09Draft(server, draft, "equipment_rental", layout.id); expect(omitted.status).toBe(200);
      const restored = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      expect(restored.version.draftData.documentRenderProfile).toEqual({ pageNumberVersion: pageVersion });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
  it.each(["missingValue", "missingBody", "wrongValue", "wrongBody", "nullValue", "nullBody", "wrongSource", "wrongEngine", "wrongMoney", "typographyBody", "typographyValue", "dateBody", "dateValue", "taxValue"] as const)("refuses frozen %s PAGE metadata before any template read or generated upload", async vector => {
    const { server, draft, wb } = await fixture();
    try {
      const queue = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: wb.version.draftRevision }) }); expect(queue.status).toBe(201); const queued = await queue.json();
      const list = async () => { const response = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers }); expect(response.status).toBe(200); return response.json(); };
      const original = (await list()).find((job: { id: string }) => job.id === queued.generationId);
      expect(original.inputSnapshot.bodyDocument.pageNumberVersion).toBe(pageVersion); expect(original.inputSnapshot.renderInput.values["contract.pageNumberVersion"]).toBe(pageVersion);
      const corrupted = JSON.parse(JSON.stringify(original.inputSnapshot));
      const body = corrupted.bodyDocument, values = corrupted.renderInput.values;
      if (vector === "missingValue") delete values["contract.pageNumberVersion"];
      else if (vector === "missingBody") delete body.pageNumberVersion;
      else if (vector === "wrongValue") values["contract.pageNumberVersion"] = "unsupported-page-version";
      else if (vector === "wrongBody") body.pageNumberVersion = "unsupported-page-version";
      else if (vector === "nullValue") values["contract.pageNumberVersion"] = null;
      else if (vector === "nullBody") body.pageNumberVersion = null;
      else if (vector === "wrongSource") body.sourceSha256 = "0".repeat(64);
      else if (vector === "wrongEngine") delete body.pdfEngine;
      else if (vector === "wrongMoney") { body.renderSemanticVersion = "unsupported-money-version"; values["contract.renderSemanticVersion"] = "unsupported-money-version"; }
      else if (vector === "typographyBody") body.typographyVersion = "reviewed-mechanical-primary-secondary-roles-v1";
      else if (vector === "typographyValue") values["contract.typographyVersion"] = "reviewed-mechanical-primary-secondary-roles-v1";
      else if (vector === "dateBody") body.signatureDateVersion = "reviewed-material-signature-date-v1";
      else if (vector === "dateValue") values["contract.signatureDateVersion"] = "reviewed-material-signature-date-v1";
      else values["contract.reviewedLaborTaxBindingVersion"] = "reviewed-labor-tax-v1";
      // Corrupt persisted pending fixture consumed by the actual worker, not a
      // direct call of the renderer or private snapshot validator.
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: queued.generationId }, data: { inputSnapshot: corrupted } });
      const reads = jest.spyOn(server.files, "getFileBuffer"), uploads = jest.spyOn(server.files, "uploadPrivateFile");
      Object.defineProperty(server, "store", { get() { throw new Error("PAGE错轴准备已封，不得私读store"); } });
      try {
        expect(await server.processor.processNext()).toBe(true);
        const failed = (await list()).find((job: { id: string }) => job.id === queued.generationId);
        expect(failed).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null });
        expect(failed.errorMessage).toBe(vector === "wrongEngine" ? "合同文档输入快照格式不正确" : vector === "wrongMoney" ? "合同文书金额口径版本无法核对，请联系管理员处理" : "合同页码呈现版本无法核对，请联系管理员处理");
        expect(reads).toHaveBeenCalledTimes(0); expect(uploads).toHaveBeenCalledTimes(0);
        const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
        for (const key of ["version", "draft", "parties", "bills", "paymentTerms", "attachments"]) expect(after[key]).toEqual(wb[key]);
      } finally { reads.mockRestore(); uploads.mockRestore(); }
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
});
