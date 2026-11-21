'use strict';
const assert=require('node:assert/strict');
const lane=process.argv[2];
assert.ok(process.argv.length===3 && ['execution','finance','receipt'].includes(lane));
const receipt={schemaVersion:1,purpose:'ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_290_SOURCE',lane,business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>require('./installer.cjs').withOutside290Fresh(receipt,lane)).then(()=>{
  throw Error('EXPENSE_HISTORICAL_UNEXPECTED_COMPLETION');
}).catch(error=>{
  const count={
    execution:()=>receipt.expenseExecutionRetainedNegatives?.observed?.length===13,
    finance:()=>receipt.financeRetainedNegatives?.observed?.length===require('./task12-expense-finance-retained-negative.json').rows.length+1,
    receipt:()=>receipt.expenseReceiptNegatives?.cases?.length===7,
  };
  if (error.message==='EXPENSE_ORIGINAL_NEGATIVES_PRE_203_COMPLETE'&&count[lane]()&&
      receipt.business==='NOT_ENTERED'&&receipt.installOnly290===undefined&&
      receipt.cleanup==='POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT') {
    receipt.status='ORIGINAL_EXPENSE_HISTORICAL_NEGATIVES_PASSED';
    return;
  }
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/u.test(code)?code:'EXPENSE_HISTORICAL_UNCLASSIFIED',sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
