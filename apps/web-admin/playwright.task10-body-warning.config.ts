import { defineConfig } from "@playwright/test";
import bodyConfig from "./playwright.task10-body.config";
export default defineConfig({ ...bodyConfig, testMatch: "task10-body-warning.e2e.ts", timeout: 90_000,
  expect: { timeout: 10_000 }, workers: 1, retries: 0, use: { ...bodyConfig.use, trace: "off" },
  projects: bodyConfig.projects });
