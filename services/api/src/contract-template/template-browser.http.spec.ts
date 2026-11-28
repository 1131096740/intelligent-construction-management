import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import PizZip from "pizzip";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loginTemplateActor, seedSelectionDraft, saveSelectionThroughHttp } from "./template-selection.test-support";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";

describe("template UI against actual local HTTP services", () => {
  it.each([false, true])("runs real browser/public mapping/output with repeated text=%s", async (repeated) => {
    const server = await createTemplateTestServer({ draftWorkbench: repeated });
    const artifactDirectory = await mkdtemp(join(tmpdir(), "jg-enterprise-task11-browser-"));
    const sourcePath = join(artifactDirectory, "source.docx");
    let source = syntheticWordSource(true);
    if (repeated) {
      const zip = new PizZip(source);
      zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("甲方：合成甲方公司", "甲方：________ 乙方：________").replace("乙方：合成乙方公司", "附注：本段其他文字保留。"));
      source = zip.generate({ type: "nodebuffer" });
    }
    await writeFile(sourcePath, source);
    server.processor.onApplicationBootstrap();
    const childEnvironment = { ...process.env };
    delete childEnvironment.JEST_WORKER_ID;
    try {
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task11.config.ts"], {
        cwd: resolve(__dirname, "../../../.."),
        env: { ...childEnvironment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TEMPLATE_BROWSER_REPEATED_SOURCE: repeated ? "1" : "0", TEMPLATE_BROWSER_ACCOUNT: JSON.stringify({ phone: server.actors[0].phone, password: server.password }), TEMPLATE_BROWSER_SOURCE: sourcePath, TEMPLATE_BROWSER_OUTPUT: join(artifactDirectory, "browser") },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(artifactDirectory, "browser.log"), result.stdout + result.stderr);
      // Inspect actual published previews in both real browser variants.
      {
        const director = await loginTemplateActor(server, "director");
        const base = await server.app.getUrl();
        const headers = { authorization: `Bearer ${director}` };
        const maintained = await fetch(base + "/contract-layout-templates/maintenance", { headers }).then(response => response.json()) as Array<{ name: string; versions: Array<{ id: string; status: string }> }>;
        const published = maintained.find(template => template.name === "浏览器显式映射模板")!.versions.find(version => version.status === "published")!;
        const previewResponse = await fetch(`${base}/contract-layout-template-versions/${published.id}/preview-generation`, { headers });
        expect(previewResponse.status).toBe(200);
        const preview = await previewResponse.json() as { status: string; previewPdfFileId: string };
        expect(preview.status).toBe("succeeded");
        const pdf = await server.files.getFileBuffer(preview.previewPdfFileId);
        const text = inspectActualTemplatePdf(source, pdf.buffer, repeated ? "real supervisor duplicate-source preview" : "real supervisor unique-source preview");
        expect(text).toContain("浏览器甲方"); expect(text).toContain("浏览器乙方");
      }
      if (repeated) {
        const director = await loginTemplateActor(server, "director");
        const base = await server.app.getUrl();
        const http = async (path: string) => {
          const response = await fetch(base + path, { headers: { authorization: `Bearer ${director}` } });
          expect(response.status).toBe(200); return response.json();
        };
        const maintained = await http("/contract-layout-templates/maintenance") as Array<{ name: string; versions: Array<{ id: string; status: string }> }>;
        const published = maintained.find(template => template.name === "浏览器显式映射模板")!.versions.find(version => version.status === "published")!;
        const positions = await http(`/contract-layout-template-versions/${published.id}/source-positions`) as { sourceSha256: string; mappingFingerprint: string; confirmed: boolean; positions: Array<{ positionId: string; text: string }>; bindings: Array<{ positionId: string; fieldKey: string; start: number; end: number }> };
        expect(positions.confirmed).toBe(true);
        const paragraph = positions.positions.find(position => position.text === "甲方：________ 乙方：________")!;
        const bindings = positions.bindings.filter(binding => binding.positionId === paragraph.positionId);
        expect(bindings).toEqual(expect.arrayContaining([{ positionId: paragraph.positionId, fieldKey: "party.owner.name", start: 3, end: 11 }, { positionId: paragraph.positionId, fieldKey: "party.counterparty.name", start: 15, end: 23 }]));
        expect(bindings).toHaveLength(2);
        const draft = await seedSelectionDraft(server);
        const saved = await saveSelectionThroughHttp(server, draft.versionId, published.id);
        const queued = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { method: "POST", headers: saved.headers, body: JSON.stringify({ purpose: "draft", layoutTemplateVersionId: published.id }) });
        expect(queued.status).toBe(201);
        const job = await queued.json() as { id: string };
        let output: { id: string; status: string; docxFileId: string; pdfFileId: string } | undefined;
        const deadline = Date.now() + 15_000;
        do {
          const response = await fetch(`${base}/contract-workbench/${draft.versionId}/documents`, { headers: saved.headers });
          expect(response.status).toBe(200);
          const outputs = await response.json() as Array<{ id: string; status: string; docxFileId: string; pdfFileId: string }>;
          output = outputs.find(value => value.id === job.id);
          if (output && !["queued", "processing"].includes(output.status)) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        if (!output) throw new Error("实际队列未返回本次文书记录");
        expect(output.status).toBe("success");
        const docx = await server.files.getFileBuffer(output.docxFileId);
        const pdf = await server.files.getFileBuffer(output.pdfFileId);
        const originalXml = new PizZip(source).file("word/document.xml")!.asText();
        const actualXml = new PizZip(docx.buffer).file("word/document.xml")!.asText();
        expect(actualXml).toContain("甲方：实际甲方 乙方：实际乙方");
        expect(actualXml).toContain("附注：本段其他文字保留。");
        expect(actualXml).toContain("手工条款：本项普通约定按原文保留。");
        expect(actualXml.match(/<w:p>/gu)).toHaveLength(9);
        expect(actualXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/gu)).toEqual(originalXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/gu));
        const text = inspectActualTemplatePdf(docx.buffer, pdf.buffer, "real supervisor duplicate mapping worker output");
        expect(text).toContain("甲方：实际甲方 乙方：实际乙方");
        expect(text).toContain("附注：本段其他文字保留。");
        expect(text).toContain("手工条款：本项普通约定按原文保留。");
        await writeFile(join(artifactDirectory, "repeated-generated.docx"), docx.buffer);
        await writeFile(join(artifactDirectory, "repeated-generated.pdf"), pdf.buffer);
        await writeFile(join(artifactDirectory, "repeated-receipt.json"), JSON.stringify({ completedAt: new Date().toISOString(), sourceSha256: positions.sourceSha256, mappingFingerprint: positions.mappingFingerprint, bindings, generatedDocumentId: job.id, docxSha256: createHash("sha256").update(docx.buffer).digest("hex"), pdfSha256: createHash("sha256").update(pdf.buffer).digest("hex"), sourceParagraphs: 9, outputParagraphs: 9, paragraphAndRunFormattingPreserved: true, scope: "actual synthetic DOCX/public manual mapping/real browser/local converter; no PG or production" }, null, 2));
        console.info(`任务11同段重复位置实际输出：${artifactDirectory}`);
      }
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(artifactDirectory, "browser-failure.log"), output);
      throw new Error(`真实浏览器失败，收据目录 ${artifactDirectory}\n${output}`, { cause });
    } finally {
      await server.processor.onApplicationShutdown();
      await server.app.close();
    }
  }, 130_000);
});
