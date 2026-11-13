'use strict';
// Host SOURCE component regression: actual SDK/native version + empty builder.
// No client/engine instance, compile, app initialization, connection or business.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=fs.realpathSync(process.cwd());
const {observeCurrent259Build}=require(path.join(ROOT,'services/api/prisma/task16-current259-build.cjs'));
const {loadCurrent259Client}=require(path.join(ROOT,'services/api/prisma/task16-current259-client-loader.cjs'));
const mode=process.env.JG_TASK16_LOADER_COMPONENT_CASE??'one-read-per-pass';
assert.ok(['one-read-per-pass','module-replaced','same-object-export','unsealed-child'].includes(mode));
test('public empty builder preserves each witness and rejects module drift: '+mode,()=>{
 const handle=observeCurrent259Build();assert.equal(handle.executionAllowed,false);
 const loader=loadCurrent259Client(handle),target=path.join(ROOT,'services/api/dist/database/registered-payment-postgres.cases.js'),mod=require.cache[target];assert.ok(mod?.loaded);
 const reject=()=>assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED');
 if(mode==='one-read-per-pass'){
  const slot=Object.getOwnPropertyDescriptor(fs,'openSync');let captures=0,builder;
  Object.defineProperty(fs,'openSync',{...slot,value:function(...args){if(args[0]===target)captures++;return Reflect.apply(slot.value,this,args);}});
  try{builder=loader.createTestingModule({imports:[]});}finally{Object.defineProperty(fs,'openSync',slot);}
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
 }else{
  const child=path.join(process.env.HOME,'unsealed-loader-child.cjs');fs.writeFileSync(child,'module.exports=Object.freeze({testOnly:true});\n',{flag:'wx',mode:0o600});
  try{
   require(child);const extra=require.cache[child];assert.equal(extra.loaded,true);mod.children.push(extra);
   try{reject();}finally{mod.children.pop();}
   reject();
  }finally{delete require.cache[child];fs.unlinkSync(child);}
 }
});
