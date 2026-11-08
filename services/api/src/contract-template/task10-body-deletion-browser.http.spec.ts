import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 saved addition deletion real responsive body UI", () => {
  it("offers deletion of one saved addition after formal body and a separate manual clause are verified", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-body-deletion-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-body-deletion-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      const layout = await confirmedBodyLayout(server, source, "materials");
      const drafts: Record<string, { contract: { id: string }; version: { id: string }; additionId: string }> = {};
      for (const project of ["desktop", "mobile"]) {
        const draft = await createTask09Draft(server);
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        const rows = [{ clientRowKey: "table-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
        const saved = await saveBody(draft, undefined, "当前单甲方", rows);
        expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
        const bodyResponse = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
        expect(bodyResponse.status).toBe(200);
        const body = await bodyResponse.json() as { sourceSha256: string; blocks: Array<{ id: string; editable: boolean; text: string }> };
        expect(body.sourceSha256).toBe(layout.sha256);
        const ordinary = body.blocks.find(block => block.editable && block.text.includes("4.若卖方违背"));
        expect(ordinary).toBeDefined();
        const additionId = "saved-addition-" + project;
        const manual = await saveBody(draft, {
          protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
          edits: [{ positionId: ordinary!.id, text: ordinary!.text + "原有人工条款需保留。" }],
          additions: [{ id: additionId, afterPositionId: ordinary!.id, text: "待删除新增条款：检验后不再保留本段。" }]
        }, "当前单甲方", rows);
        expect(manual.status === 200 ? "OK" : await manual.text()).toBe("OK");
        const released = await fetch(`${draft.base}/edit-lease`, { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
        expect(released.status).toBe(200);
        expect(await released.json()).toMatchObject({ released: true });
        drafts[project] = { contract: { id: draft.contract.id }, version: { id: draft.version.id }, additionId };
      }
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const args = ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-body-deletion.config.ts", "--grep", "删除已保存新增条款后保留其他人工正文$", "--max-failures=1"];
      const result = await promisify(execFile)("pnpm", args, {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ drafts, sourceSha256: layout.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10删除新增条款真实双端证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10删除新增条款浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});

describe("task10 original ordinary paragraph deletion real responsive UI", () => {
  it("deletes an original editable paragraph through public save reload and same-revision Word PDF", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-original-paragraph-deletion-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      const layout = await confirmedBodyLayout(server, source, "materials");
      const drafts: Record<string, Awaited<ReturnType<typeof createTask09Draft>> & { targetId: string; retainedId: string; additionId: string }> = {};
      const before: Record<string, { body: { blocks: Array<{ id: string; editable: boolean; text: string }>; paragraphGroups: string[][]; flow: Array<{ kind: string; paragraphId?: string }> }; facts: Record<string, unknown> }> = {};
      for (const project of ["desktop", "mobile"]) {
        const draft = await createTask09Draft(server);
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        const rows = [{ clientRowKey: "ordinary-delete-row", sortOrder: 0, itemName: "删除段落守恒钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
        expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
        const initial = await fetch(draft.base + "/document-body", { headers: draft.headers }).then(response => response.json());
        const topLevel = new Set(initial.flow.filter((node: { kind: string }) => node.kind === "paragraph").map((node: { paragraphId: string }) => node.paragraphId));
        const target = initial.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.includes("4.若卖方违背"));
        const retained = initial.blocks.find((block: { id: string; editable: boolean; text: string }) => block.editable && topLevel.has(block.id) && block.id !== target.id && block.text.length > 20);
        expect(target).toBeDefined(); expect(retained).toBeDefined();
        const additionId = "keep-original-delete-" + project;
        const order = initial.paragraphGroups.flat() as string[];
        const reorderGroup = initial.paragraphGroups.find((group: string[]) => group.filter(id => id !== target.id).length >= 2) as string[];
        expect(reorderGroup).toBeDefined(); const reorder = reorderGroup.filter(id => id !== target.id).slice(0, 2); const first = order.indexOf(reorder[0]), second = order.indexOf(reorder[1]);
        [order[first], order[second]] = [order[second], order[first]];
        const plan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
          edits: [{ positionId: target.id, text: target.text + "原段删除目标文字。" }, { positionId: retained.id, text: retained.text + "其他人工正文必须保留。" }],
          additions: [{ id: additionId, afterPositionId: retained.id, text: "保留的新增条款内容。" }], paragraphOrder: order };
        const saved = await saveBody(draft, plan, "当前单甲方", rows); expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
        const body = await fetch(draft.base + "/document-body", { headers: draft.headers }).then(response => response.json());
        const facts = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json()); expect(facts.version.amountYuan).toBe("6.5000");
        before[project] = { body, facts }; drafts[project] = { ...draft, targetId: target.id, retainedId: retained.id, additionId };
        const release = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" }); expect(release.status).toBe(200);
      }
      await writeFile(join(directory, "public-before-gui.json"), JSON.stringify({ layout, before, sourceSha256: layout.sha256 }, null, 2));
      Object.defineProperty(server, "store", { get() { throw new Error("GUI准备已封，删除消费必须经公有HTTP"); } });
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-body-deletion.config.ts", "--grep", "删除原有普通条款后保存重读并保留其他内容$", "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ drafts, sourceSha256: layout.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      const outputs = [];
      for (const project of ["desktop", "mobile"]) {
        const draft = drafts[project];
        const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200); const body = await bodyResponse.json();
        const factsResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(factsResponse.status).toBe(200); const facts = await factsResponse.json();
        expect(body.blocks).toEqual(before[project].body.blocks.filter(block => block.id !== draft.targetId).map((block: { id: string }, index: number) => block.id.startsWith("generated:") ? { ...block, id: `generated:${index}` } : block));
        expect(facts.version.amountYuan).toBe("6.5000"); expect(facts.version.draftData.documentBody.deletedPositionIds).toContain(draft.targetId);
        const queue = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: facts.version.draftRevision }) }); expect(queue.status).toBe(201); const queued = await queue.json();
        expect(queued).toMatchObject({ documentContentRevision: facts.version.documentContentRevision, documentContentFingerprint: facts.version.documentContentFingerprint });
        const started = performance.now(); expect(await server.processor.processNext()).toBe(true); expect(performance.now() - started).toBeLessThanOrEqual(130000);
        const list = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers }); expect(list.status).toBe(200);
        const output = (await list.json()).find((job: { id: string }) => job.id === queued.generationId); expect(output).toMatchObject({ status: "success", documentContentRevision: queued.documentContentRevision, documentContentFingerprint: queued.documentContentFingerprint });
        const pair: Partial<Record<"docx" | "pdf", Buffer>> = {};
        for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
          const ticket = await fetch((await server.app.getUrl()) + "/files/" + id + "/download-ticket", { method: "POST", headers: draft.headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对原普通段落真实删除及同修订导出" }) }); expect(ticket.status).toBe(201); const value = await ticket.json();
          const response = await fetch((await server.app.getUrl()) + value.downloadUrl); expect(response.status).toBe(200); pair[format] = Buffer.from(await response.arrayBuffer()); await writeFile(join(directory, project + "." + format), pair[format]!);
        }
        const word = new DOMParser().parseFromString(new PizZip(pair.docx!).file("word/document.xml")!.asText(), "application/xml"); const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")); expect(paragraphs.length).toBe(body.blocks.length); expect(body.blocks.length).toBe(before[project].body.blocks.length - 1);
        const text = paragraphs.map(paragraph => Array.from(paragraph.getElementsByTagNameNS(ns, "t")).map(node => node.textContent ?? "").join("")).join("");
        const drawn = inspectActualTemplatePdf(pair.docx!, pair.pdf!, "task10-original-paragraph-deletion-" + project, output.inputSnapshot.inspection.runtime).replace(/\s/gu, "");
        for (const value of ["原段删除目标文字。", "4.若卖方违背"]) { expect(text).not.toContain(value); expect(drawn).not.toContain(value); }
        for (const value of ["其他人工正文必须保留。", "保留的新增条款内容。", "删除段落守恒钢材", "6.5000", "当前单甲方", "当前单乙方"]) { expect(text).toContain(value); expect(drawn).toContain(value); }
        expect(Array.from(word.getElementsByTagNameNS(ns, "tbl"))).toHaveLength(2);
        outputs.push({ project, facts, body, output, wordParagraphCount: paragraphs.length, actualWholeParagraphRemovedNotCleared: true });
      }
      await writeFile(join(directory, "public-saved-and-exported.json"), JSON.stringify({ layout, before, outputs }, null, 2));
      console.info("原普通段删除GUI与双格式证据：" + directory);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string }; await writeFile(join(directory, "failure.txt"), String(cause instanceof Error ? cause.stack : cause)); await writeFile(join(directory, "browser-failure.log"), (failure.stdout ?? "") + "\n" + (failure.stderr ?? "")); throw new Error("原普通段删除纵向失败，证据 " + directory, { cause });
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  }, 250_000);
});
