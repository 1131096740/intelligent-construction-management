'use strict';

const {readFileSync,writeFileSync,statSync}=require('node:fs');
const {scope}=require('../common/successor.cjs');
const {technical}=require('./archive-contract.cjs');

const identity=row=>row&&row.schemaVersion===1&&row.purpose==='NTF04_NAMED_RESTORE_EXACT_295'&&row.candidateSha===require(process.argv[6]).head&&
  row.operation==='NAMED_BANK_BACKUP_AND_RECOVERY';
const restoreStages=[
  'BACKUP294_NAMED_EXPORT_IMPORT','BACKUP292_RESTORE_BUSINESS_PRE_DATA',
  'BACKUP292_RESTORE_BUSINESS_DATA','BACKUP292_RESTORE_BUSINESS_POST_DATA',
  'BACKUP292_RESTORE_OWNER_PRE_DATA','BACKUP292_RESTORE_OWNER_POST_DATA',
];
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
  if(mode==='--preflight') return row.status==='BACKUP295_NO_DB_PREFLIGHT_PASSED'&&
    row.stages.at(-1)==='BACKUP292_BOTH_WORKSPACE_CLOSURES';
  if(mode!=='--once') return false;
  const data=row.restore;
  return row.status==='BACKUP295_RESTORED_AND_VERIFIED'&&row.business==='CALLBACK_COMPLETED'&&
    row.releaseTree===scope.tree&&row.cleanup==='POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT'&&
    row.installOnly292?.count===292&&row.installOnly292.ledgerSha256===scope.expectedLedgerSha256&&
    row.installOnly294?.ledgerSha256===require('./combined294-source.json').ledgerSha256&&
    row.installOnly295?.ledgerSha256===require('../common/multi-witness.cjs').final&&
    restoreStages.every(stage=>row.stages.filter(value=>value===stage).length===1)&&
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
    if(process.argv.length!==7||!/^\d{1,3}$/u.test(status)||Number(status)>255||
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
