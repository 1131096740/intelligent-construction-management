'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function model(){
 const source=fs.readFileSync(path.join(__dirname,'task16-current259-client-loader.cjs'),'utf8');
 const factory=source.slice(source.indexOf(' function createNativeTask12OrdinaryClient('),source.indexOf(' check();material.check();const result=Object.freeze({createNativeTask12OrdinaryClient,'));
 const verifier=source.slice(source.indexOf('function takeCurrent261NativeOrdinaryClient('),source.indexOf('\n}',source.indexOf('function takeCurrent261NativeOrdinaryClient('))+2);
 let valid=true,constructs=0;const options=[];
 class Constructor{constructor(value){constructs++;options.push(value);return new Proxy(this,{});}}
 const values={PrismaService:Constructor},loaded={PrismaService:Constructor},loader=Object.freeze({}),registry=new WeakMap();
 const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
 const ports=new Function('nativeTask12OrdinaryClients','need','material','check','values','loadCurrent261LocalLifecycleDocumentModules','result',factory+'\n'+verifier+'\nreturn {create:createNativeTask12OrdinaryClient,take:takeCurrent261NativeOrdinaryClient};')(registry,need,{source:{profile:{profile:'TASK12_ARCHIVE261_SOURCE_V1'}}},()=>{if(!valid)throw Error('CURRENT_MODULE_CHANGED');},values,()=>loaded,loader);
 const url=new URL('postgresql://jg_fixture_app_'+'a'.repeat(24)+':'+'b'.repeat(96)+'@127.0.0.1:55432/jg_task01_'+'c'.repeat(32));
 for(const [k,v]of Object.entries({schema:'public',connection_limit:'2',sslmode:'require',sslaccept:'strict',sslcert:'/private/tmp/jg-native-contract-model/ca.crt',connect_timeout:'5',pool_timeout:'5',application_name:'native_task12_'+'d'.repeat(32)+'_3'}))url.searchParams.set(k,v);
 return {...ports,url,loader,loaded,values,options,constructs:()=>constructs,invalidate(){valid=false;}};
}
test('fixed native factory alone issues the exact proxy instance and rejects copied/wrapped/foreign/reused values before traps',()=>{
 const f=model(),client=f.create(f.url.toString());assert.equal(require('node:util').types.isProxy(client),true);assert.equal(client instanceof f.loaded.PrismaService,true);assert.equal(f.constructs(),1);
 assert.equal(f.options[0].datasources.db.url,f.url.toString());
 let traps=0;const foreign=new Proxy(client,{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');},getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE');}});
 for(const value of [foreign,{},Object.create(f.loaded.PrismaService.prototype)])assert.throws(()=>f.take(f.loader,f.loaded,value),/CURRENT261_NATIVE_ORDINARY_HANDLE/u);
 assert.equal(traps,0);assert.throws(()=>f.take({},f.loaded,client));assert.throws(()=>f.take(f.loader,{...f.loaded},client));
 assert.equal(f.take(f.loader,f.loaded,client),true);assert.throws(()=>f.take(f.loader,f.loaded,client));
});
test('native issuer rejects unsafe URL before constructor and refuses stale source or changed constructor at consumption',()=>{
 const f=model();for(const change of [url=>url.hostname='8.8.8.8',url=>url.port='5432',url=>url.username='jg_task01_owner',url=>url.searchParams.set('sslaccept','accept_invalid_certs'),url=>url.searchParams.set('connection_limit','1'),url=>url.searchParams.append('sslmode','require')]){const url=new URL(f.url);change(url);assert.throws(()=>f.create(url.toString()));}assert.equal(f.constructs(),0);
 let traps=0;assert.throws(()=>f.create(new Proxy({},{get(){traps++;throw Error('PRIVATE');}})));assert.equal(traps,0);
 const client=f.create(f.url.toString());f.values.PrismaService=class{};assert.throws(()=>f.take(f.loader,f.loaded,client));
 const g=model(),other=g.create(g.url.toString());g.invalidate();assert.throws(()=>g.take(g.loader,g.loaded,other),/CURRENT_MODULE_CHANGED/u);
});
