'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { verifyJestCoverage } = require('./verify-pol115-jest.cjs');

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
