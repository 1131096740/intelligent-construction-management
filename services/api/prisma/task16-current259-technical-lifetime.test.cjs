"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=path.join(__dirname,'enterprise-task01-resources.cjs');
const options=()=>({runId:'12345678-1234-4234-8234-123456789012',sourceSha:'a'.repeat(40),artifactsDir:'/private/tmp/lifetime-model/run',endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',daemonId:'synthetic-daemon-12345',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',tools:{docker:'/synthetic/docker',openssl:'/synthetic/openssl'},ownerPassword:'b'.repeat(96)});
function fixture(){
 const receipts=[],writes=[],commands=[];
 const stat={uid:process.getuid(),mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>true};
 const mockFs={constants:{X_OK:1},realpathSync:file=>file,statSync:()=>stat,lstatSync:()=>stat,existsSync:()=>false,accessSync(){},mkdirSync(){},renameSync(){},unlinkSync(){},writeFileSync(file,bytes){writes.push(file);if(file.endsWith('resource-manifest.pending'))receipts.push(JSON.parse(bytes));}};
 const api={exports:{}};const req=name=>name==='node:fs'?mockFs:name==='node:child_process'?{spawn(...args){commands.push(args);throw Error('SYNTHETIC_STOP_BEFORE_TOOL');}}:require(name);
 new Function('require','module',fs.readFileSync(source,'utf8'))(req,api);
 return {api:api.exports,receipts,writes,commands};
}
test('old physical resource still rejects900001 before preparation or tool IO',async()=>{
 const f=fixture();await assert.rejects(f.api.startTask01Postgres({...options(),deadlineMs:900001}),/TASK01_RESOURCE_INPUT_INVALID/);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.commands,[]);
});
test('named technical physical resource fixes3600000 while old default remains900000',async()=>{
 for(const [entry,deadline] of [['startTask01Postgres',900000],['startCurrent259TechnicalPostgres',3600000]]){
  const f=fixture();await assert.rejects(f.api[entry](options()));
  assert.equal(f.receipts[0].limits.totalDeadlineMs,deadline);
  assert.equal(f.receipts[0].purpose,deadline===3600000?'CURRENT259_TECHNICAL_MIGRATIONS_V1':undefined);
  assert.ok(f.commands.length>0,'only synthetic spawn boundary is reached');
 }
});
test('named technical entry rejects caller deadlines/purpose/max flags before preparation',async()=>{
 for(const extra of [{deadlineMs:900000},{deadlineMs:3600000},{deadlineMs:3600001},{purpose:'CURRENT259_TECHNICAL_MIGRATIONS_V1'},{maxDeadlineMs:7200000},{technical:true}]){
  const f=fixture();await assert.rejects(f.api.startCurrent259TechnicalPostgres({...options(),...extra}),/TASK01_RESOURCE_INPUT_INVALID/);
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.commands,[]);
 }
});

test('the fixed contract rules extend the original bytes only before the two final TLS rejects',()=>{
 const raw={exports:{}};
 const body=fs.readFileSync(source,'utf8')+'\nmodule.exports={hbaRules,renderHba,ROLES,CONTRACT_LOGINS};';
 new Function('require','module',body)(require,raw);
 const {hbaRules,renderHba,ROLES,CONTRACT_LOGINS}=raw.exports;
 const database='jg_task01_'+'1'.repeat(32);
 const fixedRoles=['jg_task01_owner','jg_task01_runtime','jg_task01_observer'];
 assert.deepEqual(ROLES,fixedRoles);
 const original=[
  'local all jg_task01_owner peer map=jg_task01_init','local all all reject',
  'hostnossl all all 0.0.0.0/0 reject','hostnossl all all ::/0 reject',
  ...fixedRoles.flatMap(role=>[`hostssl ${database} ${role} 0.0.0.0/0 scram-sha-256`,`hostssl ${database} ${role} ::/0 scram-sha-256`]),
  'hostssl all all 0.0.0.0/0 reject','hostssl all all ::/0 reject',
 ];
 assert.equal(renderHba(hbaRules(database,ROLES)),original.join('\n')+'\n');
 const five=['jg_fixture_app_'+'a'.repeat(24),...CONTRACT_LOGINS];
 const extended=hbaRules(database,[...ROLES,...five]);
 assert.equal(extended.length,22);
 assert.equal(renderHba([...extended.slice(0,10),...extended.slice(20)]),original.join('\n')+'\n');
 assert.deepEqual(extended.slice(10,20),five.flatMap(role=>['0.0.0.0','::'].map(ip=>['hostssl',database,role,ip,'scram-sha-256',[]])));
});
