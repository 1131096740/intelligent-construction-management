'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { admitSource } = require('./install-only292.cjs');
const { withCombined335HistoricalExpense, withCombinedExpenseWitness, withCombinedExpenseWitness349, withCombinedSignedSettlement350, withCombinedCompanyHistory352 } = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const history = require('./historical-expense-335-profile.cjs');
const source = require('./contract-finance-source.json');
const company = source.mode === 'company-history-352';
const signed = company || source.mode === 'signed-settlement-350';
const precision = signed || source.mode === 'expense-witness-349';
const combined = precision || source.mode === 'expense-witness-346';
const profile = company ? require('./company-history-352-profile.cjs') : signed ? require('./signed-settlement-350-profile.cjs')
  : precision ? require('./expense-witness-349-profile.cjs')
  : combined ? require('./expense-witness-346-profile.cjs') : history;

const root = '/qualification';
const api = path.join(root, 'workspace/services/api');
const raceScript = path.join(root, 'historical-expense-335-race.cjs');
const spec = history.issue417Spec;
const title = 'imports 20 rows, verifies 18, keeps 2 pending, posts only verified rows once';
const purpose = 'ISSUE417_HISTORY_EXPENSE_EXACT_' + profile.count;
const receipt = { schemaVersion: 1, purpose, sourceSha: source.sourceSha, stages: ['INPUTS'], status: 'STOPPED' };

async function consume(context) {
  const { ownerUrl, database, workDir, candidateTree, runId } = context;
  const endpoint = new URL(ownerUrl);
  const run = runId.replaceAll('-', '');
  assert.equal(candidateTree, source.sourceTree);
  if (signed) assert.equal(receipt.installOnly295.nonOwnerDenied, true);
  assert.match(run, /^[a-f0-9]{32}$/u);
  assert.equal(database, 'jg_task01_' + run);
  assert.equal(endpoint.protocol, 'postgresql:');
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.equal(endpoint.username, 'jg_task01_owner');
  assert.equal(endpoint.pathname, '/' + database);
  assert.equal(endpoint.searchParams.get('sslmode'), 'require');
  assert.equal(endpoint.searchParams.get('sslaccept'), 'strict');
  assert.equal(endpoint.searchParams.get('sslcert'), path.join(workDir, 'ca.crt'));
  const readHistoryCatalog = async () => JSON.parse((await context.sql(history.catalogSql)).stdout.trim());
  const historicalCatalog = combined ? await readHistoryCatalog() : receipt.historicalExpense335Catalog;
  history.assertCatalog(historicalCatalog, true);

  receipt.stages.push('ISSUE417_EXACT_' + profile.count + '_REPEATABLE_READ_SCENE_FENCE');
  receipt.sceneRace = await require(raceScript).verifyHistoryExpenseInvariant(context, profile.count);
  receipt.stages.push('ISSUE417_EXACT_' + profile.count + '_ORIGINAL_BUSINESS');
  const directory = fs.mkdtempSync(path.join(workDir, 'issue417-'));
  const reportPath = path.join(directory, 'jest.json');
  const child = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'),
    '--runInBand', '--runTestsByPath', spec, '--json', '--outputFile=' + reportPath], {
    cwd: api, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: directory, NODE_ENV: 'test', CI: 'true',
      ISSUE417_HISTORY_EXPENSE_RUN: '1', ISSUE417_EXACT_FORWARD_RUN_ID: run,
      ISSUE417_EXACT_FORWARD_COUNT: String(profile.count), DATABASE_URL: endpoint.href,
      FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: path.join(directory, 'files'),
      APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false'
    }
  });
  const report = fs.existsSync(reportPath) && fs.statSync(reportPath).size <= 8 * 1024 * 1024
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const suite = report?.testResults?.[0];
  const cases = suite?.assertionResults ?? [];
  receipt.original = {
    registered: report?.numTotalTests ?? 0,
    passed: report?.numPassedTests ?? 0,
    skipped: report?.numPendingTests ?? 0,
    databaseRole: 'ISOLATED_FIXTURE_OWNER',
    operatingLedgerPort: 'ORIGINAL_RECORDED_INPUTS',
    failedCases: cases.flatMap((test, index) => {
      if (test.status !== 'failed') return [];
      const message = (test.failureMessages ?? []).join('\n').slice(0, 32_768);
      return [{
        index: index + 1,
        lines: [...new Set([...message.matchAll(/issue417-history-expense\.pg\.spec\.ts:(\d{1,5}):\d{1,5}/gu)]
          .map(match => Number(match[1])))].slice(0, 4),
        sqlstates: [...new Set(message.match(/\b(?:23503|23514|23505|42501|P2002|P2003|P2010)\b/gu) ?? [])].slice(0, 4)
      }];
    })
  };
  receipt.original.complete = child.status === 0 && report?.success === true && report?.testResults.length === 1 &&
    suite?.name === path.join(api, spec) && report.numPassedTests === 1 && report.numTotalTests === 1 &&
    report.numPendingTests === 0 && cases.length === 1 && cases[0].title === title && cases[0].status === 'passed';
  if (combined) {
    assert.deepEqual(await readHistoryCatalog(), historicalCatalog);
    receipt.historicalExpenseCatalogAfterBusiness = true;
  }
}

