'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

const historicalColumns=['id','projectId','settlementId','sourceType','contractId','contractVersionId','paymentTermsVersionId',
  'paymentTermsStageId','code','status','requestedAmountCents','approvedAmountCents','paidAmountCents','paymentMatter',
  'amountCalculationExplanation','paymentSubjectType','dueDate','abandonedAt','abandonedByUserId','abandonReason','createdAt','updatedAt'];
const paymentRowsSql=includeNewColumn=>`
  SELECT jsonb_build_object('count',count(*),
    'sha256',encode(sha256(convert_to(coalesce(string_agg(row_data,E'\\n' ORDER BY row_data COLLATE "C"),''),'UTF8')),'hex')
    ${includeNewColumn?",'newColumnNull',coalesce(bool_and(\"contractDueBasis\" IS NULL),false)":''})
  FROM (SELECT jsonb_build_array(${historicalColumns.map(name=>'"'+name+'"').join(',')})::text AS row_data
    ${includeNewColumn?', "contractDueBasis"':''} FROM public."PaymentRequest") p;`;
function paymentRows(raw,includeNewColumn) {
  const result=JSON.parse(raw);
  assert.ok(Number.isSafeInteger(result.count)&&result.count>0,'BACKUP330_HISTORICAL_PAYMENT_REQUIRED');
  assert.match(result.sha256,/^[a-f0-9]{64}$/u);
  if(includeNewColumn) assert.equal(result.newColumnNull,true,'BACKUP330_HISTORICAL_NEW_COLUMN_NULL');
  return {count:result.count,sha256:result.sha256};
}

const originalRoutines=[
  ['jg_guard_payment_text_agreement_v1()','ad1a4d63d54439361a70aba1283c00577b41d86435e711c35883e883cc7167ef',false,false,false,'trigger'],
  ['jg_read_text_payment_agreement_v1(text,text,text,text)','19b590b39f0bc954449f1e882c6e8daf0deb89baef8b1697453e9073e7ca1aa2',true,true,true,'text'],
  ['jg_freeze_signed_payment_agreement_v1()','afc3ec3ce0ccd4e6985c1113247bf4e869b1bf31fd59230f1b6a78694bb944bf',true,false,false,'trigger'],
  ['jg_guard_approved_request_payment_allocation_v1()','e8b2350cfaaf33545eba96c6c1f287ff8f2e4ebf85055ceb08ef695c39baa786',false,false,false,'trigger']
];
const triggers=[
  ['PaymentRequest','jg_guard_payment_text_agreement','jg_guard_payment_text_agreement_v1',23,null],
  ['PaymentRequest','jg_freeze_signed_payment_agreement','jg_freeze_signed_payment_agreement_v1',5,null],
  ['PaymentExecutionAllocation','PaymentExecutionAllocation_direct_contract_stage_guard','guard_direct_contract_stage_allocation',7,'new."stageType" IS NOT NULL'],
  ['PaymentExecutionAllocation','jg_guard_approved_request_payment_allocation','jg_guard_approved_request_payment_allocation_v1',7,'new."stageType" IS NULL']
];
const checkNames=['PaymentRequest_text_agreement_shape_check','PaymentExecutionAllocation_settlement_required_check'];
const allocationWriter='jg_append_text_payment_allocation_v1';
const paymentCatalogSql=routines=>`
  WITH routines(signature,ordinal) AS (VALUES ${routines.map(([sig],i)=>"('public."+sig+"',"+i+")").join(',')}),
  triggers(relation,name,ordinal) AS (VALUES ${triggers.map(([relation,name],i)=>"('public.\""+relation+"\"'::regclass,'"+name+"',"+i+")").join(',')})
  SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
      c.relowner=10,pg_get_expr(ad.adbin,ad.adrelid)) ORDER BY c.relname,a.attname)
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      WHERE a.attnum>0 AND NOT a.attisdropped AND
        ((a.attrelid='public."PaymentRequest"'::regclass AND a.attname='contractDueBasis') OR
         (a.attrelid='public."PaymentExecutionAllocation"'::regclass AND a.attname='stageType'))),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid)) ORDER BY c.conname)
      FROM pg_constraint c WHERE
        (c.conrelid='public."PaymentRequest"'::regclass AND c.conname='${checkNames[0]}') OR
        (c.conrelid='public."PaymentExecutionAllocation"'::regclass AND c.conname='${checkNames[1]}')),
    'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,p.proname,t.tgtype,CASE WHEN t.tgqual IS NULL THEN NULL ELSE pg_get_triggerdef(t.oid) END,
      t.tgenabled='O' AND n.nspname='public' AND NOT t.tgisinternal) ORDER BY wanted.ordinal)
      FROM triggers wanted JOIN pg_trigger t ON t.tgrelid=wanted.relation AND t.tgname=wanted.name
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace),
    'routines',(SELECT jsonb_agg(jsonb_build_array(encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      p.prosecdef,p.proisstrict,p.proretset,format_type(p.prorettype,NULL),cardinality(p.proconfig)=1 AND regexp_replace(p.proconfig[1],'[[:space:]]','','g')='search_path=pg_catalog,public,pg_temp',
      p.proowner=10 AND l.lanname='plpgsql' AND p.provolatile=CASE WHEN p.proretset THEN 's' ELSE 'v' END::"char",
      NOT EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner),
      NOT EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN ('contract_backup','contract_runtime') AND
        has_function_privilege(r.oid,p.oid,'EXECUTE'))) ORDER BY wanted.ordinal)
      FROM routines wanted JOIN pg_proc p ON p.oid=to_regprocedure(wanted.signature) JOIN pg_language l ON l.oid=p.prolang)
  );`;

