'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('./database-dynamic-gate-manifest.json');
const gate = require('./dynamic-gate-352.cjs');
const prior = require('./dynamic-gate-349.cjs');

test('352 maps every existing automatic group without changing its scope', () => {
  const sha = 'a'.repeat(40);
  assert.equal(gate.matchesBaseline352(manifest.migrationBaseline), true);
  assert.equal(gate.matchesBaseline352({ ...manifest.migrationBaseline, terminalMigrationChecksum: '0'.repeat(64) }), false);
  assert.deepEqual(gate.unadmittedGroups352(manifest.coveredGroups), []);
  for (const group of manifest.coveredGroups.filter(row => row.ciExecution !== 'manual-only')) {
    const shard = group.pol113Pol115Shard;
    const previous = prior.commandFor349(group.id, sha, shard);
    const current = gate.commandFor352(group.id, sha, shard);
    assert.ok(previous, group.id);
    assert.deepEqual(current, previous.map(value => value === '--expense-witness-349' ? '--company-history-352'
      : typeof value === 'string' && /_349$/u.test(value) ? value.replace(/_349$/u, '_352') : value));
  }
  assert.equal(gate.commandFor352('unknown', sha), undefined);
});

test('352 issue 418 keeps all operating-dedup cases', () => {
  assert.deepEqual(gate.issue418Tests352(), prior.issue418Tests349());
});
