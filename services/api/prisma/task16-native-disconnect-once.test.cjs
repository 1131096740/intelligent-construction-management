'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
test('the response-loss purpose binds its actual transport and business interfaces',()=>{
 const api=require('./run-task16-native-disconnect-once.cjs');
 const interfaces=api.inspectNativeTask16Interfaces();
 const names=interfaces.flatMap(item=>item.exports.map(entry=>entry.name));
 assert.ok(names.includes('createNativeA16DisconnectTransport'));assert.ok(names.includes('createNativeA16DisconnectFault'));
 assert.ok(names.includes('runRegisteredNullCrossCompanyNativeDisconnect'));
 const source=fs.readFileSync(require.resolve('./run-task16-native-disconnect-once.cjs'),'utf8');
 assert.match(source,/PURPOSE='TASK16_NATIVE_COMMIT_DISCONNECT_V1'/u);
 assert.match(source,/requestJson:undefined/u);
});

test('the native response-loss barrier fails closed before any payment POST on open, fsync, or cancellation failure',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-disconnect-once.cjs');
 const parent=fs.mkdtempSync('/private/tmp/a16-barrier-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const execute=(root,check,badRoot=false,badIdentity=false)=>{const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:badRoot?0:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};return api.runNativeTask16DisconnectPreparedCase(root,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{if(badIdentity)throw Error('identity');},check,async()=>fetch(`http://127.0.0.1:${server.address().port}/payment`,{method:'POST'}));};
 for(const mode of ['open','symlink','write','fsync','directory-fsync','abort','root-mismatch','identity-mismatch']){const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});let calls=0;const check=()=>{if(mode==='abort'&&++calls===2)throw Error('abort');};
  if(mode==='open')fs.writeFileSync(path.join(root,'disconnect-identity.json'),'occupied',{mode:0o600});
  if(mode==='symlink')fs.symlinkSync(path.join(parent,'open','disconnect-identity.json'),path.join(root,'disconnect-identity.json'));
  const originalWrite=fs.writeFileSync;if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
  const original=fs.fsyncSync;let syncCalls=0;if(mode==='fsync'||mode==='directory-fsync')fs.fsyncSync=fd=>{if(++syncCalls===(mode==='fsync'?1:2))throw Error('fsync');return original(fd);};
  try{await assert.rejects(execute(root,check,mode==='root-mismatch',mode==='identity-mismatch'));}finally{fs.fsyncSync=original;fs.writeFileSync=originalWrite;}assert.equal(posts,0);
 }
 const changed=path.join(parent,'changed-key');fs.mkdirSync(changed,{mode:0o700});const st=fs.lstatSync(changed),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};
 await assert.rejects(api.runNativeTask16DisconnectPreparedCase(changed,{...plan,rootIdentity},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fixture.ids.requestKey='44444444-4444-4444-8444-444444444444';binding();posts++;}),{code:'NATIVE_A16_DISCONNECT_BINDING_CHANGED'});assert.equal(posts,0);fixture.ids.requestKey='33333333-3333-4333-8333-333333333333';
 const changedFile=path.join(parent,'changed-file');fs.mkdirSync(changedFile,{mode:0o700});const sf=fs.lstatSync(changedFile),fileRoot={dev:sf.dev,ino:sf.ino,uid:sf.uid,gid:sf.gid,mode:sf.mode};
 await assert.rejects(api.runNativeTask16DisconnectPreparedCase(changedFile,{...plan,rootIdentity:fileRoot},identity,fixture,{planSha256:'b'.repeat(64)},async()=>{},()=>{},async binding=>{fs.writeFileSync(path.join(changedFile,'disconnect-identity.json'),'tampered');binding();posts++;}),{code:'NATIVE_A16_DISCONNECT_BINDING_CHANGED'});assert.equal(posts,0);
 const changedReceipt=path.join(parent,'changed-receipt');fs.mkdirSync(changedReceipt,{mode:0o700});const sr=fs.lstatSync(changedReceipt),receiptRoot={dev:sr.dev,ino:sr.ino,uid:sr.uid,gid:sr.gid,mode:sr.mode},mutableReceipt={planSha256:'b'.repeat(64)};
 await assert.rejects(api.runNativeTask16DisconnectPreparedCase(changedReceipt,{...plan,rootIdentity:receiptRoot},identity,fixture,mutableReceipt,async()=>{},()=>{},async binding=>{mutableReceipt.disconnectIdentity.sha256='c'.repeat(64);binding();posts++;}),{code:'NATIVE_A16_DISCONNECT_BINDING_CHANGED'});assert.equal(posts,0);
 const root=path.join(parent,'ready');fs.mkdirSync(root,{mode:0o700});await execute(root,()=>{});assert.equal(posts,1);await assert.rejects(execute(root,()=>{}),{code:'EEXIST'});assert.equal(posts,1);
 const raw=fs.readFileSync(path.join(root,'disconnect-identity.json'),'utf8');assert.doesNotMatch(raw,/33333333-3333-4333-8333-333333333333/);const record=JSON.parse(raw);assert.equal(record.purpose,'TASK16_NATIVE_COMMIT_DISCONNECT_V1');assert.equal(record.sourceSealSha256,'d'.repeat(64));assert.equal(record.planSha256,'b'.repeat(64));assert.equal(record.databaseOid,'16384');assert.equal(record.systemIdentifier,'987654321');assert.equal(record.requestKeySha256,require('node:crypto').createHash('sha256').update(fixture.ids.requestKey).digest('hex'));assert.equal(fs.statSync(path.join(root,'disconnect-identity.json')).mode&0o777,0o600);
});


