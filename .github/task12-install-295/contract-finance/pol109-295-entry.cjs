'use strict';
const assert=require('node:assert/strict');
const {sourceSha}=require('./contract-finance-source.json');
const {withCombined295MultiWitness}=require('./installer.cjs');
const receipt={schemaVersion:1,sourceSha,purpose:'ORIGINAL_POL109_EXACT_295',business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  const proof=require('./workspace-proof.cjs').verifyWorkspace();
  return withCombined295MultiWitness(receipt,context=>
    require('./workspace/services/api/prisma/task12-pol109-ci.cjs').runPol109(context,receipt,proof));
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
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_POL109_295_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:/^[A-Z0-9_]+$/u.test(code)?code:'POL109_295_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
