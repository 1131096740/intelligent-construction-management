'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runHistoricalWage}=require('./remaining-historical-wage-runner.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const receipt={schemaVersion:1,purpose:'REMAINING_HISTORICAL_WAGE_295',
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,final);
  assert.equal(source.tails.at(-1).sha256,digest);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await withCombined295MultiWitness(receipt,context=>runHistoricalWage(context,receipt,source));
  assert.equal(receipt.candidateBaseline,source.sourceSha);
  assert.equal(receipt.originalSlice.expected,12);
  assert.equal(receipt.originalSlice.passed,12);
  assert.equal(receipt.originalSlice.skipped,0);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_HISTORICAL_WAGE_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_HISTORICAL_WAGE_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
