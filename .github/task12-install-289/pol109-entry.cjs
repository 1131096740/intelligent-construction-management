'use strict';
const assert=require('node:assert/strict');
const {withOutside289Pol109}=require('/qualification/installer.cjs');
const receipt={schemaVersion:1,purpose:'ORIGINAL_POL109_EXACT_289',business:'NOT_ENTERED',stages:[]};
withOutside289Pol109(receipt).then(()=>{
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.jest,{passed:8,suites:2,failed:0,skipped:0,postgresql:7,http:1});
  assert.deepEqual(receipt.browser,{passed:5,failed:0,flakes:0,skipped:0});
  assert.equal(receipt.nestHealth,true);
  assert.equal(receipt.nestCleanup,true);
  assert.deepEqual(receipt.postconsume,{count:289,exactB7:true});
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:'ORIGINAL_POL109_289_PASSED'}));
}).catch(error=>{
  const code=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_POL109_289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
  }}));
  process.exitCode=1;
});
