'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
function model(){
 const root='/private/tmp/local-lifecycle-model-source',cache=Object.create(null),names={
  profile:'services/api/prisma/task12-official-document-profile.cjs',child:'services/api/prisma/task12-official-document-child.cjs',context:'services/api/prisma/task12-document-context.cjs',
  con18:'services/api/dist/database/task12-con18-withdrawal-case.js',sample:'services/api/dist/contract-document/task12-official-qualification-sample.js',runtime:'services/api/prisma/task12-current259-generated-document-runtime.cjs',converter:'services/api/dist/contract-document/contract-body-pdf-converter.js',lo:'services/api/dist/contract-document/libreoffice-converter.js'};
 const modules=Object.fromEntries(Object.entries(names).map(([key,name])=>{const m={filename:path.join(root,name),loaded:true,exports:{},children:[]};cache[m.filename]=m;return[key,m];}));
 modules.con18.exports.runTask12Con18Withdrawal=()=>{};
 modules.sample.exports.createOfficialQualificationSample=()=>{};modules.sample.exports.createMechanicalCurrentQualificationSample=()=>{};modules.sample.exports.canonicalOfficialQualificationDocx=()=>{};
 modules.profile.exports.currentOfficialDocumentScope=()=>{};modules.child.exports.createOfficialDocumentChildBudget=()=>{};modules.child.exports.attachPostcheck=()=>{};modules.context.exports.createDocumentContextAuthority=()=>{};
 modules.runtime.exports.verifyOfficialTask12DocumentRuntime=()=>{};modules.runtime.exports.withOfficialTask12DocumentRuntime=()=>{};
 modules.profile.children.push(modules.context);modules.runtime.children.push(modules.profile);
 for(const key of ['converter','lo'])modules[key].children.push(modules.profile,modules.child);
 return {root,cache,modules};
}
test('life module closure requires the actual converter and LO to share the same host context and official issuer',()=>{
 const {assertCurrent261LocalLifecycleToolClosure:check}=require('./task12-current261-local-lifecycle-module-proof.cjs');
 const f=model();assert.equal(check(f.root,f.modules,f.cache),undefined);
 for(const patch of [g=>{delete g.modules.con18.exports.runTask12Con18Withdrawal;},g=>{delete g.cache[g.modules.con18.filename];},g=>{delete g.modules.sample.exports.canonicalOfficialQualificationDocx;},g=>{g.modules.sample.filename='/foreign/sample.js';},g=>{g.modules.converter.children=[];},g=>{g.modules.lo.children=[{...g.modules.profile},g.modules.child];},
  g=>{g.modules.runtime.children=[];},g=>{g.modules.context.filename=g.modules.context.filename.replace('model-source','foreign-source');},
  g=>{g.modules.child.exports.createOfficialDocumentChildBudget=true;},g=>{g.cache[g.modules.profile.filename]={...g.modules.profile};}]){
  const g=model();patch(g);assert.throws(()=>check(g.root,g.modules,g.cache),/LIFECYCLE_MODULE_SOURCE/u);
 }
});

test('official modules claim rejects caller readers and cloned namespaces before any SDK load',()=>{
 const {claimCurrent261OfficialDocumentModules:claim}=require('./task16-current259-client-loader.cjs');
 assert.equal(typeof claim,'function');
 for(const value of [undefined,{},Object.freeze({source:{},check(){},verifyFull(){},createOfficialQualificationSample(){},canonicalDocx(){}}),new Proxy({},{})]){
  assert.throws(()=>claim(value),error=>error.code==='CURRENT261_OFFICIAL_DOCUMENT_MODULES');
 }
});

test('auth transaction observer and filter share the same fixed module/functions and reject descriptor substitutions without traps',()=>{
 const {captureCurrent261AuthTransactionClosure:capture}=require('./task12-current261-local-lifecycle-module-proof.cjs');
 const make=()=>{const root='/private/tmp/auth-closure-model',cache={},names=['database/task12-auth-transaction-phase.js','auth/auth-rate-limit.service.js','database/task12-auth-error-diagnostic.js'];
  const modules=names.map(name=>({filename:path.join(root,'services/api/dist',name),loaded:true,exports:{},children:[]}));
  modules[0].exports={observeTask12AuthTransaction(){},takeTask12AuthTransactionPhase(){}};modules[1].children=[modules[0]];modules[2].children=[modules[0]];for(const m of modules)cache[m.filename]=m;return{root,cache,modules};};
 const f=make(),check=capture(f.root,f.cache);check();
 for(const mutate of [g=>{g.modules[0].exports.observeTask12AuthTransaction=()=>{};},g=>{g.cache[g.modules[0].filename]={...g.modules[0]};},g=>{g.modules[2].children=[{...g.modules[0]}];},g=>{g.modules[0].exports={...g.modules[0].exports};}]){
  const g=make(),verify=capture(g.root,g.cache);mutate(g);assert.throws(verify,/MODULE_SOURCE/u);
 }
 let traps=0;const g=make(),verify=capture(g.root,g.cache);Object.defineProperty(g.modules[0],'exports',{get(){traps++;return{};}});assert.throws(verify,/MODULE_SOURCE/u);assert.equal(traps,0);
 const h=make();h.cache[h.modules[0].filename]=new Proxy(h.modules[0],{get(){traps++;}});assert.throws(()=>capture(h.root,h.cache),/MODULE_SOURCE/u);assert.equal(traps,0);
});

