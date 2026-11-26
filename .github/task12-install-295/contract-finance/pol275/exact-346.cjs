'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const warmInstallerSha256 = '239f0a7183911ee4391c64f5b1a07daa20226347801f536d78159b8491f9b1f4';
const api = '/qualification/workspace/services/api';

function assertInputs(source, lane) {
  const expense = require('./expense-witness-346-profile.cjs');
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u, 'POL275_346_SOURCE_SHA');
  assert.equal(source.sourceSha, process.env.JG_POL275_SOURCE_SHA, 'POL275_346_SOURCE_SHA');
  assert.equal(process.env.DATABASE_URL, undefined, 'POL275_346_EXTERNAL_DATABASE');
  expense.assertSource(source, require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')(api, source, expense);
  const digest = createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(digest, lane==='warm'?warmInstallerSha256:expense.installerSha256, 'POL275_346_INSTALLER_SHA');
}

function forward(receipt, source) {
  require('./historical-settlement-334-profile.cjs').assertFinanceInstallation(receipt, {
    ...source, tails: source.tails.slice(0, 39)
  });
  assert.deepEqual(receipt.expenseWitnessForward, {
    count: 346, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(39).map(({name,sha256}) => ({name,sha256}))
  }, 'POL275_346_FORWARD_LEDGER');
  return { ...receipt.expenseWitnessForward, sameBaseB7: receipt.forward320.sameBaseB7 };
}

module.exports = { warmInstallerSha256, assertInputs, forward };
