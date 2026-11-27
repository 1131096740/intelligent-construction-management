'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const history = require('./historical-settlement-334-profile.cjs');
const profile = require('./expense-witness-349-profile.cjs');

async function install(receipt, consume, source) {
  const api = '/qualification/workspace/services/api';
  profile.assertSource(source, require('./multi-witness.cjs').final);
  profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
  const { withCombinedExpenseWitness349 } = require('./installer.cjs');
  await withCombinedExpenseWitness349(receipt, consume, {
    ...source, migrations: path.join(api, 'prisma/migrations'),
  });
}

function assertInstallation(receipt, source) {
  const baseCount = source.predecessor.migrationCount;
  const historicalCount = source.predecessor334.migrationCount;
  const witnessCount = source.predecessor346.migrationCount;
  history.assertFinanceInstallation(receipt, { ...source, tails: source.tails.slice(0, historicalCount - baseCount) });
  const checkpoint = (start, end, ledgerSha256) => ({
    count: end, ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(start - baseCount, end - baseCount).map(({ name, sha256 }) => ({ name, sha256 })),
  });
  assert.deepEqual(receipt.expenseWitnessForward,
    checkpoint(historicalCount, witnessCount, source.predecessor346.ledgerSha256));
  assert.deepEqual(receipt.expenseWitnessPrecisionForward, checkpoint(witnessCount, profile.count, profile.ledgerSha256));
  assert.equal(receipt.combinedAfterBusiness?.count, profile.count);
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness?.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness?.exactB7, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness, true);
}

module.exports = { install, assertInstallation };
