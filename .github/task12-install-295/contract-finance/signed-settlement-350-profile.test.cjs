'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const profile = require('./signed-settlement-350-profile.cjs');

const repo = path.resolve(__dirname, '../../..');
const previousLedger = '8bfe19831eeb7da7c38c8a4f8c4cda98b9b1a165bf4013f0e39816c0fd340679';
const finalLedger = '6dd4b8f7c484e4afeacd893991256275b087e2ae1ee2c940df87f812dc60a860';
const cleanup = 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT';

function readSource() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  return JSON.parse(execFileSync(process.execPath, [
    path.join(__dirname, 'check-ledger.cjs'), repo, sha, '--signed-settlement-350'
  ], { encoding: 'utf8' }));
}

test('the installed-lineage receipt requires the exact 349 prefix and same-db 350 post-check', () => {
  const source = readSource();
  const identity = { sourceTree: source.sourceTree, sameIdentity: true };
  const checkpoint = (count, ledgerSha256, rows) => ({
    ...identity, count, ledgerSha256, tails: rows.map(({ name, sha256 }) => ({ name, sha256 }))
  });
  const completed = {
    sourceSha: source.sourceSha, business: 'CALLBACK_COMPLETED', cleanup,
    expenseWitnessPrecisionForward: checkpoint(349, previousLedger, source.tails.slice(-4, -1)),
    signedSettlementForward: checkpoint(350, finalLedger, source.tails.slice(-1)),
    combinedAfterBusiness: { count: 350, ledgerSha256: finalLedger, sameIdentity: true, exactB7: true },
    signedSettlementCatalogAfterBusiness: true
  };

  assert.doesNotThrow(() => profile.assertInstallation(completed, source));
  const badPrefix = { ...completed, expenseWitnessPrecisionForward: {
    ...completed.expenseWitnessPrecisionForward, ledgerSha256: finalLedger
  } };
  assert.throws(() => profile.assertInstallation(badPrefix, source), /SIGNED_SETTLEMENT_350_PREDECESSOR/u);
  const badTail = { ...completed, signedSettlementForward: {
    ...completed.signedSettlementForward, tails: completed.expenseWitnessPrecisionForward.tails.slice(-1)
  } };
  assert.throws(() => profile.assertInstallation(badTail, source), /SIGNED_SETTLEMENT_350_FORWARD/u);
  const foreignDatabase = { ...completed, combinedAfterBusiness: {
    ...completed.combinedAfterBusiness, sameIdentity: false
  } };
  assert.throws(() => profile.assertInstallation(foreignDatabase, source), /SIGNED_SETTLEMENT_350_POST_BUSINESS/u);
  assert.throws(() => profile.assertInstallation({
    ...completed, signedSettlementCatalogAfterBusiness: false
  }, source), /SIGNED_SETTLEMENT_350_POST_BUSINESS/u);
  assert.throws(() => profile.assertInstallation({ ...completed, cleanup: 'STARTED' }, source),
    /SIGNED_SETTLEMENT_350_CLEANUP/u);
});

test('the existing local-only runtime requires a 349 manifest and 350 disk baseline', () => {
  const baseline = require('../../../services/api/prisma/migration-baseline.cjs');
  profile.assertRuntimeBaseline(baseline);
  const published350 = { migrationBaseline: baseline.deriveMigrationBaseline() };
  assert.throws(() => profile.assertRuntimeBaseline({
    ...baseline, loadManifest: () => published350
  }), /SIGNED_SETTLEMENT_350_LOCAL_ONLY/u);
});

test('the retained installer is staged above the frozen local-only normal installer', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-signed-350-retained-'));
  t.after(() => fs.rmSync(output, { recursive: true }));
  execFileSync(process.execPath, [path.join(__dirname, 'stage-historical-takeover-333.cjs'), output,
    'historical-settlement-334']);
  const apply = file => execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, file)], { cwd: output });
  for (const name of ['installer.patch', 'installer-349.patch', 'installer-350.patch']) {
    apply('expense-witness/' + name);
  }
  const installer = path.join(output, 'installer.cjs');
  const hash = () => createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  assert.equal(hash(), '092c7fc57d3c8c9a065264cee5b0253b2b91497448198ab02ed46362be6ee2c0');
  assert.equal(hash(), profile.installerSha256);
  apply('remaining-retained-350-installer.patch');
  assert.equal(hash(), profile.retainedInstallerSha256);
  execFileSync(process.execPath, ['--check', installer]);
  for (const file of ['signed-settlement-350-profile.cjs', 'expense-witness-349-profile.cjs',
    'expense-witness-346-profile.cjs', 'expense-witness-345-profile.cjs', 'expense-witness-prefixes.json',
    'historical-settlement-334-profile.cjs', 'historical-takeover-333-profile.cjs', 'upward-archive-332-profile.cjs',
    'text-direct-330-profile.cjs', 'common/multi-witness.cjs', 'common/checkout.cjs', 'common/scope.json',
    'common/terminal.cjs', 'common/payout-terminal.cjs', 'common/successor.cjs', 'common/install-only292.cjs']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(output, path.basename(file)));
  }
  const exports = require(installer);
  for (const method of ['withCombinedSignedSettlement350', 'withCombined350RetainedCleanup',
    'withCombined350MultiWitnessForProfile']) {
    const enter = () => assert.fail('the callback must remain unentered');
    assert.throws(() => exports[method]({}, enter, { mode: 'expense-witness-349' }), /signed-settlement-350/u);
    assert.throws(() => exports[method]({}, enter, {
      mode: 'signed-settlement-350', migrationCount: 350, ledgerSha256: finalLedger,
      predecessor349: { migrationCount: 349, ledgerSha256: finalLedger }
    }), new RegExp(previousLedger, 'u'));
  }
});
