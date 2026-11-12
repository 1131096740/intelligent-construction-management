'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const entry=path.join(__dirname,'task12-current259-readonly-relay-once.cjs');
const source=fs.readFileSync(entry,'utf8').replace(/^#![^\n]*\n/u,'');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function model(t,{once=true,used=false,drift,invalidPlan=false,closeKinds=['CLOSED_BY_RESET','REAL_FIN']}={}){
  const root=fs.mkdtempSync('/private/tmp/jg-relay-once-model-');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const run=path.join(root,'relay-readonly-run');fs.mkdirSync(run,{mode:0o700});
  const calls=[],out=[],caPath=path.join(root,'ca'),daemonId='model-daemon-id-01';
  const planSha='c'.repeat(64),candidateSha='a'.repeat(40);
  const resourceDir=path.join(run,'resource'),attemptFile=path.join(run,'attempt.json'),receiptFile=path.join(run,'receipt.json');
  const transport='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',databaseName='jg_task01_synthetic';
  const runId='fixture-owned-run',containerId='fixture-owned-container',relayId='fixture-owned-relay';
  const plan={source:{candidateSha},run:{root:run,resourceDir,attemptFile,receiptFile},resource:{daemonId,transport}};
  const holder={exports:{}},handle=Object.freeze({}),buildHandle=Object.freeze({});
  const fakeProcess={argv:['node',entry,'--plan',path.join(root,'RELAY-READONLY-PLAN.json'),'--expected-plan-sha256',planSha,...(once?['--once']:[])],
    execArgv:[],env:{},getuid:()=>process.getuid(),once(){},removeListener(){},
    stdout:{write(data){out.push(JSON.parse(data));}}};
  if(used)fs.writeFileSync(attemptFile,'prior',{mode:0o600});
  let clients=0,reads=0,checks=0,lastClosed=false,window,drained=0;
  class Client{
    constructor(config){
      this.index=clients++;
      calls.push('construct'+this.index);
      if(this.index===1)assert.ok(lastClosed&&checks>0&&drained===1);
      const url=new URL(config.datasources.db.url);
      assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'43126');
      assert.equal(url.username,'jg_task01_owner');assert.equal(url.pathname,'/'+databaseName);
      assert.deepEqual(Object.fromEntries(url.searchParams),{schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',
        sslcert:caPath,options:'-c default_transaction_read_only=on',application_name:'jg_394_contract_tls',connect_timeout:'5',pool_timeout:'5'});
    }
    async $connect(){
      calls.push('connect'+this.index);
      if(window){assert.equal(window.index,this.index);window.connected=true;}
      if(drift==='frame'||drift==='frame-and-drain')throw Object.assign(new Error('private bytes'),{
        code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',
        relayFrameStage:'STDOUT_EOF_WITHOUT_FIN'});
    }
    async $queryRawUnsafe(sql,challenge){
      calls.push('read'+this.index);reads++;
      assert.match(sql,/^\s*SELECT /u);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/u);
      assert.match(sql,/current_setting\('transaction_read_only'\) = 'on'/u);
      assert.match(sql,/to_regclass\('public\._prisma_migrations'\) IS NULL/u);
      assert.match(challenge,/^[a-f0-9]{64}$/u);
      const pid=drift==='rotate'&&reads===2?51:50+this.index;
      return [{role:'jg_task01_owner',sessionRole:'jg_task01_owner',database:databaseName,tls:true,
        client:'127.0.0.1',server:'127.0.0.1',serverPort:5432,noMigrations:drift!=='migrated',
        pid,start:'2026-11-12T11:00:00.000001Z',readOnly:drift!=='write-enabled',challenge:drift==='wrong-nonce'?'forged':challenge}];
    }
    async $disconnect(){calls.push('disconnect'+this.index);lastClosed=true;checks=0;
      if(window){assert.equal(window.index,this.index);window.disconnected=true;}
      if(drift==='disconnect')throw new Error('private disconnect');
    }
  }
  const ports={
    '../../../scripts/prepare-task12-current259-generated-draft.cjs':{verifyCurrent259ReadonlyRelayPlan(file,digest){
      assert.equal(file,path.join(root,'RELAY-READONLY-PLAN.json'));assert.equal(digest,planSha);
      if(invalidPlan)throw new Error('private input');
      return {plan,sha256:digest,buildHandle,check(){},checkContinuity(){}};
    }},
    './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,options){
      if(file===caPath)return {identity:{uid:process.getuid()},sha256:'ca'};
      const bytes=fs.readFileSync(file);
      if(file===attemptFile&&drift==='marker')return {identity:{},sha256:'replaced'};
      assert.equal(options.privateFile,true);
      return {bytes,sha256:hash(bytes),identity:{}};
    }},
    './task16-current259-owned-resource.cjs':{
      async withCurrent259ReadonlyRelayResource(build,input,signal,permit,consume){
        calls.push('open');
        assert.equal(build,buildHandle);assert.deepEqual(input,{artifactsDir:resourceDir,daemonId});
        assert.ok(signal instanceof AbortSignal&&!signal.aborted);
        const claim=holder.exports.claimReadonlyRelayResource;
        const options={artifactsDir:resourceDir,daemonId,sourceSha:candidateSha,signal};
        assert.equal(claim({...permit},options),false);
        assert.equal(claim(permit,{...options,daemonId:'wrong-daemon'}),false);
        assert.equal(claim(permit,options),true);
        assert.equal(claim(permit,options),false);
        fs.mkdirSync(resourceDir,{mode:0o700});
        try{await consume(handle);}
        finally{
          calls.push('close');
          fs.writeFileSync(path.join(resourceDir,'resource-manifest.json'),JSON.stringify({sourceSha:candidateSha,daemonId,topology:transport,
            status:'closed',runId,containerId,cleanup:{status:'completed',containerAbsent:true,networkAbsent:true,volumesAbsent:true,
              relayClosed:drift!=='cleanup',relayId:drift==='cleanup-scope'?'other':relayId}}),
          {mode:0o600});
        }
      },
      claimCurrent259TechnicalResource(actual){
        assert.equal(actual,handle);
        return {runId,resource:{caPath,serverCertHashes:{caSha256:'ca'},databaseName,port:43126,containerId,relayId},
          loader:{Class:Client},
          credentials:()=>({owner:'private-secret'}),
          beginReadonlyRelayProbe(){
            assert.equal(window,undefined);
            const current={index:clients-1,connected:false,disconnected:false,marked:false};
            calls.push('begin-drain'+current.index);
            if(drift==='drain-shape')return undefined;
            window=current;
            return {
              markDisconnect(pid,start){
                assert.equal(window,current);
                assert.equal(reads,2*(current.index+1));
                assert.equal(pid,50+current.index);
                assert.equal(start,'2026-11-12T11:00:00.000001Z');
                assert.ok(!current.disconnected);
                current.marked=true;
              },
              async finish(){
                assert.equal(window,current);
                assert.ok(current.connected&&current.disconnected&&current.marked);
                calls.push('drain-start'+current.index);
                await new Promise(resolve=>setImmediate(resolve));
                if(drift==='drain'||drift==='drain-second'&&current.index===1)throw Object.assign(new Error('private relay state'),{
                  code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT'});
                window=undefined;drained++;calls.push('drain-done'+current.index);
                return closeKinds[current.index];
              },
            };
          },
          verifyFull(){
            assert.ok(!window?.disconnected,'disconnected relay worker must drain before deep continuity');
            checks++;
          }};
      }
    }
  };
  new Function('require','module','process','__filename',source)(Object.assign(name=>ports[name]??require(name),
    {main:holder,cache:{[entry]:holder}}),holder,fakeProcess,entry);
  return {calls,fakeProcess,root,run,attemptFile,receiptFile,result:async()=>{
    for(let i=0;i<20&&!out.length;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(out.length,1);return out[0];
  }};
}
test('offline HOLD never opens resources or consumes the separate marker',async t=>{
  const f=model(t,{once:false});
  assert.equal((await f.result()).status,'CURRENT259_READONLY_RELAY_PROBE_V2_HOLD');
  assert.deepEqual(f.calls,[]);assert.deepEqual(fs.readdirSync(f.run),[]);
});
test('the exact owner runs two sequential strict TLS clients and records verified cleanup',async t=>{
  const f=model(t),r=await f.result();
  assert.equal(r.status,'CURRENT259_READONLY_RELAY_PROBE_V2_COMPLETE');
  assert.equal(r.cleanup,'VERIFIED');assert.equal(r.identityReads,4);assert.equal(r.nativeAdmission,false);
  assert.deepEqual(r.clients,[{identityVerified:true,closeKind:'CLOSED_BY_RESET',backendGone:true},
    {identityVerified:true,closeKind:'REAL_FIN'}]);
  assert.equal(r.positiveClients,undefined);
  assert.deepEqual(f.calls,['open','construct0','begin-drain0','connect0','read0','read0','disconnect0','drain-start0','drain-done0',
    'construct1','begin-drain1','connect1','read1','read1','disconnect1','drain-start1','drain-done1','close']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.receiptFile)),r);
  assert.doesNotMatch(JSON.stringify(r),/private|127\.0\.0\.1/u);
});
for(const [options,phase,opened] of [
  [{used:true},'ATTEMPT',false],[{invalidPlan:true},'PREFLIGHT',false],[{drift:'marker'},'RESOURCE',false],
  [{drift:'frame'},'TLS',true],[{drift:'wrong-nonce'},'TLS',true],[{drift:'write-enabled'},'TLS',true],[{drift:'rotate'},'TLS',true],[{drift:'migrated'},'TLS',true],
  [{drift:'disconnect'},'TLS',true],[{drift:'drain'},'TLS',true],[{drift:'drain-shape'},'TLS',true],[{drift:'cleanup'},'CLEANUP',true],[{drift:'cleanup-scope'},'CLEANUP',true],
]){
  test('relay stops on '+JSON.stringify(options),async t=>{
    const f=model(t,options),r=await f.result();
    assert.equal(r.status,'CURRENT259_READONLY_RELAY_PROBE_V2_STOPPED');assert.equal(r.phase,phase);
    assert.equal(f.calls.includes('open'),opened);assert.equal(f.calls.includes('close'),opened);
    if(phase!=='CLEANUP')assert.equal(f.calls.includes('construct1'),false);
    if(options.drift==='frame'||options.drift==='frame-and-drain'){
      assert.equal(r.failure.stage,'TLS_POSITIVE_CONNECT');
      assert.equal(r.failure.relayFrameStage,'STDOUT_EOF_WITHOUT_FIN');
      assert.equal(f.calls.includes('drain-start0'),false);
    }
    if(phase==='CLEANUP')assert.equal(r.cleanup,'UNKNOWN');
    if(options.drift==='disconnect'){
      assert.equal(r.clientCleanup,'UNKNOWN');assert.equal(f.calls.includes('drain-start0'),false);
    }
    if(options.drift==='drain'){
      assert.equal(r.cleanup,'VERIFIED');assert.equal(r.identityReads,2);assert.deepEqual(r.clients,[]);
      assert.deepEqual(r.failure,{stage:'TLS_POSITIVE_DRAIN',operationCode:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',
        relayCode:'CURRENT259_LOOPBACK_FORWARD_DEPLOY_DRAIN_TIMEOUT',roleIndex:0});
    }
    if(options.drift==='drain-shape'){
      assert.equal(f.calls.includes('connect0'),false);assert.ok(f.calls.includes('disconnect0'));
      assert.deepEqual(r.failure,{stage:'TLS_POSITIVE_CONNECT',reason:'METHOD',roleIndex:0});
    }
    if(options.used)assert.equal(fs.readFileSync(f.attemptFile,'utf8'),'prior');
    assert.equal(f.fakeProcess.exitCode,1);
    assert.doesNotMatch(JSON.stringify(r),/private/u);
  });
}

test('a second peer drain failure preserves four readbacks without certifying that peer',async t=>{
  const f=model(t,{drift:'drain-second'}),r=await f.result();
  assert.equal(r.status,'CURRENT259_READONLY_RELAY_PROBE_V2_STOPPED');
  assert.equal(r.clients.length,1);assert.equal(r.identityReads,4);assert.equal(r.cleanup,'VERIFIED');
  assert.equal(r.failure.stage,'TLS_POSITIVE_DRAIN');assert.equal(r.failure.roleIndex,1);
  assert.equal(f.calls.at(-1),'close');
});
