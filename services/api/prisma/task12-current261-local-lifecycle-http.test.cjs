'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
function model(mode,postcheckError,transactionPhase,caseKey,mainConfig,inspectionBody,clock,previewBody,workbenchBody,loopOverride){
 const users=Array.from({length:8},(_,i)=>({id:id(i+1),phone:'1990000000'+i})),passwords=Object.fromEntries(users.map((u,i)=>[u.id,String(i).repeat(64)]));
 const fixture={...(caseKey?{case:require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCase(caseKey)}:{}),approval:{users,handler:users[0],project:{id:id(20)},members:[{userId:users[0].id,positionKey:'contract_staff'},{userId:users[3].id,positionKey:'project_manager'}],globalRoles:[[1,'material_director'],[2,'contract_director'],[4,'finance_director'],[5,'general_manager'],[6,'comprehensive_director']].map(([actor,roleKey])=>({userId:users[actor].id,roleKey}))}};
 const config=mainConfig??Object.freeze({...(mode==='auth-only'?{executionPurpose:'AUTH_ONLY_DIAGNOSTIC'}:{}),fixture,passwords,sourceDocx:Buffer.from('model-docx'),originals:[Buffer.from('%PDF-original1'),Buffer.from('%PDF-original2')]}),calls=[];
 const server={listening:true,address(){return{address:'127.0.0.1',family:'IPv4',port:24080};}};let live=true,claimed=false;const checks=[],authCalls=[],authTickets=new Set();const authDiagnostics=Object.freeze({arm(phone){assert.ok(users.some(u=>u.phone===phone)||(mode==='queue-diag'&&new RegExp('^'+id(22)+':[a-f0-9]{32}:queue$','u').test(phone))||(mode==='lease-diag'&&new RegExp('^'+id(22)+':[a-f0-9]{32}$','u').test(phone))||(['workbench-diag','workbench-postcheck'].includes(mode)&&new RegExp('^'+id(22)+':[a-f0-9]{32}:workbench$','u').test(phone)));const ticket=Object.freeze({});authTickets.add(ticket);authCalls.push('arm');return ticket;},take(ticket){assert.equal(authTickets.delete(ticket),true);authCalls.push('take');if(mode==='native-take-failure-and-postcheck')throw Error('PRIVATE_DIAG_FAILURE');return ['lease-diag','workbench-diag','workbench-postcheck','queue-diag'].includes(mode)?Object.freeze({serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2028',serverAuthBoundary:'CONTROLLER_MARKER_REACHED',...(mode==='workbench-diag'?{serverWorkbenchTransactionPhase:{phase:'CALLBACK_RETURNED',elapsedMs:5031,phaseElapsedMs:5001,private:'MUST_OMIT'}}:{}),private:'MUST_OMIT'}):mode?.startsWith('native-p1017')?Object.freeze({serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P1017',serverAuthBoundary:'PRE_CONTROLLER_MARKER',...(transactionPhase?{serverAuthTransactionPhase:transactionPhase}:{}),private:'MUST_OMIT'}):mode?.startsWith('native')?Object.freeze({serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2010',serverSqlState:'42501',private:'MUST_OMIT'}):undefined;}});
 const imports={...(loopOverride?{'./task12-con18-loop-delay.cjs':loopOverride}:{}),...(clock?{'node:perf_hooks':{performance:{now:clock}}}:{}),'./task12-current259-document-application.cjs':{takeCurrent261FirstLoginHttpBridge(c,s){assert.equal(c,config);assert.equal(s,server);assert.equal(claimed,false);claimed=true;return authDiagnostics;},takeCurrent261LocalLifecycleHttpBridge(c,s){assert.equal(c,config);assert.equal(s,server);assert.equal(claimed,false);claimed=true;return authDiagnostics;}},'node:http':{request(options,consume){const outgoing=new EventEmitter();outgoing.end=wire=>{calls.push({options,wire});queueMicrotask(()=>{if(mode==='transport-and-postcheck'){live=false;outgoing.emit('error',Error('PRIVATE_TRANSPORT'));return;}const response=new EventEmitter();response.complete=true;response.socket={remoteAddress:mode==='foreign-peer'?'127.0.0.2':'127.0.0.1',remotePort:24080};response.headers=mode==='redirect'?{location:'https://invalid.example'}:{};response.statusCode=201;response.destroy=()=>{};const actor=options.path==='/auth/login'?users.findIndex(u=>u.phone===JSON.parse(wire).phone):0,roles=[...fixture.approval.members.filter(r=>r.userId===users[actor].id).map(r=>r.positionKey),...fixture.approval.globalRoles.filter(r=>r.userId===users[actor].id).map(r=>r.roleKey)];let body=options.path==='/auth/login'?{user:{id:users[actor].id,phone:users[actor].phone,mustChangePassword:false,roleKeys:roles,globalRoleKeys:fixture.approval.globalRoles.filter(r=>r.userId===users[actor].id).map(r=>r.roleKey)},tokens:{accessToken:actor?'model'+actor+'.access.token':'model.access.token'}}:{contract:{id:id(21)},version:{id:id(22)}};if(options.path.endsWith('/workbench')){body={documents:[{docxFileId:id(50),pdfFileId:id(51)}]};response.statusCode=200;}
 if(previewBody!==undefined&&options.path==='/contract-layout-templates')body={template:{id:id(21)},version:{id:id(22)}};
 if(previewBody!==undefined&&options.path.endsWith('/preview-generation')){body=options.method==='POST'?{id:id(30),layoutTemplateVersionId:id(22),sourceRevision:2,createdByUserId:id(3),status:'queued',previewPdfFileId:null}:previewBody;response.statusCode=options.method==='POST'?201:200;}
 if(workbenchBody!==undefined&&options.path.endsWith('/workbench'))body=workbenchBody;
 if(mode==='queue-diag'&&options.path.endsWith('/preview-generation')){response.statusCode=500;body={statusCode:500,message:'PRIVATE'};}
 if(mode?.startsWith('lease-')&&options.path.endsWith('/edit-lease'))body={token:'a'.repeat(43)};
 if(mode?.startsWith('lease-')&&options.path.endsWith('/edit-lease/heartbeat')){response.statusCode=500;body={statusCode:500,message:'PRIVATE'};}
 if(['workbench500','workbench-diag','workbench-other','workbench-postcheck'].includes(mode)&&options.path.endsWith('/workbench')){response.statusCode=500;body={statusCode:500,message:'Internal server error'};}
 if(options.path.endsWith('/inspection')&&inspectionBody!==undefined)body=inspectionBody;
 if(options.path.endsWith('/download-ticket'))body={downloadUrl:'/files/'+id(51)+'/download?token=model',mimeType:'application/pdf',sizeBytes:1024*1024};
 if(mode?.startsWith('native')){response.statusCode=500;body={statusCode:500,message:'Internal server error'};}
 const binary=options.path.includes('/download?');let bytes=Buffer.from(JSON.stringify(body));if(binary){bytes=Buffer.alloc(1024*1024,65);Buffer.from('%PDF-').copy(bytes);response.statusCode=200;response.headers={'content-type':mode==='wrong-mime'?'text/html':'application/pdf','content-length':String(mode==='wrong-size'?bytes.length+1:bytes.length)};}
 consume(response);response.emit('data',bytes.subarray(0,100));response.emit('data',bytes.subarray(100));response.emit('end');if(mode==='workbench-postcheck'&&options.path.endsWith('/workbench'))live=false;if(mode==='returned-and-postcheck'||mode==='native500-and-postcheck'||mode==='native-take-failure-and-postcheck'||mode==='native-p1017-postcheck')live=false;});};return outgoing;}}};
 const holder={exports:{}};const mockedRequire=name=>imports[name]??require(name);if(['lease-diag','workbench-diag','workbench-postcheck','queue-diag'].includes(mode))mockedRequire.main={filename:path.join(__dirname,'run-task12-native-con18-once.cjs')};new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task12-current261-local-lifecycle-http.cjs'),'utf8'))(mockedRequire,holder,__dirname);
 return{api:holder.exports,config,server,calls,authCalls,authTickets,checks,close(){live=false;},verify(){checks.push(live);if(!live&&postcheckError)throw postcheckError;if(!live&&mode==='transport-and-postcheck')throw Object.assign(Error('PRIVATE_GUARD'),{code:'CURRENT259_LOADER_CHANGED'});assert.equal(live,true);},verifyToken(token){const actor=Number(token.match(/^model(\d*)\./u)[1]||0);return{sub:users[actor].id,phone:users[actor].phone,type:'access',ver:0};}};
}
test('life HTTP owns login tokens, pins its loopback server and revokes escaped operations',async()=>{
 const f=model();let escaped;
 await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async bridge=>{
  escaped=bridge;assert.equal(f.api.assertCurrent261LocalLifecycleHttp(bridge),undefined);assert.throws(()=>f.api.assertCurrent261LocalLifecycleHttp({...bridge}),/LIFECYCLE_HTTP/u);await bridge.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await bridge.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  assert.equal(f.calls[1].options.headers.authorization,'Bearer model.access.token');
  assert.equal(f.calls[1].options.headers['x-contract-numeric-protocol'],'2');assert.equal(f.calls[1].options.headers.connection,'close');
 });
 assert.throws(()=>escaped.check(),/LIFECYCLE_HTTP/u);assert.throws(()=>f.api.assertCurrent261LocalLifecycleHttp(escaped),/LIFECYCLE_HTTP/u);await assert.rejects(escaped.send(0,{method:'GET',path:'/contracts'}),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,2);
});
for(const mode of ['foreign-peer','redirect'])test('life HTTP rejects '+mode+' before any business request',async()=>{
 const f=model(mode);await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,1);
});
test('life HTTP refuses caller authorization, foreign routes and unissued signed downloads without a request',async()=>{
 for(const operation of [b=>b.send(0,{method:'GET',path:'/contracts',headers:{authorization:'Bearer foreign'}}),b=>b.send(0,{method:'GET',path:'https://invalid.example'}),b=>b.download(0,'/files/'+id(50)+'/download?token=foreign')]){
  const f=model();await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,operation),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,0);
 }
});

test('life signature uploads permit exactly the five fixed actors and the unchanged native PNG bytes',async()=>{
 const f=model();await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  const actor=1,user=f.config.fixture.approval.users[actor];await b.send(actor,{method:'POST',path:'/auth/login',json:{phone:user.phone,password:f.config.passwords[user.id]}});
  const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'signature.png');
  await b.send(actor,{method:'POST',path:'/me/signature/canvas',form});
  await assert.rejects(b.send(actor,{method:'POST',path:'/me/signature/canvas',form}),/LIFECYCLE_HTTP/u);
 });assert.equal(f.calls.length,2);assert.ok(f.calls[1].options.headers['content-type'].startsWith('multipart/form-data;'));
});

