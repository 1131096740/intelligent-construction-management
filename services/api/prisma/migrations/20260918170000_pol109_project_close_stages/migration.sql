BEGIN;

CREATE TABLE "ProjectCloseAggregate" (
  "projectId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseAggregate_pkey" PRIMARY KEY ("projectId"),
  CONSTRAINT "ProjectCloseAggregate_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "ProjectCloseAggregate_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ProjectCloseStageVersion" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "stageKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "previousVersionId" TEXT,
  "projectionReadAt" TIMESTAMP(3) NOT NULL,
  "projectionCutoffAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "amountSnapshot" JSONB NOT NULL,
  "stateSnapshot" JSONB NOT NULL,
  "basisSnapshot" JSONB NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseStageVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseStageVersion_stage_check" CHECK ("stageKey" IN (
    'construction_completed',
    'owner_settlement_completed',
    'downstream_cost_confirmed',
    'tax_and_enterprise_clearing_completed',
    'final_profit_confirmed',
    'profit_distribution_completed',
    'project_funds_cleared'
  )),
  CONSTRAINT "ProjectCloseStageVersion_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ProjectCloseStageVersion_status_check" CHECK ("status" IN ('completed', 'needs_reconfirmation')),
  CONSTRAINT "ProjectCloseStageVersion_snapshot_check" CHECK (
    length(btrim("projectionFingerprint")) > 0
    AND length(btrim("idempotencyKey")) > 0
    AND length(btrim("payloadFingerprint")) > 0
    AND "projectionCutoffAt" <= "projectionReadAt"
  ),
  CONSTRAINT "ProjectCloseStageVersion_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseStageVersion_previous_fkey"
    FOREIGN KEY ("previousVersionId") REFERENCES "ProjectCloseStageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectCloseStageVersion_idempotencyKey_key"
  ON "ProjectCloseStageVersion"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectCloseStageVersion_project_stage_revision_key"
  ON "ProjectCloseStageVersion"("projectId", "stageKey", "revision");
CREATE INDEX "ProjectCloseStageVersion_project_stage_created_idx"
  ON "ProjectCloseStageVersion"("projectId", "stageKey", "createdAt");
CREATE INDEX "ProjectCloseStageVersion_previous_idx"
  ON "ProjectCloseStageVersion"("previousVersionId");

CREATE TABLE "ProjectCloseImpact" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "affectedStages" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseImpact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseImpact_payload_check" CHECK (
    length(btrim("sourceType")) > 0 AND length(btrim("sourceId")) > 0
    AND length(btrim("sourceFingerprint")) > 0 AND length(btrim("reason")) > 0
    AND jsonb_typeof("affectedStages") = 'array'
  ),
  CONSTRAINT "ProjectCloseImpact_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseImpact_idempotencyKey_key" ON "ProjectCloseImpact"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectCloseImpact_source_fingerprint_key"
  ON "ProjectCloseImpact"("projectId", "sourceType", "sourceId", "sourceFingerprint");
CREATE INDEX "ProjectCloseImpact_project_observed_idx" ON "ProjectCloseImpact"("projectId", "observedAt");

CREATE TABLE "ProjectTemporaryProfitDistribution" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "projectParticipatingCompanyId" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityVersionId" TEXT NOT NULL,
  "companyNameSnapshot" TEXT NOT NULL,
  "companyCreditCodeSnapshot" TEXT,
  "amountCents" BIGINT NOT NULL,
  "authorizationCeilingCents" BIGINT NOT NULL,
  "temporaryDistributedBeforeCents" BIGINT NOT NULL,
  "authorizedCumulativeCents" BIGINT NOT NULL,
  "projectionReadAt" TIMESTAMP(3) NOT NULL,
  "projectionCutoffAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "basisSnapshot" JSONB NOT NULL,
  "authorizedByUserId" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTemporaryProfitDistribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectTemporaryProfitDistribution_amount_check" CHECK (
    "revision" > 0 AND "amountCents" > 0 AND "authorizationCeilingCents" >= 0
    AND "temporaryDistributedBeforeCents" >= 0
    AND "authorizedCumulativeCents" = "temporaryDistributedBeforeCents" + "amountCents"
    AND "authorizedCumulativeCents" <= "authorizationCeilingCents"
    AND "projectionCutoffAt" <= "projectionReadAt"
  ),
  CONSTRAINT "ProjectTemporaryProfitDistribution_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectTemporaryProfitDistribution_participant_fkey"
    FOREIGN KEY ("projectParticipatingCompanyId") REFERENCES "ProjectParticipatingCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectTemporaryProfitDistribution_company_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectTemporaryProfitDistribution_company_version_fkey"
    FOREIGN KEY ("companyEntityVersionId") REFERENCES "CompanyEntityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectTemporaryProfitDistribution_idempotencyKey_key"
  ON "ProjectTemporaryProfitDistribution"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectTemporaryProfitDistribution_project_revision_key"
  ON "ProjectTemporaryProfitDistribution"("projectId", "revision");
