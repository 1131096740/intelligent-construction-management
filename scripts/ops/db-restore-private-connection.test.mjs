import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('public restore drill keeps isolated database rules while keeping URI password out of client argv and environment',async t=>{
 const root=await mkdtemp(join(tmpdir(),'restore-private-connection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bin=join(root,'bin');await mkdir(bin);const log=join(root,'checks'),file=join(root,'backup.dump');await writeFile(file,'fixture');
 await writeFile(file+'.sha256',createHash('sha256').update('fixture').digest('hex')+'  backup.dump\n');
 const password='fixture-password-private';
 const client=`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const leaked=process.argv.some(v=>v.includes('${password}'))||['RESTORE_DATABASE_URL','PG_RESTORE_DATABASE_URL','PGPASSWORD','PGDATABASE'].some(k=>(process.env[k]??'').includes('${password}'));
appendFileSync(${JSON.stringify(log)},String(leaked)+'\\n');
if(leaked)process.exit(91);
const args=process.argv.join(' ');
if(args.includes('SELECT current_database()'))console.log('jiangkong_restore_fixture');
else if(args.includes('SELECT COUNT(*) FROM pg_catalog.pg_tables'))console.log('0');
else if(args.includes('_prisma_migrations'))console.log('172|0|0');
else if(args.includes('select '))console.log('fixture=0');
`;
 for(const name of ['psql','pg_restore']){await writeFile(join(bin,name),client);await chmod(join(bin,name),0o700);}
 const r=spawnSync('bash',[resolve('scripts/ops/db-restore-drill.sh')],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,RESTORE_DATABASE_URL:'postgresql://fixture:'+password+'@127.0.0.1:5432/jiangkong_restore_fixture',PGDATABASE:'postgresql://fixture:'+password+'@127.0.0.1:5432/ignored',RESTORE_DATABASE_NAME_CONFIRMATION:'jiangkong_restore_fixture',BACKUP_FILE:file,APPLY_CANDIDATE_MIGRATIONS:'false'}});
 assert.equal(r.status,0,r.stderr);assert(!r.stdout.includes(password)&&!r.stderr.includes(password));
 const checks=(await readFile(log,'utf8')).trim().split('\n');assert(checks.length>=12);assert(checks.every(v=>v==='false'));
});
