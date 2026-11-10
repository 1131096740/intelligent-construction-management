"use strict";
// Fixed closed owner probes only. Import creates no client or resource. This
// proof never represents a retained owner/runtime/observer business session.
const {types,isDeepStrictEqual}=require('node:util');
const {isIP}=require('node:net');
const {randomBytes}=require('node:crypto');
const {claimCurrent259OwnedResource,closeCurrent259OwnedResource}=require('./task16-current259-owned-resource.cjs');
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
const OWNER='jg_task01_owner',LIMIT=1048576;
const proofs=new WeakMap(),used=new WeakSet();
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
const own=(value,key)=>{need(value&&!types.isProxy(value),'CURRENT259_OWNER_DATA');const d=Object.getOwnPropertyDescriptor(value,key);need(d&&Object.hasOwn(d,'value'),'CURRENT259_OWNER_DATA');return d.value;};
const oid=v=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/u.test(v)&&BigInt(v)<=0xffffffffn;
const wide=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/u.test(v)&&BigInt(v)<=0xffffffffffffffffn;
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(v)&&Number.isFinite(Date.parse(v));
const pid=v=>Number.isInteger(v)&&v>0&&v<=0x7fffffff;
const port=v=>Number.isInteger(v)&&v>0&&v<=65535;
const time=expr=>`pg_catalog.to_char(${expr} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const identitySql=`pg_catalog.current_database()::pg_catalog.text AS database,
 (SELECT oid::pg_catalog.text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AS "databaseOid",
 (SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
 current_user::pg_catalog.text AS "effectiveRole",session_user::pg_catalog.text AS "loginRole",
 current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "effectiveOid",
 session_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "loginOid",
 (SELECT datdba::pg_catalog.text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) AS "ownerOid",
 pg_catalog.pg_backend_pid() AS pid,
 (SELECT ${time('backend_start')} FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()) AS start,
 coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) AS tls,
 pg_catalog.current_setting('server_version_num')::pg_catalog.int4 AS version,
 pg_catalog.getdatabaseencoding() AS encoding,pg_catalog.current_setting('session_replication_role') AS replication,
 pg_catalog.current_setting('transaction_read_only') AS "readOnly",pg_catalog.current_setting('default_transaction_read_only') AS "defaultReadOnly",
 pg_catalog.inet_client_addr()::pg_catalog.text AS "clientAddress",pg_catalog.inet_client_port() AS "clientPort",
 pg_catalog.inet_server_addr()::pg_catalog.text AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort"`;
const hostSql=`SELECT ${identitySql},$1::pg_catalog.text AS nonce`;
const identityKeys=['database','databaseOid','systemIdentifier','effectiveRole','loginRole','effectiveOid','loginOid','ownerOid','pid','start','tls','version','encoding','replication','readOnly','defaultReadOnly','clientAddress','clientPort','serverAddress','serverPort','nonce'];
function snapshot(row,keys){need(row&&!types.isProxy(row)&&Object.getPrototypeOf(row)===Object.prototype&&Reflect.ownKeys(row).length===keys.length,'CURRENT259_OWNER_DATA');return Object.freeze(Object.fromEntries(keys.map(key=>[key,own(row,key)])));}
function engineError(error){
 const data=key=>{if(!error||types.isProxy(error))return undefined;const d=Object.getOwnPropertyDescriptor(error,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
 const code=data('errorCode')??data('code'),message=data('message');
 return Object.freeze({prismaCode:typeof code==='string'&&/^P[0-9]{4}$/u.test(code)?code:null,certificateMarker:typeof message==='string'&&message.toLowerCase().includes('tls connection')&&message.toLowerCase().includes('certificate was not trusted')});
}
function claimCurrent259OwnerTls(proof,handle){
 need(proof&&!types.isProxy(proof)&&proofs.has(proof),'CURRENT259_OWNER_PROOF');const entry=proofs.get(proof);
 need(handle===entry.handle,'CURRENT259_OWNER_PROOF');try{entry.check();return entry.view;}catch(error){proofs.delete(proof);try{void Promise.resolve(closeCurrent259OwnedResource(entry.handle)).catch(()=>{});}catch{ /* proof stays invalid; resource cleanup remains unconfirmed */ }throw error;}
}
async function verifyCurrent259OwnerTls(handle){
 need(arguments.length===1,'CURRENT259_OWNER_ARGUMENTS');const view=claimCurrent259OwnedResource(handle);
 try{return await runOwnedOwnerTls(handle,view);}
 catch(error){
  let resourceCleanup='CLOSED';try{await closeCurrent259OwnedResource(handle);}catch{resourceCleanup='UNKNOWN';}
  const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;
  throw Object.assign(fail(typeof code==='string'&&/^CURRENT259_OWNER_[A-Z0-9_]+$/u.test(code)?code:'CURRENT259_OWNER_FAILED_CLOSED'),{ownerRestorationOutcome:error?.ownerRestorationOutcome??'NOT_NEEDED',clientCleanupOutcome:error?.clientCleanupOutcome??'NOT_ATTEMPTED',resourceCleanupOutcome:resourceCleanup});
 }
}
async function runOwnedOwnerTls(handle,view){
need(!used.has(handle),'CURRENT259_OWNER_REUSED');used.add(handle);
 const resource=view.resource,loader=view.loader,Class=loader.Class,runId=view.runId;
 const resourceMethods=Object.fromEntries(['getReceipt','execOwnerSql','setServerCertificate','captureLogCursor','readPlaintextRejectionEvidence'].map(key=>[key,own(resource,key)]));
 const credential=view.credentials().owner;
 need(typeof Class==='function'&&typeof credential==='string'&&/^[a-f0-9]{96}$/u.test(credential),'CURRENT259_OWNER_SOURCE');
 const initial=resourceMethods.getReceipt(),tls=Object.freeze({...initial.tls});
 const hashKeys=['caSha256','wrongCaSha256','correctCertificateSha256','wrongSanCertificateSha256','correctCertificateDerSha256','wrongSanCertificateDerSha256'];
 need(hashKeys.every(key=>/^[a-f0-9]{64}$/u.test(tls[key]))&&tls.caSha256!==tls.wrongCaSha256&&tls.correctCertificateDerSha256!==tls.wrongSanCertificateDerSha256,'CURRENT259_OWNER_CA');
 const cas=[resource.caPath,resource.wrongCaPath].map((file,index)=>{const data=read(file,{privateFile:true,maxBytes:LIMIT,code:'CURRENT259_OWNER_CA'});need(data.sha256===tls[index?'wrongCaSha256':'caSha256'],'CURRENT259_OWNER_CA');return Object.freeze({file,identity:data.identity,sha256:data.sha256});});
 const source=view.source,sourceSnapshot=JSON.stringify(source),probes=[],owned=[];
 let anchor,primary,failed=false,restoration='NOT_NEEDED',clientCleanup='DISCONNECTED',resourceCleanup='NOT_NEEDED',closing;
 const deadline=Date.now()+180000;
 const closeOwned=()=>{if(!closing)closing=Promise.resolve().then(()=>closeCurrent259OwnedResource(handle)).then(()=>{resourceCleanup='CLOSED';},()=>{resourceCleanup='UNKNOWN';});return closing;};
 function check(mode='correct'){
  view.check();need(claimCurrent259OwnedResource(handle)===view&&view.loader===loader&&loader.Class===Class&&view.resource===resource&&view.runId===runId&&view.source===source&&JSON.stringify(source)===sourceSnapshot,'CURRENT259_OWNER_SOURCE');
  need(Object.keys(resourceMethods).every(key=>own(resource,key)===resourceMethods[key]),'CURRENT259_OWNER_RESOURCE');
  const current=resourceMethods.getReceipt();
  need(['runId','sourceSha','containerId','networkId','databaseName','port'].every(key=>current[key]===initial[key])&&hashKeys.every(key=>current.tls?.[key]===tls[key]),'CURRENT259_OWNER_RESOURCE');
  for(const ca of cas)need(read(ca.file,{privateFile:true,maxBytes:LIMIT,expectedIdentity:ca.identity,code:'CURRENT259_OWNER_CA'}).sha256===ca.sha256,'CURRENT259_OWNER_CA');
  if(mode!==null)need(current.requestedCertificateMode===mode&&current.reloadState==='OBSERVED_PEER_CERTIFICATE_MATCHED'&&current.presentedCertificate?.mode===mode&&current.presentedCertificate.derSha256===tls[mode==='correct'?'correctCertificateDerSha256':'wrongSanCertificateDerSha256'],'CURRENT259_OWNER_CERTIFICATE');
 }
 const full=(mode='correct')=>{check(mode);view.verifyFull();check(mode);};
 async function settled(action,mode='correct',cleanup=false){
  if(!cleanup)check(mode);
  let timer;const remaining=cleanup?10000:Math.min(30000,deadline-Date.now());need(remaining>0,'CURRENT259_OWNER_TIMEOUT');
  const actual=Promise.resolve().then(action).then(value=>({ok:true,value}),error=>({ok:false,error}));
  const timed=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),remaining);});
  const result=await Promise.race([actual,timed]);clearTimeout(timer);
  if(result.timeout){clientCleanup='UNKNOWN';void closeOwned();throw fail('CURRENT259_OWNER_UNSETTLED');}
  if(!result.ok)throw result.error;
  if(!cleanup)check(mode);return result.value;
 }
 function identity(raw,nonce){
  const row=snapshot(raw,identityKeys);
  need(row.nonce===nonce&&row.database===initial.databaseName&&oid(row.databaseOid)&&wide(row.systemIdentifier)&&row.effectiveRole===OWNER&&row.loginRole===OWNER&&oid(row.ownerOid)&&row.effectiveOid===row.ownerOid&&row.loginOid===row.ownerOid&&pid(row.pid)&&stamp(row.start)&&row.tls===true&&Number.isInteger(row.version)&&row.version>=160000&&row.version<170000&&row.encoding==='UTF8'&&row.replication==='origin'&&row.readOnly==='off'&&row.defaultReadOnly==='off'&&isIP(row.clientAddress)===4&&port(row.clientPort)&&isIP(row.serverAddress)===4&&row.serverPort===5432,'CURRENT259_OWNER_IDENTITY');
  if(anchor)need(['database','databaseOid','systemIdentifier','ownerOid','effectiveOid','loginOid','version','encoding','replication','readOnly','defaultReadOnly'].every(key=>row[key]===anchor[key]),'CURRENT259_OWNER_DATABASE_CHANGED');return row;
 }
 async function ownerRead(){
  full();const nonce=randomBytes(32).toString('hex');
  const sql=`SELECT pg_catalog.row_to_json(anchor) FROM (SELECT ${identitySql},'${nonce}'::pg_catalog.text AS nonce) anchor`;
  const result=await settled(()=>resourceMethods.execOwnerSql(sql,'current259-owner-anchor'));
  need(typeof result?.stdout==='string'&&Buffer.byteLength(result.stdout)<=LIMIT,'CURRENT259_OWNER_OUTPUT');const row=identity(JSON.parse(result.stdout.trim()),nonce);if(!anchor)anchor=row;full();
 }
 async function liveRead(row){
  const nonce=randomBytes(32).toString('hex');
  const sql=`SELECT pg_catalog.row_to_json(observed) FROM (SELECT pg_catalog.current_database()::pg_catalog.text AS database,
   d.oid::pg_catalog.text AS "databaseOid",(SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
   d.datdba::pg_catalog.text AS "ownerOid",a.usesysid::pg_catalog.text AS "loginOid",a.usename::pg_catalog.text AS "loginRole",a.pid,${time('a.backend_start')} AS start,
   coalesce(s.ssl,false) AS tls,a.client_addr::pg_catalog.text AS "clientAddress",a.client_port AS "clientPort",
   pg_catalog.pg_backend_pid() AS "readerPid",(SELECT ${time('backend_start')} FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()) AS "readerStart",
   current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "readerOid",current_user::pg_catalog.text AS "readerRole",
   coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) AS "readerTls",'${nonce}'::pg_catalog.text AS nonce
   FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_database d ON d.oid=a.datid LEFT JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid
   WHERE d.datname=pg_catalog.current_database() AND a.pid=${row.pid} AND ${time('a.backend_start')}='${row.start}') observed`;
  const result=await settled(()=>resourceMethods.execOwnerSql(sql,'current259-owner-live'));
  need(typeof result?.stdout==='string'&&Buffer.byteLength(result.stdout)<=LIMIT,'CURRENT259_OWNER_OUTPUT');
  const v=snapshot(JSON.parse(result.stdout.trim()),['database','databaseOid','systemIdentifier','ownerOid','loginOid','loginRole','pid','start','tls','clientAddress','clientPort','readerPid','readerStart','readerOid','readerRole','readerTls','nonce']);
  need(v.nonce===nonce&&['database','databaseOid','systemIdentifier','ownerOid','loginOid','loginRole','pid','start','tls','clientAddress','clientPort'].every(key=>v[key]===row[key])&&pid(v.readerPid)&&v.readerPid!==row.pid&&stamp(v.readerStart)&&v.readerOid===anchor.ownerOid&&v.readerRole===OWNER&&v.readerTls===true,'CURRENT259_OWNER_LIVE_READBACK');
 }
 async function probe(kind,caIndex=0,mode='correct'){
  full(mode);const url=new URL(`postgresql://${OWNER}:${credential}@127.0.0.1:${initial.port}/${initial.databaseName}`);
  for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:kind==='plaintext'?'disable':'require',sslaccept:'strict',sslcert:cas[caIndex].file,application_name:`task16_owner_${runId.replaceAll('-','')}`,connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
  let client;try{client=new Class({datasources:{db:{url:url.toString()}},log:[]});}catch{clientCleanup='UNKNOWN';throw fail('CURRENT259_OWNER_CONSTRUCTOR_UNKNOWN');}
  need(client&&(typeof client==='object'||typeof client==='function')&&!owned.some(entry=>entry.client===client),'CURRENT259_OWNER_CLIENT');
  const entry={client,disconnect:client.$disconnect,disconnected:false,disconnectAttempted:false};owned.push(entry);
  const methods={$connect:client.$connect,$queryRawUnsafe:client.$queryRawUnsafe,$disconnect:entry.disconnect};
  need(typeof client.then!=='function'&&Object.values(methods).every(fn=>typeof fn==='function'),'CURRENT259_OWNER_CLIENT');
  const clientCheck=()=>need(Object.keys(methods).every(key=>client[key]===methods[key]),'CURRENT259_OWNER_CLIENT_CHANGED');
  let result,probeFailure,hasFailure=false;
  try{
   clientCheck();let rejected;
   try{await settled(()=>methods.$connect.call(client),mode);}catch(error){const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value;if(typeof code==='string'&&/^CURRENT259_OWNER_[A-Z0-9_]+$/u.test(code))throw error;rejected=engineError(error);}
   check(mode);clientCheck();
   if(kind!=='healthy'){
    need(rejected&&rejected.prismaCode===(kind==='plaintext'?'P1010':'P1011')&&(kind==='plaintext'||rejected.certificateMarker),'CURRENT259_OWNER_NEGATIVE');
    result=Object.freeze({kind,prismaCode:rejected.prismaCode,certificateMarker:rejected.certificateMarker,closed:true});
   }else{
    need(!rejected,'CURRENT259_OWNER_HEALTHY');full(mode);
    const nonce=randomBytes(32).toString('hex'),rows=await settled(()=>methods.$queryRawUnsafe.call(client,hostSql,nonce),mode);clientCheck();
    need(Array.isArray(rows)&&rows.length===1,'CURRENT259_OWNER_IDENTITY');const first=identity(rows[0],nonce);
    await liveRead(first);full(mode);
    const secondNonce=randomBytes(32).toString('hex'),secondRows=await settled(()=>methods.$queryRawUnsafe.call(client,hostSql,secondNonce),mode);clientCheck();
    need(Array.isArray(secondRows)&&secondRows.length===1,'CURRENT259_OWNER_IDENTITY');const second=identity(secondRows[0],secondNonce);
    need(identityKeys.filter(key=>key!=='nonce').every(key=>first[key]===second[key]),'CURRENT259_OWNER_SESSION_CHANGED');
    result=Object.freeze({kind,identity:first,closed:true});
   }
  }catch(error){probeFailure=error;hasFailure=true;}
  finally{
   try{entry.disconnectAttempted=true;await settled(()=>methods.$disconnect.call(client),null,true);entry.disconnected=true;}
   catch{clientCleanup='UNKNOWN';if(!hasFailure){probeFailure=fail('CURRENT259_OWNER_DISCONNECT_UNKNOWN');hasFailure=true;}}
  }
  if(hasFailure)throw probeFailure;full(mode);probes.push(result);return result;
 }
 try{
  full();await ownerRead();await probe('healthy');await probe('wrong-ca',1);await probe('healthy');
  let sanError,sanFailed=false;
  try{restoration='RESTORE_REQUIRED';await settled(()=>resourceMethods.setServerCertificate('wrong-san'),null);check('wrong-san');await probe('wrong-san',0,'wrong-san');}
  catch(error){sanError=error;sanFailed=true;}
  finally{
   try{check(null);await settled(()=>resourceMethods.setServerCertificate('correct'),null);full();restoration='CORRECT_PRESENTATION_RESTORED';}
   catch{restoration='UNKNOWN';if(!sanFailed){sanError=fail('CURRENT259_OWNER_RESTORE_UNKNOWN');sanFailed=true;}}
  }
  if(sanFailed)throw sanError;
  await probe('healthy');const cursor=await settled(()=>resourceMethods.captureLogCursor());
  need(cursor?.runId===runId&&cursor.containerId===resource.containerId,'CURRENT259_OWNER_LOG_CURSOR');await probe('plaintext');
  const hba=await settled(()=>resourceMethods.readPlaintextRejectionEvidence(cursor,{role:OWNER,databaseName:initial.databaseName}));
  need(hba?.hbaNoEncryptionRejected===true&&hba.roleMatched===true&&hba.databaseMatched===true,'CURRENT259_OWNER_PLAINTEXT_HBA');
  await probe('healthy');await ownerRead();full();
  need(owned.length===7&&owned.every(entry=>entry.disconnected)&&clientCleanup==='DISCONNECTED'&&restoration==='CORRECT_PRESENTATION_RESTORED','CURRENT259_OWNER_NOT_CLOSED');
  const proof=Object.freeze({kind:'CURRENT259_OWNER_CLOSED_PROBES'});
  const result=Object.freeze({scope:'CLOSED_OWNER_TLS_CONTROLS_ONLY',runId,source,database:anchor.database,databaseOid:anchor.databaseOid,systemIdentifier:anchor.systemIdentifier,ownerOid:anchor.ownerOid,caSha256:tls.caSha256,probes:Object.freeze(probes.slice()),ownerRestorationOutcome:restoration,clientCleanupOutcome:clientCleanup});
  proofs.set(proof,{handle,check:()=>full(),view:result});return proof;
 }catch(error){primary=error;failed=true;}
 finally{
  if(failed){
   for(const entry of owned.filter(e=>!e.disconnectAttempted)){
    try{entry.disconnectAttempted=true;if(typeof entry.disconnect==='function'){await settled(()=>entry.disconnect.call(entry.client),null,true);entry.disconnected=true;}else clientCleanup='UNKNOWN';}
    catch{clientCleanup='UNKNOWN';}
   }
   await closeOwned();
  }
 }
 const code=typeof primary?.code==='string'&&/^CURRENT259_OWNER_[A-Z0-9_]+$/u.test(primary.code)?primary.code:'CURRENT259_OWNER_FAILED_CLOSED';
 throw Object.assign(fail(code),{ownerRestorationOutcome:restoration,clientCleanupOutcome:clientCleanup,resourceCleanupOutcome:resourceCleanup});
}
module.exports=Object.freeze({verifyCurrent259OwnerTls,claimCurrent259OwnerTls});
