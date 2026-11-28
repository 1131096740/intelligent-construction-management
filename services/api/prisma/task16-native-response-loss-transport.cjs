'use strict';
const {randomUUID}=require('node:crypto');
const {startResponseLossProxy}=require('./enterprise-task01-response-loss-proxy.cjs');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
function need(v){if(!v)throw Object.assign(new Error('NATIVE_RESPONSE_LOSS_TRANSPORT'),{code:'NATIVE_RESPONSE_LOSS_TRANSPORT'});}
async function createNativeResponseLossTransport({origin,payment,key,check,prepareBody}){
 const base=new URL(origin);need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port&&base.pathname==='/'&&!base.username&&!base.password&&!base.search&&!base.hash&&uuid(payment)&&uuid(key)&&typeof check==='function'&&typeof prepareBody==='function');
 const route=`/payment-executions/${payment}/registrations`,requestId=randomUUID(),proxy=await startResponseLossProxy({upstreamUrl:base.origin,drop:{method:'POST',path:route,requestId},deadlineMs:5000});
 let phase='ready',body,verifyBody,posts=0;
 async function send(target,init={}){
  check();const u=new URL(target);need(u.origin===base.origin&&!u.username&&!u.password&&!u.hash&&!u.search);
  if(u.pathname!==route||init.method!=='POST')return fetch(u,init);
  need((phase==='armed'&&posts===0)||(phase==='replay-authorized'&&posts===1));need(typeof init.body==='string');
  const command=JSON.parse(init.body);need(command&&command.idempotencyKey===key);
  if(body===undefined){body=init.body;verifyBody=prepareBody(body);need(typeof verifyBody==='function');}else need(body===init.body);
  verifyBody(init.body);check();
  posts++;
  if(phase==='armed')return fetch(new URL(route,proxy.url),{...init,headers:{...init.headers,'x-jg-task01-synthetic-request-id':requestId}});
  phase='replayed';return fetch(u,init);
 }
 async function lose(submit){
  need(phase==='ready'&&typeof submit==='function');phase='armed';let rejected=false;
  try{try{await submit();}catch{rejected=true;}const status=proxy.getStatus();need(rejected&&posts===1&&status.faultState==='dropped'&&status.upstreamStatusCode===201);phase='observing';return {faultState:'dropped',upstreamStatusCode:201};}
  finally{await proxy.close();}
 }
 function authorizeReplay(){check();need(phase==='observing'&&posts===1);phase='replay-authorized';}
 function assertCompleted(){check();need(phase==='replayed'&&posts===2&&proxy.getStatus().closed===true);}
 async function close(){await proxy.close();}
 return Object.freeze({fetch:send,lose,authorizeReplay,assertCompleted,close});
}
module.exports={createNativeResponseLossTransport};
