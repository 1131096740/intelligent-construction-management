"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const {runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,signatureBindingCheckSql,approvalDependencyCheckSql,cleanupOwnedContainer,containerName}=require("./run-task398-shared-standard-local.cjs");
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
  assert.ok(physicalApproval.includes(`NOT has_table_privilege('jg_task01_runtime','public."${table}"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`));
  assert.ok(physicalApproval.includes(`NOT has_any_column_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,REFERENCES')`));
 }
 const signatureCheck=signatureBindingCheckSql();
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','fileId','SELECT'\)/u);
 assert.match(signatureCheck,/has_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','slotKey','SELECT'\)/u);
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
 assert.match(signatureCheck,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ContractDraftAttachment"','INSERT,UPDATE,REFERENCES'\)/u);
 for(const column of ["attachmentFileId","correctionType","schemaVersion"])assert.ok(signatureCheck.includes(`has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','${column}','SELECT')`));
 assert.match(signatureCheck,/NOT has_table_privilege\('jg_task01_runtime','public\."ContractTakeoverCorrection"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/u);
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
 const models=new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map(match=>match[1]));
 for(const directory of fs.readdirSync(migrationRoot)){
  const file=path.join(migrationRoot,directory,"migration.sql");if(!fs.existsSync(file))continue;
  const source=fs.readFileSync(file,"utf8");if(!source.includes("jg_file_business_binding_columns"))continue;
  for(const match of source.matchAll(/\(\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*'([A-Za-z][A-Za-z0-9_]*)'\s*,\s*(?:TRUE|FALSE)/giu)){
   if(models.has(match[1]))assert.ok(plan.runtime.tables.find(row=>row.table===match[1])?.select.includes(match[2]),`${directory}: ${match[1]}.${match[2]}`);
  }
 }
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
 fields("ProjectFinancingQuotaUsage",["paymentRequestId","status","amountCents"]);
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
 const columns=["toUserId","actionKey","resourceType","resourceId","enabled","startsAt","endsAt","fromUserId"];
 assert.deepEqual([...row.select].sort(),[...columns].sort());assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);
 const source=fs.readFileSync(path.join(__dirname,"../src/approval/active-approval-delegations.ts"),"utf8");
 const start=source.indexOf("export async function activeApprovalDelegatorIds"),end=source.indexOf("export async function activeScopedApprovalDelegatorIds");assert.ok(start>=0&&end>start);
 const query=source.slice(start,end);for(const column of columns)assert.match(query,new RegExp(`\\b${column}\\b`,"u"));
 const guard=fs.readFileSync(path.join(__dirname,"../src/auth/guards/permission.guard.ts"),"utf8");assert.match(guard,/activeApprovalDelegatorIds\(delegationClient as ActiveApprovalDelegationClient, userId\)/u);
 const sql=approvalDependencyCheckSql();for(const col of columns){assert.ok(sql.includes(`'${col}','SELECT'`));assert.ok(sql.includes(`'${col}','SELECT WITH GRANT OPTION'`));}assert.match(sql,/NOT has_any_column_privilege\('jg_task01_runtime','public\."ApprovalDelegation"','INSERT,UPDATE,REFERENCES'\)/u);
});
