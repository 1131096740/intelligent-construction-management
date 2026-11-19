'use strict';
// Diagnostic only: the histogram covers the whole process during one HTTP
// exchange. It does not attribute a delay to the request or to a transaction.
// Sampling may miss an interval, especially at start/end; even a low bucket
// cannot prove that no long stall occurred.
const {monitorEventLoopDelay}=require('node:perf_hooks');
function beginCon18LoopDelay(){
 let histogram;
 try{histogram=monitorEventLoopDelay({resolution:10});histogram.enable();}catch{return ()=>Object.freeze({status:'UNAVAILABLE'});}
 let done=false;
 return ()=>{
  if(done)return Object.freeze({status:'UNAVAILABLE'});done=true;
  try{
   histogram.disable();const count=histogram.count,max=histogram.max;
   if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(max)||max<0)return Object.freeze({status:'UNAVAILABLE'});
   if(count===0)return Object.freeze({status:'UNSAMPLED'});
   const ms=max/1e6,maxBucket=ms<100?'UNDER_100_MS':ms<500?'100_TO_499_MS':ms<1000?'500_TO_999_MS':ms<5000?'1000_TO_4999_MS':'5000_MS_OR_MORE';
   return Object.freeze({status:'OBSERVED',maxBucket,samples:Math.min(count,1000000)});
  }catch{return Object.freeze({status:'UNAVAILABLE'});}
 };
}
module.exports=Object.freeze({beginCon18LoopDelay});
