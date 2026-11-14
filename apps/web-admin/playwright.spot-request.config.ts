import { defineConfig } from "@playwright/test";
const apiPort = Number(process.env.JG_SPOT_API_PORT);
const webPort = Number(process.env.JG_SPOT_WEB_PORT);
if (![apiPort, webPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || apiPort === webPort) throw new Error("Assign two unused loopback ports");
export default defineConfig({
  testDir: "./e2e", testMatch: "spot-request-http.e2e.ts", timeout: 30_000, retries: 0, workers: 1,
  outputDir: process.env.JG_SPOT_ARTIFACTS ?? "/private/tmp/jg-task19-browser", reporter: "list",
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  webServer: [
    {command: "node e2e/helpers/spot-request-synthetic-server.cjs", url: `http://127.0.0.1:${apiPort}/__spot_fixture/health`, reuseExistingServer: false, env: {JG_SPOT_API_PORT: String(apiPort)}, timeout: 120_000},
    {command: `pnpm dev --host 127.0.0.1 --port ${webPort} --strictPort`, url: `http://127.0.0.1:${webPort}`, env: {VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`}, reuseExistingServer: false, timeout: 120_000}
  ],
  projects: [
    {name: "desktop", use: {browserName: "chromium", viewport: {width: 1366,height: 768}}},
    {name: "mobile", use: {browserName: "chromium",viewport: {width: 390,height: 844},isMobile: true,hasTouch: true}}
  ]
});
