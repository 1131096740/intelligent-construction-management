'use strict';
const assert=require('node:assert/strict');
const modes=require('/qualification/installer.cjs');
const lane=process.argv[2];
const map={v7:['withOutside289FundExecution','fundExecutionV7',26],invoice:['withOutside289Invoice','freshOwner',10],pol279:['withOutside289Pol279','freshOwner',4]};
assert.ok(Object.hasOwn(map,lane));
const [method,key,expected]=map[lane];
const receipt={schemaVersion:1,business:'NOT_ENTERED',stages:[]};
modes[method](receipt).then(()=>{
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt[key].passed,expected);
  assert.equal(receipt[key].skipped,0);
  assert.equal(receipt.sameInstancePostConsume,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=receipt.purpose+'_PASSED';
  console.log(JSON.stringify(receipt));
}).catch(error=>{
  const code=error.code??error.message;
  const stage=receipt.stages.at(-1);
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{stage:typeof stage==='string'?stage:stage?.stage??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_FRESH289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit}}));
  process.exitCode=1;
});