CREATE INDEX "ProjectTemporaryProfitDistribution_project_company_idx"
  ON "ProjectTemporaryProfitDistribution"("projectId", "companyEntityId", "createdAt");

CREATE TABLE "ProjectCloseCommandReceipt" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "stageVersionId" TEXT,
  "action" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "responseSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseCommandReceipt_payload_check" CHECK (
    length(btrim("action")) > 0
    AND length(btrim("idempotencyKey")) > 0
    AND length(btrim("payloadFingerprint")) > 0
  ),
  CONSTRAINT "ProjectCloseCommandReceipt_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseCommandReceipt_stage_version_fkey"
    FOREIGN KEY ("stageVersionId") REFERENCES "ProjectCloseStageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectCloseCommandReceipt_idempotencyKey_key"
  ON "ProjectCloseCommandReceipt"("idempotencyKey");
CREATE INDEX "ProjectCloseCommandReceipt_project_action_idx"
  ON "ProjectCloseCommandReceipt"("projectId", "action", "createdAt");
CREATE INDEX "ProjectCloseCommandReceipt_stage_version_idx"
  ON "ProjectCloseCommandReceipt"("stageVersionId");

CREATE TABLE "ProjectCloseProfessionalAttestation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "projectionReadAt" TIMESTAMP(3) NOT NULL,
  "projectionCutoffAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "basisSnapshot" JSONB NOT NULL,
  "attestedByUserId" TEXT NOT NULL,
  "attestedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseProfessionalAttestation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseProfessionalAttestation_specialty_check"
    CHECK ("specialty" IN ('contract', 'finance')),
  CONSTRAINT "ProjectCloseProfessionalAttestation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ProjectCloseProfessionalAttestation_snapshot_check" CHECK (
    length(btrim("projectionFingerprint")) > 0
    AND length(btrim("idempotencyKey")) > 0
    AND length(btrim("payloadFingerprint")) > 0
    AND "projectionCutoffAt" <= "projectionReadAt"
  ),
  CONSTRAINT "ProjectCloseProfessionalAttestation_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseProfessionalAttestation_idempotencyKey_key"
  ON "ProjectCloseProfessionalAttestation"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectCloseAttestation_project_specialty_revision_key"
  ON "ProjectCloseProfessionalAttestation"("projectId", "specialty", "revision");
CREATE INDEX "ProjectCloseAttestation_project_specialty_created_idx"
  ON "ProjectCloseProfessionalAttestation"("projectId", "specialty", "createdAt");

