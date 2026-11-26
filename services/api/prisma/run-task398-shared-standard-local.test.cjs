"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const {runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,signatureBindingCheckSql,approvalDependencyCheckSql,businessReadGrantSql,cleanupOwnedContainer,containerName}=require("./run-task398-shared-standard-local.cjs");
const {createCiDynamicMigrationFixture}=require("./local-staged-ci-dynamic.cjs");

test("names the uniquely labelled container within the existing staged migration policy",()=>{
 const runId="11111111-2222-4333-8444-555555555555",name=containerName(runId);
 assert.equal(name,"jiangkong-task398-shared-11111111222243338444555555555555");
 assert.match(name,/^jiangkong-[a-z0-9-]+$/u);
 assert.doesNotThrow(()=>createCiDynamicMigrationFixture({ciFixture:"DYNAMIC_PAYMENT_EXECUTION_V1",container:{id:"a".repeat(64),name,runId},databaseNames:["jiangkong_payment_execution_concurrency"],temporaryRoot:"/private/tmp/task398-synthetic",dockerCommand:()=>{},deploy:()=>{}}));
 assert.throws(()=>containerName("not-a-run-id"),/TASK398_RUN_ID/u);
});

test("the isolated shared role composes existing cash and voucher plans without granting direct ledger writes",()=>{
 const plan=runtimePlan(),row=name=>plan.runtime.tables.find(item=>item.table===name);
 for(const name of ["OperatingLedgerWriteSecret","OperatingLedgerWriteContext","RegisteredContractHistoryRevision"])assert.equal(row(name),undefined);
 for(const name of ["OperatingFact","OperatingImpactEntry"]){assert.deepEqual(row(name).insert,[]);assert.deepEqual(row(name).update,[]);}
 assert.deepEqual(row("ApprovalInstance").update,["currentNodeIndex","frozenNodes","status","updatedAt"]);
 assert.ok(row("User").update.includes("signatureFileId"));
 assert.ok(row("RegisteredPaymentVoucher").insert.includes("executionId"));
 assert.ok(row("BusinessEntrySubmissionSnapshot").insert.includes("sceneKey"));
 assert.deepEqual(row("ContractDraftAttachment").select,["fileId","slotKey"]);
 assert.deepEqual(row("ContractDraftAttachment").insert,[]);assert.deepEqual(row("ContractDraftAttachment").update,[]);
 assert.deepEqual(row("ContractTakeoverCorrection").select,["attachmentFileId","correctionType","schemaVersion"]);
 assert.deepEqual(row("ContractTakeoverCorrection").insert,[]);assert.deepEqual(row("ContractTakeoverCorrection").update,[]);
 for(const [table,columns] of [["FundExecutionCase",["approvalInstanceId","auditAction"]],["PaymentExecutionPayerAttestation",["reauthorizationApprovalInstanceId"]],["ProjectFinancingQuotaUsage",["amountCents","paymentRequestId","status"]]]){
  for(const column of columns)assert.ok(row(table)?.select.includes(column),`${table}.${column}`);
  assert.deepEqual(row(table).insert,[]);assert.deepEqual(row(table).update,[]);
  const physicalApproval=approvalDependencyCheckSql();
  for(const column of columns)assert.ok(physicalApproval.includes(`has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT')`));
  assert.ok(physicalApproval.includes(`NOT has_table_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`));
  assert.ok(physicalApproval.includes(`NOT has_any_column_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,REFERENCES')`));
 }
 const signatureCheck=signatureBindingCheckSql();
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','fileId','SELECT'\)/u);
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','slotKey','SELECT'\)/u);
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
 assert.match(signatureCheck,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','INSERT,UPDATE,REFERENCES'\)/u);
 for(const column of ["attachmentFileId","correctionType","schemaVersion"])assert.ok(signatureCheck.includes(`has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','${column}','SELECT')`));
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractTakeoverCorrection"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
 assert.match(signatureCheck,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ContractTakeoverCorrection"','INSERT,UPDATE,REFERENCES'\)/u);
 const sql=columnGrants(plan);assert.doesNotMatch(sql,/GRANT (?:SELECT|INSERT|UPDATE) ON ALL TABLES/u);assert.doesNotMatch(sql,/\bxmin\b/u);
 assert.equal(technicalDeleteGrant(plan),'GRANT DELETE ON public."AuthRateLimit" TO jg_task01_runtime;');
 const missing=structuredClone(plan);delete missing.runtime.technicalAuthRateLimitDelete;assert.throws(()=>technicalDeleteGrant(missing),/TASK398_AUTH_RATE_DELETE/u);
 missing.runtime.technicalAuthRateLimitDelete=false;assert.throws(()=>technicalDeleteGrant(missing),/TASK398_AUTH_RATE_DELETE/u);
 const physical=technicalDeleteCheckSql();
 assert.match(physical,/has_table_privilege\('jg_task01_runtime','public\."AuthRateLimit"','DELETE'\)/u);
 assert.match(physical,/c\.oid<>'public\."AuthRateLimit"'::regclass/u);
 assert.match(physical,/NOT EXISTS[\s\S]*has_table_privilege\('jg_task01_runtime',c\.oid,'DELETE'\)/u);
 assert.match(physical,/NOT EXISTS[\s\S]*has_table_privilege\('jg_task01_observer',c\.oid,'DELETE'\)/u);
 assert.throws(()=>columnGrants({runtime:{tables:[{table:'x;DROP',select:['id'],insert:[],update:[]}]}}),/TASK398_IDENTIFIER/u);
});

test("the signature guard can read each schema-backed candidate in the migration registry",()=>{
 const plan=runtimePlan(),migrationRoot=path.join(__dirname,"migrations"),schema=fs.readFileSync(path.join(__dirname,"schema.prisma"),"utf8");
 const models=new Map([...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)].map(match=>[match[1],match[2]]));
 const businessReferences=new Set(["ContractSignedChange.appendixFormalFileId","SignedContractSettlementAttachment.fileId"]);
 const grant=businessReadGrantSql();
 const rule=/WHERE n\.nspname='public' AND c\.relkind IN \('r','p'\) AND NOT \(c\.relname = ANY\(ARRAY\[([^\]]+)\]\) OR c\.relname ~\* '([^']+)' OR EXISTS\(SELECT FROM information_schema\.columns col WHERE col\.table_schema=n\.nspname AND col\.table_name=c\.relname AND col\.column_name ~\* '([^']+)'\)\)/u.exec(grant);
 assert.ok(rule,"runtime business read filter");
 assert.match(grant,/EXECUTE format\('GRANT SELECT ON TABLE public\.%I TO jg_task01_runtime',r\.relname\)/u);
 const excludedTables=new Set([...rule[1].matchAll(/'([^']+)'/gu)].map(match=>match[1]));
 const sensitiveTable=new RegExp(rule[2],"iu"),sensitiveColumn=new RegExp(rule[3],"iu");
 for(const directory of fs.readdirSync(migrationRoot)){
  const file=path.join(migrationRoot,directory,"migration.sql");if(!fs.existsSync(file))continue;
  const source=fs.readFileSync(file,"utf8");if(!source.includes("jg_file_business_binding_columns"))continue;
  for(const match of source.matchAll(/\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*(?:TRUE|FALSE)/giu)){
   if(directory==="20261118185000_project_owner_settlement_voucher_binding" && match[1]==="ProjectOwnerSettlementEntry" && match[2]==="voucherFileId"){
    assert.ok(source.includes("binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id)"));
    assert.ok(source.includes("REVOKE ALL ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT) FROM PUBLIC"));
    const fixtureGrant=fs.readFileSync(path.join(__dirname,"contract-bank-runtime-fixture.cjs"),"utf8");
    assert.ok(fixtureGrant.includes("GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns_before_owner_settlement(), public.jg_project_owner_settlement_voucher_bound(pg_catalog.text) TO %I"));
    const acl=fs.readFileSync(path.join(__dirname,"prepared/task30/project-owner-settlement-voucher-runtime.sql"),"utf8");
    assert.ok(acl.includes("GRANT EXECUTE ON FUNCTION public.jg_project_owner_settlement_voucher_bound(TEXT)"));
    assert.ok(!plan.runtime.tables.find(row=>row.table===match[1])?.select.includes(match[2]));
    continue;
   }
   const [,table,column]=match;
   const reference=table+"."+column;
   if(directory==="20261119007500_signed_change_and_settlement_attachment_file_binding" && businessReferences.delete(reference)){
    const model=models.get(table);
    assert.ok(model,reference);
    const fields=[...model.matchAll(/^\s+(\w+)\s+\S+/gmu)].map(field=>field[1]);
    assert.ok(fields.includes(column),reference);
    assert.ok(!excludedTables.has(table) && !sensitiveTable.test(table) && !fields.some(name=>sensitiveColumn.test(name)),reference);
    continue;
   }
   if(models.has(table))assert.ok(plan.runtime.tables.find(row=>row.table===table)?.select.includes(column),directory+": "+reference);
  }
 }
 assert.deepEqual([...businessReferences],[],"missing signed archive registry references");
 const original=fs.readFileSync(path.join(migrationRoot,"20260728132000_contract_takeover_correction_ledger","migration.sql"),"utf8");
 const guard=original.slice(original.indexOf("CREATE OR REPLACE FUNCTION jg_has_exclusive_file_business_binding"),original.indexOf("CREATE OR REPLACE FUNCTION jg_enforce_exclusive_file_business_binding"));
 const start=guard.indexOf("AS $$")+5,end=guard.indexOf("$$;",start);
 assert.equal(createHash("sha256").update(guard.slice(start,end)).digest("hex"),"2dd031c00d7774dc6ff29376b6bd3f1b4a23579ac19f2a2c76e40ee788deb6c7");
 for(const column of ["attachmentFileId","correctionType","schemaVersion"])assert.ok(guard.includes(`"${column}"`));
 const rewrite=fs.readFileSync(path.join(migrationRoot,"20261109100000_contract_direct_pending_input_v1","migration.sql"),"utf8");
 assert.ok(rewrite.includes('FROM public."ContractDraftAttachment" WHERE "fileId"=candidate_file_id AND "slotKey"='));
 assert.ok(plan.runtime.tables.find(row=>row.table==="RegisteredPaymentVoucher").select.includes("fileId"));
 const requirements=require("./task16-current259-voucher-acl.requirements.json");
 for(const routine of requirements.routineSources)assert.ok(plan.runtime.functions.includes(routine.signature));
 assert.match(require("./contract-bank-runtime-fixture.cjs").renderTask398FileGuardGrant(),/jg_has_exclusive_file_business_binding/u);
});

