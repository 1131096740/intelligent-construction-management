'use strict';
const assert = require('node:assert/strict');
const source = require('./contract-finance-source.json');
const {sourceSha} = source;
const current320=source.mode==='current-320';
const textDirect=source.mode==='text-direct-330';
const paymentRemainder=source.mode==='payment-remainder-331';
const count=paymentRemainder?331:textDirect?330:current320?329:295;
const standard330=process.argv[2]==='standard-330';
const ledgerLoss=process.argv[2]===`ledger-loss-${count}`;
assert.ok(paymentRemainder
  ? process.argv.length===3&&ledgerLoss
  : process.argv.length===2||(process.argv.length===3&&textDirect&&(standard330||ledgerLoss)));
const textFinance=textDirect&&!standard330&&!ledgerLoss;
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const receipt = {schemaVersion:1,sourceSha,purpose:textFinance?'TASK425_TEXT_DIRECT_FINANCE_330':ledgerLoss?`TASK398_LEDGER_LOSS_EXACT_${count}`:'TASK398_STANDARD_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
async function run(){
  assert.equal(source.migrationCount,count);
  const consume=context=>runTask398Owned282Voucher(context,textFinance?'text-direct-330':ledgerLoss?`ledger-loss-${count}`:'standard-'+count,receipt);
  if(current320||textDirect||paymentRemainder){
    assert.equal(source.predecessor.ledgerSha256,require('./multi-witness.cjs').final);
    const install=paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await install(receipt,consume,{
      sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
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
