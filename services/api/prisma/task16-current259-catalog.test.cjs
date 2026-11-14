"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const api=require('./task16-current259-catalog.cjs');
const {PAYMENT261_RUNTIME_PROFILE,PAYMENT261_LEDGER_SHA256}=require('./task16-current259-profile.cjs');
const {PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const root=path.resolve(__dirname,'../../..');
const currentMigrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d{14}_/u.test(n)).sort().map(n=>({path:`services/api/prisma/migrations/${n}/migration.sql`,sha256:hash(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
const migrations=currentMigrations.slice(0,259);
const source={candidateSha:'a'.repeat(40),sealSha256:'b'.repeat(64),schemaSha256:hash(fs.readFileSync(path.join(__dirname,'schema.prisma'))),migrations};
const identity={runId:'01234567-89ab-cdef-0123-456789abcdef',database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'16384',namespaceOid:'2200',ownerOid:'10',runtimeOid:'17000',observerOid:'17001',systemIdentifier:'123456789'};
const request={source,identity,nonce:'c'.repeat(64),phase:'before'};
test('fixed259 material includes exact B7 bytes and no session authority or executable port',()=>{
 const p=api.loadCurrent259CatalogMaterial(source);
 assert.equal(p.readerBodySha256,'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20');
 assert.equal(p.executionAllowed,false);assert.equal(p.nativeAdmission,false);
 assert.equal(p.sevenFragments.length,7);assert.equal(p.ledger.length,259);
 assert.equal(typeof p.execOwnerSql,'undefined');
});
test('current259 supplies the same effective read plan to future role installers',()=>{
 const effective=api.loadCurrent259CatalogMaterial(source).accessPlan;
 assert.ok(effective,'the installer needs the qualified effective plan');
 const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-registered-access.json'),'utf8'));
 const permissions=role=>role.tables.flatMap(table=>['select','insert','update','references'].flatMap(op=>
  (table[op]??[]).map(column=>[table.table,column,op.toUpperCase()])));
 const before=new Set(permissions(historical.runtime).map(row=>JSON.stringify(row)));
 const after=new Set(permissions(effective.runtime).map(row=>JSON.stringify(row)));
 assert.deepEqual([...after].filter(row=>!before.has(row)).map(row=>JSON.parse(row)),[
  ['ContractProxyExecution','id','SELECT'],['ContractVersion','originalSignedNumber','SELECT'],
  ['PaymentExecutionAllocation','id','SELECT'],['ProjectProxyPayment','id','SELECT']
 ]);
 assert.deepEqual([...before].filter(row=>!after.has(row)),[]);
 const beforeObserver=new Set(permissions(historical.observer).map(row=>JSON.stringify(row)));
 const afterObserver=new Set(permissions(effective.observer).map(row=>JSON.stringify(row)));
 assert.deepEqual([...afterObserver].filter(row=>!beforeObserver.has(row)).map(row=>JSON.parse(row)),[['AuditLog','id','SELECT'],['RegisteredFundPaymentAllocation','id','SELECT']]);
 assert.deepEqual([...beforeObserver].filter(row=>!afterObserver.has(row)),[]);
 const expectedObserver=structuredClone(historical.observer);
 expectedObserver.tables.find(table=>table.table==='RegisteredFundPaymentAllocation').select.push('id');
 expectedObserver.tables.find(table=>table.table==='RegisteredFundPaymentAllocation').select.sort();
 expectedObserver.tables.find(table=>table.table==='AuditLog').select.push('id');
 expectedObserver.tables.find(table=>table.table==='AuditLog').select.sort();
 assert.deepEqual(effective.observer,expectedObserver);
 assert.equal(historical.observer.tables.find(table=>table.table==='RegisteredFundPaymentAllocation').select.includes('id'),false);
 assert.deepEqual(effective.runtime.functions,historical.runtime.functions);
 assert.equal(historical.runtime.tables.find(table=>table.table==='ContractVersion').select.includes('originalSignedNumber'),false);
 assert.equal(Object.isFrozen(effective.runtime.tables),true);
});
test('fixed readback SQL and installation material are distinct from execution',()=>{
 const sql=api.renderCurrent259CatalogRead(request);
 assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
 assert.equal(sql.includes('/private/tmp'),false);
 assert.throws(()=>api.renderCurrent259CatalogRead({...request,phase:'arbitrary'}),/TASK16_CURRENT259_CATALOG/u);
});

const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-registered-access.json'),'utf8'));
// Current SDK default scalar reads include the original signed number. This
// observation is independent of the historical permission matrix on disk.
plan.runtime.tables.find(table=>table.table==='ContractVersion').select.push('originalSignedNumber');
for(const table of ['ProjectProxyPayment','ContractProxyExecution','PaymentExecutionAllocation'])plan.runtime.tables.find(row=>row.table===table).select.push('id');
// Mirror only the observed SDK allocation-PK read in this independent catalog protocol fixture.
plan.observer.tables.find(table=>table.table==='RegisteredFundPaymentAllocation').select.push('id');
plan.observer.tables.find(table=>table.table==='AuditLog').select.push('id');
const sort=rows=>rows.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
function observed(phase='before',access=plan){
 const roles=[['owner','jg_task01_owner'],['runtime','jg_task01_runtime'],['observer','jg_task01_observer']].map(([key,name])=>{
  const management=key==='owner';return {oid:identity[key+'Oid'],name,superuser:management,inherit:management,
   canLogin:true,createRole:management,createDb:management,replication:management,bypassRls:management,
   connectionLimit:management?-1:1,memberships:0,createSchema:management,usageSchema:true,
   connectDatabase:true,createDatabaseSchema:management,temporary:management,otherDatabases:management?[["5","CONNECT"]]:[],readOnlyDefault:key==='observer'};
 }).sort((a,b)=>a.name<b.name?-1:1);
 const capabilities=[];for(const role of [access.runtime,access.observer]){
  for(const table of role.tables)for(const privilege of ['select','insert','update','references'])
   for(const col of table[privilege]??[])capabilities.push([role.role,'column',table.table,col,privilege.toUpperCase(),false]);
  if(role.technicalAuthRateLimitDelete)capabilities.push([role.role,'table','AuthRateLimit','','DELETE',false]);
 }
 const functions=[];let i=2000;const ids=new Map();for(const role of [access.runtime,access.observer])for(const sig of [...role.functions].sort())functions.push([role.role,sig,ids.get(sig)??(ids.set(sig,String(i++)),ids.get(sig)),true,false]);
 if(phase!=='before')functions.push(['jg_task01_runtime','public.jg_read_registered_payment_impacts(text,text,text,text,text)','3000',true,false]);
 const tables=[...new Set([...access.runtime.tables,...access.observer.tables].map(x=>x.table).concat(['PaymentExecution','PaymentRequest','Contract','ContractVersion','OperatingFact','OperatingImpactEntry','RegisteredPaymentFunding','PaymentExecutionWagePayableBinding','HistoricalWageSummaryPaymentExecutionLink']))].sort();
 const row={phase,nonce:request.nonce,sourceSha:source.candidateSha,sealSha256:source.sealSha256,schemaSha256:source.schemaSha256,
  identity:{database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,ownerOid:'10',systemIdentifier:identity.systemIdentifier,
   currentRole:'jg_task01_owner',sessionRole:'jg_task01_owner',backendPid:phase==='committed'?401:400,backendStart:phase==='committed'?'2026-11-11T01:00:01.000001Z':'2026-11-11T01:00:00.000001Z',tls:true,version:160015,replication:'origin',readOnly:phase!=='staged'},
  ledger:migrations.map(x=>({name:x.path.split('/').at(-2),sha256:x.sha256,finished:true,rolledBack:false})),roles,
  capabilities:sort(capabilities),functions:sort(functions),relations:tables.map((table,n)=>({table,oid:String(4000+n),owner:access.legacyRelationOwners[table]??'jg_task01_owner',kind:'r',rls:false,forceRls:false})),
  readerColumns:JSON.parse(fs.readFileSync(path.join(__dirname,'task16-current259-access.json'),'utf8')).readerColumns,publicAclViolations:[],
  guardsVerified:true,extraFunctions:[],otherAclSha256:'d'.repeat(64),writeXid:phase==='staged'?'1000':null,commitStatus:phase==='committed'?'committed':null,reader:null};
 if(phase!=='before')row.reader={oid:'3000',ownerOid:'10',namespaceOid:'2200',kind:'f',language:'plpgsql',definer:true,
  volatility:'s',parallel:'u',leakproof:false,strict:false,returnsSet:true,resultType:'record',inputCount:5,defaults:0,variadic:'0',support:'0',
  names:['p_request_key','p_execution_id','p_payment_id','p_project_id','p_fact_id','factId','impactKind','amountCents','numericProtocolVersion','subjectKind','subjectId'],
  modes:['i','i','i','i','i','t','t','t','t','t','t'],types:['text','text','text','text','text','text','text','bigint','integer','text','text'],
  config:['search_path=pg_catalog'],bodySha256:'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20',xmin:'1000',acl:[['10','10','EXECUTE',false],['10','17000','EXECUTE',false]]};
 return row;
}
test('payment261 B7 binds both forward rows, the exact owner routines and the effective normal payment matrix',()=>{
 const source261={...source,migrations:currentMigrations};
 const identity261={...identity,paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 const request261={...request,source:source261,identity:identity261};
 const material=api.loadCurrent259CatalogMaterial(source261);
 assert.equal(material.ledgerSha256,PAYMENT261_LEDGER_SHA256);
 assert.deepEqual(material.accessPlan,api.loadCurrent259CatalogMaterial(source).accessPlan);
 const effective=api.loadCurrent259CatalogMaterial(source261,PAYMENT261_RUNTIME_PROFILE).accessPlan;
 const observe=phase=>observed(phase,{...plan,...effective});
 const parse=(row,r,prior)=>api.parseCurrent259CatalogRead(JSON.stringify({...row,ledger:material.ledger}),r,prior);
 const before=parse(observe(),request261);
 const staged=parse(observe('staged'),{...request261,phase:'staged'},before);
 const committed=parse(observe('committed'),{...request261,phase:'committed',installXid:'1000'},staged);
 assert.deepEqual(committed.raw.reader.acl,[['10','10','EXECUTE',false],['10','17000','EXECUTE',false]]);
 assert.equal(committed.nativeAdmission,false);
 const sql=api.renderCurrent259B7Install({source:source261,identity:identity261,nonce:request.nonce,before});
 for(const marker of [PAYMENT261_RUNTIME_PROFILE,'jg_guard_contract_bank_event_company_transfer()','NOT (f.prosecdef',
  'jg_upward_archive_splice_metadata_v2()','jg_upward_archive_recipe_v2()','jg_require_contract_direct_upward_source_v2()']){
  assert.ok(sql.includes(marker),marker);
  assert.ok(!api.renderCurrent259CatalogRead(request).includes(marker),marker);
 }
 assert.throws(()=>parse({...observe(),guardsVerified:false},request261),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(observed()),request261),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>parse({...observe(),extraFunctions:[['jg_task01_runtime','9999']]},request261),/TASK16_CURRENT259_CATALOG/u);
});
test('payment261 catalog rejects wrong-purpose, partial, drifted and expanded source profiles',()=>{
 const source261={...source,migrations:currentMigrations};
 const identity261={...identity,paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 const reject=(actualSource,actualIdentity,code='TASK16_CURRENT259_CATALOG')=>assert.throws(()=>api.renderCurrent259CatalogRead({
  ...request,source:actualSource,identity:actualIdentity
 }),{code});
 reject(source261,identity);
 reject(source,identity261);
 reject(source261,{...identity261,paymentProfile:'TASK12_ARCHIVE261_SOURCE_V1'});
 reject(source261,{...identity261,runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'});
 reject(source261,{...identity261,voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'});
 reject({...source261,migrations:currentMigrations.slice(0,260)},identity261,'TASK16_CURRENT259_SOURCE');
 reject({...source261,migrations:[...currentMigrations,{path:'services/api/prisma/migrations/20261112100000_future/migration.sql',sha256:'a'.repeat(64)}]},identity261,'TASK16_CURRENT259_SOURCE');
 for(const index of [259,260]){
  const drift=structuredClone(currentMigrations);drift[index].sha256='a'.repeat(64);
  reject({...source261,migrations:drift},identity261,'TASK16_CURRENT259_SOURCE');
 }
});
test('the named competition catalog accepts only the exact runtime connection limit delta',()=>{
 const row=observed(),comp={...request,identity:{...identity,runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES'}};
 const parse=(candidate,r)=>api.parseCurrent259CatalogRead(JSON.stringify(candidate),r);
 assert.throws(()=>parse(row,comp));
 row.roles.find(role=>role.name==='jg_task01_runtime').connectionLimit=2;
 assert.throws(()=>parse(row,request));
 const before=parse(row,comp);
 assert.match(api.renderCurrent259B7Install({source,identity:comp.identity,nonce:comp.nonce,before}),/CURRENT259_TWO_RUNTIME_LANES/u);
 row.roles.find(role=>role.name==='jg_task01_observer').connectionLimit=2;
 assert.throws(()=>parse(row,comp));
 assert.throws(()=>parse(row,{...comp,identity:{...comp.identity,runtimeProfile:'arbitrary'}}));
});
test('current259 accepts the contract scalar read needed by registered execution options',()=>{
 const result=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 assert.equal(result.status,'CURRENT259_B7_CATALOG_MATCHED_NOT_ADMISSION');
});
test('current259 requires the physical type of the added original-number read',()=>{
 const row=observed();
 row.readerColumns=row.readerColumns.filter(column=>!(column[0]==='ContractVersion'&&column[1]==='originalSignedNumber'));
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});
test('actual catalog-shaped259 rows yield material validation, never native session approval',()=>{
 const result=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 assert.equal(result.executionAllowed,false);assert.equal(result.nativeAdmission,false);
 assert.equal(result.status,'CURRENT259_B7_CATALOG_MATCHED_NOT_ADMISSION');
});
for(const [name,change] of [
 ['unfinished259 ledger',r=>{r.ledger[258].finished=false;}],
 ['runtime elevated',r=>{r.roles[2].superuser=true;}],
 ['extra table privilege',r=>{r.capabilities.push(['jg_task01_runtime','table','OperatingFact','','SELECT',false]);}],
 ['missing permitted column',r=>{r.capabilities.pop();}],
 ['missing signed-original scalar read',r=>{r.capabilities=r.capabilities.filter(row=>!(row[2]==='ContractVersion'&&row[3]==='originalSignedNumber'));}],
 ['signed-original write permission',r=>{r.capabilities.push(['jg_task01_runtime','column','ContractVersion','originalSignedNumber','UPDATE',false]);}],
 ['unexpected function execution',r=>{r.extraFunctions.push(['jg_task01_observer','9999']);}],
 ['wrong table owner',r=>{r.relations[0].owner='jg_task01_runtime';}],
 ['forced RLS',r=>{r.relations[0].forceRls=true;}],
 ['no actual TLS',r=>{r.identity.tls=false;}],
 ['different owner',r=>{r.identity.ownerOid='11';}],
 ['invalid backend calendar day',r=>{r.identity.backendStart='2026-02-30T01:00:00.000001Z';}],
 ['raw additional key',r=>{r.secret='not-allowed';}]
])test(`catalog readback rejects ${name}`,()=>{const row=observed();change(row);assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);});

test('fixed B7 installation qualifies one captured staged row before output and commit',()=>{
 const before=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 const script=api.renderCurrent259B7Install({source,identity,nonce:request.nonce,before});
 assert.equal((script.match(/^COMMIT;$/gmu)??[]).length,1);
 assert.match(script,/BEGIN ISOLATION LEVEL SERIALIZABLE/u);
 assert.equal(script.includes('/private/tmp'),false);
 const capture=script.indexOf('CREATE TEMP TABLE pg_temp.jg_current259_b7_staged ON COMMIT DROP AS');
 assert.ok(script.slice(script.indexOf('DO $current259_before$'),capture).includes("jsonb_set(observed,'{identity}',(observed->'identity')-'backendPid'-'backendStart'-'readOnly')-'writeXid'"));
 const guard=script.indexOf('DO $current259_staged$');
 const emit=script.indexOf('SELECT result FROM pg_temp.jg_current259_b7_staged;');
 assert.ok(capture>script.indexOf('$witness$;')&&guard>capture&&emit>guard&&script.indexOf('COMMIT;')>emit);
 const block=script.slice(guard,emit);
 assert.match(block,/SELECT result INTO STRICT observed FROM pg_temp\.jg_current259_b7_staged;/u);
 assert.match(block,/IF observed IS DISTINCT FROM expected\s+THEN RAISE EXCEPTION/u);
 const template=JSON.parse(block.match(/expected jsonb := '((?:[^']|'')+)'::jsonb;/u)[1].replaceAll("''","'"));
 const projected=observed('staged');
 delete projected.identity.backendPid;delete projected.identity.backendStart;
 projected.reader.oid=null;projected.reader.xmin=null;projected.writeXid=null;
 projected.functions.find(row=>row[1]==='public.jg_read_registered_payment_impacts(text,text,text,text,text)')[2]=null;
 assert.deepEqual(template,projected);
 assert.match(block,/pg_catalog\.pg_current_xact_id_if_assigned\(\)/u);
 assert.match(block,/pg_catalog\.to_regprocedure\('public\.jg_read_registered_payment_impacts\(text,text,text,text,text\)'\)/u);
 const staged=api.parseCurrent259CatalogRead(JSON.stringify(observed('staged')),{...request,phase:'staged'},before);
 assert.equal(staged.nativeAdmission,false);
 const committed=api.parseCurrent259CatalogRead(JSON.stringify(observed('committed')),{...request,phase:'committed',installXid:'1000'},staged);
 assert.equal(committed.raw.commitStatus,'committed');assert.equal(committed.executionAllowed,false);
});
for(const [name,mutate] of [
 ['observer B7 execution',r=>{r.reader.acl.push(['10','17001','EXECUTE',false]);}],
 ['PUBLIC B7 execution',r=>{r.reader.acl.unshift(['10','0','EXECUTE',false]);}],
 ['runtime grant option',r=>{r.reader.acl[1][3]=true;}],
 ['different reader source',r=>{r.reader.bodySha256='0'.repeat(64);}],
 ['different security mode',r=>{r.reader.definer=false;}],
 ['function created outside writer transaction',r=>{r.reader.xmin='999';}],
 ['other roles ACL changed',r=>{r.otherAclSha256='e'.repeat(64);}],
 ['new role membership',r=>{r.roles[2].memberships=1;}]
])test(`B7 staged proof rejects ${name}`,()=>{
 const before=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 const row=observed('staged');mutate(row);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),{...request,phase:'staged'},before),/TASK16_CURRENT259_CATALOG/u);
});
for(const [name,mutate] of [
 ['unconfirmed commit',r=>{r.commitStatus='in progress';}],
 ['same writer used for independent read',r=>{r.identity.backendPid=400;r.identity.backendStart='2026-11-11T01:00:00.000001Z';}],
 ['reader OID swap',r=>{r.reader.oid='3001';}]
])test(`postcommit proof rejects ${name}`,()=>{
 const before=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 const staged=api.parseCurrent259CatalogRead(JSON.stringify(observed('staged')),{...request,phase:'staged'},before);
 const row=observed('committed');mutate(row);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),{...request,phase:'committed',installXid:'1000'},staged),/TASK16_CURRENT259_CATALOG/u);
});

test('unowned execution callbacks and accessors cannot enter the fixed SQL renderer',()=>{
 let invoked=0;
 const input={...request};Object.defineProperty(input,'identity',{get(){invoked++;return identity;},enumerable:true});
 assert.throws(()=>api.renderCurrent259CatalogRead(input),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>api.renderCurrent259CatalogRead({...request,execOwnerSql(){invoked++;}}),/TASK16_CURRENT259_CATALOG/u);
 assert.equal(invoked,0);
});
test('source259 cannot borrow a changed prefix or schema',()=>{
 const rows=JSON.parse(JSON.stringify(migrations));rows[255].sha256='0'.repeat(64);
 assert.throws(()=>api.loadCurrent259CatalogMaterial({...source,migrations:rows}),/TASK16_CURRENT259_/u);
 assert.throws(()=>api.loadCurrent259CatalogMaterial({...source,schemaSha256:'0'.repeat(64)}),/TASK16_CURRENT259_/u);
});
test('versioned reader bytes are checked in an independent copied source closure',()=>{
 const os=require('node:os');const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'current259-material-'));
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-current259-access.json'),'utf8'));
  const files=[...manifest.files.map(x=>x.path),'services/api/prisma/task16-current259-catalog.cjs',
   'services/api/prisma/task16-current259-access.json','services/api/prisma/task16-current261-competition-profile.cjs','services/api/prisma/schema.prisma',...migrations.map(x=>x.path)];
  for(const relative of files){const to=path.join(temporary,relative);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,relative),to);}
  const isolated=require(path.join(temporary,'services/api/prisma/task16-current259-catalog.cjs'));
  assert.equal(isolated.loadCurrent259CatalogMaterial(source).nativeAdmission,false);
  fs.appendFileSync(path.join(temporary,'services/api/prisma/prepared/task16-current259/registered-impact-reader.sql'),'\n-- changed material\n');
  assert.throws(()=>isolated.loadCurrent259CatalogMaterial(source),/TASK16_CURRENT259_CATALOG/u);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

for(const [name,mutate] of [
 ['stale nonce',r=>{r.nonce='e'.repeat(64);}],
 ['foreign database',r=>{r.identity.database='foreign_database';}],
 ['foreign cluster',r=>{r.identity.systemIdentifier='999999';}],
 ['wrong schema material',r=>{r.schemaSha256='0'.repeat(64);}],
 ['missing prior TLS',r=>{r.identity.tls=false;}],
 ['malformed prior backend',r=>{r.identity.backendStart='bad';}]
])test(`staged chain rejects ${name} in a copied prior`,()=>{
 const before=JSON.parse(JSON.stringify(api.parseCurrent259CatalogRead(JSON.stringify(observed()),request)));
 mutate(before.raw);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(observed('staged')),{...request,phase:'staged'},before),/TASK16_CURRENT259_CATALOG/u);
});
test('committed chain rejects a stale nonce in its otherwise valid staged proof',()=>{
 const before=api.parseCurrent259CatalogRead(JSON.stringify(observed()),request);
 const staged=JSON.parse(JSON.stringify(api.parseCurrent259CatalogRead(JSON.stringify(observed('staged')),{...request,phase:'staged'},before)));
 staged.raw.nonce='e'.repeat(64);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(observed('committed')),{...request,phase:'committed',installXid:'1000'},staged),/TASK16_CURRENT259_CATALOG/u);
});

