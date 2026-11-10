"use strict";
// Fixed source/SQL/readback tools only. No executor, resource or session authority.
const path=require('node:path'),{createHash}=require('node:crypto');
const {types,isDeepStrictEqual:equal}=require('node:util');
const {baselineGuardsSql,referenceGuardSql}=require('./task16-registered-access-check.cjs');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const {readQualifiedTask16File:read}=require('./task16-runtime-inputs.cjs');
const ROOT=path.resolve(__dirname,'../../..'),MANIFEST='services/api/prisma/task16-current259-access.json';
const MANIFEST_SHA='fa28e78f0330024da5297dc4090cfd28364625600df06cf0aab2658d2a37035d';
const BODY='f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20';
const SIGNATURE='public.jg_read_registered_payment_impacts(text,text,text,text,text)';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=()=>{throw Object.assign(new Error('TASK16_CURRENT259_CATALOG'),{code:'TASK16_CURRENT259_CATALOG'});};
const need=x=>{if(!x)fail();};
function snapshot(value){
 if(value===null||['string','boolean','number'].includes(typeof value))return value;
 need(value&&typeof value==='object'&&!types.isProxy(value));
 const ds=Object.getOwnPropertyDescriptors(value);need(Reflect.ownKeys(ds).every(k=>typeof k==='string'&&Object.hasOwn(ds[k],'value')));
 if(Array.isArray(value)){need(Object.keys(ds).every(k=>k==='length'||/^(0|[1-9][0-9]*)$/u.test(k)));return Object.freeze(Array.from({length:value.length},(_,i)=>{need(ds[i]);return snapshot(ds[i].value);}));}
 need(Object.getPrototypeOf(value)===Object.prototype);return Object.freeze(Object.fromEntries(Object.keys(ds).map(k=>[k,snapshot(ds[k].value)])));
}
const quote=x=>"'"+x.replaceAll("'","''")+"'";
const oid=x=>typeof x==='string'&&/^[1-9][0-9]{0,9}$/u.test(x)&&BigInt(x)<=0xffffffffn;
const wide=x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/u.test(x)&&BigInt(x)<=0xffffffffffffffffn;
function material(source){
 const p=qualifyCurrent259Source(source),capture=relative=>read(path.join(ROOT,relative),{maxBytes:2*1024*1024,collect:true,code:'TASK16_CURRENT259_CATALOG'});
 const m=capture(MANIFEST);need(m.sha256===MANIFEST_SHA);const manifest=JSON.parse(m.bytes.toString('utf8'));
 for(let i=0;i<p.ledger.length;i++){const r=p.ledger[i];need(capture(source.migrations[i].path).sha256===r.sha256);}
 need(capture('services/api/prisma/schema.prisma').sha256===p.schemaSha256);
 const files=manifest.files.map(r=>{const c=capture(r.path);need(c.sha256===r.sha256);return{...r,bytes:c.bytes};});
 const sql=files.find(f=>f.path==='services/api/prisma/prepared/task16-current259/registered-impact-reader.sql').bytes.toString('utf8'),parts=sql.split('$reader$');need(parts.length===3&&hash(parts[1])===BODY);
 const plan=JSON.parse(files[1].bytes.toString('utf8'));
 // The current generated SDK also selects the signed-original number in the
 // unprojected contract read. Keep the historical access materials intact.
 need(equal(manifest.runtimeSelectAdditions,[{table:'ContractVersion',select:['originalSignedNumber']}]));
 const version=plan.runtime.tables.find(table=>table.table==='ContractVersion');
 need(version&&!version.select.includes('originalSignedNumber'));
 version.select=[...version.select,'originalSignedNumber'].sort();
 return{p,manifest,files,sql,plan};
}
function loadCurrent259CatalogMaterial(source){
 source=snapshot(source);const m=material(source);
 return snapshot({profile:m.manifest.profile,sourceSha:m.p.candidateSha,sealSha256:m.p.sealSha256,
  ledger:m.p.ledger,ledgerSha256:m.p.ledgerSha256,prefix256Sha256:m.p.prefix256Sha256,
  readerBodySha256:BODY,readerSqlSha256:hash(m.sql),sevenFragments:m.manifest.files.slice(2,9),
  accessPlan:{runtime:m.plan.runtime,observer:m.plan.observer},
  executionAllowed:false,nativeAdmission:false});
}
function request(input){
 const r=snapshot(input);need(equal(Object.keys(r).sort(),['identity','nonce','phase','source',...(Object.hasOwn(r,'installXid')?['installXid']:[])].sort()));
 const id=r.identity;need(equal(Object.keys(id).sort(),['runId','database','databaseOid','namespaceOid','ownerOid','runtimeOid','observerOid','systemIdentifier'].sort()));
 need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id.runId)&&id.database==='jg_task01_'+id.runId.replaceAll('-','')&&
  ['databaseOid','namespaceOid','ownerOid','runtimeOid','observerOid'].every(k=>oid(id[k]))&&
  new Set([id.ownerOid,id.runtimeOid,id.observerOid]).size===3&&wide(id.systemIdentifier)&&
  /^[a-f0-9]{64}$/u.test(r.nonce)&&['before','staged','committed'].includes(r.phase)&&
  (r.phase==='committed'?wide(r.installXid):!Object.hasOwn(r,'installXid')));
 return r;
}
function config(r,m){
 const runtime=JSON.parse(JSON.stringify(m.plan.runtime)),observer=m.plan.observer;
 if(r.phase!=='before')runtime.functions.push(SIGNATURE);
 return{phase:r.phase,nonce:r.nonce,sourceSha:m.p.candidateSha,sealSha256:m.p.sealSha256,
  schemaSha256:m.p.schemaSha256,identity:r.identity,ledger:m.p.ledger,
  runtime,observer,readerColumns:m.manifest.readerColumns,relations:[...new Set([...runtime.tables,...observer.tables].map(x=>x.table).concat(['PaymentExecution','PaymentRequest','Contract','ContractVersion','OperatingFact','OperatingImpactEntry','RegisteredPaymentFunding','PaymentExecutionWagePayableBinding','HistoricalWageSummaryPaymentExecutionLink']))].sort().map(table=>({table,owner:m.plan.legacyRelationOwners[table]??'jg_task01_owner'})),readerSignature:SIGNATURE,installXid:r.installXid??null};
}
function query(r,m){
 const template=m.files.find(f=>f.path==='services/api/prisma/task16-current259-catalog.sql').bytes.toString('utf8');
 need(template.split('__CONFIG__').length===2&&template.includes('__GUARDS__'));
 return template.replace('__CONFIG__',quote(JSON.stringify(config(r,m)))).replace('__GUARDS__','('+baselineGuardsSql()+') AND ('+referenceGuardSql(m.plan)+')');
}
function renderCurrent259CatalogRead(input){
 const r=request(input);need(r.phase!=='staged');const m=material(r.source);
 return 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;\n'+query(r,m)+'\nROLLBACK;\n';
}


