module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  roots: ["<rootDir>", "<rootDir>/../prisma"],
  testEnvironment: "node",
  testRegex: ".*(?:\\.spec|\\.e2e-spec)\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest"
  }
};
