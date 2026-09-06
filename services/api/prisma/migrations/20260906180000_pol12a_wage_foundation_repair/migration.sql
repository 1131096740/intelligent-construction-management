-- POL-12A repair: approved sources and submitted/confirmed wage facts are append-only.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 26);

CREATE FUNCTION jg_wage_approved_source_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WageApprovedSourceVersion is immutable; create a new source version'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "WageApprovedSourceVersion_immutable"
BEFORE UPDATE OR DELETE ON "WageApprovedSourceVersion"
FOR EACH ROW EXECUTE FUNCTION jg_wage_approved_source_immutable();

CREATE FUNCTION jg_wage_statement_version_finalized_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" IN ('confirmed', 'superseded') THEN
    RAISE EXCEPTION 'Finalized WageStatementVersion is immutable; create a new revision'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageStatementVersion_finalized_update_immutable"
BEFORE UPDATE ON "WageStatementVersion"
FOR EACH ROW EXECUTE FUNCTION jg_wage_statement_version_finalized_immutable();

CREATE TRIGGER "WageStatementVersion_finalized_delete_immutable"
BEFORE DELETE ON "WageStatementVersion"
FOR EACH ROW EXECUTE FUNCTION jg_wage_statement_version_finalized_immutable();

CREATE FUNCTION jg_wage_fact_parent_must_be_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_version_id TEXT;
  parent_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'WagePersonLine' THEN
    parent_version_id := OLD."statementVersionId";
  ELSIF TG_TABLE_NAME IN ('WageCostComponent', 'WageCreditorBreakdown', 'WageProjectAllocation') THEN
    SELECT p."statementVersionId" INTO parent_version_id
    FROM "WagePersonLine" p
    WHERE p."id" = OLD."personLineId";
  ELSIF TG_TABLE_NAME = 'WageProjectCostComponentAllocation' THEN
    SELECT p."statementVersionId" INTO parent_version_id
    FROM "WageProjectAllocation" a
    JOIN "WagePersonLine" p ON p."id" = a."personLineId"
    WHERE a."id" = OLD."projectAllocationId";
  ELSIF TG_TABLE_NAME = 'WageProjectCreditorAllocation' THEN
    SELECT p."statementVersionId" INTO parent_version_id
    FROM "WageProjectAllocation" a
    JOIN "WagePersonLine" p ON p."id" = a."personLineId"
    WHERE a."id" = OLD."projectAllocationId";
  ELSE
    RAISE EXCEPTION 'Unsupported wage fact table %', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  SELECT v."status" INTO parent_status
  FROM "WageStatementVersion" v
  WHERE v."id" = parent_version_id;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Submitted or finalized wage facts are immutable; edit a draft or create a new revision'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WagePersonLine_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WagePersonLine"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();
CREATE TRIGGER "WageCostComponent_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageCostComponent"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();
CREATE TRIGGER "WageCreditorBreakdown_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageCreditorBreakdown"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();
CREATE TRIGGER "WageProjectAllocation_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();
CREATE TRIGGER "WageProjectCostComponentAllocation_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectCostComponentAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();
CREATE TRIGGER "WageProjectCreditorAllocation_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectCreditorAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_wage_fact_parent_must_be_draft();

CREATE FUNCTION jg_wage_service_basis_nondraft_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "WageProjectAllocation" a
    JOIN "WagePersonLine" p ON p."id" = a."personLineId"
    JOIN "WageStatementVersion" v ON v."id" = p."statementVersionId"
    WHERE a."serviceBasisBindingId" = OLD."id"
      AND v."status" <> 'draft'
  ) THEN
    RAISE EXCEPTION 'Service basis used by submitted or finalized wage facts is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageServiceBasisBinding_nondraft_immutable"
BEFORE UPDATE OR DELETE ON "WageServiceBasisBinding"
FOR EACH ROW EXECUTE FUNCTION jg_wage_service_basis_nondraft_immutable();

COMMIT;
