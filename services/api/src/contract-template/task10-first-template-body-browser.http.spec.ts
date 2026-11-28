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

describe("task10 first saved template selection opens current body without reload", () => {
  it("opens editable current template paragraphs after the first no-regeneration selection acknowledgement", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-first-template-body-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-first-template-body-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials", "material_purchase", "首次选用材料合同");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase")).status).toBe(200);
      const rows = [{ clientRowKey: "first-template-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const workbenchResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(workbenchResponse.status).toBe(200);
      const workbench = await workbenchResponse.json();
      expect(workbench.version).toMatchObject({ numericProtocolVersion: 2, layoutTemplateVersionId: null, amountYuan: "6.5000" });
      expect(workbench.version.draftData.documentBody).toBeUndefined();
      expect(workbench.version.draftData.documentBodyAction).toBeUndefined();
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(400);
      expect((await bodyResponse.json()).message).toBe("请先选择并保存合同模板，再查看完整正文");
      const catalogResponse = await fetch(`${await server.app.getUrl()}/contract-layout-templates?contractTypeKey=material_purchase`, { headers: draft.headers });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json();
      expect(catalog).toEqual([expect.objectContaining({ name: "首次选用材料合同", layoutTemplateVersionId: layout.id, contractTypeKey: "material_purchase" })]);
      await writeFile(join(directory, "public-unselected-precondition.json"), JSON.stringify({ layout: layout.id, sourceSha256: layout.sha256, catalog, draftRevision: workbench.version.draftRevision, amountYuan: workbench.version.amountYuan, selectedLayout: workbench.version.layoutTemplateVersionId, scope: "syntheticpublishedimmutable44be fixture, notactualpublication" }, null, 2));
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-first-template-body.config.ts", "--project=desktop", "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id } }, layout, sourceSha256: layout.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10首次选模板后刷新前正文真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10首次选模板正文浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
