"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=path.join(__dirname,'enterprise-task01-resources.cjs');
const options=()=>({runId:'12345678-1234-4234-8234-123456789012',sourceSha:'a'.repeat(40),artifactsDir:'/private/tmp/lifetime-model/run',endpoint:'unix:///Users/leoyang/.docker/run/docker.sock',daemonId:'synthetic-daemon-12345',imageId:'sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d',tools:{docker:'/synthetic/docker',openssl:'/synthetic/openssl'},ownerPassword:'b'.repeat(96)});
function fixture(){
 const receipts=[],writes=[],commands=[];
 const stat={uid:process.getuid(),mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>true};
 const mockFs={constants:{X_OK:1},realpathSync:file=>file,statSync:()=>stat,lstatSync:()=>stat,existsSync:()=>false,accessSync(){},mkdirSync(){},renameSync(){},unlinkSync(){},writeFileSync(file,bytes){writes.push(file);if(file.endsWith('resource-manifest.pending'))receipts.push(JSON.parse(bytes));}};
 const api={exports:{}};const req=name=>name==='node:fs'?mockFs:name==='node:child_process'?{spawn(...args){commands.push(args);throw Error('SYNTHETIC_STOP_BEFORE_TOOL');}}:require(name);
 new Function('require','module',fs.readFileSync(source,'utf8'))(req,api);
 return {api:api.exports,receipts,writes,commands};
}
test('old physical resource still rejects900001 before preparation or tool IO',async()=>{
 const f=fixture();await assert.rejects(f.api.startTask01Postgres({...options(),deadlineMs:900001}),/TASK01_RESOURCE_INPUT_INVALID/);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.commands,[]);
});
test('named technical physical resource fixes3600000 while old default remains900000',async()=>{
 for(const [entry,deadline] of [['startTask01Postgres',900000],['startCurrent259TechnicalPostgres',3600000]]){
  const f=fixture();await assert.rejects(f.api[entry](options()));
  assert.equal(f.receipts[0].limits.totalDeadlineMs,deadline);
  assert.equal(f.receipts[0].purpose,deadline===3600000?'CURRENT259_TECHNICAL_MIGRATIONS_V1':undefined);
  assert.ok(f.commands.length>0,'only synthetic spawn boundary is reached');
 }
});
test('named technical entry rejects caller deadlines/purpose/max flags before preparation',async()=>{
 for(const extra of [{deadlineMs:900000},{deadlineMs:3600000},{deadlineMs:3600001},{purpose:'CURRENT259_TECHNICAL_MIGRATIONS_V1'},{maxDeadlineMs:7200000},{technical:true}]){
  const f=fixture();await assert.rejects(f.api.startCurrent259TechnicalPostgres({...options(),...extra}),/TASK01_RESOURCE_INPUT_INVALID/);
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.commands,[]);
 }
});

test('the fixed contract rules extend the original bytes only before the two final TLS rejects',()=>{
 const raw={exports:{}};
 const body=fs.readFileSync(source,'utf8')+'\nmodule.exports={hbaRules,renderHba,ROLES,CONTRACT_LOGINS};';
 new Function('require','module',body)(require,raw);
 const {hbaRules,renderHba,ROLES,CONTRACT_LOGINS}=raw.exports;
 const database='jg_task01_'+'1'.repeat(32);
 const fixedRoles=['jg_task01_owner','jg_task01_runtime','jg_task01_observer'];
 assert.deepEqual(ROLES,fixedRoles);
 const original=[
  'local all jg_task01_owner peer map=jg_task01_init','local all all reject',
  'hostnossl all all 0.0.0.0/0 reject','hostnossl all all ::/0 reject',
  ...fixedRoles.flatMap(role=>[`hostssl ${database} ${role} 0.0.0.0/0 scram-sha-256`,`hostssl ${database} ${role} ::/0 scram-sha-256`]),
  'hostssl all all 0.0.0.0/0 reject','hostssl all all ::/0 reject',
 ];
 assert.equal(renderHba(hbaRules(database,ROLES)),original.join('\n')+'\n');
 const five=['jg_fixture_app_'+'a'.repeat(24),...CONTRACT_LOGINS];
 const extended=hbaRules(database,[...ROLES,...five]);
 assert.equal(extended.length,22);
 assert.equal(renderHba([...extended.slice(0,10),...extended.slice(20)]),original.join('\n')+'\n');
 assert.deepEqual(extended.slice(10,20),five.flatMap(role=>['0.0.0.0','::'].map(ip=>['hostssl',database,role,ip,'scram-sha-256',[]])));
});

test('fixed plaintext evidence only counts fresh complete explicit FATAL lines for the bound role and database',()=>{
 const raw={exports:{}};
 new Function('require','module',fs.readFileSync(source,'utf8')+'\nmodule.exports={contractPlaintextReadback,sha};')(require,raw);
 const {contractPlaintextReadback,sha}=raw.exports;
 const role='jg_fixture_app_'+'a'.repeat(24),db='jg_task01_'+'1'.repeat(32);
 const prefix='2026-11-11T14:47:23.804940290Z 2026-11-11 14:47:23.804 UTC [58] ';
 const good=`${prefix}user=${role} db=${db} FATAL:  pg_hba.conf rejects connection for host "172.29.0.1", user "${role}", database "${db}", no encryption\n`;
 const before={stdout:Buffer.alloc(0),stderr:Buffer.from(good)};
 const cursor={stdoutBytes:before.stdout.length,stderrBytes:before.stderr.length,stdoutSha256:sha(before.stdout),stderrSha256:sha(before.stderr)};
 const check=(tail,initial=before.stderr)=>contractPlaintextReadback({stdout:before.stdout,stderr:Buffer.concat([initial,Buffer.from(tail)])},cursor,role,db);
 assert.equal(check(good),true);
 for(const tail of ['',good.trimEnd(),good.replace('FATAL:','DETAIL:'),good.replace('rejects connection for host','no entry for host'),
  good.replace('no encryption','SSL encryption'),good.replace(db,'wrong_db'),good.replace(role,'wrong_role'),
  good.replace(`user "${role}"`,'user "another"'),good.replace(`database "${db}"`,'database "another"'),
  good.replace('172.29.0.1','invalid'),good.replace('[58]','[0]'),good.replace('no encryption','no encryption extra')]){
  assert.equal(check(tail),false);
 }
 const changed=Buffer.from(before.stderr);changed[0]=0;
 assert.throws(()=>check(good,changed),/TASK01_RESOURCE_CONTRACT_PLAINTEXT_WINDOW/u);
});

