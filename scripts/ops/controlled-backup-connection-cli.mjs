#!/usr/bin/env node
import {readFile,lstat,realpath,open} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installConnection,withdrawConnection,containReader,credentialObserveOperation} from './controlled-backup-connection.mjs';
import {readPinnedConfiguration} from './export-private-object-inventory.mjs';
import {assertCandidateRepository} from './private-object-backup.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [operation,path,pin,journalPin]=process.argv.slice(2);
 if(process.getuid()!==0||!['install','withdraw'].includes(operation)||!/^[a-f0-9]{64}$/.test(pin??'')||process.argv.length!==(operation==='install'?5:6)||operation==='withdraw'&&!/^[a-f0-9]{64}$/.test(journalPin??''))throw Error('invalid exact operation');
 if(process.env.CONTROLLED_CONNECTION_CONFIRM!==operation+':'+pin+(journalPin?':'+journalPin:''))throw Error('exact approval required');
 const planFile=await readPinnedConfiguration(path,pin);
 try{
  const p=JSON.parse(planFile.raw);
  if(Object.keys(p).sort().join(',')!==['candidateSha','runId','machineIdentitySha256','database','databaseIdentitySha256','roleOid','dbPlanSha256'].sort().join(',')||!/^[a-f0-9]{40}$/.test(p.candidateSha??'')||!/^[a-z0-9-]{1,60}$/.test(p.runId??'')||!/^[a-f0-9]{64}$/.test(p.dbPlanSha256??''))throw Error('invalid plan');
  if(hash((await readFile('/etc/machine-id')).toString().trim())!==p.machineIdentitySha256)throw Error('machine mismatch');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  await assertCandidateRepository(root,p.candidateSha,'scripts/ops/controlled-backup-connection-cli.mjs');
  const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')&&!/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(k)));
  const started=Date.now();
  const command=(program,args,input,env=safeEnv)=>{const remaining=60000-(Date.now()-started);if(remaining<=0)throw Error('credential stage deadline');try{return execFileSync(program,args,{input,env,timeout:Math.min(remaining,15000),maxBuffer:262144,stdio:['pipe','pipe','pipe']});}catch{throw Error('credential command stopped');}};
  const dbPath='/var/lib/jiangkong-controlled-launch/'+p.runId+'-db-plan.json';
  const db=await readPinnedConfiguration(dbPath,p.dbPlanSha256);
  try{
   const d=JSON.parse(db.raw);
   for(const key of ['candidateSha','runId','machineIdentitySha256','databaseIdentitySha256'])if(d[key]!==p[key])throw Error('database hold lineage mismatch');
   const dbJournalPath='/var/lib/jiangkong-controlled-launch/'+p.runId+'-database/journal.json';
   const meta=await lstat(dbJournalPath);if(!meta.isFile()||meta.isSymbolicLink()||meta.nlink!==1||meta.uid!==0||(meta.mode&0o077))throw Error('unsafe database journal');
   const dbJournal=await readPinnedConfiguration(dbJournalPath,hash(await readFile(dbJournalPath)));
   const observeOperation=credentialObserveOperation(operation,JSON.parse(dbJournal.raw),p.dbPlanSha256);
   const observe=()=>command('/usr/bin/python3',['-I','-B',join(root,'scripts/ops/controlled-database-hold.py'),observeOperation,dbPath,p.dbPlanSha256],undefined,{...safeEnv,CONTROLLED_DATABASE_CONFIRM:observeOperation+':'+p.dbPlanSha256});
   await dbJournal.verify();await dbJournal.close();
   observe();
   const query=async sql=>{if(!/^[A-Za-z0-9_-]{1,63}$/.test(p.database))throw Error('database identity');command('/usr/sbin/runuser',['-u','postgres','--','/usr/bin/psql','-X','-q','-t','-A','--set=ON_ERROR_STOP=1','-p','5432','-d',p.database],sql);};
   const roleGuard=(await readFile(join(root,'scripts/ops/db-backup-read-role.sql'),'utf8')).replace(/^BEGIN READ ONLY;\r?\n/m,'').replace(/ROLLBACK;\s*$/,'');
   await query('BEGIN READ ONLY; SET LOCAL statement_timeout=\'10s\'; SET LOCAL ROLE jiangkong_backup_reader; '+roleGuard+'; ROLLBACK;');
   await planFile.verify();await db.verify();
   const file='/etc/jiangkong/db-backup-database.env',journal='/var/lib/jiangkong-controlled-launch/'+p.runId+'-credential.json';
   if(operation==='install'){
    // Reserve the receipt before activation. A partial receipt is never treated as installed.
    const dir=dirname(journal),dirMeta=await lstat(dir);if(await realpath(dir)!==dir||!dirMeta.isDirectory()||dirMeta.uid!==0||(dirMeta.mode&0o077))throw Error('private journal directory required');
    const fd=await open(journal,'wx+',0o600);
    try{
     await fd.writeFile(JSON.stringify({state:'prepared',planSha256:pin,roleOid:p.roleOid})+'\n');await fd.sync();
     const owned=await installConnection({file,database:p.database,roleOid:p.roleOid,databaseIdentitySha256:p.databaseIdentitySha256,query});
     observe();await planFile.verify();await db.verify();
     const bytes=Buffer.from(JSON.stringify({state:'installed',planSha256:pin,owned})+'\n');
     await fd.truncate(0);await fd.write(bytes,0,bytes.length,0);await fd.sync();
     const named=await lstat(journal),actual=await fd.stat();if(named.dev!==actual.dev||named.ino!==actual.ino||named.nlink!==1||(named.mode&0o077)||named.uid!==0)throw Error('credential journal changed');
     const saved=await readPinnedConfiguration(journal,hash(bytes));try{await saved.verify();}finally{await saved.close();}
     const directory=await open(dir,'r');try{await directory.sync();}finally{await directory.close();}
     // Metadata only. Never emit config, password or verifier.
     console.log(JSON.stringify({status:'installed-reader-credential',journalSha256:hash(bytes),readerHbaEnabled:false,businessUnfrozen:false}));
    }catch{await containReader({...p,query});throw Error('Credential installation stopped with reader contained; preserve private evidence');}finally{await fd.close();}
   }else{
    const saved=await readPinnedConfiguration(journal,journalPin);
    try{const j=JSON.parse(saved.raw);if(j.state!=='installed'||j.planSha256!==pin||j.owned.roleOid!==p.roleOid||j.owned.databaseIdentitySha256!==p.databaseIdentitySha256)throw Error('wrong owned credential journal');await saved.verify();await withdrawConnection({file,pin:j.owned,query});console.log(JSON.stringify({status:'credential-withdrawn',permissionsRemoved:false,businessUnfrozen:false}));}finally{await saved.close();}
   }
  }finally{await db.close();}
 }finally{await planFile.close();}
}
main().catch(()=>{console.error('Controlled credential stage stopped; preserve private journal/file, no retry or business unfreeze.');process.exitCode=1;});
