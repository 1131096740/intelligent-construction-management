'use strict';

const {request}=require('node:http');
const {randomBytes}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {isDeepStrictEqual:equal,types}=require('node:util');
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const jwt=/^[\w-]+\.[\w-]+\.[\w-]+$/u;
const cap=512*1024;
const error=()=>Object.assign(Error('CURRENT259_GENERATED_DOCUMENT_HTTP'),{code:'CURRENT259_GENERATED_DOCUMENT_HTTP'});
const need=value=>{if(!value)throw error();};
const data=(value,key)=>value&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
function send(port,method,path,headers,body,multipart){
 const signal=AbortSignal.timeout(15000);
 const wire=multipart??(body===undefined?undefined:Buffer.from(JSON.stringify(body)));
 need(!wire||wire.length<=(multipart?8*1024*1024:cap));
 const fixed={Host:'127.0.0.1:'+port,'Accept-Encoding':'identity',...headers};
 if(wire)fixed['Content-Length']=wire.length;
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(error());
  const outgoing=request({hostname:'127.0.0.1',port,method,path,headers:fixed,agent:false,maxHeaderSize:16384,signal},reply=>{
   reply.once('error',fail);reply.once('aborted',fail);reply.once('close',()=>{if(!reply.complete)fail();});
   if(reply.socket?.remoteAddress!=='127.0.0.1'||reply.socket.remotePort!==port||
    reply.statusCode<200||reply.statusCode>=600||reply.statusCode>=300&&reply.statusCode<400||
    Object.hasOwn(reply.headers,'location')||Object.hasOwn(reply.headers,'content-range')||
    (reply.headers['content-encoding']&&reply.headers['content-encoding']!=='identity')){
    fail();reply.destroy();return;
   }
   const chunks=[];let bytes=0;
   reply.on('data',chunk=>{bytes+=chunk.length;if(bytes>cap){fail();reply.destroy();}else chunks.push(chunk);});
   reply.once('end',()=>{
    try{
     need(!signal.aborted&&reply.complete&&bytes<=cap);
     resolve(Object.freeze({status:reply.statusCode,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)))}));
    }catch{fail();}
   });
  });
  outgoing.once('error',fail);outgoing.end(wire);
 });
}

