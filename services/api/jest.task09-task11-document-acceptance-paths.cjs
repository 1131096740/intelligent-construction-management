// Exact suites that exercise the native converter, physical PDF or real browser.
const { resolve } = require("node:path");

const documentFiles = Object.freeze([
  "contract-template/task09-draft-template-type-native.http.spec.ts",
  "contract-template/task09-new-selection-browser.http.spec.ts",
  "contract-template/template-browser.http.spec.ts",
  "contract-template/template-mapping-native.http.spec.ts",
  "contract-template/template-selection-browser.http.spec.ts",
  "contract-template/template-selection-legacy.http.spec.ts",
  "contract-template/template-selection-native.http.spec.ts"
]);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sourceRoot = resolve(__dirname, "src").replace(/\\/g, "/");
const documentIgnorePatterns = Object.freeze(documentFiles
  .map(file => `^${escapeRegex(`${sourceRoot}/${file}`)}$`));

module.exports = { documentFiles, documentIgnorePatterns };
