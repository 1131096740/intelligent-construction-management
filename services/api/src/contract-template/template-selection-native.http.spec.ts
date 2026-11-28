import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import PizZip from "pizzip";
import { loginTemplateActor, seedSelectionDraft, publishMappedSelectionLayout, saveSelectionThroughHttp } from "./template-selection.test-support";
import { createTemplateTestServer } from "./template-management.test-support";

describe("manual template selection through existing real aggregate HTTP authority", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  beforeAll(async () => { server = await createTemplateTestServer({ draftWorkbench: true }); });
  afterAll(async () => { await server.app.close(); });
  it("rejects a new queue whose explicit template differs from the saved draft selection", async () => {
    const layout = await publishMappedSelectionLayout(server);
    const draft = await seedSelectionDraft(server);
    const token = await loginTemplateActor(server, "staff");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 409, body: { message: expect.stringContaining("保存") } });
    const documents = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json());
    expect(documents).toEqual([]);
    const saved = await saveSelectionThroughHttp(server, draft.versionId, layout.id);
    const read = await fetch(`${await server.app.getUrl()}/contract-drafts/${draft.versionId}/workbench`, { headers: saved.headers }).then(response => response.json());
    expect(read).toMatchObject({ version: { layoutTemplateVersionId: layout.id, layoutTemplateSelection: { id: layout.id, name: "真实手动选版样张", versionNo: 1, status: "published" } } });
    const queued = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
    expect(queued.status).toBe(201);
    const job = await queued.json() as { id: string };
    await server.processor.processNext();
    const finished = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; errorMessage: string | null; docxFileId: string; pdfFileId: string }>;
    const output = finished.find(value => value.id === job.id)!;
    expect(output).toMatchObject({ status: "success", errorMessage: null });
    const docx = await server.files.getFileBuffer(output.docxFileId);
    const xml = new PizZip(docx.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("手动选版草稿");
    expect(xml.match(/实际甲方/gu)).toHaveLength(2);
    expect(xml.match(/实际乙方/gu)).toHaveLength(2);
    expect(xml).toContain("本项普通约定按原文保留");
    expect(xml).not.toContain("合成甲方公司");
    const pdf = await server.files.getFileBuffer(output.pdfFileId);
    const text = inspectActualTemplatePdf(docx.buffer, pdf.buffer, "public selected/legacy generated document");
    expect(text).toContain("手动选版草稿");
    expect(text.match(/实际甲方/gu)).toHaveLength(2);
    expect(text.match(/实际乙方/gu)).toHaveLength(2);
    expect(text).toContain("本项普通约定按原文保留");
  });

  it("classifies a real worker failure retry before and after catalog stop without rewriting successful history", async () => {
    const layout = await publishMappedSelectionLayout(server, "真实失败重试样张");
    const token = await loginTemplateActor(server, "staff");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = await server.app.getUrl();
    async function failedJob() {
      const draft = await seedSelectionDraft(server);
      await saveSelectionThroughHttp(server, draft.versionId, layout.id);
      const queue = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: layout.id }) });
      expect(queue.status).toBe(201);
      const job = await queue.json() as { id: string };
      server.failNextPrivateRead();
      await server.processor.processNext();
      const list = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; docxFileId: string | null; pdfFileId: string | null }>;
      expect(list.find(value => value.id === job.id)).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null });
      return { draft, job };
    }
    const first = await failedJob();
    expect((await fetch(`${base}/contract-documents/${first.job.id}/retry`, { method: "POST", headers })).status).toBe(201);
    await server.processor.processNext();
    const success = (await fetch(`${base}/contract-workbench/${first.draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string; pdfFileId: string }>).find(value => value.id === first.job.id)!;
    expect(success.status).toBe("success");
    const original = await server.files.getFileBuffer(success.pdfFileId);
    inspectActualTemplatePdf((await server.files.getFileBuffer(layout.fileId)).buffer, original.buffer, "public real worker retry output");
    const stopped = await failedJob();
    const director = await loginTemplateActor(server, "director");
    expect((await fetch(`${base}/contract-layout-template-versions/${layout.id}/stop`, { method: "POST", headers: { authorization: `Bearer ${director}` } })).status).toBe(201);
    const blocked = await fetch(`${base}/contract-documents/${stopped.job.id}/retry`, { method: "POST", headers });
    expect({ status: blocked.status, body: await blocked.json() }).toMatchObject({ status: 400, body: { message: expect.stringContaining("尚未发布") } });
    expect((await server.files.getFileBuffer(success.pdfFileId)).buffer.equals(original.buffer)).toBe(true);
    const list = await fetch(`${base}/contract-workbench/${stopped.draft.versionId}/documents`, { headers }).then(response => response.json()) as Array<{ id: string; status: string }>;
    expect(list.find(value => value.id === stopped.job.id)).toMatchObject({ status: "failed" });
  });
});
