'use strict';

const assert = require('node:assert/strict');
const previous = require('./expense-witness-345-profile.cjs');
const historical = require('./historical-settlement-334-profile.cjs');

const mode = 'expense-witness-346';
const count = 346;
const installerSha256 = '50208a12c5ac61b396655807e87f8c86ea92db83aa2a3297c38f253735ce155d';
const ledgerSha256 = 'bdddd170728d7c28c1b5a4f4a4b2b8981aa1ba2d041590475d695427502d8225';
const terminal = Object.freeze({
  name: '20261129015000_expense_public_cash_operating_source',
  sha256: 'd2f1419df6337020ad7dc5385b4b52a2997f276656dd3ff90f71d8c62f5c8b9a',
  finished: true,
  rolledBack: false
});

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.equal(source.migrationCount, count);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.tails.at(-1), terminal);
  previous.assertSource({
    ...source, mode: previous.mode, migrationCount: previous.count,
    ledgerSha256: previous.ledgerSha256, tails: source.tails.slice(0, -1)
  }, predecessor295);
}

function assertRuntimeBaseline({ loadManifest, deriveMigrationBaseline, DEFAULT_MANIFEST_PATH }) {
  const admitted = loadManifest(DEFAULT_MANIFEST_PATH).migrationBaseline;
  const installed = deriveMigrationBaseline();
  assert.deepEqual(
    [admitted.expectedDirectoryCount, admitted.terminalMigration, admitted.terminalMigrationChecksum],
    [334, historical.terminal.name, historical.terminal.sha256],
    'CASH_OPERATING_346_RELEASE_SCOPE'
  );
  assert.deepEqual(
    [installed.expectedDirectoryCount, installed.terminalMigration, installed.terminalMigrationChecksum],
    [count, terminal.name, terminal.sha256],
    'CASH_OPERATING_346_RUNTIME_SCOPE'
  );
}

function assertPrefix(size, digest) {
  if (size === count) assert.equal(digest, ledgerSha256, 'EXPENSE_WITNESS_LEDGER_346');
  else previous.assertPrefix(size, digest);
}

const catalogSql = previous.catalogSql.replace(/\);$/u, `,
  'impactValidator', (SELECT jsonb_build_object('procedure', to_jsonb(p)-'prosrc', 'wiring', to_jsonb(t),
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."OperatingImpactEntry"'::regclass AND t.tgname='OperatingImpactEntry_validate_references'),
  'expenseCashGuards', (SELECT jsonb_object_agg(q.table_name,jsonb_build_object(
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'private',p.prosecdef AND p.proowner=current_user::regrole::oid
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND NOT EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) u
        WHERE u.grantee<>p.proowner OR u.grantor<>p.proowner OR u.privilege_type<>'EXECUTE' OR u.is_grantable),
    'condition',pg_get_triggerdef(t.oid)))
    FROM (VALUES ('OperatingFact','jg_validate_expense_public_cash_fact_v1'),
      ('OperatingImpactEntry','jg_validate_expense_public_cash_impact_v1')) q(table_name,routine)
    JOIN pg_trigger t ON t.tgrelid=to_regclass(format('public.%I',q.table_name))
      AND t.tgname=q.table_name||'_expense_public_cash_source' AND t.tgtype=7
      AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgnargs=0
    JOIN pg_proc p ON p.oid=t.tgfoid AND p.oid=to_regprocedure('public.'||q.routine||'()')),
  'preparedAdapterAbsent', to_regprocedure('public.jg_registered_payment_fact_guard()') IS NULL
    AND to_regprocedure('public.jg_registered_payment_cash_impact_guard()') IS NULL,
  'registeredPaymentGuards', (SELECT jsonb_object_agg(q.table_name,jsonb_build_object(
    'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
    'procedure',to_jsonb(p)-'prosrc','wiring',to_jsonb(t)))
    FROM (VALUES ('OperatingFact','OperatingFact_registered_payment','jg_registered_payment_fact_guard'),
      ('OperatingImpactEntry','OperatingImpactEntry_registered_cash','jg_registered_payment_cash_impact_guard'))
      q(table_name,hook,routine)
    JOIN pg_trigger t ON t.tgrelid=to_regclass(format('public.%I',q.table_name))
      AND t.tgname=q.hook AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgconstraint=0 AND t.tgnargs=0 AND t.tgqual IS NULL
    JOIN pg_proc p ON p.oid=t.tgfoid AND p.oid=to_regprocedure('public.'||q.routine||'()')
      AND p.proowner=current_user::regrole::oid AND NOT p.prosecdef)
);`);

