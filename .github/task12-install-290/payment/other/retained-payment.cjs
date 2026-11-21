"use strict";
const {createHash}=require("node:crypto");
const {readFileSync}=require("node:fs");
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(condition,code)=>{if(!condition)throw new Error(code);};
const migration="20260728139000_payment_execution_idempotency";
const checksum="e95d42ff64463872ab135552f64450b81d83a63cde1d900cbc5644fa54841522";
const expectedFacts=[
  "legacy:payment_execution:retained_valid_execution|retained_valid_company|存量迁移验收建设有限公司|91310000RETAINED01|retained_valid_executor|retained_valid_executor",
  "effective|400",
];
const catalogSql=`
 SELECT jsonb_build_object(
   'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.table_name,c.ordinal_position)
      FROM information_schema.columns c WHERE c.table_schema='public'
       AND c.table_name IN ('PaymentExecution','PaymentRequest','Settlement')),
   'constraints',(SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) ORDER BY conrelid,conname)
      FROM pg_constraint WHERE conrelid IN ('public."PaymentExecution"'::regclass,'public."PaymentRequest"'::regclass,'public."Settlement"'::regclass)),
   'indexes',(SELECT jsonb_agg(jsonb_build_array(relname,pg_get_indexdef(indexrelid)) ORDER BY relname)
      FROM pg_index JOIN pg_class ON oid=indexrelid
      WHERE indrelid IN ('public."PaymentExecution"'::regclass,'public."PaymentRequest"'::regclass,'public."Settlement"'::regclass)),
   'triggers',(SELECT jsonb_agg(jsonb_build_array(tgrelid::regclass::text,tgname,pg_get_triggerdef(oid)) ORDER BY tgrelid,tgname)
      FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public."PaymentExecution"'::regclass,'public."PaymentRequest"'::regclass,'public."Settlement"'::regclass)),
   'routines',(SELECT jsonb_agg(jsonb_build_array(proname,pg_get_functiondef(oid)) ORDER BY proname)
      FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname IN ('jg_file_business_binding_columns','jg_file_business_binding_columns_before_payment_execution','guard_payment_execution_immutable'))
 );
`;
function load(file) {
  const bytes=readFileSync(file);
  need(createHash("sha256").update(bytes).digest("hex")==="65abe64ccd8d0d3f2a169d783317930514a5200855c0f8a92d5d540dfe1a6d80","PAYMENT_RETAINED_MATERIAL");
  const data=JSON.parse(bytes);
  need(data.cases.length===15 && data.cases[0].label==="valid" &&
    data.cases.slice(1).every(row=>/^jiangkong_payment_execution_retained_[a-z_]+$/u.test(row.database) &&
      /^payment_execution_[a-z_]+$/u.test(row.expectedMarker)),"PAYMENT_RETAINED_FORMAT");
  return data;
}
async function verifyFacts(data,sql) {
  for(const [i,statement] of data.checks.entries()){
    need((await sql(statement)).stdout.trim()===expectedFacts[i],"PAYMENT_RETAINED_VALID_FACTS");
  }
  return {historicalSettlement:true,exactExecutionCompanyAndUploader:true};
}
async function verifyPrefix({data,database,deploy,sql,jsonSql,inspect,ledger,identity,onPhase,onCase,onFailure,readLog}) {
  need(ledger[109]?.name===migration && ledger[109].sha256===checksum,"PAYMENT_RETAINED_MIGRATION_IDENTITY");
  await deploy(109,database);
  const prefix=await jsonSql(inspect);
  const before=identity(prefix);
  need(equal(prefix.ledger,ledger.slice(0,109)),"PAYMENT_RETAINED_PREFIX_LEDGER");
  const negatives=[];
  for(const row of data.cases.slice(2)){
    onPhase("PAYMENT_RETAINED_NEGATIVE_"+row.label.toUpperCase());
    // PostgreSQL stores identifiers up to 63 bytes; original ASCII names
    // have one member that reaches 64 bytes. The actual catalog name is used.
    const target={database:row.database.slice(0,63)};
    await sql(`CREATE DATABASE ${target.database} TEMPLATE ${database};`,{database:"postgres"});
    try {
      const beforeClone=await jsonSql(inspect,target);
      need(beforeClone.database===target.database && beforeClone.databaseOid!==before.databaseOid &&
        beforeClone.systemIdentifier===before.systemIdentifier && beforeClone.ownerOid==="10" &&
        beforeClone.actorOid==="10" && beforeClone.actor==="jg_task01_owner" &&
        beforeClone.sessionActor===beforeClone.actor && equal(beforeClone.ledger,ledger.slice(0,109)),
        "PAYMENT_RETAINED_CLONE_PREFIX");
      await sql(row.sql,target);
      const beforeObjects=await jsonSql(catalogSql,target);
      const logBefore=readLog().length;
      const attempted=await deploy(110,target.database,true);
      const outcome=await jsonSql(`SELECT jsonb_build_object(
        'completed',count(*) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
        'targetRows',count(*) FILTER(WHERE migration_name='${migration}'),
        'checksumMatches',count(*) FILTER(WHERE migration_name='${migration}' AND checksum='${checksum}'),
        'unfinished',count(*) FILTER(WHERE migration_name='${migration}' AND finished_at IS NULL AND rolled_back_at IS NULL),
        'zeroAppliedSteps',count(*) FILTER(WHERE migration_name='${migration}' AND applied_steps_count=0),
        'markerInFailedLedger',COALESCE(bool_or(position('${row.expectedMarker}' in COALESCE(logs,''))>0)
          FILTER (WHERE migration_name='${migration}' AND finished_at IS NULL),false))
        FROM public._prisma_migrations;`,target);
      const rollbackColumns=(await sql(data.rollback,target)).stdout.trim();
      const observation={case:row.label,processExit:attempted.code,
        markerInPrismaStdout:(attempted.stdout??"").includes(row.expectedMarker),
        markerInPrismaStderr:(attempted.stderr??"").includes(row.expectedMarker),
        markerInPostgres:readLog().slice(logBefore).includes(row.expectedMarker),
        ...outcome,
        originalRollbackColumns:/^[0-4]$/u.test(rollbackColumns)?Number(rollbackColumns):null};
      onFailure(observation);
      need(Number.isInteger(attempted.code)&&attempted.code>0,"PAYMENT_RETAINED_NEGATIVE_DID_NOT_FAIL");
      need(outcome.completed===109 && outcome.targetRows===1 && outcome.checksumMatches===1 &&
        outcome.unfinished===1 && outcome.zeroAppliedSteps===1 &&
        (observation.markerInFailedLedger||observation.markerInPrismaStdout||
         observation.markerInPrismaStderr||observation.markerInPostgres),"PAYMENT_RETAINED_WRONG_FAILURE");
      const afterClone=await jsonSql(inspect,target);
      need(afterClone.databaseOid===beforeClone.databaseOid &&
        afterClone.systemIdentifier===beforeClone.systemIdentifier &&
        afterClone.ledger.length===110 && equal(afterClone.ledger.slice(0,109),beforeClone.ledger) &&
        afterClone.ledger[109].name===migration && afterClone.ledger[109].sha256===checksum &&
        afterClone.ledger[109].finished===false && afterClone.ledger[109].rolledBack===false,
        "PAYMENT_RETAINED_PARTIAL_LEDGER");
      need(observation.originalRollbackColumns===0,"PAYMENT_RETAINED_PARTIAL_COLUMNS");
      need(equal(await jsonSql(catalogSql,target),beforeObjects),"PAYMENT_RETAINED_PARTIAL_OBJECTS");
    } finally {
      await sql(`DROP DATABASE ${target.database};`,{database:"postgres"});
    }
    const evidence={case:row.label,marker:row.expectedMarker,rollback:true,cloneRemoved:true};
    negatives.push(evidence);
    onCase(evidence);
  }
  return {identity:before,negatives};
}
module.exports={load,verifyFacts,verifyPrefix};
