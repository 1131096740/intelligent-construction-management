"use strict";
// Fixed in-process client loader. No cache deletion or interpreter and no I/O on import.
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const {readQualifiedTask16File:read}=require("./task16-runtime-inputs.cjs");
const BUILTIN_LOADER_SOURCE=process.binding("natives")["internal/modules/cjs/loader"];
const TREES=["node_modules","services/api/node_modules","packages/shared-domain/node_modules","services/api/dist","packages/shared-domain/dist"];
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
function coreHooksUnmodified(){
 // Fixed Node CJS assignments, not a JavaScript interpreter. Comparing to the
 // pinned running Node's builtin source prevents an earlier wrapper from being
 // adopted as the baseline merely because its reference stays unchanged.
 const source=BUILTIN_LOADER_SOURCE;
 if(typeof source!=="string")return false;
 const checks=[[Module._load,"Module._load = function"],[Module._resolveFilename,"Module._resolveFilename = function"],[Module._findPath,"Module._findPath = function"],[Module.prototype.require,"Module.prototype.require = function"],...[".js",".json",".node"].map(ext=>[Module._extensions[ext],`Module._extensions['${ext}'] = function`])];
 return checks.every(([fn,marker])=>{const assignment=source.indexOf(marker);if(assignment<0||typeof fn!=="function")return false;const begin=source.indexOf("function",assignment),end=source.indexOf("\n};",begin);return end>begin&&Function.prototype.toString.call(fn)===source.slice(begin,end+2);});
}
function loadTask16Client(source,facts,simulation,applicationEntries){
 const root=source.candidateRoot;
 need(coreHooksUnmodified()&&facts&&facts.hooks&&Module._load===facts.hooks.load&&Module._resolveFilename===facts.hooks.resolve&&Module._findPath===facts.hooks.find&&Module.prototype.require===facts.hooks.require&&[".js",".json",".node"].every(ext=>Module._extensions[ext]===facts.hooks.extensions[ext]),"TASK16_CLIENT_LOADER_HOOK_CHANGED");
 need(simulation||facts.freshCli===true,"TASK16_CLIENT_FRESH_CLI_REQUIRED");
 const entry=source.runtimeAdmission.clientEntry;
 need(entry&&typeof entry.path==="string"&&inside(root,entry.path)&&/\.(?:c?js)$/u.test(entry.path)&&fs.realpathSync(entry.path)===entry.path,"TASK16_CLIENT_ENTRY");
 const manifests=source.inputs.trees.map(tree=>{const captured=read(tree.manifest,{privateFile:true,maxBytes:64*1024*1024,collect:true,code:"TASK16_CLIENT_TREE"});need(captured.sha256===tree.sha256,"TASK16_CLIENT_TREE");const value=JSON.parse(captured.bytes.toString("utf8"));need(value.schemaVersion===1&&value.status==="captured"&&value.root===path.join(root,tree.root),"TASK16_CLIENT_TREE");return{root:path.join(root,tree.root),entries:value.entries};});
 const members=new Map(source.executionFiles.map(row=>[path.join(root,row.path),row]));
 const capture=file=>{need(fs.realpathSync(file)===file&&inside(root,file),"TASK16_CLIENT_MODULE_ESCAPES");const tree=manifests.find(item=>inside(item.root,file));const expected=tree?.entries[path.relative(tree.root,file)]??members.get(file);need(expected&&(expected.kind===undefined||expected.kind==="file")&&/^[a-f0-9]{64}$/u.test(expected.sha256),"TASK16_CLIENT_MODULE_UNSEALED");const actual=read(file,{maxBytes:64*1024*1024,code:"TASK16_CLIENT_MODULE_CHANGED"});need(actual.sha256===expected.sha256,"TASK16_CLIENT_MODULE_CHANGED");return{path:file,...actual};};
 const initial=capture(entry.path);need(entry.identity&&read(entry.path,{maxBytes:64*1024*1024,expectedIdentity:entry.identity,code:"TASK16_CLIENT_ENTRY"}).sha256===entry.sha256,"TASK16_CLIENT_ENTRY");need(initial.sha256===entry.sha256,"TASK16_CLIENT_ENTRY");
 need(!Object.keys(require.cache).some(file=>TREES.some(tree=>inside(path.join(root,tree),file))),"TASK16_CLIENT_PRELOADED_MODULE");
 need(!Object.values(Module._pathCache).some(file=>typeof file==="string"&&TREES.some(tree=>inside(path.join(root,tree),file))),"TASK16_CLIENT_PRELOADED_PATH");
 const loaded=require(entry.path),actual=require.cache[entry.path];
 need(actual?.loaded===true&&actual.exports===loaded&&typeof loaded.PrismaClient==="function"&&loaded.Prisma?.prismaVersion?.client==="5.22.0"&&loaded.Prisma?.prismaVersion?.engine==="605197351a3c8bdd595af2d2a9bc3025bca48ea2","TASK16_CLIENT_CLASS");
 const Class=loaded.PrismaClient,files=new Map(),applicationRoots=[];let applicationExports,reflection,fixtureExports;const fixtureDependencyMethods=new Map();
 const check=()=>{
  need(coreHooksUnmodified()&&Module._load===facts.hooks.load&&Module._resolveFilename===facts.hooks.resolve&&Module._findPath===facts.hooks.find&&Module.prototype.require===facts.hooks.require&&[".js",".json",".node"].every(ext=>Module._extensions[ext]===facts.hooks.extensions[ext]),"TASK16_CLIENT_LOADER_HOOK_CHANGED");
  need(require.cache[entry.path]===actual&&actual.exports===loaded&&loaded.PrismaClient===Class,"TASK16_CLIENT_CLASS_CHANGED");
  const visited=new Set();const visit=mod=>{if(visited.has(mod))return;visited.add(mod);need(mod?.loaded===true&&typeof mod.filename==="string","TASK16_CLIENT_MODULE_CHANGED");const previous=files.get(mod.filename);if(previous){need(previous.module===mod&&previous.exports===mod.exports,"TASK16_CLIENT_MODULE_CHANGED");const current=read(previous.path,{maxBytes:64*1024*1024,expectedIdentity:previous.identity,code:"TASK16_CLIENT_MODULE_CHANGED"});need(current.sha256===previous.sha256&&require.cache[mod.filename]===mod,"TASK16_CLIENT_MODULE_CHANGED");}else{need(require.cache[mod.filename]===mod,"TASK16_CLIENT_MODULE_CHANGED");files.set(mod.filename,{...capture(mod.filename),module:mod,exports:mod.exports});}for(const child of mod.children)visit(child);};visit(actual);for(const mod of applicationRoots)visit(mod);
  for(const row of files.values()){need(require.cache[row.path]===row.module&&row.module.exports===row.exports,"TASK16_CLIENT_MODULE_CHANGED");need(read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:"TASK16_CLIENT_MODULE_CHANGED"}).sha256===row.sha256,"TASK16_CLIENT_MODULE_CHANGED");}
  if(fixtureExports){
   for(const row of files.values()){
    const key=row.path===path.join(root,'services/api/dist/company-entity/unified-social-credit-code.js')?'assertValidUnifiedSocialCreditCode':/\/node_modules\/bcryptjs\/(?:index\.js|dist\/bcrypt\.js)$/u.test(row.path)?'hash':undefined;
    if(key){const descriptor=Object.getOwnPropertyDescriptor(row.exports,key);need(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function','TASK16_FIXTURE_DEPENDENCY_CHANGED');const prior=fixtureDependencyMethods.get(row.path);if(prior)need(prior===descriptor.value,'TASK16_FIXTURE_DEPENDENCY_CHANGED');else fixtureDependencyMethods.set(row.path,descriptor.value);}
   }
  }
  if(fixtureExports)for(const row of fixtureExports)need(Object.getOwnPropertyDescriptor(row.module.exports,row.key)?.value===row.value,"TASK16_FIXTURE_EXPORT_CHANGED");
  if(applicationExports){need(Reflect.getMetadata===reflection.get&&Reflect.defineMetadata===reflection.define,"TASK16_APP_REFLECTION_CHANGED");for(const row of applicationExports.records)need(Object.getOwnPropertyDescriptor(row.module.exports,row.key)?.value===row.value,"TASK16_APP_EXPORT_CHANGED");applicationExports.checkMetadata();}
  for(const file of Object.keys(require.cache))if(TREES.some(tree=>inside(path.join(root,tree),file)))need(files.has(file),"TASK16_APP_FOREIGN_CACHE");
  const current=read(entry.path,{maxBytes:64*1024*1024,expectedIdentity:initial.identity,code:"TASK16_CLIENT_ENTRY"});need(current.sha256===entry.sha256,"TASK16_CLIENT_ENTRY");
 };
 const loadApplicationModules=request=>{
  check();need(!applicationExports,"TASK16_APP_MODULE_REENTRY");
  const relative=["database/task16-registered-application.module.js","database/prisma.service.js","api-security.js","operating-projection/projection-export-json.js","api-json-replacer.js","validation/api-validation.js","api-listen.js"];
  const names=["application","database","security","projection","json","validation","listen"];
  need(JSON.stringify(request)===JSON.stringify(relative.map((file,i)=>({name:names[i],path:"services/api/dist/"+file}))),"TASK16_APP_FIXED_ENTRIES");
  need(Array.isArray(applicationEntries)&&applicationEntries.length===8&&JSON.stringify(applicationEntries)===JSON.stringify(source.runtimeAdmission.applicationEntries),"TASK16_APP_FIRST_ENTRIES");
  need(applicationEntries.every(row=>!require.cache[row.path]),"TASK16_APP_PRELOADED_ENTRY");
  const records=[],values={},keys=["Task16RegisteredApplicationModule","PrismaService","configureApiSecurity","configureProjectionExportJson","apiJsonReplacer","createApiValidationPipe","listenApi","Test"];
  for(let i=0;i<8;i++){
   const row=applicationEntries[i];need(row&&typeof row.path==="string"&&inside(root,row.path)&&(i===7?/\/node_modules\/@nestjs\/testing\/test\.js$/u.test(row.path):row.path===path.join(root,'services/api/dist',relative[i])),"TASK16_APP_FIXED_ENTRIES");
   const cached=require.cache[row.path];need(!cached||files.get(row.path)?.module===cached&&files.get(row.path)?.exports===cached.exports,"TASK16_APP_PRELOADED_ENTRY");const before=capture(row.path);need(before.sha256===row.sha256&&read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:"TASK16_APP_ENTRY_CHANGED"}).sha256===row.sha256,"TASK16_APP_ENTRY_CHANGED");
   const exports=require(row.path),mod=require.cache[row.path];need(mod?.loaded===true&&mod.exports===exports,"TASK16_APP_ENTRY_CHANGED");applicationRoots.push(mod);
   const descriptor=Object.getOwnPropertyDescriptor(exports,keys[i]);need(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function',"TASK16_APP_EXPORT_CHANGED");records.push({module:mod,key:keys[i],value:descriptor.value});values[keys[i]]=descriptor.value;
   read(row.path,{maxBytes:64*1024*1024,expectedIdentity:before.identity,code:"TASK16_APP_ENTRY_CHANGED"});check();
  }
  need(Object.getPrototypeOf(values.PrismaService)===Class&&Object.getPrototypeOf(values.PrismaService.prototype)===Class.prototype,"TASK16_APP_PRISMA_CLASS");
  reflection={get:Reflect.getMetadata,define:Reflect.defineMetadata};need(typeof reflection.get==='function'&&typeof reflection.define==='function',"TASK16_APP_REFLECTION_CHANGED");
  const exported=(file,key)=>{const mod=require.cache[path.join(root,'services/api/dist',file+'.js')];need(mod&&files.get(mod.filename)?.module===mod,"TASK16_APP_METADATA_SOURCE");const d=Object.getOwnPropertyDescriptor(mod.exports,key);need(d&&Object.hasOwn(d,'value')&&typeof d.value==='function',"TASK16_APP_METADATA_SOURCE");return d.value;};
  const metadata=(key,Class)=>reflection.get.call(Reflect,key,Class);
  const imports=[["database/database.module","DatabaseModule"],["auth/auth.module","AuthModule"],["audit/audit.module","AuditModule"],["file/file.module","FileModule"],["fund-account/fund-account.module","FundAccountModule"],["operating-ledger/operating-ledger.module","OperatingLedgerModule"],["project-funding/project-funding.module","ProjectFundingModule"],["business-entry-definition/business-entry-transaction.module","BusinessEntryTransactionModule"]].map(([f,k])=>exported(f,k));
  const guards=[["auth/guards/jwt-auth.guard","JwtAuthGuard"],["retired-write-entry/retired-write-entry.guard","RetiredWriteEntryGuard"],["operational-write-freeze/operational-write-freeze.guard","OperationalWriteFreezeGuard"],["auth/guards/account-rate-limit.guard","AccountRateLimitGuard"],["auth/guards/permission.guard","PermissionGuard"],["contract-cutover/contract-cutover.guard","ContractCutoverGuard"]].map(([f,k])=>exported(f,k));
  const controller=exported('payment/registered-payment-execution.controller','RegisteredPaymentExecutionController'),filter=exported('project/project-operating-constraint.filter','ProjectOperatingConstraintFilter');
  const serviceProviders=[["payment/payment-amount.service","PaymentAmountService"],["payment/payment-request.service","PaymentRequestService"],["payment/registered-payment-execution.service","RegisteredPaymentExecutionService"],["payment/registered-payment-notification.service","RegisteredPaymentNotificationService"],["approval/approval-sms.service","ApprovalSmsService"]].map(([f,k])=>exported(f,k));
  const checkMetadata=()=>{const actualImports=metadata('imports',values.Task16RegisteredApplicationModule);need(Array.isArray(actualImports)&&actualImports.length===imports.length&&imports.every((v,i)=>actualImports[i]===v),"TASK16_APP_METADATA_CHANGED");const controllers=metadata('controllers',values.Task16RegisteredApplicationModule);need(controllers?.length===1&&controllers[0]===controller,"TASK16_APP_METADATA_CHANGED");const providers=metadata('providers',values.Task16RegisteredApplicationModule);need(providers?.length===6&&serviceProviders.every((Class,i)=>providers[i]===Class)&&providers[5]?.provide==='APP_FILTER'&&providers[5].useClass===filter,"TASK16_APP_METADATA_CHANGED");const actual=metadata('providers',imports[1])?.filter(row=>row?.provide==='APP_GUARD');need(actual?.length===6&&guards.every((Class,i)=>actual[i].useClass===Class),"TASK16_APP_METADATA_CHANGED");};
  applicationExports={records,checkMetadata};check();return Object.freeze(values);
 };
 const loadFixtureModules=()=>{
  check();need(!fixtureExports,"TASK16_FIXTURE_MODULE_REENTRY");const row=source.runtimeAdmission.fixture?.entry;
  need(row?.path===path.join(root,'services/api/dist/database/registered-payment-postgres.fixture.js')&&row.identity,"TASK16_FIXTURE_ENTRY");
  const existing=require.cache[row.path];need(!existing||files.get(row.path)?.module===existing&&files.get(row.path)?.exports===existing.exports,"TASK16_FIXTURE_PRELOADED_ENTRY");
  need(read(row.path,{maxBytes:64*1024*1024,expectedIdentity:row.identity,code:'TASK16_FIXTURE_ENTRY'}).sha256===row.sha256,"TASK16_FIXTURE_ENTRY");
  const exports=require(row.path),mod=require.cache[row.path];need(mod?.loaded===true&&mod.exports===exports,"TASK16_FIXTURE_ENTRY");applicationRoots.push(mod);
  const keys=['buildRegisteredPgFixturePlan','seedRegisteredPgFixture'];fixtureExports=keys.map(key=>{const descriptor=Object.getOwnPropertyDescriptor(exports,key);need(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function',"TASK16_FIXTURE_EXPORT_CHANGED");return{module:mod,key,value:descriptor.value};});check();return Object.freeze(Object.fromEntries(fixtureExports.map(row=>[row.key,row.value])));
 };
 check();return{Class,check,loadApplicationModules,loadFixtureModules,witness:()=>({entry:entry.path,entrySha256:entry.sha256,modules:[...files.values()].map(row=>({path:row.path,sha256:row.sha256})).sort((a,b)=>a.path.localeCompare(b.path))})};
}
module.exports={loadTask16Client};
