'use strict';
const assert = require('node:assert/strict');
const source = require('./contract-finance-source.json');
const {sourceSha} = source;
const current320=source.mode==='current-320';
const count=current320?322:295;
const {withCombined295MultiWitness,withCombined320ContractPayment} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const receipt = {schemaVersion:1,sourceSha,purpose:'TASK398_STANDARD_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
async function run(){
  assert.equal(source.migrationCount,count);
  const consume=context=>runTask398Owned282Voucher(context,'standard-'+count,receipt);
  if(current320){
    assert.equal(source.predecessor.ledgerSha256,require('./multi-witness.cjs').final);
    await withCombined320ContractPayment(receipt,consume,{
      sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.combinedAfterBusiness?.count,count);
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:8,skipped:0});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = 'TASK398_STANDARD_EXACT_'+count+'_PASSED';
}

run().catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_STANDARD_295_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
