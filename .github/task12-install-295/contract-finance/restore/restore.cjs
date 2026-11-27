'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {pgDumpArgs,classifyArchive}=require('./archive-contract.cjs');
const {key,operatingVerifier,operatingContext}=require('./technical-relations.json');
const {legacy,successor,textDirect,expense346,expense349,signed350,company352}=require('./restore-profile.cjs');
const {paymentRowsSql,paymentRows,paymentCatalogChecks}=require('./text-direct-330.cjs');
const {scope,exactCatalog,catalogSql}=require('./successor.cjs');
const notice=require('./terminal.cjs');
const payout=require('./payout-terminal.cjs');
const multi=require('./multi-witness.cjs');
const noticeWitness='jg_fund_balance_notice_witness';
const {readBusinessHistory,validateHistory}=require('./business-readback.cjs');
const {restoreFailure}=require('./restore-diagnostic.cjs');
const {dataOnlyList,namedDataArgs}=require('./named-data.cjs');
const restoreDb='contract_restored';
const owner='jg_task01_owner', backupRole='contract_backup', bankRuntime='contract_runtime';
const simple=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
const quote=name=>{assert.match(name,simple);return '"'+name+'"';};
const originalBackupGuard=fs.readFileSync(path.join(__dirname,'backup-original.sql'),'utf8');
const coverage="AND ((c.relkind IN ('r', 'p', 'm') AND NOT has_table_privilege(current_user, c.oid, 'SELECT'))";
assert.equal(originalBackupGuard.split(coverage).length,2);
const diagnosticGuard=profile=>originalBackupGuard.replace(coverage,
  "AND ((c.relkind IN ('r', 'p', 'm') AND NOT (n.nspname='public' AND c.relname IN ("+profile.sqlnames+"))"+
  " AND NOT has_table_privilege(current_user, c.oid, 'SELECT'))");

function connection(context,credentials,expectedTree) {
  const endpoint=new URL(context.ownerUrl);
  const ca=endpoint.searchParams.get('sslcert');
  assert.equal(context.candidateTree,expectedTree);
  assert.equal(context.database,'jg_task01_'+context.runId.replaceAll('-',''));
  assert.match(context.database,/^jg_task01_[a-f0-9]{32}$/u);
  assert.equal(endpoint.hostname,'127.0.0.1');
  assert.equal(endpoint.username,owner);
  assert.equal(endpoint.pathname,'/'+context.database);
  assert.equal(endpoint.searchParams.get('sslaccept'),'strict');
  assert.equal(ca,path.join(context.workDir,'ca.crt'));
  const secrets={[owner]:decodeURIComponent(endpoint.password),
    [backupRole]:credentials.backupPassword,[bankRuntime]:credentials.runtimePassword};
  if(Object.values(secrets).some(secret=>typeof secret!=='string'||!/^[a-zA-Z0-9-]{32,256}$/u.test(secret)))
    throw new Error('BACKUP292_CREDENTIAL_IDENTITY');
  return function invoke(role,db,bin,args,stdin,negative,phase){
    assert.ok(Object.hasOwn(secrets,role)&&[context.database,restoreDb].includes(db));
    assert.ok(['psql','pg_dump','pg_restore'].includes(bin));
    const child=spawnSync(bin,args,{input:stdin,timeout:180000,maxBuffer:4*1024*1024,encoding:'utf8',
      cwd:context.workDir,env:{
        PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin',LANG:'C',LC_ALL:'C',
        PGHOST:'127.0.0.1',PGPORT:endpoint.port,PGUSER:role,PGPASSWORD:secrets[role],PGDATABASE:db,
        PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGCONNECT_TIMEOUT:'5',PGAPPNAME:'jg-isolated-backup-restore-292',
      }});
    if(negative){
      if(child.error||child.status===0||!negative.test(child.stderr??''))throw new Error('BACKUP292_EXPECTED_DENIAL');
      return;
    }
    if(child.error||child.status!==0){
      const sqlstate=/(?:ERROR|FATAL):\s*([0-9A-Z]{5}):/u.exec(child.stderr??'')?.[1];
      throw Object.assign(new Error('BACKUP292_'+bin.toUpperCase()),{exit:child.status,sqlstate,
        ...(phase?{restoreDiagnostic:restoreFailure(child.stderr??'',phase,child.status)}:{})});
    }
    return child.stdout.trim();
  };
}

function sqlRunner(invoke) {
  return (role,db,sql,negative)=>invoke(role,db,'psql',['-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-f','-'],sql,negative);
}
function instanceProof(sql,db) {
  const proof=JSON.parse(sql(owner,db,`
    SELECT jsonb_build_object('system',ctl.system_identifier::text,'oid',d.oid::text,
      'port',inet_server_port(),'tls',COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false))
    FROM pg_control_system() ctl CROSS JOIN pg_database d
    WHERE d.datname=current_database() AND d.datname='${db}' AND current_user='${owner}'
      AND current_user=session_user AND inet_client_addr()='127.0.0.1'::inet
      AND inet_server_addr()='127.0.0.1'::inet;`));
  assert.ok(/^[0-9]+$/u.test(proof.system)&&/^[0-9]+$/u.test(proof.oid)&&
    Number.isSafeInteger(proof.port)&&proof.tls,'BACKUP292_INSTANCE_IDENTITY');
  return proof;
}

