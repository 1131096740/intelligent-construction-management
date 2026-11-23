'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path');
const [root,sha,mode]=process.argv.slice(2);
assert.ok(process.argv.length===4||(process.argv.length===5&&mode==='--current-320'),
  'CONTRACT_FINANCE_HOSTED_LEDGER_MODE');
const current320=mode==='--current-320';
assert.match(sha,/^[a-f0-9]{40}$/u);
const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:16*1024*1024});
assert.equal(git('rev-parse','HEAD').toString().trim(),sha);
const migrationsPath='services/api/prisma/migrations';
const blob=name=>git('show',sha+':'+name);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ledgerHash=rows=>hash(JSON.stringify(rows));
const ledger=git('ls-tree','-r','--name-only','-z',sha,'--',migrationsPath).toString().split('\0')
  .filter(file=>file.endsWith('/migration.sql'))
  .map(file=>({name:path.basename(path.dirname(file)),sha256:hash(blob(file)),finished:true,rolledBack:false}));
const digest=ledgerHash(ledger);
const predecessor295Sha256='b0d398a46c4c6a3209e1448ddd415938ea95425c3d823f1f8a77d81dde396f2d';
if(current320) {
  assert.equal(ledger.length,323,'CONTRACT_FINANCE_CURRENT_320_LEDGER_COUNT');
  assert.equal(ledgerHash(ledger.slice(0,295)),predecessor295Sha256,'CONTRACT_FINANCE_CURRENT_320_PREDECESSOR');
  assert.equal(digest,'5623f6ae565471f54b3d1dfd965c4beafc560b8f2bfb97765c4a8699ee9f99ec',
    'CONTRACT_FINANCE_CURRENT_320_LEDGER_DIGEST');
} else {
  assert.ok(ledger.length===294||ledger.length===295,'CONTRACT_FINANCE_HOSTED_LEDGER_COUNT');
}
assert.equal(ledgerHash(ledger.slice(0,292)),'739451e0ff81740db53707acc013709436a746a2b019f99059c6375a5039a775');
assert.equal(ledgerHash(ledger.slice(0,294)),'1b66e6c98907b9c06d64ad2294e203a877157fcb0ca463b4989657ea1d86396d');
if(ledger.length===295) {
  assert.equal(digest,predecessor295Sha256);
}
const {migrationBaseline}=JSON.parse(blob('services/api/prisma/database-dynamic-gate-manifest.json'));
const terminal=ledger.at(-1);
assert.equal(migrationBaseline.expectedDirectoryCount,ledger.length);
assert.equal(migrationBaseline.terminalMigration,terminal.name);
assert.equal(migrationBaseline.terminalMigrationChecksum,terminal.sha256);
if (current320) {
  console.log(JSON.stringify({
    mode:'current-320',sourceSha:sha,sourceTree:git('rev-parse',sha+'^{tree}').toString().trim(),
    migrationCount:323,ledgerSha256:digest,
    predecessor:{migrationCount:295,ledgerSha256:predecessor295Sha256,tails:ledger.slice(292,295)},
    tails:ledger.slice(295)
  }));
} else {
  console.log(JSON.stringify({sourceSha:sha,migrationCount:ledger.length,ledgerSha256:digest,tails:ledger.slice(292)}));
}
