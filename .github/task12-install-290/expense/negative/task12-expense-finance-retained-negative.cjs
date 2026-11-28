'use strict';

const { execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const need = (ok, code) => { if (!ok) throw new Error(code); };
const migration = '20260728150000_project_expense_finance_idempotency';
const checksum = '3455616a471743268c4bf0ab7ef7ce06ba57d880d5033f90dcd4c25f0d2fe7e5';

function startWriter({target, hold, root, port, password}) {
  return new Promise(resolve => {
    const writer = execFile('psql', ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--dbname',target], {
      timeout:10_000, cwd:root, env:{
        PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin', LANG:'C', LC_ALL:'C',
        PGHOST:'127.0.0.1', PGPORT:String(port), PGUSER:'jg_task01_owner', PGPASSWORD:password,
        PGSSLMODE:'verify-full', PGSSLROOTCERT:root+'/ca.crt', PGCONNECT_TIMEOUT:'5',
      },
    }, error=>resolve(!error));
    writer.stdin.on('error',()=>writer.kill());
    writer.stdin.end(hold);
  });
}

async function verifyFinanceRetainedNegatives({material,database,root,port,password,deploy,sql,jsonSql,inspect,
  ledger,identity,onPhase,readLog,receipt}) {
  const { rows, writer, rollback } = material;
  need(ledger[111]?.name===migration && ledger[111].sha256===checksum &&
    rows.length===13 && !rows.some(row=>row.label==='valid'||row.label==='auditMissing') &&
    writer.label==='lockConflict' && writer.attempts===100 && writer.intervalMs===50,'FINANCE_NEGATIVE_SOURCE');
  await deploy(111,database);
  const before=await jsonSql(inspect);
  identity(before);
  need(equal(before.ledger,ledger.slice(0,111)),'FINANCE_NEGATIVE_PREFIX');
  receipt.financeRetainedNegatives={prefix:111,failedOrdinal:112,observed:[]};
  for (const row of [...rows,writer]) {
    need(/^jiangkong_project_expense_finance_retained_[a-z_]+$/u.test(row.database) &&
      /^project_expense_finance_[a-z_]+$/u.test(row.marker),'FINANCE_NEGATIVE_CASE');
    onPhase('FINANCE_NEGATIVE_'+row.label.toUpperCase());
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
        equal(clone.ledger,before.ledger),'FINANCE_NEGATIVE_CLONE');
      await sql(row.seed,scope);
      if (row===writer) {
        heldWriter=startWriter({target,hold:writer.hold,root,port,password});
        let ready=false;
        for (let attempt=0; attempt<writer.attempts; attempt++) {
          if (Number((await sql(writer.readiness,scope)).stdout.trim())>0) { ready=true; break; }
          await delay(writer.intervalMs);
        }
        need(ready,'FINANCE_NEGATIVE_WRITER_NOT_READY');
      }
      const logBefore=readLog();
      const result=await deploy(112,target,true);
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
      const expectedLogMarker=row===writer ? row.marker+' table=FinanceRecord' : row.marker;
      const markerInPostgres=logAfter.startsWith(logBefore) && logAfter.slice(logBefore.length).includes(expectedLogMarker);
      observation={label:row.label,marker:row.marker,processExit:result.code,...outcome,noObjects,markerInPostgres,
        markerInPrisma:[result.stdout,result.stderr].some(text=>(text??'').includes(row.marker)),
        writerLockObserved:row===writer};
      receipt.financeRetainedNegatives.lastObservation=observation;
      need(Number.isInteger(result.code) && result.code>0 && outcome.completed===111 &&
        outcome.targetRows===1 && outcome.checksumMatches===1 && outcome.unfinished===1 && outcome.zeroAppliedSteps===1 &&
        markerInPostgres && noObjects,'FINANCE_NEGATIVE_ORIGINAL_FAILURE');
      const after=await jsonSql(inspect,scope);
      need(after.databaseOid===clone.databaseOid && after.systemIdentifier===clone.systemIdentifier &&
        after.ledger.length===112 && equal(after.ledger.slice(0,111),clone.ledger) &&
        after.ledger[111].name===migration && after.ledger[111].sha256===checksum &&
        after.ledger[111].finished===false && after.ledger[111].rolledBack===false,'FINANCE_NEGATIVE_PARTIAL_LEDGER');
      if (heldWriter) need(await heldWriter,'FINANCE_NEGATIVE_WRITER_EXIT');
    } finally {
      if (heldWriter) await heldWriter;
      await sql(`DROP DATABASE ${target};`,{database:'postgres'});
    }
    receipt.financeRetainedNegatives.observed.push({...observation,cloneRemoved:true});
  }
}
module.exports={verifyFinanceRetainedNegatives};
