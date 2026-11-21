'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const api = '/qualification/workspace/services/api';
const spec = 'src/database/direct-payment-capacity-concurrency.spec.ts';
const title = 'serializes different payment sources so they cannot both spend the old fixed limit';
const fixtureSha = '735b7c13cafc6a54930d9c6d862fb0fe4d04467329cc5f7fce83436ca0612f31';

async function consume(context, receipt) {
  const { ownerUrl, workDir, runId, database } = context;
  const endpoint = new URL(ownerUrl);
  assert.ok(endpoint.protocol === 'postgresql:' && endpoint.hostname === '127.0.0.1' &&
    endpoint.username === 'jg_task01_owner' && database === 'jg_task01_' + runId.replaceAll('-', '') &&
    endpoint.pathname === '/' + database && endpoint.searchParams.get('sslmode') === 'require' &&
    endpoint.searchParams.get('sslaccept') === 'strict' &&
    endpoint.searchParams.get('sslcert') === path.join(workDir, 'ca.crt'), 'REMAINING_DIRECT_289_IDENTITY');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(api, spec))).digest('hex'),
    fixtureSha, 'REMAINING_DIRECT_289_FIXTURE');
  const proof = await context.sql(`SELECT (current_user=session_user AND current_user='jg_task01_owner'
    AND current_user::regrole::oid=10 AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=10)
    AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text`);
  assert.equal(proof.stdout.trim(), 'true', 'REMAINING_DIRECT_289_BOOTSTRAP_TLS');
  receipt.stages.push('REMAINING_DIRECT_289_ORIGINAL_JEST');
  const reportFile = path.join(fs.mkdtempSync(path.join(workDir, 'direct-capacity-')), 'jest.json');
  const result = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'), '--runInBand',
    '--runTestsByPath', spec, '--json', '--outputFile=' + reportFile], {
    cwd: api, encoding: 'utf8', timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH:'/usr/local/bin:/usr/bin:/bin', HOME:workDir, TMPDIR:workDir, NODE_ENV:'test',
      RUN_DIRECT_PAYMENT_CAPACITY_CONCURRENCY:'1', DIRECT_PAYMENT_CAPACITY_DATABASE_URL:endpoint.toString(),
      JG_DIRECT_CAPACITY_289_RUN_ID:runId.replaceAll('-', '') },
  });
  let report;
  if (fs.existsSync(reportFile) && fs.statSync(reportFile).size <= 16 * 1024 * 1024) {
    report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  }
  assert.ok(result.status === 0 && report?.success && report.numTotalTests === 1 &&
    report.numPassedTests === 1 && report.numPendingTests === 0 && report.testResults.length === 1 &&
    report.testResults[0].name === path.join(api, spec) &&
    report.testResults[0].assertionResults[0].title === title, 'REMAINING_DIRECT_289_ORIGINAL_COVERAGE');
  receipt.directCapacity = { passed:1, skipped:0, bootstrapOid:10, tls:true };
}

if (require.main === module) {
  const receipt = { schemaVersion:1, business:'NOT_ENTERED', stages:[] };
  require('./installer.cjs').withOutside289RemainingDirectCapacity(receipt).then(() => {
    assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
    assert.equal(receipt.sameInstancePostConsume,true);
    assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
    console.log(JSON.stringify({ ...receipt, status:'REMAINING_DIRECT_PAYMENT_CAPACITY_289_PASSED' }));
  }).catch(() => {
    const stage = receipt.stages.at(-1);
    console.log(JSON.stringify({ ...receipt, status:'STOPPED',
      failure:{ stage:typeof stage === 'string' ? stage : stage?.stage ?? 'INPUTS' } }));
    process.exitCode = 1;
  });
}
module.exports = { consume };
