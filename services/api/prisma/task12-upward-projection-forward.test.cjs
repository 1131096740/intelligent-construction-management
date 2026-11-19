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
