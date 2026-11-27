'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const predecessor = require('./exact-346.cjs');
const { fixtureSha, fixtureSourceSha256, hash, portableCatalog } = predecessor;

const installerSha256 = '4dacb0174c975f207f8305758354d675f4ab6e8479e5cb2fd531477054698f7b';

function assertLedger(ledger, source) {
  assert.equal(ledger.length, 349, 'BACKUP349_LEDGER_COUNT');
  predecessor.assertLedger(ledger.slice(0, 346), { ...source, ...source.predecessor346 });
  assert.equal(hash(JSON.stringify(ledger)), source.ledgerSha256, 'BACKUP349_LEDGER_BYTES');
}

function assertMigrationBytes(root, source) {
  const ledger = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(name => {
      const file = path.join(root, name, 'migration.sql');
      assert.ok(fs.lstatSync(file).isFile(), 'BACKUP349_MIGRATION_FILE');
      return { name, sha256: hash(fs.readFileSync(file)), finished: true, rolledBack: false };
    });
  assertLedger(ledger, source);
}

function forward(receipt, source, historical) {
  const prefixLength = source.predecessor346.migrationCount - source.predecessor.migrationCount;
  predecessor.forward(receipt, { ...source, ...source.predecessor346, tails: source.tails.slice(0, prefixLength) }, historical);
  assert.deepEqual(receipt.expenseWitnessPrecisionForward, {
    count: source.migrationCount, ledgerSha256: source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
    tails: source.tails.slice(prefixLength).map(({ name, sha256 }) => ({ name, sha256 }))
  }, 'BACKUP349_FORWARD_LEDGER');
  return { ...receipt.expenseWitnessPrecisionForward, sameBaseB7: receipt.forward320.sameBaseB7 };
}

function portablePrecisionCatalog(snapshot) {
  // The catalog query already checks each trigger's relation, routine and deferrability.
  // The deparsed definition carries the condition without database-local identifiers.
  const constraints = Object.fromEntries(Object.entries(snapshot.constraints).map(([name, { oid, ...row }]) => [name, row]));
  const guards = Object.fromEntries(Object.entries(snapshot.guards).map(([name, guard]) => {
    const { oid, ...procedure } = guard.procedure;
    const { oid: triggerOid, tgrelid, tgfoid, tgconstraint, tgqual, ...wiring } = guard.wiring;
    return [name, { ...guard, procedure, wiring: { ...wiring, constraintBacked: tgconstraint !== 0 } }];
  }));
  return { ...snapshot, constraints, guards };
}

function assertRestoredCatalog(source, restored) {
  assert.deepEqual(portablePrecisionCatalog(restored), portablePrecisionCatalog(source), 'BACKUP349_RESTORED_PRECISION_CATALOG');
}

module.exports = { fixtureSha, fixtureSourceSha256, installerSha256, hash, assertLedger, assertMigrationBytes,
  forward, portableCatalog, assertRestoredCatalog };
