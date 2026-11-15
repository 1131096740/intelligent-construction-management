'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
const file=path.join(__dirname,'run-task16-native-direct-once.cjs');
for(const args of [[],['--once'],['--docker'],['--prepare','--run-root','/tmp/foreign']])test('native fixed entry rejects incomplete/foreign invocation without resources '+args.join(' '),()=>{
 const result=spawnSync(process.execPath,[file,...args],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:5000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_ARGUMENTS'});assert.equal(result.stderr,'');
});
const fs=require('node:fs'),{randomUUID,createHash}=require('node:crypto');
function planModel(t){const root=fs.mkdtempSync('/private/tmp/jg-native-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const st=fs.lstatSync(root),runId=randomUUID();return {schemaVersion:1,purpose:'TASK16_NATIVE_DIRECT_PRODUCTION_READER_V1',runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:root,rootIdentity:Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]])),source:{},artifacts:[],dependencies:{},binaryManifest:{},binaries:[],openssl:{},externalLibraries:[],node:{},limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:[]};}
test('native plan keeps fixed purpose, original budgets and owned private root; structural data grants no execution',t=>{
 const {validateNativePlan}=require('./run-task16-native-direct-once.cjs'),p=planModel(t);assert.equal(validateNativePlan(p).runRoot,p.runRoot);
 for(const field of Object.keys(p.limits))assert.throws(()=>validateNativePlan({...p,limits:{...p.limits,[field]:p.limits[field]+1}}));
 assert.throws(()=>validateNativePlan({...p,purpose:'CURRENT259_PRIVATE_PAYMENT_CASE'}));assert.throws(()=>validateNativePlan({...p,database:'postgres'}));
 let traps=0;const getter={...p};Object.defineProperty(getter,'source',{get(){traps++;throw Error('private');},enumerable:true});assert.throws(()=>validateNativePlan(getter));assert.equal(traps,0);
 assert.throws(()=>validateNativePlan(new Proxy(p,{ownKeys(){traps++;throw Error('private');}})));assert.equal(traps,0);
});
test('forged structural plan cannot start a process, write once or construct SDK',t=>{
 const p=planModel(t),target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[file,'--once','--plan',target,'--expected-plan-sha256',createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);const out=JSON.parse(result.stdout);assert.equal(out.status,'REJECTED_NO_RESOURCES');assert.ok(['NATIVE_DIRECT_SOURCE_DIRTY','NATIVE_DIRECT_SOURCE_CHANGED','NATIVE_DIRECT_RUNTIME'].includes(out.code));assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('native original resource abort reaches cleanup even when a real phase Promise never settles',async()=>{
 const api=require('./run-task16-native-direct-once.cjs'),controller=new AbortController();let calls=0,cleaned=false;
 const running=api.waitNativeTask16Operation(()=>{calls++;return new Promise(()=>{});},controller.signal).finally(()=>{cleaned=true;});
 controller.abort();await assert.rejects(running,error=>error.code==='NATIVE_DIRECT_DEADLINE');assert.equal(calls,1);assert.equal(cleaned,true);
 await assert.rejects(api.waitNativeTask16Operation(()=>{calls++;return 1;},controller.signal));assert.equal(calls,1);
});
test('native aborted construction cannot continue to listen; late owned result is disposed once',async()=>{
 const api=require('./run-task16-native-direct-once.cjs'),controller=new AbortController();let resolve,disposed=0;
 const pending=new Promise(r=>{resolve=r;});const running=api.waitNativeTask16Operation(()=>pending,controller.signal,()=>{disposed++;});controller.abort();await assert.rejects(running);resolve({owned:true});await new Promise(r=>setImmediate(r));assert.equal(disposed,1);
});
test('retained foreground child refuses a changed PID and never signals after original exit',async()=>{
 const {trackNativeTask16Child}=require('./run-task16-native-direct-once.cjs');
 const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},40)'],{env:{PATH:path.dirname(process.execPath)},stdio:'ignore'});
 const owner=trackNativeTask16Child(child);assert.equal(owner.running(),true);const pid=child.pid;child.pid=999999;
 assert.equal(owner.running(),false);assert.throws(()=>owner.stop());child.pid=pid;
 await owner.terminal;assert.equal(owner.running(),false);assert.throws(()=>owner.stop());
});
test('SDK TLS negative classification accepts certificate evidence and keeps DNS/refused unknown',()=>{
 const {classifyNativeTask16TlsFailure:classify}=require('./run-task16-native-direct-once.cjs');
 assert.deepEqual(classify(Object.assign(new Error('Error opening a TLS connection: invalid peer certificate: NotValidForName'),{errorCode:'P1011'}),'wrong-san'),{prismaCode:'P1011',kind:'CERTIFICATE_NAME_REJECTED',accepted:true});
 assert.equal(classify(Object.assign(new Error('Error opening a TLS connection: UnknownIssuer'),{errorCode:'P1011'}),'wrong-ca').accepted,true);
 assert.equal(classify(Object.assign(new Error('Error opening a TLS connection: UnknownIssuer'),{errorCode:'P1011'}),'wrong-san').accepted,false);
 assert.equal(classify(Object.assign(new Error('Error opening a TLS connection: certificate was not trusted'),{errorCode:'P1011'}),'wrong-san').accepted,false);
 for(const message of ['Connection refused','DNS lookup failed','TLS connection generic'])assert.equal(classify(Object.assign(new Error(message),{errorCode:'P1001'}),'wrong-san').accepted,false);
 assert.equal(classify(Object.assign(new Error('generic TLS connection error'),{errorCode:'P1011'}),'wrong-san').accepted,false);
 assert.equal(classify(Object.assign(new Error('access denied'),{errorCode:'P1010'}),'no-tls').accepted,true);
 let traps=0;const error={get errorCode(){traps++;return 'P1011';},get message(){traps++;return 'TLS connection certificate was not trusted';}};assert.equal(classify(error,'wrong-san').accepted,false);assert.equal(traps,0);
 assert.equal(JSON.stringify(classify(Object.assign(new Error('private password'),{errorCode:'P1001'}),'wrong-san')).includes('password'),false);
});
test('fixed localhost TLS target accepts only actual loopback answers and rejects external or unknown',()=>{
 const {verifyNativeTask16LocalhostAnswers:verify}=require('./run-task16-native-direct-once.cjs');assert.deepEqual(verify([{address:'127.0.0.1',family:4},{address:'::1',family:6}]),[{address:'127.0.0.1',family:4},{address:'::1',family:6}]);
 for(const value of [[],[{address:'127.0.0.1',family:4},{address:'192.168.1.1',family:4}],[{address:'127.0.0.2',family:4}]])assert.throws(()=>verify(value));
 let traps=0;assert.throws(()=>verify([{get address(){traps++;return '127.0.0.1';},family:4}]));assert.equal(traps,0);
});
test('new native purpose accepts only the explicitly reviewed93-file binary qualification hash',t=>{
 const p=planModel(t),{prepareNativeTask16Plan}=require('./run-task16-native-direct-once.cjs');
 if(process.platform!=='darwin'||process.arch!=='arm64'||process.version!=='v20.20.2')return;
 assert.throws(()=>prepareNativeTask16Plan({runRoot:p.runRoot,binaryManifest:'/private/tmp/not-approved.json',binaryManifestSha256:'0'.repeat(64),output:path.join(p.runRoot,'plan.json')}),error=>error.code==='NATIVE_DIRECT_BINARY_APPROVAL');assert.deepEqual(fs.readdirSync(p.runRoot),[]);
});
