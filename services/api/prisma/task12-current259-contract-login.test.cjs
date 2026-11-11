"use strict";
const assert=require('node:assert/strict');
const {test}=require('node:test');

test('unbranded ACL receipts cannot start any contract login stage', async () => {
  const {api}=fixture();
  await assert.rejects(api.withCurrent259ContractLogin(Object.freeze({status:'CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION'}),{},()=>assert.fail('unexpected lease')), /HANDLE/u);
});

const fs=require('node:fs');
const path=require('node:path');
const {createHash,createHmac,pbkdf2Sync}=require('node:crypto');
const sha=value=>createHash('sha256').update(value).digest('hex');
const blob=n=>n.repeat(64);
const LOGIN_NAMES=['jg_c259_outside_issuer_login','jg_c259_outside_executor_login','jg_c259_upward_issuer_login','jg_c259_upward_runtime_login'];
const apiSource=fs.readFileSync(path.join(__dirname,'task12-current259-contract-login.cjs'),'utf8');

function fixture(preloaded = false) {
  const source=Object.freeze({candidateSha:'a'.repeat(40)}),handle=Object.freeze({}),control={},calls=[];
  const runId='12345678-1234-4234-8234-123456789012',containerId=blob('a'),networkId=blob('b');
  const database='jg_task01_'+runId.replaceAll('-','');
  const identity={database,databaseOid:'200',namespaceOid:'2200',ownerOid:'10',actorOid:'10',
    actor:'jg_task01_owner',sessionActor:'jg_task01_owner',systemIdentifier:'1234',tls:true,clientAddress:'127.0.0.1',
    serverAddress:'127.0.0.1',serverPort:5432};
  const base={login:true,limit:1,password:'absent',superuser:false,createRole:false,createDb:false,inherit:false,replication:false,bypassRls:false,unlimitedValidity:true};
  const ordinary={...base,name:'jg_fixture_app_'+'c'.repeat(24),oid:'80',limit:0};
  const roles=[...LOGIN_NAMES,'jg_c259_outside_executor_owner','jg_c259_outside_issuer_owner','jg_c259_upward_issuer_owner',
    'jg_task01_observer','jg_task01_runtime'].sort().map((name,index)=>({...base,name,oid:String(90+index),xmin:'700',
      login:!name.endsWith('_owner'),limit:name.endsWith('_owner')?0:1,password:name.startsWith('jg_task01_')?'scram':'absent'}));
  const databaseAcl=[{name:database,oid:'200',owner:'10',acl:[['10','80','CONNECT',false]]}];
  const roleCompletion={status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:source.candidateSha,runId,containerId,
    databaseIdentity:identity,ordinary,roles,databaseAcl:{after:databaseAcl},commitXid:'700'};
  const archiveCompletion={status:'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED',sourceSha:source.candidateSha,runId,containerId,
    installXid:'701',bindingSha256:blob('e'),registeredFileSource:true,executionAllowed:false,nativeAdmission:false};
  const completion=Object.freeze({status:'CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
    runId,containerId,installXid:'702',archiveInstallXid:'701',catalogSha256:blob('a'),protectedSha256:blob('b'),
    requirementsSha256:blob('c'),executionAllowed:false,nativeAdmission:false});
  const prior={source,completion,archiveCompletion,roleCompletion,check:()=>assert.equal(control.closed,undefined),
    catalogSql:"'a'::text",protectedSql:"'b'::text"};
  const state={identity,databaseAcl,catalogSha256:completion.catalogSha256,protectedSha256:completion.protectedSha256,
    bindingSha256:archiveCompletion.bindingSha256,archiveXmins:Array(5).fill('701'),rawDatabaseSha256:blob('a'),
    otherAuthSha256:blob('b'),membershipsSha256:blob('c'),settingsSha256:blob('d'),managedRoleSafe:true,
    roleSettings:[{oid:roles.find(r=>r.name==='jg_task01_observer').oid,database:'0',config:['default_transaction_read_only=on']}],
    roles:[{...ordinary,xmin:'600'},...roles].sort((a,b)=>a.name<b.name?-1:1).map(r=>({...r,verifierSha256:null})),
    limits:[16,3,0],originCommitted:true,environmentOk:true,noConnections:true};
  const targets=[ordinary,...LOGIN_NAMES.map(name=>roles.find(role=>role.name===name))];
  let pid=100,claimed=false,staged,clientRow,activeClients=0;
  const next=()=>({pid:++pid,start:`2026-11-11T10:00:00.000${pid}Z`});
  const writeIds=new Map();
  const resource={
    databaseName:database,containerId,networkId,port:32456,caPath:'/model/ca.crt',wrongCaPath:'/model/wrong.crt',
    serverCertHashes:{caSha256:blob('a'),wrongCaSha256:blob('b'),correctCertificateDerSha256:blob('c')},
    async execOwnerSql(sql,phase){
      const name=phase.replace('current259-contract-login-','');
      calls.push(name);
      if(process.env.JG_STATIC_PACKET_DIR)fs.writeFileSync(path.join(process.env.JG_STATIC_PACKET_DIR,name+'.sql'),sql);
      const sqlResult=value=>({stdout:JSON.stringify(value)});
      if(name==='tls-live'){
        const challenge=sql.match(/'challenge','([a-f0-9]{64})'/u)?.[1];
        assert.ok(challenge);
        assert.equal(activeClients,1);
        const {challenge:previous,sessionRole,serverAddress,serverPort,...session}=clientRow;
        if(control.drift==='tls-live')session.oid='999';
        return sqlResult({identity,session,reader:next(),challenge});
      }
      const before=name==='before',write=name==='write';
      if(write){
        assert.match(sql,/ISOLATION LEVEL SERIALIZABLE READ WRITE/u);
        assert.ok(sql.indexOf('SET log_transaction_sample_rate')<sql.indexOf('BEGIN ISOLATION'));
        assert.doesNotMatch(sql,/\b(?:CREATE ROLE|GRANT|REVOKE)\b/u);
        for(const match of sql.matchAll(/ALTER ROLE "([^"]+)" PASSWORD '(SCRAM-SHA-256\$[^']+)'/gu))writeIds.set(match[1],match[2]);
        assert.deepEqual([...writeIds.keys()],targets.map(role=>role.name));
        staged={...state,roles:state.roles.map(role=>writeIds.has(role.name)?{...role,limit:role.name===ordinary.name?4:1,
          password:'scram',xmin:'703',verifierSha256:sha(writeIds.get(role.name))}:role)};
      }
      assert.ok(before||write||name.includes('committed'));
      const result={state:structuredClone(before?state:staged),backend:next(),readOnly:!write,
        isolation:write?'serializable':'repeatable read',writeXid:write?'703':null,commitStatus:before||write?null:'committed'};
      if(control.drift==='before'&&before)result.state.roles[0].xmin='999';
      if(control.drift==='acl'&&before)result.state.catalogSha256=blob('f');
      if(control.drift==='limit'&&before)result.state.limits=[16,3,5];
      if(control.drift==='write'&&write)result.state.roles.find(r=>r.name===ordinary.name).oid='999';
      if(control.drift==='committed'&&name==='committed')result.commitStatus='in progress';
      if(control.drift==='protected'&&name==='hba-committed')result.state.protectedSha256=blob('f');
      return sqlResult(result);
    },
    getReceipt(){return {configuration:{hbaSha256:blob('a')}};},
    async applyCurrent259ContractHbaV1(){assert.equal(arguments.length,0);calls.push('hba');return {beforeSha256:blob('a'),afterSha256:blob('b'),rules:22};},
    async beginCurrent259ContractPlaintextProbe(){calls.push('plaintext-cursor');assert.equal(arguments.length,0);},
    async verifyCurrent259ContractPlaintextRejection(){
      calls.push('plaintext-readback');assert.equal(arguments.length,0);return !control.noPlaintextEvidence;
    },
    async inspectConnectionEndpoint(){return {containerId,networkId,databaseName:database,publishedHost:'127.0.0.1',publishedPort:32456,
      serverAddress:'172.29.0.2',serverPort:5432};},
    async observePresentedCertificate(){return {mode:'correct',derSha256:blob('c')};},
  };
  class Client {
    constructor({datasources}) {
      assert.equal(activeClients++,0);
      this.url=new URL(datasources.db.url);
      assert.equal(this.url.hostname,'127.0.0.1');
      assert.equal(this.url.searchParams.get('connection_limit'),'1');
      assert.equal(this.url.searchParams.get('sslaccept'),'strict');
      this.role=targets.find(role=>role.name===this.url.username);
      assert.ok(this.role);
      calls.push('construct');
    }
    async $connect(){
      if(control.pending==='CONNECT')return new Promise(()=>{});
      const [prefix,parts]=writeIds.get(this.role.name).split('$');
      const [iterations,salt]=parts.split(':');
      const salted=pbkdf2Sync(this.url.password,Buffer.from(salt,'base64'),Number(iterations),32,'sha256');
      const stored=sha(createHmac('sha256',salted).update('Client Key').digest());
      const verifier=writeIds.get(this.role.name).split('$')[2].split(':')[0];
      let code;
      if(this.url.searchParams.get('sslcert')===resource.wrongCaPath)code='P1011';
      else if(this.url.searchParams.get('sslmode')==='disable')code='P1010';
      else if(stored!==Buffer.from(verifier,'base64').toString('hex'))code='P1000';
      if(code && control.drift!=='negative')throw Object.assign(new Error(code==='P1011'?
        control.certificateError??'Error opening a TLS connection: The certificate was not trusted':
        'connection denied'),{errorCode:code});
      this.backend=next();
      assert.equal(prefix,'SCRAM-SHA-256');
    }
    async $disconnect(){assert.equal(activeClients--,1);calls.push('disconnect');if(control.drift==='disconnect')throw new Error('sensitive');}
    async $queryRawUnsafe(sql,challenge) {
      if(control.pending==='QUERY')return new Promise(()=>{});
      assert.match(sql,/pg_stat_ssl/u);
      if(process.env.JG_STATIC_PACKET_DIR)fs.writeFileSync(path.join(process.env.JG_STATIC_PACKET_DIR,'tls-host.sql'),sql);
      clientRow={database,databaseOid:identity.databaseOid,role:this.role.name,sessionRole:this.role.name,oid:this.role.oid,
        ...this.backend,tls:true,clientAddress:'172.29.0.1',clientPort:35343,serverAddress:'172.29.0.2',serverPort:5432,challenge};
      if(control.drift==='endpoint')clientRow.serverAddress='127.0.0.1';
      return [clientRow];
    }
  }
  const view={source,runId,resource,loader:{Class:Client},verifyFull:()=>assert.equal(control.closed,undefined)};
  const ports={
    './task16-current259-ordinary-archive-acl.cjs':{claimCurrent259OrdinaryArchiveAcl(candidate,actual){
      assert.equal(actual,handle);assert.equal(candidate,completion);assert.equal(claimed,false);claimed=true;return prior;
    }},
    './task16-current259-owned-resource.cjs':{
      claimCurrent259TechnicalResource(actual){assert.equal(actual,handle);assert.equal(control.closed,undefined);return view;},
      async closeCurrent259OwnedResource(actual){assert.equal(actual,handle);control.closed=(control.closed??0)+1;if(control.closeUnknown)throw new Error('credential in foreign failure');},
    },
    './task16-runtime-inputs.cjs':{readQualifiedTask16File(file){return {identity:{uid:process.getuid()},sha256:file===resource.caPath?blob('a'):blob('b')};}},
  };
  const module={exports:{}};
  const cache={};
  if(preloaded)Object.defineProperty(cache,'./task16-current259-ordinary-archive-acl.cjs',{
    get(){assert.fail('preloaded cache getter must never execute');}
  });
  const privateRequire=name=>{
    if(!Object.hasOwn(ports,name))return require(name);
    cache[name]??={exports:ports[name]};
    return cache[name].exports;
  };
  privateRequire.resolve=name=>name;
  privateRequire.cache=cache;
  const clock=(fn,milliseconds)=>setTimeout(fn,control.pending?1:milliseconds);
  new Function('require','module','setTimeout',apiSource)(privateRequire,module,clock);
  return {api:module.exports,handle,completion,control,calls,source,cache};
}

