'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const { admitSource } = require('./install-only292.cjs');
const { withCombined334HistoricalSettlement, withCombinedExpenseWitness } = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const historical = require('./historical-settlement-334-profile.cjs');
const { stageWebWorkspace } = require('./task12-pol109-stage-browser.cjs');
const { pol115Scope, verifyJestCoverage } = require('./verify-pol115-jest.cjs');
const { summarizeBrowserWitness } = require('./browser-witness.cjs');
const recipes = require('./pol115-334-cases.json');
const inputs = require('./pol115-334-inputs.json');
const source = require('./contract-finance-source.json');
const expenseWitness = source.mode === 'expense-witness-346' ? require('./expense-witness-346-profile.cjs') : null;
const profile = expenseWitness ?? historical;

const root = '/qualification';
const workspace = path.join(root, 'workspace');
const api = path.join(workspace, 'services/api');
const scope = process.argv[2];
const selected = pol115Scope(recipes, scope);
const receipt = { schemaVersion: 1, purpose: 'ORIGINAL_POL115_SPOT_' + source.migrationCount, sourceSha: source.sourceSha, scope,
  stages: ['INPUTS'], status: 'STOPPED' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const browserFailurePatterns = {
  BROWSER_BINARY_MISSING: /Executable doesn't exist at|command to download new browsers/iu,
  BROWSER_HOST_DEPS: /Host system is missing dependencies|error while loading shared libraries/iu,
  BROWSER_LAUNCH_FAILED: /browserType\.launch:|Failed to launch (?:the )?browser process/iu,
  BROWSER_SANDBOX: /No usable sandbox|SUID sandbox|Failed to move to new namespace/iu,
  VITE_WEBSERVER_STARTUP: /Process from config\.webServer (?:was not able to start|exited)|waiting for config\.webServer/iu,
  VITE_BIND: /port 4215 is already in use|listen EADDRINUSE/iu,
  VITE_IMPORT: /failed to load config from|Failed to resolve import|failed to resolve entry for package/iu,
  BROWSER_TOOL_LOOKUP: /Command "playwright" not found|corepack.*(?:not found|network|download)|Cannot find module '[^'\r\n]*@playwright\/test\/cli\.js'/iu,
  BROWSER_TEST_TIMEOUT: /Test timeout of \d+ms exceeded|Timeout \d+ms exceeded/iu
};

function browserProcessFailure(messages) {
  const marker = messages.match(/POL115_BROWSER_FAILURE (\{[^\r\n]{1,240}\})/u)?.[1];
  if (!marker) return undefined;
  try {
    const { phase, exitCode, signal, spawnCode } = JSON.parse(marker);
    if (!['spawn', 'exit'].includes(phase)) return undefined;
    return {
      phase,
      exitCode: Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null,
      signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'OTHER'].includes(signal) ? signal : null,
      spawnCode: ['ENOENT', 'EACCES', 'EPERM', 'EAGAIN', 'ENOMEM', 'OTHER'].includes(spawnCode) ? spawnCode : null
    };
  } catch {
    return undefined;
  }
}

function summarizeFailedAssertion(file, test) {
  const messages = stripVTControlCharacters((test.failureMessages ?? []).join('\n'));
  const statusPair = messages.match(/Expected:\s*([1-5]\d{2})\s+Received:\s*([1-5]\d{2})\b/u);
  const location = messages.split('\n').find(line => line.includes(file + ':') && line.trimStart().startsWith('at '));
  const line = location?.split(file + ':')[1]?.match(/^\d{1,5}(?=:)/u)?.[0];
  const browser = browserProcessFailure(messages);
  const jestTimeout = messages.match(/Exceeded timeout of (\d{1,6}) ms for a test\b/u)?.[1];
  return {
    file, titleSha256: sha256(test.fullName),
    codes: [...new Set(messages.match(/\bP[0-9]{4}\b/gu) ?? [])].slice(0, 4),
    ...(statusPair && { expectedStatus: Number(statusPair[1]), receivedStatus: Number(statusPair[2]) }),
    ...(line && { line: Number(line) }),
    ...(jestTimeout && { jestTimeoutMs: Number(jestTimeout) }),
    ...(browser && { browser })
  };
}