test('B7 material rejects a differently typed definer-only amount column',()=>{
 const row=observed();row.readerColumns.find(x=>x[0]==='OperatingImpactEntry'&&x[1]==='amountCents')[3]='text';
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});
test('B7 material rejects a missing definer-only join column',()=>{
 const row=observed();row.readerColumns=row.readerColumns.filter(x=>!(x[0]==='OperatingFact'&&x[1]==='sourceBusinessId'));
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});
for(const [kind,object,privilege]of [['function','5000','EXECUTE'],['relation','5001','SELECT'],['schema','2200','USAGE'],['database','16384','CONNECT'],['type','5002','USAGE']])
 test(`PUBLIC ${kind} grant cannot masquerade as the same legal restricted-role capabilities`,()=>{
  const row=observed();row.publicAclViolations.push([kind,object,'0','10','0',privilege,false]);
  assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
 });

test('fixed owner database capability projection rejects arbitrary payload shapes',()=>{
 const row=observed();row.roles.find(r=>r.name==='jg_task01_owner').otherDatabases=[['5','raw-payload']];
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});

test('application manifest binding is the fixed qualified registered file bytes',()=>{
 const material=api.loadCurrent259CatalogMaterial(source);
 const registered=fs.readFileSync(path.join(__dirname,'task16-registered-access.json'));
 assert.equal(material.registeredManifestSha256,hash(registered));
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-current259-access.json'),'utf8'));
 assert.equal(manifest.files[1].path,'services/api/prisma/task16-registered-access.json');
 assert.equal(material.registeredManifestSha256,manifest.files[1].sha256);
});

