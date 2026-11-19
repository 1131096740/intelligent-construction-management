'use strict';
const {request}=require('node:http'),{randomBytes,createHash}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises'),{types,isDeepStrictEqual:equal}=require('node:util');
const {performance}=require('node:perf_hooks');
const readMonotonic=performance.now.bind(performance);
const diagnosticNow=()=>{try{const value=readMonotonic();return typeof value==='number'&&Number.isFinite(value)?value:NaN;}catch{return NaN;}};
const {decodeRelaySysreadExit}=require('./task16-current259-relay-sysread.cjs');
const id=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x);
const issued=new WeakMap(),failures=new WeakMap();
// Diagnostics are observations only; these entries confer no runtime authority.
function describeCurrent261LocalLifecycleHttpFailure(cause){
 for(let n=0;n<8&&cause&&typeof cause==='object'&&!types.isProxy(cause);n++,cause=own(cause,'cause')){
  const detail=failures.get(cause);if(detail)return detail;
 }
}
const remember=(cause,detail)=>{if(cause&&typeof cause==='object'&&!types.isProxy(cause)&&!failures.has(cause))failures.set(cause,Object.freeze({...detail}));};
const routeTemplate=path=>{
 const fixed=['/auth/login','/me/signature/canvas','/files','/contract-layout-templates','/contracts','/contracts/workbench?view=pending_action&page=1&pageSize=100'];
 if(fixed.includes(path))return path;
 const uuid='[a-f0-9-]{36}',patterns=[
  ['^/contracts/'+uuid+'\\?versionId='+uuid+'$','/contracts/:contractId?versionId=:versionId'],
  ['^/contract-drafts/'+uuid+'$','/contract-drafts/:versionId'],
  ['^/contract-drafts/'+uuid+'/(edit-lease|edit-lease/heartbeat|workbench|document-body|preview-generation|submission)$','/contract-drafts/:versionId/'],
  ['^/contract-layout-template-versions/'+uuid+'/(source-positions|source-mapping|inspection|preview-generation|source-mapping-confirmation|submission|publication)$','/contract-layout-template-versions/:versionId/'],
  ['^/contracts/'+uuid+'/(approval|approval-withdrawal|seal-confirmation|signed-archive)$','/contracts/:versionId/'],
  ['^/contracts/'+uuid+'/archive-requests/'+uuid+'$','/contracts/:versionId/archive-requests/:requestId'],
  ['^/files/'+uuid+'/download-ticket$','/files/:fileId/download-ticket'],
  ['^/files/'+uuid+'/download\\?[^#\\r\\n]*$','/files/:fileId/download']
 ];
 for(const [pattern,template]of patterns){const match=new RegExp(pattern,'u').exec(path);if(match)return template+(match[1]??'');}
 return 'UNKNOWN';
};
function assertHttp(bridge,authOnly){need(bridge&&!types.isProxy(bridge)&&issued.has(bridge));const entry=issued.get(bridge);need(entry.authOnly===authOnly);entry.check();}
function assertCurrent261LocalLifecycleHttp(bridge){need(arguments.length===1);assertHttp(bridge,false);}
function assertCurrent261FirstLoginHttp(bridge){need(arguments.length===1);assertHttp(bridge,true);}
const cap=512*1024,uploadCap=8*1024*1024,docxCap=25*1024*1024,pdfCap=100000000;
const docxMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdfMime='application/pdf';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=()=>Object.assign(Error('CURRENT261_LOCAL_LIFECYCLE_HTTP'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'});
const need=ok=>{if(!ok)throw error();};
const own=(v,k)=>v&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
const authKinds=new Set(['ERROR','TYPE_ERROR','RANGE_ERROR','KNOWN_REQUEST_ERROR','UNKNOWN_REQUEST_ERROR','VALIDATION_ERROR','INITIALIZATION_ERROR','OTHER_NATIVE_ERROR','NON_NATIVE_THROWN','UNINSPECTED']);
const authCodes=new Set(['P1000','P1001','P1002','P1003','P1008','P1010','P1011','P1017','P2000','P2002','P2003','P2004','P2010','P2011','P2021','P2022','P2024','P2025','P2028','P2034']);
const authStates=new Set(['23502','23503','23505','42501','25006','25P02','40001','40P01','42P01','42703','57014']);
function closedCon18LoopDelay(value){
 const status=own(value,'status'),maxBucket=own(value,'maxBucket'),samples=own(value,'samples');
 if(status==='UNSAMPLED'||status==='UNAVAILABLE')return Object.freeze({status});
 if(status==='OBSERVED'&&['UNDER_100_MS','100_TO_499_MS','500_TO_999_MS','1000_TO_4999_MS','5000_MS_OR_MORE'].includes(maxBucket)&&Number.isSafeInteger(samples)&&samples>0&&samples<=1000000)return Object.freeze({status,maxBucket,samples});
 return Object.freeze({status:'UNAVAILABLE'});
}
function closedAuthTransactionPhase(value){
 const operation=own(value,'operation'),phase=own(value,'phase'),upsertOrdinal=own(value,'upsertOrdinal'),callbackEntered=own(value,'callbackEntered'),callbackReturned=own(value,'callbackReturned'),elapsedMs=own(value,'elapsedMs'),phaseElapsedMs=own(value,'phaseElapsedMs');
 if(operation!=='ACCOUNT_RATE_LIMIT'||![0,1,2].includes(upsertOrdinal)||typeof callbackEntered!=='boolean'||typeof callbackReturned!=='boolean'||
  !Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>3600000||!Number.isSafeInteger(phaseElapsedMs)||phaseElapsedMs<0||phaseElapsedMs>elapsedMs)return;
 const valid=phase==='PRE_CALLBACK_UNRESOLVED'?!callbackEntered&&!callbackReturned&&upsertOrdinal===0:
  phase==='POST_CALLBACK_UNRESOLVED'?callbackEntered&&callbackReturned:
  ['DELETE_PENDING','DELETE_RETURNED'].includes(phase)?callbackEntered&&!callbackReturned&&upsertOrdinal===0:
  ['UPSERT_1_PENDING','UPSERT_1_RETURNED'].includes(phase)?callbackEntered&&!callbackReturned&&upsertOrdinal===1:
  ['UPSERT_2_PENDING','UPSERT_2_RETURNED'].includes(phase)?callbackEntered&&!callbackReturned&&upsertOrdinal===2:false;
 if(valid)return Object.freeze({operation,phase,upsertOrdinal,callbackEntered,callbackReturned,elapsedMs,phaseElapsedMs});
}
function closedWorkbenchTransactionPhase(value){
 const phase=own(value,'phase'),elapsedMs=own(value,'elapsedMs'),phaseElapsedMs=own(value,'phaseElapsedMs');
 if(['BEGIN','VERSION_READ','LAYOUT_READ','TEMPLATE_READ','BILLS_READ','CALLBACK_RETURNED'].includes(phase)&&
  Number.isSafeInteger(elapsedMs)&&elapsedMs>=0&&elapsedMs<=3600000&&Number.isSafeInteger(phaseElapsedMs)&&phaseElapsedMs>=0&&phaseElapsedMs<=elapsedMs){
  return Object.freeze({phase,elapsedMs,phaseElapsedMs});
 }
}
function closedAuthDetail(value){
 const kind=own(value,'serverErrorKind'),code=own(value,'serverPrismaCode'),sql=own(value,'serverSqlState'),boundary=own(value,'serverAuthBoundary');
 if(!authKinds.has(kind))return {};
 const transactionPhase=closedAuthTransactionPhase(own(value,'serverAuthTransactionPhase')),workbenchPhase=closedWorkbenchTransactionPhase(own(value,'serverWorkbenchTransactionPhase'));
 return {serverErrorKind:kind,...(workbenchPhase?{serverWorkbenchTransactionPhase:workbenchPhase}:{}),...(transactionPhase?{serverAuthTransactionPhase:transactionPhase}:{}),...(['PRE_CONTROLLER_MARKER','CONTROLLER_MARKER_REACHED'].includes(boundary)?{serverAuthBoundary:boundary}:{}),...(['KNOWN_REQUEST_ERROR','INITIALIZATION_ERROR'].includes(kind)&&authCodes.has(code)?{serverPrismaCode:code}:{}),
  ...(kind==='KNOWN_REQUEST_ERROR'&&authStates.has(sql)?{serverSqlState:sql}:{})};
}
const relayCodes=new Set(['ABORTED','CONFIG','LIMIT','CHILD','STREAM','FRAME','HALF_CLOSE_TIMEOUT','DEPLOY_DRAIN_TIMEOUT','DEPLOY_DRAIN_ACTIVE','LISTEN','CLOSED','CLEANUP'].map(part=>'CURRENT259_LOOPBACK_FORWARD_'+part));
const relayFrameStages=new Set(['DATA_AFTER_FIN','OVERSIZED_LENGTH','TRAILING_AFTER_FIN','STDOUT_EOF_WITHOUT_FIN']);
const relayCloseFields=['hostFin','stdinEnded','pgFin','stdoutEnded','cliClosed','stdoutRawEnd','receiveSettled','cliExited','peerSocketDestroyed','peerEndReturned'];
// Snapshot only the error thrown by this HTTP postcheck, before later unwind.
// These fixed observations neither replace that error nor confer run authority.
function projectPostCheckFailure(cause){
 if(!cause||typeof cause!=='object'||types.isProxy(cause)||!types.isNativeError(cause)||own(cause,'code')!=='TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED')return undefined;
 const relayCode=own(cause,'relayCode');if(!relayCodes.has(relayCode))return undefined;
 const result={resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode};
 if(relayCode==='CURRENT259_LOOPBACK_FORWARD_FRAME'){
  const stage=own(cause,'relayFrameStage');
  if(relayFrameStages.has(stage))result.relayFrameStage=stage;
  if(stage==='STDOUT_EOF_WITHOUT_FIN'){
   const exit=own(cause,'relayChildExitCode');
   if(Number.isInteger(exit)&&(exit===0||exit>=41&&exit<=48)){
    result.relayChildExitCode=exit;
    const sysread=own(cause,'relaySysreadExit');
    if(exit===47&&decodeRelaySysreadExit(sysread))result.relaySysreadExit=sysread;
   }
  }
 }
 if(['CURRENT259_LOOPBACK_FORWARD_FRAME','CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT','CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'].includes(relayCode)){
  const state=own(cause,'relayCloseState'),snapshot=Object.fromEntries(relayCloseFields.map(key=>[key,own(state,key)]));
  if(Object.values(snapshot).every(value=>typeof value==='boolean'))result.relayCloseState=Object.freeze(snapshot);
 }
 return Object.freeze(result);
}
function inspectionSummary(value){
 const unknown=()=>Object.freeze({status:'UNKNOWN'});
 if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value))return unknown();
 const revision=own(value,'sourceRevision'),loop=own(value,'hasBillLoop'),errors=own(value,'blockingErrors');
 if(!Number.isSafeInteger(revision)||revision<0||revision>1000000||typeof loop!=='boolean'||types.isProxy(errors)||!Array.isArray(errors))return unknown();
 const size=Object.getOwnPropertyDescriptor(errors,'length');
 if(!size||!Object.hasOwn(size,'value')||!Number.isInteger(size.value)||size.value<0||size.value>1000)return unknown();
 const descriptors=Object.getOwnPropertyDescriptors(errors);
 if(Reflect.ownKeys(descriptors).length!==size.value+1)return unknown();
 for(let i=0;i<size.value;i++)if(!descriptors[i]||!Object.hasOwn(descriptors[i],'value'))return unknown();
 return Object.freeze({status:'OBSERVED',sourceRevision:revision,hasBillLoop:loop,blockingErrorCount:size.value});
}
function previewSummary(value,coordinates){
 const unknown=()=>Object.freeze({status:'UNKNOWN'});
 if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||!coordinates||typeof coordinates!=='object'||types.isProxy(coordinates))return unknown();
 const expected={};for(const key of ['id','layoutTemplateVersionId','createdByUserId','sourceFileId','templateId']){const v=own(coordinates,key);if(!id(v))return unknown();expected[key]=v;}
 const revision=own(coordinates,'sourceRevision');if(!Number.isSafeInteger(revision)||revision<0||revision>1000000)return unknown();
 const observed={};for(const key of ['id','layoutTemplateVersionId','createdByUserId']){const v=own(value,key);if(typeof v!=='string'||v.length>64)return unknown();observed[key]=v;}
 const sourceRevision=own(value,'sourceRevision'),jobStatus=own(value,'status'),file=own(value,'previewPdfFileId'),error=own(value,'errorMessage'),started=own(value,'startedAt'),completed=own(value,'completedAt');
 if(!Number.isSafeInteger(sourceRevision)||sourceRevision<0||sourceRevision>1000000||!['queued','processing','succeeded','failed','stale'].includes(jobStatus)||!(file===null||typeof file==='string'&&file.length<=64)||!(error===null||typeof error==='string'&&error.length<=4096)||![started,completed].every(v=>v===null||typeof v==='string'&&v.length<=64))return unknown();
 const sameJob=observed.id===expected.id,sameLayout=observed.layoutTemplateVersionId===expected.layoutTemplateVersionId,sameRevision=sourceRevision===revision,sameCreator=observed.createdByUserId===expected.createdByUserId;
 const previewFileIdValid=id(file)&&![expected.id,expected.layoutTemplateVersionId,expected.sourceFileId,expected.templateId].includes(file),errorMessageNull=error===null;
 const start=typeof started==='string'?Date.parse(started):NaN,end=typeof completed==='string'?Date.parse(completed):NaN,startedAtValid=Number.isFinite(start),completedAfterStarted=startedAtValid&&Number.isFinite(end)&&end>=start;
 const consumerBranch=!(sameJob&&sameLayout&&sameRevision&&sameCreator)?'COORDINATES_MISMATCH':jobStatus==='succeeded'?(previewFileIdValid&&errorMessageNull&&startedAtValid&&completedAfterStarted?'VALID_SUCCESS':'INVALID_SUCCESS'):jobStatus==='failed'?'FAILED':jobStatus==='stale'?'STALE':file===null?'VALID_PENDING':'INVALID_PENDING';
 return Object.freeze({status:'OBSERVED',jobStatus,consumerBranch,sameJob,sameLayout,sameRevision,sameCreator,previewFileIdValid,errorMessageNull,startedAtValid,completedAfterStarted});
}
// Counts from the returned JSON only; no document identifiers, text or DB-cause inference.
function documentSummary(value){
 const unknown=()=>Object.freeze({status:'UNKNOWN'}),documents=own(value,'documents');
 if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||types.isProxy(documents)||!Array.isArray(documents))return unknown();
 const length=Object.getOwnPropertyDescriptor(documents,'length')?.value;
 if(!Number.isInteger(length)||length<0||length>100)return unknown();
 const descriptors=Object.getOwnPropertyDescriptors(documents);
 if(Reflect.ownKeys(descriptors).length!==length+1)return unknown();
 const states={queued:0,processing:0,success:0,failed:0,stale:0,cancelled:0};
 for(let index=0;index<length;index++){
  const descriptor=descriptors[index];if(!descriptor||!Object.hasOwn(descriptor,'value'))return unknown();
  const document=descriptor.value,state=own(document,'status');
  if(!document||typeof document!=='object'||types.isProxy(document)||Array.isArray(document)||typeof state!=='string'||!Object.hasOwn(states,state))return unknown();
  states[state]++;
 }
 return Object.freeze({status:'OBSERVED',documentCount:length,states:Object.freeze(states)});
}
const consumeCodes=Object.freeze({
 GENERATED_DOCUMENT_CONSUMER:Object.freeze(['INPUT','LEASE','QUEUE','WORKBENCH','DOCUMENT','TEMPLATE','TIME'].map(stage=>'TASK12_GENERATED_DOCUMENT_'+stage)),
 LOCAL_LIFECYCLE_CONSUMER:Object.freeze(['TASK12_LOCAL_LIFECYCLE_CASE_HTTP']),
 TEMPLATE_CONSUMER:Object.freeze(['INPUT','UPLOAD','CREATE','POSITIONS','MAPPING','INSPECTION','TIME','QUEUE','PREVIEW','CONFIRM','SUBMIT','PUBLISH'].map(stage=>'TASK12_GENERATED_MATERIAL_TEMPLATE_'+stage)),
 OFFICIAL_DEADLINE:Object.freeze(['TASK12_OFFICIAL_DOCUMENT_DEADLINE']),
 NATIVE_DEADLINE:Object.freeze(['NATIVE_DIRECT_DEADLINE','TASK12_LOCAL_LIFECYCLE_CASE_ABORTED']),
 INTEGRITY:Object.freeze(['CURRENT261_NATIVE_PROVIDER_LOOKUP','CURRENT261_LOCAL_LIFECYCLE_HTTP','CURRENT259_LOADER_CHANGED','CURRENT259_BUILD_CHANGED','NATIVE_DIRECT_SOURCE_CHANGED','NATIVE_DIRECT_OFFICIAL_RUNTIME','NATIVE_DIRECT_HBA_CHANGED','NATIVE_DIRECT_CERT_CONTEXT'])
});
function consumeFirstCause(cause){
 if(cause&&typeof cause==='object'&&!types.isProxy(cause)&&types.isNativeError(cause)){
  const code=own(cause,'code');for(const [family,codes]of Object.entries(consumeCodes))if(codes.includes(code))return Object.freeze({family,code});
 }
 return Object.freeze({family:'UNKNOWN',code:'UNKNOWN'});
}
function rememberCurrent261ApplicationHttpSetupFailure(cause){
 if(!describeCurrent261LocalLifecycleHttpFailure(cause))remember(cause,{method:'UNKNOWN',routeTemplate:'UNKNOWN',phase:'APPLICATION_HTTP_SETUP',observationContext:'NO_HTTP_OBSERVATION',httpStatus:null,businessOutcome:'UNKNOWN',firstCause:consumeFirstCause(cause),timingAtConsumeFailure:Object.freeze({status:'UNKNOWN'})});
}
const secondary=(detail,cause)=>{detail.secondaryPhase='AFTER_CHECK';const code=own(cause,'code');detail.secondaryReason=['CURRENT259_LOADER_CHANGED','CURRENT261_LOCAL_LIFECYCLE_HTTP'].includes(code)?code:'UNCLASSIFIED';};
function exchange(port,method,path,headers,wire,binary,observe){
 const signal=AbortSignal.timeout(15000);
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(error());
  const outgoing=request({hostname:'127.0.0.1',port,method,path,headers:{Host:'127.0.0.1:'+port,'Accept-Encoding':'identity',connection:'close',...headers,...(wire?{'Content-Length':wire.length}:{})},agent:false,maxHeaderSize:16384,signal},reply=>{
   if(Number.isInteger(reply.statusCode)&&reply.statusCode>=100&&reply.statusCode<=599)observe(reply.statusCode);
   reply.once('error',fail);reply.once('aborted',fail);reply.once('close',()=>{if(!reply.complete)fail();});
   if(reply.socket?.remoteAddress!=='127.0.0.1'||reply.socket.remotePort!==port||reply.statusCode<200||reply.statusCode>=600||reply.statusCode>=300&&reply.statusCode<400||
    Object.hasOwn(reply.headers,'location')||Object.hasOwn(reply.headers,'content-range')||(reply.headers['content-encoding']&&reply.headers['content-encoding']!=='identity')){fail();reply.destroy();return;}
   const mime=typeof reply.headers['content-type']==='string'?reply.headers['content-type'].split(';')[0].trim().toLowerCase():'';
   if(binary&&reply.statusCode===200&&(mime!==binary.mimeType||reply.headers['content-length']!==String(binary.sizeBytes))){fail();reply.destroy();return;}
   const limit=binary&&reply.statusCode===200?binary.sizeBytes:cap,chunks=[];let bytes=0;const digest=binary&&reply.statusCode===200?createHash('sha256'):undefined;
   reply.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit){fail();reply.destroy();}else{chunks.push(chunk);digest?.update(chunk);}});
   reply.once('end',()=>{try{need(!signal.aborted&&reply.complete&&bytes<=limit);if(binary&&reply.statusCode===200){need(bytes===binary.sizeBytes);const actual=digest.digest('hex');need(!binary.sha256||actual===binary.sha256);}const value=Buffer.concat(chunks,bytes);
    resolve(Object.freeze({status:reply.statusCode,...(binary?{bytes:value,mimeType:mime}:{body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value))})}));
   }catch{fail();}});
  });outgoing.once('error',fail);outgoing.end(wire);
 });
}
async function withCurrent261LocalLifecycleHttp(config,server,verify,verifyToken,consume){need(arguments.length===5&&own(config,'executionPurpose')===undefined);return withLifecycleHttp(config,server,verify,verifyToken,consume,false);}
async function withCurrent261FirstLoginHttp(config,server,verify,verifyToken,consume){need(arguments.length===5&&own(config,'executionPurpose')==='AUTH_ONLY_DIAGNOSTIC');return withLifecycleHttp(config,server,verify,verifyToken,consume,true);}
async function withLifecycleHttp(config,server,verify,verifyToken,consume,authOnly){
 need(arguments.length===6&&typeof verify==='function'&&typeof verifyToken==='function'&&typeof consume==='function');
 const application=require('./task12-current259-document-application.cjs');
 const authDiagnostics=(authOnly?application.takeCurrent261FirstLoginHttpBridge:application.takeCurrent261LocalLifecycleHttpBridge)(config,server);
 need(authDiagnostics&&!types.isProxy(authDiagnostics)&&Object.isFrozen(authDiagnostics));
 const armAuth=own(authDiagnostics,'arm'),takeAuth=own(authDiagnostics,'take');need(typeof armAuth==='function'&&typeof takeAuth==='function');
 const {fixture,passwords,sourceDocx,originals}=config,seed=fixture.approval;
 let selected;try{selected=require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCaseFromFixture(fixture);}catch{need(false);}
 need(seed.users.length===8&&new Set(seed.users.map(u=>u.id)).size===8&&id(seed.project.id)&&seed.handler===seed.users[0]&&
  seed.users.every(u=>id(u.id)&&typeof u.phone==='string'&&typeof passwords[u.id]==='string'&&/^[a-f0-9]{64}$/u.test(passwords[u.id]))&&new Set(Object.values(passwords)).size===8&&
  sourceDocx instanceof Uint8Array&&Array.isArray(originals)&&originals.length===2&&originals.every(b=>b instanceof Uint8Array));
 const address=server.address,port=address.call(server)?.port;
 let available=true,failed=false,requests=0,upload=0,contractId,versionId,layoutId,lease,lastObservation,parallelObserved=false,draftPreviewQueued=false,layoutPreviewContext,previewCoordinates,inspectedRevision;
 const tokens=new Map(),active=new Map(),files=new Map(),tickets=new Map(),signatures=new Set();
 // Inclusive observational timings only. They neither gate nor extend work.
 const began=diagnosticNow(),timing={guardCalls:0,guardElapsedMs:0,exchangeCalls:0,exchangeElapsedMs:0};
 const snapshotTiming=()=>{
  const value={guardCalls:timing.guardCalls,exchangeCalls:timing.exchangeCalls,guardElapsedMs:Math.floor(timing.guardElapsedMs),exchangeElapsedMs:Math.floor(timing.exchangeElapsedMs),consumerElapsedMs:Math.floor(diagnosticNow()-began)};
  return Object.freeze(Object.values(value).every(n=>Number.isSafeInteger(n)&&n>=0)&&value.guardCalls<=1000000&&value.exchangeCalls<=600&&['guardElapsedMs','exchangeElapsedMs','consumerElapsedMs'].every(k=>value[k]<=3600000)?{status:'OBSERVED',...value}:{status:'UNKNOWN'});
 };
 const continuity=()=>{const started=diagnosticNow();timing.guardCalls++;try{verify();const a=address.call(server);need(available&&server.address===address&&server.listening===true&&a?.address==='127.0.0.1'&&a.family==='IPv4'&&Number.isInteger(port)&&port>1024&&port<=65535&&a.port===port);}finally{timing.guardElapsedMs+=diagnosticNow()-started;}};
 const check=()=>{continuity();need(!failed);};
 const actorCheck=actor=>{check();need(Number.isInteger(actor)&&actor>=0&&actor<8);};
 const wire=async(method,path,headers,body,binary=false,authPhone)=>{
  const observation={method,routeTemplate:routeTemplate(path),phase:'BEFORE_CHECK',httpStatus:null,businessOutcome:'UNKNOWN'};
  lastObservation=undefined;let ticket;
  const collectAuth=()=>{if(ticket===undefined)return;const current=ticket;ticket=undefined;try{const detail=closedAuthDetail(takeAuth.call(authDiagnostics,current));if(['/contract-drafts/:versionId/edit-lease/heartbeat','/contract-drafts/:versionId/workbench','/contract-drafts/:versionId/preview-generation'].includes(observation.routeTemplate)){const {serverAuthBoundary,serverAuthTransactionPhase,serverWorkbenchTransactionPhase,...finite}=detail;const boundaryKey=observation.routeTemplate.endsWith('/workbench')?'serverWorkbenchBoundary':observation.routeTemplate.endsWith('/preview-generation')?'serverQueueBoundary':'serverLeaseBoundary';Object.assign(observation,finite,...(boundaryKey==='serverWorkbenchBoundary'&&serverWorkbenchTransactionPhase?[{serverWorkbenchTransactionPhase}]:[]),...(serverAuthBoundary?[{[boundaryKey]:serverAuthBoundary}]:[]));}else Object.assign(observation,detail);}catch{/* Preserve the original HTTP failure and UNKNOWN. */}};
  try{
   check();need(++requests<=600);
   if(authPhone!==undefined){need(method==='POST'&&path==='/auth/login'||require.main&&require.main.filename===require('node:path').join(__dirname,'run-task12-native-con18-once.cjs')&&(method==='POST'&&['/contract-drafts/:versionId/edit-lease/heartbeat','/contract-drafts/:versionId/preview-generation'].includes(routeTemplate(path))||method==='GET'&&routeTemplate(path)==='/contract-drafts/:versionId/workbench'));try{ticket=armAuth.call(authDiagnostics,authPhone);}catch{/* Diagnostics confer no request authority and cannot replace its response. */}}
   observation.phase='EXCHANGE';
   const exchangeStarted=diagnosticNow();timing.exchangeCalls++;let result,finishLoopDelay;
   if(require.main&&require.main.filename===require('node:path').join(__dirname,'run-task12-native-con18-once.cjs')&&draftPreviewQueued&&method==='GET'&&observation.routeTemplate==='/contract-drafts/:versionId/workbench'){
    try{finishLoopDelay=require('./task12-con18-loop-delay.cjs').beginCon18LoopDelay();}catch{/* Observation cannot affect the request. */}
   }
   try{result=await exchange(port,method,path,headers,body,binary,status=>{observation.httpStatus=status;});}finally{
    timing.exchangeElapsedMs+=diagnosticNow()-exchangeStarted;
    if(finishLoopDelay)try{observation.eventLoopDelay=closedCon18LoopDelay(finishLoopDelay());}catch{/* Preserve the exchange result. */}
   }
   if(method==='POST'&&observation.routeTemplate==='/contract-layout-template-versions/:versionId/inspection'&&result.status===201){
    observation.inspectionSummary=inspectionSummary(result.body);inspectedRevision=observation.inspectionSummary.status==='OBSERVED'?observation.inspectionSummary.sourceRevision:undefined;
   }
   if(observation.routeTemplate==='/contract-layout-template-versions/:versionId/preview-generation'){
    if(method==='POST'){
     previewCoordinates=undefined;
     const job=own(result.body,'id');if(result.status===201&&id(job)&&layoutPreviewContext&&Number.isSafeInteger(inspectedRevision))previewCoordinates=Object.freeze({...layoutPreviewContext,id:job,layoutTemplateVersionId:layoutId,sourceRevision:inspectedRevision,createdByUserId:seed.users[2].id});
    }else if(method==='GET'&&result.status===200)observation.previewSummary=previewSummary(result.body,previewCoordinates);
   }
   if(method==='GET'&&observation.routeTemplate==='/contract-drafts/:versionId/workbench'&&result.status===200)observation.documentSummary=documentSummary(result.body);
   collectAuth(); // Retain the native cause before a later resource guard can fail.
   observation.phase='AFTER_CHECK';check();lastObservation=Object.freeze({...observation,phase:'CONSUME',timingAtResponse:snapshotTiming()});return result;
  }catch(cause){
   collectAuth();
   if(observation.phase==='EXCHANGE')try{continuity();}catch(later){secondary(observation,later);}
   if(observation.phase==='AFTER_CHECK'){const detail=projectPostCheckFailure(cause);if(detail)observation.postCheckFailure=detail;}
   remember(cause,observation);throw cause;
  }finally{collectAuth();}
 };
 const registerFile=(fileId,mimeType,expected)=>{need(id(fileId));const prior=files.get(fileId);if(prior){need(prior.mimeType===mimeType&&(!expected||prior.sizeBytes===expected.sizeBytes&&prior.sha256===expected.sha256));}else files.set(fileId,{mimeType,...expected});};
 const roleKeys=actor=>[...seed.members.filter(r=>r.userId===seed.users[actor].id).map(r=>r.positionKey),...seed.globalRoles.filter(r=>r.userId===seed.users[actor].id).map(r=>r.roleKey)].sort();
 const globalKeys=actor=>seed.globalRoles.filter(r=>r.userId===seed.users[actor].id).map(r=>r.roleKey).sort();
 const route=(actor,method,path)=>{
  if(authOnly)return actor===0&&method==='POST'&&path==='/auth/login'&&requests===0;
  need(typeof path==='string'&&path.length<=4096&&path.startsWith('/')&&!path.startsWith('//')&&!/[\r\n#\\]/u.test(path));
  if(path==='/auth/login')return method==='POST'&&!tokens.has(actor);
  need(tokens.has(actor));
  if(path==='/me/signature/canvas')return method==='POST'&&actor>=1&&actor<=5&&!signatures.has(actor);
  if(path==='/files')return method==='POST'&&(upload===0?actor===2:actor===0)&&upload<3;
  if(path==='/contract-layout-templates')return actor===2&&method==='POST'&&!layoutId;
  if(layoutId&&path.startsWith('/contract-layout-template-versions/'+layoutId+'/')){
   const action=path.slice(('/contract-layout-template-versions/'+layoutId+'/').length);
   return actor===2&&({ 'source-positions':['GET'],'source-mapping':['PATCH'],inspection:['POST'],'preview-generation':['GET','POST'],
    'source-mapping-confirmation':['POST'],submission:['POST'],publication:['POST']})[action]?.includes(method);
  }
  if(path==='/contracts')return actor===0&&method==='POST'&&!contractId;
  if(contractId&&path==='/contracts/workbench?view=pending_action&page=1&pageSize=100')return method==='GET'&&(actor===0||actor===6||require.main&&require.main.filename===require('node:path').join(__dirname,'run-task12-native-con18-once.cjs')&&actor>=1&&actor<=5);
  if(contractId&&path==='/contracts/'+contractId+'?versionId='+versionId)return method==='GET';
  if(versionId&&path==='/contract-drafts/'+versionId)return actor===0&&method==='PUT';
  if(versionId&&path.startsWith('/contract-drafts/'+versionId+'/')){
   const action=path.slice(('/contract-drafts/'+versionId+'/').length);
   return ({'edit-lease':['POST'],'edit-lease/heartbeat':['POST'],workbench:['GET'],'document-body':['GET'],'preview-generation':['POST'],submission:['POST']})[action]?.includes(method)&&
    (actor===0||actor===7&&action==='submission');
  }
  if(versionId&&path.startsWith('/contracts/'+versionId+'/')){
   const action=path.slice(('/contracts/'+versionId+'/').length);
   return ['approval','approval-withdrawal','seal-confirmation','signed-archive'].includes(action)&&method==='POST'||method==='GET'&&/^archive-requests\/[a-f0-9-]{36}$/u.test(action);
  }
  const ticket=path.match(/^\/files\/([a-f0-9-]{36})\/download-ticket$/u);
  return !!ticket&&files.has(ticket[1])&&method==='POST'&&(actor===0||actor===7);
 };
 async function send(actor,message){
  lastObservation=undefined;
  actorCheck(actor);need(message&&typeof message==='object'&&!types.isProxy(message));
  const descriptors=Object.getOwnPropertyDescriptors(message);need(Reflect.ownKeys(descriptors).every(k=>['method','path','json','form','headers'].includes(k)&&Object.hasOwn(descriptors[k],'value')));
  const {method,path,json,form,headers}=message;need(['GET','POST','PUT','PATCH'].includes(method)&&route(actor,method,path)&&!(json!==undefined&&form!==undefined));
  const parallel=method==='POST'&&path==='/contracts/'+versionId+'/approval'&&actor>=1&&actor<=5;
  if(active.size===0)parallelObserved=parallel;
  need(!active.has(actor)&&(active.size===0||parallel&&[...active.values()].every(x=>x.parallel)&&active.size<5));
  const h={'content-type':'application/json','x-contract-numeric-protocol':'2',...(tokens.has(actor)?{authorization:'Bearer '+tokens.get(actor)}:{})};
  if(headers!==undefined){need(headers&&typeof headers==='object'&&!types.isProxy(headers));for(const [k,d]of Object.entries(Object.getOwnPropertyDescriptors(headers))){need(Object.hasOwn(d,'value')&&(k==='x-contract-numeric-protocol'&&d.value==='2'||k==='x-contract-draft-lease'&&typeof lease==='string'&&d.value===lease));h[k]=d.value;}}
  let body,uploaded;
  if(path==='/files'||path==='/me/signature/canvas')need(form!==undefined);
  if(form!==undefined){
   need((path==='/files'||path==='/me/signature/canvas')&&form instanceof FormData&&equal([...form.keys()],['file']));const file=form.get('file');
   const signature=path==='/me/signature/canvas';
   const expected=signature?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=','base64'):upload===0?sourceDocx:originals[upload-1];
   const mime=signature?'image/png':upload===0?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf';
   const name=signature?'signature.png':upload===0?(selected.contractTypeKey==='equipment_rental'?'equipment-rental-real-v1.docx':'material-purchase-real-v1.docx'):'signed-original-'+upload+'.pdf';
   need(file&&file.name===name&&file.type===mime&&file.size===expected.byteLength);
   const bytes=Buffer.from(await file.arrayBuffer());check();need(equal(bytes,Buffer.from(expected)));uploaded={sizeBytes:bytes.length,sha256:sha(bytes),mimeType:mime};
   const boundary='jg-life-'+randomBytes(24).toString('hex');body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: '+mime+'\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
   need(body.length<=uploadCap);h['content-type']='multipart/form-data; boundary='+boundary;if(signature)signatures.add(actor);else upload++;
  }else if(json!==undefined){body=Buffer.from(JSON.stringify(json));need(body.length<=cap);}
  if(path==='/auth/login')need(equal(json,{phone:seed.users[actor].phone,password:passwords[seed.users[actor].id]}));
  if(path==='/contracts')need(equal(json,{projectId:seed.project.id,numericProtocolVersion:2,contractTypeKey:selected.contractTypeKey,relationship:selected.relationship,amountLimitType:'capped'}));
  let drained;const pending={parallel,done:new Promise(resolve=>{drained=resolve;})};active.set(actor,pending);
  try{
   let diagnosticIdentity=path==='/auth/login'?seed.users[actor].phone:undefined;
   if(require.main&&require.main.filename===require('node:path').join(__dirname,'run-task12-native-con18-once.cjs')&&actor===0&&(method==='POST'&&['/contract-drafts/:versionId/edit-lease/heartbeat','/contract-drafts/:versionId/preview-generation'].includes(routeTemplate(path))||method==='GET'&&draftPreviewQueued&&routeTemplate(path)==='/contract-drafts/:versionId/workbench')){try{const nonce=randomBytes(16).toString('hex');h['x-task12-diagnostic']=nonce;diagnosticIdentity=versionId+':'+nonce+(method==='GET'?':workbench':routeTemplate(path)==='/contract-drafts/:versionId/preview-generation'?':queue':'');}catch{/* An unavailable diagnostic must not prevent the request. */}}
   const result=await wire(method,path,h,body,false,diagnosticIdentity),value=result.body;
   if(path==='/auth/login'){
    const user=own(value,'user'),token=own(own(value,'tokens'),'accessToken');
    need(result.status===201&&own(user,'id')===seed.users[actor].id&&own(user,'phone')===seed.users[actor].phone&&own(user,'mustChangePassword')===false&&
     equal(own(user,'roleKeys'),roleKeys(actor))&&equal(own(user,'globalRoleKeys'),globalKeys(actor))&&typeof token==='string'&&token.length<=4096&&/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token));
    const claims=verifyToken(token);need(own(claims,'sub')===seed.users[actor].id&&own(claims,'phone')===seed.users[actor].phone&&own(claims,'type')==='access'&&own(claims,'ver')===0);tokens.set(actor,token);
   }else if(path==='/contract-drafts/'+versionId+'/preview-generation'&&method==='POST'&&result.status===201){draftPreviewQueued=true;}
   else if(path==='/contracts'&&result.status===201){contractId=own(own(value,'contract'),'id');versionId=own(own(value,'version'),'id');need(id(contractId)&&id(versionId)&&contractId!==versionId);}
   else if(path==='/contract-layout-templates'&&result.status===201){
    layoutId=own(own(value,'version'),'id');need(id(layoutId));
    const sourceFileId=own(json,'docxFileId'),templateId=own(own(value,'template'),'id');
    layoutPreviewContext=id(sourceFileId)&&id(templateId)?Object.freeze({sourceFileId,templateId}):undefined;previewCoordinates=undefined;inspectedRevision=undefined;
   }
   else if(path==='/files'&&result.status===201){const fileId=own(value,'id');need(id(fileId)&&!files.has(fileId));registerFile(fileId,uploaded.mimeType,uploaded);}
   else if(path==='/contract-drafts/'+versionId+'/edit-lease'&&result.status===201){lease=own(value,'token');need(typeof lease==='string'&&/^[\w-]{43}$/u.test(lease));}
   else if(path==='/contract-drafts/'+versionId+'/workbench'&&result.status===200){const documents=own(value,'documents');need(Array.isArray(documents)&&documents.length<=4);for(const doc of documents)for(const key of ['docxFileId','pdfFileId'])if(id(own(doc,key)))registerFile(own(doc,key),key==='docxFileId'?docxMime:pdfMime);}
   else if(path.endsWith('/download-ticket')&&result.status===201){const target=path.slice('/files/'.length,-'/download-ticket'.length),url=own(value,'downloadUrl');need(typeof url==='string'&&url.startsWith('/files/'+target+'/download?')&&url.length<=4096&&!/[\r\n#\\]/u.test(url));const known=files.get(target),mimeType=own(value,'mimeType'),sizeBytes=own(value,'sizeBytes');
    need(mimeType===known.mimeType&&Number.isSafeInteger(sizeBytes)&&sizeBytes>0&&sizeBytes<=(mimeType===pdfMime?pdfCap:docxCap)&&(!known.sizeBytes||known.sizeBytes===sizeBytes));
    tickets.set(url,Object.freeze({fileId:target,mimeType,sizeBytes,...(known.sha256?{sha256:known.sha256}:{})}));}
   return result;
  }catch(cause){if(lastObservation&&!parallelObserved)remember(cause,lastObservation);failed=true;throw cause;}finally{active.delete(actor);drained();}
 }
 const bridge=Object.freeze({check,send,now(){check();return Date.now();},async wait(ms){check();need(ms===1000);await delay(ms);check();},async download(actor,path){
  lastObservation=undefined;
  actorCheck(actor);need(actor===0&&typeof path==='string'&&active.size===0);
  let ticket=tickets.get(path);if(!ticket)for(const [url,entry]of tickets){const candidate=new URL(url,'http://127.0.0.1:'+port);candidate.searchParams.set('expiresAt','2000-01-01T00:00:00.000Z');if(candidate.pathname+candidate.search===path){ticket=entry;break;}}need(ticket);
  let drained;const pending={parallel:false,done:new Promise(resolve=>{drained=resolve;})};active.set('download',pending);
  try{return await wire('GET',path,{},undefined,ticket);}catch(cause){failed=true;throw cause;}finally{active.delete('download');drained();}
 }});
 issued.set(bridge,{check,authOnly});
 try{const result=await consume(bridge);check();need(active.size===0&&(!authOnly||requests===1&&tokens.has(0)));return result;}
 catch(cause){
  if(lastObservation&&!parallelObserved&&!describeCurrent261LocalLifecycleHttpFailure(cause)){
   const detail={...lastObservation,firstCause:consumeFirstCause(cause),timingAtConsumeFailure:snapshotTiming()};try{continuity();}catch(later){secondary(detail,later);}detail.timingAfterSecondary=snapshotTiming();remember(cause,detail);
  }else if(!describeCurrent261LocalLifecycleHttpFailure(cause)){
   remember(cause,{method:'UNKNOWN',routeTemplate:'UNKNOWN',phase:'CONSUME',observationContext:lastObservation&&parallelObserved?'PARALLEL_RESPONSE_CONTEXT':'NO_HTTP_OBSERVATION',httpStatus:null,businessOutcome:'UNKNOWN',firstCause:consumeFirstCause(cause),timingAtConsumeFailure:snapshotTiming()});
  }
  throw cause;
 }
 finally{available=false;issued.delete(bridge);await Promise.allSettled([...active.values()].map(item=>item.done));tokens.clear();tickets.clear();}
}
module.exports=Object.freeze({withCurrent261LocalLifecycleHttp,assertCurrent261LocalLifecycleHttp,withCurrent261FirstLoginHttp,assertCurrent261FirstLoginHttp,describeCurrent261LocalLifecycleHttpFailure,rememberCurrent261ApplicationHttpSetupFailure});