async function downloadCase(f,b){
 await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
 await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
 await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});
 const ticket=await b.send(0,{method:'POST',path:'/files/'+id(51)+'/download-ticket',json:{confirmationPassword:f.config.passwords[id(1)],downloadReason:'本轮隔离验收'}});
 return b.download(0,ticket.body.downloadUrl);
}
test('binary downloads retain the original PDF budget and bind exact ticket size and real response MIME',async()=>{
 const f=model();await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{const file=await downloadCase(f,b);assert.equal(file.bytes.length,1024*1024);assert.equal(file.mimeType,'application/pdf');});
 assert.equal(f.calls.length,5);
});
for(const mode of ['wrong-mime','wrong-size'])test('binary ticket rejects '+mode+' without widening the original budget',async()=>{
 const f=model(mode);await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>downloadCase(f,b)),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,5);
});
test('the fixed total HTTP request cap stops before sending another request and cannot be swallowed as success',async()=>{
 const f=model();await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  for(let i=2;i<600;i++)await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});
  await assert.rejects(b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'}),/LIFECYCLE_HTTP/u);
 }),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,600);
});

for(const [mode,phase,httpStatus,secondaryPhase]of [
 ['transport-and-postcheck','EXCHANGE',null,'AFTER_CHECK'],
 ['returned-and-postcheck','AFTER_CHECK',201,undefined]
])test('life diagnostics preserve '+mode+' without asserting business success',async()=>{
 const f=model(mode);let first;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),cause=>{first=cause;return true;});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);
 assert.deepEqual(detail,{method:'POST',routeTemplate:'/auth/login',phase,httpStatus,businessOutcome:'UNKNOWN',...(secondaryPhase?{secondaryPhase,secondaryReason:'CURRENT259_LOADER_CHANGED'}:{})});
 assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure({code:'CURRENT261_LOCAL_LIFECYCLE_HTTP',httpStatus:201,routeTemplate:'/auth/login'}),undefined);
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|199000|password|token|10000000/u);
});

test('a consume failure keeps its identity and records only the preceding response observation',async()=>{
 const f=model(),business=Object.assign(Error('PRIVATE_BUSINESS'),{code:'CURRENT261_LOCAL_LIFECYCLE_OWNER_OUTPUT'});
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  f.close();throw business;
 }),cause=>cause===business);
 const {timingAtResponse,timingAtConsumeFailure,timingAfterSecondary,...observed}=f.api.describeCurrent261LocalLifecycleHttpFailure(business);for(const t of [timingAtResponse,timingAtConsumeFailure,timingAfterSecondary])assert.equal(t.status,'OBSERVED');
 assert.deepEqual(observed,{method:'POST',routeTemplate:'/auth/login',phase:'CONSUME',httpStatus:201,businessOutcome:'UNKNOWN',firstCause:{family:'UNKNOWN',code:'UNKNOWN'},secondaryPhase:'AFTER_CHECK',secondaryReason:'UNCLASSIFIED'});
});

test('diagnostics redact dynamic route coordinates and do not borrow a prior response after a failed precheck',async()=>{
 const f=model(),business=Error('PRIVATE_AFTER_RESPONSE');
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'GET',path:'/contracts/'+id(21)+'?versionId='+id(22)});throw business;
 }),cause=>cause===business);
 assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure(business).routeTemplate,'/contracts/:contractId?versionId=:versionId');
 assert.doesNotMatch(JSON.stringify(f.api.describeCurrent261LocalLifecycleHttpFailure(business)),/10000000|PRIVATE/u);
 const g=model();let current;
 await assert.rejects(g.api.withCurrent261LocalLifecycleHttp(g.config,g.server,g.verify,g.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:g.config.fixture.approval.users[0].phone,password:g.config.passwords[id(1)]}});
  g.close();try{await b.send(0,{method:'POST',path:'/contracts',json:{}});}catch(cause){current=cause;throw cause;}
 }));
 const missing=g.api.describeCurrent261LocalLifecycleHttpFailure(current);assert.equal(missing.observationContext,'NO_HTTP_OBSERVATION');assert.equal(missing.httpStatus,null);assert.equal(missing.routeTemplate,'UNKNOWN');
});

