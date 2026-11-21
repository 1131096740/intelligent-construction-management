'use strict';
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {expectedLedger}=require('./successor.cjs');
const profiles=require('./profiles.json');
const workspace='/qualification/workspace';
const api=join(workspace,'services/api');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function runExpenseApp(lane,context,receipt,runCommand) {
  assert.ok(Object.hasOwn(profiles,lane));
  const config=profiles[lane];
  const endpoint=new URL(context.ownerUrl);
  assert.equal(endpoint.protocol,'postgresql:');
  assert.equal(endpoint.hostname,'127.0.0.1');
  assert.equal(endpoint.username,'jg_task01_owner');
  assert.equal(endpoint.pathname,'/'+context.database);
  assert.equal(context.database,'jg_task01_'+context.runId.replaceAll('-',''));
  assert.equal(endpoint.searchParams.get('sslmode'),'require');
  assert.equal(endpoint.searchParams.get('sslaccept'),'strict');
  assert.equal(endpoint.searchParams.get('sslcert'),join(context.workDir,'ca.crt'));
  const spec=join('src/database',config.spec);
  assert.equal(digest(readFileSync(join(api,spec))),config.sha256,'EXPENSE_290_TEST_SOURCE');
  const state=JSON.parse((await context.sql(`SELECT jsonb_build_object(
    'role', current_user, 'sameSession', current_user=session_user,
    'ownerOid', (SELECT datdba::integer FROM pg_database WHERE datname=current_database()),
    'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
    'database',current_database(),
    'ledger', (SELECT json_agg(row_to_json(r) ORDER BY name) FROM (
      SELECT migration_name AS name, checksum AS sha256, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS "rolledBack" FROM public._prisma_migrations) r)
  )`)).stdout);
  assert.equal(state.role,'jg_task01_owner');
  assert.equal(state.sameSession,true);
  assert.equal(state.ownerOid,10);
  assert.equal(state.tls,true);
  assert.equal(state.database,context.database);
  assert.equal(state.ledger.length,290);
  assert.deepEqual(state.ledger,expectedLedger(state.ledger.slice(0,-1)));
  const extra={COREPACK_HOME:'/opt/corepack',COREPACK_DEFAULT_TO_LATEST:'0',COREPACK_ENABLE_NETWORK:'0',
    NODE_ENV:'test',CI:'true',DATABASE_URL:context.ownerUrl,[config.runIdKey]:context.runId.replaceAll('-',''),
    [config.runFlag]:'1'};
  const invoke=['--dir',workspace,'--filter','@jiangkong/api','exec'];
  if (lane !== 'execution') {
    receipt.stages.push('EXPENSE_290_MIGRATION_NOOP');
    const result=runCommand('pnpm',[...invoke,'prisma','migrate','deploy'],{cwd:workspace,extra,timeoutMs:180_000});
    assert.match(result.stdout,/No pending migrations to apply\./u);
  }
  receipt.stages.push('EXPENSE_290_MIGRATION_STATUS');
  const status=runCommand('pnpm',[...invoke,'prisma','migrate','status'],{cwd:workspace,extra,timeoutMs:180_000});
  assert.match(status.stdout,/Database schema is up to date/u);
  receipt.stages.push('EXPENSE_290_ORIGINAL_JEST');
  const run=runCommand('pnpm',[...invoke,'jest','--runInBand','--runTestsByPath',spec,'--json'],
    {cwd:workspace,extra,timeoutMs:lane==='receipt'?180_000:900_000,allowFailure:true});
  const summary=run.stdout.split('\n').find(line=>line.startsWith('{"numFailedTestSuites":'));
  const result=summary?JSON.parse(summary):{};
  receipt.expenseApp={lane,role:state.role,tls:true,exit:run.code,passed:result.numPassedTests,
    failed:result.numFailedTests,skipped:result.numPendingTests,total:result.numTotalTests,
    failedCases:result.testResults?.flatMap(suite=>suite.assertionResults.filter(test=>test.status==='failed').map(test=>({
      title:test.title,
      prismaCodes:[...new Set((test.failureMessages??[]).join(' ').match(/\bP[0-9]{4}\b/gu)??[])],
      frames:[...(test.failureMessages??[]).join(' ').matchAll(/project-expense-(?:execution|finance|receipt)-concurrency(?:\.owned282)?\.spec\.ts:(\d+):(\d+)/gu)].slice(0,5).map(m=>[Number(m[1]),Number(m[2])]),
    })))};
  assert.equal(run.code,0,'EXPENSE_290_JEST_EXIT');
  assert.equal(result.testResults?.length,1);
  assert.equal(result.testResults?.[0]?.name,join(api,spec));
  assert.equal(result.numTotalTests,1);
  assert.equal(result.numPassedTests,1);
  assert.equal(result.numFailedTests,0);
  assert.equal(result.numPendingTests,0);
}
module.exports={runExpenseApp};
