BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $preimage$
BEGIN
  IF current_user <> session_user
    OR current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_database
      WHERE datname = current_database() AND datdba = current_user::regrole::oid
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'public."ExpenseClaim"'::regclass
        AND t.tgname = 'ExpenseClaim_lock_construction_enterprise'
        AND t.tgfoid = 'public."lockProjectConstructionEnterpriseFromFormalFact"()'::regprocedure
        AND t.tgtype = 21 AND t.tgenabled = 'O' AND NOT t.tgisinternal
        AND NOT (t.tgdeferrable OR t.tginitdeferred) AND t.tgconstraint = 0
        AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr::text = ''
        AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
        AND p.proowner = current_user::regrole::oid AND NOT p.prosecdef
    )
  THEN
    RAISE EXCEPTION 'EXPENSE_STANDALONE_ASSIGNMENT_LOCK_PREIMAGE' USING ERRCODE = '55000';
  END IF;
END;
$preimage$;

-- Restrict the elevated operation to side effects of the actual expense row.
-- No callable writer accepts a project or an assignment as an argument.
CREATE FUNCTION public.jg_lock_standalone_expense_assignment_v1()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $lock$
DECLARE
  assignment_id text;
  fact_day date;
BEGIN
  IF TG_RELID <> 'public."ExpenseClaim"'::regclass OR TG_WHEN <> 'AFTER'
    OR TG_LEVEL <> 'ROW' OR TG_OP NOT IN ('INSERT', 'UPDATE') OR TG_NARGS <> 0
    OR current_setting('session_replication_role') <> 'origin'
  THEN
    RAISE EXCEPTION 'EXPENSE_STANDALONE_ASSIGNMENT_LOCK_TRIGGER' USING ERRCODE = '42501';
  END IF;

  IF NEW."projectId" IS NULL OR NEW."claimType" NOT IN ('reimbursement', 'incidental_expense')
    OR NEW."actualPurchaseBatchId" IS NOT NULL OR NEW."generalProcurementId" IS NOT NULL
  THEN
    RAISE EXCEPTION 'EXPENSE_STANDALONE_ASSIGNMENT_LOCK_SOURCE' USING ERRCODE = '42501';
  END IF;

  IF NEW."voidedAt" IS NOT NULL OR NEW."status" NOT IN (
    'approved_pending_payment', 'partially_paid', 'paid',
    'approved_pending_disbursement', 'partially_disbursed', 'disbursed', 'offset_completed'
  ) THEN
    RETURN NEW;
  END IF;

  fact_day := COALESCE(NEW."approvedAt", NEW."createdAt")::date;
  PERFORM 1 FROM public."Project" WHERE "id" = NEW."projectId" FOR UPDATE;
  SELECT "id" INTO assignment_id
  FROM public."ProjectAffiliateAssignment"
  WHERE "projectId" = NEW."projectId" AND "effectiveFrom" <= fact_day AND "endedAt" IS NULL
  FOR KEY SHARE;
  IF assignment_id IS NULL THEN
    RAISE EXCEPTION '正式经营事实发生前必须先设置唯一施工企业' USING ERRCODE = '23514';
  END IF;

  UPDATE public."Project"
  SET "constructionEnterpriseLockedAt" = COALESCE("constructionEnterpriseLockedAt", CURRENT_TIMESTAMP)
  WHERE "id" = NEW."projectId";
  RETURN NEW;
END;
$lock$;

REVOKE ALL ON FUNCTION public.jg_lock_standalone_expense_assignment_v1() FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.jg_lock_standalone_expense_assignment_v1()'::regprocedure
      AND (a.grantee <> p.proowner OR a.grantor <> p.proowner OR a.privilege_type <> 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'EXPENSE_STANDALONE_ASSIGNMENT_LOCK_ACL' USING ERRCODE = '55000';
  END IF;
END;
$acl$;

DROP TRIGGER "ExpenseClaim_lock_construction_enterprise" ON public."ExpenseClaim";
CREATE TRIGGER "ExpenseClaim_lock_construction_enterprise"
  AFTER INSERT OR UPDATE ON public."ExpenseClaim"
  FOR EACH ROW WHEN (NOT (
    NEW."projectId" IS NOT NULL AND NEW."claimType" IN ('reimbursement', 'incidental_expense')
    AND NEW."actualPurchaseBatchId" IS NULL AND NEW."generalProcurementId" IS NULL
  )) EXECUTE FUNCTION public."lockProjectConstructionEnterpriseFromFormalFact"();

CREATE TRIGGER "ExpenseClaim_lock_standalone_assignment"
  AFTER INSERT OR UPDATE ON public."ExpenseClaim"
  FOR EACH ROW WHEN (
    NEW."projectId" IS NOT NULL AND NEW."claimType" IN ('reimbursement', 'incidental_expense')
    AND NEW."actualPurchaseBatchId" IS NULL AND NEW."generalProcurementId" IS NULL
  ) EXECUTE FUNCTION public.jg_lock_standalone_expense_assignment_v1();

COMMIT;
