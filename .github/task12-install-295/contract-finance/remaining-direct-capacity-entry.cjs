'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {consume}=require('./remaining-direct-capacity.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const current320=source.mode==='current-320';
const count=current320?320:295;
const receipt={schemaVersion:1,purpose:'REMAINING_DIRECT_CAPACITY_'+count,
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  const predecessor=current320?source.predecessor:source;
  assert.equal(predecessor.migrationCount,295);
  assert.equal(predecessor.ledgerSha256,final);
  assert.equal(predecessor.tails.at(-1).sha256,digest);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const verify=context=>consume(context,receipt);
  if(current320){
    await withCombined320ContractPayment(receipt,verify,{
      sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
  } else {
    await withCombined295MultiWitness(receipt,verify);
  }
  assert.deepEqual(receipt.directCapacity,{passed:1,skipped:0,bootstrapOid:10,tls:true});
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_DIRECT_CAPACITY_'+count+'_PASSED';
}

main().catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_DIRECT_CAPACITY_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
