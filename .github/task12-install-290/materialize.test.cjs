'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {materializeFiles,verifyIndex}=require('./materialize.cjs');
const profile=require('./profile.json');

test('materializes the exact 290 input as the original 289 archive plus one successor', {skip:!process.env.EXACT_290_TEST_REPOSITORY}, t => {
  const root=process.env.EXACT_290_TEST_REPOSITORY;
  const input=fs.readFileSync(process.env.EXACT_290_TEST_INDEX);
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'jg290-test-'));
  t.after(()=>fs.rmSync(target,{recursive:true,force:true}));
  const report=materializeFiles(root,target,input);
  assert.deepEqual(report,{mode:profile.mode,tree:profile.tree,files:292,expectedLedgerSha256:profile.expectedLedgerSha256});
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(target,'successor.sql'))).digest('hex'),profile.terminal.sha256);
  const earlier=path.join(target,'predecessor','checkout-source.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(earlier,'utf8')),profile.predecessorAttestation);
  assert.equal(fs.existsSync(path.join(target,'predecessor/services/api/prisma/migrations',profile.terminal.name)),false);
  assert.throws(()=>verifyIndex(Buffer.concat([input,Buffer.from('100644 '+'0'.repeat(40)+' 0\tforeign-path\0')])),/EXACT_290_INDEX/);
  const corrupted=Buffer.from(input);
  corrupted[8]=corrupted[8]===48?49:48;
  assert.throws(()=>verifyIndex(corrupted),/EXACT_290_INDEX/);
});
