"use strict";
// Factory lifetime only. No SDK import, environment preparation or native loader
// fallback. The qualified one-shot source/module bridge is a separate missing gate.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {types}=require('node:util');
const REQUEST=Object.freeze([
 ['application','database/task16-registered-application.module.js'],['database','database/prisma.service.js'],
 ['security','api-security.js'],['projection','operating-projection/projection-export-json.js'],
 ['json','api-json-replacer.js'],['validation','validation/api-validation.js'],['listen','api-listen.js']
].map(([name,file])=>Object.freeze({name,path:'services/api/dist/'+file})));
const CODES=new Set(['TASK16_APP_ABORTED','TASK16_APP_ADDRESS','TASK16_APP_BOUNDARY','TASK16_APP_CLOSE_UNKNOWN',
 'TASK16_APP_DATA_DESCRIPTOR','TASK16_APP_ENVIRONMENT_CHANGED','TASK16_APP_ENVIRONMENT_REQUIRED','TASK16_APP_FAILED_CLOSED',
 'TASK16_APP_HANDLE','TASK16_APP_IMPACT_READER_PROOF','TASK16_APP_METHOD_CHANGED','TASK16_APP_METHOD_DESCRIPTOR','TASK16_APP_MODULE_EXPORTS',
 'TASK16_APP_PRIOR_CHANGED','TASK16_APP_PRIOR_CLIENTS','TASK16_APP_RUNTIME_PROVIDER','TASK16_APP_STORAGE_CHANGED','TASK16_APP_STORAGE_REQUIRED']);
