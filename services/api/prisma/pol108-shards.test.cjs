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


test('POL-108 transpiles in isolation while preserving the base discovery and runtime settings', () => {
  const base = require('../jest.config.cjs');
  const config = require('../jest.runtime.config.cjs');
  assert.deepEqual(config.transform['^.+\\.ts$'], ['ts-jest', { tsconfig: { isolatedModules: true } }]);
  assert.deepEqual({ ...config, transform: base.transform }, base);
  assert.deepEqual(base.transform['^.+\\.ts$'], ['ts-jest', { tsconfig: { isolatedModules: true } }]);
});

test('default Jest executes runtime assertions while independent TypeScript rejects a real type error', () => {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const directory = mkdtempSync(path.resolve(__dirname, '../.jest-runtime-contract-'));
  try {
    const file = path.join(directory, 'semantic.spec.ts');
    writeFileSync(file, `export {};
declare function test(name: string, body: () => void): void;
declare function expect(value: unknown): { toBe(expected: unknown): void };
const value: string = 42;
test('runtime assertion is executed', () => { expect(value).toBe(42); });
`);
    const project = path.join(directory, 'tsconfig.json');
    writeFileSync(project, JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, types: [], target: 'ES2022', module: 'CommonJS'
    }, files: [file] }));
    const options = { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' } };
    const types = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', project], options);
    assert.equal(types.error, undefined);
    assert.equal(types.status, 2, types.stdout + types.stderr);
    assert.match(types.stdout, /TS2322: Type 'number' is not assignable to type 'string'/u);
    const runtime = spawnSync(process.execPath, [require.resolve('jest/bin/jest'),
      '--config', path.resolve(__dirname, '../jest.config.cjs'), '--rootDir', directory,
      '--roots', directory, '--runInBand', '--runTestsByPath', file,
      '--cacheDirectory', path.join(directory, 'cache'), '--json'], options);
    assert.equal(runtime.error, undefined);
    assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
    const report = JSON.parse(runtime.stdout);
    assert.equal(report.numPassedTests, 1);
    assert.equal(report.numPendingTests, 0);
    assert.equal(report.success, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('document acceptance configurations inherit the same runtime transform', () => {
  const base = require('../jest.config.cjs');
  for (const name of ['jest.task10-native-acceptance.config.cjs', 'jest.task10-browser-acceptance.config.cjs',
    'jest.task09-task11-document-acceptance.config.cjs']) {
    const config = require('../' + name);
    assert.deepEqual(config.transform, base.transform, name);
    assert.equal(config.testEnvironment, base.testEnvironment, name);
    assert.equal(config.rootDir, base.rootDir, name);
    assert.deepEqual(config.roots, base.roots, name);
  }
});
