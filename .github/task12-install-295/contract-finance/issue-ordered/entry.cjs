'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const { admitSource } = require('./install-only292.cjs');
const { withCombined334HistoricalSettlement, withCombinedExpenseWitness, withCombinedExpenseWitness349 } = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const historical = require('./historical-settlement-334-profile.cjs');
const source = require('./contract-finance-source.json');

const root = '/qualification';
const api = path.join(root, 'workspace/services/api');
const { profileFor } = require('./issue-ordered-profiles.cjs');
const scope = process.argv[2];
const profile = profileFor(scope);
const { file, titles } = profile;
const precision = source.mode === 'expense-witness-349';
const combined = precision || source.mode === 'expense-witness-346';
const expenseWitness = combined ? require('./expense-witness-346-profile.cjs') : null;
const ledgerProfile = precision ? require('./expense-witness-349-profile.cjs') : expenseWitness ?? historical;
const purpose = scope.toUpperCase() + '_ORIGINAL_' + source.migrationCount;
const receipt = { schemaVersion: 1, purpose, sourceSha: source.sourceSha,
  stages: ['INPUTS'], status: 'STOPPED' };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function summarizeFirstFailure(file, test, detailed = false) {
  const diagnostic = stripVTControlCharacters((test.failureMessages ?? []).join('\n'));
  const codes = [...diagnostic.matchAll(
    /\b(P\d{4})\b|\b(?:SQLSTATE|[Cc]ode:)\s*[`"']?([0-9][0-9A-Z]{4})\b/gu
  )].map(match => match[1] ?? match[2]);
  const statusPair = diagnostic.match(/Expected:\s*([1-5]\d{2})\s+Received:\s*([1-5]\d{2})\b/u);
  const location = diagnostic.split('\n').find(line => line.includes(file + ':') && line.trimStart().startsWith('at '));
  const line = location?.split(file + ':')[1]?.match(/^\d{1,5}(?=:)/u)?.[0];
  let kind = /ISOLATED_DATABASE_REQUIRED/u.test(diagnostic) ? 'ISOLATED_DATABASE_REQUIRED' :
    /PrismaClientInitializationError/u.test(diagnostic) ? 'PRISMA_INITIALIZATION' :
    /PrismaClientKnownRequestError/u.test(diagnostic) ? 'PRISMA_REQUEST' :
    /PrismaClientUnknownRequestError/u.test(diagnostic) ? 'PRISMA_UNKNOWN_REQUEST' :
    /Cannot find module/u.test(diagnostic) ? 'MODULE_NOT_FOUND' : undefined;
  const constraint = diagnostic.match(/\bconstraint\s+\\?"([A-Za-z_][A-Za-z0-9_]{0,80})\\?"/u)?.[1];
  const postgres = diagnostic.match(/PostgresError \{ code: "([A-Z0-9]{5})", message: ("(?:[^"\\\n]|\\.){1,600}"), severity:/u);
  const serverMessageSha256 = postgres && sha256(postgres[2]);
  const timeout = detailed && diagnostic.match(/^Error: thrown: "Exceeded timeout of (\d{1,6}) ms for a test\./u)?.[1];
  if (detailed && !kind) {
    kind = timeout ? 'JEST_TIMEOUT' :
      /^Error: expect\(/u.test(diagnostic) ? 'JEST_ASSERTION' :
      /^BadRequestException:/u.test(diagnostic) ? 'NEST_BAD_REQUEST' :
      /^ConflictException:/u.test(diagnostic) ? 'NEST_CONFLICT' :
      /^ForbiddenException:/u.test(diagnostic) ? 'NEST_FORBIDDEN' :
      /^NotFoundException:/u.test(diagnostic) ? 'NEST_NOT_FOUND' :
      'UNCLASSIFIED';
  }
  return { codes: [...new Set(codes)].slice(0, 6),
    ...(kind && { kind }), ...(line && { line: Number(line) }),
    ...(timeout && { timeoutMilliseconds: Number(timeout) }),
    ...(detailed && Number.isSafeInteger(test.duration) && test.duration >= 0 && { durationMilliseconds: test.duration }),
    ...(constraint && { constraint }),
    ...(serverMessageSha256 && { serverMessageSha256 }),
    ...(statusPair && { expectedStatus: Number(statusPair[1]), receivedStatus: Number(statusPair[2]) }) };
}

async function consume({ ownerUrl, database, runId, workDir, candidateTree, sql }) {
  assert.equal(candidateTree, source.sourceTree);
  assert.equal(database, 'jg_task01_' + runId.replaceAll('-', ''));
  const url = new URL(ownerUrl);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'jg_task01_owner');
  assert.equal(url.pathname, '/' + database);
  assert.deepEqual(url.searchParams.getAll('sslmode'), ['require']);
  assert.deepEqual(url.searchParams.getAll('sslaccept'), ['strict']);
  assert.deepEqual(url.searchParams.getAll('sslcert'), [path.join(workDir, 'ca.crt')]);
  historical.assertFinanceInstallation(receipt, combined ? { ...source, tails: source.tails.slice(0, 39) } : source);
  if (combined) {
    assert.equal(receipt.expenseWitnessForward.count, expenseWitness.count);
    assert.equal(receipt.expenseWitnessForward.ledgerSha256, expenseWitness.ledgerSha256);
    assert.equal(receipt.expenseWitnessForward.sameIdentity, true);
  }
  if (precision) {
    assert.equal(receipt.expenseWitnessPrecisionForward.count, ledgerProfile.count);
    assert.equal(receipt.expenseWitnessPrecisionForward.ledgerSha256, ledgerProfile.ledgerSha256);
    assert.equal(receipt.expenseWitnessPrecisionForward.sameIdentity, true);
  }
  const { stdout } = await sql(`SELECT (
    current_database() = '${database}' AND current_user = session_user AND current_user = 'jg_task01_owner' AND
    current_user::regrole::oid = 10 AND EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10) AND
    current_setting('server_version_num')::int BETWEEN 160000 AND 169999 AND inet_server_port() = ${Number(url.port)} AND
    host(inet_client_addr()) = '127.0.0.1' AND host(inet_server_addr()) = '127.0.0.1' AND
    EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  )::text;`);
  assert.equal(stdout.trim(), 'true', 'ISSUE_ORDERED_ISOLATED_OWNER_TLS');
  receipt.isolatedFixtureOwnerVerified = true;
  const work = fs.mkdtempSync(path.join(workDir, scope + '-'));
  const reportFile = path.join(work, 'jest.json');
  const secret = () => randomBytes(32).toString('hex');
  receipt.stages.push(profile.stage);
  const writeSecret = profile.requiresOperatingLedgerWriteSecret ? secret() : undefined;
  if (precision && writeSecret) {
    await sql(`INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, public.crypt('${writeSecret}', public.gen_salt('bf')));`);
  }
  const child = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'),
    '--runInBand', '--runTestsByPath', file, '--json', '--outputFile', reportFile], {
    cwd: api, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir,
      NODE_ENV: 'test', CI: 'true', DATABASE_URL: ownerUrl, [profile.orderedDatabaseKey]: database,
      [profile.enableKey]: '1',
      ...(profile.databaseUrlKey && { [profile.databaseUrlKey]: ownerUrl }),
      ...(writeSecret && { OPERATING_LEDGER_DB_WRITE_SECRET: writeSecret }),
      FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: path.join(work, 'files'),
      FILE_DOWNLOAD_SECRET: secret(), JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(),
      APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false' }
  });
  const report = fs.existsSync(reportFile) && fs.statSync(reportFile).size <= 8 * 1024 * 1024
    ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  const rows = report?.testResults?.[0]?.assertionResults ?? [];
  const counts = { registered: report?.numTotalTests, passed: report?.numPassedTests,
    skipped: report?.numPendingTests, processExit: child.status };
  receipt.suite = { ...counts, titles: rows.map(row => ({ title: row.title, status: row.status })),
    complete: child.status === 0 && !child.error && !child.signal && report?.success === true &&
      report?.testResults?.length === 1 && report.testResults[0].name === path.join(api, file) &&
      counts.registered === titles.length && counts.passed === titles.length && counts.skipped === 0 &&
      rows.length === titles.length && rows.every((row, index) => row.title === titles[index] && row.status === 'passed') };
  const firstFailed = rows.find(row => row.status === 'failed');
  if (firstFailed) receipt.suite.firstFailure = summarizeFirstFailure(file, firstFailed);
  if (scope === 'issue404' || scope === 'issue404_349') {
    const failedCases = rows.slice(0, titles.length).flatMap((row, index) =>
      row.status === 'failed' ? [{ index, ...summarizeFirstFailure(file, row, true) }] : []);
    if (failedCases.length) receipt.suite.failedCases = failedCases;
  }
}

async function main() {
  assert.equal(process.argv.length, 3);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(source.migrationCount, profile.requiredMigrationCount ?? 334,
    'ISSUE_ORDERED_MIGRATION_SCOPE');
  ledgerProfile.assertSource(source, final);
  if (combined) {
    const required = source.tails[profile.requiredMigrationCount - 296];
    assert.equal(required?.name, profile.requiredTerminalMigration);
    assert.equal(required?.sha256, profile.requiredTerminalMigrationSha256);
  }
  assert.equal(sha256(fs.readFileSync(path.join(root, 'installer.cjs'))), ledgerProfile.installerSha256);
  assert.equal(sha256(fs.readFileSync(path.join(api, file))),
    profile.fixtureDigest ?? profile.sourceDigest);
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs'));
  if (combined) ledgerProfile.assertRuntimeBaseline(baseline);
  else {
    const schema = baseline.loadCanonicalMigrationBaseline();
    assert.equal(schema.expectedDirectoryCount, 334);
    assert.equal(schema.terminalMigration, historical.terminal.name);
    assert.equal(schema.terminalMigrationChecksum, historical.terminal.sha256);
  }
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');
  const material = { sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails };
  if (precision) {
    await withCombinedExpenseWitness349(receipt, consume, { ...source, ...material });
    assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness, true);
  } else if (combined) {
    await withCombinedExpenseWitness(receipt, consume, material, ledgerProfile.count);
  } else {
    await withCombined334HistoricalSettlement(receipt, consume, material);
  }
  if (combined) assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.combinedAfterBusiness.count, source.migrationCount);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.equal(receipt.suite?.complete, true, 'ISSUE_ORDERED_ORIGINAL_COVERAGE');
  receipt.status = purpose + '_PASSED';
}
main().catch(error => {
  receipt.failure = { stage: receipt.stages.at(-1),
    code: /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'ISSUE_ORDERED_FAILED',
    sqlstate: error.sqlstate, prismaCode: error.prismaCode };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
