'use strict';
const {historicalQualificationSchemaHash,useHistoricalQualificationSchemaFile}=require('./testdata/historical-qualification-schema.cjs');
useHistoricalQualificationSchemaFile();

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash} = require('node:crypto');
const {readFileSync, readdirSync} = require('node:fs');
const path = require('node:path');
const {qualifyCurrent259Source,PAYMENT261_RUNTIME_PROFILE} = require('./task16-current259-profile.cjs');
const {renderCurrent259RuntimeAcl,renderCurrent259CompetitionRuntimeAcl,renderCurrent259VoucherRuntimeAcl} = require('./task16-current259-runtime-acl.cjs');

const nonce='d'.repeat(64);
const database = 'jg_task01_12345678123442348234123456789012';
const runtime = {name:'jg_task01_runtime',oid:'110'};
const observer = {name:'jg_task01_observer',oid:'111'};
const ordinary = {name:'jg_fixture_app_'+'a'.repeat(24),oid:'100'};
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const material = {
 candidateSha:'b'.repeat(40), sealSha256:'c'.repeat(64), schemaSha256:historicalQualificationSchemaHash(),
 migrations:readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(0,259).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 })),
};
const source={candidateSha:material.candidateSha,sourceSealSha256:material.sealSha256,profile:qualifyCurrent259Source(material)};
function receipt(){
 const databaseIdentity={database,databaseOid:'90',ownerOid:'10',namespaceOid:'2200',systemIdentifier:'1234567890123456789'};
 const owner=[['10','10','CONNECT',false],['10','10','CREATE',false],['10','10','TEMPORARY',false]];
 return {status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId:'12345678-1234-4234-8234-123456789012',databaseIdentity,ordinary,roles:[runtime,observer],
  databaseAcl:{after:[{oid:'90',name:database,owner:'10',acl:[...owner,['10','0','CONNECT',false],['10','0','TEMPORARY',false],
   ...[ordinary,runtime,observer].map(role=>['10',role.oid,'CONNECT',false])]},
  ...[['5','postgres'],['4','template0'],['1','template1']].map(([oid,name])=>({oid,name,owner:'10',acl:owner}))]}};
}

test('renders the fixed current259 matrix, all lock guards, and a fresh-backend read without admission',()=>{
 const plan=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 assert.equal(plan.nativeAdmission,false);
 assert.equal(plan.publicAclStatus,'REQUIRES_FINAL_CATALOG');
 assert.match(plan.sql,/GRANT SELECT \([^\n]*"originalSignedNumber"[^\n]*\) ON TABLE public\."ContractVersion" TO "jg_task01_runtime"/u);
 assert.match(plan.sql,/GRANT DELETE ON TABLE public\."AuthRateLimit" TO "jg_task01_runtime"/u);
 const xminTables=[...plan.sql.matchAll(/GRANT SELECT \([^\n]*"xmin"[^\n]*\) ON TABLE public\."([^"]+)" TO "jg_task01_runtime"/gu)]
   .map(([,table])=>table).sort();
 assert.deepEqual(xminTables,['FundAccountBalanceRegistration','PaymentExecution','RegisteredFundAccount']);
 assert.match(plan.witnessSql,/pg_catalog\.pg_attribute a ON a\.attrelid=c\.oid AND a\.attnum<>0/u);
 assert.match(plan.sql,/a\.attname=q\.column_name AND a\.attnum<>0/u);
 assert.match(plan.sql,/aclexplode\(a\.attacl\) g WHERE c\.relnamespace=\d+::oid AND a\.attnum<>0/u);
 assert.doesNotMatch(plan.sql,/GRANT (?:INSERT|UPDATE|DELETE)[^\n]+TO "jg_task01_observer"/u);
 assert.equal([...plan.sql.matchAll(/ENABLE ALWAYS TRIGGER/g)].length,4);
 assert.match(plan.sql,/jg_task16_runtime_version_read_only/u);
 assert.match(plan.sql,/jg_task16_runtime_reference_read_only/u);
 assert.match(plan.sql,/TASK16_CURRENT259_DATABASE_ACL_POSTIMAGE/u);
 assert.doesNotMatch(plan.sql,/REVOKE .*ON ALL|ALTER DEFAULT PRIVILEGES|\bCOMMIT;/u);
 assert.match(plan.witnessSql,/extraFunctions/u);
 assert.match(plan.witnessSql,/publicAclViolations/u);
 assert.match(plan.readbackSql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/u);
 assert.doesNotMatch(plan.readbackSql,/CREATE TRIGGER|GRANT DELETE|REVOKE /u);
});

