import { defineConfig, devices } from "@playwright/test";

const pnpmCommand = JSON.stringify(process.env.PNPM_BIN ?? "pnpm");

export default defineConfig({
  testDir: "./e2e", testMatch: "task12-submit-consumer.e2e.ts",
  timeout: 45_000, expect: { timeout: 8_000 }, workers: 1, retries: 0,
  reporter: [["list"]], outputDir: process.env.TASK12_SUBMIT_OUTPUT,
  use: { baseURL: "http://127.0.0.1:54912", trace: "retain-on-failure", actionTimeout: 8_000 },
  webServer: {
    command: `${pnpmCommand} exec vite --host 127.0.0.1 --port 54912 --strictPort`,
    url: "http://127.0.0.1:54912", reuseExistingServer: false, timeout: 60_000
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    {
      name: "mobile",
      grep: /确认当前正文后，剩余普通空位|同版重复生成时|提交响应不明时|取消正文检查|UNKNOWN保留|UNKNOWN刷新/u,
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } }
    }
  ]
});
