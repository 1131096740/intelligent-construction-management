'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const profiles = require('./remaining-owner-modes.json');
const api = '/qualification/workspace/services/api';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function mode(lane) {
  assert.ok(Object.hasOwn(profiles,lane),'REMAINING_OWNER_289_MODE');
  return profiles[lane];
}

function collectMounts(lane, product) {
  const profile = mode(lane);
  const rows=[];
  for(const [file,value] of Object.entries(profile.files)){
    const source=path.join(__dirname,'remaining-fixtures',file);
    assert.equal(hash(source),value.sha,'REMAINING_OWNER_289_SOURCE');
    rows.push([source,file]);
  }
  for(const [migration,expected] of Object.entries(profile.sql)){
    const file='prisma/migrations/'+migration+'/migration.sql';
    const source=path.join(product,'services/api',file);
    assert.equal(hash(source),expected,'REMAINING_OWNER_289_SQL');
    rows.push([source,file]);
  }
  return rows;
}

async function consume(context, receipt, lane) {
  const profile=mode(lane);
  const {ownerUrl,workDir,runId,database}=context;
  const endpoint=new URL(ownerUrl);
  const compact=runId.replaceAll('-','');
  assert.ok(endpoint.protocol==='postgresql:' && endpoint.hostname==='127.0.0.1' &&
    endpoint.username==='jg_task01_owner' && endpoint.pathname==='/'+database &&
    database==='jg_task01_'+compact && endpoint.searchParams.get('sslmode')==='require' &&
    endpoint.searchParams.get('sslaccept')==='strict' &&
    endpoint.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),'REMAINING_OWNER_289_IDENTITY');
  const proof=await context.sql(`SELECT (current_user=session_user AND current_user='jg_task01_owner'
    AND current_user::regrole::oid=10 AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=10)
    AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text`);
  assert.equal(proof.stdout.trim(),'true','REMAINING_OWNER_289_TLS');
  const files=Object.entries(profile.files);
  for(const [file,value] of files) assert.equal(hash(path.join(api,file)),value.sha,'REMAINING_OWNER_289_SOURCE');
  for(const [migration,expected] of Object.entries(profile.sql)){
    assert.equal(hash(path.join(api,'prisma/migrations',migration,'migration.sql')),expected,'REMAINING_OWNER_289_SQL');
  }
  if(lane==='operating-ledger'){
    const roles=await context.sql(`SELECT (count(*)=2 AND bool_and(NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls))
       FROM pg_catalog.pg_roles WHERE rolname IN ('jg_pol275_owner','jg_pol275_runtime')`);
    assert.equal(roles.stdout.trim(),'t','REMAINING_OWNER_289_POL275_ROLES');
  }
  if(profile.pool==='default') endpoint.searchParams.delete('connection_limit');
  else if(profile.pool) endpoint.searchParams.set('connection_limit',profile.pool);
  const url=endpoint.toString();
  const flags=Object.fromEntries(Object.entries(profile.flags).map(([k,v])=>[k,v==='url'?url:v==='run'?compact:v]));
  const reportFile=path.join(fs.mkdtempSync(path.join(workDir,'remaining-owner-')),'jest.json');
  receipt.stages.push('REMAINING_OWNER_289_ORIGINAL_JEST');
  const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',
    ...files.map(([file])=>file),'--json','--outputFile='+reportFile],{cwd:api,encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,NODE_ENV:'test',CI:'true',...flags,
      ...(profile.secret?{OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID()}:{})}});
  const report=fs.existsSync(reportFile)&&fs.statSync(reportFile).size<=16*1024*1024?JSON.parse(fs.readFileSync(reportFile,'utf8')):null;
  const suites=files.map(([file,value])=>{
    const rows=report?.testResults?.find(row=>row.name===path.join(api,file))?.assertionResults??[];
    return {file,expected:value.count,total:rows.length,passed:rows.filter(row=>row.status==='passed').length,
      exactTitles:!value.titles||value.titles.every(title=>rows.filter(row=>row.title===title&&row.status==='passed').length===1)};
  });
  receipt.originalScope={lane,suites,skipped:report?.numPendingTests,exit:result.status};
  assert.ok(result.status===0&&report?.success&&report.numPendingTests===0&&report.testResults.length===files.length&&
    suites.every(row=>row.total===row.expected&&row.passed===row.expected&&row.exactTitles),'REMAINING_OWNER_289_COVERAGE');
}

if(require.main===module){
  if(process.argv[2]==='--mounts'){
    assert.equal(process.argv.length,5);
    for(const row of collectMounts(process.argv[3],process.argv[4])) console.log(row.join('\t'));
  } else {
    assert.equal(process.argv.length,3);
    const lane=process.argv[2];
    mode(lane);
    const receipt={schemaVersion:1,lane,business:'NOT_ENTERED',stages:[]};
    require('./installer.cjs').withOutside289RemainingOwner(receipt,lane).then(()=>{
      assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
      assert.equal(receipt.business,'CALLBACK_COMPLETED');
      assert.equal(receipt.sameInstancePostConsume,true);
      assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
      console.log(JSON.stringify({...receipt,status:'REMAINING_OWNER_289_PASSED'}));
    }).catch(error=>{
      const code=error.code??error.message;
      const stage=receipt.stages.at(-1);
      console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
        stage:typeof stage==='string'?stage:stage?.stage??'INPUTS',
        code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_OWNER_289_UNCLASSIFIED'}}));
      process.exitCode=1;
    });
  }
}
module.exports={ mode, consume };
