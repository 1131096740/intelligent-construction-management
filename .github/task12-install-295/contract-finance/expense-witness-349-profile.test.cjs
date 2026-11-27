'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const plan = __dirname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('the 349 installer composes on the frozen 346 postimage', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-hosted-349-patch-'));
  t.after(() => fs.rmSync(output, { recursive: true }));
  execFileSync(process.execPath, [path.join(plan, 'stage-historical-takeover-333.cjs'), output,
    'historical-settlement-334']);
  const apply = name => execFileSync('git', ['apply', '--unidiff-zero', path.join(plan, 'expense-witness', name)],
    { cwd: output });
  apply('installer.patch');
  const installer = path.join(output, 'installer.cjs');
  assert.equal(hash(fs.readFileSync(installer)), require('./expense-witness-346-profile.cjs').installerSha256);
  apply('installer-349.patch');
  const profile = require('./expense-witness-349-profile.cjs');
  assert.equal(hash(fs.readFileSync(installer)), profile.installerSha256);
  execFileSync(process.execPath, ['--check', installer]);
  for (const file of ['expense-witness-349-profile.cjs', 'expense-witness-346-profile.cjs',
    'expense-witness-345-profile.cjs', 'expense-witness-prefixes.json', 'historical-settlement-334-profile.cjs',
    'historical-takeover-333-profile.cjs', 'upward-archive-332-profile.cjs', 'text-direct-330-profile.cjs',
    'common/multi-witness.cjs', 'common/checkout.cjs', 'common/scope.json', 'common/terminal.cjs',
    'common/payout-terminal.cjs', 'common/successor.cjs', 'common/install-only292.cjs']) {
    fs.copyFileSync(path.join(plan, file), path.join(output, path.basename(file)));
  }
  assert.throws(() => require(installer).withCombinedExpenseWitness349({ stages: [] }, () => assert.fail(),
    { mode: 'expense-witness-346', migrationCount: 349 }), /expense-witness-349/);
});

test('the 349 runtime requires both the release manifest and the installed terminal', () => {
  const profile = require('./expense-witness-349-profile.cjs');
  const baseline = require('../../../services/api/prisma/migration-baseline.cjs');
  const manifest349 = baseline.loadManifest(baseline.DEFAULT_MANIFEST_PATH);
  profile.assertRuntimeBaseline(baseline);

  const prefix346 = require('./expense-witness-346-profile.cjs');
  const runtime346 = {
    expectedDirectoryCount: prefix346.count,
    terminalMigration: prefix346.terminal.name,
    terminalMigrationChecksum: prefix346.terminal.sha256
  };
  assert.throws(() => profile.assertRuntimeBaseline({
    ...baseline, deriveMigrationBaseline: () => runtime346
  }), /EXPENSE_PRECISION_349_RUNTIME_SCOPE/);
  assert.throws(() => profile.assertRuntimeBaseline({
    ...baseline, loadManifest: () => ({ ...manifest349, migrationBaseline: runtime346 })
  }), /EXPENSE_PRECISION_349_RELEASE_SCOPE/);
  assert.throws(() => profile.assertPrefix(350), /EXPENSE_PRECISION_PREFIX_SIZE/);
  assert.throws(() => profile.assertPrefix(349, prefix346.ledgerSha256), /EXPENSE_PRECISION_LEDGER_349/);
});
