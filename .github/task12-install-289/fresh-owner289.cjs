'use strict';
const path = require('node:path');
const {randomUUID} = require('node:crypto');
async function fundExecution(context,receipt,runCommand,need,equal) {
const result = await context.sql(`SELECT jsonb_build_object(
  'ownerOid',current_user::regrole::oid::text,
  'sameSession',current_user=session_user AND current_database()='${context.database}',
  'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
  'relations',ARRAY[ to_regclass('public."VerifiedBankTransactionObservation"') IS NOT NULL,
    to_regclass('public."BankTransactionClaim"') IS NOT NULL, to_regclass('public."FundExecution"') IS NOT NULL,
    to_regclass('public."ExecutionAllocationLine"') IS NOT NULL ]
);`);
const catalog = JSON.parse(result.stdout);
need(equal(catalog,{ownerOid:'10',sameSession:true,tls:true,relations:[true,true,true,true]}),
  'FUND_EXECUTION_V7_CATALOG');
const cwd = '/qualification/workspace/services/api';
const suite = 'src/fund-execution/fund-execution-service.pg.spec.ts';
const testEndpoint = new URL(context.ownerUrl);
testEndpoint.searchParams.set('connection_limit','2');
await context.sql("ALTER ROLE jg_task01_owner SET log_error_verbosity='verbose';");
const logBefore = context.readPostgresLog().length;
const output = runCommand(process.execPath,[path.join(cwd,'node_modules/jest/bin/jest.js'),
  '--runInBand','--runTestsByPath',suite,'--json'],{cwd,timeoutMs:300_000,allowFailure:true,extra:{
  DATABASE_URL:testEndpoint.toString(), NODE_ENV:'test', RUN_FUND_EXECUTION_V7_PG:'1',
  OPERATING_LEDGER_DB_WRITE_SECRET:'fund-execution-v7-pg-test-write-secret',
}});
const log = context.readPostgresLog().slice(logBefore);
const deadlock40P01 = /ERROR:\s+40P01:\s+deadlock detected/u.test(log);
const lockSessions = new Set(Array.from(log.matchAll(/Process (\d+) waits for /gu), match=>match[1])).size;
const tests = output.stdout.trim() ? JSON.parse(output.stdout) : {};
receipt.fundExecutionV7 = {suite,catalog,connectionLimit:2,deadlock40P01,lockSessions,jestExit:output.code,
  total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,skipped:tests.numPendingTests};
need(output.code === 0 && deadlock40P01 && lockSessions === 2 && tests.numTotalTestSuites === 1 && tests.numPassedTestSuites === 1 &&
  tests.numTotalTests === 26 && tests.numPassedTests === 26 && tests.numPendingTests === 0,
  'FUND_EXECUTION_V7_TEST_COVERAGE');
}
async function runFresh(freshOwner,suite,count,context,receipt,runCommand,need) {
const cwd = '/qualification/workspace/services/api';
const extra = {
  DATABASE_URL:context.ownerUrl, NODE_ENV:'test', CI:'true', [freshOwner.flag]:'1',
};
if (freshOwner.id === 'invoice_ledger_pol260') extra.JG_TASK12_INVOICE_OWNED_RUN_ID = context.runId;
let replaySeed;
if (freshOwner.replaySeed) {
  Object.assign(extra,{
    TMPDIR:context.workDir,
    FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:path.join(context.workDir,'storage','private'),
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),SEED_PASSWORD:'Local@1-'+randomUUID(),
  });
  receipt.stages.push('FRESH_OWNER_REPLAY');
  const migration = runCommand(process.execPath,[path.join(cwd,'node_modules/prisma/build/index.js'),'migrate',
    'deploy','--schema',path.join(cwd,'prisma/schema.prisma')],{cwd,timeoutMs:180_000,extra});
  need(migration.stdout.includes('No pending migrations to apply.'),'FRESH_OWNER_REPLAY');
  receipt.stages.push('FRESH_OWNER_SEED');
  runCommand(process.execPath,[path.join(cwd,'prisma/seed.cjs')],{cwd:context.workDir,timeoutMs:180_000,extra});
  replaySeed = true;
}
receipt.stages.push('FRESH_OWNER_JEST');
const output = runCommand(process.execPath,[path.join(cwd,'node_modules/jest/bin/jest.js'),
  '--runInBand','--runTestsByPath',suite,'--json'],{cwd,timeoutMs:300_000,allowFailure:true,extra});
const tests = output.stdout.trim() ? JSON.parse(output.stdout) : {};
receipt.freshOwner = {id:freshOwner.id,suite,replaySeed,jestExit:output.code,total:tests.numTotalTests,
  passed:tests.numPassedTests,failed:tests.numFailedTests,skipped:tests.numPendingTests};
need(output.code === 0 && tests.numTotalTestSuites === 1 && tests.numPassedTestSuites === 1 &&
  tests.numTotalTests === count && tests.numPassedTests === count &&
  tests.numPendingTests === 0,'FRESH_OWNER_GATE_TEST_COVERAGE');
}
module.exports = Object.freeze({
  fundExecution,
  invoice: (context,receipt,runCommand,need) => runFresh(
    {id:'invoice_ledger_pol260',flag:'RUN_INVOICE_LEDGER_POSTGRESQL16'},
    'src/invoice-ledger/invoice-ledger.postgres.spec.ts',10,context,receipt,runCommand,need),
  pol279: (context,receipt,runCommand,need) => runFresh(
    {id:'necessary_expense_reserve_pol279',flag:'RUN_POL279_NECESSARY_EXPENSE_RESERVE_PG16',replaySeed:true},
    'src/database/necessary-expense-reserve-postgresql.spec.ts',4,context,receipt,runCommand,need),
});
