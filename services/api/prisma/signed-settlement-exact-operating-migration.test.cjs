"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = () => readFileSync(path.join(
  __dirname,
  "migrations/20261129019000_signed_settlement_exact_operating_cost/migration.sql"
), "utf8");

test("signed review freezes the cents change after checking the protected cumulative amount", () => {
  const sql = migration();
  assert.match(sql, /pg_catalog\.pg_proc|FROM pg_proc/u);
  assert.match(sql, /bb255527d0454028caf034bae9f279aac799d5e1a4026423f3b6106ebcf11cf0/u);
  assert.match(sql, /IF trunc\(draft\."amountYuan", 2\) <> draft\."amountYuan" THEN/u);
  assert.match(sql, /'cumulativeBeforeYuan', round\(confirmed_yuan, 4\)::text/u);
  assert.match(sql, /'cumulativeAfterYuan', round\(confirmed_yuan \+ draft\."amountYuan", 4\)::text/u);
  assert.match(sql, /round\(\(confirmed_yuan \+ draft\."amountYuan"\) \* 100\) - round\(confirmed_yuan \* 100\)/u);
  assert.match(sql, /CASE WHEN draft\."contractKind" = 'upward' THEN '0'/u);
});

test("signed exact facts and impacts retain the source and reject an incomplete set at commit", () => {
  const sql = migration();
  assert.match(sql, /8144b48b02f9807a065b79240b0824b2504f00c9a098965d06f94ee91eb40146/u);
  assert.match(sql, /8f40f0c593112c133bd6c4617985d2f80b3fd1cb97642ad88755ceea0a80dd04/u);
  assert.match(sql, /ee6c957720c75515173c5858194c6589c3b7cc20a479a02be53863243b0e04fa/u);
  assert.match(sql, /BEFORE INSERT ON public\."OperatingFact" FOR EACH ROW\s+WHEN \(NEW\."sourceType" = 'signed_contract_settlement'\)/u);
  assert.match(sql, /NEW\."sourceSnapshot"->'operatingNumericFacts' IS DISTINCT FROM frozen/u);
  assert.match(sql, /NEW\."sourceSnapshot"->>'signedAmountYuan' IS DISTINCT FROM source_row\."amountYuan"::text/u);
  assert.match(sql, /NEW\."amountYuan" IS NOT DISTINCT FROM f\."amountYuan"/u);
  assert.match(sql, /'projectConsolidation' = 'exclude_internal'/u);
  assert.match(sql, /AFTER INSERT ON public\."OperatingFact" DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(sql, /WHEN NEW\."sourceSnapshot"#>>'\{operatingNumericFacts,payableDeltaCents\}' = '0' THEN 1/u);
});
