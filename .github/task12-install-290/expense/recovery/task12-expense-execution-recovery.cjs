'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');

const name = '20260728140000_project_expense_execution_idempotency';
const checksum = 'b18cb2fe11c734bf144bff12181c4179a0c30089cd517361f53c601bce9cd7fe';
const rollback = Object.freeze({name, sha256:checksum, finished:false, rolledBack:true});
function hasPostgresMarker(delta) {
  return /^NATIVE_TASK16 \[\d+\] (?:[A-Z0-9]+ )?ERROR: +(?:23514: +)?project_expense_execution_audit_missing *$/mu.test(delta);
}

function markerEvidence(ledgerMarker, observed) {
  const sources = {
    markerInFailedLedger:ledgerMarker === true,
    markerInPrismaStdout:observed.markerInPrismaStdout === true,
    markerInPrismaStderr:observed.markerInPrismaStderr === true,
    markerInPostgres:observed.markerInPostgres === true,
  };
  return {sources,originalMarker:Object.values(sources).some(Boolean)};
}

const materialSha = 'a7a852fb53dcada5be21fe5283342ed0a2c26952311f9453dd6f1cab107dff09';
const tailSha = 'efb77c7e3b7ff4b521816f2d747f02310bbe41dee7fbce2aada37d2dbd48e416';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, label) => { if (!ok) throw new Error('EXPENSE_EXECUTION_RECOVERY_'+label); };

function material() {
  const bytes = fs.readFileSync(path.join(__dirname,'task12-expense-execution-recovery.json'));
  need(hash(bytes) === materialSha,'MATERIAL');
  return JSON.parse(bytes);
}

function expectedLedger(completed, size) {
  need(completed[110]?.name === name && completed[110].sha256 === checksum &&
    completed.every(row => row.finished === true && row.rolledBack === false), 'LEDGER_SOURCE');
  const ledger = completed.slice(0,size);
  return size < 111 ? ledger : [...ledger.slice(0,110), rollback, ...ledger.slice(110)];
}

function assertLedger(observed, completed, size) {
  need(equal(observed, expectedLedger(completed,size)), 'LEDGER');
}

function bindArchiveLedger(sql, completed) {
  const expected = "'" + JSON.stringify(completed) + "'::jsonb";
  const replacement = "'" + JSON.stringify(expectedLedger(completed,completed.length)) + "'::jsonb";
  const anchor = /ORDER BY migration_name COLLATE "C"\) FROM public\._prisma_migrations\)(\s+IS DISTINCT FROM )/gu;
  const patches = [...sql.matchAll(anchor)].map(match => {
    const start=match.index, end=start+match[0].length;
    need(sql.startsWith(expected,end),'ARCHIVE_LEDGER_EXPECTED');
    return [start,end+expected.length,match[1]];
  });
  need(patches.length > 0 && patches.length <= 4,'ARCHIVE_LEDGER_ANCHOR');
  for(const [start,end,comparison] of patches.reverse()) {
    sql=sql.slice(0,start)+'ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations)'+
      comparison+replacement+sql.slice(end);
  }
  return sql;
}

function tailModule(historical) {
  const file = path.join(historical,'local-staged-tail-qualification.cjs');
  const source = fs.readFileSync(file,'utf8');
  need(hash(source) === tailSha,'TAIL_SOURCE');
  const previous = 'const rollback=ci?ledger.find(row=>row.name===ciRecovery):ledger[114];';
  const count = 'requireSingleRollback:Boolean(ciRecovery)';
  need(source.split(previous).length===2 && source.split(count).length===2,'TAIL_ANCHOR');
  const staged = source.replace(previous,'const rollback=ledger.find(row=>row.name==='+JSON.stringify(name)+'&&row.sha256==='+JSON.stringify(checksum)+');')
    .replace(count,'requireSingleRollback:true');
  const local = new Module(file,module);
  local.filename = file;
  local.paths = Module._nodeModulePaths(path.dirname(file));
  local._compile(staged,file);
  return local.exports;
}

