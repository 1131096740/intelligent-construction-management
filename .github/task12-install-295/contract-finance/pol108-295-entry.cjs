'use strict';
const assert=require('node:assert/strict');
const source=require('./contract-finance-source.json');
const {sourceSha}=source;
const mode=process.argv.at(-1);
const upwardArchive=mode==='--upward-archive-332';
const paymentRemainder=mode==='--payment-remainder-331';
const textDirect=mode==='--text-direct-330';
const current320=upwardArchive||paymentRemainder||textDirect||mode==='--current-320';
const count=upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const {withPol108At295,withPol108At320,withPol108At330,withPol108At331,withPol108At332}=require('./installer.cjs');
const upwardArchiveProfile=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
const {selectShards}=require('./pol108-shards.cjs');
const [shard]=process.argv.slice(2);
assert.equal(process.argv.length,current320?4:3);
const [original]=selectShards(['--shard',shard]);
const receipt={schemaVersion:1,sourceSha,shard,purpose:'ORIGINAL_POL108_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(source.migrationCount,count);
  if(current320) {
    assert.equal(source.mode,mode.slice(2));
    assert.equal(source.predecessor.migrationCount,295);
    upwardArchiveProfile?.assertSource(source,sourceSha,require('./multi-witness.cjs').final);
    const install=upwardArchive?withPol108At332:paymentRemainder?withPol108At331:textDirect?withPol108At330:withPol108At320;
    return install(receipt,shard,{sourceTree:source.sourceTree,
      migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails});
  }
  return withPol108At295(receipt,shard);
}).then(()=>{
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
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.operatingProjection.tests,original.titles.length);
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_POL108_EXACT_'+count+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'POL108_295_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
