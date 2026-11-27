'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const history = require('./historical-settlement-334-profile.cjs');
const profile = require('./signed-settlement-350-profile.cjs');

async function install(receipt, consume, source) {
  const api = '/qualification/workspace/services/api';
  profile.assertSource(source, require('./multi-witness.cjs').final);
  profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
  const { withCombinedSignedSettlement350 } = require('./installer.cjs');
  await withCombinedSignedSettlement350(receipt, consume, {
    ...source, migrations: path.join(api, 'prisma/migrations'),
  });
}

function assertInstallation(receipt, source) {
  const baseCount = source.predecessor.migrationCount;
  const historicalCount = source.predecessor334.migrationCount;
  const { migrationCount: witnessCount, ledgerSha256 } = source.predecessor346;
  history.assertFinanceInstallation(receipt, { ...source, tails: source.tails.slice(0, historicalCount - baseCount) });
  assert.deepEqual(receipt.expenseWitnessForward, {
    count: witnessCount, ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(historicalCount - baseCount, witnessCount - baseCount)
      .map(({ name, sha256 }) => ({ name, sha256 })),
  });
  profile.assertInstallation(receipt, source);
  for (const field of ['multiWitnessCatalogAfterBusiness', 'historicalTakeoverCatalogAfterBusiness',
    'historicalSettlementCatalogAfterBusiness', 'expenseWitnessCatalogAfterBusiness',
    'expenseWitnessPrecisionCatalogAfterBusiness']) {
    assert.equal(receipt[field], true, 'PAYMENT_350_POST_BUSINESS_CATALOG ' + field);
  }
}

module.exports = { install, assertInstallation };
