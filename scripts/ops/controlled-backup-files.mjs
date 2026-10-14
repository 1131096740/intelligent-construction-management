import {open,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const FILES=Object.freeze({'run-production-db-backup.sh':0o700,'db-backup.sh':0o700,'db-backup-read-role.sql':0o600,'private-libpq-service.mjs':0o600,'cos-backup-transfer.mjs':0o600});
const sha=b=>createHash('sha256').update(b).digest('hex');
const identity=s=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function directory(path,uid,privateDirectory=false){const s=await lstat(path);if(await realpath(path)!==path||!s.isDirectory()||s.uid!==uid||(s.mode&(privateDirectory?0o077:0o022)))throw Error('unsafe package directory');return [s.dev,s.ino,s.uid,s.gid,s.mode];}
async function sync(path){const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
async function read(path,uid){const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await fd.stat();if(!s.isFile()||s.nlink!==1||s.uid!==uid||s.size>1048576||(s.mode&0o022))throw Error('unsafe package file');const bytes=await fd.readFile(),current=await fd.stat(),named=await lstat(path);if(!same(identity(s),identity(current))||!same(identity(s),identity(named)))throw Error('package file changed');return {bytes,pin:{identity:identity(s),sha256:sha(bytes)}};}finally{await fd.close();}}
async function match(path,pin,uid){const r=await read(path,uid);if(!same(r.pin,pin))throw Error('package file changed');return r.bytes;}
async function absent(path){try{await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('expected absent package file changed');}
async function create(path,bytes,mode,uid,gid){const fd=await open(path,'wx+',mode);try{if(gid!==undefined)await fd.chown(uid,gid);await fd.chmod(mode);await fd.writeFile(bytes);await fd.sync();const r=await read(path,uid);if(!same(identity(await fd.stat()),r.pin.identity)||r.pin.sha256!==sha(bytes))throw Error('created package file changed');return r.pin;}finally{await fd.close();}}
async function save(fd,path,value,uid){const bytes=Buffer.from(JSON.stringify(value)+'\n');await fd.truncate(0);await fd.write(bytes,0,bytes.length,0);await fd.sync();const r=await read(path,uid);if(!same(identity(await fd.stat()),r.pin.identity)||r.pin.sha256!==sha(bytes))throw Error('package journal changed');await sync(join(path,'..'));}
function inputs(p){if(!/^[a-f0-9]{40}$/.test(p.candidateSha??'')||Object.keys(p.before).sort().join()!==Object.keys(FILES).sort().join())throw Error('invalid exact package inputs');for(const b of Object.values(p.before)){if(typeof b.exists!=='boolean'||b.exists&&(!/^[a-f0-9]{64}$/.test(b.sha256??'')||![0o600,0o700].includes(b.mode)))throw Error('invalid exact before metadata');}}
export async function installBackupFiles(p){
 p={...p,before:structuredClone(p.before)};inputs(p);const uid=p.expectedUid??0,started=Date.now(),deadline=()=>{if(Date.now()-started>60000)throw Error('package deadline');};
 const targetPin=await directory(p.target,uid),sourcePin=await directory(p.source,p.sourceUid??uid),statePin=await directory(p.state,uid,true);
 const verifyDirs=async()=>{deadline();if(!same(targetPin,await directory(p.target,uid))||!same(sourcePin,await directory(p.source,p.sourceUid??uid))||!same(statePin,await directory(p.state,uid,true)))throw Error('package directory changed');};
 await p.observe();const rows=[];
 // Validate all before and source files before reserving a new receipt or replacing anything.
 for(const [name,mode]of Object.entries(FILES)){const source=await read(join(p.source,name),p.sourceUid??uid),b=p.before[name];let before=null;if(b.exists){const r=await read(join(p.target,name),uid);if(r.pin.sha256!==b.sha256||(r.pin.identity[4]&0o777)!==b.mode)throw Error('before package changed');before=r;}else await absent(join(p.target,name));rows.push({name,mode,sourcePin:source.pin,sourceBytes:source.bytes,before});}
 await verifyDirs();const journalPath=join(p.state,'journal.json'),fd=await open(journalPath,'wx+',0o600);const j={state:'prepared',candidateSha:p.candidateSha,target:p.target,source:p.source,targetPin,sourcePin,statePin,files:[]};
 try{
  for(const r of rows){let snapshot=null;if(r.before)snapshot=await create(join(p.state,'before-'+r.name),r.before.bytes,0o600,uid);const staged=await create(join(p.target,'.controlled-new-'+r.name),r.sourceBytes,r.mode,uid);j.files.push({name:r.name,mode:r.mode,sourcePin:r.sourcePin,before:r.before?.pin??null,snapshot,staged,after:null});}
  await sync(p.target);await save(fd,journalPath,j,uid);
  for(const r of j.files){await p.observe();await verifyDirs();await match(join(p.source,r.name),r.sourcePin,p.sourceUid??uid);if(r.before)await match(join(p.target,r.name),r.before,uid);else await absent(join(p.target,r.name));await match(join(p.target,'.controlled-new-'+r.name),r.staged,uid);await rename(join(p.target,'.controlled-new-'+r.name),join(p.target,r.name));await sync(p.target);r.after=(await read(join(p.target,r.name),uid)).pin;if(r.after.sha256!==r.sourcePin.sha256||!same(r.after.identity.slice(0,7),r.staged.identity.slice(0,7)))throw Error('installed package changed');await save(fd,journalPath,j,uid);}
  await p.observe();await verifyDirs();for(const r of j.files)await match(join(p.target,r.name),r.after,uid);j.state='installed';await save(fd,journalPath,j,uid);return structuredClone(j);
 }finally{await fd.close();}
}
export async function withdrawBackupFiles(p){
 p={...p};
 const uid=p.expectedUid??0,j=structuredClone(p.journal);if(j.state!=='installed'||j.candidateSha!==p.candidateSha||j.target!==p.target||j.source!==p.source||j.files?.length!==5||j.files.map(r=>r.name).join()!==Object.keys(FILES).join())throw Error('incomplete or foreign package journal');
 const started=Date.now(),verifyDirs=async()=>{if(Date.now()-started>60000||!same(j.targetPin,await directory(p.target,uid))||!same(j.sourcePin,await directory(p.source,p.sourceUid??uid))||!same(j.statePin,await directory(p.state,uid,true)))throw Error('package directory changed');};
 await verifyDirs();const journalPath=join(p.state,'journal.json'),saved=await read(journalPath,uid);if(!same(JSON.parse(saved.bytes),j))throw Error('package journal changed');
 await p.observe();for(const r of j.files){if(r.mode!==FILES[r.name])throw Error('package mode changed');await match(join(p.target,r.name),r.after,uid);if(r.before){const bytes=await match(join(p.state,'before-'+r.name),r.snapshot,uid);if(sha(bytes)!==r.before.sha256)throw Error('before snapshot changed');await absent(join(p.target,'.controlled-restore-'+r.name));}}
 const fd=await open(journalPath,constants.O_RDWR|constants.O_NOFOLLOW);try{if(!same(identity(await fd.stat()),saved.pin.identity))throw Error('package journal changed');j.state='restoring';await save(fd,journalPath,j,uid);
 for(const r of j.files){await p.observe();await verifyDirs();await match(join(p.target,r.name),r.after,uid);if(r.before){const bytes=await match(join(p.state,'before-'+r.name),r.snapshot,uid),stage=join(p.target,'.controlled-restore-'+r.name),pin=await create(stage,bytes,r.before.identity[4]&0o777,uid,r.before.identity[3]);await match(join(p.target,r.name),r.after,uid);await match(stage,pin,uid);await rename(stage,join(p.target,r.name));r.restoredPin=(await read(join(p.target,r.name),uid)).pin;if(r.restoredPin.sha256!==r.before.sha256||!same(r.restoredPin.identity.slice(2,5),r.before.identity.slice(2,5)))throw Error('restored package changed');}else{await match(join(p.target,r.name),r.after,uid);await unlink(join(p.target,r.name));}await sync(p.target);r.restored=true;await save(fd,journalPath,j,uid);}
 await p.observe();await verifyDirs();for(const r of j.files){if(r.before)await match(join(p.target,r.name),r.restoredPin,uid);else await absent(join(p.target,r.name));}j.state='restored';await save(fd,journalPath,j,uid);return structuredClone(j);
 }finally{await fd.close();}
}