function prepareBrowser(workDir) {
  const side = stageWebWorkspace(workDir);
  const browser = path.join(workDir, 'apps/web-admin');
  const shared = path.join(workDir, 'packages/shared-domain');
  fs.mkdirSync(path.dirname(browser));
  fs.renameSync(side, browser);
  for (const dir of ['scripts', 'apps/web-admin/e2e/support', 'packages/shared-domain']) {
    fs.mkdirSync(path.join(workDir, dir), { recursive: true, mode: 0o700 });
  }
  const copy = file => fs.copyFileSync(path.join(workspace, file), path.join(workDir, file), fs.constants.COPYFILE_EXCL);
  for (const file of [
    'package.json', 'pnpm-workspace.yaml', 'scripts/pnpm-workspace.mjs',
    'packages/shared-domain/package.json', 'packages/shared-domain/tsconfig.json',
    'apps/web-admin/playwright.pol115-real.config.ts', 'apps/web-admin/e2e/support/playwright-navigation.ts',
    ...['pol115-expense-real', 'expense-self-service-real', 'draft-deletion-real', 'operating-takeover-real',
      'pol115-fund-real', 'pol115-spot-procurement-real'].map(name => 'apps/web-admin/e2e/' + name + '.e2e.ts')
  ]) copy(file);
  const browserConfig = path.join(browser, 'playwright.pol115-real.config.ts');
  const config = fs.readFileSync(browserConfig, 'utf8');
  const lineReporter = 'reporter: "line",';
  assert.equal(config.split(lineReporter).length, 2, 'POL115_BROWSER_REPORTER_ANCHOR');
  const witness = JSON.stringify(path.join(root, 'browser-witness.cjs'));
  fs.writeFileSync(browserConfig, config.replace(lineReporter, `reporter: [["line"], [${witness}]],`));
  fs.cpSync(path.join(workspace, 'packages/shared-domain/src'), path.join(shared, 'src'),
    { recursive: true, force: false, errorOnExist: true });
  // pnpm's executable shims resolve the virtual store relative to the staged workspace.
  fs.mkdirSync(path.join(workDir, 'node_modules'));
  fs.symlinkSync(path.join(workspace, 'node_modules/.pnpm'), path.join(workDir, 'node_modules/.pnpm'));
  fs.symlinkSync(path.join(workspace, 'packages/shared-domain/node_modules'), path.join(shared, 'node_modules'));
  fs.symlinkSync(path.join(workspace, 'apps/web-admin/node_modules/.bin'), path.join(browser, 'node_modules/.bin'));
  const alias = path.join(browser, 'node_modules/@jiangkong');
  fs.unlinkSync(alias);
  fs.mkdirSync(alias);
  fs.symlinkSync(shared, path.join(alias, 'shared-domain'));
  return browser;
}

async function runOriginal(context) {
  const { ownerUrl, runId, database, workDir } = context;
  assert.equal(context.candidateTree, source.sourceTree);
  assert.equal(database, 'jg_task01_' + runId.replaceAll('-', ''));
  const url = new URL(ownerUrl);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'jg_task01_owner');
  assert.equal(url.pathname, '/' + database);
  assert.equal(url.searchParams.getAll('sslmode').join(','), 'require');
  assert.equal(url.searchParams.getAll('sslaccept').join(','), 'strict');
  assert.equal(url.searchParams.getAll('sslcert').join(','), path.join(workDir, 'ca.crt'));
  historical.assertFinanceInstallation(receipt, expenseWitness ? { ...source, tails: source.tails.slice(0, 39) } : source);
  if (expenseWitness) {
    assert.equal(receipt.expenseWitnessForward.count, expenseWitness.count);
    assert.equal(receipt.expenseWitnessForward.ledgerSha256, expenseWitness.ledgerSha256);
    assert.equal(receipt.expenseWitnessForward.sameIdentity, true);
  }

  const { stdout } = await context.sql(`SELECT (current_user=session_user AND
    current_user='jg_task01_owner' AND current_user::regrole::oid=10 AND
    EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10) AND
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text;`);
  assert.equal(stdout.trim(), 'true', 'POL115_334_OWNER_TLS');
  receipt.ownerIdentityVerified = true;
  const roleInventory = "SELECT jsonb_agg(to_jsonb(r) - 'rolpassword' ORDER BY r.rolname) FROM pg_roles r;";
  const rolesBefore = (await context.sql(roleInventory)).stdout;
  url.searchParams.delete('connection_limit');

  const browser = scope === 'notification' ? null : prepareBrowser(workDir);
  const files = path.join(workDir, 'pol115-files');
  const cache = path.join(workDir, 'pol115-cache');
  fs.mkdirSync(files, { mode: 0o700 });
  fs.mkdirSync(cache, { mode: 0o700 });
  const reportFile = path.join(workDir, 'pol115-jest-report.json');
  receipt.stages.push('ORIGINAL_PUBLIC_JEST');
  const result = spawnSync(process.execPath, [
    path.join(api, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath',
    ...selected.map(row => row.file), '--json', '--outputFile', reportFile
  ], { cwd: api, encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, XDG_CACHE_HOME: cache,
      NODE_ENV: 'test', CI: 'true', COREPACK_HOME: '/opt/corepack', COREPACK_ENABLE_NETWORK: '0',
      DATABASE_URL: url.href,
      [scope === 'spot' ? 'RUN_POL115_SPOT_ENTRY_PG16' : 'RUN_POL115_ENTRY_PG16']: '1',
      ...(browser && { PLAYWRIGHT_BROWSERS_PATH: '/opt/jg-playwright', RUN_POL115_BROWSER: '1', JG_POL115_334_WEB_ROOT: browser }),
      APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false',
      JG_POL115_334_SCOPE: scope, JG_POL115_334_RUN_ID: runId.replaceAll('-', ''),
      FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: files, FILE_DOWNLOAD_SECRET: randomUUID(),
      JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID(), OPERATING_LEDGER_DB_WRITE_SECRET: randomUUID() }
  });
  assert.equal((await context.sql(roleInventory)).stdout, rolesBefore, 'POL115_334_TEMPORARY_ROLES');
  receipt.rolesPreserved = true;
  const report = fs.existsSync(reportFile) && fs.statSync(reportFile).size <= 32 * 1024 * 1024
    ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  if (result.status !== 0 || result.error || result.signal || !report?.success) {
    receipt.jest = { exit: result.status, registered: report?.numTotalTests, passed: report?.numPassedTests,
      skipped: report?.numPendingTests, failed: (report?.testResults ?? []).flatMap(suite =>
        suite.assertionResults.filter(test => test.status === 'failed')
          .map(test => summarizeFailedAssertion(path.relative(api, suite.name), test))).slice(0, 8) };
    const childOutput = stripVTControlCharacters((result.stdout ?? '') + '\n' + (result.stderr ?? ''));
    const browserWitness = summarizeBrowserWitness(childOutput);
    if (browserWitness) receipt.jest.browserWitness = browserWitness;
    if (browserWitness || receipt.jest.failed.some(test => test.browser)) {
      receipt.jest.browserFailureLabels = Object.entries(browserFailurePatterns)
        .filter(([, pattern]) => pattern.test(childOutput)).map(([label]) => label);
    }
    return;
  }
  try {
    receipt.jest = { exit: result.status, files: verifyJestCoverage(report, selected, api) };
  } catch (error) {
    receipt.jest = { exit: result.status, coverageError: error.message.split("\n")[0] };
  }
}

