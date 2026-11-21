'use strict';

const { execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const need = (ok, code) => { if (!ok) throw new Error(code); };
const migration = '20260728140000_project_expense_execution_idempotency';
const checksum = 'b18cb2fe11c734bf144bff12181c4179a0c30089cd517361f53c601bce9cd7fe';

function startWriter({target, hold, root, port, password}) {
  return new Promise(resolve => {
    const writer = execFile('psql', ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--dbname',target], {
      timeout:30_000, cwd:root, env:{
        PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin', LANG:'C', LC_ALL:'C',
        PGHOST:'127.0.0.1', PGPORT:String(port), PGUSER:'jg_task01_owner', PGPASSWORD:password,
        PGSSLMODE:'verify-full', PGSSLROOTCERT:root+'/ca.crt', PGCONNECT_TIMEOUT:'5',
      },
    }, error=>resolve(!error));
    writer.stdin.on('error',()=>writer.kill());
    writer.stdin.end(hold);
  });
}

async function verifyExpenseExecutionRetainedNegatives({material,database,root,port,password,deploy,sql,jsonSql,inspect,
  ledger,identity,onPhase,readLog,receipt}) {
  const { rows, writer, rollback, oldVoucherIndex } = material;
  need(ledger[110]?.name===migration && ledger[110].sha256===checksum &&
    rows.length===12 && !rows.some(row=>row.label==='valid'||row.label==='audit_missing') &&
    writer.label==='lock_conflict' && writer.attempts===200 && writer.intervalMs===50 && writer.expectedLockCount===4,'EXPENSE_EXECUTION_NEGATIVE_SOURCE');
  await deploy(110,database);
  const before=await jsonSql(inspect);
  identity(before);
  need(equal(before.ledger,ledger.slice(0,110)),'EXPENSE_EXECUTION_NEGATIVE_PREFIX');
  receipt.expenseExecutionRetainedNegatives={prefix:110,failedOrdinal:111,observed:[]};
  for (const row of [...rows,writer]) {
    need(/^jiangkong_project_expense_execution_retained_[a-z_]+$/u.test(row.database) &&
      /^project_(?:expense_execution|funding_allocation)_[a-z_]+$/u.test(row.marker),'EXPENSE_EXECUTION_NEGATIVE_CASE');
    onPhase('EXPENSE_EXECUTION_NEGATIVE_'+row.label.toUpperCase());
    const target=row.database.slice(0,63);
    const scope={database:target};
    await sql(`CREATE DATABASE ${target} TEMPLATE ${database};`,{database:'postgres'});
    let heldWriter;
    let observation;
    try {
      const clone=await jsonSql(inspect,scope);
      need(clone.database===target && clone.databaseOid!==before.databaseOid &&
        clone.systemIdentifier===before.systemIdentifier && clone.ownerOid==='10' &&
        clone.actorOid==='10' && clone.actor===before.actor && clone.sessionActor===clone.actor &&
        equal(clone.ledger,before.ledger),'EXPENSE_EXECUTION_NEGATIVE_CLONE');
      await sql(row.seed,scope);
      let writerLockCount;
      if (row===writer) {
        heldWriter=startWriter({target,hold:writer.hold,root,port,password});
        let ready=false;
        for (let attempt=0; attempt<writer.attempts; attempt++) {
          writerLockCount=Number((await sql(writer.readiness,scope)).stdout.trim());
          if (writerLockCount===writer.expectedLockCount) { ready=true; break; }
          await delay(writer.intervalMs);
        }
        need(ready,'EXPENSE_EXECUTION_NEGATIVE_WRITER_NOT_READY');
      }
      const logBefore=readLog();
      const result=await deploy(111,target,true,row===writer);
      const logAfter=readLog();
      const outcome=await jsonSql(`SELECT jsonb_build_object(
        'completed',count(*) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
        'targetRows',count(*) FILTER(WHERE migration_name='${migration}'),
        'checksumMatches',count(*) FILTER(WHERE migration_name='${migration}' AND checksum='${checksum}'),
        'unfinished',count(*) FILTER(WHERE migration_name='${migration}' AND finished_at IS NULL AND rolled_back_at IS NULL),
        'zeroAppliedSteps',count(*) FILTER(WHERE migration_name='${migration}' AND applied_steps_count=0),
        'markerInFailedLedger',COALESCE(bool_or(position('${row.marker}' in COALESCE(logs,''))>0)
          FILTER(WHERE migration_name='${migration}' AND finished_at IS NULL),false))
        FROM public._prisma_migrations;`,scope);
      const noObjects=(await sql(rollback,scope)).stdout.trim()==='0';
      const delta=logAfter.startsWith(logBefore) ? logAfter.slice(logBefore.length) : '';
      const writerSqlstate=row===writer && /ERROR:\s+55P03:\s+project_expense_execution_migration_requires_quiescence table=ProjectExpenseExecution\s*(?:\n|$)/u.test(delta) ? '55P03' : null;
      const markerInPostgres=row===writer ? writerSqlstate==='55P03' : delta.includes(row.marker);
      const voucherIndexPreserved=(await sql(oldVoucherIndex,scope)).stdout.trim()==='1';
      observation={label:row.label,marker:row.marker,processExit:result.code,...outcome,noObjects,markerInPostgres,
        markerInPrisma:[result.stdout,result.stderr].some(text=>(text??'').includes(row.marker)),
        voucherIndexPreserved,writerLockCount,writerSqlstate};
      receipt.expenseExecutionRetainedNegatives.lastObservation=observation;
      need(Number.isInteger(result.code) && result.code>0 && outcome.completed===110 &&
        outcome.targetRows===1 && outcome.checksumMatches===1 && outcome.unfinished===1 && outcome.zeroAppliedSteps===1 &&
        markerInPostgres && noObjects && voucherIndexPreserved,'EXPENSE_EXECUTION_NEGATIVE_ORIGINAL_FAILURE');
      const after=await jsonSql(inspect,scope);
      need(after.databaseOid===clone.databaseOid && after.systemIdentifier===clone.systemIdentifier &&
        after.ledger.length===111 && equal(after.ledger.slice(0,110),clone.ledger) &&
        after.ledger[110].name===migration && after.ledger[110].sha256===checksum &&
        after.ledger[110].finished===false && after.ledger[110].rolledBack===false,'EXPENSE_EXECUTION_NEGATIVE_PARTIAL_LEDGER');
      if (heldWriter) {
        need(await heldWriter,'EXPENSE_EXECUTION_NEGATIVE_WRITER_EXIT');
        observation.writerAuditCommitted=(await sql(writer.completion,scope)).stdout.trim()==='1';
        need(observation.writerAuditCommitted,'EXPENSE_EXECUTION_NEGATIVE_WRITER_AUDIT');
      }
    } finally {
      if (heldWriter) await heldWriter;
      await sql(`DROP DATABASE ${target};`,{database:'postgres'});
    }
    receipt.expenseExecutionRetainedNegatives.observed.push({...observation,cloneRemoved:true});
  }
}
module.exports={verifyExpenseExecutionRetainedNegatives};
