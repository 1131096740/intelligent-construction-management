import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ContractDocumentInputSnapshot } from "../contract-document/contract-document.service";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const legacyRuntimePath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/runtime-manifest.json";
const legacyRuntimeSha = "200e2a3be3008e0b9c9c2bca1579024fd1df93d3616613c7fd834c38dd49080a";
const legacyLockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const runtimePath = "/private/tmp/jg-382-material-body25-v4-r2-runtime-20261107/runtime-manifest.json";
const inspectionPath = "/private/tmp/jg-382-material-body25-v4-r2-runtime-20261107/inspection-manifest.json";
const runtimeSha = "a48b4092bf77ad89a26c083162904ab9562f52a9171eb6c57dc12228e2c30aba";
const inspectionSha = "12903034b24d53b502179a4574b7ffddf48c127edb2aafc5b02476e9c125f185";
const lockSha = "6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128";
const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
interface ListedDocument {
  id: string; status: string; purpose: string; layoutTemplateVersionId: string; docxFileId: string | null; pdfFileId: string | null;
  documentContentRevision: number; documentContentFingerprint: string;
  inputSnapshot: ContractDocumentInputSnapshot & { inspection?: { pageCount: number; runtime?: {
    engine: string; runtimeLockSha256: string; runtimeManifestSha256: string; exportedDocxSha256: string; exportedPdfSha256: string;
    conversionCalls: number; boundaryDenials: number; pdfSha256: string;
  } } };
}

