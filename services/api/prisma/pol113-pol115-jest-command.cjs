"use strict";

function pol113Pol115JestArgs(specs, env) {
  const preparedSha = env.POL113_POL115_PREPARED_SHA;
  if (preparedSha === undefined) {
    return ["--filter", "@jiangkong/api", "test", "--", "--runInBand", ...specs];
  }
  if (env.LOCAL_PG16_DYNAMIC_GATE !== "LOCAL_PG16_DYNAMIC_GATE" ||
    !/^[0-9a-f]{40}$/u.test(preparedSha) ||
    preparedSha !== env.DATABASE_DYNAMIC_GATE_CANDIDATE_SHA) {
    throw new Error("POL113-POL115 预构建与动态门候选版本不一致");
  }
  return ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", ...specs];
}

module.exports = { pol113Pol115JestArgs };
