'use strict';
// Explicit postbuild, constructor-only component. No SDK connection/query,
// Nest assembly, HTTP, SQL, qualification, resource or admission is performed.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{types}=require('node:util');
const scenario=process.env.JG_NATIVE_ORDINARY_SCENARIO;
if(scenario===undefined){
 for(const selected of ['positive','mutation'])test('genuine constructor-only native ordinary '+selected,async()=>{
  const {spawn}=require('node:child_process');
  const env={...process.env,JG_NATIVE_ORDINARY_SCENARIO:selected};delete env.NODE_TEST_CONTEXT;
  for(const key of ['DATABASE_URL','NODE_OPTIONS','NODE_PATH','PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_QUERY_ENGINE_BINARY'])delete env[key];
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[__filename],{env,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('CONSTRUCTOR_COMPONENT_TIMEOUT'));},90000);child.stdout.on('data',b=>{out+=b;assert.ok(out.length<65536);});child.stderr.on('data',b=>{err+=b;assert.ok(err.length<65536);});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});});
  assert.equal(result.code,0,result.out+'\n'+result.err);assert.match(result.out,/# pass 1/u);assert.match(result.out,/# fail 0/u);
 });
}else{
 if(!['positive','mutation'].includes(scenario))throw Error('FIXED_SCENARIO_REQUIRED');
 test('genuine fixed native ordinary constructor boundary',()=>{
  const {observeCurrent259Build}=require('./task16-current259-build.cjs'),api=require('./task16-current259-client-loader.cjs');
  const loader=api.loadCurrent259Client(observeCurrent259Build()),loaded=loader.loadCurrent261LocalLifecycleDocumentModules();
  const url=new URL('postgresql://jg_fixture_app_'+'a'.repeat(24)+':'+'b'.repeat(96)+'@127.0.0.1:55432/jg_task01_'+'c'.repeat(32));
  for(const [key,value]of Object.entries({schema:'public',connection_limit:'2',sslmode:'require',sslaccept:'strict',sslcert:'/private/tmp/jg-native-contract-constructor/ca.crt',connect_timeout:'5',pool_timeout:'5',application_name:'native_task12_'+'d'.repeat(32)+'_3'}))url.searchParams.set(key,value);
  const client=loader.createNativeTask12OrdinaryClient(url.toString());
  assert.equal(types.isProxy(client),true);assert.equal(client instanceof loaded.PrismaService,true);
  if(scenario==='mutation'){
   const mod=require(path.join(__dirname,'../dist/database/prisma.service.js')),d=Object.getOwnPropertyDescriptor(mod,'PrismaService');
   try{Object.defineProperty(mod,'PrismaService',{...d,value:class Foreign{}});assert.throws(()=>api.takeCurrent261NativeOrdinaryClient(loader,loaded,client),error=>error.code==='CURRENT259_LOADER_CHANGED');}
   finally{Object.defineProperty(mod,'PrismaService',d);}return;
  }
  let traps=0;const foreign=new Proxy(client,{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE');}});
  assert.throws(()=>api.takeCurrent261NativeOrdinaryClient(loader,loaded,foreign),error=>error.code==='CURRENT261_NATIVE_ORDINARY_HANDLE');assert.equal(traps,0);
  assert.throws(()=>api.takeCurrent261NativeOrdinaryClient({...loader},loaded,client),error=>error.code==='CURRENT261_NATIVE_ORDINARY_HANDLE');
  assert.throws(()=>api.takeCurrent261NativeOrdinaryClient(loader,{...loaded},client),error=>error.code==='CURRENT261_NATIVE_ORDINARY_HANDLE');
  assert.equal(api.takeCurrent261NativeOrdinaryClient(loader,loaded,client),true);assert.throws(()=>api.takeCurrent261NativeOrdinaryClient(loader,loaded,client),error=>error.code==='CURRENT261_NATIVE_ORDINARY_HANDLE');
 });
}
