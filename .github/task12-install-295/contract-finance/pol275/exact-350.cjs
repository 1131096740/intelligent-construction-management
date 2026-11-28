'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const warmInstallerSha256 = '6a75113eba5e41aa5a3c1a50de14bebee67906415e558797a75647a4a529cf3e';
const api = '/qualification/workspace/services/api';

function assertInputs(source, lane) {
  const signed = require('./signed-settlement-350-profile.cjs');
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u, 'POL275_350_SOURCE_SHA');
  assert.equal(source.sourceSha, process.env.JG_POL275_SOURCE_SHA, 'POL275_350_SOURCE_SHA');
  assert.equal(process.env.DATABASE_URL, undefined, 'POL275_350_EXTERNAL_DATABASE');
  signed.assertSource(source, require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')(api, source, signed);
  const digest = createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(digest, lane==='warm'?warmInstallerSha256:signed.installerSha256, 'POL275_350_INSTALLER_SHA');
}

function forward(receipt, source) {
  require('./exact-349.cjs').forward(receipt, {
    ...source, ...source.predecessor349, tails: source.tails.slice(0, -1)
  });
  assert.equal(receipt.installOnly295.nonOwnerDenied, true, 'POL275_350_PREDECESSOR_NON_OWNER');
  const {name,sha256} = source.tails.at(-1);
  assert.deepEqual(receipt.signedSettlementForward, {
    count: 350, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: [{name,sha256}]
  }, 'POL275_350_FORWARD_LEDGER');
  return { ...receipt.signedSettlementForward, sameBaseB7: receipt.forward320.sameBaseB7 };
}

function assertInstallation(receipt, source) {
  require('./signed-settlement-350-profile.cjs').assertInstallation(receipt, source);
}

module.exports = { warmInstallerSha256, assertInputs, forward, assertInstallation };
