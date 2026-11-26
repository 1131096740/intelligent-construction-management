'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const source=require('./contract-finance-source.json');
const {sourceSha}=source;
const requestedMode=process.argv[2];
const textDirect=requestedMode==='--text-direct-330';
const paymentRemainder=requestedMode==='--payment-remainder-331';
const historicalSettlement=requestedMode==='--historical-settlement-334';
const exact=requestedMode==='--expense-witness-346'?require('./exact-346.cjs'):undefined;
const upwardArchive=requestedMode==='--upward-archive-332';
const forward=exact||historicalSettlement||upwardArchive||paymentRemainder||textDirect||requestedMode==='--current-320';
const count=exact?346:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:forward?329:295;
const profile331=paymentRemainder?require('./payment-remainder-331-profile.cjs'):undefined;
const profile334=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const profile332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
const installer=require('./installer.cjs');
const original='/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs';
const receipt={schemaVersion:1,sourceSha,purpose:'ORIGINAL_POL275_COLD_EXACT_'+count,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(process.argv.length,forward?3:2);
  assert.equal(source.migrationCount,count);
  const profile=profile332??profile331;
  if(exact) exact.assertInputs(source,'cold');
  else if(profile334) profile334.assertSource(source,require('./multi-witness.cjs').final);
  else if(profile) profile.assertSource(source,sourceSha,require('./multi-witness.cjs').final);
  else if(forward) {
    assert.equal(source.mode,requestedMode.slice(2));
    assert.equal(source.predecessor.migrationCount,295);
  }
  assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'),'a338dcd1817f5dc6dacdea62cb36b3357d7933bc58587e61b4b71dec7a91d2db');
  const consume=async context=>{
    exact?.forward(receipt,source);
    profile334?.assertFinanceInstallation(receipt,source);
    profile332?.assertInstallation(receipt,source);
    receipt.stages.push('POL275_ORIGINAL_CATALOG');
    const catalog=await require(original).collectEvidence(context.ownerUrl,count);
    receipt.pol275={migrationCount:catalog.migrationCount,originalTerminal:catalog.terminalMigration};
  };
  const install=exact?installer.withCombinedExpenseWitness:historicalSettlement?installer.withCombined334HistoricalSettlement:
    upwardArchive?installer.withCombined332UpwardArchive:
    paymentRemainder?installer.withCombined331PaymentRemainder:
    textDirect?installer.withCombined330TextAgreement:installer.withCombined320ContractPayment;
  return forward
    ? install(receipt,consume,{
      sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails
    },...(exact?[count]:[]))
    : installer.withCombined295MultiWitness(receipt,consume);
}).then(()=>{
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.installOnly295.count,295);
  assert.equal(receipt.pol275.migrationCount,count);
  if(forward) {
    const terminal=exact?exact.forward(receipt,source):receipt.forward320;
    assert.equal(receipt.installOnly295.ledgerSha256,source.predecessor.ledgerSha256);
    assert.equal(terminal.count,count);
    assert.equal(terminal.sourceTree,source.sourceTree);
    assert.equal(terminal.ledgerSha256,source.ledgerSha256);
    assert.equal(terminal.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  }
  if(exact) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
    assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
  }
  if(profile334) {
    profile334.assertFinanceInstallation(receipt,source);
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  if(profile331) profile331.assertInstallation(receipt,source);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=receipt.purpose+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'POL275_COLD_'+count+'_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
