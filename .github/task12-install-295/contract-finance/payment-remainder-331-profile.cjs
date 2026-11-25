'use strict';

const assert = require('node:assert/strict');
const mode = 'payment-remainder-331';
const ledgerSha256 = '0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014';
const textDirectPredecessorSha256 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const predecessorSha256 = '12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f';
const terminal = {
  name: '20261129000000_payment_remaining_withdrawal',
  sha256: '67593637957ba372cbba7633334fb9896ba6adf472b0c1b9b6f1482c0d645fc2'
};

function assertSource(source, sourceSha, base295Sha256) {
  assert.equal(source.mode, mode);
  assert.match(sourceSha, /^[a-f0-9]{40}$/u);
  assert.equal(source.sourceSha, sourceSha);
  assert.match(source.sourceTree, /^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount, 331);
  assert.equal(source.ledgerSha256, ledgerSha256);
  assert.equal(source.predecessor.migrationCount, 295);
  assert.equal(source.predecessor.ledgerSha256, base295Sha256);
  assert.deepEqual(source.predecessor330, {migrationCount: 330, ledgerSha256: predecessorSha256});
  assert.equal(source.tails.length, 36);
  assert.deepEqual(source.tails.at(-1), {...terminal, finished: true, rolledBack: false});
}

function assertInstallation(receipt, source) {
  assert.deepEqual(receipt.textDirectPredecessor, {
    count: 329, ledgerSha256: textDirectPredecessorSha256, sameIdentity: true, sameBaseB7: true
  });
  assert.deepEqual(receipt.paymentRemainderPredecessor, {
    count: 330, ledgerSha256: predecessorSha256, sameIdentity: true, sameBaseB7: true
  });
  assert.equal(receipt.forward320.count, 331);
  assert.equal(receipt.forward320.sourceTree, source.sourceTree);
  assert.equal(receipt.forward320.ledgerSha256, ledgerSha256);
  assert.equal(receipt.forward320.sameIdentity, true);
  assert.equal(receipt.forward320.sameBaseB7, true);
  assert.deepEqual(receipt.forward320.tails, source.tails.map(({name, sha256}) => ({name, sha256})));
}

module.exports = {assertSource, assertInstallation};
