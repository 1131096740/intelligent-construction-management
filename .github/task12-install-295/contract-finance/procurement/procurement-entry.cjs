'use strict';
const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const source=require('./contract-finance-source.json');
const multi=require('./multi-witness.cjs');
try {
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  const current320=process.argv[2]==='--current-320';
  const textDirect330=process.argv[2]==='--text-direct-330';
  const paymentRemainder331=process.argv[2]==='--payment-remainder-331';
  const upwardArchive332=process.argv[2]==='--upward-archive-332';
  const historicalSettlement334=process.argv[2]==='--historical-settlement-334';
  const expenseWitness349=process.argv[2]==='--expense-witness-349';
  const expenseWitness346=process.argv[2]==='--expense-witness-346';
  const expenseProfile=expenseWitness349?require('./expense-witness-349-profile.cjs'):
    expenseWitness346?require('./expense-witness-346-profile.cjs'):undefined;
  const forward=current320||textDirect330||paymentRemainder331||upwardArchive332||historicalSettlement334||expenseWitness346||expenseWitness349;
  assert.equal(process.argv.length,forward?3:2);
  const count=expenseWitness349?349:expenseWitness346?346:historicalSettlement334?334:upwardArchive332?332:paymentRemainder331?331:textDirect330?330:current320?329:295;
  assert.equal(source.migrationCount,count);
  if(expenseProfile) {
    expenseProfile.assertSource(source,multi.final);
  } else if(historicalSettlement334) {
    require('./historical-settlement-334-profile.cjs').assertSource(source,multi.final);
  } else if(upwardArchive332) {
    require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,multi.final);
  } else if(paymentRemainder331) {
    require('./payment-remainder-331-profile.cjs').assertSource(source,source.sourceSha,multi.final);
  } else if(textDirect330) {
    require('./text-direct-330-profile.cjs').assertSource(source,source.sourceSha,multi.final);
  } else if(current320) {
    assert.equal(source.mode,'current-320');
    assert.match(source.sourceTree,/^[a-f0-9]{40}$/u);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,multi.final);
    assert.equal(source.tails.length,34);
  }
  if(!forward) assert.equal(source.ledgerSha256,multi.final);
  const baselineModule=require('./workspace/services/api/prisma/migration-baseline.cjs');
  if(expenseProfile) {
    expenseProfile.assertRuntimeBaseline(baselineModule);
  } else {
    const baseline=baselineModule.loadCanonicalMigrationBaseline();
    assert.equal(baseline.expectedDirectoryCount,count);
    assert.equal(baseline.terminalMigrationChecksum,forward?source.tails.at(-1).sha256:multi.digest);
    if(forward) assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
  }
  admitSource('/qualification','/qualification/source/services/api/prisma','/qualification/source-seal.txt');
  require('./consumer.cjs');
} catch(error) {
  const code=error.code??error.message;
  console.log(JSON.stringify({status:'STOPPED',sourceSha:source.sourceSha,failure:{
    stage:'PROCUREMENT_295_INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'PROCUREMENT_295_INPUT_FAILED'}}));
  process.exitCode=1;
}
