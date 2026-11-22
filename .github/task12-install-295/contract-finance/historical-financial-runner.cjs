'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const profiles=require('./historical-financial-profile.json');
const api='/qualification/workspace/services/api';

async function runSlice(context,receipt,baseline,sourceTree){
 const profile=profiles.financial;
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const {ownerUrl,runId,database,workDir}=context;
 assert.match(baseline.commit,/^[a-f0-9]{40}$/u);
 assert.match(baseline.tree,/^[a-f0-9]{40}$/u);
 assert.equal(baseline.commit,receipt.sourceSha);
 if(sourceTree!==undefined) assert.equal(baseline.tree,sourceTree);
 assert.equal(context.candidateTree,sourceTree??require('./scope.json').tree);
 receipt.candidateGitTree=baseline.tree;
 const endpoint=new URL(ownerUrl);
 assert.ok(endpoint.protocol==='postgresql:'&&endpoint.hostname==='127.0.0.1'&&endpoint.username==='jg_task01_owner'&&
   endpoint.pathname==='/'+database&&database==='jg_task01_'+runId.replaceAll('-','')&&
   endpoint.searchParams.get('sslmode')==='require'&&endpoint.searchParams.get('sslaccept')==='strict'&&
   endpoint.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),'HISTORICAL_FINANCIAL_295_IDENTITY');
 const ownerProof=await context.sql(`SELECT (current_user=session_user AND current_user='jg_task01_owner'
  AND current_user::regrole::oid=10 AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=10)
  AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text`);
 assert.equal(ownerProof.stdout.trim(),'true','HISTORICAL_FINANCIAL_295_OWNER_TLS');
 endpoint.searchParams.delete('connection_limit');
 assert.equal(sha(fs.readFileSync(path.join(api,profile.spec))),profile.sha,'HISTORICAL_FINANCIAL_295_SOURCE');
 const flags=Object.fromEntries(Object.entries(profile.flags).map(([k,v])=>[k,v==='databaseUrl'?endpoint.toString():v]));
 const reportPath=path.join(fs.mkdtempSync(path.join(workDir,'historical-jest-')),'report.json');
 receipt.candidateBaseline=baseline.commit;
 receipt.stages.push('HISTORICAL_FINANCIAL_295_ORIGINAL_JEST');
 const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',
   profile.spec,'--json','--outputFile='+reportPath],{cwd:api,encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024,
   env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,CI:'true',NODE_ENV:'test',GIT_COMMIT_SHA:baseline.commit,...flags}});
 let report;
 if(fs.existsSync(reportPath)&&fs.statSync(reportPath).size<16*1024*1024) report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 const rows=report?.testResults?.find(suite=>suite.name===path.join(api,profile.spec))?.assertionResults??[];
 const missing=profile.titles.flatMap((title,i)=>rows.filter(row=>row.title===title&&row.status==='passed').length===1?[]:[i+1]);
 const failures=rows.flatMap((row,index)=>{
  if(row.status!=='failed') return [];
  const message=row.failureMessages.join('\n');
  const frames=[...message.matchAll(/historical-financial-takeover\.pg\.spec\.ts:(\d+):(\d+)/gu)]
    .slice(0,3).map(frame=>[Number(frame[1]),Number(frame[2])]);
  const match=message.match(/expect\((?:received|promise)\)\.(?:rejects\.|resolves\.)?(toThrow|toEqual|toMatchObject|toBe)/u);
  return [{position:index+1,frames,matcher:match?.[1],timeout:/Exceeded timeout/u.test(message),
   sqlstate:/\b(42501|23514|23503|40P01|40001)\b/u.exec(message)?.[1],prismaCode:/\bP[0-9]{4}\b/u.exec(message)?.[0]}];
 });
 receipt.originalSlice={mode:'financial',expected:profile.titles.length,passed:report?.numPassedTests,skipped:report?.numPendingTests,
  exit:result.status,missing,failures};
 assert.ok(result.status===0&&report?.success&&report.testResults.length===1&&rows.length===profile.titles.length&&
  report.numPendingTests===0&&missing.length===0,'HISTORICAL_FINANCIAL_295_COVERAGE');
}
module.exports={runSlice};
