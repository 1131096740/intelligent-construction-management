const base = require("./jest.config.cjs");

// Type checking runs in the independent quality gate. Do not retain its full
// compiler program alongside the real PostgreSQL projection budget fixtures.
module.exports = {
  ...base,
  transform: {
    ...base.transform,
    "^.+\\.ts$": ["ts-jest", { tsconfig: { isolatedModules: true } }]
  }
};