test('rejects a different candidate role receipt and checked-to-used getters',()=>{
 assert.throws(()=>renderCurrent259RuntimeAcl(source,{...receipt(),sourceSha:'d'.repeat(40)},nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 const result=receipt();let getter=0;
 result.roles=[{name:runtime.name,get oid(){getter++;return runtime.oid;}},observer];
 assert.throws(()=>renderCurrent259RuntimeAcl(source,result,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.equal(getter,0);
});

test('payment261 runtime ACL retains the old grants and requires its scoped ordinary role receipt',()=>{
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const profile=qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]});
 const witness={...source,profile},provisioned={...receipt(),paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,receipt(),nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259RuntimeAcl(source,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 const qualified=renderCurrent259RuntimeAcl(witness,provisioned,nonce),legacy=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 const effective=require('./task16-current259-catalog.cjs').loadCurrent259CatalogMaterial({...material,migrations:[...material.migrations,...extra]},PAYMENT261_RUNTIME_PROFILE).accessPlan;
 for(const row of effective.runtime.tables){
  if(row.insert?.length)assert.ok(qualified.sql.includes(`GRANT INSERT (${row.insert.map(c=>'"'+c+'"').join(', ')}) ON TABLE public."${row.table}" TO "jg_task01_runtime";`));
 }
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 const discovery='GRANT SELECT ("evidenceLevel", "id", "kind", "mappingDecision", "projectId", "targetKind", "targetRef") ON TABLE public."HistoricalFinancialTakeoverRowMapping" TO "jg_task01_runtime";';
 assert.equal(grants(qualified.sql).filter(sql=>sql===discovery).length,1);
 assert.deepEqual(grants(qualified.sql).filter(sql=>!sql.startsWith('GRANT INSERT ')&&sql!==discovery),grants(legacy.sql).filter(sql=>!sql.startsWith('GRANT INSERT ')));
 assert.match(qualified.witnessSql,/jg_guard_contract_bank_event_company_transfer\(\)/u);
 assert.match(qualified.witnessSql,/jg_upward_archive_recipe_v2\(\)/u);
 assert.equal(qualified.nativeAdmission,false);
});


test('transaction includes exact directory read checks and does not accept a replay under a different namespace coordinate',()=>{
 const invalid=receipt();invalid.databaseIdentity.namespaceOid='not-an-oid';
 assert.throws(()=>renderCurrent259RuntimeAcl(source,invalid,nonce));
 assert.throws(()=>renderCurrent259RuntimeAcl(source,receipt()),/TASK16_CURRENT259_RUNTIME_ACL/u);
 const result=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 assert.match(result.sql,/NOT EXISTS\(SELECT \* FROM expected EXCEPT ALL SELECT \* FROM actual\)/u);
 assert.match(result.sql,/TASK16_CURRENT259_RUNTIME_ACL_POSTIMAGE/u);
 assert.match(result.readbackSql,/TASK16_CURRENT259_RUNTIME_ACL_POSTIMAGE/u);
 assert.doesNotMatch(result.sql,/REVOKE USAGE|GRANT USAGE[^\n]+jg_fixture_app/u);
});

test('failed ACL postimages identify the first fixed predicate in either transaction',()=>{
 const rendered=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 const fixed=['IDENTITY','ROLE_ARRAY','ROLES','LEDGER','GUARDS','READER','CAPABILITIES','FUNCTIONS','RELATIONS','DATABASE_ACL'];
 for(const [sql,phase] of [[rendered.sql,'WRITER'],[rendered.readbackSql,'READBACK']]){
  const message=new RegExp(`RAISE EXCEPTION 'TASK16_CURRENT259_RUNTIME_ACL_POSTIMAGE: ${phase}_([A-Z0-9_]+)';`,'gu');
  const labels=[...sql.matchAll(message)].map(match=>match[1]);
  assert.deepEqual(labels.slice(0,fixed.length),fixed);
  assert.deepEqual(labels.slice(-3),['HELPERS','DIRECT_ACL','GRANT_OPTION']);
  assert.equal(new Set(labels).size,labels.length);
  assert.ok(labels.includes('FUNCTION_PROOF_0'));
 }
});

test('checks the migration-pinned lineage routine with its full catalog metadata in both ACL proofs',()=>{
 const {functionProofs:[lineage]}=require('./task16-baseline-access.json');
 const migration=readFileSync(path.join(__dirname,'migrations/20260828080000_pol13b_payer_authority_and_relation_guards/migration.sql'),'utf8');
 const body=/CREATE OR REPLACE FUNCTION assert_inter_entity_relationship_lineage\(\s*p_settlement_case_id TEXT,\s*p_payment_execution_id TEXT\s*\)\s*RETURNS VOID AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/u.exec(migration)?.[1];
 assert.equal(lineage.body,body);
 const expected={...lineage,bodySha256:'4f58454305ef953353959c192ea13d7c82567b48219b5f8a4ff5e132b2cb218e',
  language:'plpgsql',strict:false,volatility:'v',parallel:'u',returnType:'void',returnsSet:false,searchPath:null,
  interface:{argumentNames:['p_settlement_case_id','p_payment_execution_id'],inputArgumentTypes:['text','text'],
   allArgumentTypes:null,argumentModes:null,defaultArgumentCount:0,variadicType:null,kind:'f',leakproof:false,support:null}};
 const twoLanes={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 for(const plan of [renderCurrent259RuntimeAcl(source,receipt(),nonce),
  renderCurrent259CompetitionRuntimeAcl(source,twoLanes,nonce),renderCurrent259VoucherRuntimeAcl(source,twoLanes,nonce)]){
  for(const sql of [plan.sql,plan.readbackSql]){
   const proofs=[...sql.matchAll(/FROM pg_catalog\.jsonb_array_elements\('((?:[^']|'')*)'::jsonb\) proof WHERE NOT EXISTS/gu)]
    .flatMap(([,value])=>JSON.parse(value.replaceAll("''","'")));
   assert.deepEqual(proofs.filter(row=>row.signature===lineage.signature),[expected]);
  }
 }
});


test('fixed competition ACL requires runtime two and observer one and leaves the original single lane SQL unchanged',()=>{
 const single=receipt();
 single.roles=[{...runtime,limit:1},{...observer,limit:1}];
 const competition={...single,roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const original=renderCurrent259RuntimeAcl(source,single,nonce);
 assert.deepEqual(original,renderCurrent259RuntimeAcl(source,receipt(),nonce));
 assert.throws(()=>renderCurrent259RuntimeAcl(source,competition,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 const rendered=renderCurrent259CompetitionRuntimeAcl(source,competition,nonce);
 for(const sql of [rendered.sql,rendered.readbackSql]){
  const tested=[...sql.matchAll(/jsonb_array_elements\(report->'roles'\) r WHERE r @> '([^']+)'::jsonb/gu)].map(match=>JSON.parse(match[1]));
  assert.deepEqual(tested.map(role=>[role.name,role.connectionLimit]),[[observer.name,1],[runtime.name,2]]);
 }
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(source,single,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(source,{...single,roles:[{...runtime,limit:2},{...observer,limit:2}]},nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(source,{...single,roles:[{...runtime,limit:3},{...observer,limit:1}]},nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
});

test('voucher runtime takes the original shared locks and installs only the additive guards before its grants',()=>{
 const roles={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const voucher=renderCurrent259VoucherRuntimeAcl(source,roles,nonce);
 const competition=renderCurrent259CompetitionRuntimeAcl(source,roles,nonce);
 const newGrants=new Set(voucher.sql.match(/^GRANT .*;$/gmu));
 const oldGrants=competition.sql.match(/^GRANT .*;$/gmu);
 for(const grant of oldGrants.filter(line=>line.includes('"jg_task01_observer"')))assert.ok(newGrants.has(grant));
 assert.match(voucher.lockSql,/^LOCK TABLE public\._prisma_migrations, .*jg_contract_direct_pending_binding_v1 IN SHARE MODE NOWAIT;/u);
 const before=voucher.sql.indexOf('DO $voucher_before$');
 const insertGuard=voucher.sql.indexOf('CREATE TRIGGER "jg_task16_runtime_voucher_file_insert"');
 const insertGrant=voucher.sql.indexOf('GRANT INSERT ("contentSha256", "executionId", "fileId", "uploadedByUserId")');
 const after=voucher.sql.indexOf('DO $current259_runtime_acl_after$');
 assert.ok(before>=0&&insertGuard>before&&insertGrant>insertGuard&&after>insertGrant);
 assert.equal((voucher.sql.match(/ENABLE ALWAYS TRIGGER/g)||[]).length,7);
 assert.match(voucher.witnessSql,/CURRENT259_PAYMENT_VOUCHER_V1/u);
 assert.match(voucher.witnessSql,/voucherBindingSha256/u);
 assert.match(voucher.witnessSql,/p\.proargdefaults IS NULL/u);
 assert.doesNotMatch(competition.witnessSql,/CURRENT259_PAYMENT_VOUCHER_V1|voucherBindingSha256/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(source,receipt(),nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
});

test('261 competition ACL supplies exactly normal default INSERT additions and rejects mismatched pairings',()=>{
 const {PAYMENT261_COMPETITION_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const paired={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const provisioned={...paired,paymentProfile:PAYMENT261_COMPETITION_RUNTIME_PROFILE};
 const acl=renderCurrent259CompetitionRuntimeAcl(witness,provisioned,nonce);
 const legacy=renderCurrent259CompetitionRuntimeAcl(source,paired,nonce);
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 const normal=renderCurrent259RuntimeAcl(witness,{...receipt(),paymentProfile:PAYMENT261_RUNTIME_PROFILE},nonce);
 assert.deepEqual(grants(acl.sql),grants(normal.sql));
 assert.notDeepEqual(grants(acl.sql),grants(legacy.sql));
 assert.match(acl.sql,/GRANT INSERT \("action", "actorUserId", "businessId", "businessType", "createdAt", "id", "metadata"\) ON TABLE public\."AuditLog" TO "jg_task01_runtime";/u);
 assert.doesNotMatch(acl.sql,/GRANT INSERT \([^\n]*(?:"ipAddress"|"userAgent")[^\n]*\) ON TABLE public\."AuditLog"/u);
 assert.doesNotMatch(acl.sql,/GRANT (?:INSERT|UPDATE|DELETE)[^\n]+TO "jg_task01_observer"|GRANT INSERT ON TABLE/u);
 assert.match(acl.sql,/GRANT SELECT \("evidenceLevel", "id", "kind", "mappingDecision", "projectId", "targetKind", "targetRef"\) ON TABLE public\."HistoricalFinancialTakeoverRowMapping" TO "jg_task01_runtime";/u);
 assert.doesNotMatch(acl.sql,/^GRANT (?:INSERT|UPDATE|REFERENCES)[^\n]+HistoricalFinancialTakeoverRowMapping|^GRANT [^\n]+HistoricalFinancialTakeoverRowMapping[^\n]+jg_task01_observer/mu);
 assert.match(acl.witnessSql,/TASK16_PAYMENT261_COMPETITION_RUNTIME_V1/u);
 assert.match(acl.witnessSql,/jg_guard_contract_bank_event_company_transfer\(\)/u);
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(source,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(witness,{...provisioned,roles:[{...runtime,limit:1},{...observer,limit:1}]},nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
});

test('261 gap adds five opening defaults and voucher eleven with unchanged nonINSERT grants and lane limits',()=>{
 const {PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 const single=receipt(),paired={...single,roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const gap={...single,paymentProfile:PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE};
 const voucher={...paired,paymentProfile:PAYMENT261_VOUCHER_RUNTIME_PROFILE};
 const gap261=renderCurrent259RuntimeAcl(witness,gap,nonce),voucher261=renderCurrent259VoucherRuntimeAcl(witness,voucher,nonce);
 const historicalVoucher=renderCurrent259VoucherRuntimeAcl(source,paired,nonce);
 const legacy=renderCurrent259RuntimeAcl(source,single,nonce);
 const inserts=sql=>grants(sql).filter(row=>row.startsWith('GRANT INSERT '));
 assert.deepEqual(grants(gap261.sql).filter(row=>!row.startsWith('GRANT INSERT ')),grants(legacy.sql).filter(row=>!row.startsWith('GRANT INSERT ')));
 assert.equal(inserts(gap261.sql).filter(row=>!inserts(legacy.sql).includes(row)).length,4);
 assert.doesNotMatch(gap261.sql,/^GRANT SELECT [^\n]+HistoricalFinancialTakeoverRowMapping/mu);
 for(const table of ['PaymentExecution','RegisteredPaymentEvent','InterEntityRelationshipEntry'])assert.deepEqual(inserts(gap261.sql).filter(row=>row.includes('public."'+table+'"')),inserts(legacy.sql).filter(row=>row.includes('public."'+table+'"')));
 const rosterGrant='GRANT SELECT ("id", "projectId", "userId") ON TABLE public."ProjectRosterMember" TO "jg_task01_runtime";';
 const approvedReadChanges=new Map([
  ['GRANT SELECT ("archiveFileId", "contractVersionId", "fileId") ON TABLE public."ContractArchiveEvidenceFile" TO "jg_task01_runtime";',
   'GRANT SELECT ("archiveFileId", "contentSha256", "contractVersionId", "createdAt", "displayOrder", "fileId", "id", "mimeType", "sizeBytes") ON TABLE public."ContractArchiveEvidenceFile" TO "jg_task01_runtime";'],
  ['GRANT SELECT ("evidenceFileId") ON TABLE public."WageApprovedSourceVersion" TO "jg_task01_runtime";',
   'GRANT SELECT ("evidenceFileId", "id") ON TABLE public."WageApprovedSourceVersion" TO "jg_task01_runtime";']
 ]);
 const historicalNonInsert=grants(historicalVoucher.sql).filter(row=>!row.startsWith('GRANT INSERT '));
 for(const oldGrant of approvedReadChanges.keys())assert.equal(historicalNonInsert.filter(row=>row===oldGrant).length,1);
 assert.deepEqual(grants(voucher261.sql).filter(row=>!row.startsWith('GRANT INSERT ')&&row!==rosterGrant),historicalNonInsert.map(row=>approvedReadChanges.get(row)??row));
 assert.deepEqual(grants(voucher261.sql).filter(row=>row.includes('public."ProjectRosterMember"')),[rosterGrant]);
 assert.equal(inserts(voucher261.sql).filter(row=>!inserts(historicalVoucher.sql).includes(row)).length,9);
 for(const table of ['FileObject','RegisteredPaymentVoucher'])assert.match(inserts(voucher261.sql).find(row=>row.includes('public.\"'+table+'\"')),/createdAt/u);
 assert.equal(voucher261.lockSql,historicalVoucher.lockSql);
 assert.match(voucher261.witnessSql,/voucherBindingSha256/u);
 assert.doesNotMatch(gap261.witnessSql,/voucherBindingSha256/u);
 for(const acl of [gap261,voucher261])assert.match(acl.witnessSql,/jg_guard_contract_bank_event_company_transfer\(\)/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,gap,nonce));
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(witness,voucher,nonce));
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,{...voucher,roles:single.roles},nonce));
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,{...gap,roles:paired.roles},nonce));
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(source,voucher,nonce));
 assert.throws(()=>renderCurrent259RuntimeAcl(source,gap,nonce));
});


test('original ACL renderer grants only the observer allocation PK read and closes its exact postimage',()=>{
 const acl=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 assert.match(acl.sql,/GRANT SELECT \("accountId", "amountCents", "executionId", "id", "sourceBatchId"\) ON TABLE public\."RegisteredFundPaymentAllocation" TO "jg_task01_observer";/u);
 const expected=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.sql)?.[1]??'null');assert.ok(Array.isArray(expected));
 const observerCaps=expected.filter(row=>row[0]==='jg_task01_observer');
 assert.ok(observerCaps.length>0);assert.ok(observerCaps.every(row=>row[1]==='column'&&row[4]==='SELECT'&&row[5]===false));
 assert.deepEqual(observerCaps.filter(row=>row[2]==='RegisteredFundPaymentAllocation').map(row=>row[3]).sort(),['accountId','amountCents','executionId','id','sourceBatchId']);
 assert.ok(!observerCaps.some(row=>row[3]==='xmin'||row[4]!=='SELECT'||row[1]==='table'));
 assert.match(acl.sql,/"name":"jg_task01_observer"[^']*"readOnlyDefault":true/u);
 assert.doesNotMatch(acl.sql,/GRANT (?:INSERT|UPDATE|DELETE|REFERENCES)[^\n]+TO "jg_task01_observer"/u);
 const readback=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.readbackSql)?.[1]??'null');assert.deepEqual(readback,expected);
 assert.match(acl.sql,/TASK16_CURRENT259_RUNTIME_ACL_POSTIMAGE: WRITER_CAPABILITIES/u);
});

test('audit PK observer read is exact in original grant and postimage readback',()=>{
 const acl=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 assert.match(acl.sql,/GRANT SELECT \("action", "actorUserId", "businessId", "businessType", "id", "metadata"\) ON TABLE public\."AuditLog" TO "jg_task01_observer";/u);
 const caps=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.sql)[1]);
 const readback=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.readbackSql)[1]);assert.deepEqual(readback,caps);
 const audit=caps.filter(row=>row[0]==='jg_task01_observer'&&row[2]==='AuditLog');
 assert.deepEqual(audit.map(row=>row[3]).sort(),['action','actorUserId','businessId','businessType','id','metadata']);
 assert.ok(audit.every(row=>row[1]==='column'&&row[4]==='SELECT'&&row[5]===false));
});

test('three native proxy PK grants are narrow runtime selects in writer and independent postimage',()=>{
 const acl=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 const caps=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.sql)[1]);
 const after=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(acl.readbackSql)[1]);assert.deepEqual(after,caps);
 for(const table of ['ProjectProxyPayment','ContractProxyExecution','PaymentExecutionAllocation']){
  assert.deepEqual(caps.filter(r=>r[0]==='jg_task01_runtime'&&r[2]===table&&r[3]==='id'),[['jg_task01_runtime','column',table,'id','SELECT',false]]);
  const grant=acl.sql.split('\n').filter(line=>line.startsWith('GRANT SELECT (')&&line.includes(`ON TABLE public."${table}" TO "jg_task01_runtime"`));
  assert.equal(grant.length,1);assert.ok(grant[0].includes('"id"'));
  assert.ok(!caps.some(r=>r[0]==='jg_task01_observer'&&r[2]===table&&r[3]==='id'));
 }
 assert.doesNotMatch(acl.sql,/GRANT SELECT ON TABLE/u);
});

test('native fixed ACL renderer changes only the fully verified endpoint and audits all three SQL outputs',()=>{
 const {renderNativeTask16RuntimeAcl}=require('./run-task16-native-direct-once.cjs');
 const migrations=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(0,261).map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))}));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations})},provisioned={...receipt(),commitXid:'1234',paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 provisioned.databaseIdentity={...provisioned.databaseIdentity,tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:54968};
 const original=renderCurrent259RuntimeAcl(witness,provisioned,nonce),actual=renderNativeTask16RuntimeAcl(JSON.stringify({source:witness,provisioned}),nonce);
 for(const field of ['sql','readbackSql','witnessSql']){
  assert.equal(actual[field].replaceAll('inet_server_port() IS DISTINCT FROM 54968','inet_server_port() IS DISTINCT FROM 5432'),original[field]);
  assert.ok(!actual[field].includes('inet_server_port() IS DISTINCT FROM 5432'));
  assert.equal((actual[field].match(/inet_server_port\(\)/gu)||[]).length,field==='sql'?1:0);
 }
 assert.equal(actual.nativeAdmission,false);assert.equal(actual.publicAclStatus,original.publicAclStatus);
 const publicOriginal=require('./task16-current259-public-access.cjs').renderCurrent259PublicAccess(provisioned);
 assert.equal(actual.publicSql.replaceAll('inet_server_port() IS DISTINCT FROM 54968','inet_server_port() IS DISTINCT FROM 5432'),publicOriginal);
 assert.equal(actual.writeSql,actual.sql+'\n'+actual.publicSql);
 assert.equal((actual.publicSql.match(/inet_server_port\(\)/gu)||[]).length,1);
 assert.match(actual.publicSql,/REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC RESTRICT/u);assert.match(actual.publicSql,/REVOKE USAGE ON SCHEMA public FROM PUBLIC RESTRICT/u);
 assert.ok(actual.writeSql.indexOf('REVOKE USAGE ON SCHEMA public FROM PUBLIC RESTRICT')>actual.writeSql.indexOf('jg_task01_connection_identity'));

 for(const delta of [{serverPort:5432},{serverPort:'54968'},{serverPort:undefined},{serverPort:1024},{serverPort:65536},{tls:false},{clientAddress:'127.0.0.2'},{serverAddress:'0.0.0.0'}])assert.throws(()=>renderNativeTask16RuntimeAcl(JSON.stringify({source:witness,provisioned:{...provisioned,databaseIdentity:{...provisioned.databaseIdentity,...delta}}}),nonce),error=>error.code==='NATIVE_DIRECT_ACL_ENDPOINT');
});
test('cash grants and physical readback are bound to its own source and profile',()=>{
 const {PAYMENT261_CASH_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))}));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const roles={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}],paymentProfile:PAYMENT261_CASH_RUNTIME_PROFILE};
 const acl=renderCurrent259CompetitionRuntimeAcl(witness,roles,nonce);
 assert.match(acl.sql,/appendOperatingFactThroughService.*OperatingLedgerFactWritePayload"/u);
 assert.match(acl.sql,/appendOperatingImpactThroughService.*OperatingLedgerImpactWritePayload"/u);
 assert.match(acl.readbackSql,/TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1/u);
 assert.match(acl.sql,/GRANT SELECT \("amountSnapshot", "id", "projectId", "projectionCutoffAt", "projectionFingerprint", "projectionReadAt", "revision", "stageKey", "stateSnapshot", "status"\) ON TABLE public\."ProjectCloseStageVersion" TO "jg_task01_runtime";/u);
 assert.doesNotMatch(acl.sql,/GRANT (?:INSERT|UPDATE|DELETE|REFERENCES)[^\n]*ProjectCloseStageVersion/u);
 assert.match(acl.sql,/GRANT SELECT \("id", "projectId", "sourceFingerprint", "sourceId", "sourceType"\) ON TABLE public\."ProjectCloseImpact" TO "jg_task01_runtime";/u);
 assert.doesNotMatch(acl.sql,/GRANT (?:INSERT|UPDATE|DELETE|REFERENCES)[^\n]*ProjectCloseImpact/u);
 assert.match(acl.sql,/GRANT SELECT \("createdAt", "projectId", "revision", "updatedAt"\) ON TABLE public\."ProjectCloseAggregate" TO "jg_task01_runtime";/u);
 assert.match(acl.sql,/GRANT INSERT \("createdAt", "projectId", "revision", "updatedAt"\) ON TABLE public\."ProjectCloseAggregate" TO "jg_task01_runtime";/u);
 assert.match(acl.sql,/GRANT UPDATE \("updatedAt"\) ON TABLE public\."ProjectCloseAggregate" TO "jg_task01_runtime";/u);
 assert.doesNotMatch(acl.sql,/GRANT (?:DELETE|REFERENCES)[^\n]*ProjectCloseAggregate/u);
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,roles,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,roles,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
});
test('cash allocation readback adds only observed ordering column to runtime',()=>{
 const profiles=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))}));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const paired={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const render=profile=>renderCurrent259CompetitionRuntimeAcl(witness,{...paired,paymentProfile:profile},nonce);
 const baseline=render(profiles.PAYMENT261_COMPETITION_RUNTIME_PROFILE),cash=render(profiles.PAYMENT261_CASH_RUNTIME_PROFILE);
 const caps=sql=>JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(sql)[1]).filter(row=>row[2]==='PaymentExecutionAllocation');
 const before=caps(baseline.sql),after=caps(cash.sql);
 assert.deepEqual(after.filter(row=>!before.some(old=>JSON.stringify(old)===JSON.stringify(row))),[['jg_task01_runtime','column','PaymentExecutionAllocation','allocationOrder','SELECT',false]]);
 assert.deepEqual(before.filter(row=>!after.some(now=>JSON.stringify(now)===JSON.stringify(row))),[]);
 assert.deepEqual(caps(cash.readbackSql),after);
});

