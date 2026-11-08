"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {runTask16RegisteredPg}=require('./run-task16-registered-pg-local.cjs');
const ROOT=path.resolve(__dirname,'../../..');
function harness(t,hooks={}){
 const root=fs.mkdtempSync('/private/tmp/jg-task16-app-factory-');fs.chmodSync(root,0o700);const artifacts=path.join(root,'artifacts'),storage=path.join(artifacts,'storage');fs.mkdirSync(storage,{recursive:true,mode:0o700});fs.chmodSync(artifacts,0o700);t.after(()=>fs.rmSync(root,{recursive:true}));
 const values={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:storage,JWT_ACCESS_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),FILE_DOWNLOAD_SECRET:'c'.repeat(64)};
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));for(const [k,v]of Object.entries(values))process.env[k]=v;t.after(()=>{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const calls=[],runtime={},source={candidateSha:'a'.repeat(40),sealSha256:'b'.repeat(64)};let bundle;
 const put=(p,b)=>{const f=path.join(root,'package',p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{mode:0o600});return f;};
 function loadActualModuleMetadata(){
  const actual=['database/task16-registered-application.module','auth/auth.module'];
  put('database/prisma.service.js','exports.PrismaService=class PrismaService{};');
  put('node_modules/@nestjs/common/index.js',"exports.Module=metadata=>Class=>{Class.metadata=metadata;return Class;};");
  put('node_modules/@nestjs/core/index.js',"exports.APP_GUARD='APP_GUARD';exports.APP_FILTER='APP_FILTER';");
  for(const name of actual){
   const source=fs.readFileSync(path.join(ROOT,'services/api/src',name+'.ts'),'utf8');
   for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/gu)){
    const imported=match[2];if(imported.startsWith('@nestjs/')||actual.some(n=>path.posix.normalize(path.posix.join(path.posix.dirname(name),imported))===n))continue;
    const file=path.posix.normalize(path.posix.join(path.posix.dirname(name),imported))+'.js';
    put(file,match[1].split(',').map(n=>n.trim()).filter(Boolean).map(n=>`exports.${n}=class ${n}{};`).join('\n'));
   }
   put(name+'.js',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText);
  }
  return {module:require(path.join(root,'package/database/task16-registered-application.module.js')).Task16RegisteredApplicationModule,PrismaService:require(path.join(root,'package/database/prisma.service.js')).PrismaService};
 }
 const server={listening:true,address(){calls.push('address');return hooks.address??{address:'127.0.0.1',family:'IPv4',port:15433};}};
 const app={close:async()=>{calls.push('app-close');hooks.appClose?.();},get(token){calls.push('app-get');assert.equal(token,bundle.PrismaService);return hooks.appRuntime??runtime;},getHttpAdapter(){return{getInstance(){return{set(key,value){assert.equal(key,'json replacer');assert.equal(value,bundle.apiJsonReplacer);calls.push('json');}};}};},enableCors(options){calls.push('cors');assert.deepEqual(options,{origin:[],credentials:false});},useGlobalPipes(pipe){calls.push('pipe');assert.equal(pipe,'synthetic-validation-pipe');},init:async()=>{calls.push('init');hooks.init?.();},getHttpServer(){calls.push('server');return server;}};
 const module={close:async()=>{calls.push('module-close');hooks.moduleClose?.();},get(token){calls.push('module-get');assert.equal(token,bundle.PrismaService);return runtime;},createNestApplication(){calls.push('create-app');hooks.createApp?.();return app;}};
 const builder={overrideProvider(token){calls.push('override');assert.equal(token,bundle.PrismaService);return{useValue(value){calls.push('use-runtime');assert.equal(value,runtime);return builder;}};},compile:async()=>{calls.push('compile');assert.ok(calls.indexOf('use-runtime')<calls.indexOf('compile'));hooks.compile?.();return module;}};
 const boundary={loadModules:async request=>{calls.push('load');assert.ok(Array.isArray(request)&&request.every(row=>typeof row.path==='string'));const metadata=loadActualModuleMetadata();bundle={Task16RegisteredApplicationModule:metadata.module,PrismaService:metadata.PrismaService,configureApiSecurity:()=>calls.push('security'),configureProjectionExportJson:()=>calls.push('projection'),apiJsonReplacer:()=>{},createApiValidationPipe:()=>{calls.push('validation');return'synthetic-validation-pipe';},listenApi:async(target,port,host)=>{calls.push('listen');assert.equal(target,app);assert.equal(port,0);assert.equal(host,'127.0.0.1');hooks.listen?.();}};hooks.loaded?.({root,storage});return bundle;},createTestingModule(metadata){calls.push('builder');assert.deepEqual(metadata,{imports:[bundle.Task16RegisteredApplicationModule]});return builder;}};
 const clients={status:'CLIENTS_CONNECTED_AND_IDENTITY_MATCHED',runtime,sourceBinding:{sourceSha:source.candidateSha,sourceSealSha256:source.sealSha256,registeredManifestSha256:'c'.repeat(64)},close:async()=>calls.push('clients-close')};
 const adapters={verifySource:async()=>source,startResource:async()=>({close:async()=>calls.push('resource-close'),getReceipt:()=>({status:'closed',cleanup:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}})}),verifyOwnerTransport:async()=>{},migrateBaseline:async()=>{},installBaselineAccess:async()=>{},installPreparedSql:async()=>{},installRegisteredAccess:async()=>({manifestSha256:'c'.repeat(64)}),connectRestrictedClients:async()=>clients,startApplication:boundary,seedFixture:async context=>{calls.push('seed');assert.equal(context.application.runtime,runtime);assert.equal(context.application.origin,'http://127.0.0.1:15433/');return{};},runNormalCase:async()=>({caseId:'registered.null-cross-company.commit',passed:true})};
 return {root,artifacts,storage,calls,boundary,adapters,app,module,server,runtime,clients,get bundle(){return bundle;},run:()=>runTask16RegisteredPg({packetFile:path.join(root,'not-read-packet'),expectedPacketSha256:'a'.repeat(64),inputsFile:path.join(root,'not-read-inputs'),expectedInputsSha256:'b'.repeat(64),artifactsDir:artifacts},adapters)};
}
test('the real factory uses override-before-compile, original runtime, loopback protocol and driver cleanup',async t=>{
 const f=harness(t);const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(receipt.nativeExecution,false);assert.equal(receipt.financialAcceptance,false);assert.ok(f.calls.indexOf('security')<f.calls.indexOf('projection'));assert.ok(f.calls.indexOf('projection')<f.calls.indexOf('json'));assert.ok(f.calls.indexOf('pipe')<f.calls.indexOf('init'));assert.ok(f.calls.indexOf('init')<f.calls.indexOf('listen'));assert.equal(f.calls.filter(x=>x==='listen').length,1);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);assert.equal(f.calls.includes('module-close'),false);
 const imports=f.bundle.Task16RegisteredApplicationModule.metadata.imports;assert.ok(imports.some(Class=>Class.name==='AuthModule'));const guards=imports.find(Class=>Class.name==='AuthModule').metadata.providers.filter(row=>row.provide==='APP_GUARD').map(row=>row.useClass.name);assert.deepEqual(guards,['JwtAuthGuard','RetiredWriteEntryGuard','OperationalWriteFreezeGuard','AccountRateLimitGuard','PermissionGuard','ContractCutoverGuard']);
});

