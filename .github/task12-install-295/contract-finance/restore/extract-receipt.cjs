'use strict';

const {readFileSync,writeFileSync,statSync}=require('node:fs');
const {scope}=require('../common/successor.cjs');
const {legacy,successor,textDirect,expense346,expense349}=require('./restore-profile.cjs');
const path=require('node:path');
const {paymentCatalogChecks}=require('./text-direct-330.cjs');
const current=process.argv[7]?require(process.argv[7]):undefined;
const upwardArchive332=current?.mode==='upward-archive-332';
const historicalSettlement334=current?.mode==='historical-settlement-334';
const precision=current?.mode==='expense-witness-349';
const exact=precision?require('./exact-349.cjs'):current?.mode==='expense-witness-346'?require('./exact-346.cjs'):undefined;
const historical=historicalSettlement334||exact?require('../historical-settlement-334-profile.cjs'):undefined;
const paymentRemainder331=exact||historicalSettlement334||upwardArchive332||current?.mode==='payment-remainder-331';
const textDirect330=paymentRemainder331||current?.mode==='text-direct-330';
const count=precision?349:exact?346:historicalSettlement334?334:upwardArchive332?332:paymentRemainder331?331:textDirect330?330:current?329:295;
const paymentProfile=upwardArchive332?require('../upward-archive-332-profile.cjs'):
  paymentRemainder331?require('../payment-remainder-331-profile.cjs'):
  textDirect330?require('../text-direct-330-profile.cjs'):undefined;
const {technical,businessCount}=precision?expense349:exact?expense346:textDirect330?textDirect:current?successor:legacy;

const identity=row=>row&&row.schemaVersion===1&&row.purpose==='NTF04_NAMED_RESTORE_EXACT_'+count&&row.candidateSha===(current?.sourceSha??require(process.argv[6]).head)&&
  row.operation==='NAMED_BANK_BACKUP_AND_RECOVERY'&&(!current||row.fixturePredecessorSha===require(process.argv[6]).head)&&
  (!textDirect330||(row.candidateTree===current.sourceTree&&row.candidateSha!==row.fixturePredecessorSha&&
    /^[a-f0-9]{64}$/u.test(row.fixturePredecessorSourceSha256)&&row.fixturePredecessorSourceSha256===require(process.argv[6]).predecessorSourceSha256))&&
  (!exact||(row.fixturePredecessorSha===exact.fixtureSha&&row.fixturePredecessorSourceSha256===exact.fixtureSourceSha256&&row.installerSha256===exact.installerSha256&&
    row.candidateSourceSha256===exact.hash(readFileSync(process.argv[7]))&&row.candidateSourceSha256===require(process.argv[6]).currentSourceSha256));
const restoreStages=[
  'BACKUP294_NAMED_EXPORT_IMPORT','BACKUP292_RESTORE_BUSINESS_PRE_DATA',
  'BACKUP292_RESTORE_BUSINESS_DATA','BACKUP292_RESTORE_BUSINESS_POST_DATA',
  'BACKUP292_RESTORE_OWNER_PRE_DATA','BACKUP292_RESTORE_OWNER_POST_DATA',
];
const namedExportStage=textDirect330?'BACKUP'+count+'_NAMED_EXPORT_IMPORT':current?'BACKUP320_NAMED_EXPORT_IMPORT':restoreStages[0];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const exactlyTrue=(row,names)=>row&&names.every(name=>row[name]===true);

function readTerminal(raw){
  const lines=raw.trimEnd().split(/\r?\n/u);
  const records=[];
  for(const [index,line] of lines.entries()){
    if(!line.startsWith('{')) continue;
    let row;
    try { row=JSON.parse(line); } catch { continue; }
    if(identity(row)) records.push({row,index});
  }
  if(records.length!==1||records[0].index!==lines.length-1) throw Error('BACKUP292_TERMINAL_RECEIPT_INVALID');
  return records[0].row;
}

