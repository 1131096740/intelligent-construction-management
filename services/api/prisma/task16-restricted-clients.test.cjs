"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createHash}=require("node:crypto");
const PROJECT=path.resolve(__dirname,"../../..");
const hash=b=>createHash("sha256").update(b).digest("hex");
const ROLES=["jg_task01_owner","jg_task01_runtime","jg_task01_observer"];
function fixture(t){
 const temporary=fs.mkdtempSync("/private/tmp/jg-task16-clients-protocol-"),root=path.join(temporary,"candidate");fs.mkdirSync(root,{mode:0o700});t.after(()=>fs.rmSync(temporary,{recursive:true}));
 const put=(relative,bytes,mode=0o600)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode});return target;};
 const plan=JSON.parse(fs.readFileSync(path.join(PROJECT,"services/api/prisma/task16-registered-access.json"),"utf8"));
 const files=[...new Set(["services/api/prisma/run-task16-registered-pg-local.cjs","services/api/prisma/task16-runtime-inputs.cjs","services/api/prisma/task16-bounded-command.cjs","services/api/prisma/task16-registered-object-witness.cjs","services/api/prisma/task16-registered-access-check.cjs","services/api/prisma/task16-registered-access-check.sql","services/api/prisma/task16-registered-access.json","services/api/prisma/task16-baseline-access.json","scripts/prepare-task16-registered-pg.cjs","scripts/ops/runtime-manifest.py",...plan.sources.map(row=>row.path),...['task16-restricted-clients.cjs','task16-client-loader.cjs'].map(f=>'services/api/prisma/'+f).filter(f=>fs.existsSync(path.join(PROJECT,f)))])];
 for(const f of files)put(f,fs.readFileSync(path.join(PROJECT,f)));
 const entry=put("services/api/node_modules/@prisma/client/index.js",`"use strict";const support=require('./support.cjs');class FakeClient{constructor(options){this.options=options;this.marker=support.marker;this.connected=false;}async $connect(){this.connected=true;}async $disconnect(){this.connected=false;}};module.exports={PrismaClient:FakeClient,Prisma:{prismaVersion:{client:'5.22.0',engine:'605197351a3c8bdd595af2d2a9bc3025bca48ea2'}}};\n`);
 put("services/api/node_modules/@prisma/client/support.cjs","module.exports={marker:'only-owned-no-engine-fake'};\n");put("services/api/node_modules/@prisma/client/package.json",'{"main":"index.js"}\n');
 const roots=["node_modules","services/api/node_modules","packages/shared-domain/node_modules","services/api/dist","packages/shared-domain/dist"];
 for(const tree of roots)put(tree+"/marker.txt","synthetic tree bytes\n");
 const manifests=path.join(temporary,"manifests");fs.mkdirSync(manifests,{mode:0o700});
 function captureTree(relative,index){const entries={};const walk=file=>{const s=fs.lstatSync(file),row={mode:s.mode&0o777,uid:s.uid,gid:s.gid};if(s.isDirectory()){row.kind="dir";for(const name of fs.readdirSync(file).sort())walk(path.join(file,name));}else{row.kind="file";row.bytes=s.size;row.sha256=hash(fs.readFileSync(file));}entries[path.relative(path.join(root,relative),file)||"."]=row;};walk(path.join(root,relative));const manifest=path.join(manifests,index+".json");fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,status:"captured",root:path.join(root,relative),entries}),{mode:0o600});return{root:relative,manifest,sha256:hash(fs.readFileSync(manifest))};}
 const trees=roots.map(captureTree);const tools={};const node=fs.realpathSync(process.execPath);tools.node={path:node,sha256:hash(fs.readFileSync(node))};const python=put("private-tools/python","#!/bin/sh\nexit 99\n",0o700);tools.python={path:python,sha256:hash(fs.readFileSync(python))};
 const source={candidateSha:"a".repeat(40),candidateRoot:root,sealSha256:"b".repeat(64),runtimeAdmission:{status:"INPUTS_AND_CODE_TREES_MATCHED",clientEntry:{path:entry,sha256:hash(fs.readFileSync(entry)),identity:Object.fromEntries(["dev","ino","size","mode","uid","gid","mtimeMs","ctimeMs"].map(key=>[key,fs.statSync(entry)[key]]))}},migrations:Array.from({length:202},(_,i)=>({path:`services/api/prisma/migrations/${String(20260101000000+i)}_synthetic/migration.sql`,sha256:"c".repeat(64)})),executionFiles:files.map(f=>({path:f,sha256:hash(fs.readFileSync(path.join(root,f)))})),inputs:{candidateRoot:root,sourceSha:"a".repeat(40),tools,trees,docker:{endpoint:"unix:///Users/leoyang/.docker/run/docker.sock",daemonId:"synthetic-daemon",imageId:"sha256:"+"f".repeat(64)}}};
 const gitDir=path.join(temporary,"owner-git/worktrees/candidate");fs.mkdirSync(gitDir,{recursive:true,mode:0o700});const gitFile=put(".git",`gitdir: ${gitDir}\n`);fs.writeFileSync(path.join(gitDir,"gitdir"),gitFile+"\n",{mode:0o600});
 const preparationFile=path.join(temporary,"preparation.json");fs.writeFileSync(preparationFile,JSON.stringify({schemaVersion:1,purpose:"witnessed-fresh-task16-build-ownership-not-approval",candidateRoot:root,sourceSha:source.candidateSha,worktreeGitDir:gitDir,worktreeGitFileSha256:hash(fs.readFileSync(gitFile)),buildSteps:["shared-domain:build","api:build"],outputs:trees.filter(t=>t.root.endsWith("/dist")).map(t=>({root:t.root,originallyAbsent:true,preparedManifestSha256:t.sha256}))}),{mode:0o600});source.inputs.preparationReceipt={path:preparationFile,sha256:hash(fs.readFileSync(preparationFile))};
 const packetFile=path.join(temporary,"packet.json"),inputsFile=path.join(temporary,"inputs.json"),artifactsDir=path.join(temporary,"artifacts");fs.mkdirSync(artifactsDir,{mode:0o700});fs.writeFileSync(packetFile,JSON.stringify({candidateSha:source.candidateSha,sealSha256:source.sealSha256,migrations:source.migrations,source:{repo:root,files:source.executionFiles}}),{mode:0o600});fs.writeFileSync(inputsFile,JSON.stringify(source.inputs),{mode:0o600});const options={packetFile,expectedPacketSha256:hash(fs.readFileSync(packetFile)),inputsFile,expectedInputsSha256:hash(fs.readFileSync(inputsFile)),artifactsDir};
 const ca=path.join(temporary,"ca.crt");fs.writeFileSync(ca,"synthetic CA bytes only\n",{mode:0o600});
 const calls=[],clients=[],hooks={},identity={databaseOid:"16384",systemIdentifier:"7234567890123456789",ownerOid:"10000",runtimeOid:"20001",observerOid:"20002"};let resource,receipt,credentials;
 const codeHash=name=>hash(fs.readFileSync(path.join(root,"services/api/prisma/"+name)));
 const baselinePlan=JSON.parse(fs.readFileSync(path.join(root,"services/api/prisma/task16-baseline-access.json"),"utf8"));
 const adapters={verifySource:async()=>source,startResource:async c=>{credentials={...c.credentials};receipt={...source.inputs.docker,runId:c.runId,sourceSha:source.candidateSha,containerId:"d".repeat(64),networkId:"e".repeat(64),databaseName:`jg_task01_${c.runId.replaceAll("-","")}`,port:15432,status:"started-awaiting-driver-verification",cleanup:{status:"pending"},requestedCertificateMode:"correct",reloadState:"OBSERVED_PEER_CERTIFICATE_MATCHED",presentedCertificate:{mode:"correct",derSha256:"1".repeat(64)},tls:{caSha256:hash(fs.readFileSync(ca)),correctCertificateDerSha256:"1".repeat(64)}};resource={containerId:receipt.containerId,networkId:receipt.networkId,port:receipt.port,databaseName:receipt.databaseName,caPath:ca,serverCertHashes:{...receipt.tls},getReceipt:()=>structuredClone(receipt),execOwnerSql:async(sql,label)=>{calls.push(label);if(hooks.owner)await hooks.owner(sql,label);const nonce=/'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1];return{stdout:JSON.stringify({...identity,phase:"clients-check",nonce,database:receipt.databaseName,ownerRole:ROLES[0],loginRole:ROLES[0],ownerIsDatabaseOwner:true,runtimeRole:ROLES[1],observerRole:ROLES[2],tls:true,version:160004,replication:"origin",readOnly:"off",migrationLedger:source.migrations.map(r=>({name:r.path.split('/').at(-2),sha256:r.sha256,finished:true,rolledBack:false})),functionsVerified:true,baselineGuardsVerified:true,matrixVerified:true,guardVerified:true,installedObjectWitness:{columns:[],constraints:[],triggers:[]},otherGranteeAclWitness:[],...hooks.ownerReply})};},close:async()=>{calls.push("resource-close");receipt.status="closed";receipt.cleanup={status:"completed",containerAbsent:true,volumesAbsent:true,networkAbsent:true};}};return resource;},verifyOwnerTransport:async()=>({status:"OWNER_TLS_CONTROLS_VERIFIED",databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,caSha256:hash(fs.readFileSync(ca)),tlsWitness:{caSha256:hash(fs.readFileSync(ca)),correctCertificateDerSha256:"1".repeat(64)}}),migrateBaseline:async()=>({status:"BASELINE_MIGRATIONS_LEDGER_VERIFIED",migrationCount:202}),installBaselineAccess:async c=>({status:"BASELINE_ROLE_ACL_COMMIT_OBSERVED",...identity,sourceSha:source.candidateSha,runtimeRole:ROLES[1],observerRole:ROLES[2],manifestSha256:codeHash("task16-baseline-access.json"),expectedMatrixSha256:hash(JSON.stringify([baselinePlan.runtime,baselinePlan.observer])),resourceWitness:structuredClone(c.resourceWitness)}),installPreparedSql:async c=>({status:"SQL_INSTALLATION_COMMIT_OBSERVED",...identity,candidateSha:source.candidateSha,sourceSealSha256:source.sealSha256,packetSha256:options.expectedPacketSha256,baselineContinuityVerified:true,baselineManifestSha256:c.baselineAccess.manifestSha256,fragmentCount:7,installedObjectWitness:{columns:[],constraints:[],triggers:[]}}),installRegisteredAccess:async c=>({status:"REGISTERED_ACL_COMMIT_OBSERVED",...identity,sourceSha:source.candidateSha,sourceSealSha256:source.sealSha256,manifestSha256:codeHash("task16-registered-access.json"),baselineManifestSha256:c.baselineAccess.manifestSha256,expectedMatrixSha256:hash(JSON.stringify([plan.runtime,plan.observer])),installedObjectWitness:{columns:[],constraints:[],triggers:[]},otherGranteeAclWitness:[]}),connectRestrictedClients:{command:async(exe,args)=>{calls.push("command");if(args[0].endsWith("prepare-task16-registered-pg.cjs"))return{actualSettled:true,code:0,timedOut:false,stdout:JSON.stringify({status:"SOURCE_ONLY_VERIFIED_NOT_EXECUTED",executionAllowed:false,candidateSha:source.candidateSha,sealSha256:source.sealSha256,packetSha256:options.expectedPacketSha256}),stderr:""};const result={status:"passed",differences:[],root:args[args.indexOf("--root")+1],expectedManifest:args[args.indexOf("--expected")+1],actualManifest:args[args.indexOf("--actual-manifest")+1]};fs.writeFileSync(args[args.indexOf("--receipt")+1],JSON.stringify(result),{mode:0o600});return{actualSettled:true,code:0,timedOut:false,stdout:JSON.stringify({status:"passed"}),stderr:""};},createClient:(configuration,Class)=>{const client=new Class({datasources:{db:{url:configuration.url}},log:[]});assert.equal(client.marker,"only-owned-no-engine-fake");client.role=configuration.role;const i=ROLES.indexOf(client.role);const connect=client.$connect.bind(client),disconnect=client.$disconnect.bind(client);client.$connect=async()=>{calls.push("connect-"+client.role);if(hooks.connect)await hooks.connect(client,i);await connect();};client.$disconnect=async()=>{calls.push("disconnect-"+client.role);if(hooks.disconnect)await hooks.disconnect(client,i);await disconnect();};client.$queryRawUnsafe=async(sql,nonce)=>{calls.push("identity-"+client.role);return[{nonce,database:receipt.databaseName,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,effectiveRole:client.role,loginRole:client.role,effectiveOid:identity[["ownerOid","runtimeOid","observerOid"][i]],loginOid:identity[["ownerOid","runtimeOid","observerOid"][i]],pid:12001+i,version:160004,tls:true,replication:"origin",readOnly:i===2?"on":"off",defaultReadOnly:i===2?"on":"off",...hooks.sessions?.[i]}];};client.$transaction=async action=>action(client);clients.push(client);return client;}},startApplication:async c=>{assert.equal(c.clients.runtime,clients[1]);calls.push("app");return{close:async()=>calls.push("app-close")};},seedFixture:async()=>({}),runNormalCase:async()=>({caseId:"registered.null-cross-company.commit",passed:true})};
 const run=()=>require(path.join(root,"services/api/prisma/run-task16-registered-pg-local.cjs")).runTask16RegisteredPg(options,adapters);
 return{run,options,adapters,source,root,temporary,entry,clients,calls,hooks,resource:()=>resource,receipt:()=>receipt,credentials:()=>credentials};
}

test("the real clients stage loads only the owned fake class and connects three distinct role sessions",async t=>{
 const f=fixture(t);const receipt=await f.run();assert.equal(receipt.status,"SIMULATED_CASE_PROTOCOL_COMPLETED",receipt.failureCode);assert.equal(receipt.nativeExecution,false);
 assert.equal(f.clients.length,3);assert.ok(f.clients.every(c=>c.connected===false));
 assert.deepEqual(f.calls.filter(c=>c.startsWith("connect-")),ROLES.map(role=>"connect-"+role));assert.deepEqual(f.calls.filter(c=>c.startsWith("disconnect-")),[...ROLES].reverse().map(role=>"disconnect-"+role));
 assert.equal(f.calls.at(-1),"resource-close");assert.equal(JSON.stringify(receipt).includes(f.credentials().runtime),false);
});

test("a malformed newly owned client is still disconnected before rejecting its shape",async t=>{
 const f=fixture(t),factory=f.adapters.connectRestrictedClients.createClient;f.adapters.connectRestrictedClients.createClient=(...args)=>{const client=factory(...args);delete client.$transaction;return client;};
 const receipt=await f.run();assert.equal(receipt.status,"FAILED_CLOSED");assert.equal(receipt.failureCode,"TASK16_CLIENT_HANDLE");assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),["disconnect-jg_task01_owner"]);assert.equal(f.calls.at(-1),'resource-close');
});

test("a caller witness alias cannot replace the first resource witness",async t=>{
 const f=fixture(t),previous=f.adapters.installRegisteredAccess;f.adapters.installRegisteredAccess=async c=>{const result=await previous(c);f.receipt().containerId="9".repeat(64);f.resource().containerId=f.receipt().containerId;c.baselineAccess.resourceWitness.containerId=f.receipt().containerId;c.witness={...c.resourceWitness,containerId:f.receipt().containerId};return result;};
 const receipt=await f.run();assert.equal(receipt.failureCode,"TASK16_CLIENT_RESOURCE_WITNESS");assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');
});

test("first connection failure still uses the captured owned disconnect method",async t=>{
 const f=fixture(t);f.hooks.connect=client=>{client.$disconnect=async()=>f.calls.push('replacement-disconnect');throw new Error('synthetic connection first failure');};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_FAILED_CLOSED');assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),["disconnect-jg_task01_owner"]);assert.equal(f.calls.includes('replacement-disconnect'),false);assert.equal(f.calls.at(-1),'resource-close');
});

for(const kind of ['command-only','factory-only','extra-key'])test(`incomplete explicit client boundary ${kind} never starts resources`,async t=>{
 const f=fixture(t),b=f.adapters.connectRestrictedClients;f.adapters.connectRestrictedClients=kind==='command-only'?{command:b.command}:kind==='factory-only'?{createClient:b.createClient}:{...b,extra:()=>{}};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_DRIVER_CAPABILITIES_INCOMPLETE');assert.deepEqual(receipt.missingCapabilities,['connectRestrictedClients']);assert.deepEqual(f.calls,[]);assert.equal(receipt.nativeExecution,false);
});
for(const [field,value] of [['effectiveOid','99999'],['loginRole',ROLES[0]],['tls',false],['readOnly','on'],['systemIdentifier','9234567890123456789']])test(`runtime ${field} drift stops before observer construction`,async t=>{
 const f=fixture(t);f.hooks.sessions={1:{[field]:value}};const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_SESSION_IDENTITY');assert.equal(f.clients.length,2);assert.ok(f.clients.every(c=>c.connected===false));assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),[...ROLES].slice(0,2).reverse().map(r=>'disconnect-'+r));assert.equal(f.calls.includes('app'),false);assert.equal(f.calls.at(-1),'resource-close');
});
test('three client objects cannot share the owner backend PID',async t=>{
 const f=fixture(t);f.hooks.sessions={2:{pid:12001}};const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_SHARED_SESSION');assert.equal(f.clients.length,3);assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.at(-1),'resource-close');
});
test('observer must have actual and default readonly on',async t=>{
 const f=fixture(t);f.hooks.sessions={2:{defaultReadOnly:'off'}};const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_SESSION_IDENTITY');assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.at(-1),'resource-close');
});
test('the B6 prior unrelated-grantee witness cannot be replaced with a new observation',async t=>{
 const f=fixture(t);f.hooks.ownerReply={otherGranteeAclWitness:[{synthetic:'drift'}]};const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_CATALOG_CONTINUITY');assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');
});
test('an already-loaded owned fake client module is rejected without constructing another client',async t=>{
 const f=fixture(t);require(f.entry);const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_PRELOADED_MODULE');assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');
});
test('the same long-lived simulated controller cannot reuse its earlier loaded class',async t=>{
 const f=fixture(t);assert.equal((await f.run()).status,'SIMULATED_CASE_PROTOCOL_COMPLETED');const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_PRELOADED_MODULE');assert.equal(f.clients.length,3);assert.equal(f.calls.at(-1),'resource-close');
});
test('a loaded fake dependency changed during connect stops before another role',async t=>{
 const f=fixture(t);f.hooks.connect=(client,i)=>{if(i===0)fs.appendFileSync(path.join(path.dirname(f.entry),'support.cjs'),'// synthetic changed bytes\n');};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_MODULE_CHANGED');assert.equal(f.clients.length,1);assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.at(-1),'resource-close');
});
test('a changed parent loading hook is rejected and restored only by the test owner',async t=>{
 const f=fixture(t),M=require('node:module'),original=M._load;t.after(()=>{M._load=original;});f.hooks.connect=(client,i)=>{if(i===0)M._load=function(...args){return original.apply(this,args);};};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_LOADER_HOOK_CHANGED');assert.equal(f.clients.length,1);assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.at(-1),'resource-close');
});
test('second role connection failure closes both owned handles and redacts credentials',async t=>{
 const f=fixture(t);f.hooks.connect=(client,i)=>{if(i===1)throw new Error('synthetic '+f.credentials().runtime+' '+client.options.datasources.db.url);};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_FAILED_CLOSED');assert.equal(receipt.clientConnectionOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(f.clients.length,2);assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.includes('app'),false);assert.equal(JSON.stringify(receipt).includes(f.credentials().runtime),false);assert.equal(JSON.stringify(receipt).includes('postgresql://'),false);assert.equal(f.calls.at(-1),'resource-close');
});
test('cleanup failure does not replace first failure or skip the remaining owned clients',async t=>{
 const f=fixture(t);f.hooks.connect=(client,i)=>{if(i===1)throw new Error('synthetic first connect failure');};f.hooks.disconnect=(client,i)=>{if(i===1)throw new Error('synthetic disconnect failure');};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_FAILED_CLOSED');assert.equal(receipt.clientCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');assert.deepEqual(receipt.cleanupFailures,['clients']);assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),[ROLES[1],ROLES[0]].map(r=>'disconnect-'+r));assert.equal(f.calls.at(-1),'resource-close');
});
test('caller abort after the connected handle is returned still disconnects all acquired clients',async t=>{
 const f=fixture(t),controller=new AbortController();f.options.signal=controller.signal;f.hooks.connect=(client,i)=>{if(i===1)controller.abort();};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_ABORTED');assert.equal(f.clients.length,2);assert.ok(f.clients.every(c=>c.connected===false));assert.equal(f.calls.at(-1),'resource-close');
});
test('fixed per-role URLs use the admitted CA and no second pool or implicit datasource',async t=>{
 const f=fixture(t),factory=f.adapters.connectRestrictedClients.createClient;f.adapters.connectRestrictedClients.createClient=(configuration,Class)=>{const u=new URL(configuration.url),index=ROLES.indexOf(configuration.role);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.username,configuration.role);assert.equal(u.password===f.credentials()[['owner','runtime','observer'][index]],true,'synthetic role credential must match');assert.equal(u.searchParams.get('connection_limit'),'1');assert.equal(u.searchParams.get('sslmode'),'require');assert.equal(u.searchParams.get('sslaccept'),'strict');assert.equal(u.searchParams.get('sslcert'),f.resource().caPath);assert.equal([...u.searchParams.keys()].length,8);return factory(configuration,Class);};
 const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(receipt.nativeExecution,false);
});
test('the shared checker is defined before the readonly segment and never reinstalls product ACL',async t=>{
 const f=fixture(t);f.hooks.owner=sql=>{const at=sql.indexOf('BEGIN READ ONLY;');assert.ok(at>0);assert.ok(sql.slice(0,at).includes('CREATE FUNCTION pg_temp.jg_task16_registered_check'));const readonly=sql.slice(at);assert.equal(/\n(?:CREATE|GRANT|REVOKE|ALTER|INSERT|UPDATE|DELETE) /u.test(readonly),false);assert.equal(sql.includes('DO $column_grants$'),false);};const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);
});

