'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const exact = require('./exact-352.cjs');
const company = require('../company-history-352-profile.cjs');
const migrations = path.resolve(__dirname, '../../../../services/api/prisma/migrations');
const ledger = fs.readdirSync(migrations, { withFileTypes: true }).filter(row => row.isDirectory())
  .map(row => row.name).sort().map(name => ({ name,
    sha256: exact.hash(fs.readFileSync(path.join(migrations, name, 'migration.sql'))), finished: true, rolledBack: false }));
const source = { migrationCount: 352, ledgerSha256: company.ledgerSha256, sourceTree: 'a'.repeat(40),
  predecessor: { migrationCount: 295 }, predecessor334: { migrationCount: 334, ledgerSha256: require('../historical-settlement-334-profile.cjs').ledgerSha256 },
  predecessor346: { migrationCount: 346, ledgerSha256: require('../expense-witness-346-profile.cjs').ledgerSha256 },
  predecessor349: { migrationCount: 349, ledgerSha256: require('../expense-witness-349-profile.cjs').ledgerSha256 },
  predecessor350: { migrationCount: 350, ledgerSha256: require('../signed-settlement-350-profile.cjs').ledgerSha256 }, tails: ledger.slice(295) };
test('restore binds 350 predecessor and both 352 migration bytes', () => {
  exact.assertMigrationBytes(migrations, source);
  for (const index of [349, 350, 351]) {
    const altered = structuredClone(ledger);
    altered[index].sha256 = '0'.repeat(64);
    assert.throws(() => exact.assertLedger(altered, source));
  }
  assert.throws(() => exact.assertLedger(ledger.slice(0, 351), source));
});
test('restore binds the complete forward receipt', () => {
  const proof = (count, start, digest) => ({ count, ledgerSha256: digest, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(start - 295, count - 295).map(({ name, sha256 }) => ({ name, sha256 })) });
  const receipt = { forward320: { count: 334, ledgerSha256: source.predecessor334.ledgerSha256,
    sameIdentity: true, sameBaseB7: true, sourceTree: source.sourceTree, tails: source.tails.slice(0, 39).map(({ name, sha256 }) => ({ name, sha256 })) },
    expenseWitnessForward: proof(346,334,source.predecessor346.ledgerSha256),
    expenseWitnessPrecisionForward: proof(349,346,source.predecessor349.ledgerSha256),
    signedSettlementForward: proof(350,349,source.predecessor350.ledgerSha256),
    companyHistoryForward: proof(352,350,source.ledgerSha256) };
  const historical = { assertFinanceInstallation() {} };
  assert.equal(exact.forward(receipt, source, historical).count, 352);
  const altered = structuredClone(receipt); altered.companyHistoryForward.tails.pop();
  assert.throws(() => exact.forward(altered, source, historical), /BACKUP352_FORWARD_LEDGER/u);
});
