'use strict';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
function need(value){if(!value)throw Object.assign(new Error('NATIVE_A16_CANCEL_TRANSPORT'),{code:'NATIVE_A16_CANCEL_TRANSPORT'});}
function createNativeA16CancelTransport({origin,payment,key,check,prepareBody}){
 const base=new URL(origin);need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port&&base.pathname==='/'&&!base.username&&!base.password&&!base.search&&!base.hash&&uuid(payment)&&uuid(key)&&typeof check==='function'&&typeof prepareBody==='function');
 const route=`/payment-executions/${payment}/registrations`;let posts=0;
 return Object.freeze({async fetch(target,init={}){
  check();const url=new URL(target);need(url.origin===base.origin&&!url.username&&!url.password&&!url.hash&&!url.search);
  if(init.method==='GET'){need([`/payment-executions/${payment}/registration-options`,`/payment-executions/results/${key}`].includes(url.pathname));return fetch(url,init);}
  need(url.pathname===route&&init.method==='POST');
  need(posts===0&&typeof init.body==='string');const command=JSON.parse(init.body);need(command&&command.idempotencyKey===key);
  const verify=prepareBody(init.body);need(typeof verify==='function');verify(init.body);check();posts++;return fetch(url,init);
 },assertSubmitted(){check();need(posts===1);}});
}
module.exports={createNativeA16CancelTransport};
