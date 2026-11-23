'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runHistoricalWage}=require('./remaining-historical-wage-runner.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const current320=process.argv[2]==='--current-320';
const count=current320?329:295;
const receipt={schemaVersion:1,purpose:'REMAINING_HISTORICAL_WAGE_'+count,
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,current320?3:2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  if(current320){
    assert.equal(source.mode,'current-320');
    assert.match(source.sourceTree,/^[a-f0-9]{40}$/u);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,final);
    assert.equal(source.tails.length,34);
    const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
    assert.equal(baseline.expectedDirectoryCount,count);
    assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
    assert.equal(baseline.terminalMigrationChecksum,source.tails.at(-1).sha256);
  } else {
    assert.equal(source.ledgerSha256,final);
    assert.equal(source.tails.at(-1).sha256,digest);
  }
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const consume=context=>runHistoricalWage(context,receipt,source);
  if(current320){
    await withCombined320ContractPayment(receipt,async context=>{
      assert.equal(context.candidateTree,source.sourceTree);
      await consume(context);
    },{
      sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.count,count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.candidateBaseline,source.sourceSha);
  assert.equal(receipt.originalSlice.expected,12);
  assert.equal(receipt.originalSlice.passed,12);
  assert.equal(receipt.originalSlice.skipped,0);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_HISTORICAL_WAGE_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_HISTORICAL_WAGE_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
