#!/usr/bin/env node
// Generates only a new reader credential. No application credential is read or reused.
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {open,lstat,realpath,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname} from 'node:path';
const role='jiangkong_backup_reader';
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=s=>[s.dev,s.ino,s.size,s.uid,s.gid,s.mode,s.nlink,s.mtimeMs,s.ctimeMs];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function guard(database,oid,databaseIdentitySha256){
 if(!/^[a-f0-9]{64}$/.test(databaseIdentitySha256??'')||!/^[A-Za-z0-9_-]{1,63}$/.test(database)||!Number.isSafeInteger(oid)||oid<1||oid>4294967295)throw Error('fixed database and actual new role OID required');
 return `IF (SELECT encode(sha256(convert_to(system_identifier::text||'|'||current_database()||'|public','UTF8')),'hex') FROM pg_control_system())<>'${databaseIdentitySha256}' OR current_database()<>'${database}' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=${oid} AND rolname='${role}' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=${oid} OR member=${oid}) THEN RAISE EXCEPTION 'Exact reader identity changed'; END IF;`;
}
function mutation(database,oid,databaseIdentitySha256,statement,requireNoLogin=false){return `BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'; DO $guard$ BEGIN ${guard(database,oid,databaseIdentitySha256)} ${requireNoLogin?`IF (SELECT rolcanlogin FROM pg_roles WHERE oid=${oid}) THEN RAISE EXCEPTION 'Reader already active'; END IF;`:''} END $guard$; ${statement}; COMMIT;`;}
function verifier(password){
 // PostgreSQL scram-common.c format; generated passwords are ASCII hex (no SASLprep ambiguity).
 const salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
 const key=label=>createHmac('sha256',salted).update(label).digest();
 return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(key('Client Key')).digest('base64')}:${key('Server Key').toString('base64')}`;
}
async function parent(file,uid){const p=dirname(file),s=await lstat(p);if(await realpath(p)!==p||!s.isDirectory()||s.uid!==uid||(s.mode&0o077))throw Error('private connection parent required');return [s.dev,s.ino,s.uid,s.mode];}
async function pinFile(file,uid){
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await fd.stat();if(!s.isFile()||s.nlink!==1||s.uid!==uid||(s.mode&0o077)||s.size>4096)throw Error('unsafe private connection');const raw=await fd.readFile();if(!equal(identity(s),identity(await fd.stat()))||!equal(identity(s),identity(await lstat(file))))throw Error('connection changed');return {sha256:hash(raw),identity:identity(s)};}finally{await fd.close();}
}
async function syncParent(file){const d=await open(dirname(file),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}}
export async function installConnection({file,database,roleOid,databaseIdentitySha256,query,expectedUid=0}){
 guard(database,roleOid,databaseIdentitySha256);const directory=await parent(file,expectedUid);
 await query(mutation(database,roleOid,databaseIdentitySha256,'SELECT 1',true));
 const password=randomBytes(32).toString('hex'),secret=verifier(password);
 const raw=Buffer.from(`DATABASE_URL=postgresql://${role}:${password}@127.0.0.1:5432/${database}\n`);
 const fd=await open(file,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 let pin;
 try{
  await fd.chmod(0o600);await fd.writeFile(raw);await fd.sync();pin=await pinFile(file,expectedUid);
  if(pin.sha256!==hash(raw)||!equal(identity(await fd.stat()),pin.identity)||!equal(directory,await parent(file,expectedUid)))throw Error('private save changed');
  await syncParent(file);
  await query(mutation(database,roleOid,databaseIdentitySha256,`ALTER ROLE ${role} PASSWORD '${secret}'`,true));
  if(!equal(pin,await pinFile(file,expectedUid)))throw Error('connection changed before activation');
  await query(mutation(database,roleOid,databaseIdentitySha256,`ALTER ROLE ${role} LOGIN`,true));
  if(!equal(pin,await pinFile(file,expectedUid)))throw Error('connection changed after activation');
  return {...pin,database,roleOid,parentIdentity:directory,databaseIdentitySha256};
 }catch{
  // A bounded exact-role containment, not a retry of the failed action. Preserve file for inspection.
  try{await query(mutation(database,roleOid,databaseIdentitySha256,`ALTER ROLE ${role} NOLOGIN`));}catch{throw Error('Credential install stopped; reader containment unconfirmed, preserve private file');}
  throw Error('Credential install stopped; exact reader NOLOGIN, preserve private file');
 }finally{raw.fill(0);await fd.close();}
}
export async function withdrawConnection({file,pin,query,expectedUid=0}){
 if(!pin||!equal(pin.parentIdentity,await parent(file,expectedUid))||!equal({sha256:pin.sha256,identity:pin.identity},await pinFile(file,expectedUid)))throw Error('owned connection drift; do not remove');
 await query(mutation(pin.database,pin.roleOid,pin.databaseIdentitySha256,`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`));
 if(!equal({sha256:pin.sha256,identity:pin.identity},await pinFile(file,expectedUid))||!equal(pin.parentIdentity,await parent(file,expectedUid)))throw Error('connection changed during withdrawal; preserve file');
 await unlink(file);await syncParent(file);
 return {status:'owned-credential-withdrawn',roleRemoved:false,businessUnfrozen:false};
}

export async function containReader({database,roleOid,databaseIdentitySha256,query}){
 await query(mutation(database,roleOid,databaseIdentitySha256,`ALTER ROLE ${role} NOLOGIN`));
}

export function credentialObserveOperation(operation,journal,planSha256){
 if(!journal||journal.planSha256!==planSha256||journal.state!=='connections-held'||typeof journal.bootstrap!=='boolean'||!['install','withdraw'].includes(operation)||operation==='install'&&!journal.bootstrap)throw Error('exact held database phase required');
 return journal.bootstrap?'observe-bootstrap':'observe';
}
