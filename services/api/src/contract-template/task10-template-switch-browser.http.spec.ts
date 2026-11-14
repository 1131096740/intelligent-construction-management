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

describe("task10 explicit selected template replacement real UI", () => {
  it("confirms overwrite only when choosing another eligible record and consumes its regeneration action before the next nonbody save", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-template-switch-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-template-switch-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      // Existing immutable published synthetic fixture, not template-publication acceptance.
      const original = await confirmedBodyLayout(server, source, "materials", "material_purchase", "原版材料合同");
      const alternative = await confirmedBodyLayout(server, source, "materials", "material_purchase", "备选材料合同");
      expect(original.id).not.toBe(alternative.id);
      expect(original.sha256).toBe(alternative.sha256);
      const clean = await createTask09Draft(server);
      const catalogResponse = await fetch(`${await server.app.getUrl()}/contract-layout-templates?contractTypeKey=material_purchase`, { headers: clean.headers });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json();
      expect(catalog).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "原版材料合同", layoutTemplateVersionId: original.id, contractTypeKey: "material_purchase" }),
        expect.objectContaining({ name: "备选材料合同", layoutTemplateVersionId: alternative.id, contractTypeKey: "material_purchase" })
      ]));
      const qualified = await saveTask09Draft(server, clean, "material_purchase", alternative.id);
      expect(qualified.status === 200 ? "OK" : await qualified.text()).toBe("OK");
      const cleanBodyResponse = await fetch(clean.base + "/document-body", { headers: clean.headers });
      expect(cleanBodyResponse.status).toBe(200);
      const cleanBody = await cleanBodyResponse.json();
      expect(cleanBody).toMatchObject({ layoutTemplateVersionId: alternative.id, sourceSha256: original.sha256 });
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", original.id)).status).toBe(200);
      const rows = [{ clientRowKey: "switch-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json();
      const ordinary = body.blocks.find((block: { editable: boolean; text: string }) => block.editable && block.text.startsWith("4.若卖方违背"));
      expect(ordinary).toBeDefined();
      const additionId = "template-switch-saved-addition";
      expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: original.id, sourceSha256: original.sha256,
        edits: [{ positionId: ordinary.id, text: ordinary.text + "原有人工条款需保留。" }],
        additions: [{ id: additionId, afterPositionId: ordinary.id, text: "更换模板前已保存的新增约定。" }]
      }, "当前单甲方", rows)).status).toBe(200);
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      await writeFile(join(directory, "public-alternative-eligibility.json"), JSON.stringify({ catalog, cleanBodyLayout: cleanBody.layoutTemplateVersionId, cleanBodySource: cleanBody.sourceSha256, sourceScope: "same44be/independent syntheticpublishedrecords; notdifferentWordsource or actualpublication" }, null, 2));
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-template-switch.config.ts", "--project=desktop", "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id }, additionId, ordinaryId: ordinary.id, originalOrdinaryText: ordinary.text }, original, alternative, sourceSha256: original.sha256, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10同源记录换模板覆盖确认真实桌面证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10换模板覆盖浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
