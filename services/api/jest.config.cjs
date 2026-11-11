const { exactIgnorePatterns } = require("./jest.task10-acceptance-paths.cjs");
const { documentIgnorePatterns } = require("./jest.task09-task11-document-acceptance-paths.cjs");

module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  roots: ["<rootDir>", "<rootDir>/../prisma"],
  testEnvironment: "node",
  testRegex: ".*(?:\\.spec|\\.e2e-spec)\\.ts$",
  testPathIgnorePatterns: ["/node_modules/", ...exactIgnorePatterns, ...documentIgnorePatterns],
  transform: {
    "^.+\\.ts$": "ts-jest"
  }
};