function paymentCatalog(raw,routines) {
  const catalog=JSON.parse(raw);
  assert.deepEqual(catalog.columns,[
    ['PaymentExecutionAllocation','stageType','text',false,true,null],
    ['PaymentRequest','contractDueBasis','text',false,true,null],
  ],'BACKUP330_PAYMENT_COLUMNS');
  assert.deepEqual(catalog.constraints.map(row=>row.slice(0,3)),
    [...checkNames].sort().map(name=>[name,'c',true]),'BACKUP330_PAYMENT_CONSTRAINTS');
  assert.match(catalog.constraints[0][3],/stageType.*IS NULL.*stageId.*IS NULL.*sourceEffectiveAt.*IS NULL/u);
  assert.match(catalog.constraints[1][3],/contractDueBasis.*IS NULL.*text_agreement_v1.*requestedAmountCents/u);
  assert.deepEqual(catalog.triggers.map(([table,name,routine,type,definition,active])=>
    [table,name,routine,type,definition?.match(/ WHEN \({1,2}(new\."stageType" IS (?:NOT )?NULL)\){1,2} EXECUTE FUNCTION /u)?.[1] ?? definition,active]),
    triggers.map(row=>[...row,true]),'BACKUP330_ACTIVE_PAYMENT_TRIGGERS');
  assert.deepEqual(catalog.routines,routines.map(row=>[...row.slice(1),true,true,true,true]),'BACKUP330_PAYMENT_ROUTINES_ACL');
  return sha256(JSON.stringify(catalog));
}

function paymentCatalogChecks(terminalSql,expectedSha256) {
  assert.equal(sha256(terminalSql),expectedSha256,'BACKUP330_PAYMENT_CATALOG_MIGRATION_INPUT');
  const sql=terminalSql.toString('utf8');
  const routines=[...originalRoutines];
  let allocationWriterSha256;
  if(sql.includes(allocationWriter)) {
    const definitions=[...sql.matchAll(/CREATE FUNCTION public\.jg_append_text_payment_allocation_v1\(execution_id text\) RETURNS void\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS \$\$([\s\S]*?)\$\$;/gu)];
    const revoke='REVOKE ALL ON FUNCTION public.jg_append_text_payment_allocation_v1(text) FROM PUBLIC;';
    assert.equal(definitions.length,1,'BACKUP330_PAYMENT_ALLOCATION_WRITER_SOURCE');
    assert.equal(sql.split(revoke).length,2,'BACKUP330_PAYMENT_ALLOCATION_WRITER_PUBLIC_DENY');
    allocationWriterSha256=sha256(definitions[0][1]);
    routines.push([allocationWriter+'(text)',allocationWriterSha256,true,false,false,'void']);
  }
  return {
    sql:paymentCatalogSql(routines),
    parse:raw=>paymentCatalog(raw,routines),
    allocationWriterSha256
  };
}

module.exports={paymentRowsSql,paymentRows,paymentCatalogChecks};
