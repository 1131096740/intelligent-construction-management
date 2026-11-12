'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
function source(){
 const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>fs.existsSync(path.join(__dirname,'migrations',n,'migration.sql'))).sort().map(n=>({path:'services/api/prisma/migrations/'+n+'/migration.sql',sha256:hash(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
 return {candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:qualifyCurrent259Source({candidateSha:'a'.repeat(40),sealSha256:'c'.repeat(64),schemaSha256:hash(fs.readFileSync(path.join(__dirname,'schema.prisma'))),migrations})};
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
