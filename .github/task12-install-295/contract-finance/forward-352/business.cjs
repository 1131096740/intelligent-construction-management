'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function runBusiness({ endpoint, database, runId, workDir, jsonSql, receipt }) {
  const run = runId.replaceAll('-', '');
  assert.match(run, /^[0-9a-f]{32}$/u);
  assert.equal(database, 'jg_task01_' + run);
  const url = new URL(endpoint.toString());
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/' + database);
  const api = '/qualification/candidate/services/api';
  const report = path.join(workDir, 'issue436-352-jest.json');
  // The assertion is read from separate sessions, so persist it only on this disposable database.
  await jsonSql(`ALTER DATABASE "${database}" SET "app.issue436_company_run" = '${runId}'; SELECT '{}'::jsonb`);
  const child = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'), '--runInBand',
    '--runTestsByPath', 'src/database/issue436-company-history-expense.pg.spec.ts', '--json', '--outputFile=' + report], {
    cwd: api, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, NODE_ENV: 'test', CI: 'true',
      ISSUE436_COMPANY_HISTORY_RUN: '1', ISSUE436_COMPANY_HISTORY_DATABASE_URL: url.toString(),
      ISSUE436_COMPANY_HISTORY_RUN_ID: runId, ISSUE436_COMPANY_HISTORY_MODE: '--full-chain',
      DATABASE_URL: url.toString(), APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false' }
  });
  const output = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
  const suite = output?.testResults?.[0];
  const cases = suite?.assertionResults ?? [];
  receipt.issue436_352 = { exit: child.status, total: output?.numTotalTests ?? 0,
    passed: output?.numPassedTests ?? 0, skipped: output?.numPendingTests ?? 0,
    errors: cases.filter(item => item.status === 'failed').map(item => ({ title: item.title,
      message: (item.failureMessages ?? []).join('\n').slice(0, 12000).replaceAll(url.password, '[redacted]') })) };
  assert.ok(child.status === 0 && output?.success && output.numTotalTests === 1 && output.numPassedTests === 1 &&
    output.numPendingTests === 0 && cases.length === 1 && cases[0].status === 'passed', 'ISSUE436_352_BUSINESS');
};
