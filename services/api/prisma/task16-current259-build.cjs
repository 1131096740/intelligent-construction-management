"use strict";
const {assertCurrent259BusinessIssuer:businessIssuer,checkCurrent259FileIdentity}=require('./task16-current259-business-continuity.cjs');
// Observes source/build bytes on this host. Never constructs a DB client, starts
// a resource, invokes a supplied builder or issues native/business authority.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process'),{types}=require('node:util');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const ROOT=path.resolve(__dirname,'../../..');
const TREES=['node_modules','services/api/node_modules','packages/shared-domain/node_modules','services/api/dist','packages/shared-domain/dist'];
const APP=['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'];
const KEYS=['Task16RegisteredApplicationModule','PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi','Test'];
const ENGINE='605197351a3c8bdd595af2d2a9bc3025bca48ea2';
const SOURCE_SCHEMA='60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4';
// Exact output observed from local Prisma5.22 generation of the fixed6038 source;
// this is a new generated-schema pair, not a relaxed formatting equivalence.
const GENERATED_SCHEMA='0c385cd1e964674c1510b916cff78601111dc1a0e72adc8ece928c9f4ffb7eb3';
const handles=new WeakMap(),claims=new WeakSet();
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const identity=stat=>Object.fromEntries(['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'].map(k=>[k,String(stat[k])]));
function file(file){
 const before=fs.lstatSync(file,{bigint:true});need(before.isFile()&&!before.isSymbolicLink()&&before.size<=128n*1024n*1024n,'CURRENT259_BUILD_FILE');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const opened=identity(fs.fstatSync(fd,{bigint:true}));need(JSON.stringify(opened)===JSON.stringify(identity(before)),'CURRENT259_BUILD_FILE');
  const bytes=fs.readFileSync(fd);need(JSON.stringify(opened)===JSON.stringify(identity(fs.fstatSync(fd,{bigint:true})))&&JSON.stringify(opened)===JSON.stringify(identity(fs.lstatSync(file,{bigint:true}))),'CURRENT259_BUILD_FILE');
  return {path:file,sha256:hash(bytes),identity:Object.freeze(opened),bytes};
 }finally{fs.closeSync(fd);}
}
const descriptor=row=>Object.freeze({path:row.path,sha256:row.sha256,identity:row.identity});
function environment(){
 need(!['NODE_OPTIONS','NODE_PATH','DATABASE_URL','PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_QUERY_ENGINE_BINARY','PRISMA_SCHEMA_ENGINE_BINARY','PRISMA_CLIENT_ENGINE_TYPE','PRISMA_CLI_QUERY_ENGINE_TYPE'].some(k=>process.env[k]!==undefined),'CURRENT259_BUILD_ENVIRONMENT');
 need(!(process._preload_modules?.length)&&!process.execArgv.some(v=>v.startsWith('--preserve-symlinks')),'CURRENT259_BUILD_ENVIRONMENT');
 for(const name of ['.env','services/api/.env','services/api/prisma/.env'])need(!fs.existsSync(path.join(ROOT,name)),'CURRENT259_BUILD_ENVIRONMENT');
}
function git(...args){return execFileSync('/usr/bin/git',['--no-replace-objects',...args],{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'}});}
function source(){
 need(fs.realpathSync(ROOT)===ROOT&&git('rev-parse','--show-toplevel').trim()===ROOT&&git('status','--porcelain')==='','CURRENT259_BUILD_SOURCE_NOT_CLEAN');
 const sha=git('rev-parse','HEAD').trim(),format=git('rev-parse','--show-object-format').trim();need(format==='sha1'||format==='sha256','CURRENT259_BUILD_SOURCE');
 const rows=git('ls-tree','-r','-z','HEAD').split('\0').filter(Boolean).map(line=>{
  const [meta,name]=line.split('\t'),[mode,type,oid]=meta.split(' ');need(type==='blob'&&['100644','100755'].includes(mode)&&name&&!path.isAbsolute(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'CURRENT259_BUILD_SOURCE');
  const row=file(path.join(ROOT,name));need(fs.realpathSync(row.path)===row.path&&Boolean(Number(row.identity.mode)&0o111)===(mode==='100755'),'CURRENT259_BUILD_SOURCE');
  need(createHash(format).update(`blob ${row.bytes.length}\0`).update(row.bytes).digest('hex')===oid,'CURRENT259_BUILD_SOURCE');
  return Object.freeze({path:name,mode,oid,sha256:row.sha256,identity:row.identity});
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 need(rows.length>0&&rows.length<=20000&&git('rev-parse','HEAD').trim()===sha,'CURRENT259_BUILD_SOURCE');
 const sourceSeal=hash(JSON.stringify(rows.map(({path,mode,oid,sha256})=>({path,mode,oid,sha256}))));
 const migrations=rows.filter(r=>r.path.startsWith('services/api/prisma/migrations/')&&r.path.endsWith('/migration.sql'));
 const schema=rows.find(r=>r.path==='services/api/prisma/schema.prisma');need(schema?.sha256===SOURCE_SCHEMA,'CURRENT259_BUILD_SCHEMA');
 const profile=qualifyCurrent259Source({candidateSha:sha,sealSha256:sourceSeal,schemaSha256:schema.sha256,migrations});
 return {sha,rows,profile,tree:git('rev-parse','HEAD^{tree}').trim()};
}
function tree(relative){
 const root=path.join(ROOT,relative);need(fs.realpathSync(root)===root&&fs.lstatSync(root).isDirectory(),'CURRENT259_BUILD_TREE');
 const entries=[],files=[];let count=0,total=0;
 function walk(p){
  need(++count<=100000,'CURRENT259_BUILD_TREE_BUDGET');const s=fs.lstatSync(p,{bigint:true});
  need(s.uid===BigInt(process.getuid())&&(s.isSymbolicLink()||(Number(s.mode)&0o022)===0),'CURRENT259_BUILD_TREE_PERMISSIONS');
  const row={path:path.relative(root,p)||'.',identity:identity(s)};
  if(s.isSymbolicLink()){
   const target=fs.readlinkSync(p),resolved=fs.realpathSync(p);need(inside(ROOT,resolved),'CURRENT259_BUILD_LINK_ESCAPES');
   entries.push({...row,kind:'link',target,resolved});
  }else if(s.isDirectory()){
   const children=fs.readdirSync(p).sort();for(const child of children)walk(path.join(p,child));
   need(JSON.stringify(children)===JSON.stringify(fs.readdirSync(p).sort())&&JSON.stringify(identity(s))===JSON.stringify(identity(fs.lstatSync(p,{bigint:true}))),'CURRENT259_BUILD_TREE_CHANGED');
   entries.push({...row,kind:'dir'});
  }else{
   const captured=file(p);total+=captured.bytes.length;need(total<=2*1024*1024*1024,'CURRENT259_BUILD_TREE_BUDGET');
   files.push(descriptor(captured));entries.push({...row,kind:'file',sha256:captured.sha256});
  }
 }
 walk(root);return {root,relative,entries,files,digest:hash(JSON.stringify(entries)),bytes:total};
}
function resolveAt(name,base){const entry=fs.realpathSync(Module.createRequire(path.join(base,'package.json')).resolve(name));need(inside(ROOT,entry),'CURRENT259_BUILD_LINK_ESCAPES');return entry;}
function observeCurrent259Build(){
 need(arguments.length===0,'CURRENT259_BUILD_ARGUMENTS');environment();const initialSource=source(),trees=TREES.map(tree),members=new Map();
 for(const row of initialSource.rows)members.set(path.join(ROOT,row.path),Object.freeze({path:path.join(ROOT,row.path),sha256:row.sha256,identity:row.identity}));
 for(const t of trees)for(const f of t.files)members.set(f.path,f);
 function capture(p){
  need(typeof p==='string'&&inside(ROOT,p)&&fs.realpathSync(p)===p&&members.has(p),'CURRENT259_BUILD_UNSEALED_MODULE');
  const expected=members.get(p),actual=file(p);need(expected.sha256===actual.sha256&&JSON.stringify(expected.identity)===JSON.stringify(actual.identity),'CURRENT259_BUILD_CHANGED');return descriptor(actual);
 }
 const api=path.join(ROOT,'services/api'),clientEntry=resolveAt('@prisma/client',api),generated=path.resolve(path.dirname(clientEntry),'../../.prisma/client');
 capture(clientEntry);need(/\/node_modules\/@prisma\/client\/default\.js$/u.test(clientEntry),'CURRENT259_BUILD_SDK');
 const generatedSchema=capture(path.join(generated,'schema.prisma')),index=capture(path.join(generated,'index.js'));
 need(generatedSchema.sha256===GENERATED_SCHEMA,'CURRENT259_BUILD_GENERATED_SCHEMA');
 const text=file(index.path).bytes.toString('utf8'),matches=[...text.matchAll(/(?:^|\n)const config = (\{[\s\S]*?\n\})\n/gu)];need(matches.length===1,'CURRENT259_BUILD_SDK_CONFIG');
 const config=JSON.parse(matches[0][1]);
 need(config.clientVersion==='5.22.0'&&config.engineVersion===ENGINE&&config.copyEngine===true&&config.activeProvider==='postgresql'
  &&JSON.stringify(config.datasourceNames)===JSON.stringify(['db'])&&config.inlineDatasources?.db?.url?.fromEnvVar==='DATABASE_URL'&&config.inlineDatasources.db.url.value===null
  &&config.generator?.sourceFilePath===path.join(ROOT,'services/api/prisma/schema.prisma')&&config.generator?.output?.value===path.dirname(clientEntry)
  &&hash(config.inlineSchema)===GENERATED_SCHEMA,'CURRENT259_BUILD_SDK_CONFIG');
 const normalizedConfig=structuredClone(config);normalizedConfig.generator.sourceFilePath='<CURRENT259_SCHEMA>';normalizedConfig.generator.output.value='<CURRENT259_CLIENT>';
 need(hash(text.replace(matches[0][1],JSON.stringify(normalizedConfig,null,2)))==='76f06d6bfbf598cc4a3189937f16684f0897d6d26312f48ca38d711b3a9b3f8f','CURRENT259_BUILD_GENERATED_CODE');
 need(process.platform==='darwin'&&process.arch==='arm64'&&config.generator.binaryTargets?.length===1&&config.generator.binaryTargets[0].native===true&&config.generator.binaryTargets[0].value==='darwin-arm64','CURRENT259_BUILD_HOST_ENGINE');
 const engineName='libquery_engine-darwin-arm64.dylib.node',engine=capture(path.join(generated,engineName));
 const prismaPackage=resolveAt('prisma/package.json',api),enginePackage=resolveAt('@prisma/engines/package.json',path.dirname(prismaPackage)),toolEngine=capture(path.join(path.dirname(enginePackage),engineName));
 const engineBytes=file(engine.path).bytes;need(engine.sha256===toolEngine.sha256&&engineBytes.readUInt32LE(0)===0xfeedfacf&&engineBytes.readUInt32LE(4)===0x100000c,'CURRENT259_BUILD_HOST_ENGINE');
 const entries=APP.map(p=>capture(path.join(api,'dist',p)));entries.push(capture(resolveAt('@nestjs/testing/test',api)));
 const node=descriptor(file(fs.realpathSync(process.execPath)));
 let broken=false;
 function checkLight(){
  need(!broken,'CURRENT259_BUILD_CHANGED');try{
   environment();for(const p of [clientEntry,generatedSchema.path,index.path,engine.path,toolEngine.path,...entries.map(r=>r.path)])capture(p);
   const current=file(node.path);need(current.sha256===node.sha256&&JSON.stringify(current.identity)===JSON.stringify(node.identity),'CURRENT259_BUILD_TOOL_CHANGED');
  }catch{broken=true;throw fault('CURRENT259_BUILD_CHANGED');}
 }
 function check(){
  checkLight();try{
   const currentSource=source();need(JSON.stringify(currentSource)===JSON.stringify(initialSource),'CURRENT259_BUILD_SOURCE_CHANGED');
   for(const t of trees)need(tree(t.relative).digest===t.digest,'CURRENT259_BUILD_TREE_CHANGED');
  }catch{broken=true;throw fault('CURRENT259_BUILD_CHANGED');}
 }
 const summary=Object.freeze({node:Object.freeze({path:node.path,sha256:node.sha256,version:process.version,openssl:process.versions.openssl}),trees:Object.freeze(trees.map(t=>Object.freeze({root:t.relative,digest:t.digest,entries:t.entries.length,bytes:t.bytes}))),sdk:Object.freeze({clientVersion:config.clientVersion,engineVersion:config.engineVersion,copyEngineObserved:config.copyEngine,sourceSchemaSha256:SOURCE_SCHEMA,generatedSchemaSha256:generatedSchema.sha256,normalizedIndexSha256:'76f06d6bfbf598cc4a3189937f16684f0897d6d26312f48ca38d711b3a9b3f8f',engineSha256:engine.sha256})});
 function checkContinuity(token,ownedHandle){
  try{
   businessIssuer(token,ownedHandle);need(!broken,'CURRENT259_BUILD_CHANGED');environment();
   for(const p of [clientEntry,generatedSchema.path,index.path,engine.path,toolEngine.path,...entries.map(r=>r.path)])checkCurrent259FileIdentity(p,members.get(p).identity);
   checkCurrent259FileIdentity(node.path,node.identity);
  }catch(error){broken=true;throw error;}
 }
 const view=Object.freeze({root:ROOT,source:Object.freeze({candidateSha:initialSource.sha,tree:initialSource.tree,sourceSealSha256:initialSource.profile.sealSha256,profile:initialSource.profile}),summary,clientEntry,generatedIndex:index.path,engine,applicationEntries:Object.freeze(entries),keys:Object.freeze(KEYS.slice()),capture,checkLight,check,checkContinuity});
 check();const handle=Object.freeze({kind:'OBSERVED_CURRENT259_HOST_BUILD',executionAllowed:false});handles.set(handle,view);return handle;
}
function claimCurrent259Build(handle){
 need(handle&&!types.isProxy(handle)&&handles.has(handle)&&!claims.has(handle),'CURRENT259_BUILD_HANDLE');claims.add(handle);
 const material=handles.get(handle);material.check();return material;
}
module.exports=Object.freeze({observeCurrent259Build,claimCurrent259Build});
