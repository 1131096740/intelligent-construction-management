'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const history = require('./historical-settlement-334-profile.cjs');
const profile = require('./expense-witness-346-profile.cjs');

async function install(receipt, consume, source) {
  const api = '/qualification/workspace/services/api';
  profile.assertSource(source, require('./multi-witness.cjs').final);
  profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
  const { withCombinedExpenseWitness } = require('./installer.cjs');
  await withCombinedExpenseWitness(receipt, consume, {
    sourceTree: source.sourceTree,
    migrations: path.join(api, 'prisma/migrations'),
    tails: source.tails,
  }, profile.count);
}

function assertInstallation(receipt, source) {
  history.assertFinanceInstallation(receipt, { ...source, tails: source.tails.slice(0, 39) });
  assert.deepEqual(receipt.expenseWitnessForward, {
    count: profile.count,
    ledgerSha256: profile.ledgerSha256,
    sameIdentity: true,
    sourceTree: source.sourceTree,
    tails: source.tails.slice(39).map(({ name, sha256 }) => ({ name, sha256 })),
  });
  assert.equal(receipt.combinedAfterBusiness?.count, profile.count);
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness?.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness?.exactB7, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
}

module.exports = { install, assertInstallation };
