'use strict';

const assert = require('node:assert/strict');
const {admitSource} = require('./install-only292.cjs');
const {withCombined295RetainedCleanup} = require('./installer.cjs');
const {final, digest} = require('./multi-witness.cjs');
const {runRetained} = require('./remaining-retained.cjs');

const root = '/qualification';
const source = require('./contract-finance-source.json');
const receipt = {schemaVersion:1,purpose:'REMAINING_RETAINED_CLEANUP_295',
  sourceSha:source.sourceSha,stages:['INPUTS'],status:'STOPPED'};

async function main() {
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,final);
  assert.equal(source.tails.at(-1).sha256,digest);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await withCombined295RetainedCleanup(receipt,context=>runRetained(context,receipt,'cleanup'));
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,final);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.deepEqual(receipt.cleanupLegacy,{count:205,exactTerminal:true,distinctDatabase:true,samePostmaster:true,postconsume:true});
  assert.deepEqual(receipt.cleanupLegacyAcl,{primaryUnchanged:true,legacyOwnerAndQualifiedAppOnly:true,publicDenied:true,
    unrelatedLoginDenied:true,postconsume:true});
  assert.equal(receipt.retainedOriginal.originalPgPassed,21);
  assert.equal(receipt.retainedOriginal.originalModelPassed,10);
  assert.equal(receipt.retainedOriginal.exact,true);
  assert.equal(receipt.retainedOriginal.seen.length,6);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='REMAINING_RETAINED_CLEANUP_295_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'REMAINING_RETAINED_CLEANUP_295_FAILED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
