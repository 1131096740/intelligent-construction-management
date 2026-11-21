'use strict';
const assert=require('node:assert/strict');
const {verifyInputs}=require('./workbench-inputs.cjs');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness}=require('./installer.cjs');
const terminal=require('./multi-witness.cjs');
const source=require('./contract-finance-source.json');
const receipt={schemaVersion:1,sourceSha:source.sourceSha,purpose:'POL115_WORKBENCH_ORIGINAL_295',business:'NOT_ENTERED',stages:['INPUTS']};
Promise.resolve().then(()=>{
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,terminal.final);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  verifyInputs();
  admitSource('/qualification','/qualification/source/services/api/prisma','/qualification/source-seal.txt');
  const {runWorkbench}=require('./task12-pol115-workbench-ci.cjs');
  return withCombined295MultiWitness(receipt,context=>runWorkbench(context,receipt));
}).then(()=>{
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.workbench?.tests,9);
  assert.equal(receipt.workbench?.skipped,0);
  assert.deepEqual(receipt.workbench?.browserProjects,['desktop','mobile']);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295?.ledgerSha256,terminal.final);
  assert.equal(receipt.combinedAfterBusiness?.ledgerSha256,terminal.final);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.sameIdentity,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='POL115_WORKBENCH_ORIGINAL_295_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'POL115_WORKBENCH_295_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
