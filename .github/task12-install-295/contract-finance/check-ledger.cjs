'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {ledgerSha256: textDirectLedgerSha256}=require('./text-direct-330-profile.cjs');
const [root,sha,mode]=process.argv.slice(2);
assert.ok(process.argv.length===4||(process.argv.length===5&&['--current-320','--text-direct-330','--payment-remainder-331','--upward-archive-332','--historical-takeover-333','--historical-settlement-334','--expense-witness-345','--expense-witness-346'].includes(mode)),
  'CONTRACT_FINANCE_HOSTED_LEDGER_MODE');
const textDirect=mode==='--text-direct-330';
const expenseWitness=mode==='--expense-witness-346' ? require('./expense-witness-346-profile.cjs')
  : mode==='--expense-witness-345' ? require('./expense-witness-345-profile.cjs') : null;
const historicalSettlement=mode==='--historical-settlement-334'||Boolean(expenseWitness);
const historicalTakeover=mode==='--historical-takeover-333'||historicalSettlement;
const historicalTakeoverProfile=require('./historical-takeover-333-profile.cjs');
const historicalSettlementProfile=require('./historical-settlement-334-profile.cjs');
const upwardArchive=mode==='--upward-archive-332'||historicalTakeover;
const paymentRemainder=mode==='--payment-remainder-331'||upwardArchive;
const current320=mode==='--current-320'||textDirect||paymentRemainder;
const paymentRemainderLedgerSha256='0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014';
const upwardArchiveLedgerSha256='b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4';
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
  assert.equal(ledger.length,expenseWitness?expenseWitness.count:historicalSettlement?334:historicalTakeover?333:upwardArchive?332:paymentRemainder?331:textDirect?330:329,'CONTRACT_FINANCE_CURRENT_320_LEDGER_COUNT');
  assert.equal(ledgerHash(ledger.slice(0,295)),predecessor295Sha256,'CONTRACT_FINANCE_CURRENT_320_PREDECESSOR');
  assert.equal(ledgerHash(ledger.slice(0,329)),'3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2',
    'CONTRACT_FINANCE_CURRENT_320_LEDGER_DIGEST');
  if(textDirect||paymentRemainder) assert.equal(ledgerHash(ledger.slice(0,330)),textDirectLedgerSha256,
    'CONTRACT_FINANCE_TEXT_DIRECT_330_LEDGER_DIGEST');
  if(paymentRemainder) assert.equal(ledgerHash(ledger.slice(0,331)),paymentRemainderLedgerSha256,
    'CONTRACT_FINANCE_PAYMENT_REMAINDER_331_LEDGER_DIGEST');
  if(upwardArchive) assert.equal(ledgerHash(ledger.slice(0,332)),upwardArchiveLedgerSha256,
    'CONTRACT_FINANCE_UPWARD_ARCHIVE_332_LEDGER_DIGEST');
  if(historicalTakeover) assert.equal(ledgerHash(ledger.slice(0,333)),historicalTakeoverProfile.ledgerSha256,
    'CONTRACT_FINANCE_HISTORICAL_TAKEOVER_333_LEDGER_DIGEST');
  if(historicalSettlement) assert.equal(ledgerHash(ledger.slice(0,334)),historicalSettlementProfile.ledgerSha256,
    'CONTRACT_FINANCE_HISTORICAL_SETTLEMENT_334_LEDGER_DIGEST');
  if(expenseWitness) for(let size=335;size<=expenseWitness.count;size++) expenseWitness.assertPrefix(size,ledgerHash(ledger.slice(0,size)));
} else {
  assert.ok(ledger.length===294||ledger.length===295,'CONTRACT_FINANCE_HOSTED_LEDGER_COUNT');
}
assert.equal(ledgerHash(ledger.slice(0,292)),'739451e0ff81740db53707acc013709436a746a2b019f99059c6375a5039a775');
assert.equal(ledgerHash(ledger.slice(0,294)),'1b66e6c98907b9c06d64ad2294e203a877157fcb0ca463b4989657ea1d86396d');
if(ledger.length===295) {
  assert.equal(digest,predecessor295Sha256);
}
const {migrationBaseline}=JSON.parse(blob('services/api/prisma/database-dynamic-gate-manifest.json'));
const admittedCount=migrationBaseline.expectedDirectoryCount;
assert.ok(admittedCount===ledger.length || (expenseWitness?.count===346 && admittedCount===334),
  'CONTRACT_FINANCE_RELEASE_SCOPE');
const terminal=ledger[admittedCount-1];
assert.equal(migrationBaseline.terminalMigration,terminal.name);
assert.equal(migrationBaseline.terminalMigrationChecksum,terminal.sha256);
if (current320) {
  console.log(JSON.stringify({
    mode:mode.slice(2),sourceSha:sha,sourceTree:git('rev-parse',sha+'^{tree}').toString().trim(),
    migrationCount:ledger.length,ledgerSha256:digest,
    predecessor:{migrationCount:295,ledgerSha256:predecessor295Sha256,tails:ledger.slice(292,295)},
    ...(paymentRemainder?{predecessor330:{migrationCount:330,ledgerSha256:textDirectLedgerSha256}}:{}),
    ...(upwardArchive?{predecessor331:{migrationCount:331,ledgerSha256:paymentRemainderLedgerSha256}}:{}),
    ...(historicalTakeover?{predecessor332:{migrationCount:332,ledgerSha256:upwardArchiveLedgerSha256}}:{}),
    ...(historicalSettlement?{predecessor333:{migrationCount:333,ledgerSha256:historicalTakeoverProfile.ledgerSha256}}:{}),
    ...(expenseWitness?{predecessor334:{migrationCount:334,ledgerSha256:historicalSettlementProfile.ledgerSha256}}:{}),
    tails:ledger.slice(295)
  }));
} else {
  console.log(JSON.stringify({sourceSha:sha,migrationCount:ledger.length,ledgerSha256:digest,tails:ledger.slice(292)}));
}
