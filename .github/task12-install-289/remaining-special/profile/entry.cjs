'use strict';
const assert=require('node:assert/strict');
const {withOutside289RemainingRetained}=require('/qualification/installer.cjs');
const mode=process.argv[2];
assert.ok(mode==='cleanup'||mode==='profile');
const receipt={schemaVersion:1,purpose:'ORIGINAL_REMAINING_RETAINED_289_'+mode.toUpperCase(),business:'NOT_ENTERED',stages:[]};
withOutside289RemainingRetained(receipt,mode).then(()=>{
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.orderedTails.at(-1).size,289);
  assert.deepEqual(receipt.postconsume,{count:289,exactB7:true});
  if(mode==='cleanup') assert.deepEqual(receipt.cleanupLegacy,{count:205,exactTerminal:true,distinctDatabase:true,samePostmaster:true,postconsume:true});
  else {
    assert.equal(receipt.profileHistory.prefix,125);
    assert.equal(receipt.profileHistory.backfill,126);
    assert.equal(receipt.profileHistory.sameInstance,true);
  }
  assert.equal(receipt.retainedOriginal.seen.length,mode==='cleanup'?6:1);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:receipt.purpose+'_PASSED'}));
}).catch(error=>{
  const code=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_REMAINING_RETAINED_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
  }}));
  process.exitCode=1;
});
