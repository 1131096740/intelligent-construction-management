'use strict';

const { execFile } = require('node:child_process');
const { readFile, statfs } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const {
  collectEnvironment, collectContainerResources, databaseSnapshotSql, observeDatabase, startDatabaseSampling,
} = require('./pol108-observability.cjs');
const { selectShards, assertTestResults } = require('./pol108-shards.cjs');

const exec = promisify(execFile);
const apiRoot = '/qualification/workspace/services/api';

async function qualifyPol108(context, shardName, environment, receipt) {
  const [shard] = selectShards(['--shard', shardName]);
  const evidencePath = path.join(context.workDir,'pol108-a18-evidence.jsonl');
  const testEnvironment = {...environment, POL108_OWNED_289_RUN_ID:context.runId, POL108_A18_EVIDENCE_FILE:evidencePath};
  const aggregateQuery = async (_command, args) => {
    if (args.at(-1) !== databaseSnapshotSql) throw new Error('POL108_OBSERVATION_QUERY');
    return context.sql(databaseSnapshotSql);
  };
  const cgroups = () => collectContainerResources(async (_command, args) => ({
    stdout: await readFile(args.at(-1), 'utf8'),
  }), null, null);
  const capture = async () => ({
    resources: await cgroups(),
    database: await observeDatabase(aggregateQuery, null, null, context.database),
  });
  const before = await capture();
  if (before.database.trackIoTiming !== 'on') throw new Error('POL108_TRACK_IO_TIMING');
  const stats = (await context.sql('SHOW track_functions;')).stdout.trim();
  if (stats !== 'all') throw new Error('POL108_TRACK_FUNCTIONS');

  receipt.operatingProjection = { shard: shardName, environment: await collectEnvironment(), before,
    resourceSampleScope:'COMBINED_PG_INSTALLER_AND_JEST', pgStatsScope:'OWNED_POSTGRESQL_ONLY' };
  if (shardName === 'facts' || shardName === 'impacts') {
    const space = await statfs(context.workDir);
    const totalBytes = space.bsize * space.blocks;
    const freeBytes = space.bsize * space.bavail;
    const facts = shardName === 'facts';
    const totalRequired = (facts ? 1024 : 2048) * 1024 * 1024;
    const freeRequired = (facts ? 512 : 1536) * 1024 * 1024;
    const storageField = facts ? 'factsStorage' : 'impactsStorage';
    receipt.operatingProjection[storageField] = { totalBytes, freeBytes };
    if (totalBytes !== totalRequired || freeBytes < freeRequired) {
      throw new Error(facts ? 'POL108_FACTS_STORAGE_BOUNDARY' : 'POL108_IMPACTS_STORAGE_BOUNDARY');
    }
  }
  const stop = startDatabaseSampling({ command: aggregateQuery, databaseName: context.database });
  const resultPath = path.join(context.workDir, 'pol108-jest-result.json');
  try {
    await exec(process.execPath, [path.join(apiRoot, 'node_modules/jest/bin/jest.js'),
      '--config', path.join(apiRoot, 'jest.runtime.config.cjs'), '--runInBand',
      '--runTestsByPath', shard.file, '--json', '--outputFile', resultPath], {
      cwd: apiRoot, env: testEnvironment, timeout: 90 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    receipt.operatingProjection.jestExit = Number.isInteger(error.code) ? error.code : null;
    const stderr = String(error.stderr ?? '');
    receipt.operatingProjection.prismaCode = stderr.match(/\bP[0-9]{4}\b/u)?.[0];
    receipt.operatingProjection.startupCodes = [
      "Can't find a root directory", 'Cannot find module', 'ENOENT', 'out of memory',
    ].filter(code => stderr.includes(code));
    const failedOutput = await readFile(resultPath,'utf8').catch(() => null);
    if (failedOutput) {
      const results = JSON.parse(failedOutput);
      receipt.operatingProjection.passed = results.numPassedTests;
      receipt.operatingProjection.failed = results.numFailedTests;
      receipt.operatingProjection.failedCases = results.testResults.flatMap(suite => suite.assertionResults)
        .filter(test => test.status === 'failed').map(test => test.title);
    }
    throw new Error('POL108_JEST');
  } finally {
    const raw = await readFile(evidencePath,'utf8').catch(() => '');
    receipt.operatingProjection.registeredCash = raw.trim() ? raw.trim().split('\n').map(line=>JSON.parse(line)) : [];
    Object.assign(receipt.operatingProjection, { sampling: await stop(), after: await capture() });
  }

  const results = JSON.parse(await readFile(resultPath, 'utf8'));
  receipt.operatingProjection.tests = assertTestResults(results, [shard]);
}

async function runPol108(context, shard, receipt, runCommand, baseEnv, need) {
  const extra = {
    DATABASE_URL:context.ownerUrl, NODE_ENV:'test', CI:'true', RUN_POL108_OPERATING_PROJECTION_PG16:'1',
    TMPDIR:context.workDir, FILE_STORAGE_DRIVER:'local', FILE_STORAGE_ROOT:path.join(context.workDir,'storage','private'),
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(), SEED_PASSWORD:'Local@1-'+randomUUID(),
  };
  receipt.stages.push('FRESH_OWNER_REPLAY');
  const migration=runCommand(process.execPath,[path.join(apiRoot,'node_modules/prisma/build/index.js'),'migrate',
    'deploy','--schema',path.join(apiRoot,'prisma/schema.prisma')],{cwd:apiRoot,timeoutMs:180_000,extra});
  need(migration.stdout.includes('No pending migrations to apply.'),'FRESH_OWNER_REPLAY');
  receipt.stages.push('FRESH_OWNER_SEED');
  runCommand(process.execPath,[path.join(apiRoot,'prisma/seed.cjs')],{cwd:context.workDir,timeoutMs:180_000,extra});
  const endpoint = new URL(context.ownerUrl);
  endpoint.searchParams.set('connection_limit','2');
  extra.DATABASE_URL = endpoint.toString();
  receipt.pol108ConnectionLimit=2;
  receipt.stages.push('POL108_OBSERVED_JEST');
  await qualifyPol108(context,shard,{...baseEnv,HOME:'/tmp',...extra},receipt);
}

module.exports = { runPol108 };
