'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitnessForProfile}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runRetained,verifyInputs}=require('./remaining-retained.cjs');
const source=require('./contract-finance-source.json');
const root='/qualification';
const lane='profile';
const receipt={schemaVersion:1,purpose:'REMAINING_PROFILE_WARM_EXACT_295',lane,sourceSha:source.sourceSha,
  migrationSha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,final);
  assert.equal(source.tails.at(-1).sha256,digest);
  const rows=verifyInputs(lane);
  assert.equal(rows.length,1);
  assert.equal(rows[0].pending,2);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await withCombined295MultiWitnessForProfile(receipt,async context=>runRetained(context,receipt,lane));
  assert.equal(receipt.retainedOriginal.mode,lane);
  assert.equal(receipt.retainedOriginal.exit,0);
  assert.equal(receipt.retainedOriginal.seen.length,rows.length);
  assert.equal(receipt.profileHistory.prefix,125);
  assert.equal(receipt.profileHistory.backfill,126);
  assert.equal(receipt.profileHistory.sameInstance,true);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_PROFILE_WARM_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_PROFILE_WARM_295_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