test('an owned client with a throwing public query getter retains its known disconnect',async t=>{
 const f=fixture(t),factory=f.adapters.connectRestrictedClients.createClient;f.adapters.connectRestrictedClients.createClient=(...args)=>{const client=factory(...args);Object.defineProperty(client,'$queryRawUnsafe',{get(){throw new Error('synthetic public query getter failure');}});return client;};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_FAILED_CLOSED');assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),["disconnect-jg_task01_owner"]);assert.equal(f.calls.at(-1),'resource-close');
});

test('a loading hook present before the driver cannot become the trusted baseline',async t=>{
 const f=fixture(t),M=require('node:module'),original=M._load;t.after(()=>{M._load=original;});M._load=function(...args){return original.apply(this,args);};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_LOADER_HOOK_CHANGED');assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');
});

test('a throwing then getter cannot hide a returned owned client from cleanup',async t=>{
 const f=fixture(t),factory=f.adapters.connectRestrictedClients.createClient;f.adapters.connectRestrictedClients.createClient=(...args)=>{const client=factory(...args);Object.defineProperty(client,'then',{get(){throw new Error('synthetic then getter failure');}});return client;};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_FAILED_CLOSED');assert.equal(receipt.clientConnectionOutcome,'UNKNOWN_DO_NOT_RETRY');assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),["disconnect-jg_task01_owner"]);assert.equal(receipt.clientCleanupOutcome,'DISCONNECTED');assert.equal(f.calls.at(-1),'resource-close');
});