function catalogTables(sql,db,{technical,addedBusiness}) {
  const rows=JSON.parse(sql(owner,db,`
    SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind)
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
      AND c.relkind IN ('r','p','m','f');`));
  assert.ok(rows.length>100&&rows.length<1000&&rows.every(row=>row.schema==='public'&&simple.test(row.name)&&row.kind==='r'),'BACKUP292_CATALOG_PROFILE');
  const names=rows.map(row=>row.name);
  assert.ok(technical.every(name=>names.includes(name)),'BACKUP292_PRIVATE_RELATIONS_MISSING');
  const business=names.filter(name=>!technical.includes(name));
  assert.ok(addedBusiness.every(name=>business.includes(name)),'BACKUP320_NEW_BUSINESS_RELATIONS');
  return business;
}
function technicalIntegrity(sql,db,expectedKeyRows,{technical,emptyBindings,sqlnames}) {
  const ownerOnly=JSON.parse(sql(owner,db,`
    SELECT jsonb_build_object('privateCount',count(*),
      'ownerOnly',bool_and(c.relowner=10 AND NOT EXISTS (
        SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner)
        AND NOT EXISTS(SELECT FROM pg_attribute p CROSS JOIN LATERAL aclexplode(p.attacl) a
          WHERE p.attrelid=c.oid AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))),
      'namedReadDenied',bool_and(NOT EXISTS(
        SELECT FROM pg_roles r WHERE r.rolname IN ('contract_runtime','contract_backup') AND
        (has_table_privilege(r.oid,c.oid,'SELECT') OR has_any_column_privilege(r.oid,c.oid,'SELECT')))))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (${sqlnames});`));
  assert.deepEqual(ownerOnly,{privateCount:technical.length,ownerOnly:true,namedReadDenied:true},'BACKUP292_PRIVATE_ACL');
  const emptiness=emptyBindings.map(name=>'NOT EXISTS(SELECT FROM public.'+quote(name)+')').join(' AND ');
  const stats=JSON.parse(sql(owner,db,`SELECT jsonb_build_object('bindingsEmpty',${emptiness},
    'keyCount',(SELECT count(*) FROM public.${quote(key)}),
    'keyShape',NOT EXISTS(SELECT FROM public.${quote(key)} WHERE NOT singleton OR octet_length("key")<>32));`));
  assert.equal(stats.bindingsEmpty,true,'BACKUP292_UNEXPECTED_PRIVATE_PAYLOAD');
  assert.equal(stats.keyShape,true,'BACKUP292_KEY_SHAPE');
  assert.ok(expectedKeyRows.includes(stats.keyCount),'BACKUP292_KEY_ROW_COUNT');
  return stats;
}

function businessFingerprint(sql,db,relations) {
  // Isolated fixture only: owner compares row digests without returning data values.
  // Deterministic C ordering plus JSONB preserves row multiplicity and nulls.
  const query=relations.map((name,index)=>`SELECT ${index} AS ordinal,count(*) AS total,
    encode(sha256(convert_to(coalesce(string_agg(row_data,E'\\n' ORDER BY row_data COLLATE "C"),''),'UTF8')),'hex') AS digest
    FROM (SELECT to_jsonb(data_row)::text AS row_data FROM public.${quote(name)} data_row) rows`).join(' UNION ALL ');
  const entries=JSON.parse(sql(owner,db,`SELECT jsonb_agg(to_jsonb(t) ORDER BY ordinal) FROM (${query}) t;`));
  assert.equal(entries.length,relations.length);
  return entries;
}

function requiredHistory(sql,db) {
  const result=JSON.parse(sql(owner,db,`
    SELECT jsonb_build_object('bankObservations',(
      SELECT count(*) FROM public."ContractBankVerificationRequest" WHERE status='confirmed' AND "observationId" IS NOT NULL),
      'historicalDebtTransfers',(SELECT count(*) FROM public."CompanyTransfer" t WHERE t.kind='loan'
        AND EXISTS (SELECT FROM public."CompanyTransferEvent" e WHERE e."transferId"=t.id AND e.kind='outgoing')
        AND EXISTS (SELECT FROM public."CompanyTransferEvent" e WHERE e."transferId"=t.id AND e.kind='incoming')),
      'settlements',(SELECT count(*) FROM public."Settlement"),
      'pendingRounds',(SELECT count(*) FROM public."FundAccountBalanceRegistration" r
        JOIN public."ApprovalInstance" a ON a.id=r."approvalInstanceId"
        WHERE r.kind='correction' AND r.status='pending_review'
          AND a."businessType"='fund_account_balance_registration' AND a."flowType"='fund_account_balance_correction'
          AND a.status='approval_pending')); `));
  assert.ok(Object.values(result).every(n=>Number.isSafeInteger(n)&&n>0),'BACKUP292_REQUIRED_HISTORY_MISSING');
  return result;
}