test('actual loader check and checkContinuity bodies reject auth descriptor mutations before root or material visits (port model, not full loader)',()=>{
 const fs=require('node:fs'),cp=require('node:child_process'),file=path.join(__dirname,'task16-current259-client-loader.cjs');
 const source=process.env.JG_TASK12_P2_LOADER_BASELINE==='1'?cp.execFileSync('git',['show','4c66040bf712e6a8833c666b7dcda71072bbb09f:services/api/prisma/task16-current259-client-loader.cjs'],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
 const checkSource=source.slice(source.indexOf(' function check(){'),source.indexOf(' function checkContinuity(')).trim(),continuitySource=source.slice(source.indexOf(' function checkContinuity('),source.indexOf(' function verifyBusinessFiles(')).trim();
 for(const body of [checkSource,continuitySource])for(const target of ['cache-getter','exports-getter','module-proxy']){
  const root='/private/tmp/actual-loader-check-body-model',cache={},names=['database/task12-auth-transaction-phase.js','auth/auth-rate-limit.service.js','database/task12-auth-error-diagnostic.js'],modules=names.map(name=>({filename:path.join(root,'services/api/dist',name),loaded:true,exports:{},children:[]}));
  modules[0].exports={observeTask12AuthTransaction(){},takeTask12AuthTransactionPhase(){}};modules[1].children=[modules[0]];modules[2].children=[modules[0]];for(const m of modules)cache[m.filename]=m;
  const verify=require('./task12-current261-local-lifecycle-module-proof.cjs').captureCurrent261AuthTransactionClosure(root,cache),calls=[];let traps=0;
  const context={failed:false,loading:false,coreHooksUnmodified:()=>true,Module:{_load:1},hooks:{load:1},hooksMatch:()=>true,businessIssuer(){calls.push('issuer');},checkAuthTransactionClosure:verify,
   material:{checkLight(){calls.push('material');},checkContinuity(){calls.push('material');}},need(ok){if(!ok)throw Error('MODEL_REJECT');},require:{cache},files:new Map(modules.map(m=>[m.filename,{path:m.filename,module:m,exports:m.exports}])),roots:[modules[0]],
   visitRoots(){calls.push('visit');void cache[modules[0].filename].exports;throw Error('MODEL_END_OF_ROOT_VISIT');}};
  if(target==='cache-getter')Object.defineProperty(cache,modules[0].filename,{get(){traps++;return modules[0];}});
  if(target==='exports-getter')Object.defineProperty(modules[0],'exports',{get(){traps++;return{};}});
  if(target==='module-proxy')cache[modules[0].filename]=new Proxy(modules[0],{get(){traps++;throw Error('TRAP');}});
  const check=new Function('context','with(context){return ('+body+');}')(context);assert.throws(()=>check({},{}),e=>e.code==='CURRENT259_LOADER_CHANGED');assert.equal(traps,0,target);assert.ok(!calls.includes('material')&&!calls.includes('visit'));
 }
});

test('first-owned-load phase/service baseline exists before filter load and is never adopted again',()=>{
 const api=require('./task12-current261-local-lifecycle-module-proof.cjs'),root='/private/tmp/auth-initial-closure-model',cache={};
 const phase={filename:path.join(root,'services/api/dist/database/task12-auth-transaction-phase.js'),loaded:true,exports:{observeTask12AuthTransaction(){},takeTask12AuthTransactionPhase(){}},children:[]};
 const service={filename:path.join(root,'services/api/dist/auth/auth-rate-limit.service.js'),loaded:true,exports:{},children:[phase]};cache[phase.filename]=phase;cache[service.filename]=service;
 const initial=api.captureCurrent261AuthTransactionBaseClosure(root,cache);initial();
 const filter={filename:path.join(root,'services/api/dist/database/task12-auth-error-diagnostic.js'),loaded:true,exports:{},children:[phase]};cache[filter.filename]=filter;
 const full=api.captureCurrent261AuthTransactionClosure(root,cache);initial();full();
 let traps=0;Object.defineProperty(phase,'exports',{get(){traps++;return{};}});assert.throws(initial,/MODULE_SOURCE/u);assert.throws(full,/MODULE_SOURCE/u);assert.equal(traps,0);
});
