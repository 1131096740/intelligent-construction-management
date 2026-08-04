import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4194;
const baseURL = `http://${host}:${port}`;
const outputDir = join(
  tmpdir(),
  "jiangkong-project-financing-quota-termination"
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "project-financing-quota-termination.e2e.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "line",
  outputDir: join(outputDir, "artifacts"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `pnpm build && pnpm preview --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: "webkit-desktop",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 }
      }
    },
    {
      name: "webkit-mobile",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
