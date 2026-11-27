'use strict';

const assert = require('node:assert/strict');
const previous = require('./expense-witness-349-profile.cjs');
const historical = require('./historical-settlement-334-profile.cjs');

const mode = 'signed-settlement-350';
const count = 350;
const installerSha256 = '092c7fc57d3c8c9a065264cee5b0253b2b91497448198ab02ed46362be6ee2c0';
const retainedInstallerSha256 = '2fb7824925d00a876b87c06fcf10eea04b12c4e8bae2c08b5d02ca4c01e02284';
const terminal = {
  name: '20261129019000_signed_settlement_exact_operating_cost',
  sha256: '86ad90ea7fad6231f1d8b24dd8e4eb25d5ba0b1696d3544f5999680ebaa4c6e4',
  finished: true,
  rolledBack: false
};
const ledgerSha256 = '6dd4b8f7c484e4afeacd893991256275b087e2ae1ee2c940df87f812dc60a860';

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode);
  assert.equal(source.migrationCount, count);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.deepEqual(source.predecessor349, { migrationCount: previous.count, ledgerSha256: previous.ledgerSha256 });
  assert.equal(source.tails.length, count - 295);
  assert.deepEqual(source.tails.at(-1), terminal);
  previous.assertSource({
    ...source, mode: previous.mode, migrationCount: previous.count,
    ledgerSha256: previous.ledgerSha256, tails: source.tails.slice(0, -1)
  }, predecessor295);
}

function assertPrefix(size, digest) {
  if (size === count) assert.equal(digest, ledgerSha256, 'SIGNED_SETTLEMENT_350_LEDGER');
  else previous.assertPrefix(size, digest);
}

function assertRuntimeBaseline({ loadManifest, deriveMigrationBaseline, DEFAULT_MANIFEST_PATH }) {
  const tuple = row => [row.expectedDirectoryCount, row.terminalMigration, row.terminalMigrationChecksum];
  assert.deepEqual(tuple(loadManifest(DEFAULT_MANIFEST_PATH).migrationBaseline),
    [previous.count, previous.terminal.name, previous.terminal.sha256], 'SIGNED_SETTLEMENT_350_LOCAL_ONLY');
  assert.deepEqual(tuple(deriveMigrationBaseline()),
    [count, terminal.name, terminal.sha256], 'SIGNED_SETTLEMENT_350_RUNTIME_SCOPE');
}

const changedChecks = ['OperatingFact_numeric_protocol_check', 'OperatingImpactEntry_numeric_protocol_check'];
const parentGuard = 'OperatingImpactEntry_money_protocol_parent';
const review = 'jg_review_signed_settlement_draft_v1';
const expectedSources = {
  OperatingFact_signed_settlement_exact_source: {
    body: 'efcde5593464f887125816bf7214a311e9a1ec1f52756e56984721bd3efc9a38',
    routine: 'jg_validate_signed_settlement_exact_fact', event: 7, deferred: false
  },
  OperatingFact_signed_settlement_exact_impacts: {
    body: '09811d48ae81ce33796dbe4b5492e27926e0b1b82297322a0276cc2c621e9930',
    routine: 'jg_require_signed_settlement_exact_impacts', event: 5, deferred: true
  }
};
const subquery = sql => sql.trim().replace(/;$/u, '');
const catalogSql = `
SELECT jsonb_build_object(
  'expense', (${subquery(previous.catalogSql)}),
  'historical', (${subquery(historical.catalogSql)}),
  'changedChecks', (
    SELECT jsonb_object_agg(c.conname, pg_get_constraintdef(c.oid))
    FROM pg_constraint c
    WHERE (c.conrelid, c.conname) IN (
      ('public."OperatingFact"'::regclass, 'OperatingFact_numeric_protocol_check'),
      ('public."OperatingImpactEntry"'::regclass, 'OperatingImpactEntry_numeric_protocol_check')
    )
  ),
  'sources', (
    SELECT coalesce(jsonb_object_agg(t.tgname, jsonb_build_object(
      'routine', p.proname, 'body', encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'ownerOnly', p.proowner=current_user::regrole::oid
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE'),
      'invoker', NOT p.prosecdef, 'configuration', p.proconfig,
      'event', t.tgtype, 'enabled', t.tgenabled='O', 'deferred', t.tgdeferrable AND t.tginitdeferred,
      'definition', pg_get_triggerdef(t.oid)
    )), '{}'::jsonb)
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."OperatingFact"'::regclass
      AND t.tgname IN ('OperatingFact_signed_settlement_exact_source', 'OperatingFact_signed_settlement_exact_impacts')
      AND NOT t.tgisinternal AND t.tgnargs=0
  )
);`;

