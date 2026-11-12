'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash} = require('node:crypto');
const {readFileSync, readdirSync} = require('node:fs');
const path = require('node:path');
const {qualifyCurrent259Source} = require('./task16-current259-profile.cjs');
const {renderCurrent259RuntimeAcl,renderCurrent259CompetitionRuntimeAcl,renderCurrent259VoucherRuntimeAcl} = require('./task16-current259-runtime-acl.cjs');

const nonce='d'.repeat(64);
const database = 'jg_task01_12345678123442348234123456789012';
const runtime = {name:'jg_task01_runtime',oid:'110'};
const observer = {name:'jg_task01_observer',oid:'111'};
const ordinary = {name:'jg_fixture_app_'+'a'.repeat(24),oid:'100'};
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const material = {
 candidateSha:'b'.repeat(40), sealSha256:'c'.repeat(64), schemaSha256:hash(path.join(__dirname,'schema.prisma')),
 migrations:readdirSync(path.join(__dirname,'migrations')).filter(name=>/^\d{14}_/u.test(name)).sort().map(name=>({
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