for(const payment261 of [false,true])test('voucher catalog keeps the exact C0 binding and guards through B7 staged and independent committed read ('+payment261+')',()=>{
 const manifest=require('./task16-current259-voucher-acl.requirements.json');
 const extra=structuredClone(plan);
 const tables=new Map(extra.runtime.tables.map(row=>[row.table,row]));
 for(const [privilege,delta] of [['select',manifest.readDelta],['insert',manifest.insertDelta],['update',manifest.lockOnlyUpdate]]){
  for(const [table,columns] of Object.entries(delta)){
   if(!tables.has(table))tables.set(table,{table});
   const row=tables.get(table);
   row[privilege]=[...(row[privilege]??[]),...[columns].flat()];
  }
 }
 extra.runtime.tables=[...tables.values()];
 extra.runtime.functions.push(...manifest.routineSources.map(row=>row.signature));
 const id={...identity,runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES',voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1',
  ...(payment261?{paymentProfile:PAYMENT261_VOUCHER_RUNTIME_PROFILE}:{})};
 const voucherSource=payment261?{...source,migrations:currentMigrations}:source;
 const base={...request,source:voucherSource,identity:id};
 function row(phase){
  const r=observed(phase,extra);
  r.ledger=api.loadCurrent259CatalogMaterial(voucherSource).ledger;
  r.roles.find(role=>role.name==='jg_task01_runtime').connectionLimit=2;
  r.voucherBindingSha256='7'.repeat(64);
  return r;
 }
 function parse(observation,phase,prior){
  return api.parseCurrent259CatalogRead(JSON.stringify(observation),
   {...base,phase,...(phase==='committed'?{installXid:'1000'}:{})},prior);
 }
 const before=parse(row('before'),'before');
 const staged=parse(row('staged'),'staged',before);
 assert.equal(parse(row('committed'),'committed',staged).raw.voucherBindingSha256,'7'.repeat(64));
 const installer=api.renderCurrent259B7Install({source:voucherSource,identity:id,nonce:request.nonce,before});
 const ownerRead=api.renderCurrent259CatalogRead({...base,phase:'committed',installXid:'1000'});
 const bindingLock=installer.indexOf('jg_contract_direct_pending_binding_v1 IN SHARE MODE NOWAIT;');
 assert.ok(bindingLock>=0&&bindingLock<installer.indexOf('DO $current259_before$'));
 assert.ok(installer.indexOf('voucherBindingSha256')<installer.indexOf('DO $current259_staged$'));
 assert.match(ownerRead,/p\.proargnames IS NOT DISTINCT FROM/u);
 assert.match(ownerRead,/fileCallerOids/u);
 assert.match(ownerRead,/voucherBindingSha256/u);
 if(payment261){
  assert.match(ownerRead,/jg_guard_contract_bank_event_company_transfer\(\)/u);
  assert.throws(()=>api.renderCurrent259CatalogRead({...base,identity:{...id,paymentProfile:PAYMENT261_COMPETITION_RUNTIME_PROFILE}}));
  assert.throws(()=>api.renderCurrent259CatalogRead({...base,identity:{...id,paymentProfile:PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}}));
  const {voucherProfile,...withoutVoucher}=id;assert.throws(()=>api.renderCurrent259CatalogRead({...base,identity:withoutVoucher}));
 }
 assert.doesNotMatch(ownerRead,/IN SHARE MODE NOWAIT|CREATE TRIGGER/u);
 assert.throws(()=>api.renderCurrent259CatalogRead({...base,identity:{...id,voucherProfile:'arbitrary'}}),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>api.renderCurrent259CatalogRead({...base,identity:{...identity,voucherProfile:id.voucherProfile}}),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>parse({...row('before'),guardsVerified:false},'before'),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>parse({...row('staged'),voucherBindingSha256:'8'.repeat(64)},'staged',before),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>parse({...row('committed'),voucherBindingSha256:'8'.repeat(64)},'committed',staged),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>parse({...row('committed'),capabilities:row('committed').capabilities.slice(1)},'committed',staged),/TASK16_CURRENT259_CATALOG/u);
 const routines=row('committed').functions;
 assert.throws(()=>parse({...row('committed'),functions:routines.slice(1)},'committed',staged),/TASK16_CURRENT259_CATALOG/u);
});

