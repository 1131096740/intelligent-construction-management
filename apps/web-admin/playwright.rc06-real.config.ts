import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const host = "127.0.0.1";
const port = 4201;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "real-role-browser-uat.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: process.env.REAL_BROWSER_OUTPUT_DIR ?? join(tmpdir(), "jiangkong-rc06-real-browser"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `pnpm dev --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_PROXY_TARGET: process.env.REAL_API_BASE_URL ?? "http://127.0.0.1:3000"
    }
  },
  projects: [
    {
      name: "rc06-real-chromium-1366x768",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } }
    },
    {
      name: "rc06-real-webkit-390x844",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }
    }
  ]
});
