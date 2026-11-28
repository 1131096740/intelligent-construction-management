'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = function assertMigrationInputs(api, source, profile) {
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs'));
  profile.assertRuntimeBaseline(baseline);
  const root = baseline.DEFAULT_MIGRATIONS_ROOT;
  const ledger = baseline.listMigrationDirectories(root).map(name => ({
    name, sha256: baseline.migrationChecksum(root, name), finished: true, rolledBack: false
  }));
  const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  assert.equal(ledger.length, profile.count, 'BANK_346_MIGRATION_COUNT');
  assert.equal(digest(ledger.slice(0, 334)), source.predecessor334.ledgerSha256, 'BANK_346_PREFIX_334');
  if (profile.count === 350 || profile.count === 352) {
    assert.equal(digest(ledger.slice(0, 349)), source.predecessor349.ledgerSha256, 'BANK_350_PREFIX_349');
  }
  if (profile.count === 352) assert.equal(digest(ledger.slice(0, 350)), source.predecessor350.ledgerSha256, 'BANK_352_PREFIX_350');
  assert.equal(digest(ledger), source.ledgerSha256, 'BANK_346_MIGRATION_BYTES');
};
