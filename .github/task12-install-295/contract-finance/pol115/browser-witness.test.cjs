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
