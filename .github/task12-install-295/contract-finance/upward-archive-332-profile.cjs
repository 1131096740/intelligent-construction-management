'use strict';

const assert = require('node:assert/strict');
const mode = 'upward-archive-332';
const ledgerSha256 = 'b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4';
const predecessor329 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const predecessor330 = '12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f';
const predecessor331 = '0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014';
const terminal = {
  name: '20261129001000_contract_upward_archive_verifier_pin_forward',
  sha256: '4e8e6e23267f525ca2bff68719e2989126fff82e5bd0d0ba344abc2c4c8d4da3'
};

function assertSource(source, sourceSha, base295Sha256) {
  assert.equal(source.mode, mode);
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(source.sourceSha, sourceSha);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, 332);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.equal(source.predecessor.migrationCount, 295);
  assert.equal(source.predecessor.ledgerSha256, base295Sha256);
  assert.deepEqual(source.predecessor330, {migrationCount: 330, ledgerSha256: predecessor330});
  assert.deepEqual(source.predecessor331, {migrationCount: 331, ledgerSha256: predecessor331});
  assert.equal(source.tails.length, 37);
  assert.deepEqual(source.tails.at(-1), {...terminal, finished: true, rolledBack: false});
}

function assertInstallation(receipt, source) {
  const predecessor = (count, ledgerSha256) => ({count, ledgerSha256, sameIdentity: true, sameBaseB7: true});
  assert.deepEqual(receipt.textDirectPredecessor, predecessor(329, predecessor329));
  assert.deepEqual(receipt.paymentRemainderPredecessor, predecessor(330, predecessor330));
  assert.deepEqual(receipt.upwardArchivePredecessor, predecessor(331, predecessor331));
  assert.equal(receipt.forward320.count, 332);
  assert.equal(receipt.forward320.sourceTree, source.sourceTree);
  assert.equal(receipt.forward320.ledgerSha256, ledgerSha256);
  assert.equal(receipt.forward320.sameIdentity, true);
  assert.equal(receipt.forward320.sameBaseB7, true);
  assert.deepEqual(receipt.forward320.tails, source.tails.map(({name, sha256}) => ({name, sha256})));
}

module.exports = {assertSource, assertInstallation};
