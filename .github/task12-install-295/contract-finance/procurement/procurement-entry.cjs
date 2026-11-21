'use strict';
const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const source=require('./contract-finance-source.json');
const multi=require('./multi-witness.cjs');
try {
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,295);
  assert.equal(source.ledgerSha256,multi.final);
  const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
  assert.equal(baseline.expectedDirectoryCount,295);
  assert.equal(baseline.terminalMigrationChecksum,multi.digest);
  admitSource('/qualification','/qualification/source/services/api/prisma','/qualification/source-seal.txt');
  require('./consumer.cjs');
} catch(error) {
  const code=error.code??error.message;
  console.log(JSON.stringify({status:'STOPPED',sourceSha:source.sourceSha,failure:{
    stage:'PROCUREMENT_295_INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'PROCUREMENT_295_INPUT_FAILED'}}));
  process.exitCode=1;
}
