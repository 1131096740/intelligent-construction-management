BEGIN;

ALTER TABLE "SettlementDraft"
  ADD COLUMN "governanceVersion" INTEGER,
  ADD COLUMN "fieldReviewerUserId" TEXT,
  ADD COLUMN "fieldReviewerRoleKey" TEXT;

ALTER TABLE "Settlement"
  ADD COLUMN "governanceVersion" INTEGER,
  ADD COLUMN "fieldReviewerUserId" TEXT,
  ADD COLUMN "fieldReviewerRoleKey" TEXT,
  ADD COLUMN "preparedByUserId" TEXT,
  ADD COLUMN "preparerSignatureFileId" TEXT,
  ADD COLUMN "preparerSignatureSha256" TEXT;

CREATE TABLE "SettlementSignedDocument" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT,
  "settlementDraftId" TEXT,
  "purpose" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "businessSnapshotToken" TEXT NOT NULL,
  "approvalActionSetHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "generationStatus" TEXT NOT NULL,
  "declarationSnapshot" JSONB,
  "declaredByUserId" TEXT,
  "declaredAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "uploadedByUserId" TEXT,
  "generatedByUserId" TEXT,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SettlementSignedDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementSignedDocument_settlementId_purpose_status_idx"
  ON "SettlementSignedDocument"("settlementId", "purpose", "status");
CREATE INDEX "SettlementSignedDocument_settlementDraftId_purpose_status_idx"
  ON "SettlementSignedDocument"("settlementDraftId", "purpose", "status");
CREATE INDEX "SettlementSignedDocument_fileId_idx"
  ON "SettlementSignedDocument"("fileId");
CREATE INDEX "SettlementSignedDocument_supersedesId_idx"
  ON "SettlementSignedDocument"("supersedesId");
CREATE UNIQUE INDEX "SettlementSignedDocument_active_settlement_revision_purpose_key"
  ON "SettlementSignedDocument"("settlementId", "sourceRevision", "purpose")
  WHERE "status" = 'active' AND "settlementId" IS NOT NULL;
