'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {qualifyCurrent259Source,isExactCurrentPaymentProfile,PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');
const root=path.join(__dirname,'migrations');
const migrations=fs.readdirSync(root).sort().filter(n=>/^\d{14}_[a-z0-9_]+$/.test(n)&&fs.existsSync(path.join(root,n,'migration.sql'))).map(n=>({path:`services/api/prisma/migrations/${n}/migration.sql`,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n,'migration.sql'))).digest('hex')}));
const source={candidateSha:'a'.repeat(40),sealSha256:'b'.repeat(64),schemaSha256:'60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4',migrations};
test('262 has its own exact source identity while 261 and payment remain separate',()=>{
 const v262=qualifyCurrent259Source(source),v261=qualifyCurrent259Source({...source,migrations:migrations.slice(0,261)});
 assert.equal(v262.profile,'TASK12_ARCHIVE262_SOURCE_V1');assert.equal(v261.profile,'TASK12_ARCHIVE261_SOURCE_V1');
 assert.equal(isExactCurrentPaymentProfile(v262,PAYMENT261_RUNTIME_PROFILE),false);
 assert.equal(isExactCurrentPaymentProfile(v261,PAYMENT261_RUNTIME_PROFILE),true);
 const changed=migrations.map(x=>({...x}));changed[261].sha256='0'.repeat(64);
 assert.throws(()=>qualifyCurrent259Source({...source,migrations:changed}));
 assert.throws(()=>qualifyCurrent259Source({...source,migrations:migrations.slice(0,260)}));
});
test('262 source is accepted by archive catalog without accepting payment mode',()=>{
 const catalog=require('./task16-current259-catalog.cjs');
 const result=catalog.loadCurrent259CatalogMaterial(source);
 assert.equal(result.ledgerSha256,qualifyCurrent259Source(source).ledgerSha256);
 assert.throws(()=>catalog.loadCurrent259CatalogMaterial(source,PAYMENT261_RUNTIME_PROFILE));
});
test('lifecycle qualification binds the 262 profile and rejects mixed 261 identities',()=>{
 const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
 const profile=qualifyCurrent259Source(source),input={candidateSha:source.candidateSha,tree:'c'.repeat(40),sourceSealSha256:source.sealSha256,profile};
 assert.equal(qualifyCurrent261GeneratedLifecycleSource(input).profile.profile,'TASK12_ARCHIVE262_SOURCE_V1');
 assert.throws(()=>qualifyCurrent261GeneratedLifecycleSource({...input,profile:{...profile,profile:'TASK12_ARCHIVE261_SOURCE_V1'}}));
});
