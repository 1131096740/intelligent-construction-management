'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const apiRoot = '/qualification/workspace/services/api';
const suites = [
  'src/approval/issue430-notification.pg.spec.ts',
  'src/fund-execution/fund-execution-entry.http.pg.spec.ts'
];
const expectedScenarios = [
  'expense_claim', 'fund_execution_case', 'project_expense_request',
  'project_financing_quota', 'project_settlement_exception_quota'
];

async function runIssue430ApprovalSms(context, receipt, source) {
  assert.ok(['payment-remainder-331', 'upward-archive-332', 'historical-settlement-334', 'expense-witness-346'].includes(source.mode));
  assert.equal(context.candidateTree, source.sourceTree);
  assert.equal(context.database, 'jg_task01_' + context.runId.replaceAll('-', ''));
  const uri = new URL(context.ownerUrl);
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.username, 'jg_task01_owner');
  assert.equal(uri.pathname, '/' + context.database);
  assert.equal(uri.searchParams.get('sslmode'), 'require');
  assert.equal(uri.searchParams.get('sslaccept'), 'strict');
  assert.ok(uri.searchParams.get('sslcert'));
  const files = path.join(context.workDir, 'issue430-files');
  const reportPath = path.join(context.workDir, 'issue430-jest-report.json');
  fs.mkdirSync(files, { mode: 0o700 });
  receipt.stages.push('ISSUE430_SMS');
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'test', HOME: context.workDir, TMPDIR: context.workDir,
    DATABASE_URL: uri.toString(), RUN_POL115_ENTRY_PG16: '1', RUN_ISSUE430_SMS: '1',
    ISSUE430_NATIVE_PG_DATABASE: context.database, APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false',
    FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: files,
    FILE_DOWNLOAD_SECRET: randomUUID(), JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID()
  };
  let stdout;
  try {
    ({ stdout } = await execute(process.execPath, [path.join(apiRoot, 'node_modules/jest/bin/jest.js'),
      '--runInBand', '--runTestsByPath', ...suites, '--json', '--outputFile', reportPath],
    { cwd: apiRoot, env, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    receipt.issue430 = {
      jestExit: Number.isInteger(error.code) ? error.code : null,
      failedCases: report?.testResults?.flatMap(suite => suite.assertionResults)
        .filter(test => test.status === 'failed').map(test => test.title),
      prismaCodes: [...new Set(String(error.stderr ?? '').match(/\bP[0-9]{4}\b/gu) ?? [])]
    };
    throw new Error('ISSUE430_APPROVAL_SMS_JEST');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.deepEqual(report.testResults.map(suite => path.relative(apiRoot, suite.name)).sort(), [...suites].sort());
  assert.equal(report.numPassedTestSuites, 2);
  assert.equal(report.numPassedTests, 5);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 1); // Optional fund browser case is covered separately.
  const scenarios = [...stdout.matchAll(/\{"scenario":"([a-z_]+)","mockedCorrectionSends":3,"unknownResends":0,"externalSends":0\}/gu)]
    .map(match => match[1]).sort();
  assert.deepEqual(scenarios, expectedScenarios);
  receipt.issue430 = { tests: report.numPassedTests, scenarios, externalSends: 0 };
}

module.exports = { runIssue430ApprovalSms };
