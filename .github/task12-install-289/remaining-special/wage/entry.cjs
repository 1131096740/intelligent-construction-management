'use strict';
const assert = require('node:assert/strict');
const {withOutside289Wage} = require('./installer.cjs');
const receipt = {purpose:'ORIGINAL_WAGE_EXACT_289',...require('./hypothesis.json'),business:'NOT_ENTERED',stages:[]};
withOutside289Wage(receipt).then(() => {
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.wageHistory.noopAndStatus,true);
  assert.equal(receipt.wageJest.exact,true);
  assert.deepEqual(receipt.postconsume,{count:289,exactB7:true});
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:'ORIGINAL_WAGE_EXACT_289_PASSED'}));
}).catch(error => {
  const code=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_WAGE_289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
  }}));
  process.exitCode=1;
});
