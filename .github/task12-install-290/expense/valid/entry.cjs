'use strict';
const assert=require('node:assert/strict');
const lane=process.argv[2];
assert.ok(process.argv.length===3 && ['execution','finance','receipt'].includes(lane));
const receipt={schemaVersion:1,purpose:'ORIGINAL_EXPENSE_290_RETAINED_VALID_ONLY',lane,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>require('./installer.cjs').withOutside290Fresh(receipt,lane)).then(()=>{
  assert.equal(receipt.installOnly290?.count,290);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  if(lane==='execution') assert.equal(receipt.retainedExpenseExecution.legacyKeyCount,2);
  else if(lane==='finance') assert.equal(receipt.retainedFinanceValid.after290,'1|1|400');
  else assert.equal(receipt.retainedReceipt.originalLegacyKeyNull,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_EXPENSE_290_RETAINED_VALID_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/u.test(code)?code:'EXPENSE_290_UNCLASSIFIED',sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
