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

const paragraphA = "463ab1e5ff371f1eb9cf8636c0e3cdf9a11e929e439a57cc07f0df5ffeb251f1";
const paragraphB = "78794bb119e7439510ea23f117cc494318f0dd5730b6d7caa4c444a6fc2d7361";
const originalA = "1.买卖双方应就合同履行中有关的事项及时进行联络，重要事项应通过书面形式进行联络。";
const originalB = "2.书面形式指合同文件、信件和数据电文（包括传真、电子数据交换和电子邮件）等可以有形地表现所载内容的形式。";

describe("task10 ordinary paragraph within-group reorder real UI", () => {
  it("moves the second ordinary paragraph above its adjacent peer without losing edits or hidden group IDs", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-paragraph-reorder-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-paragraph-reorder-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "reorder-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const initialResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json();
      expect(initial.sourceSha256).toBe(layout.sha256);
      expect(initial.blocks.find((block: { id: string }) => block.id === paragraphA)).toMatchObject({ editable: true, text: originalA });
      expect(initial.blocks.find((block: { id: string }) => block.id === paragraphB)).toMatchObject({ editable: true, text: originalB });
      const group = initial.paragraphGroups.find((items: string[]) => items.includes(paragraphA));
      expect(group).toEqual(["ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", paragraphA, paragraphB, "7551ee090ac74d72775135f4316553b4d0a353c2dccfd369ef996be28bcbf85d"]);
      const manualA = originalA + "人工补充：联络后保留书面记录。";
      expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: paragraphA, text: manualA }] }, "当前单甲方", rows)).status).toBe(200);
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      const drafts = { desktop: { contract: { id: draft.contract.id }, version: { id: draft.version.id }, paragraphA, paragraphB, originalA, originalB, manualA } };
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-paragraph-reorder.config.ts", "--project=desktop", "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ drafts, sourceSha256: layout.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10普通条款同组调位真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10普通条款调位浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
