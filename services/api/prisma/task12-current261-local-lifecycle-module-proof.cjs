'use strict';
// A pure consistency predicate. The real loader must still capture every module
// and verify its bytes against its original source/build witness.
const path=require('node:path'),{types}=require('node:util');
const need=ok=>{if(!ok)throw new Error('CURRENT261_LOCAL_LIFECYCLE_MODULE_SOURCE');};
const own=(v,k)=>{need(v&&typeof v==='object'&&!types.isProxy(v));const d=Object.getOwnPropertyDescriptor(v,k);need(d&&Object.hasOwn(d,'value'));return d.value;};
const entries=Object.freeze({sample:'services/api/dist/contract-document/task12-official-qualification-sample.js',profile:'services/api/prisma/task12-official-document-profile.cjs',child:'services/api/prisma/task12-official-document-child.cjs',
 context:'services/api/prisma/task12-document-context.cjs',runtime:'services/api/prisma/task12-current259-generated-document-runtime.cjs',
 converter:'services/api/dist/contract-document/contract-body-pdf-converter.js',lo:'services/api/dist/contract-document/libreoffice-converter.js'});
const functions=Object.freeze({sample:['createOfficialQualificationSample','canonicalOfficialQualificationDocx'],profile:['currentOfficialDocumentScope'],child:['createOfficialDocumentChildBudget','attachPostcheck'],
 context:['createDocumentContextAuthority'],runtime:['verifyOfficialTask12DocumentRuntime','withOfficialTask12DocumentRuntime']});
function assertCurrent261LocalLifecycleToolClosure(root,modules,cache){
 need(arguments.length===3&&typeof root==='string'&&path.isAbsolute(root)&&path.normalize(root)===root);
 for(const [key,name]of Object.entries(entries)){
  const mod=own(modules,key),file=path.join(root,name);need(own(mod,'filename')===file&&own(mod,'loaded')===true&&own(cache,file)===mod);
  const exports=own(mod,'exports');for(const exportName of functions[key]??[])need(typeof own(exports,exportName)==='function');
 }
 const children=mod=>{const rows=own(mod,'children');need(Array.isArray(rows)&&!types.isProxy(rows));return Array.from({length:rows.length},(_,i)=>own(rows,String(i)));};
 for(const key of ['converter','lo'])for(const dependency of ['profile','child'])need(children(own(modules,key)).filter(m=>m===own(modules,dependency)).length===1);
 need(children(own(modules,'profile')).filter(m=>m===own(modules,'context')).length===1);
 const visited=new Set();
 const reaches=mod=>{if(mod===own(modules,'profile'))return true;if(visited.has(mod))return false;visited.add(mod);need(visited.size<=1000);return children(mod).some(reaches);};
 need(reaches(own(modules,'runtime')));
}
module.exports=Object.freeze({assertCurrent261LocalLifecycleToolClosure});
