'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
test('the response-loss purpose binds its actual transport and business interfaces',()=>{
 const api=require('./run-task16-native-cancel-once.cjs');
 const interfaces=api.inspectNativeTask16Interfaces();
 const names=interfaces.flatMap(item=>item.exports.map(entry=>entry.name));
 assert.ok(names.includes('createNativeA16CancelTransport'));assert.ok(names.includes('createNativeA16CancelFault'));
 assert.ok(names.includes('runRegisteredNullCrossCompanyNativeCancellation'));
 const source=fs.readFileSync(require.resolve('./run-task16-native-cancel-once.cjs'),'utf8');
 assert.match(source,/PURPOSE='TASK16_NATIVE_COMMIT_CANCEL_V1'/u);
 assert.match(source,/requestJson:undefined/u);
});

test('the native response-loss barrier fails closed before any payment POST on open, fsync, or cancellation failure',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-cancel-once.cjs');
 const parent=fs.mkdtempSync('/private/tmp/a16-barrier-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const execute=(root,check,badRoot=false,badIdentity=false)=>{const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:badRoot?0:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};return api.runNativeTask16CancelPreparedCase(root,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{if(badIdentity)throw Error('identity');},check,async()=>fetch(`http://127.0.0.1:${server.address().port}/payment`,{method:'POST'}));};
 for(const mode of ['open','symlink','write','fsync','directory-fsync','abort','root-mismatch','identity-mismatch']){const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});let calls=0;const check=()=>{if(mode==='abort'&&++calls===2)throw Error('abort');};
  if(mode==='open')fs.writeFileSync(path.join(root,'cancel-identity.json'),'occupied',{mode:0o600});
  if(mode==='symlink')fs.symlinkSync(path.join(parent,'open','cancel-identity.json'),path.join(root,'cancel-identity.json'));
  const originalWrite=fs.writeFileSync;if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
  const original=fs.fsyncSync;let syncCalls=0;if(mode==='fsync'||mode==='directory-fsync')fs.fsyncSync=fd=>{if(++syncCalls===(mode==='fsync'?1:2))throw Error('fsync');return original(fd);};
  try{await assert.rejects(execute(root,check,mode==='root-mismatch',mode==='identity-mismatch'));}finally{fs.fsyncSync=original;fs.writeFileSync=originalWrite;}assert.equal(posts,0);
 }
 const changed=path.join(parent,'changed-key');fs.mkdirSync(changed,{mode:0o700});const st=fs.lstatSync(changed),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};
 await assert.rejects(api.runNativeTask16CancelPreparedCase(changed,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fixture.ids.requestKey='44444444-4444-4444-8444-444444444444';binding();posts++;}),{code:'NATIVE_A16_CANCEL_BINDING_CHANGED'});assert.equal(posts,0);fixture.ids.requestKey='33333333-3333-4333-8333-333333333333';
 const changedFile=path.join(parent,'changed-file');fs.mkdirSync(changedFile,{mode:0o700});const sf=fs.lstatSync(changedFile),fileRoot={dev:sf.dev,ino:sf.ino,uid:sf.uid,gid:sf.gid,mode:sf.mode};
 await assert.rejects(api.runNativeTask16CancelPreparedCase(changedFile,{...plan,rootIdentity:fileRoot},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fs.writeFileSync(path.join(changedFile,'cancel-identity.json'),'tampered');binding();posts++;}),{code:'NATIVE_A16_CANCEL_BINDING_CHANGED'});assert.equal(posts,0);
 const changedReceipt=path.join(parent,'changed-receipt');fs.mkdirSync(changedReceipt,{mode:0o700});const sr=fs.lstatSync(changedReceipt),receiptRoot={dev:sr.dev,ino:sr.ino,uid:sr.uid,gid:sr.gid,mode:sr.mode},mutableReceipt={planSha256:'b'.repeat(64)};
 await assert.rejects(api.runNativeTask16CancelPreparedCase(changedReceipt,{...plan,rootIdentity:receiptRoot},identity,fixture,mutableReceipt,async()=>{},()=>{},async binding=>{mutableReceipt.cancelIdentity.sha256='c'.repeat(64);binding();posts++;}),{code:'NATIVE_A16_CANCEL_BINDING_CHANGED'});assert.equal(posts,0);
 const root=path.join(parent,'ready');fs.mkdirSync(root,{mode:0o700});await execute(root,()=>{});assert.equal(posts,1);await assert.rejects(execute(root,()=>{}),{code:'EEXIST'});assert.equal(posts,1);
 const raw=fs.readFileSync(path.join(root,'cancel-identity.json'),'utf8');assert.doesNotMatch(raw,/33333333-3333-4333-8333-333333333333/);const record=JSON.parse(raw);assert.equal(record.purpose,'TASK16_NATIVE_COMMIT_CANCEL_V1');assert.equal(record.sourceSealSha256,'d'.repeat(64));assert.equal(record.planSha256,'b'.repeat(64));assert.equal(record.databaseOid,'16384');assert.equal(record.systemIdentifier,'987654321');assert.equal(record.requestKeySha256,require('node:crypto').createHash('sha256').update(fixture.ids.requestKey).digest('hex'));assert.equal(fs.statSync(path.join(root,'cancel-identity.json')).mode&0o777,0o600);
});


