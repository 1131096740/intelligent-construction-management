'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const title = 'keeps project principal limits isolated across two actual advance sources (A23)';
const originalRoleTitle = 'binds project duties and restricts public cash to the current comprehensive custodian';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalRunnerSha256 = 'c2c17739b6fd52ff369e9d76453dbd30338e52e615da31d3f96650ad092ac626';
const originalSpecSha256 = 'c541006fafbe750c4d8d1f5ee94c1fab74acc33083d4761b0167f5c3c2b85ca9';
const fragmentSha256 = 'ed7e03613be9b43e2d8eff8c806e1095487f632dca7d0e1744a8da89c8894d02';
const runnerSha256 = 'ff3ef7e101e8f86aefa66bd84a85030a48500f6f5f3becc4452097a52db1c1ae';
const specSha256 = 'c86f1c29b9390cdab69e85db7625ebc3e25a7ee97105f7d72406e2dec84edce2';

function replaceOnce(text, anchor, replacement) {
  assert.equal(text.split(anchor).length, 2, 'TASK409_A23_UNIQUE_ANCHOR');
  return text.replace(anchor, () => replacement);
}

function stage(work, source) {
  const api = path.join(work, 'services/api');
  const runnerPath = path.join(api, 'prisma/run-task398-shared-standard-local.cjs');
  const specPath = path.join(api, 'src/database/task27-principal-return.http.pg.spec.ts');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const spec = fs.readFileSync(specPath, 'utf8');
  const fragment = fs.readFileSync(path.join(__dirname, 'task409-a23-project-principal.fixture'), 'utf8');
  assert.equal(digest(runner), originalRunnerSha256);
  assert.equal(digest(spec), originalSpecSha256);
  assert.equal(digest(fragment), fragmentSha256);

  const stagedRunner = [
    [' const modes=new Map([["cash-handover-349"', ' const modes=new Map([["principal-return-a23-349",["--principal-return-roles-real"]],["cash-handover-349"'],
    [' const exact349=mode==="cash-handover-349"||mode==="principal-return-349";', ' const exact349=mode==="cash-handover-349"||mode==="principal-return-349"||mode==="principal-return-a23-349";'],
    ['    standard290?.lane==="principal-return"?', `    standard290?.lane==="principal-return-a23"?[${JSON.stringify(title)},1]:\n    standard290?.lane==="principal-return"?`]
  ].reduce((text, [before, after]) => replaceOnce(text, before, after), runner);
  const beforeReturn = '        expect(await observer.operatingImpactEntry.count()).toBe(0);\n        return;';
  const stagedSpec = replaceOnce(replaceOnce(spec, originalRoleTitle, title), beforeReturn,
    '        expect(await observer.operatingImpactEntry.count()).toBe(0);\n' + fragment + '        return;');

  assert.equal(digest(stagedRunner), runnerSha256, 'TASK409_A23_RUNNER_FINGERPRINT');
  assert.equal(digest(stagedSpec), specSha256, 'TASK409_A23_SPEC_FINGERPRINT');
  fs.writeFileSync(runnerPath, stagedRunner);
  fs.writeFileSync(specPath, stagedSpec);
  if (source) {
    fs.writeFileSync(path.join(work, 'a23-admission.json'), JSON.stringify({
      status: 'HOST_MATERIAL_ONLY', sourceSha: source.sourceSha, sourceTree: source.sourceTree,
      migrationCount: source.migrationCount, ledgerSha256: source.ledgerSha256,
      registered: 1, selected: title, runnerSha256, specSha256
    }) + '\n', { flag: 'wx' });
  }
}

if (require.main === module) {
  assert.equal(process.argv.length, 4);
  const source = require(path.resolve(process.argv[3]));
  const profile = require('./expense-witness-349-profile.cjs');
  profile.assertSource(source, require('./common/multi-witness.cjs').final);
  stage(process.argv[2], source);
}

module.exports = { title, runnerSha256, specSha256 };
