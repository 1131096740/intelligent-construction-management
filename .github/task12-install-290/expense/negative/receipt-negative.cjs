'use strict';
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {retainedFixtureSql}=require('./receipt-seed.cjs');
const cases=[
 ['shape','shape','shapeInvalid','shape_invalid'],
 ['business','business','businessInvalid','business_fact_invalid'],
 ['actor','actor','actorMissing','actor_missing'],
 ['audit_missing','audit_missing','auditMissing','audit_missing_or_mismatch'],
 ['audit_reverse','audit_reverse','auditReverse','audit_reverse_mismatch'],
 ['audit_duplicate','audit_duplicate','auditDuplicate','audit_duplicate'],
 ['lock','lock',null,'migration_requires_quiescence'],
];
const name='20260728160000_project_expense_receipt_confirmation';
const sha256='96c4e08921d9bca2e67fe3b2695ce2d7243865c00c66de1b22a48aec83ad7875';
const app='project-expense-receipt-migration-writer';

function writer(target,{root,port,password}) {
  return new Promise((resolve,reject)=>{
    const child=execFile('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--dbname',target],{
      timeout:20_000,cwd:root,env:{PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin',
        LANG:'C',LC_ALL:'C',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'jg_task01_owner',
        PGPASSWORD:password,PGSSLMODE:'verify-full',PGSSLROOTCERT:root+'/ca.crt',PGCONNECT_TIMEOUT:'5'},
    },error=>error?reject(new Error('RECEIPT_ORIGINAL_WRITER_EXIT')):resolve());
    child.stdin.on('error',()=>child.kill());
    child.stdin.end(`BEGIN; SET LOCAL application_name = '${app}';
      LOCK TABLE "ProjectExpenseRequest" IN ROW EXCLUSIVE MODE;
      SELECT pg_sleep(8); COMMIT;`);
  });
}

async function verifyReceiptRetainedNegatives(config) {
  const {database,deploy,sql,jsonSql,inspect,ledger,identity,onPhase,readLog,receipt}=config;
  assert.deepEqual(ledger[112],{name,sha256,finished:true,rolledBack:false});
  await deploy(112,database);
  const prefix=await jsonSql(inspect);
  identity(prefix);
  assert.deepEqual(prefix.ledger,ledger.slice(0,112));
  receipt.expenseReceiptNegatives={prefix:112,failedOrdinal:113,cases:[]};
  for (const [suffix,label,mode,safeMarker] of cases) {
    const target='jiangkong_project_expense_receipt_retained_'+suffix;
    assert.ok(target.length<=63);
    const scope={database:target};
    const marker='project_expense_receipt_'+safeMarker;
    await sql(`CREATE DATABASE ${target} TEMPLATE ${database};`,{database:'postgres'});
    let held;
    try {
      const clone=await jsonSql(inspect,scope);
      assert.equal(clone.database,target);
      assert.notEqual(clone.databaseOid,prefix.databaseOid);
      assert.equal(clone.systemIdentifier,prefix.systemIdentifier);
      assert.equal(clone.ownerOid,'10');
      assert.equal(clone.actorOid,'10');
      assert.deepEqual(clone.ledger,prefix.ledger);
      if(mode) await sql(retainedFixtureSql(label,mode),scope);
      else {
        held=writer(target,config);
        held.catch(()=>{});
        let ready=false;
        for(let attempt=0;attempt<100;attempt++){
          const result=await sql(`SELECT COUNT(*) FROM pg_stat_activity activity
            JOIN pg_locks held_lock ON held_lock.pid=activity.pid AND held_lock.locktype='relation' AND held_lock.granted
            JOIN pg_class relation ON relation.oid=held_lock.relation
            WHERE activity.datname=current_database() AND activity.application_name='${app}'
              AND held_lock.mode='RowExclusiveLock' AND relation.relname='ProjectExpenseRequest';`,scope);
          if(Number(result.stdout.trim())>0){ready=true;break;}
          await delay(50);
        }
        assert.ok(ready,'RECEIPT_ORIGINAL_WRITER_READY');
      }
      onPhase('EXPENSE_RECEIPT_NEGATIVE_'+label.toUpperCase());
      const before=readLog();
      const result=await deploy(113,target,true,!mode);
      assert.equal(result.code,1);
      const log=readLog();
      const observed=(log.startsWith(before)?log.slice(before.length):log).includes(marker);
      assert.ok(observed,'RECEIPT_ORIGINAL_POSTGRES_MARKER');
      const after=await jsonSql(inspect,scope);
      assert.equal(after.databaseOid,clone.databaseOid);
      assert.equal(after.systemIdentifier,clone.systemIdentifier);
      assert.deepEqual(after.ledger,[...clone.ledger,{name,sha256,finished:false,rolledBack:false}]);
      const objects=await sql(`SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='ProjectExpenseRequest'
          AND column_name='receiptConfirmationIdempotencyKey';`,scope);
      assert.equal(objects.stdout.trim(),'0','RECEIPT_ORIGINAL_ROLLBACK_ASSERTION');
      if(held)await held;
    } finally {
      if(held)await held.catch(()=>{});
      await sql(`DROP DATABASE ${target};`,{database:'postgres'});
    }
    receipt.expenseReceiptNegatives.cases.push({label,markerMatched:true,failedRowPreserved:true,noObjects:true,cloneRemoved:true});
  }
}
module.exports={verifyReceiptRetainedNegatives};
