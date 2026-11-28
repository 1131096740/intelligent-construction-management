'use strict';

const version4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const oid=/^[1-9][0-9]{0,9}$/u;
const sha=/^[a-f0-9]{64}$/u;
const helper='public.jg_lock_normal_generated_archive_assignment_v1(text)';
const helperSha='49d8560d487e6ee6f3aafeb75ea1081c3bf6916f6ab1a88e08983487c9af5e16';
const voucherCheck='public.jg_check_normal_archive_voucher_v1(text,text,text)';
const voucherCheckSha='cca53e10d26887d7c6ad4314f1c35a159135696b39b8d73bb7ed8823bd85abbe';
const voucherPrior='public.jg_project_owner_settlement_voucher_bound(text)';
const voucherMigration='20261118224000_contract_normal_archive_voucher_check';
const voucherMigrationSha='bb74a39261b09274b69fbc0996523b592059f981f44979f20106cba8d8ff05b1';
const binding='public.jg_normal_generated_archive_activation_binding_v1';
const fail=()=>Object.assign(new Error('TASK12_NORMAL274_ARCHIVE_BINDING'),{code:'TASK12_NORMAL274_ARCHIVE_BINDING'});

function renderNormal274ArchiveBinding(lease,checkpoint,voucherInstalled=false){
 const {identity,serverPort,roles}=lease;
 const ordinary=roles?.[3],files=checkpoint?.originals;
 if(!/^jg_task01_[a-f0-9]{32}$/u.test(identity?.database)||!oid.test(identity.databaseOid)||
    !/^[0-9]{1,20}$/u.test(identity.systemIdentifier)||!Number.isInteger(serverPort)||serverPort<=1024||serverPort>65535||
    !/^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary?.name)||!oid.test(ordinary.oid)||
    !['projectId','handlerId','contractId','versionId','approvalInstanceId','requestKey'].every(key=>version4.test(checkpoint?.[key]))||
    !Number.isSafeInteger(checkpoint.documentContentRevision)||checkpoint.documentContentRevision<0||
    !sha.test(checkpoint.documentContentFingerprint)||!Array.isArray(files)||files.length!==2||
    !files.every(row=>version4.test(row.id)&&sha.test(row.sha256)&&Number.isSafeInteger(row.sizeBytes)&&row.sizeBytes>0)||
    files[0].id===files[1].id)throw fail();
 const {projectId,handlerId,contractId,versionId,approvalInstanceId,requestKey,documentContentRevision,documentContentFingerprint}=checkpoint;
 const manifest=JSON.stringify(files.map((file,displayOrder)=>({fileId:file.id,displayOrder,mimeType:'application/pdf',sizeBytes:file.sizeBytes,contentSha256:file.sha256})));
 return `BEGIN;
 SET LOCAL search_path=pg_catalog,pg_temp;
 LOCK TABLE ${binding} IN SHARE ROW EXCLUSIVE MODE;
 DO $guard$
 DECLARE target record;
 BEGIN
   IF current_database()<>'${identity.database}' OR
      (SELECT oid FROM pg_database WHERE datname=current_database() AND datdba=10) IS DISTINCT FROM '${identity.databaseOid}'::oid OR
      session_user<>current_user OR current_user::regrole::oid<>10 OR
      NOT COALESCE(inet_server_port()=${serverPort} AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet,false) OR
      NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) OR
      (SELECT system_identifier::text FROM pg_control_system())<>'${identity.systemIdentifier}' OR
      NOT EXISTS(SELECT FROM pg_roles r WHERE r.oid='${ordinary.oid}'::oid AND r.rolname='${ordinary.name}' AND r.rolcanlogin AND
        NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)) OR
      EXISTS(SELECT FROM pg_auth_members WHERE '${ordinary.oid}'::oid IN(member,roleid)) OR
      has_any_column_privilege('${ordinary.oid}'::oid,'public."ProjectAffiliateAssignment"'::regclass,'UPDATE') OR
      has_column_privilege('${ordinary.oid}'::oid,'public."Project"'::regclass,'constructionEnterpriseLockedAt','UPDATE') OR
      has_function_privilege('${ordinary.oid}'::oid,'${helper}','EXECUTE') OR
      NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('${helper}') AND p.proowner=10 AND p.prosecdef AND p.proisstrict AND
         p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND
         encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${helperSha}' AND
         (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee=10 AND a.grantor=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)=1 AND
         (SELECT count(*) FROM aclexplode(p.proacl))=1) OR
      EXISTS(SELECT FROM ${binding}) THEN RAISE EXCEPTION 'TASK12_NORMAL274_ARCHIVE_BINDING_PREIMAGE'; END IF;
   ${voucherInstalled?`IF NOT (${normalArchiveVoucherAcl(ordinary.oid,false)}) OR
      NOT EXISTS(SELECT FROM public."_prisma_migrations" WHERE migration_name='${voucherMigration}'
        AND checksum='${voucherMigrationSha}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
      THEN RAISE EXCEPTION 'TASK12_NORMAL_ARCHIVE_VOUCHER_PREIMAGE'; END IF;`:''}
   SELECT a.id,a."businessPartyVersionId" INTO STRICT target
   FROM public."ContractVersion" v
   JOIN public."Contract" c ON c.id=v."contractId" AND c.id='${contractId}' AND c."projectId"='${projectId}'
      AND c."ownerUserId"='${handlerId}' AND c."contractTypeKey"='equipment_rental' AND c."voidedAt" IS NULL
   JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
      AND p."constructionEnterpriseLockedAt" IS NULL
   JOIN public."ApprovalInstance" approval ON approval.id='${approvalInstanceId}' AND approval."businessId"=v.id AND
      approval."businessType"='contract_version' AND approval."flowType"='contract.approve' AND approval.status='approved' AND
      approval."applicantUserId"='${handlerId}'
   JOIN public."ContractSealTask" seal ON seal."contractVersionId"=v.id AND seal."approvalInstanceId"=approval.id AND
      seal."handlerUserId"='${handlerId}' AND seal.status='completed' AND seal."completedAt" IS NOT NULL
   JOIN public."ProjectAffiliateAssignment" a ON a."projectId"=p.id AND a."endedAt" IS NULL AND a."effectiveFrom"<=CURRENT_DATE
   WHERE v.id='${versionId}' AND v.status='seal_approved_pending_archive' AND v."numericProtocolVersion"=2 AND
      v."documentContentRevision"=${documentContentRevision} AND v."documentContentFingerprint"='${documentContentFingerprint}' AND
      v."draftData"#>>'{contractBasics,relationship}'='inside' AND NOT EXISTS(
        SELECT FROM public."ContractArchiveFile" prior WHERE prior."contractVersionId"=v.id)
      AND 2=(SELECT count(*) FROM jsonb_array_elements('${manifest}'::jsonb) m
       JOIN public."FileObject" f ON f.id=m->>'fileId' AND f."uploadedByUserId"='${handlerId}' AND f."storageStatus"='active'
       AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
       AND f."contentSha256"=m->>'contentSha256' AND f."sizeBytes"=(m->>'sizeBytes')::numeric AND f."mimeType"='application/pdf')
   FOR SHARE OF v,c,p,approval,seal,a;
   INSERT INTO ${binding} VALUES(true,'${identity.databaseOid}'::oid,'${identity.systemIdentifier}',${serverPort},
      '${ordinary.oid}'::oid,'${projectId}','${handlerId}','${versionId}',target.id,target."businessPartyVersionId",'${requestKey}','${manifest}'::jsonb);
   GRANT EXECUTE ON FUNCTION ${helper} TO ${ordinary.name};
   ${voucherInstalled?`GRANT EXECUTE ON FUNCTION ${voucherCheck} TO ${ordinary.name};
   IF NOT (${normalArchiveVoucherAcl(ordinary.oid,true)})
      THEN RAISE EXCEPTION 'TASK12_NORMAL_ARCHIVE_VOUCHER_POSTIMAGE'; END IF;`:''}
   IF NOT EXISTS(SELECT FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('${helper}') AND
        a.grantee='${ordinary.oid}'::oid AND a.grantor=10 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
     OR (SELECT count(*) FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('${helper}'))<>2 THEN
     RAISE EXCEPTION 'TASK12_NORMAL274_ARCHIVE_BINDING_POSTIMAGE';
   END IF;
 END $guard$;
 COMMIT;`;
}