describe("task10 cold current draft PDF actual desktop public UI", () => {
  it("generates one cold current PDF only from the real UI and preserves saved editable body", async () => {
    const startedAt = performance.now();
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("冷纸面检查需要准确任务10或集成API目录");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-paper-cold-browser-"));
    const caseDeadline = startedAt + 390_000;
    const phases: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    let server: Awaited<ReturnType<typeof createTemplateTestServer>> | undefined;
    let stopRequested = false;
    let browserCompletedSuccessfully = false;
    let strictPhysicalPassed = false;
    let receiptWrite = Promise.resolve();
    let processCalls = 0;
    let observedQueuedId: string | null = null;
    let firstFailure: unknown;
    let firstFailureRecorded = false;
    const event = (name: string, facts: Record<string, unknown> = {}) => events.push({ sequence: events.length + 1, elapsedMs: performance.now() - startedAt, name, ...facts });
    function noteFailure(name: string, cause: unknown) {
      event(name, { message: cause instanceof Error ? cause.message : "阶段失败" });
      if (!firstFailureRecorded) { firstFailure = cause; firstFailureRecorded = true; }
    }
    async function phase<T>(name: string, ms: number, operation: () => Promise<T>, deadline = caseDeadline): Promise<T> {
      const start = performance.now(); const remaining = Math.min(ms, Math.max(0, deadline - start));
      if (remaining <= 0) throw new Error("阶段预算已用尽：" + name);
      let exceeded = false; const timer = setTimeout(() => { exceeded = true; }, remaining);
      try {
        const value = await operation();
        if (exceeded || performance.now() - start > remaining) throw new Error("阶段完成超过预算：" + name);
        phases.push({ name, budgetMs: remaining, exit: 0, seconds: (performance.now() - start) / 1000, ownedOperationSettled: true }); return value;
      } catch (cause) {
        noteFailure(name, cause);
        phases.push({ name, budgetMs: remaining, exit: 1, seconds: (performance.now() - start) / 1000, deadlineExceeded: exceeded || performance.now() - start > remaining, ownedOperationSettled: true });
        throw cause;
      } finally {
        clearTimeout(timer);
        const payload = JSON.stringify(phases, null, 2);
        receiptWrite = receiptWrite.then(() => writeFile(join(directory, "phase-budget-receipt.json"), payload));
        await receiptWrite;
      }
    }
    try {
      const prepared = await phase("seed-preflight", 10_000, async () => {
        expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(legacyRuntimePath);
        expect(process.env.CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
        expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
        expect(process.env.TEMPLATE_PDF_RUNTIME_MODE).toBe("font-profile");
        expect(sha(await readFile(legacyRuntimePath))).toBe(legacyRuntimeSha);
        expect(sha(await readFile(runtimePath))).toBe(runtimeSha);
        expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
        expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(legacyLockSha);
        expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock-material-body25-v4.json")))).toBe(lockSha);
        const sourcePaths = ["services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts"];
        await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
        const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
        const beforeScratch = await readdir(runtime.scratchDirectory);
        server = await createTemplateTestServer({ draftWorkbench: true });
        const source = await readFile(join(repository, "services/api/assets/templates/material-purchase-real-v1.docx"));
        expect(sha(source)).toBe(sourceSha);
        const layout = await confirmedBodyLayout(server, source, "materials");
        const draft = await createTask09Draft(server);
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        const rows = [{ clientRowKey: "paper-cold-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
        expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
        const first = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(first.status).toBe(200);
        const original = await first.json();
        const ordinary = original.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背")); expect(ordinary).toBeDefined();
        const manualText = ordinary.text + "纸面核对保留人工约定。";
        const additionId = "paper-cold-addition";
        expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
          edits: [{ positionId: ordinary.id, text: manualText }], additions: [{ id: additionId, afterPositionId: ordinary.id, text: "冷生成保留新增约定。" }] }, "当前单甲方", rows)).status).toBe(200);
        const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200);
        const wb = await wbResponse.json();
        expect(wb.version.amountYuan).toBe("6.5000"); expect(wb.contract.code).toBeNull();
        expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        expect(wb.draftOperationAvailableActions).toContain("queue_contract_draft_preview");
        const empty = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
        expect(empty.status).toBe(200); expect(await empty.json()).toEqual([]);
        const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
        expect(released.status).toBe(200); expect(await released.json()).toMatchObject({ released: true });
        return { draft, layout, ordinaryId: ordinary.id, manualText, additionId, wb, runtime, beforeScratch };
      });
      const base = await server!.app.getUrl();
      const list = async (): Promise<ListedDocument[]> => {
        const response = await fetch(`${base}/contract-workbench/${prepared.draft.version.id}/documents`, { headers: prepared.draft.headers });
        expect(response.status).toBe(200); return await response.json() as ListedDocument[];
      };
      const browserDeadline = Math.min(performance.now() + 220_000, caseDeadline);
      const publicPump = async () => {
        for (let polls = 0; polls < 1100; polls += 1) {
          if (stopRequested) { event("pump-idle-stopped"); return; }
          if (performance.now() >= browserDeadline) throw new Error("冷生成观察阶段超过既有浏览器期限");
          const rows = await list();
          if (stopRequested) { event("pump-after-read-stopped"); return; }
          if (!rows.length) { await new Promise<void>(done => setTimeout(done, 200)); continue; }
          expect(rows).toHaveLength(1);
          const queued = rows[0];
          expect(queued).toMatchObject({ status: "queued", purpose: "draft", layoutTemplateVersionId: prepared.layout.id,
            documentContentRevision: prepared.wb.version.documentContentRevision, documentContentFingerprint: prepared.wb.version.documentContentFingerprint,
            docxFileId: null, pdfFileId: null,
            inputSnapshot: { bodyDocument: { sourceSha256: sourceSha, pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha } } });
          if (stopRequested) return;
          observedQueuedId = queued.id;
          event("public-queued-observed", { generationId: queued.id });
          processCalls += 1; expect(processCalls).toBe(1);
          const output = await phase("one-real-worker", 130_000, async () => {
            expect(await server!.processor.processNext()).toBe(true);
            const completedRows = await list(); expect(completedRows).toHaveLength(1);
            const job = completedRows[0];
            expect(job).toMatchObject({ id: queued.id, status: "success", purpose: "draft", layoutTemplateVersionId: prepared.layout.id,
              documentContentRevision: prepared.wb.version.documentContentRevision, documentContentFingerprint: prepared.wb.version.documentContentFingerprint,
              docxFileId: expect.any(String), pdfFileId: expect.any(String) });
            expect(job.inputSnapshot.inspection!.runtime).toMatchObject({ engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
            const created = (await readdir(prepared.runtime.scratchDirectory)).filter(name => !prepared.beforeScratch.includes(name)); expect(created).toHaveLength(1);
            const witness = JSON.parse(await readFile(join(prepared.runtime.scratchDirectory, created[0], "completed.json"), "utf8"));
            expect(witness).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
            const raw = join(prepared.runtime.scratchDirectory, created[0], "output.pdf"); expect((await stat(raw)).size).toBeLessThanOrEqual(100_000_000);
            expect(sha(await readFile(raw))).toBe(witness.pdfSha256);
            await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(witness, null, 2)); return job;
          });
          event("actual-worker-settled", { generationId: output.id });
          if (stopRequested && !browserCompletedSuccessfully) { event("pump-stopped-after-active-worker"); return; }
          const files = await phase("authorized-pair-and-handoff", 7_000, async () => {
            const pair = {} as Record<"docx" | "pdf", Buffer>;
            for (const [format, id] of [["docx", output.docxFileId!], ["pdf", output.pdfFileId!]] as const) {
              const cap = await fetch(`${base}/files/${id}/download-ticket-capability`, { headers: prepared.draft.headers }); expect(cap.status).toBe(200);
              expect(await cap.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
              const ticket = await fetch(`${base}/files/${id}/download-ticket`, { method: "POST", headers: prepared.draft.headers, body: JSON.stringify({ confirmationPassword: server!.password, downloadReason: "核对用户冷生成的当前草稿", accessMode: format === "pdf" ? "preview" : "download" }) });
              expect(ticket.status).toBe(201); const value = await ticket.json(); expect(value.downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
              const actual = await fetch(base + value.downloadUrl, { headers: prepared.draft.headers }); expect(actual.status).toBe(200);
              if (format === "pdf") expect(actual.headers.get("content-type")).toMatch(/^application\/pdf/u);
              pair[format] = Buffer.from(await actual.arrayBuffer()); expect(pair[format].length).toBeGreaterThan(0);
              await writeFile(join(directory, "actual." + format), pair[format]);
            }
            expect(pair.pdf.length).toBeLessThanOrEqual(100_000_000); expect(pair.pdf.subarray(0, 5).toString()).toBe("%PDF-");
            expect(sha(pair.docx)).toBe(output.inputSnapshot.inspection!.runtime!.exportedDocxSha256); expect(sha(pair.pdf)).toBe(output.inputSnapshot.inspection!.runtime!.exportedPdfSha256);
            const expected = { generationId: output.id, pdfFileId: output.pdfFileId, docxFileId: output.docxFileId, purpose: output.purpose,
              layoutTemplateVersionId: output.layoutTemplateVersionId, sourceSha256: sourceSha,
              contentRevision: output.documentContentRevision, contentFingerprint: output.documentContentFingerprint,
              pdfBytes: pair.pdf.length, pdfSha256: sha(pair.pdf), docxBytes: pair.docx.length, docxSha256: sha(pair.docx), pageCount: output.inputSnapshot.inspection!.pageCount, legalSigningAcceptance: false };
            await writeFile(join(directory, "expected-public-pair.json.tmp"), JSON.stringify(expected, null, 2));
            await rename(join(directory, "expected-public-pair.json.tmp"), join(directory, "expected-public-pair.json"));
            return pair;
          });
          if (stopRequested && !browserCompletedSuccessfully) { event("pump-stopped-after-active-downloads"); return; }
          await phase("original-strict-physical", 20_000, async () => {
            const text = inspectActualTemplatePdf(files.docx, files.pdf, "task10-cold-current-A4-desktop", output.inputSnapshot.inspection!.runtime);
            for (const literal of [prepared.manualText, "冷生成保留新增约定。", "6.5000", "草稿"]) expect(text.replace(/\s/gu, "")).toContain(literal.replace(/\s/gu, ""));
            const final = await list(); expect(final).toHaveLength(1); expect(final[0]).toMatchObject({ id: output.id, status: "success", docxFileId: output.docxFileId, pdfFileId: output.pdfFileId });
          });
          strictPhysicalPassed = true;
          event("pump-complete", { generationId: output.id }); return;
        }
        throw new Error("冷生成公开观察次数已用尽");
      };
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "PNPM_HOME", "TASK10_LINKED_PDF_WORKER_CONFIG"]) if (process.env[key] !== undefined) environment[key] = process.env[key];
      const pumpTask = publicPump().catch(cause => { stopRequested = true; noteFailure("pump-failure", cause); throw cause; });
      const browserTask = phase("desktop-browser", 220_000, async () => {
        try {
          const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-paper-cold.config.ts", "--project=desktop", "--max-failures=1"], {
            cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: base, TASK10_COLD_BROWSER_OUTPUT: join(directory, "browser"),
              TASK10_COLD_BROWSER_INPUT: JSON.stringify({ draft: { contract: prepared.draft.contract, version: prepared.draft.version }, layoutId: prepared.layout.id, sourceSha256: sourceSha,
                ordinaryId: prepared.ordinaryId, manualText: prepared.manualText, additionId: prepared.additionId,
                contentRevision: prepared.wb.version.documentContentRevision, contentFingerprint: prepared.wb.version.documentContentFingerprint,
                staff: { phone: server!.actors[1].phone, password: server!.password } }) }, timeout: Math.max(1, Math.floor(browserDeadline - performance.now())), maxBuffer: 4 * 1024 * 1024
          });
          await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
          browserCompletedSuccessfully = true;
        } catch (cause) {
          const error = cause as { stdout?: string; stderr?: string; message?: string };
          await writeFile(join(directory, "browser.log"), `${error.message ?? "浏览器失败"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`); throw cause;
        } finally { stopRequested = true; event("browser-operation-settled"); }
      }, browserDeadline);
      const settled = await Promise.allSettled([browserTask, pumpTask]);
      event("both-operations-settled", { results: settled.map(value => value.status), processCalls, observedQueuedId });
      await writeFile(join(directory, "owned-lifecycle.json"), JSON.stringify({ events, results: settled.map(value => value.status), processCalls, observedQueuedId, actualSettled: true }, null, 2));
      if (firstFailureRecorded) throw firstFailure;
      expect(settled.every(value => value.status === "fulfilled")).toBe(true); expect(processCalls).toBe(1); expect(observedQueuedId).not.toBeNull(); expect(strictPhysicalPassed).toBe(true);
      const finalRows = await list(); expect(finalRows).toHaveLength(1); expect(finalRows[0]).toMatchObject({ id: observedQueuedId, status: "success" });
      const finalWbResponse = await fetch(prepared.draft.base + "/workbench", { headers: prepared.draft.headers }); expect(finalWbResponse.status).toBe(200);
      const finalWb = await finalWbResponse.json(); expect(finalWb.version.documentContentRevision).toBe(prepared.wb.version.documentContentRevision);
      expect(finalWb.version.documentContentFingerprint).toBe(prepared.wb.version.documentContentFingerprint); expect(finalWb.version.amountYuan).toBe("6.5000"); expect(finalWb.contract.code).toBeNull();
    } catch (cause) {
      const error = cause as { stdout?: string; stderr?: string; message?: string };
      await writeFile(join(directory, "failure.txt"), `${error.message ?? "冷纸面检查失败"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      throw new Error("冷纸面检查失败，原始证据已保留 " + directory, { cause });
    } finally {
      stopRequested = true;
      try {
        await writeFile(join(directory, "lifecycle-events.json"), JSON.stringify({ events, processCalls, observedQueuedId, firstFailureRecorded, strictPhysicalPassed, browserCompletedSuccessfully }, null, 2));
      } finally {
        if (server) await phase("cleanup", 10_000, async () => { await server!.processor.onApplicationShutdown(); await server!.app.close(); }, performance.now() + 10_000);
      }
    }
  }, 400_000);
});