test('an engine redirect introduced during source verification is rejected before class construction',async t=>{
 const f=fixture(t),key='PRISMA_QUERY_ENGINE_LIBRARY',prior=process.env[key];t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});
 const command=f.adapters.connectRestrictedClients.command;let changed=false;f.adapters.connectRestrictedClients.command=async(...args)=>{const result=await command(...args);if(!changed){changed=true;process.env[key]=path.join(f.temporary,'unsealed-synthetic-engine.node');}return result;};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_ENVIRONMENT');assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');assert.equal(receipt.nativeExecution,false);
});

for(const phase of ['construct','connect'])test(`an engine redirect introduced at ${phase} stops before another client`,async t=>{
 const f=fixture(t),key='PRISMA_QUERY_ENGINE_BINARY',prior=process.env[key];t.after(()=>{if(prior===undefined)delete process.env[key];else process.env[key]=prior;});
 const redirect=()=>{process.env[key]=path.join(f.temporary,'unsealed-synthetic-engine');};
 if(phase==='construct'){const factory=f.adapters.connectRestrictedClients.createClient;f.adapters.connectRestrictedClients.createClient=(...args)=>{const client=factory(...args);redirect();return client;};}else f.hooks.connect=()=>redirect();
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_ENVIRONMENT');assert.equal(f.clients.length,1);assert.ok(f.clients.every(c=>c.connected===false));assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),[ROLES[0]].map(role=>'disconnect-'+role));assert.equal(f.calls.filter(c=>c.startsWith('connect-')).length,phase==='construct'?0:1);assert.equal(f.calls.at(-1),'resource-close');assert.equal(receipt.nativeExecution,false);
});

