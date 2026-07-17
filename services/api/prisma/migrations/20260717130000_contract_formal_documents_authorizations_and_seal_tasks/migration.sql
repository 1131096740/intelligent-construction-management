BEGIN;

ALTER TABLE "ContractVersion"
  ADD COLUMN "contractGovernanceVersion" INTEGER;

ALTER TABLE "PdfDocument"
  ADD COLUMN "approvalInstanceId" TEXT;

CREATE TABLE "ContractFormalFile" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "supersedesId" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "declarationSnapshot" JSONB NOT NULL,
  "declaredByUserId" TEXT NOT NULL,
  "declaredAt" TIMESTAMP(3) NOT NULL,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractFormalFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractAuthorization" (
  "id" TEXT NOT NULL,
  "originContractVersionId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "grantorName" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "scopeSummary" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "supersedesId" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractVersionAuthorizationLink" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL,
  "authorizationId" TEXT,
  "reusedFromContractVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractVersionAuthorizationLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractSealTask" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "approvalInstanceId" TEXT NOT NULL,
  "handlerUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractSealTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalFormGenerationClaim" (
  "approvalInstanceId" TEXT NOT NULL,
  "claimToken" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL,
  "uploadedFileId" TEXT,
  "pdfDocumentId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "safeFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovalFormGenerationClaim_pkey" PRIMARY KEY ("approvalInstanceId")
);

CREATE UNIQUE INDEX "PdfDocument_approvalInstanceId_key" ON "PdfDocument"("approvalInstanceId");
CREATE INDEX "ContractFormalFile_contractVersionId_purpose_status_idx"
  ON "ContractFormalFile"("contractVersionId", "purpose", "status");
CREATE INDEX "ContractFormalFile_fileId_idx" ON "ContractFormalFile"("fileId");
CREATE INDEX "ContractFormalFile_supersedesId_idx" ON "ContractFormalFile"("supersedesId");
CREATE UNIQUE INDEX "ContractFormalFile_active_purpose_key"
  ON "ContractFormalFile"("contractVersionId", "purpose")
  WHERE "status" = 'active';
CREATE INDEX "ContractAuthorization_originContractVersionId_side_status_idx"
  ON "ContractAuthorization"("originContractVersionId", "side", "status");
CREATE INDEX "ContractAuthorization_fileId_idx" ON "ContractAuthorization"("fileId");
CREATE INDEX "ContractAuthorization_supersedesId_idx" ON "ContractAuthorization"("supersedesId");
CREATE UNIQUE INDEX "ContractAuthorization_active_origin_side_key"
  ON "ContractAuthorization"("originContractVersionId", "side")
  WHERE "status" = 'active';
CREATE UNIQUE INDEX "ContractVersionAuthorizationLink_contractVersionId_side_key"
  ON "ContractVersionAuthorizationLink"("contractVersionId", "side");
CREATE INDEX "ContractVersionAuthorizationLink_authorizationId_idx"
  ON "ContractVersionAuthorizationLink"("authorizationId");
CREATE INDEX "ContractVersionAuthorizationLink_reusedFromContractVersionId_idx"
  ON "ContractVersionAuthorizationLink"("reusedFromContractVersionId");
CREATE UNIQUE INDEX "ContractSealTask_approvalInstanceId_key"
  ON "ContractSealTask"("approvalInstanceId");
CREATE UNIQUE INDEX "ContractSealTask_active_contract_version_key"
  ON "ContractSealTask"("contractVersionId")
  WHERE "status" <> 'cancelled';
CREATE INDEX "ContractSealTask_status_handlerUserId_idx"
  ON "ContractSealTask"("status", "handlerUserId");
CREATE INDEX "ContractSealTask_contractVersionId_status_idx"
  ON "ContractSealTask"("contractVersionId", "status");
CREATE UNIQUE INDEX "ApprovalFormGenerationClaim_uploadedFileId_key"
  ON "ApprovalFormGenerationClaim"("uploadedFileId");
CREATE UNIQUE INDEX "ApprovalFormGenerationClaim_pdfDocumentId_key"
  ON "ApprovalFormGenerationClaim"("pdfDocumentId");