test('the fixed first-rollback starter claims its own transport without arbitrary arguments',async()=>{
 const f=fixture();
 const config={...options(),tools:{...options().tools,docker:'/Applications/Docker.app/Contents/Resources/bin/docker'},signal:new AbortController().signal};
 assert.equal(typeof f.api.startCurrent259FirstRollbackPostgres,'function');
 await assert.rejects(f.api.startCurrent259FirstRollbackPostgres({...config,transport:'external'}),/TASK01_RESOURCE_INPUT_INVALID/);
 assert.equal(f.commands.length,0);
 await assert.rejects(f.api.startCurrent259FirstRollbackPostgres(config),error=>{
  assert.equal(error.resourceReceipt?.topology,'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS');
  assert.equal(error.resourceReceipt?.relay,null);
  assert.equal(error.resourceReceipt?.startupFailure.stage,'daemon-and-image');
  return true;
 });
 assert.equal(f.receipts[0].purpose,'CURRENT259_TECHNICAL_MIGRATIONS_V1');
 assert.equal(f.receipts[0].limits.totalDeadlineMs,3600000);
});

function rollbackResourceModel(mode,{firstQ2=false,starter="startCurrent259FirstRollbackPostgres",document=false,save=false,lifecycle=false,privateScopeError}={}){
 if(lifecycle)save=true;
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),crypto=require('node:crypto');
 const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
 const config={...options(),tools:{docker,openssl:'/synthetic/openssl'},signal:new AbortController().signal};
 const networkId='d'.repeat(64),containerId='c'.repeat(64),name='jg-task01-'+config.runId;
 const database='jg_task01_'+config.runId.replaceAll('-','');
 const labels={'io.jiangkong.task01.run':config.runId,'io.jiangkong.task01.task':'enterprise-task01','io.jiangkong.task01.source':config.sourceSha};
 const files=new Map(),written=new Map(),calls=[];
 const owner='jg_task01_owner',logins=['jg_fixture_app_'+'1'.repeat(24),'jg_c259_outside_issuer_login','jg_c259_outside_executor_login',
  'jg_c259_upward_issuer_login','jg_c259_upward_runtime_login'];
 const fixedRoles=[owner,'jg_task01_runtime','jg_task01_observer'],documentRoles=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'];
 if(save)documentRoles.push(mode==='document-bad-ordinary'?'jg_task01_runtime':'jg_fixture_app_0123456789abcdef01234567');
 const addedRoles=[...fixedRoles,...(document?documentRoles:logins)],hbaPath='/jg-task01/pg_hba.conf';
 const docHandle=Object.freeze({}),docProof=Object.freeze({sourceSha:config.sourceSha,runId:mode==='document-foreign-scope'?'00000000-0000-4000-8000-000000000001':config.runId,containerId,installXid:'903',
  roleOids:Object.freeze(save?['17000','17001','17002','17009']:['17000','17001','17002']),
  roleXmins:Object.freeze(documentRoles.map(()=> '903')),
  ...(save?{purpose:lifecycle?'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1':'CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1',ordinaryName:documentRoles[3]}:{}),
  ...(lifecycle?{effectivePlanSha256:'e'.repeat(64),installation:'ARCHIVE261_REGISTERED_SEVEN'}:{})});
 let docScopeActive=true,reloadObserved=false,ownerReads=0;
 const documentProbes=[],documentRenders=[];
 const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const entries=[
  ['local','all',owner,null,null,'peer',['map=jg_task01_init']],['local','all','all',null,null,'reject',[]],
  ['hostnossl','all','all','0.0.0.0','0.0.0.0','reject',[]],['hostnossl','all','all','::','::','reject',[]],
  ...addedRoles.map(role=>['hostssl',database,role,'127.0.0.1',mode==='wrong-q2-netmask'?'255.255.255.0':'255.255.255.255','scram-sha-256',[]]),
  ['hostssl','all','all','0.0.0.0','0.0.0.0','reject',[]],['hostssl','all','all','::','::','reject',[]]
 ];
 let appliedHbaSha;
 const fileStat={uid:process.getuid(),mode:0o100600,isFile:()=>true,isSymbolicLink:()=>false};
 const dirStat={...fileStat,mode:0o40700,isDirectory:()=>true};
 const fsModel={constants:{X_OK:1},realpathSync:v=>v,statSync:()=>fileStat,lstatSync:v=>files.has(v)?fileStat:dirStat,
  existsSync:v=>files.has(v),accessSync(){},mkdirSync(){},chmodSync(){},rmdirSync(){},
  renameSync(from,to){files.set(to,files.get(from));files.delete(from);},unlinkSync(v){files.delete(v);},
  readFileSync:v=>Buffer.from(files.get(v)),writeFileSync(v,b){files.set(v,b);written.set(v,b);}};
 let network=false,container=false,running=false,relayOpen=false,log='',tmpfs={},logReadFailure=false,relayFailure,ownerSqlFailure;
 const output=(args,tool,input)=>{
  if(tool!==docker){
   const write=args.indexOf('-out');if(write>=0)files.set(args[write+1],path.basename(args[write+1]));
   const failed=args[0]==='verify'&&(args[2].endsWith('wrong-ca.crt')||
     args[3]==='-verify_ip'&&args[4]==='127.0.0.1'&&args[5].endsWith('wrong-san.crt'));
   return [failed?1:0,''];
  }
  const [kind,operation]=args.slice(2);
  calls.push(args.slice(2));
  switch(kind+' '+operation){
   case 'info --format':
    if(mode==='document-scope-before-spawn'&&ownerReads===1&&!appliedHbaSha)docScopeActive=false;
    return [0,config.daemonId];
   case 'image inspect':return [0,JSON.stringify({Id:config.imageId,Config:{Env:['PG_MAJOR=16','PGDATA=/var/lib/postgresql/data']}})];
   case 'network create':
    assert.ok(args.includes('--internal'));network=true;return [0,networkId];
   case 'network inspect':return [0,JSON.stringify({Id:networkId,Name:name,Internal:true,Driver:'bridge',Labels:labels,Containers:running?{[containerId]:{}}:{}})];
   case 'container create':
    assert.ok(!args.includes('--publish'));assert.ok(!args.includes('-P'));
    tmpfs=Object.fromEntries(args.flatMap((arg,i)=>arg==='--tmpfs'?[args[i+1].split(':')]:[]));
    container=true;return [0,containerId];
   case 'container inspect':return [0,JSON.stringify({Id:containerId,Name:'/'+name,Image:config.imageId,Config:{Labels:labels},
    HostConfig:{NetworkMode:networkId,Memory:1073741824,MemorySwap:1073741824,NanoCpus:2000000000,PidsLimit:256,Tmpfs:tmpfs,
     PortBindings:mode==='publish-drift'?{'5432/tcp':[{}]}:{},PublishAllPorts:false},Mounts:[],
    State:{Running:running},NetworkSettings:{Networks:{[name]:{NetworkID:networkId}},Ports:{'5432/tcp':null}}})];
   case 'container start':running=true;return [0,containerId];
   case 'container ls':return [0,container?containerId:''];
   case 'container rm':
    assert.equal(relayOpen,false,'listener must be stopped before Docker remove');container=false;running=false;return [0,containerId];
   case 'network ls':return [0,network?networkId:''];
   case 'network rm':network=false;return [0,networkId];
   case 'cp '+config.artifactsDir+'/tls-private/bundle':return [0,''];
   case 'exec '+containerId:return [0,'postgres'];
   case 'exec --user':
    if(args.includes('sha256sum'))return [0,`${appliedHbaSha}  ${hbaPath}\n`];
    return [0,'accepting connections'];
   case 'exec --interactive':
    if(args.includes('psql')&&ownerSqlFailure)return [3,'',ownerSqlFailure];
    assert.equal(firstQ2,true,'only Q2 runs contract HBA installation in this model');
    if(args.includes('sh')){
     assert.equal(args.at(-2),digest(written.get(config.artifactsDir+'/tls-private/bundle/pg_hba.conf')));
     appliedHbaSha=digest(input);
     assert.equal(args.at(-1),appliedHbaSha);
     assert.deepEqual(input.trim().split('\n').filter(line=>line.includes('127.0.0.1/32')),
      addedRoles.map(role=>`hostssl ${database} ${role} 127.0.0.1/32 scram-sha-256`));
     return [0,appliedHbaSha+'\n'];
    }
    if(document&&input.includes("configuredAt")){
     documentRenders.push(input);ownerReads++;
     assert.ok(args.includes('PGSSLMODE=verify-full'));
     assert.match(input,/pg_xact_status\('903'::xid8\)='committed'/u);
     assert.ok(docProof.roleOids.every(oid=>input.includes(`'${oid}'::oid`)));
     if(save)assert.match(input,/CASE WHEN e.pos=4 THEN 2 ELSE 1 END/u);
     const observed=entries.filter(entry=>appliedHbaSha||!documentRoles.includes(entry[2]));
     const rows=observed.map(([type,db,role,address,mask,auth,options],i)=>
      [i+1,i+1,hbaPath,type,[db],[role],address,mask,auth,options,null]);
     if(mode==='document-old-rule-drift'&&!appliedHbaSha)rows[6][7]='255.255.255.0';
     if(mode==='document-post-rule-drift'&&appliedHbaSha)rows[8][7]='255.255.255.0';
     const roles=documentRoles.map((name,i)=>[name,docProof.roleOids[i],mode==='document-role-drift'&&i===1?'902':'903']);
     if(mode==='document-scope-drift'&&appliedHbaSha)docScopeActive=false;
     return [0,JSON.stringify({pid:800+ownerReads,start:`2026-11-12T03:00:00.00000${ownerReads}Z`,
      configuredAt:reloadObserved?'2026-11-12T03:00:00.000002Z':'2026-11-12T03:00:00.000001Z',scope:true,roles,rules:rows})];
    }
    if(input.includes('pg_authid'))return [0,JSON.stringify(logins)];
    if(input==='SELECT pg_catalog.pg_reload_conf();'){reloadObserved=mode!=='document-reload-stale';return [0,'t'];}
    assert.match(input,/FROM pg_catalog.pg_hba_file_rules/u);
    return [0,JSON.stringify(entries.map(([type,db,role,address,mask,auth,options],i)=>
     [i+1,i+1,hbaPath,type,[db],[role],address,mask,auth,options,null]))];
   case 'logs --timestamps':return logReadFailure?[1,'private fixture log payload']:[0,log];
   default:throw new Error('unexpected model command '+kind+' '+operation);
  }
 };
 function spawn(tool,args){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new PassThrough();
  let input='';child.stdin.on('data',chunk=>{input+=chunk.toString();});
  queueMicrotask(()=>{
   const [status,text,err]=output(args,tool,input);
   if(text)child.stdout.emit('data',Buffer.from(text));
   if(err)child.stderr.emit('data',Buffer.from(err));
   child.emit('close',status);
  });
  return child;
 }
 const net={createConnection(endpoint){
  assert.deepEqual(endpoint,{host:'127.0.0.1',port:43125});
  const socket=new EventEmitter();
  socket.destroy=socket.end=()=>queueMicrotask(()=>socket.emit('close'));
  socket.write=request=>{
   assert.equal(request.readUInt32BE(),request.length);
   if(request.readUInt32BE(4)===80877103)queueMicrotask(()=>socket.emit('data',Buffer.from('S')));
   else {
    assert.equal(request.readUInt32BE(4),196608);
    const role=document?documentRoles[documentProbes.length]:owner;
    assert.equal(request.subarray(8).toString(),`user\0${role}\0database\0${database}\0\0`);
    if(document){
     documentProbes.push(role);
     const peer=mode==='document-plaintext-peer'?'172.17.0.2':'127.0.0.1';
     if(mode!=='document-plaintext-stale'&&!(mode==='document-ordinary-stale'&&role===documentRoles[3]))log+=`2026-11-12T03:00:00.000000001Z 2026-11-12 03:00:00.000 UTC [40] user=${role} db=${database} FATAL:  pg_hba.conf rejects connection for host "${peer}", user "${role}", database "${database}", no encryption\n`;
    }else log=`FATAL: pg_hba.conf rejects connection for host "${mode==='wrong-log-peer'?'172.17.0.2':'127.0.0.1'}", user "jg_task01_owner", database "${database}", no encryption\n`;
    const reply=()=>{socket.emit('data',Buffer.from([69,0,0]));socket.emit('data',Buffer.from([0,5,0]));};
    if(mode==='document-drain-budget')setTimeout(reply,1000);else queueMicrotask(reply);
   }
  };
  queueMicrotask(()=>socket.emit('connect'));
  return socket;
 }};
 const tls={checkServerIdentity(host){assert.equal(host,'127.0.0.1');},
  connect(opts,ready){assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.ca.toString(),'ca.crt');opts.checkServerIdentity('ignored',{});
   const socket=new EventEmitter();socket.destroy=()=>queueMicrotask(()=>socket.emit('close'));
   socket.getPeerCertificate=()=>({raw:Buffer.from('correct.crt')});queueMicrotask(ready);return socket;}};
 let documentDrainPending=false;
 const relay={async startCurrent259LoopbackForward(input){
  calls.push(['relay-start']);assert.deepEqual(input,{containerId,dockerConfig:config.artifactsDir+'/tls-private/docker-config',signal:config.signal});
  assert.equal(running,true);relayOpen=true;
  return {port:43125,check(){assert.equal(relayOpen,true);if(relayFailure)throw relayFailure;},
   beginPrismaDrain(){assert.equal(relayOpen,true);calls.push(['relay-drain-open']);
    if(mode==='document-drain-active')throw Object.assign(Error('MODEL_OUTER_DRAIN_ACTIVE'),{code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_ACTIVE'});
    documentDrainPending=true;return async()=>{
    calls.push(['relay-drain-wait']);if(relayFailure)throw relayFailure;
    if(mode==='document-drain-hung')await new Promise(()=>{});
    if(mode==='document-drain-budget')await new Promise(resolve=>setTimeout(resolve,1500));
    if(mode==='document-drain-error')throw Object.assign(Error('MODEL_DRAIN_FAILURE'),{code:'CURRENT259_LOOPBACK_FORWARD_FRAME'});
    if(mode==='document-drain-ordered')await new Promise(resolve=>setImmediate(resolve));
    documentDrainPending=false;calls.push(['relay-drain-joined']);
   };},async close(){relayOpen=false;calls.push(['relay-close']);if(mode==='relay-close-unknown')throw Error('synthetic');}};
 }};
 const imports={'node:fs':fsModel,'node:crypto':{...crypto,X509Certificate:class{constructor(raw){this.raw=raw;}}},
  'node:child_process':{spawn},'node:net':net,'node:tls':tls,'./task16-current259-loopback-forward.cjs':relay,
  ...(document?{'./task12-current259-document-login.cjs':{assertCurrent259GeneratedDocumentLoginScope(proof,handle){
   if(mode==='document-drain-ordered')assert.equal(documentDrainPending,false,'scope cannot run before probe worker join');
   if(privateScopeError)throw privateScopeError;
   assert.ok(!lifecycle&&docScopeActive&&proof===docProof&&handle===docHandle);
  },assertCurrent261GeneratedLifecycleLoginScope(proof,handle){
   if(mode==='document-drain-ordered')assert.equal(documentDrainPending,false,'scope cannot run before probe worker join');
   if(privateScopeError)throw privateScopeError;
   assert.ok(lifecycle&&docScopeActive&&proof===docProof&&handle===docHandle);
  }}}:{})};
 const holder={exports:{}};
 new Function('require','module',fs.readFileSync(source,'utf8'))(id=>imports[id]??require(id),holder);
 const logRejection=peer=>{
  log+=`2026-11-12T03:00:00.000000001Z 2026-11-12 03:00:00.000 UTC [40] user=${logins[0]} db=${database} FATAL:  pg_hba.conf rejects connection for host "${peer}", user "${logins[0]}", database "${database}", no encryption\n`;
 };
 return {start:extra=>holder.exports[firstQ2?'startCurrent259FirstQ2LoopbackPostgres':starter]({...config,...extra}),
  written,calls,config,networkId,containerId,database,logRejection,docHandle,docProof,documentProbes,documentRenders,failLogRead:()=>{logReadFailure=true;},failRelay:error=>{relayFailure=error;},failOwnerSql:detail=>{ownerSqlFailure=detail;}};
}

test('first-rollback startup checks no Docker publish, validates TLS and HBA, and joins relay and Docker cleanup',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start(),ready=resource.getReceipt();
 assert.equal(ready.loopbackPlaintextHba.sourceAddress,'127.0.0.1');
 assert.equal(ready.presentedCertificate.mode,'correct');
 const endpoint=await resource.inspectConnectionEndpoint();
 assert.deepEqual(endpoint,{containerId:f.containerId,networkId:f.networkId,databaseName:f.database,
  transport:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS',relayId:ready.relay.id,host:'127.0.0.1',port:43125,serverAddress:'127.0.0.1',serverPort:5432});
 const hba=f.written.get(f.config.artifactsDir+'/tls-private/bundle/pg_hba.conf');
 assert.equal(hba.split('\n').filter(row=>row.includes('127.0.0.1/32')).length,3);
 assert.equal(hba.split('\n').filter(row=>row.startsWith('hostnossl')).length,2);
 assert.match(f.written.get(f.config.artifactsDir+'/tls-private/bundle/postgresql.conf'),/listen_addresses='127\.0\.0\.1'/u);
 assert.ok(!f.calls.some(call=>call[0]==='port'));
 await resource.close();
 assert.deepEqual(resource.getReceipt().cleanup,{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true,
  relayClosed:true,relayId:ready.relay.id});
 assert.ok(f.calls.findIndex(call=>call[0]==='relay-close')<f.calls.findIndex(call=>call[0]==='container'&&call[1]==='rm'));
});
test('wrong HBA source stops before resource issuance and still cleans the joined resource',async()=>{
 const f=rollbackResourceModel('wrong-log-peer');
 await assert.rejects(f.start(),error=>{
  assert.equal(error.resourceReceipt?.startupFailure.stage,'loopback-plaintext-hba');
  assert.equal(error.resourceReceipt?.cleanup.relayClosed,true);
  return true;
 });
});
test('unconfirmed relay close does not skip owned Docker cleanup or certify absence of the relay',async()=>{
 const f=rollbackResourceModel('relay-close-unknown'),resource=await f.start();
 await assert.rejects(resource.close(),/TASK01_RESOURCE_CLEANUP_FAILED/u);
 assert.equal(resource.getReceipt().cleanup.code,'TASK01_RESOURCE_LOOPBACK_CLEANUP_UNKNOWN');
 assert.equal(resource.getReceipt().cleanup.containerAbsent,true);
 assert.equal(resource.getReceipt().cleanup.relayClosed,false);
 assert.ok(f.calls.some(call=>call[0]==='container'&&call[1]==='rm'));
 assert.ok(f.calls.some(call=>call[0]==='network'&&call[1]==='rm'));
});

test('Q2 producer fixes its own named technical lifetime and refuses a caller-selected profile',async()=>{
 const f=fixture();
 const config={...options(),tools:{...options().tools,docker:'/Applications/Docker.app/Contents/Resources/bin/docker'},signal:new AbortController().signal};
 assert.equal(typeof f.api.startCurrent259FirstQ2LoopbackPostgres,'function');
 await assert.rejects(f.api.startCurrent259FirstQ2LoopbackPostgres({...config,transport:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS'}),/TASK01_RESOURCE_INPUT_INVALID/);
 assert.equal(f.commands.length,0);
 await assert.rejects(f.api.startCurrent259FirstQ2LoopbackPostgres(config),error=>{
  assert.equal(error.resourceReceipt?.topology,'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS');
  assert.equal(error.resourceReceipt?.relay,null);
  assert.equal(error.resourceReceipt?.startupFailure.stage,'daemon-and-image');
  return true;
 });
 assert.equal(f.receipts[0].purpose,'CURRENT259_TECHNICAL_MIGRATIONS_V1');
 assert.equal(f.receipts[0].limits.totalDeadlineMs,3600000);
});

test('first-Q2 producer preserves the owned relay while qualifying exact five-login HBA and fresh localhost rejection',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true}),resource=await f.start(),ready=resource.getReceipt();
 assert.equal(ready.topology,'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS');
 assert.equal(ready.loopbackPlaintextHba,undefined);
 assert.equal((await resource.inspectConnectionEndpoint()).relayId,ready.relay.id);
 const hba=await resource.applyCurrent259ContractHbaV1();
 assert.deepEqual(resource.getReceipt().contractHba,hba);
 assert.equal(hba.rules,14);
 await assert.rejects(resource.applyCurrent259ContractHbaV1(),/TASK01_RESOURCE_CONTRACT_HBA_UNAVAILABLE/u);
 f.logRejection('127.0.0.1');
 await resource.beginCurrent259ContractPlaintextProbe();
 f.logRejection('127.0.0.1');
 assert.equal(await resource.verifyCurrent259ContractPlaintextRejection(),true);
 await assert.rejects(resource.verifyCurrent259ContractPlaintextRejection(),/TASK01_RESOURCE_CONTRACT_PLAINTEXT_WINDOW/u);
 await resource.close();
 assert.equal(resource.getReceipt().cleanup.relayId,ready.relay.id);
 assert.equal(resource.getReceipt().cleanup.relayClosed,true);
});
test('Q2 refuses a changed PostgreSQL netmask before issuing its HBA evidence',async()=>{
 const f=rollbackResourceModel('wrong-q2-netmask',{firstQ2:true}),resource=await f.start();
 await assert.rejects(resource.applyCurrent259ContractHbaV1(),/TASK01_RESOURCE_CONTRACT_HBA_RULES/u);
 assert.equal(resource.getReceipt().contractHba,undefined);
 await resource.close();
});
test('Q2 rejects a stale loopback log and a fresh private-network log',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true}),resource=await f.start();
 await resource.applyCurrent259ContractHbaV1();
 f.logRejection('127.0.0.1');
 await resource.beginCurrent259ContractPlaintextProbe();
 f.logRejection('172.17.0.2');
 assert.equal(await resource.verifyCurrent259ContractPlaintextRejection(),false);
 await resource.close();
});

