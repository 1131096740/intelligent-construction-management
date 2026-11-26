'use strict';

const { basename } = require('node:path');

const marker = 'POL115_BROWSER_WITNESS ';
const suites = {
  'pol115-expense-real.e2e.ts': 'expense',
  'expense-self-service-real.e2e.ts': 'expense_self_service',
  'draft-deletion-real.e2e.ts': 'draft_deletion',
  'pol115-fund-real.e2e.ts': 'fund',
  'operating-takeover-real.e2e.ts': 'takeover',
  'pol115-spot-procurement-real.e2e.ts': 'spot'
};
const projects = ['desktop', 'mobile'];
const statuses = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
const steps = ['fixture', 'navigation', 'response_wait', 'request', 'assertion', 'interaction', 'other'];
const routes = ['login', 'expense', 'draft_deletion', 'fund', 'takeover', 'spot'];
const lineNumber = line => Number.isInteger(line) && line > 0 && line <= 2_000;

function testIdentity(test) {
  const suite = suites[basename(test.location.file)];
  const project = test.parent.project()?.name;
  const testLine = test.location.line;
  if (suite && projects.includes(project) && lineNumber(testLine)) return { suite, project, testLine };
}

function classifyStep(step, suite) {
  if (!step) return {};
  const title = step.title;
  let category = 'other';
  if (step.category === 'fixture' || step.category === 'hook') category = 'fixture';
  else if (step.category === 'expect') category = 'assertion';
  else if (/\bpage\.(?:goto|reload|waitForURL)\b|^Navigate to\b/iu.test(title)) category = 'navigation';
  else if (/\bwaitForResponse\b|Wait for event ["']?response/iu.test(title)) category = 'response_wait';
  else if (/\b(?:apiRequestContext|request)\.(?:get|post|delete|put|patch|fetch)\b/iu.test(title)) category = 'request';
  else if (step.category === 'pw:api') category = 'interaction';

  const detail = { category };
  if (step.location && suites[basename(step.location.file)] === suite && lineNumber(step.location.line)) {
    detail.stepLine = step.location.line;
  }
  if (category === 'navigation') {
    if (title.includes('/login')) detail.route = 'login';
    else detail.route = suite === 'expense_self_service' ? 'expense' : suite;
  }
  return detail;
}

function failedStep(step) {
  for (const child of step.steps) {
    const failure = failedStep(child);
    if (failure) return failure;
  }
  if (step.error) return step;
}

function emit(row) {
  process.stdout.write(marker + JSON.stringify(row) + '\n');
}

class BrowserWitness {
  constructor() { this.progressCounts = new Map(); }

  onTestBegin(test) {
    const identity = testIdentity(test);
    if (!identity) return;
    this.progressCounts.set(test, 0);
    emit({ event: 'begin', ...identity });
  }

  onStepBegin(test, _result, step) {
    const count = this.progressCounts.get(test);
    if (count === undefined || count >= 6) return;
    const identity = testIdentity(test);
    const detail = classifyStep(step, identity.suite);
    if (!['navigation', 'response_wait', 'request'].includes(detail.category) || !detail.stepLine) return;
    this.progressCounts.set(test, count + 1);
    emit({ event: 'step', ...identity, ...detail });
  }

  onTestEnd(test, result) {
    const identity = testIdentity(test);
    this.progressCounts.delete(test);
    if (!identity) return;
    const step = result.steps.map(failedStep).find(Boolean);
    emit({ event: 'end', ...identity, status: result.status, durationMs: result.duration,
      ...classifyStep(step, identity.suite) });
  }
}

function summarizeBrowserWitness(output) {
  const suitesSeen = {};
  const active = new Map();
  const failures = [];
  let events = 0;
  for (const { 1: json } of output.matchAll(/^POL115_BROWSER_WITNESS (\{[^\r\n]{1,300}\})\s*$/gmu)) {
    if (events++ >= 512) break;
    let raw;
    try { raw = JSON.parse(json); } catch { continue; }
    const { event, suite, project, testLine, status, durationMs, category, stepLine, route } = raw;
    if (!Object.values(suites).includes(suite) || !projects.includes(project) || !lineNumber(testLine)) continue;
    const key = suite + ':' + project + ':' + testLine;
    const identity = { suite, project, testLine };
    const detail = { ...(steps.includes(category) && { category }),
      ...(lineNumber(stepLine) && { stepLine }), ...(routes.includes(route) && { route }) };
    if (event === 'begin') {
      const counts = suitesSeen[suite] ??= { started: 0, completed: 0 };
      counts.started++;
      active.set(key, identity);
    } else if (event === 'step' && active.has(key)) {
      active.set(key, { ...identity, ...detail });
    } else if (event === 'end' && active.has(key) && statuses.includes(status)) {
      const progress = active.get(key);
      active.delete(key);
      suitesSeen[suite].completed++;
      if (!['passed', 'skipped'].includes(status) && failures.length < 12) {
        failures.push({ ...progress, ...detail, status,
          ...(Number.isInteger(durationMs) && durationMs >= 0 && durationMs <= 900_000 && { durationMs }) });
      }
    }
  }
  return Object.keys(suitesSeen).length ? { suites: suitesSeen, failures, inProgress: [...active.values()].slice(-8) } : undefined;
}

module.exports = BrowserWitness;
module.exports.summarizeBrowserWitness = summarizeBrowserWitness;
