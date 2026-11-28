'use strict';
const assert = require('node:assert/strict');
const { withOutside289Settlement } = require('/qualification/installer.cjs');
const receipt = {schemaVersion:1,purpose:'ORIGINAL_CONTRACT_SETTLEMENT_V2_EXACT_289',business:'NOT_ENTERED',stages:[]};

withOutside289Settlement(receipt).then(() => {
  assert.equal(receipt.releaseTree,'a1be083076018686dd8afba68c44ff9c75502014');
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.settlement.tests,2);
  assert.equal(receipt.settlement.skipped,0);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_CONTRACT_SETTLEMENT_V2_289_PASSED';
  console.log(JSON.stringify(receipt));
}).catch(error => {
  const code = error.code ?? error.message;
  console.log(JSON.stringify({
    ...receipt,status:'STOPPED',failure:{
      stage:receipt.stages.at(-1) ?? 'INPUTS',
      code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'UNCLASSIFIED_289_SETTLEMENT_FAILURE',
      sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
    }
  }));
  process.exitCode = 1;
});
