"use strict";
// Versioned259 factory. Same seven real application exports and lifecycle.
// A connected transport is not admission; private session ownership is separate.
const fs=require('node:fs'),path=require('node:path');
const abortPrototype=AbortSignal.prototype,readAborted=Object.getOwnPropertyDescriptor(abortPrototype,'aborted').get;
const addAbortListener=EventTarget.prototype.addEventListener,removeAbortListener=EventTarget.prototype.removeEventListener;
const {types}=require('node:util');
const {claimCurrent259LiveSessions}=require('./task16-current259-live-sessions.cjs');
const {claimCurrent259TechnicalResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {loadCurrent259CatalogMaterial}=require('./task16-current259-catalog.cjs');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
const {current259OwnedApplicationMethod,current259OwnedApplicationView,isCurrent259OwnedModule,createCurrent259OwnedApplication:createOwnedNestApplication,takeCurrent259CreationFailure}=require('./task16-current259-client-loader.cjs');
const REQUEST=Object.freeze([
 ['application','database/task16-registered-application.module.js'],['database','database/prisma.service.js'],
 ['security','api-security.js'],['projection','operating-projection/projection-export-json.js'],
 ['json','api-json-replacer.js'],['validation','validation/api-validation.js'],['listen','api-listen.js']
].map(([name,file])=>Object.freeze({name,path:'services/api/dist/'+file})));
const CODES=new Set(['TASK16_APP_ABORTED','TASK16_APP_ADDRESS','TASK16_APP_BOUNDARY','TASK16_APP_CLOSE_UNKNOWN',
 'TASK16_APP_DATA_DESCRIPTOR','TASK16_APP_ENVIRONMENT_CHANGED','TASK16_APP_ENVIRONMENT_REQUIRED','TASK16_APP_FAILED_CLOSED',
 'TASK16_APP_HANDLE','TASK16_APP_IMPACT_READER_PROOF','TASK16_APP_METHOD_CHANGED','TASK16_APP_METHOD_DESCRIPTOR','TASK16_APP_MODULE_EXPORTS',
 'TASK16_APP_PRIOR_CHANGED','TASK16_APP_PRIOR_CLIENTS','TASK16_APP_RUNTIME_PROVIDER','TASK16_APP_STORAGE_CHANGED','TASK16_APP_STORAGE_REQUIRED']);
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
function own(object,key){need(object&&!types.isProxy(object),'TASK16_APP_DATA_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(object??{},key);need(d&&Object.hasOwn(d,'value'),'TASK16_APP_DATA_DESCRIPTOR');return d.value;}
function method(object,key){if(types.isProxy(object)){const known=current259OwnedApplicationMethod(object,key);need(known,'TASK16_APP_METHOD_DESCRIPTOR');return known;}let next=object;for(let i=0;next&&i<32;i++,next=Object.getPrototypeOf(next)){need(!types.isProxy(next),'TASK16_APP_METHOD_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(next,key);if(d){need(Object.hasOwn(d,'value')&&typeof d.value==='function','TASK16_APP_METHOD_DESCRIPTOR');return d.value;}}throw fault('TASK16_APP_METHOD_DESCRIPTOR');}
async function createCurrent259Application(context,boundary,continuity){
 let moduleHandle,appHandle,moduleMethods,appMethods,attempted=false,closing,released=false;
 const registered=[];
 const register=(value,kind)=>{need(value!==null&&(typeof value==='object'||typeof value==='function'),'TASK16_APP_HANDLE');const entry={value,kind,close:undefined};registered.push(entry);entry.close=method(value,'close');return entry;};
 const close=()=>{released=true;return closing??=(async()=>{let unknown=attempted&&registered.length===0;const moduleEntry=registered.find(e=>e.kind==='module'),appEntry=registered.find(e=>e.kind==='app');
  if(appEntry){try{need(typeof appEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await appEntry.close.call(appEntry.value);}catch{unknown=true;if(moduleEntry){try{need(typeof moduleEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await moduleEntry.close.call(moduleEntry.value);}catch{unknown=true;}}}}
  else if(moduleEntry){try{need(typeof moduleEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await moduleEntry.close.call(moduleEntry.value);}catch{unknown=true;}}
  if(continuity?.onClose){try{continuity.onClose({returned:!unknown,acquired:registered.length>0});}catch{unknown=true;}}
  if(unknown)throw fault('TASK16_APP_CLOSE_UNKNOWN');
 })();};
 try{
  need(boundary&&!types.isProxy(boundary)&&Reflect.ownKeys(boundary).length===2&&Object.keys(boundary).sort().join(',')==='createTestingModule,loadModules','TASK16_APP_BOUNDARY');const loadModules=own(boundary,'loadModules'),createTestingModule=own(boundary,'createTestingModule');need(typeof loadModules==='function'&&typeof createTestingModule==='function','TASK16_APP_BOUNDARY');
  const clients=context.clients,source=context.source,registeredAccess=context.registeredAccess,runtime=own(clients,'runtime'),binding=own(clients,'sourceBinding');
  const sourceSha=own(source,'candidateSha'),seal=own(source,'sealSha256'),manifest=own(registeredAccess,'manifestSha256');
  need(own(clients,'status')==='CLIENTS_CONNECTED_AND_IDENTITY_MATCHED'&&runtime!==null&&typeof runtime==='object'&&/^[a-f0-9]{40}$/u.test(sourceSha)&&/^[a-f0-9]{64}$/u.test(seal)&&/^[a-f0-9]{64}$/u.test(manifest)&&own(binding,'sourceSha')===sourceSha&&own(binding,'sourceSealSha256')===seal&&own(binding,'registeredManifestSha256')===manifest,'TASK16_APP_PRIOR_CLIENTS');
  const readerAdmission=claimCurrent259Application(context);
  let impactReader,impactToken,impactExports;
  const required={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local'};
  for(const[key,value]of Object.entries(required))need(process.env[key]===value,'TASK16_APP_ENVIRONMENT_REQUIRED');
  for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'])need(typeof process.env[key]==='string'&&/^[a-f0-9]{64,192}$/u.test(process.env[key]),'TASK16_APP_ENVIRONMENT_REQUIRED');
  need(new Set(['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'].map(k=>process.env[k])).size===3,'TASK16_APP_ENVIRONMENT_REQUIRED');
  const storage=process.env.FILE_STORAGE_ROOT,parent=context.options.artifactsDir;
  need(typeof storage==='string'&&storage.startsWith(parent+path.sep)&&fs.realpathSync(storage)===storage&&fs.realpathSync(parent)===parent,'TASK16_APP_STORAGE_REQUIRED');
  for(const dir of [parent,storage]){const stat=fs.lstatSync(dir);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'TASK16_APP_STORAGE_REQUIRED');}
  const directories=[parent,storage].map(dir=>{const stat=fs.lstatSync(dir);return{dir,dev:stat.dev,ino:stat.ino,mode:stat.mode,uid:stat.uid};});
  const environment=Object.fromEntries([...Object.keys(required),'FILE_STORAGE_ROOT','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'].map(key=>[key,process.env[key]]));
  const check=()=>{
   for(const row of directories){const stat=fs.lstatSync(row.dir);need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(row.dir)===row.dir&&['dev','ino','mode','uid'].every(key=>stat[key]===row[key]),'TASK16_APP_STORAGE_CHANGED');}
   need(!context.signal.aborted,'TASK16_APP_ABORTED');need(context.clients===clients&&context.source===source&&context.registeredAccess===registeredAccess&&own(clients,'runtime')===runtime&&own(clients,'sourceBinding')===binding&&own(source,'candidateSha')===sourceSha&&own(source,'sealSha256')===seal&&own(registeredAccess,'manifestSha256')===manifest&&own(binding,'sourceSha')===sourceSha&&own(binding,'sourceSealSha256')===seal&&own(binding,'registeredManifestSha256')===manifest,'TASK16_APP_PRIOR_CHANGED');
   need(Object.entries(environment).every(([key,value])=>process.env[key]===value)&&!Object.keys(process.env).some(key=>/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_|PRISMA_)/u.test(key)&&!['SMS_ENABLED','APPROVAL_SMS_ENABLED','PRISMA_HIDE_UPDATE_MESSAGE'].includes(key))&&!['DATABASE_URL','NODE_OPTIONS','NODE_PATH','PORT','HOST','WEB_ORIGIN','SKIP_DATABASE_CONNECT'].some(key=>Boolean(process.env[key])),'TASK16_APP_ENVIRONMENT_CHANGED');
   for(const [handle,methods]of [[moduleHandle,moduleMethods],[appHandle,appMethods]])if(handle&&methods)for(const[key,value]of Object.entries(methods))need(method(handle,key)===value,'TASK16_APP_METHOD_CHANGED');
   if(readerAdmission)need(!released&&!closing&&peekCurrent259Application(context)===readerAdmission&&
    (!impactExports||own(impactExports,'Task16ImpactReaderToken')===impactToken),'TASK16_APP_IMPACT_READER_PROOF');
   if(continuity)continuity.checkLight();
  };
  check();const exports=await loadModules(REQUEST);check();const names=['Task16RegisteredApplicationModule','PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi'],loaded=Object.fromEntries(names.map(name=>[name,own(exports,name)]));need(Object.values(loaded).every(value=>typeof value==='function'),'TASK16_APP_MODULE_EXPORTS');
  const builder=createTestingModule({imports:[loaded.Task16RegisteredApplicationModule]});
  const overrideProvider=method(builder,'overrideProvider');
  const override=overrideProvider.call(builder,loaded.PrismaService);method(override,'useValue').call(override,runtime);
  if(readerAdmission){
   impactToken=own(exports,'Task16ImpactReaderToken');
   need(typeof impactToken==='symbol','TASK16_APP_IMPACT_READER_PROOF');
   impactExports=exports;
   impactReader=readerAdmission.open(check);
   const readerOverride=overrideProvider.call(builder,impactToken);method(readerOverride,'useValue').call(readerOverride,impactReader);
  }
  const verifyProviders=(handle,methods)=>{
   need(methods.get.call(handle,loaded.PrismaService)===runtime,'TASK16_APP_RUNTIME_PROVIDER');
   if(impactReader)need(methods.get.call(handle,impactToken)===impactReader,'TASK16_APP_IMPACT_READER_PROOF');
  };
  check();const compile=method(builder,'compile');attempted=true;moduleHandle=await compile.call(builder);const moduleEntry=register(moduleHandle,'module');moduleMethods={close:moduleEntry.close,get:method(moduleHandle,'get'),createNestApplication:method(moduleHandle,'createNestApplication')};check();verifyProviders(moduleHandle,moduleMethods);
  appHandle=isCurrent259OwnedModule(moduleHandle)?createOwnedNestApplication(moduleHandle):moduleMethods.createNestApplication.call(moduleHandle);const appEntry=register(appHandle,'app');appMethods={close:appEntry.close,...Object.fromEntries(['get','getHttpAdapter','enableCors','useGlobalPipes','init','getHttpServer'].map(key=>[key,method(appHandle,key)]))};check();verifyProviders(appHandle,appMethods);
  const helperTarget=current259OwnedApplicationView(appHandle)??appHandle;loaded.configureApiSecurity(helperTarget);check();loaded.configureProjectionExportJson(helperTarget);check();const adapter=appMethods.getHttpAdapter.call(appHandle),express=method(adapter,'getInstance').call(adapter);method(express,'set').call(express,'json replacer',loaded.apiJsonReplacer);appMethods.enableCors.call(appHandle,{origin:[],credentials:false});appMethods.useGlobalPipes.call(appHandle,loaded.createApiValidationPipe());check();await appMethods.init.call(appHandle);check();verifyProviders(moduleHandle,moduleMethods);verifyProviders(appHandle,appMethods);
  await loaded.listenApi(helperTarget,0,'127.0.0.1');check();const server=appMethods.getHttpServer.call(appHandle),address=method(server,'address').call(server);need(address,'TASK16_APP_ADDRESS');const host=own(address,'address'),family=own(address,'family'),port=own(address,'port'),listening=server.listening;need(listening===true&&host==='127.0.0.1'&&family==='IPv4'&&Number.isInteger(port)&&port>1024&&port<=65535,'TASK16_APP_ADDRESS');
  verifyProviders(moduleHandle,moduleMethods);verifyProviders(appHandle,appMethods);check();
  const addressMethod=method(server,'address');
  const inspect=()=>{check();need(appMethods.getHttpServer.call(appHandle)===server&&method(server,'address')===addressMethod,'TASK16_APP_ADDRESS');const current=addressMethod.call(server),live=server.listening;need(live===true&&own(current,'address')===host&&own(current,'family')===family&&own(current,'port')===port,'TASK16_APP_RUNTIME_PROVIDER');verifyProviders(appHandle,appMethods);verifyProviders(moduleHandle,moduleMethods);return Object.freeze({origin:`http://127.0.0.1:${port}/`,runtime});};
  return{inspect,status:'CURRENT259_APPLICATION_PROTOCOL_RETURNED_NOT_NATIVE_PROOF',origin:`http://127.0.0.1:${port}/`,runtime,close,sourceBinding:{sourceSha,sourceSealSha256:seal,registeredManifestSha256:manifest},nativeProof:false,environmentPreparationImplemented:false,financialAcceptance:false};
 }catch(error){const orphan=takeCurrent259CreationFailure(error);if(orphan)registered.push({value:orphan.value,kind:'app',close:orphan.close});let unknown=false;try{await close();}catch{unknown=true;}let code='TASK16_APP_FAILED_CLOSED';try{const descriptor=error&&Object.getOwnPropertyDescriptor(error,'code');if(descriptor&&Object.hasOwn(descriptor,'value')&&CODES.has(descriptor.value))code=descriptor.value;}catch{/* Untrusted exception descriptors are never projected. */}throw Object.assign(new Error(code),{code,appStartupOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:unknown?'UNKNOWN_DO_NOT_CONTINUE':registered.length?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'NOT_NEEDED'});}
}

const admissions=new WeakMap(),claims=new WeakSet(),opens=new WeakSet();
const {ownsActiveTask16SimulationContext}=require('./run-task16-registered-pg-local.cjs');
function peekCurrent259Application(context){
 const clients=context&&Object.getOwnPropertyDescriptor(context,'clients')?.value;
 const admission=clients&&admissions.get(clients);
 if(!admission||admission.context!==context)throw fault('TASK16_APP_IMPACT_READER_PROOF');
 admission.check();return admission;
}
function claimCurrent259Application(context){
 const admission=peekCurrent259Application(context);
 need(!claims.has(admission),'TASK16_APP_IMPACT_READER_PROOF');claims.add(admission);
 return admission;
}
/** Explicit simulation producer only; no native flag or plain receipt can issue
 * actual lease authority. The fixed transport above also serves a real owned
 * session once a separately reviewed repo lease consumer supplies admission. */
function bindSimulatedCurrent259Application(context,session){
 const code='TASK16_APP_IMPACT_READER_PROOF';
 need(ownsActiveTask16SimulationContext(context)&&context.simulation===true&&session&&!types.isProxy(session),code);
 const clients=context.clients,source=context.source,registered=context.registeredAccess;
 need(clients&&!types.isProxy(clients)&&!admissions.has(clients)&&source===own(session,'source')
  &&['owner','runtime','observer','identity','verifyFull','verifyInstalled259'].every(k=>own(clients,k)===own(session,k))
  &&own(clients,'status')==='CLIENTS_CONNECTED_AND_IDENTITY_MATCHED',code);
 const profile=qualifyCurrent259Source(source),sourceSnapshot=JSON.stringify(profile),binding=own(clients,'sourceBinding');
 const checkLight=own(clients,'checkLight');need(typeof checkLight==='function',code);
 need(own(binding,'sourceSha')===profile.candidateSha&&own(binding,'sourceSealSha256')===profile.sealSha256
  &&own(binding,'registeredManifestSha256')===own(registered,'manifestSha256'),code);
 const admission=Object.freeze({context,check(){
  need(ownsActiveTask16SimulationContext(context)&&context.simulation===true&&context.clients===clients&&context.source===source
   &&context.registeredAccess===registered&&own(clients,'sourceBinding')===binding&&own(clients,'checkLight')===checkLight
   &&JSON.stringify(qualifyCurrent259Source(source))===sourceSnapshot
   &&['owner','runtime','observer','identity','verifyFull','verifyInstalled259'].every(k=>own(clients,k)===own(session,k))
   &&own(binding,'sourceSha')===profile.candidateSha&&own(binding,'sourceSealSha256')===profile.sealSha256
   &&own(binding,'registeredManifestSha256')===own(registered,'manifestSha256'),code);
  checkLight.call(clients);
 },open(check){
  admission.check();need(claims.has(admission)&&!opens.has(admission)&&typeof check==='function',code);opens.add(admission);
  return createCurrent259ImpactRuntime(session,()=>{admission.check();check();});
 }});
 admission.check();admissions.set(clients,admission);
}
/**
 * Consumes a live session capability inside its original resource scope. The
 * environment and private local storage must already satisfy the real factory.
 */
async function createCurrent259OwnedApplication(proof,handle,signal,onControl){
 const code='TASK16_APP_IMPACT_READER_PROOF';
 need(arguments.length===4&&signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===abortPrototype&&
  !Object.hasOwn(signal,'aborted'),'TASK16_APP_ABORTED');
 const aborted=readAborted;
 need(aborted.call(signal)===false,'TASK16_APP_ABORTED');
 const session=claimCurrent259LiveSessions(proof,handle);
 let view,context,clients,app,appInspect,appClose,active=true,broken=false,closing,shutdown,shutdownUnknown=false;
 const revoke=()=>{active=false;if(clients)admissions.delete(clients);};
 const terminate=()=>shutdown??=Promise.resolve().then(async()=>{
  try{await own(session,'close').call(session);}catch{shutdownUnknown=true;}
  try{await closeCurrent259OwnedResource(handle);}catch{shutdownUnknown=true;}
 });
 const close=()=>{
  revoke();
  if(!app)return Promise.resolve();
  return closing??=Promise.resolve().then(async()=>{
   let unknown=false;
   try{if(app)await appClose.call(app);}catch{unknown=true;}
   if(unknown||broken)await terminate();
   if(unknown||shutdownUnknown)throw fault('TASK16_APP_CLOSE_UNKNOWN');
  });
 };
 onControl(Object.freeze({revoke,close,terminate,cleanupUnknown:()=>shutdownUnknown}));
 try{
  view=claimCurrent259TechnicalResource(handle);
  const loader=view.loader,Class=own(loader,'Class');
  const load=own(loader,'loadApplicationModules'),create=own(loader,'createTestingModule');
  const source=own(session,'source'),checkSession=own(session,'checkLight'),verifySession=own(session,'verifyFull');
  need(typeof Class==='function'&&[load,create,checkSession,verifySession].every(fn=>typeof fn==='function'),code);
  const fields=['owner','runtime','observer','identity','verifyFull','verifyInstalled259'];
  const original=Object.fromEntries(fields.map(key=>[key,own(session,key)]));
  const profile=qualifyCurrent259Source(source),sourceSnapshot=JSON.stringify(profile);
  need(view.source.candidateSha===profile.candidateSha&&view.source.sourceSealSha256===profile.sealSha256,code);
  const material=loadCurrent259CatalogMaterial(source);
  need(material.sourceSha===profile.candidateSha&&material.sealSha256===profile.sealSha256&&
   /^[a-f0-9]{64}$/u.test(material.registeredManifestSha256),code);
  const registered=Object.freeze({manifestSha256:material.registeredManifestSha256});
  const binding=Object.freeze({sourceSha:profile.candidateSha,sourceSealSha256:profile.sealSha256,registeredManifestSha256:registered.manifestSha256});
  const check=()=>{
   try{
    need(active&&!broken&&!aborted.call(signal),code);
    checkSession.call(session);view.check();
    need(claimCurrent259TechnicalResource(handle)===view&&view.loader===loader&&own(loader,'Class')===Class&&
     own(loader,'loadApplicationModules')===load&&own(loader,'createTestingModule')===create&&
     own(session,'source')===source&&own(session,'checkLight')===checkSession&&
     JSON.stringify(qualifyCurrent259Source(source))===sourceSnapshot&&
     view.source.candidateSha===profile.candidateSha&&view.source.sourceSealSha256===profile.sealSha256&&
     fields.every(key=>own(session,key)===original[key]),code);
    if(app)need(own(app,'inspect')===appInspect&&own(app,'close')===appClose,code);
   }catch{broken=true;revoke();if(app)void close().catch(()=>{});throw fault(code);}
  };
  clients=Object.freeze({status:'CLIENTS_CONNECTED_AND_IDENTITY_MATCHED',...original,sourceBinding:binding,checkLight:check});
  context=Object.freeze({clients,source,registeredAccess:registered,options:Object.freeze({artifactsDir:path.dirname(path.dirname(view.resource.caPath))}),signal});
  const admission=Object.freeze({context,check,open(checkApplication){
   check();need(claims.has(admission)&&!opens.has(admission)&&typeof checkApplication==='function',code);opens.add(admission);
   return createCurrent259ImpactRuntime(session,()=>{check();checkApplication();});
  }});
  check();await verifySession.call(session);check();
  admissions.set(clients,admission);
  const boundary=Object.freeze({
   loadModules(request){check();const result=load.call(loader,request);check();return result;},
   createTestingModule(metadata){check();const result=create.call(loader,metadata);check();return result;}
  });
  app=await createCurrent259Application(context,boundary,{checkLight:check,onClose:revoke});
  appInspect=own(app,'inspect');appClose=own(app,'close');
  check();await verifySession.call(session);check();
  const inspected=appInspect.call(app);
  need(inspected.runtime===original.runtime,code);
  const application=Object.freeze({status:'CURRENT259_OWNED_APPLICATION_SOURCE_AND_PROVIDER_MATCHED',origin:inspected.origin,
   runtime:original.runtime,sourceBinding:binding,environmentPreparationImplemented:false,financialAcceptance:false,
   inspect(){
    try{check();return appInspect.call(app);}
    catch{broken=true;revoke();void close().catch(()=>{});throw fault('TASK16_APP_FAILED_CLOSED');}
   }});
  return Object.freeze({application,close,terminate,cleanupUnknown:()=>shutdownUnknown});
 }catch(error){
  revoke();let cleanupUnknown=false;
  try{await close();}catch{cleanupUnknown=true;}
  await terminate();cleanupUnknown=cleanupUnknown||shutdownUnknown;
  let failure='TASK16_APP_FAILED_CLOSED',startup='NOT_ATTEMPTED';
  if(error&&!types.isProxy(error)){
   const descriptor=Object.getOwnPropertyDescriptor(error,'code'),state=Object.getOwnPropertyDescriptor(error,'appStartupOutcome'),cleanup=Object.getOwnPropertyDescriptor(error,'appCleanupOutcome');
   if(cleanup&&Object.hasOwn(cleanup,'value')&&cleanup.value==='UNKNOWN_DO_NOT_CONTINUE')cleanupUnknown=true;
   if(descriptor&&Object.hasOwn(descriptor,'value')&&CODES.has(descriptor.value))failure=descriptor.value;
   if(state&&Object.hasOwn(state,'value')&&['NOT_ATTEMPTED','UNKNOWN_DO_NOT_RETRY'].includes(state.value))startup=state.value;
  }
  throw Object.assign(fault(failure),{appStartupOutcome:app?'UNKNOWN_DO_NOT_RETRY':startup,
   appCleanupOutcome:cleanupUnknown?'UNKNOWN_DO_NOT_CONTINUE':app?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'NOT_NEEDED'});
 }
}
async function withCurrent259OwnedApplication(proof,handle,signal,consume){
 need(arguments.length===4&&typeof consume==='function','TASK16_APP_BOUNDARY');
 need(signal&&!types.isProxy(signal)&&Object.getPrototypeOf(signal)===abortPrototype&&
  !Object.hasOwn(signal,'aborted'),'TASK16_APP_ABORTED');
 const aborted=readAborted;
 need(aborted.call(signal)===false,'TASK16_APP_ABORTED');
 let owned,control,value,first,hasPrimary=false,cleanupUnknown=false,abortObserved=false,creationSettled=false;
 let resolveAbort,closingOutcome,closeSettled=false;
 const outcome=promise=>Promise.resolve(promise).then(value=>({value}),error=>({failed:true,error}));
 const beginClose=()=>{
  if(!closingOutcome)closingOutcome=outcome(control.close()).then(result=>{closeSettled=true;return result;});
  return closingOutcome;
 };
 const cancellation=new Promise(resolve=>{resolveAbort=resolve;});
 const onAbort=()=>{
  abortObserved=true;
  if(control){
   control.revoke();
   // Start HTTP closure before terminating the backing sessions. Neither a
   // pending caller promise nor an unreturned startup can retain authority.
   beginClose();
   void control.terminate();
  }
  resolveAbort({aborted:true});
 };
 addAbortListener.call(signal,'abort',onAbort,{once:true});
 try{
  if(aborted.call(signal))onAbort();
  const creating=outcome(createCurrent259OwnedApplication(proof,handle,signal,scope=>{
   control=scope;if(abortObserved){scope.revoke();void scope.terminate();}
  })).then(async result=>{
   creationSettled=true;
   // The race retains handlers for late resolution or rejection. Late startup
   // can only be cleaned up and never becomes the callback's application.
   if(abortObserved&&!result.failed){
    try{await result.value.close();}catch{cleanupUnknown=true;}
    await result.value.terminate();
   }
   return result;
  });
  const created=await Promise.race([creating,cancellation]);
  if(created.aborted)throw fault('TASK16_APP_ABORTED');
  if(created.failed)throw created.error;
  owned=created.value;
  const completed=await Promise.race([outcome(Promise.resolve().then(()=>consume(owned.application))),cancellation]);
  if(completed.aborted)throw fault('TASK16_APP_ABORTED');
  if(completed.failed)throw completed.error;
  value=completed.value;
  owned.application.inspect();
 }catch(error){first=error;hasPrimary=true;}
 finally{
  try{
   if(control){
    const closing=beginClose();
    const closed=closeSettled?await closing:await Promise.race([closing,cancellation]);
    if(closed.aborted){
     // Cancellation ends the wait, never certifies the unreturned close.
     if(!closeSettled)cleanupUnknown=true;
     else if((await closing).failed)cleanupUnknown=true;
     if(!hasPrimary){first=fault('TASK16_APP_ABORTED');hasPrimary=true;}
    }else if(closed.failed){
     cleanupUnknown=true;if(!hasPrimary){first=closed.error;hasPrimary=true;}
    }
    if(hasPrimary)await control.terminate();
    cleanupUnknown=cleanupUnknown||control.cleanupUnknown()||abortObserved&&!creationSettled;
   }
  }finally{removeAbortListener.call(signal,'abort',onAbort);}
 }
 if(hasPrimary){
  let code='TASK16_APP_FAILED_CLOSED',startup=owned||control?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED';
  let cleanup=owned?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'NOT_NEEDED';
  if(first&&!types.isProxy(first)){
   const descriptors=Object.getOwnPropertyDescriptors(first),data=key=>descriptors[key]&&Object.hasOwn(descriptors[key],'value')?descriptors[key].value:undefined;
   if(CODES.has(data('code')))code=data('code');
   if(['NOT_ATTEMPTED','UNKNOWN_DO_NOT_RETRY'].includes(data('appStartupOutcome')))startup=data('appStartupOutcome');
   if(['NOT_NEEDED','APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF','UNKNOWN_DO_NOT_CONTINUE'].includes(data('appCleanupOutcome')))cleanup=data('appCleanupOutcome');
  }
  if(cleanupUnknown)cleanup='UNKNOWN_DO_NOT_CONTINUE';
  throw Object.assign(fault(code),{appStartupOutcome:startup,appCleanupOutcome:cleanup});
 }
 return value;
}
module.exports={createCurrent259Application,bindSimulatedCurrent259Application,claimCurrent259Application,withCurrent259OwnedApplication};
