"use strict";
// Fixed read transport, not a native admission issuer. The caller must already own
// its connected session; the application factory separately requires a branded admission.
const {types}=require('node:util');
const {isIP}=require('node:net');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const txCode='TASK16_CLIENT_IMPACT_READER_TRANSACTION';
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const fault=code=>Object.assign(new Error(code),{code});
const ownData=(object,key)=>{if(!object||types.isProxy(object))return undefined;return Object.getOwnPropertyDescriptor(object,key)?.value;};
const readerBodySha256='f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20';
const uuid4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const columns=['factId','impactKind','amountCents','numericProtocolVersion','subjectKind','subjectId'];
const isOid=v=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/u.test(v)&&BigInt(v)<=0xffffffffn;
const isWide=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/u.test(v)&&BigInt(v)<=0xffffffffffffffffn;
const isTimestamp=v=>typeof v==='string'&&iso.test(v)&&Number.isFinite(Date.parse(v));
const timestamp=expression=>`pg_catalog.to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function runtimeScope(database,cluster,pid,roleOid,start,clientAddress,clientPort,serverAddress,serverPort) {
 return `FROM public.jg_task01_connection_identity() i
 WHERE current_user='jg_task01_runtime' AND session_user=current_user AND i."loginRole"=session_user
 AND i."databaseOid"=${database}::pg_catalog.text AND i."systemIdentifier"=${cluster}::pg_catalog.text
 AND i."backendPid"=pg_catalog.pg_backend_pid() AND i."backendPid"=${pid}::pg_catalog.int4 AND i.tls
 AND current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text=${roleOid}::pg_catalog.text
 AND pg_catalog.current_setting('transaction_isolation')='serializable'
 AND pg_catalog.current_setting('session_replication_role')='origin'
 AND pg_catalog.inet_client_addr()=${clientAddress}::pg_catalog.inet AND pg_catalog.inet_client_port()=${clientPort}::pg_catalog.int4
 AND pg_catalog.inet_server_addr()=${serverAddress}::pg_catalog.inet AND pg_catalog.inet_server_port()=${serverPort}::pg_catalog.int4
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a
    WHERE a.pid=pg_catalog.pg_backend_pid() AND ${timestamp("a.backend_start")}=${start}::pg_catalog.text)`;
}
const beginSql=`SELECT ${timestamp("pg_catalog.transaction_timestamp()")} AS "startedAt",
 pg_catalog.host(pg_catalog.inet_client_addr()) AS "clientAddress",pg_catalog.inet_client_port() AS "clientPort",
 pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort"
 ${runtimeScope("$1","$2","$3","$4","$5","$6","$7","$8","$9")}`;
const readSql=`WITH admitted AS MATERIALIZED (
 SELECT $1::pg_catalog.text AS request_key,$2::pg_catalog.text AS execution_id,$3::pg_catalog.text AS payment_id,
  $4::pg_catalog.text AS project_id,$5::pg_catalog.text AS fact_id
 ${runtimeScope("$6","$7","$8","$9","$10","$15","$16","$17","$18")}
 AND ${timestamp("pg_catalog.transaction_timestamp()")}=$11::pg_catalog.text
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.jg_read_registered_payment_impacts(text,text,text,text,text)')
   AND p.oid=$12::pg_catalog.oid AND p.proowner=$13::pg_catalog.oid AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=pg_catalog']
   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='${readerBodySha256}'
   AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
   AND NOT pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE WITH GRANT OPTION')
   AND NOT pg_catalog.has_function_privilege($14::pg_catalog.oid,p.oid,'EXECUTE'))
)
SELECT result."factId",result."impactKind",result."amountCents",result."numericProtocolVersion",
 result."subjectKind",result."subjectId" FROM admitted
