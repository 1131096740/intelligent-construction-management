import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

describe("task10 full reviewed labor source actual dual-format export", () => {
  it("preserves all three original fullwidth comma contexts through public generation and actual PDF drawings", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("完整劳务实物检查需要显式锁定物理检查运行环境");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-labor-export-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile"); // Approved public file interface; real implementation stays active.
    try {
      const source = await readFile(resolve(__dirname, "../../../../scripts/probes/task08-documents/samples/labor-subcontract-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("faae3cebc8e377764df12e999bcfddb1beefe6958cb728175f33f8e6fa4a187f");
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      // Deterministic synthetic system fact: the random draft code must not
      // alter wrapping between the fixed LO control and the new converter.
      await server.store.prisma.contract.update({ where: { id: draft.contract.id }, data: { temporaryCode: "草稿-完整劳务标点-001" } });
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const rows = [1, 2, 3].map(index => ({ clientRowKey: `labor-${index}`, sortOrder: index - 1, itemName: `完整劳务行00${index}`, unit: "项", quantity: String(index), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const saved = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body & { draftRevision: number };
      upload.mockClear();
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json() as { generationId: string; documentContentRevision: number; documentContentFingerprint: string };
      const injectedParent: Record<string, string> = process.env.TASK10_INJECT_PARENT_RUNTIME_ENV === "1" ? {
        JAVA_TOOL_OPTIONS: `-agentpath:${join(directory, "must-not-load-agent.dylib")}`,
        JDK_JAVA_OPTIONS: `-Duser.home=${join(directory, "must-not-use-home")}`,
        _JAVA_OPTIONS: `-agentpath:${join(directory, "must-not-load-agent.dylib")}`,
        CLASSPATH: join(directory, "must-not-use-classpath"),
        DYLD_INSERT_LIBRARIES: join(directory, "must-not-load-agent.dylib"),
        LD_PRELOAD: join(directory, "must-not-load-agent.dylib"),
        FONTCONFIG_FILE: join(directory, "must-not-use-fontconfig"),
        DOC_CONVERTER_COMMAND: join(directory, "must-not-use-lo")
      } : {};
      if (Object.keys(injectedParent).length) await expect(lstat(join(directory, "must-not-load-agent.dylib"))).rejects.toMatchObject({ code: "ENOENT" });
      const previousEnvironment = Object.fromEntries(Object.keys(injectedParent).map(key => [key, process.env[key]]));
      for (const [key, value] of Object.entries(injectedParent)) process.env[key] = value;
      try { expect(await server.processor.processNext()).toBe(true); }
      finally {
        for (const [key, value] of Object.entries(previousEnvironment)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
      const listed = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }).then(response => response.json()) as Array<{ id: string; status: string; docxFileId: string; pdfFileId: string; inputSnapshot?: { inspection?: { runtime?: unknown } } }>;
      const output = listed.find(output => output.id === generation.generationId)!;
      expect(output).toMatchObject({ status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      if (Object.keys(injectedParent).length) expect(output.inputSnapshot?.inspection?.runtime).toMatchObject({ childEnvironmentKeys: ["LANG", "LC_ALL", "PATH", "TMPDIR"], boundaryDenials: 3, conversionCalls: 1 });
      const files: Partial<Record<"docx" | "pdf", Buffer>> = {};
      for (const [format, fileId] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${fileId}/download-ticket`, { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "完整劳务原Word标点及实际PDF绘制核验" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json() as { downloadUrl: string };
        const response = await fetch(`${await server.app.getUrl()}${downloadUrl}`); expect(response.status).toBe(200);
        files[format] = Buffer.from(await response.arrayBuffer()); await writeFile(join(directory, `actual.${format}`), files[format]!);
      }
      const zip = new PizZip(files.docx!);
      const members = Object.values(zip.files).filter(file => !file.dir).map(file => ({ name: file.name, sha256: createHash("sha256").update(file.asNodeBuffer()).digest("hex") })).sort((left, right) => left.name.localeCompare(right.name));
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ sourceSha256: layout.sha256, generation, output, members,
        docxSha256: createHash("sha256").update(files.docx!).digest("hex"), pdfSha256: createHash("sha256").update(files.pdf!).digest("hex"), verdict: "PENDING" }, null, 2));
      if (process.env.TASK10_LABOR_BASELINE_RECEIPT) expect(members).toEqual(JSON.parse(await readFile(process.env.TASK10_LABOR_BASELINE_RECEIPT, "utf8")).members);
      inspectActualTemplatePdf(files.docx!, files.pdf!, "task10-full-reviewed-labor", output.inputSnapshot?.inspection?.runtime);
      const read = await promisify(execFile)(python, ["-c", "import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); pages=[''.join(chr(c[0]) for s in p.get_texttrace() for c in s['chars']) for p in d]; out={'pageCount':len(d),'drawnTextByPage':pages}; open(sys.argv[2],'x').write(json.dumps(out,ensure_ascii=False,indent=2)); print(json.dumps(out,ensure_ascii=False))", join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const drawings = JSON.parse(read.stdout) as { pageCount: number; drawnTextByPage: string[] };
      const text = drawings.drawnTextByPage.join("").replace(/\s/gu, "");
      for (const literal of ["公司审批后方可生效，否则不予作为最终结算依据。", "所有工序、工艺，若乙方报价", "向甲方汇报，48小时"]) expect(text).toContain(literal);
      for (const index of [1, 2, 3]) expect(text).toContain(`完整劳务行00${index}`);
      expect(drawings.pageCount).toBeGreaterThan(5);
      expect(upload.mock.calls.length).toBe(2);
      expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      expect(createHash("sha256").update(upload.mock.calls[0][0].buffer).digest("hex")).toBe(createHash("sha256").update(files.docx!).digest("hex"));
      expect(createHash("sha256").update(upload.mock.calls[1][0].buffer).digest("hex")).toBe(createHash("sha256").update(files.pdf!).digest("hex"));
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "GREEN", pageCount: drawings.pageCount,
        injectedParentKeys: Object.keys(injectedParent).sort(),
        uploads: upload.mock.calls.map(([input]) => ({ mimeType: input.mimeType, sha256: createHash("sha256").update(input.buffer).digest("hex") })) }, null, 2));
      console.info(`任务10完整劳务实际标点证据：${directory}`);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error(`任务10完整劳务实际检查失败，证据 ${directory}`, { cause });
    } finally { upload.mockRestore(); await server.app.close(); }
  }, 150_000);
});
