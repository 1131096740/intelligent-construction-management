'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash} = require('node:crypto');
const {readFileSync, readdirSync} = require('node:fs');
const path = require('node:path');
const {qualifyCurrent259Source} = require('./task16-current259-profile.cjs');
const {renderCurrent259RuntimeAcl} = require('./task16-current259-runtime-acl.cjs');

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