test('finite AUTH cause is taken before a failed AFTER_CHECK and cannot change500 or UNKNOWN',async()=>{
 const f=model('native500-and-postcheck');let first;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),cause=>{first=cause;return true;});
 assert.deepEqual(f.api.describeCurrent261LocalLifecycleHttpFailure(first),{method:'POST',routeTemplate:'/auth/login',phase:'AFTER_CHECK',httpStatus:500,businessOutcome:'UNKNOWN',serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2010',serverSqlState:'42501'});
 assert.deepEqual(f.authCalls,['arm','take']);assert.equal(f.authTickets.size,0);
});

test('failed diagnostic take cannot replace the original AFTER_CHECK error500 or UNKNOWN',async()=>{
 const f=model('native-take-failure-and-postcheck');let first;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),cause=>{first=cause;return true;});
 assert.deepEqual(f.api.describeCurrent261LocalLifecycleHttpFailure(first),{method:'POST',routeTemplate:'/auth/login',phase:'AFTER_CHECK',httpStatus:500,businessOutcome:'UNKNOWN'});
 assert.doesNotMatch(first.message,/DIAG_FAILURE/);assert.equal(f.authTickets.size,0);
});


test('modeled P1017 and original postcheck relay failure survive together without replacing the error',async()=>{
 const cause=Object.assign(Error('PRIVATE_POSTCHECK'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
 const closeState={hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:false,cliClosed:false,stdoutRawEnd:true,receiveSettled:false,cliExited:false,peerSocketDestroyed:false,peerEndReturned:false};
 for(const [key,value]of Object.entries({relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,relayCloseState:closeState}))Object.defineProperty(cause,key,{value,configurable:true});
 const f=model('native-p1017-postcheck',cause);
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),error=>error===cause);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(cause);
 assert.deepEqual(detail,{method:'POST',routeTemplate:'/auth/login',phase:'AFTER_CHECK',httpStatus:500,businessOutcome:'UNKNOWN',serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P1017',serverAuthBoundary:'PRE_CONTROLLER_MARKER',postCheckFailure:{resourceCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,relayCloseState:{hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:false,cliClosed:false,stdoutRawEnd:true,receiveSettled:false,cliExited:false,peerSocketDestroyed:false,peerEndReturned:false}}});
 assert.equal(f.calls.length,1);assert.deepEqual(f.authCalls,['arm','take']);assert.equal(f.authTickets.size,0);assert.deepEqual(f.checks,[true,true,false]);
 closeState.pgFin=true;Object.defineProperty(cause,'relayCode',{value:'CURRENT259_LOOPBACK_FORWARD_ABORTED'});
 assert.equal(detail.postCheckFailure.relayCode,'CURRENT259_LOOPBACK_FORWARD_FRAME');assert.equal(detail.postCheckFailure.relayCloseState.pgFin,false);
 assert.ok(Object.isFrozen(detail.postCheckFailure));assert.ok(Object.isFrozen(detail.postCheckFailure.relayCloseState));
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|199000|password|token|10000000/u);
});


async function modeledPostcheck(cause){
 const f=model('native-p1017-postcheck',cause);let caught;
 // assert.rejects inspects thrown proxies itself; observe only original identity.
 try{await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}}));}catch(error){caught=error;}
 assert.equal(caught,cause);return f.api.describeCurrent261LocalLifecycleHttpFailure(cause);
}
for(const mode of ['code-getter','relay-getter','unknown-resource','unknown-relay','non-native','proxy'])test('postcheck projection omits untrusted '+mode+' without evaluating it',async()=>{
 let traps=0;
 const cause=mode==='non-native'?{}:Error('PRIVATE');
 Object.defineProperty(cause,'code',mode==='code-getter'?{get(){traps++;throw Error('getter');}}:{value:mode==='unknown-resource'?'PRIVATE_CODE':'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
 Object.defineProperty(cause,'relayCode',mode==='relay-getter'?{get(){traps++;throw Error('getter');}}:{value:mode==='unknown-relay'?'CURRENT259_LOOPBACK_FORWARD_PRIVATE':'CURRENT259_LOOPBACK_FORWARD_FRAME'});
 const error=mode==='proxy'?new Proxy(cause,{get(){traps++;throw Error('proxy');},getOwnPropertyDescriptor(){traps++;throw Error('proxy');},getPrototypeOf(){traps++;throw Error('proxy');}}):cause;
 const detail=await modeledPostcheck(error);
 assert.equal(detail?.postCheckFailure,undefined);assert.equal(traps,0);
 if(mode!=='proxy'){assert.equal(detail.httpStatus,500);assert.equal(detail.serverPrismaCode,'P1017');assert.equal(detail.businessOutcome,'UNKNOWN');}
});
for(const mode of ['frame-getter','state-getter','state-proxy','state-field-getter','partial-state','nonboolean-state','unknown-exit','unknown-sysread','wrong-exit-sysread','wrong-frame-sysread'])test('postcheck projection retains only complete fixed relay fields for '+mode,async()=>{
 let traps=0;
 const cause=Object.assign(Error('PRIVATE'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME'});
 const state={hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:false,cliClosed:false,stdoutRawEnd:true,receiveSettled:false,cliExited:false,peerSocketDestroyed:false,peerEndReturned:false};
 if(mode==='partial-state')delete state.hostFin;
 if(mode==='nonboolean-state')state.hostFin='true';
 if(mode==='state-field-getter')Object.defineProperty(state,'hostFin',{get(){traps++;throw Error('getter');}});
 Object.defineProperty(cause,'relayFrameStage',mode==='frame-getter'?{get(){traps++;throw Error('getter');}}:{value:mode==='wrong-frame-sysread'?'DATA_AFTER_FIN':'STDOUT_EOF_WITHOUT_FIN'});
 Object.defineProperty(cause,'relayCloseState',mode==='state-getter'?{get(){traps++;throw Error('getter');}}:{value:mode==='state-proxy'?new Proxy(state,{getOwnPropertyDescriptor(){traps++;throw Error('proxy');}}):state});
 Object.defineProperty(cause,'relayChildExitCode',{value:mode==='unknown-exit'?255:mode==='wrong-exit-sysread'?48:47});
 Object.defineProperty(cause,'relaySysreadExit',{value:mode==='unknown-sysread'?76:70});
 const detail=(await modeledPostcheck(cause)).postCheckFailure;
 assert.equal(detail.resourceCode,'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED');assert.equal(detail.relayCode,'CURRENT259_LOOPBACK_FORWARD_FRAME');assert.equal(traps,0);
 if(['state-getter','state-proxy','state-field-getter','partial-state','nonboolean-state'].includes(mode))assert.equal(detail.relayCloseState,undefined);
 else assert.deepEqual(detail.relayCloseState,state);
 if(mode==='frame-getter')assert.equal(detail.relayFrameStage,undefined);
 if(mode==='unknown-exit'||mode==='wrong-frame-sysread'||mode==='frame-getter')assert.equal(detail.relayChildExitCode,undefined);
 if(['unknown-exit','unknown-sysread','wrong-exit-sysread','wrong-frame-sysread','frame-getter'].includes(mode))assert.equal(detail.relaySysreadExit,undefined);
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|getter|proxy/u);
});


test('modeled P1017 with a passing postcheck remains CONSUME and cannot borrow relay diagnostics',async()=>{
 const f=model('native-p1017-consume');let cause;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),error=>{cause=error;return true;});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(cause);
 assert.equal(detail.phase,'CONSUME');assert.equal(detail.httpStatus,500);assert.equal(detail.serverPrismaCode,'P1017');assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.postCheckFailure,undefined);
 assert.deepEqual(f.checks,[true,true,true]);assert.equal(f.calls.length,1);
});


