"use strict";
const {assertCurrent259BusinessIssuer:businessIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
// Loads only this observation's sealed physical closure. No SDK instance, DB,
// custom constructor, supplied resolver or application bootstrap is accepted.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const {types}=require('node:util');
const {claimCurrent259Build}=require('./task16-current259-build.cjs');
const BUILTIN_LOADER_SOURCE=process.binding('natives')['internal/modules/cjs/loader'];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const own=(value,key)=>{need(value&&!types.isProxy(value),'CURRENT259_LOADER_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'CURRENT259_LOADER_DESCRIPTOR');return d.value;};
const officialDocumentModuleViews=new WeakMap();
function claimCurrent261OfficialDocumentModules(view){
 const code='CURRENT261_OFFICIAL_DOCUMENT_MODULES';
 need(arguments.length===1&&view&&typeof view==='object'&&!types.isProxy(view)&&officialDocumentModuleViews.has(view),code);
 const lease=officialDocumentModuleViews.get(view);lease.verifyFull();return lease;
}
const cache=new WeakMap(),ownedModules=new WeakMap(),ownedApps=new WeakMap(),creationFailures=new WeakMap();
const APP_METHODS=['close','get','getHttpAdapter','enableCors','useGlobalPipes','init','getHttpServer','listen'];
function dataMethod(value,key){let next=value;for(let i=0;next&&i<32;i++,next=Object.getPrototypeOf(next)){need(!types.isProxy(next),'CURRENT259_OWNED_METHOD');const d=Object.getOwnPropertyDescriptor(next,key);if(d){need(Object.hasOwn(d,'value')&&typeof d.value==='function','CURRENT259_OWNED_METHOD');return d.value;}}throw new Error('CURRENT259_OWNED_METHOD');}
function current259OwnedApplicationMethod(value,key){return ownedApps.get(value)?.method(key);}
function current259OwnedApplicationView(value){return ownedApps.get(value)?.view;}
function inspectCurrent259OwnedPaymentProviders(value,testing,server){
 return ownedApps.get(value)?.inspectPaymentProviders(testing,server);
}
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
 let failed=false,loading=false,reflection;
 const hooksMatch=()=>Module._resolveFilename===hooks.resolve&&Module._findPath===hooks.find&&Module.prototype.require===hooks.require&&['.js','.json','.node'].every(ext=>Module._extensions[ext]===hooks.extensions[ext]);
 function guardedOperation(action){
  try{need(!loading&&!failed&&coreHooksUnmodified()&&hooksMatch(),'CURRENT259_LOADER_HOOKS');}catch(error){failed=true;throw error;}loading=true;
  function guarded(request,parent,isMain){
   need(hooksMatch()&&Module._load===guarded,'CURRENT259_LOADER_HOOKS');
   const resolved=hooks.resolve.call(Module,request,parent,isMain);
   if(!Module.isBuiltin(resolved)&&!nodeBuiltins.has(resolved.replace(/^node:/u,'')))material.capture(fs.realpathSync(resolved));
   const result=hooks.load.call(this,request,parent,isMain);
   need(hooksMatch()&&Module._load===guarded,'CURRENT259_LOADER_HOOKS');return result;
  }
  const restore=()=>{const valid=Module._load===guarded&&hooksMatch();if(Module._load===guarded)Module._load=hooks.load;loading=false;if(!valid){failed=true;throw Object.assign(new Error('CURRENT259_LOADER_HOOKS'),{code:'CURRENT259_LOADER_HOOKS'});}};
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
 // Capture both original cases and their seed's lazy dependencies before the
 // loader is returned. Same-object export replacement is not a fresh baseline.
 const paymentValues={};
 for(const [entry,keys,publish]of [
  [requireAt.resolve('bcryptjs'),['hash'],false],
  [path.join(root,'services/api/dist/company-entity/unified-social-credit-code.js'),['assertValidUnifiedSocialCreditCode'],false],
  [path.join(root,'services/api/dist/database/registered-payment-postgres.fixture.js'),['buildRegisteredPgFixturePlan','seedRegisteredPgFixture','seedRegisteredPgCompetitionFixture','seedRegisteredPgCompetitionFollowUpFixture','seedRegisteredPgAttributionGapFixture','assertRegisteredPgConnectedRoles','registeredPgHttp'],true],
  [path.join(root,'services/api/dist/database/registered-payment-postgres.cases.js'),['registeredPaymentPostgresCases','runRegisteredNullCrossCompanyCommit','runRegisteredNullCrossCompanyResponseLoss','runRegisteredNullCrossCompanyCommitCancellation','runRegisteredNullCrossCompanyDisconnectAttempt','confirmRegisteredNullCrossCompanyDisconnectRollback','runRegisteredNullCrossCompanyDisconnectRecovery','runRegisteredTwoActorPaymentCompetition','runRegisteredTwoActorPaymentCompetitionFollowUp','runRegisteredProjectAttributionGap','observeRegisteredPaymentVoucherLedger'],true]
 ]){
  const file=fs.realpathSync(entry),exports=guardedRequire(file),mod=require.cache[file];
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(exports,key);need(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function','CURRENT259_PAYMENT_EXPORT');
   records.push({module:mod,key,value:descriptor.value,descriptor});if(publish)paymentValues[key]=descriptor.value;
  }
 }
 const paymentExports=Object.freeze(paymentValues);
 const framework={};
 for(const [name,entry]of [['TestingModule','@nestjs/testing/testing-module'],['NestContainer','@nestjs/core/injector/container'],['NestApplication','@nestjs/core/nest-application'],['ExpressAdapter','@nestjs/platform-express/adapters/express-adapter']]){
  const file=fs.realpathSync(requireAt.resolve(entry)),exports=guardedRequire(file);framework[name]=own(exports,name);need(typeof framework[name]==='function','CURRENT259_FRAMEWORK_CLASS');records.push({module:require.cache[file],key:name,value:framework[name]});
 }
 const nativeProxy=globalThis.Proxy;
 const originalCreate=dataMethod(framework.TestingModule.prototype,'createNestApplication'),originalAdapterProxy=dataMethod(framework.TestingModule.prototype,'createAdapterProxy');
 const originalClose=dataMethod(framework.NestApplication.prototype,'close');
 const creationMethods=new Map(['isHttpServer','createHttpAdapter','applyLogger'].map(key=>[key,dataMethod(framework.TestingModule.prototype,key)]));
 const setHttpAdapter=dataMethod(framework.NestContainer.prototype,'setHttpAdapter');
 function visit(mod,visited){
  if(visited.has(mod))return;visited.add(mod);need(mod&&mod.loaded&&typeof mod.filename==='string'&&require.cache[mod.filename]===mod,'CURRENT259_LOADER_MODULE');
  const captured=material.capture(mod.filename),prior=files.get(mod.filename);
  if(prior)need(prior.module===mod&&prior.exports===mod.exports&&prior.sha256===captured.sha256,'CURRENT259_LOADER_MODULE');
  else files.set(mod.filename,{...captured,module:mod,exports:mod.exports});
  for(const child of mod.children)visit(child,visited);
 }
 const roots=[require.cache[material.generatedIndex],require.cache[material.clientEntry],require.cache[material.engine.path],...records.map(r=>r.module)];
 function visitRoots(){
  // Share the traversal only within one synchronous witness pass.
  const visited=new Set();
  for(const mod of roots)visit(mod,visited);
 }
 visitRoots();
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
 const methods=['$connect','$disconnect','$transaction','$queryRawUnsafe'].map(key=>({key,descriptor:Object.getOwnPropertyDescriptor(Class.prototype,key)}));
 need(methods.every(row=>row.descriptor&&Object.hasOwn(row.descriptor,'value')&&typeof row.descriptor.value==='function'),'CURRENT259_LOADER_CLASS');
 const classMethodsUnchanged=()=>methods.every(({key,descriptor})=>{const actual=Object.getOwnPropertyDescriptor(Class.prototype,key);return actual&&Object.hasOwn(actual,'value')&&['value','writable','enumerable','configurable'].every(field=>actual[field]===descriptor[field]);});
 const serviceMethods=['onModuleInit','onApplicationShutdown'].map(key=>({key,value:values.PrismaService.prototype[key]}));
 need(serviceMethods.every(row=>typeof row.value==='function'),'CURRENT259_LOADER_CONSTRUCTOR');
 const exportedValues=Object.freeze({...values}),Test=values.Test,testMethod=own(Test,'createTestingModule');
 let contract,document,lifeDocument,ordinaryTestingUsed=false;
 function check(){
  try{
   need(!failed&&!loading&&coreHooksUnmodified()&&Module._load===hooks.load&&hooksMatch(),'CURRENT259_LOADER_HOOKS');
   material.checkLight();visitRoots();
   for(const row of files.values())need(require.cache[row.path]===row.module&&row.module.exports===row.exports,'CURRENT259_LOADER_MODULE');
   need(require.cache[material.clientEntry]===wrapper&&own(wrapper.exports,'PrismaClient')===Class&&own(loaded,'PrismaClient')===Class&&prisma.prismaVersion?.client==='5.22.0'&&prisma.prismaVersion?.engine==='605197351a3c8bdd595af2d2a9bc3025bca48ea2'&&own(engine,'version')===engineVersion&&own(engine,'QueryEngine')===QueryEngine,'CURRENT259_LOADER_CLASS');
   need(Reflect.getMetadata===reflection.get&&Reflect.defineMetadata===reflection.define,'TASK16_APP_REFLECTION_CHANGED');
   for(const row of records){need(own(row.module.exports,row.key)===row.value,'CURRENT259_LOADER_EXPORT');if(row.descriptor){const actual=Object.getOwnPropertyDescriptor(row.module.exports,row.key);need(actual&&['value','writable','enumerable','configurable'].every(key=>actual[key]===row.descriptor[key]),'CURRENT259_PAYMENT_EXPORT');}}
   need(Object.getPrototypeOf(values.PrismaService)===Class&&Object.getPrototypeOf(values.PrismaService.prototype)===Class.prototype&&classMethodsUnchanged()&&serviceMethods.every(r=>values.PrismaService.prototype[r.key]===r.value)&&own(Test,'createTestingModule')===testMethod,'CURRENT259_LOADER_CONSTRUCTOR');
   checkMetadata();contract?.checkMetadata();document?.checkMetadata();lifeDocument?.checkMetadata();
   for(const p of Object.keys(require.cache))if(runtimeRoots.some(r=>inside(r,p)))need(files.has(p),'CURRENT259_LOADER_FOREIGN_CACHE');
  }catch{failed=true;throw Object.assign(new Error('CURRENT259_LOADER_CHANGED'),{code:'CURRENT259_LOADER_CHANGED'});}
 }
 function checkContinuity(token,ownedHandle){
  try{
   businessIssuer(token,ownedHandle);
   need(!failed&&!loading&&coreHooksUnmodified()&&Module._load===hooks.load&&hooksMatch(),'CURRENT259_LOADER_HOOKS');
   material.checkContinuity(token,ownedHandle);
   const seen=new Set();
   const visitIdentity=mod=>{if(seen.has(mod))return;seen.add(mod);const row=files.get(mod?.filename);
    need(row&&row.module===mod&&mod.loaded&&require.cache[row.path]===mod&&mod.exports===row.exports,'CURRENT259_LOADER_MODULE');
    for(const child of mod.children)visitIdentity(child);
   };
   for(const mod of roots)visitIdentity(mod);
   for(const row of files.values())need(require.cache[row.path]===row.module&&row.module.exports===row.exports,'CURRENT259_LOADER_MODULE');
   need(require.cache[material.clientEntry]===wrapper&&own(wrapper.exports,'PrismaClient')===Class&&own(loaded,'PrismaClient')===Class&&own(engine,'version')===engineVersion&&own(engine,'QueryEngine')===QueryEngine&&prisma.prismaVersion?.client==='5.22.0'&&prisma.prismaVersion?.engine==='605197351a3c8bdd595af2d2a9bc3025bca48ea2','CURRENT259_LOADER_CLASS');
   for(const row of records){need(own(row.module.exports,row.key)===row.value,'CURRENT259_LOADER_EXPORT');if(row.descriptor){const actual=Object.getOwnPropertyDescriptor(row.module.exports,row.key);need(actual&&['value','writable','enumerable','configurable'].every(k=>actual[k]===row.descriptor[k]),'CURRENT259_PAYMENT_EXPORT');}}
   need(Reflect.getMetadata===reflection.get&&Reflect.defineMetadata===reflection.define&&Object.getPrototypeOf(values.PrismaService)===Class&&Object.getPrototypeOf(values.PrismaService.prototype)===Class.prototype&&classMethodsUnchanged()&&serviceMethods.every(r=>values.PrismaService.prototype[r.key]===r.value)&&own(Test,'createTestingModule')===testMethod,'CURRENT259_LOADER_CONSTRUCTOR');
   checkMetadata();contract?.checkMetadata();document?.checkMetadata();lifeDocument?.checkMetadata();for(const file of Object.keys(require.cache))if(runtimeRoots.some(r=>inside(r,file)))need(files.has(file),'CURRENT259_LOADER_FOREIGN_CACHE');
  }catch{failed=true;throw Object.assign(new Error('CURRENT259_LOADER_CHANGED'),{code:'CURRENT259_LOADER_CHANGED'});}
 }
 function verifyBusinessFiles(token,ownedHandle){
  checkContinuity(token,ownedHandle);
  try{
   // The in-memory graph is checked on every transition. At the fixed impact
   // boundaries, each already-loaded file gets one physical identity check.
   for(const row of files.values())checkCurrent259FileIdentity(row.path,row.identity);
  }catch{failed=true;throw Object.assign(new Error('CURRENT259_LOADER_CHANGED'),{code:'CURRENT259_LOADER_CHANGED'});}
 }
 const expectedRequest=Object.freeze(['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'].map((p,i)=>Object.freeze({name:['application','database','security','projection','json','validation','listen'][i],path:'services/api/dist/'+p})));
 const loadApplicationModules=request=>{check();need(JSON.stringify(request)===JSON.stringify(expectedRequest),'TASK16_APP_FIXED_ENTRIES');return exportedValues;};
 function collect(){for(const mod of roots)visit(mod,new Set());check();}
 function loadContractApplicationModules(){
  need(arguments.length===0&&!document,'CURRENT259_CONTRACT_FIXED_ENTRIES');check();
  if(contract)return contract.exports;
  try{
   const dist=path.join(root,'services/api/dist');
   const contractValues={};
   for(const [relative,names]of [
    ['database/task12-first-q2-application.module.js',['Task12FirstQ2ApplicationModule']],
    ['contract/contract.module.js',['ContractModule']],
    ['contract/contract-direct-archive-runtime.js',['ContractDirectArchiveRuntime','ContractUpwardDirectArchiveRuntime']],
   ]){
    const file=path.join(dist,relative),exports=guardedRequire(file),mod=require.cache[file];
    need(mod?.loaded===true&&mod.exports===exports,'CURRENT259_CONTRACT_FIXED_ENTRIES');
    roots.push(mod);
    for(const key of names){
     const descriptor=Object.getOwnPropertyDescriptor(exports,key),value=own(exports,key);
     need(typeof value==='function','CURRENT259_CONTRACT_FIXED_ENTRIES');
     records.push({module:mod,key,value,descriptor});contractValues[key]=value;
    }
   }
   const {Task12FirstQ2ApplicationModule,ContractModule,ContractDirectArchiveRuntime,ContractUpwardDirectArchiveRuntime}=contractValues;
   const tokens=Object.freeze([values.PrismaService,ContractDirectArchiveRuntime,ContractUpwardDirectArchiveRuntime]);
   const shutdown=tokens.slice(1).map(token=>dataMethod(token.prototype,'onApplicationShutdown'));
   const inactive=['app.module.js','main.js','contract-document/contract-document-worker.module.js',
    'contract-document/contract-document.processor.js'].map(file=>path.join(dist,file));
   const published=Object.freeze({...contractValues,...Object.fromEntries(['PrismaService','configureApiSecurity',
    'configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi'].map(key=>[key,values[key]]))});
   contract=Object.freeze({root:Task12FirstQ2ApplicationModule,tokens,exports:published,checkMetadata(){
    const rootImports=metadata('imports',Task12FirstQ2ApplicationModule),rootProviders=metadata('providers',Task12FirstQ2ApplicationModule);
    const contractImports=metadata('imports',ContractModule),contractProviders=metadata('providers',ContractModule);
    need(Array.isArray(rootImports)&&rootImports.length===2&&rootImports[0]===imports[0]&&rootImports[1]===ContractModule&&
     Array.isArray(rootProviders)&&rootProviders.length===1&&own(rootProviders[0],'provide')==='APP_FILTER'&&own(rootProviders[0],'useClass')===filter&&
     Array.isArray(contractImports)&&contractImports.filter(value=>value===imports[1]).length===1&&
     Array.isArray(contractProviders)&&tokens.slice(1).every((token,i)=>contractProviders.filter(value=>value===token).length===1&&
      dataMethod(token.prototype,'onApplicationShutdown')===shutdown[i])&&inactive.every(file=>!files.has(file)),'CURRENT259_CONTRACT_METADATA');
   }});
   collect();return published;
  }catch(error){failed=true;throw error;}
 }
 let generatedDraftAdmission;
 function loadGeneratedContractDraftAdmission(){
  need(arguments.length===0&&!document,'CURRENT259_GENERATED_DRAFT_FIXED_ENTRY');
  check();
  if(generatedDraftAdmission)return generatedDraftAdmission;
  try{
   const file=path.join(root,'services/api/dist/database/task12-generated-approval-admission.js');
   const exports=guardedRequire(file),module=require.cache[file];
   need(module?.loaded===true&&module.exports===exports,'CURRENT259_GENERATED_DRAFT_FIXED_ENTRY');
   roots.push(module);
   generatedDraftAdmission=Object.freeze(Object.fromEntries([
    'buildTask12GeneratedApprovalFixture','hashTask12GeneratedAdmissionPassword','openTask12GeneratedApprovalDraft'
   ].map(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(exports,key),value=own(exports,key);
    need(typeof value==='function','CURRENT259_GENERATED_DRAFT_FIXED_ENTRY');
    records.push({module,key,value,descriptor});return [key,value];
   })));
   collect();return generatedDraftAdmission;
  }catch(error){failed=true;throw error;}
 }
 function loadGeneratedContractDocumentModules(){
  const code='CURRENT259_GENERATED_DOCUMENT_FIXED_ENTRY';
  need(arguments.length===0&&!contract&&!generatedDraftAdmission&&!ordinaryTestingUsed,code);
  check();
  if(document)return document.exports;
  try{
   const dist=path.join(root,'services/api/dist');
   const documentValues={};
   for(const [relative,names]of [
    ['database/task12-generated-document-application.module.js',['Task12GeneratedDocumentApplicationModule']],
    ['database/task12-generated-approval-admission.js',['buildTask12GeneratedApprovalFixture','hashTask12GeneratedAdmissionPassword','openTask12GeneratedApprovalDraft']],
    ['auth/jwt-token.service.js',['JwtTokenService']],
    ['contract/contract.module.js',['ContractModule']],
    ['contract-template/contract-template.module.js',['ContractTemplateModule']],
    ['contract-template/contract-template.controller.js',['ContractTemplateController']],
    ['contract-template/contract-template.service.js',['ContractTemplateService']],
    ['contract-template/contract-scenario.service.js',['ContractScenarioService']],
    ['contract-template/layout-template.service.js',['LayoutTemplateService']],
    ['contract-document/contract-document-worker.module.js',['ContractDocumentWorkerModule']],
    ['contract-document/contract-document.processor.js',['ContractDocumentProcessor']],
    ['contract-document/contract-document.module.js',['ContractDocumentModule']],
    ['contract-document/contract-document.service.js',['ContractDocumentService']],
    ['contract-workbench/contract-workbench.module.js',['ContractWorkbenchModule']],
    ['contract-workbench/contract-draft.controller.js',['ContractDraftController']],
    ['file/file.service.js',['FileService','PrivateFileStorage']],
    ['contract/contract-version-file-read-authority.js',['CONTRACT_VERSION_FILE_READ_AUTHORITY']],
    ['database/task12-generated-document-seam.js',['verifyTask12MaterialTemplate','bindTask12PublishedMaterialTemplate','runTask12GeneratedDocument']],
    ['database/task12-generated-document-draft-save.js',['saveTask12GeneratedDocumentDraft']],
    ['database/task12-generated-material-template.js',['publishTask12GeneratedMaterialTemplate']],
    ['database/task12-generated-document-readback.js',['readTask12GeneratedDocumentOutputs','claimTask12GeneratedDocumentOwnerReadback']],
    ['database/task12-generated-document-role-services.js',['withTask12PreownedDocumentRoleServices','withTask12NestDocumentRoleServices']],
   ]){
    const file=path.join(dist,relative),exports=guardedRequire(file),mod=require.cache[file];
    need(mod?.loaded===true&&mod.exports===exports,code);
    roots.push(mod);
    for(const key of names){
     const descriptor=Object.getOwnPropertyDescriptor(exports,key),value=own(exports,key);
     need(typeof value===(key==='CONTRACT_VERSION_FILE_READ_AUTHORITY'?'symbol':'function'),code);
     records.push({module:mod,key,value,descriptor});
     documentValues[key]=value;
    }
   }
   const {Task12GeneratedDocumentApplicationModule:rootClass,ContractModule,ContractTemplateModule,
    ContractTemplateController,ContractTemplateService,ContractScenarioService,LayoutTemplateService,
    ContractDocumentWorkerModule,ContractDocumentProcessor,ContractDocumentModule,ContractDocumentService,
    ContractWorkbenchModule,ContractDraftController,FileService,PrivateFileStorage}=documentValues;
   const tokens=Object.freeze([values.PrismaService,PrivateFileStorage,LayoutTemplateService,ContractDocumentProcessor]);
   const originalQueue=dataMethod(ContractDocumentService.prototype,'queueDraftPreview');
   const originalVerifyJwt=dataMethod(documentValues.JwtTokenService.prototype,'verifyAccessToken');
   const originalFileAccess=dataMethod(FileService.prototype,'assertCanDownloadFile');
   const hooks=['onApplicationBootstrap','onModuleDestroy','onApplicationShutdown','processNext']
    .map(key=>[key,dataMethod(ContractDocumentProcessor.prototype,key)]);
   const rootImports=[imports[0],ContractModule,ContractTemplateModule,ContractDocumentWorkerModule];
   const workerImports=[imports[2],imports[1],imports[0],imports[3]];
   const templateImports=[imports[0],imports[2],imports[3]];
   const templateProviders=[ContractTemplateService,ContractScenarioService,LayoutTemplateService];
   const exact=(key,Class,expected)=>{
    const actual=metadata(key,Class);
    return Array.isArray(actual)&&actual.length===expected.length&&expected.every((value,index)=>value===actual[index]);
   };
   const exports=Object.freeze({...Object.fromEntries([
    'verifyTask12MaterialTemplate','bindTask12PublishedMaterialTemplate','runTask12GeneratedDocument',
    'saveTask12GeneratedDocumentDraft',
    'publishTask12GeneratedMaterialTemplate','readTask12GeneratedDocumentOutputs','claimTask12GeneratedDocumentOwnerReadback',
    'withTask12PreownedDocumentRoleServices','withTask12NestDocumentRoleServices',
    'PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor','ContractDocumentService',
    'ContractDraftController','FileService','CONTRACT_VERSION_FILE_READ_AUTHORITY','JwtTokenService',
    'buildTask12GeneratedApprovalFixture','hashTask12GeneratedAdmissionPassword','openTask12GeneratedApprovalDraft'
   ].map(key=>[key,documentValues[key]])),...Object.fromEntries([
    'PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi'
   ].map(key=>[key,values[key]]))});
   document=Object.freeze({root:rootClass,tokens,exports,checkMetadata(){
    const rootProviders=metadata('providers',rootClass);
    need(exact('imports',rootClass,rootImports)&&exact('imports',ContractDocumentWorkerModule,workerImports)&&
     exact('providers',ContractDocumentWorkerModule,[ContractDocumentProcessor])&&
     exact('imports',ContractTemplateModule,templateImports)&&exact('providers',ContractTemplateModule,templateProviders)&&
     exact('exports',ContractTemplateModule,templateProviders)&&exact('controllers',ContractTemplateModule,[ContractTemplateController])&&
     metadata('providers',ContractDocumentModule)?.filter(provider=>provider===ContractDocumentService).length===1&&
     metadata('controllers',ContractWorkbenchModule)?.filter(controller=>controller===ContractDraftController).length===1&&
     metadata('providers',imports[3])?.filter(provider=>provider===FileService).length===1&&
     metadata('providers',imports[3])?.filter(provider=>provider===PrivateFileStorage).length===1&&
     dataMethod(ContractDocumentService.prototype,'queueDraftPreview')===originalQueue&&
     dataMethod(documentValues.JwtTokenService.prototype,'verifyAccessToken')===originalVerifyJwt&&
     dataMethod(FileService.prototype,'assertCanDownloadFile')===originalFileAccess&&
     Array.isArray(rootProviders)&&rootProviders.length===1&&own(rootProviders[0],'provide')==='APP_FILTER'&&
     own(rootProviders[0],'useClass')===filter&&
     hooks.every(([key,value])=>dataMethod(ContractDocumentProcessor.prototype,key)===value)&&
     ['app.module.js','main.js'].every(file=>!files.has(path.join(dist,file))),code);
   }});
   collect();
   return exports;
  }catch(error){failed=true;throw error;}
 }
 function loadCurrent261LocalLifecycleDocumentModules(){
  const code='CURRENT261_LOCAL_LIFECYCLE_MODULE_SOURCE';
  need(arguments.length===0&&material.source.profile.profile==='TASK12_ARCHIVE261_SOURCE_V1',code);
  check();if(lifeDocument)return lifeDocument.exports;
  try{
   const base=loadGeneratedContractDocumentModules(),published={},modules={};
   for(const [slot,relative,names]of [
    ['fixture','services/api/dist/database/task12-local-lifecycle-fixture.js',['buildTask12LocalLifecycleFixture','isTask12LocalLifecycleFixture','createTask12LocalLifecycleOriginals']],
    ['case','services/api/dist/database/task12-local-lifecycle-case.js',['runTask12LocalLifecycleCase','expectTask12LocalLifecycleAuditRollback','finishTask12LocalLifecycleCase','claimTask12LocalLifecycleCheckpoint']],
    ['sample','services/api/dist/contract-document/task12-official-qualification-sample.js',['createOfficialQualificationSample','canonicalOfficialQualificationDocx']],
    ['profile','services/api/prisma/task12-official-document-profile.cjs',['currentOfficialDocumentScope']],
    ['child','services/api/prisma/task12-official-document-child.cjs',['createOfficialDocumentChildBudget','attachPostcheck']],
    ['context','services/api/prisma/task12-document-context.cjs',['createDocumentContextAuthority']],
    ['runtime','services/api/prisma/task12-current259-generated-document-runtime.cjs',['verifyOfficialTask12DocumentRuntime','withOfficialTask12DocumentRuntime']],
    ['converter','services/api/dist/contract-document/contract-body-pdf-converter.js',['contractBodyPdfRuntimeLockFingerprint','assertContractBodyPdfRuntimeLock','convertContractBodyDocxToPdf']],
    ['lo','services/api/dist/contract-document/libreoffice-converter.js',['convertDocxToPdf','convertXlsxToPdf']]
   ]){
    const file=path.join(root,relative),exports=guardedRequire(file),mod=require.cache[file];
    need(mod?.loaded===true&&mod.exports===exports&&mod.filename===file,code);modules[slot]=mod;roots.push(mod);
    for(const key of names){const descriptor=Object.getOwnPropertyDescriptor(exports,key);need(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function',code);
     records.push({module:mod,key,value:descriptor.value,descriptor});
     if(['fixture','case','profile'].includes(slot))published[key]=descriptor.value;
    }
   }
   const {assertCurrent261LocalLifecycleToolClosure}=require('./task12-current261-local-lifecycle-module-proof.cjs');
   const verify=()=>assertCurrent261LocalLifecycleToolClosure(root,modules,require.cache);verify();
   const readTask12LocalLifecycleSourceDocx=function(){
    need(arguments.length===0,code);check();
    const file=path.join(root,'services/api/assets/templates/material-purchase-real-v1.docx'),observed=material.capture(file);
    const fields=['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'];
    const identity=stat=>Object.fromEntries(fields.map(k=>[k,String(stat[k])]));
    const same=stat=>stat.isFile()&&JSON.stringify(identity(stat))===JSON.stringify(observed.identity);
    need(BigInt(observed.identity.size)>0n&&BigInt(observed.identity.size)<8n*1024n*1024n,code);
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    let bytes;
    try{
     need(same(fs.fstatSync(fd,{bigint:true})),code);bytes=Buffer.alloc(Number(observed.identity.size));let offset=0;
     while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);need(count>0,code);offset+=count;}
     need(fs.readSync(fd,Buffer.alloc(1),0,1,bytes.length)===0&&same(fs.fstatSync(fd,{bigint:true}))&&same(fs.lstatSync(file,{bigint:true}))&&fs.realpathSync(file)===file,code);
    }finally{fs.closeSync(fd);}
    need(createHash('sha256').update(bytes).digest('hex')===observed.sha256,code);check();return bytes;
   };
   lifeDocument=Object.freeze({exports:Object.freeze({...base,...published,readTask12LocalLifecycleSourceDocx}),checkMetadata:verify});
   collect();
   const lease=Object.freeze({root,source:material.source,build:material.summary,
    check:()=>check(),verifyFull:()=>{check();material.check();},
    createOfficialQualificationSample:own(modules.sample.exports,'createOfficialQualificationSample'),
    canonicalDocx:own(modules.sample.exports,'canonicalOfficialQualificationDocx')});
   officialDocumentModuleViews.set(lifeDocument.exports,lease);
   return lifeDocument.exports;
  }catch{failed=true;throw Object.assign(new Error(code),{code});}
 }
 function createContractTestingModule(){
  need(arguments.length===0&&contract,'CURRENT259_CONTRACT_FIXED_ENTRIES');
  return createOwnedTestingModule({imports:[contract.root]},contract);
 }
 function createDocumentTestingModule(){
  need(arguments.length===0&&document,'CURRENT259_GENERATED_DOCUMENT_FIXED_ENTRY');
  return createOwnedTestingModule({imports:[document.root]},document);
 }
 function createTestingModule(metadata){
  need(!document,'CURRENT259_GENERATED_DOCUMENT_FIXED_ENTRY');
  const builder=createOwnedTestingModule(metadata);ordinaryTestingUsed=true;return builder;
 }
 function createOwnedTestingModule(metadata,contractMode){
  check();need(metadata&&!types.isProxy(metadata)&&Reflect.ownKeys(metadata).length===1,'CURRENT259_FRAMEWORK_METADATA');
  const imports=own(metadata,'imports');need(Array.isArray(imports)&&!types.isProxy(imports)&&(contractMode?
   imports.length===1&&imports[0]===contractMode.root:
   imports.length===0||imports.length===1&&imports[0]===values.Task16RegisteredApplicationModule),'CURRENT259_FRAMEWORK_METADATA');
  const builder=guardedOperation(()=>testMethod.call(Test,metadata));collect();
  const compile=dataMethod(builder,'compile'),override=dataMethod(builder,'overrideProvider');let compiled=false;
  const facade=Object.freeze({overrideProvider(token){
   check();need(!compiled&&(contractMode?contractMode.tokens.includes(token):
    token===values.PrismaService||token===values.Task16ImpactReaderToken),'CURRENT259_FRAMEWORK_OVERRIDE');
   const receiver=override.call(builder,token),use=dataMethod(receiver,'useValue');
   return Object.freeze({useValue(value){check();need(!compiled,'CURRENT259_FRAMEWORK_OVERRIDE');use.call(receiver,value);return facade;}});
  },async compile(){
   check();need(!compiled,'CURRENT259_FRAMEWORK_REENTRY');compiled=true;
   const testing=await guardedOperation(()=>compile.call(builder));collect();
   need(testing&&!types.isProxy(testing)&&Object.getPrototypeOf(testing)===framework.TestingModule.prototype,'CURRENT259_FRAMEWORK_MODULE');
   need(dataMethod(testing,'createNestApplication')===originalCreate&&dataMethod(testing,'createAdapterProxy')===originalAdapterProxy,'CURRENT259_FRAMEWORK_MODULE');
   const creationFields=new Map(['container','applicationConfig','graphInspector'].map(key=>[key,own(testing,key)]));
   const testingGet=dataMethod(testing,'get');
   const container=creationFields.get('container');
   need(container&&!types.isProxy(container)&&Object.getPrototypeOf(container)===framework.NestContainer.prototype&&dataMethod(container,'setHttpAdapter')===setHttpAdapter,'CURRENT259_FRAMEWORK_CONTAINER');
   function checkCreation(){
    for(const [key,value]of creationMethods)need(dataMethod(testing,key)===value,'CURRENT259_FRAMEWORK_HOOK_CHANGED');
    for(const [key,value]of creationFields)need(own(testing,key)===value,'CURRENT259_FRAMEWORK_HOOK_CHANGED');
    need(!types.isProxy(container)&&Object.getPrototypeOf(container)===framework.NestContainer.prototype&&dataMethod(container,'setHttpAdapter')===setHttpAdapter,'CURRENT259_FRAMEWORK_CONTAINER');
   }
   checkCreation();let consumed=false;
   ownedModules.set(testing,{create(){
    check();need(!consumed&&globalThis.Proxy===nativeProxy,'CURRENT259_FRAMEWORK_REENTRY');consumed=true;checkCreation();
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
     function verifyTarget(key){
      const fn=originalMethods.get(key),getAdapter=originalMethods.get('getHttpAdapter');
      need(!closed&&dataMethod(target,key)===fn&&dataMethod(target,'getHttpAdapter')===getAdapter&&
       getAdapter.call(target)===adapter,'CURRENT259_FRAMEWORK_CHANGED');
      return fn;
     }
     const record={inspectPaymentProviders(module,expectedServer){
      need(!contractMode&&module===testing,'CURRENT259_FRAMEWORK_CHANGED');
      check();
      // A single synchronous guarded operation reads the same server and four
      // providers. Each original method and the adapter are still checked.
      const result=guardedOperation(()=>{
       const server=verifyTarget('getHttpServer').call(target);
       need(server===expectedServer,'CURRENT259_FRAMEWORK_CHANGED');
       const runtime=verifyTarget('get').call(target,values.PrismaService);
       const reader=verifyTarget('get').call(target,values.Task16ImpactReaderToken);
       const readModule=token=>{
        need(dataMethod(testing,'get')===testingGet,'CURRENT259_FRAMEWORK_CHANGED');
        return testingGet.call(testing,token);
       };
       const moduleRuntime=readModule(values.PrismaService),moduleReader=readModule(values.Task16ImpactReaderToken);
       return {runtime,reader,moduleRuntime,moduleReader};
      });
      // check() visits the complete root graph, including any qualified load
      // during the read. There is no second identical traversal in this pass.
      check();
      return result;
     },method(key){
      if(!APP_METHODS.includes(key))return undefined;
      if(methods.has(key))return methods.get(key);
      const fn=originalMethods.get(key);
      const wrapped=key==='close'?()=>{closed=true;return close();}:(...args)=>{
       check();verifyTarget(key);
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
 check();material.check();const result=Object.freeze({Class,PrismaService:values.PrismaService,Test,check,checkContinuity,verifyBusinessFiles,verifyFull:()=>{check();material.check();},loadApplicationModules,loadPaymentModules:()=>{check();return paymentExports;},createTestingModule,loadContractApplicationModules,createContractTestingModule,loadGeneratedContractDraftAdmission,loadGeneratedContractDocumentModules,loadCurrent261LocalLifecycleDocumentModules,createDocumentTestingModule,
  constructorContract:'IMPLICIT_DERIVED_CONSTRUCTOR_FORWARDS_OPTIONS;LIFECYCLE_HOOKS_UNCHANGED_NOT_CALLED',
  witness:()=>{check();return Object.freeze({source:material.source,build:material.summary,host:process.platform+'-'+process.arch,engineCommit:observedVersion.commit,modules:files.size,executionAllowed:false});}});
 cache.set(handle,result);return result;
}
module.exports=Object.freeze({loadCurrent259Client,claimCurrent261OfficialDocumentModules,current259OwnedApplicationMethod,current259OwnedApplicationView,
 inspectCurrent259OwnedPaymentProviders,isCurrent259OwnedModule,createCurrent259OwnedApplication,takeCurrent259CreationFailure});