CREATE TABLE "ProjectCloseStageAttestationLink" (
  "stageVersionId" TEXT NOT NULL,
  "attestationId" TEXT NOT NULL,
  "specialty" TEXT NOT NULL,
  CONSTRAINT "ProjectCloseStageAttestationLink_pkey" PRIMARY KEY ("stageVersionId", "specialty"),
  CONSTRAINT "ProjectCloseStageAttestationLink_specialty_check"
    CHECK ("specialty" IN ('contract', 'finance')),
  CONSTRAINT "ProjectCloseStageAttestationLink_stage_fkey"
    FOREIGN KEY ("stageVersionId") REFERENCES "ProjectCloseStageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseStageAttestationLink_attestation_fkey"
    FOREIGN KEY ("attestationId") REFERENCES "ProjectCloseProfessionalAttestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseStageAttestationLink_attestationId_key"
  ON "ProjectCloseStageAttestationLink"("attestationId");

CREATE TABLE "ProjectCloseProfitConfirmation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "stageVersionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "previousConfirmationId" TEXT,
  "finalProfitCents" BIGINT NOT NULL,
  "projectionReadAt" TIMESTAMP(3) NOT NULL,
  "projectionCutoffAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "amountSnapshot" JSONB NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "basisSnapshot" JSONB NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseProfitConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseProfitConfirmation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ProjectCloseProfitConfirmation_snapshot_check" CHECK (
    length(btrim("projectionFingerprint")) > 0
    AND length(btrim("formulaVersion")) > 0
    AND "projectionCutoffAt" <= "projectionReadAt"
  ),
  CONSTRAINT "ProjectCloseProfitConfirmation_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseProfitConfirmation_stage_fkey"
    FOREIGN KEY ("stageVersionId") REFERENCES "ProjectCloseStageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseProfitConfirmation_previous_fkey"
    FOREIGN KEY ("previousConfirmationId") REFERENCES "ProjectCloseProfitConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseProfitConfirmation_stageVersionId_key"
  ON "ProjectCloseProfitConfirmation"("stageVersionId");
CREATE UNIQUE INDEX "ProjectCloseProfitConfirmation_idempotencyKey_key"
  ON "ProjectCloseProfitConfirmation"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectCloseProfitConfirmation_project_revision_key"
  ON "ProjectCloseProfitConfirmation"("projectId", "revision");
CREATE INDEX "ProjectCloseProfitConfirmation_previous_idx"
  ON "ProjectCloseProfitConfirmation"("previousConfirmationId");

CREATE TABLE "ProjectCloseDistribution" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "stageVersionId" TEXT NOT NULL,
  "profitConfirmationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "previousDistributionId" TEXT,
  "totalProfitCents" BIGINT NOT NULL,
  "projectionReadAt" TIMESTAMP(3) NOT NULL,
  "projectionCutoffAt" TIMESTAMP(3) NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "basisSnapshot" JSONB NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseDistribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseDistribution_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ProjectCloseDistribution_snapshot_check" CHECK (
    length(btrim("projectionFingerprint")) > 0
    AND "projectionCutoffAt" <= "projectionReadAt"
  ),
  CONSTRAINT "ProjectCloseDistribution_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistribution_stage_fkey"
    FOREIGN KEY ("stageVersionId") REFERENCES "ProjectCloseStageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistribution_profit_fkey"
    FOREIGN KEY ("profitConfirmationId") REFERENCES "ProjectCloseProfitConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistribution_previous_fkey"
    FOREIGN KEY ("previousDistributionId") REFERENCES "ProjectCloseDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseDistribution_stageVersionId_key"
  ON "ProjectCloseDistribution"("stageVersionId");
CREATE UNIQUE INDEX "ProjectCloseDistribution_idempotencyKey_key"
  ON "ProjectCloseDistribution"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectCloseDistribution_project_revision_key"
  ON "ProjectCloseDistribution"("projectId", "revision");
CREATE INDEX "ProjectCloseDistribution_profit_idx"
  ON "ProjectCloseDistribution"("profitConfirmationId");
CREATE INDEX "ProjectCloseDistribution_previous_idx"
  ON "ProjectCloseDistribution"("previousDistributionId");