test('modeled same original HTTP error keeps finite application-await phase through secondary cleanup',async()=>{
 const cause=Object.assign(Error('PRIVATE_POSTCHECK'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
 const phase={operation:'ACCOUNT_RATE_LIMIT',phase:'UPSERT_2_PENDING',upsertOrdinal:2,callbackEntered:true,callbackReturned:false,elapsedMs:12,phaseElapsedMs:4,private:'SECRET_SQL'};
 const f=model('native-p1017-postcheck',cause,phase);
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}})),error=>error===cause);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(cause);
 assert.deepEqual(detail.serverAuthTransactionPhase,{operation:'ACCOUNT_RATE_LIMIT',phase:'UPSERT_2_PENDING',upsertOrdinal:2,callbackEntered:true,callbackReturned:false,elapsedMs:12,phaseElapsedMs:4});
 assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.serverPrismaCode,'P1017');assert.deepEqual(f.authCalls,['arm','take']);assert.deepEqual(f.checks,[true,true,false]);assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(detail),/SECRET_SQL/);
});
for(const mode of ['proxy','getter','unknown','inconsistent'])test('phase projection omits '+mode+' without private traversal',async()=>{
 let reads=0;const phase=mode==='proxy'?new Proxy({},{getOwnPropertyDescriptor(){reads++;throw Error();}}):mode==='getter'?Object.defineProperty({},'operation',{get(){reads++;throw Error();}}):{operation:'ACCOUNT_RATE_LIMIT',phase:mode==='unknown'?'COMMIT_FAILED':'UPSERT_2_PENDING',upsertOrdinal:0,callbackEntered:false,callbackReturned:false,elapsedMs:1,phaseElapsedMs:0};
 const f=model('native-p1017-postcheck',Error('PRIVATE'),phase);let error;
 try{await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,b=>b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}}));}catch(value){error=value;}
 assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure(error).serverAuthTransactionPhase,undefined);assert.equal(reads,0);
});

 test('auth-only HTTP owns exactly actor0 login and cannot lend its bridge to full lifecycle',async()=>{
  const f=model('auth-only');await f.api.withCurrent261FirstLoginHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
   f.api.assertCurrent261FirstLoginHttp(b);assert.throws(()=>f.api.assertCurrent261LocalLifecycleHttp(b),/LIFECYCLE_HTTP/u);
   await assert.rejects(b.send(1,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[1].phone,password:f.config.passwords[id(2)]}}),/LIFECYCLE_HTTP/u);
   await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
   await assert.rejects(b.send(0,{method:'POST',path:'/contracts',json:{}}),/LIFECYCLE_HTTP/u);
   await assert.rejects(b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}}),/LIFECYCLE_HTTP/u);
  });assert.equal(f.calls.length,1);assert.deepEqual(f.authCalls,['arm','take']);
 });
 test('auth-only cannot complete with no POST or a full-purpose config',async()=>{
  const f=model('auth-only');await assert.rejects(f.api.withCurrent261FirstLoginHttp(f.config,f.server,f.verify,f.verifyToken,async()=>{}),/LIFECYCLE_HTTP/u);assert.equal(f.calls.length,0);
  const g=model();await assert.rejects(g.api.withCurrent261FirstLoginHttp(g.config,g.server,g.verify,g.verifyToken,async()=>{}),/LIFECYCLE_HTTP/u);
 });


test('equipment bridge accepts its exact selected creation payload and rejects a material payload before transport (model only)',async()=>{
 const f=model(undefined,undefined,undefined,'inside:equipment_rental');
 await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'equipment_rental',amountLimitType:'capped'}});
 });
 assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].wire).contractTypeKey,'equipment_rental');
 const wrong=model(undefined,undefined,undefined,'inside:equipment_rental');
 await assert.rejects(wrong.api.withCurrent261LocalLifecycleHttp(wrong.config,wrong.server,wrong.verify,wrong.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:wrong.config.fixture.approval.users[0].phone,password:wrong.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
 }),/LIFECYCLE_HTTP/u);assert.equal(wrong.calls.length,1);
});

test('only the fixed contract pending workbench query is reachable by the handler or seal actor',async()=>{
 const f=model();
 await f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'GET',path:'/contracts/workbench?view=pending_action&page=1&pageSize=100'});
 });assert.equal(f.calls.length,3);
 const wrong=model();
 await assert.rejects(wrong.api.withCurrent261LocalLifecycleHttp(wrong.config,wrong.server,wrong.verify,wrong.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:wrong.config.fixture.approval.users[0].phone,password:wrong.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'GET',path:'/contracts/workbench?view=all&page=1&pageSize=100'});
 }),/LIFECYCLE_HTTP/u);assert.equal(wrong.calls.length,2);
});

test('HTTP rejects nested case accessor and proxy without executing traps or sending a request',async()=>{
 const selected=require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCase('inside:equipment_rental');
 let traps=0;const trap=()=>{traps++;throw Error('SYNTHETIC_GETTER');};const getter={...selected};Object.defineProperty(getter,'billAlias',{enumerable:true,get:trap});
 for(const value of [Object.freeze(getter),new Proxy(selected,{get:trap,getOwnPropertyDescriptor:trap})]){
  const f=model();f.config.fixture.case=value;
  await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,()=>assert.fail()),/LIFECYCLE_HTTP/u);
  assert.equal(f.calls.length,0);
 }
 assert.equal(traps,0);
});


test('actual native main credentials feed the real HTTP dictionary and the ordered case/seed from the same eight values',async()=>{
 const base=model(undefined,undefined,undefined,'inside:equipment_rental'),fixture=base.config.fixture;
 const source=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const start=source.indexOf('  const fixture=modules.buildTask12LocalLifecycleFixture('),end=source.indexOf('  const seed=require(',start);
 const configStart=source.indexOf('   const config=Object.freeze('),configEnd=source.indexOf('   const bridge=',configStart);
 const inputStart=source.indexOf('      const input=Object.freeze('),inputEnd=source.indexOf("      enter('CONTRACT_SUBMIT_APPROVE_SEAL')",inputStart);
 assert.ok(start>=0&&end>start&&configStart>=0&&configEnd>configStart&&inputStart>=0&&inputEnd>inputStart);
 const hashInputs=[];let generated=0;
 const modules={buildTask12LocalLifecycleFixture:()=>fixture,isTask12LocalLifecycleFixture:value=>value===fixture,async hashTask12GeneratedAdmissionPassword(value){hashInputs.push(value);return 'model-hash-'+hashInputs.length;}};
 const invoke=new Function('modules','plan','randomBytes','wait','need','sourceDocx','originals','signal','http','check','official',
  'return (async()=>{'+source.slice(start,end)+source.slice(configStart,configEnd)+source.slice(inputStart,inputEnd)+'return {config,input,hashes};})();');
 const payload=await invoke(modules,{runId:id(90)},size=>Buffer.alloc(size,++generated),operation=>operation(),value=>assert.ok(value),base.config.sourceDocx,base.config.originals,new AbortController().signal,{},()=>{},{});
 const f=model(undefined,undefined,undefined,'inside:equipment_rental',payload.config);
 await f.api.withCurrent261LocalLifecycleHttp(payload.config,f.server,f.verify,f.verifyToken,async bridge=>{
  for(const [index,user]of fixture.approval.users.entries())await bridge.send(index,{method:'POST',path:'/auth/login',json:{phone:user.phone,password:payload.input.passwords[index]}});
 });
 assert.equal(generated,8);assert.equal(hashInputs.length,8);assert.equal(f.calls.length,8);
 assert.ok(Array.isArray(payload.input.passwords));
 for(const [index,user]of fixture.approval.users.entries()){
  const sent=JSON.parse(f.calls[index].wire);
  assert.ok(sent.password===payload.input.passwords[index]&&sent.password===payload.config.passwords[user.id]&&sent.password===hashInputs[index]);
  assert.equal(payload.hashes[user.id],'model-hash-'+(index+1));
 }
});

