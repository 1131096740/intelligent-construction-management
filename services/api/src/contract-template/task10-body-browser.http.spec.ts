import { task10HttpRepository } from "./task10-http-repository.test-support";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

describe("task10 complete body real responsive editor", () => {
  it("uses authenticated public HTTP and actual desktop/mobile editing against synthetic persistence", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-body-browser-"));
    const sourcePaths = ["services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-template/task10-body-browser.http.spec.ts"];
    await writeFile(join(directory, "backend-startup-source.json"), JSON.stringify(await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(repository, path))).digest("hex") }))), null, 2));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const layout = await confirmedBodyLayout(server);
      const drafts: Record<string, { contract: { id: string }; version: { id: string } }> = {};
      for (const project of ["desktop", "mobile"]) {
        const draft = await createTask09Draft(server);
        expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
        // The seed writer owns a real lease. Hand it back through the public
        // command before the browser establishes its own independent session.
        const released = await fetch(`${draft.base}/edit-lease`, { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
        expect(released.status).toBe(200);
        expect(await released.json()).toMatchObject({ released: true });
        const available = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
        expect(available.lease.state).toBe("available");
        drafts[project] = { contract: { id: draft.contract.id }, version: { id: draft.version.id } };
      }
      const environment = { ...process.env }; delete environment.JEST_WORKER_ID;
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-body.config.ts", "--max-failures=1"], {
        cwd: repository, env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"), TASK10_BODY_BROWSER_INPUT: JSON.stringify({ drafts, staff: { phone: server.actors[1].phone, password: server.password } }) }, timeout: 220_000, maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      console.info(`任务10真实正文编辑双端证据：${directory}`);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(directory, "browser-failure.log"), output);
      throw new Error(`任务10真实正文编辑失败，证据 ${directory}\n${output}`, { cause });
    } finally { await server.app.close(); }
  }, 250_000);
});
