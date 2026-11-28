'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const BrowserWitness = require('./browser-witness.cjs');
const { summarizeBrowserWitness } = BrowserWitness;

const line = row => 'POL115_BROWSER_WITNESS ' + JSON.stringify(row);

test('separates timed-out browser steps from journeys still running when Jest returns', () => {
  const fund = { suite: 'fund', project: 'mobile', testLine: 3 };
  const expense = { suite: 'expense', project: 'desktop', testLine: 46 };
  const input = [
    line({ event: 'begin', ...fund }),
    line({ event: 'step', ...fund, category: 'navigation', route: 'fund', stepLine: 11 }),
    line({ event: 'end', ...fund, status: 'timedOut', durationMs: 45_001,
      category: 'response_wait', stepLine: 10, rawMessage: 'private-test-value' }),
    line({ event: 'begin', ...expense }),
    line({ event: 'step', ...expense, category: 'navigation', route: 'expense', stepLine: 52 })
  ].join('\n');
  assert.deepEqual(summarizeBrowserWitness(input), {
    suites: { fund: { started: 1, completed: 1 }, expense: { started: 1, completed: 0 } },
    failures: [{ ...fund, category: 'response_wait', route: 'fund', stepLine: 10,
      status: 'timedOut', durationMs: 45_001 }],
    inProgress: [{ ...expense, category: 'navigation', route: 'expense', stepLine: 52 }]
  });
});

test('reports only finite names and bounded coordinates', () => {
  const good = { suite: 'takeover', project: 'desktop', testLine: 5 };
  const input = [
    line({ event: 'begin', ...good, project: 'private-test-value' }),
    line({ event: 'begin', ...good }),
    line({ event: 'step', ...good, category: 'private-test-value', stepLine: 2_001, route: 'private-test-value' }),
    line({ event: 'end', ...good, status: 'failed', durationMs: 9_000_000, reason: { toString: null }, operation: 'private-test-value', rawMessage: 'private-test-value' }),
    'POL115_BROWSER_WITNESS {' + 'x'.repeat(301) + '}'
  ].join('\n');
  assert.deepEqual(summarizeBrowserWitness(input), {
    suites: { takeover: { started: 1, completed: 1 } },
    failures: [{ ...good, status: 'failed' }],
    inProgress: []
  });
});


test('classifies early browser failures without retaining exception text or source paths', (t) => {
  const output = [];
  const write = t.mock.method(process.stdout, 'write', chunk => { output.push(chunk); return true; });
  const witness = new BrowserWitness();
  const location = { file: '/private-test-value/pol115-expense-real.e2e.ts', line: 236 };
  const entry = { location, parent: { project: () => ({ name: 'mobile' }) } };
  witness.onTestBegin(entry);
  const error = { message: 'browserContext.newPage: Target page, context or browser has been closed\nprivate-test-value',
    stack: 'Error: private-test-value\n    at /private-test-value/pol115-expense-real.e2e.ts:241:7' };
  witness.onTestEnd(entry, { status: 'failed', duration: 91, errors: [error], steps: [
    { category: 'fixture', title: 'fixture: page', steps: [
      { category: 'pw:api', title: 'browserContext.newPage', steps: [], error: { message: error.message } }
    ] }
  ] });
  write.mock.restore();
  const text = output.join('');
  assert.equal(text.includes('private-test-value'), false);
  assert.deepEqual(summarizeBrowserWitness(text)?.failures, [{ suite: 'expense', project: 'mobile', testLine: 236,
    category: 'interaction', operation: 'create_page', reason: 'target_closed', stepLine: 241, status: 'failed', durationMs: 91 }]);
});

test('keeps only the numeric status from the Spot cold-start assertion', (t) => {
  const output = [];
  const write = t.mock.method(process.stdout, 'write', chunk => { output.push(chunk); return true; });
  const witness = new BrowserWitness();
  const entry = { location: { file: '/private-test-value/pol115-spot-procurement-real.e2e.ts', line: 416 },
    parent: { project: () => ({ name: 'mobile' }) } };
  const error = { message: 'Error: POL115_SPOT_COLD_HTTP 200 502\n\nprivate-test-value' };
  witness.onTestBegin(entry);
  witness.onTestEnd(entry, { status: 'failed', duration: 91, errors: [error], steps: [
    { category: 'expect', title: 'expect.toBe', location: { ...entry.location, line: 425 }, steps: [], error }
  ] });
  write.mock.restore();
  const text = output.join('');
  assert.equal(text.includes('private-test-value'), false);
  assert.deepEqual(summarizeBrowserWitness(text)?.failures, [{ suite: 'spot', project: 'mobile', testLine: 416,
    category: 'assertion', stepLine: 425, status: 'failed', durationMs: 91, expectedStatus: 200, receivedStatus: 502 }]);
});

test('records only status codes from an expense self-service assertion', (t) => {
  const output = [];
  const write = t.mock.method(process.stdout, 'write', chunk => { output.push(chunk); return true; });
  const witness = new BrowserWitness();
  const entry = { location: { file: '/private/expense-self-service-real.e2e.ts', line: 27 },
    parent: { project: () => ({ name: 'mobile' }) } };
  const error = { message: 'Expected: 200\nReceived: 500\nprivate-test-value' };
  witness.onTestBegin(entry);
  witness.onTestEnd(entry, { status: 'failed', duration: 91, errors: [error], steps: [
    { category: 'expect', title: 'expect.toBe', location: { ...entry.location, line: 11 }, steps: [], error }
  ] });
  write.mock.restore();
  const text = output.join('');
  assert.equal(text.includes('private-test-value'), false);
  assert.deepEqual(summarizeBrowserWitness(text)?.failures, [{ suite: 'expense_self_service', project: 'mobile',
    testLine: 27, category: 'assertion', stepLine: 11, status: 'failed', durationMs: 91,
    expectedStatus: 200, receivedStatus: 500 }]);
});

test('classifies a historical balance failure without retaining displayed text', (t) => {
  const output = [];
  const write = t.mock.method(process.stdout, 'write', chunk => { output.push(chunk); return true; });
  const witness = new BrowserWitness();
  const entry = { location: { file: '/private/pol115-expense-real.e2e.ts', line: 18 },
    parent: { project: () => ({ name: 'mobile' }) } };
  const location = { ...entry.location, line: 30 };
  witness.onTestBegin(entry);
  witness.onStepEnd(entry, {}, { category: 'expect', location });
  const error = { message: 'Expected substring: "¥0.01"\nReceived string: "¥0.00 private-test-value"' };
  witness.onTestEnd(entry, { status: 'failed', duration: 100, errors: [error], steps: [
    { category: 'expect', title: 'expect.toContainText', location, steps: [], error }
  ] });
  write.mock.restore();
  assert.equal(output.join('').includes('private-test-value'), false);
  assert.deepEqual(summarizeBrowserWitness(output.join(''))?.failures, [{ suite: 'expense', project: 'mobile',
    testLine: 18, category: 'assertion', stepLine: 30, status: 'failed', durationMs: 100,
    balance: 'zero', balancePhase: 'director' }]);
});
