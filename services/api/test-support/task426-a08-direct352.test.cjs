'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { assertA08Source, captureA08Direct352Source } = require('./task426-a08-upward-pin-332-profile.cjs');

test('A08 352 admission seals the full ordered ledger and in-process source', () => {
  const migrations = join(__dirname, '../prisma/migrations');
  const ledger = readdirSync(migrations).sort().filter(name => /^[0-9]{14}_/u.test(name)).map(name => ({
    name, sha256: createHash('sha256').update(readFileSync(join(migrations, name, 'migration.sql'))).digest('hex'),
    finished: true, rolledBack: false
  }));
  const sha = 'a'.repeat(40);
  const profile = captureA08Direct352Source(sha, 'b'.repeat(40), ledger);
  assert.doesNotThrow(() => assertA08Source(profile, sha));
  assert.throws(() => assertA08Source({ ...profile }, sha), /A08_DIRECT_352_SOURCE_PROVENANCE/u);
  assert.throws(() => captureA08Direct352Source(sha, 'b'.repeat(40), ledger.slice(0, 351)));
  const tampered = ledger.map((row, index) => index === 351 ? { ...row, sha256: '0'.repeat(64) } : row);
  assert.throws(() => captureA08Direct352Source(sha, 'b'.repeat(40), tampered), /A08_DIRECT_352_LEDGER/u);
});
