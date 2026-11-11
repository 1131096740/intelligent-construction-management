"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
test('plain resource proof cannot create or claim an owned259 resource',async()=>{
 const api=require('./task16-current259-owned-resource.cjs');
 await assert.rejects(api.withCurrent259OwnedResource({native:true},{artifactsDir:'/private/tmp/no-create',daemonId:'synthetic-daemon-12345'},undefined,()=>{}),/CURRENT259_BUILD_HANDLE/u);
 assert.throws(()=>api.claimCurrent259OwnedResource({kind:'CURRENT259_OWNED_RESOURCE'}),/CURRENT259_RESOURCE_HANDLE/u);
});

// Private module instance at the real resource/build system boundary. Production
// exports have no injected start, IO, constructor, credential or proof argument.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sourceFile=path.join(__dirname,'task16-current259-owned-resource.cjs');
function fixture(){
 const build=Object.freeze({}),calls=[],state={closeCount:0,alive:true,toolChanged:false},id='12345678-1234-4234-8234-123456789012';
 const source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:{ledgerSha256:'d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952',prefix256Sha256:'85d1a225757b69aa81531560c7d989441ae6de6400c3a77737a86fc5e4a54a24'}};
 const loader=Object.freeze({check(){if(!state.alive)throw new Error('STALE_BUILD');},verifyFull(){if(!state.alive)throw new Error('STALE_BUILD');if(state.fullInvalid)throw new Error('STALE_FULL_MATERIAL');},witness(){return {source,build:{trees:Array.from({length:5},(_,i)=>({root:String(i),digest:'d'.repeat(64)}))}};}});
 const hashes={caSha256:'1'.repeat(64),wrongCaSha256:'2'.repeat(64),correctCertificateSha256:'3'.repeat(64),wrongSanCertificateSha256:'4'.repeat(64),correctCertificateDerSha256:'5'.repeat(64),wrongSanCertificateDerSha256:'6'.repeat(64)};
 const receipt={runId:id,sourceSha:source.candidateSha,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',daemonId:'synthetic-daemon-12345',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',databaseName:'jg_task01_'+id.replaceAll('-',''),containerId:'7'.repeat(64),networkId:'8'.repeat(64),port:32456,status:'started-awaiting-driver-verification',cleanup:{status:'pending'},tls:{...hashes,correctChainVerified:true,correctSanVerified:true,wrongCaChainRejected:true,wrongSanChainVerified:true,wrongSanMismatchVerified:true},requestedCertificateMode:'correct',reloadState:'OBSERVED_PEER_CERTIFICATE_MATCHED',presentedCertificate:{mode:'correct',derSha256:hashes.correctCertificateDerSha256},hostOwnerCredentialFilesErased:true,hostPrivateKeyFilesErased:true,hostPrivateMaterialsErased:true,topology:'UNVERIFIED_HOST_PUBLISHED_TLS'};
 const resource={containerId:receipt.containerId,networkId:receipt.networkId,port:receipt.port,databaseName:receipt.databaseName,caPath:'/private/tmp/model/run/tls-private/ca.crt',wrongCaPath:'/private/tmp/model/run/tls-private/wrong-ca.crt',serverCertHashes:hashes,getReceipt(){return structuredClone(receipt);},async close(){state.closeCount++;if(state.closeFailure)throw new Error('CLOSE_PRIVATE_DETAIL');receipt.status='closed';receipt.cleanup={status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true};},async captureLogCursor(){calls.push('inspect');if(state.inspectFailure)throw new Error('INSPECT_FAILED');if(state.inspectFullInvalid)state.fullInvalid=true;return {runId:id,containerId:resource.containerId};},async execOwnerSql(...args){calls.push(['owner',...args]);return {stdout:'fixed-result'};},async observePresentedCertificate(){},async setServerCertificate(){},async readPlaintextRejectionEvidence(){},async inspectConnectionEndpoint(){return {serverAddress:"172.29.0.2"};}};
 const tools=new Map([['/Applications/Docker.app/Contents/Resources/bin/docker','6c3c88771987b73d66d0664b22800f46c827f96db67579594d39163ab88e8c40'],['/opt/homebrew/Cellar/openssl@3/3.6.3/bin/openssl','103fc7706cf6646f226d96f29242d81890363499afc730e7ef1fadd64b3a123c']]);
 const mockFs={constants:{X_OK:1},realpathSync:p=>p,existsSync:()=>false,lstatSync:()=>({uid:process.getuid(),mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false}),statSync:()=>({uid:501,mode:0o100755,dev:1,ino:2,size:3,mtimeMs:4,ctimeMs:5,isFile:()=>true}),accessSync(){},readFileSync:p=>Buffer.from(p)};
 const mockCrypto={randomUUID:()=>id,randomBytes:()=>Buffer.alloc(48,9),createHash:()=>({update(bytes){this.bytes=String(bytes);return this;},digest(){return state.toolChanged?'0'.repeat(64):tools.get(this.bytes)||crypto.createHash('sha256').update(this.bytes).digest('hex');}})};
 const entries={},fixed={
  './task16-current259-client-loader.cjs':Object.freeze({loadCurrent259Client(handle){calls.push('load');if(handle!==build)throw new Error('CURRENT259_BUILD_HANDLE');return loader;}}),
  './enterprise-task01-resources.cjs':{async startTask01Postgres(options){calls.push('start');state.options=options;if(state.startFailure)throw state.startFailure;if(state.startWait)await state.startWait;return resource;},async startCurrent259TechnicalPostgres(options){calls.push('technical-start');state.options=options;receipt.purpose='CURRENT259_TECHNICAL_MIGRATIONS_V1';receipt.limits={totalDeadlineMs:3600000};if(state.startFailure)throw state.startFailure;if(state.startWait)await state.startWait;return resource;}}
 };
 function privateRequire(name){if(Object.hasOwn(fixed,name)){const filename=privateRequire.resolve(name);entries[filename]||={exports:fixed[name],loaded:true};return entries[filename].exports;}if(name==='node:fs')return mockFs;if(name==='node:crypto')return mockCrypto;return require(name);}
 privateRequire.resolve=name=>path.join(__dirname,name);privateRequire.cache=entries;
 const instance={exports:{}};new Function('require','module','__dirname',fs.readFileSync(sourceFile,'utf8'))(privateRequire,instance,__dirname);
 return {api:instance.exports,build,calls,state,receipt,resource,loader,plan:{artifactsDir:'/private/tmp/model/run',daemonId:'synthetic-daemon-12345'}};
}
test('a completed actual-shaped start owns one resource and the original loader only within its callback',async()=>{
 const f=fixture();let retained,view;
 const result=await f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,async handle=>{
  retained=handle;view=f.api.claimCurrent259OwnedResource(handle);
  assert.equal(view.loader,f.loader);assert.equal(f.api.claimCurrent259OwnedResource(handle),view);
  assert.equal(view.resource.port,32456);assert.equal(view.scope,'OWNED_RESOURCE_ONLY');
  assert.equal(view.resource.topology,'UNVERIFIED_HOST_PUBLISHED_TLS');
  assert.deepEqual(await view.resource.execOwnerSql('fixed-stage-sql','stage'),{stdout:'fixed-result'});
  return 'done';
 });
 assert.equal(result,'done');assert.equal(f.state.closeCount,1);
 assert.throws(()=>f.api.claimCurrent259OwnedResource(retained),/CURRENT259_RESOURCE_HANDLE/u);
 assert.throws(()=>view.credentials(),/CURRENT259_RESOURCE_CLOSED/u);
 assert.equal(f.state.options.sourceSha,'a'.repeat(40));assert.equal(f.state.options.ownerPassword,'09'.repeat(48));
});
test('a malformed returned IO descriptor still closes the original returned resource once',async()=>{
 const f=fixture();let getter=0;
 Object.defineProperty(f.resource,'execOwnerSql',{get(){getter++;return ()=>{};}});
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>assert.fail('must not issue handle')),/CURRENT259_RESOURCE_DESCRIPTOR/u);
 assert.equal(getter,0);assert.equal(f.state.closeCount,1);
});
test('a caught continuity failure initiates cleanup and cannot be repaired into a second claim',async()=>{
 const f=fixture();
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,async handle=>{
  const view=f.api.claimCurrent259OwnedResource(handle);f.state.alive=false;
  assert.throws(()=>f.api.claimCurrent259OwnedResource(handle),/STALE_BUILD/u);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.closeCount,1);
  f.state.alive=true;assert.throws(()=>f.api.claimCurrent259OwnedResource(handle),/CURRENT259_RESOURCE_HANDLE/u);
  assert.throws(()=>view.credentials(),/CURRENT259_RESOURCE_CLOSED/u);
 }),/CURRENT259_RESOURCE_CLOSED/u);
 assert.equal(f.state.closeCount,1);
});
test('a falsey callback failure is still a failure after owned cleanup',async()=>{
 const f=fixture();let rejected=false;
 try{await f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{throw undefined;});}catch(error){rejected=true;assert.equal(error,undefined);}
 assert.equal(rejected,true);assert.equal(f.state.closeCount,1);
});
test('the public API accepts no arbitrary tools, exec, resource or start authority',async()=>{
 for(const key of ['tools','exec','resource','start','native']){
  const f=fixture();let invoked=0;Object.defineProperty(f.plan,key,{get(){invoked++;throw new Error('unexpected');},enumerable:true});
  await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{}),/CURRENT259_RESOURCE_PLAN/u);
  assert.equal(invoked,0);assert.equal(f.calls.includes('start'),false);
 }
});
test('copies and proxies cannot claim a currently live resource and do not execute getters',async()=>{
 const f=fixture();let count=0;
 await f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,handle=>{
  for(const fake of [{...handle},new Proxy(handle,{get(){count++;}}),{get kind(){count++;return 'CURRENT259_OWNED_RESOURCE';}}])assert.throws(()=>f.api.claimCurrent259OwnedResource(fake),/CURRENT259_RESOURCE_HANDLE/u);
 });assert.equal(count,0);
});
test('the same genuine build cannot issue a second resource lifetime',async()=>{
 const f=fixture();await f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{});
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{}),/CURRENT259_RESOURCE_BUILD_REUSED/u);
 assert.equal(f.calls.filter(x=>x==='start').length,1);
});
for(const [name,change,reason]of [
 ['wrong run',r=>r.runId='foreign-run','IDENTITY'],['wrong daemon',r=>r.daemonId='foreign-daemon','IDENTITY'],
 ['wrong source',r=>r.sourceSha='b'.repeat(40),'IDENTITY'],['wrong container',r=>r.containerId='f'.repeat(64),'IDENTITY'],
 ['wrong port',r=>r.port++,'IDENTITY'],['uncleared host secret',r=>r.hostOwnerCredentialFilesErased=false,'TLS'],
 ['unverified TLS',r=>r.tls.correctSanVerified=false,'TLS'],['no observed peer',r=>r.presentedCertificate=null,'TLS']
])test(`${name} returned by the start cannot issue a handle`,async()=>{
 const f=fixture();change(f.receipt);let called=0;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{called++;}),new RegExp('CURRENT259_RESOURCE_'+reason,'u'));
 assert.equal(called,0);assert.equal(f.state.closeCount,1);
});
test('actual ownership inspect failure after start closes without a handle',async()=>{
 const f=fixture();f.state.inspectFailure=true;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>assert.fail('no handle')),/INSPECT_FAILED/u);
 assert.equal(f.state.closeCount,1);
});
test('pinned tool bytes cannot drift into a live capability',async()=>{
 const f=fixture();f.state.toolChanged=true;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{}),/CURRENT259_RESOURCE_TOOL_CHANGED/u);
 assert.equal(f.calls.includes('start'),false);
});
test('abort during the original start waits for its result and cleans it without issuance',async()=>{
 const f=fixture(),controller=new AbortController();let release;f.state.startWait=new Promise(resolve=>release=resolve);
 const running=f.api.withCurrent259OwnedResource(f.build,f.plan,controller.signal,()=>assert.fail('aborted no handle'));
 controller.abort();release();await assert.rejects(running,/CURRENT259_RESOURCE_ABORTED/u);assert.equal(f.state.closeCount,1);
});
test('active abort revokes immediately and closes the same original resource',async()=>{
 const f=fixture(),controller=new AbortController();
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,controller.signal,async handle=>{
  const view=f.api.claimCurrent259OwnedResource(handle);controller.abort();
  assert.throws(()=>f.api.claimCurrent259OwnedResource(handle),/CURRENT259_RESOURCE_HANDLE/u);
  assert.throws(()=>view.credentials(),/CURRENT259_RESOURCE_CLOSED/u);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.closeCount,1);
 }),/CURRENT259_RESOURCE_CLOSED/u);assert.equal(f.state.closeCount,1);
});
test('start failure is not retried and does not call a guessed cleanup port',async()=>{
 const f=fixture(),original=new Error('FIXED_START_FAILURE');f.state.startFailure=original;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{}),error=>error===original);
 assert.equal(f.state.closeCount,0);assert.equal(f.calls.filter(x=>x==='start').length,1);
});
test('cleanup failure retains the first stage error and reports only fixed UNKNOWN cleanup',async()=>{
 const f=fixture(),original=new Error('FIXED_STAGE_FAILURE');f.state.closeFailure=true;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{throw original;}),error=>error===original&&error.resourceCleanup.status==='UNKNOWN'&&!JSON.stringify(error).includes('CLOSE_PRIVATE_DETAIL'));
 assert.equal(f.state.closeCount,1);
});
test('cleanup failure after an otherwise complete stage cannot report success',async()=>{
 const f=fixture();f.state.closeFailure=true;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=> 'done'),error=>error.code==='CURRENT259_RESOURCE_CLEANUP_UNKNOWN'&&error.resourceCleanup.status==='UNKNOWN');
});
test('resource artifacts cannot be created within the observed repository or its runtime trees',async()=>{
 const f=fixture();f.plan.artifactsDir=path.resolve(__dirname,'../../../private-output');
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{}),/CURRENT259_RESOURCE_PLAN/u);
 assert.equal(f.calls.includes('start'),false);
});