function renderNormal274ConstructionFixture(identity,coordinates,project,applicant){
 const {database,databaseOid,systemIdentifier,ordinaryName,ordinaryOid,serverPort}=identity;
 const {party,version,assignment}=coordinates;
 if(!/^jg_task01_[a-f0-9]{32}$/u.test(database)||!oid.test(databaseOid)||
    !/^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinaryName)||!oid.test(ordinaryOid)||
    !/^[0-9]{1,20}$/u.test(systemIdentifier)||!Number.isInteger(serverPort)||serverPort<=1024||serverPort>65535||
    ![project,applicant,party,version,assignment].every(id=>version4.test(id))||
    new Set([project,applicant,party,version,assignment]).size!==5)throw fail();
 const name='本轮隔离验收施工企业';
 return `BEGIN;
 SET LOCAL search_path=pg_catalog,pg_temp;
 DO $setup$ BEGIN
   IF current_database()<>'${database}' OR current_user<>session_user OR current_user::regrole::oid<>10
    OR (SELECT oid::text FROM pg_database WHERE datname=current_database() AND datdba=10) IS DISTINCT FROM '${databaseOid}'
    OR (SELECT system_identifier::text FROM pg_control_system())<>'${systemIdentifier}'
    OR NOT COALESCE(inet_server_port()=${serverPort} AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet,false)
    OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(SELECT FROM pg_roles r WHERE r.oid='${ordinaryOid}'::oid AND r.rolname='${ordinaryName}' AND r.rolcanlogin)
    OR has_any_column_privilege('${ordinaryOid}'::oid,'public."ProjectAffiliateAssignment"'::regclass,'UPDATE')
    OR has_column_privilege('${ordinaryOid}'::oid,'public."Project"'::regclass,'constructionEnterpriseLockedAt','UPDATE')
    OR EXISTS(SELECT FROM ${binding})
    OR NOT EXISTS(SELECT FROM public."Project" WHERE id='${project}' AND "isActive"
      AND "operatingLedgerEffectiveDate" IS NULL AND "constructionEnterpriseLockedAt" IS NULL FOR UPDATE)
    OR NOT EXISTS(SELECT FROM public."ProjectMember" m JOIN public."User" u ON u.id=m."userId" AND u."isActive"
      WHERE m."projectId"='${project}' AND m."userId"='${applicant}' AND m."positionKey"='contract_staff')
    OR EXISTS(SELECT FROM public."ProjectAffiliateAssignment" WHERE "projectId"='${project}' AND "endedAt" IS NULL)
   THEN RAISE EXCEPTION 'TASK12_NORMAL274_CONSTRUCTION_FIXTURE'; END IF;
 END $setup$;
 INSERT INTO public."BusinessParty"(id,type,name,"normalizedName",status,"createdByUserId","updatedAt")
  VALUES ('${party}','organization','${name}','${name}','active','${applicant}',now());
 INSERT INTO public."BusinessPartyVersion"(id,"businessPartyId","versionNo","createdByUserId",snapshot)
  VALUES ('${version}','${party}',1,'${applicant}',jsonb_build_object('name','${name}','type','organization'));
 SET LOCAL search_path=pg_catalog,public,pg_temp;
 INSERT INTO public."ProjectAffiliateAssignment"(id,"projectId","businessPartyId","businessPartyVersionId","affiliateNameSnapshot","effectiveFrom","changeReason","assignedByUserId","updatedAt")
  VALUES ('${assignment}','${project}','${party}','${version}','${name}','2026-01-01','本轮独占虚构归档验收','${applicant}',now());
 COMMIT;`;
}

function normalArchiveVoucherAcl(ordinaryOid,bound){
 if(!oid.test(ordinaryOid))throw fail();
 return `EXISTS(SELECT FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('${voucherCheck}')
   AND p.proowner=10 AND p.prosecdef AND NOT p.proisstrict
   AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${voucherCheckSha}'
   AND (SELECT count(*)=${bound?2:1} AND bool_and(a.grantor=10 AND a.privilege_type='EXECUTE'
    AND NOT a.is_grantable AND a.grantee IN (10${bound?', '+ordinaryOid+'::oid':''}))
    AND count(*) FILTER(WHERE a.grantee=10)=1 FROM pg_catalog.aclexplode(p.proacl) a))
   AND NOT pg_catalog.has_function_privilege('${ordinaryOid}'::oid,'${voucherPrior}','EXECUTE')
   AND NOT pg_catalog.has_any_column_privilege('${ordinaryOid}'::oid,'public."ProjectOwnerSettlementEntry"'::regclass,'SELECT')`;
}
module.exports=Object.freeze({renderNormal274ArchiveBinding,renderNormal274ConstructionFixture,normalArchiveVoucherAcl,voucherCheck,voucherMigration,voucherMigrationSha});