function verifyNamedAccess(sql,db,profile) {
  for(const role of [backupRole,bankRuntime]){
    const check=sql(role,db,`SELECT current_database()='${db}' AND current_user='${role}'
      AND session_user=current_user AND current_user <> '${owner}'
      AND EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
      AND has_function_privilege(current_user,'public.issue_contract_bank_holder(text,text,text,text,text,text)','EXECUTE') IS ${role===bankRuntime?'TRUE':'FALSE'};`);
    assert.equal(check,'t','BACKUP292_NAMED_IDENTITY');
    for(const relation of [key,noticeWitness]){
      sql(role,db,`SELECT 1 FROM public.${quote(relation)} LIMIT 1;`,/42501:[^\n]*permission denied/u);
    }
  }
  sql(backupRole,db,"SELECT public.issue_contract_bank_holder('missing','missing','missing','missing','missing','missing');",
    /42501:[^\n]*permission denied for function issue_contract_bank_holder/u);
  sql(backupRole,db,diagnosticGuard(profile));
}

function provisionRestoredKey(sql,db,source) {
  const keyBytes=randomBytes(32);
  const hex=keyBytes.toString('hex');
  // Only the bootstrap owner receives this value over its local TLS session.
  assert.equal(sql(owner,source,`SELECT NOT EXISTS(SELECT FROM public.${quote(key)} WHERE "key"=decode('${hex}','hex'));`),
    't','BACKUP292_FRESH_KEY_REUSED');
  sql(owner,db,`INSERT INTO public.${quote(key)} (singleton,"key") VALUES (true,decode('${hex}','hex'));`);
  return keyBytes;
}

function operatingState(sql,db) {
  return JSON.parse(sql(owner,db,`
    SELECT jsonb_build_object('verifiers',(SELECT count(*) FROM public.${quote(operatingVerifier)}),
      'contextRows',(SELECT count(*) FROM public.${quote(operatingContext)}),
      'validVerifiers',NOT EXISTS(SELECT FROM public.${quote(operatingVerifier)}
        WHERE id<>1 OR length("secretHash")<>60));
  `));
}

function rebuildOperatingVerifier(sql,db) {
  // Synthetic fixture only. PostgreSQL generates and confines the input in the
  // owner transaction; no plaintext or verifier goes to the runner or receipt.
  sql(owner,db,`
    BEGIN;
    DO $backup292_rebuild$
    DECLARE
      fixture_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
      synthetic_actor constant text := 'jg-isolated-backup-restore-292';
    BEGIN
      IF EXISTS(SELECT FROM public."OperatingLedgerWriteSecret")
          OR EXISTS(SELECT FROM public."OperatingLedgerWriteContext") THEN
        RAISE EXCEPTION 'BACKUP292_OPERATING_REBUILD_PREIMAGE';
      END IF;
      INSERT INTO public."OperatingLedgerWriteSecret" (id,"secretHash")
      VALUES (1,public.crypt(fixture_secret,public.gen_salt('bf')));
      BEGIN
        PERFORM public."authorizeOperatingLedgerWrite"(synthetic_actor,fixture_secret);
        PERFORM public."assertOperatingLedgerWriteContext"(synthetic_actor);
        -- Roll back the proof context while retaining the verifier.
        RAISE SQLSTATE 'JG292';
      EXCEPTION WHEN SQLSTATE 'JG292' THEN NULL;
      END;
      IF EXISTS(SELECT FROM public."OperatingLedgerWriteContext") THEN
        RAISE EXCEPTION 'BACKUP292_OPERATING_CONTEXT_SURVIVED';
      END IF;
    END
    $backup292_rebuild$;
    COMMIT;
  `);
  assert.deepEqual(operatingState(sql,db),
    {verifiers:1,contextRows:0,validVerifiers:true},'BACKUP292_OPERATING_DESTINATION_STATE');
}

function sequenceNames(sql,db) {
  const items=JSON.parse(sql(owner,db,`
    SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname COLLATE "C"),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S';`));
  assert.ok(items.every(name=>simple.test(name)),'BACKUP292_SEQUENCE_INVENTORY');
  return items;
}

function verifyTargetImportAcl(sql, tables, sequences, active, {sqlnames}) {
  const expected=active?'TRUE':'FALSE';
  const reply=sql(owner,restoreDb,`
    SELECT current_database()='contract_restored' AND EXISTS(
      SELECT FROM pg_roles r
      WHERE r.rolname='contract_backup' AND r.rolcanlogin AND NOT (
        r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
        AND NOT EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid))
      AND NOT has_schema_privilege('contract_backup','public','CREATE')
      AND NOT EXISTS (
        SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','S') AND
          (c.relowner='contract_backup'::regrole::oid OR
           CASE WHEN c.relkind='S' THEN
            has_sequence_privilege('contract_backup',c.oid,'UPDATE') IS DISTINCT FROM ${expected}
            OR has_sequence_privilege('contract_backup',c.oid,'UPDATE WITH GRANT OPTION')
           ELSE
            has_table_privilege('contract_backup',c.oid,'INSERT') IS DISTINCT FROM
              (${expected} AND c.relname NOT IN (${sqlnames}))
            OR has_any_column_privilege('contract_backup',c.oid,'INSERT') IS DISTINCT FROM
              (${expected} AND c.relname NOT IN (${sqlnames}))
            OR has_any_column_privilege('contract_backup',c.oid,'INSERT WITH GRANT OPTION')
            OR has_table_privilege('contract_backup',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege('contract_backup',c.oid,'UPDATE,REFERENCES') END))
      AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN (${sqlnames}))=${tables.length}
      AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S')=${sequences.length};`);
  assert.equal(reply,'t','BACKUP292_TARGET_IMPORT_ACL');
}

