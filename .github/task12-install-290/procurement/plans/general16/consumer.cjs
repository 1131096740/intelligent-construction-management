"use strict";
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const {randomUUID,createHash}=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {setTimeout:delay}=require("node:timers/promises");
const {withOutside289GeneralProcurement}=require("./installer.cjs");
const {createOwnerSql,attemptCleanup}=require("./owner-observation.cjs");
const {roleSetup,roleTeardown}=require("./procurement289-nodb/services/api/prisma/general-procurement-owned-ci.cjs");
const receipt={schemaVersion:1,purpose:"GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_ON_289",stages:[],status:"STOPPED"};
const helper="public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)";
const raw="public.jg_project_owner_settlement_voucher_bound(text)";
const expenseHelper="public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text)";
const expenseBinding="public.jg_legacy_procurement_expense_voucher_binding_v1";
const role="general_procurement_runtime";
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const fixturePngSha=createHash("sha256").update(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=","base64")).digest("hex");
const condition=(result,message)=>{if(!result)throw new Error(message);};

withOutside289GeneralProcurement(receipt,async context=>{
  const {database,runId,workDir}=context;
  condition(context.candidateTree==="a1be083076018686dd8afba68c44ff9c75502014" && uuid.test(runId) && database==="jg_task01_"+runId.replaceAll("-",""),"PROCUREMENT_ARCHIVE_CONTEXT");
  const ownerSql=createOwnerSql(context.sql,receipt);
  const password=randomUUID();
  await ownerSql("ROLE_SETUP",roleSetup("procurement",database,password));
  const storage=path.join(workDir,"procurement-files");
  fs.mkdirSync(storage,{mode:0o700});
  const runtime=new URL(context.ownerUrl);
  runtime.username=role; runtime.password=password;
  condition(runtime.searchParams.get("connection_limit")==="1","PROCUREMENT_ARCHIVE_POOL_PREIMAGE");
  runtime.searchParams.set("connection_limit","2");
  const {stageProcurementWorkspace}=require("/qualification/stage-procurement.cjs");
  const web=stageProcurementWorkspace(workDir);
  const resultPath=path.join(workDir,"procurement-archive-jest.json");
  const spec="src/database/general-procurement-http-postgres.spec.ts";
  const migrationSpec="src/database/approval-v6-migration-postgres.spec.ts";
  const child=spawn("pnpm",["--filter","@jiangkong/api","exec","jest","--runInBand","--runTestsByPath",spec,migrationSpec,"--json","--outputFile",resultPath],{
    cwd:"/qualification/procurement289-nodb",env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:workDir,TMPDIR:workDir,
      COREPACK_HOME:"/opt/corepack",COREPACK_ENABLE_NETWORK:"0",COREPACK_DEFAULT_TO_LATEST:"0",NODE_ENV:"test",CI:"true",
      DATABASE_URL:runtime.toString(),FILE_STORAGE_DRIVER:"local",FILE_STORAGE_ROOT:storage,
      INITIAL_USER_TEMPORARY_PASSWORD:"Local-Initial-Only-01",SMS_ENABLED:"false",
      JG_PROCUREMENT_OWNED_RUN_ID:runId,JG_TASK12_OWNED_280_RUN_ID:runId,JG_PROCUREMENT_OWNED_SCOPE:"procurement",
      RUN_GENERAL_PROCUREMENT_PG16:"1",RUN_GENERAL_PROCUREMENT_BROWSER:"1",JG_PROCUREMENT_ARCHIVE_PROOF:"1",
      PLAYWRIGHT_BROWSERS_PATH:"/opt/jg-playwright",JG_PROCUREMENT_OWNED_WEB_ROOT:web},stdio:["ignore","pipe","pipe"],
  });
  let rawOutput="";
  for(const pipe of [child.stdout,child.stderr]){
    pipe.setEncoding("utf8").on("data",part=>{if(rawOutput.length<2*1024*1024)rawOutput+=part;});
  }
  const exited=once(child,"exit");
  const deadline=Date.now()+300_000;
  let publicBinding=false;
  let activeIds, expenseActive, expenseCompleted;
  let expenseBound=false;
  const seenRequests=new Set(), seenFiles=new Set();
  const bindExpense=async ({claimId,voucherId,actorId})=>{
    const scope=await ownerSql("EXPENSE_READBACK",`SELECT "projectId" FROM public."ExpenseClaim" WHERE id='${claimId}';`);
    const projectId=scope.stdout.trim();
    condition(uuid.test(projectId),"PROCUREMENT_EXPENSE_SCOPE_PROJECT");
    const witnessed=await ownerSql("EXPENSE_WITNESS_BIND",`
      BEGIN;
      INSERT INTO ${expenseBinding}
        (database_oid,system_identifier,server_port,runtime_role_oid,claim_id,project_id,approval_id,actor_id,file_id,content_sha256,size_bytes,mime_type)
      SELECT d.oid,(SELECT system_identifier::text FROM pg_control_system()),inet_server_port(),r.oid,c.id,c."projectId",
        c."approvalInstanceId",f."uploadedByUserId",f.id,f."contentSha256",f."sizeBytes",f."mimeType"
      FROM public."ExpenseClaim" c
      JOIN public."FileObject" f ON f.id='${voucherId}' AND f."uploadedByUserId"='${actorId}'
      JOIN pg_roles r ON r.rolname='${role}' AND NOT r.rolsuper
      JOIN pg_database d ON d.datname=current_database() AND d.datdba=current_user::regrole::oid
      WHERE c.id='${claimId}' AND c."projectId"='${projectId}' AND c.status='approved_pending_payment'
        AND c."generalProcurementId" IS NOT NULL AND c."claimType"='incidental_expense'
        AND f."storageStatus"='active' AND f."mimeType"='image/png' AND f."contentSha256"='${fixturePngSha}'
        AND EXISTS(SELECT FROM public."AuditLog" a WHERE a.action='file.upload'
          AND a."businessId"=f.id AND a."actorUserId"=f."uploadedByUserId" AND a.metadata->>'objectKey'=f."objectKey");
      GRANT EXECUTE ON FUNCTION ${expenseHelper} TO ${role};
      SELECT (count(*)=1 AND NOT has_function_privilege('${role}','${raw}','EXECUTE') AND
        NOT has_function_privilege('jg_task01_runtime','${expenseHelper}','EXECUTE') AND
        NOT has_function_privilege('jg_task01_observer','${expenseHelper}','EXECUTE') AND
        NOT has_any_column_privilege('${role}','${expenseBinding}','SELECT,INSERT,UPDATE,REFERENCES') AND
        NOT has_table_privilege('${role}','${expenseBinding}','DELETE,TRUNCATE,TRIGGER') AND
        NOT has_function_privilege('${role}','${expenseHelper}','EXECUTE WITH GRANT OPTION'))::text
      FROM ${expenseBinding};
      COMMIT;`);
    expenseBound=true;
    condition(witnessed.stdout.trim()==="true","PROCUREMENT_EXPENSE_WITNESS_ACL");
    return {claimId,projectId,voucherId,actorId};
  };
  const readExpense=async ({claimId,projectId,voucherId,actorId},executionId)=>{
    const result=await ownerSql("EXPENSE_READBACK",`
      SELECT jsonb_build_object(
        'partiallyPaid',c.status='partially_paid' AND c."fundedAmountCents"=15000 AND c."companyPayableAmountCents"=20000,
        'execution',(SELECT count(*)=1 AND bool_and(e.id='${executionId}' AND e."voucherFileId"='${voucherId}'
              AND e."recordedByUserId"='${actorId}' AND e."amountCents"=15000 AND f."contentSha256"='${fixturePngSha}')
          FROM public."ExpenseClaimPaymentExecution" e JOIN public."FileObject" f ON f.id=e."voucherFileId"
          WHERE e."expenseClaimId"=c.id),
        'source',(SELECT count(*)=1 AND bool_and(a."executionId"='${executionId}' AND a."amountCents"=15000
              AND a."sourceType"='project_cash' AND a.direction='debit' AND a."createdByUserId"='${actorId}')
          FROM public."ProjectFundingAllocation" a
          WHERE a."businessId"=c.id AND a."projectId"=c."projectId" AND a."executionType"='expense_claim_payment_execution'),
        'receipt',(SELECT count(*)=1 AND bool_and(r."amountCents"=100000 AND r."recordedByUserId"='${actorId}')
          FROM public."ProjectReceipt" r WHERE r."projectId"=c."projectId"),
        'audit',(SELECT count(*)=1 AND bool_and(a."actorUserId"='${actorId}' AND a.metadata->>'voucherFileId'='${voucherId}')
          FROM public."AuditLog" a WHERE a."businessId"=c.id AND a.action='incidental_expense.payment.record'))
      FROM public."ExpenseClaim" c WHERE c.id='${claimId}' AND c."projectId"='${projectId}';`);
    const facts=JSON.parse(result.stdout.trim());
    condition(Object.keys(facts).sort().join(",")==="audit,execution,partiallyPaid,receipt,source" &&
      Object.values(facts).every(value=>value===true),"PROCUREMENT_EXPENSE_FUNDED_READBACK");
    return facts;
  };
  receipt.archiveBridges=[];
  try{
    for(let sequence=1;sequence<=16;sequence++){
      const request=path.join(workDir,`procurement-archive-${sequence}.json`);
      while(!fs.existsSync(request)&&child.exitCode===null&&child.signalCode===null){
        condition(Date.now()<deadline,"PROCUREMENT_ARCHIVE_ORIGINAL_DEADLINE");
        await delay(50);
      }
      if(!fs.existsSync(request))break;
      const ids=JSON.parse(fs.readFileSync(request,"utf8"));
      const phase=sequence%2===1?"bind":"consume";
      condition(ids.phase===phase&&["archive","expense"].includes(ids.scope)&&uuid.test(ids.actorId)&&uuid.test(ids.targetId),
        "PROCUREMENT_FINITE_FIXTURE_IDS");
      if(ids.scope==="expense"){
        condition(uuid.test(ids.fileOrExecutionId)&&!activeIds,"PROCUREMENT_EXPENSE_SCOPE_OVERLAP");
        if(phase==="bind"){
          condition(!expenseActive&&!expenseCompleted,"PROCUREMENT_EXPENSE_SCOPE_REPEAT");
          expenseActive=await bindExpense({claimId:ids.targetId,voucherId:ids.fileOrExecutionId,actorId:ids.actorId});
        }else{
          condition(expenseActive&&expenseActive.claimId===ids.targetId&&expenseActive.actorId===ids.actorId,
            "PROCUREMENT_EXPENSE_CONSUMER_MISMATCH");
          const facts=await readExpense(expenseActive,ids.fileOrExecutionId);
          await ownerSql("EXPENSE_WITNESS_REMOVE",`REVOKE EXECUTE ON FUNCTION ${expenseHelper} FROM ${role}; DELETE FROM ${expenseBinding};`);
          expenseBound=false;
          expenseCompleted={binding:expenseActive,executionId:ids.fileOrExecutionId,facts};
          receipt.expenseFunded=facts;
          expenseActive=undefined;
        }
        fs.writeFileSync(path.join(workDir,`procurement-archive-${sequence}.ready`),"",{flag:"wx",mode:0o600});
        continue;
      }
      condition(!expenseActive,"PROCUREMENT_ARCHIVE_EXPENSE_OVERLAP");
      ids.procurementId=ids.targetId;
      ids.fileId=ids.fileOrExecutionId;
      if(phase==="bind"){
        condition(uuid.test(ids.fileId)&&!activeIds&&!seenRequests.has(ids.procurementId)&&!seenFiles.has(ids.fileId),"PROCUREMENT_ARCHIVE_SCOPE_REPEAT");
        const bound=await ownerSql("APPROVED_SCOPE_READ",`SELECT jsonb_build_object('projectId',g."projectId",'revision',g.revision)
          FROM public."GeneralProcurement" g WHERE g.id='${ids.procurementId}' AND g.status='approved_pending_archive';`);
        const facts=JSON.parse(bound.stdout.trim());
        condition(uuid.test(facts.projectId)&&facts.revision===5,"PROCUREMENT_ARCHIVE_CURRENT_REVISION");
        Object.assign(ids,facts);
        const out=await ownerSql("EXACT_UPLOAD_BIND",`
          BEGIN;
          INSERT INTO public.jg_general_procurement_archive_binding_v1
            (database_oid,system_identifier,server_port,runtime_role_oid,procurement_id,project_id,approval_id,actor_id,file_id,revision,content_sha256,size_bytes,mime_type)
          SELECT d.oid,(SELECT system_identifier::text FROM pg_control_system()),inet_server_port(),r.oid,
            g.id,g."projectId",g."approvalInstanceId",f."uploadedByUserId",f.id,g.revision,f."contentSha256",f."sizeBytes",f."mimeType"
          FROM public."GeneralProcurement" g
          JOIN public."FileObject" f ON f.id='${ids.fileId}' AND f."uploadedByUserId"='${ids.actorId}'
          JOIN pg_roles r ON r.rolname='${role}' AND NOT r.rolsuper
          JOIN pg_database d ON d.datname=current_database() AND d.datdba=current_user::regrole::oid
          WHERE g.id='${ids.procurementId}' AND g."projectId"='${ids.projectId}' AND g.revision=${ids.revision}
            AND g.status='approved_pending_archive' AND g."archiveFileId" IS NULL
            AND f."storageStatus"='active' AND f."mimeType"='image/png' AND f."contentSha256"='${fixturePngSha}'
            AND EXISTS(SELECT FROM public."AuditLog" a WHERE a.action='file.upload'
              AND a."businessId"=f.id AND a."actorUserId"=f."uploadedByUserId" AND a.metadata->>'objectKey'=f."objectKey");
          GRANT EXECUTE ON FUNCTION ${helper} TO ${role};
          SELECT (count(*)=1 AND
            NOT has_function_privilege('${role}','${raw}','EXECUTE') AND
            NOT has_function_privilege('jg_task01_runtime','${helper}','EXECUTE') AND
            NOT has_function_privilege('jg_task01_observer','${helper}','EXECUTE') AND
            NOT has_any_column_privilege('${role}','public.jg_general_procurement_archive_binding_v1','SELECT,INSERT,UPDATE,REFERENCES') AND
            NOT has_table_privilege('${role}','public.jg_general_procurement_archive_binding_v1','DELETE,TRUNCATE,TRIGGER') AND
            NOT has_function_privilege('${role}','${helper}','EXECUTE WITH GRANT OPTION'))::text
          FROM public.jg_general_procurement_archive_binding_v1;
          COMMIT;`);
        publicBinding=true;
        condition(out.stdout.trim()==="true","PROCUREMENT_ARCHIVE_BOUND_ACL");
        activeIds=ids;
      }else{
        condition(activeIds&&ids.procurementId===activeIds.procurementId&&ids.actorId===activeIds.actorId,"PROCUREMENT_ARCHIVE_CONSUMER_MISMATCH");
        const done=await ownerSql("ARCHIVE_READBACK",`SELECT (count(*)=1)::text FROM public."GeneralProcurement" g
          JOIN public."FileObject" f ON f.id=g."archiveFileId"
          WHERE g.id='${activeIds.procurementId}' AND g."projectId"='${activeIds.projectId}'
            AND g."archivedByUserId"='${activeIds.actorId}' AND g.status='archived' AND g.revision=6
            AND f.id='${activeIds.fileId}' AND f."contentSha256"='${fixturePngSha}'
            AND (SELECT count(*) FROM public."AuditLog" a WHERE a."businessId"=g.id
                 AND a.action='general_procurement.archive' AND a."actorUserId"=g."archivedByUserId"
                 AND a.metadata->>'fileId'=f.id)=1;`);
        condition(done.stdout.trim()==="true","PROCUREMENT_ARCHIVE_DB_READBACK");
        await ownerSql("CONSUMED_BINDING_REMOVE",`REVOKE EXECUTE ON FUNCTION ${helper} FROM ${role}; DELETE FROM public.jg_general_procurement_archive_binding_v1;`);
        publicBinding=false;
        seenRequests.add(activeIds.procurementId);
        seenFiles.add(activeIds.fileId);
        receipt.archiveBridges.push({event:receipt.archiveBridges.length+1,archiveAndAudit:true,
          bindingSha256:createHash("sha256").update(activeIds.procurementId+"|"+activeIds.fileId).digest("hex")});
        activeIds=undefined;
      }
      fs.writeFileSync(path.join(workDir,`procurement-archive-${sequence}.ready`),"",{flag:"wx",mode:0o600});
    }
    const exit=await Promise.race([exited,delay(Math.max(0,deadline-Date.now()),null,{ref:false})]);
    condition(exit!==null,"PROCUREMENT_ARCHIVE_JEST_TIMEOUT");
    const report=fs.existsSync(resultPath)?fs.readFileSync(resultPath):null;
    if(exit[0]!==0||!report){
      const parsed=report&&JSON.parse(report);
      const failures=parsed?.testResults.flatMap(suite=>suite.assertionResults).filter(test=>test.status==="failed")??[];
      const failed=failures[0];
      const assertion=failed?.failureMessages.join("\n")??"";
      const frame=/general-procurement-http-postgres\.spec\.ts:(\d+):(\d+)/u.exec(assertion);
      const pgPermission=/permission denied for (?:function|relation|table) ([A-Za-z_][A-Za-z0-9_.]{0,80})/u.exec(context.readPostgresLog())?.[1];
      receipt.narrowFailure={processExit:exit[0],testFailure:/GENERAL_PROCUREMENT_ARCHIVE_[A-Z_]+/u.exec(assertion)?.[0],
        failedCase:failed?createHash("sha256").update(failed.fullName).digest("hex"):undefined,
        passedTests:parsed?.numPassedTests,failedTests:parsed?.numFailedTests,
        cases:failures.map(({fullName,failureMessages})=>{
          const text=failureMessages.join("\n");
          const frame=/(general-procurement-http-postgres|approval-v6-migration-postgres)\.spec\.ts:(\d+):(\d+)/u.exec(text);
          return {test:createHash("sha256").update(fullName).digest("hex"),
            file:frame?.[1],frame:frame?[Number(frame[2]),Number(frame[3])]:undefined,
            sqlstate:/SqlState\(E([0-9A-Z]{5})\)/u.exec(text)?.[1],
            httpStatus:/Received:[\s\S]{0,180}?"status":\s*([1-5][0-9]{2})/u.exec(text)?.[1]};
        }),
        frame:frame?[Number(frame[1]),Number(frame[2])]:undefined,
        sqlstate:/SqlState\(E([0-9A-Z]{5})\)/u.exec(assertion)?.[1],
        assertionHttpStatus:/Received:[\s\S]{0,180}?"status":\s*([1-5][0-9]{2})/u.exec(assertion)?.[1],
        pgPermission,
        browser:{desktop:/\[desktop\]/u.test(rawOutput),mobile:/\[mobile\]/u.test(rawOutput),
          startupError:/net::(ERR_ABORTED|ERR_CONNECTION_REFUSED|ERR_FAILED)/u.exec(rawOutput)?.[1],
          moduleNotFound:/MODULE_NOT_FOUND|Cannot find module/u.test(rawOutput),
          workspaceScriptMissing:/Cannot find module[^\n]*pnpm-workspace\.mjs/u.test(rawOutput)}};
      throw new Error("PROCUREMENT_ARCHIVE_JEST");
    }
    const parsed=JSON.parse(report);
    const expectCount=(file,count)=>{
      const result=parsed.testResults.find(row=>row.name.endsWith("/"+file));
      return result?.status==="passed"&&result.assertionResults.length===count&&result.assertionResults.every(row=>row.status==="passed");
    };
    condition(parsed.success===true&&parsed.numPassedTests===16&&parsed.numPassedTestSuites===2&&parsed.numPendingTests===0&&
      expectCount(spec,15)&&expectCount(migrationSpec,1)&&receipt.archiveBridges.length===7&&!activeIds&&
      expenseCompleted&&!expenseActive,"PROCUREMENT_ARCHIVE_ORIGINAL_COVERAGE");
    receipt.expenseFinalAfterReplay=await readExpense(expenseCompleted.binding,expenseCompleted.executionId);
    receipt.archive={tests:16,browserProjects:2,actualArchiveWitnesses:7,
      reportSha256:createHash("sha256").update(report).digest("hex")};
  }catch(error){
    receipt.consumerFailure={
      code:/^[A-Z0-9_]+$/u.test(error.message??"")?error.message:"UNCLASSIFIED",
      ...(error.psqlObservation??{}),
    };
  }finally{
    await attemptCleanup(receipt,[
      ["CHILD_STOP",async ()=>{if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");await exited;}}],
      ["FAILED_BINDING_REMOVE",async ()=>{
        if(publicBinding)await ownerSql("FAILED_BINDING_REMOVE",`REVOKE EXECUTE ON FUNCTION ${helper} FROM ${role};
          DELETE FROM public.jg_general_procurement_archive_binding_v1;`);
      }],
      ["EXPENSE_WITNESS_REMOVE",async ()=>{
        if(expenseBound)await ownerSql("EXPENSE_WITNESS_REMOVE",`REVOKE EXECUTE ON FUNCTION ${expenseHelper} FROM ${role}; DELETE FROM ${expenseBinding};`);
      }],
      ["ROLE_TEARDOWN",()=>ownerSql("ROLE_TEARDOWN",roleTeardown("procurement",database))],
    ]);
  }
  if(receipt.consumerFailure||receipt.cleanupFailures)throw new Error("PROCUREMENT_ARCHIVE_ORIGINAL_STOPPED");
}).then(()=>{receipt.status="GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_289_PASSED";}).catch(error=>{
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:"UNCLASSIFIED",
    command:error.command,exit:error.exit,signal:error.signal};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
