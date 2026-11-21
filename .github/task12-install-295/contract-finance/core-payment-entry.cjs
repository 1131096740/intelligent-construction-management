'use strict';

const assert = require('node:assert/strict');
const {admitSource} = require('./install-only292.cjs');
const {withCombined295MultiWitness} = require('./installer.cjs');
const {final, digest} = require('./multi-witness.cjs');
const {verify} = require('./workspace/services/api/prisma/core-payment-runner.cjs');

const root = '/qualification';
const source = require('./contract-finance-source.json');
const mode = process.argv[2];
const receipt = {schemaVersion:1,purpose:'CONTRACT_FINANCE_CORE_OR_PAYMENT_EXACT_295',
  scope:mode,sourceSha:source.sourceSha,migrationSha256:digest,stages:['INPUTS'],status:'STOPPED'};

async function main() {
  assert.equal(process.argv.length,3);
  assert.ok(['core','payment'].includes(mode));
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,final);
  const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
  assert.equal(baseline.expectedDirectoryCount,295);
  assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
  assert.equal(baseline.terminalMigrationChecksum,digest);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await withCombined295MultiWitness(receipt,async context=>{
    assert.equal(context.database,'jg_task01_'+context.runId.replaceAll('-',''));
    receipt.stages.push(mode==='core'?'ORIGINAL_AGGREGATE_THEN_COMPANY_TRANSFER':'ORIGINAL_PAYMENT_CONCURRENCY');
    receipt.finance=await verify(mode,context);
    const found=receipt.finance.suites.map(({file,passed,skipped})=>[file.split('/').at(-1),passed,skipped]);
    assert.deepEqual(found,mode==='core'
      ? [['contract-business-entry-http.spec.ts',1,7],['company-transfer-http-postgres.spec.ts',1,0]]
      : [['payment-execution-concurrency.spec.ts',2,0]]);
    if(mode==='core'){
      assert.equal(receipt.finance.poolCapacity,2);
      assert.equal(receipt.finance.approvals.length,5);
      assert.ok(receipt.finance.approvals.every(row=>row.status===201));
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
  });
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=mode==='core'?'CONTRACT_FINANCE_CORE_295_PASSED':'CONTRACT_FINANCE_PAYMENT_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'CONTRACT_FINANCE_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,failedTest:error.failedTest,
    diagnostic:error.diagnostic,denied:error.denied,passed:error.passed,browserObservation:error.browserObservation,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
