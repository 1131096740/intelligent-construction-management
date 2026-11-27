'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const predecessor = require('./exact-349.cjs');
const { fixtureSha, fixtureSourceSha256, hash, portableCatalog, assertRestoredCatalog } = predecessor;

const installerSha256 = '6b35a1eea9a8d2c3f7da4f3ca79834fecf38c18b3fb77018470222943761a6d2';

function assertLedger(ledger, source) {
  assert.equal(ledger.length, 350, 'BACKUP350_LEDGER_COUNT');
  predecessor.assertLedger(ledger.slice(0, 349), { ...source, ...source.predecessor349 });
  assert.deepEqual(ledger.at(-1), source.tails.at(-1), 'BACKUP350_LEDGER_TERMINAL');
  assert.equal(hash(JSON.stringify(ledger)), source.ledgerSha256, 'BACKUP350_LEDGER_BYTES');
}

function assertMigrationBytes(root, source) {
  const ledger = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(name => {
      const file = path.join(root, name, 'migration.sql');
      assert.ok(fs.lstatSync(file).isFile(), 'BACKUP350_MIGRATION_FILE');
      return { name, sha256: hash(fs.readFileSync(file)), finished: true, rolledBack: false };
    });
  assertLedger(ledger, source);
}

function forward(receipt, source, historical) {
  const prefix = predecessor.forward(receipt, {
    ...source, ...source.predecessor349, tails: source.tails.slice(0, -1)
  }, historical);
  const { name, sha256 } = source.tails.at(-1);
  assert.deepEqual(receipt.signedSettlementForward, {
    count: source.migrationCount, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: [{ name, sha256 }]
  }, 'BACKUP350_FORWARD_LEDGER');
  return { ...receipt.signedSettlementForward, sameBaseB7: prefix.sameBaseB7 };
}

function assertRestoredSignedCatalog(source, restored) {
  const { expense: expenseSource, historical: historicalSource, ...sourceGuards } = source;
  const { expense: expenseRestored, historical: historicalRestored, ...restoredGuards } = restored;
  const portableRoutines = catalog => Object.fromEntries(
    Object.entries(catalog).map(([name, { oid, ...routine }]) => [name, routine])
  );
  assertRestoredCatalog(expenseSource, expenseRestored);
  assert.deepEqual(portableRoutines(historicalRestored), portableRoutines(historicalSource),
    'BACKUP350_RESTORED_REVIEW_CATALOG');
  assert.deepEqual(restoredGuards, sourceGuards, 'BACKUP350_RESTORED_SIGNED_CATALOG');
}

module.exports = { fixtureSha, fixtureSourceSha256, installerSha256, hash, assertLedger, assertMigrationBytes,
  forward, portableCatalog, assertRestoredCatalog, assertRestoredSignedCatalog };