test("approval trigger and quota lookup dependencies match the restricted read plan",()=>{
 const plan=runtimePlan(),migrations=path.join(__dirname,"migrations"),fields=(table,columns)=>{
  const row=plan.runtime.tables.find(item=>item.table===table);for(const column of columns)assert.ok(row?.select.includes(column),`${table}.${column}`);
 };
 const fund=fs.readFileSync(path.join(migrations,"20260831120000_pol13d_fund_execution_v7","migration.sql"),"utf8");
 for(const name of ["guard_fund_execution_approval_instance_freeze_immutable","guard_fund_execution_approval_action_freeze_immutable"]){
  const start=fund.indexOf(`CREATE FUNCTION ${name}()`),end=fund.indexOf("$$ LANGUAGE plpgsql;",start);assert.ok(start>=0&&end>start);
  const body=fund.slice(start,end);for(const column of ["approvalInstanceId","auditAction"])assert.ok(body.includes(`"${column}"`));
 }
 fields("FundExecutionCase",["approvalInstanceId","auditAction"]);
 const payer=fs.readFileSync(path.join(migrations,"20260828080000_pol13b_payer_authority_and_relation_guards","migration.sql"),"utf8");
 assert.match(payer,/TG_TABLE_NAME = 'ApprovalInstance'[\s\S]*?"reauthorizationApprovalInstanceId" = OLD\."id"/u);
 fields("PaymentExecutionPayerAttestation",["reauthorizationApprovalInstanceId"]);
 const service=fs.readFileSync(path.join(__dirname,"../src/payment/payment-request.service.ts"),"utf8");
 const start=service.indexOf("private async financingUsageTotals("),end=service.indexOf("\n  private ",start+1);assert.ok(start>=0&&end>start);
 const lookup=service.slice(start,end);for(const column of ["paymentRequestId","status","amountCents"])assert.ok(lookup.includes(column));
 // Same-version Prisma probe showed the projection also reads its primary key.
 fields("ProjectFinancingQuotaUsage",["id","paymentRequestId","status","amountCents"]);
 const sql=approvalDependencyCheckSql();assert.ok(sql.includes('public."ProjectFinancingQuotaUsage"'));assert.ok(sql.includes('NOT has_column_privilege(\'jg_task01_runtime\',\'public."ProjectFinancingQuotaUsage"\',\'id\',\'SELECT WITH GRANT OPTION\')'));
});

