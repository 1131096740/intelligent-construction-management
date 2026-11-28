"use strict";
// Native source bridge. Only fixed, already admitted module entries are loaded.
// Tests drive this function through public run with owned fake CJS SDK packages.
const fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
const {createTask16Application}=require('./task16-application-factory.cjs');
const ROOT=path.resolve(__dirname,'../../..');
const CODE=['task16-application-stage.cjs','task16-application-factory.cjs','task16-client-loader.cjs','task16-restricted-clients.cjs','task16-runtime-inputs.cjs','run-task16-registered-pg-local.cjs'].map(f=>'services/api/prisma/'+f);
const KEYS=['NODE_ENV','SMS_ENABLED','APPROVAL_SMS_ENABLED','FILE_STORAGE_DRIVER','FILE_STORAGE_ROOT','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const own=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object??{},key);need(d&&Object.hasOwn(d,'value'),'TASK16_APP_BRIDGE_DESCRIPTOR');return d.value;};
async function startTask16Application(context){
 let app,appMethods,prepared=false,loading=false,cleanupUnknown=false,factoryReleased=false,factoryUnknown=false,closing,env,prior,directory,directoryIdentity;
 const restore=()=>{
  if(!prepared)return;
  need(KEYS.every(k=>process.env[k]===env[k]),'TASK16_APP_ENVIRONMENT_CHANGED');
  const stat=fs.lstatSync(directory);need(fs.realpathSync(directory)===directory&&stat.isDirectory()&&!stat.isSymbolicLink()&&['dev','ino','uid','mode'].every(k=>stat[k]===directoryIdentity[k]),'TASK16_APP_STORAGE_CHANGED');
  fs.rmdirSync(directory);for(const k of KEYS)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];prepared=false;
 };
 const close=()=>closing??=(async()=>{let unknown=false;if(app){try{await appMethods.close.call(app);}catch{unknown=true;}}else if(loading&&!factoryReleased)unknown=true;
  if(!unknown){try{restore();}catch{unknown=true;}}
  if(unknown){cleanupUnknown=true;throw Object.assign(new Error('TASK16_APP_CLOSE_UNKNOWN'),{code:'TASK16_APP_CLOSE_UNKNOWN'});}
 })();
 try{
  const descriptor=Object.getOwnPropertyDescriptor(context,'clientLifecycleWitness'),life=descriptor?.value;
  need(descriptor&&descriptor.writable===false&&descriptor.configurable===false&&life?.handle===context.clients&&life.runtime===own(context.clients,'runtime')&&life.owner===own(context.clients,'owner')&&life.observer===own(context.clients,'observer'),'TASK16_APP_LIFECYCLE_WITNESS');
  const methods={checkLight:life.checkLight,verifyFull:life.verifyFull,loadApplicationModules:life.loadApplicationModules};need(Object.values(methods).every(v=>typeof v==='function'),'TASK16_APP_LIFECYCLE_WITNESS');
  const witness=Object.getOwnPropertyDescriptor(context,'applicationEntriesWitness');need(witness&&witness.writable===false&&witness.configurable===false&&Array.isArray(witness.value)&&witness.value.length===8,'TASK16_APP_FIRST_ENTRIES');
  const firstBuild=Object.getOwnPropertyDescriptor(context,'applicationBuildWitness');need(firstBuild&&firstBuild.writable===false&&firstBuild.configurable===false&&firstBuild.value&&JSON.stringify(firstBuild.value)===JSON.stringify(context.source.runtimeAdmission.applicationBuild),'TASK16_APP_FIRST_BUILD');
  const source=context.source,registered=context.registeredAccess,binding=life.sourceBinding,sourceSha=binding.sourceSha,seal=binding.sourceSealSha256;need(source.candidateSha===sourceSha&&source.sealSha256===seal&&own(registered,'manifestSha256')===binding.registeredManifestSha256&&own(life.handle,'sourceBinding')===life.bindingObject&&['sourceSha','sourceSealSha256','registeredManifestSha256'].every(k=>own(life.bindingObject,k)===binding[k]),'TASK16_APP_FIRST_SOURCE');need(source.candidateRoot===ROOT&&source.runtimeAdmission.status==='INPUTS_AND_CODE_TREES_MATCHED','TASK16_APP_SOURCE');
  const captures=CODE.map(relative=>{const member=source.executionFiles.filter(row=>row.path===relative);need(member.length===1,'TASK16_APP_SOURCE');const file=path.join(ROOT,relative),capture=read(file,{maxBytes:64*1024*1024,code:'TASK16_APP_SOURCE'});need(capture.sha256===member[0].sha256,'TASK16_APP_SOURCE');return{file,...capture};});
  const light=()=>{need(context.source===source&&context.registeredAccess===registered&&own(registered,'manifestSha256')===binding.registeredManifestSha256&&own(life.handle,'sourceBinding')===life.bindingObject&&['sourceSha','sourceSealSha256','registeredManifestSha256'].every(k=>own(life.bindingObject,k)===binding[k])&&JSON.stringify(firstBuild.value)===JSON.stringify(source.runtimeAdmission.applicationBuild)&&JSON.stringify(witness.value)===JSON.stringify(source.runtimeAdmission.applicationEntries)&&source.candidateSha===sourceSha&&source.sealSha256===seal&&context.clients===life.handle&&own(context.clients,'runtime')===life.runtime&&own(context.clients,'owner')===life.owner&&own(context.clients,'observer')===life.observer,'TASK16_APP_LIFECYCLE_CHANGED');for(const[k,method]of Object.entries(methods))need(own(context.clients,k)===method,'TASK16_APP_LIFECYCLE_CHANGED');for(const row of captures)need(read(row.file,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_APP_SOURCE_CHANGED'}).sha256===row.sha256,'TASK16_APP_SOURCE_CHANGED');if(prepared)need(KEYS.every(k=>process.env[k]===env[k]),'TASK16_APP_ENVIRONMENT_CHANGED');methods.checkLight();};
  light();await methods.verifyFull();light();
  prior=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));
  const benign={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local'};
  need(KEYS.every(k=>prior[k]===undefined||Object.hasOwn(benign,k)&&prior[k]===benign[k]),'TASK16_APP_ENVIRONMENT_OWNERSHIP');
  need(!Object.keys(process.env).some(k=>/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_)/u.test(k)&&!['SMS_ENABLED','APPROVAL_SMS_ENABLED'].includes(k))&&!['DATABASE_URL','NODE_OPTIONS','NODE_PATH','HOST','PORT','WEB_ORIGIN','SKIP_DATABASE_CONNECT'].some(k=>Boolean(process.env[k])),'TASK16_APP_ENVIRONMENT_OWNERSHIP');
  const parent=context.options.artifactsDir,stat=fs.lstatSync(parent);need(fs.realpathSync(parent)===parent&&stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'TASK16_APP_STORAGE_REQUIRED');
  directory=fs.mkdtempSync(path.join(parent,'application-private-'));fs.chmodSync(directory,0o700);const created=fs.lstatSync(directory);directoryIdentity=Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,created[k]]));
  env=Object.freeze({...benign,FILE_STORAGE_ROOT:directory,JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),FILE_DOWNLOAD_SECRET:randomBytes(32).toString('hex')});for(const k of KEYS)process.env[k]=env[k];prepared=true;light();
  let loaded,createTestingModule;
  const boundary={loadModules:async request=>{loading=true;light();loaded=methods.loadApplicationModules(request);const Test=own(loaded,'Test'),method=Object.getOwnPropertyDescriptor(Test,'createTestingModule');need(method&&Object.hasOwn(method,'value')&&typeof method.value==='function','TASK16_APP_TEST_FACTORY');const fn=method.value;createTestingModule=metadata=>{light();need(Object.getOwnPropertyDescriptor(Test,'createTestingModule')?.value===fn,'TASK16_APP_TEST_FACTORY');return fn.call(Test,metadata);};light();return loaded;},createTestingModule:metadata=>{need(typeof createTestingModule==='function','TASK16_APP_TEST_FACTORY');return createTestingModule(metadata);}};
  app=await createTask16Application(context,boundary,{checkLight:light,onClose:state=>{if(!state.returned)factoryUnknown=true;factoryReleased=state.returned&&state.acquired&&!factoryUnknown;}});appMethods={close:own(app,'close'),inspect:own(app,'inspect')};light();const observed=appMethods.inspect.call(app);need(observed.runtime===life.runtime,'TASK16_APP_RUNTIME_PROVIDER');await methods.verifyFull();light();appMethods.inspect.call(app);
  return{status:'APPLICATION_SOURCE_AND_PROVIDER_MATCHED',origin:observed.origin,runtime:life.runtime,inspect:()=>{light();return appMethods.inspect.call(app);},close,sourceBinding:Object.freeze({sourceSha,sourceSealSha256:seal,registeredManifestSha256:binding.registeredManifestSha256}),simulated:context.simulation,nativeProof:false,financialAcceptance:false};
 }catch{
  try{await close();}catch{cleanupUnknown=true;}
  throw Object.assign(new Error('TASK16_APP_BRIDGE_FAILED_CLOSED'),{code:'TASK16_APP_BRIDGE_FAILED_CLOSED',appStartupOutcome:loading?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:cleanupUnknown?'UNKNOWN_DO_NOT_CONTINUE':factoryReleased?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'NOT_NEEDED'});
 }
}
module.exports={startTask16Application};
