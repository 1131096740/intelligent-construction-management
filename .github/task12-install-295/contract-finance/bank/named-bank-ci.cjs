'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness,withCombinedExpenseWitness349}=require('./installer.cjs');
const tree=require('./tree-proof.json');
const titles=require('./original-titles.json');
const prefix='/qualification';
const workspace=path.join(prefix,'workspace');
const sha=value=>createHash('sha256').update(value).digest('hex');
const file='src/database/project-affiliate-company-contract-db.spec.ts';
const args=process.argv.slice(2);
const current320=args[0]==='--current-320';
const textDirect330=args[0]==='--text-direct-330';
const upwardArchive332=args[0]==='--upward-archive-332';
const paymentRemainder331=args[0]==='--payment-remainder-331';
const historicalSettlement334=args[0]==='--historical-settlement-334';
const precision=args[0]==='--expense-witness-349'?require('./expense-witness-349-profile.cjs'):undefined;
const expenseWitness346=Boolean(precision)||args[0]==='--expense-witness-346';
const historical=historicalSettlement334||expenseWitness346?require('./historical-settlement-334-profile.cjs'):undefined;
const expense=expenseWitness346?require('./expense-witness-346-profile.cjs'):undefined;
const forward=current320||textDirect330||paymentRemainder331||upwardArchive332||historicalSettlement334||expenseWitness346;
const count=precision?precision.count:expenseWitness346?346:historicalSettlement334?334:upwardArchive332?332:paymentRemainder331?331:textDirect330?330:current320?329:295;
const runArgs=forward?args.slice(1):args;
const profile=upwardArchive332?require('./upward-archive-332-profile.cjs'):
  paymentRemainder331?require('./payment-remainder-331-profile.cjs'):
  textDirect330?require('./text-direct-330-profile.cjs'):undefined;
