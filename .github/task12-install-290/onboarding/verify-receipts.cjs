'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const scopes=require('./lanes.json');
const {lanes}=require('./pins.json');
const scope=require('./scope.json');
const status={
  'lifecycle-rest':'ONBOARDING_ORIGINAL_NONBROWSER_LIFECYCLE_290_PASSED',
  'downstream':'ONBOARDING_ORIGINAL_INDEPENDENT_27_290_PASSED',
  'roster':'ONBOARDING_FIXED_ORIGINAL_ROSTER10_290_PASSED',
  'roster-read':'ONBOARDING_ORIGINAL_ROSTER_READ_DIRECTORY_290_PASSED',
  'lifecycle-desktop':'ONBOARDING_ORIGINAL_DESKTOP_LIFECYCLE_290_PASSED',
  'lifecycle-mobile':'ONBOARDING_ORIGINAL_MOBILE_LIFECYCLE_290_PASSED',
  'reset-case12':'ONBOARDING_ORIGINAL_DUAL_BROWSER_CASE12_290_PASSED',
};
function verifyLane(lane,receipt) {
  const expected=scopes[lane];
  assert.ok(Object.hasOwn(status,lane)&&expected,'ONBOARDING_290_RECEIPT_LANE');
  assert.equal(receipt.status,status[lane]);
  assert.equal(receipt.applicationSource.tree,scope.tree);
  assert.equal(receipt.applicationSource.lane,lane);
  assert.equal(receipt.applicationSource.fixtureMounts,Object.keys(expected.fixturePins).length);
  assert.equal(receipt.releaseTree,scope.tree);
  assert.equal(receipt.installOnly290.count,290);
  assert.equal(receipt.installOnly290.ledgerSha256,scope.expectedLedgerSha256);
  assert.equal(receipt.sameInstancePostConsume,true);
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
  return {status:'EMPLOYEE_ONBOARDING_290_ORIGINAL_DATABASE_SCOPES_PASSED',logicalScopes:6,
    lanes:results,canonical,standalonePersonnelFeedback:'SEPARATE_CI_STEP'};
}
if(require.main===module){
  const [root,lane]=process.argv.slice(2);
  assert.ok(root);
  console.log(JSON.stringify(lane?verifyLane(lane,load(path.join(root,lane,'receipt.json'))):verifyAll(root)));
}
module.exports={verifyLane,verifyAll};