test('the original ACL, write COMMIT, HBA and five serial strict TLS sessions issue one scoped claim',async()=>{
  const f=fixture();
  let retained,lease;
  const value=await f.api.withCurrent259ContractLogin(f.completion,f.handle,proof=>{
    retained=proof;
    assert.throws(()=>f.api.claimCurrent259ContractLogin({...proof},f.handle),/HANDLE/u);
    assert.throws(()=>f.api.claimCurrent259ContractLogin(proof,{}),/HANDLE/u);
    lease=f.api.claimCurrent259ContractLogin(proof,f.handle);
    assert.deepEqual(Object.keys(lease),['completion','source','check']);
    assert.equal(lease.source,f.source);
    assert.equal(lease.completion,proof);
    assert.equal(proof.executionAllowed,false);
    assert.equal(proof.nativeAdmission,false);
    assert.deepEqual(proof.roles.map(role=>role.limit),[4,1,1,1,1]);
    assert.deepEqual(proof.probes,{verified:5,negative:3,cleanup:'DISCONNECTED'});
    assert.doesNotMatch(JSON.stringify(proof),/postgresql:|SCRAM-SHA|password/u);
    lease.check();
    assert.throws(()=>f.api.claimCurrent259ContractLogin(proof,f.handle),/HANDLE/u);
    return 'done';
  });
  assert.equal(value,'done');
  assert.throws(()=>lease.check(),/CLOSED/u);
  assert.throws(()=>f.api.claimCurrent259ContractLogin(retained,f.handle),/HANDLE/u);
  assert.deepEqual(f.calls.slice(0,5),['before','write','committed','hba','hba-committed']);
  assert.equal(f.calls.filter(value=>value==='construct').length,8);
  assert.equal(f.calls.filter(value=>value==='disconnect').length,8);
  assert.equal(f.calls.filter(value=>value==='tls-live').length,5);
  assert.equal(f.calls.at(-1),'tls-committed');
});
for(const [drift,phase,forbidden] of [
  ['before','BEFORE','write'],['acl','BEFORE','write'],['limit','BEFORE','write'],
  ['write','ROLE_COMMIT_UNCONFIRMED','hba'],['committed','ROLE_COMMIT_UNCONFIRMED','hba'],
  ['protected','HBA','construct'],['negative','TLS','tls-live'],['endpoint','TLS','tls-live'],
  ['tls-live','TLS','tls-committed'],['disconnect','TLS','tls-live'],
])test('rejects '+drift+' without issuing a lease or continuing',async()=>{
  const f=fixture();f.control.drift=drift;
  if(drift==='disconnect')f.control.closeUnknown=true;
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,()=>assert.fail('unexpected lease')),error=>{
    assert.equal(error.code,'CURRENT259_CONTRACT_LOGIN_'+phase);
    if(drift==='disconnect')assert.deepEqual([error.clientCleanup,error.resourceCleanup],['UNKNOWN','UNKNOWN']);
    assert.doesNotMatch(JSON.stringify(error),/sensitive|credential/u);
    return true;
  });
  assert.equal(f.control.closed,1);
  assert.equal(f.calls.includes(forbidden),false);
});

