'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { final } = require('./common/multi-witness.cjs');
const prior = path.resolve(__dirname, '../../task12-install-289');
const archive = path.resolve(__dirname, '../../task12-install-290');
const common = path.join(__dirname, 'common');
const { selectShards } = require('../../task12-install-289/pol108-shards.cjs');

const root = path.resolve(__dirname, '../../..');
const mode = '--upward-archive-332';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const source = JSON.parse(execFileSync(process.execPath, [
  path.join(__dirname, 'check-ledger.cjs'), root, sha, mode
], { encoding: 'utf8' }));

function stageProjection(out, shard) {
  execFileSync('python3', [path.join(__dirname, 'stage-pol108.py'), prior, archive, common, out, shard, '332']);
}

function runEntry(pol, shard, modify, stagedInstaller) {
  const entry = 'pol' + pol + '-295-entry.cjs';
  const args = [process.execPath, entry, ...(shard ? [shard, mode] : [mode])];
  const context = { runId: 'test-owned-database' };
  const calls = [];
  const processModel = { argv: args };
  return new Promise(resolve => {
    async function install(receipt, consume, material) {
      calls.push('install332');
      assert.deepEqual(JSON.parse(JSON.stringify(material)), {
        sourceTree: source.sourceTree,
        migrations: '/qualification/workspace/services/api/prisma/migrations',
        tails: source.tails
      });
      const predecessor = (count, ledgerSha256) => ({ count, ledgerSha256, sameIdentity: true, sameBaseB7: true });
      Object.assign(receipt, {
        releaseTree: '67644d9465a0ab4ee80ede099139d9c129d66f14',
        installOnly295: { count: 295, ledgerSha256: final },
        textDirectPredecessor: predecessor(329, '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2'),
        paymentRemainderPredecessor: predecessor(330, source.predecessor330.ledgerSha256),
        upwardArchivePredecessor: predecessor(331, source.predecessor331.ledgerSha256),
        forward320: {
          ...predecessor(332, source.ledgerSha256), sourceTree: source.sourceTree,
          tails: source.tails.map(({ name, sha256 }) => ({ name, sha256 }))
        },
        combinedAfterBusiness: { ...predecessor(332, source.ledgerSha256), exactB7: true }
      });
      modify?.(receipt);
      await consume(context);
      receipt.business = 'CALLBACK_COMPLETED';
      receipt.cleanup = 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT';
    }

    const fakeRequire = name => {
      if (name === './contract-finance-source.json') return source;
      if (name === './installer.cjs') return installer.exports;
      if (name === './pol108-289.cjs') {
        return {
          runPol108(owned, requestedShard, receipt) {
            assert.equal(owned, context);
            assert.equal(requestedShard, shard);
            calls.push(shard);
            receipt.operatingProjection = { tests: selectShards(['--shard', shard])[0].titles.length };
          }
        };
      }
      if (name === './workspace-proof.cjs') return { verifyWorkspace: () => 'workspace-proved' };
      if (name === './pol108-shards.cjs') return { selectShards };
      if (name.endsWith('/task12-pol109-ci.cjs')) {
        return {
          runPol109(owned, receipt, proof) {
            assert.equal(owned, context);
            assert.equal(proof, 'workspace-proved');
            calls.push('jest', 'browser');
            Object.assign(receipt, {
              jest: { passed: 8, suites: 2, failed: 0, skipped: 0, postgresql: 7, http: 1 },
              browser: { passed: 5, failed: 0, flakes: 0, skipped: 0 },
              noOpDeploy: true, seed: true, nestHealth: true, nestCleanup: true
            });
          }
        };
      }
      if (name === './multi-witness.cjs') return { final };
      return require(name);
    };
    const installer = { exports: {} };
    if (stagedInstaller) {
      const load = vm.runInThisContext('(function(require, module) {\n' + stagedInstaller + '\n})');
      load(fakeRequire, installer);
    }
    installer.exports.withCombined332UpwardArchive = install;
    const code = readFileSync(path.join(__dirname, entry), 'utf8');
    const run = vm.runInThisContext('(function(require, process, console) {\n' + code + '\n})', { filename: entry });
    run(fakeRequire, processModel, {
      log: json => resolve({ receipt: JSON.parse(json), calls, exitCode: processModel.exitCode })
    });
  });
}