for(const [starter,topology] of [
 ["startCurrent259NormalPaymentPostgres","UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS"],
 ["startCurrent259AttributionGapPostgres","UNVERIFIED_PAYMENT_ATTRIBUTION_GAP_LOOPBACK_TLS"],
 ["startCurrent259VoucherPostgres","UNVERIFIED_PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS"],
 ["startCurrent259ResponseLossPostgres","UNVERIFIED_PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS"],
 ["startCurrent259CompetitionPostgres","UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS"],
 ["startCurrent259DisconnectRecoveryPostgres","UNVERIFIED_PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS"]
])test("fixed named payment starter uses only its own internal/no-publish TLS and HBA route: "+starter,async()=>{
 const f=rollbackResourceModel("healthy",{starter});
 await assert.rejects(f.start({transport:"UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS"}),/TASK01_RESOURCE_INPUT_INVALID/u);
 assert.deepEqual(f.calls,[]);
 const resource=await f.start(),ready=resource.getReceipt(),endpoint=await resource.inspectConnectionEndpoint();
 assert.equal(ready.topology,topology);assert.equal(endpoint.transport,topology);assert.equal(endpoint.relayId,ready.relay.id);
 assert.equal(ready.loopbackPlaintextHba.sourceAddress,"127.0.0.1");
 assert.equal(resource.applyCurrent259ContractHbaV1,undefined);
 assert.ok(!f.calls.some(call=>call[0]==="port"));
 await resource.close();
 assert.deepEqual(resource.getReceipt().cleanup,{status:"completed",containerAbsent:true,volumesAbsent:true,networkAbsent:true,
  relayClosed:true,relayId:ready.relay.id});
});

