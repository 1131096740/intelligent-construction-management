'use strict';
// Host SOURCE component regression: actual SDK/native version + empty builder.
// No client/engine instance, compile, app initialization, connection or business.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=fs.realpathSync(process.cwd());
const {observeCurrent259Build}=require(path.join(ROOT,'services/api/prisma/task16-current259-build.cjs'));
const {loadCurrent259Client}=require(path.join(ROOT,'services/api/prisma/task16-current259-client-loader.cjs'));
const mode=process.env.JG_TASK16_LOADER_COMPONENT_CASE??'one-read-per-pass';
assert.ok(['one-read-per-pass','module-replaced','same-object-export','unsealed-child','snapshot-read','snapshot-finish','snapshot-getter','snapshot-cache-getter','snapshot-exports-getter','snapshot-proxy','snapshot-parent','snapshot-child','snapshot-unknown-export','snapshot-arity-getter'].includes(mode));
test('public empty builder preserves each witness and rejects module drift: '+mode,()=>{
 const handle=observeCurrent259Build();assert.equal(handle.executionAllowed,false);
 const loader=loadCurrent259Client(handle),target=path.join(ROOT,mode.startsWith('snapshot-')?'services/api/dist/database/registered-payment-postgres.snapshot.js':'services/api/dist/database/registered-payment-postgres.cases.js'),mod=require.cache[target];assert.ok(mod?.loaded);
 const reject=()=>assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED');
 if(mode==='one-read-per-pass'){
  const slot=Object.getOwnPropertyDescriptor(fs,'readFileSync'),targetIdentity=fs.lstatSync(target);let captures=0,builder;
  Object.defineProperty(fs,'readFileSync',{...slot,value:function(...args){if(typeof args[0]==='number'){const opened=fs.fstatSync(args[0]);if(opened.dev===targetIdentity.dev&&opened.ino===targetIdentity.ino)captures++;}return Reflect.apply(slot.value,this,args);}});
  try{builder=loader.createTestingModule({imports:[]});}finally{Object.defineProperty(fs,'readFileSync',slot);}
  assert.equal(captures,3,'precheck, collection and postcheck each read the shared module once');
  assert.equal(Object.isFrozen(builder),true);assert.equal(typeof builder.compile,'function');loader.check();
  mod.children.push(mod);
  try{loader.check();}finally{mod.children.pop();}
  loader.check(); // A distinct pass still validates a graph containing a cycle.
 }else if(mode==='module-replaced'){
  require.cache[target]=Object.assign(Object.create(Object.getPrototypeOf(mod)),mod);
  assert.equal(require.cache[target].exports,mod.exports);
  try{reject();}finally{require.cache[target]=mod;}
  reject(); // Restoring a same-export cache entry cannot revive sticky failure.
 }else if(mode==='same-object-export'){
  const key='registeredPaymentPostgresCases',slot=Object.getOwnPropertyDescriptor(mod.exports,key);
  Object.defineProperty(mod.exports,key,{...slot,value:function substitutedCaseMustNeverRun(){throw new Error('must not invoke');}});
  try{reject();}finally{Object.defineProperty(mod.exports,key,slot);}
  reject();
 }else if(mode.startsWith('snapshot-')){
  const namespace=mod.exports,read=Object.getOwnPropertyDescriptor(namespace,'readRegisteredNormalSnapshot'),finish=Object.getOwnPropertyDescriptor(namespace,'finishRegisteredNormalSnapshot'),cacheSlot=Object.getOwnPropertyDescriptor(require.cache,target),exportsSlot=Object.getOwnPropertyDescriptor(mod,'exports'),parent=Object.getOwnPropertyDescriptor(mod,'parent'),parentValue=mod.parent,children=Object.getOwnPropertyDescriptor(mod,'children'),arity=Object.getOwnPropertyDescriptor(read.value,'length');let traps=0;
  try{
   if(mode==='snapshot-read')namespace.readRegisteredNormalSnapshot=function(a,b,c,d,e){void a;void b;void c;void d;void e;};
   if(mode==='snapshot-finish')namespace.finishRegisteredNormalSnapshot=function(a){void a;};
   if(mode==='snapshot-getter')Object.defineProperty(namespace,'readRegisteredNormalSnapshot',{configurable:true,get(){traps++;return read.value;}});
   if(mode==='snapshot-cache-getter')Object.defineProperty(require.cache,target,{configurable:true,get(){traps++;return mod;}});
   if(mode==='snapshot-exports-getter')Object.defineProperty(mod,'exports',{configurable:true,get(){traps++;return namespace;}});
   if(mode==='snapshot-proxy')mod.exports=new Proxy(namespace,{get(){traps++;throw Error('TRAP');}});
   if(mode==='snapshot-parent')mod.parent={...mod.parent};
   if(mode==='snapshot-child')mod.children=[new Proxy(mod.children[0],{get(){traps++;throw Error('TRAP');}})];
   if(mode==='snapshot-unknown-export')namespace.unknownSnapshotExport=()=>{};
   if(mode==='snapshot-arity-getter')Object.defineProperty(read.value,'length',{configurable:true,get(){traps++;return 5;}});
   reject();assert.equal(traps,0);
  }finally{Object.defineProperty(require.cache,target,cacheSlot);Object.defineProperty(mod,'exports',exportsSlot);Object.defineProperty(namespace,'readRegisteredNormalSnapshot',read);Object.defineProperty(namespace,'finishRegisteredNormalSnapshot',finish);if(parent)Object.defineProperty(mod,'parent',parent);else{delete mod.parent;mod.parent=parentValue;}Object.defineProperty(mod,'children',children);Object.defineProperty(read.value,'length',arity);delete namespace.unknownSnapshotExport;}
  reject();
 }else{
  const child=path.join(process.env.HOME,'unsealed-loader-child.cjs');fs.writeFileSync(child,'module.exports=Object.freeze({testOnly:true});\n',{flag:'wx',mode:0o600});
  try{
   require(child);const extra=require.cache[child];assert.equal(extra.loaded,true);mod.children.push(extra);
   try{reject();}finally{mod.children.pop();}
   reject();
  }finally{delete require.cache[child];fs.unlinkSync(child);}
 }
});