test('cash impact writer proof follows the later stored-watermark migration exactly',()=>{
 const {PAYMENT261_CASH_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))}));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const roles={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}],paymentProfile:PAYMENT261_CASH_RUNTIME_PROFILE};
 const sql=renderCurrent259CompetitionRuntimeAcl(witness,roles,nonce).sql;
 const proof=[...sql.matchAll(/jsonb_array_elements\('((?:[^']|'')+)'::jsonb\) proof/gu)].map(m=>JSON.parse(m[1].replaceAll("''","'"))[0]).find(p=>p.signature.includes('OperatingLedgerImpactWritePayload"'));
 assert.ok(proof);assert.equal(proof.bodySha256,'242fde7700f1e9d612a79e256e1897133c54fb606cc6a51bbc541402e6291cb6');
 assert.equal(proof.returnType,'record');assert.deepEqual(proof.interface.argumentNames,['p_payload','p_actor_user_id','p_secret','id','createdAt']);
 assert.deepEqual(proof.interface.allArgumentTypes,['public."OperatingLedgerImpactWritePayload"','pg_catalog.text','pg_catalog.text','pg_catalog.text','pg_catalog.timestamp']);
 assert.deepEqual(proof.interface.argumentModes,['i','i','i','t','t']);
 assert.match(sql,/WRITER_FUNCTION_PROOF_14/u);
});

