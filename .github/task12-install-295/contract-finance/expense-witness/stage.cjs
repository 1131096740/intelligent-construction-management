'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { final } = require('../common/multi-witness.cjs');
const cases = require('../pol115/cases.json');
const [prepared, sha, output, scope] = process.argv.slice(2);
const hash = value => createHash('sha256').update(value).digest('hex');
const source = require(path.join(prepared, 'source.json'));
const precision = source.mode === 'expense-witness-349';
const witness = require('../expense-witness-346-profile.cjs');
const profile = precision ? require('../expense-witness-349-profile.cjs')
  : source.mode === witness.mode ? witness : require('../expense-witness-345-profile.cjs');
if (precision) assert.equal(scope, '--issue417-history-expense', 'EXPENSE_WITNESS_349_SCOPE');
assert.equal(source.sourceSha, sha);
profile.assertSource(source, final);
if (precision) profile.assertRuntimeBaseline(require(path.join(prepared,
  'prepared/context/workspace/services/api/prisma/migration-baseline.cjs')));

const file = 'src/expense-claim/expense-claim-entry.http.pg.spec.ts';
const helper = 'src/database/pol115-owned-334.test-support.ts';
const original = fs.readFileSync(path.join(prepared, 'prepared/context/workspace/services/api', file), 'utf8');
const helperBytes = fs.readFileSync(path.join(__dirname, '../pol115', path.basename(helper)));
const recipe = cases.pol115.find(item => item.file === file);
assert.equal(hash(original), recipe.candidateSha256);
assert.equal(hash(helperBytes), '1d8463a0aae92d9dd696eda63c56482e455f271ac90f5f028c94b4e8f2ad7526');
const before = 'url.pathname !== "/jiangkong_pol115_entry_test"';
assert.equal(original.split(before).length, 2);
const adapted = 'import { isPol115Owned334 } from "../database/pol115-owned-334.test-support";\n' +
  original.replace(before, '(' + before + ' && !isPol115Owned334(url, "pol115-main"))');
for (const [name, contents] of [[file, adapted], [helper, helperBytes]]) {
  const staged = path.join(output, 'fixtures', name);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.writeFileSync(staged, contents, { flag: 'wx' });
  if (profile.count >= 346) fs.chmodSync(staged, 0o644);
}
execFileSync(process.execPath, [path.join(__dirname, '../stage-historical-takeover-333.cjs'), output, 'historical-settlement-334']);
execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'installer.patch')], { cwd: output });
const installer = path.join(output, 'installer.cjs');
assert.equal(hash(fs.readFileSync(installer)), witness.installerSha256);
if (precision) {
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'installer-349.patch')], { cwd: output });
  const race = 'historical-expense-335-race.cjs';
  const staged = path.join(output, race);
  const history = require('../historical-expense-335-profile.cjs');
  const original = fs.readFileSync(path.join(__dirname, '..', race));
  assert.equal(hash(original), history.raceSha256);
  fs.writeFileSync(staged, original, { flag: 'wx' });
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'issue417-race-349.patch')], { cwd: output });
  assert.equal(hash(fs.readFileSync(staged)), history.race349Sha256);
  fs.chmodSync(staged, 0o644);
}
const installerSha256 = hash(fs.readFileSync(installer));
if (precision) assert.equal(installerSha256, profile.installerSha256);
if (profile.count >= 346) fs.chmodSync(installer, 0o644);
const input = { sourceSha: sha, sourceTree: source.sourceTree, ledgerSha256: source.ledgerSha256, installerSha256,
  fixtures: { [file]: hash(adapted), [helper]: hash(helperBytes) },
  recipe: { registered: recipe.reported, namesSha256: recipe.namesSha256 } };
const inputFile = path.join(output, 'expense-witness-inputs.json');
fs.writeFileSync(inputFile, JSON.stringify(input) + '\n', { flag: 'wx' });
if (profile.count >= 346) fs.chmodSync(inputFile, 0o644);
process.stdout.write(JSON.stringify({ status: 'EXPENSE_WITNESS_' + profile.count + '_HOST_READY', ...input }) + '\n');
