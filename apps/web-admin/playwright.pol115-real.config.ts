import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = process.env.POL115_API_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api) || !process.env.POL115_BROWSER_SESSION) {
  throw new Error("费用浏览器测试仅允许本机合成会话");
}
const spec = process.env.POL115_BROWSER_SPEC;
const webPort = spec === "pol115-fund-real.e2e.ts" ? 4216 : spec === "operating-takeover-real.e2e.ts" ? 4217 : 4215;
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e", testMatch: spec ?? ["pol115-expense-real.e2e.ts", "expense-self-service-real.e2e.ts", "draft-deletion-real.e2e.ts"], timeout: 45_000,
  workers: 1, retries: 0, reporter: "line",
  outputDir: join(tmpdir(), `pol115-browser-${randomUUID()}`),
  use: { baseURL, trace: "off" },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: baseURL, reuseExistingServer: false,
    env: { VITE_API_PROXY_TARGET: api }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