test('consume first cause stays finite and precedes a later guard failure without replacing HTTP201 or UNKNOWN',async()=>{
 const first=Object.assign(Error('PRIVATE_ORIGINAL'),{code:'TASK12_GENERATED_MATERIAL_TEMPLATE_INSPECTION'}),later=Object.assign(Error('PRIVATE_LATER'),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'}),f=model(undefined,later);
 const verify=()=>{try{f.verify();}catch(error){first.code='PRIVATE_MUTATED_AFTER_CAPTURE';throw error;}};
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,verify,f.verifyToken,async bridge=>{
  const result=await bridge.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});assert.equal(result.status,201);f.close();throw first;
 }),error=>error===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);
 assert.deepEqual(detail.firstCause,{family:'TEMPLATE_CONSUMER',code:'TASK12_GENERATED_MATERIAL_TEMPLATE_INSPECTION'});
 assert.equal(detail.phase,'CONSUME');assert.equal(detail.httpStatus,201);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.secondaryPhase,'AFTER_CHECK');assert.equal(detail.secondaryReason,'UNCLASSIFIED');
 assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure({cause:first}),detail);
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_ORIGINAL|PRIVATE_LATER|password|199000|10000000/u);
});

test('consume diagnostics measure only existing boundaries and inspection201 summary survives actual native receipt projection',async()=>{
 const payload={sourceRevision:2,hasBillLoop:true,blockingErrors:[],private:'PRIVATE_PAYLOAD'},first=Object.assign(Error('PRIVATE'),{code:'TASK12_GENERATED_MATERIAL_TEMPLATE_INSPECTION'}),f=model(undefined,undefined,undefined,undefined,undefined,payload);
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(2,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[2].phone,password:f.config.passwords[id(3)]}});
  await b.send(2,{method:'POST',path:'/contract-layout-templates',json:{}});
  const response=await b.send(2,{method:'POST',path:'/contract-layout-template-versions/'+id(22)+'/inspection'});assert.deepEqual(response.body,payload);f.close();throw first;
 }),error=>error===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);
 assert.deepEqual(detail.inspectionSummary,{status:'OBSERVED',sourceRevision:2,hasBillLoop:true,blockingErrorCount:0});
 for(const name of ['timingAtResponse','timingAtConsumeFailure','timingAfterSecondary']){
  const t=detail[name];assert.equal(t.status,'OBSERVED');assert.ok(t.guardCalls>0);assert.equal(t.exchangeCalls,3);for(const k of ['guardElapsedMs','exchangeElapsedMs','consumerElapsedMs'])assert.ok(Number.isSafeInteger(t[k])&&t[k]>=0&&t[k]<=3600000);
 }
 assert.equal(detail.timingAfterSecondary.guardCalls,f.checks.length);assert.equal(detail.timingAfterSecondary.guardCalls,detail.timingAtConsumeFailure.guardCalls+1);
 const native=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8'),statement=native.match(/const http=require\('\.\/task12-current261-local-lifecycle-http.cjs'\)\.describeCurrent261LocalLifecycleHttpFailure\(error\);if\(http\)receipt.httpFailure=http;/u);assert.ok(statement);
 const receipt={};new Function('require','error','receipt',statement[0])(()=>f.api,{cause:first},receipt);assert.equal(receipt.httpFailure,detail);
 const wire=JSON.stringify(receipt);assert.ok(Buffer.byteLength(wire)<4096);assert.doesNotMatch(wire,/PRIVATE|blockingErrors|password|199000/u);
});

function actualPrivateProjection(name){
 const source=fs.readFileSync(path.join(__dirname,'task12-current261-local-lifecycle-http.cjs'),'utf8');
 return new Function('require','module',source+'\nreturn '+name+';')(require,{exports:{}});
}
test('inspection summary and first cause omit private/unknown/accessor/proxy values without executing getters',()=>{
 const project=actualPrivateProjection('inspectionSummary'),first=actualPrivateProjection('consumeFirstCause');
 const valid={sourceRevision:2,hasBillLoop:false,blockingErrors:['PRIVATE_ERROR']};assert.deepEqual(project(valid),{status:'OBSERVED',sourceRevision:2,hasBillLoop:false,blockingErrorCount:1});
 let traps=0;const bad=new Proxy(valid,{get(){traps++;throw Error('PRIVATE');},ownKeys(){traps++;throw Error('PRIVATE');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE');}});
 for(const value of [null,bad,{...valid,sourceRevision:-1},{...valid,sourceRevision:1000001},{...valid,hasBillLoop:'true'},{...valid,blockingErrors:new Array(1001)},{...valid,blockingErrors:new Proxy([],{get(){traps++;throw Error('PRIVATE');}})}])assert.deepEqual(project(value),{status:'UNKNOWN'});
 const revoked=Proxy.revocable([],{});revoked.revoke();assert.deepEqual(project({...valid,blockingErrors:revoked.proxy}),{status:'UNKNOWN'});
 for(const key of ['sourceRevision','hasBillLoop','blockingErrors']){const value={...valid};Object.defineProperty(value,key,{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project(value),{status:'UNKNOWN'});}
 const list=[];Object.defineProperty(list,0,{enumerable:true,get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project({...valid,blockingErrors:list}),{status:'UNKNOWN'});
 const error=Object.assign(Error('PRIVATE'),{code:'PRIVATE_UNKNOWN'});assert.deepEqual(first(error),{family:'UNKNOWN',code:'UNKNOWN'});Object.defineProperty(error,'code',{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(first(error),{family:'UNKNOWN',code:'UNKNOWN'});assert.deepEqual(first(new Proxy(error,{get(){traps++;throw Error('PRIVATE');}})),{family:'UNKNOWN',code:'UNKNOWN'});
 assert.equal(traps,0);
});
test('invalid or throwing diagnostic clock stays UNKNOWN and never replaces the original consumer exception',async()=>{
 for(const clock of [()=>NaN,()=>Infinity,()=>{throw Error('PRIVATE_CLOCK');}]){
  const f=model(undefined,undefined,undefined,undefined,undefined,undefined,clock),first=Object.assign(Error('PRIVATE'),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});
  await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});throw first;}),value=>value===first);
  const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);assert.deepEqual(detail.firstCause,{family:'OFFICIAL_DEADLINE',code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});assert.deepEqual(detail.timingAtResponse,{status:'UNKNOWN'});assert.deepEqual(detail.timingAtConsumeFailure,{status:'UNKNOWN'});assert.deepEqual(detail.timingAfterSecondary,{status:'UNKNOWN'});
 }
});

test('non-number diagnostic clocks never coerce objects or execute proxy/valueOf traps and preserve firstError',async()=>{
 let traps=0;const object={valueOf(){traps++;return 1;}},getter=Object.defineProperty({},'valueOf',{get(){traps++;throw Error('PRIVATE');}}),proxy=new Proxy({},{get(){traps++;throw Error('PRIVATE');}}),revoked=Proxy.revocable({},{});revoked.revoke();
 for(const value of [object,getter,proxy,revoked.proxy,Symbol("PRIVATE"),1n]){
  const f=model(undefined,undefined,undefined,undefined,undefined,undefined,()=>value),first=Object.assign(Error('PRIVATE_FIRST'),{code:'TASK12_GENERATED_MATERIAL_TEMPLATE_INSPECTION'});
  await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});throw first;}),error=>error===first);
  const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);assert.equal(detail.firstCause.code,'TASK12_GENERATED_MATERIAL_TEMPLATE_INSPECTION');
  for(const key of ['timingAtResponse','timingAtConsumeFailure','timingAfterSecondary'])assert.deepEqual(detail[key],{status:'UNKNOWN'});
 }
 assert.equal(traps,0);
});

