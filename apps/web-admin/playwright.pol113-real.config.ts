import { defineConfig } from "@playwright/test";
import localConfig from "./playwright.pol113-project-real.config";

export default defineConfig({
  ...localConfig,
  testMatch: "pol113-settings-real.e2e.ts",
  timeout: 60_000
});
