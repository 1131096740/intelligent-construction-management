#!/usr/bin/env node
'use strict';
// Fixed Task12 inside/equipment host-native comparison. No payment case, Docker, relay or old admission token.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {types,isDeepStrictEqual:equal}=require('node:util');
const ROOT=path.resolve(__dirname,'../../..'),PURPOSE='TASK12_NATIVE_EQUIPMENT_FULL261_V1';
// Root's independently reviewed official16.15/pgcrypto93-file qualification.
const BINARY_QUALIFICATION_SHA='26e93f289366a2f9c60c61b9035849052d59509d54f2c388cbdf7c419d3663a1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code='NATIVE_DIRECT_INPUT')=>{if(!value)fail(code);};
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$','u').test(v);
function fixed(value,keys){need(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);return Object.fromEntries(keys.map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'));return [key,d.value];}));}
function capture(file,max=16*1024*1024){
 need(typeof file==='string'&&path.isAbsolute(file)&&path.normalize(file)===file&&fs.realpathSync(file)===file);
 let cursor='/';for(const part of file.slice(1).split('/')){cursor=path.join(cursor,part);need(!fs.lstatSync(cursor).isSymbolicLink());}
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const a=fs.fstatSync(fd,{bigint:true});need(a.isFile()&&a.size<=BigInt(max)&&a.uid===BigInt(file==='/usr/bin/security'?0:process.getuid())&&(a.mode&0o022n)===0n);
  const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd,{bigint:true}),c=fs.lstatSync(file,{bigint:true});const identity=Object.fromEntries(['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs'].map(k=>[k,String(a[k])]));
  need(bytes.length===Number(a.size)&&Object.keys(identity).every(k=>String(b[k])===identity[k]&&String(c[k])===identity[k]));return {sha256:hash(bytes),identity,bytes};
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function directory(file,empty=false){need(typeof file==='string'&&file.startsWith('/private/tmp/')&&file.length<70&&fs.realpathSync(file)===file);const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700&&(!empty||fs.readdirSync(file).length===0));return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,s[k]]));}
function writeNew(root,name,value){need(path.basename(name)===name);const file=path.join(root,name),bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)+'\n');const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(root,fs.constants.O_RDONLY);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return {file,sha256:hash(bytes),bytes:bytes.length};}
function git(args){return execFileSync('/usr/bin/git',args,{cwd:ROOT,encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000,maxBuffer:4*1024*1024}).trim();}
function sourceCapture(){
 need(git(['status','--porcelain'])==='','NATIVE_DIRECT_SOURCE_DIRTY');
 const head=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
 const capturedFiles=git(['ls-files','-z']).split('\0').filter(Boolean).map(relative=>({relative,...capture(path.join(ROOT,relative))})),capturedByPath=new Map(capturedFiles.map(row=>[row.relative,row]));
 const files=capturedFiles.map(({relative,sha256})=>({relative,sha256})),objectFormat=git(['rev-parse','--show-object-format']);need(['sha1','sha256'].includes(objectFormat),'NATIVE_DIRECT_SOURCE');
 const migrationFiles=files.filter(row=>/^services\/api\/prisma\/migrations\/\d{14}_[a-z0-9_]+\/migration.sql$/u.test(row.relative));need(migrationFiles.length===261);
 const sourceRows=git(['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean).map(row=>{const [meta,relative]=row.split('\t'),[mode,type,oid]=meta.split(' ');need(type==='blob'&&['100644','100755'].includes(mode),'NATIVE_DIRECT_SOURCE');const observed=capturedByPath.get(relative);need(observed&&Boolean(Number(observed.identity.mode)&0o111)===(mode==='100755')&&createHash(objectFormat).update('blob '+observed.bytes.length+'\0').update(observed.bytes).digest('hex')===oid,'NATIVE_DIRECT_SOURCE');return {path:relative,mode,oid,sha256:observed.sha256};}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const code={candidateSha:head,sealSha256:hash(Buffer.from(JSON.stringify(sourceRows))),schemaSha256:capture(path.join(__dirname,'schema.prisma')).sha256,migrations:migrationFiles.map(row=>({path:row.relative,sha256:row.sha256}))};
 const profile=require('./task16-current259-profile.cjs').qualifyCurrent259Source(code);
 return {head,tree,files,code,witness:{candidateSha:head,sourceSealSha256:code.sealSha256,profile}};
}
function treeFiles(root,allowed=root){
 const result=[],visited=new Set();
 const visit=dir=>{const real=fs.realpathSync(dir);need(real===allowed||real.startsWith(allowed+'/'));if(visited.has(real))return;visited.add(real);
  for(const row of fs.readdirSync(real,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const lexical=path.join(real,row.name);let file=lexical;
   if(row.isSymbolicLink()){file=fs.realpathSync(lexical);need(file===allowed||file.startsWith(allowed+'/'));const st=fs.lstatSync(lexical,{bigint:true});result.push({link:lexical,target:fs.readlinkSync(lexical),identity:Object.fromEntries(['dev','ino','mode','uid','gid','mtimeNs','ctimeNs'].map(k=>[k,String(st[k])]))});}
   const stat=fs.lstatSync(file);if(stat.isDirectory())visit(file);else {need(stat.isFile());const c=capture(file,64*1024*1024);result.push({file,sha256:c.sha256,identity:c.identity});}
  }
 };visit(root);return result;
}
function dependencyDigest(){const rows=['node_modules','services/api/node_modules','packages/shared-domain/node_modules'].flatMap(relative=>treeFiles(path.join(ROOT,relative),ROOT));return {sha256:hash(Buffer.from(JSON.stringify(rows))),entries:rows.length};}
function compiledMaterials(){return [...treeFiles(path.join(ROOT,'services/api/dist')),...treeFiles(path.join(ROOT,'packages/shared-domain/dist'))];}

function nativeTask12ToolRoot(root,unused){
 need(typeof root==='string'&&path.isAbsolute(root)&&path.normalize(root)===root&&fs.realpathSync(root)===root,'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 const stat=fs.lstatSync(root);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700&&(!unused||fs.readdirSync(root).length===0),'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 return Object.fromEntries(['dev','ino','mode','uid','gid'].map(key=>[key,stat[key]]));
}
function validateNativeTask12EquipmentPlan(value){
 const p=fixed(value,['schemaVersion','purpose','runId','database','runRoot','rootIdentity','source','artifacts','dependencies','prismaTools','interfaces','binaryManifest','binaries','openssl','externalLibraries','node','security','limits','differences','officialRuntime']);
 need(p.schemaVersion===3&&p.purpose===PURPOSE&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(p.runId)&&p.database==='jg_task01_'+p.runId.replaceAll('-',''));
 need(equal(fixed(p.limits,['resourceMs','migrationMs','ownerSqlMs','httpMs','commandBytes','ownerSqlBytes']),{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216}));
 const runtime=fixed(p.officialRuntime,['path','sha256','toolRoot','toolRootIdentity']);need(typeof runtime.path==='string'&&path.isAbsolute(runtime.path)&&hex(runtime.sha256,64)&&typeof runtime.toolRoot==='string'&&path.isAbsolute(runtime.toolRoot));
 need(/^\/private\/tmp\/jg-native-contract-[a-zA-Z0-9_-]{1,32}$/u.test(p.runRoot));
 need(equal(directory(p.runRoot),p.rootIdentity));return p;
}
function prepareNativeTask12EquipmentPlan(options){
 need(process.version==='v20.20.2'&&process.platform==='darwin'&&process.arch==='arm64','NATIVE_DIRECT_RUNTIME');
 const o=fixed(options,['runRoot','binaryManifest','binaryManifestSha256','officialRuntimeInput','officialRuntimeSha256','output']);directory(o.runRoot,true);need(path.dirname(o.output)===o.runRoot&&path.basename(o.output)==='plan.json'&&hex(o.binaryManifestSha256,64));
 need(o.binaryManifestSha256===BINARY_QUALIFICATION_SHA,'NATIVE_DIRECT_BINARY_APPROVAL');
 const manifest=capture(o.binaryManifest,1024*1024);need(manifest.sha256===o.binaryManifestSha256);const qualified=JSON.parse(manifest.bytes);
 need(qualified.version==='16.15'&&qualified.versionObserved==='postgres (PostgreSQL) 16.15'&&typeof qualified.privatePrefix==='string');
 const binaries=treeFiles(qualified.privatePrefix);
 for(const [relative,expected]of Object.entries(qualified.files??{})){const actual=binaries.find(row=>row.file===path.join(qualified.privatePrefix,relative));need(actual&&actual.sha256===expected.sha256&&Number(actual.identity.size)===expected.bytes&&nativeTask16QualifiedModeMatches(actual.identity.mode,expected.mode)&&['dev','ino','uid','gid','mtimeNs','ctimeNs'].every(key=>actual.identity[key]===String(expected[key])),'NATIVE_DIRECT_BINARY_QUALIFICATION');}
 need(binaries.some(row=>row.file?.endsWith('/lib/postgresql/pgcrypto.dylib'))&&binaries.some(row=>row.file?.endsWith('/share/postgresql/extension/pgcrypto.control')),'NATIVE_DIRECT_PGCRYPTO_REQUIRED');
 const required=['postgres','initdb','pg_isready','psql'];need(required.every(name=>binaries.some(row=>row.file===path.join(qualified.privatePrefix,'bin',name))));
 const opensslFile=fs.realpathSync('/opt/homebrew/opt/openssl@3/bin/openssl'),openssl=capture(opensslFile,64*1024*1024);
 const externalLibraries=Object.entries(qualified.externalLibraries??{}).map(([file,expected])=>{const actual=capture(file,64*1024*1024);need(actual.sha256===expected.sha256&&Number(actual.identity.size)===expected.bytes&&nativeTask16QualifiedModeMatches(actual.identity.mode,expected.mode)&&['dev','ino','uid','gid','mtimeNs','ctimeNs'].every(key=>actual.identity[key]===String(expected[key])),'NATIVE_DIRECT_EXTERNAL_LIBRARY');return {file,sha256:actual.sha256,identity:actual.identity};});need(externalLibraries.length===2,'NATIVE_DIRECT_EXTERNAL_LIBRARY');
 const prismaTools=resolveNativeTask16PrismaTools(),interfaces=resolveNativeTask16Interfaces();
 const nodeFile=fs.realpathSync(process.execPath),nodeCapture=capture(nodeFile,128*1024*1024);
 const runtimeCapture=capture(o.officialRuntimeInput,1048576);need(runtimeCapture.sha256===o.officialRuntimeSha256,'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 const runtimePublication=require('./task12-official-document-profile.cjs').observeOfficialTask12DocumentPublication(o.officialRuntimeInput,o.officialRuntimeSha256);
 const runtimeInput=JSON.parse(runtimeCapture.bytes);need(typeof runtimeInput.runRoot==='string','NATIVE_DIRECT_OFFICIAL_RUNTIME');
 const runId=randomUUID(),p={schemaVersion:3,purpose:PURPOSE,runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:o.runRoot,rootIdentity:directory(o.runRoot),source:sourceCapture(),artifacts:compiledMaterials(),dependencies:dependencyDigest(),prismaTools,interfaces,binaryManifest:{file:o.binaryManifest,sha256:manifest.sha256,identity:manifest.identity},binaries,openssl:{file:opensslFile,sha256:openssl.sha256,identity:openssl.identity},externalLibraries,node:{file:nodeFile,sha256:nodeCapture.sha256,identity:nodeCapture.identity,version:process.version,platform:process.platform,arch:process.arch},security:captureNativeTask16Security(),limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},officialRuntime:{path:o.officialRuntimeInput,sha256:o.officialRuntimeSha256,toolRoot:runtimeInput.runRoot,toolRootIdentity:nativeTask12ToolRoot(runtimeInput.runRoot,true)},differences:['Real Task12 full261/inside equipment; original document role SQL and Me/PDF case','V2 controlled name policy evidence; SDK direct cause remains unproven','macOS native PG16.15/OpenSSL3/C locale/noICU','Real Task12 Nest/Me/document role providers; native purpose, no old F resource/admission brands','No Docker CPU/memory/pids/tmpfs enforcement equivalent']};
 need(runtimePublication.source.head===p.source.head,'NATIVE_DIRECT_OFFICIAL_RUNTIME');validateNativeTask12EquipmentPlan(p);return writeNew(o.runRoot,'plan.json',p);
}
function verifyNativeTask12EquipmentPlan(file,expected){
 need(process.version==='v20.20.2'&&process.platform==='darwin'&&process.arch==='arm64','NATIVE_DIRECT_RUNTIME');
 need(hex(expected,64));const saved=capture(file,4*1024*1024);need(saved.sha256===expected);const p=validateNativeTask12EquipmentPlan(JSON.parse(saved.bytes));
 need(file===path.join(p.runRoot,'plan.json')&&equal(sourceCapture(),p.source),'NATIVE_DIRECT_SOURCE_CHANGED');
 need(capture(p.officialRuntime.path,1048576).sha256===p.officialRuntime.sha256,'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 const publication=require('./task12-official-document-profile.cjs').observeOfficialTask12DocumentPublication(p.officialRuntime.path,p.officialRuntime.sha256);need(publication.source.head===p.source.head&&JSON.parse(capture(p.officialRuntime.path,1048576).bytes).runRoot===p.officialRuntime.toolRoot,'NATIVE_DIRECT_OFFICIAL_RUNTIME');need(equal(nativeTask12ToolRoot(p.officialRuntime.toolRoot,true),p.officialRuntime.toolRootIdentity),'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 need(p.binaryManifest.sha256===BINARY_QUALIFICATION_SHA,'NATIVE_DIRECT_BINARY_APPROVAL');
 const qualified=JSON.parse(capture(p.binaryManifest.file,1024*1024).bytes);need(qualified.version==='16.15'&&qualified.versionObserved==='postgres (PostgreSQL) 16.15'&&equal(treeFiles(qualified.privatePrefix),p.binaries),'NATIVE_DIRECT_BINARY_APPROVAL');
 need(equal(compiledMaterials(),p.artifacts)&&equal(dependencyDigest(),p.dependencies),'NATIVE_DIRECT_MATERIAL_CHANGED');
 need(equal(captureNativeTask16Security(),p.security),'NATIVE_DIRECT_SECURITY_CHANGED');
 need(equal(resolveNativeTask16PrismaTools(),p.prismaTools)&&equal(resolveNativeTask16Interfaces(),p.interfaces),'NATIVE_DIRECT_PRISMA_OR_INTERFACE_CHANGED');
 for(const row of [...p.binaries,p.openssl,...p.externalLibraries,p.binaryManifest,p.node]){if(row.link){need(fs.readlinkSync(row.link)===row.target,'NATIVE_DIRECT_MATERIAL_CHANGED');continue;}const now=capture(row.file,128*1024*1024);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_MATERIAL_CHANGED');}
 need(p.node.file===fs.realpathSync(process.execPath)&&p.node.version===process.version&&p.node.platform===process.platform&&p.node.arch===process.arch,'NATIVE_DIRECT_RUNTIME');return p;
}
function parse(args){
 need(Array.isArray(args)&&args.every(x=>typeof x==='string'),'NATIVE_DIRECT_ARGUMENTS');
 if(args[0]==='--prepare'&&args.length===13&&args[1]==='--run-root'&&args[3]==='--binary-manifest'&&args[5]==='--expected-binary-sha256'&&args[7]==='--official-runtime-input'&&args[9]==='--expected-runtime-sha256'&&args[11]==='--output')return {mode:'prepare',options:{runRoot:args[2],binaryManifest:args[4],binaryManifestSha256:args[6],officialRuntimeInput:args[8],officialRuntimeSha256:args[10],output:args[12]}};
 if(['--verify','--once'].includes(args[0])&&args.length===5&&args[1]==='--plan'&&args[3]==='--expected-plan-sha256')return {mode:args[0].slice(2),file:args[2],sha256:args[4]};
 fail('NATIVE_DIRECT_ARGUMENTS');
}
function nativeDirectoryBytes(root){let bytes=0,count=0;const visit=dir=>{for(const row of fs.readdirSync(dir,{withFileTypes:true})){need(++count<=10000,'NATIVE_DIRECT_DIRECTORY_COUNT');const file=path.join(dir,row.name),st=fs.lstatSync(file);need(!st.isSymbolicLink(),'NATIVE_DIRECT_DIRECTORY_LINK');if(st.isDirectory())visit(file);else if(st.isFile())bytes+=st.size;need(bytes<=512*1024*1024,'NATIVE_DIRECT_DIRECTORY_BYTES');}};visit(root);return bytes;}
const {waitNativeTask16Operation,trackNativeTask16Child,captureNativeTask16Security,projectNativeTask16SecurityPolicy,controlledNativeTask16NameResult,projectNativeTask16TlsWords,classifyNativeTask16TlsFailure,verifyNativeTask16LocalhostAnswers,projectNativeTask16PlaintextHba,nativeTask16QualifiedModeMatches,assertNativeTask16LogIdentity,resolveNativeTask16PrismaTools}=require('./run-task16-native-direct-once.cjs');
function inspectNativeTask16Interfaces(){
 // Fixed source-owned list, matching the original application factory/main.
 // Read exports only: never construct a client, assemble Nest, or call a route.
 const specs=[
  ['./local-staged-migration-controls.cjs',[['inspectSql',0],['setupSql',1],['checkSetup',2],['readbackSql',2],['parseReadback',1],['checkCompletion',3],['cleanupSql',2],['cleanReadSql',2]]],
  ['./local-staged-tail-qualification.cjs',[['createLocalTailQualification',2]]],
  ['./task16-current259-role-provision.cjs',[['renderNativeTask16RoleRead',2],['renderNativeTask16RoleInstall',3],['parseNativeTask16RoleRead',3]]],
  ['./task16-current259-archive-install.cjs',[['beginNativeTask12ArchiveProtocol',1]]],
  ['./task16-current259-ordinary-archive-acl.cjs',[['beginNativeTask12OrdinaryAclProtocol',1]]],
  ['./task12-current259-document-role-provision.cjs',[['beginNativeTask12DocumentRolesProtocol',1]]],
  ['./task12-current259-document-acl-transport.cjs',[['beginNativeTask12DocumentAclInstallation',1]]],
  ['./task12-current259-document-login.cjs',[['beginNativeTask12DocumentLoginProtocol',3],['nativeTask12DocumentLoginVerifiers',1],['nativeTask12DocumentClientIdentitySql','string']]],
  ['./task12-current259-q2-seed.cjs',[['createNativeCurrent261EquipmentSeed',3]]],
  ['./task12-current261-local-lifecycle-owner.cjs',[['beginNativeTask12LifecycleOwnerWindow',4],['observeCurrent261LocalLifecycleOwner',2],['installCurrent261LocalLifecycleAuditFault',1],['removeCurrent261LocalLifecycleAuditFault',1],['closeCurrent261LocalLifecycleOwnerWindow',1]]],
  ['./task12-current259-document-application.cjs',[['runNativeTask12DocumentApplication',2]]],
  ['./task12-official-document-profile.cjs',[['observeOfficialTask12DocumentPublication',2],['verifyOfficialTask12DocumentRuntime',3],['withOfficialTask12DocumentRuntime',3]]],
  ['../dist/api-security.js',[['configureApiSecurity',1]]],
  ['../dist/operating-projection/projection-export-json.js',[['configureProjectionExportJson',1]]],
  ['../dist/api-json-replacer.js',[['apiJsonReplacer',2]]],
  ['../dist/validation/api-validation.js',[['createApiValidationPipe',0]]],
  ['../dist/api-listen.js',[['listenApi',3]]],
  ['../dist/database/prisma.service.js',[['PrismaService',0]]],
  ['../dist/database/task12-generated-document-application.module.js',[['Task12GeneratedDocumentApplicationModule',0]]],
  ['../dist/database/task12-generated-document-role-services.js',[['withTask12NativeHostDocumentRoleServices',3]]],
  ['../dist/database/task12-local-lifecycle-fixture.js',[['buildTask12LocalLifecycleFixture',1],['createTask12LocalLifecycleOriginals',1],['isTask12LocalLifecycleFixture',1]]],
  ['../dist/database/task12-generated-approval-admission.js',[['hashTask12GeneratedAdmissionPassword',1]]],
  ['../dist/database/task12-local-lifecycle-case.js',[['runTask12LocalLifecycleCase',1],['expectTask12LocalLifecycleAuditRollback',1],['finishTask12LocalLifecycleCase',1],['claimTask12LocalLifecycleCheckpoint',1]]],
  ['@prisma/client',[['PrismaClient',1]]],
  ['@nestjs/testing/test.js',[['Test',0]]],
  ['@nestjs/testing',[['Test',0]]]

 ];
 return Object.freeze(specs.map(([specifier,exports])=>{
  const file=fs.realpathSync(require.resolve(specifier));need(file.startsWith(ROOT+'/'),'NATIVE_DIRECT_INTERFACE_PATH');const before=capture(file,64*1024*1024),loaded=require(specifier);
  const shapes=exports.map(([name,expected])=>{const d=Object.getOwnPropertyDescriptor(loaded,name);need(d,'NATIVE_DIRECT_INTERFACE_EXPORT');let value;if(Object.hasOwn(d,'value'))value=d.value;else {need(specifier==='@nestjs/testing'&&name==='Test'&&typeof d.get==='function'&&d.set===undefined,'NATIVE_DIRECT_INTERFACE_EXPORT');value=loaded.Test;need(value===require('@nestjs/testing/test.js').Test,'NATIVE_DIRECT_INTERFACE_EXPORT');}const kind=typeof value;need(typeof expected==='number'?kind==='function'&&value.length===expected:kind===expected,'NATIVE_DIRECT_INTERFACE_EXPORT');
   if(name==='Test'){const method=Object.getOwnPropertyDescriptor(value,'createTestingModule');need(method&&Object.hasOwn(method,'value')&&typeof method.value==='function'&&method.value.length===1,'NATIVE_DIRECT_INTERFACE_EXPORT');}
   return Object.freeze({name,kind,...(kind==='function'?{arity:value.length}:{})});});
  const after=capture(file,64*1024*1024);need(before.sha256===after.sha256&&equal(before.identity,after.identity),'NATIVE_DIRECT_INTERFACE_CHANGED');return Object.freeze({file,sha256:after.sha256,identity:after.identity,exports:Object.freeze(shapes)});
 }));
}
function resolveNativeTask16Interfaces(){
 // Discard qualification-only module state in a fixed read-only child. Actual
 // business still sets its real temporary environment before importing Nest.
 const source='const value=require('+JSON.stringify(__filename)+').inspectNativeTask16Interfaces();process.stdout.write(JSON.stringify(value));';
 let output;try{output=execFileSync(process.execPath,['-e',source],{cwd:ROOT,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1048576});}catch{fail('NATIVE_DIRECT_INTERFACE_QUALIFICATION');}
 return JSON.parse(output);
}
// Task12 does not install the payment-only SECURITY DEFINER identity helper.
// Each bootstrap pool observes itself; the separate owner witness binds the
// actual three sessions to this cluster before any certificate control/business.
const nativeTask12BootstrapIdentitySql=`SELECT pg_catalog.current_database()::text AS database,
 d.oid::text AS "databaseOid",d.datdba::text AS "ownerOid",
 current_user::text AS "effectiveRole",session_user::text AS "loginRole",
 current_user::pg_catalog.regrole::pg_catalog.oid::text AS "effectiveOid",session_user::pg_catalog.regrole::pg_catalog.oid::text AS "loginOid",
 a.pid,pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start,
 s.ssl AS tls,pg_catalog.current_setting('server_version_num')::integer AS version,
 pg_catalog.getdatabaseencoding() AS encoding,pg_catalog.current_setting('session_replication_role') AS replication,
 pg_catalog.current_setting('transaction_read_only') AS "readOnly",pg_catalog.current_setting('default_transaction_read_only') AS "defaultReadOnly",
 pg_catalog.host(pg_catalog.inet_client_addr()) AS "clientAddress",pg_catalog.inet_client_port() AS "clientPort",
 pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort",$1::text AS nonce
 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_database d ON d.oid=a.datid
 JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid WHERE a.pid=pg_catalog.pg_backend_pid()`;
function assertNativeTask12BootstrapPools(rowText,contextText){
 need(arguments.length===2&&typeof rowText==='string'&&Buffer.byteLength(rowText)<=4096&&typeof contextText==='string'&&Buffer.byteLength(contextText)<=8192,'NATIVE_DIRECT_BOOTSTRAP_POOLS');
 const row=fixed(JSON.parse(rowText),['ownerPid','tls','client','server','port','database','databaseOid','systemIdentifier','actorOid','sessionActor','rows']);
 const context=fixed(JSON.parse(contextText),['database','databaseOid','systemIdentifier','port','roles','observed']);
 const keys=['oid','role','pid','start','databaseOid','database','ssl','clientAddress','clientPort'];
 need(Number.isInteger(context.port)&&context.port>1024&&context.port<=65535&&context.port!==5432&&/^jg_task01_[a-f0-9]{32}$/u.test(context.database)&&/^[1-9][0-9]{0,19}$/u.test(context.systemIdentifier)&&Array.isArray(context.roles)&&context.roles.length===3&&context.roles.every((role,i)=>role.name==='jg_task01_'+['owner','runtime','observer'][i]&&typeof role.oid==='string'&&/^[1-9][0-9]{0,9}$/u.test(role.oid)&&(i===0?role.oid==='10':role.oid!=='10'))&&new Set(context.roles.map(role=>role.oid)).size===3,'NATIVE_DIRECT_BOOTSTRAP_POOLS');
 need(row.tls===true&&row.client==='127.0.0.1'&&row.server==='127.0.0.1'&&row.port===context.port&&row.database===context.database&&row.databaseOid===context.databaseOid&&row.systemIdentifier===context.systemIdentifier&&row.actorOid==='10'&&row.sessionActor==='jg_task01_owner'&&Number.isInteger(row.ownerPid)&&row.ownerPid>0&&Array.isArray(row.rows)&&row.rows.length===3&&Array.isArray(context.observed)&&context.observed.length===3&&Array.isArray(context.roles)&&context.roles.length===3,'NATIVE_DIRECT_BOOTSTRAP_POOLS');
 const seen=new Set();
 for(let i=0;i<3;i++){
  const expected=context.observed[i],role=context.roles[i];
  need(expected.loginRole===role.name&&expected.effectiveRole===role.name&&expected.loginOid===role.oid&&expected.effectiveOid===role.oid&&expected.database===context.database&&expected.databaseOid===context.databaseOid&&expected.ownerOid==='10'&&expected.tls===true&&expected.serverAddress==='127.0.0.1'&&expected.serverPort===context.port&&expected.clientAddress==='127.0.0.1'&&Number.isInteger(expected.pid)&&expected.pid>0&&expected.pid!==row.ownerPid&&Number.isInteger(expected.clientPort)&&expected.clientPort>0&&expected.clientPort<=65535&&typeof expected.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(expected.start),'NATIVE_DIRECT_BOOTSTRAP_POOLS');
  const found=row.rows.filter(value=>value.pid===expected.pid);need(found.length===1&&!seen.has(expected.pid),'NATIVE_DIRECT_BOOTSTRAP_POOLS');seen.add(expected.pid);
  const actual=fixed(found[0],keys);
  need(equal(actual,{oid:role.oid,role:role.name,pid:expected.pid,start:expected.start,databaseOid:context.databaseOid,database:context.database,ssl:true,clientAddress:'127.0.0.1',clientPort:expected.clientPort}),'NATIVE_DIRECT_BOOTSTRAP_POOLS');
 }
 return Object.freeze({systemIdentifier:row.systemIdentifier,source:'INDEPENDENT_OWNER_CLUSTER_AND_THREE_SESSION_READBACK',sessions:3});
}
function assertNativeTask12LoopbackListeners(text,postmasterPid,port){
 const code='NATIVE_DIRECT_LOOPBACK_LISTENERS';
 need(arguments.length===3&&typeof text==='string'&&Buffer.byteLength(text)<=1048576&&Number.isSafeInteger(postmasterPid)&&postmasterPid>0&&postmasterPid<=2147483647&&Number.isInteger(port)&&port>1024&&port<=65535&&port!==5432,code);
 const addresses=[];
 for(const line of text.split('\n')){
  const match=/^NATIVE_TASK16 \[([1-9][0-9]{0,9})\] LOG:  listening on (IPv4|IPv6) address "([^"]+)", port ([1-9][0-9]{0,4})$/u.exec(line);
  if(!match)continue;
  need(Number(match[1])===postmasterPid&&Number(match[4])===port&&((match[2]==='IPv4'&&match[3]==='127.0.0.1')||(match[2]==='IPv6'&&match[3]==='::1'))&&!addresses.includes(match[3]),code);
  addresses.push(match[3]);
 }
 need(addresses.length===2&&addresses.includes('127.0.0.1')&&addresses.includes('::1'),code);
 return Object.freeze({postmasterPid,port,addresses:Object.freeze(['127.0.0.1','::1']),ownedStartupListeners:true});
}
function assertNativeTask12DocumentPools(rowText,contextText){
 need(arguments.length===2&&typeof rowText==='string'&&Buffer.byteLength(rowText)<=4096&&typeof contextText==='string'&&Buffer.byteLength(contextText)<=8192,'NATIVE_DIRECT_DOCUMENT_POOLS');
 const row=fixed(JSON.parse(rowText),['ownerPid','tls','client','server','port','database','databaseOid','namespaceOid','systemIdentifier','actorOid','sessionActor','rows']),context=fixed(JSON.parse(contextText),['database','databaseOid','namespaceOid','systemIdentifier','port','roles','observed']);
 const {roles,observed}=context;
 need(Number.isInteger(context.port)&&context.port>1024&&context.port<=65535&&context.port!==5432&&Array.isArray(roles)&&roles.length===4&&Array.isArray(observed)&&observed.length===4&&new Set(roles.map(role=>role.oid)).size===4,'NATIVE_DIRECT_DOCUMENT_POOLS');
 const names=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'];
 need(roles.every((role,i)=>typeof role.oid==='string'&&/^[1-9][0-9]{0,9}$/u.test(role.oid)&&role.oid!=='10'&&(i<3?role.name===names[i]:/^jg_fixture_app_[a-f0-9]{24}$/u.test(role.name)))&&observed.every((value,i)=>value.oid===roles[i].oid&&value.role===roles[i].name&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value.start)),'NATIVE_DIRECT_DOCUMENT_POOLS');
 need(row.tls===true&&row.client==='127.0.0.1'&&row.server==='127.0.0.1'&&row.port===context.port&&row.database===context.database&&row.databaseOid===context.databaseOid&&row.namespaceOid===context.namespaceOid&&row.systemIdentifier===context.systemIdentifier&&row.actorOid==='10'&&row.sessionActor==='jg_task01_owner'&&Array.isArray(row.rows)&&row.rows.length>=4&&row.rows.length<=5,'NATIVE_DIRECT_DOCUMENT_POOLS');
 need(Number.isSafeInteger(row.ownerPid)&&row.ownerPid>0&&row.rows.every(value=>{fixed(value,['oid','role','pid','start','ssl','clientAddress','clientPort']);return roles.some(role=>role.oid===value.oid)&&typeof value.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value.start)&&Number.isFinite(Date.parse(value.start));})&&new Set(row.rows.map(value=>value.pid)).size===row.rows.length&&new Set(row.rows.map(value=>value.clientPort)).size===row.rows.length,'NATIVE_DIRECT_DOCUMENT_POOLS');
 for(const [i,role]of roles.entries()){
  const actual=row.rows.filter(value=>value.oid===role.oid),original=observed[i];
  need(actual.length>0&&actual.length<=(i===3?2:1)&&actual.some(value=>value.pid===original.pid&&value.start===original.start&&value.clientPort===original.clientPort)&&actual.every(value=>value.role===role.name&&value.ssl===true&&value.clientAddress==='127.0.0.1'&&value.pid!==row.ownerPid&&Number.isSafeInteger(value.pid)&&value.pid>0&&Number.isInteger(value.clientPort)&&value.clientPort>0&&value.clientPort<=65535),'NATIVE_DIRECT_DOCUMENT_POOLS');
 }
 return Object.freeze(row.rows.map(value=>Object.freeze({...value})));
}
module.exports=Object.freeze({nativeTask12BootstrapIdentitySql,assertNativeTask12BootstrapPools,assertNativeTask12DocumentPools,assertNativeTask12LoopbackListeners,captureNativeTask16Security,projectNativeTask16SecurityPolicy,controlledNativeTask16NameResult,projectNativeTask16TlsWords,inspectNativeTask16Interfaces,resolveNativeTask16PrismaTools,resolveNativeTask16Interfaces,nativeTask16QualifiedModeMatches,assertNativeTask16LogIdentity,projectNativeTask16PlaintextHba,verifyNativeTask16LocalhostAnswers,classifyNativeTask16TlsFailure,trackNativeTask16Child,waitNativeTask16Operation,prepareNativeTask12EquipmentPlan,verifyNativeTask12EquipmentPlan,validateNativeTask12EquipmentPlan});
if(require.main===module){(async()=>{let request;request=parse(process.argv.slice(2));if(request.mode==='prepare')return {status:'NATIVE_DIRECT_PREPARED_NO_RESOURCES',...prepareNativeTask12EquipmentPlan(request.options)};
 const plan=verifyNativeTask12EquipmentPlan(request.file,request.sha256);if(request.mode==='verify')return {status:'NATIVE_DIRECT_VERIFIED_NO_RESOURCES',candidateSha:plan.source.head};
 return await executeNativeTask16Once(plan,request.sha256);
})().then(result=>{process.exitCode=result.status==='STOPPED'?1:0;process.stdout.write(JSON.stringify(result)+'\n',()=>{if(process.argv[2]==='--once')process.exit(process.exitCode);});},error=>{const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;process.stdout.write(JSON.stringify({status:'REJECTED_NO_RESOURCES',code:typeof code==='string'&&/^NATIVE_DIRECT_[A-Z_]+$/u.test(code)?code:'NATIVE_DIRECT_INPUT'})+'\n');process.exitCode=1;});}

async function executeNativeTask16Once(plan,planSha256){
 need(require.main===module&&process.execArgv.length===0&&!process._preload_modules?.length&&!Object.hasOwn(process.env,'NODE_OPTIONS')&&!Object.hasOwn(process.env,'NODE_PATH'),'NATIVE_DIRECT_FRESH_MAIN');
 need(equal(fs.readdirSync(plan.runRoot).sort(),['plan.json']),'NATIVE_DIRECT_ROOT_NOT_UNUSED');
 need(equal(nativeTask12ToolRoot(plan.officialRuntime.toolRoot,true),plan.officialRuntime.toolRootIdentity),'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 writeNew(plan.runRoot,'started.json',{purpose:PURPOSE,planSha256,candidateSha:plan.source.head,startedAt:new Date().toISOString(),pid:process.pid});
 const {spawn}=require('node:child_process');
 const root=plan.runRoot,runId=plan.runId,db=plan.database,prefix=path.dirname(path.dirname(plan.binaries.find(row=>row.file?.endsWith('/bin/postgres')).file));
 const owner='jg_task01_owner',credentials=Object.fromEntries(['owner','runtime','observer'].map(k=>[k,randomBytes(48).toString('hex')]));
 const receipt={schemaVersion:3,purpose:PURPOSE,planSha256,candidateSha:plan.source.head,runId,status:'STOPPED',business:'NOT_ENTERED',stages:[],differences:plan.differences,cleanup:{status:'NOT_NEEDED'},financialAcceptance:false};
 const started=Date.now(),deadline=started+plan.limits.resourceMs;let stage='INIT',closing=false,pending=0,pgStarted=false,pgPid,pgStart,pgChild,pgLifetime,pgLogIdentity,app,moduleRef,restoreEnvironment,clients=[],port,dbReady=false,publicCertificateBinding;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),plan.limits.resourceMs);const onSignal=()=>controller.abort();process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
 const childOwnedAndRunning=()=>pgLifetime?.running()===true;
 const needLive=()=>{need(!closing&&Date.now()<deadline&&!controller.signal.aborted,'NATIVE_DIRECT_DEADLINE');need(equal(directory(root),plan.rootIdentity),'NATIVE_DIRECT_ROOT_CHANGED');for(const row of plan.externalLibraries){const st=fs.lstatSync(row.file,{bigint:true});need(st.isFile()&&Object.keys(row.identity).every(key=>String(st[key])===row.identity[key]),'NATIVE_DIRECT_EXTERNAL_LIBRARY');}if(fs.existsSync(path.join(root,'postgres.log')))need(fs.lstatSync(path.join(root,'postgres.log')).size<=1048576,'NATIVE_DIRECT_LOG_BYTES');if(pgChild)need(childOwnedAndRunning(),'NATIVE_DIRECT_PG_CHANGED');if(pgStarted)need(fs.readFileSync(path.join(root,'data/postmaster.pid'),'utf8').split('\n')[2]===pgStart,'NATIVE_DIRECT_PG_CHANGED');};
 const checkPublicCertificateContext=()=>{needLive();need(publicCertificateBinding&&publicCertificateBinding.length===3,'NATIVE_DIRECT_CERT_CONTEXT');for(const row of publicCertificateBinding){const now=capture(row.file,1048576);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_CERT_CONTEXT');}return Object.freeze({runId,port,caSha256:publicCertificateBinding[0].sha256,serverSha256:publicCertificateBinding[1].sha256,configurationSha256:publicCertificateBinding[2].sha256});};
 const enter=name=>{needLive();stage=name;receipt.stages.push({stage:name,elapsedMs:Date.now()-started});};
 const wait=(operation,onLate)=>waitNativeTask16Operation(()=>{needLive();pending++;return Promise.resolve().then(()=>{needLive();return operation();}).finally(()=>{pending--;});},controller.signal,onLate);
 const cleanupWait=async operation=>{let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('NATIVE_DIRECT_CLOSE_TIMEOUT'),{code:'NATIVE_DIRECT_CLOSE_TIMEOUT'})),5000);})]);}finally{clearTimeout(timer);}};

 const env={PATH:path.join(prefix,'bin')+':'+path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,LC_ALL:'C',LANG:'C',TZ:'UTC',PGCONNECT_TIMEOUT:'5'};
 async function command(file,args,{stdin,timeoutMs=120000,extra={},allowFailure=false,cleanup=false}={}){
  if(!cleanup)needLive();need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=180000);if(stdin!==undefined)need(Buffer.byteLength(stdin)<=plan.limits.ownerSqlBytes,'NATIVE_DIRECT_SQL_BYTES');
  const remaining=cleanup?Math.min(timeoutMs,15000):Math.min(timeoutMs,deadline-Date.now());need(remaining>0,'NATIVE_DIRECT_DEADLINE');
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(file,args,{cwd:root,env:{...env,...extra},stdio:['pipe','pipe','pipe'],detached:false});let count=0,problem,hard,hardReject;const out=[],err=[];
   const stop=code=>{if(problem)return;problem=code;child.kill('SIGTERM');hard=setTimeout(()=>child.kill('SIGKILL'),1000);hardReject=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();reject(Object.assign(new Error('NATIVE_DIRECT_PROCESS_REMAINS'),{code:'NATIVE_DIRECT_PROCESS_REMAINS'}));},5000);};
   const t=setTimeout(()=>stop('NATIVE_DIRECT_COMMAND_TIMEOUT'),remaining);const abort=()=>stop('NATIVE_DIRECT_ABORTED');if(!cleanup)controller.signal.addEventListener('abort',abort,{once:true});
   child.once('error',()=>stop('NATIVE_DIRECT_COMMAND_SPAWN'));child.once('close',code=>{clearTimeout(t);clearTimeout(hard);clearTimeout(hardReject);controller.signal.removeEventListener('abort',abort);if(problem)reject(Object.assign(new Error(problem),{code:problem}));else resolve({code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
   for(const [stream,rows]of [[child.stdout,out],[child.stderr,err]])stream.on('data',bytes=>{count+=bytes.length;if(count>plan.limits.commandBytes)stop('NATIVE_DIRECT_COMMAND_BYTES');else if(!problem)rows.push(Buffer.from(bytes));});
   child.stdin.on('error',()=>{});child.stdin.end(stdin);
  });
  if(!allowFailure)need(result.code===0,'NATIVE_DIRECT_COMMAND_FAILED');return result;
 }
 const bin=name=>path.join(prefix,'bin',name),openssl=(args,options)=>command(plan.openssl.file,args,options);
 const ownerEnv=()=>({PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:owner,PGDATABASE:db,PGPASSWORD:credentials.owner,PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(root,'ca.crt')});
 async function sql(text,{database=db,allowFailure=false,extra={}}={}){need(dbReady||database==='postgres','NATIVE_DIRECT_DATABASE');const r=await command(bin('psql'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','--dbname',database],{stdin:"SET log_min_error_statement='panic';SET log_error_verbosity='terse';SET log_parameter_max_length_on_error=0;\n"+text,extra:{...ownerEnv(),...extra},allowFailure,timeoutMs:plan.limits.ownerSqlMs});return r;}
 const jsonSql=async(text,options)=>JSON.parse((await sql(text,options)).stdout.trim());
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 async function connectPort(){return new Promise((resolve,reject)=>{const server=require('node:net').createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});});}
 try{
  enter('TLS_AND_INITDB');for(const dir of ['socket','storage','prefixes'])fs.mkdirSync(path.join(root,dir),{mode:0o700});
  for(const name of ['ca','wrong-ca']){await openssl(['req','-new','-newkey','rsa:2048','-nodes','-x509','-sha256','-days','2','-subj','/CN=native-'+name+'-'+runId,'-keyout',path.join(root,name+'.key'),'-out',path.join(root,name+'.crt')]);fs.chmodSync(path.join(root,name+'.key'),0o600);fs.chmodSync(path.join(root,name+'.crt'),0o600);}
  writeNew(root,'server.ext','subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  await openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=native-'+runId,'-keyout',path.join(root,'server.key'),'-out',path.join(root,'server.csr')]);fs.chmodSync(path.join(root,'server.key'),0o600);
  await openssl(['x509','-req','-sha256','-days','2','-in',path.join(root,'server.csr'),'-CA',path.join(root,'ca.crt'),'-CAkey',path.join(root,'ca.key'),'-set_serial','1','-extfile',path.join(root,'server.ext'),'-out',path.join(root,'server.crt')]);fs.chmodSync(path.join(root,'server.crt'),0o600);
  writeNew(root,'initdb.secret',credentials.owner+'\n');
  try{await command(bin('initdb'),['-D',path.join(root,'data'),'-U',owner,'--encoding=UTF8','--locale=C','--auth-local=peer','--auth-host=scram-sha-256','--pwfile',path.join(root,'initdb.secret')]);}finally{fs.unlinkSync(path.join(root,'initdb.secret'));}
  port=await connectPort();need(port>1024&&port!==5432,'NATIVE_DIRECT_PORT');
  const hba=`local all ${owner} peer map=native_owner\nlocal all all reject\nhostnossl all all 127.0.0.1/32 reject\nhostssl all ${owner} 127.0.0.1/32 scram-sha-256\nhostssl ${db} jg_task01_runtime,jg_task01_observer 127.0.0.1/32 scram-sha-256\nhostssl all all 127.0.0.1/32 reject\n`;
  fs.writeFileSync(path.join(root,'data/pg_hba.conf'),hba,{mode:0o600});fs.writeFileSync(path.join(root,'data/pg_ident.conf'),`native_owner ${os.userInfo().username} ${owner}\n`,{mode:0o600});
  const config=`listen_addresses='127.0.0.1,::1'\nport=${port}\nunix_socket_directories='${root}/socket'\nssl=on\nssl_min_protocol_version='TLSv1.2'\nssl_cert_file='${root}/server.crt'\nssl_key_file='${root}/server.key'\npassword_encryption='scram-sha-256'\nmax_connections=16\nshared_buffers='64MB'\nmax_wal_size='64MB'\nmin_wal_size='32MB'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length_on_error=0\nlog_error_verbosity='terse'\nlog_duration=off\nlog_min_duration_statement=-1\nlog_min_duration_sample=-1\nlog_transaction_sample_rate=0\nlogging_collector=off\nlog_destination='stderr'\nlog_line_prefix='NATIVE_TASK16 [%p] '\nlc_messages='C'\nstatement_timeout='60s'\n`;
  fs.writeFileSync(path.join(root,'data/postgresql.conf'),config,{mode:0o600});writeNew(root,'postgres.log','');
  const publicRows=()=>['ca.crt','server.crt','data/postgresql.conf'].map(name=>{const row=capture(path.join(root,name),1048576);return {file:path.join(root,name),sha256:row.sha256,identity:row.identity};});
  publicCertificateBinding=publicRows();
  enter('PG_START');const logFd=fs.openSync(path.join(root,'postgres.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
  try{pgLogIdentity=assertNativeTask16LogIdentity(logFd);pgChild=spawn(bin('postgres'),['-D',path.join(root,'data')],{cwd:root,env,stdio:['ignore',logFd,logFd],detached:false});pgChild.once('error',()=>{});pgPid=pgChild.pid;
   pgLifetime=trackNativeTask16Child(pgChild);
  }finally{fs.closeSync(logFd);}
  need(Number.isSafeInteger(pgPid)&&pgPid>0,'NATIVE_DIRECT_PG_START');const readyBy=Math.min(deadline,Date.now()+60000);let ready=false;
  while(Date.now()<readyBy){needLive();const result=await command(bin('pg_isready'),['--host','127.0.0.1','--port',String(port),'--username',owner,'--dbname','postgres'],{timeoutMs:5000,allowFailure:true});if(result.code===0){ready=true;break;}await wait(()=>new Promise(resolve=>setTimeout(resolve,250)));}
  need(ready&&childOwnedAndRunning(),'NATIVE_DIRECT_PG_READINESS');const pidRows=capture(path.join(root,'data/postmaster.pid'),8192).bytes.toString('utf8').split('\n');
  need(Number(pidRows[0])===pgPid&&pidRows[1]===path.join(root,'data')&&Number(pidRows[3])===port&&Number(pidRows[2])>=Math.floor(started/1000),'NATIVE_DIRECT_PG_IDENTITY');pgStart=pidRows[2];pgStarted=true;receipt.resource={pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db};writeNew(root,'resource-ready.json',{purpose:PURPOSE,candidateSha:plan.source.head,planSha256,runId,pid:pgPid,startEpoch:pgStart,host:'127.0.0.1',port,database:db,status:'POSTGRES_READY_NOT_BUSINESS_ADMISSION'});
  // Startup-only evidence from the original child's existing append-only log.
  // IPv4 readiness alone cannot attest that localhost's IPv6 endpoint is owned.
  let startupLogFd;try{
   const startupLogPath=path.join(root,'postgres.log');startupLogFd=fs.openSync(startupLogPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   assertNativeTask16LogIdentity(startupLogFd,pgLogIdentity,startupLogPath);const before=fs.fstatSync(startupLogFd,{bigint:true});need(before.size<=1048576n,'NATIVE_DIRECT_LOG_BYTES');
   const bytes=Buffer.alloc(Number(before.size));need(fs.readSync(startupLogFd,bytes,0,bytes.length,0)===bytes.length,'NATIVE_DIRECT_LOG_WINDOW');
   assertNativeTask16LogIdentity(startupLogFd,pgLogIdentity,startupLogPath);const after=fs.fstatSync(startupLogFd,{bigint:true});need(after.size>=before.size&&after.size<=1048576n,'NATIVE_DIRECT_LOG_WINDOW');needLive();
   receipt.loopbackListeners=assertNativeTask12LoopbackListeners(bytes.toString('utf8'),pgPid,port);
  }finally{if(startupLogFd!==undefined)fs.closeSync(startupLogFd);}
  enter('TLS_NEGATIVES');const positive=await jsonSql("SELECT jsonb_build_object('version',current_setting('server_version_num'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),'server',host(inet_server_addr()),'port',inet_server_port());",{database:'postgres'});need(positive.version==='160015'&&positive.tls===true&&positive.client==='127.0.0.1'&&positive.server==='127.0.0.1'&&positive.port===port,'NATIVE_DIRECT_TLS');
  for(const extra of [{PGSSLROOTCERT:path.join(root,'wrong-ca.crt')},{PGHOST:'127.0.0.2',PGHOSTADDR:'127.0.0.1'},{PGSSLMODE:'disable'}])need((await sql('SELECT 1;',{database:'postgres',extra,allowFailure:true})).code!==0,'NATIVE_DIRECT_TLS_NEGATIVE');receipt.tls={correct:true,wrongCaRejected:true,wrongSanRejected:true,noTlsRejected:true};
  await sql(`CREATE DATABASE ${db} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`,{database:'postgres'});dbReady=true;
  const locale=await jsonSql("SELECT jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',datlocprovider) FROM pg_database WHERE datname=current_database();");need(equal(locale,{encoding:'UTF8',collate:'C',ctype:'C',provider:'c'}),'NATIVE_DIRECT_LOCALE');receipt.locale=locale;
  enter('MIGRATIONS');const migration=await migrateNativeTask16(plan,root,port,credentials.owner,sql,jsonSql,command,enter);receipt.migrationMaterials=migration.materials;
  enter('ROLES');const roles=require('./task16-current259-role-provision.cjs'),nonce=randomBytes(32).toString('hex');
  const roleIdentity=await jsonSql(`SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port()) FROM pg_database d WHERE d.datname=current_database();`);
  need(roleIdentity.ownerOid==='10'&&roleIdentity.actorOid==='10'&&roleIdentity.tls===true&&roleIdentity.clientAddress==='127.0.0.1'&&roleIdentity.serverAddress==='127.0.0.1'&&roleIdentity.serverPort===port,'NATIVE_DIRECT_OWNER');
  const roleScope=JSON.stringify({identity:roleIdentity,app:{name:migration.plan.appName,oid:migration.setup.appOid,nonce:migration.plan.nonce},ledger:plan.source.witness.profile.ledger,competition:false});
  const before=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,null))).stdout;roles.parseNativeTask16RoleRead(roleScope,before,'before');
  const staged=(await sql(roles.renderNativeTask16RoleInstall(roleScope,before,{runtime:credentials.runtime,observer:credentials.observer}))).stdout;const stagedRow=roles.parseNativeTask16RoleRead(roleScope,staged,'install',before);
  const committed=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,stagedRow.writeXid))).stdout;const roleRow=roles.parseNativeTask16RoleRead(roleScope,committed,'committed',before,staged);
  need(roleRow.state.roles.length===9,'NATIVE_DIRECT_NINE_ROLES');
  const provisioned={status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',executionAllowed:false,nativeAdmission:false,sourceSha:plan.source.head,runId,databaseIdentity:roleIdentity,ordinary:roleRow.state.app,roles:roleRow.state.roles,commitXid:stagedRow.writeXid,databaseAcl:{before:JSON.parse(before).state.databases,after:roleRow.state.databases}};
  const contract=await installNativeTask12Full261(plan,{root,port,provisioned,sql,jsonSql,enter,receipt});
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');
  receipt.directoryBytesBeforeBusiness=nativeDirectoryBytes(root);
  enter('REAL_CLIENTS_NEST_AND_CASE');await wait(()=>runNativeTask16Business(plan,{root,port,credentials,identity:roleIdentity,contract,signal:controller.signal,sql,jsonSql,needLive,wait,cleanupWait,enter,receipt,checkPublicCertificateContext,command,logIdentity:pgLogIdentity,setRestoreEnvironment:value=>{restoreEnvironment=value;},setClients:value=>{clients=value;},setApplication:(a,m)=>{app=a;moduleRef=m;}}));
  need(equal(sourceCapture(),plan.source)&&equal(compiledMaterials(),plan.artifacts)&&equal(dependencyDigest(),plan.dependencies),'NATIVE_DIRECT_SOURCE_CHANGED');receipt.status='NATIVE_TASK12_EQUIPMENT_RETURNED_NOT_FULL394_ACCEPTANCE';
 }catch(error){const code=error&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code')?.value:undefined;receipt.failure={stage,code:typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(code)?code:'UNKNOWN',elapsedMs:Date.now()-started};receipt.status='STOPPED';
  const http=require('./task12-current261-local-lifecycle-http.cjs').describeCurrent261LocalLifecycleHttpFailure(error);if(http)receipt.httpFailure=http;
  for(let n=0,value=error;n<8&&value&&typeof value==='object'&&!types.isProxy(value);n++,value=Object.getOwnPropertyDescriptor(value,'cause')?.value){
   if(Object.getOwnPropertyDescriptor(value,'ownerCleanupOutcome')?.value==='UNKNOWN_DO_NOT_CONTINUE')receipt.ownerCleanup='UNKNOWN_DO_NOT_CONTINUE';
   if(Object.getOwnPropertyDescriptor(value,'appCleanupOutcome')?.value==='UNKNOWN_DO_NOT_CONTINUE')receipt.applicationCleanup='UNKNOWN_DO_NOT_CONTINUE';
  }
 }
 finally{
  closing=true;const errors=[];
  if(app)try{await cleanupWait(()=>app.close());}catch{errors.push('APPLICATION_CLOSE_UNKNOWN');}
  if(moduleRef)try{await cleanupWait(()=>moduleRef.close());}catch{errors.push('MODULE_CLOSE_UNKNOWN');}
  for(const client of clients)try{await cleanupWait(()=>client.$disconnect());}catch{errors.push('CLIENT_CLOSE_UNKNOWN');}
  if(pgLifetime&&!pgLifetime.running()&&(pgChild.exitCode!==null||pgChild.signalCode!==null)){
   receipt.postgresExitedBeforeOwnedStop=true;if(!receipt.failure){receipt.failure={stage:'OWNED_CLEANUP',code:'NATIVE_DIRECT_POSTGRES_EARLY_EXIT',elapsedMs:Date.now()-started};receipt.status='STOPPED';}
  }
  if(pgLifetime&&pgLifetime.running())try{
   // This exact unreaped child cannot have a recycled PID. Never find/kill a
   // replacement from postmaster.pid, a process name, or an arbitrary URL.
   need(childOwnedAndRunning(),'NATIVE_DIRECT_PG_CHANGED');pgLifetime.stop();
   let stopTimer;try{await Promise.race([pgLifetime.terminal,new Promise((_,reject)=>{stopTimer=setTimeout(()=>reject(new Error('native stop timeout')),15000);})]);}finally{clearTimeout(stopTimer);}
   need(!pgLifetime.running(),'NATIVE_DIRECT_CLEANUP_UNKNOWN');
  }catch{errors.push('POSTGRES_CLOSE_UNKNOWN');}
  if(pgChild&&(!pgLifetime||!pgLifetime.running()&&pgChild.exitCode===null&&pgChild.signalCode===null))errors.push('UNCONFIRMED_POSTGRES_START');
  if(!pgChild&&fs.existsSync(path.join(root,'data/postmaster.pid')))errors.push('UNCONFIRMED_POSTGRES_START');
  if(pending>0)errors.push('NATIVE_OPERATIONS_NOT_SETTLED');if(receipt.ownerCleanup==='UNKNOWN_DO_NOT_CONTINUE')errors.push('OWNER_CLEANUP_UNKNOWN');if(receipt.applicationCleanup==='UNKNOWN_DO_NOT_CONTINUE')errors.push('APPLICATION_CLEANUP_UNKNOWN');if(receipt.sdkTlsCleanup==='UNKNOWN')errors.push('SDK_TLS_PROBE_CLEANUP_UNKNOWN');if(receipt.sdkTlsLogClose==='UNKNOWN')errors.push('SDK_TLS_LOG_CLOSE_UNKNOWN');
  for(const name of ['ca.key','wrong-ca.key','server.key'])if(fs.existsSync(path.join(root,name)))try{fs.unlinkSync(path.join(root,name));}catch{errors.push('PRIVATE_KEY_ERASURE_UNKNOWN');}
  if(restoreEnvironment)try{restoreEnvironment();}catch{errors.push('ENVIRONMENT_RESTORE_UNKNOWN');}
  clearTimeout(timer);process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
  try{receipt.directoryBytesAfterCleanup=nativeDirectoryBytes(root);}catch{errors.push('DIRECTORY_OBSERVATION_UNKNOWN');}
  receipt.cleanup={status:errors.length?'UNKNOWN':'COMPLETED',failures:errors};if(errors.length)receipt.status='STOPPED';receipt.elapsedMs=Date.now()-started;
  try{writeNew(root,'receipt.json',receipt);}catch{receipt.status='STOPPED';receipt.publication='UNKNOWN';}
 }
 return {status:receipt.status,candidateSha:plan.source.head,runId,failedStage:receipt.failure?.stage,failureCode:receipt.failure?.code,cleanup:receipt.cleanup.status,elapsedMs:receipt.elapsedMs};
}

