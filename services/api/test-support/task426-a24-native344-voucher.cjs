"use strict";

const assert = require("node:assert/strict");
const { projectMigration342Error } = require("./task426-a24-native342-fact.cjs");

const command = "public.jg_record_expense_public_cash_voucher(text,text,bigint,timestamp,text,text,text,text,text)";
const finish = "public.jg_finish_expense_public_cash_voucher()";
const rawOwnerVoucher = "public.jg_project_owner_settlement_voucher_bound(text)";
const witness = "public.jg_expense_public_cash_voucher_witness";
const routines = [
  ["jg_issue417_check_partial_activation", "756f8871172efc4c8a9c50179f291b833fa0910c7a37775530fd0bcc093abc65", false],
  ["jg_issue417_preserve_partial_activation_scene", "7fa4b88fdb60996032cf86daf0c9e14e87902e4c76233a8a8b4e3ad25e157be3", false],
  ["jg_finish_expense_public_cash_voucher", "fb5efb4c0cc96502c9e33cb5e70fbf517d9dc4e049a6f5100530b1b74151c6ee", true],
  ["jg_record_expense_public_cash_voucher", "c76816304e9e558c6f225985164cacad2776acb63f7b883495c43caff986caec", true]
];
const triggers = [
  ["OperatingTakeoverActivation_partial_history_expense_check", '"OperatingTakeoverActivation"', routines[0][0], 23, false, "partially_activated"],
  ["OperatingTakeoverBatch_partial_history_expense_scene_check", '"OperatingTakeoverBatch"', routines[1][0], 19, false, "historical_expense"],
  ["jg_expense_public_cash_voucher_debit_required", "jg_expense_public_cash_voucher_witness", routines[2][0], 5, true, ""]
];
const states = [
  ["OperatingTakeoverRow_status_check", '"OperatingTakeoverRow"', ["historical_expense", "verified", "not_occurred"]],
  ["OperatingTakeoverBatch_status_check", '"OperatingTakeoverBatch"', ['["historical_expense"]', "partially_activated"]],
  ["OperatingTakeoverActivation_status_check", '"OperatingTakeoverActivation"', ["activated", "partially_activated"]]
];

function readCatalog(size) {
  assert.ok([342, 343, 344].includes(size));
  const activeRoutines = routines.slice(0, size === 342 ? 0 : size === 343 ? 2 : 4);
  const activeTriggers = triggers.slice(0, size === 342 ? 0 : size === 343 ? 2 : 3);
  const routineNames = activeRoutines.map(([name]) => "'" + name + "'").join(", ") || "NULL";
  const triggerNames = activeTriggers.map(([name]) => "'" + name + "'").join(", ") || "NULL";
  const constraintNames = size === 342 ? "NULL" : states.map(([name]) => "'" + name + "'").join(", ");
  return `SELECT jsonb_build_object(
    'oldBinding', (SELECT jsonb_build_object('trigger', to_jsonb(t), 'routine', to_jsonb(p)-'prosrc',
      'body', encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='public."ExpenseClaimPaymentExecution"'::regclass
        AND t.tgname='jg_efb_expense_claim_payment_execution_voucher'
        AND p.oid='public.jg_legacy_procurement_expense_voucher_guard_v1()'::regprocedure),
    'ownerLookup', (SELECT jsonb_build_object('routine',to_jsonb(p)-'prosrc',
      'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) FROM pg_catalog.pg_proc p WHERE p.oid='${rawOwnerVoucher}'::regprocedure),
    'debitConservation', (SELECT to_jsonb(t) FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public."RegisteredOperationalPayment"'::regclass
        AND t.tgname='RegisteredOperationalPayment_conservation' AND t.tgenabled='O'),
    'routines', (SELECT COALESCE(jsonb_object_agg(p.proname, jsonb_build_object(
      'oid',p.oid,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'owner',p.proowner=current_user::regrole::oid,'definer',p.prosecdef)), '{}'::jsonb)
      FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (${routineNames})),
    'triggers', (SELECT COALESCE(jsonb_object_agg(t.tgname, jsonb_build_object(
      'oid',t.oid,'relation',c.relname,'routine',p.proname,'type',t.tgtype,
      'enabled',t.tgenabled='O',
      'condition',CASE WHEN t.tgqual IS NULL THEN '' ELSE pg_get_triggerdef(t.oid) END,
      'deferred',t.tgdeferrable AND t.tginitdeferred)), '{}'::jsonb)
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgname IN (${triggerNames})),
    'constraints', (SELECT COALESCE(jsonb_object_agg(k.conname, jsonb_build_object(
      'oid',k.oid,'relation',c.relname,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid))), '{}'::jsonb)
      FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE k.contype='c' AND k.conname IN (${constraintNames})),
    'witness', ${size === 344 ? `(SELECT count(*) FROM ${witness})` : "NULL"}
  );`;
}

