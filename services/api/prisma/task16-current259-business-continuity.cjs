'use strict';
// Fixed read-only capture of the fresh main's already-published validator.
// No registration, issuer injection, token mint or resource operation.
const fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
const FILE=path.join(__dirname,'task16-current259-payment-run-authorization.cjs');
const need=ok=>{if(!ok)throw new Error('CURRENT259_BUSINESS_CONTINUITY');};
const fdMethods=Object.freeze(Object.fromEntries(['realpathSync','lstatSync','fstatSync','openSync','closeSync'].map(k=>[k,Object.freeze(Object.getOwnPropertyDescriptor(fs,k))])));
const fdConstants=fs.constants,readOnly=fdConstants.O_RDONLY,noFollow=fdConstants.O_NOFOLLOW;
function checkFdMethods(){need(Object.getOwnPropertyDescriptor(fs,'constants')?.value===fdConstants&&Object.getOwnPropertyDescriptor(fdConstants,'O_RDONLY')?.value===readOnly&&Object.getOwnPropertyDescriptor(fdConstants,'O_NOFOLLOW')?.value===noFollow);for(const [key,descriptor]of Object.entries(fdMethods)){const now=Object.getOwnPropertyDescriptor(fs,key);need(now&&['value','writable','enumerable','configurable'].every(k=>now[k]===descriptor[k]));}}
let original,broken=false;
function captureCurrent259BusinessIssuer(){
 need(arguments.length===0);
 const issuer=require.cache[FILE],main=require.main,exports=issuer?.exports;
 const descriptor=exports&&Object.getOwnPropertyDescriptor(exports,'assertCurrent259PaymentBusinessContinuity');
 need(issuer&&issuer===main&&main.filename===FILE&&Object.isFrozen(exports)&&descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function');
 if(original){need(original.issuer===issuer&&original.exports===exports&&original.descriptor.value===descriptor.value);return;}
 original=Object.freeze({issuer,main,exports,descriptor:Object.freeze(descriptor)});
}
function assertCurrent259BusinessIssuer(token,handle){
 try{need(original&&!broken);const {issuer,main,exports,descriptor}=original;
 need(require.main===main&&require.cache[FILE]===issuer&&issuer.exports===exports);
 const current=Object.getOwnPropertyDescriptor(exports,'assertCurrent259PaymentBusinessContinuity');
 need(current&&['value','writable','enumerable','configurable'].every(k=>current[k]===descriptor[k]));
 need(descriptor.value(token,handle)===true);return true;
 }catch(error){broken=true;throw error;}
}
function checkCurrent259FileIdentity(file,expected){
 checkFdMethods();need(typeof file==='string'&&path.isAbsolute(file)&&fs.realpathSync(file)===file&&expected&&!types.isProxy(expected));
 const keys=Object.keys(expected),big=keys.includes('mtimeNs');
 const fields=['dev','ino','mode','uid','gid','size',...(big?['mtimeNs','ctimeNs']:['mtimeMs','ctimeMs'])];
 need(keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(expected,k)??{},'value')));
 need(keys.length===fields.length&&fields.every(k=>Object.hasOwn(expected,k))&&keys.every(k=>big?typeof expected[k]==='string':typeof expected[k]==='number'&&Number.isFinite(expected[k])));
 const matches=stat=>keys.every(k=>Object.hasOwn(stat,k)&& (typeof expected[k]==='string'?String(stat[k]):stat[k])===expected[k]);
 const before=fs.lstatSync(file,{bigint:big});need(before.isFile()&&!before.isSymbolicLink()&&matches(before));
 const fd=fs.openSync(file,readOnly|noFollow);
 try{need(matches(fs.fstatSync(fd,{bigint:big}))&&matches(fs.lstatSync(file,{bigint:big})));}finally{fs.closeSync(fd);}
 return true;
}
module.exports=Object.freeze({captureCurrent259BusinessIssuer,assertCurrent259BusinessIssuer,checkCurrent259FileIdentity});