CREATE TABLE "ProjectCloseDistributionLine" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "distributionId" TEXT NOT NULL,
  "projectParticipatingCompanyId" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityVersionId" TEXT NOT NULL,
  "companyNameSnapshot" TEXT NOT NULL,
  "finalShareCents" BIGINT NOT NULL,
  "temporaryDistributedCents" BIGINT NOT NULL,
  "existingFundsAppliedCents" BIGINT NOT NULL,
  "actualTransferCents" BIGINT NOT NULL,
  "toReceiveCents" BIGINT NOT NULL,
  "toReturnCents" BIGINT NOT NULL,
  "additionalBearingCents" BIGINT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCloseDistributionLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectCloseDistributionLine_amount_check" CHECK (
    "temporaryDistributedCents" >= 0
    AND "existingFundsAppliedCents" >= 0
    AND "actualTransferCents" >= 0
    AND "toReceiveCents" >= 0
    AND "toReturnCents" >= 0
    AND "additionalBearingCents" >= 0
    AND "finalShareCents" =
      "existingFundsAppliedCents" + "actualTransferCents" + "toReceiveCents"
      - "toReturnCents" - "additionalBearingCents"
  ),
  CONSTRAINT "ProjectCloseDistributionLine_distribution_fkey"
    FOREIGN KEY ("distributionId") REFERENCES "ProjectCloseDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistributionLine_participant_fkey"
    FOREIGN KEY ("projectParticipatingCompanyId") REFERENCES "ProjectParticipatingCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistributionLine_company_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectCloseDistributionLine_company_version_fkey"
    FOREIGN KEY ("companyEntityVersionId") REFERENCES "CompanyEntityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCloseDistributionLine_distribution_participant_key"
  ON "ProjectCloseDistributionLine"("distributionId", "projectParticipatingCompanyId");
CREATE INDEX "ProjectCloseDistributionLine_company_idx"
  ON "ProjectCloseDistributionLine"("companyEntityId");

CREATE TABLE "ProjectProfitDistributionAuthorization" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "authorizationKind" TEXT NOT NULL,
  "temporaryDistributionId" TEXT,
  "distributionId" TEXT,
  "distributionLineId" TEXT,
  "companyEntityId" TEXT NOT NULL,
  "authorizedAmountCents" BIGINT NOT NULL,
  "projectionFingerprint" TEXT NOT NULL,
  "authorizedByUserId" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectProfitDistributionAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectProfitDistributionAuthorization_amount_check"
    CHECK (
      "authorizedAmountCents" > 0
      AND "authorizationKind" IN ('temporary', 'final')
      AND (("authorizationKind" = 'temporary' AND "temporaryDistributionId" IS NOT NULL AND "distributionId" IS NULL AND "distributionLineId" IS NULL)
        OR ("authorizationKind" = 'final' AND "temporaryDistributionId" IS NULL AND "distributionId" IS NOT NULL AND "distributionLineId" IS NOT NULL))
    ),
  CONSTRAINT "ProjectProfitDistributionAuthorization_aggregate_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ProjectCloseAggregate"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectProfitDistributionAuthorization_distribution_fkey"
    FOREIGN KEY ("distributionId") REFERENCES "ProjectCloseDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectProfitDistributionAuthorization_line_fkey"
    FOREIGN KEY ("distributionLineId") REFERENCES "ProjectCloseDistributionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectProfitDistributionAuthorization_company_fkey"
    FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectProfitDistributionAuthorization_temporary_fkey"
    FOREIGN KEY ("temporaryDistributionId") REFERENCES "ProjectTemporaryProfitDistribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectProfitDistributionAuthorization_idempotencyKey_key"
  ON "ProjectProfitDistributionAuthorization"("idempotencyKey");
CREATE UNIQUE INDEX "ProjectProfitDistributionAuthorization_line_key"
  ON "ProjectProfitDistributionAuthorization"("distributionLineId");
CREATE UNIQUE INDEX "ProjectProfitDistributionAuthorization_temporaryDistributionId_key"
  ON "ProjectProfitDistributionAuthorization"("temporaryDistributionId");
CREATE INDEX "ProjectProfitDistributionAuthorization_project_company_idx"
  ON "ProjectProfitDistributionAuthorization"("projectId", "companyEntityId");

ALTER TABLE "FundMovement"
  ADD CONSTRAINT "FundMovement_profit_authorization_fkey"
  FOREIGN KEY ("profitAuthorizationId") REFERENCES "ProjectProfitDistributionAuthorization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FundMovement_profit_authorization_status_idx"
  ON "FundMovement"("profitAuthorizationId", "status");

CREATE FUNCTION "pol109_immutable_history_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'POL-109 immutable history cannot be changed' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ProjectCloseStageVersion_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseStageVersion"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();

CREATE TRIGGER "ProjectCloseImpact_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseImpact"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectTemporaryProfitDistribution_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectTemporaryProfitDistribution"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();

