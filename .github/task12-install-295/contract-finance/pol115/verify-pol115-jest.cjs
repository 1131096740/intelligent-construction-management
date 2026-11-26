'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha256 = value => createHash('sha256').update(value).digest('hex');

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

module.exports = { verifyJestCoverage };
