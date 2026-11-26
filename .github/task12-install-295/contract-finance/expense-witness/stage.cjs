'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const profile = require('../expense-witness-345-profile.cjs');
const { final } = require('../common/multi-witness.cjs');
const cases = require('../pol115/cases.json');
const [prepared, sha, output] = process.argv.slice(2);
const hash = value => createHash('sha256').update(value).digest('hex');
const source = require(path.join(prepared, 'source.json'));
assert.equal(source.sourceSha, sha);
profile.assertSource(source, final);

const file = 'src/expense-claim/expense-claim-entry.http.pg.spec.ts';
const helper = 'src/database/pol115-owned-334.test-support.ts';
const original = fs.readFileSync(path.join(prepared, 'prepared/context/workspace/services/api', file), 'utf8');
const helperBytes = fs.readFileSync(path.join(__dirname, '../pol115', path.basename(helper)));
const recipe = cases.pol115.find(item => item.file === file);
assert.equal(hash(original), recipe.candidateSha256);
assert.equal(hash(helperBytes), 'd6f04c3158d257550f574b76d0ab7ba3215d2f8f868d7d7af7218cd84dddfb31');
const before = 'url.pathname !== "/jiangkong_pol115_entry_test"';
assert.equal(original.split(before).length, 2);
const adapted = 'import { isPol115Owned334 } from "../database/pol115-owned-334.test-support";\n' +
  original.replace(before, '(' + before + ' && !isPol115Owned334(url, "pol115"))');
for (const [name, contents] of [[file, adapted], [helper, helperBytes]]) {
  const staged = path.join(output, 'fixtures', name);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.writeFileSync(staged, contents, { flag: 'wx' });
}
execFileSync(process.execPath, [path.join(__dirname, '../stage-historical-takeover-333.cjs'), output, 'historical-settlement-334']);
execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'installer.patch')], { cwd: output });
const installerSha256 = hash(fs.readFileSync(path.join(output, 'installer.cjs')));
assert.equal(installerSha256, '1c82f256be95909a40f71e557a9d66500cf56968a3bb6b829de08c6bf4f64f50');
const input = { sourceSha: sha, sourceTree: source.sourceTree, ledgerSha256: source.ledgerSha256, installerSha256,
  fixtures: { [file]: hash(adapted), [helper]: hash(helperBytes) },
  recipe: { registered: recipe.reported, namesSha256: recipe.namesSha256 } };
fs.writeFileSync(path.join(output, 'expense-witness-inputs.json'), JSON.stringify(input) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ status: 'EXPENSE_WITNESS_345_HOST_READY', ...input }) + '\n');
