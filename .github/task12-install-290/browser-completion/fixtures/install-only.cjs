'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {withExact290CompletionBrowser}=require('./installer.cjs');
const {runTask398Owned282Voucher}=require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');
const receipt={schemaVersion:1,purpose:'TASK398_BROWSER_COMPLETION_EXACT_290',business:'NOT_ENTERED',stages:['INPUTS']};
Promise.resolve().then(()=>{
  for (const [file,digest] of Object.entries(require('./workspace-inputs.json'))) {
    assert.equal(createHash('sha256').update(readFileSync(join('/qualification/workspace',file))).digest('hex'),digest,'TASK398_BROWSER_WORKSPACE_SOURCE');
  }
  assert.equal(require('/qualification/workspace/apps/web-admin/node_modules/vite/package.json').version,'5.4.21','TASK398_BROWSER_VITE_VERSION');
  return withExact290CompletionBrowser(receipt, context=>runTask398Owned282Voucher(context,'browser-completion-290',receipt));
}).then(()=>{
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.installOnly290?.count,290);
  assert.deepEqual(receipt.original,{business:1,passed:1,skipped:0,evidenceStatus:'BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE'});
  assert.equal(receipt.postBehavior290?.keyUnprovisioned,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='TASK398_BROWSER_COMPLETION_EXACT_290_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'TASK398_BROWSER_290_BEHAVIOR_FAILED'};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
