'use strict';
const assert = require('node:assert/strict');
const {sourceSha} = require('./contract-finance-source.json');
const {withCombined295MultiWitness} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const receipt = {schemaVersion:1,sourceSha,purpose:'TASK398_BROWSER_COMPLETION_EXACT_295',business:'NOT_ENTERED',stages:[]};
withCombined295MultiWitness(receipt, async context => {
  assert.equal(require("/qualification/workspace/apps/web-admin/node_modules/vite/package.json").version,"5.4.21");
  await runTask398Owned282Voucher(context,'browser-completion-295',receipt);
}).then(() => {
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:1,skipped:0,evidenceStatus:"BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE"});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = 'TASK398_BROWSER_COMPLETION_EXACT_295_PASSED';
}).catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_BROWSER_COMPLETION_295_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
