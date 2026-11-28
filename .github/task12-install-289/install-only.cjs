'use strict';

const assert = require('node:assert/strict');
const {withOutside289InstallOnly} = require('./installer.cjs');
const exact = require('./exact-source.json');
const receipt = {schemaVersion:1,purpose:'EXACT_289_COLD_INSTALL_ONLY',business:'NOT_ENTERED',stages:[]};

withOutside289InstallOnly(receipt).then(() => {
  assert.equal(receipt.status, 'INSTALLED_289_NOT_BUSINESS_ADMISSION');
  assert.equal(receipt.releaseTree, exact.productTree);
  assert.equal(receipt.business, 'NOT_ENTERED');
  assert.equal(receipt.orderedTails?.at(-1)?.ledgerSha256, exact.ordered289);
  assert.deepEqual(receipt.outsideWitnesses?.map(row => row.size), [288,289]);
  assert.equal(receipt.outsideWitnesses[1].witness.outsideArchiveEvidenceBound, true);
  assert.equal(receipt.finalWitness?.projectLegacyReviewClosed, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  console.log(JSON.stringify(receipt));
}).catch(error => {
  const code = error.code ?? error.message;
  console.log(JSON.stringify({
    ...receipt,status:'STOPPED',failure:{
      stage:receipt.stages.at(-1) ?? 'INPUTS',
      code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'UNCLASSIFIED_289_COLD_INSTALL_FAILURE',
      sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    }
  }));
  process.exitCode = 1;
});
