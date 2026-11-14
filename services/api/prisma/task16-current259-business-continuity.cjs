'use strict';
// Fixed read-only capture of the fresh main's already-published validator.
// No registration, issuer injection, token mint or resource operation.
const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
const FILE=path.join(__dirname,'task16-current259-payment-run-authorization.cjs');
const CONTRACT_FILE=path.join(__dirname,'task12-current261-local-lifecycle-once.cjs');
const need=ok=>{if(!ok)throw new Error('CURRENT259_BUSINESS_CONTINUITY');};
const fdMethods=Object.freeze(Object.fromEntries(['realpathSync','lstatSync','fstatSync','openSync'].map(k=>[k,Object.freeze(Object.getOwnPropertyDescriptor(fs,k))])));
// Dependencies may wrap the global close slot. Close our own FD with the original method.
const fdClose=Object.freeze(ownData(fs,'closeSync'));need(typeof fdClose.value==='function');
const fdConstants=fs.constants,readOnly=fdConstants.O_RDONLY,noFollow=fdConstants.O_NOFOLLOW;
function checkFdMethods(){need(Object.getOwnPropertyDescriptor(fs,'constants')?.value===fdConstants&&Object.getOwnPropertyDescriptor(fdConstants,'O_RDONLY')?.value===readOnly&&Object.getOwnPropertyDescriptor(fdConstants,'O_NOFOLLOW')?.value===noFollow);for(const [key,descriptor]of Object.entries(fdMethods)){const now=Object.getOwnPropertyDescriptor(fs,key);need(now&&['value','writable','enumerable','configurable'].every(k=>now[k]===descriptor[k]));}}
let original,broken=false;
function ownData(owner,key){
 need(owner&&!types.isProxy(owner));const descriptor=Object.getOwnPropertyDescriptor(owner,key);
 need(descriptor&&Object.hasOwn(descriptor,'value'));return descriptor;
}
const sameDescriptor=(a,b)=>a&&b&&['value','writable','enumerable','configurable'].every(k=>a[k]===b[k]);
function captureCurrent259BusinessIssuer(){need(arguments.length===0);return captureIssuer(FILE,'assertCurrent259PaymentBusinessContinuity');}
function captureCurrent261ContractBusinessIssuer(){need(arguments.length===0);return captureIssuer(CONTRACT_FILE,'assertCurrent261ContractBusinessContinuity');}
function captureIssuer(file,validator){
 try{
  need(!broken);
  const cache=ownData(require,'cache').value,main=ownData(require,'main').value,issuer=ownData(cache,file).value;
  need(issuer&&issuer===main&&!types.isProxy(issuer));
  const filename=ownData(main,'filename'),exportsDescriptor=ownData(issuer,'exports'),exports=exportsDescriptor.value;
  need(filename.value===file&&exports&&!types.isProxy(exports)&&Object.isFrozen(exports));
  const descriptor=ownData(exports,validator);need(typeof descriptor.value==='function');
  if(original){need(original.file===file&&original.validator===validator&&original.issuer===issuer&&original.exports===exports&&sameDescriptor(original.exportsDescriptor,exportsDescriptor)&&sameDescriptor(original.descriptor,descriptor)&&sameDescriptor(original.filename,filename));return;}
  original=Object.freeze({file,validator,issuer,main,exports,exportsDescriptor:Object.freeze(exportsDescriptor),filename:Object.freeze(filename),descriptor:Object.freeze(descriptor)});
 }catch(error){broken=true;throw error;}
}
function assertIssuer(token,handle,scenario){
 try{
  need(original&&!broken);const {file,validator,issuer,main,exports,descriptor}=original;
  need(scenario===undefined||file===FILE);
  const cache=ownData(require,'cache').value;
  need(ownData(require,'main').value===main&&ownData(cache,file).value===issuer&&sameDescriptor(ownData(main,'filename'),original.filename)&&sameDescriptor(ownData(issuer,'exports'),original.exportsDescriptor));
  need(sameDescriptor(ownData(exports,validator),descriptor));
  const admitted=scenario===undefined?descriptor.value(token,handle):descriptor.value(token,handle,scenario);
  need(admitted===true);return true;
 }catch(error){broken=true;throw error;}
}
function assertCurrent259BusinessIssuer(token,handle){return assertIssuer(token,handle);}
function assertCurrent259CommitCancellationIssuer(token,handle){return assertIssuer(token,handle,'cancel-commit');}
function assertCurrent259CommitDisconnectIssuer(token,handle){return assertIssuer(token,handle,'disconnect-commit-recovery');}
function checkCurrent259FileIdentity(file,expected){
 checkFdMethods();need(typeof file==='string'&&path.isAbsolute(file)&&fs.realpathSync(file)===file&&expected&&!types.isProxy(expected));
 const keys=Object.keys(expected),big=keys.includes('mtimeNs');
 const fields=['dev','ino','mode','uid','gid','size',...(big?['mtimeNs','ctimeNs']:['mtimeMs','ctimeMs'])];
 need(keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(expected,k)??{},'value')));
 need(keys.length===fields.length&&fields.every(k=>Object.hasOwn(expected,k))&&keys.every(k=>big?typeof expected[k]==='string':typeof expected[k]==='number'&&Number.isFinite(expected[k])));
 const matches=stat=>keys.every(k=>Object.hasOwn(stat,k)&& (typeof expected[k]==='string'?String(stat[k]):stat[k])===expected[k]);
 const before=fs.lstatSync(file,{bigint:big});need(before.isFile()&&!before.isSymbolicLink()&&matches(before));
 const fd=fs.openSync(file,readOnly|noFollow);
 try{need(matches(fs.fstatSync(fd,{bigint:big}))&&matches(fs.lstatSync(file,{bigint:big})));}finally{Reflect.apply(fdClose.value,fs,[fd]);}
 return true;
}
module.exports=Object.freeze({captureCurrent259BusinessIssuer,captureCurrent261ContractBusinessIssuer,assertCurrent259BusinessIssuer,assertCurrent259CommitCancellationIssuer,assertCurrent259CommitDisconnectIssuer,checkCurrent259FileIdentity});
