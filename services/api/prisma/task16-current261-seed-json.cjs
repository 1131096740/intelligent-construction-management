'use strict';
const {performance}=require('node:perf_hooks');
const fetchSlot=Object.getOwnPropertyDescriptor(globalThis,'fetch');
const nativeFetch=fetchSlot?.value;
const builtin=process.binding('natives')['internal/bootstrap/web/exposed-window-or-worker'];
const qualifiedFetch=typeof nativeFetch==='function'&&typeof builtin==='string'&&builtin.includes(Function.prototype.toString.call(nativeFetch));
const need=value=>{if(!value)throw new Error('CURRENT261_SEED_JSON_FAILED_CLOSED');};

// The caller performs its original private qualification before this fixed
// network interval, then qualifies the consumed native response afterwards.
async function requestCurrent261SeedJson(target,init,timeoutMs,onBody){
 need(qualifiedFetch&&Object.getOwnPropertyDescriptor(globalThis,'fetch')?.value===nativeFetch&&
  timeoutMs===5000&&!Object.hasOwn(init,'signal')&&(onBody===undefined||typeof onBody==='function'));
 const deadline=performance.now()+timeoutMs;
 const signal=AbortSignal.timeout(timeoutMs);
 const response=await nativeFetch(target,{...init,signal});
 if(onBody)onBody(response.status);
 const body=await response.json();
 signal.throwIfAborted();
 if(performance.now()>deadline)throw new DOMException('Network response deadline exceeded','TimeoutError');
 return {response,body};
}

module.exports=Object.freeze({requestCurrent261SeedJson});
