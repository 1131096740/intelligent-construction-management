'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const predecessor = require('./exact-350.cjs');
const { fixtureSha, fixtureSourceSha256, hash, portableCatalog, assertRestoredCatalog, assertRestoredSignedCatalog } = predecessor;
const installerSha256 = 'b452e57424e8644979a1339edb5d33a4288e111197c817bd5d953dc1bfc87943';

function prior(source) {
  return { ...source, ...source.predecessor350, tails: source.tails.slice(0, -2) };
}
function assertLedger(ledger, source) {
  assert.equal(ledger.length, 352, 'BACKUP352_LEDGER_COUNT');
  predecessor.assertLedger(ledger.slice(0, 350), prior(source));
  assert.deepEqual(ledger.slice(-2), source.tails.slice(-2), 'BACKUP352_LEDGER_TERMINALS');
  assert.equal(hash(JSON.stringify(ledger)), source.ledgerSha256, 'BACKUP352_LEDGER_BYTES');
}
function assertMigrationBytes(root, source) {
  const ledger = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(name => {
      const file = path.join(root, name, 'migration.sql');
      assert.ok(fs.lstatSync(file).isFile(), 'BACKUP352_MIGRATION_FILE');
      return { name, sha256: hash(fs.readFileSync(file)), finished: true, rolledBack: false };
    });
  assertLedger(ledger, source);
}
function forward(receipt, source, historical) {
  const prefix = predecessor.forward(receipt, prior(source), historical);
  assert.deepEqual(receipt.companyHistoryForward, {
    count: 352, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(-2).map(({ name, sha256 }) => ({ name, sha256 }))
  }, 'BACKUP352_FORWARD_LEDGER');
  return { ...receipt.companyHistoryForward, sameBaseB7: prefix.sameBaseB7 };
}
module.exports = { fixtureSha, fixtureSourceSha256, installerSha256, hash, assertLedger, assertMigrationBytes,
  forward, portableCatalog, assertRestoredCatalog, assertRestoredSignedCatalog };
