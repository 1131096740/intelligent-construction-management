'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const warmInstallerSha256 = 'ca33a5583a09db5345b859c3172f23fa8ca10ca2c243288c92fd09e04f88c70d';
const api = '/qualification/workspace/services/api';

function assertInputs(source, lane) {
  const expense = require('./expense-witness-349-profile.cjs');
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u, 'POL275_349_SOURCE_SHA');
  assert.equal(source.sourceSha, process.env.JG_POL275_SOURCE_SHA, 'POL275_349_SOURCE_SHA');
  assert.equal(process.env.DATABASE_URL, undefined, 'POL275_349_EXTERNAL_DATABASE');
  expense.assertSource(source, require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')(api, source, expense);
  const digest = createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(digest, lane==='warm'?warmInstallerSha256:expense.installerSha256, 'POL275_349_INSTALLER_SHA');
}

function forward(receipt, source) {
  const base = source.predecessor.migrationCount;
  const history = source.predecessor334;
  const witness = source.predecessor346;
  require('./historical-settlement-334-profile.cjs').assertFinanceInstallation(receipt, {
    ...source, tails: source.tails.slice(0, history.migrationCount-base)
  });
  const tails = source.tails.map(({name,sha256}) => ({name,sha256}));
  const checkpoint = (start, end) => ({
    count: end.migrationCount, ledgerSha256: end.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: tails.slice(start.migrationCount-base, end.migrationCount-base)
  });
  assert.deepEqual(receipt.expenseWitnessForward, checkpoint(history, witness), 'POL275_346_FORWARD_LEDGER');
  assert.deepEqual(receipt.expenseWitnessPrecisionForward, checkpoint(witness, source), 'POL275_349_FORWARD_LEDGER');
  return { ...receipt.expenseWitnessPrecisionForward, sameBaseB7: receipt.forward320.sameBaseB7 };
}

module.exports = { warmInstallerSha256, assertInputs, forward };