test('source or unloaded-tree drift during inspect is rejected before resource callback issuance',async()=>{
 const f=fixture();f.state.inspectFullInvalid=true;let consumed=0;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{consumed++;}),/STALE_FULL_MATERIAL/u);
 assert.equal(consumed,0);assert.equal(f.state.closeCount,1);
 f.state.fullInvalid=false;f.state.inspectFullInvalid=false;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{consumed++;}),/CURRENT259_RESOURCE_BUILD_REUSED/u);
 assert.equal(consumed,0);assert.equal(f.state.closeCount,1);assert.equal(f.calls.filter(x=>x==='start').length,1);
});
for(const accessor of [false,true])test(`cleanup UNKNOWN preserves an existing ${accessor?'accessor':'nonconfigurable'} stage error field without invoking or replacing it`,async()=>{
 const f=fixture(),original=new Error('FIRST_STAGE_FAILURE');let reads=0;
 Object.defineProperty(original,'resourceCleanup',accessor?{get(){reads++;throw new Error('GETTER_PRIVATE_DETAIL');},configurable:true}:{value:{status:'earlier'},configurable:false});
 const before=Object.getOwnPropertyDescriptor(original,'resourceCleanup');f.state.closeFailure=true;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,()=>{throw original;}),error=>{
  assert.equal(error.code,'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');assert.equal(error.cause,original);
  assert.equal(Object.getOwnPropertyDescriptor(error,'cause').enumerable,false);assert.equal(error.resourceCleanup.status,'UNKNOWN');return true;
 });
 assert.deepEqual(Object.getOwnPropertyDescriptor(original,'resourceCleanup'),before);assert.equal(reads,0);assert.equal(f.state.closeCount,1);
});
test('an explicit close revokes before awaiting original cleanup and cannot issue another physical close',async()=>{
 const f=fixture();let retained;
 await assert.rejects(f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,async handle=>{
  retained=handle;const view=f.api.claimCurrent259OwnedResource(handle);
  const first=f.api.closeCurrent259OwnedResource(handle);
  assert.throws(()=>f.api.claimCurrent259OwnedResource(handle),/CURRENT259_RESOURCE_HANDLE/u);
  assert.throws(()=>view.credentials(),/CURRENT259_RESOURCE_CLOSED/u);
  await Promise.all([first,f.api.closeCurrent259OwnedResource(handle)]);
 }),/CURRENT259_RESOURCE_CLOSED/u);
 assert.equal(f.state.closeCount,1);
 await f.api.closeCurrent259OwnedResource(retained);assert.equal(f.state.closeCount,1);
 assert.throws(()=>f.api.claimCurrent259OwnedResource(retained),/CURRENT259_RESOURCE_HANDLE/u);
});


