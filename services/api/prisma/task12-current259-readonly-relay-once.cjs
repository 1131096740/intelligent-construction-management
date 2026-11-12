#!/usr/bin/env node
'use strict';
const FRESH=require.main===module&&process.argv[1]===__filename&&process.execArgv.length===0&&
  !process._preload_modules?.length&&Object.keys(require.cache).every(key=>key===__filename);
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {createGeneratedDraftAdmissionDiagnostic}=require('./task12-current259-generated-draft-diagnostic.cjs');

const OWNER='jg_task01_owner';
const starts=new WeakMap();
function claimReadonlyRelayResource(permit,options){
  const entry=starts.get(permit);
  const own=key=>Object.getOwnPropertyDescriptor(options,key)?.value;
  if(!entry||!options||entry.artifactsDir!==own('artifactsDir')||entry.daemonId!==own('daemonId')||
    entry.sourceSha!==own('sourceSha')||entry.signal!==own('signal'))return false;
  starts.delete(permit);
  return true;
}
module.exports=Object.freeze({claimReadonlyRelayResource});
const prefix='CURRENT259_READONLY_RELAY_PROBE_V2_';
const identitySql=`
SELECT current_user::text AS "role", session_user::text AS "sessionRole", current_database() AS "database",
  pg_backend_pid() AS "pid", to_char(activity.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "start" , ssl.ssl AS "tls",
  host(inet_client_addr()) AS "client", host(inet_server_addr()) AS "server", inet_server_port() AS "serverPort",
  to_regclass('public._prisma_migrations') IS NULL AS "noMigrations",
  current_setting('transaction_read_only') = 'on' AS "readOnly", $1::text AS "challenge"
FROM pg_catalog.pg_stat_activity activity JOIN pg_catalog.pg_stat_ssl ssl USING (pid)
WHERE activity.pid=pg_backend_pid()`;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const localReasons=new WeakMap();
const error=reason=>{
  const cause=Object.assign(new Error(prefix+reason),{code:prefix+reason});
  localReasons.set(cause,reason==='IDENTITY'?'TLS_IDENTITY':reason);
  return cause;
};
const need=(ok,reason)=>{if(!ok)throw error(reason);};

function writeNew(file,bytes,onOpen){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{onOpen?.();fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

async function bounded(operation,reason){
  let timer;
  try{
    return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(error(reason)),15000);
    })]);
  }finally{clearTimeout(timer);}
}

