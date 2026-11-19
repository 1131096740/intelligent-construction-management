import { defineConfig } from "@playwright/test";
import bodyConfig from "./playwright.task10-body.config";

export default defineConfig({ ...bodyConfig, testMatch: "task10-sole-delete-ack.e2e.ts", projects: bodyConfig.projects?.filter(project => project.name === "desktop") });
