'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
test('the response-loss purpose binds its actual transport and business interfaces',()=>{
 const api=require('./run-task16-native-response-loss-once.cjs');
 const interfaces=api.inspectNativeTask16Interfaces();
 const names=interfaces.flatMap(item=>item.exports.map(entry=>entry.name));
 assert.ok(names.includes('createNativeResponseLossTransport'));
 assert.ok(names.includes('runRegisteredNullCrossCompanyNativeResponseLoss'));
 const source=fs.readFileSync(require.resolve('./run-task16-native-response-loss-once.cjs'),'utf8');
 assert.match(source,/PURPOSE='TASK16_NATIVE_RESPONSE_LOSS_V1'/u);
 assert.match(source,/requestJson:undefined/u);
});

test('the native response-loss barrier fails closed before any payment POST on open, fsync, or cancellation failure',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-response-loss-once.cjs');
 const parent=fs.mkdtempSync('/private/tmp/a16-barrier-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const execute=(root,check,badRoot=false,badIdentity=false)=>{const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:badRoot?0:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};return api.runNativeTask16ResponseLossPreparedCase(root,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{if(badIdentity)throw Error('identity');},check,async()=>fetch(`http://127.0.0.1:${server.address().port}/payment`,{method:'POST'}));};
 for(const mode of ['open','symlink','write','fsync','directory-fsync','abort','root-mismatch','identity-mismatch']){const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});let calls=0;const check=()=>{if(mode==='abort'&&++calls===2)throw Error('abort');};
  if(mode==='open')fs.writeFileSync(path.join(root,'response-loss-identity.json'),'occupied',{mode:0o600});
  if(mode==='symlink')fs.symlinkSync(path.join(parent,'open','response-loss-identity.json'),path.join(root,'response-loss-identity.json'));
  const originalWrite=fs.writeFileSync;if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
  const original=fs.fsyncSync;let syncCalls=0;if(mode==='fsync'||mode==='directory-fsync')fs.fsyncSync=fd=>{if(++syncCalls===(mode==='fsync'?1:2))throw Error('fsync');return original(fd);};
  try{await assert.rejects(execute(root,check,mode==='root-mismatch',mode==='identity-mismatch'));}finally{fs.fsyncSync=original;fs.writeFileSync=originalWrite;}assert.equal(posts,0);
 }
 const changed=path.join(parent,'changed-key');fs.mkdirSync(changed,{mode:0o700});const st=fs.lstatSync(changed),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};
 await assert.rejects(api.runNativeTask16ResponseLossPreparedCase(changed,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fixture.ids.requestKey='44444444-4444-4444-8444-444444444444';binding();posts++;}),{code:'NATIVE_RESPONSE_LOSS_BINDING_CHANGED'});assert.equal(posts,0);fixture.ids.requestKey='33333333-3333-4333-8333-333333333333';
 const changedFile=path.join(parent,'changed-file');fs.mkdirSync(changedFile,{mode:0o700});const sf=fs.lstatSync(changedFile),fileRoot={dev:sf.dev,ino:sf.ino,uid:sf.uid,gid:sf.gid,mode:sf.mode};
 await assert.rejects(api.runNativeTask16ResponseLossPreparedCase(changedFile,{...plan,rootIdentity:fileRoot},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fs.writeFileSync(path.join(changedFile,'response-loss-identity.json'),'tampered');binding();posts++;}),{code:'NATIVE_RESPONSE_LOSS_BINDING_CHANGED'});assert.equal(posts,0);
 const changedReceipt=path.join(parent,'changed-receipt');fs.mkdirSync(changedReceipt,{mode:0o700});const sr=fs.lstatSync(changedReceipt),receiptRoot={dev:sr.dev,ino:sr.ino,uid:sr.uid,gid:sr.gid,mode:sr.mode},mutableReceipt={planSha256:'b'.repeat(64)};
 await assert.rejects(api.runNativeTask16ResponseLossPreparedCase(changedReceipt,{...plan,rootIdentity:receiptRoot},identity,fixture,mutableReceipt,async()=>{},()=>{},async binding=>{mutableReceipt.responseLossIdentity.sha256='c'.repeat(64);binding();posts++;}),{code:'NATIVE_RESPONSE_LOSS_BINDING_CHANGED'});assert.equal(posts,0);
 const root=path.join(parent,'ready');fs.mkdirSync(root,{mode:0o700});await execute(root,()=>{});assert.equal(posts,1);await assert.rejects(execute(root,()=>{}),{code:'EEXIST'});assert.equal(posts,1);
 const raw=fs.readFileSync(path.join(root,'response-loss-identity.json'),'utf8');assert.doesNotMatch(raw,/33333333-3333-4333-8333-333333333333/);const record=JSON.parse(raw);assert.equal(record.purpose,'TASK16_NATIVE_RESPONSE_LOSS_V1');assert.equal(record.sourceSealSha256,'d'.repeat(64));assert.equal(record.planSha256,'b'.repeat(64));assert.equal(record.databaseOid,'16384');assert.equal(record.systemIdentifier,'987654321');assert.equal(record.requestKeySha256,require('node:crypto').createHash('sha256').update(fixture.ids.requestKey).digest('hex'));assert.equal(fs.statSync(path.join(root,'response-loss-identity.json')).mode&0o777,0o600);
});