test('native cancellation body sidecar failure or mutation sends zero payment requests; successful path cannot retry',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-disconnect-once.cjs'),{createNativeA16DisconnectTransport}=require('./task16-native-a16-disconnect-transport.cjs');
 const parent=fs.mkdtempSync('/private/tmp/a16-cancel-');t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}};
 const origin=`http://127.0.0.1:${server.address().port}`,target=new URL(`/payment-executions/${fixture.ids.payment}/registrations`,origin),body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,amountCents:'4000',confirmationPassword:'fictional-private'});
 for(const mode of ['open','write','file-fsync','dir-fsync','abort','tamper','ready']){
  const root=path.join(parent,mode);fs.mkdirSync(root,{mode:0o700});const st=fs.lstatSync(root),rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode},receipt={planSha256:'b'.repeat(64)};let aborted=false;const check=()=>{if(aborted)throw Error('abort');};
  const run=api.runNativeTask16DisconnectPreparedCase(root,{...plan,rootIdentity},identity,fixture,receipt,async()=>{},check,async binding=>{
   const prepareBody=api.createNativeDisconnectBodyBinding(root,receipt,binding);
   if(mode==='open')fs.writeFileSync(path.join(root,'disconnect-body.json'),'occupied',{mode:0o600});
   const originalWrite=fs.writeFileSync,originalSync=fs.fsyncSync;let n=0;
   if(mode==='write')fs.writeFileSync=()=>{throw Error('write');};
   if(mode==='file-fsync'||mode==='dir-fsync')fs.fsyncSync=fd=>{if(++n===(mode==='file-fsync'?1:2))throw Error('fsync');return originalSync(fd);};
   try{const transport=createNativeA16DisconnectTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody:text=>{const verify=prepareBody(text);if(mode==='abort')aborted=true;if(mode==='tamper')fs.writeFileSync(path.join(root,'disconnect-body.json'),'tampered');return verify;}});
    const result=await transport.fetch(target,{method:'POST',body});assert.equal(result.status,500);transport.assertSubmitted();await assert.rejects(transport.fetch(target,{method:'POST',body}));
    const raw=fs.readFileSync(path.join(root,'disconnect-body.json'),'utf8');assert.doesNotMatch(raw,/fictional-private|33333333-3333-4333-8333-333333333333/);assert.equal(JSON.parse(raw).identitySha256,receipt.disconnectIdentity.sha256);
   }finally{fs.writeFileSync=originalWrite;fs.fsyncSync=originalSync;}
  });if(mode==='ready'){await run;assert.equal(posts,1);}else{await assert.rejects(run);assert.equal(posts,0);}
 }
});

test('assembled native case never posts before a verified owner lock witness',async()=>{
 const api=require('./run-task16-native-disconnect-once.cjs');let posts=0;
 const fault={ownerSql:'owner',readySql:'ready',parseReady(){throw Error('bad proof');},parseOutcome(){throw Error('unreachable');}};
 const transport={assertSubmitted(){throw Error('unreachable');}},receipt={};
 await assert.rejects(api.executeNativeA16DisconnectCase({fault,sql:async sql=>sql==='owner'?{stdout:'ended'}:{stdout:'bad'},binding(){},verifyIdentity:async()=>{},lockout:async()=>{},transport,receipt,runCase:cancel=>cancel(async()=>{posts++;})}));assert.equal(posts,0);assert.equal(receipt.disconnectFault,undefined);
});


