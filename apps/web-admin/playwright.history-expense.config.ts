import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 4236;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "history-expense.e2e.ts",
  workers: 1,
  outputDir: join(tmpdir(), "jiangkong-history-expense-browser"),
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    env: { VITE_API_PROXY_TARGET: "http://127.0.0.1:1" },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } }
  ]
});
