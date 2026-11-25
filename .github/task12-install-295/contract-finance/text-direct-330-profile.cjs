'use strict';

const assert = require('node:assert/strict');
const mode = 'text-direct-330';
const ledgerSha256 = 'd4a81f051a88dc94a102909f2791e8d81cd9dc9c3530eb4d0d4e9b2d4a889b76';
const predecessorSha256 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const terminal = {
  name: '20261128000000_text_agreement_direct_payment',
  sha256: '3ee02122366db483384492a88fcc1c33e5e42d70835560241f0a41fc76098f14'
};

function assertSource(source, sourceSha, base295Sha256) {
  assert.equal(source.mode, mode);
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(source.sourceSha, sourceSha);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, 330);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.equal(source.predecessor.migrationCount, 295);
  assert.equal(source.predecessor.ledgerSha256, base295Sha256);
  assert.equal(source.tails.length, 35);
  const last = source.tails.at(-1);
  assert.equal(last.name, terminal.name);
  assert.equal(last.sha256, terminal.sha256);
  assert.equal(last.finished, true);
  assert.equal(last.rolledBack, false);
}

function assertInstallation(receipt, source) {
  assert.deepEqual(receipt.textDirectPredecessor, {
    count: 329, ledgerSha256: predecessorSha256, sameIdentity: true, sameBaseB7: true
  });
  assert.equal(receipt.forward320.count, 330);
  assert.equal(receipt.forward320.sourceTree, source.sourceTree);
  assert.equal(receipt.forward320.ledgerSha256, ledgerSha256);
  assert.equal(receipt.forward320.sameIdentity, true);
  assert.equal(receipt.forward320.sameBaseB7, true);
  assert.deepEqual(receipt.forward320.tails, source.tails.map(({name,sha256}) => ({name,sha256})));
}

module.exports = {mode, ledgerSha256, assertSource, assertInstallation};
