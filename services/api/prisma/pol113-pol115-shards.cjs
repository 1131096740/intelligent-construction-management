"use strict";

const POL113_POL115_GROUP = "pol113_pol115_business_entries";
const BATCH_FILES = Object.freeze({
  pol113: Object.freeze(["src/database/base-entry-http-postgres.spec.ts"]),
  pol115: Object.freeze([
    "src/operating-takeover/operating-takeover-entry.http.pg.spec.ts",
    "src/database/approval-v6-independent-http-postgres.spec.ts",
    "src/expense-claim/expense-claim-entry.http.pg.spec.ts",
    "src/fund-execution/fund-execution-entry.http.pg.spec.ts",
    "src/database/draft-hard-deletion.pg.spec.ts",
    "src/database/draft-deletion-numbering.pg.spec.ts"
  ]),
  pol114: Object.freeze(["src/database/contract-business-entry-http.spec.ts"]),
  spot: Object.freeze(["src/spot-procurement/spot-procurement-entry.http.pg.spec.ts"]),
  workbench: Object.freeze(["src/settlement/settlement-template-workbench.http.pg.spec.ts"])
});
const SHARDS = Object.freeze({
  pol113_pol114: Object.freeze(["pol113", "pol114"]),
  pol115_workbench: Object.freeze(["pol115", "spot", "workbench"])
});

function pol113Pol115Batches(shard) {
  if (shard === undefined) return Object.keys(BATCH_FILES);
  if (!Object.hasOwn(SHARDS, shard)) throw new Error("POL113-POL115 子分片无效");
  return SHARDS[shard];
}

function shardPaths(batches) {
  return batches.flatMap(batch => BATCH_FILES[batch].map(file => "services/api/" + file));
}

function assertPol113Pol115Coverage(group) {
  const split = shardPaths(Object.values(SHARDS).flat());
  const registered = new Set(group.testFiles.map(file => file.path));
  if (split.length !== registered.size || new Set(split).size !== split.length ||
    split.some(file => !registered.has(file))) {
    throw new Error("POL113-POL115 子分片必须各覆盖原登记测试一次");
  }
}

function projectPol113Pol115Shard(group, shard) {
  assertPol113Pol115Coverage(group);
  const paths = new Set(shardPaths(pol113Pol115Batches(shard)));
  const testFiles = group.testFiles.filter(file => paths.has(file.path));
  return { ...group, testFiles, pendingTests: testFiles.reduce((sum, file) => sum + file.pendingTests, 0),
    pol113Pol115Shard: shard };
}

module.exports = { POL113_POL115_GROUP, BATCH_FILES, SHARDS, pol113Pol115Batches, assertPol113Pol115Coverage, projectPol113Pol115Shard };
