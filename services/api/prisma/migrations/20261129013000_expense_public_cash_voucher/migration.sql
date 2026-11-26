BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE public.jg_expense_public_cash_voucher_witness (
  execution_id text PRIMARY KEY,
  previous_registration_id text NOT NULL,
  transaction_id bigint NOT NULL
);
REVOKE ALL ON TABLE public.jg_expense_public_cash_voucher_witness FROM PUBLIC;

-- The closed writer can only finish with its own same-transaction balanced
-- cash debit. The existing RegisteredOperationalPayment conservation trigger
-- independently checks source allocation, revision and the funding balance.
CREATE FUNCTION public.jg_finish_expense_public_cash_voucher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $cash_voucher$
BEGIN
  IF NEW.transaction_id IS DISTINCT FROM txid_current() OR NOT EXISTS (
    SELECT FROM public."ExpenseClaimPaymentExecution" execution
    JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
    JOIN public."RegisteredOperationalPayment" payment ON payment."expenseExecutionId" = execution.id
    JOIN public."RegisteredFundAccount" account ON account.id = payment."accountId"
    WHERE execution.id = NEW.execution_id
      AND execution.xmin::text = (txid_current() % 4294967296)::text
      AND payment.xmin::text = (txid_current() % 4294967296)::text
      AND payment."previousRegistrationId" = NEW.previous_registration_id
      AND payment."projectId" = claim."projectId"
      AND payment."originalDebtorCompanyId" = claim."companyEntityId"
      AND payment."actorUserId" = execution."recordedByUserId"
      AND payment."amountCents" = execution."amountCents"
      AND payment."paidAt" = execution."paidAt"
      AND account.kind = 'public_cash' AND account."scopeKey" = 'public_cash'
      AND account."companyEntityId" IS NULL AND payment."actualPayerCompanyId" IS NULL
      AND payment."actualPayerName" = '公共现金'
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_DEBIT_REQUIRED' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.jg_expense_public_cash_voucher_witness WHERE execution_id = NEW.execution_id;
  RETURN NULL;
END;
$cash_voucher$;
REVOKE ALL ON FUNCTION public.jg_finish_expense_public_cash_voucher() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER jg_expense_public_cash_voucher_debit_required
AFTER INSERT ON public.jg_expense_public_cash_voucher_witness
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.jg_finish_expense_public_cash_voucher();

CREATE FUNCTION public.jg_record_expense_public_cash_voucher(
  p_claim text, p_actor text, p_amount bigint, p_paid_at timestamp, p_method text, p_file text,
  p_note text, p_previous_registration text, p_secret text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $cash_voucher$
DECLARE
  new_execution_id text := gen_random_uuid()::text;
  secret_hash text;
  claim_row record;
  amount_refunded numeric;
BEGIN
  SELECT "secretHash" INTO secret_hash FROM public."OperatingLedgerWriteSecret" WHERE id = 1;
  IF pg_trigger_depth() <> 0 OR current_setting('session_replication_role') <> 'origin'
    OR (session_user <> current_user AND has_schema_privilege(session_user, 'public', 'CREATE'))
    OR secret_hash IS NULL OR p_secret IS NULL
    OR public.crypt(p_secret, secret_hash) IS DISTINCT FROM secret_hash THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_AUTHORITY' USING ERRCODE = '42501';
  END IF;

  SELECT claim.id, claim."companyPayableAmountCents", claim."fundedAmountCents" INTO claim_row
  FROM public."ExpenseClaim" claim
  JOIN public."ApprovalInstance" approval ON approval.id = claim."approvalInstanceId"
    AND approval."businessId" = claim.id AND approval."businessType" = 'expense_claim'
    AND approval."flowType" = 'expense_claim.approve' AND approval.status = 'approved'
  WHERE claim.id = p_claim AND claim."projectId" IS NOT NULL
    AND claim."companyEntityId" IS NOT NULL AND btrim(claim."companyEntityNameSnapshot") <> ''
    AND claim."approvedAt" IS NOT NULL AND claim."voidedAt" IS NULL
    AND claim."claimType" IN ('reimbursement', 'incidental_expense')
    AND claim.status IN ('approved_pending_payment', 'partially_paid')
  FOR UPDATE OF claim;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_CLAIM' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(refund."amountCents"), 0) INTO amount_refunded
  FROM public."PaymentExecutionRefund" refund
  JOIN public."ExpenseClaimPaymentExecution" execution ON execution.id = refund."expenseClaimPaymentExecutionId"
  WHERE refund."executionType" = 'expense_claim_payment_execution' AND execution."expenseClaimId" = p_claim;
  IF p_amount IS NULL OR p_amount <= 0 OR p_paid_at IS NULL
    OR p_paid_at > (clock_timestamp() AT TIME ZONE 'UTC')
    OR nullif(btrim(p_method), '') IS NULL OR nullif(btrim(p_previous_registration), '') IS NULL
    OR claim_row."companyPayableAmountCents" < 0 OR claim_row."fundedAmountCents" < 0
    OR amount_refunded < 0 OR amount_refunded > claim_row."fundedAmountCents"
    OR p_amount > claim_row."companyPayableAmountCents" - claim_row."fundedAmountCents" + amount_refunded THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_CLAIM' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT FROM public."RegisteredFundAccount" account
    JOIN public."PublicCashCustody" custody ON custody."accountId" = account.id
    JOIN public."User" keeper ON keeper.id = custody."currentCustodianId" AND keeper."isActive"
    JOIN public."UserPosition" assignment ON assignment."userId" = keeper.id AND assignment."projectId" IS NULL
    JOIN public."Position" position ON position.id = assignment."positionId" AND position.key = 'comprehensive_director'
    WHERE account.kind = 'public_cash' AND account."scopeKey" = 'public_cash'
      AND account."companyEntityId" IS NULL AND keeper.id = p_actor
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_KEEPER' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(190731, 13);
  PERFORM FROM public."FileObject" file
  WHERE file.id = p_file AND file."uploadedByUserId" = p_actor AND file."storageStatus" = 'active'
  FOR UPDATE OF file;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_FILE' USING ERRCODE = '23514';
  END IF;

  -- The unchanged exclusive INSERT trigger checks the rest of the complete
  -- collision registry, receipt photos, owner proceeds and replacement chains.
  -- The payment precheck also includes the two derived references excluded
  -- by collision_columns and resolves signed appendices through their formal file.
  IF EXISTS (SELECT FROM public."SpotProcurementPaymentArchiveFile" archive WHERE archive."fileId" = p_file)
    OR EXISTS (SELECT FROM public."InvoiceEvidenceRepairResolution" repair WHERE repair."replacementFileId" = p_file)
    OR EXISTS (
      SELECT FROM public."ContractSignedChange" change
      JOIN public."ContractFormalFile" formal ON formal.id = change."appendixFormalFileId"
      WHERE formal."fileId" = p_file
    ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_COLLISION'
      USING ERRCODE = 'P0A24';
  END IF;

  INSERT INTO public.jg_expense_public_cash_voucher_witness (execution_id, previous_registration_id, transaction_id)
  VALUES (new_execution_id, p_previous_registration, txid_current());
  INSERT INTO public."ExpenseClaimPaymentExecution" (
    id, "expenseClaimId", "amountCents", "paidAt", "paymentMethod", "voucherFileId", "recordedByUserId", note
  ) VALUES (new_execution_id, p_claim, p_amount, p_paid_at, p_method, p_file, p_actor, p_note);
  RETURN new_execution_id;
END;
$cash_voucher$;
REVOKE ALL ON FUNCTION public.jg_record_expense_public_cash_voucher(text,text,bigint,timestamp,text,text,text,text,text) FROM PUBLIC;

-- Binding authority depends on the existing expense-only guard. A deployment
-- missing its exact target and arguments must stop before admitting the writer.
DO $install$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  scope record;
BEGIN
  IF current_user <> session_user OR current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname = current_database() AND datdba = owner_oid)
    OR NOT EXISTS (
    SELECT FROM pg_trigger binding
    JOIN pg_proc guard ON guard.oid = binding.tgfoid
    WHERE binding.tgrelid = 'public."ExpenseClaimPaymentExecution"'::regclass
      AND binding.tgname = 'jg_efb_expense_claim_payment_execution_voucher'
      AND binding.tgenabled = 'O' AND binding.tgtype = 23 AND NOT binding.tgisinternal
      AND binding.tgqual IS NULL AND binding.tgconstraint = 0 AND binding.tgnargs = 2
      AND encode(binding.tgargs, 'hex') = '766f756368657246696c654964007472756500'
      AND binding.tgattr::text = (
        SELECT attnum::text FROM pg_attribute
        WHERE attrelid = binding.tgrelid AND attname = 'voucherFileId' AND NOT attisdropped
      )
      AND guard.oid = to_regprocedure('public.jg_legacy_procurement_expense_voucher_guard_v1()')
      AND guard.proowner = current_user::regrole::oid AND NOT guard.prosecdef
  ) THEN
    RAISE EXCEPTION 'EXPENSE_PUBLIC_CASH_VOUCHER_INSTALL_SCOPE' USING ERRCODE = '55000';
  END IF;

  -- A deployed database may grant table SELECT through owner defaults.
  -- Remove inherited creation ACLs for these new private objects only.
  FOR scope IN
    SELECT 'TABLE public.jg_expense_public_cash_voucher_witness' AS target, acl.grantee
    FROM pg_class relation, LATERAL aclexplode(relation.relacl) acl
    WHERE relation.oid = 'public.jg_expense_public_cash_voucher_witness'::regclass AND acl.grantee <> owner_oid
    UNION
    SELECT 'FUNCTION ' || routine.oid::regprocedure::text, acl.grantee
    FROM pg_proc routine, LATERAL aclexplode(routine.proacl) acl
    WHERE routine.oid IN ('public.jg_finish_expense_public_cash_voucher()'::regprocedure,
      'public.jg_record_expense_public_cash_voucher(text,text,bigint,timestamp,text,text,text,text,text)'::regprocedure)
      AND acl.grantee <> owner_oid
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM %s', scope.target,
      CASE WHEN scope.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(scope.grantee)) END);
  END LOOP;
END;
$install$;

COMMIT;
