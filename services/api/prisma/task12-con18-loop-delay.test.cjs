'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function model(options={}){
 const holder={exports:{}},calls=[];
 const histogram={count:options.count??1,max:options.max??1,enable(){calls.push('enable');if(options.enableFailure)throw Error('PRIVATE_ENABLE');},disable(){calls.push('disable');if(options.disableFailure)throw Error('PRIVATE_DISABLE');}};
 const perf={monitorEventLoopDelay(config){assert.deepEqual(config,{resolution:10});if(options.createFailure)throw Error('PRIVATE_CREATE');return histogram;}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-con18-loop-delay.cjs'),'utf8'))(name=>name==='node:perf_hooks'?perf:require(name),holder);
 return {api:holder.exports,calls};
}
for(const [ns,bucket] of [[0,'UNDER_100_MS'],[99999999,'UNDER_100_MS'],[100000000,'100_TO_499_MS'],[499999999,'100_TO_499_MS'],[500000000,'500_TO_999_MS'],[999999999,'500_TO_999_MS'],[1000000000,'1000_TO_4999_MS'],[4999999999,'1000_TO_4999_MS'],[5000000000,'5000_MS_OR_MORE']]){
 test(`max latency ${ns}ns falls in ${bucket}`,()=>{const f=model({max:ns}),finish=f.api.beginCon18LoopDelay();assert.deepEqual(finish(),{status:'OBSERVED',maxBucket:bucket,samples:1});assert.deepEqual(f.calls,['enable','disable']);assert.deepEqual(finish(),{status:'UNAVAILABLE'});});
}
test('unsampled and bounded sample counts are reported explicitly',()=>{
 const none=model({count:0});assert.deepEqual(none.api.beginCon18LoopDelay()(),{status:'UNSAMPLED'});
 const many=model({count:1000001});assert.equal(many.api.beginCon18LoopDelay()().samples,1000000);
});
for(const stage of ['createFailure','enableFailure','disableFailure'])test(`${stage} produces only UNAVAILABLE`,()=>{
 const f=model({[stage]:true});const result=f.api.beginCon18LoopDelay()();assert.deepEqual(result,{status:'UNAVAILABLE'});assert.doesNotMatch(JSON.stringify(result),/PRIVATE/u);
 assert.deepEqual(f.calls,stage==='createFailure'?[]:stage==='enableFailure'?['enable']:['enable','disable']);
});
test('invalid histogram observations fail closed',()=>{
 for(const value of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])for(const field of ['count','max']){
  const f=model({[field]:value});assert.deepEqual(f.api.beginCon18LoopDelay()(),{status:'UNAVAILABLE'});
 }
});
