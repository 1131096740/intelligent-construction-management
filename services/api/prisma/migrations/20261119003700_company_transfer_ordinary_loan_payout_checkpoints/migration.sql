BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $preflight$
DECLARE
  expected record;
  routine pg_proc%ROWTYPE;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_company_transfer_original_source(public."CompanyTransfer")',
      'abb06e92039e9a24ee8c15fa40c27af412b07f59643c50df5fb234182d2ec921'),
    ('public.jg_company_transfer_correction_delta(text,timestamp without time zone,boolean,text)',
      '39ba46b15cd5facc3ba7019778e4a875408ed56f68e720f5ddb21788b4446843'),
    ('public.jg_company_transfer_original_used(text,timestamp without time zone,text)',
      '6c3c954f6879d64815a56a99fbb7a26d941b44022d3f9fbb5491204819f8a633'),
    ('public.jg_company_transfer_original_checkpoints(text,timestamp without time zone)',
      '44bb7a9cfa25c313a65f1db414f3bd91efc29a445b813c56aa50e71a69f8a447')
  ) AS pins(signature, digest)
  LOOP
    SELECT * INTO STRICT routine FROM pg_proc WHERE oid=expected.signature::regprocedure;
    IF routine.proowner<>current_user::regrole::oid OR routine.prosecdef
      OR encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')<>expected.digest
      OR EXISTS (
        SELECT FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner)))
        WHERE grantee<>routine.proowner
      ) THEN
      RAISE EXCEPTION 'company_transfer_ordinary_payout_routine_identity';
    END IF;
  END LOOP;
END
$preflight$;

-- Read only the original date checkpoints for the approved, bound repayment.
CREATE FUNCTION public.jg_company_transfer_ordinary_payout_checkpoints(
  p_repayment_id text, p_observation_id text, p_actor_id text
) RETURNS TABLE (checkpoint timestamp)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $payout$
DECLARE
  original_loan_id text;
  earliest timestamp;
BEGIN
  IF session_user !~ '^finance_runtime_[0-9a-f]{32}$' OR session_user=current_user
    OR current_database() !~ '^jg_task01_[0-9a-f]{32}$'
    OR current_setting('role')<>'none' OR current_setting('session_replication_role')<>'origin'
    OR has_schema_privilege(session_user,'public','CREATE')
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(
      SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
        AND classid=190731 AND objid=91 AND objsubid=2 AND mode='ExclusiveLock' AND granted
    )
  THEN
    RAISE EXCEPTION 'company_transfer_ordinary_payout_session' USING ERRCODE='42501';
  END IF;

  SELECT original.id, observation."occurredAt" INTO original_loan_id, earliest
  FROM public.jg_company_transfer_loan_repayment_scope_v1 scope
  JOIN pg_database db ON db.oid=scope.database_oid
  JOIN pg_roles runtime ON runtime.oid=scope.runtime_role_oid
  JOIN public."CompanyTransfer" repayment ON repayment.id=scope.repayment_id
  JOIN public."CompanyTransfer" original ON original.id=scope.loan_id
  JOIN public."ApprovalInstance" approval ON approval.id=scope.approval_id
  JOIN public."VerifiedBankTransactionObservation" observation ON observation.id=p_observation_id
  JOIN public."ContractBankVerificationRequest" verification ON verification."observationId"=observation.id
  WHERE scope.singleton AND db.datname=current_database() AND db.datdba=current_user::regrole::oid
    AND scope.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND scope.server_port=inet_server_port()
    AND runtime.oid=session_user::regrole::oid AND runtime.rolcanlogin
    AND NOT (runtime.rolsuper OR runtime.rolinherit OR runtime.rolcreaterole
      OR runtime.rolcreatedb OR runtime.rolreplication OR runtime.rolbypassrls)
    AND NOT EXISTS(SELECT FROM pg_auth_members WHERE runtime.oid IN (member,roleid))
    AND scope.approval_xid IS NOT NULL AND scope.approval_xid<>pg_current_xact_id()
    AND repayment.id=p_repayment_id AND repayment.kind='repayment' AND repayment.status='approved'
    AND repayment."originalTransferId"=original.id AND repayment."idempotencyKey"=scope.request_key
    AND repayment."amountCents"=scope.amount_cents AND repayment."applicantUserId"=scope.applicant_id
    AND repayment."approvedByUserId"=scope.approver_id AND repayment."approvalInstanceId"=approval.id
    AND NOT repayment."requiresParallelRepaymentApproval"
    AND num_nonnulls(repayment."originalProxyId",repayment."originalFundMovementRelationshipId",
      repayment."originalInterEntityRelationshipId",repayment."originalOperationalPaymentId")=0
    AND original.kind='loan' AND original.status='approved'
    AND original."sourceCompanyId"=repayment."destinationCompanyId"
    AND original."destinationCompanyId"=repayment."sourceCompanyId"
    AND original."sourceProjectId" IS NOT DISTINCT FROM repayment."destinationProjectId"
    AND original."destinationProjectId" IS NOT DISTINCT FROM repayment."sourceProjectId"
    AND approval."businessId"=repayment.id AND approval."applicantUserId"=scope.applicant_id
    AND approval."businessType"='company_transfer' AND approval."flowType"='company_transfer.approve'
    AND approval.status='approved' AND approval."currentNodeIndex"=1
    AND p_actor_id=scope.applicant_id
    AND EXISTS(
      SELECT FROM public."User" actor
      JOIN public."UserPosition" assignment ON assignment."userId"=actor.id AND assignment."projectId" IS NULL
      JOIN public."Position" position ON position.id=assignment."positionId"
      WHERE actor.id=p_actor_id AND actor."isActive" AND position.key IN ('finance_staff','finance_director')
    )
    AND verification.status='confirmed' AND verification.direction='outflow' AND observation.direction='outflow'
    AND verification."companyEntityId"=repayment."sourceCompanyId"
    AND observation."holderCompanyEntityId"=repayment."sourceCompanyId"
    AND verification."projectId" IS NOT DISTINCT FROM repayment."sourceProjectId"
    AND verification."accountHash"=repayment."sourceAccountHash"
    AND verification."occurredAt"=observation."occurredAt"
    AND verification."amountCents"=observation."amountCents" AND observation."amountCents">0
    AND NOT EXISTS(SELECT FROM public."BankTransactionClaim" WHERE "observationId"=observation.id)
    AND NOT EXISTS(SELECT FROM public."ContractBankEventClaim" WHERE "observationId"=observation.id)
    AND NOT EXISTS(SELECT FROM public."ContractProxyBankClaim" WHERE "observationId"=observation.id)
    AND NOT EXISTS(SELECT FROM public."CompanyTransferBankClaim" WHERE "observationId"=observation.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_transfer_ordinary_payout_binding' USING ERRCODE='42501';
  END IF;

  RETURN QUERY SELECT dated.checkpoint
    FROM public.jg_company_transfer_original_checkpoints('loan:'||original_loan_id,earliest) dated;
END
$payout$;
REVOKE ALL ON FUNCTION public.jg_company_transfer_ordinary_payout_checkpoints(text,text,text) FROM PUBLIC;

COMMIT;
