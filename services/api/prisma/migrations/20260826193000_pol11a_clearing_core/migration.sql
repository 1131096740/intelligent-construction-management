-- POL-11A clearing core. Artifact only; production application requires a separate authorization gate.
ALTER TABLE "ApprovalDelegation"
  ADD COLUMN "actionKey" TEXT,
  ADD COLUMN "resourceType" TEXT,
  ADD COLUMN "resourceId" TEXT,
  ADD CONSTRAINT "ApprovalDelegation_scope_all_or_none" CHECK (
    ("actionKey" IS NULL AND "resourceType" IS NULL AND "resourceId" IS NULL)
    OR
    ("actionKey" IS NOT NULL AND "resourceType" IS NOT NULL AND "resourceId" IS NOT NULL)
  );

CREATE INDEX "ApprovalDelegation_scoped_lookup_idx"
  ON "ApprovalDelegation"("toUserId", "actionKey", "resourceType", "resourceId", "enabled", "startsAt", "endsAt");

CREATE TABLE "ClearingCase" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "constructionEnterpriseAssignmentId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "governedSubjectKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "authoritativeGrossCapCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClearingCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingEvent" (
  "id" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "workflowStatus" TEXT NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClearingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingEventVersion" (
  "id" TEXT NOT NULL,
  "clearingEventId" TEXT NOT NULL,
  "clearingCaseId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "workflowStatus" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "payableRef" TEXT,
  "evidenceLevel" TEXT NOT NULL,
  "payloadSnapshot" JSONB NOT NULL,
  "actorSetSnapshot" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "previousVersionId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingEventVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingConfirmation" (
  "id" TEXT NOT NULL,
  "eventVersionId" TEXT NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  "confirmerActorSetSnapshot" JSONB NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingEvidenceAttestation" (
  "id" TEXT NOT NULL,
  "eventVersionId" TEXT NOT NULL,
  "attestedByUserId" TEXT NOT NULL,
  "attesterActorSetSnapshot" JSONB NOT NULL,
  "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingEvidenceAttestation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingAllocation" (
  "id" TEXT NOT NULL,
  "eventVersionId" TEXT NOT NULL,
  "sourceEventVersionId" TEXT,
  "sourceKind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "sourceRemainingAfterCents" BIGINT NOT NULL,
  "reversesAllocationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingImpactLink" (
  "id" TEXT NOT NULL,
  "eventVersionId" TEXT NOT NULL,
  "operatingFactId" TEXT NOT NULL,
  "operatingImpactId" TEXT NOT NULL,
  "sourceImpactKey" TEXT NOT NULL,
  "reversesImpactId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingImpactLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClearingCommandReceipt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "delegatorUserId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClearingCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClearingCase_natural_key" ON "ClearingCase"("projectId", "constructionEnterpriseAssignmentId", "category", "governedSubjectKey");
CREATE INDEX "ClearingCase_projectId_status_updatedAt_idx" ON "ClearingCase"("projectId", "status", "updatedAt");
CREATE INDEX "ClearingCase_constructionEnterpriseAssignmentId_idx" ON "ClearingCase"("constructionEnterpriseAssignmentId");
CREATE INDEX "ClearingEvent_clearingCaseId_workflowStatus_createdAt_idx" ON "ClearingEvent"("clearingCaseId", "workflowStatus", "createdAt");
CREATE INDEX "ClearingEvent_clearingCaseId_kind_idx" ON "ClearingEvent"("clearingCaseId", "kind");
CREATE UNIQUE INDEX "ClearingEventVersion_clearingEventId_versionNo_key" ON "ClearingEventVersion"("clearingEventId", "versionNo");
CREATE INDEX "ClearingEventVersion_clearingCaseId_createdAt_idx" ON "ClearingEventVersion"("clearingCaseId", "createdAt");
CREATE INDEX "ClearingEventVersion_previousVersionId_idx" ON "ClearingEventVersion"("previousVersionId");
CREATE UNIQUE INDEX "ClearingConfirmation_eventVersionId_key" ON "ClearingConfirmation"("eventVersionId");
CREATE UNIQUE INDEX "ClearingEvidenceAttestation_eventVersionId_key" ON "ClearingEvidenceAttestation"("eventVersionId");
CREATE INDEX "ClearingAllocation_eventVersionId_idx" ON "ClearingAllocation"("eventVersionId");
CREATE INDEX "ClearingAllocation_sourceEventVersionId_idx" ON "ClearingAllocation"("sourceEventVersionId");
CREATE INDEX "ClearingAllocation_reversesAllocationId_idx" ON "ClearingAllocation"("reversesAllocationId");
CREATE UNIQUE INDEX "ClearingImpactLink_eventVersionId_sourceImpactKey_key" ON "ClearingImpactLink"("eventVersionId", "sourceImpactKey");
CREATE INDEX "ClearingImpactLink_operatingFactId_idx" ON "ClearingImpactLink"("operatingFactId");
CREATE INDEX "ClearingImpactLink_operatingImpactId_idx" ON "ClearingImpactLink"("operatingImpactId");
CREATE INDEX "ClearingImpactLink_reversesImpactId_idx" ON "ClearingImpactLink"("reversesImpactId");
CREATE UNIQUE INDEX "ClearingCommandReceipt_idempotencyKey_key" ON "ClearingCommandReceipt"("idempotencyKey");
CREATE INDEX "ClearingCommandReceipt_aggregateId_action_createdAt_idx" ON "ClearingCommandReceipt"("aggregateId", "action", "createdAt");

ALTER TABLE "ClearingEvent" ADD CONSTRAINT "ClearingEvent_clearingCaseId_fkey" FOREIGN KEY ("clearingCaseId") REFERENCES "ClearingCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingEventVersion" ADD CONSTRAINT "ClearingEventVersion_clearingEventId_fkey" FOREIGN KEY ("clearingEventId") REFERENCES "ClearingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingEventVersion" ADD CONSTRAINT "ClearingEventVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingConfirmation" ADD CONSTRAINT "ClearingConfirmation_eventVersionId_fkey" FOREIGN KEY ("eventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingEvidenceAttestation" ADD CONSTRAINT "ClearingEvidenceAttestation_eventVersionId_fkey" FOREIGN KEY ("eventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingAllocation" ADD CONSTRAINT "ClearingAllocation_eventVersionId_fkey" FOREIGN KEY ("eventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingAllocation" ADD CONSTRAINT "ClearingAllocation_sourceEventVersionId_fkey" FOREIGN KEY ("sourceEventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingAllocation" ADD CONSTRAINT "ClearingAllocation_reversesAllocationId_fkey" FOREIGN KEY ("reversesAllocationId") REFERENCES "ClearingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingImpactLink" ADD CONSTRAINT "ClearingImpactLink_eventVersionId_fkey" FOREIGN KEY ("eventVersionId") REFERENCES "ClearingEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingImpactLink" ADD CONSTRAINT "ClearingImpactLink_operatingFactId_fkey" FOREIGN KEY ("operatingFactId") REFERENCES "OperatingFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingImpactLink" ADD CONSTRAINT "ClearingImpactLink_operatingImpactId_fkey" FOREIGN KEY ("operatingImpactId") REFERENCES "OperatingImpactEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClearingImpactLink" ADD CONSTRAINT "ClearingImpactLink_reversesImpactId_fkey" FOREIGN KEY ("reversesImpactId") REFERENCES "ClearingImpactLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Submitted/confirmed version history and its economic evidence are append-only.
CREATE OR REPLACE FUNCTION "prevent_clearing_immutable_row_change"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clearing immutable rows cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClearingEventVersion_immutable"
BEFORE UPDATE OR DELETE ON "ClearingEventVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
CREATE TRIGGER "ClearingEvidenceAttestation_immutable"
BEFORE UPDATE OR DELETE ON "ClearingEvidenceAttestation"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
CREATE TRIGGER "ClearingConfirmation_immutable"
BEFORE UPDATE OR DELETE ON "ClearingConfirmation"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
CREATE TRIGGER "ClearingAllocation_immutable"
BEFORE UPDATE OR DELETE ON "ClearingAllocation"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
CREATE TRIGGER "ClearingImpactLink_immutable"
BEFORE UPDATE OR DELETE ON "ClearingImpactLink"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
CREATE TRIGGER "ClearingCommandReceipt_immutable"
BEFORE UPDATE OR DELETE ON "ClearingCommandReceipt"
FOR EACH ROW EXECUTE FUNCTION "prevent_clearing_immutable_row_change"();
