'use strict';

const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {after,before,test}=require('node:test');

const repo=resolve(__dirname,'../../..');
const common=join(__dirname,'common');
const work=mkdtempSync(join(tmpdir(),'pfq-stage-test.'));
const staged=join(work,'staged');
const staged334=join(work,'staged334');
const staged346=join(work,'staged346');
const staged349=join(work,'staged349');
const modes=[undefined,'--current-320','--text-direct-330','--payment-remainder-331','--upward-archive-332','--historical-settlement-334','--expense-witness-346','--expense-witness-349'];
const migrationCounts=[295,329,330,331,332,334,346,349];
const lanes=['pre115-clean','pre116-legacy','duplicate','cross-business','replacement-child','replacement-parent','app'];
const predecessor=(count,ledgerSha256)=>({count,ledgerSha256,sameIdentity:true,sameBaseB7:true});

before(()=>{
  for(const [directory,mode] of [[staged,[]],[staged334,['--historical-settlement-334']],[staged346,['--expense-witness-346']],[staged349,['--expense-witness-349']]]){
    const result=spawnSync('python3',[
      join(__dirname,'stage-pfq.py'),join(repo,'.github/task12-install-289'),join(repo,'.github/task12-install-290'),
      common,directory,...mode,
    ],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    for(const name of ['multi-witness.cjs','scope.json']) copyFileSync(join(common,name),join(directory,name));
    for(const name of ['historical-settlement-334-profile.cjs','historical-takeover-333-profile.cjs','upward-archive-332-profile.cjs',
      'expense-witness-345-profile.cjs','expense-witness-346-profile.cjs','expense-witness-349-profile.cjs','expense-witness-prefixes.json'])
      copyFileSync(join(__dirname,name),join(directory,name));
    writeFileSync(join(directory,'mock-runtime.cjs'),`(${mockRuntime.toString()})()`);
    const appMount=join(directory,'workspace/services/api/prisma');
    mkdirSync(appMount,{recursive:true});
    writeFileSync(join(appMount,'task12-pfq-app.cjs'),`exports.runPfqApp=async(context,receipt)=>{
      receipt.pfqApp={businessCases:13,connectionCases:1,sessions:4,sessionAttestationRounds:2};
    };`);
  }
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
        ...(source.migrationCount===349?source:{mode:source.mode}),sourceTree:source.sourceTree,migrations:'/qualification/workspace/services/api/prisma/migrations',tails:source.tails,
      });
      installer[installerMethod]=async (result,consume,_material,target)=>{
        assert.equal(target,source.migrationCount===346?346:undefined);
        if(source.migrationCount===349) assert.deepEqual(_material,material);
        const {pfqPositive,pfqPostconsume,...beforeCallback}=receipt;
        Object.assign(result,beforeCallback);
        const fixture=require('./task12-pfq-positive-fixtures.json')[mode];
        await consume({candidateTree:source.sourceTree??require('./scope.json').tree,sql:async sql=>{
          if(sql.includes("'exactPostimage'")){
            assert.equal(sql.includes('486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7'),source.migrationCount>=332);
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

function takeoverCatalog(after){
  const condition=definition=>({definition,validated:true});
  const legacyAction="action=ANYARRAY['confirm','withdraw']";
  return {
    ContractTakeover_level_check:condition("takeoverLevel=ANYARRAY['A','B','C'"+(after?",'NONE'":"")+"]"),
    ContractTakeoverConfirmationEvent_side_check:condition("side=ANYARRAY['contract','finance'"+(after?",'handover'":"")+"]"),
    ContractTakeoverConfirmationEvent_action_check:condition(after
      ?"side=ANYARRAY['contract','finance']AND"+legacyAction+"ORside='handover'ANDaction=ANYARRAY['handover_register','handover_reassign']"
      :legacyAction),
    ContractTakeoverConfirmationEvent_withdraw_reason_check:condition("ACTION<>'WITHDRAW'ORNULLIFBTRIMREASON,''ISNOTNULL"),
  };
}

function signedCatalogs(){
  const text=readFileSync(join(__dirname,'historical-settlement-334-profile.cjs'),'utf8');
  const entries=text.matchAll(/^  (jg_[a-z0-9_]+): \['([a-f0-9]{64})', '([a-f0-9]{64})'\]/gmu);
  const before={},after={};
  for(const [,routine,pre,post] of entries){
    const metadata={definer:true,publicExecute:false};
    before[routine]={sha256:pre,...metadata};
    after[routine]={sha256:post,...metadata};
  }
  const [,name,sha256]=/name: '(jg_historical_signed_settlement_source_v1)',\s*sha256: '([a-f0-9]{64})'/u.exec(text);
  after[name]={sha256,definer:false,publicExecute:false,language:'sql'};
  return [before,after];
}

function run(index,lane,fault){
  const mode=modes[index];
  const count=migrationCounts[index];
  const base295=require(join(common,'multi-witness.cjs')).final;
  const ledger329='3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2';
  const ledger330='12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f';
  const ledger331='0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014';
  const ledger332='b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4';
  const historical=require('./historical-settlement-334-profile.cjs');
  const previous=require('./historical-takeover-333-profile.cjs');
  const expense=require('./expense-witness-346-profile.cjs');
  const precision=require('./expense-witness-349-profile.cjs');
  const ledgerSha256=[base295,ledger329,ledger330,ledger331,ledger332,historical.ledgerSha256,expense.ledgerSha256,precision.ledgerSha256][index];
  const source={sourceSha:'a'.repeat(40),sourceTree:'b'.repeat(40),migrationCount:count,ledgerSha256,
    mode:mode?.slice(2),predecessor:{migrationCount:295,ledgerSha256:base295},
    predecessor330:{migrationCount:330,ledgerSha256:ledger330},predecessor331:{migrationCount:331,ledgerSha256:ledger331},
    tails:[...Array.from({length:Math.max(0,Math.min(count,332)-296)},()=>({name:'synthetic',sha256:'a'.repeat(64)})),
      {name:'20261129001000_contract_upward_archive_verifier_pin_forward',
        sha256:'4e8e6e23267f525ca2bff68719e2989126fff82e5bd0d0ba344abc2c4c8d4da3',finished:true,rolledBack:false}]};
  if(!mode) delete source.sourceTree;
  if(count>=334){
    source.predecessor332={migrationCount:332,ledgerSha256:ledger332};
    source.predecessor333={migrationCount:333,ledgerSha256:previous.ledgerSha256};
    source.tails.push(...[previous.terminal,historical.terminal].map(row=>({...row,finished:true,rolledBack:false})));
  }
  if(count>=346){
    source.predecessor334={migrationCount:334,ledgerSha256:historical.ledgerSha256};
    source.tails.push(...require('./expense-witness-prefixes.json').slice(1).map(item=>item.terminal),expense.terminal);
  }
  if(count===349){
    source.predecessor346={migrationCount:346,ledgerSha256:expense.ledgerSha256};
    source.tails.push(
      {name:'20261129016000_reimbursement_business_amount_precision',
        sha256:'d5a34145bce2ed278c214df066190106d455032939112eefe2ea5fb8a4d157a4',finished:true,rolledBack:false},
      {name:'20261129017000_reimbursement_exact_operating_cost',
        sha256:'8fc8227575264f2b262cc023636700e2a8b9479b144aa788c94a691de7d497de',finished:true,rolledBack:false},
      precision.terminal
    );
  }
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
  if(count>=334){
    receipt.forward320.observedLedgerSha256=lane.startsWith('pre')||lane==='app'?historical.ledgerSha256:'c'.repeat(64);
    receipt.historicalTakeoverPredecessor={...predecessor(332,ledger332),catalog:takeoverCatalog(false)};
    receipt.historicalTakeover333Catalog=takeoverCatalog(true);
    const [before,after]=signedCatalogs();
    receipt.historicalSettlementPredecessor={count:333,ledgerSha256:previous.ledgerSha256,routineCatalog:before};
    receipt.historicalSettlement334Catalog=after;
    receipt.historicalTakeoverCatalogAfterBusiness=true;
    receipt.historicalSettlementCatalogAfterBusiness=fault!=='catalog';
  }
  if(count>=346){
    const recovery=Boolean(receipt.pfqRecovery);
    receipt.forward320={...receipt.forward320,count:334,ledgerSha256:historical.ledgerSha256,
      tails:receipt.forward320.tails.slice(0,39)};
    receipt.expenseWitnessForward={
      count:346,ledgerSha256:expense.ledgerSha256,sameIdentity:fault!=='successor',sourceTree:source.sourceTree,
      tails:source.tails.slice(39,51).map(({name,sha256})=>({name,sha256}))
    };
    receipt.pfqObserved346={rows:346+Number(recovery&&(count===349||fault!=='rollback-row')),
      sha256:recovery?'d'.repeat(64):expense.ledgerSha256};
    receipt.expenseWitnessCatalogAfterBusiness=fault!=='expense-catalog';
  }
  if(count===349){
    const recovery=Boolean(receipt.pfqRecovery);
    receipt.expenseWitnessPrecisionForward={
      count,ledgerSha256,sameIdentity:fault!=='precision-successor',sourceTree:source.sourceTree,
      tails:source.tails.slice(51).map(({name,sha256})=>({name,sha256}))
    };
    receipt.pfqObserved349={rows:count+Number(recovery&&fault!=='rollback-row'),
      sha256:recovery?'e'.repeat(64):ledgerSha256};
    receipt.expenseWitnessPrecisionCatalogAfterBusiness=fault!=='precision-catalog';
  }
  if(fault==='terminal') source.tails[source.tails.length-1]={...source.tails.at(-1),sha256:'0'.repeat(64)};
  if(fault==='predecessor') receipt.upwardArchivePredecessor.sameIdentity=false;
  if(fault==='source-predecessor') source.predecessor333.ledgerSha256='0'.repeat(64);
  if(fault==='postconsume') receipt.combinedAfterBusiness.ledgerSha256=ledger331;
  const installerMethod=['withCombined295MultiWitness','withCombined320ContractPayment','withCombined330TextAgreement',
    'withCombined331PaymentRemainder','withCombined332UpwardArchive','withCombined334HistoricalSettlement','withCombinedExpenseWitness','withCombinedExpenseWitness349'][index];
  const directory=count===349?staged349:count===346?staged346:count===334?staged334:staged;
  writeFileSync(join(directory,'contract-finance-source.json'),JSON.stringify(source));
  writeFileSync(join(directory,'mock-receipt.json'),JSON.stringify({receipt,installerMethod,fault:['terminal','source-predecessor'].includes(fault)?'before-runtime':fault}));
  const result=spawnSync(process.execPath,['--require',join(directory,'mock-runtime.cjs'),join(directory,'entry.cjs'),lane,...(mode?[mode]:[])],{encoding:'utf8'});
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

test('staged PFQ 334 rejects a changed tail, predecessor, or post-business ledger or catalog',()=>{
  for(const fault of ['terminal','source-predecessor','predecessor','postconsume','catalog']){
    const {status,output}=run(5,'replacement-child',fault);
    assert.equal(status,1);
    assert.equal(output.status,'STOPPED');
    assert.notEqual(output.failure.code,'UNEXPECTED_RUNTIME_ENTRY');
  }
});

test('staged PFQ 346 rejects a changed terminal, same-database successor, missing recovery row or catalog',()=>{
  for(const fault of ['terminal','source-predecessor','successor','rollback-row','postconsume','expense-catalog']){
    const {status,output}=run(6,'replacement-parent',fault);
    assert.equal(status,1);
    assert.equal(output.status,'STOPPED');
    assert.notEqual(output.failure.code,'UNEXPECTED_RUNTIME_ENTRY');
  }
});

test('staged PFQ 349 rejects wrong migration evidence, including the recovery row and precision catalog',()=>{
  for(const fault of ['terminal','source-predecessor','successor','precision-successor','rollback-row','postconsume','expense-catalog','precision-catalog']){
    const {status,output}=run(7,'replacement-parent',fault);
    assert.equal(status,1);
    assert.equal(output.status,'STOPPED');
    assert.notEqual(output.failure.code,'UNEXPECTED_RUNTIME_ENTRY');
  }
});
