'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {sourceSha}=require('./contract-finance-source.json');
const installer=require('./installer.cjs');
const original='/qualification/workspace/services/api/prisma/pol275-original-evidence.cjs';
const receipt={schemaVersion:1,sourceSha,purpose:'ORIGINAL_POL275_COLD_EXACT_295',business:'NOT_ENTERED',stages:[]};
Promise.resolve().then(()=>{
  assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'),'a338dcd1817f5dc6dacdea62cb36b3357d7933bc58587e61b4b71dec7a91d2db');
  return installer.withCombined295MultiWitness(receipt,async context=>{
    receipt.stages.push('POL275_ORIGINAL_CATALOG');
    const catalog=await require(original).collectEvidence(context.ownerUrl,295);
    receipt.pol275={migrationCount:catalog.migrationCount,originalTerminal:catalog.terminalMigration};
  });
}).then(()=>{
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.installOnly295.count,295);
  assert.equal(receipt.pol275.migrationCount,295);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status=receipt.purpose+'_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  const sqlstate=error.psqlObservation?.sqlstate??error.sqlstate;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'POL275_COLD_295_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(sqlstate??'')?{sqlstate}:{})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
