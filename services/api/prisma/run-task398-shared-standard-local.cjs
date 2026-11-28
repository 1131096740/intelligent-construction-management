"use strict";

// Disposable local PG only. This runner has not been admitted for execution
// until its resource, role and payment-guard setup has been independently reviewed.
const {randomUUID,randomBytes}=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {mkdtempSync,readFileSync,rmSync,chmodSync,realpathSync,mkdirSync,writeFileSync}=require("node:fs");
const {tmpdir}=require("node:os");
const path=require("node:path");
const {createCommandRuntime}=require("./money-bigint-runner-runtime.cjs");
const {CI_DYNAMIC_MIGRATION_LABEL,createCiDynamicMigrationFixture}=require("./local-staged-ci-dynamic.cjs");
const {renderTask398FileGuardGrant}=require("./contract-bank-runtime-fixture.cjs");
const {CASH_WRITER_FUNCTIONS}=require("./task16-current261-cash-profile.cjs");
const {referenceGuardBody,versionGuardBody}=require("./task16-registered-access-check.cjs");
function containerName(id){
 if(typeof id!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id))throw new Error("TASK398_RUN_ID");
 return `jiangkong-task398-shared-${id.replaceAll("-","")}`;
}
const root=path.resolve(__dirname,"../../.."),db="jiangkong_payment_execution_concurrency",runId=randomUUID(),short=runId.replaceAll("-",""),name=containerName(runId);
const password=randomUUID(),secret=randomBytes(32).toString("hex");
let containerId,endpoint,storage,launchAttempted=false;
// Prisma findMany selects id internally even with the fromUserId-only projection.
const approvalReadDependencies=Object.freeze({ApprovalDelegation:["id","toUserId","actionKey","resourceType","resourceId","enabled","startsAt","endsAt","fromUserId"],FundExecutionCase:["approvalInstanceId","auditAction"],PaymentExecutionPayerAttestation:["reauthorizationApprovalInstanceId"],ProjectFinancingQuotaUsage:["id","amountCents","paymentRequestId","status"]});
function command(bin,args,{env=process.env,input,quiet=false,timeout=180000}={}){
 const result=spawnSync(bin,args,{cwd:root,env,input,encoding:"utf8",timeout,maxBuffer:32*1024*1024});
 const output=String(result.stdout??"")+String(result.stderr??"");
 if(!quiet||result.status!==0)process.stdout.write(output.replaceAll(password,"[redacted]").replaceAll(secret,"[redacted]"));
 if(result.error||result.status!==0)throw new Error(`TASK398_COMMAND_FAILED:${path.basename(bin)}:${args[0]}`);
 return String(result.stdout??"").trim();
}
function docker(args,options){return command("docker",["--host",endpoint,...args],options);}
function sql(user,text){return docker(["exec","-i",containerId,"psql","-X","-q","-v","ON_ERROR_STOP=1","-U",user,"-d",db,"-f","-"],{input:text,quiet:true});}
function runtimePlan(){
 let plan=JSON.parse(JSON.stringify(require("./task16-registered-access.json")));
 const add=(table,operation,columns)=>{let row=plan.runtime.tables.find(value=>value.table===table);if(!row){row={table,select:[],insert:[],update:[],references:[]};plan.runtime.tables.push(row);}row[operation]=[...new Set([...row[operation],...columns])].sort();};
 const manifest=require("./task16-current259-access.json");
 for(const item of manifest.runtimeSelectAdditions)add(item.table,"select",item.select);
 for(const [table,column] of manifest.normal261RuntimeInsertAdditions.columns)add(table,"insert",[column]);
 add("HistoricalFinancialTakeoverRowMapping","select",manifest.payment261OriginalResultDiscovery.select);
 plan=require("./task16-current261-cash-profile.cjs").cashAccessPlan(plan);
 plan=require("./task16-current259-voucher-acl.cjs").voucherNative261AccessPlan(plan);
 // The migrated exclusive-file guard reads both fields for retained originals.
 add("ContractDraftAttachment","select",["slotKey"]);
 // The same invoker guard checks the correction schema version for exclusivity.
 add("ContractTakeoverCorrection","select",["schemaVersion"]);
 for(const [table,columns] of Object.entries(approvalReadDependencies))add(table,"select",columns);
 // Me work-item projections and predicates; never grant snapshot or claim tokens.
 add("SettlementDraft","select",["id","projectId","ownerUserId","status","updatedAt","periodLabel","code"]);
 add("SettlementSignedDocumentGenerationClaim","select",["id","settlementId","status","claimedAt","uploadedFileId","safeFailureCode"]);
 add("SpotProcurementPayment","select",["id","projectId"]);
 add("User","update",["signatureFileId"]);add("PaymentRequest","update",["approvedAmountCents"]);add("ApprovalInstance","update",["currentNodeIndex","frozenNodes","status"]);
 delete plan.runtime.tables.find(row=>row.table==="ApprovalInstance").lockOnlyUpdate;
 const full={ApprovalActionLog:["id","approvalInstanceId","action","actorUserId","comment","metadata","approvedRoleKey","signatureFileIdSnapshot","signatureSha256Snapshot","signatureVersionIdSnapshot","representedUserId","createdAt"],HandwrittenSignatureVersion:["id","userId","fileId","contentSha256","source","createdAt"],BusinessEntrySubmissionSnapshot:["id","projectId","sceneKey","entityType","entityId","revision","definitionVersion","definitionSnapshot","valuesSnapshot","frozenAt","frozenByUserId","createdAt"]};
 for(const [table,columns] of Object.entries(full)){add(table,"select",columns);add(table,"insert",columns);}
 add("HandwrittenSignatureVersion","update",["createdAt"]);
 return plan;
}
function columnGrants(plan){
 const identifier=value=>{if(!/^[A-Za-z][A-Za-z0-9_]*$/u.test(value))throw new Error("TASK398_IDENTIFIER");return `"${value}"`;};
 return plan.runtime.tables.flatMap(row=>["select","insert","update"].flatMap(operation=>{
  const columns=row[operation].filter(column=>column!=="xmin");return columns.length?[`GRANT ${operation.toUpperCase()} (${columns.map(identifier).join(",")}) ON public.${identifier(row.table)} TO jg_task01_runtime;`]:[];
 })).join("\n");
}
function technicalDeleteGrant(plan){
 if(plan?.runtime?.technicalAuthRateLimitDelete!==true)throw new Error("TASK398_AUTH_RATE_DELETE");
 return 'GRANT DELETE ON public."AuthRateLimit" TO jg_task01_runtime;';
}
function technicalDeleteCheckSql(){
 return `has_table_privilege('jg_task01_runtime','public."AuthRateLimit"','DELETE')
 AND NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.oid<>'public."AuthRateLimit"'::regclass
   AND has_table_privilege('jg_task01_runtime',c.oid,'DELETE'))
 AND NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND has_table_privilege('jg_task01_observer',c.oid,'DELETE'))`;
}
function signatureBindingCheckSql(){
 return `has_column_privilege('jg_task01_runtime','public."ContractDraftAttachment"','fileId','SELECT')
 AND has_column_privilege('jg_task01_runtime','public."ContractDraftAttachment"','slotKey','SELECT')
 AND NOT has_column_privilege('jg_task01_runtime','public."ContractDraftAttachment"','fileId','SELECT WITH GRANT OPTION')
 AND NOT has_column_privilege('jg_task01_runtime','public."ContractDraftAttachment"','slotKey','SELECT WITH GRANT OPTION')
 AND NOT has_table_privilege('jg_task01_runtime','public."ContractDraftAttachment"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_any_column_privilege('jg_task01_runtime','public."ContractDraftAttachment"','INSERT,UPDATE,REFERENCES')
 AND has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','attachmentFileId','SELECT')
 AND has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','correctionType','SELECT')
 AND has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','schemaVersion','SELECT')
 AND NOT has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','attachmentFileId','SELECT WITH GRANT OPTION')
 AND NOT has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','correctionType','SELECT WITH GRANT OPTION')
 AND NOT has_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','schemaVersion','SELECT WITH GRANT OPTION')
 AND NOT has_table_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_any_column_privilege('jg_task01_runtime','public."ContractTakeoverCorrection"','INSERT,UPDATE,REFERENCES')`;
}
// Broad reads are limited to synthetic business tables in this disposable DB.
const excludedReadTables=["User","EmployeeRegistration","HandwrittenSignatureHandoff","RefreshToken","ContractDraftEditLease","SettlementDraft","Settlement","SettlementSignedDocument","SettlementSignedDocumentGenerationClaim","ApprovalFormGenerationClaim","AuthRateLimit","FileObject","OperatingLedgerWriteSecret","OperatingLedgerWriteContext","PaymentExecutionPayerVerificationIssuerContext","_prisma_migrations"];
function sensitiveReadTableSql(extraExcluded=[]){return `(c.relname = ANY(ARRAY[${[...excludedReadTables,...extraExcluded].map(x=>`'${x}'`).join(",")}]) OR c.relname ~* '(secret|token|credential|password|privatekey|context)' OR EXISTS(SELECT FROM information_schema.columns col WHERE col.table_schema=n.nspname AND col.table_name=c.relname AND col.column_name ~* '(secret|token|credential|password|privatekey)'))`;}
function businessReadGrantSql(extraExcluded=[]){return `DO $read$ DECLARE r record; BEGIN FOR r IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT ${sensitiveReadTableSql(extraExcluded)} LOOP EXECUTE format('GRANT SELECT ON TABLE public.%I TO jg_task01_runtime',r.relname); END LOOP; END $read$;`;}
function businessReadCheckSql(extraExcluded=[]){return `NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND ((${sensitiveReadTableSql(extraExcluded)} AND has_table_privilege('jg_task01_runtime',c.oid,'SELECT')) OR (NOT ${sensitiveReadTableSql(extraExcluded)} AND (NOT has_table_privilege('jg_task01_runtime',c.oid,'SELECT') OR has_table_privilege('jg_task01_runtime',c.oid,'SELECT WITH GRANT OPTION')))))`;}
// Observer reads only the tables asserted by the HTTP case; signatures have a column-only projection.
const observerTables=["PaymentRequest","ApprovalInstance","ApprovalActionLog","FundAccountBalanceRegistration","PaymentExecution","RegisteredPaymentEvent","RegisteredPaymentFunding","RegisteredFundPaymentAllocation","OperatingFact","OperatingImpactEntry","AuditLog","RegisteredPaymentVoucher"];
const observerSignatureColumns=["id","userId","fileId","contentSha256","source"];
const observerDebtColumns=["id","paymentExecutionId","sourceType","entryKind","direction","status","originalDebtorCompanyId","creditorCompanyId","amountCents","projectId"];
const transferObserverTables=["RegisteredFundTransfer","RegisteredFundTransferLine","RegisteredFundTransferAction","FundAccountSourceBatch"];
const handoverObserverTables=["RegisteredFundAccount","PublicCashCustody","PublicCashHandover","PublicCashHandoverReceipt"];
function observedTables(transfer,handover){
 return handover?[...observerTables,...transferObserverTables,...handoverObserverTables]:transfer?[...observerTables,...transferObserverTables]:observerTables;
}
function observerReadGrantSql(browser=false,ledgerLoss=false,transfer=false,handover=false){
 const sql=`GRANT SELECT ON ${observedTables(transfer,handover).map(name=>`public."${name}"`).join(",")} TO jg_task01_observer;\nGRANT SELECT (${observerSignatureColumns.map(name=>`"${name}"`).join(",")}) ON public."HandwrittenSignatureVersion" TO jg_task01_observer;`;
 return sql+(browser?'\nGRANT SELECT ("id","paidAmountCents") ON public."Settlement" TO jg_task01_observer;':'')+
  (ledgerLoss?`\nGRANT SELECT (${observerDebtColumns.map(name=>`"${name}"`).join(",")}) ON public."InterEntityRelationshipEntry" TO jg_task01_observer;`:'');
}
function observerReadCheckSql(browser=false,ledgerLoss=false,transfer=false,handover=false){const sql=`${observedTables(transfer,handover).map(name=>`has_table_privilege('jg_task01_observer','public."${name}"','SELECT')`).join(" AND ")} AND NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND ((c.relname = ANY(ARRAY[${observedTables(transfer,handover).map(x=>`'${x}'`).join(",")}]) AND ${sensitiveReadTableSql()}) OR has_table_privilege('jg_task01_observer',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('jg_task01_observer',c.oid,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('jg_task01_observer',c.oid,'SELECT WITH GRANT OPTION') OR (c.relname <> ALL(ARRAY[${observedTables(transfer,handover).map(x=>`'${x}'`).join(",")}]) AND has_table_privilege('jg_task01_observer',c.oid,'SELECT')))) AND NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."HandwrittenSignatureVersion"'::regclass AND a.attnum>0 AND NOT a.attisdropped AND ((a.attname = ANY(ARRAY[${observerSignatureColumns.map(x=>`'${x}'`).join(",")}]) AND NOT has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT')) OR (a.attname <> ALL(ARRAY[${observerSignatureColumns.map(x=>`'${x}'`).join(",")}]) AND has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT')) OR has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT WITH GRANT OPTION'))) AND NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> ALL(ARRAY[${observedTables(transfer,handover).map(x=>`'${x}'`).join(",")},'HandwrittenSignatureVersion']) AND has_any_column_privilege('jg_task01_observer',c.oid,'SELECT'))`;
 if(!browser)return sql;
 const allowed=sql.replace("'HandwrittenSignatureVersion']) AND has_any_column_privilege", "'HandwrittenSignatureVersion','Settlement'"+(ledgerLoss?",'InterEntityRelationshipEntry'":"")+"]) AND has_any_column_privilege");
 if(allowed===sql)throw new Error('TASK398_BROWSER_OBSERVER_POLICY');
 const settlement=allowed+` AND NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."Settlement"'::regclass AND a.attnum>0 AND NOT a.attisdropped AND ((a.attname = ANY(ARRAY['id','paidAmountCents']) AND NOT has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT')) OR (a.attname <> ALL(ARRAY['id','paidAmountCents']) AND has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT')) OR has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT WITH GRANT OPTION'))) AND NOT has_table_privilege('jg_task01_observer','public."Settlement"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_any_column_privilege('jg_task01_observer','public."Settlement"','INSERT,UPDATE,REFERENCES')`;
 if(!ledgerLoss)return settlement;
 const approved=`ARRAY[${observerDebtColumns.map(name=>`'${name}'`).join(",")}]`;
 return settlement+` AND NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."InterEntityRelationshipEntry"'::regclass AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT') IS DISTINCT FROM (a.attname = ANY(${approved})) OR has_column_privilege('jg_task01_observer',a.attrelid,a.attname,'SELECT WITH GRANT OPTION')))`;
}