test('preview diagnostic separates original consumer failure branches with finite data and no DB-cause inference',()=>{
 const project=actualPrivateProjection('previewSummary'),coordinates=Object.freeze({id:id(30),layoutTemplateVersionId:id(22),sourceRevision:2,createdByUserId:id(3),sourceFileId:id(40),templateId:id(21)});
 const body={id:coordinates.id,layoutTemplateVersionId:coordinates.layoutTemplateVersionId,sourceRevision:2,createdByUserId:id(3),status:'failed',previewPdfFileId:null,errorMessage:'PRIVATE_ERROR',startedAt:'2026-11-16T00:00:00Z',completedAt:'2026-11-16T00:00:01Z'};
 const value=project(body,coordinates);
 assert.deepEqual(value,{status:'OBSERVED',jobStatus:'failed',consumerBranch:'FAILED',sameJob:true,sameLayout:true,sameRevision:true,sameCreator:true,previewFileIdValid:false,errorMessageNull:false,startedAtValid:true,completedAfterStarted:true});
 assert.equal(project({...body,id:id(31)},coordinates).consumerBranch,'COORDINATES_MISMATCH');
 assert.equal(project({...body,status:'stale'},coordinates).consumerBranch,'STALE');
 assert.equal(project({...body,status:'succeeded'},coordinates).consumerBranch,'INVALID_SUCCESS');
 assert.equal(project({...body,status:'succeeded',previewPdfFileId:id(32),errorMessage:null},coordinates).consumerBranch,'VALID_SUCCESS');
 assert.equal(project({...body,status:'queued',startedAt:null,completedAt:null},coordinates).consumerBranch,'VALID_PENDING');
 assert.equal(project({...body,status:'processing',previewPdfFileId:id(32)},coordinates).consumerBranch,'INVALID_PENDING');
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE|10000000|P2010|permission|password/u);assert.ok(Buffer.byteLength(JSON.stringify(value))<512);
});

test('decoded preview summary survives consumer first cause and secondary check in the actual native receipt projection',async()=>{
 const payload={id:id(30),layoutTemplateVersionId:id(22),sourceRevision:2,createdByUserId:id(3),status:'failed',previewPdfFileId:null,errorMessage:'PRIVATE_PREVIEW',startedAt:'2026-11-16T00:00:00Z',completedAt:'2026-11-16T00:00:01Z'};
 const first=Object.assign(Error('PRIVATE_FIRST'),{code:'TASK12_GENERATED_MATERIAL_TEMPLATE_PREVIEW'}),later=Error('PRIVATE_SECONDARY'),f=model(undefined,later,undefined,undefined,undefined,{sourceRevision:2,hasBillLoop:true,blockingErrors:[]},undefined,payload);
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(2,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[2].phone,password:f.config.passwords[id(3)]}});
  await b.send(2,{method:'POST',path:'/contract-layout-templates',json:{docxFileId:id(40)}});
  await b.send(2,{method:'POST',path:'/contract-layout-template-versions/'+id(22)+'/inspection'});
  await b.send(2,{method:'POST',path:'/contract-layout-template-versions/'+id(22)+'/preview-generation',json:{}});
  const response=await b.send(2,{method:'GET',path:'/contract-layout-template-versions/'+id(22)+'/preview-generation'});assert.deepEqual(response.body,payload);f.close();throw first;
 }),error=>error===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);assert.equal(detail.previewSummary.consumerBranch,'FAILED');assert.equal(detail.httpStatus,200);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.firstCause.code,'TASK12_GENERATED_MATERIAL_TEMPLATE_PREVIEW');assert.equal(detail.secondaryPhase,'AFTER_CHECK');
 const native=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8'),statement=native.match(/const http=require\('\.\/task12-current261-local-lifecycle-http.cjs'\)\.describeCurrent261LocalLifecycleHttpFailure\(error\);if\(http\)receipt.httpFailure=http;/u);assert.ok(statement);
 const receipt={};new Function('require','error','receipt',statement[0])(()=>f.api,{cause:first},receipt);assert.equal(receipt.httpFailure,detail);assert.ok(Buffer.byteLength(JSON.stringify(receipt))<4096);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|10000000|PRIVATE_PREVIEW|P2010/u);
});

test('preview diagnostic rejects unsafe own fields and foreign coordinate data without any getter or proxy trap',()=>{
 const project=actualPrivateProjection('previewSummary'),coordinates={id:id(30),layoutTemplateVersionId:id(22),sourceRevision:2,createdByUserId:id(3),sourceFileId:id(40),templateId:id(21)},body={id:id(30),layoutTemplateVersionId:id(22),sourceRevision:2,createdByUserId:id(3),status:'failed',previewPdfFileId:null,errorMessage:'PRIVATE',startedAt:null,completedAt:null};let traps=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error('PRIVATE');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE');},ownKeys(){traps++;throw Error('PRIVATE');}}),revoked=Proxy.revocable({},{});revoked.revoke();
 for(const unsafe of [proxy,revoked.proxy,undefined,null,1n,Symbol('PRIVATE')]){assert.deepEqual(project(unsafe,coordinates),{status:'UNKNOWN'});assert.deepEqual(project(body,unsafe),{status:'UNKNOWN'});}
 for(const key of Object.keys(body)){const value={...body};Object.defineProperty(value,key,{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project(value,coordinates),{status:'UNKNOWN'});assert.deepEqual(project({...body,[key]:proxy},coordinates),{status:'UNKNOWN'});}
 for(const key of Object.keys(coordinates)){const value={...coordinates};Object.defineProperty(value,key,{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project(body,value),{status:'UNKNOWN'});}
 for(const patch of [{errorMessage:'x'.repeat(4097)},{startedAt:'x'.repeat(65)},{status:'PRIVATE_UNKNOWN'},{sourceRevision:1000001}])assert.deepEqual(project({...body,...patch},coordinates),{status:'UNKNOWN'});
 const collision={...body,status:'succeeded',previewPdfFileId:coordinates.sourceFileId,errorMessage:null,startedAt:'2026-11-16',completedAt:'2026-11-17'};assert.equal(project(collision,coordinates).consumerBranch,'INVALID_SUCCESS');
 assert.equal(traps,0);
});

test('exact local lifecycle HTTP consumer code survives first-error and later-check failure without inferring a DB cause',async()=>{
 const first=Object.assign(Error('PRIVATE_FIRST'),{code:'TASK12_LOCAL_LIFECYCLE_CASE_HTTP'}),f=model('workbench500',Error('PRIVATE_SECONDARY'));
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  const response=await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});assert.equal(response.status,500);assert.deepEqual(response.body,{statusCode:500,message:'Internal server error'});f.close();throw first;
 }),e=>e===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);assert.deepEqual(detail.firstCause,{family:'LOCAL_LIFECYCLE_CONSUMER',code:'TASK12_LOCAL_LIFECYCLE_CASE_HTTP'});assert.equal(detail.httpStatus,500);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.secondaryPhase,'AFTER_CHECK');
 const native=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8'),statement=native.match(/const http=require\('\.\/task12-current261-local-lifecycle-http.cjs'\)\.describeCurrent261LocalLifecycleHttpFailure\(error\);if\(http\)receipt.httpFailure=http;/u);assert.ok(statement);const receipt={};new Function('require','error','receipt',statement[0])(()=>f.api,first,receipt);assert.equal(receipt.httpFailure,detail);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|P2010|Settlement|password/u);assert.ok(Buffer.byteLength(JSON.stringify(receipt))<4096);
 const project=actualPrivateProjection('consumeFirstCause');let traps=0;
 for(const error of [Object.assign(Error('PRIVATE'),{code:'TASK12_LOCAL_LIFECYCLE_CASE_UNKNOWN'}),{code:'TASK12_LOCAL_LIFECYCLE_CASE_HTTP'},new Proxy(first,{get(){traps++;throw Error('PRIVATE');}})])assert.deepEqual(project(error),{family:'UNKNOWN',code:'UNKNOWN'});
 const accessor=Error('PRIVATE');Object.defineProperty(accessor,'code',{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project(accessor),{family:'UNKNOWN',code:'UNKNOWN'});assert.equal(traps,0);
});


