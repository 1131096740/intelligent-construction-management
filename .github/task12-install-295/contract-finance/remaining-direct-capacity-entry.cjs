'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const {consume}=require('./remaining-direct-capacity.cjs');

const root='/qualification';
const source=require('./contract-finance-source.json');
const expense=['expense-witness-346','expense-witness-349','signed-settlement-350','company-history-352'].includes(source.mode)
  ?require('./payment-execution-'+source.migrationCount+'.cjs'):undefined;
const historicalSettlement=source.mode==='historical-settlement-334';
const historical=historicalSettlement?require('./historical-settlement-334-profile.cjs'):undefined;
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const textDirect=source.mode==='text-direct-330';
const current=expense||historicalSettlement||upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=expense?source.migrationCount:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current?329:295;
const receipt={schemaVersion:1,purpose:'REMAINING_DIRECT_CAPACITY_'+count,
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  const predecessor=current?source.predecessor:source;
  assert.equal(predecessor.migrationCount,295);
  assert.equal(predecessor.ledgerSha256,final);
  assert.equal(predecessor.tails.at(-1).sha256,digest);
  if(upwardArchive) require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  historical?.assertSource(source,final);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const verify=context=>consume(context,receipt);
  if(expense){
    const readAcl=async context=>{
      const result=await context.sql("SELECT jsonb_build_object('database',d.datacl,'publicSchema',n.nspacl) " +
        "FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_namespace n " +
        "WHERE d.datname=current_database() AND n.nspname='public'");
      const acl=JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(acl).sort(),['database','publicSchema']);
      return acl;
    };
    await expense.install(receipt,async context=>{
      const before=await readAcl(context);
      await verify(context);
      assert.deepEqual(await readAcl(context),before,'REMAINING_DIRECT_'+count+'_ACL_CHANGED');
      receipt.directCapacityAcl={databaseAndPublicSchemaUnchanged:true};
    },source);
    expense.assertInstallation(receipt,source);
  } else if(current){
    const installCurrent=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await installCurrent(receipt,verify,{
      sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    historical?.assertFinanceInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,verify);
  }
  assert.deepEqual(receipt.directCapacity,{passed:1,skipped:0,bootstrapOid:10,tls:true});
  if(expense)assert.deepEqual(receipt.directCapacityAcl,{databaseAndPublicSchemaUnchanged:true});
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historicalSettlement) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_DIRECT_CAPACITY_'+count+'_PASSED';
}

main().catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_DIRECT_CAPACITY_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
