'use strict';

const {types}=require('node:util');
const {isCurrent259OwnedModule,createCurrent259OwnedApplication,current259OwnedApplicationView,
 takeCurrent259CreationFailure}=require('./task16-current259-client-loader.cjs');
const CODE='CURRENT259_GENERATED_DOCUMENT_APP';
const faults=new WeakMap(),httpBridges=new WeakMap();
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

async function runCurrent259GeneratedDocumentApplication(bridge){
 need(arguments.length===1,'HANDLE');
 const {takeCurrent259GeneratedDocumentApplicationBridge}=require('./task12-current259-document-login.cjs');
 try{takeCurrent259GeneratedDocumentApplicationBridge(bridge);}catch{throw fault('HANDLE');}
 const {check,loader,loaded,ordinary,providers,queue,exercise,publicDraft}=bridge;
 let testing,view,orphan,closeApp,closeModule,restoreQueue,restoreOrdinary,server;
 let compilationStarted=false,pending=false,cleanupUnknown=false,primary,stage='PROVIDERS',value;
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
  const documentToken=own(loaded,'ContractDocumentService'),draftToken=own(loaded,'ContractDraftController');
  const fileToken=own(loaded,'FileService'),authorityToken=own(loaded,'CONTRACT_VERSION_FILE_READ_AUTHORITY');
  const document=get(testing,documentToken),file=get(testing,fileToken),draft=get(testing,draftToken),authority=get(testing,authorityToken);
  const moduleRef=own(file,'moduleRef'),getModule=method(moduleRef,'get');
  const routeQueue=(...args)=>{check();return queue(...args);};
  const verifyProviders=target=>{
   check();
   need(tokens.every((token,i)=>get(target,token)===instances[i])&&ordinary.onApplicationShutdown===deferredDisconnect&&
    get(target,documentToken)===document&&get(target,fileToken)===file&&get(target,draftToken)===draft&&
    own(document,'prisma')===ordinary&&own(document,'files')===file&&own(draft,'documents')===document&&
    own(file,'prisma')===ordinary&&own(file,'storage')===providers.storage&&own(file,'moduleRef')===moduleRef&&
    typeof authorityToken==='symbol'&&authority&&get(target,authorityToken)===authority&&
    getModule.call(moduleRef,authorityToken,{strict:false})===authority&&
    typeof authority.assertCanReadVersionFile==='function','PROVIDERS');
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
  if(publicDraft){
   stage='LISTEN';
   server=method(view,'getHttpServer').call(view);
   need(server&&server.listening===false,'LISTEN');
   const listen=own(loaded,'listenApi');
   need(typeof listen==='function','LISTEN');
   await bounded(()=>listen(view,0,'127.0.0.1'));
   need(method(view,'getHttpServer').call(view)===server,'LISTEN');
   stage='HTTP';
   const {withCurrent259DocumentHttp}=require('./task12-current259-document-http.cjs');
   const jwtToken=own(loaded,'JwtTokenService'),jwtService=get(view,jwtToken),verifyAccess=method(jwtService,'verifyAccessToken');
   need(typeof jwtToken==='function'&&get(testing,jwtToken)===jwtService,'HTTP');
   const checkPublic=()=>{
    verifyProviders(view);
    need(method(view,'getHttpServer').call(view)===server&&get(view,jwtToken)===jwtService&&
     method(jwtService,'verifyAccessToken')===verifyAccess,'HTTP');
   };
   const verifyToken=token=>{checkPublic();return verifyAccess.call(jwtService,token);};
   httpBridges.set(publicDraft,server);
   try{value=await withCurrent259DocumentHttp(publicDraft,server,checkPublic,verifyToken,exercise);}
   finally{httpBridges.delete(publicDraft);}
  }else{
   stage='USE';value=await exercise();
  }
  verifyProviders(view);need(document.queueDraftPreview===routeQueue,'PROVIDERS');
 }catch(error){
  primary=fault(faults.get(error)??stage);
  const exerciseCode=publicDraft&&stage==='HTTP'&&fixedExerciseCode(own(error,'code'));
  if(exerciseCode)Object.defineProperty(primary,'exerciseCode',{value:exerciseCode,enumerable:true});
  if(own(error,'appCleanupOutcome')==='UNKNOWN_DO_NOT_CONTINUE')cleanupUnknown=true;
 }
 try{
  if(closeApp)await bounded(()=>closeApp.call(view));
  else if(orphan)await bounded(()=>orphan.close());
  else if(closeModule)await bounded(()=>closeModule.call(testing));
  else if(compilationStarted)cleanupUnknown=true;
  if(server&&server.listening!==false)cleanupUnknown=true;
 }catch{cleanupUnknown=true;}
 finally{
  for(const restore of [restoreQueue,restoreOrdinary])if(restore){
   try{restore();}catch{cleanupUnknown=true;}
  }
 }
 if(cleanupUnknown||pending)throw Object.assign(primary??fault('CLOSE'),{appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
 if(primary)throw primary;
 return value;
}
module.exports=Object.freeze({runCurrent259GeneratedDocumentApplication,takeCurrent259GeneratedDocumentHttpBridge,fixedExerciseCode});