CREATE TRIGGER "ProjectCloseCommandReceipt_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseCommandReceipt"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();

CREATE TRIGGER "ProjectCloseProfessionalAttestation_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseProfessionalAttestation"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectCloseStageAttestationLink_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseStageAttestationLink"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectCloseProfitConfirmation_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseProfitConfirmation"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectCloseDistribution_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseDistribution"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectCloseDistributionLine_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectCloseDistributionLine"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();
CREATE TRIGGER "ProjectProfitDistributionAuthorization_immutable"
  BEFORE UPDATE OR DELETE ON "ProjectProfitDistributionAuthorization"
  FOR EACH ROW EXECUTE FUNCTION "pol109_immutable_history_guard"();

CREATE FUNCTION "pol109_validate_stage_lineage"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  latest_id TEXT;
  latest_revision INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pol109-stage:' || NEW."projectId" || ':' || NEW."stageKey", 0));
  SELECT v."id", v."revision" INTO latest_id, latest_revision
  FROM "ProjectCloseStageVersion" v
  WHERE v."projectId" = NEW."projectId" AND v."stageKey" = NEW."stageKey"
  ORDER BY v."revision" DESC LIMIT 1;
  IF latest_revision IS NULL THEN
    IF NEW."revision" <> 1 OR NEW."previousVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'POL-109 first stage revision must start at one' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."revision" <> latest_revision + 1 OR NEW."previousVersionId" IS DISTINCT FROM latest_id THEN
    RAISE EXCEPTION 'POL-109 stage lineage is not contiguous' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProjectCloseStageVersion_validate_lineage"
  BEFORE INSERT ON "ProjectCloseStageVersion"
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_stage_lineage"();

CREATE FUNCTION "pol109_validate_temporary_distribution"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prior_revision INTEGER;
  prior_total BIGINT;
  participant_company TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pol109-temp:' || NEW."projectId", 0));
  SELECT COALESCE(max(t."revision"), 0), COALESCE(sum(t."amountCents"), 0)
    INTO prior_revision, prior_total
  FROM "ProjectTemporaryProfitDistribution" t WHERE t."projectId" = NEW."projectId";
  SELECT p."companyEntityId" INTO participant_company
  FROM "ProjectParticipatingCompany" p
  WHERE p."id" = NEW."projectParticipatingCompanyId" AND p."projectId" = NEW."projectId"
    AND p."companyEntityVersionId" = NEW."companyEntityVersionId"
    AND p."effectiveFrom" <= NEW."projectionCutoffAt"
    AND (p."endedAt" IS NULL OR p."endedAt" > NEW."projectionCutoffAt");
  IF NEW."revision" <> prior_revision + 1
     OR NEW."temporaryDistributedBeforeCents" <> prior_total
     OR NEW."authorizedCumulativeCents" <> prior_total + NEW."amountCents"
     OR NEW."authorizedCumulativeCents" > NEW."authorizationCeilingCents"
     OR participant_company IS DISTINCT FROM NEW."companyEntityId" THEN
    RAISE EXCEPTION 'POL-109 temporary distribution exceeds its canonical locked ceiling' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProjectTemporaryProfitDistribution_validate"
  BEFORE INSERT ON "ProjectTemporaryProfitDistribution"
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_temporary_distribution"();

CREATE FUNCTION "pol109_validate_stage_completion"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  stage_order TEXT[] := ARRAY[
    'construction_completed',
    'owner_settlement_completed',
    'downstream_cost_confirmed',
    'tax_and_enterprise_clearing_completed',
    'final_profit_confirmed',
    'profit_distribution_completed',
    'project_funds_cleared'
  ];
  current_position INTEGER;
  required_stage TEXT;
  latest_status TEXT;
  linked_count INTEGER;
