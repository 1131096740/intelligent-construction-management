'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {scope} = require('./successor.cjs');
const {seedSettlementHistory} = require('./settlement-history.cjs');
const {restoreBusinessDatabase} = require('./restore.cjs');
const {ledgerSha256: ledger294} = require('./combined294-source.json');
const {final:finalLedger}=require('./multi-witness.cjs');
const notice = require('./terminal.cjs');
const {legacy,successor}=require('./restore-profile.cjs');
const forwardInventory=require('./forward-320-inventory.json');

const expectedCorrection={status:201,replay:201,queued:1,sent:0,oneTransaction:true,rollback:true};
const expectedLoan={file:'src/database/project-affiliate-company-contract-db.spec.ts',passed:1,skipped:11};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function verifyLease(context,forward320) {
  assert.match(context.runId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.equal(context.database,'jg_task01_'+context.runId.replaceAll('-',''));
  const {stdout}=await context.sql(`
    SELECT jsonb_build_object('ownedTls',current_database()='${context.database}' AND
      current_user='jg_task01_owner' AND current_user=session_user AND current_user::regrole::oid=10
      AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet
      AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl),
      'ledger',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,
        'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name)
        FROM public._prisma_migrations));
  `);
  const observed=JSON.parse(stdout);
  assert.equal(observed.ownedTls,true);
  assert.equal(observed.ledger.length,forward320?329:295);
  const ledger=observed.ledger.map(({name,sha256,finished,rolledBack})=>({name,sha256,finished,rolledBack}));
  assert.equal(sha(JSON.stringify(ledger.slice(0,295))),finalLedger,'BACKUP294_LIVE_LEDGER');
  if(forward320) {
    assert.equal(sha(JSON.stringify(ledger)),forwardInventory.ledgerSha256,'BACKUP320_LIVE_LEDGER');
    assert.equal(forward320.ledgerSha256,forwardInventory.ledgerSha256,'BACKUP320_FORWARD_LEDGER');
    assert.equal(forward320.count,329,'BACKUP320_FORWARD_COUNT');
    assert.equal(forward320.sameIdentity,true,'BACKUP320_FORWARD_INSTANCE');
    assert.equal(forward320.sameBaseB7,true,'BACKUP320_FORWARD_B7');
    assert.equal(context.candidateTree,forward320.sourceTree,'BACKUP320_CANDIDATE_TREE');
  }
}

// The owned 294 installer invokes this only after both tail catalogs have been proved.
async function prepareBackup295(context,receipt,admission,{correction,loan}) {
  assert.equal(admission.status,'FINANCE294_COMMITTED_MIGRATION_INPUTS_ADMITTED_OFFLINE');
  assert.match(admission.head,/^[a-f0-9]{40}$/u);
  assert.equal(admission.ledger294,ledger294);
  assert.equal(receipt.fixturePredecessorSha??receipt.candidateSha,admission.head,'BACKUP294_CANDIDATE_SHA');
  assert.equal(context.candidateTree,scope.tree,'BACKUP294_PREFIX_TREE');
  assert.deepEqual(receipt.orderedTails.slice(-4).map(row=>row.size),[292,293,294,295]);
  assert.equal(receipt.installOnly293.ledgerSha256,notice.ledgerSha256);
  assert.equal(receipt.installOnly294.ledgerSha256,ledger294);
  assert.equal(receipt.installOnly295.ledgerSha256,finalLedger);
  assert.ok([correction,loan].every(fn=>typeof fn==='function'));
  await verifyLease(context);
  const enter=stage=>receipt.stages.push(stage);
  enter('BACKUP294_ORIGINAL_CORRECTION');
  await correction(context,receipt);
  assert.deepEqual(receipt.businessOracle,expectedCorrection);
  enter('BACKUP294_ORIGINAL_LOAN');
  const lending=await loan(context);
  assert.equal(lending.scopeLimit,'ORIGINAL_SERVICE_APPROVAL_ONLY');
  assert.deepEqual(lending.suites,[expectedLoan]);
  enter('BACKUP294_ORIGINAL_SETTLEMENT');
  receipt.settlementFixture=await seedSettlementHistory(context);
  await verifyLease(context);
}

async function runNamedBackup(context,receipt,namedRoles,forward320) {
  assert.equal(typeof namedRoles,'function');
  assert.ok(receipt.settlementFixture,'BACKUP_ORIGINAL_FIXTURE_REQUIRED');
  assert.deepEqual(receipt.businessOracle,expectedCorrection);
  const profile=forward320?successor:legacy;
  const enter=stage=>receipt.stages.push(stage);
  await verifyLease(context,forward320);
  enter(forward320?'BACKUP320_NAMED_EXPORT_IMPORT':'BACKUP294_NAMED_EXPORT_IMPORT');
  const named=await namedRoles(context);
  try {
    receipt.restore=await restoreBusinessDatabase(context,named.credentials,enter,forward320);
    assert.equal(receipt.restore.businessTables,profile.businessCount);
    assert.equal(receipt.restore.restoredDataPayloads,profile.businessCount);
    assert.equal(receipt.restore.protectedTables,profile.technical.length);
    assert.equal(receipt.restore.protectedPayloads,0);
    assert.deepEqual(receipt.restore.namedDataImport,{role:'contract_backup',tls:true,restoredTables:profile.businessCount,
      restoredSequences:1,targetWritesRevoked:true});
  }finally{
    await named.release();
  }
  const {stdout}=await context.sql(`SELECT NOT EXISTS(SELECT FROM pg_roles
    WHERE rolname IN ('contract_backup','contract_runtime') OR rolname ~ '^finance_(runtime|untrusted)_[0-9a-f]{32}$')
    AND NOT EXISTS(SELECT FROM pg_database WHERE datname='contract_restored');`);
  assert.equal(stdout.trim(),'t','BACKUP294_ROLES_AND_TARGET_WITHDRAWN');
  receipt.backupFixtureCleanup={rolesWithdrawn:true,restoredDatabaseRemoved:true};
  await verifyLease(context,forward320);
}

async function runBackup295(context,receipt,admission,{correction,loan,namedRoles}) {
  await prepareBackup295(context,receipt,admission,{correction,loan});
  return runNamedBackup(context,receipt,namedRoles);
}

async function runBackup320(context,receipt,{namedRoles}) {
  assert.ok(receipt.forward320,'BACKUP320_FORWARD_RECEIPT_REQUIRED');
  return runNamedBackup(context,receipt,namedRoles,receipt.forward320);
}

module.exports={runBackup295,prepareBackup295,runBackup320,verifyLease};
