'use strict';
// Pure source qualification. A returned projection is never role/session authority.
const {types,isDeepStrictEqual:equal}=require('node:util');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const need=ok=>{if(!ok)throw new Error('CURRENT261_GENERATED_LIFECYCLE_SOURCE');};
function copy(value){
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const descriptors=Object.getOwnPropertyDescriptors(value);
 need(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
 if(Array.isArray(value)){
  need(Object.keys(descriptors).length===descriptors.length.value+1);
  return Object.freeze(Array.from({length:descriptors.length.value},(_,i)=>{need(descriptors[i]);return copy(descriptors[i].value);}));
 }
 need(Object.getPrototypeOf(value)===Object.prototype);
 return Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,copy(d.value)])));
}
function qualifyCurrent261GeneratedLifecycleSource(input){
 const source=copy(input);
 need(equal(Object.keys(source).sort(),['candidateSha','tree','sourceSealSha256','profile'].sort())&&/^[a-f0-9]{40}$/u.test(source.tree));
 const p=source.profile;need(p&&Array.isArray(p.ledger));
 const qualified=qualifyCurrent259Source({candidateSha:source.candidateSha,sealSha256:source.sourceSealSha256,
  schemaSha256:p.schemaSha256,migrations:p.ledger.map(row=>({path:'services/api/prisma/migrations/'+row.name+'/migration.sql',sha256:row.sha256}))});
 need(qualified.profile==='TASK12_ARCHIVE261_SOURCE_V1'&&equal(qualified,p));
 return source;
}
module.exports=Object.freeze({qualifyCurrent261GeneratedLifecycleSource});