const candidateDigest320='3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
const receipt={status:'STOPPED',scope:'NAMED_BANK_ORIGINAL_FULL_12',backupRestore:'NOT_EXECUTED',business:'NOT_ENTERED',stages:[]};
function verifyExecutionFiles(source) {
  const raw=fs.readFileSync(path.join(prefix,'execution-files.json'));
  if(profile||historical) {
    const expected=require('./bank-staging-'+count+'.json')['bank/execution-files.json'].sha256;
    assert.equal(sha(raw),expected,'BANK_'+count+'_EXECUTION_MANIFEST');
    const witness=path.join(workspace,'services/api/src/database/contract-finance-owned.test-support.ts');
    assert.ok(fs.readFileSync(witness,'utf8').includes(JSON.stringify(source.ledgerSha256)),'BANK_'+count+'_TEST_LEDGER');
  } else assert.equal(sha(raw),current320?'bcd29f1064b9c63b30566a7d3902c40e923bb68c4aab2bd80b703dea7e6aaff7':'ae305b0e93201322da07825b47100c588c056a5a98e0a6ddccec8c62f62ce041','BANK_295_EXECUTION_MANIFEST');
  const files=JSON.parse(raw);
  assert.equal(files.length,forward?1946:1814,'BANK_295_EXECUTION_COUNT');
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
  if(expense) {
    assert.deepEqual(cases.map(row=>row.title),titles,'BANK_346_ORIGINAL_TITLE_ORDER');
    assert.equal(cases.find(row=>row.status==='passed')?.title,titles[0]);
    assert.equal(report.numFailedTests,0);
  }
  receipt.preflight={originalRegistered:12,realDatabaseCasesNotEntered:11};
}
Promise.resolve().then(async()=>{
  const source=require('./hosted-source.json');
  receipt.candidateSha=source.sourceSha;
  assert.ok(runArgs.length===0||(runArgs.length===1&&runArgs[0]==='--preflight'),'BANK_RUN_MODE');
  if(expense) {
    assert.match(process.env.JG_BANK_SOURCE_SHA??'',/^[a-f0-9]{40}$/u,'BANK_346_SOURCE_SHA');
    assert.equal(source.sourceSha,process.env.JG_BANK_SOURCE_SHA,'BANK_346_SOURCE_SHA');
    assert.match(source.sourceTree,/^[a-f0-9]{40}$/u,'BANK_346_SOURCE_TREE');
    assert.equal(process.env.DATABASE_URL,undefined,'BANK_346_EXTERNAL_DATABASE');
    const activeProfile=precision??expense;
    activeProfile.assertSource(source,require('./multi-witness.cjs').final);
    require('./migration-inputs-346.cjs')(path.join(workspace,'services/api'),source,activeProfile);
    assert.equal(sha(fs.readFileSync(path.join(prefix,'installer.cjs'))),activeProfile.installerSha256,'BANK_'+count+'_INSTALLER_SHA');
  } else if(historical) {
    historical.assertSource(source,require('./multi-witness.cjs').final);
  } else if(profile) {
    profile.assertSource(source,source.sourceSha,require('./multi-witness.cjs').final);
  } else if(current320) {
    assert.equal(source.mode,'current-320');
    assert.equal(source.migrationCount,329);
    assert.equal(source.ledgerSha256,candidateDigest320);
    assert.match(source.sourceTree,/^[0-9a-f]{40}$/u);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,require('./multi-witness.cjs').final);
    assert.equal(source.tails.length,34);
  } else {
    assert.equal(source.migrationCount,295);
    assert.equal(source.ledgerSha256,require('./multi-witness.cjs').final);
  }
  verifyExecutionFiles(source);
  if(runArgs.length){
    verifyJestRegisteredWithoutDb();
    receipt.status='BANK_'+count+'_DIAGNOSTIC_NO_DATABASE_PREFLIGHT_PASSED';
    return;
  }
  const {verifyNamedBank}=require('./workspace/services/api/prisma/contract-finance-owned-ci.cjs');
  const consume=async context=>{
    if(expense) {
      historical.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
      assert.deepEqual(receipt.expenseWitnessForward,{
        count:expense.count,ledgerSha256:expense.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(39,expense.count-295).map(({name,sha256})=>({name,sha256}))
      },'BANK_346_FORWARD_LEDGER');
      if(precision) assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
        count,ledgerSha256:precision.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(expense.count-295).map(({name,sha256})=>({name,sha256}))
      },'BANK_349_FORWARD_LEDGER');
    } else if(historical) {
      historical.assertFinanceInstallation(receipt,source);
    } else if(profile) {
      profile.assertInstallation(receipt,source);
    } else if(current320) {
      assert.equal(receipt.forward320?.count,329);
      assert.equal(receipt.forward320.ledgerSha256,candidateDigest320);
      assert.equal(receipt.forward320.sameBaseB7,true);
      assert.equal(receipt.forward320.sourceTree,source.sourceTree);
      assert.deepEqual(receipt.forward320.tails,source.tails.map(({name,sha256})=>({name,sha256})));
    }
    return verifyNamedBank(context,receipt,titles,forward?{sourceTree:source.sourceTree,count}:undefined);
  };
  if(precision) {
    await withCombinedExpenseWitness349(receipt,consume,{
      ...source,migrations:path.join(workspace,'services/api/prisma/migrations')
    });
  } else if(expense) {
    await withCombinedExpenseWitness(receipt,consume,{
      sourceTree:source.sourceTree,migrations:path.join(workspace,'services/api/prisma/migrations'),tails:source.tails
    },count);
  } else if(forward) {
    const install=historicalSettlement334?withCombined334HistoricalSettlement:upwardArchive332?withCombined332UpwardArchive:paymentRemainder331?withCombined331PaymentRemainder:
      textDirect330?withCombined330TextAgreement:withCombined320ContractPayment;
    await install(receipt,consume,{
      sourceTree:source.sourceTree,migrations:path.join(workspace,'services/api/prisma/migrations'),tails:source.tails
    });
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.releaseTree,tree.tree);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  if(forward) assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  if(profile||historical) {
    assert.equal(receipt.combinedAfterBusiness.count,count);
    assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
    assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  }
  if(historical) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
  }
  if(expense) assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
  if(precision) assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.equal(receipt.namedBank.original.passed,12);
  assert.equal(receipt.namedBank.scopedAliasReleased,true);
  assert.equal(receipt.namedBank.rolesReleased,true);
  receipt.status='BANK_'+count+'_ORIGINAL_FULL_12_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'BANK_295_UNCLASSIFIED',
    exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode,failedTest:error.failedTest,denied:error.denied,migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
