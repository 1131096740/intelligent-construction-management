"use strict";

const assert = require("node:assert/strict");
const { projectMigration342Error } = require("./task426-a24-native342-fact.cjs");

const existing = [
  ['public."validateOperatingFactReferences"()', "OperatingFact", "OperatingFact_validate_references",
    "f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987", null],
  ['public."validateOperatingImpactEntryReferences"()', "OperatingImpactEntry", "OperatingImpactEntry_validate_references",
    "78d1efbfb923ee5417b580e51e87dee29d33277fe510136c7f562e61007ae1da", null],
  ["public.jg_registered_payment_fact_guard()", "OperatingFact", "OperatingFact_registered_payment",
    "54abb9bca45f8cbf2ed3dd27abb0d86725e9bba7b863282e266dfa60377a837c", "9e7cf612da3cabbbe979b8a52813d766488b01aaa289da68272f612511167cd4"],
  ["public.jg_registered_payment_cash_impact_guard()", "OperatingImpactEntry", "OperatingImpactEntry_registered_cash",
    "e8f260b939348210d529402bf7d0f30ff3d71f369a7cc7b4ae1169d8664e6751", "e59887d92a12c53d6af6e7116edc61be6ced6ac9ced8624512c3c337af30c5b4"],
];
const added = [
  ["public.jg_validate_expense_public_cash_fact_v1()", "OperatingFact", "OperatingFact_expense_public_cash_source",
    "a6f915f0aca044e1ff0188c155052a3333e24786614e79ee6fdc36fd59023e76"],
  ["public.jg_validate_expense_public_cash_impact_v1()", "OperatingImpactEntry", "OperatingImpactEntry_expense_public_cash_source",
    "dee2e2addae79e31c50c2a2f7520c9709fa64c304b4b8cb45b08a23cb63b9083"],
];

function readCatalog(size, app) {
  assert.ok([345, 346].includes(size));
  assert.match(app, /^jg_fixture_app_[a-f0-9]{24}$/u);
  const targets = (size === 346 ? [...existing, ...added] : existing).map(([signature, table, hook]) =>
    `('${signature}', 'public."${table}"', '${hook}')`).join(",\n");
  return `SELECT jsonb_build_object(
    'constraints', (SELECT jsonb_object_agg(k.conname, encode(sha256(convert_to(to_jsonb(k)::text,'UTF8')),'hex'))
      FROM pg_catalog.pg_constraint k WHERE k.convalidated
        AND ((k.conrelid='public."OperatingFact"'::regclass AND k.conname IN ('OperatingFact_subject_kind_check','OperatingFact_supported_subject_check'))
          OR (k.conrelid='public."OperatingImpactEntry"'::regclass
            AND k.conname IN ('OperatingImpactEntry_subject_check','OperatingImpactEntry_supported_subject_check','OperatingImpactEntry_impact_kind_check')))),
    'witness', (SELECT pg_get_constraintdef(k.oid) FROM pg_catalog.pg_constraint k WHERE k.convalidated
      AND k.conrelid='public."ExpenseClaim"'::regclass AND k.conname='ExpenseClaim_fact_witness_tuple_check'),
    'guards', (SELECT jsonb_object_agg(q.routine, jsonb_build_object(
        'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
        'metadata',encode(sha256(convert_to((to_jsonb(p)-'prosrc')::text,'UTF8')),'hex'),
        'wiring',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),
        'definer',p.prosecdef,'condition',CASE WHEN t.tgqual IS NULL THEN '' ELSE pg_get_triggerdef(t.oid) END,
        'private',NOT has_function_privilege('${app}',p.oid,'EXECUTE') AND NOT EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0
        )
      )) FROM (VALUES ${targets}) q(routine, relation, hook)
      JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(q.routine) AND p.proowner=current_user::regrole::oid
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
        AND NOT (p.proretset OR p.proisstrict OR p.proleakproof)
      JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid AND t.tgrelid=to_regclass(q.relation) AND t.tgname=q.hook
        AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgnargs=0),
    'directWritesDenied', NOT has_any_column_privilege('${app}','public."OperatingFact"','INSERT,UPDATE,REFERENCES')
      AND NOT has_any_column_privilege('${app}','public."OperatingImpactEntry"','INSERT,UPDATE,REFERENCES')
  );`;
}

function verifyCatalog(size, result, before) {
  assert.equal(result?.directWritesDenied, true, "NATIVE_A24_346_DIRECT_WRITE_FENCE");
  assert.equal(Object.keys(result.constraints ?? {}).length, 5, "NATIVE_A24_346_CONSTRAINTS");
  assert.ok(['"projectId" IS NOT NULL', "'reimbursement'", '"generalProcurementId" IS NULL',
    '"actualPurchaseBatchId" IS NULL', '"factWitnessNameSnapshot" IS NULL'].every(fragment =>
    result.witness?.includes(fragment)), "NATIVE_A24_345_WITNESS");
  assert.equal(Object.keys(result.guards ?? {}).length, size === 345 ? 4 : 6, "NATIVE_A24_346_GUARD_COUNT");
  for (const [signature, , , original, successor] of existing) {
    const guard = result.guards[signature];
    assert.ok(guard && !guard.definer && guard.condition === "", "NATIVE_A24_346_LEGACY_GUARD");
    assert.equal(guard.body, size === 346 ? successor ?? original : original, "NATIVE_A24_346_LEGACY_BODY");
    if (before) {
      assert.deepEqual({ ...guard, body: original }, before.guards[signature], "NATIVE_A24_346_LEGACY_METADATA");
    }
  }
  if (size === 346) {
    assert.deepEqual(result.constraints, before.constraints, "NATIVE_A24_346_LEGACY_CONSTRAINT_DRIFT");
    assert.equal(result.witness, before.witness, "NATIVE_A24_345_WITNESS_DRIFT");
    for (const [signature, , , body] of added) {
      const guard = result.guards[signature];
      assert.ok(guard?.definer && guard.private && guard.condition.includes("'expense_claim_payment_execution'"),
        "NATIVE_A24_346_EXPENSE_TRIGGER");
      assert.equal(guard.body, body, "NATIVE_A24_346_EXPENSE_BODY");
    }
  }
  return result;
}

function projectMigrationError(text) {
  const result = projectMigration342Error(text);
  const reason = /^psql:<stdin>:\d{1,6}: ERROR:\s+55000: EXPENSE_PUBLIC_CASH_LEDGER_([A-Z_]{1,30})$/mu.exec(text)?.[1];
  return result && reason ? { ...result, guard: reason } : result;
}

module.exports = { readCatalog, verifyCatalog, projectMigrationError };