test('compile failure without a returned handle remains unknown and still closes clients/resources',async t=>{
 const f=harness(t,{compile:()=>{throw new Error('synthetic-private-sdk-error');}});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.appStartupOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');assert.deepEqual(f.calls.slice(-2),['clients-close','resource-close']);assert.equal(f.calls.includes('seed'),false);assert.equal(JSON.stringify(receipt).includes('synthetic-private-sdk-error'),false);
});
test('private storage permissions changed during module loading stop before compile',async t=>{
 const f=harness(t,{loaded:({storage})=>fs.chmodSync(storage,0o755)});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.appStartupOutcome,'NOT_ATTEMPTED');assert.equal(f.calls.includes('compile'),false);assert.deepEqual(f.calls.slice(-2),['clients-close','resource-close']);
});

test('application construction failure closes the already owned module before clients',async t=>{
 const f=harness(t,{createApp:()=>{throw new Error('synthetic-private-construction-error');}});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.appStartupOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.appCleanupOutcome,'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF');assert.deepEqual(f.calls.slice(-3),['module-close','clients-close','resource-close']);assert.equal(JSON.stringify(receipt).includes('synthetic-private-construction-error'),false);
});

test('a returned app is owned before an executable get accessor can be inspected',async t=>{
 const f=harness(t);let reads=0;Object.defineProperty(f.app,'get',{get(){reads++;throw new Error('synthetic-private-getter-error');}});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(reads,0);assert.equal(receipt.failureCode,'TASK16_APP_METHOD_DESCRIPTOR');assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);assert.equal(JSON.stringify(receipt).includes('synthetic-private-getter-error'),false);
});