async function main() {
  assert.equal(process.argv.length, 3);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(inputs.scope, scope);
  assert.equal(inputs.sourceSha, source.sourceSha);
  assert.equal(inputs.sourceTree, source.sourceTree);
  assert.equal(inputs.ledgerSha256, source.ledgerSha256);
  profile.assertSource(source, final);
  assert.equal(inputs.installerSha256, profile.installerSha256);
  assert.equal(sha256(fs.readFileSync(path.join(root, 'installer.cjs'))), profile.installerSha256);
  const expectedFiles = ['src/database/pol115-owned-334.test-support.ts', ...selected.map(row => row.file)];
  assert.deepEqual(Object.keys(inputs.fixtureSha256), expectedFiles);
  for (const [file, digest] of Object.entries(inputs.fixtureSha256)) {
    assert.equal(sha256(fs.readFileSync(path.join(api, file))), digest, 'POL115_334_FIXTURE_DIGEST');
  }
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs'));
  if (expenseWitness) expenseWitness.assertRuntimeBaseline(baseline);
  else {
    const admitted = baseline.loadCanonicalMigrationBaseline();
    assert.equal(admitted.expectedDirectoryCount, 334);
    assert.equal(admitted.terminalMigration, historical.terminal.name);
    assert.equal(admitted.terminalMigrationChecksum, historical.terminal.sha256);
  }
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');

  const material = { sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails };
  if (expenseWitness) {
    await withCombinedExpenseWitness(receipt, runOriginal, material, expenseWitness.count);
    assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  } else {
    await withCombined334HistoricalSettlement(receipt, runOriginal, material);
  }
  assert.equal(receipt.combinedAfterBusiness.count, source.migrationCount);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.ok(receipt.ownerIdentityVerified && receipt.rolesPreserved, 'POL115_334_ROLE_CONTINUITY');
  assert.ok(receipt.jest?.files && receipt.jest.exit === 0, 'POL115_334_ORIGINAL_JEST');
  const passed = receipt.jest.files.reduce((sum, row) => sum + row.passed, 0);
  assert.equal(passed, inputs.currentCases);
  receipt.coverage = { declared: inputs.declared, currentPassed: passed, independentSmsCounted: 0 };
  receipt.status = 'POL115_' + source.migrationCount + '_ORIGINAL_' + scope.toUpperCase() + '_PASSED';
}

main().catch(error => {
  receipt.failure = { stage: receipt.stages.at(-1), code: /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'POL115_334_FAILED',
    sqlstate: error.sqlstate, prismaCode: error.prismaCode };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
