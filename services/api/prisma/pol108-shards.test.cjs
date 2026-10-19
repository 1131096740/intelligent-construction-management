const assert = require('node:assert/strict');
const test = require('node:test');
const { SHARDS, selectShards, assertTestResults, runSelectedShards } = require('./pol108-shards.cjs');
function result(shards) {
  const testResults = shards.map(shard => ({
    name: `/repo/services/api/${shard.file}`,
    assertionResults: shard.titles.map(title => ({ title, status: 'passed' }))
  }));
  const count = testResults.reduce((sum, suite) => sum + suite.assertionResults.length, 0);
  return { success: true, numTotalTests: count, numPassedTests: count, numPendingTests: 0,
    numTodoTests: 0, numFailedTests: 0, numRuntimeErrorTestSuites: 0, testResults };
}
test('three disjoint shards retain all 14 cases; default executes all', () => {
  assert.deepEqual(selectShards([]), Object.values(SHARDS));
  assert.deepEqual(Object.values(SHARDS).map(s => s.titles.length), [12, 1, 1]);
  assert.equal(new Set(Object.values(SHARDS).flatMap(s => s.titles)).size, 14);
  for (const key of Object.keys(SHARDS)) {
    assert.deepEqual(selectShards(['--shard', key]), [SHARDS[key]]);
  }
});
test('invalid or extra shard arguments fail closed', () => {
  for (const args of [['--shard'], ['--shard', 'typo'], ['--shard', 'core', '--passWithNoTests'], ['--testNamePattern', 'x']]) {
    assert.throws(() => selectShards(args));
  }
});
test('actual successful case identities are required, not just a manifest count', () => {
  const shards = selectShards([]);
  assert.equal(assertTestResults(result(shards), shards), 14);
  for (const mutation of [
    r => { r.testResults[0].assertionResults.pop(); },
    r => { r.testResults[0].assertionResults[0].status = 'pending'; },
    r => { r.testResults[0].assertionResults[0].title = 'unexpected'; },
    r => { r.testResults[0].assertionResults[0] = r.testResults[0].assertionResults[1]; },
    r => { r.numTotalTests = 0; },
    r => { r.success = false; },
    r => { r.numRuntimeErrorTestSuites = 1; },
    r => { r.testResults[0].name = '/repo/wrong.spec.ts'; },
    r => { r.testResults.push(r.testResults[0]); }
  ]) {
    const report = result(shards); mutation(report);
    assert.throws(() => assertTestResults(report, shards));
  }
});

test('default runner creates a separate execution for every shard and stops on failure', async () => {
  const seen = [];
  assert.equal(await runSelectedShards([], async shard => { seen.push(shard.file); return shard.titles.length; }), 14);
  assert.equal(new Set(seen).size, 3);
  let calls = 0;
  await assert.rejects(runSelectedShards([], async () => { calls++; throw new Error('failed shard'); }));
  assert.equal(calls, 1);
  await assert.rejects(runSelectedShards(['--shard', 'facts'], async () => 0));
});
