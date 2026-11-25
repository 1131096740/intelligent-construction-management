'use strict';

const assert = require('node:assert/strict');
const mode = 'text-direct-330';
const ledgerSha256 = '7ebd200accecfa799ebcb6fe9fa9e50985d7234710b729c2c463b96ecc271782';
const predecessorSha256 = '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const terminal = {
  name: '20261128000000_text_agreement_direct_payment',
  sha256: '46765295a3a943a5605cc1fc2ce0d743f05ff360ed0bfa1451f02fbd125c0314'
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
