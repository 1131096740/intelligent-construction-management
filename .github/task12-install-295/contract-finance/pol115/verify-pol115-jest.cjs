'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const notificationFile = 'src/approval/issue430-notification.pg.spec.ts';
const pol115Shards = ['notification', 'pol115-main'];
const scopeCounts = {
  notification: [4, 4],
  'pol115-main': [134, 136],
  spot: [13, 13]
};

function pol115Scope(cases, scope) {
  assert.ok(Object.hasOwn(scopeCounts, scope), 'POL115_334_SCOPE');
  const rows = scope === 'spot' ? cases.spot : cases.pol115.filter(({ file }) =>
    (file === notificationFile) === (scope === 'notification'));
  const counts = ['declared', 'reported'].map(key => rows.reduce((sum, row) => sum + row[key], 0));
  assert.deepEqual(counts, scopeCounts[scope], 'POL115_334_SCOPE_COUNTS');
  if (scope === 'notification') assert.equal(rows.length, 1, 'POL115_334_NOTIFICATION_FILE');
  return rows;
}

function verifyPol115ChildReceipt({ cases, source, scope, receipt }) {
  const rows = pol115Scope(cases, scope);
  const [declared, currentPassed] = scopeCounts[scope];
  assert.ok([334, 346, 349, 352].includes(source.migrationCount), 'POL115_MIGRATION_SCOPE');
  assert.equal(receipt.status, 'POL115_' + source.migrationCount + '_ORIGINAL_' + scope.toUpperCase() + '_PASSED');
  assert.equal(receipt.sourceSha, source.sourceSha);
  assert.equal(receipt.scope, scope);
  assert.deepEqual(receipt.coverage, { declared, currentPassed, independentSmsCounted: 0 });
  assert.equal(receipt.jest.exit, 0);
  assert.deepEqual(receipt.jest.files, rows.map(row => ({
    file: row.file, declared: row.declared, passed: row.reported, skipped: row.skipped.length, namesSha256: row.namesSha256
  })));
  assert.equal(receipt.combinedAfterBusiness.count, source.migrationCount);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
}

function aggregatePol115Shards({ cases, source, receipts }) {
  assert.equal(receipts.length, pol115Shards.length);
  for (const [index, scope] of pol115Shards.entries()) {
    verifyPol115ChildReceipt({ cases, source, scope, receipt: receipts[index] });
  }
  for (const receipt of receipts) {
    assert.match(receipt.runId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    assert.equal(receipt.databaseIdentity.database, 'jg_task01_' + receipt.runId.replaceAll('-', ''));
  }
  assert.notEqual(receipts[0].runId, receipts[1].runId, 'POL115_334_SEPARATE_DATABASES');
  const coverage = { declared: 0, currentPassed: 0, independentSmsCounted: 0 };
  for (const receipt of receipts) {
    coverage.declared += receipt.coverage.declared;
    coverage.currentPassed += receipt.coverage.currentPassed;
  }
  assert.deepEqual(coverage, { declared: 138, currentPassed: 140, independentSmsCounted: 0 });
  return { sourceSha: source.sourceSha, scope: 'pol115', status: 'POL115_' + source.migrationCount + '_ORIGINAL_POL115_PASSED',
    ledgerSha256: source.ledgerSha256, coverage, shards: Object.fromEntries(receipts.map(receipt =>
      [receipt.scope, receipt.coverage.currentPassed])) };
}

function verifyJestCoverage(report, recipes, api) {
  assert.equal(report.success, true, 'POL115_334_JEST_RUN');
  assert.equal(report.numFailedTests, 0, 'POL115_334_JEST_FAILURES');
  assert.equal(report.testResults.length, recipes.length, 'POL115_334_TEST_FILES');
  return recipes.map(({ file, declared, reported, skipped, namesSha256 }) => {
    const matching = report.testResults.filter(row => row.name === path.join(api, file));
    assert.equal(matching.length, 1, 'POL115_334_TEST_FILE');
    const rows = matching[0].assertionResults;
    assert.equal(rows.length, reported + skipped.length, 'POL115_334_REGISTERED_COUNT');
    assert.equal(sha256(JSON.stringify(rows.map(row => row.fullName))), namesSha256, 'POL115_334_TEST_TITLES');
    let passes = 0;
    for (const row of rows) {
      if (skipped.includes(row.fullName)) assert.equal(row.status, 'pending', 'POL115_334_OTHER_FIXTURE_SKIPPED');
      else {
        assert.equal(row.status, 'passed', 'POL115_334_ORIGINAL_CASE');
        passes += 1;
      }
    }
    assert.equal(passes, reported);
    return { file, declared, passed: passes, skipped: skipped.length, namesSha256 };
  });
}

module.exports = { verifyJestCoverage, pol115Scope, verifyPol115ChildReceipt, aggregatePol115Shards };
