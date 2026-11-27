'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const cases = require('./cases.json');
const { pol115Scope } = require('./verify-pol115-jest.cjs');
const historical = require('../historical-settlement-334-profile.cjs');
const { final } = require('../common/multi-witness.cjs');

const [prepared, candidateSha, scope, output] = process.argv.slice(2);
assert.equal(process.argv.length, 6);
const selected = pol115Scope(cases, scope);
assert.match(candidateSha, /^[a-f0-9]{40}$/u);
const source = require(path.join(prepared, 'source.json'));
assert.equal(source.sourceSha, candidateSha);
const company = source.mode === 'company-history-352';
if (company) assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'POL115_352_LOCAL_ONLY');
const precision = company || source.mode === 'expense-witness-349';
const expenseWitness = precision || source.mode === 'expense-witness-346' ? require('../expense-witness-346-profile.cjs') : null;
const profile = company ? require('../company-history-352-profile.cjs') : precision ? require('../expense-witness-349-profile.cjs') : expenseWitness ?? historical;
profile.assertSource(source, final);

const workspace = path.join(prepared, 'prepared/context/workspace');
const api = path.join(workspace, 'services/api');
const { coveredGroups } = require(path.join(api, 'prisma/database-dynamic-gate-manifest.json'));
const { BATCH_FILES, POL113_POL115_GROUP } = require(path.join(api, 'prisma/pol113-pol115-shards.cjs'));
const group = coveredGroups.find(entry => entry.id === POL113_POL115_GROUP);
assert.equal(group.pendingTests, 191);
const registered = new Map(group.testFiles.map(({ path: file, pendingTests }) => [file, pendingTests]));
const batch = scope === 'spot' ? 'spot' : 'pol115';
assert.deepEqual(cases[batch].map(({ file }) => file), BATCH_FILES[batch]);

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function read(file) {
  assert.ok(fs.lstatSync(file).isFile(), file);
  return fs.readFileSync(file);
}
function write(relative, bytes) {
  assert.match(relative, /^src\/(?:[a-z0-9.-]+\/)*[a-z0-9.-]+$/u);
  const target = path.join(output, 'fixtures', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
  if (expenseWitness) fs.chmodSync(target, 0o644);
}
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, before);
  return text.replace(before, after);
}

const support = 'src/database/pol115-owned-334.test-support.ts';
const helper = read(path.join(__dirname, path.basename(support)));
write(support, helper);
const fixtureHashes = { [support]: hash(helper) };
const browserSpecs = new Set([
  'expense-claim-entry.http.pg.spec.ts', 'fund-execution-entry.http.pg.spec.ts',
  'operating-takeover-entry.http.pg.spec.ts', 'spot-procurement-entry.http.pg.spec.ts'
]);
for (const row of selected) {
  const { file, declared, reported, skipped, candidateSha256 } = row;
  assert.equal(declared, registered.get('services/api/' + file));
  assert.equal(reported - declared, file.startsWith('src/expense-claim/') ? 2 : 0);
  assert.equal(skipped.length, scope === 'spot' ? 1 : 0);
  const original = read(path.join(api, file));
  assert.equal(hash(original), candidateSha256, file);
  const name = path.basename(file);
  const namespace = path.dirname(file) === 'src/database' ? '.' : '../database';
  const imports = browserSpecs.has(name)
    ? 'isPol115Owned334, pol115BrowserExitError, pol115BrowserSpawnError' : 'isPol115Owned334';
  const importLine = `import { ${imports} } from "${namespace}/pol115-owned-334.test-support";\n`;
  const owned = `isPol115Owned334(url, "${scope}")`;
  let adapted = importLine + original.toString('utf8');
  if (scope === 'spot') {
    adapted = once(adapted, 'url.pathname !== expectedDatabase ||',
      `(url.pathname !== expectedDatabase && (registeredFixture || !${owned})) ||`);
  } else if (name === 'issue430-notification.pg.spec.ts') {
    adapted = once(adapted, '|| isOwnedIssue430NativeDatabase(url)).toBe(true)',
      `|| isOwnedIssue430NativeDatabase(url) || ${owned}).toBe(true)`);
  } else {
    const selector = 'url.pathname !== "/jiangkong_pol115_entry_test"';
    adapted = once(adapted, selector, `(${selector} && !${owned})`);
  }
  if (browserSpecs.has(name)) {
    const cwd = 'cwd: resolve(__dirname, "../../../../apps/web-admin")';
    adapted = once(adapted, cwd, 'cwd: process.env.JG_POL115_334_WEB_ROOT ?? resolve(__dirname, "../../../../apps/web-admin")');
    adapted = once(adapted, 'child.on("error", reject)',
      'child.on("error", (error) => reject(pol115BrowserSpawnError(error)))');
    const exit = adapted.match(/child\.on\("exit", (?:\(code\)|code) => code === 0 \? done\(\) : reject\(new Error\("[^"\r\n]+"\)\)\)/gu);
    assert.equal(exit?.length, 1, 'POL115_BROWSER_EXIT_HANDLER ' + file);
    adapted = once(adapted, exit[0],
      'child.on("exit", (code, signal) => code === 0 ? done() : reject(pol115BrowserExitError(code, signal)))');
  }
  if (name === 'expense-claim-entry.http.pg.spec.ts') {
    // The historical loan balance belongs to the existing repayment projects.
    // It must not reserve an offset against the independent approval-round case.
    adapted = once(adapted, 'await seedDisbursedLoan(projectId);',
      'await seedDisbursedLoan(browserRepaymentProjectIds.desktop);');
    adapted = once(adapted, [
      '    for (const viewport of ["desktop", "mobile"] as const) {',
      '      browserRepaymentClaimIds[viewport] = (await seedDisbursedLoan(browserRepaymentProjectIds[viewport])).claim.id;',
      '    }'
    ].join('\n'), [
      '    browserRepaymentClaimIds.desktop = claim.id;',
      '    browserRepaymentClaimIds.mobile = (await seedDisbursedLoan(browserRepaymentProjectIds.mobile)).claim.id;'
    ].join('\n'));
  }
  write(file, adapted);
  fixtureHashes[file] = hash(adapted);
}
execFileSync(process.execPath, [path.join(__dirname, '../stage-historical-takeover-333.cjs'), output, historical.mode], { stdio: 'inherit' });
const installer = path.join(output, 'installer.cjs');
if (expenseWitness) {
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, '../expense-witness/installer.patch')], { cwd: output });
  assert.equal(hash(read(installer)), expenseWitness.installerSha256);
}
if (precision) {
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, '../expense-witness/installer-349.patch')], { cwd: output });
}
if (company) {
  for (const patch of ['installer-350.patch','installer-352.patch'])
    execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, '../expense-witness', patch)], { cwd: output });
}
assert.equal(hash(read(installer)), profile.installerSha256);
if (expenseWitness) fs.chmodSync(installer, 0o644);
const receipt = { sourceSha: candidateSha, sourceTree: source.sourceTree, scope, ledgerSha256: source.ledgerSha256,
  installerSha256: profile.installerSha256, fixtureSha256: fixtureHashes,
  declared: selected.reduce((sum, row) => sum + row.declared, 0),
  currentCases: selected.reduce((sum, row) => sum + row.reported, 0) };
const inputFile = path.join(output, 'pol115-334-inputs.json');
fs.writeFileSync(inputFile, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o644 });
if (expenseWitness) fs.chmodSync(inputFile, 0o644);
console.log(JSON.stringify({ status: 'POL115_' + source.migrationCount + '_HOST_READY', ...receipt }));
