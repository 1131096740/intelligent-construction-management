'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { admitSource } = require('./install-only292.cjs');
const installer = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const source = require('./contract-finance-source.json');

const root = '/qualification';
const api = path.join(root, 'workspace/services/api');
const spec = 'src/contract-takeover/contract-takeover-a28.http.pg.spec.ts';
const historicalSettlement = source.mode === 'historical-settlement-334';
const count = historicalSettlement ? 334 : 333;
const profile = historicalSettlement
  ? require('./historical-settlement-334-profile.cjs') : require('./historical-takeover-333-profile.cjs');
const purpose = 'HISTORICAL_TAKEOVER_A28_' + count;
const receipt = { schemaVersion: 1, purpose, sourceSha: source.sourceSha, stages: ['INPUTS'], status: 'STOPPED' };

async function consume({ ownerUrl, database, workDir, candidateTree }) {
  assert.equal(candidateTree, source.sourceTree);
  const owner = new URL(ownerUrl);
  assert.match(database, /^jg_task01_[a-f0-9]{32}$/u);
  assert.equal(owner.protocol, 'postgresql:');
  assert.equal(owner.hostname, '127.0.0.1');
  assert.equal(owner.username, 'jg_task01_owner');
  assert.equal(owner.pathname, '/' + database);
  assert.equal(owner.searchParams.get('sslmode'), 'require');
  assert.equal(owner.searchParams.get('sslaccept'), 'strict');
  assert.equal(owner.searchParams.get('sslcert'), path.join(workDir, 'ca.crt'));

  receipt.stages.push('A28_HISTORICAL_CONTRACT_TAKEOVER_HTTP');
  const directory = fs.mkdtempSync(path.join(workDir, 'a28-'));
  const reportPath = path.join(directory, 'jest.json');
  // A28 mutates takeover tables outside the original Line A runtime grants.
  // Keep the granted roles unchanged and explicitly scope this run to the disposable owner.
  const randomSecret = () => randomBytes(32).toString('hex');
  const child = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'),
    '--runInBand', '--runTestsByPath', spec, '--json', '--outputFile=' + reportPath], {
    cwd: api, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, NODE_ENV: 'test', CI: 'true',
      RUN_CONTRACT_TAKEOVER_A28_PG16: '1', JG_NATIVE_A28_DATABASE: database, DATABASE_URL: owner.href,
      FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: path.join(directory, 'files'),
      APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false',
      FILE_DOWNLOAD_SECRET: randomSecret(), JWT_ACCESS_SECRET: randomSecret(), JWT_REFRESH_SECRET: randomSecret(),
      OPERATING_LEDGER_DB_WRITE_SECRET: randomSecret()
    }
  });
  const report = fs.existsSync(reportPath) && fs.statSync(reportPath).size <= 8 * 1024 * 1024
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const suite = report?.testResults?.[0];
  const cases = suite?.assertionResults ?? [];
  receipt.a28 = {
    databaseRole: 'isolated_fixture_owner',
    httpAuthorization: 'application_business_roles',
    enabledOperatingLedgerRelationships: ['upward'],
    passed: report?.numPassedTests ?? 0,
    skipped: report?.numPendingTests ?? 0,
    registered: report?.numTotalTests ?? 0,
    failedCases: cases.flatMap((test, index) => {
      if (test.status !== 'failed') return [];
      const message = (test.failureMessages ?? []).join('\n').replace(/\u001b\[[0-9;]*m/gu, '').slice(0, 32_768);
      const lines = [...new Set([...message.matchAll(/contract-takeover-a28\.http\.pg\.spec\.ts:(\d{1,5}):\d{1,5}/gu)]
        .map(match => Number(match[1])))].slice(0, 4);
      const activationFailure = /A28_ACTIVATION_HTTP\(([1-5]\d{2}),([\p{Script=Han}，。；：！？、]{1,96})\)/u.exec(message);
      return [{ index: index + 1, lines,
        statuses: activationFailure
          ? [201, Number(activationFailure[1])]
          : [...message.matchAll(/"status": ([1-5]\d{2})/gu)].slice(0, 2).map(match => Number(match[1])),
        ...(activationFailure ? { activationPublicMessage: activationFailure[2] } : {}) }];
    })
  };
  receipt.a28.complete = child.status === 0 && report?.success === true && report.testResults.length === 1 &&
    suite.name === path.join(api, spec) && report.numPassedTests === 3 && report.numTotalTests === 3 &&
    report.numPendingTests === 0 && cases.length === 3 && cases.every(test => test.status === 'passed');
}

async function main() {
  assert.equal(process.argv.length, 2);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  profile.assertSource(source, final);
  const installerSha256 = createHash('sha256').update(fs.readFileSync(path.join(root, 'installer.cjs'))).digest('hex');
  assert.equal(installerSha256, profile.installerSha256, 'A28_INSTALLER_RUNTIME_FINGERPRINT');
  receipt.installerSha256 = installerSha256;
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs')).loadCanonicalMigrationBaseline();
  assert.equal(baseline.expectedDirectoryCount, count);
  assert.equal(baseline.terminalMigration, profile.terminal.name);
  assert.equal(baseline.terminalMigrationChecksum, profile.terminal.sha256);
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');
  const install = historicalSettlement ? installer.withCombined334HistoricalSettlement : installer.withCombined333HistoricalTakeover;
  await install(receipt, consume, {
    sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails
  });
  assert.equal(receipt.historicalTakeoverPredecessor.ledgerSha256, profile.predecessor332);
  assert.equal(receipt.forward320.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.count, count);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  if (historicalSettlement) assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.ok(receipt.a28.complete, 'A28_333_HTTP_COVERAGE');
  receipt.status = purpose + '_PASSED';
}

main().catch(error => {
  receipt.status = 'STOPPED';
  const code = error.code ?? error.message;
  receipt.failure = { stage: receipt.stages.at(-1), code: /^[A-Z0-9_]+$/u.test(code) ? code : 'A28_333_FAILED',
    sqlstate: error.sqlstate, prismaCode: error.prismaCode };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