function qualified(row,mode){
  const exactInput=row.input?.baseCount===289&&row.input.intermediateCount===291&&row.input.finalCount===292&&
    row.input.ledgerSha256===scope.expectedLedgerSha256;
  if(row.inputMigrationSha256!==require('../common/multi-witness.cjs').digest||!identity(row)||!exactInput||row.failure||!Array.isArray(row.stages)) return false;
  if(mode==='--preflight') return row.status==='BACKUP'+count+'_NO_DB_PREFLIGHT_PASSED'&&
    row.stages.at(-1)==='BACKUP292_BOTH_WORKSPACE_CLOSURES';
  if(mode!=='--once') return false;
  const data=row.restore;
  let terminalForward=row.forward320;
  if(textDirect330) {
    try {
      const base=require('../common/multi-witness.cjs').final;
      if(exact) {
        require('../expense-witness-'+count+'-profile.cjs').assertSource(current,base);
        terminalForward=exact.forward(row,current,historical);
      } else if(historical) {
        historical.assertSource(current,base);
        historical.assertFinanceInstallation(row,current);
      } else {
        paymentProfile.assertSource(current,row.candidateSha,base);
        paymentProfile.assertInstallation(row,current);
      }
    } catch {
      return false;
    }
    const proof=data?.textDirect330;
    const terminal=current.tails[34];
    const migration=path.join(path.dirname(process.argv[7]),'prepared/context/workspace/services/api/prisma/migrations',terminal.name,'migration.sql');
    const {allocationWriterSha256}=paymentCatalogChecks(readFileSync(migration),terminal.sha256);
    if(proof?.allocationWriterSha256!==allocationWriterSha256) return false;
    if(!exactlyTrue(proof,['oldColumnProjectionMatched','newColumnNull','sourceAndRestoredCatalogMatched','sourceAndRestoredNamedExecutionDenied'])||
      !positive(proof.historical?.count)||proof.historical.count!==row.historicalPayment295?.count||
      !/^[a-f0-9]{64}$/u.test(proof.historical.sha256)||proof.historical.sha256!==row.historicalPayment295?.sha256||
      !/^[a-f0-9]{64}$/u.test(proof.ddlAclSha256)||row.combinedAfterBusiness?.count!==count||
      row.combinedAfterBusiness?.sameIdentity!==true||row.multiWitnessCatalogAfterBusiness!==true) return false;
  }
  if(paymentRemainder331&&(!exactlyTrue(data?.paymentRemainder331,['historicalRowsUnchanged','validatedConstraint'])||
    JSON.stringify(data.paymentRemainder331.enabledGuards)!==JSON.stringify([
      ['PaymentExecution_withdrawn_remainder_guard','jg_guard_withdrawn_payment_execution_v1',true],
      ['PaymentRequest_remaining_withdrawal_guard','jg_guard_payment_remaining_withdrawal_v1',false]
    ]))) return false;
  if((upwardArchive332||historical) && (data?.upwardArchive332?.sourceAndRestoredMatched!==true||
    data.upwardArchive332.ledgerSha256!==(historical?.predecessor332??current.ledgerSha256)||
    data.upwardArchive332.postimages?.jg_upward_archive_catalog_projection_v2!=='486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7'||
    data.upwardArchive332.postimages?.jg_upward_direct_archive_admission_v1!=='0a647f271a6ff2ec4bdf776c7a4950b26c4885babe980e08dec0182b2c1bae30')) return false;
  if(historical&&(!exactlyTrue(row,['historicalTakeoverCatalogAfterBusiness','historicalSettlementCatalogAfterBusiness'])||
    data?.historicalSettlement334?.sourceAndRestoredMatched!==true||
    data.historicalSettlement334.ledgerSha256!==historical.ledgerSha256)) return false;
  if(exact) {
    const expenseProof=data?.['expense'+count];
    if(!exactlyTrue(row,['expenseWitnessCatalogAfterBusiness'])||
      !exactlyTrue(data,['samePostgresInstance'])||expenseProof?.sourceAndRestoredMatched!==true||
      expenseProof.ledgerSha256!==current.ledgerSha256) return false;
    if(precision&&(row.expenseWitnessPrecisionCatalogAfterBusiness!==true||expenseProof.precisionCatalogMatched!==true)) return false;
  }
  const forwardValid=!current||(terminalForward?.count===count&&terminalForward.sameIdentity===true&&
    terminalForward.sameBaseB7===true&&terminalForward.sourceTree===current.sourceTree&&
    terminalForward.ledgerSha256===current.ledgerSha256&&row.combinedAfterBusiness?.ledgerSha256===current.ledgerSha256&&
    row.combinedAfterBusiness.exactB7===true&&data?.businessTables===businessCount);
  return forwardValid&&row.status==='BACKUP'+count+'_RESTORED_AND_VERIFIED'&&row.business==='CALLBACK_COMPLETED'&&
    row.releaseTree===scope.tree&&row.cleanup==='POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT'&&
    row.installOnly292?.count===292&&row.installOnly292.ledgerSha256===scope.expectedLedgerSha256&&
    row.installOnly294?.ledgerSha256===require('./combined294-source.json').ledgerSha256&&
    row.installOnly295?.ledgerSha256===require('../common/multi-witness.cjs').final&&
    restoreStages.every(stage=>row.stages.filter(value=>value===(stage===restoreStages[0]?namedExportStage:stage)).length===1)&&
    exactlyTrue(row.backupFixtureCleanup,['rolesWithdrawn','restoredDatabaseRemoved'])&&
    data&&data.namedDataImport?.role==='contract_backup'&&
    exactlyTrue(data.namedDataImport,['tls','targetWritesRevoked'])&&
    data.namedDataImport.restoredTables===data.businessTables&&
    Number.isSafeInteger(data.namedDataImport.restoredSequences)&&data.namedDataImport.restoredSequences>=0&&
    positive(data.businessTables)&&data.restoredDataPayloads===data.businessTables&&
    data.protectedTables===technical.length&&data.protectedPayloads===0&&data.sourceKeyRows===1&&
    exactlyTrue(data,['ownerOnlyRekeyed','namedNegativeTests'])&&
    exactlyTrue(data.probes,['historicalBank','oldDebt','settlement','pendingCorrection'])&&
    exactlyTrue(data.operatingVerifierRecovery,['ownerRebuilt','protectedFromNamedRoles','preparedContextRolledBack','sourceStatePreserved','businessPreserved'])&&
    data.history&&['bankObservations','historicalDebtTransfers','settlements','pendingRounds'].every(key=>positive(data.history[key]));
}

function extract(raw,mode,containerStatus,write){
  if(!['--preflight','--once'].includes(mode)) throw Error('BACKUP292_RECEIPT_MODE');
  const row=readTerminal(raw);
  write(row);
  return containerStatus===0&&qualified(row,mode);
}

if(require.main===module){
  try{
    const [mode,source,target,status]=process.argv.slice(2);
    if(![7,8].includes(process.argv.length)||!/^\d{1,3}$/u.test(status)||Number(status)>255||
      statSync(source).size>4*1024*1024) throw Error('BACKUP292_RECEIPT_ARGS');
    if(!extract(readFileSync(source,'utf8'),mode,Number(status),row=>
      writeFileSync(target,JSON.stringify(row,null,2)+'\n',{flag:'wx',mode:0o600}))){
      process.stderr.write('BACKUP292_RECEIPT_NOT_QUALIFIED\n');
      process.exitCode=1;
    }
  }catch{
    process.stderr.write('BACKUP292_RECEIPT_EXTRACTION_FAILED\n');
    process.exitCode=1;
  }
}
module.exports={extract,qualified,readTerminal};