test('named technical owned resource uses only the fixed1h producer and binds its purpose',async()=>{
 const f=fixture();let retained;
 const result=await f.api.withCurrent259TechnicalResource(f.build,f.plan,undefined,handle=>{
  retained=handle;const view=f.api.claimCurrent259TechnicalResource(handle);
  assert.equal(view.purpose,'CURRENT259_TECHNICAL_MIGRATIONS_V1');assert.equal(view.deadlineMs,3600000);
  assert.equal(view,f.api.claimCurrent259OwnedResource(handle));
  assert.equal(view.resource.getReceipt().purpose,view.purpose);assert.equal(view.resource.getReceipt().limits.totalDeadlineMs,3600000);
  return 'technical';
 });
 assert.equal(result,'technical');assert.ok(f.calls.includes('technical-start'));assert.equal(f.calls.includes('start'),false);
 assert.equal(Object.hasOwn(f.state.options,'deadlineMs'),false);assert.equal(f.state.closeCount,1);
 assert.throws(()=>f.api.claimCurrent259TechnicalResource(retained),/CURRENT259_RESOURCE_HANDLE/);
});

test('old900s resource cannot be promoted by copied purpose or receipt fields',async()=>{
 const f=fixture();
 await f.api.withCurrent259OwnedResource(f.build,f.plan,undefined,handle=>{
  f.receipt.purpose='CURRENT259_TECHNICAL_MIGRATIONS_V1';f.receipt.limits={totalDeadlineMs:3600000};
  assert.throws(()=>f.api.claimCurrent259TechnicalResource(handle),/CURRENT259_TECHNICAL_RESOURCE_REQUIRED/);
  assert.throws(()=>f.api.claimCurrent259TechnicalResource({...handle,purpose:f.receipt.purpose}),/CURRENT259_RESOURCE_HANDLE/);
  assert.equal(f.api.claimCurrent259OwnedResource(handle).purpose,undefined);
 });
 assert.equal(f.state.options.deadlineMs,900000);assert.equal(f.state.closeCount,1);
});

