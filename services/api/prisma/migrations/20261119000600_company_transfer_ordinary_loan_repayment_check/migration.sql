BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $preflight$
DECLARE
  expected record;
  routine pg_proc%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_trigger
    WHERE tgrelid='public."CompanyTransfer"'::regclass AND tgname='CompanyTransfer_original_capacity'
      AND tgfoid='public.guard_company_transfer_original_reservation()'::regprocedure
      AND tgtype=23 AND tgenabled='O' AND NOT tgisinternal AND tgnargs=0 AND tgqual IS NULL
  ) THEN
    RAISE EXCEPTION 'company_transfer_original_trigger_identity';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('public.guard_company_transfer_original_reservation()',
      '6fb1cad3a1038720ecf40da2de3198bdc64d5e773fa0963e0dc8ba8c74717f0e', false),
    ('public.company_transfer_debt_limit(public."CompanyTransfer",timestamp without time zone)',
      '8c5072ab6cf52bb467dc21f0b93ec3d84fa76dfcb8486752a6b3fc71db32122b', false),
    ('public.jg_company_transfer_original_source(public."CompanyTransfer")',
      'abb06e92039e9a24ee8c15fa40c27af412b07f59643c50df5fb234182d2ec921', true),
    ('public.jg_company_transfer_correction_delta(text,timestamp without time zone,boolean,text)',
      '39ba46b15cd5facc3ba7019778e4a875408ed56f68e720f5ddb21788b4446843', true),
    ('public.jg_company_transfer_original_used(text,timestamp without time zone,text)',
      '6c3c954f6879d64815a56a99fbb7a26d941b44022d3f9fbb5491204819f8a633', true),
    ('public.jg_company_transfer_original_checkpoints(text,timestamp without time zone)',
      '44bb7a9cfa25c313a65f1db414f3bd91efc29a445b813c56aa50e71a69f8a447', true)
  ) AS pins(signature, digest, owner_only)
  LOOP
    SELECT * INTO STRICT routine FROM pg_proc WHERE oid=expected.signature::regprocedure;
    IF routine.proowner<>current_user::regrole::oid OR routine.prosecdef
      OR encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')<>expected.digest
      OR (expected.owner_only AND EXISTS (
        SELECT FROM aclexplode(coalesce(routine.proacl, acldefault('f',routine.proowner)))
        WHERE grantee<>routine.proowner
      )) THEN
      RAISE EXCEPTION 'company_transfer_original_routine_identity';
    END IF;
  END LOOP;
END
$preflight$;

-- Only the isolated owner may record the one real fixture request.
CREATE TABLE public.jg_company_transfer_loan_repayment_scope_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL,
  runtime_role_oid oid NOT NULL,
  applicant_id text NOT NULL,
  loan_id text NOT NULL,
  request_key text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents>0),
  repayment_id text,
  applied_xid xid8,
  CHECK ((repayment_id IS NULL)=(applied_xid IS NULL))
);
REVOKE ALL ON public.jg_company_transfer_loan_repayment_scope_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_check_company_transfer_loan_repayment_insert_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $loan$
DECLARE
  current_write_xid text := mod(pg_current_xact_id()::text::numeric,4294967296)::text;
  cap bigint;
