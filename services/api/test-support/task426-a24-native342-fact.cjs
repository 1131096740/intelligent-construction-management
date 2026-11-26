"use strict";

const assert = require("node:assert/strict");
const beforeBody = "a59d505c02c2e0ff453ed0ccf29b25909449aa9cf1149f4a414844abc0541e1b";
const afterBody = "f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987";

function readOperatingFactValidator(app) {
  assert.match(app, /^jg_fixture_app_[a-f0-9]{24}$/u);
  return `SELECT jsonb_build_object(
    'factBody', encode(sha256(convert_to(fact.prosrc, 'UTF8')), 'hex'),
    'factConfig', fact.proconfig,
    'factMetadata', encode(sha256(convert_to((to_jsonb(fact) - 'prosrc')::text, 'UTF8')), 'hex'),
    'factTrigger', encode(sha256(convert_to(to_jsonb(fact_trigger)::text, 'UTF8')), 'hex'),
    'impact', encode(sha256(convert_to(jsonb_build_array(to_jsonb(impact), to_jsonb(impact_trigger))::text, 'UTF8')), 'hex'),
    'writer', encode(sha256(convert_to(jsonb_build_array(to_jsonb(fact_writer) - 'proacl', to_jsonb(impact_writer) - 'proacl')::text, 'UTF8')), 'hex'),
    'safe', NOT has_any_column_privilege('${app}', 'public."OperatingFact"'::regclass, 'INSERT,UPDATE,REFERENCES')
      AND NOT has_any_column_privilege('${app}', 'public."OperatingImpactEntry"'::regclass, 'INSERT,UPDATE,REFERENCES')
      AND NOT has_table_privilege('${app}', 'public."OperatingFact"'::regclass, 'DELETE,TRUNCATE,TRIGGER')
      AND NOT has_table_privilege('${app}', 'public."OperatingImpactEntry"'::regclass, 'DELETE,TRUNCATE,TRIGGER')
      AND NOT fact.prosecdef AND NOT impact.prosecdef AND fact_writer.prosecdef AND impact_writer.prosecdef
      AND fact_trigger.tgtype = 7 AND impact_trigger.tgtype = 7
      AND fact_trigger.tgenabled = 'O' AND impact_trigger.tgenabled = 'O'
      AND fact_trigger.tgqual IS NULL AND impact_trigger.tgqual IS NULL
  )
  FROM pg_proc fact
  JOIN pg_trigger fact_trigger ON fact_trigger.tgfoid = fact.oid AND fact_trigger.tgname = 'OperatingFact_validate_references'
    AND fact_trigger.tgrelid = 'public."OperatingFact"'::regclass
  JOIN pg_proc impact ON impact.oid = 'public."validateOperatingImpactEntryReferences"()'::regprocedure
  JOIN pg_trigger impact_trigger ON impact_trigger.tgfoid = impact.oid AND impact_trigger.tgname = 'OperatingImpactEntry_validate_references'
    AND impact_trigger.tgrelid = 'public."OperatingImpactEntry"'::regclass
  JOIN pg_proc fact_writer ON fact_writer.oid =
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure
  JOIN pg_proc impact_writer ON impact_writer.oid =
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'::regprocedure
  WHERE fact.oid = 'public."validateOperatingFactReferences"()'::regprocedure;`;
}

function verifyOperatingFactValidator(row, before) {
  assert.equal(row.safe, true, "NATIVE_A24_342_WRITE_FENCE");
  const { factBody, ...catalog } = row;
  assert.equal(factBody, before ? afterBody : beforeBody, "NATIVE_A24_342_FACT_BODY");
  assert.deepEqual(catalog.factConfig, ["search_path=pg_catalog, public, pg_temp"], "NATIVE_A24_342_FACT_CONFIG");
  for (const key of ["factMetadata", "factTrigger", "impact", "writer"]) {
    assert.match(catalog[key], /^[a-f0-9]{64}$/u);
  }
  if (before) {
    const { factBody: originalBody, ...originalCatalog } = before;
    assert.equal(originalBody, beforeBody);
    assert.deepEqual(catalog, originalCatalog, "NATIVE_A24_342_CATALOG_DRIFT");
  }
  return row;
}

function rollbackMigration342(sql) {
  assert.ok(sql.startsWith("BEGIN;\n") && sql.endsWith("\nCOMMIT;\n"));
  return sql.slice(0, -"COMMIT;\n".length) + "ROLLBACK;\n";
}

function projectMigration342Error(text) {
  const error = /^psql:<stdin>:(\d{1,6}): ERROR:\s+([0-9A-Z]{5}): ([^\n]+)/mu.exec(text);
  if (!error) return undefined;
  const [, line, sqlState, message] = error;
  const scope = /^EXPENSE_PENDING_COST_BEARER_(SCOPE|PREIMAGE|POSTIMAGE|CATALOG)$/u.exec(message)?.[1];
  const knownSqlError = [
    ["NO_DATA_FOUND", "query returned no rows"],
    ["TOO_MANY_ROWS", "query returned more than one row"],
    ["SYNTAX_ERROR", "syntax error"],
    ["AMBIGUOUS_COLUMN", "column reference"],
    ["UNDEFINED_COLUMN", "does not exist"],
    ["REPLACE_SIGNATURE", "cannot change"],
    ["INSUFFICIENT_PRIVILEGE", "permission denied"]
  ].find(([, phrase]) => message.includes(phrase))?.[0];
  const guard = scope ?? knownSqlError ?? "OTHER";
  const context = /CREATE OR REPLACE FUNCTION public\."validateOperatingFactReferences"\(\)/u.test(text)
    ? "VALIDATOR_REPLACEMENT"
    : "MIGRATION";
  const blockLine = /PL\/pgSQL function inline_code_block line (\d{1,6}) at /u.exec(text)?.[1];
  return { line: Number(line), sqlState, guard, context, ...(blockLine ? { blockLine: Number(blockLine) } : {}) };
}

module.exports = { readOperatingFactValidator, verifyOperatingFactValidator, rollbackMigration342,
  projectMigration342Error, beforeBody, afterBody };