test('replacement of the original ACL module export accessor executes no getter',async()=>{
  const f=fixture();
  let getters=0;
  const entry=f.cache['./task16-current259-ordinary-archive-acl.cjs'];
  Object.defineProperty(entry,'exports',{get(){getters++;throw Error('unexpected');}});
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,()=>assert.fail('unexpected lease')),/METHOD/u);
  assert.equal(getters,0);
  assert.deepEqual(f.calls,[]);
});

test('a callback failure revokes the issued lease and retains only the safe commit/cleanup facts',async()=>{
  const f=fixture();
  f.control.closeUnknown=true;
  let lease;
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,proof=>{
    lease=f.api.claimCurrent259ContractLogin(proof,f.handle);
    throw new Error('private consumer detail');
  }),error=>{
    assert.deepEqual([error.code,error.roleCommit,error.resourceCleanup],['CURRENT259_CONTRACT_LOGIN_CONSUMER','COMMITTED','UNKNOWN']);
    assert.doesNotMatch(JSON.stringify(error),/private consumer detail|credential/u);
    return true;
  });
  assert.throws(()=>lease.check(),/CLOSED/u);
  assert.equal(f.control.closed,1);
});

test('a preloaded ACL cache slot is rejected before require can read it',()=>{
  assert.throws(()=>fixture(true),/CURRENT259_CONTRACT_LOGIN_IMPORT/u);
});

