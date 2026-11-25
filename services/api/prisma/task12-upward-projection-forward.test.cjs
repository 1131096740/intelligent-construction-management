'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('application pins the repaired projection and admission bodies',()=>{
 const pins=fs.readFileSync(path.join(__dirname,'../src/contract/contract-upward-direct-source-pins.ts'),'utf8');
 assert.match(pins,/UPWARD_PROJECTION_SOURCE_SHA256 = "ab4df8e090da9da9c3750787fc262145d74554b04ea8e60dbaa98000d10be38b"/u);
 assert.match(pins,/UPWARD_ARCHIVE_ADMISSION_SHA256 = "c95e8553897ff36853c9503fee242087c23a28479e02b3225f5fc24bfc3259c2"/u);
});

test('signed-change verifier pin migration advances both readers and keeps the bound source and ACL',()=>{
 const pins=fs.readFileSync(path.join(__dirname,'../src/contract/contract-upward-direct-source-pins.ts'),'utf8');
 const migration=fs.readFileSync(path.join(__dirname,'migrations/20261129001000_contract_upward_archive_verifier_pin_forward/migration.sql'),'utf8');
 const projection=pins.match(/UPWARD_SIGNED_CHANGE_FILE_PROJECTION_SHA256 = "([0-9a-f]{64})"/u)?.[1];
 const admission=pins.match(/UPWARD_SIGNED_CHANGE_FILE_ADMISSION_SHA256 = "([0-9a-f]{64})"/u)?.[1];
 assert.match(migration,new RegExp("'public.jg_upward_archive_catalog_projection_v2\\(\\)',true,\\s*'[^']+',\\s*'"+projection+"'",'u'));
 assert.match(migration,new RegExp("'public.jg_upward_direct_archive_admission_v1\\(\\)',false,\\s*'[^']+',\\s*'"+admission+"'",'u'));
 assert.match(migration,/to_jsonb\(p\)-'prosrc'=actual\.metadata/u);
 assert.match(migration,/jg_require_contract_direct_upward_source_v2\(\) IS DISTINCT FROM closure_sha/u);
 const [readerMigration, outsideMigration] = migration.split('$forward$;');
 assert.doesNotMatch(readerMigration,/\b(?:GRANT|REVOKE|ALTER ROLE)\b/u);
 const references = [...outsideMigration.matchAll(/\('([^']+)','([^']+)'\)/gu)].map(match => match.slice(1));
 assert.deepEqual(references,[
   ['ContractSignedChange','appendixFormalFileId'],
   ['SignedContractSettlementAttachment','fileId']
 ]);
 assert.deepEqual(outsideMigration.match(/\b(?:GRANT|REVOKE|ALTER ROLE)\b/gu),['GRANT']);
 assert.match(outsideMigration,/GRANT SELECT \(%I\) ON public\.%I TO %I',target\.column_name,target\.relation_name,executor_name/u);
 assert.match(outsideMigration,/r\.rolcanlogin=\(r\.oid=ANY\(login_ids\)\)/u);
 assert.match(outsideMigration,/has_table_privilege\(binding\."executorOwnerOid",relation_oid,'SELECT'\)/u);
 assert.match(outsideMigration,/UNION ALL SELECT anchor_oid,binding\."executorOwnerOid",'SELECT'::text,false/u);
});

test('the hosted catalog witness checks the repaired readers after 332 and the original readers after 331', () => {
  const {outsideWitnessSql}=require('../../../.github/task12-install-295/contract-finance/common/installer.cjs');
  const before=outsideWitnessSql(289,true);
  const after=outsideWitnessSql(289,true,true);
  assert.match(before,/jg_upward_archive_catalog_projection_v2\(\)'\)::oid, '5fc49d0c0d0982b14dad70f9498c003dcffb4dfa9d1b7ae58155a93069f220b3'/u);
  assert.match(before,/jg_upward_direct_archive_admission_v1\(\)'\)::oid, '0ae95bf1a1b3551b5a123869077432a74578cb5c49ca63e7a4be4320eecef462'/u);
  assert.match(after,/jg_upward_archive_catalog_projection_v2\(\)'\)::oid, '486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7'/u);
  assert.match(after,/jg_upward_direct_archive_admission_v1\(\)'\)::oid, '0a647f271a6ff2ec4bdf776c7a4950b26c4885babe980e08dec0182b2c1bae30'/u);
  assert.match(after,/jg_require_contract_direct_upward_source_v2\(\)'\)::oid, 'c86b37cc155cb5cf424dd682f9767363da264eed8630a0dee9f02acde0dc3f49'/u);
});
