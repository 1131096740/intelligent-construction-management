'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness,withCombinedExpenseWitness349,withCombinedSignedSettlement350,withCombinedCompanyHistory352}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {mode,consume}=require('./remaining-owner.cjs');
const source=require('./contract-finance-source.json');
const root='/qualification';
const lane=process.argv[2];
const requestedMode=process.argv[3];
const historicalSettlement=requestedMode==='--historical-settlement-334';
const company=requestedMode==='--company-history-352';
const signed=company||requestedMode==='--signed-settlement-350';
const precision=signed||requestedMode==='--expense-witness-349';
const expense=company?require('./company-history-352-profile.cjs'):signed?require('./signed-settlement-350-profile.cjs'):precision?require('./expense-witness-349-profile.cjs'):
  requestedMode==='--expense-witness-346'?require('./expense-witness-346-profile.cjs'):undefined;
const historical=historicalSettlement||expense?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=requestedMode==='--upward-archive-332';
const paymentRemainder=requestedMode==='--payment-remainder-331';
const textDirect=requestedMode==='--text-direct-330';
const current=expense||historicalSettlement||upwardArchive||paymentRemainder||textDirect||requestedMode==='--current-320';
const count=expense?expense.count:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current?329:295;
const receipt={schemaVersion:1,purpose:'REMAINING_OWNER_EXACT_'+count,lane,sourceSha:source.sourceSha,
  migrationSha256:current?source.tails.at(-1).sha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

function assertExpenseForward(){
  historical.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
  const witness=precision?source.predecessor346:source;
  const boundary=witness.migrationCount-source.predecessor.migrationCount;
  assert.deepEqual(receipt.expenseWitnessForward,{
    count:346,ledgerSha256:witness.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
    tails:source.tails.slice(39,boundary).map(({name,sha256})=>({name,sha256}))
  },'REMAINING_OWNER_346_FORWARD');
  if(precision) {
    const checkpoint=signed?source.predecessor349:source;
    const end=checkpoint.migrationCount-source.predecessor.migrationCount;
    assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
      count:checkpoint.migrationCount,ledgerSha256:checkpoint.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
      tails:source.tails.slice(boundary,end).map(({name,sha256})=>({name,sha256}))
    },'REMAINING_OWNER_349_FORWARD');
  }
  if(signed) {
    const signedProfile=company?require('./signed-settlement-350-profile.cjs'):expense;
    assert.deepEqual(receipt.signedSettlementForward,{
      count:350,ledgerSha256:signedProfile.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
      tails:[{name:signedProfile.terminal.name,sha256:signedProfile.terminal.sha256}]
    },'REMAINING_OWNER_350_FORWARD');
    if(company) assert.deepEqual(receipt.companyHistoryForward, {
      count,ledgerSha256:source.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
      tails:expense.tails.map(({name,sha256})=>({name,sha256}))
    },'REMAINING_OWNER_352_FORWARD');
  }
}

async function main(){
  assert.equal(process.argv.length,current?4:3);
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
    if(expense) {
      assert.equal(source.sourceSha,process.env.JG_REMAINING_OWNER_SOURCE_SHA,'REMAINING_OWNER_'+count+'_SHA');
      expense.assertSource(source,final);
      require('./migration-inputs-346.cjs')(root+'/workspace/services/api',source,expense);
      const installerSha=createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
      assert.equal(installerSha,expense.installerSha256,'REMAINING_OWNER_'+count+'_INSTALLER');
    } else {
      const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
      assert.equal(baseline.expectedDirectoryCount,count);
      assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
      assert.equal(baseline.terminalMigrationChecksum,receipt.migrationSha256);
    }
  } else {
    assert.equal(source.ledgerSha256,final);
    assert.equal(source.tails.at(-1).sha256,digest);
  }
  if(upwardArchive) require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  if(historicalSettlement) historical.assertSource(source,final);
  const profile=mode(lane);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  if(current){
    const installCurrent=expense?withCombinedExpenseWitness:historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    const consumeCurrent=async context=>{
      assert.equal(context.candidateTree,source.sourceTree);
      if(expense) assertExpenseForward();
      await consume(context,receipt,lane);
    };
    const material={sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails};
    if(company) await withCombinedCompanyHistory352(receipt,consumeCurrent,{...source,...material});
    else if(signed) await withCombinedSignedSettlement350(receipt,consumeCurrent,{...source,...material});
    else if(precision) await withCombinedExpenseWitness349(receipt,consumeCurrent,{...source,...material});
    else await installCurrent(receipt,consumeCurrent,material,...(expense?[count]:[]));
    if(expense) {
      assertExpenseForward();
      assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
      if(precision) assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
      if(signed) expense.assertInstallation(receipt,source);
    } else {
      assert.equal(receipt.forward320.count,count);
      assert.equal(receipt.forward320.sourceTree,source.sourceTree);
      assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
      assert.equal(receipt.forward320.sameBaseB7,true);
    }
    assert.equal(receipt.combinedAfterBusiness.count,count);
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    if(historicalSettlement) historical.assertFinanceInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,async context=>consume(context,receipt,lane));
  }
  assert.equal(receipt.originalScope.lane,lane);
  assert.equal(receipt.originalScope.skipped,0);
  assert.equal(receipt.originalScope.exit,0);
  assert.equal(receipt.originalScope.suites.length,Object.keys(profile.files).length);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historical) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_OWNER_'+count+'_PASSED';
}

main().catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_OWNER_295_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