test('revocation writer and readback bind only the six source columns to observer',()=>{
 const profiles=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259,261).map(name=>({path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))}));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const paired={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const old=renderCurrent259VoucherRuntimeAcl(witness,{...paired,paymentProfile:profiles.PAYMENT261_VOUCHER_RUNTIME_PROFILE},nonce);
 const added=renderCurrent259VoucherRuntimeAcl(witness,{...paired,paymentProfile:profiles.PAYMENT261_VOUCHER_REVOCATION_RUNTIME_PROFILE},nonce);
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);const difference=grants(added.sql).filter(x=>!grants(old.sql).includes(x));
 assert.deepEqual(difference,['GRANT SELECT ("amountYuan", "id", "projectId", "projectStatus", "registrationId", "sourceStatus") ON TABLE public."FundAccountSourceBatch" TO "jg_task01_observer";']);
 for(const sql of [added.sql,added.readbackSql]){const caps=JSON.parse(/report->'capabilities' = '([^']+)'::jsonb/u.exec(sql)[1]);const rows=caps.filter(r=>r[0]==='jg_task01_observer'&&r[2]==='FundAccountSourceBatch');assert.deepEqual(rows.map(r=>r[3]).sort(),['amountYuan','id','projectId','projectStatus','registrationId','sourceStatus']);assert.ok(rows.every(r=>r[1]==='column'&&r[4]==='SELECT'&&r[5]===false));}
});

