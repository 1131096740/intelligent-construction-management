'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runWage}=require('./wage.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const requestedMode=process.argv[2];
const historicalSettlement=requestedMode==='--historical-settlement-334';
const precision=requestedMode==='--expense-witness-349';
const expense=precision||requestedMode==='--expense-witness-346'?require('./remaining-history-346.cjs'):undefined;
const historical=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=requestedMode==='--upward-archive-332';
const paymentRemainder=requestedMode==='--payment-remainder-331';
const textDirect=requestedMode==='--text-direct-330';
const current=expense||historicalSettlement||upwardArchive||paymentRemainder||textDirect||requestedMode==='--current-320';
const count=precision?349:expense?346:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current?329:295;
const receipt={schemaVersion:1,purpose:'REMAINING_WAGE_STATEMENT_'+count,
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,current?3:2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  if(current){
    assert.equal(source.mode,requestedMode.slice(2));
    assert.match(source.sourceTree,/^[a-f0-9]{40}$/u);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,final);
    assert.equal(source.tails.length,count-295);
    if(expense) expense.assertInputs(source);
    else {
      const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
      assert.equal(baseline.expectedDirectoryCount,count);
      assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
      assert.equal(baseline.terminalMigrationChecksum,source.tails.at(-1).sha256);
    }
  } else {
    assert.equal(source.ledgerSha256,final);
    assert.equal(source.tails.at(-1).sha256,digest);
  }
  if(upwardArchive) require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  historical?.assertSource(source,final);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');

  const consume=async context=>{
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
  };
  if(expense) {
    await expense.install(receipt,source,consume);
  } else if(current){
    const installCurrent=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await installCurrent(receipt,async context=>{
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
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    historical?.assertFinanceInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }

  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.wageHistory.noopAndStatus,true);
  assert.equal(receipt.wageJest.exact,true);
  assert.equal(receipt.wageJest.originalPg,24);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historicalSettlement) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_WAGE_STATEMENT_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_WAGE_STATEMENT_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
