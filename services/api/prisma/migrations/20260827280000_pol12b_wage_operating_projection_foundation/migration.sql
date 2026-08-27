-- POL-12B：经确认工资版本的显式双矩阵和追加式应付引用基础；不创建付款、核销或其他来源事实。
BEGIN;

SELECT pg_advisory_xact_lock(190731, 14);

-- 可重放工资经营事实只能依赖确认时冻结的非敏感 envelope 坐标，不能在重放时
-- 回读当前施工企业、参与公司或生效日，也不能把人员、金额、债权人、证据写进快照。
ALTER TABLE "WageStatementVersion"
  ADD COLUMN "operatingProjectionSnapshot" JSONB;

-- 已冻结的 POL-12A 历史行没有足够资料补造联合主体或两个矩阵，保留为 legacy 空壳，
-- 由 #217 服务层拒绝确认。所有新行必须通过下面的精确联合主体 CHECK。
ALTER TABLE "WageCreditorBreakdown"
  ALTER COLUMN "creditorSubjectId" DROP NOT NULL,
  ADD COLUMN "creditorSubjectType" TEXT,
  ADD COLUMN "creditorUserId" TEXT,
  ADD COLUMN "creditorBusinessPartyVersionId" TEXT,
  ADD COLUMN "creditorSubjectIdentityKey" TEXT,
  ADD COLUMN "creditorNameSnapshot" TEXT,
  ADD COLUMN "creditorUnifiedIdentitySnapshot" TEXT,
  ADD COLUMN "creditorVersionFingerprint" TEXT;

