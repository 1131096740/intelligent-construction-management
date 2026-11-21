'use strict';
const assert=require('node:assert/strict');
const {sourceSha}=require('./contract-finance-source.json');
const {withCombined295MultiWitness}=require('./installer.cjs');
const lane=process.argv[2];
assert.ok(['warm','collision'].includes(lane));
const purpose='ORIGINAL_POL275_'+lane.toUpperCase()+'_EXACT_295';
const receipt={schemaVersion:1,sourceSha,purpose,business:'NOT_ENTERED',stages:[]};
withCombined295MultiWitness(receipt,lane==='warm' ? async context=>{
  await require('./pol275.cjs').verifyPol275(context,receipt,true);
}:undefined).then(()=>{
  if(lane==='warm'){
    assert.deepEqual(receipt.pol275History,{sameInstance:true,prefix:165,terminal:166});
    assert.equal(receipt.business,'CALLBACK_COMPLETED');
    assert.equal(receipt.installOnly295.count,295);
    assert.equal(receipt.combinedAfterBusiness.exactB7,true);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.pol275.migrationCount,295);
    assert.equal(receipt.currentProcess.passed,10);
    assert.equal(receipt.legacyProcess.passed,1);
  } else {
    assert.deepEqual(receipt.pol275Collision,{prefix:165,migration:166,membershipGuardSqlstate:'42501',
      unsafeMembershipRejected:true,terminalMigrationFinished:false,
      terminalTablesAbsent:true,terminalConstraintsAbsent:true});
    assert.equal(receipt.business,'NOT_ENTERED');
    assert.equal(receipt.installOnly295,undefined);
  }
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=purpose+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'POL275_295_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
