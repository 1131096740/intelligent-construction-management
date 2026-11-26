'use strict';
const assert=require('node:assert/strict');
const source=require('./contract-finance-source.json');
const {sourceSha}=source;
const mode=process.argv.at(-1);
const expenseWitness=mode==='--expense-witness-346'?require('./expense-witness-346-profile.cjs'):undefined;
const historicalSettlement=mode==='--historical-settlement-334';
const upwardArchive=mode==='--upward-archive-332';
const paymentRemainder=mode==='--payment-remainder-331';
const textDirect=mode==='--text-direct-330';
const current320=Boolean(expenseWitness)||historicalSettlement||upwardArchive||paymentRemainder||textDirect||mode==='--current-320';
const count=expenseWitness?expenseWitness.count:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness}=require('./installer.cjs');
const historicalProfile=historicalSettlement||expenseWitness?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchiveProfile=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
const receipt={schemaVersion:1,sourceSha,purpose:'ORIGINAL_POL109_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(process.argv.length,current320?3:2);
  assert.equal(source.migrationCount,count);
  if(current320){
    assert.equal(source.mode,mode.slice(2));
    assert.equal(source.predecessor.migrationCount,295);
    const {final}=require('./multi-witness.cjs');
    if(expenseWitness) {
      const {createHash}=require('node:crypto');
      const {readFileSync}=require('node:fs');
      expenseWitness.assertSource(source,final);
      expenseWitness.assertRuntimeBaseline(require('./workspace/services/api/prisma/migration-baseline.cjs'));
      assert.equal(createHash('sha256').update(readFileSync(require.resolve('./installer.cjs'))).digest('hex'),expenseWitness.installerSha256);
    } else {
      historicalProfile?.assertSource(source,final);
    }
    upwardArchiveProfile?.assertSource(source,sourceSha,require('./multi-witness.cjs').final);
  }
  const proof=require('./workspace-proof.cjs').verifyWorkspace();
  const consume=context=>{
    if(expenseWitness) {
      assert.equal(context.candidateTree,source.sourceTree);
      const historicalTails=source.tails.slice(0,source.predecessor334.migrationCount-source.predecessor.migrationCount);
      historicalProfile.assertFinanceInstallation(receipt,{...source,tails:historicalTails});
      assert.deepEqual(receipt.expenseWitnessForward,{
        count,ledgerSha256:source.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(historicalTails.length).map(({name,sha256})=>({name,sha256}))
      });
    } else {
      historicalProfile?.assertFinanceInstallation(receipt,source);
    }
    upwardArchiveProfile?.assertInstallation(receipt,source);
    return require('./workspace/services/api/prisma/task12-pol109-ci.cjs').runPol109(context,receipt,proof);
  };
  if(!current320) return withCombined295MultiWitness(receipt,consume);
  const material={sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails};
  if(expenseWitness) return withCombinedExpenseWitness(receipt,consume,material,count);
  const install=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
  return install(receipt,consume,material);
}).then(()=>{
  assert.equal(receipt.releaseTree,'67644d9465a0ab4ee80ede099139d9c129d66f14');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.jest,{passed:8,suites:2,failed:0,skipped:0,postgresql:7,http:1});
  assert.deepEqual(receipt.browser,{passed:5,failed:0,flakes:0,skipped:0});
  assert.equal(receipt.noOpDeploy,true);
  assert.equal(receipt.seed,true);
  assert.equal(receipt.nestHealth,true);
  assert.equal(receipt.nestCleanup,true);
  assert.equal(receipt.installOnly295?.count,295);
  if(current320){
    assert.equal(receipt.installOnly295.ledgerSha256,source.predecessor.ledgerSha256);
    assert.equal(receipt.forward320.count,expenseWitness?source.predecessor334.migrationCount:count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,expenseWitness?source.predecessor334.ledgerSha256:source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    if(historicalProfile) {
      assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
      assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
    }
    if(expenseWitness) assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  }
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_POL109_'+count+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:/^[A-Z0-9_]+$/u.test(code)?code:'POL109_295_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
