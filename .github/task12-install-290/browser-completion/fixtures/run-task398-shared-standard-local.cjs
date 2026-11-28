"use strict";

// Disposable local PG only. This runner has not been admitted for execution
// until its resource, role and payment-guard setup has been independently reviewed.
const {createHash,randomUUID,randomBytes}=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {mkdtempSync,readFileSync,rmSync,chmodSync,realpathSync,mkdirSync,writeFileSync}=require("node:fs");
const {tmpdir}=require("node:os");
const path=require("node:path");
const {createCommandRuntime}=require("./money-bigint-runner-runtime.cjs");
const {CI_DYNAMIC_MIGRATION_LABEL,createCiDynamicMigrationFixture}=require("./local-staged-ci-dynamic.cjs");
const {renderTask398FileGuardGrant,renderTask398Owned280FileGuardGrant}=require("./contract-bank-runtime-fixture.cjs");
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
function sensitiveReadTableSql(extraExcluded=[],owned280=false){
 const ownedRestriction=owned280?` OR NOT c.relname = ANY(ARRAY[${require("./task398-owned-280-business-read-baseline.json").tables.map(x=>`'${x}'`).join(",")}])`:"";
 return `(c.relname = ANY(ARRAY[${[...excludedReadTables,...extraExcluded].map(x=>`'${x}'`).join(",")}]) OR c.relname ~* '(secret|token|credential|password|privatekey|context)' OR EXISTS(SELECT FROM information_schema.columns col WHERE col.table_schema=n.nspname AND col.table_name=c.relname AND col.column_name ~* '(secret|token|credential|password|privatekey)')${ownedRestriction})`;}