const ordinaryImages = new Map([
  ['bcc05db15d2a1e2679e9887475a110ffc7cc5b08e423e0b737195ee74f63c4a6', {
    impact: 'd6666bbad410b5f1cacc8e40fe29dbaea990e2e101f9857cb14585d6a6a9d92b',
    nextFact: '1235c355fa2777269b1920f9922401a357a725039f14e3321e00b5a3d338c973',
    nextImpact: 'f9cc8b1db6c0fe72b0ee7d38e2193fb2a446e88f6da133e726b47424663f4250'
  }],
  ['61ea7834175ed793857205130b5cd33b163a4fad7d762d93ef46d45bbedbcaeb', {
    impact: 'e6d843c9d702ce00f88e79b1e7f83eac977df271c3962bb949b9299d78d9de3c',
    nextFact: '92f6f3e2e3e0f58bca1d00b5c631c0dd652b5552992dda991da3564429dc4644',
    nextImpact: '2db9ce648393690e5b1cf1e008b1a2df86b776d47240bca28fd04fe50f93ccc7'
  }]
]);

function assertCatalog(size, snapshot, before) {
  if (size < count) {
    previous.assertCatalog(size, snapshot, before);
    if (size === previous.count) {
      assert.equal(snapshot.expenseCashGuards, null, 'CASH_OPERATING_346_UNINSTALLED_GUARDS');
    }
    return;
  }
  assert.equal(size, count);
  assert.equal(snapshot.preparedAdapterAbsent, before.preparedAdapterAbsent, 'CASH_OPERATING_346_ADAPTER_CONTINUITY');
  for (const key of ['witness', 'foreignKey', 'witnessIndex', 'voucherBinding']) {
    assert.deepEqual(snapshot[key], before[key], 'CASH_OPERATING_346_PRIOR_GUARD_DRIFT');
  }
  if (before.preparedAdapterAbsent) {
    assert.equal(before.registeredPaymentGuards, null);
    assert.equal(snapshot.registeredPaymentGuards, null);
    const images = ordinaryImages.get(before.costValidator.body);
    assert.ok(images && before.impactValidator?.body === images.impact, 'CASH_OPERATING_346_ORDINARY_PREIMAGE');
    assert.deepEqual(snapshot.costValidator, { ...before.costValidator, body: images.nextFact });
    assert.deepEqual(snapshot.impactValidator, { ...before.impactValidator, body: images.nextImpact });
  } else {
    assert.equal(before.costValidator.body, 'f38dd0f9c476f613c16a73a7d4c52733effe50585bcf5f15b0e4c96a9437a987');
    assert.equal(before.impactValidator?.body, '78d1efbfb923ee5417b580e51e87dee29d33277fe510136c7f562e61007ae1da');
    assert.deepEqual(snapshot.costValidator, before.costValidator);
    assert.deepEqual(snapshot.impactValidator, before.impactValidator);
    for (const [table, original, successor] of [
      ['OperatingFact', '54abb9bca45f8cbf2ed3dd27abb0d86725e9bba7b863282e266dfa60377a837c',
        '9e7cf612da3cabbbe979b8a52813d766488b01aaa289da68272f612511167cd4'],
      ['OperatingImpactEntry', 'e8f260b939348210d529402bf7d0f30ff3d71f369a7cc7b4ae1169d8664e6751',
        'e59887d92a12c53d6af6e7116edc61be6ced6ac9ced8624512c3c337af30c5b4']
    ]) {
      const guard = before.registeredPaymentGuards?.[table];
      assert.equal(guard?.body, original, 'CASH_OPERATING_346_PREPARED_PREIMAGE');
      assert.deepEqual(snapshot.registeredPaymentGuards?.[table], { ...guard, body: successor });
    }
  }
  for (const [table, body] of [
    ['OperatingFact', '0cd263a827c1b4ddeb4f8aa61cb9e65c10f91002fc6ec1218253c914e43ecfa2'],
    ['OperatingImpactEntry', '4df155debf8024c2030f3e279e14bb8a63cf6f737bb5228a7269675c80c467d5']
  ]) {
    const guard = snapshot.expenseCashGuards?.[table];
    assert.ok(guard?.private && guard.condition.includes("'expense_claim_payment_execution'"), 'CASH_OPERATING_346_GUARD_SCOPE');
    assert.equal(guard.body, body, 'CASH_OPERATING_346_GUARD_BODY');
  }
}

module.exports = { mode, count, installerSha256, terminal, ledgerSha256, assertSource, assertPrefix, assertRuntimeBaseline, catalogSql, assertCatalog,
  cashSql: previous.cashSql, assertCash: previous.assertCash };
