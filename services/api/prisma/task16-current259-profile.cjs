"use strict";
const {createHash}=require('node:crypto'),{types}=require('node:util');
const FULL='d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const PREFIX='85d1a225757b69aa81531560c7d989441ae6de6400c3a77737a86fc5e4a54a24';
const SCHEMA='60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4';
const fail=()=>{throw Object.assign(new Error('TASK16_CURRENT259_SOURCE'),{code:'TASK16_CURRENT259_SOURCE'});};
function own(value,key){if(!value||types.isProxy(value))fail();const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))fail();return d.value;}
/** Source material only. This does not issue a client/session or execution authority. */
function qualifyCurrent259Source(source){
 const candidateSha=own(source,'candidateSha'),sealSha256=own(source,'sealSha256'),schemaSha256=own(source,'schemaSha256'),migrations=own(source,'migrations');
 if(typeof candidateSha!=='string'||typeof sealSha256!=='string'||!/^[a-f0-9]{40}$/u.test(candidateSha)||!/^[a-f0-9]{64}$/u.test(sealSha256)||schemaSha256!==SCHEMA||!Array.isArray(migrations)||types.isProxy(migrations)||migrations.length!==259)fail();
 const ledger=[];
 for(let i=0;i<259;i++){
  const item=own(migrations,String(i)),itemPath=own(item,'path');
  if(typeof itemPath!=='string')fail();
  const name=/^services\/api\/prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql$/u.exec(itemPath)?.[1],sha256=own(item,'sha256');
  if(!name||typeof sha256!=='string'||!/^[a-f0-9]{64}$/u.test(sha256)||i&&ledger[i-1].name>=name)fail();
  ledger.push(Object.freeze({name,sha256,finished:true,rolledBack:false}));
 }
 const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 if(hash(ledger)!==FULL||hash(ledger.slice(0,256))!==PREFIX)fail();
 return Object.freeze({profile:'TASK16_CURRENT259_SOURCE_V1',candidateSha,sealSha256,schemaSha256,ledgerSha256:FULL,prefix256Sha256:PREFIX,ledger:Object.freeze(ledger),executionAllowed:false});
}
module.exports={qualifyCurrent259Source};
