'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const profile = require('./company-history-352-profile.cjs');
const previous = require('./signed-settlement-350-profile.cjs');
const repo = path.resolve(__dirname, '../../..');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const args = [path.join(__dirname, 'check-ledger.cjs'), repo, sha, '--company-history-352'];

test('the exact 352 ledger retains the 350 predecessor and rejects tampering', () => {
  const source = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  assert.equal(source.migrationCount, 352);
  assert.equal(source.ledgerSha256, profile.ledgerSha256);
  assert.deepEqual(source.predecessor350, { migrationCount: 350, ledgerSha256: previous.ledgerSha256 });
  assert.deepEqual(source.tails.slice(-2), profile.tails);
  profile.assertSource(source, source.predecessor.ledgerSha256);
  profile.assertPrefix(351, profile.prefix351);
  profile.assertRuntimeBaseline(require('../../../services/api/prisma/migration-baseline.cjs'));
  assert.throws(() => profile.assertSource({ ...source, predecessor350: { migrationCount: 350,
    ledgerSha256: '0'.repeat(64) } }, source.predecessor.ledgerSha256), /COMPANY_HISTORY_352_PREDECESSOR/u);
  assert.throws(() => profile.assertSource({ ...source, tails: [...source.tails.slice(0, -1),
    { ...profile.terminal, sha256: '0'.repeat(64) }] }, source.predecessor.ledgerSha256), /COMPANY_HISTORY_352_TERMINAL/u);
  assert.throws(() => profile.assertPrefix(351, '0'.repeat(64)), /COMPANY_HISTORY_351_PREFIX/u);
});

test('the 352 receipt requires the installed predecessor, same database and cleanup', () => {
  const source = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  const identity = { sameIdentity: true, sourceTree: source.sourceTree };
  const receipt = { sourceSha: source.sourceSha, business: 'CALLBACK_COMPLETED',
    cleanup: 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT', signedSettlementCatalogAfterBusiness: true,
    signedSettlementForward: { ...identity, count: 350, ledgerSha256: previous.ledgerSha256,
      tails: [{ name: previous.terminal.name, sha256: previous.terminal.sha256 }] },
    companyHistoryForward: { ...identity, count: 352, ledgerSha256: profile.ledgerSha256,
      tails: profile.tails.map(({ name, sha256 }) => ({ name, sha256 })) },
    combinedAfterBusiness: { count: 352, ledgerSha256: profile.ledgerSha256, sameIdentity: true, exactB7: true } };
  profile.assertInstallation(receipt, source);
  assert.throws(() => profile.assertInstallation({ ...receipt, companyHistoryForward: {
    ...receipt.companyHistoryForward, sameIdentity: false } }, source), /COMPANY_HISTORY_352_FORWARD_RECEIPT/u);
  assert.throws(() => profile.assertInstallation({ ...receipt, cleanup: 'STARTED' }, source), /COMPANY_HISTORY_352_CLEANUP/u);
  assert.throws(() => profile.assertInstallation({ ...receipt, combinedAfterBusiness: {
    ...receipt.combinedAfterBusiness, count: 350 } }, source), /COMPANY_HISTORY_352_POST_BUSINESS/u);
});

test('hosted 352 preparation uses the same sealed ledger and leaves 350 blocked', () => {
  const env = { ...process.env, GITHUB_ACTIONS: 'true' };
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ledgerSha256, profile.ledgerSha256);
  const old = spawnSync(process.execPath, [args[0], repo, sha, '--signed-settlement-350'], { encoding: 'utf8', env });
  assert.notEqual(old.status, 0);
  assert.match(old.stderr, /SIGNED_SETTLEMENT_350_LOCAL_ONLY/u);
});
