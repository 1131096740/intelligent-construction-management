import original from "./playwright.task12-submit.config";
export default { ...original, use: { ...original.use, serviceWorkers: "block" as const },
  webServer: { ...original.webServer, command: "node scripts/task12-mock-vite.mjs 54912" } };
