'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const profile = require('../expense-witness-346-profile.cjs');
const { final } = require('../common/multi-witness.cjs');

const spec = 'src/fund-execution/enterprise-task01-entry.http.pg.spec.ts';
const ownerFixture = 'src/database/enterprise-task01-owner-fixture.test-support.ts';
const entrySupport = 'src/database/enterprise-task01-entry.test-support.ts';
const accessPlan = 'prisma/enterprise-task01-access.json';
const accessSql = 'prisma/enterprise-task01-access.sql';
const identitySql = 'prisma/enterprise-task01-identity.sql';
const clientProbe = 'prisma/enterprise-task01-client-probe.cjs';
const ownerProcess = 'prisma/enterprise-task01-owner-process.cjs';
const originalInputs = {
  [spec]: 'e9d15d4ea5250869a9c1e3f24476d8879dadb392375f54ae7d922b58483d9698',
  [ownerFixture]: '801a4297795cd64cfc7fd8d314997136177294f04c8f5bde87c0ea45fca48f06',
  [entrySupport]: '21cc8c267d68749e05c8d8ed78d746f25be6dd8300a36f2cb73fce3ed3cb4c2b',
  [accessPlan]: 'e89c84a04d3d1079dc95f672f8fc967ec7fad649e7c7a204f27403aaf6b334d8',
  [accessSql]: '1330656e792f8d36129569414b4f5711b1a4b4934132367ddc32dc9331b7ee39',
  [identitySql]: 'a815490641be4dd9f568eeead5c6040396991130ab5fdeb5afee830769743c00',
  [clientProbe]: '7c3d0c2601ee47a2791b952db5587cb827df0c2129bdecce0895fc367c28e49a',
  [ownerProcess]: '39b74e5cc60bf49c16f4893d9b526ed0056bd7ea817c770a4bdcd0c917beb7fc',
  'prisma/run-enterprise-task01-local.cjs': '7eaa6c921a54aa8e0ccd44fc75011c20feb35c711fffd1e46018de48e2ad1dea',
  'prisma/enterprise-task01-resources.cjs': 'c494075abc0c695a8d3c5748d432a79d05540cbcd1bf7d066800c5a032259f49'
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, 'TASK01_ORDERED_BINDING_COORDINATE');
  return text.replace(before, after);
}

function stage(prepared, sha, output) {
  const source = JSON.parse(fs.readFileSync(path.join(prepared, 'source.json'), 'utf8'));
  assert.equal(source.sourceSha, sha);
  profile.assertSource(source, final);
  const api = path.join(prepared, 'prepared/context/workspace/services/api');
  profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
  for (const [relative, digest] of Object.entries(originalInputs)) {
    assert.equal(hash(fs.readFileSync(path.join(api, relative))), digest, 'TASK01_ORDERED_PREIMAGE ' + relative);
  }

  const [entry, fixture, owner, plan, acl, identity, probe] = [
    spec, ownerFixture, ownerProcess, accessPlan, accessSql, identitySql, clientProbe
  ].map(relative => [relative, fs.readFileSync(path.join(api, relative), 'utf8')]);
  const runId = '0'.repeat(32);
  const roles = {
    jg_task01_runtime: 'finance_runtime_' + hash('task01:runtime:' + runId).slice(0, 32),
    jg_task01_observer: 'finance_runtime_' + hash('task01:observer:' + runId).slice(0, 32)
  };
  assert.notEqual(roles.jg_task01_runtime, roles.jg_task01_observer);

  // Only identity literals change. The original permission matrix and its
  // effective-ACL checks apply to two fresh, run-scoped roles.
  for (const [item, counts] of [[plan, [1, 1]], [acl, [18, 19]], [identity, [3, 3]], [probe, [1, 2]]]) {
    const originals = item[1];
    for (const [index, [logical, physical]] of Object.entries(roles).entries()) {
      const token = new RegExp('\\b' + logical + '\\b', 'gu');
      assert.equal([...item[1].matchAll(token)].length, counts[index], 'TASK01_ORDERED_ROLE_OCCURRENCES ' + item[0]);
      item[1] = item[1].replace(token, physical);
    }
    const roundTrip = Object.entries(roles).reduce((text, [logical, physical]) => text.replaceAll(physical, logical), item[1]);
    assert.equal(roundTrip, originals, 'TASK01_ORDERED_ROLE_ONLY');
  }
  const mappedPlan = JSON.parse(plan[1]);
  for (const [kind, logical] of [['runtime', 'jg_task01_runtime'], ['observer', 'jg_task01_observer']]) {
    assert.equal(mappedPlan[kind].role, roles[logical]);
  }

  const support = fs.readFileSync(path.join(api, entrySupport), 'utf8');
  const types = 'export type Task01EntryContext';
  const bindings = 'const orderedRole = ' + JSON.stringify(roles) + ' as const;\n\n';
  let stagedSupport = replaceOnce(support, types, bindings + types);
  stagedSupport = replaceOnce(stagedSupport, 'url.username !== role', 'url.username !== orderedRole[role]');
  stagedSupport = replaceOnce(stagedSupport,
    'identity.effectiveRole !== role || identity.loginRole !== role',
    'identity.effectiveRole !== orderedRole[role] || identity.loginRole !== orderedRole[role]');

  const overlays = [entry, fixture, owner, plan, acl, identity, probe, [entrySupport, stagedSupport]];
  for (const [relative, bytes] of overlays) {
    const target = path.join(output, 'fixtures', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  execFileSync(process.execPath, [path.join(__dirname, '../stage-historical-takeover-333.cjs'), output, 'historical-settlement-334']);
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, '../expense-witness/installer.patch')], { cwd: output });
  const installerSha256 = hash(fs.readFileSync(path.join(output, 'installer.cjs')));
  assert.equal(installerSha256, profile.installerSha256);
  const report = {
    purpose: 'TASK01_ORDERED_346_HOST_MATERIALS',
    executionReady: false,
    sourceSha: sha, sourceTree: source.sourceTree, migrationCount: source.migrationCount,
    ledgerSha256: source.ledgerSha256, installerSha256,
    artifacts: output,
    roles: { scope: 'HOST_FIXTURE', runId, ...roles },
    originals: originalInputs,
    fixtures: Object.fromEntries(overlays.map(([relative, bytes]) => [relative, hash(bytes)])),
    requiredForExecution: [
      'fresh exact-source packet and independently reviewed authorization',
      'fresh dependency trees, owner build and witnessed output ownership',
      'pinned owned runtime image, daemon and resource lifetime',
      'distinct restricted role and fixture transport on the same migrated database',
      'original Prisma TLS and presented certificate controls, and verified cleanup'
    ]
  };
  fs.writeFileSync(path.join(output, 'task01-host-materials.json'), JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify(report) + '\n');
}

assert.equal(process.argv.length, 5);
stage(...process.argv.slice(2));
