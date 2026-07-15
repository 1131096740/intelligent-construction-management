import { defineConfig, devices } from "@playwright/test";

const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const baseURL = isCI ? "http://127.0.0.1:4173" : (process.env.WEB_BASE_URL ?? "http://127.0.0.1:5173");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: {
    command: isCI
      ? "pnpm preview --host 127.0.0.1 --port 4173 --strictPort"
      : "pnpm dev --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