test('a failed runtime lockout prevents both fault injection and payment POST',async()=>{
 const api=require('./run-task16-native-disconnect-once.cjs');let posts=0,sqlCalls=0;
 await assert.rejects(api.executeNativeA16DisconnectCase({fault:{},sql:async()=>{sqlCalls++;},binding(){},verifyIdentity:async()=>{},lockout:async()=>{throw Error('lockout');},transport:{assertSubmitted(){}},receipt:{},runCase:disconnect=>disconnect(async()=>{posts++;})}),/lockout/);
 assert.equal(sqlCalls,0);assert.equal(posts,0);
});

test('assembled simulated disconnect binds sidecars, lockout, one POST and original-session termination proof',async t=>{
 const path=require('node:path'),http=require('node:http'),api=require('./run-task16-native-disconnect-once.cjs'),faultApi=require('./task16-native-a16-disconnect-fault.cjs'),{createNativeA16DisconnectTransport}=require('./task16-native-a16-disconnect-transport.cjs');
 const root=fs.mkdtempSync('/private/tmp/a16-disconn-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();res.writeHead(500);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const runId='7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',planSha256='b'.repeat(64),nonce='c'.repeat(64),plan={runId,source:{head:'a'.repeat(40),code:{sealSha256:'d'.repeat(64)}}},identity={databaseOid:'16384',systemIdentifier:'987654321'},fixture={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222',requestKey:'33333333-3333-4333-8333-333333333333'}},receipt={planSha256};
 const st=fs.lstatSync(root);plan.rootIdentity={dev:st.dev,ino:st.ino,uid:st.uid,gid:st.gid,mode:st.mode};const origin=`http://127.0.0.1:${server.address().port}`,target=new URL(`/payment-executions/${fixture.ids.payment}/registrations`,origin),body=JSON.stringify({idempotencyKey:fixture.ids.requestKey,confirmationPassword:'fictional-private'});
 const fault=faultApi.createNativeA16DisconnectFault({nonce,runId,candidateSha:plan.source.head,planSha256,database:{name:'jg_task01_'+runId.replaceAll('-',''),oid:'16384',namespaceOid:'2200',systemIdentifier:'987654321',port:55001},runtime:{oid:'16386',pid:321,startedAt:'2026-11-17T00:00:00.123456Z',clientAddress:'127.0.0.1',clientPort:55002}});
 const witness={pid:456,startedAt:'2026-11-17T00:00:01.123456Z'};let ownerResolve,locked=false,retired=false;const owner=new Promise(resolve=>{ownerResolve=resolve;});
 await api.runNativeTask16DisconnectPreparedCase(root,plan,identity,fixture,receipt,async()=>{},()=>{},async binding=>{
  const transport=createNativeA16DisconnectTransport({origin,payment:fixture.ids.payment,key:fixture.ids.requestKey,check:binding,prepareBody:api.createNativeDisconnectBodyBinding(root,receipt,binding)});
  return api.executeNativeA16DisconnectCase({fault,sql:async sql=>{assert.equal(locked,true);return sql===fault.ownerSql?owner:{stdout:JSON.stringify({nonce,state:'ready',owner:witness})};},binding,verifyIdentity:async()=>{},lockout:async()=>{locked=true;},transport,receipt,runCase:async disconnect=>{await disconnect(async()=>{assert.equal(locked,true);await transport.fetch(target,{method:'POST',body});ownerResolve({stdout:JSON.stringify({nonce,mode:'disconnect-commit',state:'commit-disconnected',owner:witness,runtimePid:321,runtimeStartedAt:'2026-11-17T00:00:00.123456Z',transactionId:'12',commitStartedAt:'2026-11-17T00:00:02.123456Z'})});});retired=true;}});
 });
 assert.equal(posts,1);assert.equal(retired,true);assert.equal(receipt.disconnectFault.state,'commit-disconnected');assert.equal(receipt.disconnectFault.planSha256,planSha256);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'disconnect-body.json'),'utf8')).identitySha256,receipt.disconnectIdentity.sha256);
});

test('retirement failure retains owned handles for outer cleanup and never declares runtime retired',async()=>{
 const api=require('./run-task16-native-disconnect-once.cjs'),calls=[];
 await assert.rejects(api.retireNativeA16Runtime({app:{async close(){calls.push('app');throw Error('close');}},module:{async close(){calls.push('module');}},runtime:{$disconnect:async()=>calls.push('runtime')},owner:{},observer:{},state:{setApplication(){calls.push('clear-app');},setClients(){calls.push('clear-clients');}},cleanupWait:fn=>fn(),binding(){}}),/close/);
 assert.deepEqual(calls,['app']);
});
