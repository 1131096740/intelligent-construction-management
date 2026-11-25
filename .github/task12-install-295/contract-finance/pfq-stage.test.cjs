'use strict';

const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {after,before,test}=require('node:test');

const repo=resolve(__dirname,'../../..');
const common=join(__dirname,'common');
const work=mkdtempSync(join(tmpdir(),'pfq-stage-test.'));
const staged=join(work,'staged');
const modes=[undefined,'--current-320','--text-direct-330','--payment-remainder-331','--upward-archive-332'];
const migrationCounts=[295,329,330,331,332];
const lanes=['pre115-clean','pre116-legacy','duplicate','cross-business','replacement-child','replacement-parent','app'];
const predecessor=(count,ledgerSha256)=>({count,ledgerSha256,sameIdentity:true,sameBaseB7:true});

before(()=>{
  const result=spawnSync('python3',[
    join(__dirname,'stage-pfq.py'),join(repo,'.github/task12-install-289'),join(repo,'.github/task12-install-290'),common,staged,
  ],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  for(const name of ['multi-witness.cjs','scope.json']) copyFileSync(join(common,name),join(staged,name));
  copyFileSync(join(__dirname,'upward-archive-332-profile.cjs'),join(staged,'upward-archive-332-profile.cjs'));
  writeFileSync(join(staged,'mock-runtime.cjs'),`(${mockRuntime.toString()})()`);
  const appMount=join(staged,'workspace/services/api/prisma');
  mkdirSync(appMount,{recursive:true});
  writeFileSync(join(appMount,'task12-pfq-app.cjs'),`exports.runPfqApp=async(context,receipt)=>{
    receipt.pfqApp={businessCases:13,connectionCases:1,sessions:4,sessionAttestationRounds:2};
  };`);
});
after(()=>rmSync(work,{recursive:true,force:true}));

// Run the staged entry with the existing installer boundary simulated. This creates no database.
function mockRuntime(){
  const assert=require('node:assert/strict');
  const installer=require('./installer.cjs');
  const source=require('./contract-finance-source.json');
  const {receipt,installerMethod,fault}=require('./mock-receipt.json');
  const methods=['withPfq295','withPfq320'];
  for(const name of methods){
    const original=installer[name];
    installer[name]=(output,mode,material)=>{
      assert.equal(name,source.migrationCount===295?'withPfq295':'withPfq320');
      assert.equal(mode,'--pfq-'+output.lane+'-289-local');
      assert.deepEqual(material,source.migrationCount===295?undefined:{
        mode:source.mode,sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails,
      });
      installer[installerMethod]=async (result,consume)=>{
        const {pfqPositive,pfqPostconsume,...beforeCallback}=receipt;
        Object.assign(result,beforeCallback);
        const fixture=require('./task12-pfq-positive-fixtures.json')[mode];
        await consume({candidateTree:source.sourceTree??require('./scope.json').tree,sql:async sql=>{
          if(sql.includes("'exactPostimage'")){
            assert.equal(sql.includes('486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7'),source.migrationCount===332);
            return {stdout:JSON.stringify({upward:true,tls:true,exactPostimage:true,outsidePairScopeClosed:true,outsideArchiveEvidenceBound:true})};
          }
          assert.ok(fixture&&sql.includes(fixture.readback));
          return {stdout:fixture.expected};
        }});
        assert.deepEqual(result.pfqPositive,pfqPositive);
        assert.deepEqual(result.pfqPostconsume,pfqPostconsume);
      };
      if(fault==='before-runtime') throw new Error('UNEXPECTED_RUNTIME_ENTRY');
      return original(output,mode,material);
    };
  }
}

function run(index,lane,fault){
  const mode=modes[index];
  const count=migrationCounts[index];
  const base295=require(join(common,'multi-witness.cjs')).final;
  const ledger329='3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
  const ledger330='12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f';
  const ledger331='0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014';
  const ledger332='da5e425d3160952d733fd84f4c5852b6951181fdcb8d37efd2763c32097930e8';
  const ledgerSha256=[base295,ledger329,ledger330,ledger331,ledger332][index];
  const source={sourceSha:'a'.repeat(40),sourceTree:'b'.repeat(40),migrationCount:count,ledgerSha256,
    mode:mode?.slice(2),predecessor:{migrationCount:295,ledgerSha256:base295},
    predecessor330:{migrationCount:330,ledgerSha256:ledger330},predecessor331:{migrationCount:331,ledgerSha256:ledger331},
    tails:[...Array.from({length:Math.max(0,count-296)},()=>({name:'synthetic',sha256:'a'.repeat(64)})),
      {name:'20261129001000_contract_upward_archive_verifier_pin_forward',
        sha256:'42538d9f925438e3be99e4a4fbd0721dbf93f65bae1c801101cd4e5aa64a8087',finished:true,rolledBack:false}]};
  if(!mode) delete source.sourceTree;
  const receipt={releaseTree:'67644d9465a0ab4ee80ede099139d9c129d66f14',business:'CALLBACK_COMPLETED',
    orderedTails:[{size:295}],installOnly295:{count:295,ledgerSha256:base295},
    textDirectPredecessor:predecessor(329,ledger329),paymentRemainderPredecessor:predecessor(330,ledger330),
    upwardArchivePredecessor:predecessor(331,ledger331),pfqPostconsume:{count,exactB7:true},
    combinedAfterBusiness:{count,ledgerSha256,sameIdentity:true,exactB7:true},
    forward320:{count,sourceTree:source.sourceTree,ledgerSha256,sameIdentity:true,sameBaseB7:true,
      tails:source.tails.map(({name,sha256})=>({name,sha256}))},
    cleanup:'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT'};
  if(lane==='app'){
    receipt.pfqAppMigrationStatus=true;
  }else if(lane.startsWith('pre')){
    const legacy=lane==='pre116-legacy';
    receipt.pfqPositive={prefix:legacy?115:114,mode:'--pfq-'+lane+'-289-local',exactOriginalValues:true,...(legacy&&{immutable:true})};
  }else{
    receipt.pfqRecovery={kind:lane.replace('-','_'),markerInPostgres:true,PrismaResolve:true,originalRowPreserved:true,historicalNull:true,
      caseSpecificBindingConfirmed:true,caseSpecificBindingCleared:true};
  }
  if(fault==='terminal') source.tails.at(-1).sha256='0'.repeat(64);
  if(fault==='predecessor') receipt.upwardArchivePredecessor.sameIdentity=false;
  if(fault==='postconsume') receipt.combinedAfterBusiness.ledgerSha256=ledger331;
  const installerMethod=['withCombined295MultiWitness','withCombined320ContractPayment','withCombined330TextAgreement',
    'withCombined331PaymentRemainder','withCombined332UpwardArchive'][index];
  writeFileSync(join(staged,'contract-finance-source.json'),JSON.stringify(source));
  writeFileSync(join(staged,'mock-receipt.json'),JSON.stringify({receipt,installerMethod,fault:fault==='terminal'?'before-runtime':fault}));
  const result=spawnSync(process.execPath,['--require',join(staged,'mock-runtime.cjs'),join(staged,'entry.cjs'),lane,...(mode?[mode]:[])],{encoding:'utf8'});
  return {status:result.status,output:JSON.parse(result.stdout)};
}

for(const [index,count] of migrationCounts.entries()){
  test(`staged PFQ ${count} accepts all seven original lanes with complete simulated receipts`,()=>{
    for(const lane of lanes){
      const {status,output}=run(index,lane);
      assert.equal(status,0,JSON.stringify(output));
      assert.equal(output.status,`ORIGINAL_PFQ_EXACT_${count}_PASSED`);
    }
  });
}

test('staged PFQ 332 rejects a changed terminal, predecessor identity and post-business ledger',()=>{
  for(const fault of ['terminal','predecessor','postconsume']){
    const {status,output}=run(4,'duplicate',fault);
    assert.equal(status,1);
    assert.equal(output.status,'STOPPED');
    assert.notEqual(output.failure.code,'UNEXPECTED_RUNTIME_ENTRY');
  }
});
