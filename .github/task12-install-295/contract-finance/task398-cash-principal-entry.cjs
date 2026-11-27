'use strict';
const assert = require('node:assert/strict');
const source = require('./contract-finance-source.json');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness,withCombinedExpenseWitness349} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const [lane] = process.argv.slice(2);
assert.ok(process.argv.length===3&&['cash-handover','principal-return','cash-transfer','project-advance','principal-return-a23'].includes(lane));
const textDirect=source.mode==='text-direct-330';
const company=source.mode==='company-history-352';
const signed=(company||source.mode==='signed-settlement-350')?require('./payment-execution-'+source.migrationCount+'.cjs'):undefined;
const precision=(signed||source.mode==='expense-witness-349')?require('./expense-witness-349-profile.cjs'):undefined;
const expense=(precision||source.mode==='expense-witness-346')?require('./expense-witness-346-profile.cjs'):undefined;
const profile=company?require('./company-history-352-profile.cjs'):signed?require('./signed-settlement-350-profile.cjs'):precision??expense;
const historical=(expense||source.mode==="historical-settlement-334")?require("./historical-settlement-334-profile.cjs"):null;
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const current320=Boolean(expense)||Boolean(historical)||upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=profile?profile.count:historical?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const purpose='TASK398_CASH_PRINCIPAL_EXACT_'+count;
const receipt = {schemaVersion:1,sourceSha:source.sourceSha,lane,purpose,business:'NOT_ENTERED',stages:[]};
async function main(){
  assert.equal(source.migrationCount,count);
  const a23 = lane === 'principal-return-a23' ? require('./stage-task409-a23.cjs') : null;
  if (a23) {
    assert.equal(count, 349);
    const { readFileSync } = require('node:fs');
    const { createHash } = require('node:crypto');
    const digest = file => createHash('sha256').update(readFileSync('/qualification/workspace/services/api/' + file)).digest('hex');
    assert.equal(digest('prisma/run-task398-shared-standard-local.cjs'), a23.runnerSha256);
    assert.equal(digest('src/database/task27-principal-return.http.pg.spec.ts'), a23.specSha256);
  }
  const extended=lane==='cash-transfer'||lane==='project-advance';
  if(extended) assert.ok(count===332||count===346);
  assert.equal((current320?source.predecessor:source).ledgerSha256,require('./multi-witness.cjs').final);
  if(expense){
    const {readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
    assert.equal(createHash('sha256').update(readFileSync('/qualification/installer.cjs')).digest('hex'),profile.installerSha256);
    profile.assertSource(source,require('./multi-witness.cjs').final);
    profile.assertRuntimeBaseline(require('./workspace/services/api/prisma/migration-baseline.cjs'));
  }
  if(historical&&!expense){
    const {readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
    assert.equal(createHash('sha256').update(readFileSync('/qualification/installer.cjs')).digest('hex'),historical.installerSha256);
    historical.assertSource(source,require('./multi-witness.cjs').final);
  }
  const validate332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
  validate332?.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  const consume=context=>{
    historical?.assertFinanceInstallation(receipt,expense?{...source,tails:source.tails.slice(0,39)}:source);
    if(expense){
      assert.equal(context.candidateTree,source.sourceTree);
      assert.deepEqual(receipt.expenseWitnessForward,{
        count:expense.count,ledgerSha256:expense.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(39,expense.count-295).map(({name,sha256})=>({name,sha256}))
      });
      if(precision) assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
        count:precision.count,ledgerSha256:precision.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(expense.count-295,precision.count-295).map(({name,sha256})=>({name,sha256}))
      });
    }
    return runTask398Owned282Voucher(context,lane+'-'+count,receipt);
  };
  if(current320){
    const install=historical?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    const material={sourceTree:source.sourceTree,
      migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails};
    if(signed){
      await signed.install(receipt,consume,source);
      signed.assertInstallation(receipt,source);
    } else if(precision){
      await withCombinedExpenseWitness349(receipt,consume,{...source,...material});
      assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
    } else if(expense){
      await withCombinedExpenseWitness(receipt,consume,material,count);
    } else {
      await install(receipt,consume,material);
    }
    if(expense) assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    if(!expense) assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    validate332?.assertInstallation(receipt,source);
    if(paymentRemainder) {
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:'12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f',
        sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:extended?8:1,skipped:0});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historical){
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  if (a23) receipt.a23 = { title: a23.title, passed: 1, skipped: 0, specSha256: a23.specSha256 };
  receipt.status = purpose+'_PASSED';
}
main().catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:error.cashPhase ?? receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_CASH_PRINCIPAL_'+count+'_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