function importAsNamedBackup(sql,invoke,tables,sequences,dataArchive,dataList,profile) {
  const {sqlnames}=profile;
  const tablesSql=tables.map(name=>'public.'+quote(name)).join(',');
  const sequencesSql=sequences.map(name=>'public.'+quote(name)).join(',');
  const constraints=sql(owner,restoreDb,`
    SELECT NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN (${sqlnames})
        AND (c.relrowsecurity OR c.relforcerowsecurity OR EXISTS(
          SELECT FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))); `);
  assert.equal(constraints,'t','BACKUP292_DATA_PRELOAD_GUARDS');
  verifyTargetImportAcl(sql,tables,sequences,false,profile);
  sql(owner,restoreDb,`BEGIN;
    GRANT CONNECT ON DATABASE contract_restored TO contract_backup;
    GRANT USAGE ON SCHEMA public TO contract_backup;
    GRANT INSERT ON TABLE ${tablesSql} TO contract_backup;
    ${sequences.length?`GRANT UPDATE ON SEQUENCE ${sequencesSql} TO contract_backup;`:''}
    COMMIT;`);
  try {
    verifyTargetImportAcl(sql,tables,sequences,true,profile);
    assert.equal(sql(backupRole,restoreDb,`
      SELECT current_database()='contract_restored' AND current_user='contract_backup'
        AND session_user=current_user AND inet_client_addr()='127.0.0.1'::inet
        AND inet_server_addr()='127.0.0.1'::inet
        AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl);`),
      't','BACKUP292_NAMED_DATA_TLS');
    invoke(backupRole,restoreDb,'pg_restore',namedDataArgs(restoreDb,dataArchive,dataList),
      undefined,undefined,'BUSINESS_DATA');
  }finally{
    sql(owner,restoreDb,`BEGIN;
      REVOKE INSERT ON TABLE ${tablesSql} FROM contract_backup;
      ${sequences.length?`REVOKE UPDATE ON SEQUENCE ${sequencesSql} FROM contract_backup;`:''}
      COMMIT;`);
  }
  verifyTargetImportAcl(sql,tables,sequences,false,profile);
  return {role:backupRole,tls:true,restoredTables:tables.length,restoredSequences:sequences.length,targetWritesRevoked:true};
}

