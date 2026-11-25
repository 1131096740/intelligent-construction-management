import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

const approvedTemplates = [
  ["材料采购", "material-purchase", "material_purchase", "materials", "adf70269f2a3310ee30d9e8399d794c034bb2838329a0d9dc98f3736314c8d9b", null],
  ["设备租赁", "equipment-rental", "equipment_rental", "equipmentRentals", "c90b31a23ee503f5b1af50832bb194eec9400695badecc680bf22803eda2dcac", "5c4b55cbce37aa4c3a0124a3df355f26535f0835e46b27dc6a9b1cc099e00802"],
  ["劳务分包", "labor-subcontract", "labor_subcontract", "laborItems", "d63d6110773b9b6c9f9da35adfe1d8d706c5c2911c6fd53ac68c89d3c08a42d8", "1e39c5af7f847b3f04cfad13d767b58afa1bf0954920f68ffa926f03ed399ad0"]
] as const;

const sourceFields = [
  ["{合同名称}", "contract.name"],
  ["{草稿编号}", "contract.temporaryCode"],
  ["{甲方名称}", "party.owner.name"],
  ["{乙方名称}", "party.counterparty.name"],
  ["{文档水印}", "document.watermark"]
];

describe("A07 approved compact contract templates", () => {
  it.each(approvedTemplates)("inspects, renders and publishes the approved %s source in isolation", async (label, fileName, contractTypeKey, billKey, approvedSha, a4Sha) => {
    const assets = resolve(__dirname, "../../assets/source-contract-templates/a07");
    const approved = await readFile(resolve(assets, fileName + "-approved.docx"));
    expect(createHash("sha256").update(approved).digest("hex")).toBe(approvedSha);
    const bytes = a4Sha ? await readFile(resolve(assets, fileName + "-a4.docx")) : approved;
    const sourceSha = a4Sha ?? approvedSha;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sourceSha);
    if (a4Sha) {
      const original = new PizZip(approved);
      const printSource = new PizZip(bytes);
      expect(Object.keys(printSource.files)).toEqual(Object.keys(original.files));
      for (const part of Object.values(original.files).filter(entry => !entry.dir)) {
        const printPart = printSource.file(part.name)!;
        if (part.name === "word/document.xml") {
          expect(printPart.asText()).toBe(part.asText().replace("<w:sectPr/>",
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'));
        } else {
          expect(printPart.asNodeBuffer().equals(part.asNodeBuffer())).toBe(true);
        }
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
    } finally {
      try { await server.processor.onApplicationShutdown(); }
      finally { await server.app.close(); }
    }
  }, 30_000);
});
