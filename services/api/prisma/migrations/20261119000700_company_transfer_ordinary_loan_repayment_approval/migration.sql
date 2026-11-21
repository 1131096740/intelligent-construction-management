BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."CompanyTransfer"'::regclass AND t.tgname='CompanyTransfer_original_capacity'
      AND t.tgfoid='public.guard_company_transfer_original_reservation()'::regprocedure
      AND t.tgtype=19 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgnargs=0 AND t.tgqual IS NULL
      AND p.proowner=current_user::regrole::oid AND NOT p.prosecdef
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6fb1cad3a1038720ecf40da2de3198bdc64d5e773fa0963e0dc8ba8c74717f0e'
  ) OR EXISTS (SELECT FROM public.jg_company_transfer_loan_repayment_scope_v1) THEN
    RAISE EXCEPTION 'company_transfer_loans_approval_preflight';
  END IF;
END
$preflight$;

ALTER TABLE public.jg_company_transfer_loan_repayment_scope_v1
  ADD COLUMN approval_id text,
  ADD COLUMN approver_id text,
  ADD COLUMN signature_version_id text,
  ADD COLUMN approval_xid xid8,
  ADD CHECK (num_nonnulls(approval_id,approver_id,signature_version_id) IN (0,3)),
  ADD CHECK (approval_xid IS NULL OR (approval_id IS NOT NULL AND applied_xid IS NOT NULL AND applied_xid<>approval_xid));

CREATE FUNCTION public.jg_check_company_transfer_loan_repayment_approval_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $approval$
DECLARE
  current_write_xid text := mod(pg_current_xact_id()::text::numeric,4294967296)::text;
  cap bigint;
