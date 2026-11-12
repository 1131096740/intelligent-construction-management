"use strict";
const {createHash}=require('node:crypto'),{types}=require('node:util');
const FULL='d3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const ARCHIVE_FULL='ebd6ee528e5eabd4b53abbd992c58637af70fee61f015a17f70b04cd55761598';
const PREFIX='85d1a225757b69aa81531560c7d989441ae6de6400c3a77737a86fc5e4a54a24';
const SCHEMA='60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4';
const EXACT_PROFILES=Object.freeze([
 Object.freeze({profile:'TASK16_CURRENT259_SOURCE_V1',size:259,ledgerSha256:FULL}),
 Object.freeze({profile:'TASK12_ARCHIVE261_SOURCE_V1',size:261,ledgerSha256:ARCHIVE_FULL}),
]);
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const fail=()=>{throw Object.assign(new Error('TASK16_CURRENT259_SOURCE'),{code:'TASK16_CURRENT259_SOURCE'});};
function own(value,key){if(!value||types.isProxy(value))fail();const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))fail();return d.value;}
/** Source material only. This does not issue a client/session or execution authority. */
function qualifyCurrent259Source(source){
 const candidateSha=own(source,'candidateSha'),sealSha256=own(source,'sealSha256'),schemaSha256=own(source,'schemaSha256'),migrations=own(source,'migrations');
 if(typeof candidateSha!=='string'||typeof sealSha256!=='string'||!/^[a-f0-9]{40}$/u.test(candidateSha)||!/^[a-f0-9]{64}$/u.test(sealSha256)||schemaSha256!==SCHEMA||!Array.isArray(migrations)||types.isProxy(migrations))fail();
 const exact=EXACT_PROFILES.find(row=>row.size===migrations.length);
 if(!exact)fail();
 const ledger=[];
 for(let i=0;i<exact.size;i++){
  const item=own(migrations,String(i)),itemPath=own(item,'path');
  if(typeof itemPath!=='string')fail();
  const name=/^services\/api\/prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql$/u.exec(itemPath)?.[1],sha256=own(item,'sha256');
  if(!name||typeof sha256!=='string'||!/^[a-f0-9]{64}$/u.test(sha256)||i&&ledger[i-1].name>=name)fail();
  ledger.push(Object.freeze({name,sha256,finished:true,rolledBack:false}));
 }
 if(hash(ledger)!==exact.ledgerSha256||hash(ledger.slice(0,259))!==FULL||hash(ledger.slice(0,256))!==PREFIX)fail();
 return Object.freeze({profile:exact.profile,candidateSha,sealSha256,schemaSha256,ledgerSha256:exact.ledgerSha256,prefix256Sha256:PREFIX,ledger:Object.freeze(ledger),executionAllowed:false});
}

function currentArchiveLedgerSize(ledgerSha256){
 const exact=EXACT_PROFILES.find(row=>row.ledgerSha256===ledgerSha256);
 if(!exact)fail();
 return exact.size;
}

function isExactCurrentArchiveProfile(source){
 return Boolean(source&&Array.isArray(source.ledger)&&source.prefix256Sha256===PREFIX&&
  EXACT_PROFILES.some(row=>row.profile===source.profile&&row.ledgerSha256===source.ledgerSha256&&row.size===source.ledger.length));
}
module.exports={qualifyCurrent259Source,currentArchiveLedgerSize,isExactCurrentArchiveProfile};
