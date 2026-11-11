"use strict";
// Keep the fixed technical producer import order. This prepares process-local
// test settings and storage only; it issues no application or database admission.
require('./task16-current259-application-factory.cjs');
const {claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
const fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {types}=require('node:util');
const KEYS=['NODE_ENV','SMS_ENABLED','APPROVAL_SMS_ENABLED','FILE_STORAGE_DRIVER','FILE_STORAGE_ROOT','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'];
const BENIGN={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local'};
let busy=false;
const fault=part=>Object.assign(new Error('CURRENT259_APP_ENV_'+part),{code:'CURRENT259_APP_ENV_'+part});
const need=(ok,part)=>{if(!ok)throw fault(part);};
function forbiddenEnvironment(env){return Object.keys(env).some(k=>/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_|WECHAT_|PRISMA_)/u.test(k)&&!['SMS_ENABLED','APPROVAL_SMS_ENABLED','PRISMA_HIDE_UPDATE_MESSAGE'].includes(k))||['DATABASE_URL','NODE_OPTIONS','NODE_PATH','HOST','PORT','WEB_ORIGIN','SKIP_DATABASE_CONNECT'].some(k=>Boolean(env[k]));}
function identity(directory){
 const st=fs.lstatSync(directory);
 need(st.isDirectory()&&!st.isSymbolicLink()&&fs.realpathSync(directory)===directory&&st.uid===process.getuid()&&(st.mode&0o077)===0,'STORAGE');
 return Object.fromEntries(['dev','ino','uid','mode'].map(k=>[k,st[k]]));
}
function matches(directory,prior){const now=identity(directory);return Object.keys(prior).every(k=>now[k]===prior[k]);}
async function withCurrent259ApplicationEnvironment(handle,consume){
 need(arguments.length===2&&typeof consume==='function','ARGUMENTS');
 const view=claimCurrent259TechnicalResource(handle);
 need(!busy,'BUSY');busy=true;
 const originalEnvironment=process.env;
 let active=false,broken=false,directory,parent,parentIdentity,directoryIdentity,env,prior,prepared=false;
 let value,first,hasPrimary=false,unresolvedApplication=false,envOutcome='NOT_CHANGED',storageOutcome='NOT_CREATED';
 const check=()=>{
  need(active&&!broken,'CLOSED');
  try{
   view.check();need(claimCurrent259TechnicalResource(handle)===view,'CONTINUITY');
   need(process.env===originalEnvironment&&KEYS.every(k=>process.env[k]===env[k])&&!forbiddenEnvironment(process.env),'CONTINUITY');
   need(matches(parent,parentIdentity)&&matches(directory,directoryIdentity),'CONTINUITY');
  }catch{active=false;broken=true;throw fault('CONTINUITY');}
 };
 try{
  view.check();await view.verifyFull();view.check();
  need(process.env===originalEnvironment,'OWNERSHIP');
  prior=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));
  need(KEYS.every(k=>prior[k]===undefined||Object.hasOwn(BENIGN,k)&&prior[k]===BENIGN[k]),'OWNERSHIP');
  need(!forbiddenEnvironment(process.env),'OWNERSHIP');
  need(typeof view.resource.caPath==='string'&&path.isAbsolute(view.resource.caPath)&&path.normalize(view.resource.caPath)===view.resource.caPath&&path.basename(view.resource.caPath)==='ca.crt'&&path.basename(path.dirname(view.resource.caPath))==='tls-private','STORAGE');
  parent=path.dirname(path.dirname(view.resource.caPath));parentIdentity=identity(parent);
  directory=fs.mkdtempSync(path.join(parent,'application-private-'));fs.chmodSync(directory,0o700);directoryIdentity=identity(directory);storageOutcome='CREATED';
  const secrets=Array.from({length:3},()=>randomBytes(32).toString('hex'));need(new Set(secrets).size===3,'RANDOM');
  env=Object.freeze({...BENIGN,FILE_STORAGE_ROOT:directory,JWT_ACCESS_SECRET:secrets[0],JWT_REFRESH_SECRET:secrets[1],FILE_DOWNLOAD_SECRET:secrets[2]});
  prepared=true;envOutcome='PREPARED';for(const k of KEYS)process.env[k]=env[k];
  active=true;check();
  value=await consume(Object.freeze({check,storageRoot:directory,executionAllowed:false,nativeAdmission:false}));check();
 }catch(error){
  first=error;hasPrimary=true;
  if(error&&typeof error==='object'&&!types.isProxy(error)){
   const d=Object.getOwnPropertyDescriptor(error,'appCleanupOutcome');
   unresolvedApplication=Boolean(d&&Object.hasOwn(d,'value')&&d.value==='UNKNOWN_DO_NOT_CONTINUE');
  }
 }
 finally{
  active=false;
  if(prepared){
   if(!unresolvedApplication&&process.env===originalEnvironment&&KEYS.every(k=>process.env[k]===env[k])){
    const foreign=forbiddenEnvironment(process.env);
    for(const k of KEYS)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];
    envOutcome=foreign?'UNKNOWN':'RESTORED';
   }else envOutcome='UNKNOWN';
  }
  if(directory&&unresolvedApplication)storageOutcome='UNKNOWN';
  else if(directory){
   try{
    need(matches(parent,parentIdentity)&&matches(directory,directoryIdentity),'STORAGE');
    // Only this freshly created, same-inode root is removed; rm never follows
    // descendant symlinks into files outside the scope.
    fs.rmSync(directory,{recursive:true,force:false});need(!fs.existsSync(directory),'STORAGE');storageOutcome='REMOVED';
   }catch{storageOutcome='UNKNOWN';}
  }
  busy=false;
 }
 if(envOutcome==='UNKNOWN'||storageOutcome==='UNKNOWN'){
  const error=Object.assign(fault('CLEANUP_UNKNOWN'),{environmentRestoration:envOutcome,storageCleanup:storageOutcome});
  if(hasPrimary)Object.defineProperty(error,'cause',{value:first,enumerable:false});throw error;
 }
 if(hasPrimary)throw first;
 return value;
}
module.exports=Object.freeze({withCurrent259ApplicationEnvironment});
