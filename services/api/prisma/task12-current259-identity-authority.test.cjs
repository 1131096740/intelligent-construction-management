'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const file=path.join(__dirname,'task12-current259-identity-authority.cjs');
function model(){
 const holder={exports:{}},filename=path.join(__dirname,'task12-current259-readonly-relay-once.cjs');
 let used=0;
 const api=Object.freeze({claimReadonlyRelayResource(){used++;return true;},assertIdentityFreshMain:()=>true});
 const main={filename,exports:api};
 const native=require;
 const rq=name=>native(name);rq.main=main;rq.cache={[filename]:main};
 const modelProcess=Object.defineProperties(Object.create(process),{argv:{value:['node',filename]},execArgv:{value:[]},_preload_modules:{value:[]}});
 new Function('require','module','__dirname','process',fs.readFileSync(file,'utf8'))(rq,holder,__dirname,modelProcess);
 return {api:holder.exports,main,rq,filename,used:()=>used};
}
test('the authority captures only its fixed main and retains exact exported descriptors',()=>{
 const f=model();
 f.api.captureIdentityMain(f.main);
 assert.equal(f.api.claimIdentityMain('claimReadonlyRelayResource',{}),true);
 assert.equal(f.used(),1);
 let foreign=0;
 f.main.exports=Object.freeze({claimReadonlyRelayResource(){foreign++;return true;},assertIdentityFreshMain:()=>true});
 assert.throws(()=>f.api.claimIdentityMain('claimReadonlyRelayResource',{}),/IDENTITY_AUTHORITY/u);
 assert.equal(foreign,0);
 f.main.exports=Object.freeze({});
 assert.throws(()=>f.api.claimIdentityMain('claimReadonlyRelayResource',{}),/IDENTITY_AUTHORITY/u);
});
test('a foreign cache record or non-main issuer has no capture authority',()=>{
 const f=model();
 f.rq.cache[f.filename]={filename:f.filename,exports:f.main.exports};
 assert.throws(()=>f.api.captureIdentityMain(f.main),/IDENTITY_AUTHORITY/u);
 assert.equal(f.used(),0);
});
for(const forged of ['issuer','physical','authority'])test('preloaded '+forged+' claimant cannot enter a resource from a non-main caller',()=>{
 const base=__dirname;
 const script=`
 const path=require('node:path');
 const base=process.argv[1];let calls=0,spawns=0;
 const make=(name,exports)=>{const filename=path.join(base,name);require.cache[filename]={id:filename,filename,loaded:true,exports};};
 const fn=()=>{calls++;return ()=>true;};
 if(process.argv[2]==='issuer')make('task12-current259-readonly-relay-once.cjs',Object.freeze({claimReadonlyRelayResource:fn}));
 if(process.argv[2]==='physical')make('enterprise-task01-resources.cjs',Object.freeze({claimReadonlyRelayBackendVerifier:fn}));
 if(process.argv[2]==='authority')make('task12-current259-identity-authority.cjs',Object.freeze({claimIdentityMain:fn,captureIdentityPhysical:fn,claimIdentityBackendVerifier:fn}));
 require('node:child_process').spawn=()=>{spawns++;throw Error('unexpected spawn');};
 (async()=>{
  const options={runId:'12345678-1234-4234-8234-123456789012',sourceSha:'a'.repeat(40),artifactsDir:'/private/tmp/',endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',
   daemonId:'synthetic-daemon-12345',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',
   ownerPassword:'a'.repeat(96),tools:{docker:'/Applications/Docker.app/Contents/Resources/bin/docker',openssl:'/opt/homebrew/Cellar/openssl@3/3.6.3/bin/openssl'},signal:new AbortController().signal};
  const start=process.argv[2]==='issuer'?require(path.join(base,'enterprise-task01-resources.cjs')).startCurrent259ReadonlyRelayPostgres:
   (input,permit)=>require(path.join(base,'task16-current259-loopback-forward.cjs')).startCurrent259LoopbackForward({containerId:'7'.repeat(64),dockerConfig:'/private/tmp/no-resource/tls-private/docker-config',signal:input.signal},permit);
  let failed=false;
  try{await start(options,{});}catch(error){failed=error.message==='CURRENT259_IDENTITY_AUTHORITY';}
  process.stdout.write(JSON.stringify({failed,calls,spawns}));
 })();`;
 const row=JSON.parse(execFileSync(process.execPath,['-e',script,base,forged],{encoding:'utf8'}));
 assert.deepEqual(row,{failed:true,calls:0,spawns:0});
});

test('physical callback claim is captured once and cannot be replaced after main admission',()=>{
 const f=model();f.api.captureIdentityMain(f.main);
 const file=path.join(__dirname,'enterprise-task01-resources.cjs');
 let foreign=0;
 const physical={filename:file,exports:Object.freeze({claimReadonlyRelayBackendVerifier:()=> 'original'})};
 f.rq.cache[file]=physical;f.api.captureIdentityPhysical(physical);
 assert.equal(f.api.claimIdentityBackendVerifier({},{}),'original');
 physical.exports=Object.freeze({claimReadonlyRelayBackendVerifier(){foreign++;return ()=>true;}});
 assert.throws(()=>f.api.claimIdentityBackendVerifier({},{}),/IDENTITY_AUTHORITY/u);
 assert.equal(foreign,0);
});
