import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { saveBody } from "./task10-body.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

const approvedTemplates = [
  ["材料采购", "material-purchase", "material_purchase", "materials", "adf70269f2a3310ee30d9e8399d794c034bb2838329a0d9dc98f3736314c8d9b", "297cfc6133191f666992457e45315f9a4d58da2b76053fb1cd9f30b1065a517a"],
  ["设备租赁", "equipment-rental", "equipment_rental", "equipmentRentals", "c90b31a23ee503f5b1af50832bb194eec9400695badecc680bf22803eda2dcac", "c97ea4a3cca3947547fd932336124154c63d534f05aca8945e9ce37edf5772b0"],
  ["劳务分包", "labor-subcontract", "labor_subcontract", "laborItems", "d63d6110773b9b6c9f9da35adfe1d8d706c5c2911c6fd53ac68c89d3c08a42d8", "e230da20259f560b243f6399cc6ff62fc49867f8ba37761dba88a9d91a683a69"]
] as const;

const sourceFields = [
  ["{合同名称}", "contract.name"],
  ["{草稿编号}", "contract.temporaryCode"],
  ["{甲方名称}", "party.owner.name"],
  ["{乙方名称}", "party.counterparty.name"],
  ["{文档水印}", "document.watermark"]
];

describe("A07 approved compact contract templates", () => {
  it.each(approvedTemplates)("inspects, renders and publishes the approved %s source in isolation", async (label, fileName, contractTypeKey, billKey, approvedSha, sourceSha) => {
    const assets = resolve(__dirname, "../../assets/source-contract-templates/a07");
    const approved = await readFile(resolve(assets, fileName + "-approved.docx"));
    expect(createHash("sha256").update(approved).digest("hex")).toBe(approvedSha);
    const bytes = await readFile(resolve(assets, fileName + "-a4-ready.docx"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sourceSha);
    const original = new PizZip(approved);
    const printSource = new PizZip(bytes);
    expect(Object.keys(printSource.files)).toEqual(Object.keys(original.files));
    for (const part of Object.values(original.files).filter(entry => !entry.dir)) {
      const printPart = printSource.file(part.name)!;
      if (part.name === "word/document.xml") {
        expect(printPart.asText()).toBe(part.asText().replace("<w:sectPr/>",
          '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'));
      } else if (part.name === "word/_rels/document.xml.rels") {
        expect(printPart.asText()).toBe(part.asText().replace('<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>', ""));
      } else if (part.name === "[Content_Types].xml") {
        const addedTypes = ['<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>', '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'];
        const existingTypes = part.asText();
        expect(printPart.asText()).toBe(existingTypes.replace("</Types>", addedTypes
          .filter(entry => !existingTypes.includes(entry)).reverse().join("") + "</Types>"));
      } else {
        expect(printPart.asNodeBuffer().equals(part.asNodeBuffer())).toBe(true);
      }
    }
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const token = await loginTemplateActor(server, "director");
      const base = await server.app.getUrl();
      const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
      const request = async (path: string, method: string, expected: number, body?: unknown) => {
        const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        expect(response.status === expected ? "OK" : [response.status, await response.text()]).toBe("OK");
        return response.json();
      };
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)]), label + "合同简版.docx");
      const uploaded = await fetch(base + "/files", { method: "POST", headers: { authorization: headers.authorization }, body: form });
      expect(uploaded.status).toBe(201);
      const file = await uploaded.json();
      const created = await request("/contract-layout-templates", "POST", 201, {
        name: label + "合同简版", contractTypeKey, docxFileId: file.id, placeholderSchema: { bills: [{ key: billKey }] }
      });
      const path = "/contract-layout-template-versions/" + created.version.id;
      const positions = await request(path + "/source-positions", "GET", 200) as {
        sourceSha256: string; positions: Array<{ positionId: string; text: string }>;
      };
      expect(positions.sourceSha256).toBe(sourceSha);
      const bindings = positions.positions.flatMap(position => sourceFields.flatMap(([literal, fieldKey]) => {
        const start = position.text.indexOf(literal);
        return start < 0 ? [] : [{ positionId: position.positionId, start, end: start + literal.length, fieldKey }];
      }));
      expect(new Set(bindings.map(binding => binding.fieldKey))).toEqual(new Set(sourceFields.map(([, fieldKey]) => fieldKey)));
      const mapping = await request(path + "/source-mapping", "PATCH", 200, {
        expectedRevision: 1, sourceFileId: file.id, sourceSha256: sourceSha, bindings
      });
      const inspection = await request(path + "/inspection", "POST", 201);
      expect(inspection.blockingErrors).toEqual([]);
      await request(path + "/preview-generation", "POST", 201, {
        contract: { name: label + "样张合同", temporaryCode: "A07-SAMPLE" },
        party: { owner: { name: "样张甲方公司" }, counterparty: { name: "样张乙方公司" } },
        document: { watermark: "样张" },
        bill: { [billKey]: [{ rowNumber: "1", itemName: "验收清单样项", unit: "项", quantity: "1", unitPrice: "100.00", amount: "100.00" }] }
      });
      expect(await server.processor.processNext()).toBe(true);
      const preview = await request(path + "/preview-generation", "GET", 200);
      expect(preview.status === "succeeded" ? "OK" : preview.errorMessage).toBe("OK");
      expect(preview.previewPdfFileId).toEqual(expect.any(String));
      const pdf = await server.files.getFileBuffer(preview.previewPdfFileId);
      const text = inspectActualTemplatePdf(bytes, pdf.buffer, "A07 " + label);
      expect(text).toContain("样张甲方公司");
      expect(text).toContain("样张乙方公司");
      await request(path + "/source-mapping-confirmation", "POST", 201, {
        expectedRevision: mapping.draftRevision, sourceFileId: file.id,
        sourceSha256: sourceSha, mappingFingerprint: mapping.mappingFingerprint
      });
      await request(path + "/submission", "POST", 201);
      const published = await request(path + "/publication", "POST", 201, { changeSummary: "隔离验收核对合同部通过的简版母版" });
      expect(published).toMatchObject({ id: created.version.id, status: "published", docxFileId: file.id });
      const retained = await server.files.getFileBuffer(file.id);
      expect(retained.buffer.equals(bytes)).toBe(true);
      const draft = await createTask09Draft(server, "capped", contractTypeKey);
      const selected = await saveTask09Draft(server, draft, contractTypeKey, published.id);
      expect(selected.status === 200 ? "OK" : await selected.text()).toBe("OK");
      const saved = await saveBody(draft, undefined, "正文样张甲方", [{
        clientRowKey: "A07-SAMPLE-ITEM", sortOrder: 0, itemName: "双格式清单项目",
        unit: "项", quantity: "1", unitPrice: "100", taxRatePercent: "0", customData: {}
      }]);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const workbench = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      const generationResponse = await fetch(draft.base + "/preview-generation", {
        method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: workbench.version.draftRevision })
      });
      expect(generationResponse.status === 201 ? "OK" : await generationResponse.text()).toBe("OK");
      const generation = await generationResponse.json();
      expect(await server.processor.processNext()).toBe(true);
      const listed = await fetch(base + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers });
      expect(listed.status).toBe(200);
      const outputs = await listed.json() as Array<{ id: string; status: string; docxFileId: string; pdfFileId: string; errorMessage?: string; documentContentFingerprint: string; inputSnapshot?: { inspection?: { runtime?: unknown } } }>;
      const output = outputs.find(document => document.id === generation.generationId)!;
      expect(output.status === "success" ? "OK" : output.errorMessage).toBe("OK");
      expect(output.documentContentFingerprint).toBe(generation.documentContentFingerprint);
      const generated: Buffer[] = [];
      for (const fileId of [output.docxFileId, output.pdfFileId]) {
        const ticket = await fetch(base + "/files/" + fileId + "/download-ticket", {
          method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对三份通过的简版同修订双格式" })
        });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json();
        const response = await fetch(base + downloadUrl);
        expect(response.status).toBe(200);
        generated.push(Buffer.from(await response.arrayBuffer()));
      }
      const [word, contractPdf] = generated;
      const wordXml = new PizZip(word).file("word/document.xml")!.asText();
      expect(wordXml).toContain("正文样张甲方");
      expect(wordXml).toContain("当前单乙方");
      expect(wordXml).toContain("双格式清单项目");
      const previewInspector = process.env.TEMPLATE_PDF_RUNTIME_MANIFEST;
      const previewFonts = process.env.FONTCONFIG_FILE;
      const contractInspector = process.env.A07_CONTRACT_PDF_INSPECTION_MANIFEST;
      if (!previewInspector || !previewFonts || !contractInspector) throw new Error("简版模板双格式验收须明确提供版式预览和正文导出的字体检查配置");
      delete process.env.FONTCONFIG_FILE;
      process.env.TEMPLATE_PDF_RUNTIME_MANIFEST = contractInspector;
      let pdfText: string;
      try {
        pdfText = inspectActualTemplatePdf(word, contractPdf, "A07 正文双格式 " + label, output.inputSnapshot?.inspection?.runtime);
      } finally {
        process.env.TEMPLATE_PDF_RUNTIME_MANIFEST = previewInspector;
        process.env.FONTCONFIG_FILE = previewFonts;
      }
      expect(pdfText).toContain("正文样张甲方");
      expect(pdfText).toContain("当前单乙方");
      expect(pdfText).toContain("双格式清单项目");

    } finally {
      try { await server.processor.onApplicationShutdown(); }
      finally { await server.app.close(); }
    }
  }, 30_000);
});
