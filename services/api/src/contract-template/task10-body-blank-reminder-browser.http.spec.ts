import { task10HttpRepository } from "./task10-http-repository.test-support";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

type MarkerParagraph = { id: string; text: string; editable: boolean; blankFields: string[] };

describe("task10 optional ordinary body blank reminder real UI", () => {
  it("edits one marker, preserves another and confirms only the current saved revision without submitting", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-body-blank-reminder-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-body-blank-reminder-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const zip = new PizZip(syntheticWordSource(true));
      const xml = zip.file("word/document.xml")!.asText();
      expect(xml).toContain("交货地点：合成工地");
      expect(xml).toContain("手工条款：本项普通约定按原文保留。");
      zip.file("word/document.xml", xml.replace("交货地点：合成工地", "交货地点：{交货地点}").replace("手工条款：本项普通约定按原文保留。", "验收地点：{验收地点}"));
      const source = zip.generate({ type: "nodebuffer" });
      const layout = await confirmedBodyLayout(server, source, undefined, "material_purchase", "附加空位确认样张");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "optional-blank-row", sortOrder: 0, itemName: "合成钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveBody(draft, undefined, "当前单甲方", rows)).status).toBe(200);
      const workbenchResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(workbenchResponse.status).toBe(200);
      const workbench = await workbenchResponse.json();
      expect(workbench.version).toMatchObject({ numericProtocolVersion: 2, layoutTemplateVersionId: layout.id, amountYuan: "6.5000" });
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as { sourceSha256: string; layoutTemplateVersionId: string; draftRevision: number; blocks: MarkerParagraph[] };
      expect(body).toMatchObject({ sourceSha256: layout.sha256, layoutTemplateVersionId: layout.id, draftRevision: workbench.version.draftRevision });
      const delivery = body.blocks.find(block => block.text === "交货地点：【待补充：交货地点】");
      const acceptance = body.blocks.find(block => block.text === "验收地点：【待补充：验收地点】");
      expect(delivery).toMatchObject({ editable: true, blankFields: ["交货地点"] });
      expect(acceptance).toMatchObject({ editable: true, blankFields: ["验收地点"] });
      expect(body.blocks.filter(block => block.editable && block.blankFields.length)).toHaveLength(2);
      expect(body.blocks.find(block => block.text === "甲方：当前单甲方")).toMatchObject({ editable: false });
      expect(body.blocks.find(block => block.text === "乙方：当前单乙方")).toMatchObject({ editable: false });
      await writeFile(join(directory, "public-marker-preconditions.json"), JSON.stringify({ layout, sourceSha256: layout.sha256, draftRevision: body.draftRevision, amountYuan: workbench.version.amountYuan, delivery, acceptance, scope: "two optional ordinary placeholders in actual synthetic DOCX; no formal template publication/44be/table/font claim" }, null, 2));
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200);
      expect(await released.json()).toMatchObject({ released: true });
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const project = process.env.TASK10_BODY_BLANK_PROJECT ?? "desktop";
      if (project !== "desktop" && project !== "mobile") throw new Error("正文空位浏览器项目仅允许desktop或mobile");
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-body-blank-reminder.config.ts", `--project=${project}`, "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ draft: { contract: { id: draft.contract.id }, version: { id: draft.version.id } }, layout, sourceSha256: layout.sha256, deliveryId: delivery!.id, acceptanceId: acceptance!.id, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10正文附加空位提醒真实${project}证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10正文空位浏览器检查失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
