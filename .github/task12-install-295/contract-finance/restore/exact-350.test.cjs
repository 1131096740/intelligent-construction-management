'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const signed = require('../signed-settlement-350-profile.cjs');
const expense346 = require('../expense-witness-346-profile.cjs');
const precision = require('../expense-witness-349-profile.cjs');
const exact = require('./exact-350.cjs');

const migrations = path.resolve(__dirname, '../../../../services/api/prisma/migrations');
const ledger = fs.readdirSync(migrations, { withFileTypes: true })
  .filter(row => row.isDirectory()).map(row => row.name).sort().map(name => ({
    name, sha256: exact.hash(fs.readFileSync(path.join(migrations, name, 'migration.sql'))),
    finished: true, rolledBack: false
  }));
const source = {
  migrationCount: signed.count,
  ledgerSha256: signed.ledgerSha256,
  sourceTree: 'a'.repeat(40),
  predecessor: { migrationCount: 295 },
  predecessor334: { migrationCount: 334, ledgerSha256: require('../historical-settlement-334-profile.cjs').ledgerSha256 },
  predecessor346: { migrationCount: 346, ledgerSha256: expense346.ledgerSha256 },
  predecessor349: { migrationCount: 349, ledgerSha256: precision.ledgerSha256 },
  tails: ledger.slice(295)
};

test('restore binds original fixture and exact 346/349/350 migration bytes', () => {
  assert.equal(exact.fixtureSha, 'a187dc73a133114e1cfbbc891a4aec923abe2545');
  exact.assertMigrationBytes(migrations, source);
  for (const index of [333, 345, 348, 349]) {
    const changed = structuredClone(ledger);
    changed[index].sha256 = '0'.repeat(64);
    assert.throws(() => exact.assertLedger(changed, source), { code: 'ERR_ASSERTION' });
  }
});

const proof = (count, ledgerSha256, previousCount) => ({
  count, ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
  tails: ledger.slice(previousCount, count).map(({ name, sha256 }) => ({ name, sha256 }))
});

test('restore consumes only the same database with proof of all intermediate and terminal migrations', () => {
  const historical = {
    assertFinanceInstallation(_receipt, historicalSource) {
      assert.deepEqual(historicalSource.tails, source.tails.slice(0, 39));
    }
  };
  const receipt = {
    forward320: { sameBaseB7: true },
    expenseWitnessForward: proof(346, expense346.ledgerSha256, 334),
    expenseWitnessPrecisionForward: proof(349, precision.ledgerSha256, 346),
    signedSettlementForward: proof(350, signed.ledgerSha256, 349)
  };
  assert.deepEqual(exact.forward(receipt, source, historical), { ...receipt.signedSettlementForward, sameBaseB7: true });
  assert.throws(() => exact.forward({
    ...receipt, signedSettlementForward: { ...receipt.signedSettlementForward, sameIdentity: false }
  }, source, historical), /BACKUP350_FORWARD_LEDGER/u);
  assert.throws(() => exact.forward({
    ...receipt, expenseWitnessPrecisionForward: { ...receipt.expenseWitnessPrecisionForward, ledgerSha256: '0'.repeat(64) }
  }, source, historical), /BACKUP349_FORWARD_LEDGER/u);
});

function catalog(oid) {
  return {
    historical: { review: { oid, sha256: 'a'.repeat(64), grants: ['owner'] } },
    expense: { columns: {}, constraints: { guard: { oid, digest: 'b'.repeat(64) } }, guards: {} },
    changedChecks: { guard: 'CHECK (source_is_signed)' },
    sources: { sourceGuard: { body: 'c'.repeat(64), ownerOnly: true, invoker: true, deferred: true } }
  };
}

test('restore tolerates new catalog OIDs and rejects changes to guards, constraints and ACLs', () => {
  exact.assertRestoredSignedCatalog(catalog(1000), catalog(2000));
  for (const change of [
    row => { row.historical.review.grants.push('public'); },
    row => { row.expense.constraints.guard.digest = '0'.repeat(64); },
    row => { row.changedChecks.guard = 'CHECK (true)'; },
    row => { row.sources.sourceGuard.ownerOnly = false; },
    row => { row.sources.sourceGuard.deferred = false; }
  ]) {
    const restored = catalog(2000);
    change(restored);
    assert.throws(() => exact.assertRestoredSignedCatalog(catalog(1000), restored), { code: 'ERR_ASSERTION' });
  }
});


test('restore installer is assembled from the frozen 350 installer and the 295-lease wrapper', t => {
  const plan = path.join(__dirname, '..');
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'session-restore350-'));
  t.after(() => {
    fs.unlinkSync(path.join(staged, 'installer.cjs'));
    fs.rmdirSync(staged);
  });
  const installer = path.join(staged, 'installer.cjs');
  execFileSync(process.execPath, [path.join(plan, 'stage-historical-takeover-333.cjs'), staged, 'historical-settlement-334']);
  for (const patch of ['installer.patch', 'installer-349.patch', 'installer-350.patch']) {
    execFileSync('git', ['apply', '--unidiff-zero', path.join(plan, 'expense-witness', patch)], { cwd: staged });
  }
  assert.equal(exact.hash(fs.readFileSync(installer)), signed.installerSha256);
  fs.appendFileSync(installer, fs.readFileSync(path.join(__dirname, 'installer-350-tail.cjs')));
  assert.equal(exact.hash(fs.readFileSync(installer)), exact.installerSha256);
});