test('a live cursor preserves fixed Docker command detail without recording log output',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 f.failLogRead();
 await assert.rejects(resource.captureLogCursor(),error=>{
  assert.equal(error.code,'TASK01_RESOURCE_COMMAND_FAILED');
  assert.equal(error.commandKind,'nonzero-exit');
  assert.equal(error.cursorStage,'CURSOR_LOG_READ');
  assert.doesNotMatch(String(error)+JSON.stringify(error),/private fixture log/u);
  return true;
 });
 await resource.close();
});

test('the owned resource copies only fixed half-close milestones from a relay timeout',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 const flags={hostFin:true,stdinEnded:true,pgFin:true,stdoutEnded:false,cliClosed:false,stdoutRawEnd:true,
  receiveSettled:false,cliExited:false,peerSocketDestroyed:true,peerEndReturned:false};
 f.failRelay(Object.assign(new Error('private trace'),{code:'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT',
  relayCloseState:{...flags,raw:'private payload'}}));
 assert.throws(()=>resource.checkRelay(),error=>{
  assert.equal(error.code,'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED');
  assert.equal(error.relayCode,'CURRENT259_LOOPBACK_FORWARD_HALF_CLOSE_TIMEOUT');
  assert.deepEqual(error.relayCloseState,flags);
  assert.doesNotMatch(String(error)+JSON.stringify(error.relayCloseState),/private/u);
  return true;
 });
 await resource.close();
});

