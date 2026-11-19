'use strict';

const {types}=require('node:util');
const {isCurrent259OwnedModule,createCurrent259OwnedApplication,current259OwnedApplicationView,
 takeCurrent259CreationFailure,inspectCurrent259OwnedDocumentAuthProviders,takeCurrent261NativeOrdinaryClient,inspectCurrent261OwnedNativeEquipmentProviders,inspectCurrent261OwnedNativeEquipmentPublicGuard,consumeCurrent261OwnedNativeEquipmentPublicGuard}=require('./task16-current259-client-loader.cjs');
const CODE='CURRENT259_GENERATED_DOCUMENT_APP';
const faults=new WeakMap(),httpBridges=new WeakMap(),lifecycleHttpBridges=new WeakMap();
const exercisePattern=/^CURRENT259_GENERATED_DOCUMENT_EXERCISE_(?:INPUT|TEMPLATE|OPEN|SAVE|OWNER_BEGIN|GENERATE|PUBLIC_READBACK|OWNER_READBACK|RESULT)$/u;
const fixedExerciseCode=value=>typeof value==='string'&&exercisePattern.test(value)?value:undefined;
const fault=stage=>{
 const error=Object.assign(Error(CODE+'_'+stage),{code:CODE+'_'+stage});
 faults.set(error,stage);return error;
};
const need=(value,stage)=>{if(!value)throw fault(stage);};
const own=(object,key)=>object&&!types.isProxy(object)?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;
function method(object,key){
 for(let owner=object,depth=0;owner&&depth<32;owner=Object.getPrototypeOf(owner),depth++){
  need(!types.isProxy(owner),'DESCRIPTOR');
  const descriptor=Object.getOwnPropertyDescriptor(owner,key);
  if(descriptor){need(typeof descriptor.value==='function','DESCRIPTOR');return descriptor.value;}
 }
 throw fault('DESCRIPTOR');
}
function shadow(object,key,replacement,original){
 const descriptor=Object.getOwnPropertyDescriptor(object,key);
 need((!descriptor||descriptor.configurable&&Object.hasOwn(descriptor,'value'))&&object[key]===original,'DESCRIPTOR');
 const restore=()=>{
  if(descriptor)Object.defineProperty(object,key,descriptor);
  else need(Reflect.deleteProperty(object,key),'DESCRIPTOR');
  need(object[key]===original,'DESCRIPTOR');
 };
 try{
  Object.defineProperty(object,key,{value:replacement,configurable:true});
  need(object[key]===replacement,'DESCRIPTOR');
 }catch(error){
  try{restore();}
  catch{throw Object.assign(fault('DESCRIPTOR'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});}
  throw error;
 }
 return ()=>{
  const matched=object[key]===replacement;
  restore();need(matched,'DESCRIPTOR');
 };
}

function takeCurrent259GeneratedDocumentHttpBridge(config,server){
 need(arguments.length===2&&httpBridges.get(config)===server&&httpBridges.delete(config),'HANDLE');
}

function takeCurrent261LocalLifecycleHttpBridge(config,server){
 const entry=lifecycleHttpBridges.get(config);
 need(arguments.length===2&&entry?.server===server&&entry.authOnly!==true&&lifecycleHttpBridges.delete(config),'HANDLE');return entry.authDiagnostics;
}
function takeCurrent261FirstLoginHttpBridge(config,server){
 const entry=lifecycleHttpBridges.get(config);
 need(arguments.length===2&&entry?.server===server&&entry.authOnly===true&&lifecycleHttpBridges.delete(config),'HANDLE');return entry.authDiagnostics;
}