test('a dotenv file introduced during the command await is rejected before class construction',async t=>{
 const f=fixture(t),command=f.adapters.connectRestrictedClients.command;let written=false;
 f.adapters.connectRestrictedClients.command=async(...args)=>{const result=await command(...args);if(!written){written=true;fs.writeFileSync(path.join(f.root,'services/api/prisma/.env'),'PRISMA_QUERY_ENGINE_LIBRARY=synthetic-unsealed-engine\n',{mode:0o600});}return result;};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_DOTENV');assert.equal(f.clients.length,0);assert.equal(f.calls.at(-1),'resource-close');assert.equal(receipt.nativeExecution,false);
});

test('a dotenv file introduced by construction closes the owned client before connect',async t=>{
 const f=fixture(t),factory=f.adapters.connectRestrictedClients.createClient;
 f.adapters.connectRestrictedClients.createClient=(...args)=>{const client=factory(...args);fs.writeFileSync(path.join(f.root,'.env'),'PRISMA_QUERY_ENGINE_BINARY=synthetic-unsealed-engine\n',{mode:0o600});return client;};
 const receipt=await f.run();assert.equal(receipt.failureCode,'TASK16_CLIENT_DOTENV');assert.equal(f.clients.length,1);assert.equal(f.calls.some(c=>c.startsWith('connect-')),false);assert.deepEqual(f.calls.filter(c=>c.startsWith('disconnect-')),[ROLES[0]].map(role=>'disconnect-'+role));assert.equal(f.calls.at(-1),'resource-close');assert.equal(receipt.nativeExecution,false);
});
