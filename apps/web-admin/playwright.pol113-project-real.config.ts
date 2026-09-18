import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = process.env.POL113_API_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || !process.env.POL113_BROWSER_SESSION) {
  throw new Error("项目档案浏览器测试只允许本机合成会话");
}
export default defineConfig({
  testDir: "./e2e", testMatch: ["pol113-project-profile-real.e2e.ts", "pol113-settings-real.e2e.ts", "pol113-business-party-real.e2e.ts"],
  timeout: 45_000, workers: 1, retries: 0, reporter: "line",
  outputDir: join(tmpdir(), `pol113-project-browser-${randomUUID()}`),
  use: { baseURL: "http://127.0.0.1:4214", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4214 --strictPort",
    url: "http://127.0.0.1:4214", reuseExistingServer: false,
    env: { VITE_API_PROXY_TARGET: api }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