test("resolves a lost launch ID by exact name and run label, without touching other containers",()=>{
 const id="a".repeat(64),other="b".repeat(64),calls=[];
 const scope={name:"jg398-shared-example",runId:"synthetic-run",list:()=>[id],inspect:()=>({id,name:"jg398-shared-example",runId:"synthetic-run"}),remove:value=>calls.push(value),confirmAbsent:()=>true};
 assert.equal(cleanupOwnedContainer({...scope,id:undefined}),"REMOVED");assert.deepEqual(calls,[id]);
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,list:()=>[]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,inspect:()=>({id,name:scope.name,runId:"other"})}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[other]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[id,other]}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,list:()=>{throw new Error("lookup failure");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,inspect:()=>{throw new Error("inspect failure");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,list:()=>[]}),"ABSENT");
 assert.equal(cleanupOwnedContainer({...scope,id:undefined,remove:()=>{throw new Error("unknown");}}),"UNKNOWN");
 assert.equal(cleanupOwnedContainer({...scope,id,remove:()=>{},confirmAbsent:()=>false}),"UNKNOWN");
 assert.deepEqual(calls,[id]);
});

test("approval server log extracts only one directly attributed permission object",()=>{
 const {classify}=require("./task398-approval-postgres-error.cjs");
 const before="old private value\n",prefix="JG398|jg398_runtime|jiangkong_payment_execution_concurrency|123|";
 const line=prefix+'42501|ERROR:  permission denied for table "SpotProcurementPayment"\n';
 assert.equal(classify(before,before+line),"TABLE_070");
 for(const after of [before,before+line+line,before+line.trimEnd(),before+prefix+'23505|ERROR:  permission denied for table "SpotProcurementPayment"\n',before+'SQL: permission denied for table "SpotProcurementPayment"\n',before+prefix+'42501|ERROR:  permission denied for table "SecretPrivate"\n',before+prefix+'42501|ERROR:  permission denied for table "SpotProcurementPayment" private value\n'])assert.equal(classify(before,after),"UNKNOWN");
 assert.equal(classify("unrelated\n",before+line),"UNKNOWN");
});