test('261 two-lane catalog binds exact ledger and runtime limit through independent B7 confirmation',()=>{
 const source261={...source,migrations:currentMigrations};
 const identity261={...identity,runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES',paymentProfile:PAYMENT261_COMPETITION_RUNTIME_PROFILE};
 const r={...request,source:source261,identity:identity261};
 const material=api.loadCurrent259CatalogMaterial(source261);
 const parse=(phase,limit,prior)=>{const row=observed(phase);row.roles.find(role=>role.name==='jg_task01_runtime').connectionLimit=limit;
  return api.parseCurrent259CatalogRead(JSON.stringify({...row,ledger:material.ledger}),{...r,phase,...(phase==='committed'?{installXid:'1000'}:{})},prior);};
 assert.throws(()=>parse('before',1),/TASK16_CURRENT259_CATALOG/u);
 const before=parse('before',2);
 const staged=parse('staged',2,before);
 assert.equal(parse('committed',2,staged).nativeAdmission,false);
 const sql=api.renderCurrent259B7Install({source:source261,identity:identity261,nonce:request.nonce,before});
 assert.match(sql,/TASK16_PAYMENT261_COMPETITION_RUNTIME_V1/u);
 assert.match(sql,/jg_guard_contract_bank_event_company_transfer\(\)/u);
 for(const invalid of [{...r,source},{...r,identity:{...identity,paymentProfile:PAYMENT261_COMPETITION_RUNTIME_PROFILE}},
  {...r,identity:{...identity261,paymentProfile:PAYMENT261_RUNTIME_PROFILE}},
  {...r,identity:{...identity261,voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'}}])
  assert.throws(()=>api.renderCurrent259CatalogRead(invalid),/TASK16_CURRENT259_CATALOG/u);
});

const normal261InsertAdditions=[['AuditLog','createdAt'],['RefreshToken','createdAt'],['RegisteredFundAccount','createdAt'],
 ['FundAccountBalanceRegistration','createdAt'],['FundAccountBalanceRegistration','coveredExecutionIds'],
 ['PaymentExecution','createdAt'],['RegisteredPaymentEvent','createdAt'],['RegisteredPaymentEvent','eventType'],['InterEntityRelationshipEntry','createdAt']];
test('normal261 explicit payment mode supplies exactly the nine source-required INSERT columns and a distinct bound plan',()=>{
 const current={...source,migrations:currentMigrations};
 const base=api.loadCurrent259CatalogMaterial(current);
 const payment=api.loadCurrent259CatalogMaterial(current,PAYMENT261_RUNTIME_PROFILE);
 const inserts=plan=>plan.runtime.tables.flatMap(t=>(t.insert??[]).map(c=>[t.table,c]));
 const original=new Set(inserts(base.accessPlan).map(JSON.stringify));
 assert.deepEqual(inserts(payment.accessPlan).filter(row=>!original.has(JSON.stringify(row))).sort(),[...normal261InsertAdditions].sort());
 assert.deepEqual(payment.accessPlan.observer,base.accessPlan.observer);
 assert.equal(payment.registeredManifestSha256,base.registeredManifestSha256);
 assert.deepEqual(payment.effectiveAccessBinding,{paymentProfile:PAYMENT261_RUNTIME_PROFILE,insertAdditionCount:9,
  accessPlanSha256:hash(JSON.stringify(payment.accessPlan))});
 assert.equal(Object.isFrozen(payment.effectiveAccessBinding),true);
 for(const other of [undefined,PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE]){
  const actual=api.loadCurrent259CatalogMaterial(current,other);
  assert.deepEqual(actual.accessPlan,base.accessPlan);assert.equal(actual.effectiveAccessBinding,undefined);
 }
 assert.throws(()=>api.loadCurrent259CatalogMaterial(source,PAYMENT261_RUNTIME_PROFILE));
});
test('normal261 physical readback rejects each missing addition, any expanded authority and a profile swap',()=>{
 const current={...source,migrations:currentMigrations};
 const effective=api.loadCurrent259CatalogMaterial(current,PAYMENT261_RUNTIME_PROFILE).accessPlan;
 const r={...request,source:current,identity:{...identity,paymentProfile:PAYMENT261_RUNTIME_PROFILE}};
 const row=()=>({...observed('before',{...plan,...effective}),ledger:api.loadCurrent259CatalogMaterial(current).ledger});
 const parse=value=>api.parseCurrent259CatalogRead(JSON.stringify(value),r);
 assert.doesNotThrow(()=>parse(row()));
 for(const [table,column]of normal261InsertAdditions){
  const missing=row();missing.capabilities=missing.capabilities.filter(c=>!(c[0]==='jg_task01_runtime'&&c[2]===table&&c[3]===column&&c[4]==='INSERT'));
  assert.throws(()=>parse(missing),/TASK16_CURRENT259_CATALOG/u,table+'.'+column);
 }
 for(const added of [['jg_task01_runtime','column','AuditLog','ipAddress','INSERT',false],
  ['jg_task01_runtime','column','AuditLog','userAgent','INSERT',false],['jg_task01_runtime','column','RefreshToken','revokedAt','INSERT',false],
  ['jg_task01_runtime','column','AuditLog','createdAt','UPDATE',false],['jg_task01_observer','column','AuditLog','createdAt','INSERT',false],
  ['jg_task01_runtime','table','AuditLog','','INSERT',false]]){
  const extra=row();extra.capabilities.push(added);assert.throws(()=>parse(extra),/TASK16_CURRENT259_CATALOG/u);
 }
 const grantable=row();grantable.capabilities.find(c=>c[0]==='jg_task01_runtime'&&c[2]==='AuditLog'&&c[3]==='createdAt'&&c[4]==='INSERT')[5]=true;
 assert.throws(()=>parse(grantable),/TASK16_CURRENT259_CATALOG/u);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row()),{...r,identity:{...identity}}),/TASK16_CURRENT259_CATALOG/u);
});


for(const mutation of ['missing-pk','observer-write','outside-column','table-grant','grant-option','readonly-off'])test('public catalog rejects observer allocation '+mutation+' outside the single-column read delta',()=>{
 const row=observed(),isPk=cap=>cap[0]==='jg_task01_observer'&&cap[1]==='column'&&cap[2]==='RegisteredFundPaymentAllocation'&&cap[3]==='id';
 if(mutation==='missing-pk')row.capabilities=row.capabilities.filter(cap=>!isPk(cap));
 else if(mutation==='grant-option')row.capabilities.find(isPk)[5]=true;
 else if(mutation==='readonly-off')row.roles.find(role=>role.name==='jg_task01_observer').readOnlyDefault=false;
 else row.capabilities=sort([...row.capabilities,['jg_task01_observer',mutation==='table-grant'?'table':'column','RegisteredFundPaymentAllocation',mutation==='outside-column'?'private_unapproved_column':mutation==='table-grant'?'':'id',mutation==='observer-write'?'UPDATE':'SELECT',false]]);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});

test('observer audit projection retains its PK read and zero writes',()=>{
 const role=api.loadCurrent259CatalogMaterial(source).accessPlan.observer;
 const row=role.tables.find(row=>row.table==='AuditLog');
 assert.deepEqual(row.select,['action','actorUserId','businessId','businessType','id','metadata']);
 assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);
});

for(const mutation of ['missing-pk','observer-write','outside-column','table-grant','grant-option','readonly-off'])test('public catalog rejects observer audit '+mutation+' outside the single-column read delta',()=>{
 const row=observed(),isPk=cap=>cap[0]==='jg_task01_observer'&&cap[1]==='column'&&cap[2]==='AuditLog'&&cap[3]==='id';
 if(mutation==='missing-pk')row.capabilities=row.capabilities.filter(cap=>!isPk(cap));
 else if(mutation==='grant-option')row.capabilities.find(isPk)[5]=true;
 else if(mutation==='readonly-off')row.roles.find(role=>role.name==='jg_task01_observer').readOnlyDefault=false;
 else row.capabilities=sort([...row.capabilities,['jg_task01_observer',mutation==='table-grant'?'table':'column','AuditLog',mutation==='outside-column'?'private_unapproved_column':mutation==='table-grant'?'':'id',mutation==='observer-write'?'UPDATE':'SELECT',false]]);
 assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);
});