CREATE UNIQUE INDEX "SettlementSignedDocument_active_draft_revision_purpose_key"
  ON "SettlementSignedDocument"("settlementDraftId", "sourceRevision", "purpose")
  WHERE "status" = 'active' AND "settlementDraftId" IS NOT NULL;

ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_governance_version_check"
  CHECK ("governanceVersion" IS NULL OR "governanceVersion" = 1) NOT VALID,
  ADD CONSTRAINT "SettlementDraft_field_reviewer_pair_check"
  CHECK (
    ("fieldReviewerUserId" IS NULL AND "fieldReviewerRoleKey" IS NULL)
    OR ("fieldReviewerUserId" IS NOT NULL AND "fieldReviewerRoleKey" IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT "SettlementDraft_field_reviewer_role_check"
  CHECK ("fieldReviewerRoleKey" IS NULL OR "fieldReviewerRoleKey" IN (
    'material_staff', 'engineering_foreman', 'engineering_tech'
  )) NOT VALID,
  ADD CONSTRAINT "SettlementDraft_field_reviewer_fk"
  FOREIGN KEY ("fieldReviewerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_governance_version_check"
  CHECK ("governanceVersion" IS NULL OR "governanceVersion" = 1) NOT VALID,
  ADD CONSTRAINT "Settlement_field_reviewer_pair_check"
  CHECK (
    ("fieldReviewerUserId" IS NULL AND "fieldReviewerRoleKey" IS NULL)
    OR ("fieldReviewerUserId" IS NOT NULL AND "fieldReviewerRoleKey" IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT "Settlement_field_reviewer_role_check"
  CHECK ("fieldReviewerRoleKey" IS NULL OR "fieldReviewerRoleKey" IN (
    'material_staff', 'engineering_foreman', 'engineering_tech'
  )) NOT VALID,
  ADD CONSTRAINT "Settlement_preparer_signature_pair_check"
  CHECK (
    ("preparerSignatureFileId" IS NULL AND "preparerSignatureSha256" IS NULL)
    OR ("preparerSignatureFileId" IS NOT NULL AND "preparerSignatureSha256" IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT "Settlement_preparer_signature_sha256_check"
  CHECK ("preparerSignatureSha256" IS NULL OR "preparerSignatureSha256" ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT "Settlement_field_reviewer_fk"
  FOREIGN KEY ("fieldReviewerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "Settlement_prepared_by_fk"
  FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "Settlement_preparer_signature_file_fk"
  FOREIGN KEY ("preparerSignatureFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SettlementSignedDocument"
  ADD CONSTRAINT "SettlementSignedDocument_settlement_fk"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_settlement_draft_fk"
  FOREIGN KEY ("settlementDraftId") REFERENCES "SettlementDraft"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_declared_by_fk"
  FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_uploaded_by_fk"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_generated_by_fk"
  FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementSignedDocument_supersedes_fk"
  FOREIGN KEY ("supersedesId") REFERENCES "SettlementSignedDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementSignedDocument"
  ADD CONSTRAINT "SettlementSignedDocument_parent_check"
  CHECK (
    ("settlementId" IS NOT NULL AND "settlementDraftId" IS NULL)
    OR ("settlementId" IS NULL AND "settlementDraftId" IS NOT NULL)
  ),
  ADD CONSTRAINT "SettlementSignedDocument_purpose_check"
  CHECK ("purpose" IN (
    'frozen_counterparty_copy', 'counterparty_signed_original', 'final_internal_signed_copy'
  )),
  ADD CONSTRAINT "SettlementSignedDocument_status_check"
  CHECK ("status" IN ('active', 'invalidated', 'superseded')),
  ADD CONSTRAINT "SettlementSignedDocument_generation_status_check"
  CHECK ("generationStatus" IN ('not_applicable', 'pending', 'generating', 'completed', 'failed')),
  ADD CONSTRAINT "SettlementSignedDocument_page_count_check"
  CHECK ("pageCount" > 0),
  ADD CONSTRAINT "SettlementSignedDocument_source_revision_check"
  CHECK ("sourceRevision" >= 1),
  ADD CONSTRAINT "SettlementSignedDocument_sha256_check"
  CHECK ("contentSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "SettlementSignedDocument_approval_action_set_hash_check"
  CHECK ("approvalActionSetHash" IS NULL OR "approvalActionSetHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "SettlementSignedDocument_business_snapshot_token_check"
  CHECK (NULLIF(BTRIM("businessSnapshotToken"), '') IS NOT NULL),
  ADD CONSTRAINT "SettlementSignedDocument_declaration_fields_check"
  CHECK (
    ("declarationSnapshot" IS NULL AND "declaredByUserId" IS NULL AND "declaredAt" IS NULL)
    OR ("declarationSnapshot" IS NOT NULL AND "declaredByUserId" IS NOT NULL AND "declaredAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "SettlementSignedDocument_actor_check"
  CHECK (
    ("uploadedByUserId" IS NOT NULL AND "generatedByUserId" IS NULL)
    OR ("uploadedByUserId" IS NULL AND "generatedByUserId" IS NOT NULL)
  ),
  ADD CONSTRAINT "SettlementSignedDocument_purpose_facts_check"
  CHECK (
    (
      "purpose" = 'frozen_counterparty_copy'
      AND "settlementDraftId" IS NOT NULL
      AND "settlementId" IS NULL
      AND "generationStatus" = 'completed'
      AND "generatedByUserId" IS NOT NULL
      AND "uploadedByUserId" IS NULL
      AND "declarationSnapshot" IS NULL
      AND "declaredByUserId" IS NULL
      AND "declaredAt" IS NULL
      AND "approvalActionSetHash" IS NULL
    )
    OR
    (
      "purpose" = 'counterparty_signed_original'
      AND "settlementDraftId" IS NOT NULL
      AND "settlementId" IS NULL
      AND "generationStatus" = 'not_applicable'
      AND "uploadedByUserId" IS NOT NULL
      AND "generatedByUserId" IS NULL
      AND "declarationSnapshot" IS NOT NULL
      AND "declaredByUserId" IS NOT NULL
      AND "declaredAt" IS NOT NULL
      AND "approvalActionSetHash" IS NULL
    )
    OR
    (
      "purpose" = 'final_internal_signed_copy'
      AND "settlementId" IS NOT NULL
      AND "settlementDraftId" IS NULL
      AND "generationStatus" = 'completed'
      AND "generatedByUserId" IS NOT NULL
      AND "uploadedByUserId" IS NULL
      AND "declarationSnapshot" IS NULL
      AND "declaredByUserId" IS NULL
      AND "declaredAt" IS NULL
      AND "approvalActionSetHash" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "SettlementSignedDocument_invalidation_fields_check"
  CHECK (
    ("status" = 'active' AND "invalidatedAt" IS NULL AND "invalidationReason" IS NULL)
    OR ("status" IN ('invalidated', 'superseded') AND "invalidatedAt" IS NOT NULL
      AND NULLIF(BTRIM("invalidationReason"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "SettlementSignedDocument_supersedes_not_self_check"
  CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id");

COMMIT;
