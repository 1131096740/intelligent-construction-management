import { defineConfig, devices } from "@playwright/test";
if (!process.env.SIGNATURE_REAL_DB_CONFIG || !process.env.SIGNATURE_REAL_ACCOUNTS) throw new Error("仅允许本机合成签名验收");
export default defineConfig({
 testDir: "./e2e", testMatch: "signature-real.e2e.ts", workers: 1, retries: 0, maxFailures: 1, timeout: 45000, reporter: "line",
 use: { baseURL: "http://127.0.0.1:4392", trace: "retain-on-failure" },
 webServer: [
  { command: "node e2e/helpers/signature-real-server.cjs", url: "http://127.0.0.1:4391/me/signature/canvas-capabilities", reuseExistingServer: false, gracefulShutdown: { signal: "SIGTERM", timeout: 10000 } },
  { command: "pnpm dev --host 127.0.0.1 --port 4392 --strictPort", url: "http://127.0.0.1:4392", reuseExistingServer: false, env: { VITE_API_PROXY_TARGET: "http://127.0.0.1:4391" } }
 ],
 projects: [
  { name: "android", use: { ...devices["Pixel 5"] } },
  { name: "ios", use: { ...devices["iPhone 13"] } }
 ]
});
