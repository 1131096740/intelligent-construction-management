import config from "./playwright.employee-onboarding.config";
import { defineConfig } from "@playwright/test";

if (!process.env.ROSTER_API_URL?.startsWith("http://127.0.0.1:")) throw new Error("花名册验收只允许隔离本机 API");
export default defineConfig({
  ...config,
  outputDir: "test-results/project-roster-real",
  testMatch: "project-roster-real.e2e.ts",
  use: { ...config.use, baseURL: "http://127.0.0.1:5201" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5201 --strictPort --force",
    env: { VITE_API_PROXY_TARGET: process.env.ROSTER_API_URL },
    url: "http://127.0.0.1:5201", reuseExistingServer: false, timeout: 120_000
  }
});