BEGIN
  IF NEW."status" <> 'completed' THEN
    RETURN NULL;
  END IF;
  current_position := array_position(stage_order, NEW."stageKey");
  IF current_position > 1 THEN
    FOREACH required_stage IN ARRAY stage_order[1:current_position - 1]
    LOOP
      SELECT v."status" INTO latest_status
      FROM "ProjectCloseStageVersion" v
      WHERE v."projectId" = NEW."projectId" AND v."stageKey" = required_stage
      ORDER BY v."revision" DESC
      LIMIT 1;
      IF latest_status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'POL-109 prerequisite stage is not completed' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  IF NEW."stageKey" = 'downstream_cost_confirmed' THEN
    SELECT count(*) INTO linked_count
    FROM "ProjectCloseStageAttestationLink" l
    JOIN "ProjectCloseProfessionalAttestation" a ON a."id" = l."attestationId"
    WHERE l."stageVersionId" = NEW."id"
      AND a."projectId" = NEW."projectId"
      AND a."projectionFingerprint" = NEW."projectionFingerprint"
      AND l."specialty" = a."specialty";
    IF linked_count <> 2 THEN
      RAISE EXCEPTION 'POL-109 downstream cost requires contract and finance attestations' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."stageKey" = 'final_profit_confirmed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ProjectCloseProfitConfirmation" p
      WHERE p."stageVersionId" = NEW."id" AND p."projectId" = NEW."projectId"
        AND p."projectionFingerprint" = NEW."projectionFingerprint"
    ) THEN
      RAISE EXCEPTION 'POL-109 final profit stage requires confirmation' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."stageKey" = 'profit_distribution_completed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ProjectCloseDistribution" d
      WHERE d."stageVersionId" = NEW."id" AND d."projectId" = NEW."projectId"
        AND d."projectionFingerprint" = NEW."projectionFingerprint"
    ) THEN
      RAISE EXCEPTION 'POL-109 distribution stage requires distribution version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ProjectCloseStageVersion_validate_completion"
  AFTER INSERT ON "ProjectCloseStageVersion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_stage_completion"();

CREATE FUNCTION "pol109_validate_distribution"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_id TEXT;
  target_total BIGINT;
  allocated_total BIGINT;
  invalid_subjects INTEGER;
  effective_participant_count INTEGER;
  covered_participant_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ProjectCloseDistribution' THEN
    target_id := NEW."id";
  ELSE
    target_id := NEW."distributionId";
  END IF;
  SELECT d."totalProfitCents" INTO target_total
  FROM "ProjectCloseDistribution" d WHERE d."id" = target_id;
  IF target_total IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(l."finalShareCents"), 0), count(*) FILTER (
    WHERE p."projectId" IS DISTINCT FROM d."projectId"
       OR p."companyEntityId" IS DISTINCT FROM l."companyEntityId"
       OR p."companyEntityVersionId" IS DISTINCT FROM l."companyEntityVersionId"
       OR p."effectiveFrom" > d."projectionCutoffAt"::date
       OR (p."endedAt" IS NOT NULL AND p."endedAt" <= d."projectionCutoffAt"::date)
  ) INTO allocated_total, invalid_subjects
  FROM "ProjectCloseDistribution" d
  LEFT JOIN "ProjectCloseDistributionLine" l ON l."distributionId" = d."id"
  LEFT JOIN "ProjectParticipatingCompany" p ON p."id" = l."projectParticipatingCompanyId"
  WHERE d."id" = target_id
  GROUP BY d."id";
  IF allocated_total IS DISTINCT FROM target_total THEN
    RAISE EXCEPTION 'POL-109 distribution lines do not conserve final profit' USING ERRCODE = '23514';
  END IF;
  IF invalid_subjects <> 0 THEN
    RAISE EXCEPTION 'POL-109 distribution subject is not effective at projection cutoff' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::INTEGER INTO effective_participant_count
  FROM "ProjectParticipatingCompany" p
  JOIN "ProjectCloseDistribution" d ON d."projectId" = p."projectId"
  WHERE d."id" = target_id
    AND p."effectiveFrom" <= d."projectionCutoffAt"::date
    AND (p."endedAt" IS NULL OR p."endedAt" > d."projectionCutoffAt"::date);
  SELECT count(DISTINCT l."projectParticipatingCompanyId")::INTEGER
    INTO covered_participant_count
  FROM "ProjectCloseDistributionLine" l
  WHERE l."distributionId" = target_id;
  IF covered_participant_count IS DISTINCT FROM effective_participant_count THEN
    RAISE EXCEPTION 'POL-109 distribution must cover every company effective at projection cutoff' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ProjectCloseDistribution_validate_total"
  AFTER INSERT ON "ProjectCloseDistribution"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_distribution"();
