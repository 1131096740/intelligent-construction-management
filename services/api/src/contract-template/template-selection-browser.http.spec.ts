import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { seedSelectionDraft, publishMappedSelectionLayout, loginTemplateActor } from "./template-selection.test-support";

describe("saved template selection in the real contract workbench browser", () => {
  it("uses the real parent save/lease path without intercepted business responses", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const directory = await mkdtemp(join(tmpdir(), "jg-enterprise-task11-selection-"));
    const source = join(directory, "source.docx");
    await writeFile(source, syntheticWordSource(true));
    const first = await publishMappedSelectionLayout(server, "模板甲");
    const second = await publishMappedSelectionLayout(server, "模板乙");
    const draft = await seedSelectionDraft(server, true);
    server.processor.onApplicationBootstrap();
    const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
    try {
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task11-selection.config.ts"], {
        cwd: resolve(__dirname, "../../../.."), env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TEMPLATE_BROWSER_OUTPUT: join(directory, "browser"), TEMPLATE_BROWSER_SOURCE: source, TEMPLATE_SELECTION_RECEIPT_PATH: join(directory, "browser-history-receipt.json"), TEMPLATE_SELECTION_INPUT: JSON.stringify({ ...draft, first, second, staff: { phone: server.actors[1].phone, password: server.password }, director: { phone: server.actors[0].phone, password: server.password } }) }, timeout: 150_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      const token = await loginTemplateActor(server, "staff");
      const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.versionId}/documents`, { headers: { authorization: `Bearer ${token}` } });
      if (response.status !== 200) throw new Error("浏览器后实际文书读取失败");
      const outputs = await response.json() as Array<{ status: string; docxFileId: string; pdfFileId: string }>;
      const witnessed = JSON.parse(await readFile(join(directory, "browser-history-receipt.json"), "utf8")) as { generatedDocumentId: string; docxFileId: string; pdfFileId: string; statusBeforeClear: string; statusAfterClear: string; pdfSha256BeforeStop: string; pdfSha256AfterStopAndClear: string };
      const completed = (outputs as Array<typeof outputs[number] & { id: string }>).find(output => output.id === witnessed.generatedDocumentId);
      expect(completed).toMatchObject({ status: "stale", docxFileId: witnessed.docxFileId, pdfFileId: witnessed.pdfFileId });
      expect(witnessed).toMatchObject({ statusBeforeClear: "success", statusAfterClear: "stale" });
      expect(witnessed.pdfSha256AfterStopAndClear).toBe(witnessed.pdfSha256BeforeStop);
      if (!completed) throw new Error("浏览器链未留下实际成功文书");
      const docx = await server.files.getFileBuffer(completed.docxFileId);
      const pdf = await server.files.getFileBuffer(completed.pdfFileId);
      inspectActualTemplatePdf(docx.buffer, pdf.buffer, "real browser same successful history ID");
      expect(createHash("sha256").update(pdf.buffer).digest("hex")).toBe(witnessed.pdfSha256BeforeStop);
      await writeFile(join(directory, "generated.docx"), docx.buffer);
      await writeFile(join(directory, "generated.pdf"), pdf.buffer);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ scope: "synthetic HTTP and real browser/local DOCX/PDF; no PG or production", completedAt: new Date().toISOString(), sourceSha256: second.sourceSha256, mappingFingerprint: second.mappingFingerprint, docxSha256: createHash("sha256").update(docx.buffer).digest("hex"), pdfSha256: createHash("sha256").update(pdf.buffer).digest("hex"), generatedDocumentId: witnessed.generatedDocumentId, statusBeforeClear: witnessed.statusBeforeClear, statusAfterClear: witnessed.statusAfterClear, manualSelectionSaved: true, stoppedSelectionLabelRetained: true, explicitNullCleared: true, historicalDownloadHashUnchanged: true, finalStatusAfterExplicitClear: "stale; successful immutable files retained", hardReloadEditing: "NOT_PROVEN; route disposal release used" }, null, 2));
      console.info(`任务11实际选版文书收据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`真实选版浏览器失败，收据 ${directory}\n${output}`, { cause });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 170_000);
});
