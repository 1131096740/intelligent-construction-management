"use strict";

// Disposable local PG only. This runner has not been admitted for execution
// until its resource, role and payment-guard setup has been independently reviewed.
const {randomUUID,randomBytes}=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {mkdtempSync,readFileSync,rmSync,chmodSync,realpathSync,mkdirSync}=require("node:fs");
const {tmpdir}=require("node:os");
const path=require("node:path");
const {createCommandRuntime}=require("./money-bigint-runner-runtime.cjs");
const {CI_DYNAMIC_MIGRATION_LABEL,createCiDynamicMigrationFixture}=require("./local-staged-ci-dynamic.cjs");
const {renderTask398FileGuardGrant}=require("./contract-bank-runtime-fixture.cjs");
const {CASH_WRITER_FUNCTIONS}=require("./task16-current261-cash-profile.cjs");
const {referenceGuardBody,versionGuardBody}=require("./task16-registered-access-check.cjs");
const root=path.resolve(__dirname,"../../.."),db="jiangkong_payment_execution_concurrency",runId=randomUUID(),short=runId.replaceAll("-",""),name=`jg398-shared-${short}`;
const password=randomUUID(),secret=randomBytes(32).toString("hex");
let containerId,endpoint,storage,launchAttempted=false;
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
async function run(){
 if(process.env.NODE_ENV==="production"||process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 const candidate=process.env.TASK398_EXPECTED_SHA;
 if(!/^[a-f0-9]{40}$/u.test(candidate??"")||command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_EXACT_CLEAN_CANDIDATE_REQUIRED");
 storage=realpathSync(mkdtempSync(path.join(tmpdir(),"jg398-shared-")));chmodSync(storage,0o700);
 endpoint=process.env.DOCKER_HOST||command("docker",["context","inspect","--format","{{.Endpoints.docker.Host}}"],{quiet:true});
 if(!endpoint.startsWith("unix://"))throw new Error("TASK398_LOCAL_ONLY");
 launchAttempted=true;
 const launchedId=docker(["run","--detach","--rm","--pull=never","--name",name,"--label",`${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,"--env","POSTGRES_PASSWORD","--env","POSTGRES_USER=jiangkong", "--env",`POSTGRES_DB=${db}`,"--publish","127.0.0.1::5432","postgres:16"],{env:{...process.env,POSTGRES_PASSWORD:password},quiet:true});
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
 sql("jiangkong",`CREATE ROLE jg_task01_owner LOGIN SUPERUSER PASSWORD '${password}';\nCREATE ROLE jg_task01_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\nCREATE ROLE jg_task01_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\nALTER DATABASE ${db} SET jg.task398_run_id='${short}';`);
 sql("jiangkong",`GRANT USAGE ON SCHEMA public TO jg_task01_runtime,jg_task01_observer;\nGRANT INSERT ("fileId") ON public."HandwrittenSignatureVersion" TO jg_task01_runtime;\n${renderTask398FileGuardGrant()}`);
 const files=["registered-funding.sql","registered-history-revision.sql","registered-write-authority.sql","registered-canonical-proof.sql","registered-intercompany.sql","registered-canonical-adapter.sql","registered-voucher.sql"].map(file=>readFileSync(path.join(__dirname,"prepared/task16",file),"utf8"));
 files.push(readFileSync(path.join(__dirname,"prepared/task16-current259/registered-impact-reader.sql"),"utf8"));
 sql("jg_task01_owner",`BEGIN;\nSET LOCAL jg.task16_runtime_role='jg_task01_runtime';\n${files.join("\n")}\nCOMMIT;`);
 const voucher=require("./task16-current259-voucher-acl.cjs").current259VoucherAcl();
 sql("jg_task01_owner",`CREATE FUNCTION public.jg_task16_runtime_reference_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$${referenceGuardBody}$guard$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_reference_read_only() FROM PUBLIC;\nCREATE FUNCTION public.jg_task16_runtime_version_read_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $version$${versionGuardBody}$version$;\nREVOKE EXECUTE ON FUNCTION public.jg_task16_runtime_version_read_only() FROM PUBLIC;\nCREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_version_read_only();\nALTER TABLE public."ContractVersion" ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only;\nCREATE TRIGGER jg_task16_runtime_user_position_read_only BEFORE UPDATE ON public."UserPosition" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."UserPosition" ENABLE ALWAYS TRIGGER jg_task16_runtime_user_position_read_only;\nCREATE TRIGGER jg_task16_runtime_company_read_only BEFORE UPDATE ON public."CompanyEntity" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."CompanyEntity" ENABLE ALWAYS TRIGGER jg_task16_runtime_company_read_only;\nCREATE TRIGGER jg_task398_signature_read_only BEFORE UPDATE ON public."HandwrittenSignatureVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_task16_runtime_reference_read_only();\nALTER TABLE public."HandwrittenSignatureVersion" ENABLE ALWAYS TRIGGER jg_task398_signature_read_only;\n${voucher.guardSql}`);
 const requirements=require("./task16-current259-voucher-acl.requirements.json");
 const plan=runtimePlan();
 const routines=[...plan.runtime.functions.filter(name=>!name.includes("jg_task01_connection_identity")),...CASH_WRITER_FUNCTIONS,...requirements.routineSources.map(row=>row.signature),"public.jg_read_registered_payment_impacts(text,text,text,text,text)"];
 if(routines.some(name=>typeof name!=="string"||!/^[a-zA-Z0-9_.,()" ]+$/u.test(name)))throw new Error("TASK398_ROUTINE_LIST");
 sql("jiangkong",`${columnGrants(plan)}\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO jg_task01_observer;\nREVOKE ALL ON public."OperatingLedgerWriteSecret",public."OperatingLedgerWriteContext" FROM jg_task01_runtime,jg_task01_observer;\n${[...new Set(routines)].map(name=>`GRANT EXECUTE ON FUNCTION ${name} TO jg_task01_runtime;`).join("\n")}\nINSERT INTO public."OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,public.crypt('${secret}',public.gen_salt('bf')));`);
 const check=sql("jiangkong",`SELECT CASE WHEN NOT EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer') AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)) AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('jg_task01_runtime','jg_task01_observer')) AND NOT has_table_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,DELETE') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingLedgerWriteSecret"','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_runtime','public."OperatingImpactEntry"','INSERT,UPDATE,REFERENCES') AND NOT has_any_column_privilege('jg_task01_observer','public."OperatingFact"','INSERT,UPDATE,REFERENCES') AND NOT has_schema_privilege('jg_task01_runtime','public','CREATE') AND NOT has_schema_privilege('jg_task01_observer','public','CREATE') THEN 'TASK398_ROLE_CHECK_OK' ELSE 'TASK398_ROLE_CHECK_FAILED' END;`);
 if(!check.includes("TASK398_ROLE_CHECK_OK"))throw new Error("TASK398_ROLE_CHECK");
 env.DATABASE_URL=url("jg_task01_runtime");env.TASK398_OWNER_URL=url("jg_task01_owner");env.TASK398_OBSERVER_URL=url("jg_task01_observer");
 command("pnpm",["--filter","@jiangkong/api","exec","jest","--runInBand","src/database/task16-shared-standard.http.pg.spec.ts"],{env,timeout:300000});
 if(command("git",["rev-parse","HEAD"],{quiet:true})!==candidate||command("git",["status","--porcelain"],{quiet:true})!=="")throw new Error("TASK398_CANDIDATE_CHANGED");
}
let businessPassed=false;
if(require.main===module)run().then(()=>{businessPassed=true;},error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{
 let containerClean=true;
 if(launchAttempted){
  const list=()=>docker(["ps","-a","--no-trunc","--filter",`name=^/${name}$`,"--format","{{.ID}}"],{quiet:true}).split("\n").filter(Boolean);
  const status=cleanupOwnedContainer({id:containerId,name,runId,list,inspect:id=>{const value=JSON.parse(docker(["inspect","--type","container","--format",`{"id":{{json .Id}},"name":{{json .Name}},"runId":{{json (index .Config.Labels \"${CI_DYNAMIC_MIGRATION_LABEL}\")}}}`,id],{quiet:true}));return {...value,name:value.name?.replace(/^\//u,"")};},remove:id=>docker(["rm","--force","--volumes",id],{quiet:true}),confirmAbsent:id=>!list().includes(id)});
  console.error(`TASK398_CONTAINER_CLEANUP_${status} run=${runId} name=${name}`);if(status==="UNKNOWN"){containerClean=false;console.error(`TASK398_STORAGE_RETAINED:${storage}`);process.exitCode=1;}
 }
 if(storage&&containerClean)try{rmSync(storage,{recursive:true,force:true});}catch{console.error("TASK398_STORAGE_CLEANUP_FAILED");process.exitCode=1;}
 if(businessPassed&&!process.exitCode)console.log(`TASK398_STANDARD_PASS candidate=${process.env.TASK398_EXPECTED_SHA} run=${runId}`);
});
module.exports={runtimePlan,columnGrants,cleanupOwnedContainer};
