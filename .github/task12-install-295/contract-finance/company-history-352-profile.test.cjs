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

test('352 ledger preparation remains unavailable to hosted CI until the full matrix is admitted', () => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SIGNED_SETTLEMENT_350_LOCAL_ONLY/u);
});
