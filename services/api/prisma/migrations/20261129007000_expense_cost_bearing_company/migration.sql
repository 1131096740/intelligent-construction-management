ALTER TABLE public."ExpenseClaim"
  ADD COLUMN "costBearingCompanySpecified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "costBearingCompanyEntityId" TEXT REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExpenseClaim_cost_bearing_company_check" CHECK (
    ("costBearingCompanySpecified" AND "projectId" IS NOT NULL AND "actualPurchaseBatchId" IS NULL AND "generalProcurementId" IS NULL AND "claimType" IN ('reimbursement', 'incidental_expense'))
    OR (NOT "costBearingCompanySpecified" AND "costBearingCompanyEntityId" IS NULL)
  );

CREATE FUNCTION public.jg_expense_cost_bearing_company_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (OLD.status <> 'draft' OR NEW.status <> 'draft') AND (
    NEW."costBearingCompanySpecified" IS DISTINCT FROM OLD."costBearingCompanySpecified"
    OR NEW."costBearingCompanyEntityId" IS DISTINCT FROM OLD."costBearingCompanyEntityId"
  ) THEN
    RAISE EXCEPTION 'expense cost bearing company is frozen after submission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ExpenseClaim_cost_bearing_company_frozen"
  BEFORE UPDATE OF "costBearingCompanySpecified", "costBearingCompanyEntityId" ON public."ExpenseClaim"
  FOR EACH ROW EXECUTE FUNCTION public.jg_expense_cost_bearing_company_frozen();