function businessReadGrantSql(extraExcluded=[],owned280=false){return `DO $read$ DECLARE r record; BEGIN FOR r IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT ${sensitiveReadTableSql(extraExcluded,owned280)} LOOP EXECUTE format('GRANT SELECT ON TABLE public.%I TO jg_task01_runtime',r.relname); END LOOP; END $read$;`;}
function businessReadCheckSql(extraExcluded=[],owned280=false){return `NOT EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND ((${sensitiveReadTableSql(extraExcluded,owned280)} AND has_table_privilege('jg_task01_runtime',c.oid,'SELECT')) OR (NOT ${sensitiveReadTableSql(extraExcluded,owned280)} AND (NOT has_table_privilege('jg_task01_runtime',c.oid,'SELECT') OR has_table_privilege('jg_task01_runtime',c.oid,'SELECT WITH GRANT OPTION')))))`;}
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
function task398Options(args){
 const scenario=selectTask398Scenario(args);
 const overpayScenario=args[0]==="--overpay-real";
 const ledgerLossScenario=args[0]==="--ledger-loss-real";
 const transferRejection=args[0]==="--transfer-rejection-real";
 const transferBrowser=args[0]==="--transfer-browser-real";
 const handoverScenario=args[0]==="--cash-handover-real";
 const advanceScenario=args[0]==="--project-advance-real";
 const principalRoleCoverage=args[0]==="--principal-return-roles-real";
 const principalScenario=args[0]==="--principal-return-real"||principalRoleCoverage;
 const companyProxyScenario=args[0]==="--company-proxy-repayment-real";
 const usesAdvanceRuntime=advanceScenario||principalScenario||companyProxyScenario;
 const advanceExcludedReads=usesAdvanceRuntime?["ProjectOwnerSettlementEntry"]:[];
 const transferScenario=args[0]==="--transfer-real"||transferRejection||transferBrowser||handoverScenario||usesAdvanceRuntime;
 const browserScenario=scenario==="src/database/task16-real-browser.pg.spec.ts"||scenario==="src/database/task16-real-browser-completion.pg.spec.ts";
 return {scenario,overpayScenario,ledgerLossScenario,transferRejection,transferBrowser,handoverScenario,advanceScenario,principalRoleCoverage,principalScenario,companyProxyScenario,usesAdvanceRuntime,advanceExcludedReads,transferScenario,browserScenario};
}
async function run(){
 const options=task398Options(process.argv.slice(2));
 if(process.env.NODE_ENV==="production"||process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 const candidate=process.env.TASK398_EXPECTED_SHA;
 if(!/^[a-f0-9]{40}$/u.test(candidate??"")||command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_EXACT_CLEAN_CANDIDATE_REQUIRED");
 storage=realpathSync(mkdtempSync(path.join(tmpdir(),"jg398-shared-")));chmodSync(storage,0o700);
 endpoint=process.env.DOCKER_HOST||command("docker",["context","inspect","--format","{{.Endpoints.docker.Host}}"],{quiet:true});
 if(!endpoint.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 launchAttempted=true;
 const launchedId=docker(["run","--detach","--rm","--pull=never","--name",name,"--label",`${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,"--env","POSTGRES_PASSWORD","--env","POSTGRES_USER=jiangkong", "--env",`POSTGRES_DB=${db}`,"--publish","127.0.0.1::5432","postgres:16","-c","log_destination=stderr","-c","logging_collector=off","-c","log_line_prefix=JG398|%a|%d|%p|%e|","-c","log_min_messages=error","-c",options.transferScenario?"log_error_verbosity=verbose":"log_error_verbosity=default","-c","log_statement=none","-c","log_min_error_statement=panic","-c","log_parameter_max_length_on_error=0"],{env:{...process.env,POSTGRES_PASSWORD:password},quiet:true});
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
 await runBusiness(options,{candidate,short,storage,url,sql,env});
 if(command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_CANDIDATE_CHANGED");
}
async function runBusiness(options,{candidate,short,storage,url,sql,env,current280=false,readPostgresLog,ownedMigrationBaseline,correctionCatalog,standard290,browser290}){
 const {scenario,overpayScenario,ledgerLossScenario,transferRejection,transferBrowser,handoverScenario,advanceScenario,principalRoleCoverage,principalScenario,companyProxyScenario,usesAdvanceRuntime,advanceExcludedReads,transferScenario,browserScenario}=options;
 if(!current280){
 const files=["registered-funding.sql","registered-history-revision.sql","registered-write-authority.sql","registered-canonical-proof.sql","registered-intercompany.sql","registered-canonical-adapter.sql","registered-voucher.sql"].map(file=>readFileSync(path.join(__dirname,"prepared/task16",file),"utf8"));
 // The seven-part catalog shares the migration owner's identity. The impact
 // reader has its own explicit owner/session preflight and remains separate.
 await sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${files.join("\n")}\nCOMMIT;`);
 }
 const impactReader=readFileSync(path.join(__dirname,"prepared/task16-current259/registered-impact-reader.sql"),"utf8");
 await sql("jg_task01_owner",`BEGIN;\n${impactReader}\nCOMMIT;`);
 const voucher=require("./task16-current259-voucher-acl.cjs").current259VoucherAcl();
 await sql("jg_task01_owner",`CREATE FUNCTION public.jg_task16_runtime_reference_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$${referenceGuardBody}$guard$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_reference_read_only() FROM PUBLIC;\nCREATE FUNCTION public.jg_task16_runtime_version_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $version$${versionGuardBody}$version$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_version_read_only() FROM PUBLIC;\nCREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_version_read_only();\nALTER TABLE public."ContractVersion" ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only;\nCREATE TRIGGER jg_task16_runtime_user_position_read_only BEFORE UPDATE ON public."UserPosition" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."UserPosition" ENABLE ALWAYS TRIGGER jg_task16_runtime_user_position_read_only;\nCREATE TRIGGER jg_task16_runtime_company_read_only BEFORE UPDATE ON public."CompanyEntity" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."CompanyEntity" ENABLE ALWAYS TRIGGER jg_task16_runtime_company_read_only;\nCREATE TRIGGER jg_task398_signature_read_only BEFORE UPDATE ON public."HandwrittenSignatureVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."HandwrittenSignatureVersion" ENABLE ALWAYS TRIGGER jg_task398_signature_read_only;\n${voucher.guardSql}`);
 const transferFence=transferScenario?readFileSync(path.join(__dirname,"prepared/task24/registered-fund-transfer-payment-fence.sql"),"utf8"):"";
 const requirements=require("./task16-current259-voucher-acl.requirements.json");
 const plan=runtimePlan();
 const routines=[...plan.runtime.functions.filter(name=>!name.includes("jg_task01_connection_identity")),...CASH_WRITER_FUNCTIONS,...requirements.routineSources.map(row=>row.signature),"public.jg_read_registered_payment_impacts(text,text,text,text,text)"];
 if(routines.some(name=>typeof name!=="string"||!/^[a-zA-Z0-9_.,()" ]+$/u.test(name)))throw new Error("TASK398_ROUTINE_LIST");
 await sql("jiangkong",`${columnGrants(plan)}\n${businessReadGrantSql(advanceExcludedReads,current280)}\n${technicalDeleteGrant(plan)}\n${observerReadGrantSql(browserScenario||overpayScenario||ledgerLossScenario,ledgerLossScenario,transferScenario,handoverScenario)}\nREVOKE ALL ON public."OperatingLedgerWriteSecret",public."OperatingLedgerWriteContext" FROM jg_task01_runtime,jg_task01_observer;\n${[...new Set(routines)].map(name=>`GRANT EXECUTE ON FUNCTION ${name} TO jg_task01_runtime;`).join("\n")}\nINSERT INTO public."OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,public.crypt('${secret}',public.gen_salt('bf')));`);
 if(transferScenario)await sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${transferFence}\nCOMMIT;`);
 if(handoverScenario||usesAdvanceRuntime){
  const acl=readFileSync(path.join(__dirname,"prepared/task25/public-cash-handover-runtime.sql"),"utf8");
  await sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${acl}\nCOMMIT;`);
  const exact=await sql("jiangkong",`SELECT CASE WHEN
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
 const check=await sql("jiangkong",`SELECT CASE WHEN NOT EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer') AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)) AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer')) AND NOT has_table_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,DELETE') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingImpactEntry"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_observer','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_schema_privilege('jg_task01_runtime','public','CREATE') AND NOT has_schema_privilege('jg_task01_observer','public','CREATE') AND (${technicalDeleteCheckSql()}) AND (${signatureBindingCheckSql()}) AND (${approvalDependencyCheckSql()}) AND (${spotGuardCheckSql()}) AND (${businessReadCheckSql(advanceExcludedReads,current280)}) AND (${observerReadCheckSql(browserScenario||overpayScenario||ledgerLossScenario,ledgerLossScenario,transferScenario,handoverScenario)}) AND (${meSensitiveReadCheckSql()}) THEN 'TASK398_ROLE_CHECK_OK' ELSE 'TASK398_ROLE_CHECK_FAILED' END;`);
 if(!check.includes("TASK398_ROLE_CHECK_OK"))throw new Error("TASK398_ROLE_CHECK");
 if(transferScenario){
  const transferCheck=await sql("jiangkong",`SELECT CASE WHEN
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
  const {migrationBaseline}=current280?{migrationBaseline:ownedMigrationBaseline}:require("./database-dynamic-gate-manifest.json");
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
  if(!current280&&(!allowedCounts.includes(count) || expectedTerminals.get(count)!==terminal || !/^[a-f0-9]{64}$/u.test(terminalMigrationChecksum)))throw new Error("TASK398_EXPECTED_LEDGER");
  await sql("jiangkong",`DO $$ BEGIN
    IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)<>${count}
      OR NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${terminal}'
        AND checksum='${migrationBaseline.terminalMigrationChecksum}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
    THEN RAISE EXCEPTION 'TASK408_409_MIGRATION_LEDGER'; END IF;
  END $$;`);
  const advanceAcl=readFileSync(path.join(__dirname,"prepared/task26/registered-project-advance-funding-fence.sql"),"utf8");
  await sql("jiangkong",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${advanceAcl}\nCOMMIT;`);
  await sql("jiangkong",`GRANT SELECT ON public."RegisteredFundAdvanceReceipt",public."RegisteredFundCompanyOwnedReceipt",public."RegisteredPaymentProjectAdvance" TO jg_task01_observer;
  DO $$ BEGIN
    IF has_any_column_privilege('jg_task01_runtime','public."ProjectOwnerSettlementEntry"','SELECT')
     OR has_function_privilege('jg_task01_runtime','public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE') IS DISTINCT FROM ${!current280}
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
   await sql("jiangkong",`BEGIN; SET LOCAL jg.task16_runtime_role='jg_task01_runtime'; ${task27} COMMIT;`);
   await sql("jiangkong",`GRANT SELECT ON ${relations.map(table=>`public."${table}"`).join(",")} TO jg_task01_observer;
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
   console.log(current280?"TASK409_282_ROLE_OK":"TASK409_268_ROLE_OK",migrationBaseline.terminalMigrationChecksum);
  } else {
   console.log("TASK408_267_ROLE_OK",migrationBaseline.terminalMigrationChecksum);
  }
 }
 if(correctionCatalog){
  const {readApprovalRoundCatalog}=require("/qualification/approval-round-catalog.cjs");
  const {context,receipt}=correctionCatalog;
  receipt.before=await readApprovalRoundCatalog(context,receipt);
  const {prepareControlledCorrection}=require("/qualification/controlled-correction.cjs");
  await prepareControlledCorrection(context,receipt);
  env.RUN_TASK419_CONTROLLED_ROUND="1";
  receipt.stages.push("NTF04_EXACT_ROUTE");
 }
 const privateLogDir=realpathSync(mkdtempSync(path.join(current280?storage:tmpdir(),"jg398-approval-pglog-")));chmodSync(privateLogDir,0o700);
 console.log(`TASK398_PRIVATE_PG_LOG_DIR ${privateLogDir}`);
 if(!current280){env.TASK398_LOG_CONTAINER=containerId;env.TASK398_LOG_ENDPOINT=endpoint;}else env.TASK398_OWNED_280="1";env.TASK398_LOG_FILE=path.join(privateLogDir,"approval-postgres-errors.log");
 env.DATABASE_URL=url(companyProxyScenario&&!current280?"jiangkong":companyProxyScenario?"jg_task01_owner":"jg_task01_runtime");env.TASK398_OWNER_URL=url("jg_task01_owner");env.TASK398_OBSERVER_URL=url("jg_task01_observer");
 if(companyProxyScenario){env.RUN_COMPANY_PROXY_REPAYMENT_HTTP="1";env.RUN_EXPENSE_REGISTERED_PAYMENT_PG16="1";env.TASK410_ISOLATED_RUN_ID=short;}
 if(handoverScenario)env.RUN_TASK407_HANDOVER_PG16="1";
 if(advanceScenario)env.RUN_TASK408_ADVANCE_PG16="1";
 if(principalScenario){env.RUN_TASK409_PRINCIPAL_PG16="1";env.TASK409_PRIVATE_FAILURE_PATH=path.join(privateLogDir,"principal-return-failure.jsonl");}
 if(principalRoleCoverage)env.TASK409_PRINCIPAL_ROLE_ONLY="1";
 if(overpayScenario)env.TASK398_OVERPAY_MODE="1";
 if(ledgerLossScenario)env.TASK398_LEDGER_LOSS_MODE="1";
 if(transferScenario&&!usesAdvanceRuntime){env.TASK406_TRANSFER_MODE=transferRejection?"rejection":transferBrowser?"browser":"1";env.TASK406_PRIVATE_FAILURE_PATH=path.join(privateLogDir,"transfer-failure.jsonl");}
 if(browserScenario){const evidenceDir=realpathSync(mkdtempSync(browser290?"/run/task398-browser/jg398-browser-evidence-":current280?path.join(storage,"browser-evidence-"):"/private/tmp/jg398-browser-evidence-"));chmodSync(evidenceDir,0o700);env.TASK398_BROWSER_MODE=scenario==="src/database/task16-real-browser-completion.pg.spec.ts"?"2":"1";env.TASK398_CANDIDATE_SHA=browser290?"7c226e44401c2143f06808f86c8bc3c0fdb8a944":candidate;env.TASK398_BROWSER_EVIDENCE=path.join(evidenceDir,"receipt.json");if(browser290){env.PLAYWRIGHT_BROWSERS_PATH="/opt/jg-playwright";env.TASK398_OWNED_VITE_CACHE=path.join(storage,"vite-cache");}console.log(`TASK398_BROWSER_EVIDENCE_DIR ${evidenceDir}`);}
 const scenarios=companyProxyScenario
  ? [scenario,"src/expense-claim/expense-claim-registered-payment.http.pg.spec.ts"]
  : [scenario];
 try{
  const knownTitle="rejects a project source gap, then shares three valid instalments and supplements the voucher";
  const reportFile=path.join(privateLogDir,"standard-290-jest.json");
  const selection=standard290||browser290?["--json","--outputFile",reportFile]:[];
  const output=command("pnpm",["--filter","@jiangkong/api","exec","jest","--runInBand",...scenarios,...selection],{env,timeout:300000});
  if(browser290){
   const report=JSON.parse(readFileSync(reportFile,"utf8"));
   const expectedTitle="recovers a lost payment response by the original key after page reload, then completes and reconciles payment";
   const rows=report.testResults?.flatMap(suite=>suite.assertionResults)??[];
   if(report.success!==true||report.numPassedTests!==1||report.numFailedTests!==0||report.numPendingTests!==0||
      rows.length!==1||rows[0].status!=="passed"||rows[0].title!==expectedTitle)throw Error("TASK398_BROWSER_290_ORIGINAL_COVERAGE");
   const evidenceRoot=path.dirname(env.TASK398_BROWSER_EVIDENCE);
   const evidence=JSON.parse(readFileSync(path.join(evidenceRoot,"receipt-complete.json"),"utf8"));
   const markers=["receipt.json","receipt-stage2.json"].map(file=>JSON.parse(readFileSync(path.join(evidenceRoot,file),"utf8")));
   if(evidence.candidate!==env.TASK398_CANDIDATE_SHA||evidence.runId!==short||
      evidence.status!=="BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE"||
      !Array.isArray(evidence.requestKeySha256)||evidence.requestKeySha256.length!==2||
      evidence.requestKeySha256.some(key=>!/^[0-9a-f]{64}$/u.test(key))||new Set(evidence.requestKeySha256).size!==2||
      markers.some((stage,index)=>stage.candidate!==evidence.candidate||stage.runId!==short||stage.status!=="UNKNOWN_DO_NOT_RETRY"||
        JSON.stringify(stage.requestKeySha256)!==JSON.stringify(evidence.requestKeySha256.slice(0,index+1)))||
      evidence.firstResponseRecovered!==true||evidence.firstResponseRecoveredAfterReload!==true||evidence.voucherDownloaded!==true)throw Error("TASK398_BROWSER_290_RECEIPT");
   browser290.original={business:1,passed:1,skipped:0,evidenceStatus:evidence.status};
  }
  if(standard290){
   const report=JSON.parse(readFileSync(reportFile,"utf8"));
   const rows=report.testResults?.flatMap(suite=>suite.assertionResults)??[];
   const matched=rows.filter(row=>row.status==="passed");
   if(report.success!==true||report.numPassedTests!==8||report.numFailedTests!==0||report.numPendingTests!==0||
      matched.length!==8||matched.filter(row=>row.title===knownTitle).length!==1)throw Error("TASK398_STANDARD_290_ORIGINAL_COVERAGE");
   standard290.original={business:1,passed:8,skipped:0};
  }

  if(correctionCatalog){
   const anchors=["NTF04_CONTROLLED_MODE_AND_DENIALS","NTF04_SAME_TRANSACTION_AND_ROLLBACK_PROVED",
     "NTF04_CORRECTION_201_REPLAY_201_QUEUED_ONE_SENT_ZERO"];
   if(!anchors.every(anchor=>output.split(/\r?\n/u).filter(line=>line.trim()===anchor).length===1))
    throw Error("NTF04_BUSINESS_ORACLE");
   correctionCatalog.receipt.businessOracle={status:201,replay:201,queued:1,sent:0,oneTransaction:true,rollback:true};
  }
 }
 catch(error){
  if(current280)writeFileSync(path.join(privateLogDir,"owned-postgresql.log"),readPostgresLog(),{mode:0o600,flag:"wx"});
  else if(transferScenario)try{
   const native=spawnSync("docker",["--host",endpoint,"logs","--tail","80",containerId],{cwd:root,timeout:3000,maxBuffer:256*1024});
   if(native.status===0)writeFileSync(path.join(privateLogDir,"transfer-postgresql.log"),Buffer.concat([native.stdout,native.stderr]),{mode:0o600,flag:"wx"});
  }catch{ /* Preserve the original failed business command and let owned cleanup run. */ }
  throw error;
 }
 if(advanceScenario){
  const native=current280?{status:0,stdout:readPostgresLog()}:spawnSync("docker",["--host",endpoint,"logs",containerId],{cwd:root,timeout:3000,maxBuffer:256*1024,encoding:"utf8"});
  const logs=String(native.stdout??"")+String(native.stderr??"");
  if(native.status!==0||!logs.includes("same company project funding gap requires a confirmed project advance"))throw new Error("TASK408_MIXED_FUNDING_DB_WITNESS_MISSING");
  console.log("TASK408_MIXED_FUNDING_DB_WITNESS");
 }

}
// The legacy jiangkong owner receives PostgreSQL's default PUBLIC EXECUTE on
// this invoker. The native B6 owner removes that default before the tail.
const owned280CapacitySql=`
 DO $cash_capacity$
 DECLARE capacity oid := to_regprocedure('public.jg_registered_fund_transfer_capacity(text)');
 BEGIN
   IF current_user <> 'jg_task01_owner' OR session_user <> current_user
     OR NOT EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=capacity AND p.proowner=10 AND p.pronamespace=to_regnamespace('public')
         AND l.lanname='plpgsql' AND p.prokind='f' AND NOT p.prosecdef
         AND p.prorettype='pg_catalog.void'::regtype AND NOT p.proisstrict AND NOT p.proretset
         AND p.proconfig=ARRAY['search_path=pg_catalog, public']
         AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='faa5f2b28c48673f14e1d58d17cbd373e70af822e9bafebf6f4e9a9ca41d550a'
         AND (SELECT count(*)=1 AND bool_and(grantee=10 AND grantor=10 AND privilege_type='EXECUTE' AND NOT is_grantable)
           FROM aclexplode(coalesce(p.proacl,acldefault('f',10)))))
   THEN RAISE EXCEPTION 'TASK398_OWNED_280_CAPACITY_PREIMAGE'; END IF;
   GRANT EXECUTE ON FUNCTION public.jg_registered_fund_transfer_capacity(text) TO jg_task01_runtime;
   IF NOT has_function_privilege('jg_task01_runtime',capacity,'EXECUTE')
     OR has_function_privilege('jg_task01_runtime',capacity,'EXECUTE WITH GRANT OPTION')
     OR has_function_privilege('jg_task01_observer',capacity,'EXECUTE')
     OR has_function_privilege('jg_task01_runtime','public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
   THEN RAISE EXCEPTION 'TASK398_OWNED_280_CAPACITY_POSTIMAGE'; END IF;
 END;
 $cash_capacity$;
`;
// The legacy #407 fixture inherited EXECUTE on this invoker routine.
const owned282CashHandoverSql=`
 DO $cash_successor$
 DECLARE successor oid := to_regprocedure('public.jg_public_cash_held_transfer_successor(text,text,text)');
 BEGIN
   IF current_user <> 'jg_task01_owner' OR session_user <> current_user
     OR NOT EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=successor AND p.proowner=10 AND p.pronamespace=to_regnamespace('public')
         AND l.lanname='sql' AND p.prokind='f' AND NOT p.prosecdef AND p.provolatile='s'
         AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proisstrict AND NOT p.proretset
         AND p.proconfig=ARRAY['search_path=pg_catalog, public']
         AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c21f64dde7db5112ea7d166efaa4806f904905e42bc3fe4300530dc62a280c86'
         AND (SELECT count(*)=1 AND bool_and(grantee=10 AND grantor=10 AND privilege_type='EXECUTE' AND NOT is_grantable)
           FROM aclexplode(coalesce(p.proacl,acldefault('f',10)))))
   THEN RAISE EXCEPTION 'TASK407_OWNED_282_SUCCESSOR_PREIMAGE'; END IF;
   GRANT EXECUTE ON FUNCTION public.jg_public_cash_held_transfer_successor(text,text,text) TO jg_task01_runtime;
   IF NOT has_function_privilege('jg_task01_runtime',successor,'EXECUTE')
     OR has_function_privilege('jg_task01_runtime',successor,'EXECUTE WITH GRANT OPTION')
     OR has_function_privilege('jg_task01_observer',successor,'EXECUTE')
     OR has_function_privilege('jg_task01_runtime','public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
   THEN RAISE EXCEPTION 'TASK407_OWNED_282_SUCCESSOR_POSTIMAGE'; END IF;
 END;
 $cash_successor$;
`;
const owned280Fences=Object.freeze([
 ["ContractVersion", "jg_task16_runtime_version_read_only", "jg_task16_runtime_version_read_only"],
 ["UserPosition", "jg_task16_runtime_user_position_read_only", "jg_task16_runtime_reference_read_only"],
 ["CompanyEntity", "jg_task16_runtime_company_read_only", "jg_task16_runtime_reference_read_only"],
 ["HandwrittenSignatureVersion", "jg_task398_signature_read_only", "jg_task16_runtime_reference_read_only"],
 ["PaymentExecution", "jg_task16_runtime_voucher_payment_no_update", "jg_task16_runtime_reference_read_only"],
 ["FileObject", "jg_task16_runtime_voucher_file_no_update", "jg_task16_runtime_reference_read_only"],
 ["FileObject", "jg_task16_runtime_voucher_file_insert", "jg_task16_runtime_voucher_file_insert_only"]
]);
const owned280RegisteredImpacts="jg_read_registered_payment_impacts(text,text,text,text,text)";
const owned282PrincipalFences=Object.freeze([
 ["RegisteredPaymentProjectAdvance", "RegisteredPaymentProjectAdvance_payment", "jg_registered_payment_project_advance_check"],
 ["RegisteredFundPaymentAllocation", "RegisteredFundPaymentAllocation_project_mixed_funding", "jg_registered_payment_project_mixed_funding_check"],
 ["ApprovalInstance", "RegisteredPrincipalReturnApproval_binding", "jg_assert_principal_return_approval_binding"]
]);
function ownedCashFenceProfile(principalScenario) {
 const fences=[...owned280Fences.map(fence=>[...fence,"A"]),...(principalScenario?owned282PrincipalFences.map(fence=>[...fence,"O"]):[])];
 const routines=[...new Set(fences.map(([, , routine])=>routine+"()")),owned280RegisteredImpacts];
 if(principalScenario)routines.push("jg_open_principal_return_approval(text,text,text,jsonb)");
 const triggerValues=fences.map(([relation,trigger,routine,enabled])=>
  `('public."${relation}"'::regclass,'${trigger}','public.${routine}()','${enabled}')`).join(",");
 return {routines,triggerValues};
}
const owned280Execs=`
 SELECT p.oid, a.grantee,
        format('REVOKE EXECUTE ON FUNCTION %s FROM jg_task01_runtime',p.oid::regprocedure) AS revoke
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace=to_regnamespace('public') AND p.proowner=10
  AND a.grantee='jg_task01_runtime'::regrole::oid AND a.grantor=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
`;
async function snapshotOwned280CashProfile(sql,{routines,triggerValues}) {
 const check=await sql("jg_task01_owner",`
   SET search_path=pg_catalog;
   SELECT jsonb_build_object('exec',coalesce((SELECT jsonb_agg(oid ORDER BY oid) FROM (${owned280Execs}) acl),'[]'),
     'clean',NOT EXISTS(SELECT FROM pg_trigger t JOIN (VALUES ${triggerValues}) f(rel,name,proc,enabled)
       ON f.rel=t.tgrelid AND f.name=t.tgname)
     AND NOT EXISTS(SELECT FROM unnest(ARRAY[${routines.map(r=>`'public.${r}'`).join(",")}]) r(signature)
       WHERE to_regprocedure(signature) IS NOT NULL),
     'qualified', public.jg_require_contract_direct_upward_source_v2() IS NOT NULL);
 `);
 const before=JSON.parse(check);
 if(!before.clean||!before.qualified||!Array.isArray(before.exec)||before.exec.some(oid=>!/^[0-9]+$/u.test(String(oid))))throw new Error("TASK398_OWNED_280_CASH_SCOPE");
 return before.exec;
}
async function closeOwned280CashProfile(sql,exec,{routines,triggerValues}) {
 const before=`ARRAY[${exec.join(",")}]::oid[]`;
 await sql("jg_task01_owner",`
   BEGIN;
   SET LOCAL search_path=pg_catalog;
   DO $cash_teardown$
   DECLARE fence record;
   BEGIN
     IF EXISTS(SELECT FROM unnest(${before}) expected(oid)
       WHERE expected.oid NOT IN (SELECT oid FROM (${owned280Execs}) acl))
       THEN RAISE EXCEPTION 'TASK398_OWNED_280_BASELINE_ACL_CHANGED'; END IF;
     FOR fence IN SELECT * FROM (VALUES ${triggerValues}) f(rel,name,proc,enabled)
     LOOP
       IF NOT EXISTS(SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
           WHERE t.tgrelid=fence.rel AND t.tgname=fence.name AND p.oid=to_regprocedure(fence.proc)
             AND p.proowner=10 AND NOT p.prosecdef AND t.tgenabled=fence.enabled AND NOT t.tgisinternal
             AND (fence.enabled='A' OR (t.tgdeferrable AND t.tginitdeferred)))
       THEN RAISE EXCEPTION 'TASK398_OWNED_280_FENCE_CHANGED'; END IF;
       EXECUTE format('DROP TRIGGER %I ON %s',fence.name,fence.rel);
     END LOOP;
     FOR fence IN SELECT revoke FROM (${owned280Execs}) acl WHERE acl.oid <> ALL(${before})
     LOOP EXECUTE fence.revoke; END LOOP;
   END;
   $cash_teardown$;
   ${routines.map(r=>`DROP FUNCTION public.${r};`).join("\n")}
   SELECT public.jg_require_contract_direct_upward_source_v2();
   COMMIT;
 `);
}
async function runTask398Owned282Voucher(context, mode="standard", receipt){
 const modes=new Map([["browser-completion-290",["--browser-completion-real"]],["standard-290",[]],["standard",[]],["principal-return",["--principal-return-real"]],["cash-handover",["--cash-handover-real"]],["correction-catalog",["--cash-handover-real"]]]);
 if(!modes.has(mode))throw new Error("TASK398_OWNED_282_SCENARIO");
 if(mode==="browser-completion-290"&&receipt?.purpose!=="TASK398_BROWSER_COMPLETION_EXACT_290") throw Error("TASK398_BROWSER_290_SCOPE");
 if(mode==="standard-290"&&receipt?.purpose!=="TASK398_STANDARD_EXACT_290") throw Error("TASK398_STANDARD_290_SCOPE");
 if(mode==="correction-catalog"&&receipt?.purpose!=="NTF04_CONTROLLED_ROUND_EXACT_290") throw Error("NTF04_CATALOG_SCOPE");
 const options=task398Options(modes.get(mode));
 const fences=ownedCashFenceProfile(options.principalScenario);
 const {candidateTree,sourceBaseSha: candidate,runId,database,workDir,sql:ownerSql,readPostgresLog}=context;
 const short=runId.replaceAll("-","");
 if(candidateTree!==((mode==="correction-catalog"||mode==="standard-290"||mode==="browser-completion-290")?"23b1c98bc15f36e986d17059579e6673315b9be8":"8d3e50a0c525a68e717b74fbecbcceabc80840f7")||candidate!=="0a5b607cf912ffbb50237af2608ac8b2a5360c16"||containerName(runId)===""||database!==`jg_task01_${short}`
   ||!path.isAbsolute(workDir)||typeof ownerSql!=="function"||typeof readPostgresLog!=="function")throw new Error("TASK398_OWNED_280_IDENTITY");
 const roleUrls={jg_task01_owner:context.ownerUrl,jg_task01_runtime:context.runtimeUrl,jg_task01_observer:context.observerUrl};
 const urls=Object.entries(roleUrls).map(([role,value])=>{
  const endpoint=new URL(value);
  if(endpoint.protocol!=="postgresql:"||endpoint.hostname!=="127.0.0.1"||endpoint.username!==role||!endpoint.password
     ||endpoint.pathname!==`/${database}`||endpoint.searchParams.get("sslmode")!=="require"
     ||endpoint.searchParams.get("sslaccept")!=="strict")throw new Error("TASK398_OWNED_280_ENDPOINT");
  return endpoint;
 });
 if(!urls[0].port||urls.some(url=>url.port!==urls[0].port))throw new Error("TASK398_OWNED_280_ENDPOINT");
 const afterPhase={
  "ALTER DATABASE":"TASK398_OWNED_ROLE_SETUP",
  "BEGIN;":"TASK398_OWNED_PREPARED_MEMBER",
  "CREATE FUNCTION":"TASK398_OWNED_FENCE_INSTALL",
  "GRANT SELECT":"TASK398_OWNED_BOUNDED_ACL",
  "SELECT CASE":"TASK398_OWNED_ROLE_CHECK",
  "SELECT jsonb_build_object":"TASK398_OWNED_LEDGER_CHECK"
 };
 const sql=async(role,statement)=>{
  if(role!=="jiangkong"&&role!=="jg_task01_owner")throw new Error("TASK398_OWNED_280_OWNER_REQUIRED");
  try {
   const {stdout}=await ownerSql(statement);
   return stdout.trim();
  } catch(error) {
   const phase=Object.entries(afterPhase).find(([prefix])=>statement.trimStart().startsWith(prefix))?.[1];
   if(phase)error.cashPhase=phase;
   throw error;
  }
 };
 const readback=JSON.parse(await sql("jg_task01_owner",`
   SELECT jsonb_build_object('database',current_database(),'actor',current_user,'ownerOid',d.datdba::text,
     'sameActor',current_user=session_user,'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
     'ledger',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum) ORDER BY migration_name)
       FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
     'inactiveLedger',(SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL))
   FROM pg_database d WHERE d.datname=current_database();
 `));
 const ledger=readback.ledger.map(row=>({name:row.name,sha256:row.sha256,finished:true,rolledBack:false}));
 if(readback.database!==database||readback.actor!=="jg_task01_owner"||readback.ownerOid!=="10"
   ||readback.sameActor!==true||readback.tls!==true||readback.inactiveLedger!==0||ledger.length!==((mode==="correction-catalog"||mode==="standard-290"||mode==="browser-completion-290")?290:282)
   ||createHash("sha256").update(JSON.stringify(ledger)).digest("hex")!==((mode==="correction-catalog"||mode==="standard-290"||mode==="browser-completion-290")?"8741d9da09253efb803af9e132b4cde09de0dfef86da7edf952b6c0056a057a5":"be6d9aed22658af5e273010a2e1e839544fa27e74e998701fb3d9e9248f88cfc"))throw new Error("TASK398_OWNED_280_LEDGER");
 const protectedExec=await snapshotOwned280CashProfile(sql,fences);
 const storage=mkdtempSync(path.join(workDir,"cash-storage-"));
 chmodSync(storage,0o700);
 const url=role=>roleUrls[role];
 const env={PATH:process.env.PATH,HOME:process.env.HOME,COREPACK_HOME:process.env.COREPACK_HOME,COREPACK_DEFAULT_TO_LATEST:"0",COREPACK_ENABLE_NETWORK:"0",TMPDIR:storage,NODE_ENV:"test",CI:"true",FILE_STORAGE_DRIVER:"local",FILE_STORAGE_ROOT:storage,OPERATING_LEDGER_DB_WRITE_SECRET:secret,JWT_ACCESS_SECRET:randomBytes(32).toString("hex"),JWT_REFRESH_SECRET:randomBytes(32).toString("hex"),FILE_DOWNLOAD_SECRET:randomBytes(32).toString("hex"),SMS_ENABLED:"false",APPROVAL_SMS_ENABLED:"false",RUN_TASK398_SHARED_PG16:"1",TASK398_OWNED_282_VOUCHER:"1",TASK398_RUN_ID:short};
 await sql("jg_task01_owner",`
   ALTER DATABASE ${database} SET jg.task398_run_id='${short}';
   ALTER ROLE jg_task01_runtime SET application_name='jg398_runtime';
   GRANT USAGE ON SCHEMA public TO jg_task01_runtime,jg_task01_observer;
   GRANT INSERT ("fileId") ON public."HandwrittenSignatureVersion" TO jg_task01_runtime;
   ${renderTask398Owned280FileGuardGrant(database)}
   ${owned280CapacitySql}
   ${options.handoverScenario?owned282CashHandoverSql:""}
 `);
 const catalog=await runBusiness(options,{candidate,short,storage,url,sql,env,current280:true,readPostgresLog,
  correctionCatalog:mode==="correction-catalog"?{context,receipt}:undefined,standard290:mode==="standard-290"?receipt:undefined,browser290:mode==="browser-completion-290"?receipt:undefined,ownedMigrationBaseline:{
  expectedDirectoryCount:282,terminalMigration:"20261118231000_registered_payment_voucher_fixed_read",
  terminalMigrationChecksum:"e1ff36a191e8173a2cf06db3c20aa386db58360bfceba39eed010f9444da196e"
 }});
 await closeOwned280CashProfile(sql,protectedExec,fences);
 return catalog;
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
module.exports={runTask398Owned282Voucher,selectTask398Scenario,runtimePlan,columnGrants,technicalDeleteGrant,technicalDeleteCheckSql,signatureBindingCheckSql,approvalDependencyCheckSql,spotGuardCheckSql,businessReadGrantSql,businessReadCheckSql,excludedReadTables,observerReadGrantSql,observerReadCheckSql,observerTables,observerSignatureColumns,meSensitiveReadCheckSql,cleanupOwnedContainer,containerName};
