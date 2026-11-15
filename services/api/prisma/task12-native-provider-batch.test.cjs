'use strict';
// Pure finite lookup model. Uses original Nest method bodies on synthetic
// objects, never constructs a Nest/SDK/app or grants a genuine ownership brand.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{types}=require('node:util');
const source=()=>fs.readFileSync(path.join(__dirname,'task16-current259-client-loader.cjs'),'utf8');
function model(opaquePrisma=false){
 const core=path.dirname(require.resolve('@nestjs/core/nest-application-context',{paths:[path.join(__dirname,'..')]}));
 const scope={DEFAULT:0,TRANSIENT:1,REQUEST:2},constants={STATIC_CONTEXT:Object.freeze({id:1})};
 const method=(file,marker,getter=false)=>{const text=fs.readFileSync(path.join(core,file),'utf8'),start=text.indexOf(marker),end=text.indexOf('\n    }',start)+6;assert.ok(start>=0&&end>start);const object=new Function('common_1','constants_1','instance_links_host_1','exceptions_1','unknown_element_exception_1','return ({'+text.slice(start,end)+'});')({Scope:scope},constants,{}, {InvalidClassScopeException:Error},{UnknownElementException:Error});const key=Object.getOwnPropertyNames(object)[0];return getter?Object.getOwnPropertyDescriptor(object,key).get:object[key];};
 const resolverPrototype={find:method('injector/abstract-instance-resolver.js','    find(typeOrToken, options) {')},contextPrototype=Object.create(resolverPrototype),appPrototype=Object.create(contextPrototype),linksPrototype={get:method('injector/instance-links-host.js','    get(token, options = {}) {')},wrapperPrototype={getInstanceByContextId:method('injector/instance-wrapper.js','    getInstanceByContextId(contextId, inquirerId) {')};
 Object.defineProperty(contextPrototype,'get',{value:method('nest-application-context.js','    get(typeOrToken, options = { strict: false }) {'),configurable:true});Object.defineProperty(contextPrototype,'instanceLinksHost',{get:method('nest-application-context.js','    get instanceLinksHost() {',true),configurable:true});Object.defineProperty(wrapperPrototype,'instance',{get:method('injector/instance-wrapper.js','    get instance() {',true),configurable:true});
 let opaqueTraps=0;const tokens=Object.freeze(Array.from({length:16},()=>Object.freeze({}))),providers=Object.freeze(tokens.map((_,i)=>opaquePrisma&&i===8?new Proxy(Object.freeze({}),{get(){opaqueTraps++;throw Error('PRIVATE');},getPrototypeOf(){opaqueTraps++;throw Error('PRIVATE');}}):Object.freeze({}))),container={},target=Object.create(appPrototype),host=Object.create(linksPrototype),links=new Map(),wrappers=[],states=[];
 Object.assign(target,{container,_instanceLinksHost:host,isInitialized:false});Object.assign(host,{container,instanceLinks:links});
 for(let i=0;i<16;i++){const wrapper=Object.create(wrapperPrototype),state={instance:providers[i]};Object.assign(wrapper,{scope:0,values:new WeakMap([[constants.STATIC_CONTEXT,state]])});const link={token:tokens[i],moduleId:'model',collection:new Map(),wrapperRef:wrapper};links.set(tokens[i],[link]);wrappers.push(wrapper);states.push(state);}
 const edges=[];const pin=(o,k)=>edges.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);
 const barrelLeaf={Scope:scope},barrelInterface={};Object.defineProperty(barrelInterface,'Scope',{get(){return barrelLeaf.Scope;},configurable:true});const barrelCommon={};Object.defineProperty(barrelCommon,'Scope',{get(){return barrelInterface.Scope;},configurable:true});
 const module={exports:barrelLeaf},cache={model:module};
 for(const [o,k]of [[contextPrototype,'get'],[resolverPrototype,'find'],[contextPrototype,'instanceLinksHost'],[linksPrototype,'get'],[wrapperPrototype,'instance'],[wrapperPrototype,'getInstanceByContextId'],[Map.prototype,'get'],[WeakMap.prototype,'get'],[Array,'isArray'],[barrelCommon,'Scope'],[barrelInterface,'Scope'],[barrelLeaf,'Scope'],[scope,'DEFAULT'],[scope,'REQUEST'],[scope,'TRANSIENT'],[constants,'STATIC_CONTEXT'],[module,'exports'],[cache,'model']])pin(o,k);
 const pins={Map,WeakMap,Array,objectPrototype:Object.prototype,appPrototype,contextPrototype,resolverPrototype,linksPrototype,wrapperPrototype,staticContext:constants.STATIC_CONTEXT,mapGet:Map.prototype.get,weakGet:WeakMap.prototype.get,descriptor:Object.getOwnPropertyDescriptor,prototype:Object.getPrototypeOf,apply:Reflect.apply,isProxy:types.isProxy,hasOwn:Object.hasOwn,define:Object.defineProperty,freeze:Object.freeze,arrayIsArray:Array.isArray,edges};
 const text=source(),start=text.indexOf('function nativeEquipmentLookupRows('),end=text.indexOf('\nfunction claimCurrent261OfficialDocumentModules(',start);assert.ok(start>=0&&end>start);
 const create=new Function('need','types',text.slice(start,end)+'\nreturn nativeEquipmentLookupRows;')((ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});},types),proof=create(target,container,tokens,pins);
 const warm=()=>{for(let i=0;i<16;i++)proof.warm(tokens[i],target.get(tokens[i]));target.isInitialized=true;};
 const read=()=>{proof.assert();const values=tokens.map(token=>target.get(token));proof.assert();return values;};
 return {opaqueTraps:()=>opaqueTraps,tokens,providers,container,target,host,links,wrappers,states,proof,warm,read,scope,constants,barrelLeaf,barrelInterface,barrelCommon,module,cache,pins};
}
test('fixed warmed sixteen lookup identities use original synchronous Nest path and never rebaseline an unknown read',()=>{
 const f=model();assert.throws(()=>f.proof.assert(),/CURRENT261_NATIVE_PROVIDER_LOOKUP/u);f.warm();assert.deepEqual(f.read(),f.providers);assert.equal(f.proof.expected(f.tokens[0]),f.providers[0]);
 f.links.set(f.tokens[0],[{...f.links.get(f.tokens[0])[0]}]);assert.throws(()=>f.read());assert.throws(()=>f.proof.warm(f.tokens[0],f.providers[0]));
});
test('same callback-restore Map.get counterexample is rejected by the actual new validator before callback',()=>{
 const f=model();f.warm();let calls=0;const observed={export:'original'};
 Object.defineProperty(f.links,'get',{value(key){calls++;observed.export='changed';try{return Map.prototype.get.call(this,key);}finally{observed.export='original';}},configurable:true});
 assert.throws(()=>f.read(),/CURRENT261_NATIVE_PROVIDER_LOOKUP/u);assert.equal(calls,0);assert.equal(observed.export,'original');
});
test('finite lookup substitutions cannot invoke own getters, proxies, scope, context, or inherited options callbacks',()=>{
 const mutations=[
  f=>Object.defineProperty(f.target,'find',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.target,'instanceLinksHost',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.target,'_instanceLinksHost',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>{f.target._instanceLinksHost=new Proxy(f.host,{get(){f.traps++;throw Error('PRIVATE');}});},
  f=>Object.defineProperty(f.host,'get',{value(){f.traps++;return f.links.get(f.tokens[0]);}}),
  f=>Object.defineProperty(f.wrappers[0],'scope',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.wrappers[0],'instance',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.wrappers[0],'getInstanceByContextId',{value(){f.traps++;return f.states[0];}}),
  f=>Object.defineProperty(f.wrappers[0].values,'get',{value(){f.traps++;return f.states[0];}}),
  f=>Object.defineProperty(f.states[0],'instance',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.module,'exports',{get(){f.traps++;return f.barrelLeaf;}}),
  f=>Object.defineProperty(f.barrelLeaf,'Scope',{get(){f.traps++;return f.scope;}}),
  f=>Object.defineProperty(f.scope,'REQUEST',{get(){f.traps++;return 2;}}),
  f=>Object.defineProperty(f.constants,'STATIC_CONTEXT',{get(){f.traps++;return Object.freeze({id:1});}}),
 ];
 for(const mutate of mutations){const f=model();f.traps=0;f.warm();mutate(f);assert.throws(()=>f.read());assert.equal(f.traps,0);}
 for(const key of ['each','moduleId']){const f=model();f.warm();let calls=0,error;try{Object.defineProperty(Object.prototype,key,{get(){calls++;throw Error('PRIVATE');},configurable:true});try{f.read();}catch(value){error=value;}}finally{delete Object.prototype[key];}assert.ok(error);assert.equal(calls,0);}
});
test('request/transient/lazy/missing/static-record/token graph replacements fail closed',()=>{
 for(const mutate of [f=>{delete f.target._instanceLinksHost;},f=>{f.wrappers[0].scope=1;},f=>{f.wrappers[0].scope=2;},f=>{f.wrappers[0].values.delete(f.constants.STATIC_CONTEXT);},f=>{f.wrappers[0].values.set(f.constants.STATIC_CONTEXT,{instance:f.providers[0]});},f=>{f.links.get(f.tokens[0]).push(f.links.get(f.tokens[0])[0]);},f=>{f.links.get(f.tokens[0])[0].wrapperRef=f.wrappers[1];},f=>{f.target.isInitialized=false;},f=>{f.links.get(f.tokens[0])[0].token=f.tokens[1];}]){const f=model();f.warm();mutate(f);assert.throws(()=>f.read());}
});

test('the issued Prisma composite Proxy is opaque identity; unknown wrapping or replacement never executes traps',()=>{
 const f=model(true);f.warm();const value=f.read();assert.equal(value[8],f.providers[8]);assert.equal(f.opaqueTraps(),0);
 let traps=0;f.states[8].instance=new Proxy(f.providers[8],{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');}});assert.throws(()=>f.read());assert.equal(traps,0);assert.equal(f.opaqueTraps(),0);
});
function inspection(f,options={}){
 const text=source(),start=text.indexOf('inspectNativeEquipmentProviders(module,expectedServer){'),end=text.indexOf('},inspectDocumentAuthProviders(',start);assert.ok(start>=0&&end>start);
 const testing={},document={},result={},lifeDocument={exports:{}},server={},adapter={},registry=new WeakMap(),ordinary=f.providers[8];registry.set(ordinary,{used:true,loader:result,loaded:lifeDocument.exports});Object.assign(f.target,{httpServer:server,httpAdapter:adapter});
 let checks=0,collects=0,reads=0;const first=Object.assign(Error('MODEL_ORIGINAL'),{code:'MODEL_ORIGINAL'}),secondary=Object.assign(Error('MODEL_SECONDARY'),{code:'MODEL_SECONDARY'});
 const originalMethods=new Map([['get',f.target.get],['getHttpAdapter',function(){return this.httpAdapter;}]]);Object.defineProperty(f.pins.appPrototype,'getHttpAdapter',{value:originalMethods.get('getHttpAdapter'),configurable:true});
 const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});},dataMethod=(object,key)=>{let next=object;while(next){assert.equal(types.isProxy(next),false);const d=Object.getOwnPropertyDescriptor(next,key);if(d){assert.equal(typeof d.value,'function');return d.value;}next=Object.getPrototypeOf(next);}assert.fail();};
 const check=()=>{checks++;if(options.sourceFailure)throw first;},collect=()=>{collects++;check();if(options.postFailure)throw secondary;};
 const guarded=action=>{if(options.firstFailure)throw first;return action();};

 const object=new Function('need','closed','nativeRows','nativeOrdinary','testing','contractMode','document','values','nativeProviderApply','nativeProviderWeakGet','nativeTask12OrdinaryClients','result','lifeDocument','target','adapter','check','guardedOperation','collect','dataMethod','originalMethods','nativeTokens','nativeProviderFreeze','nativeProviderHasOwn',
  'return ({'+text.slice(start,end)+'}});')(need,!!options.closed,options.noRows?undefined:f.proof,options.noIssuer?undefined:ordinary,testing,options.foreignPurpose?{}:document,document,{PrismaService:f.tokens[8]},(fn,receiver,args)=>{if(fn===f.target.get&&receiver===f.target)reads++;return Reflect.apply(fn,receiver,args);},WeakMap.prototype.get,registry,result,lifeDocument,f.target,adapter,check,guarded,collect,dataMethod,originalMethods,f.tokens,Object.freeze,Object.hasOwn);
 return {testing,server,first,secondary,record:object,run:(module=testing)=>object.inspectNativeEquipmentProviders(module,server),counts:()=>({checks,collects,reads}),registry,ordinary};
}
test('actual fixed owned-inspector body keeps two full boundaries and all sixteen original lookup identities',()=>{
 const f=model(true);f.warm();const owned=inspection(f),pairs=owned.run();assert.equal(pairs.length,16);for(let i=0;i<16;i++){assert.equal(pairs[i][0],f.tokens[i]);assert.equal(pairs[i][1],f.providers[i]);}assert.deepEqual(owned.counts(),{checks:2,collects:1,reads:16});assert.equal(f.opaqueTraps(),0);
});
test('actual inspector rejects foreign purpose/module/issuer/closed or un-warmed state and preserves first error over postcollect',()=>{
 for(const options of [{foreignPurpose:true},{noIssuer:true},{noRows:true},{closed:true}]){const f=model();f.warm();const owned=inspection(f,options);assert.throws(()=>owned.run());assert.equal(owned.counts().checks,0);}
 const f=model();f.warm();const owned=inspection(f);assert.throws(()=>owned.run({}));owned.registry.delete(owned.ordinary);assert.throws(()=>owned.run());
 const g=model();g.warm();const failed=inspection(g,{firstFailure:true,postFailure:true});let error;try{failed.run();}catch(value){error=value;}assert.equal(error,failed.first);assert.equal(failed.counts().collects,1);
});
test('public owned-app dispatch refuses unknown or extra-callback arguments before any proxy trap',()=>{
 const text=source(),start=text.indexOf('function inspectCurrent261OwnedNativeEquipmentProviders('),end=text.indexOf('\nfunction current259OwnedApplicationMethod(',start);assert.ok(start>=0&&end>start);
 const ownedApps=new WeakMap(),need=(ok,code)=>{if(!ok)throw Error(code);};
 const dispatch=new Function('need','nativeProviderDescriptor','nativeProviderWeakPrototype','nativeProviderWeakDescriptor','nativeProviderWeakGet','nativeProviderApply','ownedApps',text.slice(start,end)+'\nreturn inspectCurrent261OwnedNativeEquipmentProviders;')(need,Object.getOwnPropertyDescriptor,WeakMap.prototype,Object.getOwnPropertyDescriptor(WeakMap.prototype,'get'),WeakMap.prototype.get,Reflect.apply,ownedApps);
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');}});assert.throws(()=>dispatch(foreign,{},{}));assert.throws(()=>dispatch({}, {},{},()=>{traps++;}));assert.equal(traps,0);
});
test('unchanged default owned wrapper retains per-call full checks; fixed batch reduces only its sixteen synchronous reads',()=>{
 const f=model(true);f.warm();const text=source(),start=text.indexOf('method(key){\n      if(!APP_METHODS'),end=text.indexOf('\n     }};',start);assert.ok(start>=0&&end>start);
 let checks=0,collects=0;const check=()=>checks++,collect=()=>{collects++;check();},originalMethods=new Map([['get',f.target.get]]);
 const method=new Function('APP_METHODS','methods','originalMethods','closed','close','check','verifyTarget','guardedOperation','collect','types','target','record','nativeRows','nativeTokens','return ({'+text.slice(start,end)+'}}).method;')(['get'],new Map(),originalMethods,false,()=>{},check,key=>originalMethods.get(key),action=>action(),collect,types,f.target,{view:f.target},undefined,undefined);
 const read=method('get');for(let i=0;i<16;i++)assert.equal(read(f.tokens[i]),f.providers[i]);assert.equal(checks,32);assert.equal(collects,16);
 const batch=inspection(f);batch.run();assert.equal(batch.counts().checks,2);assert.equal(batch.counts().collects,1);assert.equal(batch.counts().reads,16);assert.equal(f.opaqueTraps(),0);
});
test('all remaining finite link/context replacement callbacks reject before they can restore module state',()=>{
 const changes=[
  f=>Object.defineProperty(f.host,'instanceLinks',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>{f.host.instanceLinks=new Proxy(f.links,{get(){f.traps++;throw Error('PRIVATE');}});},
  f=>{f.links.set(f.tokens[0],new Proxy(f.links.get(f.tokens[0]),{get(){f.traps++;throw Error('PRIVATE');}}));},
  f=>Object.defineProperty(f.links.get(f.tokens[0]),'0',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.links.get(f.tokens[0])[0],'wrapperRef',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>Object.defineProperty(f.wrappers[0],'values',{get(){f.traps++;throw Error('PRIVATE');}}),
  f=>{f.wrappers[0].values=new Proxy(f.wrappers[0].values,{get(){f.traps++;throw Error('PRIVATE');}});},
  f=>Object.defineProperty(f.cache,'model',{get(){f.traps++;return f.module;}}),
  f=>Object.defineProperty(f.barrelCommon,'Scope',{get(){f.traps++;return f.scope;}}),
  f=>Object.defineProperty(f.barrelInterface,'Scope',{get(){f.traps++;return f.scope;}}),
 ];
 for(const change of changes){const f=model();f.warm();f.traps=0;change(f);assert.throws(()=>f.read());assert.equal(f.traps,0);}
 for(const Ctor of [Map,WeakMap]){const f=model();f.warm();let calls=0,error;const d=Object.getOwnPropertyDescriptor(Ctor.prototype,'get');try{Object.defineProperty(Ctor.prototype,'get',{...d,value(){calls++;throw Error('PRIVATE');}});try{f.read();}catch(value){error=value;}}finally{Object.defineProperty(Ctor.prototype,'get',d);}assert.ok(error);assert.equal(calls,0);}
});
test('cold native inspector never registers rows; only successful original full wrapped gets warm the later batch',()=>{
 const f=model(true);f.target.isInitialized=true;const owned=inspection(f);assert.equal(owned.run(),undefined);assert.equal(f.proof.ready(),false);assert.equal(owned.counts().checks,0);
 const text=source(),start=text.indexOf('method(key){\n      if(!APP_METHODS'),end=text.indexOf('\n     }};',start);let checks=0,collects=0,warmed=0;
 const check=()=>checks++,collect=()=>{collects++;check();},originalMethods=new Map([['get',f.target.get]]),warm={warm(token,instance){assert.equal(checks,collects*2);assert.equal(collects,warmed+1);f.proof.warm(token,instance);warmed++;}};
 const method=new Function('APP_METHODS','methods','originalMethods','closed','close','check','verifyTarget','guardedOperation','collect','types','target','record','nativeRows','nativeTokens','return ({'+text.slice(start,end)+'}}).method;')(['get'],new Map(),originalMethods,false,()=>{},check,key=>originalMethods.get(key),action=>action(),collect,types,f.target,{view:f.target},warm,f.tokens);
 const read=method('get');for(let i=0;i<16;i++)assert.equal(read(f.tokens[i]),f.providers[i]);assert.equal(warmed,16);assert.equal(checks,32);assert.equal(f.proof.ready(),true);
 assert.equal(owned.run().length,16);assert.equal(owned.counts().checks,2);assert.equal(owned.counts().reads,16);
 f.wrappers[0].values.set(f.constants.STATIC_CONTEXT,{instance:f.providers[0]});assert.throws(()=>owned.run());assert.throws(()=>f.proof.warm(f.tokens[0],f.providers[0]));
});
test('actual override binder accepts only its own consumed native issuer and clears a later foreign override',()=>{
 const text=source(),line=text.split('\n').find(line=>line.includes('if(document&&contractMode===document&&token===values.PrismaService)'));assert.ok(line);
 const document={},result={},lifeDocument={exports:{}},values={PrismaService:class{}},registry=new WeakMap();
 const bind=new Function('contractMode','document','token','values','value','nativeProviderApply','nativeProviderWeakGet','nativeTask12OrdinaryClients','result','lifeDocument','prior','let nativeOrdinary=prior;'+line+'return nativeOrdinary;');
 const invoke=(value,prior,mode=document,token=values.PrismaService)=>bind(mode,document,token,values,value,Reflect.apply,WeakMap.prototype.get,registry,result,lifeDocument,prior);
 let traps=0;const client=new Proxy({},{get(){traps++;throw Error('PRIVATE');}});assert.equal(invoke(client),undefined);
 for(const row of [{used:false,loader:result,loaded:lifeDocument.exports},{used:true,loader:{},loaded:lifeDocument.exports},{used:true,loader:result,loaded:{}}]){registry.set(client,row);assert.equal(invoke(client),undefined);}
 registry.set(client,{used:true,loader:result,loaded:lifeDocument.exports});assert.equal(invoke(client),client);assert.equal(invoke({},client),undefined);assert.equal(invoke(client,undefined,{}),undefined);assert.equal(traps,0);
});