test('runtime proxy reads add only the three native required PK columns without other authority',()=>{
 const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-registered-access.json'),'utf8'));
 const expected=structuredClone(historical.runtime);
 for(const [table,column] of [['ContractVersion','originalSignedNumber'],['ContractProxyExecution','id'],['PaymentExecutionAllocation','id'],['ProjectProxyPayment','id']]){
  const row=expected.tables.find(row=>row.table===table);assert.equal(row.select.includes(column),false);row.select.push(column);row.select.sort();
 }
 const effective=api.loadCurrent259CatalogMaterial(source).accessPlan;
 assert.deepEqual(effective.runtime,expected);
 assert.deepEqual(effective.runtime.functions,historical.runtime.functions);
 assert.equal(Object.isFrozen(effective.runtime.tables),true);
});

for(const table of ['ProjectProxyPayment','ContractProxyExecution','PaymentExecutionAllocation']){
 for(const [label,change] of [
  ['missing runtime PK',r=>{r.capabilities=r.capabilities.filter(c=>!(c[0]==='jg_task01_runtime'&&c[2]===table&&c[3]==='id'&&c[4]==='SELECT'));}],
  ['runtime PK update',r=>r.capabilities.push(['jg_task01_runtime','column',table,'id','UPDATE',false])],
  ['observer PK expansion',r=>r.capabilities.push(['jg_task01_observer','column',table,'id','SELECT',false])],
  ['whole table select',r=>r.capabilities.push(['jg_task01_runtime','table',table,'','SELECT',false])]
 ])test(`catalog rejects ${table} ${label}`,()=>{const row=observed();change(row);assert.throws(()=>api.parseCurrent259CatalogRead(JSON.stringify(row),request),/TASK16_CURRENT259_CATALOG/u);});
}