LEFT JOIN LATERAL public.jg_read_registered_payment_impacts(
 admitted.request_key,admitted.execution_id,admitted.payment_id,admitted.project_id,admitted.fact_id
) result ON true LIMIT 257`;

function rowsForFact(rows,factId) {
 need(Array.isArray(rows)&&!types.isProxy(rows)&&rows.length>=1&&rows.length<=256,txCode);
 const impacts=[];
 for(let i=0;i<rows.length;i++){
  const row=ownData(rows,String(i));
  need(row&&typeof row==="object"&&!Array.isArray(row)&&!types.isProxy(row)&&Reflect.ownKeys(row).length===columns.length,txCode);
  const [id,kind,amount,version,subjectKind,subjectId]=columns.map(key=>ownData(row,key));
  if(rows.length===1&&[id,kind,amount,version,subjectKind,subjectId].every(value=>value===null))return [];
  const subject=value=>value===null||typeof value==="string"&&value.length>0&&value.length<=128;
  need(id===factId&&typeof kind==="string"&&kind.length>0&&kind.length<=128&&
   (amount===null||typeof amount==="bigint")&&(version===1||version===2)&&subject(subjectKind)&&subject(subjectId),txCode);
  impacts.push({factId:id,impactKind:kind,amountCents:amount,numericProtocolVersion:version,subjectKind,subjectId});
 }
 return impacts;
}


/** Runs actual Prisma interactive transactions and fixed SQL. It does not authorize
 * launch or manufacture B7/owner proof; native consumers must separately admit it. */
function createCurrent259ImpactRuntime(session,checkLight){
 need(session&&!types.isProxy(session)&&typeof checkLight==='function',txCode);
 const source=ownData(session,'source'),profile=qualifyCurrent259Source(source),snapshot=JSON.stringify(profile);
 const runtime=ownData(session,'runtime'),owner=ownData(session,'owner'),observer=ownData(session,'observer');
 need(runtime&&owner&&observer&&new Set([runtime,owner,observer]).size===3,txCode);
 const verifyFull=ownData(session,'verifyFull'),verifyInstalled259=ownData(session,'verifyInstalled259');
 need(typeof verifyFull==='function'&&typeof verifyInstalled259==='function',txCode);
 const transaction=runtime.$transaction,identity=ownData(session,'identity'),b7=ownData(session,'b7'),endpoint=ownData(session,'endpoint');
 const privateIPv4=value=>typeof value==='string'&&isIP(value)===4&&(/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(value));
 need(endpoint&&!types.isProxy(endpoint)&&ownData(endpoint,'publishedHost')==='127.0.0.1'
  &&Number.isInteger(ownData(endpoint,'publishedPort'))&&ownData(endpoint,'publishedPort')>1024&&ownData(endpoint,'publishedPort')<=65535
  &&privateIPv4(ownData(endpoint,'clientAddress'))&&privateIPv4(ownData(endpoint,'serverAddress'))
  &&Number.isInteger(ownData(endpoint,'clientPort'))&&ownData(endpoint,'clientPort')>0&&ownData(endpoint,'clientPort')<=65535
  &&ownData(endpoint,'serverPort')===5432,txCode);
 const endpointValues=Object.fromEntries(['publishedHost','publishedPort','clientAddress','clientPort','serverAddress','serverPort'].map(k=>[k,ownData(endpoint,k)]));
 const endpointArgs=['clientAddress','clientPort','serverAddress','serverPort'].map(k=>endpointValues[k]);
 need(typeof transaction==='function'&&Array.isArray(identity)&&!types.isProxy(identity)&&identity.length===3&&b7&&!types.isProxy(b7),txCode);
 const identities=Array.from({length:3},(_,i)=>ownData(identity,String(i)));
 const normalized=identities.map((row,i)=>{
  const role='jg_task01_'+['owner','runtime','observer'][i];
  need(row&&!types.isProxy(row)&&ownData(row,'effectiveRole')===role&&ownData(row,'loginRole')===role
   &&isOid(ownData(row,'effectiveOid'))&&ownData(row,'loginOid')===ownData(row,'effectiveOid')
   &&isOid(ownData(row,'databaseOid'))&&isWide(ownData(row,'systemIdentifier'))&&isTimestamp(ownData(row,'start'))
   &&Number.isInteger(ownData(row,'pid'))&&ownData(row,'pid')>0&&ownData(row,'pid')<=0x7fffffff&&ownData(row,'tls')===true,txCode);
  return Object.fromEntries(['database','databaseOid','systemIdentifier','effectiveRole','loginRole','effectiveOid','loginOid','pid','start','tls'].map(k=>[k,ownData(row,k)]));
 });
 const ids=normalized[1],ownerOid=normalized[0].effectiveOid,observerOid=normalized[2].effectiveOid;
 need(typeof ids.database==='string'&&/^jg_task01_[a-f0-9]{32}$/u.test(ids.database)
  &&normalized.every(r=>r.database===ids.database&&r.databaseOid===ids.databaseOid&&r.systemIdentifier===ids.systemIdentifier)
  &&['effectiveOid','pid','start'].every(k=>new Set(normalized.map(r=>r[k])).size===3)
  &&ownData(b7,'profile')==='B7_ORIGINAL'&&isWide(ownData(b7,'xid'))&&isOid(ownData(b7,'routineOid'))&&ownData(b7,'bodySha256')===readerBodySha256,txCode);
 const b7Snapshot=JSON.stringify(Object.fromEntries(['profile','xid','routineOid','bodySha256'].map(k=>[k,ownData(b7,k)])));
 const routineOid=ownData(b7,'routineOid'),coordinates=[ids.databaseOid,ids.systemIdentifier,ids.pid,ids.effectiveOid,ids.start];
 let busy=false,broken=false;
 function check(){
  need(!broken,txCode);
  try{
   checkLight();need(ownData(session,'source')===source&&JSON.stringify(qualifyCurrent259Source(source))===snapshot
    &&ownData(session,'runtime')===runtime&&ownData(session,'owner')===owner&&ownData(session,'observer')===observer&&runtime.$transaction===transaction
    &&ownData(session,'verifyFull')===verifyFull&&ownData(session,'verifyInstalled259')===verifyInstalled259&&ownData(session,'identity')===identity&&ownData(session,'b7')===b7&&ownData(session,'endpoint')===endpoint
    &&Object.entries(endpointValues).every(([k,v])=>ownData(endpoint,k)===v),txCode);
   need(normalized.every((row,i)=>ownData(identity,String(i))===identities[i]&&Object.entries(row).every(([k,v])=>ownData(identities[i],k)===v))
    &&JSON.stringify(Object.fromEntries(['profile','xid','routineOid','bodySha256'].map(k=>[k,ownData(b7,k)])))===b7Snapshot,txCode);
  }catch{broken=true;throw fault(txCode);}
 }
 check();
 async function full(){
  check();try{await verifyFull.call(session);}catch{broken=true;throw fault(txCode);}check();
 }
 return Object.freeze({async withTransaction(operation){
  check();if(busy||typeof operation!=='function'){broken=true;throw fault(txCode);}busy=true;
  let entered=false,returned=false;
  try{
   await full();
   const result=await transaction.call(runtime,async tx=>{
    check();need(!entered&&tx&&typeof tx==='object'&&![runtime,owner,observer].includes(tx),txCode);entered=true;
    const query=tx.$queryRawUnsafe;need(typeof query==='function',txCode);
    let active=true,reading=false,reads=0,failed=false;
    const run=async(sql,args)=>{try{return await query.call(tx,sql,...args);}catch{failed=true;throw fault(txCode);}};
    const verify=async()=>{
     check();const rows=await run(beginSql,[...coordinates,...endpointArgs]);check();
     need(tx.$queryRawUnsafe===query&&Array.isArray(rows)&&!types.isProxy(rows)&&rows.length===1&&isTimestamp(ownData(ownData(rows,'0'),'startedAt')),txCode);
     need(['clientAddress','clientPort','serverAddress','serverPort'].every(k=>ownData(ownData(rows,'0'),k)===endpointValues[k]),txCode);
     return ownData(ownData(rows,'0'),'startedAt');
    };
    try{
     const startedAt=await verify();
     const read=async(current,scope,factIds)=>{
      try{
       check();need(active&&!reading&&current===tx&&tx.$queryRawUnsafe===query&&Array.isArray(factIds)&&!types.isProxy(factIds)&&factIds.length<=256-reads,txCode);reading=true;
       const scopeIds=['requestKey','executionId','paymentId','projectId'].map(k=>ownData(scope,k)),impacts=[];
       for(let i=0;i<factIds.length;i++){
        const args=[...scopeIds,ownData(factIds,String(i))];
        need(active&&++reads<=256&&typeof args[0]==='string'&&uuid4.test(args[0])&&args.slice(1).every(v=>typeof v==='string'&&v.length>0&&v.length<=256&&!v.includes('\0')),txCode);
        const rows=await run(readSql,[...args,...coordinates,startedAt,routineOid,ownerOid,observerOid,...endpointArgs]);check();
        need(active&&tx.$queryRawUnsafe===query,txCode);impacts.push(...rowsForFact(rows,args[4]));
       }
       return impacts;
      }catch{failed=true;throw fault(txCode);}finally{reading=false;}
     };
     const value=await operation(tx,read);check();need(!failed&&!reading,txCode);
     need(await verify()===startedAt,txCode);
     // Owner/observer-only verification: never probe the busy runtime pool here.
     try{await verifyInstalled259.call(session);}catch{failed=true;throw fault(txCode);}
     check();need(!failed,txCode);return value;
    }finally{active=false;}
   },{isolationLevel:'Serializable'});
   returned=true;await full();check();need(entered,txCode);return result;
  }catch(error){
   if(returned)throw Object.assign(fault(txCode),{transactionOutcome:'RETURNED_READBACK_UNCONFIRMED'});
   throw error;
  }finally{busy=false;}
 }});
}
module.exports={createCurrent259ImpactRuntime};
