'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const fixtureSha = 'a187dc73a133114e1cfbbc891a4aec923abe2545';
const fixtureSourceSha256 = 'bffef2196f9039f889652a8217e705c5df00afce06a86c9945e6f8107d24c805';
const installerSha256 = 'f748ac3cbd62cef5ae10377fc76a0331914bf012be5d9acca0934ec4486a29a8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function assertLedger(ledger, source) {
  assert.equal(ledger.length, 346, 'BACKUP346_LEDGER_COUNT');
  assert.equal(hash(JSON.stringify(ledger.slice(0, 334))), source.predecessor334.ledgerSha256, 'BACKUP346_LEDGER_PREFIX');
  assert.equal(hash(JSON.stringify(ledger)), source.ledgerSha256, 'BACKUP346_LEDGER_BYTES');
}

function assertMigrationBytes(root, source) {
  const ledger = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(name => {
      const file = path.join(root, name, 'migration.sql');
      assert.ok(fs.lstatSync(file).isFile(), 'BACKUP346_MIGRATION_FILE');
      return { name, sha256: hash(fs.readFileSync(file)), finished: true, rolledBack: false };
    });
  assertLedger(ledger, source);
}

function forward(receipt, source, historical) {
  historical.assertFinanceInstallation(receipt, { ...source, tails: source.tails.slice(0, 39) });
  assert.deepEqual(receipt.expenseWitnessForward, {
    count: source.migrationCount, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(39).map(({ name, sha256 }) => ({ name, sha256 }))
  }, 'BACKUP346_FORWARD_LEDGER');
  return { ...receipt.expenseWitnessForward, sameBaseB7: receipt.forward320.sameBaseB7 };
}

function portableCatalog(snapshot) {
  const { witness, foreignKey, witnessIndex, costValidator, impactValidator, voucherBinding,
    expenseCashGuards, preparedAdapterAbsent, registeredPaymentGuards } = snapshot;
  return {
    witness: { validated: witness.validated, def: witness.def },
    foreignKey: { validated: foreignKey.validated, def: foreignKey.def }, witnessIndex,
    costValidatorBody: costValidator.body, impactValidatorBody: impactValidator.body, voucherBindingBody: voucherBinding.body,
    expenseCashGuards, preparedAdapterAbsent,
    registeredPaymentGuards: registeredPaymentGuards && Object.fromEntries(
      Object.entries(registeredPaymentGuards).map(([relation, guard]) => [relation, guard.body])
    )
  };
}

module.exports = { fixtureSha, fixtureSourceSha256, installerSha256, hash, assertLedger, assertMigrationBytes, forward, portableCatalog };
