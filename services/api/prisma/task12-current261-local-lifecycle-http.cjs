'use strict';
const {request}=require('node:http'),{randomBytes,createHash}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises'),{types,isDeepStrictEqual:equal}=require('node:util');
const id=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x);
const issued=new WeakMap();
function assertCurrent261LocalLifecycleHttp(bridge){need(arguments.length===1&&bridge&&!types.isProxy(bridge)&&issued.has(bridge));issued.get(bridge)();}
const cap=512*1024,uploadCap=8*1024*1024,docxCap=25*1024*1024,pdfCap=100000000;
const docxMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdfMime='application/pdf';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=()=>Object.assign(Error('CURRENT261_LOCAL_LIFECYCLE_HTTP'),{code:'CURRENT261_LOCAL_LIFECYCLE_HTTP'});
const need=ok=>{if(!ok)throw error();};
const own=(v,k)=>v&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
function exchange(port,method,path,headers,wire,binary){
 const signal=AbortSignal.timeout(15000);
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(error());
  const outgoing=request({hostname:'127.0.0.1',port,method,path,headers:{Host:'127.0.0.1:'+port,'Accept-Encoding':'identity',connection:'close',...headers,...(wire?{'Content-Length':wire.length}:{})},agent:false,maxHeaderSize:16384,signal},reply=>{
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
async function withCurrent261LocalLifecycleHttp(config,server,verify,verifyToken,consume){
 need(arguments.length===5&&typeof verify==='function'&&typeof verifyToken==='function'&&typeof consume==='function');
 require('./task12-current259-document-application.cjs').takeCurrent261LocalLifecycleHttpBridge(config,server);
 const {fixture,passwords,sourceDocx,originals}=config,seed=fixture.approval;
 need(seed.users.length===8&&new Set(seed.users.map(u=>u.id)).size===8&&id(seed.project.id)&&seed.handler===seed.users[0]&&
  seed.users.every(u=>id(u.id)&&typeof u.phone==='string'&&typeof passwords[u.id]==='string'&&/^[a-f0-9]{64}$/u.test(passwords[u.id]))&&new Set(Object.values(passwords)).size===8&&
  sourceDocx instanceof Uint8Array&&Array.isArray(originals)&&originals.length===2&&originals.every(b=>b instanceof Uint8Array));
 const address=server.address,port=address.call(server)?.port;
 let available=true,failed=false,requests=0,upload=0,contractId,versionId,layoutId,lease;
 const tokens=new Map(),active=new Map(),files=new Map(),tickets=new Map(),signatures=new Set();
 const check=()=>{verify();const a=address.call(server);need(available&&!failed&&server.address===address&&server.listening===true&&a?.address==='127.0.0.1'&&a.family==='IPv4'&&Number.isInteger(port)&&port>1024&&port<=65535&&a.port===port);};
 const actorCheck=actor=>{check();need(Number.isInteger(actor)&&actor>=0&&actor<8);};
 const wire=async(method,path,headers,body,binary=false)=>{check();need(++requests<=600);const result=await exchange(port,method,path,headers,body,binary);check();return result;};
 const registerFile=(fileId,mimeType,expected)=>{need(id(fileId));const prior=files.get(fileId);if(prior){need(prior.mimeType===mimeType&&(!expected||prior.sizeBytes===expected.sizeBytes&&prior.sha256===expected.sha256));}else files.set(fileId,{mimeType,...expected});};
 const roleKeys=actor=>[...seed.members.filter(r=>r.userId===seed.users[actor].id).map(r=>r.positionKey),...seed.globalRoles.filter(r=>r.userId===seed.users[actor].id).map(r=>r.roleKey)].sort();
 const globalKeys=actor=>seed.globalRoles.filter(r=>r.userId===seed.users[actor].id).map(r=>r.roleKey).sort();
 const route=(actor,method,path)=>{
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
  actorCheck(actor);need(message&&typeof message==='object'&&!types.isProxy(message));
  const descriptors=Object.getOwnPropertyDescriptors(message);need(Reflect.ownKeys(descriptors).every(k=>['method','path','json','form','headers'].includes(k)&&Object.hasOwn(descriptors[k],'value')));
  const {method,path,json,form,headers}=message;need(['GET','POST','PUT','PATCH'].includes(method)&&route(actor,method,path)&&!(json!==undefined&&form!==undefined));
  const parallel=method==='POST'&&path==='/contracts/'+versionId+'/approval'&&actor>=1&&actor<=5;
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
   const name=signature?'signature.png':upload===0?'material-purchase-real-v1.docx':'signed-original-'+upload+'.pdf';
   need(file&&file.name===name&&file.type===mime&&file.size===expected.byteLength);
   const bytes=Buffer.from(await file.arrayBuffer());check();need(equal(bytes,Buffer.from(expected)));uploaded={sizeBytes:bytes.length,sha256:sha(bytes),mimeType:mime};
   const boundary='jg-life-'+randomBytes(24).toString('hex');body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: '+mime+'\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
   need(body.length<=uploadCap);h['content-type']='multipart/form-data; boundary='+boundary;if(signature)signatures.add(actor);else upload++;
  }else if(json!==undefined){body=Buffer.from(JSON.stringify(json));need(body.length<=cap);}
  if(path==='/auth/login')need(equal(json,{phone:seed.users[actor].phone,password:passwords[seed.users[actor].id]}));
  if(path==='/contracts')need(equal(json,{projectId:seed.project.id,numericProtocolVersion:2,contractTypeKey:'material_purchase',relationship:'inside',amountLimitType:'capped'}));
  let drained;const pending={parallel,done:new Promise(resolve=>{drained=resolve;})};active.set(actor,pending);
  try{
   const result=await wire(method,path,h,body),value=result.body;
   if(path==='/auth/login'){
    const user=own(value,'user'),token=own(own(value,'tokens'),'accessToken');
    need(result.status===201&&own(user,'id')===seed.users[actor].id&&own(user,'phone')===seed.users[actor].phone&&own(user,'mustChangePassword')===false&&
     equal(own(user,'roleKeys'),roleKeys(actor))&&equal(own(user,'globalRoleKeys'),globalKeys(actor))&&typeof token==='string'&&token.length<=4096&&/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token));
    const claims=verifyToken(token);need(own(claims,'sub')===seed.users[actor].id&&own(claims,'phone')===seed.users[actor].phone&&own(claims,'type')==='access'&&own(claims,'ver')===0);tokens.set(actor,token);
   }else if(path==='/contracts'&&result.status===201){contractId=own(own(value,'contract'),'id');versionId=own(own(value,'version'),'id');need(id(contractId)&&id(versionId)&&contractId!==versionId);}
   else if(path==='/contract-layout-templates'&&result.status===201){layoutId=own(own(value,'version'),'id');need(id(layoutId));}
   else if(path==='/files'&&result.status===201){const fileId=own(value,'id');need(id(fileId)&&!files.has(fileId));registerFile(fileId,uploaded.mimeType,uploaded);}
   else if(path==='/contract-drafts/'+versionId+'/edit-lease'&&result.status===201){lease=own(value,'token');need(typeof lease==='string'&&/^[\w-]{43}$/u.test(lease));}
   else if(path==='/contract-drafts/'+versionId+'/workbench'&&result.status===200){const documents=own(value,'documents');need(Array.isArray(documents)&&documents.length<=4);for(const doc of documents)for(const key of ['docxFileId','pdfFileId'])if(id(own(doc,key)))registerFile(own(doc,key),key==='docxFileId'?docxMime:pdfMime);}
   else if(path.endsWith('/download-ticket')&&result.status===201){const target=path.slice('/files/'.length,-'/download-ticket'.length),url=own(value,'downloadUrl');need(typeof url==='string'&&url.startsWith('/files/'+target+'/download?')&&url.length<=4096&&!/[\r\n#\\]/u.test(url));const known=files.get(target),mimeType=own(value,'mimeType'),sizeBytes=own(value,'sizeBytes');
    need(mimeType===known.mimeType&&Number.isSafeInteger(sizeBytes)&&sizeBytes>0&&sizeBytes<=(mimeType===pdfMime?pdfCap:docxCap)&&(!known.sizeBytes||known.sizeBytes===sizeBytes));
    tickets.set(url,Object.freeze({fileId:target,mimeType,sizeBytes,...(known.sha256?{sha256:known.sha256}:{})}));}
   return result;
  }catch(cause){failed=true;throw cause;}finally{active.delete(actor);drained();}
 }
 const bridge=Object.freeze({check,send,now(){check();return Date.now();},async wait(ms){check();need(ms===1000);await delay(ms);check();},async download(actor,path){
  actorCheck(actor);need(actor===0&&typeof path==='string'&&active.size===0);
  let ticket=tickets.get(path);if(!ticket)for(const [url,entry]of tickets){const candidate=new URL(url,'http://127.0.0.1:'+port);candidate.searchParams.set('expiresAt','2000-01-01T00:00:00.000Z');if(candidate.pathname+candidate.search===path){ticket=entry;break;}}need(ticket);
  let drained;const pending={parallel:false,done:new Promise(resolve=>{drained=resolve;})};active.set('download',pending);
  try{return await wire('GET',path,{},undefined,ticket);}catch(cause){failed=true;throw cause;}finally{active.delete('download');drained();}
 }});
 issued.set(bridge,check);
 try{const result=await consume(bridge);check();need(active.size===0);return result;}
 finally{available=false;issued.delete(bridge);await Promise.allSettled([...active.values()].map(item=>item.done));tokens.clear();tickets.clear();}
}
module.exports=Object.freeze({withCurrent261LocalLifecycleHttp,assertCurrent261LocalLifecycleHttp});
