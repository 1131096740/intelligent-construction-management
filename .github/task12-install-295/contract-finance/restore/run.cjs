'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {runBackup295,prepareBackup295,runBackup320,verifyLease} = require('./backup-fixture.cjs');
const admission=require('./committed-admission.json');
const {admitSource} = require('./install-only292.cjs');
const {checkClosure} = require('./verify-behavior.cjs');
const {withCombined295MultiWitnessForRestore,withCombined320ContractPaymentForRestore} = require('./installer.cjs');
const bank = require('./named-roles/contract-finance-owned-ci.cjs');
const correctionRoot='/qualification/workspace', loanRoot='/qualification/loan-workspace';
const correction=require(correctionRoot+'/services/api/prisma/run-task398-shared-standard-local.cjs').runTask398Owned282Voucher;
const loan=require(loanRoot+'/services/api/prisma/contract-finance-owned-ci.cjs').verify;
const args=process.argv.slice(2);
const current320=args[0]==='--current-320';
const runArgs=current320?args.slice(1):args;
const source=current320?require('./current320-source.json'):undefined;
const receipt={schemaVersion:1,purpose:'NTF04_NAMED_RESTORE_EXACT_'+(current320?320:295),
  candidateSha:source?.sourceSha??admission.head,...(current320?{fixturePredecessorSha:admission.head}:{}),operation:'NAMED_BANK_BACKUP_AND_RECOVERY',stages:[]};

function requireNoCrossLinks(root){
  for(const relative of ['services/api/node_modules/@prisma/client','services/api/node_modules/jest','node_modules/.pnpm']) {
    const resolved=fs.realpathSync(path.join(root,relative));
    assert.ok(resolved.startsWith(root+'/'),'BACKUP292_RUNTIME_CROSSES_WORKSPACES');
  }
}
function preflight(){
  assert.equal(process.getuid()>0,true);
  receipt.input=admitSource('/qualification','/qualification/source/services/api/prisma','/qualification/source-seal.txt');
  require('./terminal.cjs').verify('/qualification/terminal.sql');
  require('./payout-terminal.cjs').verify();
  require('./multi-witness.cjs').verify();
  receipt.inputMigrationSha256=require('./multi-witness.cjs').digest;
  checkClosure(correctionRoot+'/services/api/src');
  const manifest=JSON.parse(fs.readFileSync('/qualification/loan-relocated-manifest.json','utf8'));
  assert.equal(manifest.length,1814);
  for(const [relative,digest] of manifest){
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(loanRoot,relative))).digest('hex'),
      digest,'BACKUP292_RELOCATED_SOURCE_BYTES');
  }
  for(const root of [correctionRoot,loanRoot]) requireNoCrossLinks(root);
  receipt.stages.push('BACKUP292_BOTH_WORKSPACE_CLOSURES');
}
async function namedRoles(context,forward320){
  await verifyLease(context,forward320);
  const backup=await bank.prepareDiagnosticBackupIdentity(context);
  try {
    const url=new URL(await bank.prepareBankRuntime(context,backup));
    assert.equal(url.username,'contract_runtime');
    return {
      credentials:{backupPassword:backup.password,runtimePassword:decodeURIComponent(url.password)},
      async release(){
        try { await bank.releaseBankRoles(context); }
        finally { await bank.releaseDiagnosticBackupIdentity(context); }
      },
    };
  } catch(error){
    const {stdout}=await context.sql("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='contract_runtime');");
    try { if(stdout.trim()==='t') await bank.releaseBankRoles(context); }
    finally { await bank.releaseDiagnosticBackupIdentity(context); }
    throw error;
  }
}
async function main(){
  assert.ok(runArgs.length===0||(runArgs.length===1&&runArgs[0]==='--preflight'));
  if(current320){
    assert.equal(source.mode,'current-320');
    assert.equal(source.migrationCount,320);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,require('./multi-witness.cjs').final);
    assert.equal(source.ledgerSha256,require('./forward-320-inventory.json').ledgerSha256);
    assert.match(source.sourceSha,/^[0-9a-f]{40}$/u);
    assert.match(source.sourceTree,/^[0-9a-f]{40}$/u);
  }
  preflight();
  if(runArgs.length){
    const name='公司互转真实PG：独立领导OR终审、两侧流水、在途、借款归还、自有资金与项目权限';
    const check=spawnSync('pnpm',['--filter','@jiangkong/api','exec','jest','--runInBand','--runTestsByPath',
      'src/database/project-affiliate-company-contract-db.spec.ts','--testNamePattern',name,'--json'],{
      cwd:loanRoot,timeout:60000,encoding:'utf8',maxBuffer:1024*1024,
      env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',COREPACK_HOME:'/opt/corepack',
        COREPACK_ENABLE_NETWORK:'0',COREPACK_DEFAULT_TO_LATEST:'0',NODE_ENV:'test',CI:'true',
        SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false'},
    });
    assert.equal(check.status,0,'BACKUP292_RELOCATED_JEST_PREFLIGHT');
    const tests=JSON.parse(check.stdout).testResults.flatMap(row=>row.assertionResults);
    assert.equal(tests.filter(test=>test.title===name&&test.status==='pending').length,1,'BACKUP292_LOAN_CASE_PREFLIGHT');
    receipt.status=current320?'BACKUP320_NO_DB_PREFLIGHT_PASSED':'BACKUP295_NO_DB_PREFLIGHT_PASSED';
    return;
  }
  const fixtures={
    correction:async(ctx,proof)=>{
      if(!current320) return correction(ctx,'correction-catalog',proof);
      const predecessorProof={...proof,purpose:'NTF04_NAMED_RESTORE_EXACT_295',candidateSha:admission.head};
      await correction(ctx,'correction-catalog',predecessorProof);
      for(const field of ['before','successor','businessOracle']) proof[field]=predecessorProof[field];
    },
    loan:async ctx=>{ await verifyLease(ctx); return loan('affiliate',ctx); },
  };
  if(current320){
    await withCombined320ContractPaymentForRestore(receipt,
      context=>prepareBackup295(context,receipt,admission,fixtures),
      context=>runBackup320(context,receipt,{namedRoles:ctx=>namedRoles(ctx,receipt.forward320)}),
      {sourceTree:source.sourceTree,migrations:'/qualification/current320/migrations',tails:source.tails});
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  } else {
    await withCombined295MultiWitnessForRestore(receipt,async context=>{
      await verifyLease(context);
      await runBackup295(context,receipt,admission,{...fixtures,namedRoles});
    });
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=current320?'BACKUP320_RESTORED_AND_VERIFIED':'BACKUP295_RESTORED_AND_VERIFIED';
}
main().catch(error=>{
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:'BACKUP292_UNCLASSIFIED',sqlstate:error.sqlstate,
    prismaCode:error.prismaCode,exit:error.exit,restore:error.restoreDiagnostic,migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
