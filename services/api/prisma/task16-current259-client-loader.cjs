"use strict";
// Loads only this observation's sealed physical closure. No SDK instance, DB,
// custom constructor, supplied resolver or application bootstrap is accepted.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {types}=require('node:util');
const {claimCurrent259Build}=require('./task16-current259-build.cjs');
const BUILTIN_LOADER_SOURCE=process.binding('natives')['internal/modules/cjs/loader'];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const own=(value,key)=>{need(value&&!types.isProxy(value),'CURRENT259_LOADER_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'CURRENT259_LOADER_DESCRIPTOR');return d.value;};
const cache=new WeakMap(),ownedModules=new WeakMap(),ownedApps=new WeakMap(),creationFailures=new WeakMap();
const APP_METHODS=['close','get','getHttpAdapter','enableCors','useGlobalPipes','init','getHttpServer','listen'];
function dataMethod(value,key){let next=value;for(let i=0;next&&i<32;i++,next=Object.getPrototypeOf(next)){need(!types.isProxy(next),'CURRENT259_OWNED_METHOD');const d=Object.getOwnPropertyDescriptor(next,key);if(d){need(Object.hasOwn(d,'value')&&typeof d.value==='function','CURRENT259_OWNED_METHOD');return d.value;}}throw new Error('CURRENT259_OWNED_METHOD');}
function current259OwnedApplicationMethod(value,key){return ownedApps.get(value)?.method(key);}
function current259OwnedApplicationView(value){return ownedApps.get(value)?.view;}
function isCurrent259OwnedModule(value){return ownedModules.has(value);}
function createCurrent259OwnedApplication(value){const owner=ownedModules.get(value);need(owner,'CURRENT259_OWNED_MODULE');return owner.create();}
function takeCurrent259CreationFailure(error){const entry=creationFailures.get(error);creationFailures.delete(error);return entry;}

function coreHooksUnmodified(){
 // Fixed Node CJS assignments, not a JavaScript interpreter. Comparing to the
 // pinned running Node's builtin source prevents an earlier wrapper from being
 // adopted as the baseline merely because its reference stays unchanged.
 const source=BUILTIN_LOADER_SOURCE;
 if(typeof source!=="string")return false;
 const checks=[[Module._load,"Module._load = function"],[Module._resolveFilename,"Module._resolveFilename = function"],[Module._findPath,"Module._findPath = function"],[Module.prototype.require,"Module.prototype.require = function"],...[".js",".json",".node"].map(ext=>[Module._extensions[ext],`Module._extensions['${ext}'] = function`])];
 return checks.every(([fn,marker])=>{const assignment=source.indexOf(marker);if(assignment<0||typeof fn!=="function")return false;const begin=source.indexOf("function",assignment),end=source.indexOf("\n};",begin);return end>begin&&Function.prototype.toString.call(fn)===source.slice(begin,end+2);});
}

function loadCurrent259Client(handle){
 need(arguments.length===1,'CURRENT259_LOADER_ARGUMENTS');
 if(handle&&!types.isProxy(handle)&&cache.has(handle)){const previous=cache.get(handle);previous.check();return previous;}
 const material=claimCurrent259Build(handle),root=material.root;
 need(coreHooksUnmodified()&&!process._preload_modules?.length,'CURRENT259_LOADER_HOOKS');
 const hooks={load:Module._load,resolve:Module._resolveFilename,find:Module._findPath,require:Module.prototype.require,extensions:{...Module._extensions}};
 const nodeBuiltins=new Set(Module.builtinModules.map(x=>x.replace(/^node:/u,''))),files=new Map();
 let failed=false,loading=false,applicationExports,reflection;
 const hooksMatch=()=>Module._resolveFilename===hooks.resolve&&Module._findPath===hooks.find&&Module.prototype.require===hooks.require&&['.js','.json','.node'].every(ext=>Module._extensions[ext]===hooks.extensions[ext]);
 function guardedOperation(action){
  need(!loading&&!failed&&coreHooksUnmodified()&&hooksMatch(),'CURRENT259_LOADER_HOOKS');loading=true;
  function guarded(request,parent,isMain){
   need(hooksMatch()&&Module._load===guarded,'CURRENT259_LOADER_HOOKS');
   const resolved=hooks.resolve.call(Module,request,parent,isMain);
   if(!Module.isBuiltin(resolved)&&!nodeBuiltins.has(resolved.replace(/^node:/u,'')))material.capture(fs.realpathSync(resolved));
   const result=hooks.load.call(this,request,parent,isMain);
   need(hooksMatch()&&Module._load===guarded,'CURRENT259_LOADER_HOOKS');return result;
  }
  const restore=()=>{const valid=Module._load===guarded&&hooksMatch();Module._load=hooks.load;loading=false;need(valid,'CURRENT259_LOADER_HOOKS');};
  Module._load=guarded;
  try{const value=action();if(types.isPromise(value))return value.then(result=>{restore();return result;},error=>{failed=true;restore();throw error;});restore();return value;}
  catch(error){failed=true;if(loading)restore();throw error;}
 }
 const guardedRequire=entry=>guardedOperation(()=>require(entry));
 // A preloaded dependency is not adopted as the first observation. Source-only
 // producer/loader files may already be loaded; none of the five runtime trees may.
 const runtimeRoots=['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(p=>path.join(root,p));
 const inside=(a,b)=>b===a||b.startsWith(a+path.sep);
 need(!Object.keys(require.cache).some(p=>runtimeRoots.some(r=>inside(r,p))),'CURRENT259_LOADER_PRELOADED');
 material.check();const loaded=guardedRequire(material.generatedIndex),Class=own(loaded,'PrismaClient'),prisma=own(loaded,'Prisma');
 need(typeof Class==='function'&&prisma.prismaVersion?.client==='5.22.0'&&prisma.prismaVersion?.engine==='605197351a3c8bdd595af2d2a9bc3025bca48ea2','CURRENT259_LOADER_CLASS');
 const engine=guardedRequire(material.engine.path),engineVersion=own(engine,'version'),QueryEngine=own(engine,'QueryEngine');
 need(typeof engineVersion==='function'&&typeof QueryEngine==='function','CURRENT259_LOADER_ENGINE');
 const observedVersion=engineVersion();
 need(observedVersion?.commit==='605197351a3c8bdd595af2d2a9bc3025bca48ea2','CURRENT259_LOADER_ENGINE');
 const records=[],values={};
 for(let i=0;i<8;i++){
  const entry=material.applicationEntries[i],exports=guardedRequire(entry.path),mod=require.cache[entry.path],key=material.keys[i],value=own(exports,key);
  need(typeof value==='function'&&mod?.loaded===true&&mod.exports===exports,'CURRENT259_LOADER_EXPORT');
  records.push({module:mod,key,value});values[key]=value;
  if(i===0){const token=own(exports,'Task16ImpactReaderToken');need(typeof token==='symbol','CURRENT259_LOADER_EXPORT');records.push({module:mod,key:'Task16ImpactReaderToken',value:token});values.Task16ImpactReaderToken=token;}
 }
 const requireAt=Module.createRequire(path.join(root,'services/api/package.json'));
 const framework={};
 for(const [name,entry]of [['TestingModule','@nestjs/testing/testing-module'],['NestApplication','@nestjs/core/nest-application'],['ExpressAdapter','@nestjs/platform-express/adapters/express-adapter']]){
  const file=fs.realpathSync(requireAt.resolve(entry)),exports=guardedRequire(file);framework[name]=own(exports,name);need(typeof framework[name]==='function','CURRENT259_FRAMEWORK_CLASS');records.push({module:require.cache[file],key:name,value:framework[name]});
 }
 const nativeProxy=globalThis.Proxy;
 const originalCreate=dataMethod(framework.TestingModule.prototype,'createNestApplication'),originalAdapterProxy=dataMethod(framework.TestingModule.prototype,'createAdapterProxy');
 const originalClose=dataMethod(framework.NestApplication.prototype,'close');
 function visit(mod,visited){
  if(visited.has(mod))return;visited.add(mod);need(mod&&mod.loaded&&typeof mod.filename==='string'&&require.cache[mod.filename]===mod,'CURRENT259_LOADER_MODULE');
  const captured=material.capture(mod.filename),prior=files.get(mod.filename);
  if(prior)need(prior.module===mod&&prior.exports===mod.exports&&prior.sha256===captured.sha256,'CURRENT259_LOADER_MODULE');
  else files.set(mod.filename,{...captured,module:mod,exports:mod.exports});
  for(const child of mod.children)visit(child,visited);
 }
 const roots=[require.cache[material.generatedIndex],require.cache[material.clientEntry],require.cache[material.engine.path],...records.map(r=>r.module)];
 for(const mod of roots)visit(mod,new Set());
 // Preserve the existing exact Nest composition and all six global guards.
  need(Object.getPrototypeOf(values.PrismaService)===Class&&Object.getPrototypeOf(values.PrismaService.prototype)===Class.prototype,"TASK16_APP_PRISMA_CLASS");
  reflection={get:Reflect.getMetadata,define:Reflect.defineMetadata};need(typeof reflection.get==='function'&&typeof reflection.define==='function',"TASK16_APP_REFLECTION_CHANGED");
  const exported=(file,key)=>{const mod=require.cache[path.join(root,'services/api/dist',file+'.js')];need(mod&&files.get(mod.filename)?.module===mod,"TASK16_APP_METADATA_SOURCE");const d=Object.getOwnPropertyDescriptor(mod.exports,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function',"TASK16_APP_METADATA_SOURCE");return d.value;};
  const metadata=(key,Class)=>reflection.get.call(Reflect,key,Class);
  const imports=[["database/database.module","DatabaseModule"],["auth/auth.module","AuthModule"],["audit/audit.module","AuditModule"],["file/file.module","FileModule"],["fund-account/fund-account.module","FundAccountModule"],["operating-ledger/operating-ledger.module","OperatingLedgerModule"],["project-funding/project-funding.module","ProjectFundingModule"],["business-entry-definition/business-entry-transaction.module","BusinessEntryTransactionModule"]].map(([f,k])=>exported(f,k));
  const guards=[["auth/guards/jwt-auth.guard","JwtAuthGuard"],["retired-write-entry/retired-write-entry.guard","RetiredWriteEntryGuard"],["operational-write-freeze/operational-write-freeze.guard","OperationalWriteFreezeGuard"],["auth/guards/account-rate-limit.guard","AccountRateLimitGuard"],["auth/guards/permission.guard","PermissionGuard"],["contract-cutover/contract-cutover.guard","ContractCutoverGuard"]].map(([f,k])=>exported(f,k));
  const controller=exported('payment/registered-payment-execution.controller','RegisteredPaymentExecutionController'),filter=exported('project/project-operating-constraint.filter','ProjectOperatingConstraintFilter');
  const serviceProviders=[["payment/payment-amount.service","PaymentAmountService"],["payment/payment-request.service","PaymentRequestService"],["payment/registered-payment-execution.service","RegisteredPaymentExecutionService"],["payment/registered-payment-notification.service","RegisteredPaymentNotificationService"],["approval/approval-sms.service","ApprovalSmsService"]].map(([f,k])=>exported(f,k));
  const readerModule=require.cache[path.join(root,'services/api/dist/payment/registered-payment-impact-reader.js')];
  const token=values.Task16ImpactReaderToken,readerKey="REGISTERED_PAYMENT_IMPACT_READER";
  need(readerModule&&files.get(readerModule.filename)?.module===readerModule&&
   Object.getOwnPropertyDescriptor(readerModule.exports,readerKey)?.value===token,"TASK16_APP_METADATA_SOURCE");
  records.push({module:readerModule,key:readerKey,value:token});
  const initialReaderProvider=metadata('providers',values.Task16RegisteredApplicationModule)?.[6];
  const initialReaderValue=Object.getOwnPropertyDescriptor(initialReaderProvider??{},'useValue')?.value;
  need(typeof initialReaderValue==='function',"TASK16_APP_METADATA_CHANGED");
  const checkMetadata=()=>{const actualImports=metadata('imports',values.Task16RegisteredApplicationModule);need(Array.isArray(actualImports)&&actualImports.length===imports.length&&imports.every((v,i)=>actualImports[i]===v),"TASK16_APP_METADATA_CHANGED");const controllers=metadata('controllers',values.Task16RegisteredApplicationModule);need(controllers?.length===1&&controllers[0]===controller,"TASK16_APP_METADATA_CHANGED");const providers=metadata('providers',values.Task16RegisteredApplicationModule);need(providers?.length===7&&serviceProviders.every((Class,i)=>providers[i]===Class)&&providers[5]?.provide==='APP_FILTER'&&providers[5].useClass===filter&&providers[6]===initialReaderProvider&&providers[6].provide===token&&Object.getOwnPropertyDescriptor(providers[6],'useValue')?.value===initialReaderValue,"TASK16_APP_METADATA_CHANGED");const actual=metadata('providers',imports[1])?.filter(row=>row?.provide==='APP_GUARD');need(actual?.length===6&&guards.every((Class,i)=>actual[i].useClass===Class),"TASK16_APP_METADATA_CHANGED");};

 need(!/\bconstructor\s*\(/u.test(Function.prototype.toString.call(values.PrismaService)),'CURRENT259_LOADER_CONSTRUCTOR');
 const wrapper=require.cache[material.clientEntry];need(wrapper&&own(wrapper.exports,'PrismaClient')===Class,'CURRENT259_LOADER_CLASS');
 const methods=['$connect','$disconnect','$transaction','$queryRawUnsafe'].map(key=>({key,value:Class.prototype[key]}));
 need(methods.every(row=>typeof row.value==='function'),'CURRENT259_LOADER_CLASS');
 const serviceMethods=['onModuleInit','onApplicationShutdown'].map(key=>({key,value:values.PrismaService.prototype[key]}));
 need(serviceMethods.every(row=>typeof row.value==='function'),'CURRENT259_LOADER_CONSTRUCTOR');
 applicationExports={records,checkMetadata};const exportedValues=Object.freeze({...values}),Test=values.Test,testMethod=own(Test,'createTestingModule');
 function check(){
  need(!failed&&!loading&&coreHooksUnmodified()&&Module._load===hooks.load&&hooksMatch(),'CURRENT259_LOADER_HOOKS');
  try{
   material.checkLight();for(const mod of roots)visit(mod,new Set());
   for(const row of files.values())need(require.cache[row.path]===row.module&&row.module.exports===row.exports,'CURRENT259_LOADER_MODULE');
   need(require.cache[material.clientEntry]===wrapper&&own(wrapper.exports,'PrismaClient')===Class&&own(loaded,'PrismaClient')===Class&&prisma.prismaVersion?.client==='5.22.0'&&prisma.prismaVersion?.engine==='605197351a3c8bdd595af2d2a9bc3025bca48ea2'&&own(engine,'version')===engineVersion&&own(engine,'QueryEngine')===QueryEngine,'CURRENT259_LOADER_CLASS');
   need(Reflect.getMetadata===reflection.get&&Reflect.defineMetadata===reflection.define,'TASK16_APP_REFLECTION_CHANGED');
   for(const row of records)need(own(row.module.exports,row.key)===row.value,'CURRENT259_LOADER_EXPORT');
   need(Object.getPrototypeOf(values.PrismaService)===Class&&Object.getPrototypeOf(values.PrismaService.prototype)===Class.prototype&&methods.every(r=>Class.prototype[r.key]===r.value)&&serviceMethods.every(r=>values.PrismaService.prototype[r.key]===r.value)&&own(Test,'createTestingModule')===testMethod,'CURRENT259_LOADER_CONSTRUCTOR');
   checkMetadata();
   for(const p of Object.keys(require.cache))if(runtimeRoots.some(r=>inside(r,p)))need(files.has(p),'CURRENT259_LOADER_FOREIGN_CACHE');
  }catch{failed=true;throw Object.assign(new Error('CURRENT259_LOADER_CHANGED'),{code:'CURRENT259_LOADER_CHANGED'});}
 }
 const expectedRequest=Object.freeze(['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'].map((p,i)=>Object.freeze({name:['application','database','security','projection','json','validation','listen'][i],path:'services/api/dist/'+p})));
 const loadApplicationModules=request=>{check();need(JSON.stringify(request)===JSON.stringify(expectedRequest),'TASK16_APP_FIXED_ENTRIES');return exportedValues;};
 function collect(){for(const mod of roots)visit(mod,new Set());check();}
 function createTestingModule(metadata){
  check();need(metadata&&!types.isProxy(metadata)&&Reflect.ownKeys(metadata).length===1,'CURRENT259_FRAMEWORK_METADATA');
  const imports=own(metadata,'imports');need(Array.isArray(imports)&&!types.isProxy(imports)&&(imports.length===0||imports.length===1&&imports[0]===values.Task16RegisteredApplicationModule),'CURRENT259_FRAMEWORK_METADATA');
  const builder=guardedOperation(()=>testMethod.call(Test,metadata));collect();
  const compile=dataMethod(builder,'compile'),override=dataMethod(builder,'overrideProvider');let compiled=false;
  const facade=Object.freeze({overrideProvider(token){
   check();need(!compiled&&(token===values.PrismaService||token===values.Task16ImpactReaderToken),'CURRENT259_FRAMEWORK_OVERRIDE');
   const receiver=override.call(builder,token),use=dataMethod(receiver,'useValue');
   return Object.freeze({useValue(value){check();need(!compiled,'CURRENT259_FRAMEWORK_OVERRIDE');use.call(receiver,value);return facade;}});
  },async compile(){
   check();need(!compiled,'CURRENT259_FRAMEWORK_REENTRY');compiled=true;
   const testing=await guardedOperation(()=>compile.call(builder));collect();
   need(testing&&!types.isProxy(testing)&&Object.getPrototypeOf(testing)===framework.TestingModule.prototype,'CURRENT259_FRAMEWORK_MODULE');
   need(dataMethod(testing,'createNestApplication')===originalCreate&&dataMethod(testing,'createAdapterProxy')===originalAdapterProxy,'CURRENT259_FRAMEWORK_MODULE');
   let consumed=false;
   ownedModules.set(testing,{create(){
    check();need(!consumed&&globalThis.Proxy===nativeProxy,'CURRENT259_FRAMEWORK_REENTRY');consumed=true;
    need(dataMethod(testing,'createNestApplication')===originalCreate&&dataMethod(testing,'createAdapterProxy')===originalAdapterProxy,'CURRENT259_FRAMEWORK_MODULE');
    const before=Object.getOwnPropertyDescriptor(testing,'createAdapterProxy');
    need(!before||Object.hasOwn(before,'value')&&before.value===originalAdapterProxy&&before.configurable,'CURRENT259_FRAMEWORK_DESCRIPTOR');
    let target,adapter,proxy,closePromise;
    const close=()=>closePromise??=(async()=>originalClose.call(target))();
    function witness(application,httpAdapter){
     need(!target&&!types.isProxy(application)&&Object.getPrototypeOf(application)===framework.NestApplication.prototype
      &&httpAdapter&&!types.isProxy(httpAdapter)&&Object.getPrototypeOf(httpAdapter)===framework.ExpressAdapter.prototype,'CURRENT259_FRAMEWORK_TARGET');
     // Record target ownership before any later adapter/proxy operation can throw.
     target=application;adapter=httpAdapter;
     need(globalThis.Proxy===nativeProxy,'CURRENT259_FRAMEWORK_PROXY');
     return originalAdapterProxy.call(testing,application,httpAdapter);
    }
    try{
     Object.defineProperty(testing,'createAdapterProxy',{value:witness,configurable:true,writable:false,enumerable:false});
     try{proxy=guardedOperation(()=>originalCreate.call(testing));}
     finally{
      const current=Object.getOwnPropertyDescriptor(testing,'createAdapterProxy');
      if(before)Object.defineProperty(testing,'createAdapterProxy',before);else delete testing.createAdapterProxy;
      need(current?.value===witness,'CURRENT259_FRAMEWORK_DESCRIPTOR');
     }
     collect();need(target&&adapter&&types.isProxy(proxy)&&globalThis.Proxy===nativeProxy,'CURRENT259_FRAMEWORK_PROXY');
     const originalMethods=new Map(APP_METHODS.map(key=>[key,dataMethod(target,key)]));
     let closed=false;const methods=new Map();
     const record={method(key){
      if(!APP_METHODS.includes(key))return undefined;
      if(methods.has(key))return methods.get(key);
      const fn=originalMethods.get(key);
      const wrapped=key==='close'?()=>{closed=true;return close();}:(...args)=>{
       check();need(!closed&&dataMethod(target,key)===fn&&dataMethod(target,'getHttpAdapter')===originalMethods.get('getHttpAdapter')&&originalMethods.get('getHttpAdapter').call(target)===adapter,'CURRENT259_FRAMEWORK_CHANGED');
       const result=guardedOperation(()=>fn.apply(target,args));
       if(types.isPromise(result))return result.then(value=>{collect();return value===target?record.view:value;});collect();return result===target?record.view:result;
      };
      methods.set(key,wrapped);return wrapped;
     }};
     record.view=Object.freeze(Object.fromEntries(APP_METHODS.map(key=>[key,record.method(key)])));
     ownedApps.set(proxy,record);return proxy;
    }catch(error){
     const wrapped=Object.assign(new Error('CURRENT259_FRAMEWORK_CREATION_FAILED'),{code:'CURRENT259_FRAMEWORK_CREATION_FAILED'});
     if(target)creationFailures.set(wrapped,Object.freeze({value:target,close}));throw wrapped;
    }
   }});
   return testing;
  }});
  return facade;
 }
 check();material.check();const result=Object.freeze({Class,PrismaService:values.PrismaService,Test,check,verifyFull:()=>{check();material.check();},loadApplicationModules,createTestingModule,
  constructorContract:'IMPLICIT_DERIVED_CONSTRUCTOR_FORWARDS_OPTIONS;LIFECYCLE_HOOKS_UNCHANGED_NOT_CALLED',
  witness:()=>{check();return Object.freeze({source:material.source,build:material.summary,host:process.platform+'-'+process.arch,engineCommit:observedVersion.commit,modules:files.size,executionAllowed:false});}});
 cache.set(handle,result);return result;
}
module.exports=Object.freeze({loadCurrent259Client,current259OwnedApplicationMethod,current259OwnedApplicationView,isCurrent259OwnedModule,createCurrent259OwnedApplication,takeCurrent259CreationFailure});
