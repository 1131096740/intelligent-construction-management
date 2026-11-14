import { defineConfig, devices } from "@playwright/test";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const allowedApps = new Set([
  "/private/tmp/jg-382-task10-final-integration-20261108/apps/web-admin"
]);
if (!allowedApps.has(realpathSync(process.cwd())) || realpathSync(fileURLToPath(new URL(".", import.meta.url))) !== realpathSync(process.cwd())) throw new Error("冷纸面检查仅允许准确任务10或集成应用目录");
const linkedWorkerConfig = process.env.TASK10_LINKED_PDF_WORKER_CONFIG;
if (linkedWorkerConfig && linkedWorkerConfig !== "/private/tmp/jg-task10-final-integration-preparation-20261108/linked-worker/vite-linked-worker.config.mts") throw new Error("正文纸面检查需要准确隔离依赖配置");
const viteConfigOption = linkedWorkerConfig ? ` --config ${linkedWorkerConfig}` : "";

const port = 54829;
export default defineConfig({
  testDir: "./e2e", testMatch: "task10-paper-mobile-cold.e2e.ts", timeout: 90_000,
  expect: { timeout: 10_000 }, workers: 1, retries: 0, reporter: [["list"]],
  outputDir: process.env.TASK10_COLD_BROWSER_OUTPUT,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "off" },
  webServer: { command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort${viteConfigOption}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }]
});
