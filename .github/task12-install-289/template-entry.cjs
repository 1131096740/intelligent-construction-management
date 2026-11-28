'use strict';
const assert = require('node:assert/strict');
const { withOutside289ContractTemplate } = require('/qualification/installer.cjs');
const receipt = { schemaVersion:1, purpose:'ORIGINAL_CONTRACT_TEMPLATE_289', business:'NOT_ENTERED', stages:[] };
withOutside289ContractTemplate(receipt).then(() => {
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.contractTemplate.tests,7);
  assert.equal(receipt.contractTemplate.skipped,0);
  assert.deepEqual(receipt.adjacentPostconsume,{count:289,exactB7:true});
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_CONTRACT_TEMPLATE_289_PASSED';
  console.log(JSON.stringify(receipt));
}).catch(error => {
  const code = error.code ?? error.message;
  let stage=receipt.stages.at(-1) ?? 'INPUTS';
  if(typeof stage!=='string')stage=stage?.stage??'UNKNOWN_STAGE';
  console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{stage,
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'UNCLASSIFIED_ADJACENT289_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit}}));
  process.exitCode=1;
});