async function runCurrent259GeneratedDocumentApplication(bridge){
 need(arguments.length===1,'HANDLE');
 const {takeCurrent259GeneratedDocumentApplicationBridge}=require('./task12-current259-document-login.cjs');
 try{takeCurrent259GeneratedDocumentApplicationBridge(bridge);}catch{throw fault('HANDLE');}
 return runDocumentApplication(bridge);
}
const nativeApplications=new WeakSet();
async function runNativeTask12DocumentApplication(loginProjection,bridge){
 need(arguments.length===2&&bridge&&!types.isProxy(bridge)&&loginProjection&&!types.isProxy(loginProjection)&&!nativeApplications.has(loginProjection),'HANDLE');
 const prior=require('./task12-current259-document-login.cjs').readNativeTask12DocumentLoginProjection(loginProjection);
 const loader=own(bridge,'loader'),loaded=own(bridge,'loaded'),ordinary=own(bridge,'ordinary'),config=own(bridge,'publicLifecycle');
 need(loader&&loaded&&config&&own(bridge,'publicDraft')===undefined&&typeof own(loader,'loadCurrent261LocalLifecycleDocumentModules')==='function'&&loader.loadCurrent261LocalLifecycleDocumentModules()===loaded,'HANDLE');
 const Class=own(loaded,'PrismaService'),isFixture=own(loaded,'isTask12LocalLifecycleFixture');
 need(typeof Class==='function'&&ordinary&&takeCurrent261NativeOrdinaryClient(loader,loaded,ordinary)===true&&ordinary instanceof Class&&typeof isFixture==='function'&&isFixture(own(config,'fixture'))&&own(own(own(config,'fixture'),'case'),'key')==='inside:equipment_rental'&&['TASK12_ARCHIVE261_SOURCE_V1','TASK12_ARCHIVE262_SOURCE_V1'].includes(prior.source.profile?.profile),'HANDLE');
 nativeApplications.add(loginProjection);return runDocumentApplication(bridge,true);
}
async function runDocumentApplication(bridge,nativeEquipment=false){
 const {check,loader,loaded,ordinary,providers,queue,exercise,publicDraft,publicLifecycle}=bridge;
 let testing,view,orphan,closeApp,closeModule,restoreQueue,restoreOrdinary,server;
 let compilationStarted=false,pending=false,cleanupUnknown=false,primary,stage='PROVIDERS',value,authActive=false,httpEntered=false;
 const cleanupDiagnostics=[];
 const bounded=async operation=>{
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
   timer=setTimeout(()=>{pending=true;reject(fault('TIMEOUT'));},30000);
  })]);}finally{clearTimeout(timer);}
 };
 try{
  check();
  const keys=['PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor'];
  const tokens=keys.map(key=>own(loaded,key));
  const instances=[ordinary,providers.storage,providers.template,providers.worker];
  need(tokens.every(token=>typeof token==='function')&&instances.every(Boolean)&&new Set(instances).size===4,'PROVIDERS');
  const deferredDisconnect=()=>{};
  const originalShutdown=ordinary.onApplicationShutdown;
  need(typeof originalShutdown==='function','PROVIDERS');
  // The pool issuer still owns all four disconnects. Nest retains the
  // original worker hooks and completes them before that issuer can close.
  restoreOrdinary=shadow(ordinary,'onApplicationShutdown',deferredDisconnect,originalShutdown);
  const create=own(loader,'createDocumentTestingModule');
  need(typeof create==='function','PROVIDERS');
  const builder=create.call(loader),override=method(builder,'overrideProvider');
  for(const [index,token] of tokens.entries()){
   const binding=override.call(builder,token);
   method(binding,'useValue').call(binding,instances[index]);
  }
  stage='COMPILE';compilationStarted=true;
  testing=await bounded(()=>method(builder,'compile').call(builder));
  need(isCurrent259OwnedModule(testing),'MODULE');closeModule=method(testing,'close');
  check();
  const get=(target,token)=>method(target,'get').call(target,token);
  const provider=(target,token,pairs)=>{if(!pairs)return get(target,token);for(let i=0;i<pairs.length;i++)if(pairs[i][0]===token)return pairs[i][1];throw fault('PROVIDERS');};
  const documentToken=own(loaded,'ContractDocumentService'),draftToken=own(loaded,'ContractDraftController');
  const fileToken=own(loaded,'FileService'),authorityToken=own(loaded,'CONTRACT_VERSION_FILE_READ_AUTHORITY');
  const document=get(testing,documentToken),file=get(testing,fileToken),draft=get(testing,draftToken),authority=get(testing,authorityToken);
  const authKeys=['AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor'];
  const authTokens=publicLifecycle?authKeys.map(key=>own(loaded,key)):[];
  need(authTokens.every(token=>typeof token==='function'),'PROVIDERS');
  const authObjects=authTokens.map(token=>get(testing,token));
  const authMethods=publicLifecycle?[['AuthService',['login','loadUserRoleScopes','issueTokens']],['AuthRateLimitService',['take']],['AuthController',['login']],['Task12AuthErrorFilter',['catch']],['Task12AuthStageInterceptor',['intercept']]].flatMap(([key,names])=>names.map(name=>({target:own(loaded,key).prototype,receiver:authObjects[authKeys.indexOf(key)],name,value:method(own(loaded,key).prototype,name)}))):[];
  const authReceivers=(target,pairs)=>{
   if(!publicLifecycle)return;
   need(authTokens.every((token,i)=>provider(target,token,pairs)===authObjects[i]&&authObjects[i]&&!types.isProxy(authObjects[i])&&Object.getPrototypeOf(authObjects[i])===token.prototype)&&
    own(authObjects[0],'prisma')===ordinary&&own(authObjects[1],'prisma')===ordinary&&own(authObjects[2],'auth')===authObjects[0]&&own(authObjects[4],'filter')===authObjects[3]&&
    authMethods.every(row=>method(row.target,row.name)===row.value&&method(row.receiver,row.name)===row.value),'PROVIDERS');
  };
  // The contract ledger must use the genuine narrow Me projection. Optional
  // provider absence must never turn a missing task into an accepted empty list.
  const requireTasks=publicLifecycle&&own(publicLifecycle,'executionPurpose')!=='AUTH_ONLY_DIAGNOSTIC';
  const taskKeys=requireTasks?['ContractReadService','MeService','AuditService']:[];
  const taskTokens=taskKeys.map(key=>own(loaded,key));need(taskTokens.every(token=>typeof token==='function'),'PROVIDERS');
  const taskObjects=taskTokens.map(token=>get(testing,token));
  const taskMethods=requireTasks?[['workbenchLedger'],['getContractPendingWorkItems','contractV2LifecycleWorkItems'],['record']].flatMap((names,i)=>names.map(name=>({receiver:taskObjects[i],prototype:taskTokens[i].prototype,name,value:method(taskTokens[i].prototype,name)}))):[];
  const taskReceivers=(target,pairs)=>{
   if(!requireTasks)return;
   need(taskTokens.every((token,i)=>taskObjects[i]&&!types.isProxy(taskObjects[i])&&Object.getPrototypeOf(taskObjects[i])===token.prototype&&provider(target,token,pairs)===taskObjects[i])&&
    taskObjects.every(value=>own(value,'prisma')===ordinary)&&own(taskObjects[0],'me')===taskObjects[1]&&
    own(taskObjects[0],'audit')===taskObjects[2]&&own(taskObjects[1],'audit')===taskObjects[2]&&own(taskObjects[1],'files')===file&&
    taskMethods.every(row=>method(row.prototype,row.name)===row.value&&method(row.receiver,row.name)===row.value),'PROVIDERS');
  };
  const moduleRef=own(file,'moduleRef'),getModule=method(moduleRef,'get');
  const routeQueue=(...args)=>{check();return queue(...args);};
  const verifyProviders=(target,publicGuard=false)=>{
   check();const probe=nativeEquipment&&server&&target===view?(publicGuard?inspectCurrent261OwnedNativeEquipmentPublicGuard(application,testing,server):inspectCurrent261OwnedNativeEquipmentProviders(application,testing,server)):undefined;
   const pairs=publicGuard&&probe!==undefined?own(probe,'providers'):probe;
   if(pairs!==undefined)need(!types.isProxy(pairs)&&Array.isArray(pairs)&&pairs.length===16,'PROVIDERS');
   authReceivers(target,pairs);taskReceivers(target,pairs);
   need(tokens.every((token,i)=>provider(target,token,pairs)===instances[i])&&ordinary.onApplicationShutdown===deferredDisconnect&&
    provider(target,documentToken,pairs)===document&&provider(target,fileToken,pairs)===file&&provider(target,draftToken,pairs)===draft&&
    own(document,'prisma')===ordinary&&own(document,'files')===file&&own(draft,'documents')===document&&
    own(file,'prisma')===ordinary&&own(file,'storage')===providers.storage&&own(file,'moduleRef')===moduleRef&&
    typeof authorityToken==='symbol'&&authority&&provider(target,authorityToken,pairs)===authority&&
    getModule.call(moduleRef,authorityToken,{strict:false})===authority&&
    typeof authority.assertCanReadVersionFile==='function','PROVIDERS');
   return probe;
  };
  verifyProviders(testing);
  restoreQueue=shadow(document,'queueDraftPreview',routeQueue,method(document,'queueDraftPreview'));
  stage='CREATE';
  let application;
  try{application=createCurrent259OwnedApplication(testing);}
  catch(error){orphan=takeCurrent259CreationFailure(error);throw error;}
  view=current259OwnedApplicationView(application);closeApp=method(view,'close');
  verifyProviders(view);
  own(loaded,'configureApiSecurity')(view);
  own(loaded,'configureProjectionExportJson')(view);
  const adapter=method(view,'getHttpAdapter').call(view),express=method(adapter,'getInstance').call(adapter);
  method(express,'set').call(express,'json replacer',own(loaded,'apiJsonReplacer'));
  method(view,'enableCors').call(view,{origin:[],credentials:false});
  method(view,'useGlobalPipes').call(view,own(loaded,'createApiValidationPipe')());
  stage='INIT';
  await bounded(()=>method(view,'init').call(view));verifyProviders(view);
  need(document.queueDraftPreview===routeQueue,'PROVIDERS');
  if(publicDraft||publicLifecycle){
   need(!(publicDraft&&publicLifecycle),'HTTP');
   stage='LISTEN';
   server=method(view,'getHttpServer').call(view);
   need(server&&server.listening===false,'LISTEN');
   const listen=own(loaded,'listenApi');
   need(typeof listen==='function','LISTEN');
   await bounded(()=>listen(view,0,'127.0.0.1'));
   need(method(view,'getHttpServer').call(view)===server,'LISTEN');
   stage='HTTP';
   const withHttp=publicLifecycle?(own(publicLifecycle,'executionPurpose')==='AUTH_ONLY_DIAGNOSTIC'?require('./task12-current261-local-lifecycle-http.cjs').withCurrent261FirstLoginHttp:require('./task12-current261-local-lifecycle-http.cjs').withCurrent261LocalLifecycleHttp):
    require('./task12-current259-document-http.cjs').withCurrent259DocumentHttp;
   const jwtToken=own(loaded,'JwtTokenService'),jwtService=get(view,jwtToken),verifyAccess=method(jwtService,'verifyAccessToken');
   need(typeof jwtToken==='function'&&get(testing,jwtToken)===jwtService,'HTTP');
   const checkPublic=()=>{
    const probe=verifyProviders(view,true);
    if(probe!==undefined){
     need(own(probe,'server')===server&&own(probe,'jwtService')===jwtService&&own(probe,'verifyAccessToken')===verifyAccess,'HTTP');
     // Keep the full source guard after the original moduleRef authority read.
     check();need(consumeCurrent261OwnedNativeEquipmentPublicGuard(probe,application,testing,server)===true&&method(jwtService,'verifyAccessToken')===verifyAccess,'HTTP');
    }
    else need(method(view,'getHttpServer').call(view)===server&&get(view,jwtToken)===jwtService&&
     method(jwtService,'verifyAccessToken')===verifyAccess,'HTTP');
   };
   const verifyToken=token=>{checkPublic();return verifyAccess.call(jwtService,token);};
   const config=publicLifecycle??publicDraft,bridges=publicLifecycle?lifecycleHttpBridges:httpBridges;
   let authDiagnostics;
   if(publicLifecycle){
    const arm=own(loaded,'armTask12AuthError'),take=own(loaded,'takeTask12AuthError'),current=own(loaded,'currentOfficialDocumentScope');
    need([arm,take,current].every(fn=>typeof fn==='function'),'HTTP');
    const official=current(),remaining=own(official,'remainingTotalMilliseconds'),signal=own(publicLifecycle,'signal');
    need(own(official,'kind')==='OFFICIAL_TOOL_RUNTIME'&&typeof remaining==='function'&&signal instanceof AbortSignal&&!types.isProxy(signal),'HTTP');authActive=true;
    let pendingAuth;
    const inspectAuthLocal=()=>{
     need(authActive&&!signal.aborted&&remaining()>0&&authMethods.every(row=>method(row.target,row.name)===row.value&&method(row.receiver,row.name)===row.value)&&
      own(loaded,'armTask12AuthError')===arm&&own(loaded,'takeTask12AuthError')===take&&own(loaded,'currentOfficialDocumentScope')===current,'HTTP');
     need(own(authObjects[0],'prisma')===ordinary&&own(authObjects[1],'prisma')===ordinary&&own(authObjects[2],'auth')===authObjects[0]&&own(authObjects[4],'filter')===authObjects[3],'HTTP');
    };
    const inspectAuth=()=>{
     inspectAuthLocal();
     const proof=inspectCurrent259OwnedDocumentAuthProviders(application,testing,server);
     need(proof&&proof.runtime===ordinary&&proof.moduleRuntime===ordinary&&
      ['auth','rateLimits','authController','authFilter','authInterceptor'].every((key,i)=>proof[key]===authObjects[i]&&proof['module'+key[0].toUpperCase()+key.slice(1)]===authObjects[i]),'HTTP');
     const verify=own(proof,'verifyAuthDiagnosticReceiver');need(typeof verify==='function','HTTP');return verify;
    };
    authDiagnostics=Object.freeze({arm(phone){try{
     need(!pendingAuth,'HTTP');const verify=inspectAuth();
     const ticket=arm(authObjects[3],server,phone,Math.min(15000,remaining()));pendingAuth={ticket,verify};return ticket;
    }catch(error){authActive=false;throw error;}},take(ticket){
     const pending=pendingAuth;pendingAuth=undefined;
     try{
      // Consume within the original ticket lifetime before any validation work.
      // Data stays local until the same live receiver is verified. This never
      // replaces or authorizes the original full HTTP AFTER_CHECK.
      const detail=take(authObjects[3],server,ticket);
      need(pending&&pending.ticket===ticket,'HTTP');inspectAuthLocal();
      need(pending.verify()===true,'HTTP');inspectAuthLocal();return detail;
     }catch{authActive=false;return undefined;}
    }});
   }
   bridges.set(config,publicLifecycle?Object.freeze({server,authDiagnostics,authOnly:own(publicLifecycle,'executionPurpose')==='AUTH_ONLY_DIAGNOSTIC'}):server);
   try{httpEntered=true;value=await withHttp(config,server,checkPublic,verifyToken,exercise);}
   finally{bridges.delete(config);}
  }else{
   stage='USE';value=await exercise();
  }
  verifyProviders(view);need(document.queueDraftPreview===routeQueue,'PROVIDERS');
 }catch(error){
  if(publicLifecycle&&stage==='HTTP'&&!httpEntered){
   try{require('./task12-current261-local-lifecycle-http.cjs').rememberCurrent261ApplicationHttpSetupFailure(error);}
   catch{/* Observational diagnostics must preserve the original failure and cleanup. */}
  }
  primary=fault(faults.get(error)??stage);
  if(publicLifecycle){Object.defineProperty(primary,'cause',{value:error});if(own(error,'ownerCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')Object.defineProperty(primary,'ownerCleanupOutcome',{value:'UNKNOWN_DO_NOT_CONTINUE',enumerable:true});}
  const exerciseCode=publicDraft&&stage==='HTTP'&&fixedExerciseCode(own(error,'code'));
  if(exerciseCode)Object.defineProperty(primary,'exerciseCode',{value:exerciseCode,enumerable:true});
  if(own(error,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE'){cleanupUnknown=true;cleanupDiagnostics.push('INHERITED_UNKNOWN');}
 }
 authActive=false;
 try{
  if(closeApp)await bounded(()=>closeApp.call(view));
  else if(orphan)await bounded(()=>orphan.close());
  else if(closeModule)await bounded(()=>closeModule.call(testing));
  else if(compilationStarted){cleanupUnknown=true;cleanupDiagnostics.push('CLOSE_HANDLE_MISSING');}
  if(server&&server.listening!==false){cleanupUnknown=true;cleanupDiagnostics.push('SERVER_LISTENING');}
 }catch{cleanupUnknown=true;cleanupDiagnostics.push('CLOSE_FAILED');}
 finally{
  for(const restore of [restoreQueue,restoreOrdinary])if(restore){
   try{restore();}catch{cleanupUnknown=true;cleanupDiagnostics.push(restore===restoreQueue?'QUEUE_RESTORE_FAILED':'ORDINARY_RESTORE_FAILED');}
  }
 }
 if(cleanupUnknown||pending){if(pending)cleanupDiagnostics.push('BOUNDED_TIMEOUT_OBSERVED');throw Object.assign(primary??fault('CLOSE'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE',appCleanupDiagnostics:Object.freeze(cleanupDiagnostics)});}
 if(primary)throw primary;
 return value;
}
module.exports=Object.freeze({runNativeTask12DocumentApplication,takeCurrent261FirstLoginHttpBridge,takeCurrent261LocalLifecycleHttpBridge,runCurrent259GeneratedDocumentApplication,takeCurrent259GeneratedDocumentHttpBridge,fixedExerciseCode});
