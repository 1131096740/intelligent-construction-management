import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";

describe("template UI against actual local HTTP services", () => {
  it("runs the real browser without business request interception or browser data fixtures", async () => {
    const server = await createTemplateTestServer();
    const artifactDirectory = await mkdtemp(join(tmpdir(), "jg-enterprise-task11-browser-"));
    const sourcePath = join(artifactDirectory, "source.docx");
    await writeFile(sourcePath, syntheticWordSource(true));
    server.processor.onApplicationBootstrap();
    const childEnvironment = { ...process.env };
    delete childEnvironment.JEST_WORKER_ID;
    try {
      const result = await promisify(execFile)("pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task11.config.ts"], {
        cwd: resolve(__dirname, "../../../.."),
        env: { ...childEnvironment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TEMPLATE_BROWSER_ACCOUNT: JSON.stringify({ phone: server.actors[0].phone, password: server.password }), TEMPLATE_BROWSER_SOURCE: sourcePath, TEMPLATE_BROWSER_OUTPUT: join(artifactDirectory, "browser") },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024
      });
      await writeFile(join(artifactDirectory, "browser.log"), result.stdout + result.stderr);
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string };
      const output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      await writeFile(join(artifactDirectory, "browser-failure.log"), output);
      throw new Error(`真实浏览器失败，收据目录 ${artifactDirectory}\n${output}`, { cause });
    } finally {
      await server.processor.onApplicationShutdown();
      await server.app.close();
    }
  }, 130_000);
});
