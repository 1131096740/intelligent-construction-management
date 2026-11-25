'use strict';

const assert=require('node:assert/strict');
const {admitSource}=require('./install-only292.cjs');
const {withCombined295MultiWitness,withCombined320ContractPayment,withCombined330TextAgreement,withCombined331PaymentRemainder,withCombined332UpwardArchive}=require('./installer.cjs');
const {final,digest}=require('./multi-witness.cjs');
const plan=require('./contract-adjacent-profiles.json');
const {verify}=require('./contract-ci.cjs');
const source=require('./contract-finance-source.json');
const root='/qualification';
const lane=process.argv[2];
const mode=process.argv[3];
const upwardArchive=mode==='--upward-archive-332';
const paymentRemainder=mode==='--payment-remainder-331';
const textDirect=mode==='--text-direct-330';
const current320=upwardArchive||paymentRemainder||textDirect||mode==='--current-320';
const count=upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
const receipt={schemaVersion:1,purpose:'ORIGINAL_CONTRACT_ADJACENT_EXACT_'+count,lane,sourceSha:source.sourceSha,
  migrationSha256:current320?source.tails.at(-1).sha256:digest,business:'NOT_ENTERED',stages:['INPUTS'],status:'STOPPED'};

async function main(){
  assert.equal(process.argv.length,current320?4:3);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  assert.equal(source.migrationCount,count);
  if(upwardArchive){
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
  assert.ok(Object.hasOwn(plan.profiles,lane));
  const profile=plan.profiles[lane];
  const fs=require('node:fs'),{createHash}=require('node:crypto');
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(hash(root+'/contract-ci.cjs'),plan.runnerSha256);
  for(const file of ['task12-owned-280.test-support.ts',...profile.specs])
    assert.equal(hash(root+'/workspace/services/api/src/database/'+file),plan.fixtures[file]);
  const baseline=require('./workspace/services/api/prisma/migration-baseline.cjs').loadCanonicalMigrationBaseline();
  assert.equal(baseline.expectedDirectoryCount,count);
  assert.equal(baseline.terminalMigrationChecksum,receipt.migrationSha256);
  if(current320) assert.equal(baseline.terminalMigration,source.tails.at(-1).name);
  receipt.input=admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  const consume=async context=>{
    if(current320) assert.equal(context.candidateTree,source.sourceTree);
    receipt.stages.push('ORIGINAL_CONTRACT_ADJACENT_'+lane.toUpperCase());
    receipt.settlement=verify(profile.verifyMode,context);
  };
  if(current320){
    const installCurrent=upwardArchive?withCombined332UpwardArchive:
      paymentRemainder?withCombined331PaymentRemainder:textDirect?withCombined330TextAgreement:withCombined320ContractPayment;
    await installCurrent(receipt,consume,{
      sourceTree:source.sourceTree,migrations:root+'/workspace/services/api/prisma/migrations',tails:source.tails
    });
    assert.equal(receipt.forward320.count,count);
    assert.equal(receipt.forward320.sourceTree,source.sourceTree);
    assert.equal(receipt.forward320.ledgerSha256,source.ledgerSha256);
    assert.equal(receipt.forward320.sameBaseB7,true);
    assert.equal(receipt.combinedAfterBusiness.count,count);
    if(upwardArchive) require('./upward-archive-332-profile.cjs').assertInstallation(receipt,source);
    if(paymentRemainder){
      assert.deepEqual(receipt.paymentRemainderPredecessor,{
        count:330,ledgerSha256:source.predecessor330.ledgerSha256,sameIdentity:true,sameBaseB7:true
      });
    }
  } else {
    await withCombined295MultiWitness(receipt,consume);
  }
  assert.equal(receipt.settlement.tests,profile.count);
  assert.equal(receipt.settlement.skipped,0);
  assert.deepEqual(receipt.settlement.suites,profile.specs.map(file=>'services/api/src/database/'+file));
  if(lane==='settlement')assert.match(receipt.settlement.precheckSha256,/^[a-f0-9]{64}$/u);
  assert.deepEqual(receipt.orderedTails.slice(-6).map(row=>row.size),[290,291,292,293,294,295]);
  assert.equal(receipt.installOnly295.ledgerSha256,final);
  assert.equal(receipt.installOnly295.nonOwnerDenied,true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256,source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity,true);
  assert.equal(receipt.combinedAfterBusiness.exactB7,true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness,true);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_CONTRACT_ADJACENT_'+count+'_PASSED';
}

main().catch(error=>{
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'ORIGINAL_CONTRACT_ADJACENT_295_FAILED',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,migrationCause:error.migrationCause,
    prismaOutput:error.prismaOutput,migrationLedger:error.migrationLedger,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
