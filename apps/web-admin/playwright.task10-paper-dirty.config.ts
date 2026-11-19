import { defineConfig } from "@playwright/test";
import bodyConfig from "./playwright.task10-body.config";

const desktop = bodyConfig.projects?.find(project => project.name === "desktop");
if (!desktop) throw new Error("正文保存失效检查需要真实桌面浏览器配置");

export default defineConfig({ ...bodyConfig, testMatch: "task10-paper-dirty.e2e.ts",
  // No raw network trace: login/file-ticket requests contain real synthetic credentials.
  // Explicit sanitized facts, screenshots and served-module hashes remain owned evidence.
  use: { ...bodyConfig.use, trace: "off" },
  projects: [desktop] });