test('a certificate file-load error does not prove an untrusted issuer',async()=>{
  const f=fixture();
  f.control.certificateError='could not load certificate file from disk';
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,()=>assert.fail('unexpected lease')),
    {code:'CURRENT259_CONTRACT_LOGIN_TLS',stageFailure:'TLS_NEGATIVE'});
  assert.equal(f.calls.filter(value=>value==='construct').length,1);
  assert.equal(f.control.closed,1);
});

test('a Prisma access denial without matching fresh server HBA evidence does not prove plaintext rejection',async()=>{
  const f=fixture();
  f.control.noPlaintextEvidence=true;
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,()=>assert.fail('unexpected lease')),
    {code:'CURRENT259_CONTRACT_LOGIN_TLS',stageFailure:'TLS_PLAINTEXT_HBA'});
  assert.deepEqual(f.calls.slice(-4),['plaintext-cursor','construct','disconnect','plaintext-readback']);
  assert.equal(f.control.closed,1);
});

for(const [operation,count] of [['CONNECT',1],['QUERY',4]])test('an unreturned '+operation+' keeps its first failure and unknown client cleanup',async()=>{
  const f=fixture();
  f.control.pending=operation;
  await assert.rejects(f.api.withCurrent259ContractLogin(f.completion,f.handle,()=>assert.fail('unexpected lease')),
    {code:'CURRENT259_CONTRACT_LOGIN_TLS',stageFailure:operation+'_TIMEOUT',clientCleanup:'UNKNOWN',roleCommit:'COMMITTED'});
  assert.equal(f.calls.filter(value=>value==='construct').length,count);
  assert.equal(f.calls.filter(value=>value==='disconnect').length,count);
  assert.equal(f.control.closed,1);
});
