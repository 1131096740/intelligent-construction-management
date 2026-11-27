'use strict';

const assert = require('node:assert/strict');
const {createHash,randomBytes} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {admitSource} = require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness,withCombinedExpenseWitness349,withCombinedSignedSettlement350,withCombinedCompanyHistory352} = require('./installer.cjs');
const {final, digest} = require('./multi-witness.cjs');
const {verify} = require('./workspace/services/api/prisma/core-payment-runner.cjs');

const root = '/qualification';
const source = require('./contract-finance-source.json');
const mode = process.argv[2];
const current320=source.mode==='current-320';
const textDirect330=source.mode==='text-direct-330';
const upwardArchive332=source.mode==='upward-archive-332';
const paymentRemainder331=source.mode==='payment-remainder-331';
const historicalSettlement334=source.mode==='historical-settlement-334';
const company=source.mode==='company-history-352'?require('./company-history-352-profile.cjs'):undefined;
const signed=company||source.mode==='signed-settlement-350'?require('./signed-settlement-350-profile.cjs'):undefined;
const precision=signed||source.mode==='expense-witness-349'?require('./expense-witness-349-profile.cjs'):undefined;
const expenseWitness346=(precision||source.mode==='expense-witness-346')?require('./expense-witness-346-profile.cjs'):undefined;
const expenseProfile=company??signed??precision??expenseWitness346;
const historical=historicalSettlement334||expenseWitness346?require('./historical-settlement-334-profile.cjs'):undefined;
const forward=current320||textDirect330||paymentRemainder331||upwardArchive332||historicalSettlement334||Boolean(expenseWitness346);
const profile=upwardArchive332?require('./upward-archive-332-profile.cjs'):
  paymentRemainder331?require('./payment-remainder-331-profile.cjs'):
  textDirect330?require('./text-direct-330-profile.cjs'):undefined;
const count=expenseProfile?expenseProfile.count:historicalSettlement334?334:upwardArchive332?332:paymentRemainder331?331:textDirect330?330:current320?329:295;
const receipt = {schemaVersion:1,purpose:'CONTRACT_FINANCE_CORE_OR_PAYMENT_EXACT_'+count,
  scope:mode,sourceSha:source.sourceSha,migrationSha256:forward?source.tails.at(-1).sha256:digest,stages:['INPUTS'],status:'STOPPED'};

