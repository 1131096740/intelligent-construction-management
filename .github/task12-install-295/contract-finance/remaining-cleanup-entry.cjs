'use strict';

const assert = require('node:assert/strict');
const {admitSource} = require('./install-only292.cjs');
const {withCombined295RetainedCleanup,withCombined320RetainedCleanup,withCombined330RetainedCleanup,withCombined331RetainedCleanup,withCombined332RetainedCleanup,withCombined334RetainedCleanup,withCombined346RetainedCleanup} = require('./installer.cjs');
const {final, digest} = require('./multi-witness.cjs');
const {runRetained} = require('./remaining-retained.cjs');

const root = '/qualification';
const source = require('./contract-finance-source.json');
const expense=source.mode==='expense-witness-346'?require('./expense-witness-346-profile.cjs'):undefined;
const historicalSettlement=source.mode==='historical-settlement-334';
const historical=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const textDirect=source.mode==='text-direct-330';
const current=expense||historicalSettlement||upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=expense?expense.count:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current?329:295;
const receipt = {schemaVersion:1,purpose:'REMAINING_RETAINED_CLEANUP_'+count,
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main() {
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  assert.equal(current?source.predecessor.ledgerSha256:source.ledgerSha256,final);
  assert.equal((current?source.predecessor.tails:source.tails).at(-1).sha256,digest);
  if(expense){
    expense.assertSource(source,final);
    expense.assertRuntimeBaseline(require('./workspace/services/api/prisma/migration-baseline.cjs'));
  } else if(current){
    assert.equal(source.predecessor.migrationCount,295);
    const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
    assert.equal(baseline.expectedDirectoryCount,count);
    assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
    assert.equal(baseline.terminalMigrationChecksum,source.tails.at(-1).sha256);
  }
  if(upwardArchive) require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  historical?.assertSource(source,final);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const consume=context=>runRetained(context,receipt,'cleanup');
  if(expense){
    await withCombined346RetainedCleanup(receipt,consume,{sourceTree:source.sourceTree,
      migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails});
    require('./payment-execution-346.cjs').assertInstallation(receipt,source);
  } else if(current){
    const installCurrent=historicalSettlement?withCombined334RetainedCleanup:upwardArchive?withCombined332RetainedCleanup:paymentRemainder?withCombined331RetainedCleanup:textDirect?withCombined330RetainedCleanup:withCombined320RetainedCleanup;
    await installCurrent(receipt,consume,{sourceTree:source.sourceTree,
      migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails});
    assert.equal(receipt.forward320.count,count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameIdentity,true);
    assert.equal(receipt.forward320.sameBaseB7,true);
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    historical?.assertFinanceInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295RetainedCleanup(receipt,consume);
  }
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historicalSettlement) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.deepEqual(receipt.cleanupLegacy,{count:205,exactTerminal:true,distinctDatabase:true,samePostmaster:true,postconsume:true});
  assert.deepEqual(receipt.cleanupLegacyAcl,{primaryUnchanged:true,legacyOwnerAndQualifiedAppOnly:true,publicDenied:true,
    unrelatedLoginDenied:true,postconsume:true});
  assert.equal(receipt.retainedOriginal.originalPgPassed,21);
  assert.equal(receipt.retainedOriginal.originalModelPassed,10);
  assert.equal(receipt.retainedOriginal.exact,true);
  assert.equal(receipt.retainedOriginal.seen.length,6);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_RETAINED_CLEANUP_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_RETAINED_CLEANUP_'+count+'_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
