"use strict";
const {assertCurrent259BusinessIssuer:businessIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
// Loads only this observation's sealed physical closure. No SDK instance, DB,
// custom constructor, supplied resolver or application bootstrap is accepted.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const {types}=require('node:util');
const {claimCurrent259Build}=require('./task16-current259-build.cjs');
const nodeParentPrototype=Module.prototype,nodeParentDescriptor=Object.freeze({...Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent')});
const BUILTIN_LOADER_SOURCE=process.binding('natives')['internal/modules/cjs/loader'];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const own=(value,key)=>{need(value&&!types.isProxy(value),'CURRENT259_LOADER_DESCRIPTOR');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'CURRENT259_LOADER_DESCRIPTOR');return d.value;};
const officialDocumentModuleViews=new WeakMap();
const nativeTask12OrdinaryClients=new WeakMap();
const nativeProviderWeakGet=WeakMap.prototype.get,nativeProviderWeakDescriptor=Object.getOwnPropertyDescriptor(WeakMap.prototype,'get'),nativeProviderWeakPrototype=WeakMap.prototype,nativeProviderDescriptor=Object.getOwnPropertyDescriptor,nativeProviderApply=Reflect.apply,nativeProviderFreeze=Object.freeze,nativeProviderDefine=Object.defineProperty,nativeProviderHasOwn=Object.hasOwn;
const nativePublicGuardProofs=new WeakMap(),nativePublicGuardSet=WeakMap.prototype.set,nativePublicGuardDelete=WeakMap.prototype.delete;
const nativePublicGuardSetDescriptor=nativeProviderDescriptor(WeakMap.prototype,'set'),nativePublicGuardDeleteDescriptor=nativeProviderDescriptor(WeakMap.prototype,'delete');
function nativePublicGuardMapsValid(){
 const names=['get','set','delete'],expected=[nativeProviderWeakDescriptor,nativePublicGuardSetDescriptor,nativePublicGuardDeleteDescriptor],fields=['value','writable','enumerable','configurable'];
 for(let i=0;i<names.length;i++){
  const current=nativeProviderDescriptor(nativeProviderWeakPrototype,names[i]);if(!current)return false;
  for(let j=0;j<fields.length;j++)if(nativeProviderDescriptor(current,fields[j])?.value!==nativeProviderDescriptor(expected[i],fields[j])?.value)return false;
 }
 return true;
}

function takeCurrent261NativeOrdinaryClient(loader,loaded,client){
 need(arguments.length===3&&client&&(typeof client==='object'||typeof client==='function'),'CURRENT261_NATIVE_ORDINARY_HANDLE');
 const entry=nativeTask12OrdinaryClients.get(client);
 // Unknown/replacement proxies are rejected before reading any property.
 need(entry&&entry.loader===loader&&entry.loaded===loaded&&!entry.used,'CURRENT261_NATIVE_ORDINARY_HANDLE');
 entry.verify();entry.used=true;return true;
}

// Fixed seventeen-token native equipment lookup witness (sixteen providers plus JWT). This is not a cache of
// validation results: every batch re-reads every mutable edge before and after.
function nativeEquipmentLookupRows(target,container,tokens,pins){
 const code='CURRENT261_NATIVE_PROVIDER_LOOKUP',rows=[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null];let warmed=0;
 const descriptor=pins.descriptor,prototype=pins.prototype,apply=pins.apply,isProxy=pins.isProxy;
 const data=(object,key,edges)=>{
  need(object&&(typeof object==='object'||typeof object==='function')&&!isProxy(object),code);
  const d=descriptor(object,key);need(d&&pins.hasOwn(d,'value'),code);if(edges)pins.define(edges,''+edges.length,{value:[object,key,d],writable:true,enumerable:true,configurable:true});return d.value;
 };
 const same=(object,key,expected)=>{
  need(object&&!isProxy(object),code);const d=descriptor(object,key);
  need(d,code);const fields=['value','get','set','writable','enumerable','configurable'];for(let i=0;i<fields.length;i++)need(descriptor(d,fields[i])?.value===descriptor(expected,fields[i])?.value,code);
 };
 const absent=(object,key)=>{need(object&&!isProxy(object)&&descriptor(object,key)===undefined,code);};
 const canonical=()=>{
  absent(pins.objectPrototype,'each');absent(pins.objectPrototype,'moduleId');
  for(let i=0;i<pins.edges.length;i++){const edge=pins.edges[i];same(edge[0],edge[1],edge[2]);}
  need(prototype(target)===pins.appPrototype&&prototype(pins.appPrototype)===pins.contextPrototype&&prototype(pins.contextPrototype)===pins.resolverPrototype,code);
  const absentKeys=['get','find','instanceLinksHost','getHttpAdapter','getHttpServer'];for(let i=0;i<absentKeys.length;i++)absent(target,absentKeys[i]);
  absent(pins.appPrototype,'get');absent(pins.appPrototype,'find');absent(pins.appPrototype,'instanceLinksHost');absent(pins.contextPrototype,'find');
 };
 const currentWithInstance=(token,instance,edges,prior)=>{
  need(data(target,'container',edges)===container,code);
  const host=data(target,'_instanceLinksHost',edges);if(prior)need(host===prior.host,code);need(host&&!isProxy(host)&&prototype(host)===pins.linksPrototype,code);absent(host,'get');
  need(data(host,'container',edges)===container,code);
  const links=data(host,'instanceLinks',edges);if(prior)need(links===prior.links,code);need(links&&!isProxy(links)&&prototype(links)===pins.Map.prototype,code);absent(links,'get');
  let array;try{array=apply(pins.mapGet,links,[token]);}catch{need(false,code);}
  if(prior)need(array===prior.array,code);
  need(array&&!isProxy(array)&&pins.arrayIsArray(array)&&prototype(array)===pins.Array.prototype,code);
  const length=data(array,'length',edges);need(typeof length==='number'&&length>0&&(!prior||length===prior.length),code);
  for(let i=0;i<length;i++)data(array,''+i,edges);
  const link=data(array,''+(length-1));if(prior)need(link===prior.link,code);need(link&&!isProxy(link)&&prototype(link)===pins.objectPrototype,code);
  need(data(link,'token',edges)===token,code);data(link,'moduleId',edges);data(link,'collection',edges);
  const wrapper=data(link,'wrapperRef',edges);if(prior)need(wrapper===prior.wrapper,code);need(wrapper&&!isProxy(wrapper)&&prototype(wrapper)===pins.wrapperPrototype,code);
  absent(wrapper,'instance');absent(wrapper,'getInstanceByContextId');
  const scope=data(wrapper,'scope',edges);need(scope===undefined||scope===0,code);
  const values=data(wrapper,'values',edges);if(prior)need(values===prior.values,code);need(values&&!isProxy(values)&&prototype(values)===pins.WeakMap.prototype,code);absent(values,'get');
  let state;try{state=apply(pins.weakGet,values,[pins.staticContext]);}catch{need(false,code);}
  if(prior)need(state===prior.state,code);
  need(state&&!isProxy(state)&&prototype(state)===pins.objectPrototype&&data(state,'instance',edges)===instance,code);
  return {host,links,array,length,link,wrapper,values,state,instance,edges};
 };
 const read=(token,instance,prior)=>{canonical();return currentWithInstance(token,instance,[],prior);};
 const verify=(token,prior)=>{
  const now=read(token,prior.instance,prior);
  const keys=['host','links','array','link','wrapper','values','state','instance'];for(let i=0;i<keys.length;i++)need(now[keys[i]]===prior[keys[i]],code);
  need(now.edges.length===prior.edges.length,code);
  for(let i=0;i<prior.edges.length;i++){const edge=prior.edges[i];need(now.edges[i][0]===edge[0]&&now.edges[i][1]===edge[1],code);same(edge[0],edge[1],edge[2]);}
 };
 const index=token=>{for(let i=0;i<tokens.length;i++)if(tokens[i]===token)return i;need(false,code);};
 return pins.freeze({warm(token,instance){
  canonical();const i=index(token),prior=rows[i];if(prior){need(prior.instance===instance,code);verify(token,prior);}else{rows[i]=read(token,instance);warmed++;}
 },assert(){
  canonical();need(data(target,'isInitialized')===true&&tokens.length===17&&warmed===17,code);
  for(let i=0;i<tokens.length;i++){need(rows[i],code);verify(tokens[i],rows[i]);}
 },ready(){return warmed===17;},expected(token){const row=rows[index(token)];need(row,code);return row.instance;}});
}

function claimCurrent261OfficialDocumentModules(view){
 const code='CURRENT261_OFFICIAL_DOCUMENT_MODULES';
 need(arguments.length===1&&view&&typeof view==='object'&&!types.isProxy(view)&&officialDocumentModuleViews.has(view),code);
 const lease=officialDocumentModuleViews.get(view);lease.verifyFull();return lease;
}
const cache=new WeakMap(),ownedModules=new WeakMap(),ownedApps=new WeakMap(),creationFailures=new WeakMap();
const APP_METHODS=['close','get','getHttpAdapter','enableCors','useGlobalPipes','init','getHttpServer','listen'];
function dataMethod(value,key){let next=value;for(let i=0;next&&i<32;i++,next=Object.getPrototypeOf(next)){need(!types.isProxy(next),'CURRENT259_OWNED_METHOD');const d=Object.getOwnPropertyDescriptor(next,key);if(d){need(Object.hasOwn(d,'value')&&typeof d.value==='function','CURRENT259_OWNED_METHOD');return d.value;}}throw new Error('CURRENT259_OWNED_METHOD');}
function inspectCurrent261OwnedNativeEquipmentProviders(value,module,server){
 const code='CURRENT261_NATIVE_PROVIDER_LOOKUP',d=nativeProviderDescriptor(nativeProviderWeakPrototype,'get');
 need(arguments.length===3&&d&&nativeProviderDescriptor(d,'value')?.value===nativeProviderWeakGet&&d.writable===nativeProviderWeakDescriptor.writable&&d.enumerable===nativeProviderWeakDescriptor.enumerable&&d.configurable===nativeProviderWeakDescriptor.configurable,code);
 const record=nativeProviderApply(nativeProviderWeakGet,ownedApps,[value]);need(record&&typeof record.inspectNativeEquipmentProviders==='function',code);return record.inspectNativeEquipmentProviders(module,server);
}
function inspectCurrent261OwnedNativeEquipmentPublicGuard(value,module,server){
 const code='CURRENT261_NATIVE_PROVIDER_LOOKUP',d=nativeProviderDescriptor(nativeProviderWeakPrototype,'get');
 need(arguments.length===3&&d&&nativeProviderDescriptor(d,'value')?.value===nativeProviderWeakGet&&d.writable===nativeProviderWeakDescriptor.writable&&d.enumerable===nativeProviderWeakDescriptor.enumerable&&d.configurable===nativeProviderWeakDescriptor.configurable,code);
 const record=nativeProviderApply(nativeProviderWeakGet,ownedApps,[value]);need(record&&typeof record.inspectNativeEquipmentProviders==='function',code);return record.inspectNativeEquipmentProviders(module,server,true);
}
function consumeCurrent261OwnedNativeEquipmentPublicGuard(proof,value,module,server){
 const code='CURRENT261_NATIVE_PROVIDER_LOOKUP';need(arguments.length===4&&nativePublicGuardMapsValid(),code);
 const entry=nativeProviderApply(nativeProviderWeakGet,nativePublicGuardProofs,[proof]);
 need(entry&&entry.application===value&&entry.module===module&&entry.server===server,code);
 need(nativeProviderApply(nativePublicGuardDelete,nativePublicGuardProofs,[proof])===true,code);
 return entry.verify();
}
function current259OwnedApplicationMethod(value,key){return ownedApps.get(value)?.method(key);}
function current259OwnedApplicationView(value){return ownedApps.get(value)?.view;}
function inspectCurrent259OwnedDocumentAuthProviders(value,testing,server){
 need(arguments.length===3,'CURRENT259_FRAMEWORK_CHANGED');return ownedApps.get(value)?.inspectDocumentAuthProviders(testing,server);
}
function inspectCurrent259OwnedPaymentProviders(value,testing,server,token,handle){
 need(arguments.length===3||arguments.length===5,'CURRENT259_FRAMEWORK_CHANGED');
 return arguments.length===5?ownedApps.get(value)?.inspectPaymentProviders(testing,server,token,handle):ownedApps.get(value)?.inspectPaymentProviders(testing,server);
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
  if(i===0){const token=own(exports,'Task16ImpactReaderToken');need(typeof token==='symbol','CURRENT259_LOADER_EXPORT');records.push({module:mod,key:'Task16ImpactReaderToken',value:token});values.Task16ImpactReaderToken=token;for(const key of ['Task16RegistrationErrorFilter','armTask16RegistrationError','takeTask16RegistrationError']){const value=own(exports,key);need(typeof value==='function','CURRENT259_LOADER_EXPORT');records.push({module:mod,key,value});values[key]=value;}}
 }
 // AuthModule has already loaded the real rate-limit service/phase module.
 // Pin that first owned load before any graph walk or initial facade is exposed.
 const authProof=require('./task12-current261-local-lifecycle-module-proof.cjs');
 const captureBaseAuthClosure=own(authProof,'captureCurrent261AuthTransactionBaseClosure'),captureFullAuthClosure=own(authProof,'captureCurrent261AuthTransactionClosure');
 const authCacheDescriptor=Object.freeze({...Object.getOwnPropertyDescriptor(require,'cache')});
 need(Object.hasOwn(authCacheDescriptor,'value')&&authCacheDescriptor.value&&!types.isProxy(authCacheDescriptor.value),'CURRENT259_LOADER_EXPORT');
 const verifyBaseAuthClosure=captureBaseAuthClosure(root,authCacheDescriptor.value);let verifyDocumentAuthClosure;
 const checkAuthTransactionClosure=()=>{
  const now=Object.getOwnPropertyDescriptor(require,'cache');
  need(now&&['value','writable','enumerable','configurable'].every(key=>now[key]===authCacheDescriptor[key]),'CURRENT259_LOADER_EXPORT');
  verifyBaseAuthClosure();verifyDocumentAuthClosure?.();
 };
 // Pin the shared pure decoder before any caller can mutate a same-object export.
 const diagnosticModule=require.cache[path.join(root,'services/api/dist/database/task16-registration-error-diagnostic.js')];
 need(diagnosticModule&&!types.isProxy(diagnosticModule)&&own(diagnosticModule,'loaded')===true,'CURRENT259_LOADER_EXPORT');
 const diagnosticExports=own(diagnosticModule,'exports');need(diagnosticExports&&!types.isProxy(diagnosticExports),'CURRENT259_LOADER_EXPORT');
 const projectorDescriptor=Object.getOwnPropertyDescriptor(diagnosticExports,'projectTask16RegistrationError');
 need(projectorDescriptor&&Object.hasOwn(projectorDescriptor,'value')&&typeof projectorDescriptor.value==='function','CURRENT259_LOADER_EXPORT');
 records.push({module:diagnosticModule,key:'projectTask16RegistrationError',value:projectorDescriptor.value,descriptor:projectorDescriptor});
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
 // Fixed normal-snapshot closure is captured at its first legitimate cases
 // import, before any graph walk or facade publication. It is never reissued.
 const snapshotCode='CURRENT259_PAYMENT_SNAPSHOT',snapshotIsProxy=types.isProxy;
 const snapshotData=(v,k)=>{need(v&&!snapshotIsProxy(v),snapshotCode);const d=Object.getOwnPropertyDescriptor(v,k);need(d&&Object.hasOwn(d,'value'),snapshotCode);return Object.freeze({...d});};
 const sameSnapshotData=(v,k,d)=>{const now=snapshotData(v,k);need(['value','writable','enumerable','configurable'].every(f=>now[f]===d[f]),snapshotCode);return now.value;};
 const snapshotCacheSlot=snapshotData(require,'cache'),snapshotCache=snapshotCacheSlot.value;
 const snapshotFile=path.join(root,'services/api/dist/database/registered-payment-postgres.snapshot.js'),casesFile=path.join(root,'services/api/dist/database/registered-payment-postgres.cases.js');
 const snapshotMeta=file=>{const slot=snapshotData(snapshotCache,file),mod=slot.value,filename=snapshotData(mod,'filename'),exports=snapshotData(mod,'exports');need(filename.value===file&&snapshotData(mod,'loaded').value===true&&!snapshotIsProxy(exports.value),snapshotCode);return{file,slot,mod,filename,exports};};
 const snapshotModule=snapshotMeta(snapshotFile),casesModule=snapshotMeta(casesFile),snapshotSdk=snapshotMeta(material.clientEntry);
 const snapshotCaseEdges=Array.from({length:snapshotData(casesModule.mod,'children').value.length},(_,i)=>{const slot=snapshotData(snapshotData(casesModule.mod,'children').value,String(i)),child=slot.value,filename=snapshotData(child,'filename');return{slot,meta:snapshotMeta(filename.value)};});
 const snapshotParentOf=mod=>{need(!snapshotIsProxy(mod)&&Object.getPrototypeOf(mod)===nodeParentPrototype&&!Object.getOwnPropertyDescriptor(mod,'parent'),snapshotCode);const now=Object.getOwnPropertyDescriptor(nodeParentPrototype,'parent');need(now&&['get','set','enumerable','configurable'].every(k=>now[k]===nodeParentDescriptor[k])&&typeof nodeParentDescriptor.get==='function',snapshotCode);return Reflect.apply(nodeParentDescriptor.get,mod,[]);};
 const snapshotExports=snapshotModule.exports.value,snapshotParent=snapshotParentOf(snapshotModule.mod),snapshotChildren=snapshotData(snapshotModule.mod,'children'),casesChildren=snapshotData(casesModule.mod,'children');
 need(Object.getPrototypeOf(snapshotExports)===Object.prototype&&snapshotParent===casesModule.mod&&Array.isArray(snapshotChildren.value)&&!snapshotIsProxy(snapshotChildren.value)&&snapshotChildren.value.length===1&&snapshotData(snapshotChildren.value,'0').value===snapshotSdk.mod&&Array.isArray(casesChildren.value)&&!snapshotIsProxy(casesChildren.value),snapshotCode);
 const snapshotKeys=['__esModule','finishRegisteredNormalSnapshot','readRegisteredNormalSnapshot'];
 const snapshotSlots=snapshotKeys.map(key=>{const d=snapshotData(snapshotExports,key);need(key==='__esModule'?d.value===true&&d.writable===false&&d.enumerable===false&&d.configurable===false:typeof d.value==='function'&&d.writable===true&&d.enumerable===true&&d.configurable===true,snapshotCode);return{key,d,...(key==='__esModule'?{}:{length:snapshotData(d.value,'length')})};});
 need(snapshotSlots.find(r=>r.key==='readRegisteredNormalSnapshot').length.value===5&&snapshotSlots.find(r=>r.key==='finishRegisteredNormalSnapshot').length.value===1,snapshotCode);
 const sdkPrisma=snapshotData(snapshotSdk.exports.value,'Prisma'),sdkClass=snapshotData(snapshotSdk.exports.value,'PrismaClient'),decimal=snapshotData(prisma,'Decimal'),decimalPrototype=snapshotData(decimal.value,'prototype');
 need(sdkPrisma.value===prisma&&sdkClass.value===Class&&typeof decimal.value==='function',snapshotCode);
 const decimalMethods=['minus','toFixed'].map(key=>({key,d:snapshotData(decimalPrototype.value,key)}));need(decimalMethods.every(row=>typeof row.d.value==='function'),snapshotCode);
 const utilNamespace=require('node:util'),utilTypes=snapshotData(utilNamespace,'types'),utilProxy=snapshotData(types,'isProxy');need(utilTypes.value===types&&utilProxy.value===snapshotIsProxy,snapshotCode);
 const snapshotMaterial=material.capture(snapshotFile);
 for(const row of snapshotSlots)if(row.key!=='__esModule')records.push({module:snapshotModule.mod,key:row.key,value:row.d.value,descriptor:row.d});
 const checkSnapshotClosure=()=>{
  sameSnapshotData(require,'cache',snapshotCacheSlot);
  for(const row of [snapshotModule,casesModule,snapshotSdk]){sameSnapshotData(snapshotCache,row.file,row.slot);sameSnapshotData(row.mod,'filename',row.filename);sameSnapshotData(row.mod,'exports',row.exports);need(snapshotData(row.mod,'loaded').value===true,snapshotCode);}
  need(snapshotParentOf(snapshotModule.mod)===snapshotParent,snapshotCode);const children=sameSnapshotData(snapshotModule.mod,'children',snapshotChildren),parentChildren=sameSnapshotData(casesModule.mod,'children',casesChildren);
  need(children.length===1&&snapshotData(children,'0').value===snapshotSdk.mod,snapshotCode);let count=0,edge=0;
  for(let i=0;i<parentChildren.length;i++){const child=snapshotData(parentChildren,String(i)).value;if(child===casesModule.mod)continue;need(edge<snapshotCaseEdges.length&&child===snapshotCaseEdges[edge].slot.value,snapshotCode);const row=snapshotCaseEdges[edge++].meta;sameSnapshotData(snapshotCache,row.file,row.slot);sameSnapshotData(row.mod,'filename',row.filename);sameSnapshotData(row.mod,'exports',row.exports);if(child===snapshotModule.mod)count++;}need(edge===snapshotCaseEdges.length&&count===1,snapshotCode);
  need(Object.getPrototypeOf(snapshotExports)===Object.prototype&&Reflect.ownKeys(snapshotExports).length===snapshotKeys.length&&snapshotKeys.every(key=>Object.hasOwn(snapshotExports,key)),snapshotCode);
  for(const row of snapshotSlots){sameSnapshotData(snapshotExports,row.key,row.d);if(row.length)sameSnapshotData(row.d.value,'length',row.length);}
  sameSnapshotData(snapshotSdk.exports.value,'Prisma',sdkPrisma);sameSnapshotData(snapshotSdk.exports.value,'PrismaClient',sdkClass);sameSnapshotData(prisma,'Decimal',decimal);sameSnapshotData(decimal.value,'prototype',decimalPrototype);
  for(const row of decimalMethods)sameSnapshotData(decimalPrototype.value,row.key,row.d);sameSnapshotData(utilNamespace,'types',utilTypes);sameSnapshotData(types,'isProxy',utilProxy);
  checkCurrent259FileIdentity(snapshotFile,snapshotMaterial.identity);
 };
 checkSnapshotClosure();
 const paymentExports=Object.freeze(paymentValues);
 const framework={};
 for(const [name,entry]of [['TestingModule','@nestjs/testing/testing-module'],['NestContainer','@nestjs/core/injector/container'],['NestApplication','@nestjs/core/nest-application'],['ExpressAdapter','@nestjs/platform-express/adapters/express-adapter']]){
  const file=fs.realpathSync(requireAt.resolve(entry)),exports=guardedRequire(file);framework[name]=own(exports,name);need(typeof framework[name]==='function','CURRENT259_FRAMEWORK_CLASS');records.push({module:require.cache[file],key:name,value:framework[name]});
 }
 // The first legitimate JSON body lazily loads these canonical UTF-8 codec
 // children. Observe them before the immutable business graph is sealed.
 const adapterRequire=Module.createRequire(requireAt.resolve('@nestjs/platform-express/adapters/express-adapter'));
 const parserRequire=Module.createRequire(adapterRequire.resolve('body-parser'));
 const codecFile=fs.realpathSync(parserRequire.resolve('iconv-lite')),codec=guardedRequire(codecFile);
 const decoder=own(codec,'getDecoder');need(typeof decoder==='function','CURRENT259_LOADER_EXPORT');
 guardedOperation(()=>decoder.call(codec,'utf-8'));
 records.push({module:require.cache[codecFile],key:'getDecoder',value:decoder,descriptor:Object.getOwnPropertyDescriptor(codec,'getDecoder')});
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
 checkAuthTransactionClosure();checkSnapshotClosure();visitRoots();
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
  const diagnostic=values.Task16RegistrationErrorFilter,diagnosticCatch=dataMethod(diagnostic.prototype,'catch'),baseFilterCatch=dataMethod(filter.prototype,'catch');
  const initialReaderProvider=metadata('providers',values.Task16RegisteredApplicationModule)?.[7];
  const initialReaderValue=Object.getOwnPropertyDescriptor(initialReaderProvider??{},'useValue')?.value;
  need(typeof initialReaderValue==='function',"TASK16_APP_METADATA_CHANGED");
  const checkMetadata=()=>{const actualImports=metadata('imports',values.Task16RegisteredApplicationModule);need(Array.isArray(actualImports)&&actualImports.length===imports.length&&imports.every((v,i)=>actualImports[i]===v),"TASK16_APP_METADATA_CHANGED");const controllers=metadata('controllers',values.Task16RegisteredApplicationModule);need(controllers?.length===1&&controllers[0]===controller,"TASK16_APP_METADATA_CHANGED");const providers=metadata('providers',values.Task16RegisteredApplicationModule);need(providers?.length===8&&serviceProviders.every((Class,i)=>providers[i]===Class)&&providers[5]===diagnostic&&providers[6]&&!types.isProxy(providers[6])&&Reflect.ownKeys(providers[6]).length===2&&own(providers[6],'provide')==='APP_FILTER'&&own(providers[6],'useExisting')===diagnostic&&Object.getPrototypeOf(diagnostic)===filter&&Object.getPrototypeOf(diagnostic.prototype)===filter.prototype&&dataMethod(diagnostic.prototype,'catch')===diagnosticCatch&&dataMethod(filter.prototype,'catch')===baseFilterCatch&&providers[7]===initialReaderProvider&&providers[7].provide===token&&Object.getOwnPropertyDescriptor(providers[7],'useValue')?.value===initialReaderValue,"TASK16_APP_METADATA_CHANGED");const actual=metadata('providers',imports[1])?.filter(row=>row?.provide==='APP_GUARD');need(actual?.length===6&&guards.every((Class,i)=>actual[i].useClass===Class),"TASK16_APP_METADATA_CHANGED");};

 need(!/\bconstructor\s*\(/u.test(Function.prototype.toString.call(values.PrismaService)),'CURRENT259_LOADER_CONSTRUCTOR');
 const wrapper=require.cache[material.clientEntry];need(wrapper&&own(wrapper.exports,'PrismaClient')===Class,'CURRENT259_LOADER_CLASS');
 const methods=['$connect','$disconnect','$transaction','$queryRawUnsafe'].map(key=>({key,descriptor:Object.getOwnPropertyDescriptor(Class.prototype,key)}));
 need(methods.every(row=>row.descriptor&&Object.hasOwn(row.descriptor,'value')&&typeof row.descriptor.value==='function'),'CURRENT259_LOADER_CLASS');
 const classMethodsUnchanged=()=>methods.every(({key,descriptor})=>{const actual=Object.getOwnPropertyDescriptor(Class.prototype,key);return actual&&Object.hasOwn(actual,'value')&&['value','writable','enumerable','configurable'].every(field=>actual[field]===descriptor[field]);});
 const serviceMethods=['onModuleInit','onApplicationShutdown'].map(key=>({key,value:values.PrismaService.prototype[key]}));
 need(serviceMethods.every(row=>typeof row.value==='function'),'CURRENT259_LOADER_CONSTRUCTOR');
 const exportedValues=Object.freeze({...values}),Test=values.Test,testMethod=own(Test,'createTestingModule');
 let contract,document,lifeDocument,defaultDocument,ordinaryTestingUsed=false;
 function check(){
  try{
   need(!failed&&!loading&&coreHooksUnmodified()&&Module._load===hooks.load&&hooksMatch(),'CURRENT259_LOADER_HOOKS');
   checkAuthTransactionClosure();checkSnapshotClosure();
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
   checkAuthTransactionClosure();checkSnapshotClosure();
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
 function collect(){checkAuthTransactionClosure();checkSnapshotClosure();visitRoots();check();}
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
    ['auth/auth.service.js',['AuthService']],['auth/auth-rate-limit.service.js',['AuthRateLimitService']],['auth/auth.controller.js',['AuthController']],
    ['database/task12-auth-transaction-phase.js',['observeTask12AuthTransaction','takeTask12AuthTransactionPhase']],
    ['database/task12-auth-error-diagnostic.js',['Task12AuthErrorFilter','Task12AuthStageInterceptor','armTask12AuthError','takeTask12AuthError']],
    ['contract/contract.module.js',['ContractModule']],
    ['contract/contract-read.service.js',['ContractReadService']],
    ['me/me.service.js',['MeService']],['audit/audit.service.js',['AuditService']],
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
    ['database/task12-generated-document-seam.js',['verifyTask12MaterialTemplate','verifyTask12EquipmentTemplate','bindTask12PublishedMaterialTemplate','runTask12GeneratedDocument']],
    ['database/task12-generated-document-draft-save.js',['saveTask12GeneratedDocumentDraft']],
    ['database/task12-generated-material-template.js',['publishTask12GeneratedMaterialTemplate','publishTask12GeneratedEquipmentTemplate']],
    ['database/task12-generated-document-readback.js',['readTask12GeneratedDocumentOutputs','claimTask12GeneratedDocumentOwnerReadback']],
    ['database/task12-generated-document-role-services.js',['withTask12PreownedDocumentRoleServices','withTask12NestDocumentRoleServices','withTask12NativeHostDocumentRoleServices']],
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
   // Verify the first phase/service baseline before adding the first legitimate
   // filter edge. The base guard remains the same closure for this whole loader.
   checkAuthTransactionClosure();
   verifyDocumentAuthClosure=captureFullAuthClosure(root,authCacheDescriptor.value);
   checkAuthTransactionClosure();
   const {Task12GeneratedDocumentApplicationModule:rootClass,ContractModule,ContractTemplateModule,
    ContractTemplateController,ContractTemplateService,ContractScenarioService,LayoutTemplateService,
    ContractDocumentWorkerModule,ContractDocumentProcessor,ContractDocumentModule,ContractDocumentService,
    ContractWorkbenchModule,ContractDraftController,FileService,PrivateFileStorage}=documentValues;
   const tokens=Object.freeze([values.PrismaService,PrivateFileStorage,LayoutTemplateService,ContractDocumentProcessor]);
   const authMethods=[['AuthService',['login','loadUserRoleScopes','issueTokens']],['AuthRateLimitService',['take']],['AuthController',['login']],['Task12AuthErrorFilter',['catch']],['Task12AuthStageInterceptor',['intercept']]].flatMap(([key,names])=>names.map(name=>({target:documentValues[key].prototype,name,value:dataMethod(documentValues[key].prototype,name)})));
   const taskMethods=[['ContractReadService',['workbenchLedger']],['MeService',['getContractPendingWorkItems','contractV2LifecycleWorkItems']],['AuditService',['record']]].flatMap(([key,names])=>names.map(name=>({target:documentValues[key].prototype,name,value:dataMethod(documentValues[key].prototype,name)})));
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
    'verifyTask12MaterialTemplate','verifyTask12EquipmentTemplate','bindTask12PublishedMaterialTemplate','runTask12GeneratedDocument',
    'saveTask12GeneratedDocumentDraft',
    'publishTask12GeneratedMaterialTemplate','publishTask12GeneratedEquipmentTemplate','readTask12GeneratedDocumentOutputs','claimTask12GeneratedDocumentOwnerReadback',
    'withTask12PreownedDocumentRoleServices','withTask12NestDocumentRoleServices','withTask12NativeHostDocumentRoleServices',
    'PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor','ContractDocumentService',
    'ContractReadService','MeService','AuditService','ContractDraftController','FileService','CONTRACT_VERSION_FILE_READ_AUTHORITY','JwtTokenService',
    'buildTask12GeneratedApprovalFixture','hashTask12GeneratedAdmissionPassword','openTask12GeneratedApprovalDraft',
    'AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor','armTask12AuthError','takeTask12AuthError'
   ].map(key=>[key,documentValues[key]])),...Object.fromEntries([
    'PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi'
   ].map(key=>[key,values[key]]))});
   document=Object.freeze({root:rootClass,tokens,exports,checkMetadata(){
    checkAuthTransactionClosure();
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
     Array.isArray(rootProviders)&&rootProviders.length===4&&rootProviders[0]===documentValues.Task12AuthErrorFilter&&rootProviders[1]===documentValues.Task12AuthStageInterceptor&&own(rootProviders[2],'provide')==='APP_FILTER'&&
     own(rootProviders[2],'useExisting')===documentValues.Task12AuthErrorFilter&&own(rootProviders[3],'provide')==='APP_INTERCEPTOR'&&own(rootProviders[3],'useExisting')===documentValues.Task12AuthStageInterceptor&&Object.getPrototypeOf(documentValues.Task12AuthErrorFilter.prototype)===filter.prototype&&dataMethod(filter.prototype,'catch')===baseFilterCatch&&
     authMethods.every(row=>dataMethod(row.target,row.name)===row.value)&&taskMethods.every(row=>dataMethod(row.target,row.name)===row.value)&&
     hooks.every(([key,value])=>dataMethod(ContractDocumentProcessor.prototype,key)===value)&&
     !files.has(path.join(dist,'main.js'))&&(!files.has(path.join(dist,'app.module.js'))||Boolean(defaultDocument?.checkMetadata())),code);
   }});
   collect();
   return exports;
  }catch(error){failed=true;throw error;}
 }
 function loadCurrent261DefaultAppModules(){
  const code='CURRENT261_DEFAULT_APP_MODULE_SOURCE';
  need(arguments.length===0&&require.main?.filename===path.join(root,'services/api/prisma/run-task12-native-con18-default-once.cjs'),code);
  const base=loadCurrent261LocalLifecycleDocumentModules();check();if(defaultDocument)return defaultDocument.exports;
  try{
   const dist=path.join(root,'services/api/dist'), entry=path.join(dist,'database/task12-con18-default-app.js');
   const entryExports=guardedRequire(entry),entryModule=require.cache[entry];
   need(entryModule?.loaded===true&&entryModule.exports===entryExports,code);roots.push(entryModule);
   const runDescriptor=Object.getOwnPropertyDescriptor(entryExports,'runTask12Con18DefaultApp');
   need(runDescriptor&&Object.hasOwn(runDescriptor,'value')&&typeof runDescriptor.value==='function',code);
   records.push({module:entryModule,key:'runTask12Con18DefaultApp',value:runDescriptor.value,descriptor:runDescriptor});
   const pin=(relative,key)=>{
    const module=require.cache[path.join(dist,relative+'.js')],descriptor=module&&Object.getOwnPropertyDescriptor(module.exports,key);
    need(module?.loaded===true&&descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function',code);
    records.push({module,key,value:descriptor.value,descriptor});return descriptor.value;
   };
   const app=pin('app.module','AppModule');
   const fixedImports=[["contract-ledger/contract-relationship-ledger.module","ContractRelationshipLedgerModule"],["database/database.module","DatabaseModule"],["organization/organization.module","OrganizationModule"],["project/project.module","ProjectModule"],["contract/contract.module","ContractModule"],["contract-bill/contract-bill.module","ContractBillModule"],["contract-document/contract-document.module","ContractDocumentModule"],["contract-document/contract-document-worker.module","ContractDocumentWorkerModule"],["contract-workbench/contract-workbench.module","ContractWorkbenchModule"],["contract-template/contract-template.module","ContractTemplateModule"],["contract-takeover/contract-takeover.module","ContractTakeoverModule"],["business-party/business-party.module","BusinessPartyModule"],["business-entry-definition/business-entry-definition.module","BusinessEntryDefinitionModule"],["clearing/clearing.module","ClearingModule"],["company-entity/company-entity.module","CompanyEntityModule"],["operating-ledger/operating-ledger.module","OperatingLedgerModule"],["operating-projection/operating-projection.module","OperatingProjectionModule"],["operating-takeover/operating-takeover.module","OperatingTakeoverModule"],["payable-registry/payable-registry.module","PayableRegistryModule"],["settlement/settlement.module","SettlementModule"],["payment/payment.module","PaymentModule"],["project-expense/project-expense.module","ProjectExpenseModule"],["project-close-profit/project-close-profit.module","ProjectCloseProfitModule"],["expense-claim/expense-claim.module","ExpenseClaimModule"],["general-procurement/general-procurement.module","GeneralProcurementModule"],["funds-workbench/funds-workbench.module","FundsWorkbenchModule"],["fund-account/fund-account.module","FundAccountModule"],["fund-movement/fund-movement.module","FundMovementModule"],["company-transfer/company-transfer.module","CompanyTransferModule"],["fund-execution/fund-execution.module","FundExecutionModule"],["spot-procurement/spot-procurement.module","SpotProcurementModule"],["wage-statement/wage-statement.module","WageStatementModule"],["necessary-expense-reserve/necessary-expense-reserve.module","NecessaryExpenseReserveModule"],["project-fund-dispute/project-fund-dispute.module","ProjectFundDisputeModule"],["invoice-ledger/invoice-ledger.module","InvoiceLedgerModule"],["approval/approval.module","ApprovalModule"],["file/file.module","FileModule"],["draft-retention/draft-retention.module","DraftRetentionModule"],["contract-ended-retention/contract-ended-retention.module","ContractEndedApplicationRetentionModule"],["contract-ended-purge/contract-ended-application-purge.module","ContractEndedApplicationPurgeModule"],["me/me.module","MeModule"],["archive/archive.module","ArchiveModule"],["audit/audit.module","AuditModule"],["auth/auth.module","AuthModule"],["pdf/pdf.module","PdfModule"]].map(([file,key])=>pin(file,key));
   const database=pin('database/database.module','DatabaseModule'),worker=pin('contract-document/contract-document-worker.module','ContractDocumentWorkerModule');
   const health=pin('health.controller','HealthController'),filterClass=pin('project/project-operating-constraint.filter','ProjectOperatingConstraintFilter');
   const exact=(key,target,expected)=>{const actual=metadata(key,target);return Array.isArray(actual)&&actual.length===expected.length&&expected.every((item,i)=>actual[i]===item);};
   const verify=()=>{
    const providers=metadata('providers',app);
    need(exact('imports',app,fixedImports)&&fixedImports.filter(v=>v===database).length===1&&fixedImports.filter(v=>v===worker).length===1&&
     exact('controllers',app,[health])&&Array.isArray(providers)&&providers.length===1&&own(providers[0],'provide')==='APP_FILTER'&&own(providers[0],'useClass')===filterClass&&
     exact('providers',database,[values.PrismaService])&&exact('exports',database,[values.PrismaService])&&metadata('__module:global__',database)===true&&
     !files.has(path.join(dist,'main.js')),code);
    return true;
   };
   const exports=Object.freeze({...base,runTask12Con18DefaultApp:runDescriptor.value});
   defaultDocument=Object.freeze({exports,checkMetadata:verify});verify();collect();
   const lease=officialDocumentModuleViews.get(base);need(lease,code);officialDocumentModuleViews.set(exports,lease);
   return exports;
  }catch(error){failed=true;throw error;}
 }
 function loadCurrent261LocalLifecycleDocumentModules(){
  const code='CURRENT261_LOCAL_LIFECYCLE_MODULE_SOURCE';
  need(arguments.length===0&&['TASK12_ARCHIVE261_SOURCE_V1','TASK12_ARCHIVE262_SOURCE_V1'].includes(material.source.profile.profile),code);
  check();if(lifeDocument)return lifeDocument.exports;
  try{
   const base=loadGeneratedContractDocumentModules(),published={},modules={};
   for(const [slot,relative,names]of [
    ['fixture','services/api/dist/database/task12-local-lifecycle-fixture.js',['buildTask12LocalLifecycleFixture','isTask12LocalLifecycleFixture','createTask12LocalLifecycleOriginals']],
    ['case','services/api/dist/database/task12-local-lifecycle-case.js',['runTask12LocalLifecycleCase','expectTask12LocalLifecycleAuditRollback','finishTask12LocalLifecycleCase','claimTask12LocalLifecycleCheckpoint']],
    ['con18','services/api/dist/database/task12-con18-withdrawal-case.js',['runTask12Con18Withdrawal']],
    ['sample','services/api/dist/contract-document/task12-official-qualification-sample.js',['createOfficialQualificationSample','createMechanicalCurrentQualificationSample','canonicalOfficialQualificationDocx']],
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
     if(['fixture','case','con18','profile'].includes(slot))published[key]=descriptor.value;
    }
   }
   const {assertCurrent261LocalLifecycleToolClosure}=require('./task12-current261-local-lifecycle-module-proof.cjs');
   const verify=()=>assertCurrent261LocalLifecycleToolClosure(root,modules,require.cache);verify();
   const readTask12LocalLifecycleSourceDocx=function(){
    need(arguments.length<=1,code);check();
    const key=arguments.length===0?'inside:material_purchase':require('./task12-current261-lifecycle-cases.cjs').current261LifecycleCase(arguments[0]).key;
    need(['inside:material_purchase','inside:equipment_rental'].includes(key),code);
    const file=path.join(root,'services/api/assets/templates/'+(key==='inside:equipment_rental'?'equipment-rental-real-v1.docx':'material-purchase-real-v1.docx')),observed=material.capture(file);
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
    createMechanicalCurrentQualificationSample:own(modules.sample.exports,'createMechanicalCurrentQualificationSample'),
    canonicalDocx:own(modules.sample.exports,'canonicalOfficialQualificationDocx')});
   officialDocumentModuleViews.set(lifeDocument.exports,lease);
   return lifeDocument.exports;
  }catch{failed=true;throw Object.assign(new Error(code),{code});}
 }
 function createContractTestingModule(){
  need(arguments.length===0&&contract,'CURRENT259_CONTRACT_FIXED_ENTRIES');
  return createOwnedTestingModule({imports:[contract.root]},contract);
 }
 let firstLoginDocument;
 function loadCurrent261FirstLoginModules(){
  const code='CURRENT261_FIRST_LOGIN_MODULE_SOURCE';need(arguments.length===0,code);check();if(firstLoginDocument)return firstLoginDocument;
  try{
   const base=loadCurrent261LocalLifecycleDocumentModules(),file=path.join(root,'services/api/dist/database/task12-first-login-case.js');
   const exports=guardedRequire(file),mod=own(require.cache,file),descriptor=Object.getOwnPropertyDescriptor(exports,'runTask12FirstLoginCase');
   need(own(mod,'loaded')===true&&own(mod,'filename')===file&&own(mod,'exports')===exports&&descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function',code);
   roots.push(mod);records.push({module:mod,key:'runTask12FirstLoginCase',value:descriptor.value,descriptor});collect();
   firstLoginDocument=Object.freeze({...base,runTask12FirstLoginCase:descriptor.value});officialDocumentModuleViews.set(firstLoginDocument,officialDocumentModuleViews.get(base));return firstLoginDocument;
  }catch(error){failed=true;throw error;}
 }
 function createDocumentTestingModule(){
  need(arguments.length===0&&document,'CURRENT259_GENERATED_DOCUMENT_FIXED_ENTRY');
  return createOwnedTestingModule({imports:[document.root]},document);
 }
 function createTestingModule(metadata){
  need(!document,'CURRENT259_GENERATED_DOCUMENT_FIXED_ENTRY');
  const builder=createOwnedTestingModule(metadata);ordinaryTestingUsed=true;return builder;
 }
 let nativeLookupPins;
 function prepareNativeEquipmentLookupPins(){
  if(nativeLookupPins)return nativeLookupPins;
  const code='CURRENT261_NATIVE_PROVIDER_LOOKUP',edges=[];
  const pin=(object,key)=>{need(object&&!types.isProxy(object),code);const d=Object.getOwnPropertyDescriptor(object,key);need(d,code);edges.push([object,key,d]);return d.value;};
  for(const [name,entry]of [['NestApplicationContext','@nestjs/core/nest-application-context'],['AbstractInstanceResolver','@nestjs/core/injector/abstract-instance-resolver'],['InstanceLinksHost','@nestjs/core/injector/instance-links-host'],['InstanceWrapper','@nestjs/core/injector/instance-wrapper']]){
   const file=fs.realpathSync(requireAt.resolve(entry)),exports=guardedRequire(file),mod=require.cache[file];framework[name]=own(exports,name);need(typeof framework[name]==='function',code);records.push({module:mod,key:name,value:framework[name]});roots.push(mod);
  }
  const namespaces=['@nestjs/common','@nestjs/common/interfaces','@nestjs/common/interfaces/scope-options.interface','@nestjs/core/injector/constants'].map(entry=>{
   const file=fs.realpathSync(requireAt.resolve(entry)),exports=guardedRequire(file),mod=require.cache[file];
   need(pin(require.cache,file)===mod&&pin(mod,'filename')===file&&pin(mod,'exports')===exports&&pin(mod,'loaded')===true,code);roots.push(mod);return exports;
  });
  // Scope has two original canonical barrel getters; pin both descriptors
  // without invoking them, then pin the fixed own-data leaf enum.
  for(const exports of namespaces.slice(0,2)){const d=Object.getOwnPropertyDescriptor(exports,'Scope');need(d&&typeof d.get==='function'&&d.set===undefined,code);pin(exports,'Scope');}
  const scope=pin(namespaces[2],'Scope');need(scope&&!types.isProxy(scope),code);
  need(pin(scope,'DEFAULT')===0&&pin(scope,'TRANSIENT')===1&&pin(scope,'REQUEST')===2,code);
  const staticContext=pin(namespaces[3],'STATIC_CONTEXT');need(staticContext&&!types.isProxy(staticContext)&&pin(staticContext,'id')===1,code);
  const appPrototype=framework.NestApplication.prototype,contextPrototype=framework.NestApplicationContext.prototype,resolverPrototype=framework.AbstractInstanceResolver.prototype,linksPrototype=framework.InstanceLinksHost.prototype,wrapperPrototype=framework.InstanceWrapper.prototype;
  for(const [object,key]of [[appPrototype,'getHttpAdapter'],[appPrototype,'getHttpServer'],[contextPrototype,'get'],[resolverPrototype,'find'],[contextPrototype,'instanceLinksHost'],[linksPrototype,'get'],[wrapperPrototype,'instance'],[wrapperPrototype,'getInstanceByContextId'],[Map.prototype,'get'],[WeakMap.prototype,'get'],[Array,'isArray'],[types,'isProxy'],[Object,'getOwnPropertyDescriptor'],[Object,'getPrototypeOf'],[Reflect,'apply'],[globalThis,'Map'],[globalThis,'WeakMap'],[globalThis,'Array']])pin(object,key);
  nativeLookupPins=Object.freeze({Map,WeakMap,Array,objectPrototype:Object.prototype,appPrototype,contextPrototype,resolverPrototype,linksPrototype,wrapperPrototype,staticContext,mapGet:Map.prototype.get,weakGet:WeakMap.prototype.get,descriptor:nativeProviderDescriptor,prototype:Object.getPrototypeOf,apply:nativeProviderApply,isProxy:types.isProxy,hasOwn:nativeProviderHasOwn,define:nativeProviderDefine,freeze:nativeProviderFreeze,arrayIsArray:Array.isArray,edges:Object.freeze(edges)});
  collect();return nativeLookupPins;
 }

 function createOwnedTestingModule(metadata,contractMode){
  check();need(metadata&&!types.isProxy(metadata)&&Reflect.ownKeys(metadata).length===1,'CURRENT259_FRAMEWORK_METADATA');
  const imports=own(metadata,'imports');need(Array.isArray(imports)&&!types.isProxy(imports)&&(contractMode?
   imports.length===1&&imports[0]===contractMode.root:
   imports.length===0||imports.length===1&&imports[0]===values.Task16RegisteredApplicationModule),'CURRENT259_FRAMEWORK_METADATA');
  const builder=guardedOperation(()=>testMethod.call(Test,metadata));collect();
  const compile=dataMethod(builder,'compile'),override=dataMethod(builder,'overrideProvider');let compiled=false,nativeOrdinary;
  const facade=Object.freeze({overrideProvider(token){
   check();need(!compiled&&(contractMode?contractMode.tokens.includes(token):
    token===values.PrismaService||token===values.Task16ImpactReaderToken),'CURRENT259_FRAMEWORK_OVERRIDE');
   const receiver=override.call(builder,token),use=dataMethod(receiver,'useValue');
   return Object.freeze({useValue(value){check();need(!compiled,'CURRENT259_FRAMEWORK_OVERRIDE');
    if(document&&contractMode===document&&token===values.PrismaService){const issued=nativeProviderApply(nativeProviderWeakGet,nativeTask12OrdinaryClients,[value]);nativeOrdinary=issued&&issued.used&&issued.loader===result&&issued.loaded===lifeDocument?.exports?value:undefined;}
    use.call(receiver,value);return facade;}});
  },async compile(){
   check();need(!compiled,'CURRENT259_FRAMEWORK_REENTRY');compiled=true;const nativePins=nativeOrdinary?prepareNativeEquipmentLookupPins():undefined;
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
     const nativeTokens=nativePins?Object.freeze(['AuthService','AuthRateLimitService','AuthController','Task12AuthErrorFilter','Task12AuthStageInterceptor','ContractReadService','MeService','AuditService','PrismaService','PrivateFileStorage','LayoutTemplateService','ContractDocumentProcessor','ContractDocumentService','FileService','ContractDraftController','CONTRACT_VERSION_FILE_READ_AUTHORITY','JwtTokenService'].map(key=>document.exports[key])):undefined;
     const nativeRows=nativePins?nativeEquipmentLookupRows(target,container,nativeTokens,nativePins):undefined;
     const nativeJwtVerify=nativePins?dataMethod(document.exports.JwtTokenService.prototype,'verifyAccessToken'):undefined;
     const nativeJwtPins=nativePins?nativeProviderFreeze({prototype:document.exports.JwtTokenService.prototype,method:nativeProviderFreeze({...nativeProviderDescriptor(document.exports.JwtTokenService.prototype,'verifyAccessToken')}),constructor:nativeProviderFreeze({...nativeProviderDescriptor(document.exports.JwtTokenService,'prototype')})}):undefined;
     function verifyTarget(key){
      const fn=originalMethods.get(key),getAdapter=originalMethods.get('getHttpAdapter');
      need(!closed&&dataMethod(target,key)===fn&&dataMethod(target,'getHttpAdapter')===getAdapter&&
       getAdapter.call(target)===adapter,'CURRENT259_FRAMEWORK_CHANGED');
      return fn;
     }
     const record={inspectNativeEquipmentProviders(module,expectedServer,publicGuard=false){
      const code='CURRENT261_NATIVE_PROVIDER_LOOKUP';
      need((arguments.length===2||arguments.length===3&&publicGuard===true)&&!closed&&nativeRows&&nativeOrdinary&&module===testing&&contractMode===document,code);
      // Validate every finite mutable lookup edge before invoking any original
      // getter or the existing full gate. No lazy registration at this entry.
      const issued=nativeProviderApply(nativeProviderWeakGet,nativeTask12OrdinaryClients,[nativeOrdinary]);need(issued&&issued.used&&issued.loader===result&&issued.loaded===lifeDocument?.exports,code);
      if(!nativeRows.ready())return undefined; // Caller keeps the original guarded reads.
      nativeRows.assert();need(nativeRows.expected(values.PrismaService)===nativeOrdinary,code);
      const server=Object.getOwnPropertyDescriptor(target,'httpServer'),adapterData=Object.getOwnPropertyDescriptor(target,'httpAdapter');
      need(server&&nativeProviderHasOwn(server,'value')&&server.value===expectedServer&&adapterData&&nativeProviderHasOwn(adapterData,'value')&&adapterData.value===adapter,code);
      const publicEdges=()=>{
       const server=Object.getOwnPropertyDescriptor(target,'httpServer'),adapterData=Object.getOwnPropertyDescriptor(target,'httpAdapter');
       need(server&&nativeProviderHasOwn(server,'value')&&server.value===expectedServer&&adapterData&&nativeProviderHasOwn(adapterData,'value')&&adapterData.value===adapter&&
        dataMethod(target,'getHttpServer')===originalMethods.get('getHttpServer')&&dataMethod(target,'getHttpAdapter')===originalMethods.get('getHttpAdapter'),code);
       const jwt=nativeRows.expected(nativeTokens[16]);
       need(jwt&&!types.isProxy(jwt)&&Object.getPrototypeOf(jwt)===nativeJwtPins.prototype,code);
       const same=(object,key,expected)=>{const current=nativeProviderDescriptor(object,key),fields=['value','get','set','writable','enumerable','configurable'];need(current,code);for(let i=0;i<fields.length;i++)need(nativeProviderDescriptor(current,fields[i])?.value===nativeProviderDescriptor(expected,fields[i])?.value,code);};
       same(nativeTokens[16],'prototype',nativeJwtPins.constructor);same(nativeJwtPins.prototype,'verifyAccessToken',nativeJwtPins.method);
       need(nativeProviderDescriptor(jwt,'verifyAccessToken')===undefined,code);
       need(jwt&&!types.isProxy(jwt)&&Object.getPrototypeOf(jwt)===nativeJwtPins.prototype&&dataMethod(nativeTokens[16].prototype,'verifyAccessToken')===nativeJwtVerify&&dataMethod(jwt,'verifyAccessToken')===nativeJwtVerify,code);
       return jwt;
      };
      if(publicGuard)publicEdges();
      check();let first,value;
      try{value=guardedOperation(()=>{
       nativeRows.assert();const pairs=[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null];
       const read=dataMethod(target,'get');need(read===originalMethods.get('get')&&dataMethod(target,'getHttpAdapter')===originalMethods.get('getHttpAdapter'),code);
       for(let i=0;i<16;i++){const token=nativeTokens[i],instance=nativeProviderApply(read,target,[token]);need(instance===nativeRows.expected(token),code);pairs[i]=nativeProviderFreeze([token,instance]);}
       if(publicGuard){
        const jwt=publicEdges(),server=nativeProviderApply(originalMethods.get('getHttpServer'),target,[]),jwtService=nativeProviderApply(read,target,[nativeTokens[16]]);
        need(server===expectedServer&&jwtService===jwt,code);nativeRows.assert();publicEdges();
        const proof=nativeProviderFreeze({providers:nativeProviderFreeze(pairs),server,jwtService,verifyAccessToken:nativeJwtVerify});
        need(nativePublicGuardMapsValid(),code);
        nativeProviderApply(nativePublicGuardSet,nativePublicGuardProofs,[proof,nativeProviderFreeze({application:proxy,module:testing,server:expectedServer,verify(){
         need(!closed&&nativePublicGuardMapsValid(),code);
         const current=nativeProviderApply(nativeProviderWeakGet,nativeTask12OrdinaryClients,[nativeOrdinary]);need(current===issued&&current.used&&current.loader===result&&current.loaded===lifeDocument?.exports,code);
         nativeRows.assert();publicEdges();return true;
        }})]);
        return proof;
       }
       nativeRows.assert();return nativeProviderFreeze(pairs);
      });}catch(error){first=error;}
      try{collect();if(publicGuard){nativeRows.assert();publicEdges();}}catch(error){if(!first)first=error;}
      if(first)throw first;return value;
     },inspectDocumentAuthProviders(module,expectedServer){
      need(document&&contractMode===document&&module===testing,'CURRENT259_FRAMEWORK_CHANGED');
      // Source/graph/FD ownership only: no resource or official-scope callback.
      check();
      const readAuth=()=>{
       need(verifyTarget('getHttpServer').call(target)===expectedServer&&dataMethod(testing,'get')===testingGet,'CURRENT259_FRAMEWORK_CHANGED');
       const read=token=>verifyTarget('get').call(target,token),fromModule=token=>testingGet.call(testing,token);
       const result={runtime:read(values.PrismaService),moduleRuntime:fromModule(values.PrismaService),
        ...Object.fromEntries([['auth','AuthService'],['rateLimits','AuthRateLimitService'],['authController','AuthController'],['authFilter','Task12AuthErrorFilter'],['authInterceptor','Task12AuthStageInterceptor']].flatMap(([name,key])=>[[name,read(document.exports[key])],['module'+name[0].toUpperCase()+name.slice(1),fromModule(document.exports[key])]]))};
       for(const [name,key,names]of [['auth','AuthService',['login','loadUserRoleScopes','issueTokens']],['rateLimits','AuthRateLimitService',['take']],['authController','AuthController',['login']],['authFilter','Task12AuthErrorFilter',['catch']],['authInterceptor','Task12AuthStageInterceptor',['intercept']]]){
        const receiver=result[name],Class=document.exports[key];
        need(receiver&&!types.isProxy(receiver)&&Object.getPrototypeOf(receiver)===Class.prototype&&result['module'+name[0].toUpperCase()+name.slice(1)]===receiver&&names.every(key=>dataMethod(receiver,key)===dataMethod(Class.prototype,key)),'CURRENT259_FRAMEWORK_CHANGED');
       }
       need(own(result.authInterceptor,'filter')===result.authFilter,'CURRENT259_FRAMEWORK_CHANGED');
       return result;
      };
      const result=guardedOperation(readAuth);check();
      // Diagnostic-only continuity: no material/graph hashing and no returned
      // providers. The HTTP AFTER_CHECK still performs the original full gate.
      const authData=(object,key)=>{
       need(object&&!types.isProxy(object),'CURRENT259_LOADER_EXPORT');
       const descriptor=Object.getOwnPropertyDescriptor(object,key);
       need(descriptor&&Object.hasOwn(descriptor,'value'),'CURRENT259_LOADER_EXPORT');return descriptor;
      };
      const sameAuthData=(object,key,expected)=>{
       const actual=authData(object,key);
       need(['value','writable','enumerable','configurable'].every(field=>actual[field]===expected[field]),'CURRENT259_LOADER_EXPORT');return actual.value;
      };
      const authCacheDescriptor=authData(require,'cache'),authCache=authCacheDescriptor.value;
      need(authCache&&!types.isProxy(authCache),'CURRENT259_LOADER_EXPORT');
      const authModules=new Map(records.map(row=>{
       const mod=row.module,filename=authData(mod,'filename'),exports=authData(mod,'exports');
       need(typeof filename.value==='string'&&filename.value.length>0&&exports.value&&!types.isProxy(exports.value),'CURRENT259_LOADER_EXPORT');
       const slot=authData(authCache,filename.value);need(slot.value===mod,'CURRENT259_LOADER_EXPORT');
       return [mod,{filename,exports,slot}];
      }));
      const verifyAuthDiagnosticReceiver=()=>{
       need(!failed&&!loading&&Module._load===hooks.load&&globalThis.Proxy===nativeProxy&&Reflect.getMetadata===reflection.get&&Reflect.defineMetadata===reflection.define,'CURRENT259_FRAMEWORK_CHANGED');
       need(sameAuthData(require,'cache',authCacheDescriptor)===authCache,'CURRENT259_LOADER_EXPORT');
       for(const row of records){
        const saved=authModules.get(row.module);need(saved,'CURRENT259_LOADER_EXPORT');
        const filename=sameAuthData(row.module,'filename',saved.filename),exports=sameAuthData(row.module,'exports',saved.exports);
        need(sameAuthData(authCache,filename,saved.slot)===row.module&&exports&&!types.isProxy(exports)&&own(exports,row.key)===row.value,'CURRENT259_LOADER_EXPORT');
        if(row.descriptor)sameAuthData(exports,row.key,row.descriptor);
       }
       // Reject module/cache descriptor substitutions before invoking existing
       // metadata or creation helpers that may inspect these original modules.
       checkCreation();document.checkMetadata();
       return guardedOperation(()=>{const current=readAuth();need(Object.keys(result).every(key=>current[key]===result[key]),'CURRENT259_FRAMEWORK_CHANGED');return true;});
      };
      return Object.freeze({...result,verifyAuthDiagnosticReceiver});
     },inspectPaymentProviders(module,expectedServer,token,handle){
      need(!contractMode&&module===testing&&(arguments.length===2||arguments.length===4),'CURRENT259_FRAMEWORK_CHANGED');
      const verify=arguments.length===4?()=>verifyBusinessFiles(token,handle):check;
      verify();
      // A single synchronous guarded operation reads the same server and four
      // providers plus the private filter pair. Each original method and the adapter are still checked.
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
       const registrationFilter=verifyTarget('get').call(target,values.Task16RegistrationErrorFilter),moduleRegistrationFilter=readModule(values.Task16RegistrationErrorFilter);
       return {runtime,reader,moduleRuntime,moduleReader,registrationFilter,moduleRegistrationFilter};
      });
      // Authenticated business reads recheck the graph and every current file FD.
      // Explicit non-business inspection retains the full physical hash pass.
      verify();
      return result;
     },method(key){
      if(!APP_METHODS.includes(key))return undefined;
      if(methods.has(key))return methods.get(key);
      const fn=originalMethods.get(key);
      const wrapped=key==='close'?()=>{closed=true;return close();}:(...args)=>{
       check();verifyTarget(key);
       const result=guardedOperation(()=>fn.apply(target,args));
       if(types.isPromise(result))return result.then(value=>{collect();return value===target?record.view:value;});collect();
       if(nativeRows&&key==='get'&&args.length===1){
        for(let i=0;i<nativeTokens.length;i++)if(nativeTokens[i]===args[0]){nativeRows.warm(args[0],result);break;}
       }
       return result===target?record.view:result;
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
 function createNativeTask12OrdinaryClient(urlText){
  const code='CURRENT261_NATIVE_ORDINARY_HANDLE';
  need(arguments.length===1&&typeof urlText==='string'&&urlText.length<=8192&&['TASK12_ARCHIVE261_SOURCE_V1','TASK12_ARCHIVE262_SOURCE_V1'].includes(material.source.profile.profile),code);
  check();const loaded=loadCurrent261LocalLifecycleDocumentModules(),Constructor=values.PrismaService;
  const url=new URL(urlText),keys=['schema','connection_limit','sslmode','sslaccept','sslcert','connect_timeout','pool_timeout','application_name'];
  need(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&Number(url.port)>1024&&Number(url.port)<=65535&&Number(url.port)!==5432&&/^jg_fixture_app_[a-f0-9]{24}$/u.test(url.username)&&/^[a-f0-9]{96}$/u.test(url.password)&&/^\/jg_task01_[a-f0-9]{32}$/u.test(url.pathname)&&url.hash===''&&[...url.searchParams.keys()].length===keys.length&&keys.every(key=>url.searchParams.getAll(key).length===1)&&url.searchParams.get('schema')==='public'&&url.searchParams.get('connection_limit')==='2'&&url.searchParams.get('sslmode')==='require'&&url.searchParams.get('sslaccept')==='strict'&&url.searchParams.get('connect_timeout')==='5'&&url.searchParams.get('pool_timeout')==='5'&&/^\/private\/tmp\/jg-native-contract-[A-Za-z0-9_-]{1,32}\/ca\.crt$/u.test(url.searchParams.get('sslcert'))&&/^native_task12_[a-f0-9]{32}_3$/u.test(url.searchParams.get('application_name')),code);
  const client=new Constructor({datasources:{db:{url:urlText}}});
  check();need(Constructor===values.PrismaService&&loaded.PrismaService===Constructor&&client instanceof Constructor,code);
  nativeTask12OrdinaryClients.set(client,{loader:result,loaded,used:false,verify(){
   check();need(loadCurrent261LocalLifecycleDocumentModules()===loaded&&values.PrismaService===Constructor&&loaded.PrismaService===Constructor&&client instanceof Constructor&&Object.getPrototypeOf(client)===Constructor.prototype,code);
  }});return client;
 }
 check();material.check();const result=Object.freeze({createNativeTask12OrdinaryClient,Class,PrismaService:values.PrismaService,Test,check,checkContinuity,verifyBusinessFiles,verifyFull:()=>{check();material.check();},loadApplicationModules,loadPaymentModules:()=>{check();return paymentExports;},createTestingModule,loadContractApplicationModules,createContractTestingModule,loadGeneratedContractDraftAdmission,loadGeneratedContractDocumentModules,loadCurrent261LocalLifecycleDocumentModules,loadCurrent261DefaultAppModules,loadCurrent261FirstLoginModules,createDocumentTestingModule,
  constructorContract:'IMPLICIT_DERIVED_CONSTRUCTOR_FORWARDS_OPTIONS;LIFECYCLE_HOOKS_UNCHANGED_NOT_CALLED',
  witness:()=>{check();return Object.freeze({source:material.source,build:material.summary,host:process.platform+'-'+process.arch,engineCommit:observedVersion.commit,modules:files.size,executionAllowed:false});}});
 cache.set(handle,result);return result;
}
module.exports=Object.freeze({inspectCurrent261OwnedNativeEquipmentProviders,inspectCurrent261OwnedNativeEquipmentPublicGuard,consumeCurrent261OwnedNativeEquipmentPublicGuard,takeCurrent261NativeOrdinaryClient,loadCurrent259Client,claimCurrent261OfficialDocumentModules,current259OwnedApplicationMethod,current259OwnedApplicationView,
 inspectCurrent259OwnedDocumentAuthProviders,inspectCurrent259OwnedPaymentProviders,isCurrent259OwnedModule,createCurrent259OwnedApplication,takeCurrent259CreationFailure});