async function main() {
  assert.equal(process.argv.length, 2);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  profile.assertSource(source, final);
  if (combined) {
    assert.ok(source.tails.some(row => row.name === history.terminal.name && row.sha256 === history.terminal.sha256));
    profile.assertRuntimeBaseline(require(path.join(api, 'prisma/migration-baseline.cjs')));
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'installer.cjs'))).digest('hex'),
    profile.installerSha256);
  assert.equal(createHash('sha256').update(fs.readFileSync(raceScript)).digest('hex'),
    company ? '590937ecb3d37f7014507872470053b5b80c16dc4eb1e8be5d149565fb024a6b' : signed ? history.race350Sha256 : precision ? history.race349Sha256 : history.raceSha256);
  if (signed) {
    require('./migration-inputs-346.cjs')(api, source, profile);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(api, spec))).digest('hex'), history.issue417SpecSha256);
  }
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');
  const material = { sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails };
  if (company) {
    await withCombinedCompanyHistory352(receipt, consume, { ...source, ...material });
    profile.assertInstallation(receipt, source);
  } else if (signed) {
    await withCombinedSignedSettlement350(receipt, consume, { ...source, ...material });
    profile.assertInstallation(receipt, source);
  } else if (precision) {
    await withCombinedExpenseWitness349(receipt, consume, { ...source, ...material });
    assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness, true);
  } else if (combined) {
    await withCombinedExpenseWitness(receipt, consume, material, profile.count);
  } else {
    await withCombined335HistoricalExpense(receipt, consume, material);
  }
  if (combined) assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  const base334 = combined ? receipt.forward320 : receipt.historicalExpensePredecessor;
  assert.equal(base334.count, 334);
  assert.equal(base334.ledgerSha256, source.predecessor334.ledgerSha256);
  assert.equal(base334.sameIdentity, true);
  assert.equal(base334.sameBaseB7, true);
  const forward = company ? receipt.companyHistoryForward : signed ? receipt.signedSettlementForward
    : precision ? receipt.expenseWitnessPrecisionForward
    : combined ? receipt.expenseWitnessForward : receipt.forward320;
  assert.equal(forward.sourceTree, source.sourceTree);
  assert.equal(forward.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.count, profile.count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.historicalExpenseCatalogAfterBusiness, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.deepEqual(receipt.sceneRace, {
    oldStatesAllowed: true, validPartial: true, wrongScenesRejected: true,
    distinctSessions: true, staleSceneWriteSqlstate: '40001', fixtureCleaned: true
  });
  assert.ok(receipt.original.complete, 'ISSUE417_ORIGINAL_COVERAGE');
  receipt.status = purpose + '_PASSED';
}

main().catch(error => {
  const code = /^ISSUE417_RACE_[A-Z0-9_]+$/u.test(error.message ?? '') ? error.message : error.code ?? error.message;
  const sqlstate = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.failure = { stage: receipt.stages.at(-1),
    code: typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'ISSUE417_' + profile.count + '_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate ?? '') ? { sqlstate } : {}) };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