test('native 262 fault ACL keeps ordinary grants and fails closed with a 261 role profile',()=>{
 const {PAYMENT262_FAULT_RUNTIME_PROFILE}=require('./task16-current262-native-fault-profile.cjs');
 const migrations=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(0,262).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql'))
 }));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations})};
 const legacy={...source,profile:qualifyCurrent259Source({...material,migrations:migrations.slice(0,261)})};
 const provisioned={...receipt(),commitXid:'1234',paymentProfile:PAYMENT262_FAULT_RUNTIME_PROFILE};
 provisioned.databaseIdentity={...provisioned.databaseIdentity,tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:54968};
 const legacyReceipt={...provisioned,paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 const original=renderCurrent259RuntimeAcl(legacy,legacyReceipt,nonce);
 for(const name of ['cancel','disconnect']){
  const {renderNativeTask16RuntimeAcl}=require(`./run-task16-native-${name}-once.cjs`);
  const actual=renderNativeTask16RuntimeAcl(JSON.stringify({source:witness,provisioned}),nonce);
  assert.deepEqual(grants(actual.sql),grants(original.sql));
  assert.match(actual.readbackSql,/jg_upward_archive_catalog_projection_v2/u);
  assert.match(actual.readbackSql,/jg_upward_direct_archive_admission_v1/u);
  assert.equal(actual.nativeAdmission,false);
  assert.throws(()=>renderNativeTask16RuntimeAcl(JSON.stringify({source:witness,provisioned:legacyReceipt}),nonce));
  assert.throws(()=>renderNativeTask16RuntimeAcl(JSON.stringify({source:legacy,provisioned}),nonce));
 }
});
