import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { AuditService } from "../audit/audit.service";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
interface Preview { id: string; status: string; sourceRevision: number; previewPdfFileId: string; }

describe("task10 default URL-only actual layout sample preview", () => {
  it("prepares two real template pages through public queue and previews the authorized private file", async () => {
    const started = performance.now();
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("默认样张检查仅允许准确任务10API目录");
    const runtimePath = process.env.TEMPLATE_PDF_RUNTIME_MANIFEST;
    if (!runtimePath || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("默认样张需要已核定的隔离字体运行清单");
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { workspace: string; fontconfig: { path: string; sha256: string }; converter: { wrapper: { path: string; sha256: string }; native: { path: string; sha256: string } }; fonts: Array<{ path: string; sha256: string }>; inspectorExecutable: string };
    expect(process.env.FONTCONFIG_FILE).toBe(runtime.fontconfig.path);
    expect(process.env.DOC_CONVERTER_COMMAND).toBeUndefined();
    let resolvedConverter: string | undefined;
    for (const segment of process.env.PATH?.split(delimiter) ?? []) {
      const candidate = resolve(segment || ".", "soffice");
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, constants.X_OK);
        resolvedConverter = candidate;
        break;
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") continue;
        throw cause;
      }
    }
    if (!resolvedConverter) throw new Error("实际PATH未找到可执行的锁定转换器");
    expect(await realpath(resolvedConverter)).toBe(await realpath(runtime.converter.wrapper.path));
    expect(sha(await readFile(resolvedConverter))).toBe(runtime.converter.wrapper.sha256);
    expect(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON).toBe(runtime.inspectorExecutable);
    for (const file of [runtime.fontconfig, runtime.converter.wrapper, runtime.converter.native, ...runtime.fonts]) expect(sha(await readFile(file.path))).toBe(file.sha256);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-default-layout-preview-"));
    const phases: Array<Record<string, unknown>> = [];
    const preparationDeadline = started + 170_000;
    let server: Awaited<ReturnType<typeof createTemplateTestServer>> | undefined;
    async function phase<T>(name: string, budgetMs: number, operation: () => Promise<T>, deadline = preparationDeadline) {
      const begin = performance.now(), remaining = Math.min(budgetMs, Math.max(0, deadline - begin));
      if (remaining <= 0) throw new Error("默认样张阶段预算已用尽：" + name);
      let exceeded = false; const timer = setTimeout(() => { exceeded = true; }, remaining);
      try {
        const value = await operation();
        if (exceeded || performance.now() - begin > remaining) throw new Error("默认样张阶段超过预算：" + name);
        phases.push({ name, budgetMs: remaining, exit: 0, seconds: (performance.now() - begin) / 1000, ownedOperationSettled: true }); return value;
      } catch (cause) {
        phases.push({ name, budgetMs: remaining, exit: 1, seconds: (performance.now() - begin) / 1000, ownedOperationSettled: true, message: cause instanceof Error ? cause.message : "阶段失败" }); throw cause;
      } finally { clearTimeout(timer); await writeFile(join(directory, "phase-budget-receipt.json"), JSON.stringify(phases, null, 2)); }
    }
    try {
      const prepared = await phase("public-upload-create-map-inspect-queue", 10_000, async () => {
        server = await createTemplateTestServer();
        const base = await server.app.getUrl();
        const account = { phone: server.actors[0].phone, password: server.password };
        const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(account) }); expect(login.status).toBe(201);
        const token = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
        const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
        const request = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const zip = new PizZip(syntheticWordSource(true));
        const firstMarker = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="28"/></w:rPr><w:t>第一页核验标记</w:t></w:r></w:p>';
        const secondMarker = '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="28"/></w:rPr><w:t>第二页核验标记</w:t></w:r></w:p>';
        const xml = zip.file("word/document.xml")!.asText(); expect(xml.match(/<w:sectPr>/gu)).toHaveLength(1);
        zip.file("word/document.xml", xml.replace("<w:sectPr>", firstMarker + secondMarker + "<w:sectPr>"));
        const docx = zip.generate({ type: "nodebuffer" }); await writeFile(join(directory, "source.docx"), docx);
        const form = new FormData(); form.append("file", new Blob([new Uint8Array(docx)]), "默认版式两页真实源.docx");
        const upload = await fetch(base + "/files", { method: "POST", headers: { authorization: "Bearer " + token }, body: form }); expect(upload.status).toBe(201);
        const file = await upload.json() as { id: string };
        const templateName = "默认样张两页兼容检查";
        const created = await request("/contract-layout-templates", "POST", { name: templateName, contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }); expect(created.status).toBe(201);
        const value = await created.json() as { template: { id: string }; version: { id: string } };
        const path = "/contract-layout-template-versions/" + value.version.id;
        const positions = await request(path + "/source-positions"); expect(positions.status).toBe(200);
        const source = await positions.json() as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
        expect(source.sourceSha256).toBe(sha(docx));
        const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
        const bindings = source.positions.slice(0, 5).map((position, i) => ({ positionId: position.positionId, start: i === 0 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
        for (const [index, fieldKey] of [[7, "party.owner.name"], [8, "party.counterparty.name"]] as const) { const position = source.positions[index]; bindings.push({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey }); }
        const mapping = await request(path + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }); expect(mapping.status).toBe(200);
        expect((await request(path + "/inspection", "POST")).status).toBe(201);
        const queued = await request(path + "/preview-generation", "POST", { contract: { name: "默认样张兼容合同", temporaryCode: "DEFAULT-2P" }, party: { owner: { name: "兼容甲方" }, counterparty: { name: "兼容乙方" } }, document: { watermark: "样张" } }); expect(queued.status).toBe(201);
        const job = await queued.json() as Preview; expect(job).toMatchObject({ status: "queued", sourceRevision: 2 });
        return { base, request, account, templateName, templateId: value.template.id, versionId: value.version.id, path, source, docx, job };
      });
      const output = await phase("one-real-layout-preview-worker", 130_000, async () => {
        expect(await server!.processor.processNext()).toBe(true);
        const response = await prepared.request(prepared.path + "/preview-generation"); expect(response.status).toBe(200);
        const result = await response.json() as Preview;
        expect(result).toMatchObject({ id: prepared.job.id, status: "succeeded", sourceRevision: 2, previewPdfFileId: expect.any(String) });
        const maintained = await prepared.request("/contract-layout-templates/" + prepared.templateId); expect(maintained.status).toBe(200);
        const detail = await maintained.json() as { versions: Array<{ id: string; draftRevision: number; status: string; previewPdfFileId: string | null; latestPreview: Preview | null }> };
        const version = detail.versions.find(version => version.id === prepared.versionId);
        expect(version).toMatchObject({ draftRevision: 2, status: "draft", previewPdfFileId: null });
        expect(version!.latestPreview).toMatchObject({ id: result.id, status: "succeeded", sourceRevision: 2, previewPdfFileId: result.previewPdfFileId });
        return result;
      });
      const pdf = await phase("public-authorized-pdf-download", 7_000, async () => {
        const capability = await prepared.request(`/files/${output.previewPdfFileId}/download-ticket-capability`); expect(capability.status).toBe(200);
        expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true } });
        const ticket = await prepared.request(`/files/${output.previewPdfFileId}/download-ticket`, "POST", { confirmationPassword: server!.password, downloadReason: "核对默认版式真实两页样张", accessMode: "preview" }); expect(ticket.status).toBe(201);
        const value = await ticket.json() as { downloadUrl: string }; expect(value.downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
        const response = await prepared.request(value.downloadUrl); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toMatch(/^application\/pdf/u);
        const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(0); expect(bytes.length).toBeLessThanOrEqual(100_000_000);
        await writeFile(join(directory, "actual.pdf"), bytes); return bytes;
      });
      await phase("strict-original-physical-and-two-page-qualification", 25_000, async () => {
        const text = inspectActualTemplatePdf(prepared.docx, pdf, "task10-default-layout-URL-only-two-page");
        for (const literal of ["第一页核验标记", "第二页核验标记", "兼容甲方", "兼容乙方"]) expect(text.replace(/\s/gu, "")).toContain(literal);
        const script = 'import fitz,json,sys; d=fitz.open(sys.argv[1]); print(json.dumps({"pages":len(d),"texts":[p.get_text() for p in d]},ensure_ascii=False))';
        const result = await promisify(execFile)(runtime.inspectorExecutable, ["-c", script, join(directory, "actual.pdf")], { timeout: 5_000, maxBuffer: 1024 * 1024 });
        const pages = JSON.parse(result.stdout) as { pages: number; texts: string[] }; expect(pages.pages).toBe(2);
        expect(pages.texts[0].replace(/\s/gu, "")).toContain("第一页核验标记"); expect(pages.texts[1].replace(/\s/gu, "")).toContain("第二页核验标记");
        await writeFile(join(directory, "public-ready-template-pdf.json"), JSON.stringify({ templateId: prepared.templateId, versionId: prepared.versionId, job: output, sourceSha256: prepared.source.sourceSha256, pdfSha256: sha(pdf), pdfBytes: pdf.length, pages, scope: "realtemplate publicmapping/queue/worker/file; no publishedstatus/bodyPDFfakebinding" }, null, 2));
      });
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "PNPM_HOME", "TASK10_LINKED_PDF_WORKER_CONFIG"]) if (process.env[key] !== undefined) environment[key] = process.env[key];
      const deadline = Math.min(performance.now() + 220_000, started + 390_000);
      await phase("desktop-default-sample-browser", 220_000, async () => {
        const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-default-layout-preview.config.ts", "--project=desktop", "--max-failures=1"], { cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: prepared.base, TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_DEFAULT_PREVIEW_INPUT: JSON.stringify({ account: prepared.account, templateName: prepared.templateName, templateId: prepared.templateId, versionId: prepared.versionId, jobId: output.id, pdfFileId: output.previewPdfFileId, sourceSha256: prepared.source.sourceSha256, pdfSha256: sha(pdf), pdfBytes: pdf.length }) }, timeout: Math.max(1, Math.floor(deadline - performance.now())), maxBuffer: 4 * 1024 * 1024 });
        await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      }, deadline);
      for (const file of [runtime.fontconfig, runtime.converter.wrapper, runtime.converter.native, ...runtime.fonts]) expect(sha(await readFile(file.path))).toBe(file.sha256);
    } catch (cause) {
      const error = cause as { message?: string; stdout?: string; stderr?: string }; await writeFile(join(directory, "failure.txt"), `${error.message ?? "默认样张失败"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      throw new Error("默认样张实际链失败，保留证据 " + directory, { cause });
    } finally {
      if (server) await phase("cleanup", 10_000, async () => { await server!.processor.onApplicationShutdown(); await server!.app.close(); }, performance.now() + 10_000);
    }
  }, 400_000);
  it("refuses the observed only-notdef default preview before worker upload", async () => {
    const started = performance.now();
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("默认样张检查仅允许准确任务10API目录");
    const runtimePath = process.env.TEMPLATE_PDF_RUNTIME_MANIFEST;
    if (!runtimePath || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("默认样张需要已核定的隔离字体运行清单");
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { workspace: string; fontconfig: { path: string; sha256: string }; converter: { wrapper: { path: string; sha256: string }; native: { path: string; sha256: string } }; fonts: Array<{ path: string; sha256: string }>; inspectorExecutable: string };
    expect(process.env.FONTCONFIG_FILE).toBe(runtime.fontconfig.path);
    expect(process.env.DOC_CONVERTER_COMMAND).toBeUndefined();
    let resolvedConverter: string | undefined;
    for (const segment of process.env.PATH?.split(delimiter) ?? []) {
      const candidate = resolve(segment || ".", "soffice");
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, constants.X_OK);
        resolvedConverter = candidate;
        break;
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") continue;
        throw cause;
      }
    }
    if (!resolvedConverter) throw new Error("实际PATH未找到可执行的锁定转换器");
    expect(await realpath(resolvedConverter)).toBe(await realpath(runtime.converter.wrapper.path));
    expect(sha(await readFile(resolvedConverter))).toBe(runtime.converter.wrapper.sha256);
    expect(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON).toBe(runtime.inspectorExecutable);
    for (const file of [runtime.fontconfig, runtime.converter.wrapper, runtime.converter.native, ...runtime.fonts]) expect(sha(await readFile(file.path))).toBe(file.sha256);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-B-default-layout-preview-"));
    const phases: Array<Record<string, unknown>> = [];
    const preparationDeadline = started + 170_000;
    let server: Awaited<ReturnType<typeof createTemplateTestServer>> | undefined;
    async function phase<T>(name: string, budgetMs: number, operation: () => Promise<T>, deadline = preparationDeadline) {
      const begin = performance.now(), remaining = Math.min(budgetMs, Math.max(0, deadline - begin));
      if (remaining <= 0) throw new Error("默认样张阶段预算已用尽：" + name);
      let exceeded = false; const timer = setTimeout(() => { exceeded = true; }, remaining);
      try {
        const value = await operation();
        if (exceeded || performance.now() - begin > remaining) throw new Error("默认样张阶段超过预算：" + name);
        phases.push({ name, budgetMs: remaining, exit: 0, seconds: (performance.now() - begin) / 1000, ownedOperationSettled: true }); return value;
      } catch (cause) {
        phases.push({ name, budgetMs: remaining, exit: 1, seconds: (performance.now() - begin) / 1000, ownedOperationSettled: true, message: cause instanceof Error ? cause.message : "阶段失败" }); throw cause;
      } finally { clearTimeout(timer); await writeFile(join(directory, "phase-budget-receipt.json"), JSON.stringify(phases, null, 2)); }
    }
    try {
      const prepared = await phase("public-upload-create-map-inspect-queue", 10_000, async () => {
        server = await createTemplateTestServer();
        const base = await server.app.getUrl();
        const account = { phone: server.actors[0].phone, password: server.password };
        const login = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(account) }); expect(login.status).toBe(201);
        const token = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
        const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
        const request = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const docx = await readFile("/private/tmp/jg-task10-current-lo-profile-20261108-lxyjmksl/tmp/jg-task10-default-layout-preview-azCWtF/source.docx");
        expect(sha(docx)).toBe("c99a5f07f90e7c6f569333208525e2185b42194eb21728661391962a2eedc355");
        await writeFile(join(directory, "source.docx"), docx);
        const form = new FormData(); form.append("file", new Blob([new Uint8Array(docx)]), "默认版式两页真实源.docx");
        const upload = await fetch(base + "/files", { method: "POST", headers: { authorization: "Bearer " + token }, body: form }); expect(upload.status).toBe(201);
        const file = await upload.json() as { id: string };
        const templateName = "默认样张两页兼容检查";
        const created = await request("/contract-layout-templates", "POST", { name: templateName, contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }); expect(created.status).toBe(201);
        const value = await created.json() as { template: { id: string }; version: { id: string } };
        const path = "/contract-layout-template-versions/" + value.version.id;
        const positions = await request(path + "/source-positions"); expect(positions.status).toBe(200);
        const source = await positions.json() as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
        expect(source.sourceSha256).toBe(sha(docx));
        const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
        const bindings = source.positions.slice(0, 5).map((position, i) => ({ positionId: position.positionId, start: i === 0 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
        for (const [index, fieldKey] of [[7, "party.owner.name"], [8, "party.counterparty.name"]] as const) { const position = source.positions[index]; bindings.push({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey }); }
        const mapping = await request(path + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }); expect(mapping.status).toBe(200);
        expect((await request(path + "/inspection", "POST")).status).toBe(201);
        const queued = await request(path + "/preview-generation", "POST", { contract: { name: "默认样张兼容合同", temporaryCode: "DEFAULT-2P" }, party: { owner: { name: "兼容甲方" }, counterparty: { name: "兼容乙方" } }, document: { watermark: "样张" } }); expect(queued.status).toBe(201);
        const job = await queued.json() as Preview; expect(job).toMatchObject({ status: "queued", sourceRevision: 2 });
        return { base, request, account, templateName, templateId: value.template.id, versionId: value.version.id, path, source, docx, job };
      });
      const workerUploads = jest.spyOn(server!.files, "uploadPrivateFile");
      const auditCalls = jest.spyOn(server!.moduleRef.get(AuditService), "record");
      const output = await phase("one-real-layout-preview-worker", 130_000, async () => {
        expect(await server!.processor.processNext()).toBe(true);
        const response = await prepared.request(prepared.path + "/preview-generation"); expect(response.status).toBe(200);
        const result = await response.json() as Preview;
        await writeFile(join(directory, "worker-observation.json"), JSON.stringify({ result, workerUploadCalls: workerUploads.mock.calls.length, sourceSha256: sha(prepared.docx), native: runtime.converter.native, runtimeManifest: runtimePath, classification: "OBSERVATION_ONLY_PHYSICAL_NOT_YET_CHECKED" }, null, 2));
        expect(result).toMatchObject({ id: prepared.job.id, status: "failed", sourceRevision: 2, errorMessage: "合同 PDF 字体输出异常，请联系管理员核对转换服务字体后重试" });
        expect(result.previewPdfFileId).toBeUndefined();
        expect(workerUploads).toHaveBeenCalledTimes(0);
        const jobAudits = auditCalls.mock.calls.map(call => call[1]).filter(event => event.businessId === result.id);
        expect(jobAudits.filter(event => event.action === "contract.layout_preview.failure")).toHaveLength(1);
        expect(jobAudits.filter(event => event.action === "contract.layout_preview.success")).toHaveLength(0);
        const maintained = await prepared.request("/contract-layout-templates/" + prepared.templateId); expect(maintained.status).toBe(200);
        const detail = await maintained.json() as { versions: Array<{ id: string; draftRevision: number; status: string; previewPdfFileId: string | null; latestPreview: Preview | null }> };
        const version = detail.versions.find(version => version.id === prepared.versionId);
        expect(version).toMatchObject({ draftRevision: 2, status: "draft", previewPdfFileId: null });
        expect(version!.latestPreview).toMatchObject({ id: result.id, status: "failed", sourceRevision: 2 });
        expect(version!.latestPreview!.previewPdfFileId).toBeUndefined();
        await writeFile(join(directory, "B-failclosed-public.json"), JSON.stringify({ job: result, version, workerUploadCalls: workerUploads.mock.calls.length, sourceSha256: sha(prepared.docx), originalActualBlankPdf: "b04a69bdad4b427c400abf79f1bd35bcdd29d65d10a013988c423082ff2ff858", scope: "Actual public job and maintained-version failure; no worker private upload or successful PDF reference; no download ticket invented for null file" }, null, 2));
        return result;
      });
      expect(output.status).toBe("failed");
      for (const file of [runtime.fontconfig, runtime.converter.wrapper, runtime.converter.native, ...runtime.fonts]) expect(sha(await readFile(file.path))).toBe(file.sha256);
    } catch (cause) {
      const error = cause as { message?: string; stdout?: string; stderr?: string }; await writeFile(join(directory, "failure.txt"), `${error.message ?? "默认样张失败"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      throw new Error("默认样张实际链失败，保留证据 " + directory, { cause });
    } finally {
      if (server) await phase("cleanup", 10_000, async () => { await server!.processor.onApplicationShutdown(); await server!.app.close(); }, performance.now() + 10_000);
    }
  }, 190_000);
});

import { runFrozenPendingLoCase } from "./task10-lo-frozen-pending.test-support";
describe("task10 historical pending LO output", () => {
  it.each(["legacy", "offline"] as const)("checks %s pending output through public facts and actual worker", async kind => {
    await runFrozenPendingLoCase(kind);
  }, 190_000);
});
