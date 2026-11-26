'use strict';

const { basename } = require('node:path');
const { stripVTControlCharacters } = require('node:util');

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
const operations = {
  create_context: /(?:browser\.newContext|^Create browser context$)/iu,
  create_page: /(?:browserContext\.newPage|^Create page$)/iu,
  init_script: /\.addInitScript\b/u,
  evaluate: /\.evaluate(?:Handle)?\b/u
};
const reasons = {
  target_closed: /Target page, context or browser has been closed|(?:Page|Browser|Context) closed\b/iu,
  browser_crashed: /(?:Page|Browser) (?:has )?crashed|WebProcess.*(?:crashed|terminated)/iu,
  browser_launch: /(?:browserType\.launch|Failed to launch browser)/iu,
  strict_locator: /strict mode violation/iu,
  action_timeout: /(?:Test timeout of \d+ms exceeded|Timeout \d+ms exceeded)/iu,
  reference_error: /\bReferenceError:/u,
  type_error: /\bTypeError:/u,
  navigation_error: /net::ERR_[A-Z_]+|Frame load interrupted|Navigation interrupted/iu
};
const lineNumber = line => Number.isInteger(line) && line > 0 && line <= 2_000;
const httpStatus = status => Number.isInteger(status) && status >= 100 && status <= 599;

function matchLabel(patterns, text) {
  return Object.entries(patterns).find(([, pattern]) => pattern.test(text))?.[0];
}

function diagnoseFailure(step, errors, suite) {
  const error = errors?.[0];
  const message = (step?.error?.message ?? error?.message ?? '').slice(0, 2_048);
  const operation = matchLabel(operations, step?.title ?? '') ?? matchLabel(operations, message.split('\n', 1)[0]);
  const reason = matchLabel(reasons, message);
  const coldStatus = suite === 'spot' && stripVTControlCharacters(message)
    .match(/^(?:Error: )?POL115_SPOT_COLD_HTTP 200 ([1-5]\d{2})$/mu);
  const frames = (step?.error?.stack ?? error?.stack ?? '').slice(0, 4_096);
  const frame = [...frames.matchAll(/(?:[\\/])([a-z0-9.-]+\.e2e\.ts):(\d{1,4}):\d{1,4}(?=[)\s]|$)/gu)]
    .find(([, file, line]) => suites[file] === suite && lineNumber(Number(line)));
  return { ...(operation && { operation }), ...(reason && { reason }), ...(frame && { stepLine: Number(frame[2]) }),
    ...(coldStatus && { expectedStatus: 200, receivedStatus: Number(coldStatus[1]) }) };
}

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
    const failure = diagnoseFailure(step, result.errors, identity.suite);
    emit({ event: 'end', ...identity, status: result.status, durationMs: result.duration,
      ...failure, ...classifyStep(step, identity.suite) });
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
    const { event, suite, project, testLine, status, durationMs, category, stepLine, route, operation, reason, expectedStatus, receivedStatus } = raw;
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
          ...(typeof operation === 'string' && Object.hasOwn(operations, operation) && { operation }),
          ...(typeof reason === 'string' && Object.hasOwn(reasons, reason) && { reason }),
          ...(suite === 'spot' && expectedStatus === 200 && httpStatus(receivedStatus) && { expectedStatus, receivedStatus }),
          ...(Number.isInteger(durationMs) && durationMs >= 0 && durationMs <= 900_000 && { durationMs }) });
      }
    }
  }
  return Object.keys(suitesSeen).length ? { suites: suitesSeen, failures, inProgress: [...active.values()].slice(-8) } : undefined;
}

module.exports = BrowserWitness;
module.exports.summarizeBrowserWitness = summarizeBrowserWitness;