CREATE INDEX "ApprovalFormGenerationClaim_status_claimedAt_idx"
  ON "ApprovalFormGenerationClaim"("status", "claimedAt");

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_contract_governance_version_check"
  CHECK ("contractGovernanceVersion" IS NULL OR "contractGovernanceVersion" = 1) NOT VALID;

ALTER TABLE "PdfDocument"
  ADD CONSTRAINT "PdfDocument_approval_instance_fk"
  FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "ContractFormalFile"
  ADD CONSTRAINT "ContractFormalFile_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractFormalFile_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractFormalFile_uploaded_by_fk"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractFormalFile_declared_by_fk"
  FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractFormalFile_confirmed_by_fk"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractFormalFile_supersedes_fk"
  FOREIGN KEY ("supersedesId") REFERENCES "ContractFormalFile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractFormalFile"
  ADD CONSTRAINT "ContractFormalFile_purpose_check"
  CHECK ("purpose" IN ('approval_original', 'mutually_signed_final')),
  ADD CONSTRAINT "ContractFormalFile_status_check"
  CHECK ("status" IN ('active', 'invalidated', 'superseded')),
  ADD CONSTRAINT "ContractFormalFile_page_count_check"
  CHECK ("pageCount" > 0),
  ADD CONSTRAINT "ContractFormalFile_sha256_check"
  CHECK ("contentSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ContractFormalFile_source_revision_check"
  CHECK ("sourceRevision" >= 1),
  ADD CONSTRAINT "ContractFormalFile_supersedes_not_self_check"
  CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id"),
  ADD CONSTRAINT "ContractFormalFile_invalidation_fields_check"
  CHECK (
    ("status" = 'active' AND "invalidatedAt" IS NULL AND "invalidationReason" IS NULL)
    OR
    ("status" IN ('invalidated', 'superseded') AND "invalidatedAt" IS NOT NULL
      AND NULLIF(BTRIM("invalidationReason"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "ContractFormalFile_confirmation_fields_check"
  CHECK (
    ("confirmedByUserId" IS NULL AND "confirmedAt" IS NULL AND "confirmationSnapshot" IS NULL)
    OR
    ("confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmationSnapshot" IS NOT NULL)
  );

ALTER TABLE "ContractAuthorization"
  ADD CONSTRAINT "ContractAuthorization_origin_version_fk"
  FOREIGN KEY ("originContractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractAuthorization_file_fk"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractAuthorization_uploaded_by_fk"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractAuthorization_supersedes_fk"
  FOREIGN KEY ("supersedesId") REFERENCES "ContractAuthorization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractAuthorization"
  ADD CONSTRAINT "ContractAuthorization_side_check"
  CHECK ("side" IN ('first_party', 'counterparty')),
  ADD CONSTRAINT "ContractAuthorization_status_check"
  CHECK ("status" IN ('active', 'invalidated', 'superseded')),
  ADD CONSTRAINT "ContractAuthorization_nonblank_facts_check"
  CHECK (
    NULLIF(BTRIM("grantorName"), '') IS NOT NULL
    AND NULLIF(BTRIM("agentName"), '') IS NOT NULL
    AND NULLIF(BTRIM("scopeSummary"), '') IS NOT NULL
  ),
  ADD CONSTRAINT "ContractAuthorization_page_count_check"
  CHECK ("pageCount" > 0),
  ADD CONSTRAINT "ContractAuthorization_sha256_check"
  CHECK ("contentSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ContractAuthorization_supersedes_not_self_check"
  CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id"),
  ADD CONSTRAINT "ContractAuthorization_invalidation_fields_check"
  CHECK (
    ("status" = 'active' AND "invalidatedAt" IS NULL AND "invalidationReason" IS NULL)
    OR
    ("status" IN ('invalidated', 'superseded') AND "invalidatedAt" IS NOT NULL
      AND NULLIF(BTRIM("invalidationReason"), '') IS NOT NULL)
  );

ALTER TABLE "ContractVersionAuthorizationLink"
  ADD CONSTRAINT "ContractVersionAuthorizationLink_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractVersionAuthorizationLink_authorization_fk"
  FOREIGN KEY ("authorizationId") REFERENCES "ContractAuthorization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractVersionAuthorizationLink_reused_from_version_fk"
  FOREIGN KEY ("reusedFromContractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractVersionAuthorizationLink"
  ADD CONSTRAINT "ContractVersionAuthorizationLink_side_check"
  CHECK ("side" IN ('first_party', 'counterparty')),
  ADD CONSTRAINT "ContractVersionAuthorizationLink_required_pair_check"
  CHECK (
    ("required" = TRUE AND "authorizationId" IS NOT NULL)
    OR ("required" = FALSE AND "authorizationId" IS NULL)
  ),
  ADD CONSTRAINT "ContractVersionAuthorizationLink_reuse_not_self_check"
  CHECK ("reusedFromContractVersionId" IS NULL OR "reusedFromContractVersionId" <> "contractVersionId"),
  ADD CONSTRAINT "ContractVersionAuthorizationLink_reuse_requires_authorization_check"
  CHECK ("reusedFromContractVersionId" IS NULL OR "authorizationId" IS NOT NULL);

ALTER TABLE "ContractSealTask"
  ADD CONSTRAINT "ContractSealTask_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractSealTask_approval_instance_fk"
  FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractSealTask_handler_fk"
  FOREIGN KEY ("handlerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractSealTask_approved_by_fk"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractSealTask_completed_by_fk"
  FOREIGN KEY ("completedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractSealTask_cancelled_by_fk"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalFormGenerationClaim"
  ADD CONSTRAINT "ApprovalFormGenerationClaim_approval_instance_fk"
  FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalFormGenerationClaim_uploaded_file_fk"
  FOREIGN KEY ("uploadedFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalFormGenerationClaim_pdf_document_fk"
  FOREIGN KEY ("pdfDocumentId") REFERENCES "PdfDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalFormGenerationClaim"
  ADD CONSTRAINT "ApprovalFormGenerationClaim_status_check"
  CHECK ("status" IN ('pending', 'uploaded', 'completed', 'failed')),
  ADD CONSTRAINT "ApprovalFormGenerationClaim_attempt_count_check"
  CHECK ("attemptCount" >= 1),
  ADD CONSTRAINT "ApprovalFormGenerationClaim_failure_code_check"
  CHECK ("safeFailureCode" IS NULL OR "safeFailureCode" IN (
    'render_or_upload_failed', 'finalize_retry_required'
  )),
  ADD CONSTRAINT "ApprovalFormGenerationClaim_state_fields_check"
  CHECK (
    ("status" = 'pending' AND "uploadedFileId" IS NULL AND "pdfDocumentId" IS NULL)
    OR ("status" = 'uploaded' AND "uploadedFileId" IS NOT NULL AND "pdfDocumentId" IS NULL)
    OR ("status" = 'completed' AND "uploadedFileId" IS NOT NULL AND "pdfDocumentId" IS NOT NULL)
    OR ("status" = 'failed' AND "pdfDocumentId" IS NULL)
  );

ALTER TABLE "ContractSealTask"
  ADD CONSTRAINT "ContractSealTask_status_check"
  CHECK ("status" IN ('pending_approval', 'in_seal', 'completed', 'cancelled')),
  ADD CONSTRAINT "ContractSealTask_cancellation_reason_check"
  CHECK ("cancellationReason" IS NULL OR NULLIF(BTRIM("cancellationReason"), '') IS NOT NULL),
  ADD CONSTRAINT "ContractSealTask_state_fields_check"
  CHECK (
    (
      "status" = 'pending_approval'
      AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL
      AND "completedByUserId" IS NULL AND "completedAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL
    )
    OR (
      "status" = 'in_seal'
      AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "completedByUserId" IS NULL AND "completedAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "completedByUserId" IS NOT NULL AND "completedAt" IS NOT NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL
    )
    OR (
      "status" = 'cancelled'
      AND (("approvedByUserId" IS NULL AND "approvedAt" IS NULL)
        OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL))
      AND (("completedByUserId" IS NULL AND "completedAt" IS NULL)
        OR ("completedByUserId" IS NOT NULL AND "completedAt" IS NOT NULL))
      AND "cancelledByUserId" IS NOT NULL AND "cancelledAt" IS NOT NULL
      AND NULLIF(BTRIM("cancellationReason"), '') IS NOT NULL
    )
  );

COMMIT;
