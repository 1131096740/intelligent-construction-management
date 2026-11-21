"use strict";
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const {setTimeout:delay}=require("node:timers/promises");
const {randomUUID,createHash}=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {withOutside289ProjectProcurement}=require("./installer.cjs");
const {createOwnerSql,attemptCleanup}=require("./owner-observation.cjs");
const {readProjectHttpObservation}=require("./project-scope-http-report.cjs");
const {assertProjectBrowserInputs,observeProjectBrowserReport}=require("./project-scope-browser-report.cjs");
const {roleSetup,roleTeardown}=require("./procurement289-nodb/services/api/prisma/general-procurement-owned-ci.cjs");
const receipt={schemaVersion:1,purpose:"PROJECT_BUSINESS_SCOPE_ORIGINAL_11_289",stages:[],status:"STOPPED"};
const role="project_business_scope_runtime";
const alias="public.jg_file_business_binding_columns_before_registered_payment()";
const raw="public.jg_project_owner_settlement_voucher_bound(text)";
const draftScope="public.jg_create_project_scope_initial_contract_version_v1(text,text,text)";
const binding="public.jg_project_scope_initial_contract_binding_v1";
const reviewBinding="public.jg_project_scope_legacy_review_binding_v1";
const archiveBinding="public.jg_general_procurement_archive_binding_v1";
const archivedScope="public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)";
const sha=createHash("sha256").update(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=","base64")).digest("hex");
const reviewEntry="public.jg_touch_project_scope_legacy_review_v1(text,text,text,timestamptz)";
const projectB="legacy-project-business-scope";
const uid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const condition=(result,message)=>{if(!result)throw new Error(message);};
function firstFailure(report){
  const evidence=fs.existsSync(report)?JSON.parse(fs.readFileSync(report,"utf8")):null;
  const failed=evidence?.testResults.flatMap(suite=>suite.assertionResults).find(test=>test.status==="failed");
  const assertion=failed?.failureMessages.join("\n")??"";
  const frames=[...assertion.matchAll(/project-business-scope-http-postgres\.spec\.ts:(\d+):(\d+)/gu)].slice(0,3)
    .map(frame=>[Number(frame[1]),Number(frame[2])]);
  return {
    frames,
    testId:typeof failed?.fullName==="string"?createHash("sha256").update(failed.fullName).digest("hex"):undefined,
    sameRequest:readProjectHttpObservation(assertion),
    httpStatus:Number(/(?:Received:\s*|期待 [1-5][0-9]{2}，实际 )([1-5][0-9]{2})/u.exec(assertion)?.[1])||undefined,
    prismaCode:/\b(P[0-9]{4})\b/u.exec(assertion)?.[1],
    sqlstate:/\b(42501|23514|23503|40P01|40001)\b/u.exec(assertion)?.[1],
  };
}
withOutside289ProjectProcurement(receipt,async context=>{
  const {database,runId,workDir}=context;
  condition(context.candidateTree==="a1be083076018686dd8afba68c44ff9c75502014" &&
    database==="jg_task01_"+runId.replaceAll("-",""),"PROJECT_SCOPE_SIGNATURE_CONTEXT");
  const ownerSql=createOwnerSql(context.sql,receipt);
  const password=randomUUID();
  const original=roleSetup("procurement",database,password);
  const pin=original.match(/^DO \$owned_registered_metadata\$\n[\s\S]*?^\$owned_registered_metadata\$;$/mu)?.[0];
  condition(typeof pin==="string"&&pin.includes("d2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f")&&
    pin.includes("GRANT EXECUTE ON FUNCTION "+alias+" TO general_procurement_runtime;"),
    "PROJECT_SCOPE_SIGNATURE_ALIAS_PIN");
  const defaultSetup=roleSetup("project",database,password);
  condition(!defaultSetup.includes("GRANT EXECUTE ON FUNCTION "+alias),"PROJECT_SCOPE_SIGNATURE_ALREADY_GRANTED");
  await ownerSql("ROLE_SETUP",defaultSetup);
  let aliasGranted=false;
  let draftGranted=false;
  let reviewGranted=false;
  let archiveGranted=false;
  let child;
  let exited;
  try{
    const pinnedGrant=pin.replaceAll("general_procurement_runtime",role);
    await ownerSql("PROJECT_SIGNATURE_ALIAS_GRANT",pinnedGrant);
    aliasGranted=true;
    const initial=await ownerSql("PROJECT_SIGNATURE_ALIAS_CHECK",`SELECT
      (has_function_privilege('${role}','${alias}','EXECUTE') AND
       NOT has_function_privilege('${role}','${alias}','EXECUTE WITH GRANT OPTION') AND
       NOT has_function_privilege('${role}','${raw}','EXECUTE') AND
       NOT has_table_privilege('${role}','public."ProjectOwnerSettlementEntry"','SELECT') AND
       NOT has_any_column_privilege('${role}','public._prisma_migrations','SELECT') AND
       NOT EXISTS (SELECT FROM (VALUES ('Contract'),('ContractVersion'),('PaymentTermsVersion'),('PaymentTermsStage'),('AuditLog')) t(name)
         WHERE has_table_privilege('${role}',format('public.%I',t.name),'TRUNCATE,TRIGGER')) AND
       has_column_privilege('${role}','public."RegisteredPaymentVoucher"','fileId','SELECT') AND
       NOT has_function_privilege('${role}','public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)','EXECUTE') AND
       NOT has_function_privilege('${role}','public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text)','EXECUTE'))::text;`);
    condition(initial.stdout.trim()==="true","PROJECT_SCOPE_SIGNATURE_ALIAS_ACL");
    const ownerTarget=new URL(context.ownerUrl);
    condition(ownerTarget.searchParams.get("connection_limit")==="1","PROJECT_SCOPE_POOL_PREIMAGE");
    // Match the previous original project fixture. The nested password read needs the second connection.
    ownerTarget.searchParams.set("connection_limit","2");
    const runtime=new URL(ownerTarget);
    receipt.projectFixturePool={owner:2,runtime:2};
    runtime.username=role;runtime.password=password;
    const storage=path.join(workDir,"project-scope-files");fs.mkdirSync(storage,{mode:0o700});
    const {stageProcurementWorkspace}=require("/qualification/stage-procurement.cjs");
    const web=stageProcurementWorkspace(workDir);
    assertProjectBrowserInputs(web);
    const report=path.join(workDir,"project-scope-signatures-jest.json");
    const spec="src/database/project-business-scope-http-postgres.spec.ts";
    child=spawn("pnpm",["--filter","@jiangkong/api","exec","jest","--runInBand","--runTestsByPath",spec,"--json","--outputFile",report],{
      cwd:"/qualification/procurement289-nodb",stdio:["ignore","pipe","pipe"],
      env:{PATH:"/usr/local/bin:/usr/bin:/bin",HOME:workDir,TMPDIR:workDir,COREPACK_HOME:"/opt/corepack",
        COREPACK_ENABLE_NETWORK:"0",COREPACK_DEFAULT_TO_LATEST:"0",NODE_ENV:"test",CI:"true",DATABASE_URL:runtime.toString(),
        PROJECT_BUSINESS_SCOPE_FIXTURE_DATABASE_URL:ownerTarget.toString(),SPOT_PROCUREMENT_PILOT_PROJECT_IDS:"*",
        FILE_STORAGE_DRIVER:"local",FILE_STORAGE_ROOT:storage,INITIAL_USER_TEMPORARY_PASSWORD:"Local-Initial-Only-01",SMS_ENABLED:"false",
        JG_PROCUREMENT_OWNED_RUN_ID:runId,JG_PROCUREMENT_OWNED_SCOPE:"project",JG_TASK12_OWNED_280_RUN_ID:runId,
        RUN_PROJECT_BUSINESS_SCOPE_PG16:"1",RUN_PROJECT_BUSINESS_SCOPE_BROWSER:"1",
        JG_PROJECT_SCOPE_ARCHIVE:"1",PLAYWRIGHT_BROWSERS_PATH:"/opt/jg-playwright",JG_PROCUREMENT_OWNED_WEB_ROOT:web,
        JG_PROJECT_SCOPE_DRAFT_PROOF:"1",JG_PROJECT_SCOPE_LEGACY_REVIEW_PROOF:"1",JG_PROJECT_SCOPE_HTTP_OBSERVATION:"1"},
    });
    child.stdout.resume();child.stderr.resume();
    exited=once(child,"exit");
    const deadline=Date.now()+300_000;
    const input=path.join(workDir,"project-b-draft.json");
    while(!fs.existsSync(input)&&child.exitCode===null&&child.signalCode===null){
      condition(Date.now()<deadline,"PROJECT_SCOPE_DRAFT_HANDOFF_TIMEOUT");
      await delay(50);
    }
    if(!fs.existsSync(input)){
      receipt.projectScopeFailure=firstFailure(report);
      throw new Error("PROJECT_SCOPE_DRAFT_NOT_ENTERED");
    }
    const {projectId,companyActor,templateVersion}=JSON.parse(fs.readFileSync(input,"utf8"));
    condition(projectId===projectB&&[companyActor,templateVersion].every(value=>uid.test(value)),"PROJECT_SCOPE_DRAFT_BOUND_IDS");
    const bound=await ownerSql("PROJECT_DRAFT_BIND",`
      BEGIN;
      INSERT INTO ${binding}(database_oid,system_identifier,server_port,runtime_role_oid,project_id,actor_id,template_version_id)
      SELECT d.oid,(SELECT system_identifier::text FROM pg_control_system()),inet_server_port(),r.oid,
        p.id,actor.id,v.id
      FROM public."Project" p
      JOIN public."User" actor ON actor.id='${companyActor}' AND actor."isActive"
      JOIN public."ContractBusinessTemplateVersion" v ON v.id='${templateVersion}' AND v.status='published'
      JOIN public."ContractBusinessTemplate" t ON t.id=v."templateId" AND t."contractTypeKey"='generic_contract'
      JOIN pg_roles r ON r.rolname='${role}' AND NOT r.rolsuper
      JOIN pg_database d ON d.datname=current_database() AND d.datdba=current_user::regrole::oid
      WHERE p.id='${projectB}' AND p."isActive"
        AND EXISTS(SELECT FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
          WHERE up."userId"=actor.id AND up."projectId" IS NULL AND pos.key='contract_staff');
      GRANT EXECUTE ON FUNCTION ${draftScope} TO ${role};
      SELECT (count(*)=1 AND
        NOT has_function_privilege('${role}','${raw}','EXECUTE') AND
        NOT has_function_privilege('${role}','public.jg_upward_archive_constraint_v2(public."ContractVersion")','EXECUTE') AND
        NOT has_function_privilege('jg_task01_runtime','${draftScope}','EXECUTE') AND
        NOT has_function_privilege('jg_task01_observer','${draftScope}','EXECUTE') AND
        NOT has_any_column_privilege('${role}','${binding}','SELECT,INSERT,UPDATE,REFERENCES') AND
        NOT has_table_privilege('${role}','${binding}','DELETE,TRUNCATE,TRIGGER') AND
        NOT has_function_privilege('${role}','${draftScope}','EXECUTE WITH GRANT OPTION'))::text
      FROM ${binding};
      COMMIT;`);
    draftGranted=true;
    condition(bound.stdout.trim()==="true","PROJECT_SCOPE_DRAFT_BOUND_ACL");
    fs.writeFileSync(path.join(workDir,"project-b-draft.ready"),"",{flag:"wx",mode:0o600});
    const checkpoint=path.join(workDir,"project-b-draft-created.json");
    while(!fs.existsSync(checkpoint)&&child.exitCode===null&&child.signalCode===null){
      condition(Date.now()<deadline,"PROJECT_SCOPE_DRAFT_CHECKPOINT_TIMEOUT");
      await delay(50);
    }
    if(!fs.existsSync(checkpoint)){
      receipt.projectScopeFailure=firstFailure(report);
      throw new Error("PROJECT_SCOPE_DRAFT_HTTP_NOT_ENTERED_OR_FAILED");
    }
    const {contractId,versionId}=JSON.parse(fs.readFileSync(checkpoint,"utf8"));
    condition([contractId,versionId].every(value=>uid.test(value)),"PROJECT_SCOPE_DRAFT_CREATED_IDS");
    const readback=await ownerSql("PROJECT_DRAFT_READBACK",`SELECT jsonb_build_object(
      'contract',c."projectId"='${projectB}' AND c."ownerUserId"='${companyActor}'
        AND c."contractTypeKey"='generic_contract' AND c.code IS NULL AND c.name='' AND c.counterparty=''
        AND c."temporaryCode" ~ '^草稿-[0-9]{8}-[0-9]{8}$' AND c.source='system',
      'initialVersion',v."contractId"=c.id AND v."versionNo"=1 AND v."changeType"='original' AND v.status='draft'
        AND v."numericProtocolVersion"=1 AND v."contractGovernanceVersion"=1 AND v."taxFactStatus"='draft'
        AND v."signingSubjectType"='our_company' AND v."amountCents"=0 AND v."amountLimitType"='capped'
        AND v."settlementMode"='direct_payment' AND v."settlementModeSource"='rule'
        AND v."draftRevision"=1 AND v."documentContentRevision"=1 AND v."effectiveAt" IS NULL
        AND v."firstSubmittedAt" IS NULL AND v."affiliateAssignmentId" IS NULL
        AND v."businessTemplateVersionId"='${templateVersion}' AND v."draftData"='{}'::jsonb AND v."clauseSnapshot"='[]'::jsonb
        AND v."templateSnapshot"=jsonb_build_object('fieldSchema',tv."fieldSchema",'billSchema',tv."billSchema",
          'clauseSchema',tv."clauseSchema",'attachmentSchema',tv."attachmentSchema",'validationSchema',tv."validationSchema",
          'supplementChangePolicy',tv."supplementChangePolicy"),
      'terms',(SELECT count(*)=1 AND bool_and(t."contractVersionId"=v.id AND t."versionNo"=1 AND t.status='draft' AND t."originalText"='')
        FROM public."PaymentTermsVersion" t WHERE t."contractId"=c.id),
      'audit',(SELECT count(*)=1 AND bool_and(a."actorUserId"='${companyActor}' AND a."businessType"='contract'
        AND a.metadata=jsonb_build_object('temporaryCode',c."temporaryCode",'projectId','${projectB}',
          'contractTypeKey','generic_contract','businessTemplateVersionId','${templateVersion}',
          'businessScenarioId',NULL::text,'scenarioTemplateMappingId',NULL::text))
        FROM public."AuditLog" a WHERE a."businessId"=c.id AND a.action='contract.draft.create'),
      'singleInitialDraft',(SELECT count(*)=1 FROM public."ContractVersion" x WHERE x."businessTemplateVersionId"=tv.id),
      'originalValidatedCheck',EXISTS(SELECT FROM pg_constraint q WHERE q.conrelid='public."ContractVersion"'::regclass
        AND q.conname='ContractVersion_upward_draft_source_check' AND q.convalidated
        AND pg_get_constraintdef(q.oid) LIKE '%jg_upward_archive_constraint_v2%'))
      FROM ${binding} b JOIN public."Contract" c ON c.id=b.contract_id
      JOIN public."ContractVersion" v ON v.id=b.version_id JOIN public."ContractBusinessTemplateVersion" tv ON tv.id=b.template_version_id
      WHERE c.id='${contractId}' AND v.id='${versionId}';`);
    const proof=JSON.parse(readback.stdout.trim());
    condition(Object.keys(proof).sort().join(",")==="audit,contract,initialVersion,originalValidatedCheck,singleInitialDraft,terms" &&
      Object.values(proof).every(value=>value===true),"PROJECT_SCOPE_DRAFT_DURABLE_READBACK");
    receipt.projectDraft={...proof,wrongProjectRejected:true,wrongCompanyOwnerRejected:true,exactHttp201:true,workbenchHttp200:true};
    fs.writeFileSync(path.join(workDir,"project-b-draft-observed.ready"),"",{flag:"wx",mode:0o600});
    const reviewPath=path.join(workDir,"project-b-legacy-review.json");
    while(!fs.existsSync(reviewPath)&&child.exitCode===null&&child.signalCode===null){
      condition(Date.now()<deadline,"PROJECT_SCOPE_LEGACY_REVIEW_CHECKPOINT_TIMEOUT");
      await delay(50);
    }
    if(!fs.existsSync(reviewPath)){
      receipt.projectScopeFailure=firstFailure(report);
      throw new Error("PROJECT_SCOPE_LEGACY_REVIEW_NOT_APPROACHED");
    }
    const witness=JSON.parse(fs.readFileSync(reviewPath,"utf8"));
    const {approvalId,actorId}=witness;
    condition(witness.versionId===versionId&&[approvalId,actorId].every(value=>uid.test(value))&&
      actorId!==companyActor,"PROJECT_SCOPE_LEGACY_REVIEW_IDENTITIES");
    const granted=await ownerSql("PROJECT_LEGACY_REVIEW_BIND",`
      BEGIN;
      INSERT INTO ${reviewBinding}(version_id,approval_id,actor_id,version_updated_at,approval_updated_at)
      SELECT v.id,r.id,u.id,v."updatedAt",r."updatedAt"
      FROM ${binding} b
      JOIN public."Contract" c ON c.id=b.contract_id AND c.id='${contractId}' AND c."projectId"='${projectB}'
      JOIN public."ContractVersion" v ON v.id=b.version_id AND v.id='${versionId}' AND v."contractId"=c.id
        AND v."versionNo"=1 AND v."changeType"='original' AND v."numericProtocolVersion"=1 AND v.status='in_approval'
      JOIN public."ApprovalInstance" r ON r.id='${approvalId}' AND r."businessId"=v.id AND r."applicantUserId"=b.actor_id
        AND r."businessType"='contract_version' AND r."flowType"='contract.approve' AND r.status='in_progress'
        AND r."currentNodeIndex"=0
        AND r."frozenNodes"='[{"name":"项目经理","mode":"any","roleKeys":["project_manager"]},{"name":"董事长","mode":"any","roleKeys":["chairman"]}]'::jsonb
      JOIN public."User" u ON u.id='${actorId}' AND u."isActive"
      JOIN public."UserPosition" up ON up."userId"=u.id AND up."projectId"=c."projectId"
      JOIN public."Position" p ON p.id=up."positionId" AND p.key='project_manager'
      WHERE b.singleton AND b.actor_id='${companyActor}' AND b.runtime_role_oid='${role}'::regrole::oid
        AND NOT EXISTS(SELECT FROM public."ApprovalActionLog" a WHERE a."approvalInstanceId"=r.id);
      GRANT EXECUTE ON FUNCTION ${reviewEntry} TO ${role};
      SELECT (count(*)=1 AND NOT has_table_privilege('${role}','${reviewBinding}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT has_any_column_privilege('${role}','${reviewBinding}','SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_function_privilege('${role}','${reviewEntry}','EXECUTE WITH GRANT OPTION')
        AND NOT has_function_privilege('jg_task01_runtime','${reviewEntry}','EXECUTE')
        AND NOT has_function_privilege('jg_task01_observer','${reviewEntry}','EXECUTE')
        AND NOT has_function_privilege('${role}','public.jg_upward_archive_constraint_v2(public."ContractVersion")','EXECUTE'))::text
      FROM ${reviewBinding};
      COMMIT;`);
    reviewGranted=true;
    condition(granted.stdout.trim()==="true","PROJECT_SCOPE_LEGACY_REVIEW_BOUND_ACL");
    fs.writeFileSync(path.join(workDir,"project-b-legacy-review.ready"),"",{flag:"wx",mode:0o600});
    const archiveInput=path.join(workDir,"project-b-archive.json");
    while(!fs.existsSync(archiveInput)&&child.exitCode===null&&child.signalCode===null){
      condition(Date.now()<deadline,"PROJECT_SCOPE_ARCHIVE_HANDOFF_TIMEOUT");
      await delay(50);
    }
    if(!fs.existsSync(archiveInput)){
      receipt.projectScopeFailure=firstFailure(report);
      throw new Error("PROJECT_SCOPE_ARCHIVE_NOT_ENTERED");
    }
    const {id,projectId:archiveProjectId,fileId,actorId:archiveActorId}=JSON.parse(fs.readFileSync(archiveInput,"utf8"));
    condition(archiveProjectId===projectB&&[id,fileId,archiveActorId].every(value=>uid.test(value)),"PROJECT_SCOPE_ARCHIVE_BOUND_IDS");
    const archiveBound=await ownerSql("EXACT_UPLOAD_BIND",`
      BEGIN;
      INSERT INTO ${archiveBinding}(database_oid,system_identifier,server_port,runtime_role_oid,procurement_id,project_id,approval_id,actor_id,file_id,revision,content_sha256,size_bytes,mime_type)
      SELECT d.oid,(SELECT system_identifier::text FROM pg_control_system()),inet_server_port(),r.oid,
        g.id,g."projectId",g."approvalInstanceId",f."uploadedByUserId",f.id,g.revision,f."contentSha256",f."sizeBytes",f."mimeType"
      FROM public."GeneralProcurement" g
      JOIN public."FileObject" f ON f.id='${fileId}' AND f."uploadedByUserId"='${archiveActorId}'
      JOIN pg_roles r ON r.rolname='${role}' AND NOT r.rolsuper
      JOIN pg_database d ON d.datname=current_database() AND d.datdba=current_user::regrole::oid
      WHERE g.id='${id}' AND g."projectId"='${projectB}' AND g.revision=5
        AND g.status='approved_pending_archive' AND g."archiveFileId" IS NULL
        AND f."storageStatus"='active' AND f."mimeType"='image/png' AND f."contentSha256"='${sha}'
        AND EXISTS(SELECT FROM public."AuditLog" a WHERE a.action='file.upload'
          AND a."businessId"=f.id AND a."actorUserId"=f."uploadedByUserId" AND a.metadata->>'objectKey'=f."objectKey");
      GRANT EXECUTE ON FUNCTION ${archivedScope} TO ${role};
      SELECT (count(*)=1 AND
        NOT has_function_privilege('${role}','${raw}','EXECUTE') AND
        NOT has_function_privilege('jg_task01_runtime','${archivedScope}','EXECUTE') AND
        NOT has_function_privilege('jg_task01_observer','${archivedScope}','EXECUTE') AND
        NOT has_any_column_privilege('${role}','${archiveBinding}','SELECT,INSERT,UPDATE,REFERENCES') AND
        NOT has_table_privilege('${role}','${archiveBinding}','DELETE,TRUNCATE,TRIGGER') AND
        NOT has_function_privilege('${role}','${archivedScope}','EXECUTE WITH GRANT OPTION'))::text
      FROM ${archiveBinding};
      COMMIT;`);
    archiveGranted=true;
    condition(archiveBound.stdout.trim()==="true","PROJECT_SCOPE_ARCHIVE_BOUND_ACL");
    fs.writeFileSync(path.join(workDir,"project-b-archive.ready"),"",{flag:"wx",mode:0o600});
    const exit=await Promise.race([exited,delay(Math.max(0,deadline-Date.now()),null,{ref:false})]);
    condition(exit!==null,"PROJECT_SCOPE_DRAFT_JEST_TIMEOUT");
    receipt.projectScopeBrowser=observeProjectBrowserReport(path.join(workDir,"project-scope-browser.json"));
    const browserExitFile=path.join(workDir,"project-scope-browser-exit.json");
    if(fs.existsSync(browserExitFile)){
      const code=JSON.parse(fs.readFileSync(browserExitFile,"utf8"));
      if(Number.isSafeInteger(code)&&code>=0&&code<=255)receipt.projectScopeBrowser.exit=code;
    }
    const selfReviewFile=path.join(workDir,"project-scope-self-review-http.json");
    if(fs.existsSync(selfReviewFile)){
      const selfReviewStatus=JSON.parse(fs.readFileSync(selfReviewFile,"utf8"));
      condition(Number.isInteger(selfReviewStatus)&&selfReviewStatus>=100&&selfReviewStatus<=599,"PROJECT_SCOPE_SELF_REVIEW_HTTP_STATUS");
      receipt.paymentSelfReviewHttp=selfReviewStatus;
    }
    receipt.legacyReviewHttp=Object.fromEntries(["other-directory","other-project","own-project"].flatMap(step=>{
      const file=path.join(workDir,`project-b-legacy-review-${step}.json`);
      if(!fs.existsSync(file)) return [];
      const status=JSON.parse(fs.readFileSync(file,"utf8"));
      condition(Number.isInteger(status)&&status>=100&&status<=599,"PROJECT_SCOPE_LEGACY_STATUS");
      return [[step,status]];
    }));
    if(exit[0]!==0||!fs.existsSync(report)){
      receipt.projectScopeFailure={exit:exit[0],...firstFailure(report)};
      throw new Error("PROJECT_SCOPE_DRAFT_JEST");
    }
    condition(receipt.legacyReviewHttp["other-directory"]===403&&receipt.legacyReviewHttp["other-project"]===403&&
      receipt.legacyReviewHttp["own-project"]===201,"PROJECT_SCOPE_ORIGINAL_LEGACY_STATUSES");
    condition(receipt.paymentSelfReviewHttp===201,"PROJECT_SCOPE_ORIGINAL_SELF_REVIEW_STATUS");
    const archiveReadback=await ownerSql("ARCHIVE_READBACK",`SELECT (count(*)=1)::text FROM public."GeneralProcurement" g
      JOIN public."FileObject" f ON f.id=g."archiveFileId"
      WHERE g.id='${id}' AND g."projectId"='${projectB}' AND g."archivedByUserId"='${archiveActorId}'
        AND g.status='archived' AND g.revision=6 AND f.id='${fileId}' AND f."contentSha256"='${sha}'
        AND (SELECT count(*) FROM public."AuditLog" a WHERE a."businessId"=g.id AND a.action='general_procurement.archive'
             AND a."actorUserId"=g."archivedByUserId" AND a.metadata->>'fileId'=f.id)=1;`);
    receipt.projectBArchiveDurable=archiveReadback.stdout.trim()==="true";
    const bytes=fs.readFileSync(report),test=JSON.parse(bytes);
    condition(test.success===true&&test.numPassedTests===11&&test.numTotalTests===11&&test.numPassedTestSuites===1&&
      test.testResults[0]?.status==="passed"&&test.numPendingTests===0&&receipt.projectBArchiveDurable&&
      receipt.projectScopeBrowser.complete,"PROJECT_SCOPE_DRAFT_COVERAGE");
    const observed=await ownerSql("PROJECT_LEGACY_REVIEW_READBACK",`SELECT jsonb_build_object(
      'retainedInitialVersion',v.status='in_approval' AND v."updatedAt">b.version_updated_at,
      'advancedNonfinalRound',r.status='in_progress' AND r."currentNodeIndex"=1,
      'exactSignedAction',(SELECT count(*)=1 AND bool_and(a."actorUserId"=b.actor_id
        AND a."approvedRoleKey"='project_manager' AND a."representedUserId"=b.actor_id
        AND a."signatureVersionIdSnapshot" IS NOT NULL AND a."signatureFileIdSnapshot" IS NOT NULL)
        FROM public."ApprovalActionLog" a WHERE a."approvalInstanceId"=r.id AND a.action='approve'),
      'exactOriginalAudit',(SELECT count(*)=1 AND bool_and(a."actorUserId"=b.actor_id AND a.metadata->>'expectedApprovalInstanceId'=r.id)
        FROM public."AuditLog" a WHERE a."businessId"=v.id AND a."businessType"='contract_version' AND a.action='contract.approval.approve'),
      'oneOwnerCheckedWrite',b.consumed_xid IS NOT NULL,
      'archivePredicateOwnerOnly',NOT has_function_privilege('${role}','public.jg_upward_archive_constraint_v2(public."ContractVersion")','EXECUTE'))
      FROM ${reviewBinding} b JOIN public."ApprovalInstance" r ON r.id=b.approval_id
      JOIN public."ContractVersion" v ON v.id=b.version_id WHERE b.singleton AND b.actor_id='${actorId}'
        AND v.id='${versionId}' AND r.id='${approvalId}';`);
    const reviewed=JSON.parse(observed.stdout.trim());
    condition(Object.keys(reviewed).sort().join(",")==="advancedNonfinalRound,archivePredicateOwnerOnly,exactOriginalAudit,exactSignedAction,oneOwnerCheckedWrite,retainedInitialVersion" &&
      Object.values(reviewed).every(value=>value===true),"PROJECT_SCOPE_LEGACY_REVIEW_DURABLE_READBACK");
    receipt.legacyReview=reviewed;
    receipt.originalSuite={originalTests:11,browserProjects:2,originalProjectRouteAssertionsPassed:true,legacyRoleReviewAssertionsPassed:true,
      reportSha256:createHash("sha256").update(bytes).digest("hex")};
  }catch(error){
    receipt.consumerFailure={code:/^[A-Z0-9_]+$/u.test(error.message??"")?error.message:"UNCLASSIFIED",...error.psqlObservation};
  }finally{
    await attemptCleanup(receipt,[
      ["CHILD_STOP",async ()=>{if(child?.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");await exited;}}],
      ["CONSUMED_BINDING_REMOVE",async ()=>{
        if(archiveGranted)await ownerSql("CONSUMED_BINDING_REMOVE",`REVOKE EXECUTE ON FUNCTION ${archivedScope} FROM ${role};
          DELETE FROM ${archiveBinding};`);
      }],
      ["PROJECT_LEGACY_REVIEW_REMOVE",async ()=>{
        if(reviewGranted)await ownerSql("PROJECT_LEGACY_REVIEW_REMOVE",`REVOKE EXECUTE ON FUNCTION ${reviewEntry} FROM ${role};
          DELETE FROM ${reviewBinding};`);
      }],
      ["PROJECT_DRAFT_REMOVE",async ()=>{
        if(draftGranted)await ownerSql("PROJECT_DRAFT_REMOVE",`REVOKE EXECUTE ON FUNCTION ${draftScope} FROM ${role};
          DELETE FROM ${binding};`);
      }],
      ["PROJECT_SIGNATURE_ALIAS_REMOVE",async ()=>{
        if(aliasGranted){
          const revoked=await ownerSql("PROJECT_SIGNATURE_ALIAS_REMOVE",`REVOKE EXECUTE ON FUNCTION ${alias} FROM ${role};
            SELECT (NOT has_function_privilege('${role}','${alias}','EXECUTE') AND
              NOT has_function_privilege('${role}','${raw}','EXECUTE'))::text;`);
          condition(revoked.stdout.trim()==="true","PROJECT_SCOPE_SIGNATURE_ALIAS_NOT_REMOVED");
        }
      }],
      ["ROLE_TEARDOWN",()=>ownerSql("ROLE_TEARDOWN",roleTeardown("project",database))],
    ]);
  }
  if(receipt.consumerFailure||receipt.cleanupFailures)throw new Error("PROJECT_SCOPE_DRAFT_STOPPED");
}).then(()=>{receipt.status="PROJECT_SCOPE_ORIGINAL_11_289_PASSED";}).catch(error=>{
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:"UNCLASSIFIED",
    command:error.command,exit:error.exit,signal:error.signal,sqlstate:error.sqlstate,prismaCode:error.prismaCode,
    migrationCause:error.migrationCause,psqlObservation:error.psqlObservation};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
