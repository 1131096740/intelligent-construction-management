'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createNativeA16CancelTransport}=require('./task16-native-a16-cancel-transport.cjs');
test('requires durable body binding before the only POST and forbids retries',async t=>{
 let posts=0;const server=http.createServer((req,res)=>{posts++;req.resume();req.on('end',()=>{res.writeHead(500);res.end('{}');});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`,payment='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002',target=new URL(`/payment-executions/${payment}/registrations`,origin),init={method:'POST',body:JSON.stringify({idempotencyKey:key})};
 const failed=createNativeA16CancelTransport({origin,payment,key,check(){},prepareBody(){throw Error('sync');}});await assert.rejects(failed.fetch(target,init));assert.equal(posts,0);
 let checks=0;const good=createNativeA16CancelTransport({origin,payment,key,check(){},prepareBody(){return ()=>{checks++;};}});assert.equal((await good.fetch(target,init)).status,500);await assert.rejects(good.fetch(target,init));await assert.rejects(good.fetch(new URL('/other',origin),init));assert.equal(posts,1);assert.equal(checks,1);
});
