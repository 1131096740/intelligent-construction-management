"use strict";
const {assertCurrent259BusinessIssuer:businessIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
// Physical resource lifetime only. No client, migration, role installation,
// catalog qualification or business/session admission is issued by this module.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {types,isDeepStrictEqual}=require('node:util');
const {createHash,randomUUID,randomBytes}=require('node:crypto');
const loaderPath=require.resolve('./task16-current259-client-loader.cjs');
const resourcePath=require.resolve('./enterprise-task01-resources.cjs');
// A fixed entry point must import this producer before either consumer. Do not
// adopt an already cached caller replacement as the original physical producer.
const preloaded=Boolean(require.cache[loaderPath]||require.cache[resourcePath]);
const loaderExports=require('./task16-current259-client-loader.cjs');
const resourceExports=require('./enterprise-task01-resources.cjs');
const loaderModule=require.cache[loaderPath],resourceModule=require.cache[resourcePath];
const {loadCurrent259Client}=loaderExports,{startTask01Postgres}=resourceExports;
const startCurrent259TechnicalPostgres=Object.getOwnPropertyDescriptor(resourceExports,'startCurrent259TechnicalPostgres')?.value;
const startCurrent259FirstQ2LoopbackPostgres=Object.getOwnPropertyDescriptor(resourceExports,'startCurrent259FirstQ2LoopbackPostgres')?.value;
const Q2_TOPOLOGY='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const {paymentLoopbackForScenario}=require('./task16-current259-payment-loopback.cjs');
const LEGACY_TOPOLOGY='UNVERIFIED_HOST_PUBLISHED_TLS';
const paymentStartNames=Object.freeze(Object.fromEntries([
 ['cancel-commit','startCurrent259FirstRollbackPostgres'],['normal','startCurrent259NormalPaymentPostgres'],
 ['response-loss','startCurrent259ResponseLossPostgres'],['competition','startCurrent259CompetitionPostgres'],['competition-voucher','startCurrent259VoucherPostgres'],
 ['disconnect-commit-recovery','startCurrent259DisconnectRecoveryPostgres'],['attribution-gap','startCurrent259AttributionGapPostgres']
].map(([scenario,name])=>[paymentLoopbackForScenario(scenario).topology,name])));
const paymentStarters=Object.freeze(Object.fromEntries(Object.entries(paymentStartNames).map(([topology,name])=>
 [topology,Object.getOwnPropertyDescriptor(resourceExports,name)?.value])));
const TECHNICAL_PURPOSE='CURRENT259_TECHNICAL_MIGRATIONS_V1';
const builtinLoader=process.binding('natives')['internal/modules/cjs/loader'];
const ROOT=path.resolve(__dirname,'../../..');
const ENDPOINT='unix:///Users/leoyang/.docker/run/docker.sock';
const IMAGE='sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d';
const TOOLS=Object.freeze({docker:'/Applications/Docker.app/Contents/Resources/bin/docker',openssl:'/opt/homebrew/Cellar/openssl@3/3.6.3/bin/openssl'});
const HASHES=Object.freeze({docker:'6c3c88771987b73d66d0664b22800f46c827f96db67579594d39163ab88e8c40',openssl:'103fc7706cf6646f226d96f29242d81890363499afc730e7ef1fadd64b3a123c'});
const METHODS=['getReceipt','close','captureLogCursor','execOwnerSql','observePresentedCertificate','setServerCertificate','readPlaintextRejectionEvidence','inspectConnectionEndpoint'];
const CONTRACT_METHODS=['applyCurrent259ContractHbaV1','beginCurrent259ContractPlaintextProbe','verifyCurrent259ContractPlaintextRejection'];
const FIELDS=['containerId','networkId','port','databaseName','caPath','wrongCaPath','serverCertHashes'];
const TLS_KEYS=['caSha256','wrongCaSha256','correctCertificateSha256','wrongSanCertificateSha256','correctCertificateDerSha256','wrongSanCertificateDerSha256'];
const handles=new WeakMap(),closedHandles=new WeakMap(),usedBuilds=new WeakSet();
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
function own(value,key){need(value&&!types.isProxy(value),'CURRENT259_RESOURCE_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'CURRENT259_RESOURCE_DESCRIPTOR');return d.value;}
function record(value,keys){need(value&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length,'CURRENT259_RESOURCE_PLAN');return Object.fromEntries(keys.map(key=>[key,own(value,key)]));}
function hooksClean(){
 const checks=[[Module._load,'Module._load = function'],[Module._resolveFilename,'Module._resolveFilename = function'],[Module._findPath,'Module._findPath = function'],[Module.prototype.require,'Module.prototype.require = function'],...['.js','.json','.node'].map(ext=>[Module._extensions[ext],`Module._extensions['${ext}'] = function`])];
 return typeof builtinLoader==='string'&&checks.every(([fn,marker])=>{const assignment=builtinLoader.indexOf(marker),begin=builtinLoader.indexOf('function',assignment),end=builtinLoader.indexOf('\n};',begin);return assignment>=0&&end>begin&&typeof fn==='function'&&Function.prototype.toString.call(fn)===builtinLoader.slice(begin,end+2);});
}
function importsCheck(technical=false,topology=LEGACY_TOPOLOGY){need(!preloaded&&hooksClean()&&require.cache[loaderPath]===loaderModule&&require.cache[resourcePath]===resourceModule&&loaderModule.exports===loaderExports&&resourceModule.exports===resourceExports&&own(loaderExports,'loadCurrent259Client')===loadCurrent259Client&&own(resourceExports,'startTask01Postgres')===startTask01Postgres&&(!technical||typeof startCurrent259TechnicalPostgres==='function'&&own(resourceExports,'startCurrent259TechnicalPostgres')===startCurrent259TechnicalPostgres)&&(topology===LEGACY_TOPOLOGY||topology===Q2_TOPOLOGY&&typeof startCurrent259FirstQ2LoopbackPostgres==='function'&&own(resourceExports,'startCurrent259FirstQ2LoopbackPostgres')===startCurrent259FirstQ2LoopbackPostgres||typeof paymentStarters[topology]==='function'&&own(resourceExports,paymentStartNames[topology])===paymentStarters[topology]),'CURRENT259_RESOURCE_PRODUCER_CHANGED');}
function toolsCheck(){const identities={};for(const key of ['docker','openssl']){const file=TOOLS[key];need(fs.realpathSync(file)===file,'CURRENT259_RESOURCE_TOOL_CHANGED');const before=fs.statSync(file);need(before.isFile()&&(before.mode&0o022)===0,'CURRENT259_RESOURCE_TOOL_CHANGED');fs.accessSync(file,fs.constants.X_OK);const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),after=fs.statSync(file);need(hash===HASHES[key]&&['uid','mode','dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'CURRENT259_RESOURCE_TOOL_CHANGED');identities[key]=Object.fromEntries(['dev','ino','uid','gid','mode','size','mtimeMs','ctimeMs'].map(k=>[k,after[k]]));}return identities;}
function planSnapshot(value){
 const plan=record(value,['artifactsDir','daemonId']);
 need(typeof plan.daemonId==='string'&&/^[A-Za-z0-9:-]{16,128}$/u.test(plan.daemonId),'CURRENT259_RESOURCE_PLAN');
 need(typeof plan.artifactsDir==='string'&&plan.artifactsDir.startsWith('/private/tmp/')&&path.normalize(plan.artifactsDir)===plan.artifactsDir&&!fs.existsSync(plan.artifactsDir)&&plan.artifactsDir!==ROOT&&!plan.artifactsDir.startsWith(ROOT+path.sep),'CURRENT259_RESOURCE_PLAN');
 const parent=path.dirname(plan.artifactsDir);need(fs.realpathSync(parent)===parent,'CURRENT259_RESOURCE_PLAN');const st=fs.lstatSync(parent);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'CURRENT259_RESOURCE_PLAN');return Object.freeze(plan);
}
function abortState(signal){if(signal===undefined)return false;need(!types.isProxy(signal)&&Object.getPrototypeOf(signal)===AbortSignal.prototype&&!Object.getOwnPropertyDescriptor(signal,'aborted')&&!Object.getOwnPropertyDescriptor(signal,'addEventListener')&&!Object.getOwnPropertyDescriptor(signal,'removeEventListener'),'CURRENT259_RESOURCE_SIGNAL');return Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal);}
function claimCurrent259OwnedResource(handle){
 need(handle&&!types.isProxy(handle)&&handles.has(handle),'CURRENT259_RESOURCE_HANDLE');const owner=handles.get(handle);owner.check();return owner.view;
}
function closeCurrent259OwnedResource(handle){
 need(handle&&!types.isProxy(handle),'CURRENT259_RESOURCE_HANDLE');
 const owner=handles.get(handle)||closedHandles.get(handle);need(owner,'CURRENT259_RESOURCE_HANDLE');
 closedHandles.set(handle,owner);return owner.close();
}
async function withCurrent259Resource(build,planInput,signal,consume,technical,topology=LEGACY_TOPOLOGY){
 const paymentLoopback=Object.hasOwn(paymentStarters,topology),firstQ2=topology===Q2_TOPOLOGY,loopback=paymentLoopback||firstQ2;
 need((arguments.length===5||arguments.length===6&&technical&&loopback)&&typeof consume==='function','CURRENT259_RESOURCE_ARGUMENTS');
 // The original loader consumes the genuine build brand exactly once and caches
 // its result. Future fixed stages retain this same loader, not a second claim.
 importsCheck(technical,topology);const loader=loadCurrent259Client(build);
 need(build&&!types.isProxy(build)&&!usedBuilds.has(build),'CURRENT259_RESOURCE_BUILD_REUSED');usedBuilds.add(build);
 importsCheck(technical,topology);loader.verifyFull();const witness=loader.witness(),plan=planSnapshot(planInput);
 need(!abortState(signal),'CURRENT259_RESOURCE_ABORTED');const toolIdentities=toolsCheck(),deadline=Date.now()+(technical?3600000:900000);
 const runId=randomUUID(),databaseName='jg_task01_'+runId.replaceAll('-','');
 let credentials=Object.freeze({owner:randomBytes(48).toString('hex'),runtime:randomBytes(48).toString('hex'),observer:randomBytes(48).toString('hex')});
 let view,resource,methods,fields,handle,active=false,broken=false,closing,primary,hasPrimary=false,value,businessToken;
 const invalidate=()=>{active=false;broken=true;if(handle)handles.delete(handle);credentials=undefined;};
 async function close(){
  invalidate();if(closing)return closing;
  if(!resource)return;
  // Capture the original close immediately when start returns. A mutated method
  // is never used as cleanup authority; original start handles pre-return errors.
  closing=(async()=>{need(typeof methods?.close==='function','CURRENT259_RESOURCE_CLEANUP_UNKNOWN');await methods.close.call(resource);const final=methods.getReceipt.call(resource);need(final.runId===runId&&final.sourceSha===witness.source.candidateSha&&final.containerId===own(resource,'containerId')&&final.networkId===own(resource,'networkId')&&final.status==='closed'&&final.cleanup?.status==='completed'&&final.cleanup.containerAbsent===true&&final.cleanup.volumesAbsent===true&&final.cleanup.networkAbsent===true&&(!loopback||final.topology===topology&&relayMatches(final.relay)&&final.cleanup.relayClosed===true&&final.cleanup.relayId===fields?.relayId)&&(!technical||final.purpose===TECHNICAL_PURPOSE&&final.limits?.totalDeadlineMs===3600000),'CURRENT259_RESOURCE_CLEANUP_UNKNOWN');})();return closing;
 }
 const onAbort=()=>{invalidate();void close().catch(()=>{});};
 const relayFields=loopback?[...FIELDS,'relayId']:FIELDS;
 function relayMatches(value){
  if(!fields)return false;
  try{
   const relay=record(value,['id','containerId','host','port']);
   return relay.id===fields.relayId&&relay.containerId===fields.containerId&&relay.host==='127.0.0.1'&&relay.port===fields.port;
  }catch{return false;}
 }
 function checkTransport(receipt){
  need(receipt.topology===topology,'CURRENT259_RESOURCE_TLS');
  if(loopback){
   need(relayMatches(receipt.relay),'CURRENT259_RESOURCE_IDENTITY');
   if(paymentLoopback){
    const hba=record(receipt.loopbackPlaintextHba,['sourceAddress','role','databaseName','noEncryptionRejected']);
    need(hba.sourceAddress==='127.0.0.1'&&hba.role==='jg_task01_owner'&&hba.databaseName===databaseName&&hba.noEncryptionRejected===true,'CURRENT259_RESOURCE_TLS');
   }
   methods.checkRelay.call(resource);
  }
 }
 let methodNames=METHODS;
 function check(){
  try{
   need(active&&!broken,'CURRENT259_RESOURCE_CLOSED');need(!abortState(signal),'CURRENT259_RESOURCE_ABORTED');importsCheck(technical,topology);loader.check();toolsCheck();
   for(const key of methodNames)need(own(resource,key)===methods[key],'CURRENT259_RESOURCE_CHANGED');
   for(const key of relayFields)need(isDeepStrictEqual(own(resource,key),fields[key]),'CURRENT259_RESOURCE_CHANGED');
   const receipt=methods.getReceipt.call(resource);
   need(receipt.runId===runId&&receipt.sourceSha===witness.source.candidateSha&&receipt.endpoint===ENDPOINT&&receipt.daemonId===plan.daemonId&&receipt.imageId===IMAGE&&receipt.databaseName===databaseName&&receipt.containerId===fields.containerId&&receipt.networkId===fields.networkId&&receipt.port===fields.port&&receipt.status==='started-awaiting-driver-verification'&&receipt.cleanup?.status==='pending','CURRENT259_RESOURCE_IDENTITY');
   if(technical)need(receipt.purpose===TECHNICAL_PURPOSE&&receipt.limits?.totalDeadlineMs===3600000,'CURRENT259_RESOURCE_PURPOSE');
   need(receipt.hostOwnerCredentialFilesErased===true&&receipt.hostPrivateKeyFilesErased===true&&receipt.hostPrivateMaterialsErased===true,'CURRENT259_RESOURCE_TLS');checkTransport(receipt);
   need(TLS_KEYS.every(key=>receipt.tls?.[key]===fields.serverCertHashes[key])&&['correctChainVerified','correctSanVerified','wrongCaChainRejected','wrongSanChainVerified','wrongSanMismatchVerified'].every(key=>receipt.tls?.[key]===true),'CURRENT259_RESOURCE_TLS');
  }catch(error){invalidate();void close().catch(()=>{});throw error;}
 }
 function checkLifetime(){
  try{
   need(active&&!broken,'CURRENT259_RESOURCE_CLOSED');need(!abortState(signal),'CURRENT259_RESOURCE_ABORTED');importsCheck(technical,topology);need(Date.now()<=deadline&&handles.get(handle)?.view===view,'CURRENT259_RESOURCE_CLOSED');
   for(const key of methodNames)need(own(resource,key)===methods[key],'CURRENT259_RESOURCE_CHANGED');
   for(const key of relayFields)need(isDeepStrictEqual(own(resource,key),fields[key]),'CURRENT259_RESOURCE_CHANGED');
   const receipt=methods.getReceipt.call(resource);
   need(receipt.runId===runId&&receipt.sourceSha===witness.source.candidateSha&&receipt.endpoint===ENDPOINT&&receipt.daemonId===plan.daemonId&&receipt.imageId===IMAGE&&receipt.databaseName===databaseName&&receipt.containerId===fields.containerId&&receipt.networkId===fields.networkId&&receipt.port===fields.port&&receipt.status==='started-awaiting-driver-verification'&&receipt.cleanup?.status==='pending','CURRENT259_RESOURCE_IDENTITY');
   if(technical)need(receipt.purpose===TECHNICAL_PURPOSE&&receipt.limits?.totalDeadlineMs===3600000,'CURRENT259_RESOURCE_PURPOSE');
   need(receipt.hostOwnerCredentialFilesErased===true&&receipt.hostPrivateKeyFilesErased===true&&receipt.hostPrivateMaterialsErased===true,'CURRENT259_RESOURCE_TLS');checkTransport(receipt);
   need(TLS_KEYS.every(key=>receipt.tls?.[key]===fields.serverCertHashes[key])&&['correctChainVerified','correctSanVerified','wrongCaChainRejected','wrongSanChainVerified','wrongSanMismatchVerified'].every(key=>receipt.tls?.[key]===true),'CURRENT259_RESOURCE_TLS');
  }catch(error){invalidate();void close().catch(()=>{});throw error;}
 }
 function checkContinuity(token){
  try{businessIssuer(token,handle);checkLifetime();loader.checkContinuity(token,handle);for(const key of ['docker','openssl'])checkCurrent259FileIdentity(TOOLS[key],toolIdentities[key]);checkLifetime();}
  catch(error){invalidate();void close().catch(()=>{});throw error;}
 }
 function verifyBusinessFiles(token){
  try{businessIssuer(token,handle);need(businessToken===token,'CURRENT259_RESOURCE_CLOSED');checkLifetime();loader.verifyBusinessFiles(token,handle);checkLifetime();}
  catch(error){invalidate();void close().catch(()=>{});throw error;}
 }
 function activateBusinessContinuity(token){try{checkContinuity(token);need(!businessToken||businessToken===token,'CURRENT259_RESOURCE_CLOSED');businessToken=token;}catch(error){invalidate();void close().catch(()=>{});throw error;}}
 function deactivateBusinessContinuity(token){businessIssuer(token,handle);need(businessToken===token,'CURRENT259_RESOURCE_CLOSED');checkContinuity(token);businessToken=undefined;}
 function checkOperation(){if(businessToken)checkContinuity(businessToken);else check();}

 try{
  resource=await (paymentLoopback?paymentStarters[topology]:firstQ2?startCurrent259FirstQ2LoopbackPostgres:technical?startCurrent259TechnicalPostgres:startTask01Postgres)({runId,sourceSha:witness.source.candidateSha,artifactsDir:plan.artifactsDir,endpoint:ENDPOINT,daemonId:plan.daemonId,imageId:IMAGE,tools:TOOLS,ownerPassword:credentials.owner,...(technical?{}:{deadlineMs:900000}),signal});
  // These are actual original producer return values, never caller projections.
  methods={close:own(resource,'close')};
  methods.getReceipt=own(resource,'getReceipt');
  if(technical)methodNames=[...METHODS,...(!paymentLoopback?CONTRACT_METHODS:[]),...(loopback?['checkRelay','beginPrismaRelayDrain']:[])];
  for(const key of methodNames)methods[key]=own(resource,key);
  need(methodNames.every(key=>typeof methods[key]==='function'),'CURRENT259_RESOURCE_CHANGED');
  fields=Object.fromEntries(relayFields.map(key=>[key,own(resource,key)]));fields.serverCertHashes=Object.freeze(record(fields.serverCertHashes,TLS_KEYS));
  need(/^[a-f0-9]{64}$/u.test(fields.containerId)&&/^[a-f0-9]{64}$/u.test(fields.networkId)&&Number.isInteger(fields.port)&&fields.port>0&&fields.port<=65535&&fields.databaseName===databaseName,'CURRENT259_RESOURCE_IDENTITY');
  if(loopback)need(typeof fields.relayId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(fields.relayId),'CURRENT259_RESOURCE_IDENTITY');
  need(fields.caPath===path.join(plan.artifactsDir,'tls-private/ca.crt')&&fields.wrongCaPath===path.join(plan.artifactsDir,'tls-private/wrong-ca.crt')&&TLS_KEYS.every(key=>/^[a-f0-9]{64}$/u.test(fields.serverCertHashes[key])),'CURRENT259_RESOURCE_TLS');
  need(!abortState(signal),'CURRENT259_RESOURCE_ABORTED');active=true;check();loader.verifyFull();
  const receipt=methods.getReceipt.call(resource);need(receipt.requestedCertificateMode==='correct'&&receipt.reloadState==='OBSERVED_PEER_CERTIFICATE_MATCHED'&&receipt.presentedCertificate?.mode==='correct'&&receipt.presentedCertificate.derSha256===fields.serverCertHashes.correctCertificateDerSha256,'CURRENT259_RESOURCE_TLS');
  const cursor=await methods.captureLogCursor.call(resource);check();need(cursor.runId===runId&&cursor.containerId===fields.containerId,'CURRENT259_RESOURCE_IDENTITY');
  loader.verifyFull();check();
  handle=Object.freeze({kind:'CURRENT259_OWNED_RESOURCE'});
  const resourceView={...fields,topology};
  for(const key of methodNames.filter(k=>!['close','getReceipt','checkRelay','beginPrismaRelayDrain'].includes(k)))resourceView[key]=async(...args)=>{need(!CONTRACT_METHODS.includes(key)||args.length===0,'CURRENT259_RESOURCE_DESCRIPTOR');checkOperation();try{const result=await methods[key].apply(resource,args);checkOperation();return result;}catch(error){invalidate();void close().catch(()=>{});throw error;}};
  resourceView.getReceipt=()=>{checkOperation();return methods.getReceipt.call(resource);};
  resourceView.getReceiptContinuity=token=>{businessIssuer(token,handle);checkLifetime();return methods.getReceipt.call(resource);};
  view=Object.freeze({scope:'OWNED_RESOURCE_ONLY',...(technical?{purpose:TECHNICAL_PURPOSE,deadlineMs:3600000}:{}),runId,source:witness.source,build:witness.build,loader,resource:Object.freeze(resourceView),credentials:()=>{check();return credentials;},check,checkLifetime,checkContinuity,verifyBusinessFiles,activateBusinessContinuity,deactivateBusinessContinuity,
   ...(loopback?{beginPrismaRelayDrain(){
    need(arguments.length===0&&active&&!broken&&!businessToken&&!abortState(signal)&&
     own(resource,'beginPrismaRelayDrain')===methods.beginPrismaRelayDrain,'CURRENT259_RESOURCE_CLOSED');
    return methods.beginPrismaRelayDrain.call(resource);
   }}:{}),verifyFull:()=>{check();try{loader.verifyFull();check();}catch(error){invalidate();void close().catch(()=>{});throw error;}}});
  handles.set(handle,{check,checkContinuity,view,close,technical});
  if(signal)EventTarget.prototype.addEventListener.call(signal,'abort',onAbort,{once:true});
  check();value=await consume(handle);check();loader.verifyFull();check();
 }catch(error){primary=error;hasPrimary=true;}
 finally{
  if(signal)EventTarget.prototype.removeEventListener.call(signal,'abort',onAbort);
  try{await close();}catch{
   if(!hasPrimary){primary=fail('CURRENT259_RESOURCE_CLEANUP_UNKNOWN');hasPrimary=true;}
   // Do not invoke or overwrite a foreign field, including a configurable
   // accessor. If annotation is unsafe, retain the original as a hidden cause.
   if(!primary||typeof primary!=='object'||types.isProxy(primary)||!Object.isExtensible(primary)||Object.getOwnPropertyDescriptor(primary,'resourceCleanup')){
    const cause=primary;primary=fail('CURRENT259_RESOURCE_CLEANUP_UNKNOWN');Object.defineProperty(primary,'cause',{value:cause});
   }
   Object.defineProperty(primary,'resourceCleanup',{value:Object.freeze({status:'UNKNOWN'}),enumerable:true});
  }
  invalidate();
 }
 if(hasPrimary)throw primary;return value;
}
async function withCurrent259OwnedResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function','CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,false);
}
async function withCurrent259TechnicalResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function','CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true);
}
async function withCurrent259FirstRollbackResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('cancel-commit').topology);
}
async function withCurrent259NormalPaymentResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('normal').topology);
}
async function withCurrent259ResponseLossResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('response-loss').topology);
}
async function withCurrent259FirstQ2LoopbackResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,Q2_TOPOLOGY);
}
async function withCurrent259CompetitionResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('competition').topology);
}
async function withCurrent259VoucherResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('competition-voucher').topology);
}
async function withCurrent259AttributionGapResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('attribution-gap').topology);
}
async function withCurrent259DisconnectRecoveryResource(build,plan,signal,consume){
 need(arguments.length===4&&typeof consume==='function'&&signal!==undefined,'CURRENT259_RESOURCE_ARGUMENTS');
 return withCurrent259Resource(build,plan,signal,consume,true,paymentLoopbackForScenario('disconnect-commit-recovery').topology);
}
function claimCurrent259TechnicalResource(handle){
 need(handle&&!types.isProxy(handle)&&handles.has(handle),'CURRENT259_RESOURCE_HANDLE');
 const owner=handles.get(handle);need(owner.technical===true,'CURRENT259_TECHNICAL_RESOURCE_REQUIRED');owner.check();return owner.view;
}
function claimCurrent259TechnicalResourceContinuity(handle,token){
 businessIssuer(token,handle);need(handle&&!types.isProxy(handle)&&handles.has(handle),'CURRENT259_RESOURCE_HANDLE');
 const owner=handles.get(handle);need(owner.technical===true,'CURRENT259_TECHNICAL_RESOURCE_REQUIRED');owner.view.checkLifetime();return owner.view;
}
module.exports=Object.freeze({withCurrent259OwnedResource,withCurrent259TechnicalResource,withCurrent259FirstRollbackResource,withCurrent259FirstQ2LoopbackResource,withCurrent259NormalPaymentResource,withCurrent259ResponseLossResource,withCurrent259CompetitionResource,withCurrent259VoucherResource,withCurrent259DisconnectRecoveryResource,withCurrent259AttributionGapResource,claimCurrent259OwnedResource,claimCurrent259TechnicalResource,claimCurrent259TechnicalResourceContinuity,closeCurrent259OwnedResource});
