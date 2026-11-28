import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { confirmedBodyLayout } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 explicit body converter runtime refusal at public generation HTTP", () => {
  it.each([
    ["simple", '<w:fldSimple w:instr="HYPERLINK &quot;https://example.invalid/&quot;"><w:r><w:t>普通说明</w:t></w:r></w:fldSimple>'],
    ["split complex", '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPER</w:instrText></w:r><w:r><w:instrText>LINK &quot;https://example.invalid/&quot;</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>普通说明</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'],
    ["entity encoded", '<w:fldSimple w:instr="INCLUDE&#84;EXT &quot;/__jg_docx_outside__&quot;"><w:r><w:t>普通说明</w:t></w:r></w:fldSimple>']
  ])("rejects an actual %s active field before Word load and private upload at the public generation boundary", async (_kind, field) => {
    const configured = process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    if (!configured) throw new Error("主动字段检查需要明确自有运行时");
    const runtime = JSON.parse(await readFile(configured, "utf8")) as { scratchDirectory: string };
    const source = new PizZip(syntheticWordSource(true));
    const xml = source.file("word/document.xml")!.asText();
    source.file("word/document.xml", xml.replace("<w:sectPr>", `<w:p>${field}</w:p><w:sectPr>`));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const layout = await confirmedBodyLayout(server, source.generate({ type: "nodebuffer" }));
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number } };
      upload.mockClear();
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json() as { generationId: string };
      const beforeScratch = (await readdir(runtime.scratchDirectory)).sort();
      expect(await server.processor.processNext()).toBe(true);
      expect((await readdir(runtime.scratchDirectory)).sort()).toEqual(beforeScratch);
      const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(response.status).toBe(200);
      const records = await response.json() as Array<{ id: string }>;
      expect(records.find(record => record.id === generation.generationId)).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null,
        errorMessage: "合同正文文件无法安全转换，请核对文件内容" });
      expect(upload.mock.calls.length).toBe(0);
      const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      expect(after.version).toMatchObject({ draftRevision: current.version.draftRevision, latestDraftPreviewDocumentId: null, status: "draft" });
    } finally { upload.mockRestore(); await server.app.close(); }
  });

  it("never publishes success or file references and performs no private upload when the explicit new-engine manifest is absent", async () => {
    const configured = process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    if (!configured) throw new Error("该实际失败检查需要明确自有运行时根，不能使用默认或真实环境");
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile"); // Call-through at the approved public file interface.
    try {
      const layout = await confirmedBodyLayout(server);
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number } };
      upload.mockClear(); // Published source fixture is outside this generation's uploads.
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json() as { generationId: string };
      process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = join(dirname(configured), "absent-runtime.json");
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; }
      const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(response.status).toBe(200);
      const records = await response.json() as Array<{ id: string }>;
      expect(records.find(record => record.id === generation.generationId)).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null,
        engineVersion: "contract-body-docx4j-v1", errorMessage: "合同正文转换运行环境未就绪，请联系管理员",
        inputSnapshot: { bodyDocument: { pdfEngine: "docx4j-17.3.5", runtimeLockSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) } } });
      const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      expect(after.version).toMatchObject({ draftRevision: current.version.draftRevision, latestDraftPreviewDocumentId: null, status: "draft" });
      expect(upload.mock.calls.length).toBe(0);
    } finally { upload.mockRestore(); process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; await server.app.close(); }
  });

  it("fails the same public generation before any upload when a real approved font is substituted into the wrong pinned role", async () => {
    const configured = process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    if (!configured || !configured.startsWith("/private/tmp/jg-task10-")) throw new Error("坏字体检查只允许明确的任务10自有临时运行时");
    const manifest = JSON.parse(await readFile(configured, "utf8")) as { fonts: Array<{ name: string; path: string }> };
    const fang = manifest.fonts.find(font => font.name === "fangsong")!;
    const times = manifest.fonts.find(font => font.name === "times")!;
    expect(createHash("sha256").update(await readFile(fang.path)).digest("hex")).toBe("fef7cf991b458cabd184b73378918d9d15429010e1d6c804f08d394395c3c3b4");
    expect(createHash("sha256").update(await readFile(times.path)).digest("hex")).toBe("f3b4ffff71c2a0c7227d37497683b2498fb2d0a4e8beae26f022e3ccfcaabfa3");
    fang.path = times.path;
    const fault = join(dirname(configured), `bad-font-${randomUUID()}.json`);
    await writeFile(fault, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const layout = await confirmedBodyLayout(server), draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number } };
      upload.mockClear();
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json() as { generationId: string };
      process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = fault;
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; }
      const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(response.status).toBe(200);
      const records = await response.json() as Array<{ id: string }>;
      expect(records.find(record => record.id === generation.generationId)).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null,
        engineVersion: "contract-body-docx4j-v1", errorMessage: "合同正文转换运行环境未就绪，请联系管理员" });
      const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      expect(after.version).toMatchObject({ draftRevision: current.version.draftRevision, latestDraftPreviewDocumentId: null, status: "draft" });
      expect(upload.mock.calls.length).toBe(0);
      console.info(`任务10真实字体错位负控manifest：${fault}`);
    } finally { upload.mockRestore(); process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = configured; await server.app.close(); }
  });
});
