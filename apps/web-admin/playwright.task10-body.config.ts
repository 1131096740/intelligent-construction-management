import { defineConfig, devices } from "@playwright/test";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = realpathSync(fileURLToPath(new URL(".", import.meta.url)));
if (appDirectory !== realpathSync(process.cwd())) throw new Error("完整正文浏览器检查需要当前源码对应的应用目录");
const repository = realpathSync(resolve(appDirectory, "../.."));
const workspacePackage = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
const appPackage = JSON.parse(readFileSync(join(appDirectory, "package.json"), "utf8"));
if (workspacePackage.name !== "jiangkong" || appPackage.name !== "@jiangkong/web-admin") throw new Error("完整正文浏览器检查需要建工智管 Web应用源码目录");

const linkedWorkerConfig = process.env.TASK10_LINKED_PDF_WORKER_CONFIG;
if (linkedWorkerConfig && linkedWorkerConfig !== "/private/tmp/jg-task10-final-integration-preparation-20261108/linked-worker/vite-linked-worker.config.mts") throw new Error("正文纸面检查需要准确隔离依赖配置");
const viteConfigOption = linkedWorkerConfig ? ` --config ${linkedWorkerConfig}` : "";

const port = 54823;
export default defineConfig({
  testDir: "./e2e", testMatch: "task10-body.e2e.ts", timeout: 90_000,
  expect: { timeout: 10_000 }, workers: 1, retries: 0, reporter: [["list"]],
  outputDir: process.env.TASK10_BODY_BROWSER_OUTPUT,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: { command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort${viteConfigOption}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