BEGIN
  IF TG_RELID<>'public."CompanyTransfer"'::regclass OR TG_OP<>'INSERT' OR TG_WHEN<>'BEFORE'
    OR TG_LEVEL<>'ROW' OR current_setting('role')<>'none' OR current_setting('session_replication_role')<>'origin'
    OR session_user !~ '^finance_runtime_[0-9a-f]{32}$' OR current_user=session_user
    OR current_database() !~ '^jg_task01_[0-9a-f]{32}$'
    OR has_schema_privilege(session_user,'public','CREATE')
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NEW.kind IS DISTINCT FROM 'repayment' OR NEW.status IS DISTINCT FROM 'submitted'
    OR NEW."originalTransferId" IS NULL OR NEW."originalTransferId"=NEW.id
    OR num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
      NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")<>0
    OR NEW."requiresParallelRepaymentApproval" IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_insert_scope' USING ERRCODE='42501';
  END IF;

  UPDATE public.jg_company_transfer_loan_repayment_scope_v1 scope
  SET repayment_id=NEW.id, applied_xid=pg_current_xact_id()
  FROM pg_database db, pg_roles runtime, public."ApprovalInstance" approval, public."User" applicant
  WHERE scope.singleton AND scope.applied_xid IS NULL AND scope.repayment_id IS NULL
    AND scope.database_oid=db.oid AND db.datname=current_database() AND db.datdba=current_user::regrole::oid
    AND scope.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND scope.server_port=inet_server_port()
    AND scope.runtime_role_oid=runtime.oid AND runtime.oid=session_user::regrole::oid
    AND runtime.rolcanlogin AND NOT (runtime.rolsuper OR runtime.rolinherit OR runtime.rolcreaterole
      OR runtime.rolcreatedb OR runtime.rolreplication OR runtime.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE runtime.oid IN (m.roleid,m.member))
    AND scope.loan_id=NEW."originalTransferId" AND scope.applicant_id=NEW."applicantUserId"
    AND scope.request_key=NEW."idempotencyKey" AND scope.amount_cents=NEW."amountCents"
    AND applicant.id=scope.applicant_id AND applicant."isActive"
    AND approval.id=NEW."approvalInstanceId" AND approval."businessId"=NEW.id
    AND approval."businessType"='company_transfer' AND approval."flowType"='company_transfer.approve'
    AND approval."applicantUserId"=scope.applicant_id AND approval.status='in_progress'
    AND approval."currentNodeIndex"=0 AND approval.xmin::text=current_write_xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_insert_binding' USING ERRCODE='42501';
  END IF;

  -- Keep the existing original-loan row lock and correction-aware capacity formula.
  cap := public.company_transfer_debt_limit(NEW,NULL::timestamp);
  IF public.jg_company_transfer_original_used(public.jg_company_transfer_original_source(NEW),NULL::timestamp,NEW.id)
       + NEW."amountCents" > cap THEN
    RAISE EXCEPTION 'company_transfer_original_capacity';
  END IF;
  RETURN NEW;
END
$loan$;
REVOKE ALL ON FUNCTION public.jg_check_company_transfer_loan_repayment_insert_v1() FROM PUBLIC;

-- All capacity checks stay between CompanyTransfer_guard and the proxy approval guard.
CREATE OR REPLACE TRIGGER "CompanyTransfer_original_capacity"
BEFORE UPDATE ON public."CompanyTransfer" FOR EACH ROW
EXECUTE FUNCTION public.guard_company_transfer_original_reservation();

CREATE TRIGGER "CompanyTransfer_original_capacity_insert_legacy"
BEFORE INSERT ON public."CompanyTransfer" FOR EACH ROW
WHEN ((current_user=session_user AND session_user ~ '^finance_runtime_[0-9a-f]{32}$'
  AND current_database() ~ '^jg_task01_[0-9a-f]{32}$'
  AND NEW.kind='repayment' AND NEW.status='submitted' AND NEW."originalTransferId" IS NOT NULL
  AND num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
    NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")=0) IS NOT TRUE)
EXECUTE FUNCTION public.guard_company_transfer_original_reservation();

CREATE TRIGGER "CompanyTransfer_original_capacity_insert_loan"
BEFORE INSERT ON public."CompanyTransfer" FOR EACH ROW
WHEN (current_user=session_user AND session_user ~ '^finance_runtime_[0-9a-f]{32}$'
  AND current_database() ~ '^jg_task01_[0-9a-f]{32}$'
  AND NEW.kind='repayment' AND NEW.status='submitted' AND NEW."originalTransferId" IS NOT NULL
  AND num_nonnulls(NEW."originalProxyId",NEW."originalFundMovementRelationshipId",
    NEW."originalInterEntityRelationshipId",NEW."originalOperationalPaymentId")=0)
EXECUTE FUNCTION public.jg_check_company_transfer_loan_repayment_insert_v1();

DO $closed$
BEGIN
  IF EXISTS (
    SELECT FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid='public.jg_company_transfer_loan_repayment_scope_v1'::regclass AND acl.grantee<>c.relowner
  ) OR EXISTS (
    SELECT FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.jg_check_company_transfer_loan_repayment_insert_v1()'::regprocedure AND acl.grantee<>p.proowner
  ) THEN
    RAISE EXCEPTION 'company_transfer_loan_repayment_private_acl';
  END IF;
END
$closed$;

COMMIT;
