"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
test('plain metadata cannot become an owner TLS closed-probe proof',async()=>{
 const api=require('./task16-current259-owner-tls.cjs');
 await assert.rejects(api.verifyCurrent259OwnerTls({native:true,owner:true}),/CURRENT259_RESOURCE_HANDLE/u);
 assert.throws(()=>api.claimCurrent259OwnerTls({closed:true},{}),/CURRENT259_OWNER_PROOF/u);
});
const fs=require('node:fs'),path=require('node:path');
function fixture(){
 const handle=Object.freeze({}),state={sql:[],active:true,cert:'correct',closed:0,constructed:0,disconnected:0,sequence:0},calls=[],clients=[];
 const runId='12345678-1234-4234-8234-123456789012',database='jg_task01_'+runId.replaceAll('-',''),start='2026-11-11T01:02:03.000004Z';
 const owner='jg_task01_owner',source={candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64)};
 const tls={caSha256:'1'.repeat(64),wrongCaSha256:'2'.repeat(64),correctCertificateSha256:'3'.repeat(64),wrongSanCertificateSha256:'4'.repeat(64),correctCertificateDerSha256:'5'.repeat(64),wrongSanCertificateDerSha256:'6'.repeat(64),correctChainVerified:true,correctSanVerified:true,wrongCaChainRejected:true,wrongSanChainVerified:true,wrongSanMismatchVerified:true};
 const common={database,databaseOid:'16384',systemIdentifier:'7540000000000000001',effectiveRole:owner,loginRole:owner,effectiveOid:'16385',loginOid:'16385',ownerOid:'16385',tls:true,version:160004,encoding:'UTF8',replication:'origin',readOnly:'off',defaultReadOnly:'off'};
 const row=(pid,host=true)=>({...common,pid,start,clientAddress:host?'172.19.0.1':'127.0.0.1',clientPort:host?50123:45123,serverAddress:host?'172.19.0.2':'127.0.0.1',serverPort:5432});
 const receipt=()=>({runId,sourceSha:source.candidateSha,containerId:'7'.repeat(64),networkId:'8'.repeat(64),databaseName:database,port:32456,tls:{...tls},requestedCertificateMode:state.cert,reloadState:'OBSERVED_PEER_CERTIFICATE_MATCHED',presentedCertificate:{mode:state.cert,derSha256:state.cert==='correct'?tls.correctCertificateDerSha256:tls.wrongSanCertificateDerSha256}});
 class ModelClient{
  constructor(options){state.constructed++;this.options=options;this.pid=4100+state.constructed;this.disconnected=false;clients.push(this);calls.push('construct');
   const u=new URL(options.datasources.db.url);this.url=u;
   assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'32456');assert.equal(u.username,owner);assert.equal(u.password,'09'.repeat(48));assert.equal(u.pathname,'/'+database);assert.deepEqual(options.log,[]);
   assert.equal(u.searchParams.get('connection_limit'),'1');assert.equal(u.searchParams.get('sslaccept'),'strict');assert.equal(u.searchParams.get('connect_timeout'),'5');assert.equal(u.searchParams.get('pool_timeout'),'5');
  }
  async $connect(){
   calls.push('connect');state.latest=this;if(state.prototypePatch){state.prototypePatch(ModelClient);state.prototypePatch=undefined;}
   if(state.connectNever)return new Promise(()=>{});
   if(state.connectError)throw state.connectError;
   if(this.url.searchParams.get('sslmode')==='disable'&&state.plainError)throw state.plainError;
   if((this.url.searchParams.get('sslcert').includes('wrong-ca')||state.cert==='wrong-san')&&state.negativeConnects)return;
   if((this.url.searchParams.get('sslcert').includes('wrong-ca')||state.cert==='wrong-san')&&state.negativeError)throw state.negativeError;
   if(this.url.searchParams.get('sslmode')==='disable')throw Object.assign(new Error('fixed plaintext denial'),{errorCode:'P1010'});
   if(this.url.searchParams.get('sslcert').includes('wrong-ca')||state.cert==='wrong-san')throw Object.assign(new Error('TLS connection certificate was not trusted'),{errorCode:'P1011'});
  }
  async $queryRawUnsafe(_sql,nonce){state.sql.push({phase:'host',sql:_sql});calls.push('query');this.queryCount=(this.queryCount||0)+1;const value={...row(this.pid),nonce};if(state.queryChange)state.queryChange(value,this);return [value];}
  async $disconnect(){calls.push('disconnect');state.disconnectAttempts=(state.disconnectAttempts||0)+1;if(state.disconnectNever)return new Promise(()=>{});if(state.disconnectFailure)throw new Error('disconnect detail');this.disconnected=true;state.disconnected++;}
 }
 const resource={containerId:'7'.repeat(64),networkId:'8'.repeat(64),databaseName:database,port:32456,caPath:'/private/tmp/model/ca.crt',wrongCaPath:'/private/tmp/model/wrong-ca.crt',serverCertHashes:{...tls},getReceipt:receipt,
  async execOwnerSql(sql,phase){state.sql.push({phase,sql});calls.push(phase);const nonce=/'([a-f0-9]{64})'::pg_catalog.text AS nonce/u.exec(sql)?.[1];assert.ok(nonce);
   let value;if(phase==='current259-owner-anchor')value={...row(6101,false),nonce};
   else {assert.equal(phase,'current259-owner-live');const client=state.latest;assert.equal(client.disconnected,false);value={database,databaseOid:'16384',systemIdentifier:'7540000000000000001',ownerOid:'16385',loginOid:'16385',loginRole:owner,pid:client.pid,start,tls:true,clientAddress:'172.19.0.1',clientPort:50123,readerPid:6102,readerStart:start,readerOid:'16385',readerRole:owner,readerTls:true,nonce};if(state.liveChange)state.liveChange(value);}
   return {stdout:JSON.stringify(value)};
  },
  async setServerCertificate(mode){calls.push('certificate:'+mode);if(state.restoreFailure&&mode==='correct')throw new Error('restore detail');state.cert=mode;},
  async captureLogCursor(){calls.push('cursor');return {runId,containerId:resource.containerId};},
  async readPlaintextRejectionEvidence(cursor,target){assert.equal(cursor.runId,runId);assert.equal(target.role,owner);calls.push('hba');return {hbaNoEncryptionRejected:!state.badHba,roleMatched:true,databaseMatched:true};}
 };
 const prototype=Object.fromEntries(['$connect','$queryRawUnsafe','$disconnect'].map(key=>[key,Object.getOwnPropertyDescriptor(ModelClient.prototype,key)]));
 const check=()=>{if(state.prototypePoisoned)throw new Error('loader sticky detail');if(!Object.entries(prototype).every(([key,d])=>{const now=Object.getOwnPropertyDescriptor(ModelClient.prototype,key);return now&&['value','configurable','enumerable','writable'].every(field=>now[field]===d[field]);})){state.prototypePoisoned=true;throw new Error('loader prototype detail');}if(!state.active)throw Object.assign(new Error('CURRENT259_RESOURCE_CLOSED'),{code:'CURRENT259_RESOURCE_CLOSED'});if(state.checkFailure)throw new Error('continuity detail');};
 const loader=Object.freeze({Class:ModelClient,check,verifyFull(){check();if(state.fullFailure)throw new Error('full detail');}});
 const view={scope:'OWNED_RESOURCE_ONLY',runId,source,build:{},resource,loader,credentials(){check();return {owner:'09'.repeat(48)};},check,verifyFull:loader.verifyFull};
 const ports={
  './task16-current259-owned-resource.cjs':{claimCurrent259OwnedResource(h){assert.equal(h,handle);check();return view;},async closeCurrent259OwnedResource(h){assert.equal(h,handle);if(state.active){state.active=false;state.closed++;}if(state.closeFailure)throw new Error('close detail');}},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){if(state.caChanged)throw new Error('CA detail');assert.ok([resource.caPath,resource.wrongCaPath].includes(file));return {sha256:file===resource.caPath?tls.caSha256:tls.wrongCaSha256,identity:{dev:1,ino:file===resource.caPath?2:3,size:100,mode:0o100600,uid:process.getuid(),gid:1,mtimeMs:1,ctimeMs:1}};}},
  'node:crypto':{randomBytes:()=>Buffer.from((++state.sequence).toString(16).padStart(64,'0'),'hex')}
 };
 const privateRequire=name=>Object.hasOwn(ports,name)?ports[name]:require(name),instance={exports:{}};
 const timer=(fn,ms)=>state.fastTimers?setImmediate(fn):setTimeout(fn,ms),clear=h=>{clearTimeout(h);clearImmediate(h);};
 new Function('require','module','setTimeout','clearTimeout',fs.readFileSync(path.join(__dirname,'task16-current259-owner-tls.cjs'),'utf8'))(privateRequire,instance,timer,clear);
 return {api:instance.exports,handle,state,calls,clients,view,source,Class:ModelClient};
}
test('seven fixed owner probes close and attest only closed TLS controls in the original resource lifetime',async()=>{
 const f=fixture(),proof=await f.api.verifyCurrent259OwnerTls(f.handle),value=f.api.claimCurrent259OwnerTls(proof,f.handle);
 assert.equal(value.scope,'CLOSED_OWNER_TLS_CONTROLS_ONLY');assert.equal(value.databaseOid,'16384');assert.equal(value.systemIdentifier,'7540000000000000001');assert.equal(value.ownerOid,'16385');
 assert.equal(f.state.constructed,7);assert.equal(f.state.disconnected,7);assert.equal(f.state.cert,'correct');assert.equal(f.state.closed,0);assert.equal(value.probes.length,7);
 assert.ok(f.clients.every(c=>c.disconnected));assert.equal(JSON.stringify(value).includes('09'.repeat(48)),false);
 f.state.active=false;assert.throws(()=>f.api.claimCurrent259OwnerTls(proof,f.handle),/CURRENT259_RESOURCE_CLOSED/u);
});
for(const [name,change]of [
 ['foreign database',v=>v.database='foreign_database'],['foreign cluster',v=>v.systemIdentifier='7540000000000000002'],
 ['owner name with wrong OID',v=>v.effectiveOid='16386'],['TLS absent',v=>v.tls=false],
 ['wrong server port',v=>v.serverPort=6543],['missing backend start',v=>v.start=null]
])test(`${name} from the real-shaped Class identity cannot become owner proof`,async()=>{
 const f=fixture();f.state.queryChange=change;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_/u);assert.equal(f.state.closed,1);assert.equal(f.state.active,false);
});
for(const [name,change]of [
 ['wrong target role OID',v=>v.loginOid='16386'],['wrong physical backend',v=>v.pid++],
 ['wrong backend start',v=>v.start='2026-11-11T01:02:04.000004Z'],['wrong NAT client address',v=>v.clientAddress='172.19.0.99'],
 ['same purported independent backend',v=>v.readerPid=v.pid],['reader without TLS',v=>v.readerTls=false]
])test(`${name} in independent live owner readback fails closed`,async()=>{
 const f=fixture();f.state.liveChange=change;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_LIVE_READBACK/u);assert.equal(f.state.closed,1);assert.equal(f.state.disconnected,1);
});
test('the same Class reads its physical identity again after the independent owner read',async()=>{
 const f=fixture();f.state.queryChange=(v,c)=>{if(c.queryCount===2)v.pid++;};
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_SESSION_CHANGED/u);assert.equal(f.state.closed,1);
});
for(const [name,setup]of [
 ['generic network rejection',s=>s.negativeError=Object.assign(new Error('network'),{errorCode:'P1001'})],
 ['certificate code without verification marker',s=>s.negativeError=Object.assign(new Error('generic'),{errorCode:'P1011'})],
 ['negative unexpectedly connected',s=>s.negativeConnects=true],
 ['plaintext generic error',s=>s.plainError=Object.assign(new Error('network'),{errorCode:'P1001'})],
 ['plaintext missing matching HBA evidence',s=>s.badHba=true]
])test(`${name} is not a successful TLS control`,async()=>{
 const f=fixture();setup(f.state);await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_/u);
 assert.equal(f.state.closed,1);assert.equal(f.state.active,false);
});
test('wrong SAN must restore correct presentation before the fixed probe protocol can complete',async()=>{
 const f=fixture();f.state.restoreFailure=true;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),e=>e.ownerRestorationOutcome==='UNKNOWN');
 assert.equal(f.state.closed,1);assert.equal(f.state.cert,'wrong-san');assert.equal(f.state.constructed,4);
});
test('a failed real-shaped disconnect is UNKNOWN and never retried into a closed proof',async()=>{
 const f=fixture();f.state.disconnectFailure=true;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),e=>e.clientCleanupOutcome==='UNKNOWN');
 assert.equal(f.state.closed,1);assert.equal(f.state.disconnectAttempts,1);
});
for(const never of ['connectNever','disconnectNever'])test(`${never} cannot settle into a proof or retain resource authority`,async()=>{
 const f=fixture();f.state[never]=true;f.state.fastTimers=true;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),e=>e.clientCleanupOutcome==='UNKNOWN');
 assert.equal(f.state.closed,1);assert.equal(f.state.active,false);assert.equal(f.state.disconnectAttempts,1);
});
test('a private CA descriptor failure before construction still revokes the owned handle',async()=>{
 const f=fixture();f.state.caChanged=true;
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_FAILED_CLOSED/u);assert.equal(f.state.constructed,0);assert.equal(f.state.closed,1);
});
test('copies and a different resource cannot claim the private closed-probe proof',async()=>{
 const f=fixture(),proof=await f.api.verifyCurrent259OwnerTls(f.handle);
 assert.throws(()=>f.api.claimCurrent259OwnerTls({...proof},f.handle),/CURRENT259_OWNER_PROOF/u);
 assert.throws(()=>f.api.claimCurrent259OwnerTls(proof,{}),/CURRENT259_OWNER_PROOF/u);
});
test('descriptor drift in the original Class boundary poisons the closed-probe stage',async()=>{
 const f=fixture(),descriptor=Object.getOwnPropertyDescriptor(f.Class.prototype,'$queryRawUnsafe');let gets=0;
 f.state.prototypePatch=Class=>Object.defineProperty(Class.prototype,'$queryRawUnsafe',{get(){gets++;return descriptor.value;},configurable:true});
 await assert.rejects(f.api.verifyCurrent259OwnerTls(f.handle),/CURRENT259_OWNER_/u);
 Object.defineProperty(f.Class.prototype,'$queryRawUnsafe',descriptor);
 assert.equal(f.state.closed,1);assert.equal(f.state.prototypePoisoned,true);
 assert.throws(()=>f.view.loader.check(),/loader sticky detail/u);assert.equal(gets,0);
});
test('a proof continuity failure revokes the physical resource even if the caller catches it',async()=>{
 const f=fixture(),proof=await f.api.verifyCurrent259OwnerTls(f.handle);f.state.caChanged=true;
 assert.throws(()=>f.api.claimCurrent259OwnerTls(proof,f.handle));assert.equal(f.state.closed,1);assert.equal(f.state.active,false);
 f.state.caChanged=false;assert.throws(()=>f.api.claimCurrent259OwnerTls(proof,f.handle),/CURRENT259_OWNER_PROOF/u);
});
