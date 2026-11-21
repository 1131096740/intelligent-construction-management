'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runWage}=require('./wage.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const receipt={schemaVersion:1,purpose:'REMAINING_WAGE_STATEMENT_295',
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

  await withCombined295MultiWitness(receipt,async context=>{
    const witness=receipt.orderedTails.filter(row=>[288,289,294,295].includes(row.size));
    assert.deepEqual(witness,[
      {size:288,ledgerSha256:'9e30b3f68e4909bbd1a7aa6beb2eb0345a49c350070062e86757da11d5cc0c44'},
      {size:289,ledgerSha256:'5c5e77dc94502b706c6e52c5761f52573e27cca46efb812f9b8b22216ec52f67'},
      {size:294,ledgerSha256:'1b66e6c98907b9c06d64ad2294e203a877157fcb0ca463b4989657ea1d86396d'},
      {size:295,ledgerSha256:final},
    ]);
    assert.equal(receipt.installOnly295.sameIdentity,true);
    assert.equal(receipt.installOnly295.exactB7,true);
    receipt.wageHistory={historicalPair:[288,289],terminalPair:[294,295],sameInstance:true};
    await runWage(context,receipt);
  });

  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.wageHistory.noopAndStatus,true);
  assert.equal(receipt.wageJest.exact,true);
  assert.equal(receipt.wageJest.originalPg,24);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_WAGE_STATEMENT_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_WAGE_STATEMENT_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