test('actual sidecar and transport assembly stops before POST when body digest cannot be persisted',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-response-loss-once.cjs'),{createNativeResponseLossTransport}=require('./task16-native-response-loss-transport.cjs');
 assert.equal(typeof api.createNativeResponseLossBodyBinding,'function');
 const parent=fs.mkdtempSync('/private/tmp/a16-body-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));let posts=0;
 const server=http.createServer((req,res)=>{posts++;req.resume();req.on('end',()=>{res.writeHead(201);res.end('{}');});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const origin=`http://127.0.0.1:${server.address().port}`,route=`/payment-executions/${fixture.ids.payment}/registrations`,body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,amountCents:'4000',confirmationPassword:'fictional-private'});
 for(const mode of ['open','write','file-fsync','dir-fsync','abort','tamper','replay-sidecar-tamper','ready']){
  const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode},receipt={planSha256:'b'.repeat(64)};
  let aborted=false;const check=()=>{if(aborted)throw Error('cancelled');};
  const run=api.runNativeTask16ResponseLossPreparedCase(root,{...plan,rootIdentity},identity,fixture,receipt,async()=>{},check,async binding=>{
   const prepareBody=api.createNativeResponseLossBodyBinding(root,receipt,binding);
   if(mode==='open')fs.writeFileSync(path.join(root,'response-loss-body.json'),'occupied',{mode:0o600});
   const originalWrite=fs.writeFileSync,originalSync=fs.fsyncSync;let n=0;
   if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
   if(mode==='file-fsync'||mode==='dir-fsync')fs.fsyncSync=fd=>{if(++n===(mode==='file-fsync'?1:2))throw Error('fsync');return originalSync(fd);};
   const transport=await createNativeResponseLossTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody: text=>{const verify=prepareBody(text);if(mode==='abort')aborted=true;if(mode==='tamper')fs.writeFileSync(path.join(root,'response-loss-body.json'),'tampered');return verify;}});
   try{await transport.lose(()=>transport.fetch(new URL(route,origin),{method:'POST',body}));if(mode==='replay-sidecar-tamper'){fs.writeFileSync(path.join(root,'response-loss-body.json'),'tampered');transport.authorizeReplay();await transport.fetch(new URL(route,origin),{method:'POST',body});}if(mode==='ready'){const raw=fs.readFileSync(path.join(root,'response-loss-body.json'),'utf8');assert.doesNotMatch(raw,/fictional-private|33333333-3333-4333-8333-333333333333/);const proof=JSON.parse(raw);assert.equal(proof.identitySha256,receipt.responseLossIdentity.sha256);assert.match(proof.bodyHmacSha256,/^[a-f0-9]{64}$/u);assert.equal(fs.statSync(path.join(root,'response-loss-body.json')).mode&0o777,0o600);transport.authorizeReplay();await assert.rejects(transport.fetch(new URL(route,origin),{method:'POST',body:body.replace('4000','5000')}));assert.equal(posts,2);await transport.fetch(new URL(route,origin),{method:'POST',body});transport.assertCompleted();}}finally{fs.writeFileSync=originalWrite;fs.fsyncSync=originalSync;await transport.close();}
  });
  if(mode==='ready'){await run;assert.equal(posts,3);}else{await assert.rejects(run);assert.equal(posts,mode==='replay-sidecar-tamper'?1:0);}
 }
});
