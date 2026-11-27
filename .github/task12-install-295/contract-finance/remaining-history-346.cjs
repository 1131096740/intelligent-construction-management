'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const historical = require('./historical-settlement-334-profile.cjs');
const api = '/qualification/workspace/services/api';

function assertInputs(source) {
  const expense=require('./'+source.mode+'-profile.cjs');
  const {count}=expense;
  assert.equal(source.sourceSha,process.env.JG_REMAINING_HISTORY_SOURCE_SHA,'REMAINING_HISTORY_'+count+'_SHA');
  expense.assertSource(source,require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')(api,source,expense);
  const hash=createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(hash,expense.installerSha256,'REMAINING_HISTORY_'+count+'_INSTALLER');
}

function assertForward(receipt,source) {
  historical.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
  const signed=source.mode==='signed-settlement-350';
  const precision=signed||source.mode==='expense-witness-349';
  const witness=precision?source.predecessor346:source;
  const boundary=witness.migrationCount-source.predecessor.migrationCount;
  assert.deepEqual(receipt.expenseWitnessForward,{
    count:346,sourceTree:source.sourceTree,ledgerSha256:witness.ledgerSha256,sameIdentity:true,
    tails:source.tails.slice(39,boundary).map(({name,sha256})=>({name,sha256}))
  },'REMAINING_HISTORY_346_FORWARD');
  if(precision) {
    const checkpoint=signed?source.predecessor349:source;
    const end=checkpoint.migrationCount-source.predecessor.migrationCount;
    assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
      count:349,sourceTree:source.sourceTree,ledgerSha256:checkpoint.ledgerSha256,sameIdentity:true,
      tails:source.tails.slice(boundary,end).map(({name,sha256})=>({name,sha256}))
    },'REMAINING_HISTORY_349_FORWARD');
    if(signed) assert.deepEqual(receipt.signedSettlementForward,{
      count:350,sourceTree:source.sourceTree,ledgerSha256:source.ledgerSha256,sameIdentity:true,
      tails:source.tails.slice(end).map(({name,sha256})=>({name,sha256}))
    },'REMAINING_HISTORY_350_FORWARD');
  }
}

async function install(receipt,source,consume) {
  const signed=source.mode==='signed-settlement-350';
  const precision=signed||source.mode==='expense-witness-349';
  const {withCombinedExpenseWitness,withCombinedExpenseWitness349,withCombinedSignedSettlement350}=require('./installer.cjs');
  const consumeOwned=async context=>{
    assert.equal(context.candidateTree,source.sourceTree);
    assert.equal(receipt.installOnly295.nonOwnerDenied,true);
    assertForward(receipt,source);
    await consume(context);
  };
  const material={sourceTree:source.sourceTree,migrations:api+'/prisma/migrations',tails:source.tails};
  if(signed) await withCombinedSignedSettlement350(receipt,consumeOwned,{...source,...material});
  else if(precision) await withCombinedExpenseWitness349(receipt,consumeOwned,{...source,...material});
  else await withCombinedExpenseWitness(receipt,consumeOwned,material,346);
  assertForward(receipt,source);
  assert.equal(receipt.combinedAfterBusiness.count,source.migrationCount);
  if(signed) require('./signed-settlement-350-profile.cjs').assertInstallation(receipt,source);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
  if(precision) assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
}

module.exports={assertInputs,install};
