'use strict';
// Capture the fixed fresh main before any producer receives its private token.
const path=require('node:path'),Module=require('node:module'),{types}=require('node:util');
const files=new Map([
 [path.join(__dirname,'task12-current259-readonly-relay-once.cjs'),['claimReadonlyRelayResource']],
 [path.join(__dirname,'task12-current259-generated-draft-once.cjs'),['claimIdentity261Resource','claimIdentity261Stage']],
 [path.join(__dirname,'task12-current259-first-q2-once.cjs'),['claimIdentity261Resource','claimIdentity261Stage']],
]);
const physicalFile=path.join(__dirname,'enterprise-task01-resources.cjs');
const nativeLoader=process.binding('natives')['internal/modules/cjs/loader'];
let mainSnapshot,physicalSnapshot,broken=false;
const need=ok=>{if(!ok)throw new Error('CURRENT259_IDENTITY_AUTHORITY');};
function own(owner,key){
 need(owner&&!types.isProxy(owner));
 const descriptor=Object.getOwnPropertyDescriptor(owner,key);
 need(descriptor&&Object.hasOwn(descriptor,'value'));
 return descriptor;
}
const same=(a,b)=>a&&b&&['value','writable','enumerable','configurable'].every(key=>a[key]===b[key]);
function hooks(){
 need(typeof nativeLoader==='string');
 for(const [fn,marker] of [[Module._load,'Module._load = function'],[Module._resolveFilename,'Module._resolveFilename = function'],
  [Module._findPath,'Module._findPath = function'],[Module.prototype.require,'Module.prototype.require = function'],
  ...['.js','.json','.node'].map(ext=>[Module._extensions[ext],`Module._extensions['${ext}'] = function`])]){
  const assignment=nativeLoader.indexOf(marker),begin=nativeLoader.indexOf('function',assignment),end=nativeLoader.indexOf('\n};',begin);
  need(assignment>=0&&end>begin&&!types.isProxy(fn)&&Function.prototype.toString.call(fn)===nativeLoader.slice(begin,end+2));
 }
}
function snapshot(record,file,names,frozen=true){
 need(record&&!types.isProxy(record)&&own(own(require,'cache').value,file).value===record&&own(record,'filename').value===file);
 const exported=own(record,'exports');
 need(exported.value&&!types.isProxy(exported.value)&&(!frozen||Object.isFrozen(exported.value)));
 const methods=Object.fromEntries(names.map(name=>{
  const descriptor=own(exported.value,name);
  need(typeof descriptor.value==='function'&&!types.isProxy(descriptor.value));
  return [name,Object.freeze(descriptor)];
 }));
 return Object.freeze({record,file,exported:Object.freeze(exported),filename:Object.freeze(own(record,'filename')),
  cache:own(require,'cache').value,methods:Object.freeze(methods)});
}
function checkOne(state){
 need(state&&own(require,'cache').value===state.cache&&own(state.cache,state.file).value===state.record&&
  same(own(state.record,'filename'),state.filename)&&same(own(state.record,'exports'),state.exported));
 for(const [name,descriptor]of Object.entries(state.methods))need(same(own(state.exported.value,name),descriptor));
}
function check(){
 need(!broken&&mainSnapshot);hooks();checkOne(mainSnapshot);
 need(own(require,'main').value===mainSnapshot.record&&mainSnapshot.methods.assertIdentityFreshMain.value()===true);
 if(physicalSnapshot)checkOne(physicalSnapshot);
}
function guarded(use){
 try{return use();}catch(error){broken=true;throw error;}
}
function captureIdentityMain(record){
 return guarded(()=>{
  need(arguments.length===1&&!broken);hooks();
  const main=own(require,'main').value;
  need(main===record);
  const file=own(main,'filename').value;
  need(files.has(file)&&process.argv[1]===file&&process.execArgv.length===0&&!process._preload_modules?.length);
  if(mainSnapshot){check();need(mainSnapshot.record===record);return;}
  need(own(own(record,'exports').value,'assertIdentityFreshMain').value()===true);
  mainSnapshot=snapshot(record,file,[...files.get(file),'assertIdentityFreshMain']);check();
 });
}
function claimIdentityMain(name,...args){
 return guarded(()=>{
  check();
  const method=mainSnapshot.methods[name];
  need(method);
  return method.value(...args);
 });
}
function captureIdentityPhysical(record){
 return guarded(()=>{
  check();
  if(physicalSnapshot){need(physicalSnapshot.record===record);check();return;}
  physicalSnapshot=snapshot(record,physicalFile,['claimReadonlyRelayBackendVerifier'],false);check();
 });
}
function claimIdentityBackendVerifier(permit,coordinates){
 return guarded(()=>{
  check();need(physicalSnapshot);
  return physicalSnapshot.methods.claimReadonlyRelayBackendVerifier.value(permit,coordinates);
 });
}
module.exports=Object.freeze({captureIdentityMain,claimIdentityMain,captureIdentityPhysical,claimIdentityBackendVerifier});
