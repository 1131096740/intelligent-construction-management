'use strict';
const {historicalQualificationSchemaHash,historicalMigrationCount,useHistoricalQualificationSchemaFile}=require('./testdata/historical-qualification-schema.cjs');
useHistoricalQualificationSchemaFile();
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
function source(){
 const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>fs.existsSync(path.join(__dirname,'migrations',n,'migration.sql'))).sort().slice(0,historicalMigrationCount).map(n=>({path:'services/api/prisma/migrations/'+n+'/migration.sql',sha256:hash(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
 return {candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:qualifyCurrent259Source({candidateSha:'a'.repeat(40),sealSha256:'c'.repeat(64),schemaSha256:historicalQualificationSchemaHash(),migrations})};
}
test('explicit local lifecycle scope binds the real registered plan and reports only the fixed material public case',()=>{
 const api=require('./task12-current261-local-lifecycle-scope.cjs'),s=source(),plan=api.describeCurrent261LocalLifecycle(s);
 assert.equal(plan.purpose,'CURRENT261_GENERATED_LIFECYCLE_LOCAL');
 assert.equal(plan.storage,'LOCAL_ONLY');assert.equal(plan.relationship,'inside');assert.equal(plan.contractTypeKey,'material_purchase');
 assert.equal(plan.installation,'ARCHIVE261_REGISTERED_SEVEN');
 const ordinary=require('./task16-current259-ordinary-archive-acl.cjs').describeCurrent261GeneratedLifecycleOrdinaryAcl(s);
 const document=require('./task12-current259-document-acl.cjs').describeCurrent261GeneratedLifecycleDocumentAcl(s);
 assert.equal(plan.effectivePlanSha256,ordinary.effectivePlanSha256);assert.equal(plan.effectivePlanSha256,document.effectivePlanSha256);
 assert.equal(plan.resourceMs,3600000);assert.equal(plan.httpMs,15000);assert.equal(plan.httpRequests,600);assert.equal(plan.httpJsonResponseBytes,512*1024);assert.equal(plan.httpDocxBytes,25*1024*1024);assert.equal(plan.httpPdfBytes,100000000);assert.equal(plan.httpUploadBytes,8*1024*1024);
 for(const key of ['executionAllowed','nativeAdmission','cosAccepted','storageAccepted','browserAccepted','full394Accepted'])assert.equal(plan[key],false);
 assert.ok(Object.isFrozen(plan));
 assert.throws(()=>api.describeCurrent261LocalLifecycle({...s,profile:{...s.profile,ledger:s.profile.ledger.slice(0,259)}}));
});


test('local lifecycle scope selects only either exact official tool profile',()=>{
 const api=require('./task12-current261-local-lifecycle-scope.cjs'),s=source(),profile='TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2';
 const plan=api.describeCurrent261LocalLifecycle(s,profile);assert.equal(plan.runtimeProfile,profile);assert.equal(plan.resourceMs,3600000);assert.equal(plan.httpRequests,600);
 assert.throws(()=>api.describeCurrent261LocalLifecycle(s,'arbitrary-runtime'),/SCOPE/u);
});

test('fixed auth-only description preserves exact source/ACL and budgets but admits only one login diagnostic',()=>{
 const api=require('./task12-current261-local-lifecycle-scope.cjs'),s=source(),full=api.describeCurrent261LocalLifecycle(s),auth=api.describeCurrent261FirstLogin(s);
 assert.equal(auth.purpose,'CURRENT261_FIRST_LOGIN_AUTH_ONLY_DIAGNOSTIC');assert.equal(auth.executionPurpose,'AUTH_ONLY_DIAGNOSTIC');assert.equal(auth.httpRequests,1);assert.equal(auth.resourceMs,full.resourceMs);assert.equal(auth.httpMs,full.httpMs);assert.equal(auth.effectivePlanSha256,full.effectivePlanSha256);
 assert.ok(auth.stages.includes('firstActor0Login'));assert.ok(!auth.stages.includes('archiveIdempotency'));assert.equal(auth.full394Accepted,false);assert.equal(auth.nativeAdmission,false);
});

// Source-flow model: this description does not issue runtime admission.
test('equipment case scope binds a distinct case key while retaining original authority and budgets',()=>{
 const api=require('./task12-current261-local-lifecycle-scope.cjs'),s=source();
 const legacy=api.describeCurrent261LocalLifecycle(s);
 const selected=api.describeCurrent261LocalLifecycleCase(s,'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1','inside:equipment_rental');
 assert.equal(selected.caseKey,'inside:equipment_rental');assert.equal(selected.contractTypeKey,'equipment_rental');
 assert.equal(selected.relationship,'inside');assert.equal(selected.purpose,'CURRENT261_GENERATED_LIFECYCLE_LOCAL');
 for(const key of ['resourceMs','httpMs','httpRequests','httpPdfBytes','effectivePlanSha256','documentProfileSha256'])assert.equal(selected[key],legacy[key]);
 assert.equal(selected.nativeAdmission,false);assert.equal(selected.full394Accepted,false);
 assert.ok(selected.stages.includes('publicEquipmentTemplate'));assert.ok(!selected.stages.includes('publicMaterialTemplate'));
 assert.throws(()=>api.describeCurrent261LocalLifecycleCase(s,'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1','inside:unknown'),/CASE_UNKNOWN/u);
 assert.throws(()=>api.describeCurrent261LocalLifecycleCase(s,'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',new Proxy({},{get(){throw Error('TRAP');}})),/CASE_UNKNOWN/u);
 assert.equal(legacy.contractTypeKey,'material_purchase');assert.equal(Object.hasOwn(legacy,'caseKey'),false);
});