const lexical=(a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0;
function capabilities(plan){
 const rows=[];
 for(const role of [plan.runtime,plan.observer]){
  for(const table of role.tables)for(const op of ['select','insert','update','references'])
   for(const col of table[op]??[])rows.push([role.role,'column',table.table,col,op.toUpperCase(),false]);
  if(role.technicalAuthRateLimitDelete)rows.push([role.role,'table','AuthRateLimit','','DELETE',false]);
 }
 return rows.sort(lexical);
}
const names=['p_request_key','p_execution_id','p_payment_id','p_project_id','p_fact_id',
 'factId','impactKind','amountCents','numericProtocolVersion','subjectKind','subjectId'];
const keys=(value,expected)=>need(equal(Object.keys(value).sort(),expected.sort()));
function validate(row,r,m,prior,checkLink=true){
 keys(row,['phase','nonce','sourceSha','sealSha256','schemaSha256','identity','ledger','roles','relations',
  'capabilities','functions','extraFunctions','otherAclSha256','writeXid','commitStatus','reader','guardsVerified','readerColumns','publicAclViolations']);
 need(row.phase===r.phase&&row.nonce===r.nonce&&row.sourceSha===m.p.candidateSha&&row.sealSha256===m.p.sealSha256&&
  row.schemaSha256===m.p.schemaSha256&&equal(row.ledger,m.p.ledger)&&row.guardsVerified===true&&
  equal(row.readerColumns,m.manifest.readerColumns)&&equal(row.publicAclViolations,[]));
 const id=row.identity;
 keys(id,['database','databaseOid','namespaceOid','ownerOid','systemIdentifier','currentRole','sessionRole',
  'backendPid','backendStart','tls','version','replication','readOnly']);
 for(const key of ['database','databaseOid','namespaceOid','ownerOid','systemIdentifier'])need(id[key]===r.identity[key]);
 need(id.currentRole==='jg_task01_owner'&&id.sessionRole===id.currentRole&&id.tls===true&&id.replication==='origin'&&
  id.readOnly===(r.phase!=='staged')&&Number.isInteger(id.version)&&id.version>=160000&&id.version<170000&&
  Number.isInteger(id.backendPid)&&id.backendPid>0&&id.backendPid<=2147483647&&
  typeof id.backendStart==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(id.backendStart)&&
  Number.isFinite(Date.parse(id.backendStart))&&new Date(Date.parse(id.backendStart)).toISOString().slice(0,19)===id.backendStart.slice(0,19));
 need(Array.isArray(row.roles)&&row.roles.length===3);
 const roleNames=['jg_task01_observer','jg_task01_owner','jg_task01_runtime'];
 row.roles.forEach((role,index)=>{
  const key=index===0?'observer':index===1?'owner':'runtime',owner=key==='owner';
  keys(role,['oid','name','superuser','inherit','canLogin','createRole','createDb','replication','bypassRls',
   'connectionLimit','memberships','createSchema','usageSchema','connectDatabase','createDatabaseSchema',
   'temporary','otherDatabases','readOnlyDefault']);
  need(role.name===roleNames[index]&&role.oid===r.identity[key+'Oid']&&role.canLogin===true&&
   role.usageSchema===true&&role.connectDatabase===true&&role.connectionLimit===(owner?-1:1)&&role.memberships===0&&
   ['superuser','inherit','createRole','createDb','replication','bypassRls','createSchema','createDatabaseSchema','temporary']
    .every(k=>role[k]===owner)&&role.readOnlyDefault===(key==='observer')&&Array.isArray(role.otherDatabases)&&
    (owner||role.otherDatabases.length===0));
  const seen=new Set();for(const entry of role.otherDatabases){
   need(Array.isArray(entry)&&entry.length===2&&oid(entry[0])&&entry[0]!==r.identity.databaseOid&&
    ['CONNECT','CREATE','TEMP'].includes(entry[1]));
   const key=entry.join(':');need(!seen.has(key));seen.add(key);
  }
 });
 const cfg=config(r,m);
 need(Array.isArray(row.relations)&&row.relations.length===cfg.relations.length);
 row.relations.forEach((rel,index)=>{
  keys(rel,['table','oid','owner','kind','rls','forceRls']);const expected=cfg.relations[index];
  need(rel.table===expected.table&&oid(rel.oid)&&rel.owner===expected.owner&&rel.kind==='r'&&rel.rls===false&&rel.forceRls===false);
 });
 need(equal(row.capabilities,capabilities(m.plan))&&equal(row.extraFunctions,[]));
 const expectedFunctions=[...cfg.runtime.functions.map(sig=>['jg_task01_runtime',sig]),
  ...cfg.observer.functions.map(sig=>['jg_task01_observer',sig])].sort(lexical);
 need(Array.isArray(row.functions)&&row.functions.length===expectedFunctions.length);
 const routineIds=new Map(),signatures=new Map();
 row.functions.forEach((f,i)=>{
  need(Array.isArray(f)&&f.length===5&&equal(f.slice(0,2),expectedFunctions[i])&&oid(f[2])&&f[3]===true&&f[4]===false);
  need(!routineIds.has(f[1])||routineIds.get(f[1])===f[2]);routineIds.set(f[1],f[2]);
  need(!signatures.has(f[2])||signatures.get(f[2])===f[1]);signatures.set(f[2],f[1]);
 });
 need(typeof row.otherAclSha256==='string'&&/^[a-f0-9]{64}$/u.test(row.otherAclSha256));
 if(r.phase==='before')need(row.reader===null&&row.writeXid===null&&row.commitStatus===null&&prior===undefined);
 else{
  const v=row.reader;need(v&&oid(v.oid));
  const expected={oid:v.oid,ownerOid:r.identity.ownerOid,namespaceOid:r.identity.namespaceOid,
   kind:'f',language:'plpgsql',definer:true,volatility:'s',parallel:'u',leakproof:false,strict:false,
   returnsSet:true,resultType:'record',inputCount:5,defaults:0,variadic:'0',support:'0',names,
   modes:['i','i','i','i','i','t','t','t','t','t','t'],
   types:['text','text','text','text','text','text','text','bigint','integer','text','text'],
   config:['search_path=pg_catalog'],bodySha256:BODY,xmin:v.xmin,
   acl:[[r.identity.ownerOid,r.identity.ownerOid,'EXECUTE',false],[r.identity.ownerOid,r.identity.runtimeOid,'EXECUTE',false]]
    .sort((a,b)=>Number(a[1])-Number(b[1]))};
  need(equal(v,expected)&&routineIds.get(SIGNATURE)===v.oid);
  if(r.phase==='staged')need(wide(row.writeXid)&&row.commitStatus===null&&
    v.xmin===(BigInt(row.writeXid)&0xffffffffn).toString());
  else need(row.writeXid===null&&row.commitStatus==='committed'&&
    v.xmin===(BigInt(r.installXid)&0xffffffffn).toString());
  if(checkLink){
   const before=snapshot(prior),previousRequest={source:r.source,identity:r.identity,nonce:r.nonce,
    phase:r.phase==='staged'?'before':'staged'};
   // Revalidate every prior fact against this exact run, not its self-declared status.
   const checked=validate(before.raw,previousRequest,m,undefined,false);need(equal(before,checked));
   const stableIdentity=x=>Object.fromEntries(Object.entries(x).filter(([k])=>
    !['backendPid','backendStart','readOnly'].includes(k)));
   need(equal(stableIdentity(before.raw.identity),stableIdentity(id))&&
    equal(before.raw.roles,row.roles)&&equal(before.raw.ledger,row.ledger)&&equal(before.raw.relations,row.relations)&&
    equal(before.raw.capabilities,row.capabilities)&&before.raw.otherAclSha256===row.otherAclSha256);
   const oldFunctions=row.functions.filter(f=>f[1]!==SIGNATURE);
   if(r.phase==='staged')need(equal(oldFunctions,before.raw.functions));
   else need(before.raw.writeXid===r.installXid&&equal(row.functions,before.raw.functions)&&
    equal(v,before.raw.reader)&&
    (id.backendPid!==before.raw.identity.backendPid||id.backendStart!==before.raw.identity.backendStart));
  }
 }
 return snapshot({status:'CURRENT259_B7_CATALOG_MATCHED_NOT_ADMISSION',executionAllowed:false,nativeAdmission:false,raw:row});
}
function parseCurrent259CatalogRead(stdout,input,prior){
 try{
  need(typeof stdout==='string'&&Buffer.byteLength(stdout)<=512*1024);
  const r=request(input),m=material(r.source),row=snapshot(JSON.parse(stdout.trim()));
  return validate(row,r,m,prior);
 }catch{fail();}
}


function renderCurrent259B7Install(input){
 try{
  const args=snapshot(input);keys(args,['source','identity','nonce','before']);
  const r=request({source:args.source,identity:args.identity,nonce:args.nonce,phase:'before'}),m=material(r.source);
  keys(args.before,['status','executionAllowed','nativeAdmission','raw']);
  const before=validate(args.before.raw,r,m);
  need(equal(before,args.before));
  const projection=query(r,m).trim().replace(/;$/u,'');
  const stable=value=>({...value,identity:Object.fromEntries(Object.entries(value.identity)
   .filter(([key])=>!['backendPid','backendStart','readOnly'].includes(key)))});
  const expected=stable(before.raw);delete expected.writeXid;
  const staged={...r,phase:'staged'};
  const script=`BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
LOCK TABLE public._prisma_migrations IN SHARE MODE;
DO $current259_before$ DECLARE observed jsonb; BEGIN
 SELECT q.result INTO STRICT observed FROM (${projection}) q;
 observed:=jsonb_set(observed,'{identity}',observed->'identity'-'backendPid'-'backendStart'-'readOnly')-'writeXid';
 IF observed IS DISTINCT FROM ${quote(JSON.stringify(expected))}::jsonb
 THEN RAISE EXCEPTION 'current259 B7 preimage changed'; END IF;
END $current259_before$;
${m.sql}
${query(staged,m)}
COMMIT;
`;
  need(Buffer.byteLength(script)<=2*1024*1024);
  return script;
 }catch{fail();}
}
module.exports={loadCurrent259CatalogMaterial,renderCurrent259CatalogRead,parseCurrent259CatalogRead,renderCurrent259B7Install};
