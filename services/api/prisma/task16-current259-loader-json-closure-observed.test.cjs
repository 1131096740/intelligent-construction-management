"use strict";
// Host component: genuine SDK/native version and an empty Nest JSON listener.
// No AuthService, Prisma client, live issuer, PG or financial qualification.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ROOT=fs.realpathSync(process.cwd());
const {observeCurrent259Build}=require(path.join(ROOT,'services/api/prisma/task16-current259-build.cjs'));
const {loadCurrent259Client,createCurrent259OwnedApplication,current259OwnedApplicationView}=require(path.join(ROOT,'services/api/prisma/task16-current259-client-loader.cjs'));
const mode=process.env.JG_TASK16_JSON_COMPONENT_CASE??'first-json';
assert.ok(['first-json','decoder-replaced'].includes(mode));
test('sealed public JSON component retains its module graph: '+mode,async()=>{
 const loader=loadCurrent259Client(observeCurrent259Build());
 if(mode==='decoder-replaced'){
  const apiRequire=Module.createRequire(path.join(ROOT,'services/api/package.json'));
  const adapterRequire=Module.createRequire(apiRequire.resolve('@nestjs/platform-express/adapters/express-adapter'));
  const parserRequire=Module.createRequire(adapterRequire.resolve('body-parser'));
  const file=fs.realpathSync(parserRequire.resolve('iconv-lite')),codec=require.cache[file].exports;
  const slot=Object.getOwnPropertyDescriptor(codec,'getDecoder');
  Object.defineProperty(codec,'getDecoder',{...slot,value:function foreignDecoderMustNotRun(){assert.fail('foreign decoder ran');}});
  const reject=()=>assert.throws(()=>loader.check(),error=>error.code==='CURRENT259_LOADER_CHANGED');
  try{reject();}finally{Object.defineProperty(codec,'getDecoder',slot);}
  reject();return; // Restoring the descriptor cannot revive the failed lease.
 }
 const testing=await loader.createTestingModule({imports:[]}).compile();let api;
 try{
  api=current259OwnedApplicationView(createCurrent259OwnedApplication(testing));
  await api.init();await api.listen(0,'127.0.0.1');
  const address=api.getHttpServer().address();assert.equal(address.address,'127.0.0.1');
  loader.check();
  const runtimeRoots=['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'].map(p=>path.join(ROOT,p));
  const belongs=file=>runtimeRoots.some(root=>file===root||file.startsWith(root+path.sep));
  const before=new Map(Object.entries(require.cache).filter(([file])=>belongs(file)).map(([file,mod])=>[file,{mod,exports:mod.exports,children:new Set(mod.children)}]));
  const response=await fetch('http://127.0.0.1:'+address.port+'/component-json-probe',{method:'POST',headers:{'content-type':'application/json','connection':'close'},body:'{"component":"fictitious"}'});
  await response.arrayBuffer();assert.equal(response.status,404); // No business route was registered.
  assert.deepEqual(Object.keys(require.cache).filter(file=>belongs(file)&&!before.has(file)),[],'a legitimate first JSON body must not extend the sealed runtime graph');
  for(const [file,row]of before){
   assert.equal(require.cache[file],row.mod);assert.equal(row.mod.exports,row.exports);
   assert.deepEqual([...row.mod.children].filter(child=>!row.children.has(child)),[],'no new child beneath '+path.relative(ROOT,file));
  }
  loader.check();
 }finally{if(api)await api.close();await testing.close();}
});
