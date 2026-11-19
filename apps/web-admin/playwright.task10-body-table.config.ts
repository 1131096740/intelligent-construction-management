import { defineConfig } from "@playwright/test";
import bodyConfig from "./playwright.task10-body.config";

export default defineConfig({ ...bodyConfig, testMatch: "task10-body-table.e2e.ts" });
