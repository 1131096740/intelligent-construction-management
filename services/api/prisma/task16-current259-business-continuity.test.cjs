'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
test('large material continuity uses an actual no-follow FD identity without reading or hashing file bytes',t=>{
 const dir=fs.mkdtempSync('/private/tmp/jg-259-meta-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'material');fs.writeFileSync(file,Buffer.alloc(1024*1024,1),{mode:0o600});
 const stat=fs.lstatSync(file,{bigint:true}),identity=Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(stat[k])]));
 const read=fs.readFileSync;let reads=0;
 try{fs.readFileSync=()=>{reads++;throw new Error('large data read');};assert.equal(checkCurrent259FileIdentity(file,identity),true);}finally{fs.readFileSync=read;}
 assert.equal(reads,0);
 fs.renameSync(file,file+'.old');fs.copyFileSync(file+'.old',file);assert.throws(()=>checkCurrent259FileIdentity(file,identity));
 fs.unlinkSync(file);fs.symlinkSync(file+'.old',file);assert.throws(()=>checkCurrent259FileIdentity(file,identity));
});
test('a later close wrapper or getter is never invoked and the actual FD closes on success and failure',t=>{
 const dir=fs.mkdtempSync('/private/tmp/jg-259-meta-close-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'material');fs.writeFileSync(file,'x');
 const stat=fs.lstatSync(file,{bigint:true}),identity=Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(stat[k])]));
 const source=fs.readFileSync(path.join(__dirname,'task16-current259-business-continuity.cjs'),'utf8');
 const evaluate=new Function('require','module','__dirname',source);
 const first=new Error('descriptor identity read failed');
 for(const laterDescriptor of ['wrapper','getter']){
  for(const failAfterOpen of [false,true]){
   let fd,laterCalls=0,originalCloses=0;
   const fsAtLoad={
    ...fs,
    openSync(...args){fd=fs.openSync(...args);return fd;},
    fstatSync(...args){if(failAfterOpen)throw first;return fs.fstatSync(...args);},
    closeSync(openedFd){originalCloses++;fs.closeSync(openedFd);},
   };
   const fixture={exports:{}};
   evaluate(name=>name==='node:fs'?fsAtLoad:require(name),fixture,__dirname);
   const later=()=>{laterCalls++;throw new Error('later close');};
   Object.defineProperty(fsAtLoad,'closeSync',laterDescriptor==='wrapper'?{value:later}:{get:later});
   try{
    const check=()=>fixture.exports.checkCurrent259FileIdentity(file,identity);
    if(failAfterOpen)assert.throws(check,error=>error===first);
    else assert.equal(check(),true);
    assert.equal(Number.isInteger(fd),true);
    assert.throws(()=>fs.fstatSync(fd),{code:'EBADF'});
    assert.equal(originalCloses,1);
    assert.equal(laterCalls,0);
   }finally{
    if(Number.isInteger(fd)&&originalCloses===0)fs.closeSync(fd);
   }
  }
 }
});
function issuerFixture(domain='payment'){
 const token=Object.freeze({}),handle=Object.freeze({});let calls=0;
 const main={filename:path.join(__dirname,domain==='contract'?'task12-current261-local-lifecycle-once.cjs':'task16-current259-payment-run-authorization.cjs'),exports:Object.freeze({[domain==='contract'?'assertCurrent261ContractBusinessContinuity':'assertCurrent259PaymentBusinessContinuity'](t,h){calls++;return t===token&&h===handle;}})};
 const cache={[main.filename]:main},rq=name=>{assert.notEqual(name,'./task16-current259-payment-run-authorization.cjs');return require(name);};rq.main=main;rq.cache=cache;
 const module={exports:{}};
 new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-business-continuity.cjs'),'utf8'))(rq,module,__dirname);
 return {api:module.exports,token,handle,main,cache,calls:()=>calls};
}
test('only the fixed already-published main can be captured without an issuer or callback parameter',()=>{
 const f=issuerFixture();assert.throws(()=>f.api.captureCurrent259BusinessIssuer(()=>true));
 f.api.captureCurrent259BusinessIssuer();assert.equal(f.api.assertCurrent259BusinessIssuer(f.token,f.handle),true);assert.equal(f.calls(),1);
 assert.throws(()=>f.api.assertCurrent259BusinessIssuer({...f.token},f.handle));
 assert.throws(()=>f.api.assertCurrent259BusinessIssuer(f.token,f.handle));
});
test('a same-export replacement main cannot be adopted and restoring it cannot revive continuity',()=>{
 const f=issuerFixture();f.api.captureCurrent259BusinessIssuer();f.cache[f.main.filename]={...f.main};
 assert.throws(()=>f.api.assertCurrent259BusinessIssuer(f.token,f.handle));f.cache[f.main.filename]=f.main;
 assert.throws(()=>f.api.assertCurrent259BusinessIssuer(f.token,f.handle));assert.equal(f.calls(),0);
});
test('metadata refuses an accessor snapshot without invoking it',t=>{
 const dir=fs.mkdtempSync('/private/tmp/jg-259-meta-accessor-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'material');fs.writeFileSync(file,'x');let reads=0;
 const fake={get ctimeMs(){reads++;return 0;}};assert.throws(()=>checkCurrent259FileIdentity(file,fake));assert.equal(reads,0);
});
test('initial main exports accessor is rejected without a getter and restoration does not revive capture',()=>{
 const f=issuerFixture(),descriptor=Object.getOwnPropertyDescriptor(f.main,'exports');let reads=0;
 Object.defineProperty(f.main,'exports',{configurable:true,get(){reads++;return descriptor.value;}});
 assert.throws(()=>f.api.captureCurrent259BusinessIssuer());assert.equal(reads,0);
 Object.defineProperty(f.main,'exports',descriptor);assert.throws(()=>f.api.captureCurrent259BusinessIssuer());
});
test('replacing captured main exports with an accessor invokes no getter and cannot be restored',()=>{
 const f=issuerFixture();f.api.captureCurrent259BusinessIssuer();
 const descriptor=Object.getOwnPropertyDescriptor(f.main,'exports');let reads=0;
 Object.defineProperty(f.main,'exports',{configurable:true,get(){reads++;return descriptor.value;}});
 assert.throws(()=>f.api.assertCurrent259BusinessIssuer(f.token,f.handle));assert.equal(reads,0);
 Object.defineProperty(f.main,'exports',descriptor);assert.throws(()=>f.api.assertCurrent259BusinessIssuer(f.token,f.handle));assert.equal(f.calls(),0);
});
test('a Proxy exports value is refused before descriptor or freeze traps',()=>{
 const f=issuerFixture();let traps=0;
 f.main.exports=new Proxy({}, {getOwnPropertyDescriptor(){traps++;return undefined;},isExtensible(){traps++;return true;}});
 assert.throws(()=>f.api.captureCurrent259BusinessIssuer());assert.equal(traps,0);
});

for(const mutation of ['same-inode-bytes','same-inode-restored-mtime','renamed-inode','symlink'])test('current FD continuity stops a '+mutation+' change between a light guard and the next public operation',t=>{
 const dir=fs.mkdtempSync('/private/tmp/jg-259-meta-toc-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'module.js');fs.writeFileSync(file,'module.exports=1;\n',{mode:0o600});
 const before=fs.lstatSync(file,{bigint:true}),times=fs.statSync(file),identity=Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(before[k])]));
 assert.equal(checkCurrent259FileIdentity(file,identity),true);
 if(mutation.startsWith('same-inode')){fs.writeFileSync(file,'module.exports=2;\n');assert.equal(fs.lstatSync(file,{bigint:true}).ino,before.ino);if(mutation.endsWith('mtime'))fs.utimesSync(file,times.atime,times.mtime);}
 else{fs.renameSync(file,file+'.old');if(mutation==='symlink')fs.symlinkSync(file+'.old',file);else fs.copyFileSync(file+'.old',file);}
 let effects=0;const nextPublicOperation=()=>{checkCurrent259FileIdentity(file,identity);effects++;};
 assert.throws(nextPublicOperation,/CURRENT259_BUSINESS_CONTINUITY/u);assert.equal(effects,0);
});

test('the closed contract main has a separate validator and cannot authorize payment fault scenarios',()=>{
 const f=issuerFixture('contract');f.api.captureCurrent261ContractBusinessIssuer();
 assert.equal(f.api.assertCurrent259BusinessIssuer(f.token,f.handle),true);
 assert.throws(()=>f.api.assertCurrent259CommitCancellationIssuer(f.token,f.handle));
});
test('the contract capture refuses payment main and caller supplied issuer parameters',()=>{
 const f=issuerFixture();assert.throws(()=>f.api.captureCurrent261ContractBusinessIssuer());
 const c=issuerFixture('contract');assert.throws(()=>c.api.captureCurrent261ContractBusinessIssuer(()=>true));
 c.api.captureCurrent261ContractBusinessIssuer();assert.throws(()=>c.api.assertCurrent259BusinessIssuer(Object.freeze({kind:'CURRENT261_PRIVATE_BUSINESS_CONTINUITY'}),c.handle));
});