test('an app close failure stays unknown after successful module fallback and keeps the startup failure',async t=>{
 const f=harness(t,{init:()=>{throw new Error('synthetic-private-init-error');},appClose:()=>{throw new Error('synthetic-private-close-error');}});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.failureCode,'TASK16_APP_FAILED_CLOSED');assert.equal(receipt.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');assert.deepEqual(receipt.cleanupFailures,['application']);assert.deepEqual(f.calls.slice(-4),['app-close','module-close','clients-close','resource-close']);assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);
});

test('a symbolic extra adapter key is rejected before module or resource acquisition',async t=>{
 const f=harness(t);f.boundary[Symbol('extra')]=()=>{};const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_DRIVER_CAPABILITIES_INCOMPLETE');assert.deepEqual(f.calls,[]);assert.equal(receipt.nativeExecution,false);
});

test('a replacement runtime provider is rejected before init or listening',async t=>{
 const f=harness(t,{appRuntime:{}});const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_APP_RUNTIME_PROVIDER');assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(f.calls.includes('init'),false);assert.equal(f.calls.includes('listen'),false);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);
});

test('a non-loopback actual server address never produces an accepted origin or seed',async t=>{
 const f=harness(t,{address:{address:'0.0.0.0',family:'IPv4',port:15433}});const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_APP_ADDRESS');assert.equal(f.calls.includes('seed'),false);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);
});

test('missing, accessor and non-function factory boundaries get no native fallback',async t=>{
 const f=harness(t),{loadModules,createTestingModule}=f.boundary;
 const accessor={createTestingModule,get loadModules(){throw new Error('synthetic-private-boundary-getter');}};
 for(const boundary of [{loadModules},{loadModules:null,createTestingModule},accessor,{loadModules,createTestingModule,extra:()=>{}}]){
  f.adapters.startApplication=boundary;const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_DRIVER_CAPABILITIES_INCOMPLETE');assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);
 }
});

test('an SDK-looking private code is not accepted merely for sharing the Task16 prefix',async t=>{
 const f=harness(t,{compile:()=>{throw Object.assign(new Error('synthetic-private-message'),{code:'TASK16_APP_SYNTHETIC_PRIVATE_TOKEN'});}});const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_APP_FAILED_CLOSED');assert.equal(JSON.stringify(receipt).includes('SYNTHETIC_PRIVATE_TOKEN'),false);assert.equal(JSON.stringify(receipt).includes('synthetic-private-message'),false);assert.deepEqual(f.calls.slice(-2),['clients-close','resource-close']);
});

test('the server listening accessor is consumed once after the app is owned',async t=>{
 const f=harness(t);let reads=0;delete f.server.listening;Object.setPrototypeOf(f.server,{get listening(){reads++;return true;}});const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(reads,1);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);
});

