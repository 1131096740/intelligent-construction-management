'use strict';
// Host-only public FS regression. Requires a clean real Darwin build closure;
// deliberately excluded from Ubuntu portable CI. Does not load SDK/native modules.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash,randomBytes}=require('node:crypto');
const ROOT=fs.realpathSync(process.cwd());
const {observeCurrent259Build,claimCurrent259Build}=require(path.join(ROOT,'services/api/prisma/task16-current259-build.cjs'));
const descriptor=Object.getOwnPropertyDescriptor(fs,'lstatSync'),lstat=descriptor.value;
const identity=s=>Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(s[k])]));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function withProbe(action){
 const parent=path.join(ROOT,'node_modules'),probe=path.join(parent,'.jg-stat-binding-'+randomBytes(12).toString('hex'));
 const fd=fs.openSync(probe,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 try{fs.writeFileSync(fd,'HOST_ONLY_PUBLIC_FS_STAT_BINDING\n');}finally{fs.closeSync(fd);}
 try{return action(probe,parent);}finally{Object.defineProperty(fs,'lstatSync',descriptor);fs.chmodSync(probe,0o600);fs.unlinkSync(probe);assert.deepEqual(Object.getOwnPropertyDescriptor(fs,'lstatSync'),descriptor);}
}
function observe(){
 const handle=observeCurrent259Build();assert.equal(handle.executionAllowed,false);
 const material=claimCurrent259Build(handle);material.check();
 assert.ok(Object.keys(require.cache).every(p=>!p.includes('/node_modules/')&&!p.includes('/dist/')&&!p.endsWith('.node')),'public FS observation must not load SDK/runtime/native modules');
 return material;
}
test('public full check binds the tree stat to the actual read and retains sticky failure',()=>withProbe((probe,parent)=>{
 // These real qualifications must succeed before the expected rejection window.
 const material=observe(),beforeHash=sha(probe),beforeParent=identity(lstat(parent,{bigint:true}));
 let changed=false,before,after;
 const forwarding=function(...args){const actual=Reflect.apply(lstat,fs,args);if(args[0]===probe&&!changed){changed=true;before=identity(actual);fs.chmodSync(probe,0o700);after=identity(lstat(probe,{bigint:true}));}return actual;};
 Object.defineProperty(fs,'lstatSync',{...descriptor,value:forwarding});
 try{assert.throws(()=>material.check(),error=>error.code==='CURRENT259_BUILD_CHANGED','mode changed after outer stat must invalidate this full pass');}
 finally{Object.defineProperty(fs,'lstatSync',descriptor);}
 assert.equal(changed,true);assert.notDeepEqual(before,after);assert.equal(before.mode,String(0o100600));assert.equal(after.mode,String(0o100700));
 assert.equal(sha(probe),beforeHash);assert.deepEqual(identity(lstat(parent,{bigint:true})),beforeParent,'chmod must not change parent metadata');
 fs.chmodSync(probe,0o600);
 assert.throws(()=>material.check(),error=>error.code==='CURRENT259_BUILD_CHANGED','restoring file metadata cannot revive rejected observation');
}));
test('public checks accept unchanged passes and independently reject later file metadata changes',()=>withProbe(probe=>{
 const material=observe();material.check();
 fs.chmodSync(probe,0o700);
 assert.throws(()=>material.check(),error=>error.code==='CURRENT259_BUILD_CHANGED');
 fs.chmodSync(probe,0o600);
 assert.throws(()=>material.checkLight(),error=>error.code==='CURRENT259_BUILD_CHANGED');
}));
