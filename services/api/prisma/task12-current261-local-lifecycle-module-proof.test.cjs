'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
function model(){
 const root='/private/tmp/local-lifecycle-model-source',cache=Object.create(null),names={
  profile:'services/api/prisma/task12-official-document-profile.cjs',child:'services/api/prisma/task12-official-document-child.cjs',context:'services/api/prisma/task12-document-context.cjs',
  sample:'services/api/dist/contract-document/task12-official-qualification-sample.js',runtime:'services/api/prisma/task12-current259-generated-document-runtime.cjs',converter:'services/api/dist/contract-document/contract-body-pdf-converter.js',lo:'services/api/dist/contract-document/libreoffice-converter.js'};
 const modules=Object.fromEntries(Object.entries(names).map(([key,name])=>{const m={filename:path.join(root,name),loaded:true,exports:{},children:[]};cache[m.filename]=m;return[key,m];}));
 modules.sample.exports.createOfficialQualificationSample=()=>{};modules.sample.exports.canonicalOfficialQualificationDocx=()=>{};
 modules.profile.exports.currentOfficialDocumentScope=()=>{};modules.child.exports.createOfficialDocumentChildBudget=()=>{};modules.child.exports.attachPostcheck=()=>{};modules.context.exports.createDocumentContextAuthority=()=>{};
 modules.runtime.exports.verifyOfficialTask12DocumentRuntime=()=>{};modules.runtime.exports.withOfficialTask12DocumentRuntime=()=>{};
 modules.profile.children.push(modules.context);modules.runtime.children.push(modules.profile);
 for(const key of ['converter','lo'])modules[key].children.push(modules.profile,modules.child);
 return {root,cache,modules};
}
test('life module closure requires the actual converter and LO to share the same host context and official issuer',()=>{
 const {assertCurrent261LocalLifecycleToolClosure:check}=require('./task12-current261-local-lifecycle-module-proof.cjs');
 const f=model();assert.equal(check(f.root,f.modules,f.cache),undefined);
 for(const patch of [g=>{delete g.modules.sample.exports.canonicalOfficialQualificationDocx;},g=>{g.modules.sample.filename='/foreign/sample.js';},g=>{g.modules.converter.children=[];},g=>{g.modules.lo.children=[{...g.modules.profile},g.modules.child];},
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
