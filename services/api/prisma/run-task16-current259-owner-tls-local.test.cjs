'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..'),file=path.join(__dirname,'run-task16-current259-owner-tls-local.cjs');
function sealerFixture(t){
 const base=fs.mkdtempSync('/private/tmp/jg-398-once-plan-'),runRoot=path.join(base,'run');fs.mkdirSync(runRoot,{mode:0o700});
 t.after(()=>{for(const name of ['PLAN.json']){const p=path.join(base,name);if(fs.existsSync(p))fs.unlinkSync(p);}for(const n of ['attempt.json','receipt.json','receipt.json.pending']){const p=path.join(runRoot,n);if(fs.existsSync(p))fs.unlinkSync(p);}const resource=path.join(runRoot,'resource');if(fs.existsSync(resource)){fs.unlinkSync(path.join(resource,'resource-manifest.json'));fs.rmdirSync(resource);}if(fs.existsSync(runRoot))fs.rmdirSync(runRoot);fs.rmdirSync(base);});
 const state={captures:0,loads:0,stale:false},handle=Object.freeze({});
 const witness={source:{candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:{ledgerSha256:'d'.repeat(64),prefix256Sha256:'e'.repeat(64),schemaSha256:'f'.repeat(64)}},build:{node:{path:process.execPath,sha256:'1'.repeat(64),version:process.version,openssl:process.versions.openssl},trees:['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(root=>({root,digest:'2'.repeat(64),entries:10,bytes:100})),sdk:{clientVersion:'5.22.0',engineVersion:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'}},host:process.platform+'-'+process.arch,engineCommit:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'};
 const loader={verifyFull(){if(state.stale)throw new Error('SOURCE_DRIFT');},witness(){return witness;}};
 const ports={'../services/api/prisma/task16-current259-build.cjs':{observeCurrent259Build(){state.captures++;return handle;}},'../services/api/prisma/task16-current259-client-loader.cjs':{loadCurrent259Client(h){assert.equal(h,handle);state.loads++;return loader;}}};
 const instance={exports:{}},rq=name=>Object.hasOwn(ports,name)?ports[name]:require('node:module').createRequire(path.join(ROOT,'scripts/prepare-task16-current259-owner-tls.cjs'))(name);rq.main={};
 new Function('require','module','__dirname','__filename',fs.readFileSync(path.join(ROOT,'scripts/prepare-task16-current259-owner-tls.cjs'),'utf8').replace(/^#![^\n]*\n/u,''))(rq,instance,path.join(ROOT,'scripts'),path.join(ROOT,'scripts/prepare-task16-current259-owner-tls.cjs'));
 return {api:instance.exports,state,handle,loader,base,runRoot,output:path.join(base,'PLAN.json'),daemonId:'synthetic-daemon-12345'};
}

function cliFixture(t,{once=false,stale=false,stageFailure=false,cleanupFailure=false,fresh=true,finalDrift=false,existingReceipt=false,badHash=false,extraArg=false}={}){
 const s=sealerFixture(t),saved=s.api.prepareOwnerTlsPlan({runRoot:s.runRoot,daemonId:s.daemonId,output:s.output});s.state.stale=stale;if(existingReceipt)fs.writeFileSync(path.join(s.runRoot,'receipt.json'),'USER_OWNED',{mode:0o600});
 const state={starts:0,closes:0,tls:0,console:'',exit:null},handle=Object.freeze({}),proof=Object.freeze({});let receipt;
 const ports={
  './task16-current259-owned-resource.cjs':{
   claimCurrent259OwnedResource(h){assert.equal(h,handle);return {resource:{getReceipt:()=>structuredClone(receipt)}};},
   async withCurrent259OwnedResource(build,plan,_signal,consume){assert.equal(build,s.handle);state.starts++;fs.mkdirSync(plan.artifactsDir,{mode:0o700});receipt={runId:'12345678-1234-4234-8234-123456789012',sourceSha:'a'.repeat(40),daemonId:s.daemonId,endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',containerId:'7'.repeat(64),networkId:'8'.repeat(64),databaseName:'jg_task01_12345678123442348234123456789012',port:32456,status:'started-awaiting-driver-verification',cleanup:{status:'pending'},password:'SECRET_SENTINEL'};
    let value,primary;try{value=await consume(handle);}catch(error){primary=error;}finally{state.closes++;receipt.status=cleanupFailure?'cleanup_failed':'closed';if(finalDrift)receipt.containerId='9'.repeat(64);receipt.cleanup={status:cleanupFailure?'failed':'completed',containerAbsent:!cleanupFailure,volumesAbsent:!cleanupFailure,networkAbsent:!cleanupFailure};fs.writeFileSync(path.join(plan.artifactsDir,'resource-manifest.json'),JSON.stringify(receipt),{mode:0o600});if(cleanupFailure&&!primary)primary=Object.assign(new Error('SECRET_SENTINEL'),{code:'CURRENT259_RESOURCE_CLEANUP_UNKNOWN'});}if(primary)throw primary;return value;
   }
  },
  './task16-current259-owner-tls.cjs':{async verifyCurrent259OwnerTls(h){assert.equal(h,handle);state.tls++;if(stageFailure)throw Object.assign(new Error('SECRET_SENTINEL SQL/URL'),{code:'CURRENT259_OWNER_NEGATIVE',clientCleanupOutcome:'UNKNOWN',ownerRestorationOutcome:'UNKNOWN'});return proof;},claimCurrent259OwnerTls(p,h){assert.equal(p,proof);assert.equal(h,handle);return {scope:'CLOSED_OWNER_TLS_CONTROLS_ONLY',runId:receipt.runId,database:receipt.databaseName,databaseOid:'16384',systemIdentifier:'7540000000000000001',ownerOid:'16385',ownerRestorationOutcome:'CORRECT_PRESENTATION_RESTORED',clientCleanupOutcome:'DISCONNECTED',caSha256:'1'.repeat(64),probes:Array.from({length:7},(_,i)=>({kind:['healthy','wrong-ca','healthy','wrong-san','healthy','plaintext','healthy'][i],closed:true,prismaCode:i===5?'P1010':'P1011',certificateMarker:true,secret:'SECRET_SENTINEL'})),secret:'SECRET_SENTINEL'};}},
  '../../../scripts/prepare-task16-current259-owner-tls.cjs':s.api
 };
 const instance={exports:{}},rq=name=>Object.hasOwn(ports,name)?ports[name]:require(name);rq.main=fresh?instance:{};rq.cache={[file]:instance};
 const argv=['node',file,...(once?['--once']:[]),'--plan',s.output,'--expected-plan-sha256',badHash?'0'.repeat(64):saved.sha256,...(extraArg?['--resource=SECRET_SENTINEL']:[])];
 const proc={argv,execArgv:[],_preload_modules:[],env:{},getuid:process.getuid,stdout:{write(value,callback){state.console+=value;callback?.();}},once(){},removeListener(){},exit(code){state.exit=code;},exitCode:0};
 new Function('require','module','__dirname','__filename','process',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(rq,instance,__dirname,file,proc);
 const rerunFresh=()=>{const next={exports:{}},again=name=>Object.hasOwn(ports,name)?ports[name]:require(name);again.main=next;again.cache={[file]:next};new Function('require','module','__dirname','__filename','process',fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,''))(again,next,__dirname,file,proc);return next.exports;};
 return {...s,api:instance.exports,state,argv,rerunFresh};
}
test('default CLI only verifies a plan and never creates an attempt or resource',async t=>{
 const f=cliFixture(t);const result=await f.api.execution;assert.equal(result.status,'OWNER_TLS_PLAN_VERIFIED_NO_RESOURCES');assert.equal(f.state.starts,0);assert.equal(f.state.tls,0);assert.equal(fs.existsSync(path.join(f.runRoot,'attempt.json')),false);
});
test('--once runs the fixed owner stage then requires original cleanup and a matching final manifest',async t=>{
 const f=cliFixture(t,{once:true});const result=await f.api.execution;
 assert.equal(result.status,'OWNER_TLS_CLOSED_PROBES_AND_OWNED_CLEANUP_VERIFIED');assert.equal(f.state.starts,1);assert.equal(f.state.tls,1);assert.equal(f.state.closes,1);
 assert.equal(fs.existsSync(path.join(f.runRoot,'attempt.json')),true);
 const receipt=JSON.parse(fs.readFileSync(path.join(f.runRoot,'receipt.json'),'utf8'));
 assert.equal(receipt.onceAttemptConsumed,true);assert.equal(receipt.scope.sdkProbeAttempts,7);assert.equal(receipt.scope.ownerIdentityPsqlSessions,6);assert.equal(receipt.scope.fixedIdentitySelects,14);
 assert.equal(receipt.resource.cleanup.status,'completed');assert.equal(receipt.liveSessionAdmission,false);assert.equal(JSON.stringify(receipt).includes('SECRET_SENTINEL'),false);
});

test('a once source failure consumes the durable attempt before creating any resource and cannot be retried',async t=>{
 const f=cliFixture(t,{once:true,stale:true}),result=await f.api.execution;
 assert.equal(result.status,'STOPPED');assert.equal(f.state.starts,0);assert.equal(result.onceAttemptConsumed,true);
 assert.equal(fs.existsSync(path.join(f.runRoot,'attempt.json')),true);const file=path.join(f.runRoot,'receipt.json'),original=fs.readFileSync(file);
 const receipt=JSON.parse(original);assert.equal(receipt.sourceMaterialVerified,false);assert.equal(receipt.resource.cleanup.status,'not-needed');
 const again=await f.rerunFresh().execution;assert.equal(again.status,'STOPPED');assert.equal(again.onceAttemptConsumed,true);assert.deepEqual(fs.readFileSync(file),original);assert.equal(f.state.starts,0);
});
test('an imported caller cannot execute the once path even with an exact valid plan hash',async t=>{
 const f=cliFixture(t,{fresh:false,once:true});assert.equal(f.api.execution,undefined);
 const result=await f.api.runOwnerTlsCli(f.argv.slice(2));assert.equal(result.status,'STOPPED');assert.equal(f.state.starts,0);assert.equal(fs.existsSync(path.join(f.runRoot,'attempt.json')),false);
});
for(const options of [{stageFailure:true},{cleanupFailure:true},{stageFailure:true,cleanupFailure:true}])test(`stage/cleanup failure never reports native completion ${JSON.stringify(options)}`,async t=>{
 const f=cliFixture(t,{once:true,...options}),result=await f.api.execution;assert.equal(result.status,'STOPPED');assert.equal(f.state.starts,1);assert.equal(f.state.closes,1);
 const text=fs.readFileSync(path.join(f.runRoot,'receipt.json'),'utf8');assert.equal(text.includes('SECRET_SENTINEL'),false);assert.equal(f.state.console.includes('SECRET_SENTINEL'),false);
 const receipt=JSON.parse(text);if(options.stageFailure)assert.equal(receipt.failureCode,'CURRENT259_OWNER_NEGATIVE');if(options.cleanupFailure)assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
});
test('a foreign final resource identity cannot certify cleanup',async t=>{
 const f=cliFixture(t,{once:true,finalDrift:true}),result=await f.api.execution;assert.equal(result.status,'STOPPED');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.runRoot,'receipt.json'),'utf8'));assert.equal(receipt.failureCode,'OWNER_TLS_ONCE_RESOURCE_CHANGED');assert.equal(receipt.resource.cleanup.status,'UNKNOWN');
});
test('an unknown preexisting receipt is preserved and prevents resource creation',async t=>{
 const f=cliFixture(t,{once:true,existingReceipt:true}),result=await f.api.execution;assert.equal(result.status,'STOPPED');
 assert.equal(f.state.starts,0);assert.equal(fs.readFileSync(path.join(f.runRoot,'receipt.json'),'utf8'),'USER_OWNED');
});

for(const option of ['badHash','extraArg'])test(`invalid once ${option} cannot execute and is not represented as a refunded attempt`,async t=>{
 const f=cliFixture(t,{once:true,[option]:true}),result=await f.api.execution;assert.equal(result.status,'STOPPED');assert.equal(result.onceAttemptConsumed,true);assert.equal(f.state.starts,0);assert.equal(f.state.tls,0);assert.equal(f.state.console.includes('SECRET_SENTINEL'),false);
});
