const base = require("./jest.config.cjs");
const { documentFiles, documentIgnorePatterns } = require("./jest.task09-task11-document-acceptance-paths.cjs");

const config = { ...base };
delete config.testRegex;
module.exports = {
  ...config,
  testMatch: documentFiles.map(file => `<rootDir>/${file}`),
  testPathIgnorePatterns: config.testPathIgnorePatterns.filter(pattern => !documentIgnorePatterns.includes(pattern)),
  setupFiles: ["<rootDir>/../test-support/require-task09-task11-document-runtime.cjs"],
  bail: 1
};
