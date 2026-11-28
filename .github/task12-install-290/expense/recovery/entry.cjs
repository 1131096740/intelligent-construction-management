'use strict';
const assert=require('node:assert/strict');
const lane=process.argv[2];
assert.ok(process.argv.length===3 && ['execution','finance'].includes(lane));
const receipt={schemaVersion:1,purpose:'ORIGINAL_EXPENSE_290_SAME_INSTANCE_RECOVERY_ONLY',lane,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  const {withOutside290ExpenseRecovery}=require('./installer.cjs');
  if(typeof withOutside290ExpenseRecovery!=='function') throw new Error('EXPENSE_RECOVERY_ENTRY_EXPORT');
  return withOutside290ExpenseRecovery(receipt,lane);
}).then(()=>{
  assert.equal(receipt.installOnly290?.count,290);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.expenseRecovery?.PrismaResolve,true);
  assert.equal(receipt.expenseRecovery?.expectedFailure,true);
  assert.equal(receipt.expenseRecovery?.prefix,lane==='execution'?110:111);
  assert.equal(receipt.expenseRecovery?.terminal,lane==='execution'?111:112);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_EXPENSE_290_SAME_INSTANCE_RECOVERY_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/u.test(code)?code:'EXPENSE_290_UNCLASSIFIED',sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