async function main() {
  assert.equal(process.argv.length,3);
  assert.ok(['core','payment'].includes(mode));
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  assert.equal(forward?source.predecessor.ledgerSha256:source.ledgerSha256,final);
  profile?.assertSource(source,source.sourceSha,final);
  const baselineModule=require('./workspace/services/api/prisma/migration-baseline.cjs');
  if(expenseWitness346) {
    assert.equal(mode,'core');
    expenseProfile.assertSource(source,final);
    expenseProfile.assertRuntimeBaseline(baselineModule);
    assert.equal(createHash('sha256').update(readFileSync(root+'/installer.cjs')).digest('hex'),expenseProfile.installerSha256);
  } else {
    historical?.assertSource(source,final);
    const baseline=baselineModule.loadCanonicalMigrationBaseline();
    assert.equal(baseline.expectedDirectoryCount,count);
    assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
    assert.equal(baseline.terminalMigrationChecksum,receipt.migrationSha256);
  }
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const consume=async context=>{
    assert.equal(context.database,'jg_task01_'+context.runId.replaceAll('-',''));
    receipt.stages.push(mode==='core'?'ORIGINAL_AGGREGATE_THEN_COMPANY_TRANSFER':'ORIGINAL_PAYMENT_CONCURRENCY');
    profile?.assertInstallation(receipt,source);
    if(expenseWitness346) {
      assert.equal(context.candidateTree,source.sourceTree);
      const historyTails=source.tails.slice(0,source.predecessor334.migrationCount-source.predecessor.migrationCount);
      historical.assertFinanceInstallation(receipt,{...source,tails:historyTails});
      assert.deepEqual(receipt.expenseWitnessForward,{
        count:expenseWitness346.count,ledgerSha256:expenseWitness346.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(historyTails.length,expenseWitness346.count-295).map(({name,sha256})=>({name,sha256}))
      });
      if(precision) assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
        count:precision.count,ledgerSha256:precision.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(expenseWitness346.count-295,precision.count-295).map(({name,sha256})=>({name,sha256}))
      });
    } else {
      historical?.assertFinanceInstallation(receipt,source);
    }
    if(forward&&mode==='core'){
      const key=randomBytes(32).toString('hex');
      const table='public.jg_signed_settlement_attachment_witness_key';
      await context.sql(`INSERT INTO ${table}("key") VALUES(decode('${key}','hex'));`);
      try {
        receipt.finance=await verify(mode,context,count,key);
      } finally {
        await context.sql(`DELETE FROM ${table} WHERE "key"=decode('${key}','hex');`);
        const {stdout}=await context.sql(`SELECT NOT EXISTS(SELECT FROM ${table});`);
        assert.equal(stdout.trim(),'t');
        receipt.settlementReadWitnessCleared=true;
      }
    } else {
      receipt.finance=await verify(mode,context,count);
    }
    const found=receipt.finance.suites.map(({file,passed,skipped})=>[file.split('/').at(-1),passed,skipped]);
    assert.deepEqual(found,mode==='core'
      ? [['contract-business-entry-http.spec.ts',1,7],['company-transfer-http-postgres.spec.ts',1,0]]
      : [['payment-execution-concurrency.spec.ts',2,0]]);
    if(mode==='core'){
      assert.equal(receipt.finance.poolCapacity,2);
      if(forward){
        assert.deepEqual(receipt.finance.historicalContract,{
          versionStatus:'effective',numericProtocolVersion:2,detailVersionMatches:true,
          counterpartyVersionMatches:true,approvalInstances:0
        });
        assert.deepEqual(receipt.finance.approvals,[]);
      }else{
        assert.equal(receipt.finance.approvals.length,5);
        assert.ok(receipt.finance.approvals.every(row=>row.status===201));
      }
      assert.deepEqual(receipt.finance.paymentCapabilities,[{
        supportedDomain:true,allowedActor:true,workflowReady:true,canSupplementVoucher:false,
        allowedStatus:200,deniedStatus:403,matchingPayment:true,canRegisterPayment:true,noNewExecution:true
      }]);
      const rows=receipt.finance.browserObservation;
      assert.equal(rows.length,5);
      assert.deepEqual(rows.slice(0,4).map(row=>[row.project,row.status]),
        [['desktop','passed'],['desktop','passed'],['mobile','passed'],['mobile','passed']]);
      assert.deepEqual(rows[4],{event:'child-exit',code:0,signal:null});
    }
  };
  if(forward){
    const install=expenseWitness346?withCombinedExpenseWitness:historicalSettlement334?withCombined334HistoricalSettlement:upwardArchive332?withCombined332UpwardArchive:paymentRemainder331?withCombined331PaymentRemainder:
      textDirect330?withCombined330TextAgreement:withCombined320ContractPayment;
    const material={sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails};
    if(company) await withCombinedCompanyHistory352(receipt,consume,{...source,...material});
    else if(signed) await withCombinedSignedSettlement350(receipt,consume,{...source,...material});
    else if(precision) await withCombinedExpenseWitness349(receipt,consume,{...source,...material});
    else if(expenseWitness346) await install(receipt,consume,material,count);
    else await install(receipt,consume,material);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,expenseWitness346?source.predecessor334.ledgerSha256:source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  if(historical) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  if(expenseWitness346) {
    assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.settlementReadWitnessCleared,true);
  }
  if(precision) assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
  if(company) company.assertInstallation(receipt,source);
  else signed?.assertInstallation(receipt,source);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='CONTRACT_FINANCE_'+mode.toUpperCase()+'_'+count+'_PASSED';
}

main().catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'CONTRACT_FINANCE_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,failedTest:error.failedTest,
    diagnostic:error.diagnostic,denied:error.denied,passed:error.passed,browserObservation:error.browserObservation,completedSuites:error.completedSuites,
    approvals:error.approvals,paymentCapabilities:error.paymentCapabilities,historicalContract:error.historicalContract,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
