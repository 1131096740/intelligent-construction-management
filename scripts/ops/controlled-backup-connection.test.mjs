import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installConnection,withdrawConnection,credentialObserveOperation} from './controlled-backup-connection.mjs';

test('private connection installation never sends plaintext password to SQL and exact withdrawal preserves neighbours',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'jgzg-connection-fixture-')));
 try{
  const file=join(root,'connection.env'),commands=[];
  const query=async sql=>{commands.push(sql);};
  const pin=await installConnection({file,database:'fixture',roleOid:123,databaseIdentitySha256:"a".repeat(64),query,expectedUid:process.getuid()});
  const raw=await readFile(file,'utf8'),password=new URL(raw.trim().slice(13)).password;
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert(!commands.join('\n').includes(password));assert(commands.some(x=>x.includes('SCRAM-SHA-256$')));
  await writeFile(join(root,'neighbour'),'keep');
  await withdrawConnection({file,pin,query,expectedUid:process.getuid()});
  assert.equal(await readFile(join(root,'neighbour'),'utf8'),'keep');
  await assert.rejects(readFile(file),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true});}
});

test('same-byte replaced credential is preserved and failed activation contains only the exact reader',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'jgzg-credential-drift-')));
 try{
  const file=join(root,'connection.env'),commands=[];
  const query=async sql=>commands.push(sql);
  const pin=await installConnection({file,database:'fixture',roleOid:123,databaseIdentitySha256:'a'.repeat(64),query,expectedUid:process.getuid()});
  await writeFile(join(root,'replace'),await readFile(file),{mode:0o600});await rename(join(root,'replace'),file);
  const before=commands.length;
  await assert.rejects(withdrawConnection({file,pin,query,expectedUid:process.getuid()}),/drift/);
  assert.equal(commands.length,before);assert((await stat(file)).isFile());
  const second=join(root,'partial.env');
  await assert.rejects(installConnection({file:second,database:'fixture',roleOid:124,databaseIdentitySha256:'a'.repeat(64),expectedUid:process.getuid(),query:async sql=>{commands.push(sql);if(sql.includes(' LOGIN;'))throw Error('fixture interruption');}}),/NOLOGIN/);
  assert(commands.at(-1).includes('NOLOGIN'));assert((await stat(second)).isFile());
 }finally{await rm(root,{recursive:true});}
});

test('credential exit works before reader HBA activation and refuses runtime/foreign hold states',()=>{
 const j={planSha256:'a'.repeat(64),state:'connections-held',bootstrap:true};
 assert.equal(credentialObserveOperation('install',j,j.planSha256),'observe-bootstrap');
 assert.equal(credentialObserveOperation('withdraw',j,j.planSha256),'observe-bootstrap');
 assert.equal(credentialObserveOperation('withdraw',{...j,bootstrap:false},j.planSha256),'observe');
 for(const changed of [{...j,state:'runtime-allowed'},{...j,planSha256:'b'.repeat(64)}])assert.throws(()=>credentialObserveOperation('withdraw',changed,j.planSha256));
});
