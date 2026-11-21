'use strict';
const assert = require('node:assert/strict');
const {sourceSha} = require('./contract-finance-source.json');
const {withCombined295MultiWitness} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const [lane] = process.argv.slice(2);
assert.ok(process.argv.length===3&&['cash-handover','principal-return'].includes(lane));
const receipt = {schemaVersion:1,sourceSha,lane,purpose:'TASK398_CASH_PRINCIPAL_EXACT_295',business:'NOT_ENTERED',stages:[]};
withCombined295MultiWitness(receipt, async context => {
  await runTask398Owned282Voucher(context,lane+'-295',receipt);
}).then(() => {
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:1,skipped:0});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = 'TASK398_CASH_PRINCIPAL_EXACT_295_PASSED';
}).catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:error.cashPhase ?? receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK398_CASH_PRINCIPAL_295_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
