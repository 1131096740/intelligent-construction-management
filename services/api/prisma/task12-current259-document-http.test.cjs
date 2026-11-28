'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path');
const coordinate=i=>'f0000000-0000-4000-8000-00000000000'+i;
const [projectId,handlerId,directorId,contractId,versionId,layoutId,sourceId]=[1,2,3,4,5,6,7].map(coordinate);
const expiry='2026-11-12T09:00:00.000Z',fields=Object.freeze({contractName:'隔离材料合同',ownerName:'隔离甲方单位',counterpartyName:'隔离乙方单位'});
const ownerScope=Object.freeze({});
const handler={id:handlerId,phone:'19900000001'},director={id:directorId,phone:'19900000002'};
const token1='handler.access.token',token2='director.access.token',lease='a'.repeat(43);
const credentials=Object.freeze({handler:'d'.repeat(64),director:'e'.repeat(64)});
const fixture={handler,project:{id:projectId},users:[handler,director],globalRoles:[{roleKey:'contract_director',userId:directorId}]};
const workbench={version:{id:versionId,status:'draft'},lease:{state:'held_by_me'}};
const json={'content-type':'application/json'};

function model(mode){
 let port=24080,claimed=false;
 const requests=[];
 const server={listening:true,address(){return {address:'127.0.0.1',family:'IPv4',port};}};
 const entries={
  async publishTask12GeneratedMaterialTemplate(source,actor,{send}){
   assert.equal(actor,directorId);
   const form=new FormData();
   form.append('file',new Blob([source],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),
    'material-purchase-real-v1.docx');
   await send({method:'POST',path:'/files',form});
   await send({method:'POST',path:'/contract-layout-templates',json:{docxFileId:sourceId}});
   const prefix='/contract-layout-template-versions/'+layoutId+'/';
   for(const [method,route] of [['GET','source-positions'],['PATCH','source-mapping'],['POST','inspection'],
    ['POST','preview-generation'],['GET','preview-generation'],['POST','source-mapping-confirmation'],['POST','submission'],['POST','publication']]){
    await send({method,path:prefix+(mode==='wrong-template-route'&&route==='publication'?'discard':route)});
   }
   return Object.freeze({layoutId,sourceFileId:sourceId});
  },
  async saveTask12GeneratedDocumentDraft(opened,actor,published,port){
   assert.equal(opened.versionId,versionId);assert.equal(actor,handlerId);assert.equal(published.layoutId,layoutId);
   await port.readDraftWorkbench();await port.saveDraft({version:2});await port.readDraftWorkbench();
   return Object.freeze({status:'DRAFT_DOCUMENT_SAVE_READBACK_MATCHED',projectId,contractId,versionId,layoutId,
    leaseRevision:1,leaseExpiresAt:expiry,sourceRevision:2,documentContentRevision:3,documentContentFingerprint:'a'.repeat(64),fields});
  },
  async runTask12GeneratedDocument(input,{send}){
   assert.deepEqual(input.lease,{token:lease,leaseRevision:1,expiresAt:expiry});
   const base='/contract-drafts/'+versionId;
   await send({method:'POST',path:base+'/edit-lease/heartbeat',headers:{'x-contract-draft-lease':lease}});
   await send({method:'POST',path:base+'/preview-generation',json:{sourceRevision:input.sourceRevision}});
   await send({method:'GET',path:base+'/workbench',headers:{'x-contract-numeric-protocol':'2'}});
   return Object.freeze({status:'DRAFT_WORD_PDF_COORDINATES_MATCHED',versionId});
  },
  async readTask12GeneratedDocumentOutputs(coordinates,input){
   assert.equal(coordinates.versionId,versionId);
   const {port,actorId,accessToken,confirmationPassword}=input;
   assert.deepEqual({port,actorId,accessToken,confirmationPassword},{port:24080,actorId:handlerId,accessToken:token1,
    confirmationPassword:credentials.handler});
   assert.equal(input.ownerScope,ownerScope);assert.equal(input.fields,fields);
   const pages=await input.readPdfDrawnText(Buffer.from('inert-pdf'),AbortSignal.timeout(200));
   return {pages:pages.length};
  }
 };
 const bridge=Object.freeze({fixture,passwords:credentials,entries,async openDraft(expected,password,send){
  assert.equal(expected,fixture);assert.equal(password,credentials.handler);
  const login=await send({method:'POST',path:'/auth/login',headers:json,json:{phone:handler.phone,password}});
  const headers={authorization:'Bearer '+login.body.tokens.accessToken,...json,'x-contract-numeric-protocol':'2'};
  const run=(method,path,json)=>send({method,path,headers,json});
  await run('GET','/contracts/create-capability?projectId='+projectId+'&relationship=inside');
  await run('POST','/contracts',{projectId,numericProtocolVersion:2,contractTypeKey:'material_purchase',relationship:'inside',amountLimitType:'capped'});
  await run('POST','/contract-drafts/'+versionId+'/edit-lease');
  await run('GET','/contract-drafts/'+(mode==='route'?contractId:versionId)+'/workbench');
  return {status:'DRAFT_ADMISSION_PROTOCOL_MATCHED',projectId,contractId,versionId,leaseRevision:1};
 }});
 const imports={
  './task12-current259-document-application.cjs':{takeCurrent259GeneratedDocumentHttpBridge(config,owned){
   if(claimed||config!==bridge||owned!==server)throw Error('HANDLE');claimed=true;
  }},
  'node:http':{request(options,consume){
   const out=new EventEmitter();
   out.end=wire=>{
    const multipart=String(options.headers['content-type']).startsWith('multipart/form-data;');
    requests.push({options,body:wire&&(multipart?wire.toString():JSON.parse(wire))});
    assert.equal(options.hostname,'127.0.0.1');assert.equal(options.port,24080);
    assert.equal(options.headers.Host,'127.0.0.1:24080');assert.equal(options.agent,false);
    assert.ok(options.signal instanceof AbortSignal);
    queueMicrotask(()=>{
     const r=new EventEmitter();
     r.complete=true;r.socket={remoteAddress:mode==='peer'?'127.0.0.2':'127.0.0.1',remotePort:24080};
     r.headers=mode==='redirect'?{location:'https://inert.invalid'}:{};
     r.statusCode=mode==='redirect-status'?302:200;r.destroy=()=>{};
     let body=workbench;
     const last=requests.at(-1);
     if(last.options.path==='/auth/login'){
      const isDirector=last.body.phone===director.phone,actor=isDirector?director:handler;
      if(mode!=='redirect-status')r.statusCode=201;
      const role=isDirector?'contract_director':'contract_staff';
      body={user:{id:mode==='director-id'&&isDirector?handlerId:actor.id,phone:actor.phone,mustChangePassword:false,
       roleKeys:[role],globalRoleKeys:isDirector&&mode!=='director-scope'?[role]:[]},
       tokens:{accessToken:isDirector?token2:token1,refreshToken:'never-return-refresh-token'}};
     }else if(last.options.path.endsWith('/edit-lease'))body={token:lease,expiresAt:expiry};
     else if(last.options.path==='/files'){body={id:sourceId};assert.ok(multipart);}
     else if(last.options.path==='/contract-layout-templates')body={version:{id:layoutId}};
     else if(last.options.method==='GET'&&last.options.path.endsWith('/preview-generation'))body={status:'succeeded'};
     if(mode==='port-drift')port++;
     consume(r);
     r.emit('data',mode==='response-size'?Buffer.alloc(512*1024+1):Buffer.from(JSON.stringify(body)));
     r.emit('end');
    });
   };
   return out;
  }}
 };
 const file=path.join(__dirname,'task12-current259-document-http.cjs'),mod={exports:{}};
 new Function('require','module',fs.readFileSync(file,'utf8'))(key=>imports[key]??require(key),mod);
 const verifyToken=token=>{
  const actor=token===token2&&mode!=='director-jwt'?director:handler;
  return {sub:actor.id,phone:actor.phone,type:'access',ver:0};
 };
 return {run:use=>mod.exports.withCurrent259DocumentHttp(bridge,server,()=>{},verifyToken,use),
  api:mod.exports,requests,server};
}

