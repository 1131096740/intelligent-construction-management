import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = process.env.PROJECT_SCOPE_API ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || !process.env.PROJECT_SCOPE_SESSIONS) throw new Error("项目范围浏览器测试仅允许本机合成会话");

export default defineConfig({
  testDir: "./e2e", testMatch: "project-business-scope-real.e2e.ts", timeout: 60_000, workers: 1, retries: 0, reporter: "line",
  outputDir: join(tmpdir(), `project-business-scope-browser-${randomUUID()}`),
  use: { baseURL: "http://127.0.0.1:4237", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 4237 --strictPort", url: "http://127.0.0.1:4237", reuseExistingServer: false, env: { VITE_API_PROXY_TARGET: api } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
