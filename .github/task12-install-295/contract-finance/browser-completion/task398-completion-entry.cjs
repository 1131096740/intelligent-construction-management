'use strict';
const assert = require('node:assert/strict');
const source = require('./contract-finance-source.json');
const {browserDiagnostic,markBrowserPhase} = require('./task398-browser-diagnostics.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const historicalSettlement=source.mode==='historical-settlement-334';
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const textDirect=source.mode==='text-direct-330';
const current320=historicalSettlement||upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const purpose='TASK398_BROWSER_COMPLETION_EXACT_'+count;
const receipt = {schemaVersion:1,sourceSha:source.sourceSha,purpose,business:'NOT_ENTERED',stages:[]};
async function main(){
  assert.equal(source.migrationCount,count);
  assert.equal((current320?source.predecessor:source).ledgerSha256,require('./multi-witness.cjs').final);
  const historicalProfile=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
  historicalProfile?.assertSource(source,require('./multi-witness.cjs').final);
  const validate332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
  validate332?.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  const consume=async context=>{
    historicalProfile?.assertFinanceInstallation(receipt,source);
    if(current320)markBrowserPhase(receipt,'RUNTIME_PREFLIGHT');
    assert.equal(require("/qualification/workspace/apps/web-admin/node_modules/vite/package.json").version,"5.4.21");
    await runTask398Owned282Voucher(context,'browser-completion-'+count,receipt);
    if(current320)markBrowserPhase(receipt,'VERIFY_OWNER_CONTINUITY');
  };
  if(current320){
    const install=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await install(receipt,consume,{sourceTree:source.sourceTree,
      migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails});
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    if(historicalProfile){
      historicalProfile.assertFinanceInstallation(receipt,source);
      assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
      assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
    }
    validate332?.assertInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:1,skipped:0,evidenceStatus:"BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE"});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = purpose+'_PASSED';
}
main().catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_BROWSER_COMPLETION_'+count+'_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
    ...(current320 ? {browser:browserDiagnostic(receipt)} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