test('native cancellation body sidecar failure or mutation sends zero payment requests; successful path cannot retry',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-cancel-once.cjs'),{createNativeA16CancelTransport}=require('./task16-native-a16-cancel-transport.cjs');
 const parent=fs.mkdtempSync('/private/tmp/a16-cancel-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const origin=`http://127.0.0.1:${server.address().port}`,target=new URL(`/payment-executions/${fixture.ids.payment}/registrations`,origin),body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,amountCents:'4000',confirmationPassword:'fictional-private'});
 for(const mode of ['open','write','file-fsync','dir-fsync','abort','tamper','ready']){
  const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode},receipt={planSha256:'b'.repeat(64)};let aborted=false;const check=()=>{if(aborted)throw Error('abort');};
  const run=api.runNativeTask16CancelPreparedCase(root,{...plan,rootIdentity},identity,fixture,receipt,async()=>{},check,async binding=>{
   const prepareBody=api.createNativeCancelBodyBinding(root,receipt,binding);
   if(mode==='open')fs.writeFileSync(path.join(root,'cancel-body.json'),'occupied',{mode:0o600});
   const originalWrite=fs.writeFileSync,originalSync=fs.fsyncSync;let n=0;
   if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
   if(mode==='file-fsync'||mode==='dir-fsync')fs.fsyncSync=fd=>{if(++n===(mode==='file-fsync'?1:2))throw Error('fsync');return originalSync(fd);};
   try{const transport=createNativeA16CancelTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody:text=>{const verify=prepareBody(text);if(mode==='abort')aborted=true;if(mode==='tamper')fs.writeFileSync(path.join(root,'cancel-body.json'),'tampered');return verify;}});
    const result=await transport.fetch(target,{method:'POST',body});assert.equal(result.status,500);transport.assertSubmitted();await assert.rejects(transport.fetch(target,{method:'POST',body}));
    const raw=fs.readFileSync(path.join(root,'cancel-body.json'),'utf8');assert.doesNotMatch(raw,/fictional-private|33333333-3333-4333-8333-333333333333/);assert.equal(JSON.parse(raw).identitySha256,receipt.cancelIdentity.sha256);
   }finally{fs.writeFileSync=originalWrite;fs.fsyncSync=originalSync;}
  });if(mode==='ready'){await run;assert.equal(posts,1);}else{await assert.rejects(run);assert.equal(posts,0);}
 }
});

test('assembled native case never posts before a verified owner lock witness',async()=>{
 const api=require('./run-task16-native-cancel-once.cjs');let posts=0;
 const fault={ownerSql:'owner',readySql:'ready',parseReady(){throw Error('bad proof');},parseOutcome(){throw Error('unreachable');}};
 const transport={assertSubmitted(){throw Error('unreachable');}},receipt={};
 await assert.rejects(api.executeNativeA16CancelCase({fault,sql:async sql=>sql==='owner'?{stdout:'ended'}:{stdout:'bad'},binding(){},verifyIdentity:async()=>{},transport,receipt,runCase:cancel=>cancel(async()=>{posts++;})}));assert.equal(posts,0);assert.equal(receipt.cancelFault,undefined);
});

test('assembled simulated runner binds two sidecars, one HTTP POST and authenticated cancellation evidence',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-cancel-once.cjs'),faultApi=require('./task16-native-a16-cancel-fault.cjs'),{createNativeA16CancelTransport}=require('./task16-native-a16-cancel-transport.cjs');
 const root=fs.mkdtempSync('/private/tmp/a16-assembled-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const runId='7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',planSha256='b'.repeat(64),nonce='c'.repeat(64),plan={runId,source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}},receipt={planSha256};
 const st=fs.lstatSync(root);plan.rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};const origin=`http://127.0.0.1:${server.address().port}`,target=new URL(`/payment-executions/${fixture.ids.payment}/registrations`,origin),body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,confirmationPassword:'fictional-private'});
 const fault=faultApi.createNativeA16CancelFault({nonce,runId,candidateSha:plan.source.head,planSha256,database:{name:'jg_task01_'+runId.replaceAll('-',''),oid:'16384',namespaceOid:'2200',systemIdentifier:'987654321',port:55001},runtime:{oid:'16386',pid:321,startedAt:'2026-11-17T00:00:00.123456Z',clientAddress:'127.0.0.1',clientPort:55002}});
 const ownerStart='2026-11-17T00:00:01.123456Z',witness={pid:456,startedAt:ownerStart};let ownerResolve;const owner=new Promise(resolve=>{ownerResolve=resolve;});
 await api.runNativeTask16CancelPreparedCase(root,plan,identity,fixture,receipt,async()=>{},()=>{},async binding=>{
  const transport=createNativeA16CancelTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody:api.createNativeCancelBodyBinding(root,receipt,binding)});
  return api.executeNativeA16CancelCase({fault,sql:async sql=>sql===fault.ownerSql?owner:{stdout:JSON.stringify({nonce,state:'ready',owner:witness})},binding,verifyIdentity:async()=>{},transport,receipt,runCase:cancel=>cancel(async()=>{await transport.fetch(target,{method:'POST',body});ownerResolve({stdout:JSON.stringify({nonce,mode:'cancel-commit',state:'commit-cancelled',owner:witness,runtimePid:321,runtimeStartedAt:'2026-11-17T00:00:00.123456Z',transactionId:'12',commitStartedAt:'2026-11-17T00:00:02.123456Z'})});})});
 });
 assert.equal(posts,1);assert.equal(receipt.cancelFault.state,'commit-cancelled');assert.equal(receipt.cancelFault.planSha256,planSha256);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cancel-body.json'),'utf8')).identitySha256,receipt.cancelIdentity.sha256);
});

