BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- The isolated owner binds the exact pre-review version, round and direct actor.
-- This forward migration does not grant the entry to an application role.
CREATE TABLE public.jg_project_scope_legacy_review_binding_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version_id text NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  version_updated_at timestamp(3) NOT NULL,
  approval_updated_at timestamp(3) NOT NULL,
  consumed_xid xid8
);
REVOKE ALL ON TABLE public.jg_project_scope_legacy_review_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_touch_project_scope_legacy_review_v1(
  p_version text, p_approval text, p_actor text, p_updated_at timestamptz
) RETURNS boolean LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $review$
DECLARE
  scope public.jg_project_scope_legacy_review_binding_v1%ROWTYPE;
  current_write_xid text := (txid_current() % 4294967296)::text;
BEGIN
  IF session_user<>'project_business_scope_runtime' OR current_user=session_user
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR p_updated_at<date_trunc('milliseconds',transaction_timestamp()) OR p_updated_at>clock_timestamp() THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_LEGACY_REVIEW_SESSION' USING ERRCODE='42501';
  END IF;

  SELECT w.* INTO STRICT scope
  FROM public.jg_project_scope_legacy_review_binding_v1 w
  JOIN public.jg_project_scope_initial_contract_binding_v1 b ON b.singleton AND b.version_id=w.version_id
  JOIN pg_database db ON db.oid=b.database_oid AND db.datname=current_database()
    AND db.datdba=current_user::regrole::oid
  JOIN pg_roles runtime ON runtime.oid=b.runtime_role_oid AND runtime.oid=session_user::regrole::oid
    AND runtime.rolname='project_business_scope_runtime' AND runtime.rolcanlogin
    AND NOT (runtime.rolsuper OR runtime.rolinherit OR runtime.rolcreaterole OR runtime.rolcreatedb
      OR runtime.rolreplication OR runtime.rolbypassrls)
    AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE runtime.oid IN (m.roleid,m.member))
  JOIN public."Contract" c ON c.id=b.contract_id AND c."projectId"=b.project_id AND c."ownerUserId"=b.actor_id
  JOIN public."Project" project ON project.id=c."projectId" AND project."isActive"
  JOIN public."ContractVersion" v ON v.id=w.version_id AND v."contractId"=c.id AND v."versionNo"=1
    AND v."changeType"='original' AND v.status='in_approval' AND v."updatedAt"=w.version_updated_at
    AND v."businessTemplateVersionId"=b.template_version_id AND v."numericProtocolVersion"=1
  JOIN public."ApprovalInstance" approval ON approval.id=w.approval_id AND approval."businessId"=v.id
    AND approval."businessType"='contract_version' AND approval."flowType"='contract.approve'
    AND approval."applicantUserId"=b.actor_id AND approval.status='in_progress' AND approval."currentNodeIndex"=1
    AND approval.xmin::text=current_write_xid
    AND approval."frozenNodes"='[{"name":"项目经理","mode":"any","roleKeys":["project_manager"]},{"name":"董事长","mode":"any","roleKeys":["chairman"]}]'::jsonb
  JOIN public."User" actor ON actor.id=w.actor_id AND actor."isActive"
  JOIN public."UserPosition" assignment ON assignment."userId"=actor.id AND assignment."projectId"=project.id
  JOIN public."Position" role ON role.id=assignment."positionId" AND role.key='project_manager'
  WHERE w.singleton AND w.consumed_xid IS NULL AND w.version_id=p_version AND w.approval_id=p_approval AND w.actor_id=p_actor
    AND w.actor_id<>b.actor_id AND c."contractTypeKey"='generic_contract'
    AND b.runtime_role_oid=session_user::regrole::oid AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND b.server_port=inet_server_port() AND b.project_id='legacy-project-business-scope'
    AND b.creation_xid IS NOT NULL AND b.creation_xid<>pg_current_xact_id()
  FOR UPDATE OF w,v,approval NOWAIT FOR SHARE OF c,actor,project,assignment,role NOWAIT;

  IF (SELECT count(*)=1 AND bool_and(
      a."actorUserId"=p_actor AND a."representedUserId"=p_actor AND a."approvedRoleKey"='project_manager'
      AND EXISTS (
        SELECT FROM public."HandwrittenSignatureVersion" signature
        JOIN public."FileObject" f ON f.id=signature."fileId" AND f."storageStatus"='active'
        WHERE signature.id=a."signatureVersionIdSnapshot" AND signature."userId"=p_actor AND signature.source='canvas'
          AND f.id=a."signatureFileIdSnapshot" AND f."contentSha256"=a."signatureSha256Snapshot"
          AND lower(signature."contentSha256")=lower(f."contentSha256")
      ))
    FROM public."ApprovalActionLog" a WHERE a."approvalInstanceId"=p_approval AND a.action='approve'
      AND a.xmin::text=current_write_xid) IS DISTINCT FROM true
    OR (SELECT count(*)=1 AND bool_and(
      a."actorUserId"=p_actor AND a.metadata->>'approvedRoleKey'='project_manager'
      AND a.metadata->>'representedUserId'=p_actor AND a.metadata->>'fromStatus'='in_approval'
      AND a.metadata->>'toStatus'='in_approval' AND a.metadata->>'expectedApprovalInstanceId'=p_approval
      AND a.metadata->>'expectedNodeIndex'='0'
      AND a.metadata->>'expectedContractUpdatedAt'=to_char(scope.version_updated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND a.metadata->>'expectedApprovalUpdatedAt'=to_char(scope.approval_updated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM public."AuditLog" a WHERE a."businessId"=p_version AND a."businessType"='contract_version'
      AND a.action='contract.approval.approve' AND a.xmin::text=current_write_xid) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_LEGACY_REVIEW_FACTS' USING ERRCODE='42501';
  END IF;

  UPDATE public."ContractVersion"
    SET status='in_approval', "updatedAt"=(p_updated_at AT TIME ZONE 'UTC')
    WHERE id=scope.version_id;
  UPDATE public.jg_project_scope_legacy_review_binding_v1
    SET consumed_xid=pg_current_xact_id() WHERE singleton;
  RETURN true;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'PROJECT_SCOPE_LEGACY_REVIEW_COORDINATES' USING ERRCODE='42501';
END;
$review$;
REVOKE ALL ON FUNCTION public.jg_touch_project_scope_legacy_review_v1(text,text,text,timestamptz) FROM PUBLIC;

DO $verify$
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=current_user::regrole::oid)
    OR public.jg_require_contract_direct_upward_source_v2() IS NULL THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_LEGACY_REVIEW_INSTALL' USING ERRCODE='55000';
  END IF;
END;
$verify$;
COMMIT;
