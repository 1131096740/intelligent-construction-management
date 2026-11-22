'use strict';
const assert=require('node:assert/strict');
const source=require('./contract-finance-source.json');
const {sourceSha}=source;
const current320=process.argv.at(-1)==='--current-320';
const count=current320?322:295;
const {withCombined295MultiWitness,withCombined320ContractPayment}=require('./installer.cjs');
const receipt={schemaVersion:1,sourceSha,purpose:'ORIGINAL_POL109_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(process.argv.length,current320?3:2);
  assert.equal(source.migrationCount,count);
  if(current320){
    assert.equal(source.mode,'current-320');
    assert.equal(source.predecessor.migrationCount,295);
  }
  const proof=require('./workspace-proof.cjs').verifyWorkspace();
  const consume=context=>require('./workspace/services/api/prisma/task12-pol109-ci.cjs').runPol109(context,receipt,proof);
  if(current320) return withCombined320ContractPayment(receipt,consume,{
    sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
  });
  return withCombined295MultiWitness(receipt,consume);
}).then(()=>{
  assert.equal(receipt.releaseTree,'67644d9465a0ab4ee80ede099139d9c129d66f14');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.jest,{passed:8,suites:2,failed:0,skipped:0,postgresql:7,http:1});
  assert.deepEqual(receipt.browser,{passed:5,failed:0,flakes:0,skipped:0});
  assert.equal(receipt.noOpDeploy,true);
  assert.equal(receipt.seed,true);
  assert.equal(receipt.nestHealth,true);
  assert.equal(receipt.nestCleanup,true);
  assert.equal(receipt.installOnly295?.count,295);
  if(current320){
    assert.equal(receipt.installOnly295.ledgerSha256,source.predecessor.ledgerSha256);
    assert.equal(receipt.forward320.count,count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  }
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_POL109_'+count+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:/^[A-Z0-9_]+$/u.test(code)?code:'POL109_295_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