const fault=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fault(code);};
function own(object,key){const d=Object.getOwnPropertyDescriptor(object??{},key);need(d&&Object.hasOwn(d,'value'),'TASK16_APP_DATA_DESCRIPTOR');return d.value;}
function method(object,key){let next=object;for(let i=0;next&&i<32;i++,next=Object.getPrototypeOf(next)){const d=Object.getOwnPropertyDescriptor(next,key);if(d){need(Object.hasOwn(d,'value')&&typeof d.value==='function','TASK16_APP_METHOD_DESCRIPTOR');return d.value;}}throw fault('TASK16_APP_METHOD_DESCRIPTOR');}
async function createTask16Application(context,boundary,continuity){
 let moduleHandle,appHandle,moduleMethods,appMethods,attempted=false,closing;
 const registered=[];
 const register=(value,kind)=>{need(value!==null&&(typeof value==='object'||typeof value==='function'),'TASK16_APP_HANDLE');const entry={value,kind,close:undefined};registered.push(entry);entry.close=method(value,'close');return entry;};
 const close=()=>closing??=(async()=>{let unknown=attempted&&registered.length===0;const moduleEntry=registered.find(e=>e.kind==='module'),appEntry=registered.find(e=>e.kind==='app');
  if(appEntry){try{need(typeof appEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await appEntry.close.call(appEntry.value);}catch{unknown=true;if(moduleEntry){try{need(typeof moduleEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await moduleEntry.close.call(moduleEntry.value);}catch{unknown=true;}}}}
  else if(moduleEntry){try{need(typeof moduleEntry.close==='function','TASK16_APP_CLOSE_UNKNOWN');await moduleEntry.close.call(moduleEntry.value);}catch{unknown=true;}}
  if(continuity?.onClose){try{continuity.onClose({returned:!unknown,acquired:registered.length>0});}catch{unknown=true;}}
  if(unknown)throw fault('TASK16_APP_CLOSE_UNKNOWN');
 })();
 try{
  need(boundary&&Reflect.ownKeys(boundary).length===2&&Object.keys(boundary).sort().join(',')==='createTestingModule,loadModules','TASK16_APP_BOUNDARY');const loadModules=own(boundary,'loadModules'),createTestingModule=own(boundary,'createTestingModule');need(typeof loadModules==='function'&&typeof createTestingModule==='function','TASK16_APP_BOUNDARY');
  const clients=context.clients,source=context.source,registeredAccess=context.registeredAccess,runtime=own(clients,'runtime'),binding=own(clients,'sourceBinding');
  const sourceSha=own(source,'candidateSha'),seal=own(source,'sealSha256'),manifest=own(registeredAccess,'manifestSha256');
  need(own(clients,'status')==='CLIENTS_CONNECTED_AND_IDENTITY_MATCHED'&&runtime!==null&&typeof runtime==='object'&&/^[a-f0-9]{40}$/u.test(sourceSha)&&/^[a-f0-9]{64}$/u.test(seal)&&/^[a-f0-9]{64}$/u.test(manifest)&&own(binding,'sourceSha')===sourceSha&&own(binding,'sourceSealSha256')===seal&&own(binding,'registeredManifestSha256')===manifest,'TASK16_APP_PRIOR_CLIENTS');
  const migrations=Object.getOwnPropertyDescriptor(source,'migrations')?.value;
  const readerRequired=context.simulation!==true||Array.isArray(migrations)&&migrations.length!==205;
  const readerAdmission=readerRequired?getTask16ImpactReaderRuntime(context):undefined;
  need(!readerRequired||readerAdmission,'TASK16_APP_IMPACT_READER_PROOF');
  let impactReader,impactToken,impactExports;
  const required={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local'};
  for(const[key,value]of Object.entries(required))need(process.env[key]===value,'TASK16_APP_ENVIRONMENT_REQUIRED');
  for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'])need(typeof process.env[key]==='string'&&/^[a-f0-9]{64,192}$/u.test(process.env[key]),'TASK16_APP_ENVIRONMENT_REQUIRED');
  need(new Set(['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'].map(k=>process.env[k])).size===3,'TASK16_APP_ENVIRONMENT_REQUIRED');
  const storage=process.env.FILE_STORAGE_ROOT,parent=context.options.artifactsDir;
  need(typeof storage==='string'&&storage.startsWith(parent+path.sep)&&fs.realpathSync(storage)===storage&&fs.realpathSync(parent)===parent,'TASK16_APP_STORAGE_REQUIRED');
  for(const dir of [parent,storage]){const stat=fs.lstatSync(dir);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'TASK16_APP_STORAGE_REQUIRED');}
  const directories=[parent,storage].map(dir=>{const stat=fs.lstatSync(dir);return{dir,dev:stat.dev,ino:stat.ino,mode:stat.mode,uid:stat.uid};});
  const environment=Object.fromEntries([...Object.keys(required),'FILE_STORAGE_ROOT','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','FILE_DOWNLOAD_SECRET'].map(key=>[key,process.env[key]]));
  const check=()=>{
   for(const row of directories){const stat=fs.lstatSync(row.dir);need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(row.dir)===row.dir&&['dev','ino','mode','uid'].every(key=>stat[key]===row[key]),'TASK16_APP_STORAGE_CHANGED');}
   need(!context.signal.aborted,'TASK16_APP_ABORTED');need(context.clients===clients&&context.source===source&&context.registeredAccess===registeredAccess&&own(clients,'runtime')===runtime&&own(clients,'sourceBinding')===binding&&own(source,'candidateSha')===sourceSha&&own(source,'sealSha256')===seal&&own(registeredAccess,'manifestSha256')===manifest&&own(binding,'sourceSha')===sourceSha&&own(binding,'sourceSealSha256')===seal&&own(binding,'registeredManifestSha256')===manifest,'TASK16_APP_PRIOR_CHANGED');
   need(Object.entries(environment).every(([key,value])=>process.env[key]===value)&&!Object.keys(process.env).some(key=>/^(?:SMS_|APPROVAL_SMS_|COS_|TENCENT|WX_|PRISMA_)/u.test(key)&&!['SMS_ENABLED','APPROVAL_SMS_ENABLED','PRISMA_HIDE_UPDATE_MESSAGE'].includes(key))&&!['DATABASE_URL','NODE_OPTIONS','NODE_PATH','PORT','HOST','WEB_ORIGIN','SKIP_DATABASE_CONNECT'].some(key=>Boolean(process.env[key])),'TASK16_APP_ENVIRONMENT_CHANGED');
   for(const [handle,methods]of [[moduleHandle,moduleMethods],[appHandle,appMethods]])if(handle&&methods)for(const[key,value]of Object.entries(methods))need(method(handle,key)===value,'TASK16_APP_METHOD_CHANGED');
   if(readerAdmission)need(!closing&&getTask16ImpactReaderRuntime(context)===readerAdmission&&
    (!impactExports||own(impactExports,'Task16ImpactReaderToken')===impactToken),'TASK16_APP_IMPACT_READER_PROOF');
   if(continuity)continuity.checkLight();
  };
  check();const exports=await loadModules(REQUEST);check();const names=['Task16RegisteredApplicationModule','PrismaService','configureApiSecurity','configureProjectionExportJson','apiJsonReplacer','createApiValidationPipe','listenApi'],loaded=Object.fromEntries(names.map(name=>[name,own(exports,name)]));need(Object.values(loaded).every(value=>typeof value==='function'),'TASK16_APP_MODULE_EXPORTS');
  const builder=createTestingModule({imports:[loaded.Task16RegisteredApplicationModule]});
  const overrideProvider=method(builder,'overrideProvider');
  const override=overrideProvider.call(builder,loaded.PrismaService);method(override,'useValue').call(override,runtime);
  if(readerAdmission){
   impactToken=own(exports,'Task16ImpactReaderToken');
   need(typeof impactToken==='symbol','TASK16_APP_IMPACT_READER_PROOF');
   impactExports=exports;
   impactReader=readerAdmission.open(check);
   const readerOverride=overrideProvider.call(builder,impactToken);method(readerOverride,'useValue').call(readerOverride,impactReader);
  }
  const verifyProviders=(handle,methods)=>{
   need(methods.get.call(handle,loaded.PrismaService)===runtime,'TASK16_APP_RUNTIME_PROVIDER');
   if(impactReader)need(methods.get.call(handle,impactToken)===impactReader,'TASK16_APP_IMPACT_READER_PROOF');
  };
  check();const compile=method(builder,'compile');attempted=true;moduleHandle=await compile.call(builder);const moduleEntry=register(moduleHandle,'module');moduleMethods={close:moduleEntry.close,get:method(moduleHandle,'get'),createNestApplication:method(moduleHandle,'createNestApplication')};check();verifyProviders(moduleHandle,moduleMethods);
  appHandle=moduleMethods.createNestApplication.call(moduleHandle);const appEntry=register(appHandle,'app');appMethods={close:appEntry.close,...Object.fromEntries(['get','getHttpAdapter','enableCors','useGlobalPipes','init','getHttpServer'].map(key=>[key,method(appHandle,key)]))};check();verifyProviders(appHandle,appMethods);
  loaded.configureApiSecurity(appHandle);check();loaded.configureProjectionExportJson(appHandle);check();const adapter=appMethods.getHttpAdapter.call(appHandle),express=method(adapter,'getInstance').call(adapter);method(express,'set').call(express,'json replacer',loaded.apiJsonReplacer);appMethods.enableCors.call(appHandle,{origin:[],credentials:false});appMethods.useGlobalPipes.call(appHandle,loaded.createApiValidationPipe());check();await appMethods.init.call(appHandle);check();verifyProviders(moduleHandle,moduleMethods);verifyProviders(appHandle,appMethods);
  await loaded.listenApi(appHandle,0,'127.0.0.1');check();const server=appMethods.getHttpServer.call(appHandle),address=method(server,'address').call(server);need(address,'TASK16_APP_ADDRESS');const host=own(address,'address'),family=own(address,'family'),port=own(address,'port'),listening=server.listening;need(listening===true&&host==='127.0.0.1'&&family==='IPv4'&&Number.isInteger(port)&&port>1024&&port<=65535,'TASK16_APP_ADDRESS');
  verifyProviders(moduleHandle,moduleMethods);verifyProviders(appHandle,appMethods);check();
  const addressMethod=method(server,'address');
  const inspect=()=>{check();need(appMethods.getHttpServer.call(appHandle)===server&&method(server,'address')===addressMethod,'TASK16_APP_ADDRESS');const current=addressMethod.call(server),live=server.listening;need(live===true&&own(current,'address')===host&&own(current,'family')===family&&own(current,'port')===port,'TASK16_APP_RUNTIME_PROVIDER');verifyProviders(appHandle,appMethods);verifyProviders(moduleHandle,moduleMethods);return Object.freeze({origin:`http://127.0.0.1:${port}/`,runtime});};
  return{inspect,status:'APPLICATION_FACTORY_PROTOCOL_RETURNED_NOT_NATIVE_PROOF',origin:`http://127.0.0.1:${port}/`,runtime,close,sourceBinding:{sourceSha,sourceSealSha256:seal,registeredManifestSha256:manifest},nativeProof:false,environmentPreparationImplemented:false,financialAcceptance:false};
 }catch(error){let unknown=false;try{await close();}catch{unknown=true;}let code='TASK16_APP_FAILED_CLOSED';try{const descriptor=error&&Object.getOwnPropertyDescriptor(error,'code');if(descriptor&&Object.hasOwn(descriptor,'value')&&CODES.has(descriptor.value))code=descriptor.value;}catch{/* Untrusted exception descriptors are never projected. */}throw Object.assign(new Error(code),{code,appStartupOutcome:attempted?'UNKNOWN_DO_NOT_RETRY':'NOT_ATTEMPTED',appCleanupOutcome:unknown?'UNKNOWN_DO_NOT_CONTINUE':registered.length?'APP_HANDLE_CLOSE_RETURNED_NOT_FULL_PROOF':'NOT_NEEDED'});}
}
const admissions=new WeakMap();
const ledgerSha256="737652cf3b2919c01411f0f8a32e333ce5210e62caf22c1d44926f8aab10c590";
const readerBodySha256="f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20";
const uuid4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const columns=["factId","impactKind","amountCents","numericProtocolVersion","subjectKind","subjectId"];
const isOid=value=>typeof value==="string"&&/^[1-9][0-9]{0,9}$/u.test(value)&&Number(value)<=0xffffffff;
const isWide=value=>typeof value==="string"&&/^[1-9][0-9]{0,19}$/u.test(value)&&BigInt(value)<=0xffffffffffffffffn;
const isTimestamp=value=>typeof value==="string"&&iso.test(value)&&Number.isFinite(Date.parse(value));
const ownData=(object,key)=>Object.getOwnPropertyDescriptor(object??{},key)?.value;
const proofCode="TASK16_APP_IMPACT_READER_PROOF";
const txCode="TASK16_CLIENT_IMPACT_READER_TRANSACTION";

function exactLedger(source) {
 const migrations=ownData(source,"migrations");
 if(!Array.isArray(migrations)||migrations.length!==256)return false;
 const rows=migrations.map(row=>{
  const found=/^services\/api\/prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql$/u.exec(ownData(row,"path"));
  return {name:found?.[1],sha256:ownData(row,"sha256"),finished:true,rolledBack:false};
 });
 return createHash("sha256").update(JSON.stringify(rows)).digest("hex")===ledgerSha256;
}

const timestamp=expression=>`pg_catalog.to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function runtimeScope(database,cluster,pid,roleOid,start) {
 return `FROM public.jg_task01_connection_identity() i
 WHERE current_user='jg_task01_runtime' AND session_user=current_user AND i."loginRole"=session_user
 AND i."databaseOid"=${database}::pg_catalog.text AND i."systemIdentifier"=${cluster}::pg_catalog.text
 AND i."backendPid"=pg_catalog.pg_backend_pid() AND i."backendPid"=${pid}::pg_catalog.int4 AND i.tls
 AND current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text=${roleOid}::pg_catalog.text
 AND pg_catalog.current_setting('transaction_isolation')='serializable'
 AND pg_catalog.current_setting('session_replication_role')='origin'
 AND pg_catalog.inet_client_addr()='127.0.0.1'::pg_catalog.inet
 AND pg_catalog.inet_server_addr()='127.0.0.1'::pg_catalog.inet
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a
    WHERE a.pid=pg_catalog.pg_backend_pid() AND ${timestamp("a.backend_start")}=${start}::pg_catalog.text)`;
}
const beginSql=`SELECT ${timestamp("pg_catalog.transaction_timestamp()")} AS "startedAt"
 ${runtimeScope("$1","$2","$3","$4","$5")}`;
const readSql=`WITH admitted AS MATERIALIZED (
 SELECT $1::pg_catalog.text AS request_key,$2::pg_catalog.text AS execution_id,$3::pg_catalog.text AS payment_id,
  $4::pg_catalog.text AS project_id,$5::pg_catalog.text AS fact_id
 ${runtimeScope("$6","$7","$8","$9","$10")}
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

// Explicit fixture issuer. The existing 205 connector cannot issue a 256 admission.
// A native issuer must come from the trusted same-boot 256 B7/client lifecycle.
function bindSimulatedTask16ImpactReader(context,clients,proof) {
 const {ownsActiveTask16SimulationContext}=require("./run-task16-registered-pg-local.cjs");
 need(ownsActiveTask16SimulationContext(context),proofCode);
 const {source,registeredAccess,resourceWitness,signal}=context;
 const runtime=ownData(clients,"runtime"),checkLight=ownData(clients,"checkLight");
 const runtimeTransaction=runtime?.$transaction;
 const session=ownData(clients,"identity")?.[1];
 const {profile,b7Xid,routineOid,bodySha256,backendStart}=proof??{};
 const {databaseOid,systemIdentifier,runtimeOid,ownerOid,observerOid}=registeredAccess??{};
 need(context.simulation===true&&exactLedger(source)&&!admissions.has(clients)&&resourceWitness&&
  ownData(clients,"status")==="CLIENTS_CONNECTED_AND_IDENTITY_MATCHED"&&typeof checkLight==="function"&&
  typeof runtimeTransaction==="function"&&signal instanceof AbortSignal&&!signal.aborted&&
  profile==="B7_ORIGINAL"&&isWide(b7Xid)&&bodySha256===readerBodySha256&&
  [databaseOid,routineOid,runtimeOid,ownerOid,observerOid].every(isOid)&&new Set([runtimeOid,ownerOid,observerOid]).size===3&&
  isWide(systemIdentifier)&&isTimestamp(backendStart)&&session?.start===backendStart&&
  Number.isInteger(session.pid)&&session.pid>0&&session.pid<=0x7fffffff&&session.database===resourceWitness.databaseName&&
  session.databaseOid===databaseOid&&session.systemIdentifier===systemIdentifier&&session.effectiveRole==="jg_task01_runtime"&&
  session.loginRole===session.effectiveRole&&session.effectiveOid===runtimeOid&&session.loginOid===runtimeOid&&session.tls===true,
 proofCode);
 const pid=session.pid;
 const coordinates=[databaseOid,systemIdentifier,pid,runtimeOid,backendStart];
 const assertLive=()=>{
  need(ownsActiveTask16SimulationContext(context)&&context.simulation===true&&!signal.aborted&&context.source===source&&context.registeredAccess===registeredAccess&&
   context.resourceWitness===resourceWitness&&ownData(clients,"runtime")===runtime&&ownData(clients,"checkLight")===checkLight&&
   runtime.$transaction===runtimeTransaction&&exactLedger(source)&&
   [databaseOid,systemIdentifier,runtimeOid,ownerOid,observerOid].every((value,i)=>value===
    ownData(registeredAccess,["databaseOid","systemIdentifier","runtimeOid","ownerOid","observerOid"][i]))&&
   ownData(clients,"identity")?.[1]===session&&session.pid===pid&&session.start===backendStart,proofCode);
  checkLight.call(clients);
 };
 assertLive();
 admissions.set(clients,Object.freeze({context,assertLive,open(check){
  const live=()=>{assertLive();check();};
  return Object.freeze({async withTransaction(operation){
   live();
   need(typeof operation==="function",txCode);
   let entered=false;
   const result=await runtimeTransaction.call(runtime,async tx=>{
    live();
    // Prisma's admitted interactive transaction client is itself a composite Proxy.
    need(!entered&&tx&&typeof tx==="object"&&
     ![runtime,ownData(clients,"owner"),ownData(clients,"observer")].includes(tx),txCode);
    entered=true;
    const query=tx.$queryRawUnsafe;
    need(typeof query==="function",txCode);
    const runQuery=async (sql,...args)=>{
     try {return await query.call(tx,sql,...args);}
     catch {throw fault(txCode);}
    };
    const start=await runQuery(beginSql,...coordinates);
    live();
    need(tx.$queryRawUnsafe===query&&Array.isArray(start)&&!types.isProxy(start)&&start.length===1&&
     isTimestamp(ownData(ownData(start,"0"),"startedAt")),txCode);
    const startedAt=ownData(ownData(start,"0"),"startedAt");
    let active=true,reads=0;
    const read=async (current,scope,factIds)=>{
     live();
     need(active&&current===tx&&tx.$queryRawUnsafe===query&&Array.isArray(factIds)&&
      !types.isProxy(factIds)&&factIds.length<=256-reads,txCode);
     const scopeIds=["requestKey","executionId","paymentId","projectId"].map(key=>ownData(scope,key));
     const impacts=[];
     for(let i=0;i<factIds.length;i++){
      live();
      const ids=[...scopeIds,ownData(factIds,String(i))];
      need(active&&tx.$queryRawUnsafe===query&&++reads<=256&&typeof ids[0]==="string"&&uuid4.test(ids[0])&&
       ids.slice(1).every(id=>typeof id==="string"&&id.length>0&&!id.includes("\0")),txCode);
      const rows=await runQuery(readSql,...ids,...coordinates,startedAt,routineOid,ownerOid,observerOid);
      live();
      need(active&&tx.$queryRawUnsafe===query,txCode);
      impacts.push(...rowsForFact(rows,ids[4]));
     }
     return impacts;
    };
    try {return await operation(tx,read);}
    finally {active=false;}
   },{isolationLevel:"Serializable"});
   live();
   need(entered,txCode);
   return result;
  }});
 }}));
}

function getTask16ImpactReaderRuntime(context) {
 const admission=admissions.get(context.clients);
 if(!admission||admission.context!==context||context.simulation!==true)return undefined;
 admission.assertLive();
 return admission;
}

module.exports={createTask16Application,bindSimulatedTask16ImpactReader};