test('the owned resource projects fixed frame details without copying raw output',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 const flags={hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:false,cliClosed:false,stdoutRawEnd:true,
  receiveSettled:false,cliExited:false,peerSocketDestroyed:false,peerEndReturned:false};
 for(const [stage,exit,raw,expected,expectedRaw] of [
  ['STDOUT_EOF_WITHOUT_FIN',47,70,47,70],['STDOUT_EOF_WITHOUT_FIN',47,76,47,undefined],
  ['STDOUT_EOF_WITHOUT_FIN',47,'private marker',47,undefined],['STDOUT_EOF_WITHOUT_FIN',255,70,undefined,undefined],
  ['STDOUT_EOF_WITHOUT_FIN',48,70,48,undefined],['private stdout',47,70,undefined,undefined],
 ]){
  f.failRelay(Object.assign(new Error('private trace'),{code:'CURRENT259_LOOPBACK_FORWARD_FRAME',
   relayFrameStage:stage,relayChildExitCode:exit,relaySysreadExit:raw,relayCloseState:{...flags,raw:'private bytes'}}));
  assert.throws(()=>resource.checkRelay(),error=>{
   assert.equal(error.code,'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED');
   assert.equal(error.relayCode,'CURRENT259_LOOPBACK_FORWARD_FRAME');
   assert.equal(error.relayFrameStage,stage==='STDOUT_EOF_WITHOUT_FIN'?stage:undefined);
   assert.equal(error.relayChildExitCode,expected);
   assert.equal(error.relaySysreadExit,expectedRaw);
   assert.deepEqual(error.relayCloseState,flags);
   assert.doesNotMatch(String(error)+JSON.stringify(error.relayCloseState),/private/u);
   return true;
  });
 }
 await resource.close();
});

