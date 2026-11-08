"use strict";
// Fixed Task16 source bridge. Import performs no SDK/network/resource work.
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {readQualifiedTask16File:read,normalizeTask16FixtureDates:dates}=require('./task16-runtime-inputs.cjs');
const ROOT=path.resolve(__dirname,'../../..');
const FRAGMENTS=['funding','history-revision','write-authority','canonical-proof','intercompany','canonical-adapter','voucher'].map(n=>'services/api/prisma/prepared/task16/registered-'+n+'.sql');
const fault=()=>Object.assign(new Error('TASK16_SEED_FAILED_CLOSED'),{code:'TASK16_SEED_FAILED_CLOSED'});
const need=ok=>{if(!ok)throw fault();};
const own=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object??{},key);need(d&&Object.hasOwn(d,'value'));return d.value;};
const fixed=(context,key)=>{const d=Object.getOwnPropertyDescriptor(context,key);need(d&&d.writable===false&&d.configurable===false);return d.value;};
function validateTask16SeedAdmission(context){
 const first=fixed(context,'seedAdmissionWitness'),transport=fixed(context,'seedTransportWitness'),source=context.source,build=fixed(context,'applicationBuildWitness');
 need(first&&source?.candidateRoot===ROOT&&source.runtimeAdmission?.status==='INPUTS_AND_CODE_TREES_MATCHED'&&first.build&&JSON.stringify(first.build)===JSON.stringify(build)&&first.build.candidateRoot===ROOT&&first.build.sourceSha===source.candidateSha&&first.build.sourceSealSha256===source.sealSha256);
 const normalized=dates(first.dates);need(JSON.stringify(normalized)===JSON.stringify(dates(source.inputs.fixtureDates)));
 need(first.input?.path===context.options.inputsFile&&first.input.sha256===context.options.expectedInputsSha256);
 const input=read(first.input.path,{maxBytes:16*1024*1024,privateFile:true,collect:true,expectedIdentity:first.input.identity,code:'TASK16_SEED_INPUT'});need(input.sha256===first.input.sha256&&JSON.stringify(dates(JSON.parse(input.bytes.toString('utf8')).fixtureDates))===JSON.stringify(normalized));
 need(first.entry?.path===path.join(ROOT,'services/api/dist/database/registered-payment-postgres.fixture.js')&&first.entry.identity&&read(first.entry.path,{maxBytes:64*1024*1024,expectedIdentity:first.entry.identity,code:'TASK16_SEED_ENTRY'}).sha256===first.entry.sha256);
 need(first.fragments?.length===7&&first.fragments.every((row,i)=>row.path===FRAGMENTS[i]&&/^[a-f0-9]{64}$/u.test(row.sha256)&&source.executionFiles?.filter(member=>member.path===row.path&&member.sha256===row.sha256).length===1));
 for(const row of first.fragments)need(row.identity&&read(path.join(ROOT,row.path),{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_SEED_FRAGMENT'}).sha256===row.sha256);
 const sourcePaths=['services/api/prisma/task16-seed-fixture.cjs','services/api/prisma/run-task16-registered-pg-local.cjs','services/api/prisma/task16-runtime-inputs.cjs','services/api/prisma/task16-client-loader.cjs','services/api/prisma/task16-restricted-clients.cjs','services/api/src/database/registered-payment-postgres.fixture.ts','services/api/src/company-entity/unified-social-credit-code.ts'];
 need(first.sources?.length===sourcePaths.length&&first.sources.every((row,i)=>row.path===sourcePaths[i]&&row.identity&&source.executionFiles?.filter(member=>member.path===row.path&&member.sha256===row.sha256).length===1));
 for(const row of first.sources)need(read(path.join(ROOT,row.path),{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_SEED_SOURCE'}).sha256===row.sha256);
 need(transport&&typeof transport.fetch==='function'&&transport.qualified===true&&transport.simulation===context.simulation&&own(globalThis,'fetch')===transport.fetch);
 return first;
}
const seedRuns=new WeakSet(),completedSeeds=new WeakMap();
function releaseTask16SeedHandoff(context){completedSeeds.delete(context);}
function samePreparedData(current,snapshot){
 if(snapshot===null||typeof snapshot!=='object')return current===snapshot;
 if(!current||typeof current!=='object')return false;
 const descriptors=Object.getOwnPropertyDescriptors(current),keys=Reflect.ownKeys(snapshot);
 return Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors[key]??{},'value')&&samePreparedData(descriptors[key].value,snapshot[key]));
}
function takeTask16SeedHandoff(context){
 const handoff=completedSeeds.get(context);completedSeeds.delete(context);
 need(handoff&&context.source===handoff.source&&own(context,'fixture')===handoff.prepared&&samePreparedData(handoff.prepared,handoff.snapshot));handoff.checkLight();return handoff;
}
async function seedTask16Fixture(context){
 let attempted=false;
 try{
  need(!seedRuns.has(context));seedRuns.add(context);
  const admission=validateTask16SeedAdmission(context),life=fixed(context,'clientLifecycleWitness'),app=fixed(context,'applicationLifecycleWitness'),transport=fixed(context,'seedTransportWitness'),source=context.source,registered=context.registeredAccess,installation=context.installation,witness=fixed(context,'resourceWitness');
  need(life?.handle===context.clients&&app?.handle===context.application&&typeof life.loadFixtureModules==='function'&&app.runtime===life.runtime&&typeof app.inspect==='function');
  const methods=Object.freeze(Object.fromEntries(['checkLight','verifyFull','loadFixtureModules'].map(k=>[k,life[k]])));need(Object.values(methods).every(fn=>typeof fn==='function'));
  const headers=Object.freeze({sourceSha:admission.build.sourceSha,sourceSealSha256:admission.build.sourceSealSha256,registeredManifestSha256:life.sourceBinding.registeredManifestSha256});
  const captures=['task16-seed-fixture.cjs','run-task16-registered-pg-local.cjs','task16-runtime-inputs.cjs','task16-client-loader.cjs','task16-restricted-clients.cjs'].map(name=>{const relative='services/api/prisma/'+name,rows=source.executionFiles.filter(row=>row.path===relative);need(rows.length===1);const file=path.join(ROOT,relative),row=read(file,{maxBytes:64*1024*1024,code:'TASK16_SEED_SOURCE'});need(row.sha256===rows[0].sha256);return{file,...row};});
  const initialResource=Object.freeze({...witness});
  const check=()=>{
   need(context.source===source&&context.registeredAccess===registered&&context.installation===installation&&context.clients===life.handle&&context.application===app.handle&&own(app.handle,'runtime')===life.runtime&&own(app.handle,'inspect')===app.inspect&&own(app.handle,'close')===app.close&&own(app.handle,'origin')===app.origin&&own(app.handle,'sourceBinding')===app.sourceBinding);
   need(Object.entries(headers).every(([k,v])=>own(app.sourceBinding,k)===v&&app.sourceHeader[k]===v&&life.sourceBinding[k]===v&&own(life.bindingObject,k)===v)&&own(life.handle,'sourceBinding')===life.bindingObject&&registered.manifestSha256===headers.registeredManifestSha256);
   for(const [key,fn]of Object.entries(methods))need(own(life.handle,key)===fn);
   need(['owner','runtime','observer'].every(key=>own(life.handle,key)===life[key]));
   need(source.candidateSha===headers.sourceSha&&source.sealSha256===headers.sourceSealSha256&&JSON.stringify(source.runtimeAdmission.fixture)===JSON.stringify(admission)&&Object.keys(initialResource).every(key=>witness[key]===initialResource[key]));
   need(installation.candidateSha===headers.sourceSha&&installation.sourceSealSha256===headers.sourceSealSha256&&installation.packetSha256===context.options.expectedPacketSha256&&installation.baselineContinuityVerified===true&&installation.fragmentCount===7);
   validateTask16SeedAdmission(context);for(const row of captures)need(read(row.file,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_SEED_SOURCE'}).sha256===row.sha256);
   methods.checkLight();const seen=app.inspect();need(seen.runtime===life.runtime&&seen.origin===app.origin);
  };
  check();await methods.verifyFull();check();const loaded=methods.loadFixtureModules();check();
  const base=context.baselineAccess;const proof={authorizationReference:source.inputs.authorizationReference,runId:witness.runId.replaceAll('-','').slice(0,12),resourceRunId:witness.runId,databaseName:witness.databaseName,databaseOid:base.databaseOid,systemIdentifier:base.systemIdentifier,host:'127.0.0.1',port:witness.port,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:headers.sourceSealSha256,preparedSqlSha256:Object.fromEntries(admission.fragments.map(row=>[path.basename(row.path),row.sha256])),transport:'isolated-loopback-tls-verify-full',application:{origin:app.origin,databaseRole:'jg_task01_runtime',sourceSealSha256:headers.sourceSealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'}};
  const plan=loaded.buildRegisteredPgFixturePlan(proof.runId,admission.dates.paidAt,admission.dates.openingDate);check();Object.freeze(proof.application);Object.freeze(proof.preparedSqlSha256);Object.freeze(proof);const execution=Object.freeze({proof,owner:life.owner,runtime:life.runtime,observer:life.observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000});
  let prepared;
  try{prepared=await loaded.seedRegisteredPgFixture(execution,plan,Object.freeze({checkLight:check,fetch:transport.fetch}));}catch(error){let outcome;try{outcome=error?.fixtureOutcome;}catch{ /* Discard untrusted getter errors without retaining credentials. */ }attempted=outcome!=='NOT_ATTEMPTED';throw fault();}
  attempted=true;check();await methods.verifyFull();check();
  const snapshot=structuredClone(prepared);const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};freeze(snapshot);
  const inspectPrepared=()=>{check();need(own(context,'fixture')===prepared&&samePreparedData(prepared,snapshot));};
  completedSeeds.set(context,Object.freeze({source,prepared,snapshot,execution,checkLight:inspectPrepared,verifyFull:methods.verifyFull,transport:transport.fetch}));return prepared;
 }catch{releaseTask16SeedHandoff(context);throw Object.assign(fault(),{fixtureOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED'});}
}
module.exports={seedTask16Fixture,validateTask16SeedAdmission,takeTask16SeedHandoff,releaseTask16SeedHandoff};
