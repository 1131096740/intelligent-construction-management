'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { final } = require('../common/multi-witness.cjs');

const root = path.resolve(__dirname, '../../../..');
const mode = '--upward-archive-332';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const source = JSON.parse(execFileSync(process.execPath, [
  path.join(__dirname, '../check-ledger.cjs'), root, sha, mode
], { encoding: 'utf8' }));
const historicalTerminal = '20260909100000_pol275_clearing_reconciliation_repair';

function runEntry(lane, changeReceipt) {
  const cold = lane === 'cold';
  const entry = cold ? 'pol275-cold-entry.cjs' : 'pol275-entry.cjs';
  const stages = [];
  const original = '/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs';
  const ownerUrl = 'postgresql://owner@127.0.0.1/qualification';
  return new Promise(resolve => {
    const sandboxProcess = {
      argv: [process.execPath, entry, ...(cold ? [] : [lane]), mode],
      stdout: { write: json => resolve({ receipt: JSON.parse(json), stages, exitCode: sandboxProcess.exitCode }) }
    };
    const install = async (receipt, consume, material) => {
      stages.push('install332');
      assert.deepEqual(material, {
        sourceTree: source.sourceTree,
        migrations: '/qualification/workspace/services/api/prisma/migrations',
        tails: source.tails,
        ...(cold ? {} : {count: 332})
      });
      const predecessor = (count, ledgerSha256) => ({ count, ledgerSha256, sameIdentity: true, sameBaseB7: true });
      Object.assign(receipt, {
        pol275History: { sameInstance: true, prefix: 165, terminal: 166 },
        installOnly295: { count: 295, ledgerSha256: final },
        textDirectPredecessor: predecessor(329, '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2'),
        paymentRemainderPredecessor: predecessor(330, source.predecessor330.ledgerSha256),
        upwardArchivePredecessor: predecessor(331, source.predecessor331.ledgerSha256),
        forward320: { ...predecessor(332, source.ledgerSha256), sourceTree: source.sourceTree,
          tails: source.tails.map(({ name, sha256 }) => ({ name, sha256 })) },
        combinedAfterBusiness: { ...predecessor(332, source.ledgerSha256), exactB7: true },
        multiWitnessCatalogAfterBusiness: true,
        cleanup: 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT'
      });
      changeReceipt?.(receipt);
      await consume({ ownerUrl });
      receipt.business = 'CALLBACK_COMPLETED';
    };
    const fakeRequire = name => {
      if (name === './contract-finance-source.json') return source;
      if (name === './installer.cjs') return { withCombined332UpwardArchive: install };
      if (name === './multi-witness.cjs') return { final };
      if (name === original) return {
        collectEvidence(url, count) {
          assert.equal(url, ownerUrl);
          assert.equal(count, 332);
          stages.push('cold-catalog');
          return { migrationCount: count, terminalMigration: historicalTerminal };
        }
      };
      if (name === './pol275.cjs') return {
        verifyPol275(context, receipt, warm, material) {
          assert.equal(context.ownerUrl, ownerUrl);
          assert.equal(warm, true);
          assert.equal(material.count, 332);
          stages.push('current-process', 'legacy-process', 'warm-catalog');
          Object.assign(receipt, { pol275: { migrationCount: material.count, originalTerminal: historicalTerminal },
            currentProcess: { passed: 10 }, legacyProcess: { passed: 1 } });
        }
      };
      if (name === 'node:fs') return {
        readFileSync(file) {
          assert.equal(file, original);
          return readFileSync(path.join(root, '.github/task12-install-289/pol275/cold-evidence.cjs'));
        }
      };
      return require(name === './upward-archive-332-profile.cjs' ? '../upward-archive-332-profile.cjs' : name);
    };
    const code = readFileSync(path.join(__dirname, entry), 'utf8');
    vm.runInThisContext('(function(require, process) {\n' + code + '\n})', { filename: entry })(fakeRequire, sandboxProcess);
  });
}

for (const lane of ['cold', 'warm']) {
  test('POL275 ' + lane + ' admits original checks after exact 331 and 332 attestations', async () => {
    const passed = await runEntry(lane);
    assert.equal(passed.receipt.status, 'ORIGINAL_POL275_' + lane.toUpperCase() + '_EXACT_332_PASSED');
    assert.deepEqual(passed.stages, ['install332', ...(lane === 'cold' ? ['cold-catalog'] :
      ['current-process', 'legacy-process', 'warm-catalog'])]);
    assert.equal(passed.receipt.upwardArchivePredecessor.count, 331);
    assert.equal(passed.receipt.pol275.migrationCount, 332);

    const noPredecessor = await runEntry(lane, receipt => delete receipt.upwardArchivePredecessor);
    const wrongFinal = await runEntry(lane, receipt => {
      receipt.forward320.ledgerSha256 = source.predecessor331.ledgerSha256;
    });
    for (const denied of [noPredecessor, wrongFinal]) {
      assert.equal(denied.receipt.status, 'STOPPED');
      assert.equal(denied.exitCode, 1);
      assert.deepEqual(denied.stages, ['install332']);
    }
  });
}

test('POL275 keeps the collision lane on its original source', async () => {
  const denied = await runEntry('collision');
  assert.equal(denied.receipt.status, 'STOPPED');
  assert.equal(denied.receipt.purpose, 'ORIGINAL_POL275_COLLISION_EXACT_332');
  assert.deepEqual(denied.stages, []);
});