test('generated document consumer failure preserves the exact finite stage after a200 response',async()=>{
 const first=Object.assign(Error('PRIVATE_ORIGINAL'),{code:'TASK12_GENERATED_DOCUMENT_TIME'}),f=model();
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  assert.equal((await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'})).status,200);f.close();throw first;
 }),error=>error===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);
 assert.deepEqual(detail.firstCause,{family:'GENERATED_DOCUMENT_CONSUMER',code:'TASK12_GENERATED_DOCUMENT_TIME'});
 assert.equal(detail.httpStatus,200);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.secondaryPhase,'AFTER_CHECK');
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_ORIGINAL|password|199000|10000000/u);
 const project=actualPrivateProjection('consumeFirstCause');
 for(const stage of ['INPUT','LEASE','QUEUE','WORKBENCH','DOCUMENT','TEMPLATE','TIME'])assert.deepEqual(project(Object.assign(Error('PRIVATE'),{code:'TASK12_GENERATED_DOCUMENT_'+stage})),{family:'GENERATED_DOCUMENT_CONSUMER',code:'TASK12_GENERATED_DOCUMENT_'+stage});
 assert.deepEqual(project(Object.assign(Error('PRIVATE'),{code:'TASK12_GENERATED_DOCUMENT_PRIVATE'})),{family:'UNKNOWN',code:'UNKNOWN'});
});


test('workbench200 retains only bounded document states before a later consume failure',async()=>{
 const payload={documents:[{status:'failed',errorMessage:'PRIVATE_ERROR'},{status:'processing',file:'PRIVATE_FILE'}]},first=Object.assign(Error('PRIVATE'),{code:'TASK12_GENERATED_DOCUMENT_DOCUMENT'}),f=model(undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,payload);
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  assert.deepEqual((await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'})).body,payload);f.close();throw first;
 }),error=>error===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);
 assert.deepEqual(detail.documentSummary,{status:'OBSERVED',documentCount:2,states:{queued:0,processing:1,success:0,failed:1,stale:0,cancelled:0}});
 assert.equal(detail.httpStatus,200);assert.equal(detail.firstCause.code,'TASK12_GENERATED_DOCUMENT_DOCUMENT');assert.equal(detail.businessOutcome,'UNKNOWN');
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|errorMessage|password|10000000/u);
});


test('document summaries reject unsafe states, arrays and accessors without reading private payloads',()=>{
 const project=actualPrivateProjection('documentSummary');let traps=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error('PRIVATE');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE');},ownKeys(){traps++;throw Error('PRIVATE');}}),revoked=Proxy.revocable([],{});revoked.revoke();
 for(const value of [null,undefined,proxy,{documents:proxy},{documents:revoked.proxy},{documents:new Array(101)},{documents:[{status:'PRIVATE'}]},{documents:[proxy]}])assert.deepEqual(project(value),{status:'UNKNOWN'});
 const body={};Object.defineProperty(body,'documents',{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project(body),{status:'UNKNOWN'});
 const row={};Object.defineProperty(row,'status',{get(){traps++;throw Error('PRIVATE');}});assert.deepEqual(project({documents:[row]}),{status:'UNKNOWN'});
 const array=[];Object.defineProperty(array,0,{get(){traps++;throw Error('PRIVATE');},enumerable:true});assert.deepEqual(project({documents:array}),{status:'UNKNOWN'});
 assert.equal(traps,0);assert.deepEqual(project({documents:[]}),{status:'OBSERVED',documentCount:0,states:{queued:0,processing:0,success:0,failed:0,stale:0,cancelled:0}});
});


test('pre-wire guard failure keeps finite cause without borrowing an earlier response or rechecking',async()=>{
 const first=Object.assign(Error('PRIVATE_GUARD_MESSAGE'),{code:'CURRENT261_NATIVE_PROVIDER_LOOKUP'}),f=model(undefined,first);let checks;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  f.close();checks=f.checks.length;
  await b.send(0,{method:'POST',path:'/contracts',json:{}});
 }),cause=>cause===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure({cause:first});assert.ok(detail);
 assert.equal(detail.phase,'CONSUME');assert.equal(detail.observationContext,'NO_HTTP_OBSERVATION');
 assert.equal(detail.method,'UNKNOWN');assert.equal(detail.routeTemplate,'UNKNOWN');assert.equal(detail.httpStatus,null);assert.equal(detail.businessOutcome,'UNKNOWN');
 assert.deepEqual(detail.firstCause,{family:'INTEGRITY',code:'CURRENT261_NATIVE_PROVIDER_LOOKUP'});
 assert.equal(detail.timingAtConsumeFailure.guardCalls,checks+1);assert.equal(f.checks.length,checks+1);assert.equal(f.calls.length,1);
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|phone|password|stack/u);
});


test('parallel approval consumer failure keeps ambiguous context without attributing a returned route',async()=>{
 const f=model(),first=Object.assign(Error('PRIVATE_CONSUMER'),{code:'TASK12_GENERATED_DOCUMENT_DOCUMENT'});let checks;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  for(let actor=0;actor<=5;actor++){const user=f.config.fixture.approval.users[actor];await b.send(actor,{method:'POST',path:'/auth/login',json:{phone:user.phone,password:f.config.passwords[user.id]}});}
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await Promise.all([1,2,3,4,5].map(actor=>b.send(actor,{method:'POST',path:'/contracts/'+id(22)+'/approval',json:{decision:'approve'}})));
  checks=f.checks.length;throw first;
 }),cause=>cause===first);
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(first);assert.ok(detail);
 assert.equal(detail.observationContext,'PARALLEL_RESPONSE_CONTEXT');assert.equal(detail.method,'UNKNOWN');assert.equal(detail.routeTemplate,'UNKNOWN');assert.equal(detail.httpStatus,null);assert.equal(detail.businessOutcome,'UNKNOWN');
 assert.deepEqual(detail.firstCause,{family:'GENERATED_DOCUMENT_CONSUMER',code:'TASK12_GENERATED_DOCUMENT_DOCUMENT'});
 assert.equal(detail.timingAtConsumeFailure.exchangeCalls,12);assert.equal(f.checks.length,checks);assert.equal(detail.timingAtConsumeFailure.guardCalls,checks);assert.equal(f.calls.length,12);
 const native=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8'),statement=native.match(/const http=require\('\.\/task12-current261-local-lifecycle-http.cjs'\)\.describeCurrent261LocalLifecycleHttpFailure\(error\);if\(http\)receipt.httpFailure=http;/u);assert.ok(statement);
 const receipt={};new Function('require','error','receipt',statement[0])(()=>f.api,{cause:first},receipt);assert.equal(receipt.httpFailure,detail);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|phone|password|stack/u);
});