BEGIN
  IF TG_RELID<>'public."CompanyTransfer"'::regclass OR TG_OP<>'UPDATE' OR TG_WHEN<>'BEFORE'
    OR TG_LEVEL<>'ROW' OR current_setting('role')<>'none' OR current_setting('session_replication_role')<>'origin'
    OR session_user !~ '^finance_runtime_[0-9a-f]{32}$' OR current_user=session_user
    OR current_database() !~ '^jg_task01_[0-9a-f]{32}$' OR has_schema_privilege(session_user,'public','CREATE')
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR OLD.status IS DISTINCT FROM 'submitted' OR NEW.status IS DISTINCT FROM 'approved'
    OR NEW.kind IS DISTINCT FROM 'repayment' OR NEW."originalTransferId" IS NULL
    OR num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
      NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")<>0
    OR NEW."requiresParallelRepaymentApproval" IS DISTINCT FROM false
    OR NEW."approvalInstanceId" IS DISTINCT FROM OLD."approvalInstanceId" THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_approval_scope' USING ERRCODE='42501';
  END IF;

  UPDATE public.jg_company_transfer_loan_repayment_scope_v1 scope
  SET approval_xid=pg_current_xact_id()
  FROM pg_database db, pg_roles runtime, public."ApprovalInstance" approval,
    public."ApprovalActionLog" action, public."User" approver, public."UserPosition" assignment,
    public."Position" position, public."HandwrittenSignatureVersion" signature, public."FileObject" artwork
  WHERE scope.singleton AND scope.applied_xid IS NOT NULL AND scope.applied_xid<>pg_current_xact_id()
    AND scope.approval_xid IS NULL AND scope.repayment_id=OLD.id AND OLD.id=NEW.id
    AND scope.database_oid=db.oid AND db.datname=current_database() AND db.datdba=current_user::regrole::oid
    AND scope.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND scope.server_port=inet_server_port()
    AND scope.runtime_role_oid=runtime.oid AND runtime.oid=session_user::regrole::oid
    AND runtime.rolcanlogin AND NOT (runtime.rolsuper OR runtime.rolinherit OR runtime.rolcreaterole
      OR runtime.rolcreatedb OR runtime.rolreplication OR runtime.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE runtime.oid IN (m.roleid,m.member))
    AND scope.loan_id=NEW."originalTransferId" AND scope.applicant_id=NEW."applicantUserId"
    AND scope.request_key=NEW."idempotencyKey" AND scope.amount_cents=NEW."amountCents"
    AND approver.id=scope.approver_id AND approver.id=NEW."approvedByUserId"
    AND approver.id<>scope.applicant_id AND approver."isActive"
    AND assignment."userId"=approver.id AND assignment."projectId" IS NULL
    AND position.id=assignment."positionId" AND position.key IN ('chairman','general_manager')
    AND approval.id=scope.approval_id AND approval.id=NEW."approvalInstanceId"
    AND approval."businessId"=NEW.id AND approval."businessType"='company_transfer'
    AND approval."flowType"='company_transfer.approve' AND approval."applicantUserId"=scope.applicant_id
    AND approval.status='approved' AND approval."currentNodeIndex"=1 AND approval.xmin::text=current_write_xid
    AND (approval."frozenNodes"->0->'candidateUserIdsByRole'->position.key) ? approver.id
    AND action."approvalInstanceId"=approval.id AND action.action='approve'
    AND action."actorUserId"=approver.id AND action."representedUserId"=approver.id
    AND action."approvedRoleKey"=position.key AND action."createdAt"=NEW."approvedAt"
    AND action.xmin::text=current_write_xid
    AND signature.id=scope.signature_version_id AND signature.id=action."signatureVersionIdSnapshot"
    AND signature."userId"=approver.id AND signature.source='canvas'
    AND artwork.id=signature."fileId" AND artwork.id=action."signatureFileIdSnapshot"
    AND artwork."storageStatus"='active' AND artwork."uploadedByUserId"=approver.id
    AND artwork."contentSha256"=action."signatureSha256Snapshot"
    AND lower(signature."contentSha256")=lower(artwork."contentSha256")
    AND NOT EXISTS (
      SELECT FROM public."ApprovalActionLog" other WHERE other."approvalInstanceId"=approval.id
        AND other.action='approve' AND other.id<>action.id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_approval_binding' USING ERRCODE='42501';
  END IF;

  cap := public.company_transfer_debt_limit(NEW,NULL::timestamp);
  IF public.jg_company_transfer_original_used(public.jg_company_transfer_original_source(NEW),NULL::timestamp,NEW.id)
       + NEW."amountCents" > cap THEN
    RAISE EXCEPTION 'company_transfer_original_capacity';
  END IF;
  RETURN NEW;
END
$approval$;
REVOKE ALL ON FUNCTION public.jg_check_company_transfer_loan_repayment_approval_v1() FROM PUBLIC;

-- Keep the original UPDATE check except for the one bounded approval route.
CREATE OR REPLACE TRIGGER "CompanyTransfer_original_capacity"
BEFORE UPDATE ON public."CompanyTransfer" FOR EACH ROW
WHEN ((current_user=session_user AND session_user ~ '^finance_runtime_[0-9a-f]{32}$'
  AND current_database() ~ '^jg_task01_[0-9a-f]{32}$' AND OLD.status='submitted' AND NEW.status='approved'
  AND NEW.kind='repayment' AND NEW."originalTransferId" IS NOT NULL AND NOT NEW."requiresParallelRepaymentApproval"
  AND num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
    NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")=0) IS NOT TRUE)
EXECUTE FUNCTION public.guard_company_transfer_original_reservation();

CREATE TRIGGER "CompanyTransfer_original_capacity_update_loan"
BEFORE UPDATE ON public."CompanyTransfer" FOR EACH ROW
WHEN (current_user=session_user AND session_user ~ '^finance_runtime_[0-9a-f]{32}$'
  AND current_database() ~ '^jg_task01_[0-9a-f]{32}$' AND OLD.status='submitted' AND NEW.status='approved'
  AND NEW.kind='repayment' AND NEW."originalTransferId" IS NOT NULL AND NOT NEW."requiresParallelRepaymentApproval"
  AND num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
    NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")=0)
EXECUTE FUNCTION public.jg_check_company_transfer_loan_repayment_approval_v1();

DO $closed$
BEGIN
  IF EXISTS (
    SELECT FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.jg_check_company_transfer_loan_repayment_approval_v1()'::regprocedure AND acl.grantee<>p.proowner
  ) THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_approval_acl';
  END IF;
END
$closed$;

COMMIT;