test('the first-rollback resource opens a Prisma relay wait and maps its fixed failure',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 assert.throws(()=>resource.beginPrismaRelayDrain('other-deploy'),/TASK01_RESOURCE_CLOSED/u);
 const wait=resource.beginPrismaRelayDrain();
 assert.deepEqual(f.calls.filter(([name])=>name.startsWith('relay-drain')), [['relay-drain-open']]);
 f.failRelay(Object.assign(new Error('private trace'),{code:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'}));
 await assert.rejects(wait(),error=>{
  assert.equal(error.code,'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED');
  assert.equal(error.relayCode,'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT');
  assert.doesNotMatch(String(error),/private/u);
  return true;
 });
 assert.deepEqual(f.calls.filter(([name])=>name.startsWith('relay-drain')), [['relay-drain-open'],['relay-drain-wait']]);
 await resource.close();
});

test('a failed fixed seven prestate retains only the adjacent allowlisted detail of the first scope error',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 const sql='DO $current259_seven_scope$\nBEGIN\nEND $current259_seven_scope$;';
 const scopeError='psql:<stdin>:3: ERROR:  P0001: CURRENT259_SEVEN_INSTALL_SCOPE\n';
 const fixedDetail='DETAIL:  CURRENT259_SEVEN_SCOPE_OPERATING_FACT_ROUTINE\n';
 const common={sqlState:'P0001',guard:'CURRENT259_SEVEN_INSTALL_SCOPE',section:'SCOPE_GUARD'};
 for(const [stderr,expected] of [
  [scopeError+fixedDetail+'CONTEXT: private material\npsql:<stdin>:4: ERROR:  42501: private later detail\n',
   {...common,scopeReason:'OPERATING_FACT_ROUTINE'}],
  [scopeError+'DETAIL:  CURRENT259_SEVEN_SCOPE_PRIVATE\n',common],
  [scopeError+'CONTEXT: private first error\npsql:<stdin>:3: ERROR:  P0001: CURRENT259_SEVEN_INSTALL_SCOPE\n'+fixedDetail,common],
  [scopeError.replace('P0001','42703')+fixedDetail,{...common,sqlState:'42703'}],
  [scopeError.replace('SCOPE','FRESH_OBJECTS')+fixedDetail,{...common,guard:'CURRENT259_SEVEN_INSTALL_FRESH_OBJECTS'}],
 ]){
  f.failOwnerSql(stderr);
  await assert.rejects(resource.execOwnerSql(sql,'current259-seven-before'),error=>{
   assert.equal(error.code,'TASK01_RESOURCE_COMMAND_FAILED');
   assert.deepEqual(error.sevenOwnerFailure,expected);
   assert.doesNotMatch(String(error)+JSON.stringify(error.sevenOwnerFailure),/private/i);
   return true;
  });
 }
 const probe=f.calls.filter(row=>row[0]==='exec'&&row.includes('psql')).at(-1);
 assert.ok(probe.includes('VERBOSITY=verbose'));
 await resource.close();
});

test('seven prestate maps a fixed input section without retaining input, line or server detail',async()=>{
 const f=rollbackResourceModel('healthy'),resource=await f.start();
 f.failOwnerSql('psql:<stdin>:3: ERROR:  42883: private PostgreSQL message\n');
 await assert.rejects(resource.execOwnerSql("DO $current259_seven_scope$\nBEGIN\nEND;\nROLLBACK;",'current259-seven-before'),error=>{
  assert.deepEqual(error.sevenOwnerFailure,{sqlState:'42883',section:'SCOPE_GUARD'});
  assert.doesNotMatch(JSON.stringify(error.sevenOwnerFailure),/private|BEGIN/u);
  return true;
 });
 f.failOwnerSql('psql:<stdin>:1: ERROR:  ZZZZZ: private first error\npsql:<stdin>:2: ERROR:  P0001: CURRENT259_SEVEN_INSTALL_SCOPE\n');
 await assert.rejects(resource.execOwnerSql('SELECT 1;','current259-seven-before'),error=>error.sevenOwnerFailure===undefined);
 f.failOwnerSql('psql:<stdin>:1: ERROR:  P0001: CURRENT259_SEVEN_INSTALL_SCOPE\n');
 await assert.rejects(resource.execOwnerSql('SELECT 1;','current259-seven-install'),error=>error.sevenOwnerFailure===undefined);
 assert.ok(!f.calls.filter(row=>row[0]==='exec'&&row.includes('psql')).at(-1).includes('VERBOSITY=verbose'));
 await resource.close();
});

test('archive writer projects only the first native strict error and its fixed context',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true}),resource=await f.start();
 const sql='\\set VERBOSITY verbose\nDO $archive_registered_final$\nBEGIN\nEND $archive_registered_final$;';
 const first='psql:<stdin>:4: ERROR:  P0002: query returned no rows\n';
 const approved='PL/pgSQL function public.jg_install_contract_direct_upward_v2(text,text,text,uuid) line 94 at SQL statement';
 for(const [stderr,expected] of [
  [first+'DETAIL: private payload\nCONTEXT:  '+approved+'\nLOCATION: private pointer\n',
   {sqlState:'P0002',section:'ARCHIVE_FINAL',routine:'jg_install_contract_direct_upward_v2',sourceLine:94}],
  [first+'CONTEXT:  PL/pgSQL function public.raw_private(text) line 2 at SQL statement\n',
   {sqlState:'P0002',section:'ARCHIVE_FINAL'}],
  [first+'CONTEXT:  '+approved.replace('94','99999')+'\n',
   {sqlState:'P0002',section:'ARCHIVE_FINAL'}],
  [first+'psql:<stdin>:4: ERROR:  P0002: query returned no rows\nCONTEXT:  '+approved+'\n',
   {sqlState:'P0002',section:'ARCHIVE_FINAL'}],
  [first.replace('P0002','P0001')+'CONTEXT:  '+approved+'\n',undefined],
 ]){
  f.failOwnerSql(stderr);
  await assert.rejects(resource.execOwnerSql(sql,'archive-registered-write'),error=>{
   assert.equal(error.code,'TASK01_RESOURCE_COMMAND_FAILED');
   assert.deepEqual(error.archiveWriteFailure,expected);
   assert.doesNotMatch(String(error)+JSON.stringify(error.archiveWriteFailure),/private|DETAIL|CONTEXT|LOCATION/u);
   return true;
  });
 }
 assert.ok(f.calls.filter(row=>row[0]==='exec'&&row.includes('psql')).at(-1).includes('VERBOSITY=verbose'));
 f.failOwnerSql(first+'CONTEXT:  '+approved+'\n');
 await assert.rejects(resource.execOwnerSql(sql,'archive-registered-committed'),error=>error.archiveWriteFailure===undefined);
 assert.ok(!f.calls.filter(row=>row[0]==='exec'&&row.includes('psql')).at(-1).includes('VERBOSITY=verbose'));
 await resource.close();
});