test('opens one real-protocol draft, keeps both credentials private and binds PUT and GET to the same held version',async()=>{
 const f=model();let escaped;
 const result=await f.run(async http=>{
  escaped=http;
  assert.deepEqual(Object.keys(http),['publishMaterialTemplate','openDraft','readDraftWorkbench','saveDraft','saveGeneratedDraft','generateDocument','readDocumentOutputs']);
  assert.deepEqual(await http.openDraft(),{status:'DRAFT_ADMISSION_PROTOCOL_MATCHED',projectId,contractId,versionId,leaseRevision:1});
  assert.deepEqual(await http.readDraftWorkbench(),{status:200,body:workbench});
  assert.deepEqual(await http.saveDraft({numericProtocolVersion:2}),{status:200,body:workbench});
  assert.deepEqual(await http.readDraftWorkbench(),{status:200,body:workbench});
  return false;
 });
 assert.equal(result,false);
 assert.throws(()=>escaped.readDraftWorkbench(),/DOCUMENT_HTTP/u);
 assert.deepEqual(f.requests.map(row=>row.options.method),['POST','POST','GET','POST','POST','GET','GET','PUT','GET']);
 assert.deepEqual(f.requests.slice(0,2).map(row=>row.body),[
  {phone:director.phone,password:credentials.director},{phone:handler.phone,password:credentials.handler}]);
 const put=f.requests.at(-2).options;
 assert.equal(put.path,'/contract-drafts/'+versionId);
 assert.equal(put.headers.authorization,'Bearer '+token1);
 assert.equal(put.headers['x-contract-draft-lease'],lease);
});

