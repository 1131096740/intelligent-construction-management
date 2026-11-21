'use strict';

const assert=require('node:assert/strict');
const receipt={schemaVersion:1,purpose:'EXACT_290_INSTALL_ONLY',business:'NOT_ENTERED',stages:[]};
require('./installer.cjs').withOutside290InstallOnly(receipt).then(()=>{
  assert.equal(receipt.releaseTree,'23b1c98bc15f36e986d17059579e6673315b9be8');
  assert.equal(receipt.installOnly290.count,290);
  assert.equal(receipt.business,'NOT_ENTERED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify({...receipt,status:'EXACT_290_INSTALL_ONLY_PASSED'}));
}).catch(error=>{
  const candidate=error.code??error.message;
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
    stage:receipt.stages.at(-1)??'INPUTS',code:/^[A-Z0-9_]+$/u.test(candidate)?candidate:'INSTALL_ONLY_290_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
  }}));
  process.exitCode=1;
});
