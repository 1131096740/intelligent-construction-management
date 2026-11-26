'use strict';
const assert=require('node:assert/strict');
const source=require('./contract-finance-source.json');
const {sourceSha}=source;
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement}=require('./installer.cjs');
const lane=process.argv[2];
assert.ok(['warm','collision'].includes(lane));
const requestedMode=process.argv[3];
const textDirect=requestedMode==='--text-direct-330';
const paymentRemainder=requestedMode==='--payment-remainder-331';
const historicalSettlement=requestedMode==='--historical-settlement-334';
const upwardArchive=requestedMode==='--upward-archive-332';
const forward=historicalSettlement||upwardArchive||paymentRemainder||textDirect||requestedMode==='--current-320';
const count=historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:forward?329:295;
const profile331=paymentRemainder?require('./payment-remainder-331-profile.cjs'):undefined;
const profile334=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const profile332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
const purpose='ORIGINAL_POL275_'+lane.toUpperCase()+'_EXACT_'+count;
const receipt={schemaVersion:1,sourceSha,purpose,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(process.argv.length,forward?4:3);
  assert.equal(source.migrationCount,count);
  if(forward) {
    assert.equal(lane,'warm','POL275_COLLISION_320_FORBIDDEN');
    const profile=profile332??profile331;
    if(profile334) profile334.assertSource(source,require('./multi-witness.cjs').final);
    else if(profile) profile.assertSource(source,sourceSha,require('./multi-witness.cjs').final);
    else {
      assert.equal(source.mode,requestedMode.slice(2));
      assert.equal(source.predecessor.migrationCount,295);
    }
  }
  const material=forward ? {sourceTree:source.sourceTree,count,
    migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails} : undefined;
  const consume=lane==='warm' ? context=>{
    profile334?.assertFinanceInstallation(receipt,source);
    profile332?.assertInstallation(receipt,source);
    return require('./pol275.cjs').verifyPol275(context,receipt,true,material);
  } : undefined;
  const install=historicalSettlement?withCombined334HistoricalSettlement:
    upwardArchive?withCombined332UpwardArchive:
    paymentRemainder?withCombined331PaymentRemainder:
    textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
  return forward
    ? install(receipt,consume,material)
    : withCombined295MultiWitness(receipt,consume);
}).then(()=>{
  if(lane==='warm'){
    assert.deepEqual(receipt.pol275History,{sameInstance:true,prefix:165,terminal:166});
    assert.equal(receipt.business,'CALLBACK_COMPLETED');
    assert.equal(receipt.installOnly295.count,295);
    assert.equal(receipt.combinedAfterBusiness.exactB7,true);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.pol275.migrationCount,count);
    if (forward) {
      assert.equal(receipt.installOnly295.ledgerSha256,source.predecessor.ledgerSha256);
      assert.equal(receipt.forward320.count,count);
      assert.equal(receipt.forward320.sourceTree,source.sourceTree);
      assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
      assert.equal(receipt.forward320.sameBaseB7,true);
      assert.equal(receipt.combinedAfterBusiness.count,count);
      assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
    }
    if(profile334) {
      profile334.assertFinanceInstallation(receipt,source);
      assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
      assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
    }
    if(profile331) profile331.assertInstallation(receipt,source);
    assert.equal(receipt.currentProcess.passed,10);
    assert.equal(receipt.legacyProcess.passed,1);
  } else {
    assert.deepEqual(receipt.pol275Collision,{prefix:165,migration:166,membershipGuardSqlstate:'42501',
      unsafeMembershipRejected:true,terminalMigrationFinished:false,
      terminalTablesAbsent:true,terminalConstraintsAbsent:true});
    assert.equal(receipt.business,'NOT_ENTERED');
    assert.equal(receipt.installOnly295,undefined);
    assert.equal(receipt.forward320,undefined);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=purpose+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'POL275_'+count+'_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