async function probe(view,check,report,read,progress){
  const {resource,loader,beginReadonlyRelayProbe}=view;
  const {caPath,serverCertHashes,databaseName,port}=resource;
  const readCa=expectedIdentity=>read(caPath,{maxBytes:1024*1024,expectedIdentity,code:'CURRENT259_CONTRACT_LOGIN_CA'});
  const ca=readCa();
  const caMatches=row=>row.identity.uid===process.getuid()&&row.sha256===serverCertHashes.caSha256;
  need(caMatches(ca),'CA');
  const full=()=>{
    check();
    view.verifyFull();
    need(caMatches(readCa(ca.identity)),'CA');
  };
  const url=new URL(`postgresql://${OWNER}:${view.credentials().owner}@127.0.0.1:${port}/${databaseName}`);
  for(const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',
    sslcert:caPath,options:'-c default_transaction_read_only=on',application_name:'jg_394_contract_tls',connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
  let previous;
  for(let index=0;index<2;index++){
    const enter=step=>report.enter('TLS_POSITIVE_'+step,index);
    let client,disconnect,window,firstFault,disconnectResolved=false;
    try{
      enter('CONSTRUCT');
      full();
      client=new loader.Class({datasources:{db:{url:url.toString()}},log:[]});
      disconnect=client.$disconnect;
      const connect=client.$connect,query=client.$queryRawUnsafe;
      need([connect,query,disconnect].every(value=>typeof value==='function'),'CLIENT');
      const clientCheck=()=>{
        full();
        need(client.$connect===connect&&client.$queryRawUnsafe===query&&client.$disconnect===disconnect,'CLIENT');
      };
      enter('CONNECT');
      clientCheck();
      need(typeof beginReadonlyRelayProbe==='function'&&view.beginReadonlyRelayProbe===beginReadonlyRelayProbe,'METHOD');
      window=beginReadonlyRelayProbe.call(view);
      need(typeof window?.markDisconnect==='function'&&typeof window?.finish==='function','METHOD');
      await bounded(()=>connect.call(client),'CONNECT_TIMEOUT');
      enter('CONTINUITY');
      clientCheck();
      enter('IDENTITY');
      const self=async()=>{
        const challenge=randomBytes(32).toString('hex');
        const rows=await bounded(()=>query.call(client,identitySql,challenge),'QUERY_TIMEOUT');
        clientCheck();
        need(Array.isArray(rows)&&rows.length===1,'IDENTITY');
        const [row]=rows;
        need(row.role===OWNER&&row.sessionRole===OWNER&&row.database===databaseName&&row.tls===true&&
          row.client==='127.0.0.1'&&row.server==='127.0.0.1'&&row.serverPort===5432&&row.noMigrations===true&&row.readOnly===true&&
          row.challenge===challenge&&Number.isInteger(row.pid)&&row.pid>0&&
          typeof row.start==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.start)&&Number.isFinite(Date.parse(row.start)),'IDENTITY');
        progress.identityReads++;
        return row;
      };
      const first=await self(),last=await self();
      need(first.pid===last.pid&&first.start===last.start&&first.challenge!==last.challenge&&(!previous||first.pid!==previous.pid),'IDENTITY');
      previous=first;
      window.markDisconnect(first.pid,first.start);
    }catch(cause){
      const reason=localReasons.get(cause);
      if(reason==='CONNECT_TIMEOUT'||reason==='QUERY_TIMEOUT')progress.clientCleanupUnknown=true;
      report.capture(cause,reason);
      firstFault={cause};
    }
    if(client){
      enter('DISCONNECT');
      try{await bounded(()=>disconnect.call(client),'DISCONNECT_UNKNOWN');disconnectResolved=true;}
      catch(cause){

        progress.clientCleanupUnknown=true;
        if(!firstFault){
          report.capture(cause,'DISCONNECT_UNKNOWN');
          firstFault={cause};
        }
      }
    }
    if(firstFault)throw firstFault.cause;
    enter('DRAIN');
    let closeKind;
    try{
      need(disconnectResolved,'DISCONNECT_UNKNOWN');
      closeKind=await window.finish();
      need(closeKind==='REAL_FIN'||closeKind==='CLOSED_BY_RESET','IDENTITY');
    }catch(cause){report.capture(cause,localReasons.get(cause));throw cause;}
    enter('CONTINUITY');
    try{full();}catch(cause){report.capture(cause,localReasons.get(cause));throw cause;}
    progress.clients.push(Object.freeze({identityVerified:true,closeKind,...(closeKind==='CLOSED_BY_RESET'?{backendGone:true}:{})}));
  }
}

