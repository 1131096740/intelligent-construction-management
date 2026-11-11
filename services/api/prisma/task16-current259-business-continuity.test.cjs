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
function issuerFixture(){
 const token=Object.freeze({}),handle=Object.freeze({});let calls=0;
 const main={filename:path.join(__dirname,'task16-current259-payment-run-authorization.cjs'),exports:Object.freeze({assertCurrent259PaymentBusinessContinuity(t,h){calls++;return t===token&&h===handle;}})};
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