CREATE TABLE "WageProjectCostComponentAllocation" (
  "id" TEXT NOT NULL,
  "projectAllocationId" TEXT NOT NULL,
  "costComponentId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageProjectCostComponentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WageProjectCreditorAllocation" (
  "id" TEXT NOT NULL,
  "projectAllocationId" TEXT NOT NULL,
  "creditorBreakdownId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WageProjectCreditorAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WagePayableRef" (
  "id" TEXT NOT NULL,
  "confirmedVersionId" TEXT NOT NULL,
  "projectAllocationId" TEXT NOT NULL,
  "creditorBreakdownId" TEXT NOT NULL,
  "debtorCompanyId" TEXT NOT NULL,
  "costBearingCompanyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "personLineId" TEXT NOT NULL,
  "debtorCompanySnapshot" JSONB NOT NULL,
  "costBearingCompanySnapshot" JSONB NOT NULL,
  "projectSnapshot" JSONB NOT NULL,
  "personSnapshot" JSONB NOT NULL,
  "creditorSnapshot" JSONB NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "adjustsPayableRefId" TEXT,
  "settlementRecheckRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WagePayableRef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WageProjectCostComponentAllocation_project_component_key"
  ON "WageProjectCostComponentAllocation"("projectAllocationId", "costComponentId");
CREATE INDEX "WageProjectCostComponentAllocation_costComponentId_idx"
  ON "WageProjectCostComponentAllocation"("costComponentId");
CREATE UNIQUE INDEX "WageProjectCreditorAllocation_project_creditor_key"
  ON "WageProjectCreditorAllocation"("projectAllocationId", "creditorBreakdownId");
CREATE INDEX "WageProjectCreditorAllocation_creditorBreakdownId_idx"
  ON "WageProjectCreditorAllocation"("creditorBreakdownId");
CREATE INDEX "WageCreditorBreakdown_creditorUserId_idx"
  ON "WageCreditorBreakdown"("creditorUserId");
CREATE INDEX "WageCreditorBreakdown_creditorBusinessPartyVersionId_idx"
  ON "WageCreditorBreakdown"("creditorBusinessPartyVersionId");
CREATE UNIQUE INDEX "WageCreditorBreakdown_explicit_subject_key"
  ON "WageCreditorBreakdown"("personLineId", "creditorCategory", "creditorSubjectIdentityKey")
  WHERE "creditorSubjectIdentityKey" IS NOT NULL;
CREATE INDEX "WagePayableRef_confirmedVersionId_idx" ON "WagePayableRef"("confirmedVersionId");
CREATE INDEX "WagePayableRef_projectId_debtorCompanyId_idx" ON "WagePayableRef"("projectId", "debtorCompanyId");
CREATE INDEX "WagePayableRef_projectId_costBearingCompanyId_idx" ON "WagePayableRef"("projectId", "costBearingCompanyId");
CREATE INDEX "WagePayableRef_adjustsPayableRefId_idx" ON "WagePayableRef"("adjustsPayableRefId");
CREATE UNIQUE INDEX "WagePayableRef_base_identity_key"
  ON "WagePayableRef"("confirmedVersionId", "projectAllocationId", "creditorBreakdownId")
  WHERE "adjustsPayableRefId" IS NULL;

ALTER TABLE "WageCreditorBreakdown"
  ADD CONSTRAINT "WageCreditorBreakdown_creditor_user_fkey"
    FOREIGN KEY ("creditorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageCreditorBreakdown_creditor_business_party_version_fkey"
    FOREIGN KEY ("creditorBusinessPartyVersionId") REFERENCES "BusinessPartyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageCreditorBreakdown_creditor_subject_check"
    CHECK (
      (
        "creditorSubjectType" IS NULL
        AND "creditorSubjectId" IS NOT NULL
        AND "creditorUserId" IS NULL
        AND "creditorBusinessPartyVersionId" IS NULL
        AND "creditorSubjectIdentityKey" IS NULL
        AND "creditorNameSnapshot" IS NULL
        AND "creditorUnifiedIdentitySnapshot" IS NULL
        AND "creditorVersionFingerprint" IS NULL
      )
      OR (
        "creditorSubjectType" = 'employee_user'
        AND "creditorSubjectId" IS NULL
        AND "creditorUserId" IS NOT NULL
        AND "creditorBusinessPartyVersionId" IS NULL
        AND "creditorSubjectIdentityKey" = 'employee_user:' || "creditorUserId"
        AND "creditorNameSnapshot" IS NOT NULL
        AND btrim("creditorNameSnapshot") <> ''
        AND "creditorVersionFingerprint" IS NOT NULL
        AND btrim("creditorVersionFingerprint") <> ''
      )
      OR (
        "creditorSubjectType" = 'business_party'
        AND "creditorSubjectId" IS NULL
        AND "creditorUserId" IS NULL
        AND "creditorBusinessPartyVersionId" IS NOT NULL
        AND "creditorSubjectIdentityKey" = 'business_party:' || "creditorBusinessPartyVersionId"
        AND "creditorNameSnapshot" IS NOT NULL
        AND btrim("creditorNameSnapshot") <> ''
        AND "creditorVersionFingerprint" IS NOT NULL
        AND btrim("creditorVersionFingerprint") <> ''
      )
    );

ALTER TABLE "WageProjectCostComponentAllocation"
  ADD CONSTRAINT "WageProjectCostComponentAllocation_project_allocation_fkey"
    FOREIGN KEY ("projectAllocationId") REFERENCES "WageProjectAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageProjectCostComponentAllocation_cost_component_fkey"
    FOREIGN KEY ("costComponentId") REFERENCES "WageCostComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageProjectCostComponentAllocation_amount_nonnegative_check"
    CHECK ("amountCents" >= 0);
ALTER TABLE "WageProjectCreditorAllocation"
  ADD CONSTRAINT "WageProjectCreditorAllocation_project_allocation_fkey"
    FOREIGN KEY ("projectAllocationId") REFERENCES "WageProjectAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageProjectCreditorAllocation_creditor_breakdown_fkey"
    FOREIGN KEY ("creditorBreakdownId") REFERENCES "WageCreditorBreakdown"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WageProjectCreditorAllocation_amount_nonnegative_check"
    CHECK ("amountCents" >= 0);

-- 跨矩阵不能把某人的项目分摊连接到另一人的组成项或债权人明细；这个关系由行级
-- 触发器在写入时冻结，金额平衡仍由 #217 服务在整个版本范围内验证。
CREATE FUNCTION jg_wage_project_cost_component_allocation_same_person_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_person_line_id TEXT;
  component_person_line_id TEXT;
BEGIN
  SELECT "personLineId" INTO allocation_person_line_id
  FROM "WageProjectAllocation" WHERE "id" = NEW."projectAllocationId";
  SELECT "personLineId" INTO component_person_line_id
  FROM "WageCostComponent" WHERE "id" = NEW."costComponentId";
  IF allocation_person_line_id IS DISTINCT FROM component_person_line_id THEN
    RAISE EXCEPTION 'WageProjectCostComponentAllocation endpoints must share a WagePersonLine'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageProjectCostComponentAllocation_same_person_line"
BEFORE INSERT OR UPDATE OF "projectAllocationId", "costComponentId"
ON "WageProjectCostComponentAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_wage_project_cost_component_allocation_same_person_line();

CREATE FUNCTION jg_wage_project_creditor_allocation_same_person_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_person_line_id TEXT;
  creditor_person_line_id TEXT;
BEGIN
  SELECT "personLineId" INTO allocation_person_line_id
  FROM "WageProjectAllocation" WHERE "id" = NEW."projectAllocationId";
  SELECT "personLineId" INTO creditor_person_line_id
  FROM "WageCreditorBreakdown" WHERE "id" = NEW."creditorBreakdownId";
  IF allocation_person_line_id IS DISTINCT FROM creditor_person_line_id THEN
    RAISE EXCEPTION 'WageProjectCreditorAllocation endpoints must share a WagePersonLine'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageProjectCreditorAllocation_same_person_line"
BEFORE INSERT OR UPDATE OF "projectAllocationId", "creditorBreakdownId"
ON "WageProjectCreditorAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_wage_project_creditor_allocation_same_person_line();

ALTER TABLE "WagePayableRef"
  ADD CONSTRAINT "WagePayableRef_confirmed_version_fkey"
    FOREIGN KEY ("confirmedVersionId") REFERENCES "WageStatementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WagePayableRef_project_allocation_fkey"
    FOREIGN KEY ("projectAllocationId") REFERENCES "WageProjectAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WagePayableRef_creditor_breakdown_fkey"
    FOREIGN KEY ("creditorBreakdownId") REFERENCES "WageCreditorBreakdown"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WagePayableRef_person_line_fkey"
    FOREIGN KEY ("personLineId") REFERENCES "WagePersonLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WagePayableRef_adjusts_payable_ref_fkey"
    FOREIGN KEY ("adjustsPayableRefId") REFERENCES "WagePayableRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WagePayableRef_amount_nonnegative_check" CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "WagePayableRef_direction_check" CHECK ("direction" IN ('increase', 'decrease')),
  ADD CONSTRAINT "WagePayableRef_adjustment_direction_check"
    CHECK ("adjustsPayableRefId" IS NOT NULL OR "direction" = 'increase'),
  ADD CONSTRAINT "WagePayableRef_settlement_recheck_check"
    CHECK (
      "settlementRecheckRequired" = (
        "adjustsPayableRefId" IS NOT NULL AND "direction" = 'decrease'
      )
    ),
  ADD CONSTRAINT "WagePayableRef_debtor_cost_bearing_company_check"
    CHECK ("debtorCompanyId" = "costBearingCompanyId");

-- 已发布的应付引用不得覆盖或删除；更正、冲销只能追加指向其原引用的新行。
CREATE FUNCTION jg_wage_payable_ref_endpoints_same_person_and_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_person_line_id TEXT;
  allocation_project_id TEXT;
  allocation_version_id TEXT;
  creditor_person_line_id TEXT;
  target_root RECORD;
  target_version RECORD;
  root_version RECORD;
  new_person RECORD;
  root_person RECORD;
  new_creditor RECORD;
  root_creditor RECORD;
BEGIN
  SELECT allocation."personLineId", allocation."projectId", person."statementVersionId"
  INTO allocation_person_line_id, allocation_project_id, allocation_version_id
  FROM "WageProjectAllocation" allocation
  JOIN "WagePersonLine" person ON person."id" = allocation."personLineId"
  WHERE allocation."id" = NEW."projectAllocationId";
  SELECT "personLineId" INTO creditor_person_line_id
  FROM "WageCreditorBreakdown" WHERE "id" = NEW."creditorBreakdownId";

  IF NEW."personLineId" IS DISTINCT FROM allocation_person_line_id
    OR creditor_person_line_id IS DISTINCT FROM allocation_person_line_id
    OR NEW."confirmedVersionId" IS DISTINCT FROM allocation_version_id
    OR NEW."projectId" IS DISTINCT FROM allocation_project_id THEN
    RAISE EXCEPTION 'WagePayableRef endpoints must share one person line, version and project'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."adjustsPayableRefId" IS NOT NULL THEN
    -- Every correction/reversal points directly to the immutable original.
    -- Linking to an earlier adjustment would make lineage ambiguous and let
    -- later writes conceal the single base reference that #220 reconciles.
    SELECT * INTO target_root FROM "WagePayableRef"
    WHERE "id" = NEW."adjustsPayableRefId";
    IF target_root."adjustsPayableRefId" IS NOT NULL THEN
      RAISE EXCEPTION 'WagePayableRef adjustment must directly target an original base reference'
        USING ERRCODE = '23514';
    END IF;

    -- An adjustment is a later frozen version of the same monthly statement,
    -- not a duplicate row in the original version. Its physical line IDs may
    -- change with the later frozen matrices, but the original business
    -- identities and every projection snapshot must remain exactly stable.
    SELECT "statementId", "revision" INTO target_version
    FROM "WageStatementVersion" WHERE "id" = NEW."confirmedVersionId";
    SELECT "statementId", "revision" INTO root_version
    FROM "WageStatementVersion" WHERE "id" = target_root."confirmedVersionId";
    IF target_version."statementId" IS DISTINCT FROM root_version."statementId"
      OR target_version."revision" <= root_version."revision" THEN
      RAISE EXCEPTION 'WagePayableRef adjustment must target a later version of the same wage statement'
        USING ERRCODE = '23514';
    END IF;

    SELECT "employeeId", "employmentSnapshotId" INTO new_person
    FROM "WagePersonLine" WHERE "id" = NEW."personLineId";
    SELECT "employeeId", "employmentSnapshotId" INTO root_person
    FROM "WagePersonLine" WHERE "id" = target_root."personLineId";
    SELECT "creditorSubjectType", "creditorSubjectIdentityKey", "creditorCategory",
      "creditorNameSnapshot", "creditorUnifiedIdentitySnapshot", "creditorVersionFingerprint"
    INTO new_creditor
    FROM "WageCreditorBreakdown" WHERE "id" = NEW."creditorBreakdownId";
    SELECT "creditorSubjectType", "creditorSubjectIdentityKey", "creditorCategory",
      "creditorNameSnapshot", "creditorUnifiedIdentitySnapshot", "creditorVersionFingerprint"
    INTO root_creditor
    FROM "WageCreditorBreakdown" WHERE "id" = target_root."creditorBreakdownId";

    IF NEW."debtorCompanyId" IS DISTINCT FROM target_root."debtorCompanyId"
      OR NEW."costBearingCompanyId" IS DISTINCT FROM target_root."costBearingCompanyId"
      OR NEW."projectId" IS DISTINCT FROM target_root."projectId"
      OR NEW."debtorCompanySnapshot" IS DISTINCT FROM target_root."debtorCompanySnapshot"
      OR NEW."costBearingCompanySnapshot" IS DISTINCT FROM target_root."costBearingCompanySnapshot"
      OR NEW."projectSnapshot" IS DISTINCT FROM target_root."projectSnapshot"
      OR new_person."employeeId" IS DISTINCT FROM root_person."employeeId"
      OR new_person."employmentSnapshotId" IS DISTINCT FROM root_person."employmentSnapshotId"
      OR NEW."personSnapshot" IS DISTINCT FROM target_root."personSnapshot"
      OR new_creditor."creditorSubjectType" IS DISTINCT FROM root_creditor."creditorSubjectType"
      OR new_creditor."creditorSubjectIdentityKey" IS DISTINCT FROM root_creditor."creditorSubjectIdentityKey"
      OR new_creditor."creditorCategory" IS DISTINCT FROM root_creditor."creditorCategory"
      OR new_creditor."creditorNameSnapshot" IS DISTINCT FROM root_creditor."creditorNameSnapshot"
      OR new_creditor."creditorUnifiedIdentitySnapshot" IS DISTINCT FROM root_creditor."creditorUnifiedIdentitySnapshot"
      OR new_creditor."creditorVersionFingerprint" IS DISTINCT FROM root_creditor."creditorVersionFingerprint"
      OR NEW."creditorSnapshot" IS DISTINCT FROM target_root."creditorSnapshot" THEN
      RAISE EXCEPTION 'WagePayableRef adjustment must preserve the original debtor, project, person and creditor identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WagePayableRef_endpoints_same_person_and_version"
BEFORE INSERT ON "WagePayableRef"
FOR EACH ROW EXECUTE FUNCTION jg_wage_payable_ref_endpoints_same_person_and_version();

CREATE FUNCTION jg_wage_payable_ref_adjustment_effective_nonnegative()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  root_id TEXT;
  effective_amount BIGINT;
BEGIN
  IF NEW."adjustsPayableRefId" IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE ancestry AS (
    SELECT ref."id", ref."adjustsPayableRefId", 0 AS depth
    FROM "WagePayableRef" ref WHERE ref."id" = NEW."adjustsPayableRefId"
    UNION ALL
    SELECT parent."id", parent."adjustsPayableRefId", ancestry.depth + 1
    FROM "WagePayableRef" parent
    JOIN ancestry ON ancestry."adjustsPayableRefId" = parent."id"
  )
  SELECT "id" INTO root_id FROM ancestry
  WHERE "adjustsPayableRefId" IS NULL ORDER BY depth DESC LIMIT 1;

  -- Serialize sibling adjustments through the immutable base row, so two
  -- concurrent decreases cannot both observe the same pre-adjustment amount.
  PERFORM 1 FROM "WagePayableRef" WHERE "id" = root_id FOR UPDATE;

  WITH RECURSIVE lineage AS (
    SELECT ref."id", ref."direction", ref."amountCents"
    FROM "WagePayableRef" ref WHERE ref."id" = root_id
    UNION ALL
    SELECT child."id", child."direction", child."amountCents"
    FROM "WagePayableRef" child
    JOIN lineage ON child."adjustsPayableRefId" = lineage."id"
  )
  SELECT COALESCE(sum(CASE WHEN "direction" = 'increase' THEN "amountCents" ELSE -"amountCents" END), 0)
    INTO effective_amount
  FROM lineage;

  effective_amount := effective_amount +
    CASE WHEN NEW."direction" = 'increase' THEN NEW."amountCents" ELSE -NEW."amountCents" END;
  IF effective_amount < 0 THEN
    RAISE EXCEPTION 'WagePayableRef adjustment would make its effective amount negative'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WagePayableRef_adjustment_effective_nonnegative"
BEFORE INSERT ON "WagePayableRef"
FOR EACH ROW EXECUTE FUNCTION jg_wage_payable_ref_adjustment_effective_nonnegative();

CREATE FUNCTION jg_reject_wage_payable_ref_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WagePayableRef is append-only; create an adjustment reference instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "WagePayableRef_immutable"
BEFORE UPDATE OR DELETE ON "WagePayableRef"
FOR EACH ROW EXECUTE FUNCTION jg_reject_wage_payable_ref_mutation();

-- A confirmed wage version is immutable at every matrix endpoint.  Protect
-- both the explicit cells and the component/creditor/project rows they join,
-- so a direct SQL update cannot change the data a confirmed projection would
-- later replay.  Draft versions remain editable through the wage workflow.
CREATE FUNCTION jg_reject_confirmed_wage_projection_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_person_line_id TEXT;
  new_person_line_id TEXT;
  has_confirmed_version BOOLEAN;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'WageCostComponent', 'WageCreditorBreakdown', 'WageProjectAllocation' THEN
      old_person_line_id := OLD."personLineId";
      IF TG_OP = 'UPDATE' THEN new_person_line_id := NEW."personLineId"; END IF;
    WHEN 'WageProjectCostComponentAllocation' THEN
      SELECT "personLineId" INTO old_person_line_id
      FROM "WageProjectAllocation" WHERE "id" = OLD."projectAllocationId";
      IF TG_OP = 'UPDATE' THEN
        SELECT "personLineId" INTO new_person_line_id
        FROM "WageProjectAllocation" WHERE "id" = NEW."projectAllocationId";
      END IF;
    WHEN 'WageProjectCreditorAllocation' THEN
      SELECT "personLineId" INTO old_person_line_id
      FROM "WageProjectAllocation" WHERE "id" = OLD."projectAllocationId";
      IF TG_OP = 'UPDATE' THEN
        SELECT "personLineId" INTO new_person_line_id
        FROM "WageProjectAllocation" WHERE "id" = NEW."projectAllocationId";
      END IF;
  END CASE;

  SELECT EXISTS (
    SELECT 1
    FROM "WagePersonLine" person
    JOIN "WageStatementVersion" version ON version."id" = person."statementVersionId"
    WHERE person."id" IN (old_person_line_id, new_person_line_id)
      AND version."status" = 'confirmed'
  ) INTO has_confirmed_version;
  IF has_confirmed_version THEN
    RAISE EXCEPTION 'confirmed WageStatementVersion projection rows are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WageCostComponent_confirmed_projection_immutable"
BEFORE UPDATE OR DELETE ON "WageCostComponent"
FOR EACH ROW EXECUTE FUNCTION jg_reject_confirmed_wage_projection_mutation();
CREATE TRIGGER "WageCreditorBreakdown_confirmed_projection_immutable"
BEFORE UPDATE OR DELETE ON "WageCreditorBreakdown"
FOR EACH ROW EXECUTE FUNCTION jg_reject_confirmed_wage_projection_mutation();
CREATE TRIGGER "WageProjectAllocation_confirmed_projection_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_reject_confirmed_wage_projection_mutation();
CREATE TRIGGER "WageProjectCostComponentAllocation_confirmed_projection_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectCostComponentAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_reject_confirmed_wage_projection_mutation();
CREATE TRIGGER "WageProjectCreditorAllocation_confirmed_projection_immutable"
BEFORE UPDATE OR DELETE ON "WageProjectCreditorAllocation"
FOR EACH ROW EXECUTE FUNCTION jg_reject_confirmed_wage_projection_mutation();

COMMIT;
