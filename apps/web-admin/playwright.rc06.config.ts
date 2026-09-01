import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4196;
const baseURL = `http://${host}:${port}`;
const outputDir = process.env.PLAYWRIGHT_RC06_OUTPUT_DIR ??
  join(tmpdir(), "jiangkong-rc06-mock-browser-contract");

// This deterministic route-mocked gate protects browser contracts only. It does
// not replace the API-backed four-role acceptance evidence required by RC-06.
const settlementMockCoverage =
  /(?:结算签章治理五步|超过 100 行的结算清单)/u;
const fundExecutionMockCoverage = /资金执行案件响应丢失重试复用幂等键/u;
const chromiumMockCoverage = new RegExp(
  `${settlementMockCoverage.source}|${fundExecutionMockCoverage.source}|core detail pages expose flow summaries|结算详情展示双证据|separates the payment ledger|P0 desktop Chromium|P0 mobile WebKit`,
  "u"
);
const webkitMockCoverage = new RegExp(
  `${settlementMockCoverage.source}|${fundExecutionMockCoverage.source}|RC-06 mocked contract detail|本人可在设置页|资料库只在服务端授权后`,
  "u"
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "p0-browser-smoke.e2e.ts",
    "payment-workbench.e2e.ts",
    "settlement-signature-governance.e2e.ts",
    "handwritten-signature.e2e.ts",
    "signature-handoff.e2e.ts",
    "fund-execution-workbench.e2e.ts"
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `pnpm preview --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "rc06-mock-chromium-1366x768",
      grep: chromiumMockCoverage,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: "rc06-mock-webkit-390x844",
      grep: webkitMockCoverage,
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
