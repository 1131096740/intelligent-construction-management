'use strict';
const assert = require('node:assert/strict');
const source = require('./contract-finance-source.json');
const {sourceSha} = source;
const current320=source.mode==='current-320';
const textDirect=source.mode==='text-direct-330';
const paymentRemainder=source.mode==='payment-remainder-331';
const expenseWitness=source.mode==="expense-witness-346"?require("./expense-witness-346-profile.cjs"):null;
const historical=expenseWitness||source.mode==="historical-settlement-334"?require("./historical-settlement-334-profile.cjs"):null;
const upwardArchive=source.mode==='upward-archive-332';
const count=expenseWitness?expenseWitness.count:historical?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const standard=!expenseWitness&&process.argv[2]===`standard-${count}`;
const ledgerLoss=(!historical||expenseWitness!==null)&&process.argv[2]===`ledger-loss-${count}`;
const competition=!historical&&count>=331&&process.argv[2]===`competition-${count}`;
assert.ok((!expenseWitness||ledgerLoss)&&(process.argv.length===2||(process.argv.length===3&&count>=330&&(standard||ledgerLoss||competition))));
const textFinance=count>=330&&!standard&&!ledgerLoss&&!competition;
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const receipt = {schemaVersion:1,sourceSha,purpose:textFinance?`TASK425_TEXT_DIRECT_FINANCE_${count}`:ledgerLoss?`TASK398_LEDGER_LOSS_EXACT_${count}`:competition?`TASK398_COMPETITION_EXACT_${count}`:'TASK398_STANDARD_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
async function run(){
  assert.equal(source.migrationCount,count);
  if(historical){
    const profile=expenseWitness??historical;
    const {readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
    assert.equal(createHash('sha256').update(readFileSync('/qualification/installer.cjs')).digest('hex'),profile.installerSha256);
    profile.assertSource(source,require('./multi-witness.cjs').final);
  }
  const validate332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
  const consume=context=>{
    validate332?.assertInstallation(receipt,source);
    const historicalSource=expenseWitness?{...source,tails:source.tails.slice(0,39)}:source;
    historical?.assertFinanceInstallation(receipt,historicalSource);
    if(expenseWitness){
      const installed=receipt.expenseWitnessForward;
      assert.equal(installed.count,count);
      assert.equal(installed.ledgerSha256,source.ledgerSha256);
      assert.equal(installed.sourceTree,source.sourceTree);
      assert.equal(installed.sameIdentity,true);
      assert.deepEqual(installed.tails,source.tails.slice(historicalSource.tails.length).map(({name,sha256})=>({name,sha256})));
    }
    return runTask398Owned282Voucher(context,textFinance?`text-direct-${count}`:process.argv[2]??'standard-'+count,receipt);
  };
  if(count>=329){
    const baseLedgerSha256=require('./multi-witness.cjs').final;
    assert.equal(source.predecessor.ledgerSha256,baseLedgerSha256);
    validate332?.assertSource(source,sourceSha,baseLedgerSha256);
    const install=historical?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    const material={
      sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
    };
    if(expenseWitness){
      await withCombinedExpenseWitness(receipt,consume,material,count);
      assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    }else{
      await install(receipt,consume,material);
      assert.equal(receipt.forward320.sourceTree,source.sourceTree);
      assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.combinedAfterBusiness?.count,count);
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  if(textDirect||paymentRemainder){
    assert.equal(receipt.textDirectPredecessor?.count,329);
    assert.equal(receipt.textDirectPredecessor?.sameBaseB7,true);
  }
  if(paymentRemainder) {
    assert.deepEqual(receipt.paymentRemainderPredecessor,{
      count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
    });
  }
  if(textFinance){
    assert.deepEqual(receipt.finance,{passed:1,skipped:0});
  }else{
    assert.deepEqual(receipt.original,{business:1,passed:8,skipped:0});
  }
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historical){
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = receipt.purpose+'_PASSED';
}

run().catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_STANDARD_295_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