test('first-Q2 document HBA rejects an unbranded role list without any HBA write',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true}),resource=await f.start();
 await assert.rejects(resource.applyCurrent259DocumentHbaV1({},Object.freeze({roleOids:['17000','17001','17002']})),
  /TASK01_RESOURCE_DOCUMENT_HBA_SCOPE/u);
 assert.ok(!f.calls.some(args=>args.includes('document-hba')));
 await resource.close();
});


test('the live document login scope installs only three local TLS rules and proves all fresh plaintext denials',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true,document:true}),resource=await f.start();
 const old=resource.getReceipt().configuration.hbaSha256;
 const result=await resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof);
 assert.deepEqual(result,resource.getReceipt().documentHba);
 assert.equal(result.beforeSha256,old);assert.notEqual(result.afterSha256,old);
 assert.equal(result.rules,12);assert.equal(result.loginInstallXid,'903');
 assert.equal(result.plaintextNoEncryptionRejected,true);
 assert.deepEqual(f.documentProbes,['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue']);
 assert.equal(f.documentRenders.length,2);
 assert.equal(resource.getReceipt().contractHba,undefined);
 await assert.rejects(resource.applyCurrent259ContractHbaV1(),/TASK01_RESOURCE_CONTRACT_HBA_UNAVAILABLE/u);
 await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),/TASK01_RESOURCE_DOCUMENT_HBA_SCOPE/u);
 await resource.close();
 assert.equal(resource.getReceipt().cleanup.relayClosed,true);
});

test('document HBA stops on wrong old rules or role xmin, with no file mutation',async()=>{
 for(const [mode,reason] of [['document-old-rule-drift','PREIMAGE'],['document-role-drift','PREIMAGE'],['document-foreign-scope','SCOPE'],['document-scope-before-spawn','SCOPE']]){
  const f=rollbackResourceModel(mode,{firstQ2:true,document:true}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),new RegExp('TASK01_RESOURCE_DOCUMENT_HBA_'+reason,'u'));
  assert.ok(!f.calls.some(args=>args.includes('document-hba')));
  assert.equal(resource.getReceipt().documentHba,undefined);await resource.close();
 }
});

test('document HBA does not issue on post-image or scope drift or on an unproven plaintext rejection',async()=>{
 for(const [mode,reason] of [['document-post-rule-drift','READBACK'],['document-scope-drift','SCOPE'],
  ['document-plaintext-peer','PLAINTEXT'],['document-plaintext-stale','PLAINTEXT'],['document-reload-stale','RELOAD']]){
  const f=rollbackResourceModel(mode,{firstQ2:true,document:true}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),new RegExp('TASK01_RESOURCE_DOCUMENT_HBA_'+reason,'u'));
  assert.ok(f.calls.some(args=>args.includes('document-hba')));
  if(mode==='document-reload-stale')assert.equal(f.documentProbes.length,0);
  assert.equal(resource.getReceipt().documentHba,undefined);await resource.close();
 }
});

test('the save-purpose HBA atomically admits only the verified ordinary and three document loopback rules',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true,document:true,save:true}),resource=await f.start();
 const hba=await resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof);
 assert.equal(hba.rules,13);
 assert.equal(hba.purpose,'CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1');
 assert.deepEqual(f.documentProbes,['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue','jg_fixture_app_0123456789abcdef01234567']);
 assert.equal(f.calls.filter(args=>args.includes('document-hba')).length,1);
 assert.equal(resource.getReceipt().contractHba,undefined);
 await assert.rejects(resource.applyCurrent259ContractHbaV1(),/TASK01_RESOURCE_CONTRACT_HBA_UNAVAILABLE/u);
 await resource.close();
});

test('an unproven ordinary role or its missing plaintext rejection never publishes a save-purpose HBA receipt',async()=>{
 for(const [mode,reason] of [['document-bad-ordinary','SCOPE'],['document-ordinary-stale','PLAINTEXT']]){
  const f=rollbackResourceModel(mode,{firstQ2:true,document:true,save:true}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),new RegExp('TASK01_RESOURCE_DOCUMENT_HBA_'+reason,'u'));
  assert.equal(f.calls.filter(args=>args.includes('document-hba')).length,mode==='document-bad-ordinary'?0:1);
  assert.equal(resource.getReceipt().documentHba,undefined);await resource.close();
 }
});

