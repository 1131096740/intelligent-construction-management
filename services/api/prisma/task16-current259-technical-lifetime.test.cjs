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

function rollbackResourceModel(mode,{firstQ2=false,starter="startCurrent259FirstRollbackPostgres"}={}){
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),crypto=require('node:crypto');
 const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
 const config={...options(),tools:{docker,openssl:'/synthetic/openssl'},signal:new AbortController().signal};
 const networkId='d'.repeat(64),containerId='c'.repeat(64),name='jg-task01-'+config.runId;
 const database='jg_task01_'+config.runId.replaceAll('-','');
 const labels={'io.jiangkong.task01.run':config.runId,'io.jiangkong.task01.task':'enterprise-task01','io.jiangkong.task01.source':config.sourceSha};
 const files=new Map(),written=new Map(),calls=[];
 const owner='jg_task01_owner',logins=['jg_fixture_app_'+'1'.repeat(24),'jg_c259_outside_issuer_login','jg_c259_outside_executor_login',
  'jg_c259_upward_issuer_login','jg_c259_upward_runtime_login'];
 const addedRoles=[owner,'jg_task01_runtime','jg_task01_observer',...logins],hbaPath='/jg-task01/pg_hba.conf';
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
 let network=false,container=false,running=false,relayOpen=false,log='',tmpfs={},logReadFailure=false,relayFailure;
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
   case 'info --format':return [0,config.daemonId];
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
    assert.equal(firstQ2,true,'only Q2 runs contract HBA installation in this model');
    if(args.includes('sh')){
     assert.equal(args.at(-2),digest(written.get(config.artifactsDir+'/tls-private/bundle/pg_hba.conf')));
     appliedHbaSha=digest(input);
     assert.equal(args.at(-1),appliedHbaSha);
     assert.deepEqual(input.trim().split('\n').filter(line=>line.includes('127.0.0.1/32')),
      addedRoles.map(role=>`hostssl ${database} ${role} 127.0.0.1/32 scram-sha-256`));
     return [0,appliedHbaSha+'\n'];
    }
    if(input.includes('pg_authid'))return [0,JSON.stringify(logins)];
    if(input==='SELECT pg_catalog.pg_reload_conf();')return [0,'t'];
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
   const [status,text]=output(args,tool,input);
   if(text)child.stdout.emit('data',Buffer.from(text));
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
    assert.equal(request.subarray(8).toString(),`user\0jg_task01_owner\0database\0${database}\0\0`);
    log=`FATAL: pg_hba.conf rejects connection for host "${mode==='wrong-log-peer'?'172.17.0.2':'127.0.0.1'}", user "jg_task01_owner", database "${database}", no encryption\n`;
    queueMicrotask(()=>{
     socket.emit('data',Buffer.from([69,0,0]));
     socket.emit('data',Buffer.from([0,5,0]));
    });
   }
  };
  queueMicrotask(()=>socket.emit('connect'));
  return socket;
 }};
 const tls={checkServerIdentity(host){assert.equal(host,'127.0.0.1');},
  connect(opts,ready){assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.ca.toString(),'ca.crt');opts.checkServerIdentity('ignored',{});
   const socket=new EventEmitter();socket.destroy=()=>queueMicrotask(()=>socket.emit('close'));
   socket.getPeerCertificate=()=>({raw:Buffer.from('correct.crt')});queueMicrotask(ready);return socket;}};
 const relay={async startCurrent259LoopbackForward(input){
  calls.push(['relay-start']);assert.deepEqual(input,{containerId,dockerConfig:config.artifactsDir+'/tls-private/docker-config',signal:config.signal});
  assert.equal(running,true);relayOpen=true;
  return {port:43125,check(){assert.equal(relayOpen,true);if(relayFailure)throw relayFailure;},
   beginPrismaDrain(){assert.equal(relayOpen,true);calls.push(['relay-drain-open']);return async()=>{
    calls.push(['relay-drain-wait']);if(relayFailure)throw relayFailure;
   };},async close(){relayOpen=false;calls.push(['relay-close']);if(mode==='relay-close-unknown')throw Error('synthetic');}};
 }};
 const imports={'node:fs':fsModel,'node:crypto':{...crypto,X509Certificate:class{constructor(raw){this.raw=raw;}}},
  'node:child_process':{spawn},'node:net':net,'node:tls':tls,'./task16-current259-loopback-forward.cjs':relay};
 const holder={exports:{}};
 new Function('require','module',fs.readFileSync(source,'utf8'))(id=>imports[id]??require(id),holder);
 const logRejection=peer=>{
  log+=`2026-11-12T03:00:00.000000001Z 2026-11-12 03:00:00.000 UTC [40] user=${logins[0]} db=${database} FATAL:  pg_hba.conf rejects connection for host "${peer}", user "${logins[0]}", database "${database}", no encryption\n`;
 };
 return {start:extra=>holder.exports[firstQ2?'startCurrent259FirstQ2LoopbackPostgres':starter]({...config,...extra}),
  written,calls,config,networkId,containerId,database,logRejection,failLogRead:()=>{logReadFailure=true;},failRelay:error=>{relayFailure=error;}};
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
