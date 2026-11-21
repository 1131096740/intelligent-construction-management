'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const fixtures=require('./fixtures.json');
const api='/qualification/workspace/services/api';
const need=(ok,code)=>{if(!ok)throw new Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function verifyInputs(mode,root=api){
  const rows=mode==='cleanup'?fixtures.cleanup:mode==='profile'?[fixtures.profile]:[];
  need(rows.length>0,'REMAINING_RETAINED_EXACT_MODE');
  for(const row of rows) need(sha(fs.readFileSync(path.join(root,row.file)))===(row.postimage??row.sha256),'REMAINING_RETAINED_SPEC_BYTES');
  if(mode==='cleanup') need(sha(fs.readFileSync(path.join(root,'src/database/remaining-289-cleanup-fixture.ts')))==='b069b19848053e356e3867318e392178b56cf36ff5c552aa2d548ac46797ce5d','REMAINING_RETAINED_HELPER_BYTES');
  return rows;
}

function databaseUrl(raw,runId,workDir){
  const url=new URL(raw);
  need(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.username==='jg_task01_owner'&&
    url.pathname==='/jg_task01_'+runId.replaceAll('-','')&&url.searchParams.get('sslmode')==='require'&&
    url.searchParams.get('sslaccept')==='strict'&&url.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),
    'REMAINING_RETAINED_DATABASE_BINDING');
  url.searchParams.delete('connection_limit');
  return url;
}

async function runRetained(context,receipt,mode) {
  const rows=verifyInputs(mode);
  const {ownerUrl,runId,workDir}=context, primary=databaseUrl(ownerUrl,runId,workDir);
  const extra={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,NODE_ENV:'test',CI:'true',
    DATABASE_URL:primary.toString(),FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:path.join(workDir,'remaining-private')};
  if(mode==='cleanup'){
    need(receipt.cleanupLegacy?.count===205&&receipt.cleanupLegacy.distinctDatabase&&receipt.cleanupLegacy.samePostmaster,
      'REMAINING_PRE206_MISSING');
    const legacy=databaseUrl(context.legacyOwnerUrl,context.legacyRunId,workDir);
    need(primary.port===legacy.port&&primary.pathname!==legacy.pathname,'REMAINING_RETAINED_DUAL_PAIR');
    Object.assign(extra,{RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE:'1',CONTRACT_DRAFT_AGGREGATE_DATABASE_URL:primary.toString(),
      CONTRACT_LEGACY_CLEANUP_DATABASE_URL:legacy.toString(),JG_REMAINING_289_PRIMARY_ID:runId.replaceAll('-',''),
      JG_REMAINING_289_LEGACY_ID:context.legacyRunId.replaceAll('-',''),
      JG_REMAINING_289_CA_FILE:primary.searchParams.get('sslcert'),JG_REMAINING_289_PG_PORT:primary.port});
  }else{
    need(receipt.profileHistory?.sameInstance&&receipt.profileHistory.backfill===126,'REMAINING_PROFILE_MISSING');
    extra.RUN_PROJECT_OPERATING_PROFILE_UPGRADE='1';
  }
  receipt.stages.push('REMAINING_RETAINED_ORIGINAL_JEST');
  const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',
    ...rows.map(row=>row.file),'--json'],{cwd:api,env:extra,encoding:'utf8',timeout:12*60_000,maxBuffer:16*1024*1024});
  let report;
  try{report=JSON.parse(result.stdout);}catch{}
  const seen=(report?.testResults??[]).map(suite=>({
    file:path.relative(api,suite.name),passed:suite.assertionResults.filter(test=>test.status==='passed').length,
    skipped:suite.assertionResults.filter(test=>test.status==='pending').length,
    failed:suite.assertionResults.flatMap((test,i)=>test.status==='failed'?[i+1]:[]),
  }));
  receipt.retainedOriginal={mode,exit:result.status,seen};
  need(result.status===0&&report?.success===true&&report.numPendingTests===0&&seen.length===rows.length&&
    rows.every(expected=>seen.some(observed=>observed.file===expected.file&&observed.passed>=expected.pending&&observed.skipped===0&&!observed.failed.length)),
    'REMAINING_RETAINED_ORIGINAL_COVERAGE');
}
module.exports={runRetained,verifyInputs,databaseUrl};
