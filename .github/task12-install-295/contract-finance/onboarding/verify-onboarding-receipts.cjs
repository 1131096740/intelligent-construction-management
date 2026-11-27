'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const old=process.argv[4];
const source=process.argv[6] ? require(process.argv[6]) : null;
const current320=source?.mode==='current-320';
const textDirect330=source?.mode==='text-direct-330';
const paymentRemainder331=source?.mode==='payment-remainder-331';
const upwardArchive332=source?.mode==='upward-archive-332';
const historical=source?.mode==='historical-settlement-334'?require('../historical-settlement-334-profile.cjs'):undefined;
const expenseWitness=['expense-witness-346','expense-witness-349','signed-settlement-350'].includes(source?.mode)
  ?require('../'+source.mode+'-profile.cjs'):undefined;
const forward=expenseWitness||current320||textDirect330||paymentRemainder331||upwardArchive332||historical;
const profile=upwardArchive332?require('../upward-archive-332-profile.cjs'):
  paymentRemainder331?require('../payment-remainder-331-profile.cjs'):
  textDirect330?require('../text-direct-330-profile.cjs'):undefined;
const count=expenseWitness?expenseWitness.count:historical?334:upwardArchive332?332:paymentRemainder331?331:textDirect330?330:current320?329:295;
const scopes=require(path.join(old,'lanes.json'));
const {lanes}=require(path.join(old,'pins.json'));
const scope={tree:'67644d9465a0ab4ee80ede099139d9c129d66f14',expectedLedgerSha256:'b0d398a46c4c6a3209e1448ddd415938ea95425c3d823f1f8a77d81dde396f2d'};
const status={
  'lifecycle-rest':'ONBOARDING_ORIGINAL_NONBROWSER_LIFECYCLE_295_PASSED',
  'downstream':'ONBOARDING_ORIGINAL_INDEPENDENT_27_295_PASSED',
  'roster':'ONBOARDING_FIXED_ORIGINAL_ROSTER10_295_PASSED',
  'roster-read':'ONBOARDING_ORIGINAL_ROSTER_READ_DIRECTORY_295_PASSED',
  'lifecycle-desktop':'ONBOARDING_ORIGINAL_DESKTOP_LIFECYCLE_295_PASSED',
  'lifecycle-mobile':'ONBOARDING_ORIGINAL_MOBILE_LIFECYCLE_295_PASSED',
  'reset-case12':'ONBOARDING_ORIGINAL_DUAL_BROWSER_CASE12_295_PASSED',
};
function verifyLane(lane,receipt) {
  const expected=scopes[lane];
  assert.ok(Object.hasOwn(status,lane)&&expected,'ONBOARDING_295_RECEIPT_LANE');
  assert.equal(receipt.status,status[lane].replace(/_295_PASSED$/u,"_"+count+"_PASSED"));
  assert.equal(receipt.applicationSource.tree,forward?source.sourceTree:scope.tree);
  assert.equal(receipt.applicationSource.lane,lane);
  assert.equal(receipt.applicationSource.fixtureMounts,Object.keys(expected.fixturePins).length);
  assert.equal(receipt.releaseTree,scope.tree);
  assert.equal(receipt.installOnly295.count,295);
  assert.equal(receipt.installOnly295.ledgerSha256,scope.expectedLedgerSha256);
  if(expenseWitness) {
    assert.equal(source.sourceSha,process.argv[5]);
    expenseWitness.assertSource(source,scope.expectedLedgerSha256);
    require('../payment-execution-'+count+'.cjs').assertInstallation(receipt,source);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  }
  if(historical) {
    assert.equal(source.sourceSha,process.argv[5]);
    historical.assertSource(source,scope.expectedLedgerSha256);
    historical.assertFinanceInstallation(receipt,source);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  if(profile) {
    profile.assertSource(source,process.argv[5],scope.expectedLedgerSha256);
    profile.assertInstallation(receipt,source);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  }
  if(forward){
    assert.equal(receipt.forward320.count,expenseWitness?334:count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.forward320.ledgerSha256,expenseWitness?source.predecessor334.ledgerSha256:source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  }
  assert.equal(receipt.sameInstancePostConsume,true);
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.applicationSource.sourceSha,process.argv[5]);
  assert.equal(receipt.onboardingAliasRevoked,true);
  assert.equal(receipt.onboardingVoucherColumnRevoked,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.equal(receipt.onboardingSuites.length,1);
  const suite=receipt.onboardingSuites[0];
  assert.equal(suite.passed,expected.caseCount);
  assert.equal(suite.skipped,expected.expectedFiltered);
  assert.equal(suite.failed,0);
  return {lane,passed:suite.passed};
}
function load(file) {
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function verifyAll(root) {
  const results=lanes.map(lane=>verifyLane(lane,load(path.join(root,lane,'receipt.json'))));
  const canonical=results.filter(result=>result.lane!=='lifecycle-mobile').reduce((sum,result)=>sum+result.passed,0);
  assert.equal(canonical,59);
  return {status:'EMPLOYEE_ONBOARDING_'+count+'_ORIGINAL_DATABASE_SCOPES_PASSED',logicalScopes:6,
    lanes:results,canonical,standalonePersonnelFeedback:'SEPARATE_CI_STEP'};
}
if(require.main===module){
  const [root,lane]=process.argv.slice(2);
  assert.ok(root);
  console.log(JSON.stringify(lane?verifyLane(lane,load(path.join(root,lane,'receipt.json'))):verifyAll(root)));
}
module.exports={verifyLane,verifyAll};
