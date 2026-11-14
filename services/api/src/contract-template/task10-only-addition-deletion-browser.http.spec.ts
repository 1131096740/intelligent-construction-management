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

describe("task10 only saved manual addition deletion real body UI", () => {
  it("saves an explicit deletion of the sole manual addition without erasing original template clauses", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-only-addition-deletion-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-only-addition-deletion-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      const layout = await confirmedBodyLayout(server, source, "materials");
      const drafts: Record<string, { contract: { id: string }; version: { id: string }; additionId: string; originalOrdinaryText: string }> = {};
      for (const project of ["desktop"]) {
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
        const additionId = "only-saved-addition-" + project;
        const manual = await saveBody(draft, {
          protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
          edits: [],
          additions: [{ id: additionId, afterPositionId: ordinary!.id, text: "唯一新增手工条款：本次明确删除本段。" }]
        }, "当前单甲方", rows);
        expect(manual.status === 200 ? "OK" : await manual.text()).toBe("OK");
        const released = await fetch(`${draft.base}/edit-lease`, { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
        expect(released.status).toBe(200);
        expect(await released.json()).toMatchObject({ released: true });
        drafts[project] = { contract: { id: draft.contract.id }, version: { id: draft.version.id }, additionId, originalOrdinaryText: ordinary!.text };
      }
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const args = ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-only-addition-deletion.config.ts", "--project=desktop", "--max-failures=1"];
      const result = await promisify(execFile)("pnpm", args, {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ drafts, sourceSha256: layout.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10删除唯一新增条款真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10删除唯一新增条款浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
