const base = require("./jest.config.cjs");
const { nativeResourceFiles, exactIgnorePatterns } = require("./jest.task10-acceptance-paths.cjs");

const config = { ...base };
delete config.testRegex;
module.exports = {
  ...config,
  testMatch: nativeResourceFiles.map((file) => `<rootDir>/${file}`),
  testPathIgnorePatterns: config.testPathIgnorePatterns.filter((pattern) => !exactIgnorePatterns.includes(pattern)),
  bail: 1
};
