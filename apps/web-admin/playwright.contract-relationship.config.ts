import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "contract-relationship.e2e.ts", workers: 1, timeout: 45000,
  reporter: [["list"]], use: { baseURL: "http://127.0.0.1:5189", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 5189 --strictPort", url: "http://127.0.0.1:5189", reuseExistingServer: false, timeout: 120000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] } }]
});
