import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.JG_GRID_API_PORT);
const webPort = Number(process.env.JG_GRID_WEB_PORT);
if (![apiPort, webPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || apiPort === webPort) {
  throw new Error("Assign two unused loopback ports with JG_GRID_API_PORT and JG_GRID_WEB_PORT");
}
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "contract-grid-http.e2e.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  outputDir: process.env.JG_GRID_ARTIFACTS ?? `/private/tmp/jg-task06-browser-${Date.now()}`,
  use: { baseURL, trace: "retain-on-failure" },
  reporter: "list",
  webServer: [
    {
      command: "pnpm --filter @jiangkong/api build && node e2e/helpers/contract-grid-synthetic-server.cjs",
      url: `http://127.0.0.1:${apiPort}/__grid_fixture/health`,
      env: { JG_GRID_API_PORT: String(apiPort) },
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: baseURL,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
