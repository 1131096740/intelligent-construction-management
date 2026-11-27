'use strict';

const { closeSync, constants, fstatSync, openSync, readFileSync } = require('node:fs');

const phaseKey = Symbol('task398BrowserPhase');
const jestKey = Symbol('task398BrowserJestFailure');
const browserSpecs = new Set(['task16-real-browser.pg.spec.ts', 'task16-real-browser-completion.pg.spec.ts']);
const childFailures = new Set(['EACCES', 'ENOENT', 'ENOBUFS', 'ETIMEDOUT']);
const childSignals = new Set(['SIGABRT', 'SIGKILL', 'SIGTERM']);
const phases = new Set(['RUNTIME_PREFLIGHT', 'JEST_SCENARIO', 'VERIFY_BROWSER_EVIDENCE', 'VERIFY_OWNER_CONTINUITY']);

function markBrowserPhase(receipt, phase) {
  if (!phases.has(phase)) throw new Error('TASK398_BROWSER_DIAGNOSTIC_PHASE');
  receipt[phaseKey] = phase;
}

function readJestReport(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 1024 * 1024) return undefined;
    const report = JSON.parse(readFileSync(fd, 'utf8'));
    return report && typeof report === 'object' ? report : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function boundedInteger(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : undefined;
}

function browserAssertion(report, scenario) {
  const spec = scenario.split('/').at(-1);
  if (!browserSpecs.has(spec) || !Array.isArray(report?.testResults)) return {};
  const suite = report.testResults.find(row => typeof row?.name === 'string' && row.name.endsWith('/' + scenario));
  const test = Array.isArray(suite?.assertionResults) ? suite.assertionResults.find(row => row?.status === 'failed') : undefined;
  const first = test?.failureMessages?.[0] ?? suite?.message;
  const clean = typeof first === 'string' ? first.slice(0, 8192).replace(/\x1b\[[0-9;]*m/gu, '') : '';
  const status = /^\s*Expected:\s+([1-5]\d{2})\s*\r?\n\s*Received:\s+([1-5]\d{2})\s*$/mu.exec(clean);
  const statuses = /TASK398_HTTP_STATUSES_([1-5]\d{2}(?:_[1-5]\d{2}){5})\b/u.exec(clean);
  const frame = /^\s*at [^\r\n]*?\b(task16-real-browser(?:-completion)?\.pg\.spec\.ts):(\d{1,5}):(\d{1,5})(?=[\s)]|$)/mu.exec(clean);
  const kind = status || statuses ? 'HTTP_STATUS_MISMATCH'
    : /permission denied for (?:table|column|function|schema|sequence)\b|\b42501\b/iu.test(clean) ? 'DATABASE_PERMISSION'
      : /TimeoutError|timed out|exceeded timeout/iu.test(clean) ? 'TIMEOUT'
        : /expect\(|AssertionError/u.test(clean) ? 'ASSERTION' : 'OTHER';
  return {
    kind,
    ...(status ? { http: { expected: Number(status[1]), received: Number(status[2]) } } : {}),
    ...(statuses ? { initialHttpStatuses: statuses[1].split('_').map(Number) } : {}),
    ...(frame?.[1] === spec && Number(frame[2]) > 0 && Number(frame[3]) > 0
      ? { frame: { spec, line: Number(frame[2]), column: Number(frame[3]) } } : {})
  };
}

function recordBrowserJestFailure(receipt, reportPath, scenario, result) {
  const report = readJestReport(reportPath);
  receipt[jestKey] = {
    exitStatus: boundedInteger(result.status, 255),
    signal: childSignals.has(result.signal) ? result.signal : undefined,
    spawnError: childFailures.has(result.error?.code) ? result.error.code : undefined,
    report: report ? 'PRESENT' : 'UNAVAILABLE',
    ...(report ? {
      passed: boundedInteger(report.numPassedTests, 99),
      failed: boundedInteger(report.numFailedTests, 99),
      skipped: boundedInteger(report.numPendingTests, 99),
      ...browserAssertion(report, scenario)
    } : {})
  };
}

function browserDiagnostic(receipt) {
  if (receipt[phaseKey]) {
    return { phase: receipt[phaseKey], ...(receipt[jestKey] ? { jest: receipt[jestKey] } : {}) };
  }
  if (receipt.forward320 && receipt.stages.at(-1) === 'EXACT_295_MULTI_WITNESS_CONSUMER') {
    return { phase: 'CONSUMER_HANDOFF' };
  }
}

module.exports = { browserDiagnostic, markBrowserPhase, recordBrowserJestFailure };
