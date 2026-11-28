'use strict';
const assert=require('node:assert/strict');
const {withOutside289Pfq}=require('/qualification/installer.cjs');
const lane=process.argv[2];
const expected={
  'pre115-clean':{prefix:114},
  'pre116-legacy':{prefix:115,immutable:true},
  duplicate:{kind:'duplicate'},
  'cross-business':{kind:'cross_business'},
  'replacement-child':{kind:'replacement_child'},
  'replacement-parent':{kind:'replacement_parent'},
  app:{businessCases:13,connectionCases:1},
};
assert.ok(Object.hasOwn(expected,lane));
const mode='--pfq-'+lane+'-289-local';
const receipt={schemaVersion:1,purpose:'ORIGINAL_PFQ_EXACT_289',lane,business:'NOT_ENTERED',stages:[]};
withOutside289Pfq(receipt,mode).then(()=>{
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.deepEqual(receipt.pfqPostconsume,{count:289,exactB7:true});
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.orderedTails.at(-1).size,289);
  const shape=expected[lane];
  if(shape.prefix){
    assert.equal(receipt.pfqPositive.prefix,shape.prefix);
    assert.equal(receipt.pfqPositive.mode,mode);
    assert.equal(receipt.pfqPositive.exactOriginalValues,true);
    if(shape.immutable) assert.equal(receipt.pfqPositive.immutable,true);
  } else if(shape.kind) {
    const r=receipt.pfqRecovery;
    assert.equal(r.kind,shape.kind);
    assert.equal(r.markerInPostgres,true);
    assert.equal(r.PrismaResolve,true);
    assert.equal(r.originalRowPreserved,true);
    assert.equal(r.historicalNull,true);
    if(shape.kind!=='duplicate'){
      assert.equal(r.caseSpecificBindingConfirmed,true);
      assert.equal(r.caseSpecificBindingCleared,true);
    }
  } else {
    assert.equal(receipt.pfqAppMigrationStatus,true);
    assert.equal(receipt.pfqApp.businessCases,shape.businessCases);
    assert.equal(receipt.pfqApp.connectionCases,shape.connectionCases);
    assert.equal(receipt.pfqApp.sessions,4);
    assert.equal(receipt.pfqApp.sessionAttestationRounds,2);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:'ORIGINAL_PFQ_EXACT_289_PASSED'}));
}).catch(error=>{
  const code=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_PFQ_289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,recoveryObservation:error.recoveryObservation,
  }}));
  process.exitCode=1;
});
