'use strict';

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
 candidateSha:'b'.repeat(40), sealSha256:'c'.repeat(64), schemaSha256:hash(path.join(__dirname,'schema.prisma')),
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
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const profile=qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]});
 const witness={...source,profile},provisioned={...receipt(),paymentProfile:PAYMENT261_RUNTIME_PROFILE};
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,receipt(),nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259RuntimeAcl(source,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 const qualified=renderCurrent259RuntimeAcl(witness,provisioned,nonce),legacy=renderCurrent259RuntimeAcl(source,receipt(),nonce);
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 assert.deepEqual(grants(qualified.sql),grants(legacy.sql));
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

test('261 competition ACL keeps the historical grant set and rejects ordinary, legacy and voucher pairings',()=>{
 const {PAYMENT261_COMPETITION_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const paired={...receipt(),roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const provisioned={...paired,paymentProfile:PAYMENT261_COMPETITION_RUNTIME_PROFILE};
 const acl=renderCurrent259CompetitionRuntimeAcl(witness,provisioned,nonce);
 const legacy=renderCurrent259CompetitionRuntimeAcl(source,paired,nonce);
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 assert.deepEqual(grants(acl.sql),grants(legacy.sql));
 assert.match(acl.witnessSql,/TASK16_PAYMENT261_COMPETITION_RUNTIME_V1/u);
 assert.match(acl.witnessSql,/jg_guard_contract_bank_event_company_transfer\(\)/u);
 assert.throws(()=>renderCurrent259RuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(source,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259CompetitionRuntimeAcl(witness,{...provisioned,roles:[{...runtime,limit:1},{...observer,limit:1}]},nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
 assert.throws(()=>renderCurrent259VoucherRuntimeAcl(witness,provisioned,nonce),/TASK16_CURRENT259_RUNTIME_ACL/u);
});

test('261 voucher and attribution gap retain exactly their historical grants, source guards and lane limits',()=>{
 const {PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE}=require('./task16-current261-competition-profile.cjs');
 const extra=readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().slice(259).map(name=>({
  path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:hash(path.join(__dirname,'migrations',name,'migration.sql')),
 }));
 const witness={...source,profile:qualifyCurrent259Source({...material,migrations:[...material.migrations,...extra]})};
 const grants=sql=>sql.match(/^GRANT [^;]+;/gmu);
 const single=receipt(),paired={...single,roles:[{...runtime,limit:2},{...observer,limit:1}]};
 const gap={...single,paymentProfile:PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE};
 const voucher={...paired,paymentProfile:PAYMENT261_VOUCHER_RUNTIME_PROFILE};
 const gap261=renderCurrent259RuntimeAcl(witness,gap,nonce),voucher261=renderCurrent259VoucherRuntimeAcl(witness,voucher,nonce);
 const historicalVoucher=renderCurrent259VoucherRuntimeAcl(source,paired,nonce);
 assert.deepEqual(grants(gap261.sql),grants(renderCurrent259RuntimeAcl(source,single,nonce).sql));
 assert.deepEqual(grants(voucher261.sql),grants(historicalVoucher.sql));
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