test('missing observation diagnostic projects only exact guard codes and never executes an error accessor',async()=>{
 let getters=0;
 const accessor=Error('PRIVATE_ACCESSOR');Object.defineProperty(accessor,'code',{get(){getters++;throw Error('PRIVATE_GETTER');}});
 for(const [first,expected]of [[Object.assign(Error('PRIVATE'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}),{family:'INTEGRITY',code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'}],[Object.assign(Error('PRIVATE'),{code:'CURRENT261_NATIVE_PROVIDER_LOOKUP_PRIVATE'}),{family:'UNKNOWN',code:'UNKNOWN'}],[accessor,{family:'UNKNOWN',code:'UNKNOWN'}]]){
  const f=model();let checks;
  await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async()=>{checks=f.checks.length;throw first;}),cause=>cause===first);
  const detail=f.api.describeCurrent261LocalLifecycleHttpFailure({cause:first});assert.deepEqual(detail.firstCause,expected);assert.equal(detail.observationContext,'NO_HTTP_OBSERVATION');assert.equal(detail.httpStatus,null);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(f.checks.length,checks);assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|stack/u);
  const wrapped={cause:first};f.api.rememberCurrent261ApplicationHttpSetupFailure(wrapped);assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure(wrapped),detail);
 }
 assert.equal(getters,0);
});

test('CON18 heartbeat server cause is bound, finite, and preserves failed response as primary',async()=>{
 const f=model('lease-diag');let failure;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/edit-lease'});
  const response=await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/edit-lease/heartbeat',headers:{'x-contract-draft-lease':'a'.repeat(43)}});
  assert.equal(response.status,500);throw Object.assign(Error('PRIVATE PRIMARY'),{code:'TASK12_GENERATED_DOCUMENT_LEASE'});
 }),e=>{failure=e;return e.code==='TASK12_GENERATED_DOCUMENT_LEASE';});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(failure);assert.equal(detail.httpStatus,500);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.serverErrorKind,'KNOWN_REQUEST_ERROR');assert.equal(detail.serverPrismaCode,'P2028');assert.equal(detail.serverLeaseBoundary,'CONTROLLER_MARKER_REACHED');assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|aaaaaaaa|10000000/u);
});

test('other lifecycle entry points do not arm CON18 heartbeat diagnostics',async()=>{
 const f=model('lease-other');
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/edit-lease'});
  const response=await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/edit-lease/heartbeat',headers:{'x-contract-draft-lease':'a'.repeat(43)}});assert.equal(response.status,500);throw Error('stop');
 }));
 assert.deepEqual(f.authCalls,['arm','take']);
});

test('CON18 workbench GET preserves the failure and projects only the matching finite observation',async()=>{
 const f=model('workbench-diag');let failure;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/preview-generation',json:{sourceRevision:1}});
  const response=await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});assert.equal(response.status,500);throw Object.assign(Error('PRIVATE PRIMARY'),{code:'TASK12_GENERATED_DOCUMENT_WORKBENCH'});
 }),e=>{failure=e;return e.code==='TASK12_GENERATED_DOCUMENT_WORKBENCH';});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(failure);assert.equal(detail.httpStatus,500);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.serverErrorKind,'KNOWN_REQUEST_ERROR');assert.equal(detail.serverPrismaCode,'P2028');assert.equal(detail.serverWorkbenchBoundary,'CONTROLLER_MARKER_REACHED');assert.deepEqual(detail.serverWorkbenchTransactionPhase,{phase:'CALLBACK_RETURNED',elapsedMs:5031,phaseElapsedMs:5001});assert.ok(['OBSERVED','UNSAMPLED'].includes(detail.eventLoopDelay.status));assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|10000000/u);assert.deepEqual(f.authCalls,['arm','take','arm','take']);
});

test('workbench diagnostic remains unarmed before queue and outside CON18',async()=>{
 for(const [mode,queue] of [['workbench-diag',false],['workbench-other',true]]){const f=model(mode);let failure;await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  if(queue)await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/preview-generation',json:{sourceRevision:1}});
  await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});throw Error('stop');
 }),e=>{failure=e;return true;});assert.equal(f.api.describeCurrent261LocalLifecycleHttpFailure(failure).eventLoopDelay,undefined);assert.deepEqual(f.authCalls,['arm','take']);assert.equal(f.calls.at(-1).options.headers['x-task12-diagnostic'],undefined);}
});

test('workbench server observation is taken before a failed postcheck without replacing that failure',async()=>{
 const original=Object.assign(Error('PRIVATE_POSTCHECK'),{code:'CURRENT259_LOADER_CHANGED'}),f=model('workbench-postcheck',original);let failure;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/preview-generation',json:{sourceRevision:1}});
  await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});
 }),e=>{failure=e;return e===original;});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(failure);assert.equal(detail.phase,'AFTER_CHECK');assert.equal(detail.httpStatus,500);assert.equal(detail.serverPrismaCode,'P2028');assert.equal(detail.serverWorkbenchBoundary,'CONTROLLER_MARKER_REACHED');assert.equal(detail.businessOutcome,'UNKNOWN');assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|10000000/u);
});

test('untrusted loop observation is closed and cannot replace the original failed response',async()=>{
 let traps=0;const loop={beginCon18LoopDelay(){return ()=>Object.defineProperty({status:'OBSERVED',samples:1,private:'PRIVATE'},'maxBucket',{get(){traps++;throw Error('PRIVATE');}});}},f=model('workbench-diag',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,loop);let failure;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/preview-generation',json:{sourceRevision:1}});
  const response=await b.send(0,{method:'GET',path:'/contract-drafts/'+id(22)+'/workbench'});assert.equal(response.status,500);throw Object.assign(Error('PRIVATE'),{code:'TASK12_GENERATED_DOCUMENT_WORKBENCH'});
 }),e=>{failure=e;return e.code==='TASK12_GENERATED_DOCUMENT_WORKBENCH';});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(failure);assert.deepEqual(detail.eventLoopDelay,{status:'UNAVAILABLE'});assert.equal(traps,0);assert.doesNotMatch(JSON.stringify(detail),/PRIVATE/u);
});

 test('CON18 queue POST retains only its bound finite server cause',async()=>{
 const f=model('queue-diag');let failure;
 await assert.rejects(f.api.withCurrent261LocalLifecycleHttp(f.config,f.server,f.verify,f.verifyToken,async b=>{
  await b.send(0,{method:'POST',path:'/auth/login',json:{phone:f.config.fixture.approval.users[0].phone,password:f.config.passwords[id(1)]}});
  await b.send(0,{method:'POST',path:'/contracts',json:{projectId:id(20),numericProtocolVersion:2,relationship:'inside',contractTypeKey:'material_purchase',amountLimitType:'capped'}});
  const response=await b.send(0,{method:'POST',path:'/contract-drafts/'+id(22)+'/preview-generation',json:{sourceRevision:1}});assert.equal(response.status,500);throw Object.assign(Error('PRIVATE PRIMARY'),{code:'TASK12_GENERATED_DOCUMENT_QUEUE'});
 }),e=>{failure=e;return e.code==='TASK12_GENERATED_DOCUMENT_QUEUE';});
 const detail=f.api.describeCurrent261LocalLifecycleHttpFailure(failure);assert.equal(detail.httpStatus,500);assert.equal(detail.businessOutcome,'UNKNOWN');assert.equal(detail.serverErrorKind,'KNOWN_REQUEST_ERROR');assert.equal(detail.serverPrismaCode,'P2028');assert.equal(detail.serverQueueBoundary,'CONTROLLER_MARKER_REACHED');assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|10000000/u);assert.deepEqual(f.authCalls,['arm','take','arm','take']);
 });
