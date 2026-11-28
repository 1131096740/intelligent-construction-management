'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const profiles=require('./historical-wage-profiles.json');
const api='/qualification/workspace/services/api';

async function runHistoricalWage(context,receipt,source){
 const profile=profiles.wage;
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const {ownerUrl,runId,database,workDir}=context;
 assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
 const count=source.mode==='company-history-352'?352:source.mode==='signed-settlement-350'?350:source.mode==='expense-witness-349'?349:source.mode==='expense-witness-346'?346:source.mode==='historical-settlement-334'?334:source.mode==='upward-archive-332'?332:source.mode==='payment-remainder-331'?331:source.mode==='text-direct-330'?330:source.mode==='current-320'?329:295;
 assert.equal(source.migrationCount,count);
 if(count!==295) assert.equal(context.candidateTree,source.sourceTree);
 assert.equal(receipt.installOnly295.count,295);
 assert.equal(receipt.installOnly295.sameIdentity,true);
 assert.equal(receipt.installOnly295.ledgerSha256,count!==295?source.predecessor.ledgerSha256:source.ledgerSha256);
 const endpoint=new URL(ownerUrl);
 assert.ok(endpoint.protocol==='postgresql:'&&endpoint.hostname==='127.0.0.1'&&endpoint.username==='jg_task01_owner'&&
   endpoint.pathname==='/'+database&&database==='jg_task01_'+runId.replaceAll('-','')&&
   endpoint.searchParams.get('sslmode')==='require'&&endpoint.searchParams.get('sslaccept')==='strict'&&
   endpoint.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),'HISTORICAL_WAGE_295_IDENTITY');
 const ownerProof=await context.sql(`SELECT (current_user=session_user AND current_user='jg_task01_owner'
  AND current_user::regrole::oid=10 AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=10)
  AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text`);
 assert.equal(ownerProof.stdout.trim(),'true','HISTORICAL_WAGE_295_OWNER_TLS');
 endpoint.searchParams.delete('connection_limit');
 assert.equal(sha(fs.readFileSync(path.join(api,profile.spec))),profile.diagnosticOverlaySha,'HISTORICAL_WAGE_295_SOURCE');
 const flags=Object.fromEntries(Object.entries(profile.flags).map(([k,v])=>[k,v==='databaseUrl'?endpoint.toString():v]));
 const reportPath=path.join(fs.mkdtempSync(path.join(workDir,'historical-jest-')),'report.json');
 receipt.candidateBaseline=source.sourceSha;
 receipt.diagnosticOverlay={scope:'SEQUENTIAL_READBACK_ONLY',originalSpecSha256:profile.sha,
  executedSpecSha256:profile.diagnosticOverlaySha};
 receipt.stages.push('HISTORICAL_WAGE_295_ORIGINAL_JEST');
 const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',
   profile.spec,'--json','--outputFile='+reportPath],{cwd:api,encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024,
   env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,CI:'true',NODE_ENV:'test',GIT_COMMIT_SHA:source.sourceSha,...flags}});
 let report;
 if(fs.existsSync(reportPath)&&fs.statSync(reportPath).size<16*1024*1024) report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 const rows=report?.testResults?.find(suite=>suite.name===path.join(api,profile.spec))?.assertionResults??[];
 const missing=profile.titles.flatMap((title,i)=>rows.filter(row=>row.title===title&&row.status==='passed').length===1?[]:[i+1]);
 const failures=require('./wage-observation.cjs').observeWageFailures(rows);
 receipt.originalSlice={mode:'wage',expected:profile.titles.length,passed:report?.numPassedTests,skipped:report?.numPendingTests,
  exit:result.status,missing,failures};
 assert.ok(result.status===0&&report?.success&&report.testResults.length===1&&rows.length===profile.titles.length&&
  report.numPendingTests===0&&missing.length===0,'HISTORICAL_WAGE_295_COVERAGE');
}
module.exports={runHistoricalWage};
