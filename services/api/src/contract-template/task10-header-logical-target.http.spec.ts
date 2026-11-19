import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const message = "合同模板的表格边距设置暂不支持，请核对模板后再生成";

describe("task10 active logical-header internal-target refusal", () => {
  it("refuses the same active header logical table under canonical and equivalent dotsegment targets before uploads", async () => {
    const directory = process.env.TASK10_HEADER_TARGET_FIXTURES;
    const configured = process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    if (!directory || !configured || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("页眉负控需要明确自有样张及锁定运行时");
    const runtime = JSON.parse(await readFile(configured, "utf8")) as { scratchDirectory: string };
    const sources = await Promise.all(["canonical.docx", "dotsegment.docx"].map(name => readFile(join(directory, name))));
    expect(sources.map(hash)).toEqual(["9dff324175522e17e628986d5b67a1625c88ef412317a539228698809c552502", "8f710b8decb865251be4aa3b59e7a351f19c6b9032c156d6a887a2b852ff09d0"]);
    const packages = sources.map(bytes => new PizZip(bytes));
    const members = Object.keys(packages[0].files).filter(name => !packages[0].files[name].dir);
    expect(Object.keys(packages[1].files).filter(name => !packages[1].files[name].dir)).toEqual(members);
    expect(members.filter(name => !packages[0].file(name)!.asNodeBuffer().equals(packages[1].file(name)!.asNodeBuffer()))).toEqual(["word/_rels/document.xml.rels"]);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      for (const [index, target] of ["header1.xml", "nested/../header1.xml"].entries()) {
        const zip = packages[index];
        const main = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "application/xml");
        expect(Array.from(main.getElementsByTagNameNS(W, "headerReference")).filter(reference => reference.getAttributeNS(R, "id") === "rIdHeader1")).toHaveLength(2);
        const relationships = new DOMParser().parseFromString(zip.file("word/_rels/document.xml.rels")!.asText(), "application/xml");
        const active = Array.from(relationships.getElementsByTagNameNS(REL, "Relationship")).find(reference => reference.getAttribute("Id") === "rIdHeader1")!;
        expect(active.getAttribute("Type")).toBe(R + "/header");
        expect(active.getAttribute("Target")).toBe(target);
        expect(new URL(target, "https://package.invalid/word/document.xml").pathname).toBe("/word/header1.xml");
        expect(hash(zip.file("word/header1.xml")!.asNodeBuffer())).toBe("543acba94af064e7c05643389a48e0f0c7b721ab6e9110c2a3dddd831116d827");
        const header = new DOMParser().parseFromString(zip.file("word/header1.xml")!.asText(), "application/xml");
        expect(header.getElementsByTagNameNS(W, "tbl").length).toBe(1);
        for (const side of ["start", "end"]) {
          const margin = header.getElementsByTagNameNS(W, side)[0];
          expect(margin.getAttributeNS(W, "w")).toBe("80"); expect(margin.getAttributeNS(W, "type")).toBe("dxa");
        }
        const layout = await confirmedBodyLayout(server, sources[index], "materials");
        const draft = await createTask09Draft(server);
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        expect((await saveBody(draft, undefined, "当前单甲方", [{ clientRowKey: "header-row", sortOrder: 0, itemName: "页眉路径核对材料", unit: "项", quantity: "1", unitPrice: "3.0000", taxRatePercent: "0", customData: {} }])).status).toBe(200);
        const stateResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
        expect(stateResponse.status).toBe(200);
        const state = await stateResponse.json();
        expect(state.version).toMatchObject({ amountYuan: "3.0000", status: "draft", latestDraftPreviewDocumentId: null });
        const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: state.version.draftRevision }) });
        expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
        const generation = await queued.json();
        const documentsUrl = await server.app.getUrl() + "/contract-workbench/" + draft.version.id + "/documents";
        const before = (await fetch(documentsUrl, { headers: draft.headers }).then(response => response.json())).find((value: { id: string }) => value.id === generation.generationId);
        expect(before.inputSnapshot).toMatchObject({ attachmentFiles: [], bodyDocument: { sourceSha256: layout.sha256, tableLayoutVersion: "body-bill-loop-v2" }, renderInput: { values: { "contract.tableLayoutVersion": "body-bill-loop-v2" } } });
        const absent = join(directory, "missing-runtime-" + randomUUID() + ".json");
        expect(existsSync(absent)).toBe(false);
        const reads = jest.spyOn(server.files, "getFileBuffer");
        const uploads = jest.spyOn(server.files, "uploadPrivateFile");
        const beforeScratch = (await readdir(runtime.scratchDirectory)).sort();
        try {
          process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = absent;
          expect(await server.processor.processNext()).toBe(true);
          expect((await readdir(runtime.scratchDirectory)).sort()).toEqual(beforeScratch);
          const response = await fetch(documentsUrl, { headers: draft.headers }); expect(response.status).toBe(200);
          const output = (await response.json()).find((value: { id: string }) => value.id === generation.generationId);
          console.info("ActiveLogicalHeaderRefusal", JSON.stringify({ target, status: output.status, message: output.errorMessage, wordReads: reads.mock.calls.length, uploads: uploads.mock.calls.length }));
          expect(output).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null });
          expect(uploads).toHaveBeenCalledTimes(0);
          expect(reads.mock.calls.map(call => call[0])).toEqual([before.inputSnapshot.templateFileId]);
          expect(hash((await reads.mock.results[0].value).buffer)).toBe(layout.sha256);
          const afterResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(afterResponse.status).toBe(200);
          expect((await afterResponse.json()).version).toMatchObject({ draftRevision: state.version.draftRevision, amountYuan: "3.0000", status: "draft", latestDraftPreviewDocumentId: null });
          // A runtime-not-ready failure is the predicted escaping-path RED, NOT
          // a policy pass. Canonical control must prove the specific B1 refusal.
          expect(output.errorMessage).toBe(message);
        } finally { process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; reads.mockRestore(); uploads.mockRestore(); }
      }
    } finally { process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; await server.app.close(); }
  }, 150_000);
});
