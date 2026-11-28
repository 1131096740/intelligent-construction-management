'use strict';
const assert=require('node:assert/strict');
const installer=require('/qualification/installer.cjs');
const lane=process.argv[2],methods={cold:'withOutside289Pol275Cold',warm:'withOutside289Pol275Warm',collision:'withOutside289Pol275Collision'};
assert.ok(Object.hasOwn(methods,lane));
const receipt={schemaVersion:1,purpose:'ORIGINAL_POL275_EXACT_289_'+lane.toUpperCase(),business:'NOT_ENTERED',stages:[]};
installer[methods[lane]](receipt).then(()=>{
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  if(lane==='collision') {
    assert.equal(receipt.pol275Collision.membershipGuardSqlstate,'42501');
    assert.equal(receipt.pol275Collision.terminalTablesAbsent,true);
    assert.equal(receipt.pol275Collision.terminalConstraintsAbsent,true);
    assert.equal(receipt.business,'NOT_ENTERED');
  } else {
    assert.equal(receipt.business,'CALLBACK_COMPLETED');
    assert.equal(receipt.pol275.migrationCount,289);
    assert.deepEqual(receipt.postconsume,{count:289,exactB7:true});
    if(lane==='warm') {
      assert.deepEqual(receipt.pol275History,{sameInstance:true,prefix:165,terminal:166});
      assert.equal(receipt.currentProcess.passed,10);
      assert.equal(receipt.legacyProcess.passed,1);
    }
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:receipt.purpose+'_PASSED'}));
}).catch(error=>{
  const code=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_POL275_289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
  }}));
  process.exitCode=1;
});
