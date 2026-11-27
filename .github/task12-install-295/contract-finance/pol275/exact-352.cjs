'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const warmInstallerSha256 = 'f008f263008d185d71a220ad34b514390ee2a1f2f405a9bf309de798d64c34e7';
function assertInputs(source, lane) {
  const company = require('./company-history-352-profile.cjs');
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u, 'POL275_352_SOURCE_SHA');
  assert.equal(source.sourceSha, process.env.JG_POL275_SOURCE_SHA, 'POL275_352_SOURCE_SHA');
  assert.equal(process.env.DATABASE_URL, undefined, 'POL275_352_EXTERNAL_DATABASE');
  company.assertSource(source, require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')('/qualification/workspace/services/api', source, company);
  const digest = createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(digest, lane==='warm'?warmInstallerSha256:company.installerSha256, 'POL275_352_INSTALLER_SHA');
}
function forward(receipt, source) {
  require('./exact-350.cjs').forward(receipt, {...source,...source.predecessor350,tails:source.tails.slice(0,-2)});
  assert.deepEqual(receipt.companyHistoryForward, { count:352, ledgerSha256:source.ledgerSha256,
    sameIdentity:true, sourceTree:source.sourceTree,
    tails:source.tails.slice(-2).map(({name,sha256})=>({name,sha256})) }, 'POL275_352_FORWARD_LEDGER');
  return {...receipt.companyHistoryForward,sameBaseB7:receipt.forward320.sameBaseB7};
}
function assertInstallation(receipt, source) { require('./company-history-352-profile.cjs').assertInstallation(receipt, source); }
module.exports = { warmInstallerSha256, assertInputs, forward, assertInstallation };
