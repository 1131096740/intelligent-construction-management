'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function run435({ endpoint, database, runId, workDir, receipt }) {
  assert.equal(database, 'jg_task01_' + runId.replaceAll('-', ''));
  const url = new URL(endpoint.toString());
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/' + database);
  const api = '/qualification/candidate/services/api';
  const report = path.join(workDir, 'issue435-352-jest.json');
  const secret = randomBytes(32).toString('hex');
  const child = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'), '--runInBand',
    '--runTestsByPath', 'src/database/issue411-third-company-repayment.pg.spec.ts',
    '--testNamePattern=issue 435', '--json', '--outputFile=' + report], {
    cwd: api, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, NODE_ENV: 'test', CI: 'true',
      DATABASE_URL: url.toString(), JG_ISSUE411_ORDERED_DATABASE: database,
      OPERATING_LEDGER_DB_WRITE_SECRET: secret, RUN_ISSUE411_THIRD_COMPANY_REPAYMENT: '1',
      RUN_ISSUE435_SETTLED_RETURN: '1', APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false' }
  });
  const output = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
  const cases = output?.testResults?.[0]?.assertionResults ?? [];
  const selected = cases.filter(item => item.title.startsWith('issue 435 '));
  receipt.issue435_352 = { exit: child.status, selected: selected.length,
    passed: selected.filter(item => item.status === 'passed').length,
    errors: selected.filter(item => item.status === 'failed').map(item => ({ title: item.title,
      message: (item.failureMessages ?? []).join('\n').slice(0, 12000)
        .replaceAll(url.password, '[redacted]').replaceAll(secret, '[redacted]') })) };
  assert.ok(child.status === 0 && output?.success && selected.length === 2 &&
    selected.every(item => item.status === 'passed'), 'ISSUE435_352_BUSINESS');
};
