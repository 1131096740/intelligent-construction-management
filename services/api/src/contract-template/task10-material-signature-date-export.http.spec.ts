import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const dateVersion = "reviewed-material-signature-date-v1";
const dateText = "签署日期：　年　月　日";
const slotIds = ["be6d8bf0f1e5172844c287c65d2f53f404b033dd67611442873a02d5a37a312e", "f20c09d2043ff82ab2e75bd5cce357c5c2a7dc7885246d96872c54245e699d2f"];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const textOf = (element: Element) => Array.from(element.getElementsByTagNameNS(W, "t")).map(t => t.textContent ?? "").join("");
const direct = (element: Element, name: string) => Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === name);

describe("task10 material complete signature dates at the public body and actual export boundary", () => {
  it("fills exactly two original empty signature slots, freezes the date capability and exports the same revision without moving original Word fields", async () => {
    const repository = await task10HttpRepository(__dirname), directory = await mkdtemp(join(tmpdir(), "jg-task10-material-signature-date-export-"));
    const source = await readFile(join(repository, "services/api/assets/templates/material-purchase-real-v1.docx"));
    expect(sha(source)).toBe(sourceSha);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server, source, "materials"), draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "signature-date-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      const saved = await saveBody(draft, undefined, "当前单甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wb = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json());
      expect(wb.version.amountYuan).toBe("6.5000");
      expect(wb.draft.documentRenderProfile).toEqual({ typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: dateVersion });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as Body & { draftRevision: number; documentContentRevision: number };
      for (const id of slotIds) expect(body.blocks.find(block => block.id === id)).toMatchObject({ text: dateText, editable: true });
      expect(body.blocks.filter(block => block.text === dateText)).toHaveLength(2);
      await writeFile(join(directory, "public-body-and-workbench.json"), JSON.stringify({ wb, body }, null, 2));
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: wb.version.draftRevision }) }); expect(queued.status).toBe(201);
      const generation = await queued.json() as { generationId: string };
      const list = async () => {
        const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return response.json();
      };
      const pending = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(pending).toMatchObject({ status: "queued", inputSnapshot: { documentContentRevision: wb.version.documentContentRevision,
        documentContentFingerprint: wb.version.documentContentFingerprint, bodyDocument: { sourceSha256: sourceSha, typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: dateVersion },
        renderInput: { values: { "contract.signatureDateVersion": dateVersion } } } });
      const lock = sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock-material-body25-v4.json")));
      expect(pending.idempotencyKey).toBe(sha(JSON.stringify([draft.version.id, wb.version.documentContentRevision, wb.version.documentContentFingerprint, layout.id, "draft", [], "contract-body-docx4j-v1", lock, "contract-money-v1", "body-bill-loop-v2", "reviewed-material-primary-secondary-body25-v4", dateVersion])));
      const start = performance.now(); expect(await server.processor.processNext()).toBe(true); expect(performance.now() - start).toBeLessThanOrEqual(130_000);
      const output = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(output).toMatchObject({ status: "success", inputSnapshot: pending.inputSnapshot, idempotencyKey: pending.idempotencyKey, docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      const files = {} as Record<"docx" | "pdf", Buffer>;
      for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对当前合同双方签署日期及同修订实际文书" }) }); expect(ticket.status).toBe(201);
        const { downloadUrl } = await ticket.json(); expect(downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
        const response = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(response.status).toBe(200);
        files[format] = Buffer.from(await response.arrayBuffer()); await writeFile(join(directory, "actual." + format), files[format]);
      }
      const parse = (bytes: Buffer) => new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(), "application/xml");
      const raw = parse(source), actual = parse(files.docx), serializer = new XMLSerializer();
      const rawTable = raw.getElementsByTagNameNS(W, "tbl")[1], table = actual.getElementsByTagNameNS(W, "tbl")[1];
      const rawCells = direct(direct(rawTable, "tr")[0], "tc"), cells = direct(direct(table, "tr")[0], "tc"); expect(cells).toHaveLength(2);
      expect(direct(table, "tr")).toHaveLength(1);
      for (let i = 0; i < 2; i++) {
        const original = direct(rawCells[i], "p"), rendered = direct(cells[i], "p"); expect(rendered).toHaveLength(7);
        expect(original[5].childNodes.length).toBe(0); expect(textOf(rendered[5])).toBe(dateText);
        expect(direct(rendered[5], "pPr").map(p => serializer.serializeToString(p))).toEqual([]);
        const t = rendered[5].getElementsByTagNameNS(W, "t"); expect(t.length).toBe(1); expect(t[0].getAttributeNS("http://www.w3.org/XML/1998/namespace", "space")).toBe("preserve");
        for (const j of [1, 2, 3, 4, 6]) expect(serializer.serializeToString(rendered[j])).toBe(serializer.serializeToString(original[j]));
        expect(textOf(rendered[0])).toBe(i === 0 ? "买方（章）：当前单甲方" : "卖方（章）：当前单乙方");
        expect(direct(cells[i], "tcPr").map(p => serializer.serializeToString(p))).toEqual(direct(rawCells[i], "tcPr").map(p => serializer.serializeToString(p)));
      }
      expect(files.pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pdfText = inspectActualTemplatePdf(files.docx, files.pdf, "material-complete-signature-date", output.inputSnapshot.inspection.runtime);
      expect(pdfText.replace(/\s/gu, "").match(/签署日期：年月日/gu)).toHaveLength(2);
      const after = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(r => r.json()); expect(after.version).toEqual({ ...wb.version, latestDraftPreviewDocumentId: generation.generationId, updatedAt: after.version.updatedAt }); expect(typeof after.version.updatedAt).toBe("string"); expect(Date.parse(after.version.updatedAt)).toBeGreaterThanOrEqual(Date.parse(wb.version.updatedAt)); expect(after.bills).toEqual(wb.bills); expect(after.parties).toEqual(wb.parties);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ generation, output, docxSha256: sha(files.docx), pdfSha256: sha(files.pdf), sourceSha256: sourceSha,
        remaining: ["independent actual date glyph/space-advance/cell geometry and same-V4-without-date control", "manual blank/edit/delete and old-owner compatibility", "other sources have no applicable free party slot"] }, null, 2));
      console.info(`任务10材料完整双方日期实际双格式证据：${directory}`);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 180_000);
});