test('missing private environment preparation refuses before the module loader is called',async t=>{
 const f=harness(t);delete process.env.FILE_DOWNLOAD_SECRET;const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_APP_ENVIRONMENT_REQUIRED');assert.equal(receipt.appStartupOutcome,'NOT_ATTEMPTED');assert.equal(f.calls.includes('load'),false);assert.deepEqual(f.calls,['clients-close','resource-close']);
});

test('environment drift during module loading stops before Nest compilation',async t=>{
 const f=harness(t,{loaded:()=>{process.env.NODE_ENV='production';}});const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_APP_ENVIRONMENT_CHANGED');assert.equal(f.calls.includes('compile'),false);assert.deepEqual(f.calls.slice(-2),['clients-close','resource-close']);
});

test('the returned application close handle is idempotent after driver cleanup',async t=>{
 const f=harness(t);let handle;f.adapters.seedFixture=async context=>{handle=context.application;return{};};const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);await handle.close();await handle.close();assert.equal(f.calls.filter(x=>x==='app-close').length,1);assert.equal(f.calls.includes('module-close'),false);
});

test('new app outcome relays capture finite getters once and discard throwing getters',async t=>{
 const f=harness(t);let startup=0,cleanup=0;
 f.adapters.startApplication=async()=>{throw{code:'TASK16_APP_FAILED_CLOSED',get appStartupOutcome(){return ++startup===1?'UNKNOWN_DO_NOT_RETRY':'synthetic-private-startup';},get appCleanupOutcome(){return ++cleanup===1?'UNKNOWN_DO_NOT_CONTINUE':'synthetic-private-cleanup';}};};
 const receipt=await f.run();assert.equal(startup,1);assert.equal(cleanup,1);assert.equal(receipt.appStartupOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);assert.deepEqual(f.calls,['clients-close','resource-close']);
 f.calls.length=0;f.adapters.startApplication=async()=>{throw{code:'TASK16_APP_FAILED_CLOSED',get appStartupOutcome(){throw new Error('synthetic-private-exception');},appCleanupOutcome:'synthetic-private-invalid'};};
 const rejected=await f.run();assert.equal(rejected.appStartupOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(rejected.appCleanupOutcome,'NOT_NEEDED');assert.equal(JSON.stringify(rejected).includes('synthetic-private'),false);assert.deepEqual(f.calls,['clients-close','resource-close']);
});

test('the outer application getter is consumed only by the original adapter spread',async t=>{
 const f=harness(t);let reads=0;const stage=async()=>({runtime:f.runtime,origin:'http://127.0.0.1:15433/',close:async()=>f.calls.push('app-close')});
 Object.defineProperty(f.adapters,'startApplication',{enumerable:true,get(){if(++reads===1)return stage;throw new Error('synthetic-private-outer-getter-error');}});
 const receipt=await f.run();assert.equal(reads,1);assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(receipt.nativeExecution,false);assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);
});

test('an inner factory boundary Proxy exception yields a safe missing-capability receipt',async t=>{
 const f=harness(t);let reads=0;f.adapters.startApplication=new Proxy(f.boundary,{ownKeys(){reads++;throw new Error('synthetic-private-boundary-proxy-error');}});
 const receipt=await f.run();assert.equal(reads,1);assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.failureCode,'TASK16_DRIVER_CAPABILITIES_INCOMPLETE');assert.equal(JSON.stringify(receipt).includes('synthetic-private'),false);assert.deepEqual(receipt.stages,[]);assert.deepEqual(f.calls,[]);
});

test('valid Proxy factory metadata is snapshotted once before invoking the fixed functions',async t=>{
 const f=harness(t);let ownKeys=0,descriptors=0;
 f.adapters.startApplication=new Proxy(f.boundary,{ownKeys(target){if(++ownKeys!==1)throw new Error('synthetic-private-second-snapshot');return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){descriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(ownKeys,1);assert.equal(descriptors,2);assert.equal(receipt.nativeExecution,false);assert.deepEqual(f.calls.slice(-3),['app-close','clients-close','resource-close']);
});