function meSensitiveReadCheckSql(){
 const rows={SettlementDraft:{allowed:["id","projectId","ownerUserId","status","updatedAt","periodLabel","code"],denied:["sourceSnapshotToken"]},SettlementSignedDocumentGenerationClaim:{allowed:["id","settlementId","status","claimedAt","uploadedFileId","safeFailureCode"],denied:["claimToken","businessSnapshotToken"]}};
 return Object.entries(rows).flatMap(([table,row])=>[...row.allowed.flatMap(column=>[`has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT')`,`NOT has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT WITH GRANT OPTION')`]),...row.denied.map(column=>`NOT has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT')`),`NOT has_table_privilege('jg_task01_runtime','public."${table}"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,`NOT has_any_column_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,REFERENCES')`]).join(" AND ");
}
function spotGuardCheckSql(){
 return ["id","projectId"].flatMap(column=>[`has_column_privilege('jg_task01_runtime','public."SpotProcurementPayment"','${column}','SELECT')`,`NOT has_column_privilege('jg_task01_runtime','public."SpotProcurementPayment"','${column}','SELECT WITH GRANT OPTION')`]).concat([`NOT has_table_privilege('jg_task01_runtime','public."SpotProcurementPayment"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,`NOT has_any_column_privilege('jg_task01_runtime','public."SpotProcurementPayment"','INSERT,UPDATE,REFERENCES')`]).join(" AND ");
}
function approvalDependencyCheckSql(){
 return Object.entries(approvalReadDependencies).flatMap(([table,columns])=>[
  ...columns.flatMap(column=>[`has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT')`,`NOT has_column_privilege('jg_task01_runtime','public."${table}"','${column}','SELECT WITH GRANT OPTION')`]),
  `NOT has_table_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
  `NOT has_any_column_privilege('jg_task01_runtime','public."${table}"','INSERT,UPDATE,REFERENCES')`
 ]).join(" AND ");
}
function cleanupOwnedContainer({id,name,runId,list,inspect,remove,confirmAbsent}){
 try{
  if(id!==undefined&&!/^[a-f0-9]{64}$/u.test(id))return "UNKNOWN";
  const matches=list();if(!Array.isArray(matches)||matches.length>1)return "UNKNOWN";
  if(matches.length===0)return id?"ABSENT":"UNKNOWN";
  const candidate=matches[0];if(!/^[a-f0-9]{64}$/u.test(candidate)||(id&&candidate!==id))return "UNKNOWN";
  const observed=inspect(candidate);if(observed.id!==candidate||observed.name!==name||observed.runId!==runId)return "UNKNOWN";
  remove(candidate);return confirmAbsent(candidate)?"REMOVED":"UNKNOWN";
 }catch{return "UNKNOWN";}
}
function selectTask398Scenario(args){
 if(!Array.isArray(args)||args.length>1)throw new Error("TASK398_SCENARIO");
 if(args.length===0||["--overpay-real","--ledger-loss-real","--transfer-real","--transfer-rejection-real","--transfer-browser-real","--project-advance-real"].includes(args[0]))return "src/database/task16-shared-standard.http.pg.spec.ts";
 if(["--principal-return-real","--principal-return-roles-real"].includes(args[0]))return "src/database/task27-principal-return.http.pg.spec.ts";
 if(args[0]==="--company-proxy-repayment-real")return "src/database/company-proxy-repayment.http.pg.spec.ts";
 if(args[0]==="--cash-handover-real")return "src/database/task25-public-cash-handover.http.pg.spec.ts";
 if(args[0]==="--browser-real")return "src/database/task16-real-browser.pg.spec.ts";
 if(args[0]==="--browser-completion-real")return "src/database/task16-real-browser-completion.pg.spec.ts";
 throw new Error("TASK398_SCENARIO");
}
async function run(){
 const scenario=selectTask398Scenario(process.argv.slice(2));
 const overpayScenario=process.argv[2]==="--overpay-real";
 const ledgerLossScenario=process.argv[2]==="--ledger-loss-real";
 const transferRejection=process.argv[2]==="--transfer-rejection-real";
 const transferBrowser=process.argv[2]==="--transfer-browser-real";
 const handoverScenario=process.argv[2]==="--cash-handover-real";
 const advanceScenario=process.argv[2]==="--project-advance-real";
 const principalRoleCoverage=process.argv[2]==="--principal-return-roles-real";
 const principalScenario=process.argv[2]==="--principal-return-real"||principalRoleCoverage;
 const companyProxyScenario=process.argv[2]==="--company-proxy-repayment-real";
 const usesAdvanceRuntime=advanceScenario||principalScenario||companyProxyScenario;
 const advanceExcludedReads=usesAdvanceRuntime?["ProjectOwnerSettlementEntry"]:[];
 const transferScenario=process.argv[2]==="--transfer-real"||transferRejection||transferBrowser||handoverScenario||usesAdvanceRuntime;
 const browserScenario=scenario==="src/database/task16-real-browser.pg.spec.ts"||scenario==="src/database/task16-real-browser-completion.pg.spec.ts";
 if(process.env.NODE_ENV==="production"||process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 const candidate=process.env.TASK398_EXPECTED_SHA;
 if(!/^[a-f0-9]{40}$/u.test(candidate??"")||command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_EXACT_CLEAN_CANDIDATE_REQUIRED");
 storage=realpathSync(mkdtempSync(path.join(tmpdir(),"jg398-shared-")));chmodSync(storage,0o700);
 endpoint=process.env.DOCKER_HOST||command("docker",["context","inspect","--format","{{.Endpoints.docker.Host}}"],{quiet:true});
 if(!endpoint.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 launchAttempted=true;
 const launchedId=docker(["run","--detach","--rm","--pull=never","--name",name,"--label",`${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,"--env","POSTGRES_PASSWORD","--env","POSTGRES_USER=jiangkong", "--env",`POSTGRES_DB=${db}`,"--publish","127.0.0.1::5432","postgres:16","-c","log_destination=stderr","-c","logging_collector=off","-c","log_line_prefix=JG398|%a|%d|%p|%e|","-c","log_min_messages=error","-c",transferScenario?"log_error_verbosity=verbose":"log_error_verbosity=default","-c","log_statement=none","-c","log_min_error_statement=panic","-c","log_parameter_max_length_on_error=0"],{env:{...process.env,POSTGRES_PASSWORD:password},quiet:true});
 if(!/^[a-f0-9]{64}$/u.test(launchedId))throw new Error("TASK398_CONTAINER_ID");
 containerId=launchedId;
 const binding=docker(["port",containerId,"5432/tcp"],{quiet:true}),port=/^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];if(!port)throw new Error("TASK398_LOOPBACK_ONLY");
 docker(["exec",containerId,"sh","-c","for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d jiangkong_payment_execution_concurrency && exit 0; sleep 0.2; done; exit 1"],{quiet:true});
 const url=role=>`postgresql://${role}:${password}@127.0.0.1:${port}/${db}`;
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:storage,NODE_ENV:"test",CI:"true",DATABASE_URL:url("jiangkong"),FILE_STORAGE_DRIVER:"local",FILE_STORAGE_ROOT:storage,OPERATING_LEDGER_DB_WRITE_SECRET:secret,JWT_ACCESS_SECRET:randomBytes(32).toString("hex"),JWT_REFRESH_SECRET:randomBytes(32).toString("hex"),FILE_DOWNLOAD_SECRET:randomBytes(32).toString("hex"),SMS_ENABLED:"false",APPROVAL_SMS_ENABLED:"false",RUN_TASK398_SHARED_PG16:"1",TASK398_RUN_ID:short};
 const {command:stagedCommand}=createCommandRuntime({defaultCwd:root});
 const staged=path.join(storage,"staged");mkdirSync(staged,{mode:0o700});
 const fixture=createCiDynamicMigrationFixture({ciFixture:"DYNAMIC_PAYMENT_EXECUTION_V1",container:{id:containerId,name,runId},databaseNames:[db],temporaryRoot:staged,dockerCommand:(args,options)=>stagedCommand("docker",["--host",endpoint,...args],{...options,env:process.env}),deploy({databaseUrl,runtimeEnv,schemaPath}){const args=["--filter","@jiangkong/api","exec","prisma","migrate","deploy"];if(schemaPath)args.push("--schema",schemaPath);return {stdout:command("pnpm",args,{env:{...runtimeEnv,DATABASE_URL:databaseUrl},quiet:true})};}});
 await fixture.migrate({databaseUrl:env.DATABASE_URL,runtimeEnv:env});
 sql("jiangkong",`CREATE ROLE jg_task01_owner LOGIN SUPERUSER PASSWORD '${password}';\nCREATE ROLE jg_task01_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\nCREATE ROLE jg_task01_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\nALTER DATABASE ${db} SET jg.task398_run_id='${short}';\nALTER ROLE jg_task01_runtime SET application_name='jg398_runtime';`);
 sql("jiangkong",`GRANT USAGE ON SCHEMA public TO jg_task01_runtime,jg_task01_observer;\nGRANT INSERT ("fileId") ON public."HandwrittenSignatureVersion" TO jg_task01_runtime;\n${renderTask398FileGuardGrant()}`);
 const files=["registered-funding.sql","registered-history-revision.sql","registered-write-authority.sql","registered-canonical-proof.sql","registered-intercompany.sql","registered-canonical-adapter.sql","registered-voucher.sql"].map(file=>readFileSync(path.join(__dirname,"prepared/task16",file),"utf8"));
 // The seven-part catalog shares the migration owner's identity. The impact
 // reader has its own explicit owner/session preflight and remains separate.
 const transferFence=transferScenario?readFileSync(path.join(__dirname,"prepared/task24/registered-fund-transfer-payment-fence.sql"),"utf8"):"";
 sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${files.join("\n")}\nCOMMIT;`);
 const impactReader=readFileSync(path.join(__dirname,"prepared/task16-current259/registered-impact-reader.sql"),"utf8");
 sql("jg_task01_owner",`BEGIN;\n${impactReader}\nCOMMIT;`);
 const voucher=require("./task16-current259-voucher-acl.cjs").current259VoucherAcl();
 sql("jg_task01_owner",`CREATE FUNCTION public.jg_task16_runtime_reference_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$${referenceGuardBody}$guard$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_reference_read_only() FROM PUBLIC;\nCREATE FUNCTION public.jg_task16_runtime_version_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $version$${versionGuardBody}$version$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_version_read_only() FROM PUBLIC;\nCREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_version_read_only();\nALTER TABLE public."ContractVersion" ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only;\nCREATE TRIGGER jg_task16_runtime_user_position_read_only BEFORE UPDATE ON public."UserPosition" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."UserPosition" ENABLE ALWAYS TRIGGER jg_task16_runtime_user_position_read_only;\nCREATE TRIGGER jg_task16_runtime_company_read_only BEFORE UPDATE ON public."CompanyEntity" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."CompanyEntity" ENABLE ALWAYS TRIGGER jg_task16_runtime_company_read_only;\nCREATE TRIGGER jg_task398_signature_read_only BEFORE UPDATE ON public."HandwrittenSignatureVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."HandwrittenSignatureVersion" ENABLE ALWAYS TRIGGER jg_task398_signature_read_only;\n${voucher.guardSql}`);
 const requirements=require("./task16-current259-voucher-acl.requirements.json");
 const plan=runtimePlan();
 const routines=[...plan.runtime.functions.filter(name=>!name.includes("jg_task01_connection_identity")),...CASH_WRITER_FUNCTIONS,...requirements.routineSources.map(row=>row.signature),"public.jg_read_registered_payment_impacts(text,text,text,text,text)"];
 if(routines.some(name=>typeof name!=="string"||!/^[a-zA-Z0-9_.,()" ]+$/u.test(name)))throw new Error("TASK398_ROUTINE_LIST");
 sql("jiangkong",`${columnGrants(plan)}\n${businessReadGrantSql(advanceExcludedReads)}\n${technicalDeleteGrant(plan)}\n${observerReadGrantSql(browserScenario||overpayScenario||ledgerLossScenario,ledgerLossScenario,transferScenario,handoverScenario)}\nREVOKE ALL ON public."OperatingLedgerWriteSecret",public."OperatingLedgerWriteContext" FROM jg_task01_runtime,jg_task01_observer;\n${[...new Set(routines)].map(name=>`GRANT EXECUTE ON FUNCTION ${name} TO jg_task01_runtime;`).join("\n")}\nINSERT INTO public."OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,public.crypt('${secret}',public.gen_salt('bf')));`);
 if(transferScenario)sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${transferFence}\nCOMMIT;`);
 if(handoverScenario||usesAdvanceRuntime){
  const acl=readFileSync(path.join(__dirname,"prepared/task25/public-cash-handover-runtime.sql"),"utf8");
  sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${acl}\nCOMMIT;`);
  const exact=sql("jiangkong",`SELECT CASE WHEN
    (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN ('public."PublicCashCustody"'::regclass,'public."PublicCashHandover"'::regclass,'public."PublicCashHandoverReceipt"'::regclass)
      AND has_table_privilege('jg_task01_runtime',c.oid,'SELECT') AND has_table_privilege('jg_task01_runtime',c.oid,'INSERT')
      AND NOT has_table_privilege('jg_task01_runtime',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=3
    AND has_column_privilege('jg_task01_runtime','public."PublicCashCustody"','currentCustodianId','UPDATE')
    AND NOT has_column_privilege('jg_task01_runtime','public."PublicCashCustody"','initialCustodianId','UPDATE')
    AND NOT has_any_column_privilege('jg_task01_runtime','public."PublicCashHandover"','UPDATE')
    AND NOT has_any_column_privilege('jg_task01_runtime','public."PublicCashHandoverReceipt"','UPDATE')
    THEN 'TASK407_ROLE_CHECK_OK' ELSE 'TASK407_ROLE_CHECK_FAILED' END;`);
  if(!exact.includes("TASK407_ROLE_CHECK_OK"))throw new Error("TASK407_ROLE_CHECK");
 }
 const check=sql("jiangkong",`SELECT CASE WHEN NOT EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer') AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)) AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer')) AND NOT has_table_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,DELETE') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingImpactEntry"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_observer','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_schema_privilege('jg_task01_runtime','public','CREATE') AND NOT has_schema_privilege('jg_task01_observer','public','CREATE') AND (${technicalDeleteCheckSql()}) AND (${signatureBindingCheckSql()}) AND (${approvalDependencyCheckSql()}) AND (${spotGuardCheckSql()}) AND (${businessReadCheckSql(advanceExcludedReads)}) AND (${observerReadCheckSql(browserScenario||overpayScenario||ledgerLossScenario,ledgerLossScenario,transferScenario,handoverScenario)}) AND (${meSensitiveReadCheckSql()}) THEN 'TASK398_ROLE_CHECK_OK' ELSE 'TASK398_ROLE_CHECK_FAILED' END;`);
 if(!check.includes("TASK398_ROLE_CHECK_OK"))throw new Error("TASK398_ROLE_CHECK");
 if(transferScenario){
  const transferCheck=sql("jiangkong",`SELECT CASE WHEN
    has_table_privilege('jg_task01_runtime','public."RegisteredFundTransfer"','SELECT') AND
    has_column_privilege('jg_task01_runtime','public."RegisteredFundTransfer"','revision','UPDATE') AND
    NOT has_column_privilege('jg_task01_runtime','public."RegisteredFundTransfer"','amountYuan','UPDATE') AND
    NOT has_any_column_privilege('jg_task01_runtime','public."RegisteredFundTransferLine"','UPDATE') AND
    NOT has_any_column_privilege('jg_task01_runtime','public."RegisteredFundTransferAction"','UPDATE') AND
    has_column_privilege('jg_task01_runtime','public."FundAccountBalanceRegistration"','transferId','SELECT') AND
    has_column_privilege('jg_task01_runtime','public."FundAccountSourceBatch"','receivedTransferLineId','SELECT')
    THEN 'TASK406_ROLE_CHECK_OK' ELSE 'TASK406_ROLE_CHECK_FAILED' END;`);
  if(!transferCheck.includes("TASK406_ROLE_CHECK_OK"))throw new Error("TASK406_ROLE_CHECK");
 }

 if(usesAdvanceRuntime){
  const {migrationBaseline}=require("./database-dynamic-gate-manifest.json");
  const {expectedDirectoryCount:count,terminalMigration:terminal,terminalMigrationChecksum}=migrationBaseline;
  const expectedTerminals=new Map([
   [267,"20261118190000_registered_project_advance_funding"],
   [268,"20261118200000_registered_principal_returns"],
   [269,"20261118210000_company_proxy_repayment_approval"],
   [270,"20261118211500_company_transfer_original_debt_corrections"],
   [271,"20261118212000_company_transfer_canonical_debt_correction"],
   [272,"20261118214000_spot_first_approved_debtor"],
  ]);
  const allowedCounts=companyProxyScenario?[269,270,271,272]:principalScenario?[268,269,270,271,272]:[267];
  if(!allowedCounts.includes(count) || expectedTerminals.get(count)!==terminal || !/^[a-f0-9]{64}$/u.test(terminalMigrationChecksum))throw new Error("TASK398_EXPECTED_LEDGER");
  sql("jiangkong",`DO $$ BEGIN
    IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)<>${count}
      OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${terminal}'
        AND checksum='${migrationBaseline.terminalMigrationChecksum}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
    THEN RAISE EXCEPTION 'TASK408_409_MIGRATION_LEDGER'; END IF;
  END $$;`);
  const advanceAcl=readFileSync(path.join(__dirname,"prepared/task26/registered-project-advance-funding-fence.sql"),"utf8");
  sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${advanceAcl}\nCOMMIT;`);
  sql("jiangkong",`GRANT SELECT ON public."RegisteredFundAdvanceReceipt",public."RegisteredFundCompanyOwnedReceipt",public."RegisteredPaymentProjectAdvance" TO jg_task01_observer;
  DO $$ BEGIN
    IF has_any_column_privilege('jg_task01_runtime','public."ProjectOwnerSettlementEntry"','SELECT')
     OR NOT has_function_privilege('jg_task01_runtime','public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
     OR has_function_privilege('jg_task01_observer','public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
     OR has_table_privilege('jg_task01_runtime','public."RegisteredFundAdvanceReceipt"','UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('jg_task01_runtime','public."RegisteredFundCompanyOwnedReceipt"','UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('jg_task01_runtime','public."RegisteredPaymentProjectAdvance"','UPDATE,DELETE,TRUNCATE')
     OR has_any_column_privilege('jg_task01_observer','public."RegisteredPaymentProjectAdvance"','INSERT,UPDATE')
     OR has_function_privilege('jg_task01_observer','public.jg_registered_fund_verified_own_candidates(text)','EXECUTE')
    THEN RAISE EXCEPTION 'TASK408_ROLE_CHECK'; END IF;
  END $$;`);
  if (principalScenario||companyProxyScenario) {
   const task27=readFileSync(path.join(__dirname,"prepared/task27/registered-principal-return-runtime.sql"),"utf8");
   const relations=["RegisteredPrincipalReturnSource","RegisteredPrincipalReturnApplication","RegisteredPrincipalReturnPayment","RegisteredPrincipalReturnAllocation","RegisteredPrincipalReturnCommand"];
   const entries=relations.map(table=>`'public."${table}"'`).join(",");
   sql("jiangkong",`BEGIN; SET LOCAL jg.task16_runtime_role='jg_task01_runtime'; ${task27} COMMIT;`);
   sql("jiangkong",`GRANT SELECT ON ${relations.map(table=>`public."${table}"`).join(",")} TO jg_task01_observer;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM unnest(ARRAY[${entries}]::regclass[]) original
       WHERE NOT has_table_privilege('jg_task01_runtime',original,'SELECT,INSERT')
        OR NOT has_table_privilege('jg_task01_observer',original,'SELECT')
        OR has_table_privilege('jg_task01_runtime',original,'UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
        OR has_any_column_privilege('jg_task01_observer',original,'INSERT,UPDATE,REFERENCES'))
       OR NOT has_column_privilege('jg_task01_runtime','public."RegisteredPrincipalReturnSource"','writeRevision','UPDATE')
       OR NOT has_column_privilege('jg_task01_runtime','public."RegisteredPrincipalReturnApplication"','revision','UPDATE')
       OR has_column_privilege('jg_task01_runtime','public."RegisteredPrincipalReturnApplication"','requestedYuan','UPDATE')
      THEN RAISE EXCEPTION 'TASK409_ROLE_CHECK'; END IF;
    END $$;`);
   console.log("TASK409_268_ROLE_OK",migrationBaseline.terminalMigrationChecksum);
  } else {
   console.log("TASK408_267_ROLE_OK",migrationBaseline.terminalMigrationChecksum);
  }
 }
 const privateLogDir=realpathSync(mkdtempSync(path.join(tmpdir(),"jg398-approval-pglog-")));chmodSync(privateLogDir,0o700);
 console.log(`TASK398_PRIVATE_PG_LOG_DIR ${privateLogDir}`);
 env.TASK398_LOG_CONTAINER=containerId;env.TASK398_LOG_ENDPOINT=endpoint;env.TASK398_LOG_FILE=path.join(privateLogDir,"approval-postgres-errors.log");
 env.DATABASE_URL=url(companyProxyScenario?"jiangkong":"jg_task01_runtime");env.TASK398_OWNER_URL=url("jg_task01_owner");env.TASK398_OBSERVER_URL=url("jg_task01_observer");
 if(companyProxyScenario){env.RUN_COMPANY_PROXY_REPAYMENT_HTTP="1";env.RUN_EXPENSE_REGISTERED_PAYMENT_PG16="1";env.TASK410_ISOLATED_RUN_ID=short;}
 if(handoverScenario)env.RUN_TASK407_HANDOVER_PG16="1";
 if(advanceScenario)env.RUN_TASK408_ADVANCE_PG16="1";
 if(principalScenario){env.RUN_TASK409_PRINCIPAL_PG16="1";env.TASK409_PRIVATE_FAILURE_PATH=path.join(privateLogDir,"principal-return-failure.jsonl");}
 if(principalRoleCoverage)env.TASK409_PRINCIPAL_ROLE_ONLY="1";
 if(overpayScenario)env.TASK398_OVERPAY_MODE="1";
 if(ledgerLossScenario)env.TASK398_LEDGER_LOSS_MODE="1";
 if(transferScenario&&!usesAdvanceRuntime){env.TASK406_TRANSFER_MODE=transferRejection?"rejection":transferBrowser?"browser":"1";env.TASK406_PRIVATE_FAILURE_PATH=path.join(privateLogDir,"transfer-failure.jsonl");}
 if(browserScenario){const evidenceDir=realpathSync(mkdtempSync("/private/tmp/jg398-browser-evidence-"));chmodSync(evidenceDir,0o700);env.TASK398_BROWSER_MODE=scenario==="src/database/task16-real-browser-completion.pg.spec.ts"?"2":"1";env.TASK398_CANDIDATE_SHA=candidate;env.TASK398_BROWSER_EVIDENCE=path.join(evidenceDir,"receipt.json");console.log(`TASK398_BROWSER_EVIDENCE_DIR ${evidenceDir}`);}
 const scenarios=companyProxyScenario
  ? [scenario,"src/expense-claim/expense-claim-registered-payment.http.pg.spec.ts"]
  : [scenario];
 try{command("pnpm",["--filter","@jiangkong/api","exec","jest","--runInBand",...scenarios],{env,timeout:300000});}
 catch(error){
  if(transferScenario)try{
   const native=spawnSync("docker",["--host",endpoint,"logs","--tail","80",containerId],{cwd:root,timeout:3000,maxBuffer:256*1024});
   if(native.status===0)writeFileSync(path.join(privateLogDir,"transfer-postgresql.log"),Buffer.concat([native.stdout,native.stderr]),{mode:0o600,flag:"wx"});
  }catch{ /* Preserve the original failed business command and let owned cleanup run. */ }
  throw error;
 }
 if(advanceScenario){
  const native=spawnSync("docker",["--host",endpoint,"logs",containerId],{cwd:root,timeout:3000,maxBuffer:256*1024,encoding:"utf8"});
  const logs=String(native.stdout??"")+String(native.stderr??"");
  if(native.status!==0||!logs.includes("same company project funding gap requires a confirmed project advance"))throw new Error("TASK408_MIXED_FUNDING_DB_WITNESS_MISSING");
  console.log("TASK408_MIXED_FUNDING_DB_WITNESS");
 }
 if(command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_CANDIDATE_CHANGED");
}
let businessPassed=false;
if(require.main===module)run().then(()=>{businessPassed=true;},error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{
 let containerClean=true;
 if(launchAttempted){
  const list=()=>docker(["ps","-a","--no-trunc","--filter",`name=^/${name}$`,"--format","{{.ID}}"],{quiet:true}).split("\n").filter(Boolean);
  const status=cleanupOwnedContainer({id:containerId,name,runId,list,inspect:id=>{const value=JSON.parse(docker(["inspect","--type","container","--format",`{"id":{{json .Id}},"name":{{json .Name}},"runId":{{json (index .Config.Labels \"${CI_DYNAMIC_MIGRATION_LABEL}\")}}}`,id],{quiet:true}));return {...value,name:value.name?.replace(/^\//u,"")};},remove:containerId=>docker(["rm","--force","--volumes",containerId],{quiet:true}),confirmAbsent:id=>!list().includes(id)});
  console.error(`TASK398_CONTAINER_CLEANUP_${status} run=${runId} name=${name}`);if(status==="UNKNOWN"){containerClean=false;console.error(`TASK398_STORAGE_RETAINED:${storage}`);process.exitCode=1;}
 }
 if(storage&&containerClean)try{rmSync(storage,{recursive:true,force:true});}catch{console.error("TASK398_STORAGE_CLEANUP_FAILED");process.exitCode=1;}
 if(businessPassed&&!process.exitCode)console.log(`${["--browser-real","--browser-completion-real"].includes(process.argv[2])?"TASK398_BROWSER_PASS":process.argv[2]==="--overpay-real"?"TASK398_OVERPAY_PASS":process.argv[2]==="--ledger-loss-real"?"TASK398_LEDGER_LOSS_PASS":process.argv[2]==="--transfer-browser-real"?"TASK406_BROWSER_PASS":process.argv[2]==="--cash-handover-real"?"TASK407_HANDOVER_PASS":process.argv[2]==="--transfer-real"?"TASK406_TRANSFER_PASS":process.argv[2]==="--transfer-rejection-real"?"TASK406_REJECTION_PASS":process.argv[2]==="--project-advance-real"?"TASK408_ADVANCE_PASS":process.argv[2]==="--principal-return-roles-real"?"TASK409_PRINCIPAL_ROLES_PASS":process.argv[2]==="--principal-return-real"?"TASK409_PRINCIPAL_PASS":process.argv[2]==="--company-proxy-repayment-real"?"TASK410_COMPANY_PROXY_REPAYMENT_PASS":"TASK398_STANDARD_PASS"} candidate=${process.env.TASK398_EXPECTED_SHA} run=${runId}`);
});
module.exports={selectTask398Scenario,runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,signatureBindingCheckSql,approvalDependencyCheckSql,spotGuardCheckSql,businessReadGrantSql,businessReadCheckSql,excludedReadTables,observerReadGrantSql,observerReadCheckSql,observerTables,observerSignatureColumns,meSensitiveReadCheckSql,cleanupOwnedContainer,containerName};
