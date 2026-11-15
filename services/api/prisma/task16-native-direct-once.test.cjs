'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
const file=path.join(__dirname,'run-task16-native-direct-once.cjs');
for(const args of [[],['--once'],['--docker'],['--prepare','--run-root','/tmp/foreign']])test('native fixed entry rejects incomplete/foreign invocation without resources '+args.join(' '),()=>{
 const result=spawnSync(process.execPath,[file,...args],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:5000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_ARGUMENTS'});assert.equal(result.stderr,'');
});
const fs=require('node:fs'),{randomUUID,createHash}=require('node:crypto');
function planModel(t){const root=fs.mkdtempSync('/private/tmp/jg-native-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const st=fs.lstatSync(root),runId=randomUUID();return {schemaVersion:2,purpose:'TASK16_NATIVE_DIRECT_CONTROLLED_NAME_V2',runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:root,rootIdentity:Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]])),source:{},artifacts:[],dependencies:{},prismaTools:{},interfaces:[],binaryManifest:{},binaries:[],openssl:{},externalLibraries:[],node:{},security:{},limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:[]};}
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
 assert.equal(classify(Object.assign(new Error('access denied'),{errorCode:'P1010'}),'no-tls').accepted,false);
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
 const options={runRoot:p.runRoot,binaryManifest:path.join(p.runRoot,'absent-qualified-manifest.json'),output:path.join(p.runRoot,'plan.json')};
 for(const sha of ['0'.repeat(64),'84aa6cb54fabd27296e907f7aa2e304fc3d7ea4fd478c846e7b69fe7d68f932a'])assert.throws(()=>prepareNativeTask16Plan({...options,binaryManifestSha256:sha}),error=>error.code==='NATIVE_DIRECT_BINARY_APPROVAL');
 assert.throws(()=>prepareNativeTask16Plan({...options,binaryManifestSha256:'26e93f289366a2f9c60c61b9035849052d59509d54f2c388cbdf7c419d3663a1'}),error=>error.code==='ENOENT');assert.deepEqual(fs.readdirSync(p.runRoot),[]);
});
test('generic SDK P1010 alone is unknown; only matching fresh native runtime HBA plaintext evidence closes it',()=>{
 const api=require('./run-task16-native-direct-once.cjs'),db='jg_task01_'+'a'.repeat(32),error=Object.assign(new Error('generic denied access'),{errorCode:'P1010'});
 const line='NATIVE_TASK16 [1234] FATAL:  pg_hba.conf rejects connection for host "127.0.0.1", user "jg_task01_runtime", database "'+db+'", no encryption\n';
 const proof=api.projectNativeTask16PlaintextHba(line,db);assert.deepEqual(proof,{family:'HBA_PLAINTEXT_REJECT',backendPids:[1234],count:1});
 assert.equal(api.classifyNativeTask16TlsFailure(error,'no-tls').accepted,false);assert.equal(api.classifyNativeTask16TlsFailure(error,'no-tls',proof).accepted,true);
 assert.equal(api.projectNativeTask16PlaintextHba(line.replace('jg_task01_runtime','jg_task01_owner'),db),undefined);
 assert.equal(api.projectNativeTask16PlaintextHba(line.replace('no encryption','SSL encryption'),db),undefined);
 assert.equal(api.projectNativeTask16PlaintextHba(line,'jg_task01_'+'b'.repeat(32)),undefined);
});
test('reviewed binary permission mode is compared to regular-file FD permissions without losing type checks',()=>{
 const {nativeTask16QualifiedModeMatches:matches}=require('./run-task16-native-direct-once.cjs');assert.equal(matches('33261',493),true);assert.equal(matches('33261',420),false);assert.equal(matches('41453',493),false);assert.equal(matches('4516',420),false);
});
test('TLS log window rejects a rotated pathname against the original foreground stdout inode',t=>{
 const {assertNativeTask16LogIdentity:check}=require('./run-task16-native-direct-once.cjs'),p=planModel(t),log=path.join(p.runRoot,'postgres.log');fs.writeFileSync(log,'',{mode:0o600});const original=fs.openSync(log,'r');
 const identity=check(original);fs.renameSync(log,log+'.original');fs.writeFileSync(log,'',{mode:0o600});const rotated=fs.openSync(log,'r');
 try{assert.throws(()=>check(rotated,identity),error=>error.code==='NATIVE_DIRECT_LOG_WINDOW');assert.deepEqual(check(original,identity),identity);assert.throws(()=>check(original,identity,log),error=>error.code==='NATIVE_DIRECT_LOG_WINDOW');}finally{fs.closeSync(original);fs.closeSync(rotated);}
});
for(const [instant,paidAt,openingDate]of [
 ['2026-11-14T16:00:00.000Z','2026-11-15','2026-11-14'],
 ['2026-02-28T16:00:00.000Z','2026-03-01','2026-02-28'],
 ['2028-02-29T16:00:00.000Z','2028-03-01','2028-02-29'],
 ['2026-12-31T16:00:00.000Z','2027-01-01','2026-12-31']
])test('native fixture preserves China payment day and prior-day opening '+instant,()=>{
 const {nativeTask16FixtureDates:dates}=require('./run-task16-native-direct-once.cjs');assert.deepEqual(dates(Date.parse(instant)),{paidAt,openingDate});
});
test('actual pnpm CLI dependency resolves the same installed schema engine before any native startup',()=>{
 const {resolveNativeTask16PrismaTools:resolve}=require('./run-task16-native-direct-once.cjs'),tools=resolve();
 assert.equal(path.basename(tools.engine.file),'schema-engine-darwin-arm64');assert.equal(fs.realpathSync(tools.engine.file),tools.engine.file);assert.equal(tools.version,'5.22.0');
 const packageFile=require('node:module').createRequire(tools.cli.file).resolve('@prisma/engines/package.json');assert.equal(tools.engine.file,path.join(path.dirname(fs.realpathSync(packageFile)),'schema-engine-darwin-arm64'));
 assert.ok(tools.engine.file.startsWith(path.resolve(__dirname,'../../..')+'/node_modules/'));assert.equal(fs.statSync(tools.engine.file).mode&0o111,0o111);
});
test('fixed actual compiled interfaces retain original projection JSON configuration and public exports without assembly',()=>{
 const {resolveNativeTask16Interfaces:resolve}=require('./run-task16-native-direct-once.cjs'),rows=resolve();
 assert.ok(rows.some(row=>row.file.endsWith('/dist/operating-projection/projection-export-json.js')&&row.exports.some(e=>e.name==='configureProjectionExportJson'&&e.kind==='function'&&e.arity===1)));
 assert.ok(rows.some(row=>row.exports.some(e=>e.name==='seedRegisteredPgFixture'&&e.kind==='function'&&e.arity===3)));
 assert.equal(rows.some(row=>row.file.endsWith('/dist/projection-export-json.js')),false);
});
test('readonly export qualification leaves parent business environment and API module cache untouched',()=>{
 const source=`const path=require('node:path');const api=require(${JSON.stringify(file)});const target=path.join(path.dirname(${JSON.stringify(file)}),'../dist/database/task16-registered-application.module.js');const before=Object.prototype.hasOwnProperty.call(require.cache,require.resolve(target));const value=process.env.NATIVE_QUAL_SENTINEL;const rows=api.resolveNativeTask16Interfaces();process.stdout.write(JSON.stringify({before,after:Object.prototype.hasOwnProperty.call(require.cache,require.resolve(target)),environmentUnchanged:process.env.NATIVE_QUAL_SENTINEL===value,count:rows.length}));`;
 const result=spawnSync(process.execPath,['-e',source],{encoding:'utf8',env:{PATH:path.dirname(process.execPath),NATIVE_QUAL_SENTINEL:'unchanged'},timeout:10000,maxBuffer:1048576});assert.equal(result.status,0);const value=JSON.parse(result.stdout);assert.equal(value.before,false);assert.equal(value.after,false);assert.equal(value.environmentUnchanged,true);assert.ok(value.count>10);
});

test('TLS error word projection is bounded own-data booleans and grants no new SAN acceptance',()=>{
 const api=require('./run-task16-native-direct-once.cjs'),project=api.projectNativeTask16TlsWords;
 const message='Error opening a TLS connection: certificate not valid for name; IP address mismatch; certificate verify failed; https://private.invalid/password-secret';
 const error=Object.assign(new Error(message),{errorCode:'P1011'}),words=project(error);
 assert.equal(words.messageState,'BOUNDED_OWN_DATA');assert.equal(words.tokens.tlsConnection,true);assert.equal(words.tokens.certificateNotValidForName,true);assert.equal(words.tokens.ipAddressMismatch,true);assert.equal(words.tokens.certificateVerifyFailed,true);
 assert.ok(Object.values(words.tokens).every(value=>typeof value==='boolean'));assert.ok(!JSON.stringify(words).includes('private.invalid'));assert.ok(!JSON.stringify(words).includes('password-secret'));
 assert.equal(api.classifyNativeTask16TlsFailure(Object.assign(new Error('Error opening a TLS connection: IP address mismatch; certificate verify failed'),{errorCode:'P1011'}),'wrong-san').accepted,false);
 let traps=0;const accessor={get message(){traps++;throw Error('private');}},proxy=new Proxy({}, {getOwnPropertyDescriptor(){traps++;throw Error('private');}});
 for(const value of [undefined,null,{},accessor,proxy,{message:42},{message:'x'.repeat(32769)},{message:'汉'.repeat(11000)}]){const result=project(value);assert.equal(result.messageState,'UNKNOWN');assert.ok(Object.values(result.tokens).every(flag=>flag===false));}
 assert.equal(traps,0);assert.equal(project({message:'x'.repeat(32768)}).messageState,'BOUNDED_OWN_DATA');
 for(const [message,key]of [['NotValidForName','notValidForName'],['not valid for name','notValidForNameSpaced'],['hostname mismatch','hostnameMismatch'],['hostname does not match','hostnameDoesNotMatch'],['certificate is not valid for','certificateIsNotValidFor']])assert.equal(project({message}).tokens[key],true);
});

test('V2 controlled name result requires the current policy and real generic TLS evidence without changing strict classification',()=>{
 const api=require('./run-task16-native-direct-once.cjs'),binding={runId:'12345678-1234-4234-8234-123456789012',port:55432,caSha256:'a'.repeat(64),serverSha256:'b'.repeat(64),configurationSha256:'c'.repeat(64)};
 const context={binding,currentBinding:{...binding},positiveClientsVerified:true,onlyHostnameChanged:true,positivePolicy:{exitCode:0,hostnameMismatch:false,error67602:false},negativePolicy:{exitCode:1,hostnameMismatch:true,error67602:true}};
 const error=Object.assign(new Error('Error opening a TLS connection. certificate was not trusted'),{errorCode:'P1011'}),project=c=>api.controlledNativeTask16NameResult(error,JSON.stringify(c));
 assert.equal(api.classifyNativeTask16TlsFailure(error,'wrong-san').accepted,false);
 assert.deepEqual(project(context),{kind:'CONTROLLED_NAME_REJECTION_WITH_NATIVE_POLICY',accepted:true,sdkDirectCause:false});
 for(const delta of [{positiveClientsVerified:false},{onlyHostnameChanged:false},{currentBinding:{...binding,port:55433}},{currentBinding:{...binding,runId:'22345678-1234-4234-8234-123456789012'}},{currentBinding:{...binding,caSha256:'d'.repeat(64)}},{currentBinding:{...binding,serverSha256:'d'.repeat(64)}},{currentBinding:{...binding,configurationSha256:'d'.repeat(64)}},{positivePolicy:{...context.positivePolicy,exitCode:1}},{negativePolicy:{...context.negativePolicy,exitCode:0}},{negativePolicy:{...context.negativePolicy,hostnameMismatch:false}},{negativePolicy:{...context.negativePolicy,error67602:false}}])assert.equal(project({...context,...delta}).accepted,false);
 for(const message of ['Error opening a TLS connection. UnknownIssuer','Error opening a TLS connection. certificate was not trusted UnknownIssuer','certificate was not trusted','Error opening a TLS connection generic','Error opening a TLS connection. certificate was not trusted ECONNREFUSED'])assert.equal(api.controlledNativeTask16NameResult(Object.assign(new Error(message),{errorCode:'P1011'}),JSON.stringify(context)).accepted,false);
 assert.equal(api.controlledNativeTask16NameResult(Object.assign(new Error(error.message),{errorCode:'P1001'}),JSON.stringify(context)).accepted,false);
 let traps=0;const getter={get message(){traps++;throw Error('private');}};assert.equal(api.controlledNativeTask16NameResult(getter,JSON.stringify(context)).accepted,false);assert.equal(traps,0);
 assert.deepEqual(api.projectNativeTask16SecurityPolicy({code:1,stdout:'SSLHostname Host name mismatch -67602',stderr:''}),context.negativePolicy);
 assert.throws(()=>api.projectNativeTask16SecurityPolicy({code:1,stdout:'x'.repeat(1048577),stderr:''}));
});
test('V2 plan rejects old V1 even with the new security field and qualifies only the fixed root-owned security tool',t=>{
 const api=require('./run-task16-native-direct-once.cjs'),p=planModel(t);assert.throws(()=>api.validateNativePlan({...p,schemaVersion:1,purpose:'TASK16_NATIVE_DIRECT_PRODUCTION_READER_V1'}));
 const tool=api.captureNativeTask16Security();assert.equal(tool.file,'/usr/bin/security');assert.equal(tool.identity.uid,'0');assert.equal((Number(tool.identity.mode)&0o022),0);assert.ok((Number(tool.identity.mode)&0o111)!==0);
});
