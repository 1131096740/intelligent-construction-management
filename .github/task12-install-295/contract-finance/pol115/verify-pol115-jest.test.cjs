'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { verifyJestCoverage, aggregatePol115Shards, pol115Scope } = require('./verify-pol115-jest.cjs');
const cases = require('./cases.json');

const file = 'src/pol115.pg.spec.ts';
const original = 'public test';
const other = 'independent Task410 fixture';
const recipe = { file, declared: 1, reported: 1, skipped: [other],
  namesSha256: createHash('sha256').update(JSON.stringify([original, other])).digest('hex') };
const report = {
  success: true, numFailedTests: 0, testResults: [{
    name: '/api/' + file, assertionResults: [{ fullName: original, status: 'passed' }, { fullName: other, status: 'pending' }]
  }]
};

test('requires all original cases while keeping the independently scoped case outside the pass count', () => {
  assert.deepEqual(verifyJestCoverage(report, [recipe], '/api'),
    [{ file, declared: 1, passed: 1, skipped: 1, namesSha256: recipe.namesSha256 }]);
  const pending = structuredClone(report);
  pending.testResults[0].assertionResults[0].status = 'pending';
  assert.throws(() => verifyJestCoverage(pending, [recipe], '/api'), /ORIGINAL_CASE/u);
  const replacement = structuredClone(report);
  replacement.testResults[0].assertionResults[0].fullName = 'renamed test';
  assert.throws(() => verifyJestCoverage(replacement, [recipe], '/api'), /TEST_TITLES/u);
  const counted = structuredClone(report);
  counted.testResults[0].assertionResults[1].status = 'passed';
  assert.throws(() => verifyJestCoverage(counted, [recipe], '/api'), /OTHER_FIXTURE_SKIPPED/u);
});

test('assigns each original POL115 file to one fresh database and leaves Spot separate', () => {
  const notification = pol115Scope(cases, 'notification');
  const main = pol115Scope(cases, 'pol115-main');
  assert.deepEqual(notification.map(({ file, reported }) => [file, reported]),
    [['src/approval/issue430-notification.pg.spec.ts', 4]]);
  assert.equal(main.reduce((total, row) => total + row.reported, 0), 136);
  assert.deepEqual([...notification, ...main].map(row => row.file).sort(),
    cases.pol115.map(row => row.file).sort());
  assert.deepEqual(pol115Scope(cases, 'spot'), cases.spot);
});

test('combines verified children only with the same candidate ledger and distinct databases', () => {
  const source = { sourceSha: 'a'.repeat(40), migrationCount: 334, ledgerSha256: 'b'.repeat(64) };
  function child(scope, runId) {
    const rows = pol115Scope(cases, scope);
    return { scope, runId, sourceSha: source.sourceSha,
      databaseIdentity: { database: 'jg_task01_' + runId.replaceAll('-', '') },
      status: 'POL115_334_ORIGINAL_' + scope.toUpperCase() + '_PASSED',
      coverage: { declared: rows.reduce((sum, row) => sum + row.declared, 0),
        currentPassed: rows.reduce((sum, row) => sum + row.reported, 0), independentSmsCounted: 0 },
      combinedAfterBusiness: { count: 334, ledgerSha256: source.ledgerSha256, sameIdentity: true },
      cleanup: 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT',
      jest: { exit: 0, files: rows.map(row => ({
        file: row.file, declared: row.declared, passed: row.reported, skipped: row.skipped.length, namesSha256: row.namesSha256
      })) }
    };
  }
  const first = '12345678-1234-4123-8123-123456789abc';
  const second = '23456789-1234-4123-8123-123456789abc';
  const notification = child('notification', first);
  const main = child('pol115-main', second);
  const combine = (...receipts) => aggregatePol115Shards({ cases, source, receipts });
  assert.deepEqual(combine(notification, main).coverage,
    { declared: 138, currentPassed: 140, independentSmsCounted: 0 });
  assert.throws(() => combine(notification, child('pol115-main', first)), /SEPARATE_DATABASES/u);
  assert.throws(() => combine({ ...notification, sourceSha: 'c'.repeat(40) }, main));
  assert.throws(() => combine({ ...notification, combinedAfterBusiness: {
    ...notification.combinedAfterBusiness, ledgerSha256: 'c'.repeat(64)
  } }, main));
  assert.throws(() => combine({ ...notification, cleanup: 'STOPPED' }, main));
  assert.throws(() => combine({ ...notification, jest: { ...notification.jest, files: [] } }, main));
});
