import { defineConfig, devices } from "@playwright/test";
const api = "http://127.0.0.1:43271";
export default defineConfig({
  testDir: "./e2e", testMatch: "general-request-http.e2e.ts", timeout: 45_000, workers: 1, retries: 0,
  reporter: "line", outputDir: "/private/tmp/jg-task20-evidence/browser",
  use: { baseURL: "http://127.0.0.1:43272", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: [
    { command: "pnpm --filter @jiangkong/api exec node prisma/run-general-request-browser-synthetic.cjs", url: `${api}/general-procurements/create-options`, reuseExistingServer: false, timeout: 45_000 },
    { command: "pnpm dev --host 127.0.0.1 --port 43272 --strictPort", url: "http://127.0.0.1:43272", reuseExistingServer: false, env: { VITE_API_PROXY_TARGET: api } }
  ],
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "touch-chromium", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    { name: "touch-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
