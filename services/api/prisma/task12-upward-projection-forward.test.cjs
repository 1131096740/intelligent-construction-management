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
 assert.doesNotMatch(migration,/\b(?:GRANT|REVOKE|ALTER ROLE)\b/u);
});