CREATE CONSTRAINT TRIGGER "ProjectCloseDistributionLine_validate_total"
  AFTER INSERT ON "ProjectCloseDistributionLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_distribution"();

CREATE FUNCTION "pol109_validate_profit_authorization"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  line_row "ProjectCloseDistributionLine"%ROWTYPE;
  distribution_row "ProjectCloseDistribution"%ROWTYPE;
  temporary_row "ProjectTemporaryProfitDistribution"%ROWTYPE;
BEGIN
  IF NEW."authorizationKind" = 'temporary' THEN
    SELECT * INTO temporary_row FROM "ProjectTemporaryProfitDistribution" WHERE "id" = NEW."temporaryDistributionId";
    IF temporary_row."projectId" IS DISTINCT FROM NEW."projectId"
       OR temporary_row."companyEntityId" IS DISTINCT FROM NEW."companyEntityId"
       OR temporary_row."amountCents" IS DISTINCT FROM NEW."authorizedAmountCents"
       OR temporary_row."projectionFingerprint" IS DISTINCT FROM NEW."projectionFingerprint" THEN
      RAISE EXCEPTION 'POL-109 temporary authorization does not match its snapshot' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO line_row FROM "ProjectCloseDistributionLine" WHERE "id" = NEW."distributionLineId";
    SELECT * INTO distribution_row FROM "ProjectCloseDistribution" WHERE "id" = NEW."distributionId";
    IF line_row."distributionId" IS DISTINCT FROM NEW."distributionId"
       OR line_row."companyEntityId" IS DISTINCT FROM NEW."companyEntityId"
       OR NEW."authorizedAmountCents" IS DISTINCT FROM line_row."toReceiveCents"
       OR distribution_row."projectId" IS DISTINCT FROM NEW."projectId"
       OR distribution_row."projectionFingerprint" IS DISTINCT FROM NEW."projectionFingerprint" THEN
      RAISE EXCEPTION 'POL-109 profit authorization does not match its canonical company line' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProjectProfitDistributionAuthorization_validate"
  BEFORE INSERT ON "ProjectProfitDistributionAuthorization"
  FOR EACH ROW EXECUTE FUNCTION "pol109_validate_profit_authorization"();

ALTER TABLE "ProjectFundingAllocation"
  DROP CONSTRAINT "ProjectFundingAllocation_execution_type_check",
  ADD CONSTRAINT "ProjectFundingAllocation_execution_type_check" CHECK (
    "executionType" IN (
      'payment_execution', 'project_expense_execution',
      'spot_procurement_payment_execution', 'expense_claim_payment_execution',
      'employee_loan_disbursement', 'fund_execution', 'fund_movement'
    )
  );

