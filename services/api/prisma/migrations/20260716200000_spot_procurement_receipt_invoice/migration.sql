-- Coordinate indexes are migration-owned because the existing Prisma models
-- intentionally keep their original Task 2 contract unchanged.
CREATE UNIQUE INDEX "SpotProcurementLine_versionId_id_key"
  ON "SpotProcurementLine"("versionId", "id");
CREATE UNIQUE INDEX "SpotProcurementPayment_procurementId_procurementVersionId_id_key"
  ON "SpotProcurementPayment"("procurementId", "procurementVersionId", "id");
CREATE UNIQUE INDEX "SupplierBalanceEntry_procurementId_id_key"
  ON "SupplierBalanceEntry"("procurementId", "id");

CREATE TABLE "SpotProcurementReceipt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "currentRevisionNo" INTEGER NOT NULL DEFAULT 1,
  "handlerUserId" TEXT NOT NULL,
  "note" TEXT,
  "actualCostCents" BIGINT NOT NULL DEFAULT 0,
  "firstSubmittedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "submittedByUserId" TEXT,
  "submissionDelegationId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceipt_status_check"
    CHECK (
      "status" IN (
        'draft',
        'submitted',
        'returned',
        'reviewed',
        'review_revoked',
        'locked'
      )
    ),
  CONSTRAINT "SpotProcurementReceipt_revision_positive_check"
    CHECK ("currentRevisionNo" > 0),
  CONSTRAINT "SpotProcurementReceipt_actual_cost_nonnegative_check"
    CHECK ("actualCostCents" >= 0),
  CONSTRAINT "SpotProcurementReceipt_submission_tuple_check"
    CHECK (
      (
        "submittedAt" IS NULL
        AND "submittedByUserId" IS NULL
      )
      OR (
        "submittedAt" IS NOT NULL
        AND "submittedByUserId" IS NOT NULL
        AND "firstSubmittedAt" IS NOT NULL
        AND "firstSubmittedAt" <= "submittedAt"
      )
    ),
  CONSTRAINT "SpotProcurementReceipt_lock_tuple_check"
    CHECK (
      (
        "status" = 'locked'
        AND "lockedAt" IS NOT NULL
      )
      OR (
        "status" <> 'locked'
        AND "lockedAt" IS NULL
      )
    ),
  CONSTRAINT "SpotProcurementReceipt_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "SpotProcurementReceipt_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "SpotProcurementReceipt_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "SpotProcurementReceipt_handlerUserId_fkey"
    FOREIGN KEY ("handlerUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceipt_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceipt_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurementReceipt_id_procurementId_key"
  ON "SpotProcurementReceipt"("id", "procurementId");

CREATE TABLE "SpotProcurementReceiptRevision" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "handlerUserId" TEXT NOT NULL,
  "note" TEXT,
  "actualCostCents" BIGINT NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "submittedByUserId" TEXT,
  "submissionDelegationId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementReceiptRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceiptRevision_revision_positive_check"
    CHECK ("revisionNo" > 0),
  CONSTRAINT "SpotProcurementReceiptRevision_actual_cost_nonnegative_check"
    CHECK ("actualCostCents" >= 0),
  CONSTRAINT "SpotProcurementReceiptRevision_submission_tuple_check"
    CHECK (
      (
        "submittedAt" IS NULL
        AND "submittedByUserId" IS NULL
        AND "submissionDelegationId" IS NULL
      )
      OR (
        "submittedAt" IS NOT NULL
        AND "submittedByUserId" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementReceiptRevision_receipt_procurement_coordinates_fkey"
    FOREIGN KEY ("receiptId", "procurementId")
    REFERENCES "SpotProcurementReceipt"("id", "procurementId"),
  CONSTRAINT "SpotProcurementReceiptRevision_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "SpotProcurementReceiptRevision_handlerUserId_fkey"
    FOREIGN KEY ("handlerUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceiptRevision_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceiptRevision_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurementReceiptRevision_receiptId_revisionNo_key"
  ON "SpotProcurementReceiptRevision"("receiptId", "revisionNo");
CREATE UNIQUE INDEX "SpotProcurementReceiptRevision_receipt_revision_procurement_version_key"
  ON "SpotProcurementReceiptRevision"(
    "receiptId",
    "revisionNo",
    "procurementId",
    "procurementVersionId"
  );

CREATE TABLE "SpotProcurementReceiptLine" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "procurementLineId" TEXT NOT NULL,
  "approvedQuantitySnapshot" DECIMAL(24, 6) NOT NULL,
  "qualifiedQuantity" DECIMAL(24, 6) NOT NULL,
  "unqualifiedQuantity" DECIMAL(24, 6) NOT NULL,
  "unqualifiedReason" TEXT,
  "freeGiftQuantity" DECIMAL(24, 6) NOT NULL,
  "replenishmentPending" BOOLEAN NOT NULL DEFAULT false,
  "discrepancyNote" TEXT,
  "actualCostCents" BIGINT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementReceiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceiptLine_revision_positive_check"
    CHECK ("receiptRevisionNo" > 0),
  CONSTRAINT "SpotProcurementReceiptLine_quantities_nonnegative_check"
    CHECK (
      "approvedQuantitySnapshot" >= 0
      AND "qualifiedQuantity" >= 0
      AND "unqualifiedQuantity" >= 0
      AND "freeGiftQuantity" >= 0
    ),
  CONSTRAINT "SpotProcurementReceiptLine_qualified_within_approved_check"
    CHECK ("qualifiedQuantity" <= "approvedQuantitySnapshot"),
  CONSTRAINT "SpotProcurementReceiptLine_unqualified_reason_check"
    CHECK (
      "unqualifiedQuantity" = 0
      OR (
        "unqualifiedReason" IS NOT NULL
        AND btrim("unqualifiedReason") <> ''
      )
    ),
  CONSTRAINT "SpotProcurementReceiptLine_actual_cost_nonnegative_check"
    CHECK ("actualCostCents" >= 0),
  CONSTRAINT "SpotProcurementReceiptLine_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "SpotProcurementReceiptLine_revision_coordinates_fkey"
    FOREIGN KEY (
      "receiptId",
      "receiptRevisionNo",
      "procurementId",
      "procurementVersionId"
    )
    REFERENCES "SpotProcurementReceiptRevision"(
      "receiptId",
      "revisionNo",
      "procurementId",
      "procurementVersionId"
    ),
  CONSTRAINT "SpotProcurementReceiptLine_procurement_line_coordinates_fkey"
    FOREIGN KEY ("procurementVersionId", "procurementLineId")
    REFERENCES "SpotProcurementLine"("versionId", "id"),
  CONSTRAINT "SpotProcurementReceiptLine_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementReceiptPhoto" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "originalFileId" TEXT NOT NULL,
  "watermarkedFileId" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "watermarkedSha256" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "serverRecordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "uploadedByUserId" TEXT NOT NULL,
  "lockedAtFirstSubmission" BOOLEAN NOT NULL DEFAULT false,
  "lockedAt" TIMESTAMP(3),
  "appendReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementReceiptPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceiptPhoto_revision_positive_check"
    CHECK ("receiptRevisionNo" > 0),
  CONSTRAINT "SpotProcurementReceiptPhoto_source_check"
    CHECK ("source" IN ('camera', 'album')),
  CONSTRAINT "SpotProcurementReceiptPhoto_category_check"
    CHECK ("category" IN ('material_scene', 'delivery_note')),
  CONSTRAINT "SpotProcurementReceiptPhoto_distinct_files_check"
    CHECK ("originalFileId" <> "watermarkedFileId"),
  CONSTRAINT "SpotProcurementReceiptPhoto_sha256_check"
    CHECK (
      "originalSha256" ~ '^[0-9A-Fa-f]{64}$'
      AND "watermarkedSha256" ~ '^[0-9A-Fa-f]{64}$'
      AND lower("originalSha256") <> lower("watermarkedSha256")
    ),
  CONSTRAINT "SpotProcurementReceiptPhoto_first_submission_lock_check"
    CHECK (
      NOT "lockedAtFirstSubmission"
      OR (
        "lockedAt" IS NOT NULL
        AND "appendReason" IS NULL
      )
    ),
  CONSTRAINT "SpotProcurementReceiptPhoto_supplement_lock_reason_check"
    CHECK (
      ("lockedAt" IS NULL AND "appendReason" IS NULL)
      OR "lockedAtFirstSubmission"
      OR (
        "lockedAt" IS NOT NULL
        AND
        "appendReason" IS NOT NULL
        AND btrim("appendReason") <> ''
      )
    ),
  CONSTRAINT "SpotProcurementReceiptPhoto_append_reason_check"
    CHECK ("appendReason" IS NULL OR btrim("appendReason") <> ''),
  CONSTRAINT "SpotProcurementReceiptPhoto_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "SpotProcurementReceiptPhoto_originalFileId_fkey"
    FOREIGN KEY ("originalFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementReceiptPhoto_watermarkedFileId_fkey"
    FOREIGN KEY ("watermarkedFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementReceiptPhoto_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementReceiptDelegation" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "delegatorUserId" TEXT NOT NULL,
  "delegateUserId" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'receipt_confirmation',
  "delegatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementReceiptDelegation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceiptDelegation_distinct_users_check"
    CHECK ("delegatorUserId" <> "delegateUserId"),
  CONSTRAINT "SpotProcurementReceiptDelegation_scope_check"
    CHECK ("scope" = 'receipt_confirmation'),
  CONSTRAINT "SpotProcurementReceiptDelegation_revocation_tuple_check"
    CHECK (
      (
        "revokedAt" IS NULL
        AND "revokedByUserId" IS NULL
        AND "revocationReason" IS NULL
      )
      OR (
        "revokedAt" IS NOT NULL
        AND "revokedByUserId" IS NOT NULL
        AND "revocationReason" IS NOT NULL
        AND btrim("revocationReason") <> ''
        AND "revokedAt" >= "delegatedAt"
      )
    ),
  CONSTRAINT "SpotProcurementReceiptDelegation_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "SpotProcurementReceiptDelegation_delegatorUserId_fkey"
    FOREIGN KEY ("delegatorUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceiptDelegation_delegateUserId_fkey"
    FOREIGN KEY ("delegateUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementReceiptDelegation_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementReceiptReview" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "comment" TEXT,
  "reviewedByUserId" TEXT NOT NULL,
  "submissionDelegationId" TEXT,
  "targetReviewId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementReceiptReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementReceiptReview_revision_sequence_positive_check"
    CHECK ("receiptRevisionNo" > 0 AND "sequenceNo" > 0),
  CONSTRAINT "SpotProcurementReceiptReview_decision_check"
    CHECK ("decision" IN ('approved', 'returned', 'revoked')),
  CONSTRAINT "SpotProcurementReceiptReview_reason_target_check"
    CHECK (
      (
        (
          "decision" = 'approved'
          AND "targetReviewId" IS NULL
        )
        OR (
          "decision" = 'returned'
          AND "targetReviewId" IS NULL
          AND "comment" IS NOT NULL
          AND btrim("comment") <> ''
        )
        OR (
          "decision" = 'revoked'
          AND "targetReviewId" IS NOT NULL
          AND "comment" IS NOT NULL
          AND btrim("comment") <> ''
        )
      )
      AND ("targetReviewId" IS NULL OR "targetReviewId" <> "id")
    ),
  CONSTRAINT "SpotProcurementReceiptReview_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "SpotProcurementReceiptReview_revision_coordinates_fkey"
    FOREIGN KEY (
      "receiptId",
      "receiptRevisionNo",
      "procurementId",
      "procurementVersionId"
    )
    REFERENCES "SpotProcurementReceiptRevision"(
      "receiptId",
      "revisionNo",
      "procurementId",
      "procurementVersionId"
    ),
  CONSTRAINT "SpotProcurementReceiptReview_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementDiscrepancy" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "receiptReviewId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_resolution',
  "approvedAmountCentsSnapshot" BIGINT NOT NULL,
  "actualCostCentsSnapshot" BIGINT NOT NULL,
  "shortageAmountCents" BIGINT NOT NULL,
  "canceledUnexecutedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "paidAmountCentsSnapshot" BIGINT NOT NULL,
  "supplierBalanceUsedAmountCentsSnapshot" BIGINT NOT NULL,
  "overpaidAmountCents" BIGINT NOT NULL,
  "resolutionType" TEXT,
  "supplierBalanceEntryId" TEXT,
  "note" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedByUserId" TEXT,
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementDiscrepancy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementDiscrepancy_revision_positive_check"
    CHECK ("receiptRevisionNo" > 0),
  CONSTRAINT "SpotProcurementDiscrepancy_status_check"
    CHECK (
      "status" IN (
        'pending_resolution',
        'awaiting_refund',
        'awaiting_supplier_balance',
        'resolved',
        'invalidated'
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_amounts_nonnegative_check"
    CHECK (
      "approvedAmountCentsSnapshot" >= 0
      AND "actualCostCentsSnapshot" >= 0
      AND "shortageAmountCents" >= 0
      AND "canceledUnexecutedAmountCents" >= 0
      AND "paidAmountCentsSnapshot" >= 0
      AND "supplierBalanceUsedAmountCentsSnapshot" >= 0
      AND "overpaidAmountCents" >= 0
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_shortage_check"
    CHECK (
      "actualCostCentsSnapshot" <= "approvedAmountCentsSnapshot"
      AND "shortageAmountCents" =
        "approvedAmountCentsSnapshot" - "actualCostCentsSnapshot"
      AND "canceledUnexecutedAmountCents" <= "shortageAmountCents"
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_overpaid_check"
    CHECK (
      "overpaidAmountCents" = GREATEST(
        "paidAmountCentsSnapshot"
          + "supplierBalanceUsedAmountCentsSnapshot"
          - "actualCostCentsSnapshot",
        0
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_resolution_type_check"
    CHECK (
      (
        "overpaidAmountCents" = 0
        AND "resolutionType" IS NULL
        AND "status" NOT IN ('awaiting_refund', 'awaiting_supplier_balance')
      )
      OR (
        "overpaidAmountCents" > 0
        AND (
          (
            "resolutionType" = 'full_refund'
            AND "status" IN ('awaiting_refund', 'resolved', 'invalidated')
          )
          OR (
            "resolutionType" = 'full_supplier_balance'
            AND "status" IN (
              'awaiting_supplier_balance',
              'resolved',
              'invalidated'
            )
          )
        )
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_resolved_tuple_check"
    CHECK (
      (
        "resolvedAt" IS NULL
        AND "resolvedByUserId" IS NULL
      )
      OR (
        "resolvedAt" IS NOT NULL
        AND "resolvedByUserId" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_invalidation_tuple_check"
    CHECK (
      (
        "status" <> 'invalidated'
        AND "invalidatedAt" IS NULL
        AND "invalidatedByUserId" IS NULL
        AND "invalidationReason" IS NULL
      )
      OR (
        "status" = 'invalidated'
        AND "invalidatedAt" IS NOT NULL
        AND "invalidatedByUserId" IS NOT NULL
        AND "invalidationReason" IS NOT NULL
        AND btrim("invalidationReason") <> ''
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_status_resolution_check"
    CHECK (
      (
        "status" IN ('pending_resolution', 'awaiting_refund', 'awaiting_supplier_balance')
        AND "resolvedAt" IS NULL
        AND "resolvedByUserId" IS NULL
      )
      OR (
        "status" = 'resolved'
        AND "resolvedAt" IS NOT NULL
        AND "resolvedByUserId" IS NOT NULL
      )
      OR "status" = 'invalidated'
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_balance_entry_check"
    CHECK (
      (
        "supplierBalanceEntryId" IS NULL
        OR "resolutionType" = 'full_supplier_balance'
      )
      AND (
        "status" <> 'resolved'
        OR "resolutionType" <> 'full_supplier_balance'
        OR "supplierBalanceEntryId" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementDiscrepancy_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "SpotProcurementDiscrepancy_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "SpotProcurementDiscrepancy_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "SpotProcurementDiscrepancy_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "SpotProcurementDiscrepancy_supplier_balance_coordinates_fkey"
    FOREIGN KEY ("procurementId", "supplierBalanceEntryId")
    REFERENCES "SupplierBalanceEntry"("procurementId", "id"),
  CONSTRAINT "SpotProcurementDiscrepancy_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementDiscrepancy_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementDiscrepancy_invalidatedByUserId_fkey"
    FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurementDiscrepancy_procurementId_id_key"
  ON "SpotProcurementDiscrepancy"("procurementId", "id");

CREATE TABLE "SpotProcurementRefund" (
  "id" TEXT NOT NULL,
  "discrepancyId" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "refundMethod" TEXT NOT NULL,
  "voucherFileId" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementRefund_amount_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "SpotProcurementRefund_method_check"
    CHECK (btrim("refundMethod") <> ''),
  CONSTRAINT "SpotProcurementRefund_discrepancy_coordinates_fkey"
    FOREIGN KEY ("procurementId", "discrepancyId")
    REFERENCES "SpotProcurementDiscrepancy"("procurementId", "id"),
  CONSTRAINT "SpotProcurementRefund_procurementId_fkey"
    FOREIGN KEY ("procurementId") REFERENCES "SpotProcurement"("id"),
  CONSTRAINT "SpotProcurementRefund_voucherFileId_fkey"
    FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementRefund_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "InvoiceRecord" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "invoiceType" TEXT NOT NULL,
  "invoiceCode" TEXT,
  "invoiceNumber" TEXT,
  "externalIdentifier" TEXT,
  "issueDate" DATE NOT NULL,
  "sellerName" TEXT NOT NULL,
  "buyerName" TEXT NOT NULL,
  "totalAmountCents" BIGINT NOT NULL,
  "allocatableAmountCents" BIGINT NOT NULL,
  "allocatedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "fileId" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "sourceBusinessType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceProcurementId" TEXT,
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedByUserId" TEXT,
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceRecord_invoice_type_check"
    CHECK ("invoiceType" IN ('vat_general', 'vat_special')),
  CONSTRAINT "InvoiceRecord_identity_fields_check"
    CHECK (
      btrim("identityKey") <> ''
      AND (
        ("invoiceCode" IS NOT NULL AND btrim("invoiceCode") <> '')
        OR ("invoiceNumber" IS NOT NULL AND btrim("invoiceNumber") <> '')
        OR (
          "externalIdentifier" IS NOT NULL
          AND btrim("externalIdentifier") <> ''
        )
      )
    ),
  CONSTRAINT "InvoiceRecord_required_text_check"
    CHECK (
      btrim("sellerName") <> ''
      AND btrim("buyerName") <> ''
      AND btrim("sourceBusinessType") <> ''
      AND btrim("sourceBusinessId") <> ''
    ),
  CONSTRAINT "InvoiceRecord_amounts_check"
    CHECK (
      "totalAmountCents" >= 0
      AND "allocatableAmountCents" >= 0
      AND "allocatedAmountCents" >= 0
      AND "allocatedAmountCents" <= "allocatableAmountCents"
      AND "allocatableAmountCents" <= "totalAmountCents"
    ),
  CONSTRAINT "InvoiceRecord_status_invalidation_check"
    CHECK (
      (
        "status" = 'active'
        AND "invalidatedAt" IS NULL
        AND "invalidatedByUserId" IS NULL
        AND "invalidationReason" IS NULL
      )
      OR (
        "status" = 'invalidated'
        AND "invalidatedAt" IS NOT NULL
        AND "invalidatedByUserId" IS NOT NULL
        AND "invalidationReason" IS NOT NULL
        AND btrim("invalidationReason") <> ''
      )
    ),
  CONSTRAINT "InvoiceRecord_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "InvoiceRecord_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "InvoiceRecord_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "InvoiceRecord_source_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "sourceProcurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "InvoiceRecord_invalidatedByUserId_fkey"
    FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "InvoiceRecord_projectId_id_key"
  ON "InvoiceRecord"("projectId", "id");

CREATE TABLE "InvoiceLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "invoiceRecordId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "description" TEXT,
  "vatRateOptionId" TEXT NOT NULL,
  "vatRateValueSnapshot" DECIMAL(9, 6) NOT NULL,
  "vatRateLabelSnapshot" TEXT NOT NULL,
  "taxInclusiveAmountCents" BIGINT NOT NULL,
  "allocatedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceLine_line_number_positive_check"
    CHECK ("lineNo" > 0),
  CONSTRAINT "InvoiceLine_rate_amounts_check"
    CHECK (
      "vatRateValueSnapshot" >= 0
      AND "taxInclusiveAmountCents" >= 0
      AND "allocatedAmountCents" >= 0
      AND "allocatedAmountCents" <= "taxInclusiveAmountCents"
    ),
  CONSTRAINT "InvoiceLine_rate_label_check"
    CHECK (btrim("vatRateLabelSnapshot") <> ''),
  CONSTRAINT "InvoiceLine_invoice_coordinates_fkey"
    FOREIGN KEY ("projectId", "invoiceRecordId")
    REFERENCES "InvoiceRecord"("projectId", "id"),
  CONSTRAINT "InvoiceLine_vatRateOptionId_fkey"
    FOREIGN KEY ("vatRateOptionId") REFERENCES "VatRateOption"("id")
);

CREATE UNIQUE INDEX "InvoiceLine_projectId_id_key"
  ON "InvoiceLine"("projectId", "id");

CREATE TABLE "InvoiceAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "invoiceLineId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "procurementLineId" TEXT NOT NULL,
  "paymentId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedByUserId" TEXT,
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceAllocation_revision_positive_check"
    CHECK ("receiptRevisionNo" > 0),
  CONSTRAINT "InvoiceAllocation_amount_nonnegative_check"
    CHECK ("amountCents" >= 0),
  CONSTRAINT "InvoiceAllocation_invalidation_tuple_check"
    CHECK (
      (
        "invalidatedAt" IS NULL
        AND "invalidatedByUserId" IS NULL
        AND "invalidationReason" IS NULL
      )
      OR (
        "invalidatedAt" IS NOT NULL
        AND "invalidatedByUserId" IS NOT NULL
        AND "invalidationReason" IS NOT NULL
        AND btrim("invalidationReason") <> ''
      )
    ),
  CONSTRAINT "InvoiceAllocation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "InvoiceAllocation_invoice_line_coordinates_fkey"
    FOREIGN KEY ("projectId", "invoiceLineId")
    REFERENCES "InvoiceLine"("projectId", "id"),
  CONSTRAINT "InvoiceAllocation_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "InvoiceAllocation_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "InvoiceAllocation_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "InvoiceAllocation_procurement_line_coordinates_fkey"
    FOREIGN KEY ("procurementVersionId", "procurementLineId")
    REFERENCES "SpotProcurementLine"("versionId", "id"),
  CONSTRAINT "InvoiceAllocation_payment_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId", "paymentId")
    REFERENCES "SpotProcurementPayment"(
      "procurementId",
      "procurementVersionId",
      "id"
    ),
  CONSTRAINT "InvoiceAllocation_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id"),
  CONSTRAINT "InvoiceAllocation_invalidatedByUserId_fkey"
    FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "NoInvoiceConfirmation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "procurementLineId" TEXT NOT NULL,
  "paymentId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "proofFileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewComment" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NoInvoiceConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoInvoiceConfirmation_revision_amount_check"
    CHECK ("receiptRevisionNo" > 0 AND "amountCents" >= 0),
  CONSTRAINT "NoInvoiceConfirmation_reason_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "NoInvoiceConfirmation_review_state_check"
    CHECK (
      (
        "status" = 'pending_review'
        AND "reviewedByUserId" IS NULL
        AND "reviewedAt" IS NULL
        AND "reviewComment" IS NULL
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'confirmed'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'returned'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reviewComment" IS NOT NULL
        AND btrim("reviewComment") <> ''
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'reversed'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reversedAt" IS NOT NULL
        AND "reversedByUserId" IS NOT NULL
        AND "reversalReason" IS NOT NULL
        AND btrim("reversalReason") <> ''
      )
    ),
  CONSTRAINT "NoInvoiceConfirmation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "NoInvoiceConfirmation_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "NoInvoiceConfirmation_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "NoInvoiceConfirmation_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "NoInvoiceConfirmation_procurement_line_coordinates_fkey"
    FOREIGN KEY ("procurementVersionId", "procurementLineId")
    REFERENCES "SpotProcurementLine"("versionId", "id"),
  CONSTRAINT "NoInvoiceConfirmation_payment_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId", "paymentId")
    REFERENCES "SpotProcurementPayment"(
      "procurementId",
      "procurementVersionId",
      "id"
    ),
  CONSTRAINT "NoInvoiceConfirmation_proofFileId_fkey"
    FOREIGN KEY ("proofFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "NoInvoiceConfirmation_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "NoInvoiceConfirmation_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "NoInvoiceConfirmation_reversedByUserId_fkey"
    FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "InvoiceExceptionConfirmation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receiptRevisionNo" INTEGER NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "procurementLineId" TEXT NOT NULL,
  "paymentId" TEXT,
  "invoiceLineId" TEXT,
  "expectedInvoiceType" TEXT NOT NULL,
  "expectedVatRateOptionId" TEXT NOT NULL,
  "expectedVatRateValueSnapshot" DECIMAL(9, 6) NOT NULL,
  "expectedVatRateLabelSnapshot" TEXT NOT NULL,
  "expectedUnitPriceSnapshot" DECIMAL(24, 6) NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "proofFileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewComment" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceExceptionConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_revision_amount_check"
    CHECK (
      "receiptRevisionNo" > 0
      AND "amountCents" >= 0
      AND "expectedVatRateValueSnapshot" >= 0
      AND "expectedUnitPriceSnapshot" >= 0
    ),
  CONSTRAINT "InvoiceExceptionConfirmation_expected_invoice_check"
    CHECK (
      "expectedInvoiceType" IN ('vat_general', 'vat_special')
      AND btrim("expectedVatRateLabelSnapshot") <> ''
      AND btrim("reason") <> ''
    ),
  CONSTRAINT "InvoiceExceptionConfirmation_review_state_check"
    CHECK (
      (
        "status" = 'pending_review'
        AND "reviewedByUserId" IS NULL
        AND "reviewedAt" IS NULL
        AND "reviewComment" IS NULL
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'confirmed'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'returned'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reviewComment" IS NOT NULL
        AND btrim("reviewComment") <> ''
        AND "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "status" = 'reversed'
        AND "reviewedByUserId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reversedAt" IS NOT NULL
        AND "reversedByUserId" IS NOT NULL
        AND "reversalReason" IS NOT NULL
        AND btrim("reversalReason") <> ''
      )
    ),
  CONSTRAINT "InvoiceExceptionConfirmation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "SpotProcurementReceipt"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "InvoiceExceptionConfirmation_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "InvoiceExceptionConfirmation_procurement_line_coordinates_fkey"
    FOREIGN KEY ("procurementVersionId", "procurementLineId")
    REFERENCES "SpotProcurementLine"("versionId", "id"),
  CONSTRAINT "InvoiceExceptionConfirmation_payment_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId", "paymentId")
    REFERENCES "SpotProcurementPayment"(
      "procurementId",
      "procurementVersionId",
      "id"
    ),
  CONSTRAINT "InvoiceExceptionConfirmation_invoice_line_coordinates_fkey"
    FOREIGN KEY ("projectId", "invoiceLineId")
    REFERENCES "InvoiceLine"("projectId", "id"),
  CONSTRAINT "InvoiceExceptionConfirmation_expectedVatRateOptionId_fkey"
    FOREIGN KEY ("expectedVatRateOptionId") REFERENCES "VatRateOption"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_proofFileId_fkey"
    FOREIGN KEY ("proofFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "InvoiceExceptionConfirmation_reversedByUserId_fkey"
    FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurementReceipt_procurementId_key"
  ON "SpotProcurementReceipt"("procurementId");
CREATE INDEX "SpotProcurementReceipt_projectId_status_idx"
  ON "SpotProcurementReceipt"("projectId", "status");
CREATE INDEX "SpotProcurementReceipt_procurementVersionId_status_idx"
  ON "SpotProcurementReceipt"("procurementVersionId", "status");
CREATE INDEX "SpotProcurementReceipt_handlerUserId_status_idx"
  ON "SpotProcurementReceipt"("handlerUserId", "status");
CREATE INDEX "SpotProcurementReceipt_submittedByUserId_idx"
  ON "SpotProcurementReceipt"("submittedByUserId");
CREATE INDEX "SpotProcurementReceipt_createdByUserId_idx"
  ON "SpotProcurementReceipt"("createdByUserId");
CREATE INDEX "SpotProcurementReceipt_submissionDelegationId_idx"
  ON "SpotProcurementReceipt"("submissionDelegationId");

CREATE INDEX "SpotProcurementReceiptRevision_procurementId_procurementVersionId_idx"
  ON "SpotProcurementReceiptRevision"("procurementId", "procurementVersionId");
CREATE INDEX "SpotProcurementReceiptRevision_handlerUserId_idx"
  ON "SpotProcurementReceiptRevision"("handlerUserId");
CREATE INDEX "SpotProcurementReceiptRevision_submittedByUserId_idx"
  ON "SpotProcurementReceiptRevision"("submittedByUserId");
CREATE INDEX "SpotProcurementReceiptRevision_submissionDelegationId_idx"
  ON "SpotProcurementReceiptRevision"("submissionDelegationId");
CREATE INDEX "SpotProcurementReceiptRevision_createdByUserId_idx"
  ON "SpotProcurementReceiptRevision"("createdByUserId");

CREATE UNIQUE INDEX "SpotProcurementReceiptLine_revision_procurement_version_line_key"
  ON "SpotProcurementReceiptLine"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  );
CREATE INDEX "SpotProcurementReceiptLine_procurementId_procurementVersionId_idx"
  ON "SpotProcurementReceiptLine"("procurementId", "procurementVersionId");
CREATE INDEX "SpotProcurementReceiptLine_procurementVersionId_procurementLineId_idx"
  ON "SpotProcurementReceiptLine"("procurementVersionId", "procurementLineId");
CREATE INDEX "SpotProcurementReceiptLine_receiptId_receiptRevisionNo_idx"
  ON "SpotProcurementReceiptLine"("receiptId", "receiptRevisionNo");
CREATE INDEX "SpotProcurementReceiptLine_createdByUserId_idx"
  ON "SpotProcurementReceiptLine"("createdByUserId");

CREATE UNIQUE INDEX "SpotProcurementReceiptPhoto_originalFileId_key"
  ON "SpotProcurementReceiptPhoto"("originalFileId");
CREATE UNIQUE INDEX "SpotProcurementReceiptPhoto_watermarkedFileId_key"
  ON "SpotProcurementReceiptPhoto"("watermarkedFileId");
CREATE INDEX "SpotProcurementReceiptPhoto_receiptId_category_createdAt_idx"
  ON "SpotProcurementReceiptPhoto"("receiptId", "category", "createdAt");
CREATE INDEX "SpotProcurementReceiptPhoto_uploadedByUserId_createdAt_idx"
  ON "SpotProcurementReceiptPhoto"("uploadedByUserId", "createdAt");

CREATE UNIQUE INDEX "SpotProcurementReceiptDelegation_receiptId_id_key"
  ON "SpotProcurementReceiptDelegation"("receiptId", "id");
CREATE UNIQUE INDEX "SpotProcurementReceiptDelegation_active_receiptId_key"
  ON "SpotProcurementReceiptDelegation"("receiptId")
  WHERE "revokedAt" IS NULL;
CREATE INDEX "SpotProcurementReceiptDelegation_receiptId_revokedAt_idx"
  ON "SpotProcurementReceiptDelegation"("receiptId", "revokedAt");
CREATE INDEX "SpotProcurementReceiptDelegation_delegateUserId_revokedAt_idx"
  ON "SpotProcurementReceiptDelegation"("delegateUserId", "revokedAt");
CREATE INDEX "SpotProcurementReceiptDelegation_delegatorUserId_idx"
  ON "SpotProcurementReceiptDelegation"("delegatorUserId");
CREATE INDEX "SpotProcurementReceiptDelegation_revokedByUserId_idx"
  ON "SpotProcurementReceiptDelegation"("revokedByUserId");

CREATE UNIQUE INDEX "SpotProcurementReceiptReview_receiptId_sequenceNo_key"
  ON "SpotProcurementReceiptReview"("receiptId", "sequenceNo");
CREATE UNIQUE INDEX "SpotProcurementReceiptReview_revision_procurement_version_id_key"
  ON "SpotProcurementReceiptReview"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "id"
  );
CREATE UNIQUE INDEX "SpotProcurementReceiptReview_receiptId_id_key"
  ON "SpotProcurementReceiptReview"("receiptId", "id");
CREATE UNIQUE INDEX "SpotProcurementReceiptReview_targetReviewId_key"
  ON "SpotProcurementReceiptReview"("targetReviewId");
CREATE INDEX "SpotProcurementReceiptReview_procurementId_procurementVersionId_idx"
  ON "SpotProcurementReceiptReview"("procurementId", "procurementVersionId");
CREATE INDEX "SpotProcurementReceiptReview_procurementVersionId_idx"
  ON "SpotProcurementReceiptReview"("procurementVersionId");
CREATE INDEX "SpotProcurementReceiptReview_reviewedByUserId_createdAt_idx"
  ON "SpotProcurementReceiptReview"("reviewedByUserId", "createdAt");
CREATE INDEX "SpotProcurementReceiptReview_submissionDelegationId_idx"
  ON "SpotProcurementReceiptReview"("submissionDelegationId");

CREATE UNIQUE INDEX "SpotProcurementDiscrepancy_supplierBalanceEntryId_key"
  ON "SpotProcurementDiscrepancy"("supplierBalanceEntryId");
CREATE UNIQUE INDEX "SpotProcurementDiscrepancy_active_receiptId_key"
  ON "SpotProcurementDiscrepancy"("receiptId")
  WHERE "invalidatedAt" IS NULL;
CREATE INDEX "SpotProcurementDiscrepancy_projectId_status_idx"
  ON "SpotProcurementDiscrepancy"("projectId", "status");
CREATE INDEX "SpotProcurementDiscrepancy_receiptId_status_idx"
  ON "SpotProcurementDiscrepancy"("receiptId", "status");
CREATE INDEX "SpotProcurementDiscrepancy_procurementId_status_idx"
  ON "SpotProcurementDiscrepancy"("procurementId", "status");
CREATE INDEX "SpotProcurementDiscrepancy_procurementVersionId_idx"
  ON "SpotProcurementDiscrepancy"("procurementVersionId");
CREATE INDEX "SpotProcurementDiscrepancy_receiptReviewId_idx"
  ON "SpotProcurementDiscrepancy"("receiptReviewId");
CREATE INDEX "SpotProcurementDiscrepancy_createdByUserId_idx"
  ON "SpotProcurementDiscrepancy"("createdByUserId");
CREATE INDEX "SpotProcurementDiscrepancy_resolvedByUserId_idx"
  ON "SpotProcurementDiscrepancy"("resolvedByUserId");
CREATE INDEX "SpotProcurementDiscrepancy_invalidatedByUserId_idx"
  ON "SpotProcurementDiscrepancy"("invalidatedByUserId");

CREATE UNIQUE INDEX "SpotProcurementRefund_discrepancyId_key"
  ON "SpotProcurementRefund"("discrepancyId");
CREATE UNIQUE INDEX "SpotProcurementRefund_voucherFileId_key"
  ON "SpotProcurementRefund"("voucherFileId");
CREATE UNIQUE INDEX "SpotProcurementRefund_idempotencyKey_key"
  ON "SpotProcurementRefund"("idempotencyKey");
CREATE INDEX "SpotProcurementRefund_procurementId_receivedAt_idx"
  ON "SpotProcurementRefund"("procurementId", "receivedAt");
CREATE INDEX "SpotProcurementRefund_recordedByUserId_createdAt_idx"
  ON "SpotProcurementRefund"("recordedByUserId", "createdAt");

CREATE UNIQUE INDEX "InvoiceRecord_identityKey_key"
  ON "InvoiceRecord"("identityKey");
CREATE UNIQUE INDEX "InvoiceRecord_fileId_key"
  ON "InvoiceRecord"("fileId");
CREATE INDEX "InvoiceRecord_projectId_status_idx"
  ON "InvoiceRecord"("projectId", "status");
CREATE INDEX "InvoiceRecord_sourceBusinessType_sourceBusinessId_idx"
  ON "InvoiceRecord"("sourceBusinessType", "sourceBusinessId");
CREATE INDEX "InvoiceRecord_sourceProcurementId_status_idx"
  ON "InvoiceRecord"("sourceProcurementId", "status");
CREATE INDEX "InvoiceRecord_uploadedByUserId_idx"
  ON "InvoiceRecord"("uploadedByUserId");
CREATE INDEX "InvoiceRecord_invalidatedByUserId_idx"
  ON "InvoiceRecord"("invalidatedByUserId");

CREATE UNIQUE INDEX "InvoiceLine_invoiceRecordId_lineNo_key"
  ON "InvoiceLine"("invoiceRecordId", "lineNo");
CREATE INDEX "InvoiceLine_projectId_invoiceRecordId_idx"
  ON "InvoiceLine"("projectId", "invoiceRecordId");
CREATE INDEX "InvoiceLine_vatRateOptionId_idx"
  ON "InvoiceLine"("vatRateOptionId");

CREATE INDEX "InvoiceAllocation_invoiceLineId_invalidatedAt_idx"
  ON "InvoiceAllocation"("invoiceLineId", "invalidatedAt");
CREATE INDEX "InvoiceAllocation_procurementLineId_invalidatedAt_idx"
  ON "InvoiceAllocation"("procurementLineId", "invalidatedAt");
CREATE INDEX "InvoiceAllocation_paymentId_invalidatedAt_idx"
  ON "InvoiceAllocation"("paymentId", "invalidatedAt");
CREATE INDEX "InvoiceAllocation_receiptId_receiptRevisionNo_idx"
  ON "InvoiceAllocation"("receiptId", "receiptRevisionNo");
CREATE INDEX "InvoiceAllocation_projectId_procurementId_idx"
  ON "InvoiceAllocation"("projectId", "procurementId");
CREATE INDEX "InvoiceAllocation_procurementId_procurementVersionId_paymentId_idx"
  ON "InvoiceAllocation"("procurementId", "procurementVersionId", "paymentId");
CREATE INDEX "InvoiceAllocation_procurementVersionId_procurementLineId_idx"
  ON "InvoiceAllocation"("procurementVersionId", "procurementLineId");
CREATE INDEX "InvoiceAllocation_createdByUserId_idx"
  ON "InvoiceAllocation"("createdByUserId");
CREATE INDEX "InvoiceAllocation_invalidatedByUserId_idx"
  ON "InvoiceAllocation"("invalidatedByUserId");
CREATE UNIQUE INDEX "InvoiceAllocation_active_without_payment_key"
  ON "InvoiceAllocation"("invoiceLineId", "procurementLineId")
  WHERE "invalidatedAt" IS NULL AND "paymentId" IS NULL;
CREATE UNIQUE INDEX "InvoiceAllocation_active_with_payment_key"
  ON "InvoiceAllocation"("invoiceLineId", "procurementLineId", "paymentId")
  WHERE "invalidatedAt" IS NULL AND "paymentId" IS NOT NULL;

CREATE INDEX "NoInvoiceConfirmation_procurementLineId_status_idx"
  ON "NoInvoiceConfirmation"("procurementLineId", "status");
CREATE INDEX "NoInvoiceConfirmation_receiptId_receiptRevisionNo_idx"
  ON "NoInvoiceConfirmation"("receiptId", "receiptRevisionNo");
CREATE INDEX "NoInvoiceConfirmation_paymentId_idx"
  ON "NoInvoiceConfirmation"("paymentId");
CREATE INDEX "NoInvoiceConfirmation_proofFileId_idx"
  ON "NoInvoiceConfirmation"("proofFileId");
CREATE INDEX "NoInvoiceConfirmation_projectId_procurementId_idx"
  ON "NoInvoiceConfirmation"("projectId", "procurementId");
CREATE INDEX "NoInvoiceConfirmation_procurementId_procurementVersionId_paymentId_idx"
  ON "NoInvoiceConfirmation"("procurementId", "procurementVersionId", "paymentId");
CREATE INDEX "NoInvoiceConfirmation_procurementVersionId_procurementLineId_idx"
  ON "NoInvoiceConfirmation"("procurementVersionId", "procurementLineId");
CREATE INDEX "NoInvoiceConfirmation_submittedByUserId_idx"
  ON "NoInvoiceConfirmation"("submittedByUserId");
CREATE INDEX "NoInvoiceConfirmation_reviewedByUserId_idx"
  ON "NoInvoiceConfirmation"("reviewedByUserId");
CREATE INDEX "NoInvoiceConfirmation_reversedByUserId_idx"
  ON "NoInvoiceConfirmation"("reversedByUserId");
CREATE UNIQUE INDEX "NoInvoiceConfirmation_current_procurementLineId_key"
  ON "NoInvoiceConfirmation"("procurementLineId")
  WHERE "status" IN ('pending_review', 'confirmed');

CREATE INDEX "InvoiceExceptionConfirmation_procurementLineId_status_idx"
  ON "InvoiceExceptionConfirmation"("procurementLineId", "status");
CREATE INDEX "InvoiceExceptionConfirmation_receiptId_receiptRevisionNo_idx"
  ON "InvoiceExceptionConfirmation"("receiptId", "receiptRevisionNo");
CREATE INDEX "InvoiceExceptionConfirmation_paymentId_idx"
  ON "InvoiceExceptionConfirmation"("paymentId");
CREATE INDEX "InvoiceExceptionConfirmation_invoiceLineId_idx"
  ON "InvoiceExceptionConfirmation"("invoiceLineId");
CREATE INDEX "InvoiceExceptionConfirmation_proofFileId_idx"
  ON "InvoiceExceptionConfirmation"("proofFileId");
CREATE INDEX "InvoiceExceptionConfirmation_projectId_procurementId_idx"
  ON "InvoiceExceptionConfirmation"("projectId", "procurementId");
CREATE INDEX "InvoiceExceptionConfirmation_procurementId_procurementVersionId_paymentId_idx"
  ON "InvoiceExceptionConfirmation"(
    "procurementId",
    "procurementVersionId",
    "paymentId"
  );
CREATE INDEX "InvoiceExceptionConfirmation_procurementVersionId_procurementLineId_idx"
  ON "InvoiceExceptionConfirmation"("procurementVersionId", "procurementLineId");
CREATE INDEX "InvoiceExceptionConfirmation_expectedVatRateOptionId_idx"
  ON "InvoiceExceptionConfirmation"("expectedVatRateOptionId");
CREATE INDEX "InvoiceExceptionConfirmation_submittedByUserId_idx"
  ON "InvoiceExceptionConfirmation"("submittedByUserId");
CREATE INDEX "InvoiceExceptionConfirmation_reviewedByUserId_idx"
  ON "InvoiceExceptionConfirmation"("reviewedByUserId");
CREATE INDEX "InvoiceExceptionConfirmation_reversedByUserId_idx"
  ON "InvoiceExceptionConfirmation"("reversedByUserId");
CREATE UNIQUE INDEX "InvoiceExceptionConfirmation_current_procurementLineId_key"
  ON "InvoiceExceptionConfirmation"("procurementLineId")
  WHERE "status" IN ('pending_review', 'confirmed');

ALTER TABLE "SpotProcurementReceipt"
  ADD CONSTRAINT "SpotProcurementReceipt_submissionDelegation_coordinates_fkey"
  FOREIGN KEY ("id", "submissionDelegationId")
  REFERENCES "SpotProcurementReceiptDelegation"("receiptId", "id");

ALTER TABLE "SpotProcurementReceipt"
  ADD CONSTRAINT "SpotProcurementReceipt_current_revision_coordinates_fkey"
  FOREIGN KEY (
    "id",
    "currentRevisionNo",
    "procurementId",
    "procurementVersionId"
  )
  REFERENCES "SpotProcurementReceiptRevision"(
    "receiptId",
    "revisionNo",
    "procurementId",
    "procurementVersionId"
  )
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "SpotProcurementReceiptRevision"
  ADD CONSTRAINT "SpotProcurementReceiptRevision_submissionDelegation_coordinates_fkey"
  FOREIGN KEY ("receiptId", "submissionDelegationId")
  REFERENCES "SpotProcurementReceiptDelegation"("receiptId", "id");

ALTER TABLE "SpotProcurementReceiptPhoto"
  ADD CONSTRAINT "SpotProcurementReceiptPhoto_revision_coordinates_fkey"
  FOREIGN KEY ("receiptId", "receiptRevisionNo")
  REFERENCES "SpotProcurementReceiptRevision"("receiptId", "revisionNo");

ALTER TABLE "SpotProcurementReceiptReview"
  ADD CONSTRAINT "SpotProcurementReceiptReview_submissionDelegation_coordinates_fkey"
  FOREIGN KEY ("receiptId", "submissionDelegationId")
  REFERENCES "SpotProcurementReceiptDelegation"("receiptId", "id");

ALTER TABLE "SpotProcurementReceiptReview"
  ADD CONSTRAINT "SpotProcurementReceiptReview_target_coordinates_fkey"
  FOREIGN KEY (
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "targetReviewId"
  )
  REFERENCES "SpotProcurementReceiptReview"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "id"
  );

ALTER TABLE "SpotProcurementDiscrepancy"
  ADD CONSTRAINT "SpotProcurementDiscrepancy_review_coordinates_fkey"
  FOREIGN KEY (
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "receiptReviewId"
  )
  REFERENCES "SpotProcurementReceiptReview"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "id"
  );

ALTER TABLE "InvoiceAllocation"
  ADD CONSTRAINT "InvoiceAllocation_receipt_line_coordinates_fkey"
  FOREIGN KEY (
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  )
  REFERENCES "SpotProcurementReceiptLine"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  );

ALTER TABLE "NoInvoiceConfirmation"
  ADD CONSTRAINT "NoInvoiceConfirmation_receipt_line_coordinates_fkey"
  FOREIGN KEY (
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  )
  REFERENCES "SpotProcurementReceiptLine"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  );

ALTER TABLE "InvoiceExceptionConfirmation"
  ADD CONSTRAINT "InvoiceExceptionConfirmation_receipt_line_coordinates_fkey"
  FOREIGN KEY (
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  )
  REFERENCES "SpotProcurementReceiptLine"(
    "receiptId",
    "receiptRevisionNo",
    "procurementId",
    "procurementVersionId",
    "procurementLineId"
  );