function assertCatalog(after, before) {
  assert.deepEqual(before.sources, {}, 'SIGNED_SETTLEMENT_350_NEW_GUARDS_PREIMAGE');
  assert.deepEqual(after.historical, {
    ...before.historical,
    [review]: { ...before.historical[review], sha256: '05fbb37f45cc8b3a19a695d9e410b5f9725be11537c8497e9e34233aee73ca57' }
  }, 'SIGNED_SETTLEMENT_350_REVIEW_BODY_ONLY');
  for (const name of changedChecks) {
    assert.notEqual(after.expense.constraints[name].oid, before.expense.constraints[name].oid);
    assert.notEqual(after.expense.constraints[name].digest, before.expense.constraints[name].digest);
    assert.match(after.changedChecks[name], /signed_contract_settlement/u);
    assert.doesNotMatch(before.changedChecks[name], /signed_contract_settlement/u);
  }
  const updatedChecks = Object.fromEntries(changedChecks.map(name => [name, after.expense.constraints[name]]));
  assert.deepEqual(after.expense, {
    ...before.expense,
    constraints: { ...before.expense.constraints, ...updatedChecks },
    guards: { ...before.expense.guards, [parentGuard]: {
      ...before.expense.guards[parentGuard], body: '9b8980f85312ae53e4e94c98badefe460746536ab2e0786ef6f0e22286dc27f7'
    } }
  }, 'SIGNED_SETTLEMENT_350_EXPENSE_GUARDS_CONTINUITY');
  assert.deepEqual(Object.keys(after.sources).sort(), Object.keys(expectedSources).sort());
  for (const [name, expected] of Object.entries(expectedSources)) {
    const { definition, ...metadata } = after.sources[name];
    assert.deepEqual(metadata, {
      ...expected, ownerOnly: true, invoker: true, configuration: ['search_path=pg_catalog, pg_temp'], enabled: true
    }, 'SIGNED_SETTLEMENT_350_GUARD ' + name);
    assert.match(definition, /signed_contract_settlement/u);
    if (expected.deferred) assert.match(definition, /numericProtocolVersion/u);
  }
}

function assertInstallation(receipt, source) {
  assert.equal(receipt.sourceSha, source.sourceSha, 'SIGNED_SETTLEMENT_350_RECEIPT_SOURCE');
  const identity = { sameIdentity: true, sourceTree: source.sourceTree };
  const baseCount = source.predecessor.migrationCount;
  const previousTails = source.tails.slice(source.predecessor346.migrationCount - baseCount, previous.count - baseCount);
  assert.deepEqual(receipt.expenseWitnessPrecisionForward, {
    ...identity, count: previous.count, ledgerSha256: previous.ledgerSha256,
    tails: previousTails.map(({ name, sha256 }) => ({ name, sha256 }))
  }, 'SIGNED_SETTLEMENT_350_PREDECESSOR');
  assert.deepEqual(receipt.signedSettlementForward, {
    ...identity, count, ledgerSha256, tails: [{ name: terminal.name, sha256: terminal.sha256 }]
  }, 'SIGNED_SETTLEMENT_350_FORWARD');
  const after = receipt.combinedAfterBusiness;
  assert.ok(after?.count === count && after.ledgerSha256 === ledgerSha256 &&
    after.sameIdentity === true && after.exactB7 === true &&
    receipt.business === 'CALLBACK_COMPLETED' && receipt.signedSettlementCatalogAfterBusiness === true,
  'SIGNED_SETTLEMENT_350_POST_BUSINESS');
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT', 'SIGNED_SETTLEMENT_350_CLEANUP');
}

module.exports = { mode, count, installerSha256, retainedInstallerSha256, terminal, ledgerSha256, assertSource,
  assertPrefix, assertRuntimeBaseline, catalogSql, assertCatalog, assertInstallation };