async function recover({ledger, deploy, resolve, sql, jsonSql, inspect, enter, identity}) {
  const input = material();
  await deploy(110);
  const pre = await jsonSql(inspect);
  const binding = identity(pre);
  assertLedger(pre.ledger,ledger,110);
  await sql(input.seed);
  const failedDeployment=await deploy(111,undefined,true);
  const failedPrismaCode=failedDeployment.prismaCode;
  const failedSql = `SELECT jsonb_build_object(
    'id',id,'sha256',checksum,'failed',finished_at IS NULL AND rolled_back_at IS NULL,
    'marker',position('project_expense_execution_audit_missing' in coalesce(logs,''))>0,
    'notApplied',applied_steps_count=0,
    'ledgerSqlState',(SELECT state FROM unnest(ARRAY['23503','23514','42501','42P01','42703','55000','55P03','57014','P0001']) AS states(state)
      WHERE position(state in coalesce(logs,''))>0 LIMIT 1),
    'logPresent',coalesce(logs,'')<>'')
   FROM public._prisma_migrations WHERE migration_name='${name}'`;
  const failed = await jsonSql(failedSql);
  const {sources,originalMarker}=markerEvidence(failed.marker,failedDeployment);
  const observation=Object.freeze({
    checksumMatched:failed.sha256===checksum,failedState:failed.failed===true,
    originalMarker,exactPostmasterMarker:sources.markerInPostgres,notApplied:failed.notApplied===true,
    rowIdShape:typeof failed.id==='string'&&/^[a-f0-9-]{36}$/u.test(failed.id),
    noPartialObjects:(await sql(input.noObjects)).stdout.trim()==='0',
    originalVoucherIndex:(await sql(input.oldVoucherIndex)).stdout.trim()==='1',
    sameDatabase:equal(identity(await jsonSql(inspect)),binding),
  });
  if(!Object.values(observation).every(Boolean)){
    throw Object.assign(new Error('EXPENSE_EXECUTION_RECOVERY_ORIGINAL_FAILURE'),{
      recoveryObservation:{...observation,...sources,failedPrismaCode,
        ledgerSqlState:failed.ledgerSqlState,ledgerLogPresent:failed.logPresent===true}
    });
  }
  enter('FINANCE_PRISMA_RESOLVE');
  await resolve(name);
  await sql(input.repair);
  await deploy(111);
  const fixed=await jsonSql(inspect);
  need(equal(identity(fixed),binding),'IDENTITY');
  assertLedger(fixed.ledger,ledger,111);
  const witnessSql = `SELECT jsonb_build_object('rollbackId',b.id,'rolledBackAt',b.rolled_back_at,
    'ledgerMarker',position('project_expense_execution_audit_missing' in coalesce(b.logs,''))>0,
    'legacyKey', (SELECT "idempotencyKey" FROM public."ProjectExpenseExecution" WHERE id='retained_audit_missing_execution'),
    'originalAuditPresent', EXISTS(SELECT FROM public."AuditLog" WHERE id='retained_audit_missing_audit_recovery'))
   FROM public._prisma_migrations b WHERE b.migration_name='${name}' AND b.checksum='${checksum}'
    AND b.finished_at IS NULL AND b.rolled_back_at IS NOT NULL AND b.applied_steps_count=0`;
  const witness=await jsonSql(witnessSql);
  need(witness.rollbackId===failed.id && typeof witness.rolledBackAt==='string' &&
    witness.ledgerMarker===sources.markerInFailedLedger && witness.legacyKey==='legacy:project_expense_execution:retained_audit_missing_execution' && witness.originalAuditPresent===true,'ROLLBACK_WITNESS');
  const readback=async()=>need((await sql(input.readback)).stdout.trim()===input.expected,'ORIGINAL_LEGACY_READBACK');
  await readback();
  return Object.freeze({binding,verify:async()=>{
    need(equal(await jsonSql(witnessSql),witness),'ROW_IDENTITY');
    await readback();
  },
    receipt:Object.freeze({prefix:110,terminal:111,checksum,expectedFailure:true,...sources,failedPrismaCode,PrismaResolve:true,originalLegacyReadback:input.expected,originalVoucherIndex:true})});
}

module.exports = {expectedLedger, assertLedger, bindArchiveLedger, tailModule, recover, hasPostgresMarker, markerEvidence};