async function migrateNativeTask16(plan,root,port,password,sql,jsonSql,command,enter){
 const controls=require('./local-staged-migration-controls.cjs'),{createLocalTailQualification}=require('./local-staged-tail-qualification.cjs');
 const ledger=plan.source.witness.profile.ledger,migrations=ledger.map(({name,sha256})=>({name,sha256})),database=plan.database;
 const tools=resolveNativeTask16PrismaTools();need(equal(tools,plan.prismaTools),'NATIVE_DIRECT_PRISMA_TOOLS_CHANGED');const cli=tools.cli.file,engine=tools.engine.file;
 const schema=capture(path.join(__dirname,'schema.prisma')).bytes;
 const roots=new Map();
 for(const size of [203,205,213,215,218,221,261]){
  const dir=path.join(root,'prefixes',String(size));fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(path.join(dir,'migrations'),{mode:0o700});
  fs.writeFileSync(path.join(dir,'schema.prisma'),schema,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(dir,'migrations/migration_lock.toml'),'provider = "postgresql"\n',{flag:'wx',mode:0o600});
  for(const row of ledger.slice(0,size)){
   const bytes=capture(path.join(__dirname,'migrations',row.name,'migration.sql')).bytes;need(hash(bytes)===row.sha256,'NATIVE_DIRECT_MIGRATION_SOURCE');
   const target=path.join(dir,'migrations',row.name);fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'migration.sql'),bytes,{flag:'wx',mode:0o600});
  }
  roots.set(size,dir);
 }
 const baseUrl=new URL('postgresql://jg_task01_owner@127.0.0.1:'+port+'/'+database);baseUrl.password=password;
 for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5'}))baseUrl.searchParams.set(key,value);
 const deploy=async(size,url=baseUrl)=>{enter('MIGRATE_'+size);await command(process.execPath,[cli,'migrate','deploy','--schema',path.join(roots.get(size),'schema.prisma')],{timeoutMs:plan.limits.migrationMs,extra:{DATABASE_URL:url.toString(),PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'}});};
 const identity=row=>{need(row.database===database&&row.ownerOid==='10'&&row.actorOid==='10'&&row.actor==='jg_task01_owner'&&row.sessionActor==='jg_task01_owner'&&row.version===160015&&row.encoding==='UTF8'&&row.replication==='origin','NATIVE_DIRECT_MIGRATION_IDENTITY');return Object.fromEntries(['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier'].map(k=>[k,row[k]]));};
 const checkLedger=(row,size)=>{need(equal(row.ledger,ledger.slice(0,size)),'NATIVE_DIRECT_MIGRATION_LEDGER');};
 await deploy(203);const first=await jsonSql(controls.inspectSql());const bound=identity(first);checkLedger(first,203);
 const migrationPlan={...bound,runId:randomUUID(),nonce:randomBytes(32).toString('hex'),appName:'jg_fixture_app_'+randomBytes(12).toString('hex'),schemaName:'jg_fixture_'+randomBytes(12).toString('hex'),technicalProfile:'CURRENT259_OWNED_TECHNICAL_V1',resourceRunId:plan.runId,migrations:migrations.slice(0,205)};
 const setup=await jsonSql(controls.setupSql(migrationPlan));controls.checkSetup(setup,migrationPlan);
 const qualified=new URL(baseUrl);qualified.searchParams.set('options','-c app.contract_archive_v2_application_role_oid='+setup.appOid+' -c app.contract_archive_v2_file_caller_oids='+JSON.stringify(setup.fileCallerOids)+' -c app.local_migration_nonce='+migrationPlan.nonce);
 await deploy(205,qualified);const completed=controls.parseReadback((await sql(controls.readbackSql(migrationPlan,setup))).stdout);need(equal(identity(completed),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(completed,205);controls.checkCompletion(completed,migrationPlan,setup);
 await sql(controls.cleanupSql(migrationPlan,setup));const clean=await jsonSql(controls.cleanReadSql(migrationPlan,setup));need(clean.schemaAbsent===true&&clean.eventAbsent===true&&clean.appOid===setup.appOid&&clean.applicationQualified===true,'NATIVE_DIRECT_QUALIFICATION_CLEANUP');
 const materials=[];const tail=createLocalTailQualification({plan:migrationPlan,setup,migrations},{read:async(_phase,text)=>jsonSql(text),write:async(_phase,text)=>jsonSql(text),recordMaterial:row=>{need(hash(Buffer.from(row.sql))===row.afterSha256,'NATIVE_DIRECT_SQL_MATERIAL');materials.push({kind:row.kind,beforeSha256:row.beforeSha256,afterSha256:row.afterSha256});}});
 for(const size of [213,215,218,221]){await deploy(size);const row=await jsonSql(controls.inspectSql());need(equal(identity(row),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(row,size);await tail.qualify(size);}
 await deploy(261);const final=await jsonSql(controls.inspectSql());need(equal(identity(final),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(final,261);
 return {plan:migrationPlan,setup,materials};
}

function replaceNativeTask12Hba(root,name,content){
 need(['pg_hba.conf','pg_ident.conf'].includes(name)&&typeof content==='string'&&Buffer.byteLength(content)<8192,'NATIVE_DIRECT_HBA');
 const file=path.join(root,'data',name),before=capture(file,8192);need((BigInt(before.identity.mode)&0o777n)===0o600n,'NATIVE_DIRECT_HBA_MODE');const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  need(['dev','ino','size','mode','uid','gid','mtimeNs','ctimeNs'].every(key=>String(fs.fstatSync(fd,{bigint:true})[key])===before.identity[key]),'NATIVE_DIRECT_HBA_CHANGED');
  fs.writeSync(fd,content,0,'utf8');fs.ftruncateSync(fd,Buffer.byteLength(content));fs.fsyncSync(fd);
  const after=capture(file,8192);need(after.sha256===hash(Buffer.from(content))&&['dev','ino','mode','uid','gid'].every(key=>after.identity[key]===before.identity[key]),'NATIVE_DIRECT_HBA_CHANGED');return {file,sha256:after.sha256,identity:after.identity};
 }finally{fs.closeSync(fd);}
}
async function installNativeTask12Full261(plan,state){
 const {root,port,provisioned,sql,jsonSql,enter,receipt}=state;
 const run=async(label,statement)=>{enter(label);return (await sql(statement)).stdout;};
 const source={...plan.source.witness,tree:plan.source.tree};
 const archive=require('./task16-current259-archive-install.cjs').beginNativeTask12ArchiveProtocol(JSON.stringify({source,completion:provisioned,serverPort:port}));
 const seven=archive.acceptBefore(await run('ARCHIVE_BEFORE',archive.beforeSql));
 const archiveWriter=seven.acceptBefore(await run('ARCHIVE_SEVEN_BEFORE',seven.beforeSql));
 const archiveReader=archiveWriter.acceptWritten(await run('ARCHIVE_SEVEN_WRITE',archiveWriter.sql));
 const archiveResult=archiveReader.acceptCommitted(await run('ARCHIVE_SEVEN_COMMITTED',archiveReader.sql));
 const ordinary=require('./task16-current259-ordinary-archive-acl.cjs').beginNativeTask12OrdinaryAclProtocol(archiveResult);
 const ordinaryWriter=ordinary.acceptBefore(await run('ORDINARY_ACL_BEFORE',ordinary.sql));
 const ordinaryReader=ordinaryWriter.acceptWritten(await run('ORDINARY_ACL_WRITE',ordinaryWriter.sql));
 const ordinaryResult=ordinaryReader.acceptCommitted(await run('ORDINARY_ACL_COMMITTED',ordinaryReader.sql));
 const roles=require('./task12-current259-document-role-provision.cjs').beginNativeTask12DocumentRolesProtocol(ordinaryResult);
 const roleWriter=roles.acceptBefore(await run('DOCUMENT_ROLES_BEFORE',roles.sql));
 const roleReader=roleWriter.acceptWritten(await run('DOCUMENT_ROLES_WRITE',roleWriter.sql));
 const roleResult=roleReader.acceptCommitted(await run('DOCUMENT_ROLES_COMMITTED',roleReader.sql));
 const acl=require('./task12-current259-document-acl-transport.cjs').beginNativeTask12DocumentAclInstallation(roleResult);
 const aclWriter=acl.acceptBefore(await run('DOCUMENT_ACL_BEFORE',acl.beforeSql));
 const aclReader=aclWriter.acceptStaged(await run('DOCUMENT_ACL_WRITE',aclWriter.sql));
 const aclResult=aclReader.acceptCommitted(await run('DOCUMENT_ACL_COMMITTED',aclReader.sql));
 const loginApi=require('./task12-current259-document-login.cjs'),secrets=Array.from({length:4},()=>randomBytes(48).toString('hex'));
 const verifiers=loginApi.nativeTask12DocumentLoginVerifiers(JSON.stringify(secrets));
 const login=loginApi.beginNativeTask12DocumentLoginProtocol(aclResult,JSON.stringify({runRoot:root,osUser:os.userInfo().username}),JSON.stringify(verifiers));
 receipt.documentHba=[replaceNativeTask12Hba(root,'pg_hba.conf',login.hba),replaceNativeTask12Hba(root,'pg_ident.conf',login.ident)];
 enter('DOCUMENT_HBA_RELOAD');need((await jsonSql("SELECT jsonb_build_object('reloaded',pg_reload_conf());")).reloaded===true,'NATIVE_DIRECT_HBA_RELOAD');
 const loginWriter=login.acceptBefore(await run('DOCUMENT_LOGIN_BEFORE',login.sql));
 const loginReader=loginWriter.acceptWritten(await run('DOCUMENT_LOGIN_WRITE',loginWriter.sql));
 const loginResult=loginReader.acceptCommitted(await run('DOCUMENT_LOGIN_COMMITTED',loginReader.sql));
 receipt.installation={migrations:261,roles:9,documentRoles:3,archiveInstallXid:archiveResult.installXid,
  ordinaryAclInstallXid:ordinaryResult.installXid,documentRoleInstallXid:roleResult.installXid,
  documentAclInstallXid:aclResult.installXid,documentLoginInstallXid:loginResult.installXid};
 return {source,archiveResult,ordinaryResult,roleResult,aclResult,loginResult,secrets,bootstrapRoles:[{name:"jg_task01_owner",oid:"10"},...["runtime","observer"].map(kind=>(need(provisioned.roles.filter(role=>role.name==="jg_task01_"+kind).length===1,"NATIVE_DIRECT_BOOTSTRAP_ROLES"),provisioned.roles.find(role=>role.name==="jg_task01_"+kind)))]};
}
async function runNativeTask16Business(plan,state){
 const {root,port,credentials,identity,contract,needLive,cleanupWait,enter,receipt}=state;
 const env={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:path.join(root,'storage'),JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),FILE_DOWNLOAD_SECRET:randomBytes(32).toString('hex')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));state.setRestoreEnvironment(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});for(const [key,value]of Object.entries(env))process.env[key]=value;
 const build=require('./task16-current259-build.cjs').observeCurrent259Build();
 const loader=require('./task16-current259-client-loader.cjs').loadCurrent259Client(build),modules=loader.loadCurrent261LocalLifecycleDocumentModules();
 const officialApi=require('./task12-official-document-profile.cjs');
 need(equal(nativeTask12ToolRoot(plan.officialRuntime.toolRoot,true),plan.officialRuntime.toolRootIdentity),'NATIVE_DIRECT_OFFICIAL_RUNTIME');
 const officialProof=officialApi.verifyOfficialTask12DocumentRuntime(plan.officialRuntime.path,plan.officialRuntime.sha256,modules);
 return officialApi.withOfficialTask12DocumentRuntime(officialProof,plan.officialRuntime.toolRoot,async official=>{
  need(equal(nativeTask12ToolRoot(plan.officialRuntime.toolRoot,false),plan.officialRuntime.toolRootIdentity),'NATIVE_DIRECT_OFFICIAL_RUNTIME');
  const officialAbort=new AbortController(),signal=AbortSignal.any([state.signal,officialAbort.signal]);
  const timer=setTimeout(()=>officialAbort.abort(),Math.floor(official.remainingTotalMilliseconds()));
  const wait=(operation,onLate)=>waitNativeTask16Operation(()=>state.wait(operation,onLate),signal,onLate);
  const PrismaClient=loader.Class;
  try{
  const controllerAborted=error=>Object.getOwnPropertyDescriptor(error??{},'code')?.value==='NATIVE_DIRECT_DEADLINE';
  const urlFor=kind=>{const url=new URL('postgresql://jg_task01_'+kind+'@127.0.0.1:'+port+'/'+plan.database);url.password=credentials[kind];for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5',application_name:'native_task16_'+plan.runId.replaceAll('-','')+'_'+kind}))url.searchParams.set(key,value);return url.toString();};
  const clients=['owner','runtime','observer'].map(kind=>new PrismaClient({datasources:{db:{url:urlFor(kind)}}}));state.setClients(clients);
  await wait(()=>Promise.all(clients.map(client=>client.$connect())));
  const identitySql=nativeTask12BootstrapIdentitySql;
  let retained;
  const verifyIdentity=async()=>{
   needLive();const nonce=randomBytes(32).toString('hex');const rows=await wait(()=>Promise.all(clients.map(client=>client.$queryRawUnsafe(identitySql,nonce))));
   need(rows.every((result,i)=>result.length===1&&result[0].database===plan.database&&result[0].databaseOid===identity.databaseOid&&result[0].effectiveRole==='jg_task01_'+['owner','runtime','observer'][i]&&result[0].loginRole===result[0].effectiveRole&&result[0].effectiveOid===result[0].loginOid&&result[0].tls===true&&result[0].version===160015&&result[0].encoding==='UTF8'&&result[0].replication==='origin'&&result[0].clientAddress==='127.0.0.1'&&result[0].serverAddress==='127.0.0.1'&&result[0].serverPort===port&&result[0].nonce===nonce&&result[0].readOnly===(i===2?'on':'off')),'NATIVE_DIRECT_CLIENT_IDENTITY');
   need(new Set(rows.map(r=>r[0].pid)).size===3&&new Set(rows.map(r=>r[0].loginOid)).size===3&&new Set(rows.map(r=>r[0].clientPort)).size===3,'NATIVE_DIRECT_CLIENT_SEPARATION');
   const next=rows.map(r=>{const copy={...r[0]};delete copy.nonce;return copy;});if(retained)need(equal(next,retained),'NATIVE_DIRECT_CLIENT_CHANGED');else retained=next;return next;
  };
  await verifyIdentity();
  const bootstrapOwnerSql=`SELECT jsonb_build_object('ownerPid',pg_backend_pid(),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),'server',host(inet_server_addr()),'port',inet_server_port(),'database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'actorOid',current_user::regrole::oid::text,'sessionActor',session_user,'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',a.usesysid::text,'role',a.usename,'pid',a.pid,'start',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'databaseOid',a.datid::text,'database',a.datname,'ssl',s.ssl,'clientAddress',host(a.client_addr),'clientPort',a.client_port) ORDER BY a.pid),'[]'::jsonb) FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid=a.pid WHERE a.datid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND a.backend_type='client backend' AND a.pid<>pg_backend_pid()));`;
  needLive();loader.check();state.checkPublicCertificateContext();
  const bootstrapOwner=await wait(()=>state.sql(bootstrapOwnerSql));
  needLive();loader.check();state.checkPublicCertificateContext();
  receipt.bootstrapIdentity=assertNativeTask12BootstrapPools(bootstrapOwner.stdout,JSON.stringify({database:plan.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,port,roles:contract.bootstrapRoles,observed:retained}));
  receipt.sdkPositiveClients=retained.map(row=>({role:row.loginRole,pid:row.pid,startedAt:row.start,tls:row.tls,databaseOid:row.databaseOid,clientAddress:row.clientAddress,clientPort:row.clientPort,serverAddress:row.serverAddress,serverPort:row.serverPort}));
  const policyBinding=state.checkPublicCertificateContext();need(equal(captureNativeTask16Security(),plan.security),'NATIVE_DIRECT_SECURITY_CHANGED');
  const policies=[];for(const hostname of ['127.0.0.1','localhost']){
   state.checkPublicCertificateContext();need(equal(captureNativeTask16Security(),plan.security),'NATIVE_DIRECT_SECURITY_CHANGED');
   const result=await wait(()=>state.command('/usr/bin/security',['verify-cert','-c',path.join(root,'server.crt'),'-r',path.join(root,'ca.crt'),'-p','ssl','-n',hostname,'-N','-L','-R','offline','-v'],{timeoutMs:5000,allowFailure:true}));
   policies.push(projectNativeTask16SecurityPolicy(result));state.checkPublicCertificateContext();
  }
  receipt.nativeNamePolicy={binding:policyBinding,positive:policies[0],negative:policies[1],sdkDirectCause:false};
  need(equal(policies[0],{exitCode:0,hostnameMismatch:false,error67602:false})&&equal(policies[1],{exitCode:1,hostnameMismatch:true,error67602:true}),'NATIVE_DIRECT_NATIVE_POLICY_UNKNOWN');
  receipt.sdkTls={};receipt.sdkTlsWords={};
  for(const mode of ['wrong-ca','no-tls','wrong-san']){
   const originalRuntimeUrl=urlFor('runtime'),url=new URL(originalRuntimeUrl);if(mode==='wrong-ca')url.searchParams.set('sslcert',path.join(root,'wrong-ca.crt'));else if(mode==='no-tls')url.searchParams.set('sslmode','disable');else url.hostname='localhost';
   if(mode==='wrong-san')receipt.localhostAnswers=verifyNativeTask16LocalhostAnswers(await wait(()=>require('node:dns').promises.lookup('localhost',{all:true,verbatim:true})));
   const restored=new URL(url);restored.hostname='127.0.0.1';const onlyHostnameChanged=mode==='wrong-san'&&url.hostname==='localhost'&&restored.toString()===originalRuntimeUrl;if(mode==='wrong-san')receipt.nameControlOnlyHostnameChanged=onlyHostnameChanged;state.checkPublicCertificateContext();
   const probe=new PrismaClient({datasources:{db:{url:url.toString()}}});state.setClients([...clients,probe]);let primary,logFd,logBefore;
   try{
    if(mode==='no-tls'){logFd=fs.openSync(path.join(root,'postgres.log'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));logBefore=fs.fstatSync(logFd,{bigint:true});need(logBefore.isFile()&&logBefore.uid===BigInt(process.getuid())&&(logBefore.mode&0o777n)===0o600n,'NATIVE_DIRECT_LOG_WINDOW');}
    let rejected,controlled;try{await wait(()=>probe.$connect());}catch(error){if(controllerAborted(error))throw error;receipt.sdkTlsWords[mode]=projectNativeTask16TlsWords(error);receipt.sdkTls[mode]={status:'UNKNOWN',...classifyNativeTask16TlsFailure(error,mode)};let hba;
     if(mode==='no-tls'){
      assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));const after=fs.fstatSync(logFd,{bigint:true}),named=fs.lstatSync(path.join(root,'postgres.log'),{bigint:true});
      need(['dev','ino','mode','uid','gid'].every(key=>after[key]===logBefore[key]&&named[key]===logBefore[key])&&!named.isSymbolicLink()&&after.size>=logBefore.size&&after.size-logBefore.size<=65536n,'NATIVE_DIRECT_LOG_WINDOW');
      const bytes=Buffer.alloc(Number(after.size-logBefore.size));let read=0;while(read<bytes.length){const count=fs.readSync(logFd,bytes,read,bytes.length-read,Number(logBefore.size)+read);need(count>0,'NATIVE_DIRECT_LOG_WINDOW');read+=count;}
      assertNativeTask16LogIdentity(logFd,state.logIdentity,path.join(root,'postgres.log'));const checked=fs.fstatSync(logFd,{bigint:true});need(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>checked[key]===after[key]),'NATIVE_DIRECT_LOG_WINDOW');
      hba=projectNativeTask16PlaintextHba(bytes.toString('utf8'),plan.database);if(hba)receipt.plaintextHba=hba;
     }
     rejected=classifyNativeTask16TlsFailure(error,mode,hba);if(mode==='wrong-san'&&!rejected.accepted){controlled=controlledNativeTask16NameResult(error,JSON.stringify({binding:policyBinding,currentBinding:state.checkPublicCertificateContext(),positiveClientsVerified:true,onlyHostnameChanged,positivePolicy:policies[0],negativePolicy:policies[1]}));receipt.controlledNameRejection=controlled;}}
    if(!rejected){receipt.sdkTls[mode]={status:'UNEXPECTEDLY_ACCEPTED'};fail('NATIVE_DIRECT_TLS_NEGATIVE_ACCEPTED');}
    receipt.sdkTls[mode]={status:rejected.accepted?'REJECTED':'UNKNOWN',...rejected};state.checkPublicCertificateContext();need(rejected.accepted||controlled?.accepted===true,'NATIVE_DIRECT_TLS_NEGATIVE_UNKNOWN');
   }catch(error){primary=error;throw error;}
   finally{let logCloseFailed=false;if(logFd!==undefined)try{fs.closeSync(logFd);}catch{logCloseFailed=true;receipt.sdkTlsLogClose='UNKNOWN';}state.setClients(clients);try{await cleanupWait(()=>probe.$disconnect());}catch{receipt.sdkTlsCleanup='UNKNOWN';if(!primary)fail('NATIVE_DIRECT_PROBE_CLEANUP_UNKNOWN');}if(logCloseFailed&&!primary)fail('NATIVE_DIRECT_LOG_CLOSE_UNKNOWN');}
  }

  enter('TLS_BOOTSTRAP_NORMAL_CLOSE');await wait(()=>Promise.all(clients.map(client=>cleanupWait(()=>client.$disconnect()))));state.setClients([]);receipt.bootstrapClientsClosed='NORMAL_BEFORE_MASTER_SEED';
  const check=()=>{needLive();need(equal(nativeTask12ToolRoot(plan.officialRuntime.toolRoot,false),plan.officialRuntime.toolRootIdentity),'NATIVE_DIRECT_OFFICIAL_RUNTIME');need(!signal.aborted,'NATIVE_DIRECT_DEADLINE');official.remainingTotalMilliseconds();loader.check();state.checkPublicCertificateContext();
   for(const row of receipt.documentHba){const now=capture(row.file,8192);need(now.sha256===row.sha256&&equal(now.identity,row.identity),'NATIVE_DIRECT_HBA_CHANGED');}
  };
  check();enter('CONTRACT_MASTER_FIXTURE');
  const fixture=modules.buildTask12LocalLifecycleFixture(plan.runId,'inside:equipment_rental');need(modules.isTask12LocalLifecycleFixture(fixture)&&fixture.case.key==='inside:equipment_rental','NATIVE_DIRECT_CONTRACT_FIXTURE');
  const passwords=Object.freeze(fixture.approval.users.map(()=>randomBytes(32).toString('hex')));
  const passwordsByUser=Object.freeze(Object.fromEntries(fixture.approval.users.map((user,index)=>[user.id,passwords[index]])));
  const hashes=Object.fromEntries(await wait(()=>Promise.all(fixture.approval.users.map(async(user,i)=>[user.id,await modules.hashTask12GeneratedAdmissionPassword(passwords[i])]))));
  const seed=require('./task12-current259-q2-seed.cjs').createNativeCurrent261EquipmentSeed(fixture,identity,hashes);
  const ownerSql=async(sql,label)=>{check();enter(label);const result=await state.sql(sql);check();return result;};
  seed.verifyBefore((await ownerSql(seed.beforeSql(),'CONTRACT_SEED_BEFORE')).stdout);
  seed.verifyWritten((await ownerSql(seed.writeSql(),'CONTRACT_SEED_WRITE')).stdout);
  const seeded=seed.finish((await ownerSql(seed.committedSql(),'CONTRACT_SEED_COMMITTED')).stdout);need(seeded.seedRows===26,'NATIVE_DIRECT_CONTRACT_SEED');
  const originals=await wait(()=>modules.createTask12LocalLifecycleOriginals(fixture)),sourceDocx=modules.readTask12LocalLifecycleSourceDocx('inside:equipment_rental');
  const login=require('./task12-current259-document-login.cjs').readNativeTask12DocumentLoginProjection(contract.loginResult);
  const docClients=login.roles.map((role,i)=>{const ordinary=i===3,url=new URL('postgresql://'+role.name+'@127.0.0.1:'+port+'/'+plan.database);url.password=contract.secrets[i];
   for(const [key,value]of Object.entries({schema:'public',connection_limit:ordinary?'2':'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5',application_name:'native_task12_'+plan.runId.replaceAll('-','')+'_'+i}))url.searchParams.set(key,value);
   return ordinary?loader.createNativeTask12OrdinaryClient(url.toString()):new modules.PrismaService({datasources:{db:{url:url.toString()}}});});
  state.setClients(docClients);await wait(()=>Promise.all(docClients.map(client=>client.$connect())));check();
  const [templateClient,workerClient,queueClient,ordinary]=docClients;
  // The ordinary app pool is never the owner/runtime/observer or any worker.
  const documentIdentitySql=require('./task12-current259-document-login.cjs').nativeTask12DocumentClientIdentitySql;
  const observedDocuments=await wait(()=>Promise.all(docClients.map(async(client,i)=>{const challenge=randomBytes(32).toString('hex'),rows=await client.$queryRawUnsafe(documentIdentitySql,challenge);
   need(rows.length===1&&rows[0].challenge===challenge&&rows[0].role===login.roles[i].name&&rows[0].sessionRole===login.roles[i].name&&rows[0].oid===login.roles[i].oid&&rows[0].database===plan.database&&rows[0].databaseOid===identity.databaseOid&&rows[0].ssl===true&&rows[0].clientAddress==='127.0.0.1'&&rows[0].serverAddress==='127.0.0.1'&&rows[0].serverPort===port,'NATIVE_DIRECT_DOCUMENT_IDENTITY');return rows[0];})));
  need(new Set(observedDocuments.map(row=>row.pid)).size===4&&new Set(observedDocuments.map(row=>row.clientPort)).size===4,'NATIVE_DIRECT_DOCUMENT_SEPARATION');
  const observeDocumentPools=async()=>{
   check();const ids=login.roles.map(role=>"'"+role.oid+"'::oid").join(',');
   const query=`SELECT jsonb_build_object('ownerPid',pg_backend_pid(),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),'server',host(inet_server_addr()),'port',inet_server_port(),'database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10),'namespaceOid',to_regnamespace('public')::oid::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'actorOid',current_user::regrole::oid::text,'sessionActor',session_user,'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',a.usesysid::text,'role',a.usename,'pid',a.pid,'start',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'ssl',s.ssl,'clientAddress',host(a.client_addr),'clientPort',a.client_port) ORDER BY a.usesysid,a.pid),'[]'::jsonb) FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid=a.pid WHERE a.datid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND a.usesysid IN (${ids})));`;
   const raw=await ownerSql(query,'DOCUMENT_CURRENT_POOLS');
   const rows=assertNativeTask12DocumentPools(raw.stdout,JSON.stringify({database:plan.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,systemIdentifier:identity.systemIdentifier,port,roles:login.roles,observed:observedDocuments}));
   receipt.documentClients=rows;check();return rows;
  };
  await observeDocumentPools();
  const expected={database:plan.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,storageRoot:env.FILE_STORAGE_ROOT,
   roleOids:Object.fromEntries(['template','worker','queue'].map((slot,i)=>[slot,login.roles[i].oid])),serverPort:port,nativeProfile:'TASK12_NATIVE_HOST_EQUIPMENT_V1'};
  const ownerApi=require('./task12-current261-local-lifecycle-owner.cjs');
  const final=await wait(()=>modules.withTask12NativeHostDocumentRoleServices({template:templateClient,worker:workerClient,queue:queueClient},expected,async(operations,providers)=>{
   const config=Object.freeze({fixture,passwords:passwordsByUser,sourceDocx,originals,signal});
   const bridge=Object.freeze({check,loader,loaded:modules,ordinary,providers,queue:operations.queue.queueDraftPreview,publicLifecycle:config,
    async exercise(http){
     let window,first,result,closed;
     try{
      official.checkMaterials();check();window=await ownerApi.beginNativeTask12LifecycleOwnerWindow(contract.loginResult,modules,fixture,ownerSql);check();receipt.business='ENTERED';
      const input=Object.freeze({fixture,passwords:Object.freeze(passwords),sourceDocx,originals,bridge:http,signal,readPdfDrawnText:async(bytes,abort)=>{check();const pages=await official.readPdfDrawnText(bytes,abort);check();return pages;}});
      enter('CONTRACT_SUBMIT_APPROVE_SEAL');const signed=await modules.runTask12LocalLifecycleCase(input);check();await ownerApi.observeCurrent261LocalLifecycleOwner(window,signed);check();
      official.checkMaterials();await ownerApi.installCurrent261LocalLifecycleAuditFault(window);check();
      const rollback=await modules.expectTask12LocalLifecycleAuditRollback(signed);check();await ownerApi.observeCurrent261LocalLifecycleOwner(window,rollback);check();
      await ownerApi.removeCurrent261LocalLifecycleAuditFault(window);check();official.checkMaterials();
      enter('CONTRACT_SIGNED_ARCHIVE_AND_DOWNLOAD');result=await modules.finishTask12LocalLifecycleCase(rollback);check();
      const facts=await ownerApi.observeCurrent261LocalLifecycleOwner(window,result);check();
      const checkpoint=modules.claimTask12LocalLifecycleCheckpoint(result);
      const evidence=Buffer.from(JSON.stringify({schemaVersion:1,purpose:PURPOSE,candidateSha:plan.source.head,runId:plan.runId,caseKey:fixture.case.key,
       checkpoint,ownerFacts:facts,full394Accepted:false,cosAccepted:false,browserAccepted:false})+'\n');need(evidence.length<=32768,'NATIVE_DIRECT_CONTRACT_EVIDENCE_BYTES');
      receipt.contractCase={status:'ORIGINAL_COMPLETE_CHECKPOINT_OBSERVED_NOT_FINAL_ACCEPTANCE',caseKey:fixture.case.key,projectId:checkpoint.projectId,versionId:checkpoint.versionId,stage:checkpoint.stage,ownerSubjectsMatched:true,full394Accepted:false};
      try{receipt.contractEvidence=writeNew(root,'contract-equipment-evidence.json',evidence);}catch{receipt.contractEvidence={status:'UNKNOWN_DO_NOT_RETRY'};fail('NATIVE_DIRECT_CONTRACT_EVIDENCE_UNKNOWN');}
     }catch(error){first=error;}
     finally{if(window)try{closed=await ownerApi.closeCurrent261LocalLifecycleOwnerWindow(window);}catch(error){if(first)receipt.ownerCleanup='UNKNOWN_DO_NOT_CONTINUE';else first=error;}}
     if(first)throw first;need(closed?.matched===true,'NATIVE_DIRECT_CONTRACT_OWNER_CLOSE');receipt.ownerClosed=closed;return result;
    }});
   return require('./task12-current259-document-application.cjs').runNativeTask12DocumentApplication(contract.loginResult,bridge);
  }));
  check();official.checkMaterials();need(modules.claimTask12LocalLifecycleCheckpoint(final).stage==='COMPLETE','NATIVE_DIRECT_CONTRACT_RESULT');
  receipt.business='ORIGINAL_EQUIPMENT_CASE_RETURNED';await observeDocumentPools();receipt.bootstrapRoleScope='TLS_CONTROLS_BEFORE_TASK12_ONLY';
  receipt.full394Accepted=false;receipt.cosAccepted=false;receipt.browserAccepted=false;
  return final;
  }finally{clearTimeout(timer);}
 });
}
