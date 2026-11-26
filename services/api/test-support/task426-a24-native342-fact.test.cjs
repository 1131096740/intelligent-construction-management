"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { readOperatingFactValidator, verifyOperatingFactValidator, rollbackMigration342, projectMigration342Error,
  beforeBody, afterBody } = require("./task426-a24-native342-fact.cjs");

const read = relative => readFileSync(path.join(__dirname, "..", relative), "utf8");

test("recognizes only the approved original expense and preserves the old permission rejection", () => {
  const migration = read("prisma/migrations/20261129011000_expense_pending_cost_bearer/migration.sql");
  const successor = migration.split("$next$")[1];
  for (const proof of [
    'NEW."sourceVersion" = 1', 'NEW."entryKind" = \'original\'', 'NEW."adjustsFactId" IS NULL',
    'expense."projectId" = NEW."projectId"', 'expense."approvedAt" = NEW."occurredAt"',
    'expense."requestedAmountCents" = NEW."amountCents"', 'expense."voidedAt" IS NULL',
    'expense."actualPurchaseBatchId" IS NULL', 'expense."generalProcurementId" IS NULL',
    'expense."costBearingCompanySpecified" AND expense."costBearingCompanyEntityId" IS NULL',
    'round."id" = expense."approvalInstanceId"', 'round."status" = \'approved\'',
    'round."businessType" = \'expense_claim\' AND round."businessId" = expense."id"',
    'round."flowType" = \'expense_claim.approve\'',
    'action."actorUserId" = NEW."confirmedByUserId"', 'action."createdAt" = NEW."confirmedAt"'
  ]) assert.ok(successor.includes(proof), proof);
  assert.doesNotMatch(successor, /FOR (?:UPDATE|SHARE|KEY SHARE)|\bGRANT\b/u);
  assert.match(migration, /to_jsonb\(p\) - 'prosrc'\) = prior\.metadata/u);
  assert.match(migration, /trigger_before IS DISTINCT FROM prior\.wiring/u);
  assert.match(migration, /bodies\.proconfig IS NOT DISTINCT FROM prior\.proconfig/u);
  assert.equal([...migration.matchAll(/NULL::text\[\]/gu)].length, 2);
  assert.match(migration, /a59d505c[\s\S]+ARRAY\['search_path=pg_catalog, public, pg_temp'\]/u);
});

test("retains both product archive validator tuples and admits only their exact successors", () => {
  const source = read("src/contract/contract-generated-upward-operating-installation.ts");
  const tuples = [...source.matchAll(/\((TRUE|FALSE),'([a-f0-9]{64})',\s*'([a-f0-9]{64})'\)/gu)].map(match => match.slice(1));
  const [withoutClock, withClock, successorWithoutClock, successorWithClock] = tuples;
  assert.equal(tuples.length, 4);
  assert.equal(withoutClock[1], "26a0fe0d77faa0cb21df9098d339f6350e45e9468504d1cc9d66afee4171a975");
  assert.equal(withClock[1], "a9f2052a70675effdd906929c1b3490c4f4f81867b65b29ea13c9e3a935f7434");
  assert.equal(successorWithoutClock[1], "bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6");
  assert.equal(successorWithClock[1], "61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb");
  assert.deepEqual([successorWithoutClock[0], successorWithoutClock[2]], [withoutClock[0], withoutClock[2]]);
  assert.deepEqual([successorWithClock[0], successorWithClock[2]], [withClock[0], withClock[2]]);
  assert.doesNotMatch(source, new RegExp(afterBody, "u"));
});

test("refuses a change to the native facts metadata, impact validator or write fence", () => {
  const sql = readOperatingFactValidator("jg_fixture_app_" + "a".repeat(24));
  assert.match(sql, /NOT has_any_column_privilege.+"OperatingFact".+'INSERT,UPDATE,REFERENCES'/u);
  assert.match(sql, /NOT has_table_privilege.+"OperatingImpactEntry".+'DELETE,TRUNCATE,TRIGGER'/u);
  const before = { factBody: beforeBody, factConfig: ["search_path=pg_catalog, public, pg_temp"],
    factMetadata: "b".repeat(64), factTrigger: "c".repeat(64),
    impact: "d".repeat(64), writer: "e".repeat(64), safe: true };
  const after = { ...before, factBody: afterBody };
  verifyOperatingFactValidator(before);
  verifyOperatingFactValidator(after, before);
  assert.throws(() => verifyOperatingFactValidator({ ...after, safe: false }, before), /WRITE_FENCE/u);
  assert.throws(() => verifyOperatingFactValidator({ ...after, impact: "f".repeat(64) }, before), /CATALOG_DRIFT/u);
  assert.throws(() => verifyOperatingFactValidator({ ...after, factConfig: null }, before), /FACT_CONFIG/u);
  assert.throws(() => verifyOperatingFactValidator(before, before), /FACT_BODY/u);
});

test("diagnoses the first SQL error and leaves the migration uncommitted", () => {
  const migration = read("prisma/migrations/20261129011000_expense_pending_cost_bearer/migration.sql");
  assert.equal(rollbackMigration342(migration).replace(/ROLLBACK;\n$/u, "COMMIT;\n"), migration);
  assert.throws(() => rollbackMigration342(migration + "SELECT 1;"));
  const first = 'psql:<stdin>:99: ERROR:  55000: EXPENSE_PENDING_COST_BEARER_CATALOG\n' +
    'CONTEXT:  PL/pgSQL function inline_code_block line 73 at RAISE\n' +
    'psql:<stdin>:102: ERROR:  25P02: postgresql://private';
  assert.deepEqual(projectMigration342Error(first), {
    line: 99, sqlState: "55000", guard: "CATALOG", context: "MIGRATION", blockLine: 73
  });
  assert.deepEqual(projectMigration342Error('psql:<stdin>:99: ERROR:  42601: syntax error private\n' +
    'CONTEXT: SQL statement "CREATE OR REPLACE FUNCTION public."validateOperatingFactReferences"()"'), {
    line: 99, sqlState: "42601", guard: "SYNTAX_ERROR", context: "VALIDATOR_REPLACEMENT"
  });
});
