'use strict';
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const source = require('./contract-finance-source.json');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const [lane] = process.argv.slice(2);
assert.ok(process.argv.length===3&&lane==='company-proxy-repayment');
const textDirect=source.mode==='text-direct-330';
const upwardArchive=source.mode==='upward-archive-332';
const paymentRemainder=source.mode==='payment-remainder-331';
const current320=upwardArchive||paymentRemainder||textDirect||source.mode==='current-320';
const count=upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const purpose='TASK410_COMPANY_PROXY_EXACT_'+count;
const receipt = {schemaVersion:1,sourceSha:source.sourceSha,lane,purpose,business:'NOT_ENTERED',stages:[]};
async function withGuardedReplay(context, consume) {
  const run = context.runId.replaceAll('-', '');
  assert.match(run,/^[0-9a-f]{32}$/u);
  assert.equal(context.database,`jg_task01_${run}`);
  const role = `finance_runtime_${run}`;
  const password = randomBytes(24).toString('hex');
  const replayDatabaseUrl = new URL(context.runtimeUrl);
  replayDatabaseUrl.username = role;
  replayDatabaseUrl.password = password;
  replayDatabaseUrl.searchParams.set('connection_limit','1');
  const witness = 'public.jg_contract_work_completion_witness';
  const readers = [
    'public.jg_contract_work_completion_cost_sources_v1(text,text,text)',
    'public.jg_company_transfer_canonical_correction_plan(text)',
  ];
  const noFixtureAccess = `SELECT NOT EXISTS(SELECT FROM ${witness})
    AND NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='${role}');`;
  const initial = await context.sql(noFixtureAccess);
  assert.equal(initial.stdout.trim(),'t');
  await context.sql(`BEGIN;
    CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
      CONNECTION LIMIT 1 PASSWORD '${password}';
    GRANT CONNECT ON DATABASE ${context.database} TO ${role};
    GRANT USAGE ON SCHEMA public TO ${role};
    INSERT INTO ${witness}(singleton,"key","databaseOid","runtimeRoleOid")
    SELECT true,decode('${randomBytes(32).toString('hex')}','hex'),oid,'${role}'::regrole::oid
    FROM pg_database WHERE datname=current_database();
    GRANT EXECUTE ON FUNCTION ${readers.join(', ')} TO ${role};
    GRANT SELECT ON public."ProjectOwnerSettlementEntry",public."SignedContractSettlement" TO ${role};
    COMMIT;`);
  try {
    await consume({...context,replayDatabaseUrl:replayDatabaseUrl.href});
  } finally {
    await context.sql(`BEGIN;
      DELETE FROM ${witness} WHERE singleton AND "runtimeRoleOid"='${role}'::regrole::oid;
      DROP OWNED BY ${role};
      DROP ROLE ${role};
      COMMIT;`);
    const restored = await context.sql(noFixtureAccess);
    assert.equal(restored.stdout.trim(),'t');
  }
}
async function main(){
  assert.equal(source.migrationCount,count);
  assert.equal((current320?source.predecessor:source).ledgerSha256,require('./multi-witness.cjs').final);
  const validate332=upwardArchive?require('./upward-archive-332-profile.cjs'):undefined;
  validate332?.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  const consume=context=>runTask398Owned282Voucher(context,lane+'-'+count,receipt);
  if(current320){
    const install=upwardArchive?withCombined332UpwardArchive:paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await install(receipt,context=>withGuardedReplay(context,consume),{sourceTree:source.sourceTree,
      migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails});
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  validate332?.assertInstallation(receipt,source);
  if (paymentRemainder) {
    assert.deepEqual(receipt.paymentRemainderPredecessor,{
      count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
    });
  }
  assert.equal(receipt.combinedAfterBusiness.count,count);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.installOnly295?.count,295);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.original,{business:1,passed:6,skipped:0});
  assert.equal(receipt.combinedAfterBusiness?.exactB7,true);
  assert.equal(receipt.combinedAfterBusiness?.balance.keyUnprovisioned,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = purpose+'_PASSED';
}
main().catch(error => {
  const code = error.code ?? error.message;
  const state = error.psqlObservation?.sqlstate ?? error.sqlstate;
  receipt.status = 'STOPPED';
  receipt.failure = {
    stage:error.cashPhase ?? receipt.stages.at(-1),
    code:typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'TASK410_COMPANY_PROXY_'+count+'_BEHAVIOR_FAILED',
    ...(/^[0-9A-Z]{5}$/u.test(state ?? '') ? {sqlstate:state} : {}),
    ...(error.psqlObservation?.permissionDenied === true ? {permissionDenied:true} : {}),
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
