import config from "./playwright.employee-onboarding.config";
import { defineConfig } from "@playwright/test";

if (!process.env.ONBOARDING_API_URL?.startsWith("http://127.0.0.1:")) {
  throw new Error("员工入职浏览器测试只允许隔离本机 API");
}

export default defineConfig({
  ...config,
  testMatch: "employee-onboarding-real.e2e.ts",
  use: { ...config.use, baseURL: "http://127.0.0.1:5199" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5199 --strictPort",
    env: { VITE_API_PROXY_TARGET: process.env.ONBOARDING_API_URL },
    url: "http://127.0.0.1:5199",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