function verifyCatalog(size, result, predecessor) {
  assert.ok(result?.oldBinding && result.ownerLookup && result.debitConservation, "NATIVE_A24_344_OLD_GUARDS");
  if (predecessor) {
    for (const key of ["oldBinding", "ownerLookup", "debitConservation"]) {
      assert.deepEqual(result[key], predecessor[key], "NATIVE_A24_344_OLD_GUARD_DRIFT");
    }
  }
  const activeRoutines = routines.slice(0, size === 342 ? 0 : size === 343 ? 2 : 4);
  const activeTriggers = triggers.slice(0, size === 342 ? 0 : size === 343 ? 2 : 3);
  assert.equal(Object.keys(result.routines).length, activeRoutines.length, "NATIVE_A24_344_ROUTINES");
  for (const [name, body, definer] of activeRoutines) {
    const routine = result.routines[name];
    assert.ok(routine?.oid, "NATIVE_A24_344_ROUTINE");
    assert.deepEqual({ body: routine.body, owner: routine.owner, definer: routine.definer }, { body, owner: true, definer }, "NATIVE_A24_344_ROUTINE_SHAPE");
  }
  assert.equal(Object.keys(result.triggers).length, activeTriggers.length, "NATIVE_A24_344_TRIGGERS");
  for (const [name, relation, routine, type, deferred, condition] of activeTriggers) {
    const trigger = result.triggers[name];
    assert.ok(trigger?.oid && (condition ? trigger.condition.includes(condition) : trigger.condition === ""), "NATIVE_A24_344_TRIGGER_CONDITION");
    assert.deepEqual({ relation: trigger.relation, routine: trigger.routine, type: trigger.type,
      enabled: trigger.enabled, deferred: trigger.deferred },
    { relation: relation.replaceAll('"', ""), routine, type, enabled: true, deferred }, "NATIVE_A24_344_TRIGGER_SHAPE");
  }
  if (size > 342) {
    for (const [name, relation, terms] of states) {
      const row = result.constraints[name];
      assert.ok(row?.oid && row.validated && row.relation === relation.replaceAll('"', "") &&
        terms.every(term => row.definition.includes("'" + term + "'")), "NATIVE_A24_343_CONSTRAINT");
    }
  }
  if (size === 344) {
    assert.equal(result.witness, 0, "NATIVE_A24_344_UNCONSUMED_WITNESS");
    assert.deepEqual(result.constraints, predecessor.constraints, "NATIVE_A24_343_CONSTRAINT_DRIFT");
    for (const [name] of routines.slice(0, 2)) assert.deepEqual(result.routines[name], predecessor.routines[name]);
    for (const [name] of triggers.slice(0, 2)) assert.deepEqual(result.triggers[name], predecessor.triggers[name]);
  }
  return result;
}

function addCashVoucherAcl(plan) {
  return {
    ...plan,
    read: { ...plan.read, RegisteredFundAccount: [...plan.read.RegisteredFundAccount, "xmin"] },
    functions: [...plan.functions, command]
  };
}

function readAcl(app, observer) {
  for (const role of [app, observer]) assert.match(role, /^jg_[a-z0-9_]+$/u);
  return `SELECT jsonb_build_object(
    'writerRestricted', has_function_privilege('${app}','${command}','EXECUTE')
      AND NOT has_function_privilege('${app}','${command}','EXECUTE WITH GRANT OPTION')
      AND NOT has_function_privilege('${observer}','${command}','EXECUTE')
      AND NOT EXISTS (SELECT FROM pg_proc p, LATERAL aclexplode(p.proacl) a
        WHERE p.oid='${command}'::regprocedure AND a.grantee=0),
    'private', NOT EXISTS (
      SELECT FROM (VALUES ('${app}'),('${observer}')) role(name)
      WHERE has_function_privilege(role.name,'${finish}','EXECUTE')
        OR has_function_privilege(role.name,'${rawOwnerVoucher}','EXECUTE')
        OR has_table_privilege(role.name,'${witness}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(role.name,'${witness}','SELECT,INSERT,UPDATE,REFERENCES')
    ),
    'accountWriteWitnessReadable', has_column_privilege('${app}','public."RegisteredFundAccount"','xmin','SELECT')
      AND NOT has_column_privilege('${app}','public."RegisteredFundAccount"','xmin','SELECT WITH GRANT OPTION')
      AND NOT has_column_privilege('${observer}','public."RegisteredFundAccount"','xmin','SELECT'),
    'historicalWriteDenied', NOT has_column_privilege('${app}','public."OperatingTakeoverBatch"','revision','UPDATE')
      AND NOT has_any_column_privilege('${observer}','public."OperatingTakeoverActivation"','INSERT,UPDATE,REFERENCES')
  );`;
}

function projectMigrationError(text) {
  const result = projectMigration342Error(text);
  if (!result) return undefined;
  const scope = /^psql:<stdin>:\d{1,6}: ERROR:\s+55000: EXPENSE_PUBLIC_CASH_VOUCHER_INSTALL_SCOPE$/mu.test(text);
  return scope ? { ...result, guard: "VOUCHER_INSTALL_SCOPE" } : result;
}

module.exports = { command, readCatalog, verifyCatalog, addCashVoucherAcl, readAcl, projectMigrationError };