test('technical receipt purpose or deadline drift revokes the original handle permanently',async()=>{
 for(const drift of ['purpose','deadline']) {
  const f=fixture();
  await assert.rejects(f.api.withCurrent259TechnicalResource(f.build,f.plan,undefined,handle=>{
   if(drift==='purpose')f.receipt.purpose='OWNED_RESOURCE_ONLY';else f.receipt.limits.totalDeadlineMs=900000;
   assert.throws(()=>f.api.claimCurrent259TechnicalResource(handle),/CURRENT259_RESOURCE_PURPOSE/);
   f.receipt.purpose='CURRENT259_TECHNICAL_MIGRATIONS_V1';f.receipt.limits.totalDeadlineMs=3600000;
   assert.throws(()=>f.api.claimCurrent259TechnicalResource(handle),/CURRENT259_RESOURCE_HANDLE/);
  }));
  assert.equal(f.state.closeCount,1);
 }
});

test('technical resource cancellation retains original once-only cleanup and revocation',async()=>{
 const f=fixture(),signal=new AbortController();let handle;
 await assert.rejects(f.api.withCurrent259TechnicalResource(f.build,f.plan,signal.signal,async value=>{
  handle=value;const view=f.api.claimCurrent259TechnicalResource(value);signal.abort();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.closeCount,1);
  assert.throws(()=>f.api.claimCurrent259TechnicalResource(handle),/CURRENT259_RESOURCE_HANDLE/);
  assert.throws(()=>view.credentials(),/CURRENT259_RESOURCE_CLOSED/);
 }));
 assert.equal(f.state.closeCount,1);
});

test('the original inspected endpoint is fetched afresh and revoked with its owned lifetime',async()=>{
 const f=fixture();let count=0,retained;
 f.resource.inspectConnectionEndpoint=async()=>{count++;return Object.freeze({serverAddress:count===1?'172.29.0.2':'172.29.0.3'});};
 await f.api.withCurrent259TechnicalResource(f.build,f.plan,undefined,async handle=>{
  retained=f.api.claimCurrent259TechnicalResource(handle).resource;
  assert.deepEqual(await retained.inspectConnectionEndpoint(),{serverAddress:'172.29.0.2'});
  assert.deepEqual(await retained.inspectConnectionEndpoint(),{serverAddress:'172.29.0.3'});
 });
 await assert.rejects(retained.inspectConnectionEndpoint(),/CURRENT259_RESOURCE_CLOSED/u);
 assert.equal(count,2);
});