test('a mismatched cancellation proof remains unknown and cannot submit a second time',async()=>{
 const api=require('./run-task16-native-cancel-once.cjs');let posts=0,asserted=false,finishOwner;const owner=new Promise(resolve=>{finishOwner=resolve;}),witness={pid:456};
 const fault={ownerSql:'owner',readySql:'ready',parseReady(){return witness;},parseOutcome(){throw Error('wrong runtime');}},receipt={};
 await assert.rejects(api.executeNativeA16CancelCase({fault,sql:async sql=>sql==='owner'?owner:{stdout:'ready'},binding(){},verifyIdentity:async()=>{},transport:{assertSubmitted(){asserted=true;}},receipt,runCase:cancel=>cancel(async()=>{posts++;finishOwner({stdout:'wrong proof'});})}),/wrong runtime/);
 assert.equal(posts,1);assert.equal(asserted,false);assert.equal(receipt.cancelFault,undefined);
});

test('ledger assembled runner binds both sidecars, the exact single POST and cancellation proof',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-cancel-once.cjs'),faultApi=require('./task16-native-a16-cancel-fault.cjs'),{createNativeA16CancelTransport}=require('./task16-native-a16-cancel-transport.cjs');
 const root=fs.mkdtempSync('/private/tmp/a16-assembled-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const runId='7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',planSha256='b'.repeat(64),nonce='c'.repeat(64),plan={runId,purpose:'TASK16_NATIVE_LEDGER_CANCEL_V1',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}},receipt={planSha256};
 const st=fs.lstatSync(root);plan.rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};const origin=`http://127.0.0.1:${server.address().port}`,target=new URL(`/payment-executions/${fixture.ids.payment}/registrations`,origin),body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,confirmationPassword:'fictional-private'});
 const fault=faultApi.createNativeLedgerA16CancelFault({nonce,runId,candidateSha:plan.source.head,planSha256,database:{name:'jg_task01_'+runId.replaceAll('-',''),oid:'16384',namespaceOid:'2200',systemIdentifier:'987654321',port:55001},runtime:{oid:'16386',pid:321,startedAt:'2026-11-17T00:00:00.123456Z',clientAddress:'127.0.0.1',clientPort:55002},peer:{oid:'16386',pid:322,startedAt:'2026-11-17T00:00:00.223456Z',clientAddress:'127.0.0.1',clientPort:55003}});
 const ownerStart='2026-11-17T00:00:01.123456Z',witness={pid:456,startedAt:ownerStart};let ownerResolve;const owner=new Promise(resolve=>{ownerResolve=resolve;});
 await api.runNativeTask16CancelPreparedCase(root,plan,identity,fixture,receipt,async()=>{},()=>{},async binding=>{
  const transport=createNativeA16CancelTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody:api.createNativeCancelBodyBinding(root,receipt,binding,plan.purpose)});
  return api.executeNativeA16CancelCase({fault,sql:async sql=>sql===fault.ownerSql?owner:{stdout:JSON.stringify({nonce,state:'ready',owner:witness})},binding,verifyIdentity:async()=>{},transport,receipt,runCase:cancel=>cancel(async()=>{await transport.fetch(target,{method:'POST',body});ownerResolve({stdout:JSON.stringify({nonce,mode:'cancel-commit',state:'commit-cancelled',owner:witness,runtimePid:321,runtimeStartedAt:'2026-11-17T00:00:00.123456Z',transactionId:'12',commitStartedAt:'2026-11-17T00:00:02.123456Z'})});})});
 },plan.purpose);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cancel-identity.json'),'utf8')).purpose,plan.purpose);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cancel-body.json'),'utf8')).purpose,plan.purpose);
 assert.equal(posts,1);assert.equal(receipt.cancelFault.state,'commit-cancelled');assert.equal(receipt.cancelFault.planSha256,planSha256);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cancel-body.json'),'utf8')).identitySha256,receipt.cancelIdentity.sha256);
});
