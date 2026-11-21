'use strict';
const assert=require('node:assert/strict');
assert.equal(typeof require('./owner-observation.cjs').projectPsql,'function');
const {withExact290Standard}=require('./installer.cjs');
const {runTask398Owned282Voucher}=require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');
require('./verify-behavior.cjs').checkClosure('/qualification/workspace/services/api/src');
const receipt={schemaVersion:1,purpose:'TASK398_STANDARD_EXACT_290',business:'NOT_ENTERED',stages:[]};
withExact290Standard(receipt,async context=>{
 await runTask398Owned282Voucher(context,'standard-290',receipt);
}).then(()=>{
 assert.equal(receipt.postBehavior290?.catalogPreserved,true);
 assert.equal(receipt.business,'CALLBACK_COMPLETED');
 assert.equal(receipt.installOnly290?.count,290);
 assert.deepEqual(receipt.original,{business:1,passed:8,skipped:0});
 assert.equal(receipt.postBehavior290?.keyUnprovisioned,true);
 assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
 receipt.status='TASK398_STANDARD_EXACT_290_PASSED';
}).catch(error=>{
 const code=error.code??error.message;
 receipt.status='STOPPED';
 const state=error?.psqlObservation?.sqlstate??error.sqlstate;
 receipt.failure={...(/^[0-9A-Z]{5}$/u.test(state??'')?{sqlstate:state}:{}),
  ...(error?.psqlObservation?.permissionDenied===true?{permissionDenied:true}:{}),stage:receipt.stages.at(-1),code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'TASK398_STANDARD_290_BEHAVIOR_FAILED'};
 process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