for(const mode of ['director-id','director-scope','director-jwt','peer','redirect','redirect-status','response-size','port-drift']){
 test('fails before the program on '+mode,async()=>{
  const f=model(mode);
  await assert.rejects(f.run(()=>assert.fail('business callback reached')),/DOCUMENT_HTTP/u);
  assert.equal(f.requests.length,1);
 });
}

test('a changed version stops before workbench; a body over the bound sends no PUT',async()=>{
 const changed=model('route');
 await assert.rejects(changed.run(http=>http.openDraft()),/DOCUMENT_HTTP/u);
 assert.equal(changed.requests.length,5);
 const bounded=model();
 await assert.rejects(bounded.run(async http=>{
  await http.openDraft();await http.readDraftWorkbench();return http.saveDraft({oversize:'x'.repeat(512*1024)});
 }),/DOCUMENT_HTTP/u);
 assert.equal(bounded.requests.length,7);
});

test('plain coordinates cannot claim the module and premature callback success never certifies a request',async()=>{
 const f=model();
 await assert.rejects(f.api.withCurrent259DocumentHttp({},f.server,()=>{},()=>{},()=>{}),/HANDLE/u);
 await assert.rejects(f.run(http=>{void http.openDraft();return 1;}),/DOCUMENT_HTTP/u);
});

test('same listener binds director publication, original handler save and generation plus private dual-format readback',async()=>{
 const f=model();
 const result=await f.run(async http=>{
  const published=await http.publishMaterialTemplate(Buffer.from('inert-template'));
  const opened=await http.openDraft();
  const saved=await http.saveGeneratedDraft(opened,published);
  const generation=await http.generateDocument(published,saved);
  return http.readDocumentOutputs(generation,ownerScope,saved.fields,async bytes=>{
   assert.equal(bytes.toString(),'inert-pdf');return ['page'];
  });
 });
 assert.deepEqual(result,{pages:1});
 const template=f.requests.slice(1,11);
 assert.equal(template.length,10);assert.ok(template.every(row=>row.options.headers.authorization==='Bearer '+token2));
 assert.match(template[0].body,/filename="material-purchase-real-v1\.docx"/u);
 assert.match(template[0].body,/inert-template/u);
 assert.equal(f.requests.filter(row=>row.options.path==='/auth/login').length,2);
 const heartbeat=f.requests.find(row=>row.options.path.endsWith('/heartbeat'));
 assert.equal(heartbeat.options.headers['x-contract-draft-lease'],lease);
 assert.equal(heartbeat.options.headers.authorization,'Bearer '+token1);
});
test('stops a drifted publication route and rejects a copied saved handoff before queuing',async()=>{
 const drift=model('wrong-template-route');
 await assert.rejects(drift.run(http=>http.publishMaterialTemplate(Buffer.from('inert-template'))),/DOCUMENT_HTTP/u);
 assert.ok(!drift.requests.some(row=>row.options.path.endsWith('/discard')));
 const copied=model();
 await assert.rejects(copied.run(async http=>{
  const published=await http.publishMaterialTemplate(Buffer.from('inert-template'));
  const opened=await http.openDraft();
  const saved=await http.saveGeneratedDraft(opened,published);
  return http.generateDocument(published,{...saved});
 }),/DOCUMENT_HTTP/u);
 assert.ok(!copied.requests.some(row=>row.options.path==='/contract-drafts/'+versionId+'/preview-generation'));
});
