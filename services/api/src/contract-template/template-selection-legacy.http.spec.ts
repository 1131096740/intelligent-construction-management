import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { loginTemplateActor, seedSelectionDraft, saveSelectionThroughHttp } from "./template-selection.test-support";

describe("identifiable legacy source without mapping through actual queued worker output", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  beforeAll(async () => { server = await createTemplateTestServer({ draftWorkbench: true }); });
  afterAll(async () => { await server.app.close(); });
  async function request(path: string, token: string, method = "GET", body?: unknown) {
    const response = await fetch(`${await server.app.getUrl()}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function legacy(fixedParties: boolean | "signature-only") {
    const director = await loginTemplateActor(server, "director");
    const zip = new PizZip(syntheticWordSource(true));
    let xml = zip.file("word/document.xml")!.asText().replace("合成工程合同", "{合同名称}");
    if (fixedParties === "signature-only") xml = xml.replace("甲方签章：合成甲方公司", "甲方签章：{甲方名称}").replace("乙方签章：合成乙方公司", "乙方签章：{乙方名称}");
    if (!fixedParties) xml = xml.replaceAll("合成甲方公司", "{甲方名称}").replaceAll("合成乙方公司", "{乙方名称}");
    zip.file("word/document.xml", xml);
    const source = zip.generate({ type: "nodebuffer" });
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(source)]), "历史无映射原文.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${director}` }, body: form });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json() as { id: string };
    const created = await request("/contract-layout-templates", director, "POST", { name: fixedParties ? "历史固定双方负控" : "历史占位符正控", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } });
    expect(created.status).toBe(201);
    const id = created.body.version.id as string;
    expect((await request(`/contract-layout-template-versions/${id}/inspection`, director, "POST")).status).toBe(201);
    const preview = await request(`/contract-layout-template-versions/${id}/preview-generation`, director, "POST", {});
    expect(preview.status).toBe(201);
    await server.processor.processNext();
    const actualPreview = await server.store.prisma.contractLayoutPreviewJob.findUnique({ where: { id: preview.body.id } });
    expect(actualPreview).toMatchObject({ status: "succeeded", previewPdfFileId: expect.any(String) });
    // Historical published metadata and already-queued snapshot are synthetic
    // persistence preconditions. No success status or output file is fabricated.
    await server.store.prisma.contractLayoutTemplateVersion.update({ where: { id }, data: { status: "published", publishedAt: new Date(), publishedByUserId: "director", previewPdfFileId: actualPreview!.previewPdfFileId } });
    const old = await seedSelectionDraft(server);
    const snapshot = { documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), templateFileId: file.id, outputBaseName: "历史冻结无映射合同", renderInput: { values: { "contract.name": "历史冻结名称", "party.owner.name": "历史甲方", "party.counterparty.name": "历史乙方", "contract.temporaryCode": "T11-LEGACY", "document.watermark": "历史草稿" } }, requiredKeys: ["contract.name", "contract.temporaryCode", "document.watermark"], attachmentFiles: [] };
    const job = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: old.versionId, layoutTemplateVersionId: id, purpose: "draft", status: "queued", sourceRevision: 1, inputSnapshot: snapshot, idempotencyKey: randomUUID(), engineVersion: "legacy-synthetic-queued", createdByUserId: "staff" } });
    await server.processor.processNext();
    const finished = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: job.id } });
    expect(finished).toMatchObject({ status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
    const pdf = await server.files.getFileBuffer(String(finished!.pdfFileId));
    return { id, old, finished: finished!, pdf, director, sourceHash: createHash("sha256").update(source).digest("hex") };
  }
  it("keeps original no-mapping rendering while new selection fills supported canonical aliases", async () => {
    const layout = await legacy(false);
    const draft = await seedSelectionDraft(server);
    const saved = await saveSelectionThroughHttp(server, draft.versionId, layout.id);
    const queued = await request(`/contract-workbench/${draft.versionId}/documents`, saved.token, "POST", { purpose: "draft", layoutTemplateVersionId: layout.id });
    expect(queued.status).toBe(201);
    await server.processor.processNext();
    const output = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: queued.body.id } });
    expect(output).toMatchObject({ status: "success" });
    expect(output!.inputSnapshot).not.toHaveProperty("layoutSourceMapping");
    const docx = await server.files.getFileBuffer(String(output!.docxFileId));
    const xml = new PizZip(docx.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("甲方：实际甲方"); expect(xml).toContain("乙方：实际乙方");
    expect(xml).toContain("甲方签章：实际甲方"); expect(xml).toContain("乙方签章：实际乙方");
    expect(xml).toContain("手动选版草稿"); expect(xml.match(/实际甲方/gu)).toHaveLength(2); expect(xml.match(/实际乙方/gu)).toHaveLength(2);
    const pdf = await server.files.getFileBuffer(String(output!.pdfFileId));
    const text = execFileSync(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON ?? "python3", ["-c", "import sys,pymupdf;d=pymupdf.open(stream=sys.stdin.buffer.read(),filetype='pdf');print(''.join(p.get_text() for p in d))"], { input: pdf.buffer, encoding: "utf8" });
    expect(text).toMatch(/甲方：\s*实际甲方/u); expect(text).toMatch(/乙方：\s*实际乙方/u);
    expect(text).toMatch(/甲方签章：\s*实际甲方/u); expect(text).toMatch(/乙方签章：\s*实际乙方/u);
    expect(text).toContain("手动选版草稿"); expect(text.match(/实际甲方/gu)).toHaveLength(2); expect(text.match(/实际乙方/gu)).toHaveLength(2);
    expect(text).toContain("本项普通约定按原文保留"); expect(text).not.toContain("历史甲方");
  });
  it("rejects new use of a historically rendered source whose parties are fixed text", async () => {
    const layout = await legacy(true);
    const oldDocx = await server.files.getFileBuffer(String(layout.finished.docxFileId));
    expect(new PizZip(oldDocx.buffer).file("word/document.xml")!.asText()).toContain("合成甲方公司");
    const draft = await seedSelectionDraft(server);
    let rejection = "";
    try { await saveSelectionThroughHttp(server, draft.versionId, layout.id); }
    catch (cause) { rejection = cause instanceof Error ? cause.message : "unknown"; }
    expect(rejection).toContain("主管");
  });
  it("rejects signature-only aliases when actual legacy body still fixes obsolete parties", async () => {
    const layout = await legacy("signature-only");
    const oldDocx = await server.files.getFileBuffer(String(layout.finished.docxFileId));
    const xml = new PizZip(oldDocx.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("甲方：合成甲方公司");
    expect(xml).toContain("甲方签章：历史甲方");
    const draft = await seedSelectionDraft(server);
    let rejection = "";
    try { await saveSelectionThroughHttp(server, draft.versionId, layout.id); }
    catch (cause) { rejection = cause instanceof Error ? cause.message : "unknown"; }
    expect(rejection).toContain("主管");
  });

});
