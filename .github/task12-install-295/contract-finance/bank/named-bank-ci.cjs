'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness}=require('./installer.cjs');
const tree=require('./tree-proof.json');
const titles=require('./original-titles.json');
const prefix='/qualification';
const workspace=path.join(prefix,'workspace');
const sha=value=>createHash('sha256').update(value).digest('hex');
const file='src/database/project-affiliate-company-contract-db.spec.ts';
const receipt={status:'STOPPED',scope:'NAMED_BANK_ORIGINAL_FULL_12',backupRestore:'NOT_EXECUTED',business:'NOT_ENTERED',stages:[]};
function verifyExecutionFiles() {
  const raw=fs.readFileSync(path.join(prefix,'execution-files.json'));
  assert.equal(sha(raw),'b317116eb809b23c8d6d27f094d0b4e9eeba433469aa98c424b8b406010dd6a5','BANK_295_EXECUTION_MANIFEST');
  const files=JSON.parse(raw);
  assert.equal(files.length,1814,'BANK_295_EXECUTION_COUNT');
  for(const [relative,digest] of files) {
    assert.ok(!path.isAbsolute(relative)&&!relative.split('/').includes('..'),'BANK_295_EXECUTION_PATH');
    assert.equal(sha(fs.readFileSync(path.join(workspace,relative))),digest,'BANK_295_EXECUTION_BYTES');
  }
  const combined=admitSource(prefix,path.join(prefix,'source/services/api/prisma'),path.join(prefix,'source-seal.txt'));
  assert.equal(combined.finalCount,292);
  require('./terminal.cjs').verify(prefix+'/terminal.sql');
  require('./payout-terminal.cjs').verify();
  require('./multi-witness.cjs').verify();
  receipt.inputMigrationSha256=require('./multi-witness.cjs').digest;
  receipt.input={executionFiles:files.length,...combined};
}
function verifyJestRegisteredWithoutDb() {
  const run=spawnSync('pnpm',['--filter','@jiangkong/api','exec','jest','--runInBand','--runTestsByPath',file,'--json'],{
    cwd:workspace,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',LANG:'C',LC_ALL:'C',NODE_ENV:'test',CI:'true',
      COREPACK_HOME:'/opt/corepack',COREPACK_ENABLE_NETWORK:'0',COREPACK_DEFAULT_TO_LATEST:'0',
      SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false'},
  });
  assert.equal(run.status,0,'BANK_295_PREFLIGHT_JEST');
  const report=JSON.parse(run.stdout);
  const suites=report.testResults;
  assert.equal(suites.length,1);
  const cases=suites[0].assertionResults;
  assert.equal(titles.length,12);
  assert.ok(titles.every(title=>cases.filter(row=>row.title===title).length===1),'BANK_295_ORIGINAL_TITLES');
  assert.equal(report.numPassedTests,1);
  assert.equal(report.numPendingTests,11);
  receipt.preflight={originalRegistered:12,realDatabaseCasesNotEntered:11};
}
Promise.resolve().then(async()=>{
  receipt.candidateSha=require('./hosted-source.json').sourceSha;
  verifyExecutionFiles();
  if(process.argv.length===3&&process.argv[2]==='--preflight'){
    verifyJestRegisteredWithoutDb();
    receipt.status='BANK_295_DIAGNOSTIC_NO_DATABASE_PREFLIGHT_PASSED';
    return;
  }
  assert.equal(process.argv.length,2);
  const {verifyNamedBank}=require('./workspace/services/api/prisma/contract-finance-owned-ci.cjs');
  await withCombined295MultiWitness(receipt,async context=>verifyNamedBank(context,receipt,titles));
  assert.equal(receipt.releaseTree,tree.tree);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,require('./multi-witness.cjs').final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.equal(receipt.namedBank.original.passed,12);
  assert.equal(receipt.namedBank.scopedAliasReleased,true);
  assert.equal(receipt.namedBank.rolesReleased,true);
  receipt.status='BANK_295_ORIGINAL_FULL_12_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'BANK_295_UNCLASSIFIED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,failedTest:error.failedTest,denied:error.denied,migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
