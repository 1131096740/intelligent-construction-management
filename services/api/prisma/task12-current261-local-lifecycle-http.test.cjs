'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
function model(mode){
 const users=Array.from({length:8},(_,i)=>({id:id(i+1),phone:'1990000000'+i})),passwords=Object.fromEntries(users.map((u,i)=>[u.id,String(i).repeat(64)]));
 const fixture={approval:{users,handler:users[0],project:{id:id(20)},members:[{userId:users[0].id,positionKey:'contract_staff'},{userId:users[3].id,positionKey:'project_manager'}],globalRoles:[[1,'material_director'],[2,'contract_director'],[4,'finance_director'],[5,'general_manager'],[6,'comprehensive_director']].map(([actor,roleKey])=>({userId:users[actor].id,roleKey}))}};
 const config=Object.freeze({fixture,passwords,sourceDocx:Buffer.from('model-docx'),originals:[Buffer.from('%PDF-original1'),Buffer.from('%PDF-original2')]}),calls=[];
 const server={listening:true,address(){return{address:'127.0.0.1',family:'IPv4',port:24080};}};let live=true,claimed=false;
 const imports={'./task12-current259-document-application.cjs':{takeCurrent261LocalLifecycleHttpBridge(c,s){assert.equal(c,config);assert.equal(s,server);assert.equal(claimed,false);claimed=true;}},'node:http':{request(options,consume){const outgoing=new EventEmitter();outgoing.end=wire=>{calls.push({options,wire});queueMicrotask(()=>{const response=new EventEmitter();response.complete=true;response.socket={remoteAddress:mode==='foreign-peer'?'127.0.0.2':'127.0.0.1',remotePort:24080};response.headers=mode==='redirect'?{location:'https://invalid.example'}:{};response.statusCode=201;response.destroy=()=>{};const actor=options.path==='/auth/login'?users.findIndex(u=>u.phone===JSON.parse(wire).phone):0,roles=[...fixture.approval.members.filter(r=>r.userId===users[actor].id).map(r=>r.positionKey),...fixture.approval.globalRoles.filter(r=>r.userId===users[actor].id).map(r=>r.roleKey)];let body=options.path==='/auth/login'?{user:{id:users[actor].id,phone:users[actor].phone,mustChangePassword:false,roleKeys:roles,globalRoleKeys:fixture.approval.globalRoles.filter(r=>r.userId===users[actor].id).map(r=>r.roleKey)},tokens:{accessToken:actor?'model'+actor+'.access.token':'model.access.token'}}:{contract:{id:id(21)},version:{id:id(22)}};if(options.path.endsWith('/workbench')){body={documents:[{docxFileId:id(50),pdfFileId:id(51)}]};response.statusCode=200;}
 if(options.path.endsWith('/download-ticket'))body={downloadUrl:'/files/'+id(51)+'/download?token=model',mimeType:'application/pdf',sizeBytes:1024*1024};
 const binary=options.path.includes('/download?');let bytes=Buffer.from(JSON.stringify(body));if(binary){bytes=Buffer.alloc(1024*1024,65);Buffer.from('%PDF-').copy(bytes);response.statusCode=200;response.headers={'content-type':mode==='wrong-mime'?'text/html':'application/pdf','content-length':String(mode==='wrong-size'?bytes.length+1:bytes.length)};}
 consume(response);response.emit('data',bytes.subarray(0,100));response.emit('data',bytes.subarray(100));response.emit('end');});};return outgoing;}}};
 const holder={exports:{}};new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-current261-local-lifecycle-http.cjs'),'utf8'))(name=>imports[name]??require(name),holder);
 return{api:holder.exports,config,server,calls,close(){live=false;},verify(){assert.equal(live,true);},verifyToken(token){const actor=Number(token.match(/^model(\d*)\./u)[1]||0);return{sub:users[actor].id,phone:users[actor].phone,type:'access',ver:0};}};
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
