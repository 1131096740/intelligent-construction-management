'use strict';
const assert=require('node:assert/strict');
const {sourceSha}=require('./contract-finance-source.json');
const {withPol108At295}=require('./installer.cjs');
const {selectShards}=require('./pol108-shards.cjs');
const [shard]=process.argv.slice(2);
assert.equal(process.argv.length,3);
const [original]=selectShards(['--shard',shard]);
const receipt={schemaVersion:1,sourceSha,shard,purpose:'ORIGINAL_POL108_EXACT_295',business:'NOT_ENTERED',stages:[]};
withPol108At295(receipt,shard).then(()=>{
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.operatingProjection.tests,original.titles.length);
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_POL108_EXACT_295_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'POL108_295_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
