'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { contract289, verifyMaterialized } = require('./checkout.cjs');
const { expectedLedger, verifySql, scope } = require('./successor.cjs');
const { verifyOrdinaryLoan291Inputs, verifyOutside289Inputs, installCombined292 } = require('./installer.cjs');
const treeProof = require('./tree-proof.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function admitSource(prefix, historical, sealPath) {
  const first = path.join(prefix,'product289');
  const predecessor = path.join(prefix,'product');
  verifyMaterialized(first,contract289);
  const seal = fs.readFileSync(sealPath,'utf8').trim();
  const base = verifyOutside289Inputs(historical,path.join(first,'services/api/prisma'),seal).ledger;
  const intermediate = verifyOrdinaryLoan291Inputs(historical,path.join(predecessor,'services/api/prisma'),seal).ledger;
  verifySql(path.join(prefix,'successor.sql'));
  const combined = expectedLedger(intermediate);
  assert.equal(base.length,289);
  assert.equal(hash(base),treeProof.prefix289);
  assert.deepEqual(intermediate.slice(0,289),base);
  assert.deepEqual(combined.slice(-3),treeProof.tail);
  assert.equal(combined.length,292);
  assert.equal(scope.tree,treeProof.tree);
  assert.equal(hash(combined),treeProof.combined292);
  return {baseCount:base.length,intermediateCount:intermediate.length,finalCount:combined.length,ledgerSha256:hash(combined)};
}

if (require.main === module) {
  const prefix = '/qualification';
  const receipt = {schemaVersion:1,purpose:'EXACT_COMBINED_292_INSTALL_ONLY',business:'NOT_ENTERED',stages:[]};
  Promise.resolve().then(async () => {
    assert.equal(process.argv.length,2);
    receipt.input=admitSource(prefix,prefix+'/source/services/api/prisma',prefix+'/source-seal.txt');
    await installCombined292(receipt);
    assert.equal(receipt.releaseTree,treeProof.tree);
    assert.deepEqual(receipt.orderedTails.slice(-3).map(row=>row.size),[290,291,292]);
    assert.equal(receipt.installOnly292.count,292);
    assert.equal(receipt.installOnly292.ledgerSha256,treeProof.combined292);
    assert.equal(receipt.business,'NOT_ENTERED');
    assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
    console.log(JSON.stringify({...receipt,status:'EXACT_COMBINED_292_INSTALL_ONLY_PASSED'}));
  }).catch(error => {
    const message = error.code ?? error.message;
    console.log(JSON.stringify({...receipt,status:'STOPPED',failure:{
      stage:receipt.stages.at(-1)??'INPUTS',code:typeof message==='string'&&/^[A-Z0-9_]+$/u.test(message)?message:'UNCLASSIFIED_COMBINED_292_FAILURE',
      sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
    }}));
    process.exitCode=1;
  });
}
module.exports={admitSource};