test('runtime PK manifest decoder remains closed after a separately rebound file digest',()=>{
 const os=require('node:os'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'current259-proxy-pk-'));
 try{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'task16-current259-access.json'),'utf8'));
  const files=[...manifest.files.map(x=>x.path),'services/api/prisma/task16-current259-catalog.cjs','services/api/prisma/task16-current259-access.json',
   'services/api/prisma/task16-current261-competition-profile.cjs','services/api/prisma/schema.prisma',...migrations.map(x=>x.path)];
  for(const relative of files){const to=path.join(temporary,relative);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,relative),to);}
  const catalogPath=path.join(temporary,'services/api/prisma/task16-current259-catalog.cjs');
  const manifestPath=path.join(temporary,'services/api/prisma/task16-current259-access.json');
  const originalCatalog=fs.readFileSync(catalogPath,'utf8');
  const mutations=[m=>m.runtimeSelectAdditions.pop(),m=>m.runtimeSelectAdditions.push({table:'User',select:['id']}),
   m=>m.runtimeSelectAdditions[1].select.push('amountCents'),m=>m.runtimeSelectAdditions.reverse(),
   m=>m.runtimeSelectAdditions.push(m.runtimeSelectAdditions[1])];
  for(const mutate of mutations){
   const changed=structuredClone(manifest);mutate(changed);const bytes=Buffer.from(JSON.stringify(changed));fs.writeFileSync(manifestPath,bytes);
   fs.writeFileSync(catalogPath,originalCatalog.replace(/MANIFEST_SHA='[a-f0-9]{64}'/u,`MANIFEST_SHA='${hash(bytes)}'`));
   delete require.cache[require.resolve(catalogPath)];const isolated=require(catalogPath);
   assert.throws(()=>isolated.loadCurrent259CatalogMaterial(source),/TASK16_CURRENT259_CATALOG/u);
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