test("private log write failure is unknown and never emits raw text",()=>{
 const {finish}=require("./task398-approval-postgres-error.cjs");
 assert.equal(finish("before\n","before\nprivate data\n",{TASK398_LOG_FILE:"/nonexistent/task398-log"}),"UNKNOWN");
});

test("approval guard project lookup has only required spot payment reads",()=>{
 const {spotGuardCheckSql}=require("./run-task398-shared-standard-local.cjs");
 const row=runtimePlan().runtime.tables.find(item=>item.table==="SpotProcurementPayment");
 for(const column of ["id","projectId"])assert.ok(row.select.includes(column));
 assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);
 const guard=fs.readFileSync(path.join(__dirname,"../src/auth/guards/permission.guard.ts"),"utf8");
 assert.match(guard,/request\.params\?\.paymentId;[\s\S]*?spotAccess\.findPaymentProjectId\(paymentId\)/u);
 const access=fs.readFileSync(path.join(__dirname,"../src/spot-procurement/spot-procurement-access.service.ts"),"utf8");
 assert.match(access,/async findPaymentProjectId\(paymentId: string\)[\s\S]*?spotProcurementPayment\.findUnique\(\{\s*where: \{ id: paymentId \},\s*select: \{ projectId: true \}/u);
 const sql=spotGuardCheckSql();for(const part of ["'id','SELECT'","'projectId','SELECT'","SELECT WITH GRANT OPTION","NOT has_table_privilege","NOT has_any_column_privilege"])assert.ok(sql.includes(part));
});

test("approval delegation lookup has its exact read-only predicate and projection",()=>{
 const row=runtimePlan().runtime.tables.find(value=>value.table==="ApprovalDelegation");
 const columns=["id","toUserId","actionKey","resourceType","resourceId","enabled","startsAt","endsAt","fromUserId"];
 assert.deepEqual([...row.select].sort(),[...columns].sort());assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);
 const source=fs.readFileSync(path.join(__dirname,"../src/approval/active-approval-delegations.ts"),"utf8");
 const start=source.indexOf("export async function activeApprovalDelegatorIds"),end=source.indexOf("export async function activeScopedApprovalDelegatorIds");assert.ok(start>=0&&end>start);
 const query=source.slice(start,end);for(const column of columns.filter(value=>value!=="id"))assert.match(query,new RegExp(`\\b${column}\\b`,"u"));
 const guard=fs.readFileSync(path.join(__dirname,"../src/auth/guards/permission.guard.ts"),"utf8");assert.match(guard,/activeApprovalDelegatorIds\(delegationClient as ActiveApprovalDelegationClient, userId\)/u);
 const sql=approvalDependencyCheckSql();for(const col of columns){assert.ok(sql.includes(`'${col}','SELECT'`));assert.ok(sql.includes(`'${col}','SELECT WITH GRANT OPTION'`));}assert.match(sql,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ApprovalDelegation"','INSERT,UPDATE,REFERENCES'\)/u);
});


test("broad reads exclude secret and credential tables while retaining write restrictions",()=>{
 const {businessReadGrantSql,businessReadCheckSql,excludedReadTables}=require("./run-task398-shared-standard-local.cjs");
 for(const name of ["User","EmployeeRegistration","HandwrittenSignatureHandoff","RefreshToken","ContractDraftEditLease","SettlementDraft","Settlement","SettlementSignedDocument","SettlementSignedDocumentGenerationClaim","ApprovalFormGenerationClaim","AuthRateLimit","FileObject","OperatingLedgerWriteSecret","OperatingLedgerWriteContext","PaymentExecutionPayerVerificationIssuerContext"])assert.ok(excludedReadTables.includes(name));
 const schema=fs.readFileSync(path.join(__dirname,"schema.prisma"),"utf8");
 for(const name of ["User","EmployeeRegistration","HandwrittenSignatureHandoff","RefreshToken","ContractDraftEditLease","SettlementDraft","Settlement","SettlementSignedDocument","SettlementSignedDocumentGenerationClaim","ApprovalFormGenerationClaim"]){const match=new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`,"u").exec(schema);assert.ok(match,`${name} model`);assert.match(match[1],/password|token|credential/iu);}
 assert.match(businessReadGrantSql(),/information_schema\.columns/u);assert.match(businessReadGrantSql(),/col\.column_name ~\*/u);assert.match(businessReadCheckSql(),/information_schema\.columns/u);assert.match(businessReadGrantSql(),/GRANT SELECT ON TABLE/u);assert.match(businessReadCheckSql(),/SELECT WITH GRANT OPTION/u);assert.doesNotMatch(businessReadGrantSql(),/GRANT (INSERT|UPDATE|DELETE)/u);
});

test("observer reads only actual accounting tables and bounded signature columns",()=>{
 const {observerReadGrantSql,observerReadCheckSql,observerTables,observerSignatureColumns,excludedReadTables}=require("./run-task398-shared-standard-local.cjs");
 assert.deepEqual(observerSignatureColumns,["id","userId","fileId","contentSha256","source"]);
 for(const table of observerTables)assert.ok(!excludedReadTables.includes(table));
 assert.doesNotMatch(observerReadGrantSql(),/ALL TABLES|OperatingLedgerWriteSecret|RefreshToken|"User"/u);
 assert.match(observerReadGrantSql(),/GRANT SELECT \("id","userId","fileId","contentSha256","source"\)/u);
 const sql=observerReadCheckSql();for(const text of ["SELECT WITH GRANT OPTION","has_any_column_privilege","INSERT,UPDATE,REFERENCES","pg_catalog.pg_attribute"])assert.ok(sql.includes(text));
 const spec=fs.readFileSync(path.join(__dirname,"../src/database/task16-shared-standard.http.pg.spec.ts"),"utf8");
 for(const expression of ["observer.paymentRequest","observer.approvalInstance","observer.approvalActionLog","observer.handwrittenSignatureVersion","observer.paymentExecution","observer.registeredPaymentVoucher"])assert.ok(spec.includes(expression));
});

test("personal work items read only required settlement fields without tokens",()=>{
 const {meSensitiveReadCheckSql}=require("./run-task398-shared-standard-local.cjs"),plan=runtimePlan();
 for(const [table,required,forbidden] of [["SettlementDraft",["id","projectId","ownerUserId","status","updatedAt","periodLabel","code"],["sourceSnapshotToken"]],["SettlementSignedDocumentGenerationClaim",["id","settlementId","status","claimedAt","uploadedFileId","safeFailureCode"],["claimToken","businessSnapshotToken"]]]){
  const row=plan.runtime.tables.find(item=>item.table===table);for(const col of required)assert.ok(row.select.includes(col));for(const col of forbidden)assert.ok(!row.select.includes(col));assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);
 }
 const sql=meSensitiveReadCheckSql();for(const text of ["sourceSnapshotToken","claimToken","businessSnapshotToken","SELECT WITH GRANT OPTION","has_any_column_privilege"])assert.ok(sql.includes(text));
});

test("registered catalog uses migration owner while impact reader keeps its qualified owner",()=>{
 const source=fs.readFileSync(path.join(__dirname,"run-task398-shared-standard-local.cjs"),"utf8");
 assert.match(source,/sql\("jiangkong",`BEGIN;\\nSET LOCAL jg\.task16_runtime_role=[\s\S]*?\$\{files\.join/u);
 assert.match(source,/sql\("jg_task01_owner",`BEGIN;\\n\$\{impactReader\}/u);
 const impact=fs.readFileSync(path.join(__dirname,"prepared/task16-current259/registered-impact-reader.sql"),"utf8");
 assert.match(impact,/current_user <> 'jg_task01_owner' OR session_user <> 'jg_task01_owner'/u);
 const spec=fs.readFileSync(path.join(__dirname,"../src/database/task16-shared-standard.http.pg.spec.ts"),"utf8");
 assert.match(spec,/runtime\.\$transaction\(tx=>registeredPaymentInstalled\(tx\)\)/u);
});
test('browser and overpay modes are explicit and preserve standard selection',()=>{
 const {selectTask398Scenario}=require('./run-task398-shared-standard-local.cjs');
 assert.equal(selectTask398Scenario([]),'src/database/task16-shared-standard.http.pg.spec.ts');
 assert.equal(selectTask398Scenario(['--overpay-real']),'src/database/task16-shared-standard.http.pg.spec.ts');
 assert.equal(selectTask398Scenario(['--ledger-loss-real']),'src/database/task16-shared-standard.http.pg.spec.ts');
 assert.equal(selectTask398Scenario(['--cash-handover-real']),'src/database/task25-public-cash-handover.http.pg.spec.ts');
 assert.equal(selectTask398Scenario(['--browser-real']),'src/database/task16-real-browser.pg.spec.ts');
 assert.equal(selectTask398Scenario(['--browser-completion-real']),'src/database/task16-real-browser-completion.pg.spec.ts');
 assert.throws(()=>selectTask398Scenario(['--browser-real','--other']));
 assert.throws(()=>selectTask398Scenario(['--unknown']));
});
test('browser observer adds only the exact Settlement lookup columns and no other privileges',()=>{
 const {observerReadGrantSql,observerReadCheckSql}=require('./run-task398-shared-standard-local.cjs');
 const oldGrant=observerReadGrantSql(),browserGrant=observerReadGrantSql(true),oldCheck=observerReadCheckSql(),browserCheck=observerReadCheckSql(true);
 assert.equal(browserGrant,oldGrant+'\nGRANT SELECT ("id","paidAmountCents") ON public."Settlement" TO jg_task01_observer;');
 assert.doesNotMatch(oldGrant,/ON public\."Settlement"/u);assert.doesNotMatch(oldCheck,/'Settlement'\]::text\[\]/u);
 for(const part of ['public."Settlement"','paidAmountCents','attname <> ALL','SELECT WITH GRANT OPTION','INSERT,UPDATE,REFERENCES','has_table_privilege'])assert.ok(browserCheck.includes(part));
 assert.match(browserCheck,/c\.relname <> ALL\(ARRAY\[[^\]]*'Settlement'\]\)/u);
 assert.doesNotMatch(browserGrant,/GRANT (?:INSERT|UPDATE|DELETE|REFERENCES).*"Settlement"/u);
});

test('ledger loss adds only the exact debt witness columns to the browser observer matrix',()=>{
 const {observerReadGrantSql,observerReadCheckSql}=require('./run-task398-shared-standard-local.cjs');
 const debtGrant='GRANT SELECT ("id","paymentExecutionId","sourceType","entryKind","direction","status","originalDebtorCompanyId","creditorCompanyId","amountCents","projectId") ON public."InterEntityRelationshipEntry" TO jg_task01_observer;';
 assert.equal(observerReadGrantSql(true,true),observerReadGrantSql(true)+'\n'+debtGrant);
 assert.doesNotMatch(observerReadCheckSql(true),/InterEntityRelationshipEntry/u);
 const exact=observerReadCheckSql(true,true);
 assert.match(exact,/'public\."InterEntityRelationshipEntry"'::regclass/u);
 assert.match(exact,/has_column_privilege\([^)]*'SELECT'\) IS DISTINCT FROM \(a\.attname = ANY\(ARRAY\['id','paymentExecutionId','sourceType'/u);
});
