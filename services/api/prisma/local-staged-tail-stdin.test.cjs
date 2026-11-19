"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createCommandRuntime}=require('./money-bigint-runner-runtime.cjs');

test('tail SQL stdin is delivered as UTF8 bytes with backpressure, never in argv',async()=>{
 const runtime=createCommandRuntime();const payload='甲'.repeat(200000);
 try{
  const result=await runtime.command(process.execPath,['-e',`let n=0;process.stdin.on('data',c=>{n+=c.length;process.stdin.pause();setTimeout(()=>process.stdin.resume(),1)});process.stdin.on('end',()=>process.stdout.write(String(n)))`],{stdinText:payload,timeoutMs:5000,maxOutputBytes:100});
  assert.equal(result.stdout,String(Buffer.byteLength(payload)));assert.equal(runtime.activeCount(),0);
 }finally{await runtime.stopAll();}
});
for(const [name,value]of [['NUL','select\0'],['invalidUTF8','\ud800'],['oversized','x'.repeat(16*1024*1024+1)]])test(`tail stdin rejects ${name} before spawn`,async()=>{
 let calls=0;const runtime=createCommandRuntime({spawnCommand(){calls++;throw new Error('spawn must not occur');}});
 await assert.rejects(runtime.command('synthetic',[],{stdinText:value}),/STDIN/u);assert.equal(calls,0);
});
test('tail stdin treats early child exit as failed transport and drains no further writes',async()=>{
 const runtime=createCommandRuntime();try{
  await assert.rejects(runtime.command(process.execPath,['-e','process.exit(0)'],{stdinText:'x'.repeat(8*1024*1024),timeoutMs:5000,maxOutputBytes:100}),/STDIN/u);
  assert.equal(runtime.activeCount(),0);
 }finally{await runtime.stopAll();}
});

test('cancelling a backpressured tail stdin terminates its writer and child',async()=>{
 const runtime=createCommandRuntime({terminationGraceMs:50});
 const job=runtime.command(process.execPath,['-e','process.stdin.pause();setInterval(()=>{},1000)'],{stdinText:'x'.repeat(8*1024*1024),timeoutMs:5000,maxOutputBytes:100});
 const rejected=assert.rejects(job,/STDIN|failed/u);
 await new Promise(resolve=>setTimeout(resolve,20));await runtime.stopAll();await rejected;
 assert.equal(runtime.activeCount(),0);
});