test('explicit lifecycle HBA consumes its private login brand and retains the effective registered plan',async()=>{
 const f=rollbackResourceModel('healthy',{firstQ2:true,document:true,lifecycle:true}),resource=await f.start();
 await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,{...f.docProof,effectivePlanSha256:'0'.repeat(64)}),/TASK01_RESOURCE_DOCUMENT_HBA_SCOPE/u);
 assert.ok(!f.calls.some(args=>args.includes('document-hba')));
 const hba=await resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof);
 assert.equal(hba.rules,13);assert.equal(hba.purpose,'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1');
 assert.equal(hba.effectivePlanSha256,f.docProof.effectivePlanSha256);assert.equal(hba.installation,'ARCHIVE261_REGISTERED_SEVEN');
 assert.equal(f.documentProbes.length,4);assert.equal(resource.getReceipt().contractHba,undefined);
 await resource.close();
});

// Source-backed resource model; no native private login proof or PostgreSQL.
test('document HBA scope reports only the original first rejected predicate and fixed callsite',async()=>{
 for(const [mode,predicate,subphase] of [
  ['document-foreign-scope','BIND_RUN','ENTRY'],
  ['document-scope-before-spawn','PRIVATE_SCOPE','WRITE'],
  ['document-scope-drift','PRIVATE_SCOPE','READ_COMMITTED']
 ]){
  const f=rollbackResourceModel(mode,{firstQ2:true,document:true}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),error=>{
   assert.equal(error.code,'TASK01_RESOURCE_DOCUMENT_HBA_SCOPE');
   assert.deepEqual(error.documentHbaScope,{predicate,subphase});
   assert.ok(Object.isFrozen(error.documentHbaScope));return true;
  });await resource.close();
 }
 const f=rollbackResourceModel('healthy',{firstQ2:true,document:true}),resource=await f.start();
 for(const [args,predicate] of [[[f.docHandle],'ENTRY_ARITY'],[[f.docHandle,null],'PROOF_OBJECT'],[[f.docHandle,{}],'PRIVATE_SCOPE']])
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(...args),error=>{assert.deepEqual(error.documentHbaScope,{predicate,subphase:'ENTRY'});return true;});
 const result=await resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof);
 assert.equal(result.rules,12);
 await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),error=>{
  assert.deepEqual(error.documentHbaScope,{predicate:'ENTRY_DOCUMENT_UNUSED',subphase:'ENTRY'});return true;
 });await resource.close();
});

const privateScopeCodes=["CURRENT259_DOCUMENT_LOGIN_HANDLE", "CURRENT259_DOCUMENT_LOGIN_CONTINUITY", "CURRENT259_DOCUMENT_LOGIN_ROLE_RUNTIME", "CURRENT259_DOCUMENT_ACL_TRANSPORT_CONTINUITY", "CURRENT259_DOCUMENT_ROLE_PROVISION_CONTINUITY", "CURRENT259_ORDINARY_ARCHIVE_ACL_CONTINUITY", "CURRENT259_LOADER_CHANGED", "CURRENT259_RESOURCE_CLOSED", "CURRENT259_RESOURCE_ABORTED", "CURRENT259_RESOURCE_SIGNAL", "CURRENT259_RESOURCE_PRODUCER_CHANGED", "CURRENT259_RESOURCE_TOOL_CHANGED", "CURRENT259_RESOURCE_CHANGED", "CURRENT259_RESOURCE_IDENTITY", "CURRENT259_RESOURCE_PURPOSE", "CURRENT259_RESOURCE_TLS", "TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED", "TASK12_OFFICIAL_DOCUMENT_CONTINUITY", "TASK12_OFFICIAL_DOCUMENT_DEADLINE", "TASK12_OFFICIAL_DOCUMENT_MODULES"];
test('private scope only retains enumerated own error codes without reading getters or proxies',async()=>{
 for(const code of privateScopeCodes){
  const f=rollbackResourceModel('healthy',{firstQ2:true,document:true,privateScopeError:{code}}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),error=>{assert.equal(error.code,'TASK01_RESOURCE_DOCUMENT_HBA_SCOPE');assert.deepEqual(error.documentHbaScope,{predicate:'PRIVATE_SCOPE',subphase:'ENTRY',privateScopeCode:code});return true;});await resource.close();
 }
 let reads=0;const getter={};Object.defineProperty(getter,'code',{get(){reads++;throw Error('PRIVATE_DO_NOT_PRINT');}});
 const proxy=new Proxy({code:privateScopeCodes[0]},{getOwnPropertyDescriptor(){throw Error('PRIVATE_DO_NOT_PRINT');}});
 for(const cause of [{code:'CURRENT259_DOCUMENT_LOGIN_HANDLE_UNKNOWN'},{code:'EACCES'},getter,proxy]){
  const f=rollbackResourceModel('healthy',{firstQ2:true,document:true,privateScopeError:cause}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),error=>{assert.deepEqual(error.documentHbaScope,{predicate:'PRIVATE_SCOPE',subphase:'ENTRY'});return true;});await resource.close();
 }assert.equal(reads,0);
});

test('document HBA joins each owned probe cohort before scope guards resume',async()=>{
 const f=rollbackResourceModel('document-drain-ordered',{firstQ2:true,document:true,lifecycle:true}),resource=await f.start();
 const hba=await resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof);assert.equal(hba.rules,13);
 assert.deepEqual(f.calls.filter(row=>row[0].startsWith('relay-drain-')).map(row=>row[0]),Array.from({length:4},()=>['relay-drain-open','relay-drain-wait','relay-drain-joined']).flat());
 await resource.close();
});
test('document HBA rejects active windows, worker faults and hung joins within the same probe budget',async()=>{
 for(const mode of ['document-drain-active','document-drain-error','document-drain-hung','document-drain-budget']){
  const f=rollbackResourceModel(mode,{firstQ2:true,document:true}),resource=await f.start();
  await assert.rejects(resource.applyCurrent259DocumentHbaV1(f.docHandle,f.docProof),{code:'TASK01_RESOURCE_DOCUMENT_HBA_PLAINTEXT'});
  assert.equal(resource.getReceipt().documentHba,undefined);
  // Budget mode has a 1000ms reply plus 1500ms successful join: one 2000ms
  // deadline rejects it; resetting a second 2000ms budget would wrongly pass.
  await resource.close();
 }
});