test('POL108 qualifies each original shard only after the distinct 331 and 332 ledger attestations', async t => {
  const work = mkdtempSync(path.join(tmpdir(), 'pol108-332-entry-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  stageProjection(path.join(work, 'core'), 'core');
  const installer = readFileSync(path.join(work, 'core', 'installer.cjs'), 'utf8');
  for (const shard of ['core', 'facts', 'impacts']) {
    const passed = await runEntry(108, shard, undefined, installer);
    assert.deepEqual(passed.calls, ['install332', shard]);
    assert.equal(passed.receipt.status, 'ORIGINAL_POL108_EXACT_332_PASSED');
    assert.equal(passed.receipt.upwardArchivePredecessor.count, 331);
    assert.equal(passed.receipt.forward320.count, 332);
  }
  const denied = await runEntry(108, 'core', receipt => delete receipt.upwardArchivePredecessor, installer);
  assert.deepEqual(denied.calls, ['install332']);
  assert.equal(denied.receipt.status, 'STOPPED');
  assert.equal(denied.exitCode, 1);
});

test('POL109 runs the original database and browser suites only after attesting the final 332 ledger', async () => {
  const passed = await runEntry(109);
  assert.deepEqual(passed.calls, ['install332', 'jest', 'browser']);
  assert.equal(passed.receipt.status, 'ORIGINAL_POL109_332_PASSED');
  assert.equal(passed.receipt.upwardArchivePredecessor.count, 331);
  assert.equal(passed.receipt.forward320.count, 332);
  const denied = await runEntry(109, undefined, receipt => {
    receipt.forward320.ledgerSha256 = source.predecessor331.ledgerSha256;
  });
  assert.deepEqual(denied.calls, ['install332']);
  assert.equal(denied.receipt.status, 'STOPPED');
  assert.equal(denied.exitCode, 1);
});

test('POL108 and POL109 stage their original fixtures for the exact 332 ledger', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'pol108-pol109-332-'));
  try {
    stageProjection(path.join(work, 'pol108'), 'core');
    const projection = readFileSync(path.join(work, 'pol108', 'operating-projection-postgresql.cases.ts'), 'utf8');
    assert.match(projection, /rolled_back_at IS NULL\) = 332/u);

    const workspace = path.join(work, 'workspace');
    const httpSpec = 'services/api/src/project-close-profit/project-close-profit.http.pg.spec.ts';
    mkdirSync(path.dirname(path.join(workspace, httpSpec)), { recursive: true });
    writeFileSync(path.join(workspace, httpSpec), readFileSync(path.join(root, httpSpec)));
    const record = path.join(work, 'source.json');
    writeFileSync(record, JSON.stringify(source));
    const closure = path.join(work, 'pol109');
    execFileSync('python3', [path.join(__dirname, 'stage-pol109.py'), prior, archive, common,
      workspace, record, closure]);
    const terminal = source.tails.at(-1);
    for (const name of ['project-close-profit.owned282.http.pg.spec.ts', 'task12-pol109-ci.cjs']) {
      const staged = readFileSync(path.join(closure, name), 'utf8');
      assert.match(staged, /count\(\*\) ?= ?332/u);
      assert.ok(staged.includes(terminal.name));
      assert.ok(staged.includes(terminal.sha256));
    }
    const owned = readFileSync(path.join(closure, 'project-close-profit.owned282.http.pg.spec.ts'), 'utf8');
    assert.match(owned, /and rejects an incomplete A27 final submission/u);
    assert.ok(owned.includes('经营金额或来源仍不完整，不能最终确认盈亏'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
