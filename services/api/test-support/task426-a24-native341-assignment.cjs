"use strict";

const assert = require("node:assert/strict");
const signature = "public.jg_lock_standalone_expense_assignment_v1()";
const routineSha256 = "a9ddd8f3cdd09c73b92444745e21f55bdca12702d6a33e92132c80800ce7962d";

function readExpenseAssignmentLock(app) {
  assert.match(app, /^jg_fixture_app_[a-f0-9]{24}$/u);
  // Read metadata only. Preserve both ordinary role prohibitions from Normal.
  return `SELECT jsonb_build_object(
    'routineOid', p.oid::text,
    'safe', p.prokind = 'f' AND p.prosecdef AND p.pronargs = 0
      AND p.prorettype = 'pg_catalog.trigger'::regtype AND p.provolatile = 'v'
      AND p.proowner = (SELECT datdba FROM pg_database WHERE datname = current_database())
      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = '${routineSha256}'
      AND NOT EXISTS (
        SELECT FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee <> p.proowner OR a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE'
      )
      AND NOT has_function_privilege('${app}', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('${app}', 'public.jg_lock_normal_generated_archive_assignment_v1(text)', 'EXECUTE')
      AND NOT has_any_column_privilege('${app}', 'public."ProjectAffiliateAssignment"'::regclass, 'UPDATE')
      AND NOT has_column_privilege('${app}', 'public."Project"'::regclass, 'constructionEnterpriseLockedAt', 'UPDATE')
      AND EXISTS (
        SELECT FROM pg_trigger legacy JOIN pg_proc impl ON impl.oid = legacy.tgfoid
        WHERE legacy.tgrelid = 'public."ContractVersion"'::regclass
          AND legacy.tgname = 'ContractVersion_lock_construction_enterprise'
          AND legacy.tgfoid = 'public."lockProjectConstructionEnterpriseFromFormalFact"()'::regprocedure
          AND legacy.tgtype = 21 AND legacy.tgenabled = 'O' AND legacy.tgqual IS NULL
          AND NOT impl.prosecdef AND impl.proowner = p.proowner
          AND encode(sha256(convert_to(impl.prosrc, 'UTF8')), 'hex') =
            '437dbc3b138068a70740aa9216b77d54a90e13f3b2c442f29e62abef2fb5ee4f'
      )
      AND (SELECT count(*) FROM pg_trigger WHERE tgfoid = p.oid) = 1,
    'triggers', (
      SELECT jsonb_agg(jsonb_build_object('name', t.tgname, 'oid', t.oid::text,
        'predicateSha256', encode(sha256(convert_to(t.tgqual::text, 'UTF8')), 'hex'),
        'routine', f.proname, 'safe', t.tgtype = 21 AND t.tgenabled = 'O' AND NOT t.tgisinternal
          AND NOT (t.tgdeferrable OR t.tginitdeferred) AND t.tgconstraint = 0
          AND t.tgqual IS NOT NULL AND t.tgnargs = 0 AND t.tgattr::text = '')
        ORDER BY t.tgname COLLATE "C")
      FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
      WHERE t.tgrelid = 'public."ExpenseClaim"'::regclass
        AND t.tgname IN ('ExpenseClaim_lock_construction_enterprise', 'ExpenseClaim_lock_standalone_assignment')
    )) FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure;`;
}

function verifyExpenseAssignmentLock(row) {
  assert.equal(row.safe, true, "NATIVE_A24_341_ASSIGNMENT_ACL");
  assert.match(row.routineOid, /^[1-9][0-9]*$/u);
  assert.deepEqual(row.triggers.map(({ name, routine }) => [name, routine]), [
    ["ExpenseClaim_lock_construction_enterprise", "lockProjectConstructionEnterpriseFromFormalFact"],
    ["ExpenseClaim_lock_standalone_assignment", "jg_lock_standalone_expense_assignment_v1"]
  ], "NATIVE_A24_341_ASSIGNMENT_WIRING");
  assert.ok(row.triggers.every(trigger => trigger.safe === true && /^[1-9][0-9]*$/u.test(trigger.oid)
    && /^[a-f0-9]{64}$/u.test(trigger.predicateSha256)));
  assert.notEqual(row.triggers[0].predicateSha256, row.triggers[1].predicateSha256);
  return row;
}

module.exports = { readExpenseAssignmentLock, verifyExpenseAssignmentLock, routineSha256 };
