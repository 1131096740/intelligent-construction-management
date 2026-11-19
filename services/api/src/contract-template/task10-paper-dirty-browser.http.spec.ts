import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
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

describe("task10 dirty saved body invalidates old current draft PDF", () => {
  it("edits and really saves an ordinary clause while freezing and invalidating one old private PDF", async () => {
    const project = "desktop";
    let processNextCalls = 0;
    const startedAt = performance.now();
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("纸面检查需要准确任务10或集成API目录");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-paper-dirty-browser-"));
    const preparationDeadline = startedAt + 170_000;
    const phaseRecords: Array<Record<string, unknown>> = [];
    let server: Awaited<ReturnType<typeof createTemplateTestServer>> | undefined;
    async function phase<T>(name: string, ms: number, operation: () => Promise<T>, deadline = preparationDeadline): Promise<T> {
      const start = performance.now();
      const remaining = Math.min(ms, Math.max(0, deadline - start));
      if (remaining <= 0) throw new Error("阶段预算已用尽：" + name);
      // A deadline marks failure; it never pretends to cancel a public async operation.
      // Always wait for the owned operation to settle before cleanup/starting another phase.
      // Native Java and browser exec keep their existing120s/220s subprocess timeouts.
      let crossedDeadline = false;
      const timer = setTimeout(() => { crossedDeadline = true; }, remaining);
      try {
        const value = await operation();
        const seconds = (performance.now() - start) / 1000;
        if (crossedDeadline || seconds * 1000 > remaining) throw new Error("阶段完成超过预算：" + name);
        phaseRecords.push({ name, budgetMs: remaining, exit: 0, seconds, ownedOperationSettled: true });
        return value;
      } catch (cause) {
        phaseRecords.push({ name, budgetMs: remaining, exit: 1, seconds: (performance.now() - start) / 1000,
          deadlineExceeded: crossedDeadline || performance.now() - start > remaining, ownedOperationSettled: true,
          message: cause instanceof Error ? cause.message : "阶段失败" });
        throw cause;
      } finally {
        clearTimeout(timer);
        await writeFile(join(directory, "phase-budget-receipt.json"), JSON.stringify(phaseRecords, null, 2));
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
        const rows = [{ clientRowKey: "paper-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
        expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
        const first = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(first.status).toBe(200);
        const original = await first.json();
        const ordinary = original.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背")); expect(ordinary).toBeDefined();
        const manualText = ordinary.text + "纸面核对保留人工约定。";
        const additionId = "paper-preview-addition";
        expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
          edits: [{ positionId: ordinary.id, text: manualText }], additions: [{ id: additionId, afterPositionId: ordinary.id, text: "纸面核对新增约定。" }] }, "当前单甲方", rows)).status).toBe(200);
        const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200);
        const wb = await wbResponse.json();
        expect(wb.version.amountYuan).toBe("6.5000"); expect(wb.contract.code).toBeNull();
        expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        return { draft, layout, ordinaryId: ordinary.id, manualText, additionId, wb, runtime, beforeScratch };
      });
      const base = await server!.app.getUrl();
      const list = async () => {
        const response = await fetch(`${base}/contract-workbench/${prepared.draft.version.id}/documents`, { headers: prepared.draft.headers });
        expect(response.status).toBe(200); return await response.json() as ListedDocument[];
      };
      const generation = await phase("queue-list", 3_000, async () => {
        const response = await fetch(prepared.draft.base + "/preview-generation", { method: "POST", headers: prepared.draft.headers, body: JSON.stringify({ sourceRevision: prepared.wb.version.draftRevision }) });
        expect(response.status).toBe(201);
        const queued = await response.json();
        expect(queued.documentContentRevision).toBe(prepared.wb.version.documentContentRevision);
        expect(queued.documentContentFingerprint).toBe(prepared.wb.version.documentContentFingerprint);
        const job = (await list()).find(row => row.id === queued.generationId)!;
        expect(job).toMatchObject({ status: "queued", purpose: "draft", layoutTemplateVersionId: prepared.layout.id,
          documentContentRevision: prepared.wb.version.documentContentRevision, documentContentFingerprint: prepared.wb.version.documentContentFingerprint,
          inputSnapshot: { bodyDocument: { sourceSha256: sourceSha, pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha } } });
        return queued;
      });
      const output = await phase("one-real-worker", 130_000, async () => {
        processNextCalls += 1;
        expect(await server!.processor.processNext()).toBe(true);
        const job = (await list()).find(row => row.id === generation.generationId)!;
        expect(job).toMatchObject({ status: "success", purpose: "draft", layoutTemplateVersionId: prepared.layout.id,
          documentContentRevision: prepared.wb.version.documentContentRevision, documentContentFingerprint: prepared.wb.version.documentContentFingerprint,
          docxFileId: expect.any(String), pdfFileId: expect.any(String) });
        expect(job.inputSnapshot.inspection!.runtime).toMatchObject({ engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
        const created = (await readdir(prepared.runtime.scratchDirectory)).filter(name => !prepared.beforeScratch.includes(name));
        expect(created).toHaveLength(1);
        const completed = JSON.parse(await readFile(join(prepared.runtime.scratchDirectory, created[0], "completed.json"), "utf8"));
        expect(completed).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
        // Raw Java output and normalized authorized PDF are different provenance facts.
        const rawOutput = join(prepared.runtime.scratchDirectory, created[0], "output.pdf");
        expect((await stat(rawOutput)).size).toBeLessThanOrEqual(100_000_000);
        expect(sha(await readFile(rawOutput))).toBe(completed.pdfSha256);
        await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(completed, null, 2));
        return job;
      });
      const files = await phase("authorized-downloads-release", 7_000, async () => {
        const pair = {} as Record<"docx" | "pdf", Buffer>;
        for (const [format, id] of [["docx", output.docxFileId!], ["pdf", output.pdfFileId!]] as const) {
          const capability = await fetch(`${base}/files/${id}/download-ticket-capability`, { headers: prepared.draft.headers }); expect(capability.status).toBe(200);
          expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
          const ticket = await fetch(`${base}/files/${id}/download-ticket`, { method: "POST", headers: prepared.draft.headers, body: JSON.stringify({ confirmationPassword: server!.password, downloadReason: "核对当前合同草稿A4纸面", accessMode: format === "pdf" ? "preview" : "download" }) });
          expect(ticket.status).toBe(201); const value = await ticket.json(); expect(value.downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
          const downloaded = await fetch(base + value.downloadUrl, { headers: prepared.draft.headers }); expect(downloaded.status).toBe(200);
          if (format === "pdf") expect(downloaded.headers.get("content-type")).toMatch(/^application\/pdf/u);
          pair[format] = Buffer.from(await downloaded.arrayBuffer());
          if (format === "pdf") { expect(pair.pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(pair.pdf.length).toBeLessThanOrEqual(100_000_000); }
          await writeFile(join(directory, "actual." + format), pair[format]);
        }
        expect(sha(pair.docx)).toBe(output.inputSnapshot.inspection!.runtime!.exportedDocxSha256);
        expect(sha(pair.pdf)).toBe(output.inputSnapshot.inspection!.runtime!.exportedPdfSha256);
        const released = await fetch(prepared.draft.base + "/edit-lease", { method: "DELETE", headers: { ...prepared.draft.headers, "x-contract-draft-lease": prepared.draft.leaseToken }, body: "{}" }); expect(released.status).toBe(200); expect(await released.json()).toMatchObject({ released: true });
        const wb = await fetch(prepared.draft.base + "/workbench", { headers: prepared.draft.headers }).then(response => response.json()); expect(wb.contract.code).toBeNull();
        return pair;
      });
      await phase("original-strict-physical", 20_000, async () => {
        const text = inspectActualTemplatePdf(files.docx, files.pdf, `task10-dirty-initial-old-current-A4-${project}`, output.inputSnapshot.inspection!.runtime);
        for (const literal of [prepared.manualText, "纸面核对新增约定。", "6.5000", "草稿"]) expect(text.replace(/\s/gu, "")).toContain(literal.replace(/\s/gu, ""));
        const current = await list(); expect(current.find(row => row.id === output.id)!.status).toBe("success");
        await writeFile(join(directory, "prepared-public-pdf-receipt.json"), JSON.stringify({ generationId: output.id, purpose: output.purpose, layoutTemplateVersionId: output.layoutTemplateVersionId, documentContentRevision: output.documentContentRevision, documentContentFingerprint: output.documentContentFingerprint, pdfFileId: output.pdfFileId, pdfSha256: sha(files.pdf), docxSha256: sha(files.docx), pageCount: output.inputSnapshot.inspection!.pageCount, legalSigningAcceptance: false }, null, 2));
      });
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "PNPM_HOME", "TASK10_LINKED_PDF_WORKER_CONFIG"]) if (process.env[key] !== undefined) environment[key] = process.env[key];
      const browserDeadline = Math.min(performance.now() + 220_000, startedAt + 390_000);
      await phase(`${project}-browser`, 220_000, async () => {
        const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-paper-dirty.config.ts", `--project=${project}`, "--max-failures=1"], {
          cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: base, TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: prepared.draft.contract, version: prepared.draft.version }, layoutId: prepared.layout.id, sourceSha256: sourceSha, ordinaryId: prepared.ordinaryId, manualText: prepared.manualText, additionId: prepared.additionId, oldDraftRevision: prepared.wb.version.draftRevision, generationId: output.id, contentRevision: output.documentContentRevision, contentFingerprint: output.documentContentFingerprint, pdfFileId: output.pdfFileId, pdfSha256: sha(files.pdf), pageCount: output.inputSnapshot.inspection!.pageCount, staff: { phone: server!.actors[1].phone, password: server!.password } }) }, timeout: Math.max(1, Math.floor(browserDeadline - performance.now())), maxBuffer: 4 * 1024 * 1024
        });
        await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      }, browserDeadline);
      await phase("independent-public-after-browser", 10_000, async () => {
        // Post-browser independently use the public HTTP seam; never read a private object-store buffer.
        const currentResponse = await fetch(prepared.draft.base + "/workbench", { headers: prepared.draft.headers });
        expect(currentResponse.status).toBe(200); const current = await currentResponse.json();
        const currentBodyResponse = await fetch(prepared.draft.base + "/document-body", { headers: prepared.draft.headers });
        expect(currentBodyResponse.status).toBe(200); const currentBody = await currentBodyResponse.json();
        expect(current.version.draftRevision).toBeGreaterThan(prepared.wb.version.draftRevision);
        expect(current.version.documentContentRevision).toBeGreaterThan(output.documentContentRevision);
        expect(current.version.documentContentFingerprint).not.toBe(output.documentContentFingerprint);
        expect(current.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
        expect(current.version.amountYuan).toBe("6.5000"); expect(current.contract.code).toBeNull();
        expect(currentBody).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: prepared.layout.id,
          draftRevision: current.version.draftRevision, documentContentRevision: current.version.documentContentRevision });
        expect(currentBody.blocks.find((block: { id: string }) => block.id === prepared.ordinaryId).text)
          .toBe(prepared.manualText + "保存新修订仅供当前正文核对。");
        const finalDocuments = await list(); expect(finalDocuments).toHaveLength(1);
        expect(finalDocuments[0]).toMatchObject({ id: output.id, status: "stale", purpose: "draft", docxFileId: output.docxFileId,
          pdfFileId: output.pdfFileId, layoutTemplateVersionId: prepared.layout.id,
          documentContentRevision: output.documentContentRevision, documentContentFingerprint: output.documentContentFingerprint });
        expect(finalDocuments[0].inputSnapshot).toEqual(output.inputSnapshot);
        expect(processNextCalls).toBe(1);
        expect((await readdir(prepared.runtime.scratchDirectory)).filter(name => !prepared.beforeScratch.includes(name))).toHaveLength(1);
        await writeFile(join(directory, "independent-public-after-browser.json"), JSON.stringify({ status: "passed", processNextCalls,
          oldDocumentId: output.id, oldR: output.documentContentRevision, oldF: output.documentContentFingerprint,
          currentDraftRevision: current.version.draftRevision, currentR: current.version.documentContentRevision,
          currentF: current.version.documentContentFingerprint, oldSnapshotUnchanged: true, oldFileIdsUnchanged: true,
          documentsCount: finalDocuments.length, noSecondNative: true, legalSigningAcceptance: false }, null, 2));
      }, startedAt + 390_000);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string; message?: string };
      await writeFile(join(directory, "failure.txt"), `${failure.message ?? "纸面检查失败"}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`);
      throw new Error("纸面检查失败，保留证据 " + directory, { cause });
    } finally {
      if (server) await phase("cleanup", 10_000, async () => { await server!.processor.onApplicationShutdown(); await server!.app.close(); }, performance.now() + 10_000);
    }
  }, 400_000);
});