async function restoreBusinessDatabase(context,credentials,enter,forward320,textDirectInputs) {
  const expenseSource=textDirectInputs?.expenseSource;
  const company=expenseSource?.migrationCount===352;
  const signed=company||expenseSource?.migrationCount===350;
  const precision=signed||expenseSource?.migrationCount===349;
  const profile=company?company352:signed?signed350:precision?expense349:expenseSource?expense346:textDirectInputs?textDirect:forward320?successor:legacy;
  assert.equal([330,331,332,334,346,349,350,352].includes(forward320?.count),Boolean(textDirectInputs),'BACKUP330_PAYMENT_PREIMAGE_REQUIRED');
  assert.equal([346,349,350,352].includes(forward320?.count),Boolean(expenseSource),'BACKUP346_SOURCE_REQUIRED');
  if(expenseSource) assert.equal(forward320.count,expenseSource.migrationCount,'BACKUP_EXPENSE_SOURCE_COUNT');
  const expectedTree=forward320?.sourceTree ?? scope.tree;
  assert.match(expectedTree,/^[a-f0-9]{40}$/u);
  const {technical}=profile;
  assert.equal(typeof enter,'function','BACKUP292_STAGE_RECORDER_REQUIRED');
  const {database:source}=context;
  const invoke=connection(context,credentials,expectedTree);
  const sql=sqlRunner(invoke);
  const stage=context.workDir;
  const sourceInstance=instanceProof(sql,source);
  const originalOperating=operatingState(sql,source);
  assert.equal(originalOperating.verifiers,1,'BACKUP292_SOURCE_OPERATING_VERIFIER');
  assert.equal(originalOperating.validVerifiers,true,'BACKUP292_SOURCE_OPERATING_VERIFIER_SHAPE');
  const beforeKeys=technicalIntegrity(sql,source,[1],profile);
  const business=catalogTables(sql,source,profile);
  const history=requiredHistory(sql,source);
  const expectedHistory=readBusinessHistory(statement=>sql(owner,source,statement));
  validateHistory(expectedHistory);
  const before=businessFingerprint(sql,source,business);
  let paymentChecks;
  if(textDirectInputs) {
    const {terminal}=textDirectInputs;
    paymentChecks=paymentCatalogChecks(fs.readFileSync('/qualification/current320/migrations/'+terminal.name+'/migration.sql'),
      terminal.sha256);
  }
  const paymentProof=paymentChecks?readTextDirect330(source):undefined;
  const paymentRemainderProof=textDirectInputs?.paymentRemainder?readPaymentRemainder331(source):undefined;
  const historical=[334,346,349,350,352].includes(forward320?.count)?require('./historical-settlement-334-profile.cjs'):undefined;
  const exact=expenseSource?require('./exact-'+expenseSource.migrationCount+'.cjs'):undefined;
  const precisionProfile=precision?require('./expense-witness-349-profile.cjs'):undefined;
  const expense=expenseSource?require('./expense-witness-346-profile.cjs'):undefined;
  const signedProfile=signed?require('./signed-settlement-350-profile.cjs'):undefined;
  function readUpwardArchive332(db) {
    const ledger = JSON.parse(sql(owner,db,`SELECT jsonb_agg(jsonb_build_object(
      'name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,
      'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM public._prisma_migrations;`))
      .map(({name,sha256,finished,rolledBack})=>({name,sha256,finished,rolledBack}));
    const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    assert.equal(ledger.length,forward320.count,'BACKUP_UPWARD_LEDGER_COUNT');
    assert.equal(digest(ledger),forward320.ledgerSha256,'BACKUP_UPWARD_LEDGER_DIGEST');
    if(exact) exact.assertLedger(ledger,expenseSource);
    const ledgerSha256=digest(ledger.slice(0,332));
    if(historical) {
      assert.equal(ledgerSha256,historical.predecessor332,'BACKUP334_UPWARD_PREFIX');
      assert.equal(digest(ledger.slice(0,333)),require('./historical-takeover-333-profile.cjs').ledgerSha256,'BACKUP334_HISTORICAL_PREFIX');
    }
    const postimages = JSON.parse(sql(owner,db,`SELECT jsonb_object_agg(p.proname,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
      FROM pg_proc p WHERE p.oid IN (
        to_regprocedure('public.jg_upward_archive_catalog_projection_v2()'),
        to_regprocedure('public.jg_upward_direct_archive_admission_v1()'));`));
    assert.deepEqual(postimages,{
      jg_upward_archive_catalog_projection_v2:'486032556ec79adeaaf134eace64e6348cbf667abf3f9a7ba38e29176ebe2cc7',
      jg_upward_direct_archive_admission_v1:'0a647f271a6ff2ec4bdf776c7a4950b26c4885babe980e08dec0182b2c1bae30'
    },'BACKUP332_UPWARD_ARCHIVE_POSTIMAGES');
    return {ledgerSha256,postimages};
  }
  const upwardArchiveProof=[332,334,346,349,350,352].includes(forward320?.count)?readUpwardArchive332(source):undefined;
  function readHistoricalSettlement334(db) {
    const previous=require('./historical-takeover-333-profile.cjs');
    const checks=JSON.parse(sql(owner,db,previous.catalogSql));
    previous.assertCatalog(checks,true);
    const catalog=JSON.parse(sql(owner,db,historical.catalogSql));
    // Restoring the same SQL creates new object OIDs. Compare bodies and portable ACL/catalog metadata.
    const comparable=Object.fromEntries(Object.entries(catalog).map(([name,{oid,...row}])=>[name,row]));
    return {checks,catalog,comparable};
  }
  const historicalProof=historical?readHistoricalSettlement334(source):undefined;
  function readExpense346(db) {
    const catalog=JSON.parse(sql(owner,db,expense.catalogSql));
    const cash=JSON.parse(sql(owner,db,expense.cashSql));
    expense.assertCash(cash);
    return {catalog,cash};
  }
  const expenseProof=expense?readExpense346(source):undefined;
  const readPrecision = db => JSON.parse(sql(owner,db,precisionProfile.catalogSql));
  const precisionProof=precision?readPrecision(source):undefined;
  const readCompanyCatalog = db => JSON.parse(sql(owner,db,`SELECT jsonb_build_object(
    'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::jsonb)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('CompanyHistoryExpenseBatch','CompanyHistoryExpenseRow','CompanyHistoryExpenseFact')),
    'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN ('CompanyHistoryExpenseBatch','CompanyHistoryExpenseRow','CompanyHistoryExpenseFact')),
    'functions', (SELECT coalesce(jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)),'{}'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('jg_company_history_expense_immutable','jg_require_company_transfer_settled_return_refund'))
  );`));
  const companyProof=company?readCompanyCatalog(source):undefined;
  if(company) {
    assert.equal(Object.keys(companyProof.functions).length,2,'BACKUP352_FUNCTIONS_PRESENT');
    assert.ok(companyProof.constraints.length>0 && companyProof.triggers.length>=2,'BACKUP352_GUARDS_PRESENT');
  }

  if(precision) assert.deepEqual(precisionProof,textDirectInputs.precisionCatalog,'BACKUP349_SOURCE_PRECISION_CATALOG');
  function readPaymentRemainder331(db) {
    const proof=JSON.parse(sql(owner,db,`SELECT jsonb_build_object(
      'historicalRowsUnchanged', NOT EXISTS(SELECT FROM public."PaymentRequest" WHERE "remainingWithdrawnCents" IS NOT NULL),
      'validatedConstraint', (SELECT convalidated FROM pg_catalog.pg_constraint
        WHERE conrelid='public."PaymentRequest"'::regclass AND conname='PaymentRequest_remaining_withdrawn_cents_check'),
      'enabledGuards', (SELECT coalesce(jsonb_agg(jsonb_build_array(t.tgname,p.proname,p.prosecdef) ORDER BY t.tgname), '[]'::jsonb)
        FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
        WHERE t.tgenabled='O' AND (
          (t.tgrelid='public."PaymentRequest"'::regclass AND t.tgname='PaymentRequest_remaining_withdrawal_guard') OR
          (t.tgrelid='public."PaymentExecution"'::regclass AND t.tgname='PaymentExecution_withdrawn_remainder_guard')))
    );`));
    assert.deepEqual(proof,{historicalRowsUnchanged:true,validatedConstraint:true,enabledGuards:[
      ['PaymentExecution_withdrawn_remainder_guard','jg_guard_withdrawn_payment_execution_v1',true],
      ['PaymentRequest_remaining_withdrawal_guard','jg_guard_payment_remaining_withdrawal_v1',false]
    ]});
    return proof;
  }
  function readTextDirect330(db) {
    const historical=paymentRows(sql(owner,db,paymentRowsSql(true)),true);
    assert.deepEqual(historical,textDirectInputs.historical,'BACKUP330_HISTORICAL_PAYMENTS_CHANGED');
    return {historical,ddlAclSha256:paymentChecks.parse(sql(owner,db,paymentChecks.sql)),
      ...(paymentChecks.allocationWriterSha256?{allocationWriterSha256:paymentChecks.allocationWriterSha256}:{})};
  }
  function verifyTextDirect330NamedDenials(db) {
    for (const role of [backupRole,bankRuntime]) {
      sql(role,db,"SELECT * FROM public.jg_read_text_payment_agreement_v1('missing','missing','missing','missing');",
        /42501:[^\n]*permission denied for function jg_read_text_payment_agreement_v1/u);
      if(paymentChecks.allocationWriterSha256) {
        sql(role,db,"SELECT public.jg_append_text_payment_allocation_v1('missing');",
          /42501:[^\n]*permission denied for function jg_append_text_payment_allocation_v1/u);
      }
    }
  }
  assert.equal(sql(owner,source,`SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname='${restoreDb}');`),'t','BACKUP292_DESTINATION_EXISTS');

  const readBaseline=sql(owner,source,`SELECT NOT EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND (
      (c.relkind IN ('r','p','m') AND
        (has_table_privilege('contract_backup',c.oid,'SELECT') OR has_any_column_privilege('contract_backup',c.oid,'SELECT')))
      OR (c.relkind='S' AND has_sequence_privilege('contract_backup',c.oid,'SELECT'))));`);
  assert.equal(readBaseline,'t','BACKUP292_BACKUP_READ_PREIMAGE');
  const readTargets=business.map(name=>'public.'+quote(name)).join(',');
  const dataArchive=path.join(stage,'contract-business.dump');
  const technicalArchive=path.join(stage,'owner-technical-schema.dump');
  const dataList=path.join(stage,'named-business-data.list');
  const sequences=sequenceNames(sql,source);
  assert.equal(business.length,profile.businessCount,'BACKUP294_BUSINESS_TABLE_COUNT');
  assert.deepEqual(sequences,['PersonnelChange_sequence_seq'],'BACKUP294_SEQUENCE_COUNT');
  const sequenceSnapshot=(db)=>sql(owner,db,`SELECT last_value::text,is_called FROM public.${quote(sequences[0])};`);
  const originalSequence=sequenceSnapshot(source);
  function verifySuccessorCatalogs(db){
    const noticeCatalog=JSON.parse(sql(owner,db,notice.catalogSql));
    const payoutCatalog=JSON.parse(sql(owner,db,payout.catalogSql));
    assert.equal(notice.exact(noticeCatalog),true,'BACKUP294_NOTICE_OWNER_ONLY');
    assert.equal(payout.valid(payoutCatalog),true,'BACKUP294_PAYOUT_OWNER_ONLY');
    const multiCatalog=JSON.parse(sql(owner,db,multi.catalogSql));
    assert.equal(multi.valid(multiCatalog,true),true,'BACKUP295_WITNESS_OWNER_ONLY');
  }
  verifySuccessorCatalogs(source);
  assert.ok(!fs.existsSync(dataArchive)&&!fs.existsSync(technicalArchive)&&!fs.existsSync(dataList),'BACKUP292_ARCHIVE_PREIMAGE');
  const outline=(role,file)=>invoke(role,source,'pg_restore',['--list',file]);
  let restoredKey, granted=false, created=false;
  try {
    // The original role receives complete read access to the verified business
    // inventory only. The exact no-read roles and tables are separately checked.
    sql(owner,source,`BEGIN;
      GRANT SELECT ON TABLE ${readTargets} TO ${backupRole};
      GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${backupRole};
      COMMIT;`);
    granted=true;
    verifyNamedAccess(sql,source,profile);
    if (paymentProof) verifyTextDirect330NamedDenials(source);
    for(const table of technical){
      sql(backupRole,source,`SELECT 1 FROM public.${quote(table)} LIMIT 1;`,/42501:[^\n]*permission denied/u);
    }
    invoke(backupRole,source,'pg_dump',pgDumpArgs(source,dataArchive,'business',profile));
    const dataToc=outline(backupRole,dataArchive);
    const dataCount=classifyArchive(dataToc,business,'business',profile);
    fs.writeFileSync(dataList,dataOnlyList(dataToc,business,sequences),{mode:0o600,flag:'wx'});
    invoke(owner,source,'pg_dump',pgDumpArgs(source,technicalArchive,'owner-schema',profile));
    const technicalCount=classifyArchive(outline(owner,technicalArchive),technical,'owner-schema',profile);
    assert.deepEqual(businessFingerprint(sql,source,business),before,'BACKUP292_SOURCE_CHANGED_DURING_EXPORT');
    technicalIntegrity(sql,source,[beforeKeys.keyCount],profile);
    sql(owner,source,`CREATE DATABASE ${restoreDb} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';`);
    created=true;
    sql(owner,source,`REVOKE ALL ON DATABASE ${restoreDb} FROM PUBLIC;`);
    const options=['--dbname',restoreDb,'--exit-on-error','--single-transaction'];
    let namedDataImport;
    for (const [label,section,file] of [
      ['BUSINESS_PRE_DATA','pre-data',dataArchive],
      ['BUSINESS_DATA','data',dataArchive],
      ['BUSINESS_POST_DATA','post-data',dataArchive],
      ['OWNER_PRE_DATA','pre-data',technicalArchive],
      ['OWNER_POST_DATA','post-data',technicalArchive],
    ]) {
      enter('BACKUP292_RESTORE_'+label);
      if(label==='BUSINESS_DATA'){
        namedDataImport=importAsNamedBackup(sql,invoke,business,sequences,dataArchive,dataList,profile);
      }else{
        invoke(owner,restoreDb,'pg_restore',[...options,'--section='+section,file],undefined,undefined,label);
      }
    }
    const restoredInstance=instanceProof(sql,restoreDb);
    assert.ok(restoredInstance.system===sourceInstance.system && restoredInstance.port===sourceInstance.port &&
      restoredInstance.oid!==sourceInstance.oid,'BACKUP292_SAME_INSTANCE_REQUIRED');
    technicalIntegrity(sql,restoreDb,[0],profile);
    verifyTargetImportAcl(sql,business,sequences,false,profile);
    assert.deepEqual(catalogTables(sql,restoreDb,profile),business,'BACKUP292_RESTORED_TABLES');
    assert.deepEqual(sequenceNames(sql,restoreDb),sequences,'BACKUP294_RESTORED_SEQUENCE_INVENTORY');
    assert.equal(sequenceSnapshot(restoreDb),originalSequence,'BACKUP294_RESTORED_SEQUENCE_VALUE');
    assert.equal(sequenceSnapshot(source),originalSequence,'BACKUP294_SOURCE_SEQUENCE_CHANGED');
    verifySuccessorCatalogs(restoreDb);
    assert.deepEqual(businessFingerprint(sql,restoreDb,business),before,'BACKUP292_RESTORED_BUSINESS_FINGERPRINT');
    assert.deepEqual(requiredHistory(sql,restoreDb),history,'BACKUP292_RESTORED_HISTORICAL_CLASSES');
    sql(owner,restoreDb,`GRANT CONNECT ON DATABASE ${restoreDb} TO ${backupRole},${bankRuntime};`);
    verifyNamedAccess(sql,restoreDb,profile);
    restoredKey=provisionRestoredKey(sql,restoreDb,source);
    rebuildOperatingVerifier(sql,restoreDb);
    assert.deepEqual(operatingState(sql,source), originalOperating, 'BACKUP292_SOURCE_OPERATING_STATE_CHANGED');
    assert.deepEqual(businessFingerprint(sql,restoreDb,business),before,'BACKUP292_REKEY_CHANGED_BUSINESS');
    technicalIntegrity(sql,restoreDb,[1],profile);
    const shape=JSON.parse(sql(owner,restoreDb,catalogSql));
    assert.equal(shape.keyUnprovisioned,false,'BACKUP292_REKEY_NOT_INSTALLED');
    assert.equal(exactCatalog({...shape,keyUnprovisioned:true}),true,'BACKUP292_RESTORED_BALANCE_CATALOG');
    const probes=validateHistory(readBusinessHistory(statement=>sql(owner,restoreDb,statement)),expectedHistory);
    verifyNamedAccess(sql,restoreDb,profile);
    if (paymentProof) {
      assert.deepEqual(readTextDirect330(restoreDb),paymentProof,'BACKUP330_RESTORED_PAYMENT_CATALOG');
      assert.deepEqual(readTextDirect330(source),paymentProof,'BACKUP330_SOURCE_PAYMENT_CATALOG');
      verifyTextDirect330NamedDenials(restoreDb);
    }
    if(paymentRemainderProof){
      assert.deepEqual(readPaymentRemainder331(restoreDb),paymentRemainderProof);
      assert.deepEqual(readPaymentRemainder331(source),paymentRemainderProof);
    }
    if(upwardArchiveProof) {
      assert.deepEqual(readUpwardArchive332(restoreDb),upwardArchiveProof);
      assert.deepEqual(readUpwardArchive332(source),upwardArchiveProof);
    }
    if(historicalProof) {
      const restored=readHistoricalSettlement334(restoreDb);
      const unchangedSource=readHistoricalSettlement334(source);
      assert.deepEqual(restored.checks,historicalProof.checks,'BACKUP334_RESTORED_HISTORICAL_CHECKS');
      assert.deepEqual(restored.comparable,historicalProof.comparable,'BACKUP334_RESTORED_SETTLEMENT_CATALOG');
      assert.deepEqual(unchangedSource,historicalProof,'BACKUP334_SOURCE_SETTLEMENT_CATALOG');
    }
    if(expenseProof) {
      const restored=readExpense346(restoreDb);
      assert.deepEqual(exact.portableCatalog(restored.catalog),exact.portableCatalog(expenseProof.catalog),'BACKUP346_RESTORED_CATALOG');
      assert.deepEqual(restored.cash,expenseProof.cash,'BACKUP346_RESTORED_CASH_WITNESS');
      assert.deepEqual(readExpense346(source),expenseProof,'BACKUP346_SOURCE_CATALOG_UNCHANGED');
    }
    if(precision) {
      exact.assertRestoredCatalog(precisionProof,readPrecision(restoreDb));
      assert.deepEqual(readPrecision(source),precisionProof,'BACKUP349_SOURCE_PRECISION_CATALOG_UNCHANGED');
    }
    if(signedProfile) {
      const readSigned = db => JSON.parse(sql(owner,db,signedProfile.catalogSql));
      exact.assertRestoredSignedCatalog(textDirectInputs.signedCatalog,readSigned(restoreDb));
      assert.deepEqual(readSigned(source),textDirectInputs.signedCatalog,'BACKUP350_SOURCE_SIGNED_CATALOG_UNCHANGED');
    }
    if(company) {
      assert.deepEqual(readCompanyCatalog(restoreDb),companyProof,'BACKUP352_RESTORED_COMPANY_CATALOG');
      assert.deepEqual(readCompanyCatalog(source),companyProof,'BACKUP352_SOURCE_COMPANY_CATALOG_UNCHANGED');
    }
    if (forward320) {
      for (const role of [backupRole,bankRuntime])
        for (const table of profile.technical)
          sql(role,restoreDb,`SELECT 1 FROM public.${quote(table)} LIMIT 1;`,/42501:[^\n]*permission denied/u);
    }
    for (const role of [backupRole,bankRuntime]) {
      for (const table of [operatingVerifier,operatingContext])
        sql(role,restoreDb,`SELECT 1 FROM public.${quote(table)} LIMIT 1;`,/42501:[^\n]*permission denied/u);
    }
    assert.equal(namedDataImport.restoredSequences,1,'BACKUP294_NAMED_SEQUENCE_NOT_IMPORTED');
    return {namedDataImport, noticeWitness:{ownerSchemaOnly:true,emptyBeforeAndAfter:true,namedReadDenied:true},
      sequenceReadback:true, samePostgresInstance:true, operatingVerifierRecovery:{ownerRebuilt:true,protectedFromNamedRoles:true,
      preparedContextRolledBack:true,sourceStatePreserved:true,businessPreserved:true},
      businessTables:dataCount.tables,restoredDataPayloads:dataCount.payloads,
      protectedTables:technicalCount.tables,protectedPayloads:technicalCount.payloads,
      history,sourceKeyRows:beforeKeys.keyCount,ownerOnlyRekeyed:true,namedNegativeTests:true,probes,
      ...(paymentRemainderProof?{paymentRemainder331:paymentRemainderProof}:{}),
      ...(upwardArchiveProof?{upwardArchive332:{...upwardArchiveProof,sourceAndRestoredMatched:true}}:{}),
      ...(historicalProof?{historicalSettlement334:{ledgerSha256:historical.ledgerSha256,sourceAndRestoredMatched:true}}:{}),
      ...(expenseProof?{['expense'+forward320.count]:{ledgerSha256:forward320.ledgerSha256,sourceAndRestoredMatched:true,
        ...(precision?{precisionCatalogMatched:true}:{}),
        ...(signed?{signedCatalogMatched:true}:{}),
        ...(company?{companyCatalogMatched:true}:{})}}:{}),
      ...(paymentProof?{textDirect330:{...paymentProof,oldColumnProjectionMatched:true,newColumnNull:true,
        sourceAndRestoredCatalogMatched:true,sourceAndRestoredNamedExecutionDenied:true}}:{})};
  } finally {
    restoredKey?.fill(0);
    try {
      if(created) sql(owner,source,`DROP DATABASE ${restoreDb};`);
    }finally{
      if(granted){
        sql(owner,source,`BEGIN;
          REVOKE SELECT ON TABLE ${readTargets} FROM ${backupRole};
          REVOKE SELECT ON ALL SEQUENCES IN SCHEMA public FROM ${backupRole};
          COMMIT;`);
        technicalIntegrity(sql,source,[beforeKeys.keyCount],profile);
      }
      for(const file of [dataArchive,technicalArchive,dataList]){
        if(fs.existsSync(file))fs.unlinkSync(file);
      }
    }
  }
}
module.exports={restoreBusinessDatabase};
