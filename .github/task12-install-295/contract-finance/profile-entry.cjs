'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitnessForProfile,withCombined320MultiWitnessForProfile,withCombined330MultiWitnessForProfile,withCombined331MultiWitnessForProfile,withCombined332MultiWitnessForProfile,withCombined334MultiWitnessForProfile,withCombined346MultiWitnessForProfile,withCombined349MultiWitnessForProfile,withCombined350MultiWitnessForProfile}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {runRetained,verifyInputs}=require('./remaining-retained.cjs');
const source=require('./contract-finance-source.json');
const signed=source.mode==='signed-settlement-350';
const expense=['expense-witness-346','expense-witness-349','signed-settlement-350'].includes(source.mode)?
  require('./'+source.mode+'-profile.cjs'):undefined;
const historicalSettlement=source.mode==='historical-settlement-334';
const historical=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const textDirect=source.mode==='text-direct-330';
const current=expense||historicalSettlement||upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=expense?expense.count:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current?329:295;
const root='/qualification';
const lane='profile';
const receipt={schemaVersion:1,purpose:'REMAINING_PROFILE_WARM_EXACT_'+count,lane,sourceSha:source.sourceSha,
  migrationSha256:current?source.tails.at(-1).sha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

async function main(){
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
  const rows=verifyInputs(lane);
  assert.equal(rows.length,1);
  assert.equal(rows[0].pending,2);
  if(upwardArchive) require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  historical?.assertSource(source,final);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const consume=context=>runRetained(context,receipt,lane);
  if(expense){
    const installExpense=signed?withCombined350MultiWitnessForProfile:
      count===349?withCombined349MultiWitnessForProfile:withCombined346MultiWitnessForProfile;
    await installExpense(receipt,consume,{...source,
      migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails});
    if(!signed) require('./payment-execution-'+count+'.cjs').assertInstallation(receipt,source);
  } else if(current){
    const installCurrent=historicalSettlement?withCombined334MultiWitnessForProfile:upwardArchive?withCombined332MultiWitnessForProfile:paymentRemainder?withCombined331MultiWitnessForProfile:textDirect?withCombined330MultiWitnessForProfile:withCombined320MultiWitnessForProfile;
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
    await withCombined295MultiWitnessForProfile(receipt,consume);
  }
  assert.equal(receipt.retainedOriginal.mode,lane);
  assert.equal(receipt.retainedOriginal.exit,0);
  assert.equal(receipt.retainedOriginal.seen.length,rows.length);
  if(expense){
    assert.equal(receipt.retainedOriginal.seen[0].passed,2);
    assert.equal(receipt.retainedOriginal.seen[0].skipped,0);
  }
  assert.equal(receipt.profileHistory.prefix,125);
  assert.equal(receipt.profileHistory.backfill,126);
  assert.equal(receipt.profileHistory.sameInstance,true);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historicalSettlement||signed) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  if(signed) {
    assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_PROFILE_WARM_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_PROFILE_WARM_'+count+'_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
