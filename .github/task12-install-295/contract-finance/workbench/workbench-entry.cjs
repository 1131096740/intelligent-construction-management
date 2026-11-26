'use strict';
const assert=require('node:assert/strict');
const {verifyInputs}=require('./workbench-inputs.cjs');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement}=require('./installer.cjs');
const terminal=require('./multi-witness.cjs');
const source=require('./contract-finance-source.json');
const mode=process.argv[2];
const historicalSettlement=mode==='--historical-settlement-334';
const historical=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=historicalSettlement||mode==='--upward-archive-332';
const paymentRemainder=upwardArchive||mode==='--payment-remainder-331';
const textDirect=paymentRemainder||mode==='--text-direct-330';
const current320=textDirect||mode==='--current-320';
const count=historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const receipt={schemaVersion:1,sourceSha:source.sourceSha,purpose:'POL115_WORKBENCH_ORIGINAL_'+count,business:'NOT_ENTERED',stages:['INPUTS']};
Promise.resolve().then(()=>{
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.equal(process.argv.length,current320?3:2);
  assert.equal(source.migrationCount,count);
  if(current320){
    assert.equal(source.mode,mode.slice(2));
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,terminal.final);
  } else assert.equal(source.ledgerSha256,terminal.final);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  historical?.assertSource(source,terminal.final);
  verifyInputs();
  admitSource('/qualification','/qualification/source/services/api/prisma','/qualification/source-seal.txt');
  const {runWorkbench}=require('./task12-pol115-workbench-ci.cjs');
  const consume=async context=>{
    historical?.assertFinanceInstallation(receipt,source);
    await runWorkbench(context,receipt,current320?source:undefined);
    if(paymentRemainder) await require('./issue430-approval-sms-ci.cjs').runIssue430ApprovalSms(context,receipt,source);
  };
  if(current320){
    const install=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    return install(receipt,consume,{
      sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
    });
  }
  return withCombined295MultiWitness(receipt,consume);
}).then(()=>{
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.workbench?.tests,9);
  assert.equal(receipt.workbench?.skipped,0);
  assert.deepEqual(receipt.workbench?.browserProjects,['desktop','mobile']);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295?.ledgerSha256,terminal.final);
  if(current320){
    assert.equal(receipt.forward320.count,count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.count,count);
  }
  if(textDirect){
    assert.equal(receipt.textDirectPredecessor?.count,329);
    assert.equal(receipt.textDirectPredecessor?.sameBaseB7,true);
  }
  if(paymentRemainder){
    assert.equal(receipt.issue430?.tests,5);
    assert.equal(receipt.issue430?.externalSends,0);
    assert.deepEqual(receipt.paymentRemainderPredecessor,{
      count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
    });
  }
  if(upwardArchive){
    assert.deepEqual(receipt.upwardArchivePredecessor,{
      count:331,ledgerSha256:source.predecessor331.ledgerSha256,sameIdentity:true,sameBaseB7:true
    });
  }
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.sameIdentity,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historicalSettlement) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='POL115_WORKBENCH_ORIGINAL_'+count+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'POL115_WORKBENCH_295_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
