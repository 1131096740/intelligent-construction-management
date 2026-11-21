'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {mode,consume}=require('./remaining-owner.cjs');
const source=require('./contract-finance-source.json');
const root='/qualification';
const lane=process.argv[2];
const receipt={schemaVersion:1,purpose:'REMAINING_OWNER_EXACT_295',lane,sourceSha:source.sourceSha,
  migrationSha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,3);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,final);
  assert.equal(source.tails.at(-1).sha256,digest);
  const profile=mode(lane);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await withCombined295MultiWitness(receipt,async context=>consume(context,receipt,lane));
  assert.equal(receipt.originalScope.lane,lane);
  assert.equal(receipt.originalScope.skipped,0);
  assert.equal(receipt.originalScope.exit,0);
  assert.equal(receipt.originalScope.suites.length,Object.keys(profile.files).length);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_OWNER_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_OWNER_295_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
