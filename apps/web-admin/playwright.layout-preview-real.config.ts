import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const api = process.env.LAYOUT_PREVIEW_API_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) throw new Error("版式浏览器验收仅允许本机隔离 API");
export default defineConfig({
  testDir: "./e2e", testMatch: "layout-preview-real.e2e.ts", timeout: 60_000,
  expect: { timeout: 10_000 }, workers: 1, retries: 0, reporter: "line",
  outputDir: join(tmpdir(), `layout-preview-browser-${randomUUID()}`),
  use: { baseURL: "http://127.0.0.1:4219", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 4219 --strictPort",
    url: "http://127.0.0.1:4219", reuseExistingServer: false,
    env: { VITE_API_PROXY_TARGET: api } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
