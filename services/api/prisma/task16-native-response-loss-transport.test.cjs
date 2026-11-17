'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createNativeResponseLossTransport}=require('./task16-native-response-loss-transport.cjs');
test('complete upstream response is dropped once and replay only accepts the original command',async()=>{
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();req.on('end',()=>{res.writeHead(201);res.end('{}');});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,payment='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002',route=`/payment-executions/${payment}/registrations`;
 try {const c=await createNativeResponseLossTransport({origin,payment,key,check(){},prepareBody:()=>()=>{}}),init={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idempotencyKey:key,amountCents:'4000'})};
 const proof=await c.lose(()=>c.fetch(new URL(route,origin),init));assert.deepEqual(proof,{faultState:'dropped',upstreamStatusCode:201});assert.equal(posts,1);await assert.rejects(c.fetch(new URL(route,origin),init));assert.equal(posts,1);c.authorizeReplay();
 await assert.rejects(c.fetch(new URL(route,origin),{...init,body:JSON.stringify({idempotencyKey:key,amountCents:'5000'})}));assert.equal(posts,1);
 const replay=await c.fetch(new URL(route,origin),init);assert.equal(replay.status,201);assert.equal(posts,2);c.assertCompleted();await c.close();
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('an incomplete upstream response cannot authorize replay',async()=>{
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();req.on('end',()=>{res.writeHead(201,{'content-length':'100'});res.write('{}');res.destroy();});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,payment='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002',route=`/payment-executions/${payment}/registrations`;
 try{const c=await createNativeResponseLossTransport({origin,payment,key,check(){},prepareBody:()=>()=>{}}),init={method:'POST',body:JSON.stringify({idempotencyKey:key})};await assert.rejects(c.lose(()=>c.fetch(new URL(route,origin),init)));assert.throws(()=>c.authorizeReplay());assert.equal(posts,1);await c.close();}finally{await new Promise(resolve=>server.close(resolve));}
});

test('transport cannot be created without mandatory body binding',async()=>{
 await assert.rejects(createNativeResponseLossTransport({origin:'http://127.0.0.1:30001',payment:'00000000-0000-4000-8000-000000000001',key:'00000000-0000-4000-8000-000000000002',check(){}}),{code:'NATIVE_RESPONSE_LOSS_TRANSPORT'});
});
