'use strict';
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const source = require('./contract-finance-source.json');
const {withCombined295MultiWitness,withCombined320ContractPayment} = require('./installer.cjs');
const {runTask398Owned282Voucher} = require('./workspace/services/api/prisma/run-task398-shared-standard-local.cjs');

const [lane] = process.argv.slice(2);
assert.ok(process.argv.length===3&&lane==='company-proxy-repayment');
const current320=source.mode==='current-320';
const count=current320?329:295;
const purpose='TASK410_COMPANY_PROXY_EXACT_'+count;
const receipt = {schemaVersion:1,sourceSha:source.sourceSha,lane,purpose,business:'NOT_ENTERED',stages:[]};
async function withGuardedReplay(context, consume) {
  const witness = 'public.jg_contract_work_completion_witness';
  const sources = 'public.jg_contract_work_completion_cost_sources_v1(text,text,text)';
  const initial = await context.sql(`SELECT NOT EXISTS(SELECT FROM ${witness})
    AND NOT has_function_privilege('jg_task01_runtime','${sources}','EXECUTE');`);
  assert.equal(initial.stdout.trim(),'t');
  await context.sql(`BEGIN;
    INSERT INTO ${witness}(singleton,"key","databaseOid","runtimeRoleOid")
    SELECT true,decode('${randomBytes(32).toString('hex')}','hex'),oid,'jg_task01_runtime'::regrole::oid
    FROM pg_database WHERE datname=current_database();
    GRANT EXECUTE ON FUNCTION ${sources} TO jg_task01_runtime;
    COMMIT;`);
  try {
    await consume(context);
  } finally {
    await context.sql(`BEGIN;
      REVOKE EXECUTE ON FUNCTION ${sources} FROM jg_task01_runtime;
      DELETE FROM ${witness} WHERE singleton AND "runtimeRoleOid"='jg_task01_runtime'::regrole::oid;
      COMMIT;`);
    const restored = await context.sql(`SELECT NOT EXISTS(SELECT FROM ${witness})
      AND NOT has_function_privilege('jg_task01_runtime','${sources}','EXECUTE');`);
    assert.equal(restored.stdout.trim(),'t');
  }
}
async function main(){
  assert.equal(source.migrationCount,count);
  assert.equal((current320?source.predecessor:source).ledgerSha256,require('./multi-witness.cjs').final);
  const consume=context=>runTask398Owned282Voucher(context,lane+'-'+count,receipt);
  if(current320){
    await withCombined320ContractPayment(receipt,context=>withGuardedReplay(context,consume),{sourceTree:source.sourceTree,
      migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails});
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
  } else {
    await withCombined295MultiWitness(receipt,consume);
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
