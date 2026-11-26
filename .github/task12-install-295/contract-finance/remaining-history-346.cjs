'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const expense = require('./expense-witness-346-profile.cjs');
const historical = require('./historical-settlement-334-profile.cjs');
const api = '/qualification/workspace/services/api';

function assertInputs(source) {
  assert.equal(source.sourceSha,process.env.JG_REMAINING_HISTORY_SOURCE_SHA,'REMAINING_HISTORY_346_SHA');
  expense.assertSource(source,require('./multi-witness.cjs').final);
  require('./migration-inputs-346.cjs')(api,source,expense);
  const hash=createHash('sha256').update(readFileSync(__dirname+'/installer.cjs')).digest('hex');
  assert.equal(hash,expense.installerSha256,'REMAINING_HISTORY_346_INSTALLER');
}

function assertForward(receipt,source) {
  historical.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
  assert.deepEqual(receipt.expenseWitnessForward,{
    count:346,sourceTree:source.sourceTree,ledgerSha256:source.ledgerSha256,sameIdentity:true,
    tails:source.tails.slice(39).map(({name,sha256})=>({name,sha256}))
  },'REMAINING_HISTORY_346_FORWARD');
}

async function install(receipt,source,consume) {
  const {withCombinedExpenseWitness}=require('./installer.cjs');
  await withCombinedExpenseWitness(receipt,async context=>{
    assert.equal(context.candidateTree,source.sourceTree);
    assert.equal(receipt.installOnly295.nonOwnerDenied,true);
    assertForward(receipt,source);
    await consume(context);
  },{sourceTree:source.sourceTree,migrations:api+'/prisma/migrations',tails:source.tails},346);
  assertForward(receipt,source);
  assert.equal(receipt.combinedAfterBusiness.count,346);
  assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
}

module.exports={assertInputs,install};
