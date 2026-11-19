// Exact resource acceptance files only. Pure HTTP cases stay in default discovery.
const { resolve } = require("node:path");

const browserFiles = Object.freeze([
  "contract-template/task10-body-addition-browser.http.spec.ts",
  "contract-template/task10-body-blank-reminder-browser.http.spec.ts",
  "contract-template/task10-body-browser.http.spec.ts",
  "contract-template/task10-body-deletion-browser.http.spec.ts",
  "contract-template/task10-body-regeneration-ack-browser.http.spec.ts",
  "contract-template/task10-body-regeneration-browser.http.spec.ts",
  "contract-template/task10-body-table-browser.http.spec.ts",
  "contract-template/task10-body-warning-browser.http.spec.ts",
  "contract-template/task10-first-template-body-browser.http.spec.ts",
  "contract-template/task10-manual-net-amount-load-browser.http.spec.ts",
  "contract-template/task10-only-addition-deletion-browser.http.spec.ts",
  "contract-template/task10-paragraph-reorder-browser.http.spec.ts",
  "contract-template/task10-sole-delete-ack-browser.http.spec.ts",
  "contract-template/task10-template-switch-body-command-browser.http.spec.ts",
  "contract-template/task10-template-switch-browser.http.spec.ts"
]);
const nativeResourceFiles = Object.freeze([
  "contract-template/task10-body-export.http.spec.ts",
  "contract-template/task10-custom-net-export.http.spec.ts",
  "contract-template/task10-default-layout-preview-browser.http.spec.ts",
  "contract-template/task10-formal-45-row-export.http.spec.ts",
  "contract-template/task10-formal-labor-current-export.http.spec.ts",
  "contract-template/task10-formal-mechanical-45-row-export.http.spec.ts",
  "contract-template/task10-header-logical-target.http.spec.ts",
  "contract-template/task10-known-v1-native.http.spec.ts",
  "contract-template/task10-labor-export.http.spec.ts",
  "contract-template/task10-logical-margin.http.spec.ts",
  "contract-template/task10-margin-control.http.spec.ts",
  "contract-template/task10-material-body-spacing-export.http.spec.ts",
  "contract-template/task10-material-signature-date-export.http.spec.ts",
  "contract-template/task10-material-signature-date-control-export.http.spec.ts",
  "contract-template/task10-material-primary-secondary-roles-export.http.spec.ts",
  "contract-template/task10-material-two-role-export.http.spec.ts",
  "contract-template/task10-net-export.http.spec.ts",
  "contract-template/task10-paper-cold-browser.http.spec.ts",
  "contract-template/task10-paper-dirty-browser.http.spec.ts",
  "contract-template/task10-paper-mobile-cold-browser.http.spec.ts",
  "contract-template/task10-paper-preview-browser.http.spec.ts",
  "contract-template/task10-runtime-refusal.http.spec.ts",
  "contract-template/task10-table-layout-boundary-addition.http.spec.ts",
  "contract-template/task10-table-layout-cache.http.spec.ts",
  "contract-template/task10-table-layout-legacy-native.http.spec.ts",
  "contract-template/task10-table-layout-v2-cache.http.spec.ts"
]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sourceRoot = resolve(__dirname, "src").replace(/\\/g, "/");
const exactIgnorePatterns = Object.freeze([...browserFiles, ...nativeResourceFiles]
  .map((file) => `^${escapeRegex(`${sourceRoot}/${file}`)}$`));

module.exports = { browserFiles, nativeResourceFiles, exactIgnorePatterns };
