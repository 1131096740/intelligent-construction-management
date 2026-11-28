import { defineConfig, devices } from "@playwright/test";
const port = 54811;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "template-management-real.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.TEMPLATE_BROWSER_OUTPUT,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: { command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
