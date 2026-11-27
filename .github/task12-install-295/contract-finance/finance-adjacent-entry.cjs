'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive,withCombined334HistoricalSettlement,withCombinedExpenseWitness,withCombinedExpenseWitness349,withCombinedSignedSettlement350,withCombinedCompanyHistory352}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const plan=require('./finance-adjacent-profiles.json');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {isDeepStrictEqual}=require('node:util');
const source=require('./contract-finance-source.json');
const root='/qualification';
const lane=process.argv[2];
const mode=process.argv[3];
const company=mode==='--company-history-352';
const signed=company||mode==='--signed-settlement-350';
const precision=signed||mode==='--expense-witness-349';
const expenseWitness=precision||mode==='--expense-witness-346';
const historicalSettlement=mode==='--historical-settlement-334';
const upwardArchive=mode==='--upward-archive-332';
const paymentRemainder=mode==='--payment-remainder-331';
const textDirect=mode==='--text-direct-330';
const current320=expenseWitness||historicalSettlement||upwardArchive||paymentRemainder||textDirect||mode==='--current-320';
const count=company?352:signed?350:precision?349:expenseWitness?346:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const receipt={schemaVersion:1,purpose:'ORIGINAL_FINANCE_ADJACENT_EXACT_'+count,lane,sourceSha:source.sourceSha,
  migrationSha256:current320?source.tails.at(-1).sha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,current320?4:3);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  const expense346=expenseWitness?require('./expense-witness-346-profile.cjs'):undefined;
  const expenseProfile=company?require('./company-history-352-profile.cjs'):signed?require('./signed-settlement-350-profile.cjs')
    :precision?require('./expense-witness-349-profile.cjs'):expense346;
  const historicalProfile=(historicalSettlement||expenseWitness)?require('./historical-settlement-334-profile.cjs'):undefined;
  const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  if(expenseProfile){
    expenseProfile.assertSource(source,final);
    assert.equal(hash(root+'/installer.cjs'),expenseProfile.installerSha256);
  } else if(historicalProfile){
    historicalProfile.assertSource(source,final);
    assert.equal(hash(root+'/installer.cjs'),historicalProfile.installerSha256);
  } else if(upwardArchive){
    require('./upward-archive-332-profile.cjs').assertSource(source,source.sourceSha,final);
  } else if(current320){
    assert.equal(source.mode,mode.slice(2));
    assert.match(source.sourceTree,/^[a-f0-9]{40}$/u);
    assert.equal(source.predecessor.migrationCount,295);
    assert.equal(source.predecessor.ledgerSha256,final);
    assert.equal(source.tails.length,count-295);
  } else {
    assert.equal(source.ledgerSha256,final);
    assert.equal(source.tails.at(-1).sha256,digest);
  }
  assert.ok(Object.hasOwn(plan,lane));
  const profile=plan[lane];
  assert.equal(hash(root+'/'+profile.runner),profile.runnerSha256);
  assert.equal(hash(root+'/workspace/services/api/'+profile.suite),profile.suiteSha256);
  if(current320 && profile.legacySeed) {
    const {revision,files}=profile.legacySeed;
    for(const {fixture,sha256} of Object.values(files)) {
      assert.equal(hash(root+'/workspace/services/api/src/fund-execution/'+fixture),sha256,'V7_PRE_CUTOVER_SOURCE');
    }
    receipt.preCutoverSetup={sourceSha:revision,files:Object.keys(files).length};
  }
  const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs');
  if(expenseProfile) expenseProfile.assertRuntimeBaseline(baseline);
  else {
    const canonical=baseline.loadCanonicalMigrationBaseline();
    assert.equal(canonical.expectedDirectoryCount,count);
    assert.equal(canonical.terminalMigrationChecksum,receipt.migrationSha256);
    if(current320) assert.equal(canonical.terminalMigration,source.tails.at(-1).name);
  }
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const need=(ok,code)=>assert.ok(ok,code);
  const consume=async context=>{
    if(current320) assert.equal(context.candidateTree,source.sourceTree);
    if(expenseProfile){
      historicalProfile.assertFinanceInstallation(receipt,{...source,tails:source.tails.slice(0,39)});
      assert.deepEqual(receipt.expenseWitnessForward,{
        count:expense346.count,ledgerSha256:expense346.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
        tails:source.tails.slice(39,expense346.count-295).map(({name,sha256})=>({name,sha256}))
      });
      if(precision) {
        const checkpoint=signed?source.predecessor349:source;
        const end=checkpoint.migrationCount-295;
        assert.deepEqual(receipt.expenseWitnessPrecisionForward,{
          count:checkpoint.migrationCount,ledgerSha256:checkpoint.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
          tails:source.tails.slice(expense346.count-295,end).map(({name,sha256})=>({name,sha256}))
        });
        if(signed) {
          const signedProfile=company?require('./signed-settlement-350-profile.cjs'):expenseProfile;
          assert.deepEqual(receipt.signedSettlementForward,{
            count:350,ledgerSha256:signedProfile.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
            tails:source.tails.slice(end,350-295).map(({name,sha256})=>({name,sha256}))
          });
          if(company) assert.deepEqual(receipt.companyHistoryForward,{
            count:352,ledgerSha256:expenseProfile.ledgerSha256,sameIdentity:true,sourceTree:source.sourceTree,
            tails:source.tails.slice(350-295).map(({name,sha256})=>({name,sha256}))
          });
        }
      }
    }
    function runCommand(file,args,{cwd,timeoutMs,allowFailure,extra}){
      const result=spawnSync(file,args,{cwd,encoding:'utf8',timeout:timeoutMs,maxBuffer:16*1024*1024,
        env:{PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin',LANG:'C',LC_ALL:'C',TZ:'UTC',
          HOME:context.workDir,TMPDIR:context.workDir,...extra}});
      if(result.status!==0&&!allowFailure) {
        const stderr=result.stderr??'';
        const seedLocation=/\b(seed\.cjs|seed-auth-runtime\.js|seed-layout-preview\.cjs):(\d{1,5}):\d{1,5}/u.exec(stderr);
        const seedKind=['PrismaClientKnownRequestError','PrismaClientUnknownRequestError',
          'PrismaClientInitializationError','MODULE_NOT_FOUND','EACCES','ENOSPC','Seed project cash is insufficient',
          'Seed project funds mismatch','SQLITE_BUSY'].find(value=>stderr.includes(value));
        throw Object.assign(new Error('FINANCE_ADJACENT_COMMAND_FAILED'),{
          exit:result.status,prismaCode:/\bP[0-9]{4}\b/u.exec(stderr)?.[0],
          sqlstate:/(?:Database error code:\s*|ERROR:\s+)([0-9A-Z]{5})(?=[:\s]|$)/u.exec(stderr)?.[1],
          ...(receipt.stages.at(-1)==='FRESH_OWNER_SEED' && { seedDiagnostic: {
            ...(seedKind && {kind:seedKind}), ...(seedLocation && {file:seedLocation[1],line:Number(seedLocation[2])}),
            stderrSha256:createHash('sha256').update(stderr).digest('hex')
          } })
        });
      }
      return {stdout:result.stdout??'',code:result.status};
    }
    const run=require('./'+profile.runner)[profile.method];
    if(lane==='pol280')await run(context,receipt);
    else await run(context,receipt,runCommand,need,isDeepStrictEqual);
  };
  if(current320){
    const installCurrent=historicalSettlement?withCombined334HistoricalSettlement:upwardArchive?withCombined332UpwardArchive:
      paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    const material={
      sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails
    };
    if(signed) {
      if(company) await withCombinedCompanyHistory352(receipt,consume,{...source,...material});
      else await withCombinedSignedSettlement350(receipt,consume,{...source,...material});
      expenseProfile.assertInstallation(receipt,source);
    } else if(precision) {
      await withCombinedExpenseWitness349(receipt,consume,{...source,...material});
    } else if(expenseWitness) {
      await withCombinedExpenseWitness(receipt,consume,material,count);
    } else {
      await installCurrent(receipt,consume,material);
      assert.equal(receipt.forward320.count,count);
      assert.equal(receipt.forward320.sourceTree,source.sourceTree);
      assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    }
    if(precision) assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness,true);
    if(expenseWitness) assert.equal(receipt.expenseWitnessCatalogAfterBusiness,true);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    if(historicalProfile) {
      if(historicalSettlement) historicalProfile.assertFinanceInstallation(receipt,source);
      assert.equal(receipt.historicalTakeoverCatalogAfterBusiness,true);
      assert.equal(receipt.historicalSettlementCatalogAfterBusiness,true);
    }
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  const original=receipt[profile.receipt];
  assert.equal(original.suite,profile.suite);
  assert.equal(original.passed,profile.count);
  assert.equal(original.skipped,0);
  if(lane==='v7')assert.deepEqual(
    [original.connectionLimit,original.deadlock40P01,original.lockSessions],[2,true,2]);
  if(lane==='pol279')assert.equal(original.replaySeed,true);
  if(lane==='pol280')assert.deepEqual([original.replayNoop,original.seed,original.lockSessionCapacity],[true,true,3]);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_FINANCE_ADJACENT_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'ORIGINAL_FINANCE_ADJACENT_295_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit,seedDiagnostic:error.seedDiagnostic};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