CREATE FUNCTION "pol109_validate_profit_movement_lineage"(p_movement_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  movement_row "FundMovement"%ROWTYPE;
  authorization_row "ProjectProfitDistributionAuthorization"%ROWTYPE;
  leg_count BIGINT;
  invalid_leg_count BIGINT;
  missing_fact_count BIGINT;
  relationship_count BIGINT;
  allocation_amount BIGINT;
  consumed_amount BIGINT;
BEGIN
  SELECT * INTO movement_row FROM "FundMovement" WHERE "id" = p_movement_id;
  IF NOT FOUND OR movement_row."status" IS DISTINCT FROM 'confirmed' THEN RETURN; END IF;
  IF movement_row."kind" IS DISTINCT FROM 'profit_distribution_execution' THEN
    RAISE EXCEPTION 'POL-109 profit movement validator received another kind' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO authorization_row
  FROM "ProjectProfitDistributionAuthorization"
  WHERE "id" = movement_row."profitAuthorizationId";
  IF NOT FOUND
     OR authorization_row."projectId" IS DISTINCT FROM movement_row."sourceProjectId"
     OR movement_row."sourceProjectId" IS DISTINCT FROM movement_row."beneficiaryProjectId"
     OR authorization_row."companyEntityId" IS DISTINCT FROM movement_row."sourceCompanyEntityId"
     OR movement_row."sourceCompanyEntityId" IS DISTINCT FROM movement_row."beneficiaryCompanyEntityId"
     OR movement_row."paymentExecutionId" IS NOT NULL
     OR movement_row."projectFundUsedCents" IS DISTINCT FROM movement_row."paymentAmountCents"
     OR movement_row."companyAdvanceCents" IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'POL-109 profit movement authorization scope is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::BIGINT,
         count(*) FILTER (WHERE
           "projectId" IS DISTINCT FROM movement_row."sourceProjectId"
           OR "companyEntityId" IS DISTINCT FROM movement_row."sourceCompanyEntityId"
           OR "amountCents" IS DISTINCT FROM movement_row."paymentAmountCents"
           OR ("role" = 'source' AND "direction" IS DISTINCT FROM 'decrease')
           OR ("role" = 'beneficiary' AND "direction" IS DISTINCT FROM 'increase')
           OR "role" NOT IN ('source', 'beneficiary')
         )::BIGINT,
         count(*) FILTER (WHERE "operatingFactId" IS NULL)::BIGINT
  INTO leg_count, invalid_leg_count, missing_fact_count
  FROM "FundMovementLeg"
  WHERE "movementId" = p_movement_id;
  SELECT count(*)::BIGINT INTO relationship_count
  FROM "FundMovementRelationshipEntry" WHERE "movementId" = p_movement_id;
  SELECT COALESCE(sum("amountCents"), 0)
  INTO allocation_amount
  FROM "ProjectFundingAllocation"
  WHERE "projectId" = movement_row."sourceProjectId"
    AND "executionType" = 'fund_movement'
    AND "executionId" = movement_row."id"
    AND "direction" = 'debit';
  SELECT COALESCE(sum("paymentAmountCents"), 0)
  INTO consumed_amount
  FROM "FundMovement"
  WHERE "profitAuthorizationId" = authorization_row."id"
    AND "kind" = 'profit_distribution_execution'
    AND "status" = 'confirmed';
  IF leg_count <> 2 OR invalid_leg_count <> 0 OR missing_fact_count <> 0
     OR relationship_count <> 0
     OR allocation_amount IS DISTINCT FROM movement_row."projectFundUsedCents"
     OR consumed_amount > authorization_row."authorizedAmountCents" THEN
    RAISE EXCEPTION 'POL-109 profit movement confirmed lineage is invalid' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_fund_movement_lineage_deferred()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_movement_id TEXT;
  target_kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND TG_TABLE_NAME IN ('FundMovementLeg', 'FundMovementRelationshipEntry') THEN
    IF OLD."sourceSnapshot" IS DISTINCT FROM NEW."sourceSnapshot"
       AND OLD."sourceSnapshot"->>'authority' = 'fund_movement_draft'
       AND OLD."sourceSnapshot"->>'status' = 'pending_server_resolution'
       AND NEW."sourceSnapshot"->>'authority' = 'payment_execution_source' THEN
      PERFORM assert_fund_movement_snapshot_projection_confirmed(NEW."movementId");
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'FundMovement' THEN
    target_movement_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  ELSE
    target_movement_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."movementId" ELSE NEW."movementId" END;
  END IF;
  SELECT "kind" INTO target_kind FROM "FundMovement" WHERE "id" = target_movement_id;
  IF target_kind = 'profit_distribution_execution' THEN
    PERFORM "pol109_validate_profit_movement_lineage"(target_movement_id);
  ELSE
    PERFORM assert_fund_movement_lineage(target_movement_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE
  "ProjectCloseStageVersion", "ProjectCloseCommandReceipt",
  "ProjectCloseImpact", "ProjectTemporaryProfitDistribution",
  "ProjectCloseProfessionalAttestation", "ProjectCloseStageAttestationLink",
  "ProjectCloseProfitConfirmation", "ProjectCloseDistribution",
  "ProjectCloseDistributionLine", "ProjectProfitDistributionAuthorization"
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_immutable_history_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_stage_lineage"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_temporary_distribution"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_stage_completion"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_distribution"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_profit_authorization"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "pol109_validate_profit_movement_lineage"(TEXT) FROM PUBLIC;

COMMIT;
