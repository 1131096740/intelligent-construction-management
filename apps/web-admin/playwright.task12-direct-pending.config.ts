import archive from "./playwright.task12-archive.config";

const url = "http://127.0.0.1:54914";
export default {
  ...archive,
  testMatch: "task12-direct-pending-consumer.e2e.ts",
  outputDir: process.env.TASK12_DIRECT_WEB_OUTPUT,
  use: { ...archive.use, baseURL: url },
  webServer: { ...archive.webServer, command: "node scripts/task12-mock-vite.mjs 54914", url }
};
