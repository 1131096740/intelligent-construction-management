const base = require("./jest.config.cjs");

// Type checking runs in the independent quality gate. Runtime tests retain
// their assertions without keeping a second full compiler program resident.
module.exports = {
  ...base,
  transform: {
    ...base.transform,
    "^.+\\.ts$": ["ts-jest", { tsconfig: { isolatedModules: true } }]
  }
};