async function withCurrent259DocumentHttp(bridge,server,verify,verifyToken,consume){
 const {takeCurrent259GeneratedDocumentHttpBridge}=require('./task12-current259-document-application.cjs');
 need(arguments.length===5);
 takeCurrent259GeneratedDocumentHttpBridge(bridge,server);
 const {fixture,passwords,openDraft,entries={}}=bridge;
 const {handler,project}=fixture;
 const director=fixture.users.find(row=>row.id===fixture.globalRoles.find(role=>role.roleKey==='contract_director')?.userId);
 need(director&&director!==handler&&id.test(director.id)&&id.test(handler.id)&&id.test(project.id));
 const address=server.address,port=address.call(server)?.port;
 let available=true,attempted=false,saved=false,reads=0,pending,failed=false,current,lease,leaseExpiry,opened,handlerHeaders,directorHeaders;
 let published,savedDraft,generation,downloaded=false;
 const check=()=>{
  verify();
  const row=address.call(server);
  need(available&&server.address===address&&server.listening===true&&row?.address==='127.0.0.1'&&row.family==='IPv4'&&
   Number.isInteger(port)&&port>1024&&port<=65535&&row.port===port);
 };
 const json=Object.freeze({'content-type':'application/json'});
 const wire=async(...args)=>{check();const result=await send(port,...args);check();return result;};
 const login=async(actor,password,role,global)=>{
  const response=await wire('POST','/auth/login',json,{phone:actor.phone,password});
  const user=data(response.body,'user'),token=data(data(response.body,'tokens'),'accessToken');
  need(response.status===201&&data(user,'id')===actor.id&&data(user,'phone')===actor.phone&&
   data(user,'mustChangePassword')===false&&equal(data(user,'roleKeys'),[role])&&equal(data(user,'globalRoleKeys'),global)&&
   typeof token==='string'&&token.length<=4096&&jwt.test(token));
  const claims=verifyToken(token);
  need(data(claims,'sub')===actor.id&&data(claims,'phone')===actor.phone&&data(claims,'type')==='access'&&data(claims,'ver')===0);
  return response;
 };
 const run=operation=>{
  check();need(!pending&&!failed);
  const task=Promise.resolve().then(operation);
  pending=task;
  task.then(()=>{pending=undefined;},()=>{failed=true;pending=undefined;});
  return task;
 };
 const now=()=>{check();return Date.now();};
 const wait=async ms=>{check();need(ms===1000);await delay(ms);check();};
 const readDraft=async()=>{
  need(current&&(reads===0||reads===1&&saved));reads++;
  const result=await wire('GET','/contract-drafts/'+current+'/workbench',handlerHeaders);
  if(result.status!==200)failed=true;
  return result;
 };
 const save=async body=>{
  need(current&&lease&&reads===1&&!saved&&body&&!types.isProxy(body)&&Object.getPrototypeOf(body)===Object.prototype);
  saved=true;
  const result=await wire('PUT','/contract-drafts/'+current,{...handlerHeaders,'x-contract-draft-lease':lease},body);
  if(result.status!==200)failed=true;
  return result;
 };
 const operations=Object.freeze({
  publishMaterialTemplate:source=>run(async()=>{
   const publish=entries.publishTask12GeneratedMaterialTemplate;
   need(!published&&!opened&&typeof publish==='function');
   need(source instanceof Uint8Array&&source.byteLength>0&&source.byteLength<8*1024*1024-512);
   let step=0,layoutId,polls=0,sourceId;
   published=await publish(source,director.id,{now,wait,async send(message){
    const {method,path,json:body,form}=message;
    if(step===0){
     need(method==='POST'&&path==='/files'&&body===undefined&&form instanceof FormData&&equal([...form.keys()],['file']));
     const file=form.get('file'),name='material-purchase-real-v1.docx';
     const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
     need(file&&file.name===name&&file.type===mime&&file.size===source.byteLength);
     const bytes=Buffer.from(await file.arrayBuffer());
     need(equal(bytes,Buffer.from(source)));
     const boundary='jg-task12-'+randomBytes(24).toString('hex');
     const payload=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+
      '"\r\nContent-Type: '+mime+'\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
     const response=await wire(method,path,{...directorHeaders,'content-type':'multipart/form-data; boundary='+boundary},undefined,payload);
     sourceId=data(response.body,'id');need(id.test(sourceId));step++;return response;
    }
    need(form===undefined);
    if(step===1){
     need(method==='POST'&&path==='/contract-layout-templates'&&body?.docxFileId===sourceId);
     const response=await wire(method,path,directorHeaders,body);
     layoutId=data(data(response.body,'version'),'id');need(id.test(layoutId));step++;return response;
    }
    const base='/contract-layout-template-versions/'+layoutId;
    const routes=[['GET','source-positions'],['PATCH','source-mapping'],['POST','inspection'],
     ['POST','preview-generation'],['GET','preview-generation'],['POST','source-mapping-confirmation'],
     ['POST','submission'],['POST','publication']];
    const route=routes[step-2];
    need(route&&method===route[0]&&path===base+'/'+route[1]&&(method!=='GET'||body===undefined));
    const response=await wire(method,path,directorHeaders,body);
    if(step===6){need(++polls<=130);if(data(response.body,'status')==='succeeded')step++;}
    else step++;
    return response;
   }});
   need(step===10&&published?.layoutId===layoutId&&published.sourceFileId===sourceId);
   return published;
  }),
  openDraft:()=>run(async()=>{
   need(!attempted);attempted=true;
   let index=0,version;
   const result=await openDraft(fixture,passwords.handler,async message=>{
    const step=index++;
    const {method,path,headers,json:body}=message;
    if(step===0){
     need(method==='POST'&&path==='/auth/login'&&equal(headers,json)&&equal(body,{phone:handler.phone,password:passwords.handler}));
     const response=await login(handler,passwords.handler,'contract_staff',[]);
     handlerHeaders=Object.freeze({authorization:'Bearer '+response.body.tokens.accessToken,...json,'x-contract-numeric-protocol':'2'});
     return response;
    }
    need(equal(headers,handlerHeaders));
    if(step===1)need(method==='GET'&&path==='/contracts/create-capability?projectId='+project.id+'&relationship=inside'&&body===undefined);
    else if(step===2)need(method==='POST'&&path==='/contracts'&&equal(body,{projectId:project.id,numericProtocolVersion:2,
     contractTypeKey:'material_purchase',relationship:'inside',amountLimitType:'capped'}));
    else if(step===3){
     const suffix='/edit-lease',prefix='/contract-drafts/';
     need(method==='POST'&&path.startsWith(prefix)&&path.endsWith(suffix)&&body===undefined);
     version=path.slice(prefix.length,-suffix.length);need(id.test(version));
    }else need(step===4&&method==='GET'&&path==='/contract-drafts/'+version+'/workbench'&&body===undefined);
    const response=await wire(method,path,handlerHeaders,body);
    if(step===3){lease=data(response.body,'token');leaseExpiry=data(response.body,'expiresAt');need(typeof lease==='string'&&/^[\w-]{43}$/u.test(lease));}
    return response;
   });
   need(index===5&&result?.status==='DRAFT_ADMISSION_PROTOCOL_MATCHED'&&result.projectId===project.id&&id.test(result.contractId)&&result.versionId===version&&result.leaseRevision===1);
   current=version;
   opened=Object.freeze({status:result.status,projectId:result.projectId,contractId:result.contractId,versionId:version,leaseRevision:1});
   return opened;
  }),
  readDraftWorkbench:()=>run(readDraft),
  saveDraft:body=>run(()=>save(body)),
  saveGeneratedDraft:(draft,template)=>run(async()=>{
   const saveDocument=entries.saveTask12GeneratedDocumentDraft;
   need(opened&&draft===opened&&published&&template===published&&!savedDraft&&typeof saveDocument==='function');
   savedDraft=await saveDocument(opened,handler.id,published,Object.freeze({readDraftWorkbench:readDraft,saveDraft:save}));
   need(!failed&&saved&&reads===2&&savedDraft?.status==='DRAFT_DOCUMENT_SAVE_READBACK_MATCHED'&&
    savedDraft.versionId===current&&savedDraft.projectId===project.id&&savedDraft.contractId===opened.contractId&&
    savedDraft.layoutId===published.layoutId&&savedDraft.leaseRevision===opened.leaseRevision&&
    savedDraft.leaseExpiresAt===leaseExpiry);
   return savedDraft;
  }),
  generateDocument:(template,input)=>run(async()=>{
   const generate=entries.runTask12GeneratedDocument;
   need(published&&template===published&&savedDraft&&input===savedDraft&&!generation&&typeof generate==='function');
   const base='/contract-drafts/'+current;
   const {sourceRevision,documentContentRevision,documentContentFingerprint}=savedDraft;
   let queued=false,polls=0;
   generation=await generate({template,versionId:current,sourceRevision,documentContentRevision,documentContentFingerprint,
    lease:{token:lease,leaseRevision:opened.leaseRevision,expiresAt:leaseExpiry}}, {now,wait,async send(message){
    const {method,path,json:body,headers}=message;
    if(method==='POST'&&path===base+'/edit-lease/heartbeat'){
     need(body===undefined&&equal(headers,{'x-contract-draft-lease':lease}));
     return wire(method,path,{...handlerHeaders,'x-contract-draft-lease':lease});
    }
    if(method==='POST'&&path===base+'/preview-generation'){
     need(!queued&&headers===undefined&&equal(body,{sourceRevision}));queued=true;
    }else need(queued&&++polls<=130&&method==='GET'&&path===base+'/workbench'&&body===undefined&&
     equal(headers,{'x-contract-numeric-protocol':'2'}));
    return wire(method,path,handlerHeaders,body);
   }});
   need(queued&&polls>0&&generation?.status==='DRAFT_WORD_PDF_COORDINATES_MATCHED'&&generation.versionId===current);
   return generation;
  }),
  readDocumentOutputs:(coordinates,ownerScope,fields,readPdfDrawnText)=>run(async()=>{
   const read=entries.readTask12GeneratedDocumentOutputs;
   need(generation&&coordinates===generation&&fields===savedDraft.fields&&!downloaded&&ownerScope&&
    typeof read==='function'&&typeof readPdfDrawnText==='function'&&!types.isProxy(readPdfDrawnText));
   downloaded=true;
   return read(generation,{port,ownerScope,actorId:handler.id,accessToken:handlerHeaders.authorization.slice(7),
    confirmationPassword:passwords.handler,fields,readPdfDrawnText:async(bytes,signal)=>{
     check();const pages=await readPdfDrawnText(bytes,signal);check();return pages;
    }});
  })
 });
 try{
  // Bind the contract director to the fixed global position before allowing
  // any template operation. The JWT is deliberately not returned.
  const directorLogin=await login(director,passwords.director,'contract_director',['contract_director']);
  directorHeaders=Object.freeze({authorization:'Bearer '+directorLogin.body.tokens.accessToken,...json});
  const result=await consume(operations);
  need(!pending&&!failed);check();return result;
 }finally{
  available=false;
  if(pending)await Promise.allSettled([pending]);
  current=lease=handlerHeaders=directorHeaders=undefined;
 }
}
module.exports=Object.freeze({withCurrent259DocumentHttp});
