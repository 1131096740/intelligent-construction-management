'use strict';

const assert = require('node:assert/strict');
const mode = 'text-direct-330';
const ledgerSha256 = '12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f';
const predecessorSha256 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const terminal = {
  name: '20261128000000_text_agreement_direct_payment',
  sha256: '4d99963155b37e091f37db7a1648d2fed6e6464aee7c643002a3297b4120991c'
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