async function main(){
  const controller=new AbortController(),abort=()=>controller.abort();
  const diagnostic=createGeneratedDraftAdmissionDiagnostic();
  const report={enter:diagnostic.enter,capture(...args){failure??=diagnostic.capture(...args);}};
  const progress={clients:[],identityReads:0,clientCleanupUnknown:false};
  let plan,coordinates,attempted=false,resourceAttempted=false,phase='PREFLIGHT',cleanup='NOT_STARTED',failure;
  let read,owned;
  const result=status=>({status:prefix+status,phase,...coordinates,attempted,cleanup,
    clients:progress.clients,identityReads:progress.identityReads,nativeAdmission:false,
    ...(progress.clientCleanupUnknown?{clientCleanup:'UNKNOWN'}:{}),...(failure?{failure}:{})});
  function cleanupProof(){
    if(!resourceAttempted)return 'NOT_STARTED';
    try{
      const observed=read(path.join(plan.run.resourceDir,'resource-manifest.json'),
        {privateFile:true,maxBytes:128*1024,collect:true,code:prefix+'CLEANUP'});
      const resource=JSON.parse(observed.bytes),state=resource.cleanup;
      if(resource.sourceSha===coordinates.sourceSha&&resource.daemonId===plan.resource.daemonId&&
        resource.topology===plan.resource.transport&&resource.status==='closed'&&state.status==='completed'&&
        (!owned||resource.runId===owned.runId&&resource.containerId===owned.containerId&&state.relayId===owned.relayId)&&
        ['containerAbsent','networkAbsent','volumesAbsent','relayClosed'].every(key=>state[key]===true))return 'VERIFIED';
    }catch{/* The original owner still supplies the primary failure. */}
    return 'UNKNOWN';
  }
  try{
    need(FRESH,'FRESH');
    const args=process.argv.slice(2),once=args[4]==='--once';
    need((args.length===4||args.length===5&&once)&&args[0]==='--plan'&&
      args[2]==='--expected-plan-sha256'&&/^[a-f0-9]{64}$/u.test(args[3]),'ARGS');
    need(!Object.keys(process.env).some(key=>/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy|COS_.*)$/u.test(key)),'HOST_ENV');
    const {verifyCurrent259ReadonlyRelayPlan}=require('../../../scripts/prepare-task12-current259-generated-draft.cjs');
    const verified=verifyCurrent259ReadonlyRelayPlan(args[1],args[3]);
    plan=verified.plan;
    coordinates={planSha256:verified.sha256,sourceSha:plan.source.candidateSha};
    if(!once)return result('HOLD');
    read=require('./task16-runtime-inputs.cjs').readQualifiedTask16File;
    const {withCurrent259ReadonlyRelayResource,claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    phase='ATTEMPT';
    verified.check();
    need(!controller.signal.aborted&&fs.readdirSync(plan.run.root).length===0,'ATTEMPT_USED');
    const marker=Buffer.from(JSON.stringify({status:'CONSUMED',...coordinates})+'\n');
    writeNew(plan.run.attemptFile,marker,()=>{attempted=true;});
    const witness=read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,code:prefix+'ATTEMPT'});
    const check=()=>{
      need(!controller.signal.aborted,'ABORTED');
      verified.checkContinuity();
      need(read(plan.run.attemptFile,{privateFile:true,maxBytes:4096,expectedIdentity:witness.identity,code:prefix+'ATTEMPT'}).sha256===
        digest(marker),'ATTEMPT');
    };
    phase='RESOURCE';check();resourceAttempted=true;
    const permit=Object.freeze({});
    starts.set(permit,{artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId,
      sourceSha:coordinates.sourceSha,signal:controller.signal});
    try{await withCurrent259ReadonlyRelayResource(verified.buildHandle,
      {artifactsDir:plan.run.resourceDir,daemonId:plan.resource.daemonId},controller.signal,permit,async handle=>{
        phase='TLS';
        const view=claimCurrent259TechnicalResource(handle);
        owned={runId:view.runId,containerId:view.resource.containerId,relayId:view.resource.relayId};
        await probe(view,check,report,read,progress);
      });}finally{starts.delete(permit);}
    phase='CLEANUP';cleanup=cleanupProof();need(cleanup==='VERIFIED','CLEANUP');
    verified.check();check();
    phase='COMPLETE';
    const receipt=result('COMPLETE');
    writeNew(plan.run.receiptFile,Buffer.from(JSON.stringify(receipt)+'\n'));
    return receipt;
  }catch{
    process.exitCode=1;
    cleanup=cleanupProof();
    const receipt=result('STOPPED');
    if(attempted)try{writeNew(plan.run.receiptFile,Buffer.from(JSON.stringify(receipt)+'\n'));}catch{/* Preserve the first stop. */}
    return receipt;
  }finally{
    controller.abort();
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  }
}
if(require.main===module)void main().then(value=>process.stdout.write(JSON.stringify(value)+'\n'));
