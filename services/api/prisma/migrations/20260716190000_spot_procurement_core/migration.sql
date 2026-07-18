CREATE TABLE "VatRateOption" (
  "id" TEXT NOT NULL,
  "rateValue" DECIMAL(9, 6) NOT NULL,
  "label" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VatRateOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VatRateOption_rate_nonnegative_check"
    CHECK ("rateValue" >= 0),
  CONSTRAINT "VatRateOption_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "VatRateOption_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurement" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "supplierPartyId" TEXT,
  "supplierKey" TEXT NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "applicantUserId" TEXT NOT NULL,
  "handlerUserId" TEXT NOT NULL,
  "currentVersionId" TEXT,
  "status" TEXT NOT NULL,
  "approvedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "actualCostCents" BIGINT,
  "closedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurement_amounts_nonnegative_check"
    CHECK (
      "approvedAmountCents" >= 0
      AND ("actualCostCents" IS NULL OR "actualCostCents" >= 0)
    ),
  CONSTRAINT "SpotProcurement_void_tuple_check"
    CHECK (
      (
        "voidedAt" IS NULL
        AND "voidedByUserId" IS NULL
        AND "voidReason" IS NULL
      )
      OR (
        "voidedAt" IS NOT NULL
        AND "voidedByUserId" IS NOT NULL
        AND "voidReason" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurement_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "SpotProcurement_supplierPartyId_fkey"
    FOREIGN KEY ("supplierPartyId") REFERENCES "BusinessParty"("id"),
  CONSTRAINT "SpotProcurement_applicantUserId_fkey"
    FOREIGN KEY ("applicantUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurement_handlerUserId_fkey"
    FOREIGN KEY ("handlerUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurement_voidedByUserId_fkey"
    FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementVersion" (
  "id" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "supplierPartyId" TEXT,
  "supplierKey" TEXT NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "handlerUserId" TEXT NOT NULL,
  "totalAmountCents" BIGINT NOT NULL,
  "changeReason" TEXT,
  "changeSummary" JSONB,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementVersion_versionNo_positive_check"
    CHECK ("versionNo" > 0),
  CONSTRAINT "SpotProcurementVersion_totalAmountCents_nonnegative_check"
    CHECK ("totalAmountCents" >= 0),
  CONSTRAINT "SpotProcurementVersion_procurementId_fkey"
    FOREIGN KEY ("procurementId") REFERENCES "SpotProcurement"("id"),
  CONSTRAINT "SpotProcurementVersion_supplierPartyId_fkey"
    FOREIGN KEY ("supplierPartyId") REFERENCES "BusinessParty"("id"),
  CONSTRAINT "SpotProcurementVersion_handlerUserId_fkey"
    FOREIGN KEY ("handlerUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementVersion_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "SpotProcurement_projectId_id_key"
  ON "SpotProcurement"("projectId", "id");
CREATE UNIQUE INDEX "SpotProcurementVersion_procurementId_id_key"
  ON "SpotProcurementVersion"("procurementId", "id");

CREATE TABLE "SpotProcurementLine" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "materialName" TEXT NOT NULL,
  "specification" TEXT,
  "unit" TEXT NOT NULL,
  "quantity" DECIMAL(24, 6) NOT NULL,
  "invoiceMode" TEXT NOT NULL,
  "invoiceType" TEXT,
  "vatRateOptionId" TEXT,
  "vatRateValueSnapshot" DECIMAL(9, 6),
  "vatRateLabelSnapshot" TEXT,
  "unitPrice" DECIMAL(24, 6) NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "usageLocation" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementLine_sortOrder_positive_check"
    CHECK ("sortOrder" > 0),
  CONSTRAINT "SpotProcurementLine_quantity_positive_check"
    CHECK ("quantity" > 0),
  CONSTRAINT "SpotProcurementLine_price_amount_nonnegative_check"
    CHECK ("unitPrice" >= 0 AND "amountCents" >= 0),
  CONSTRAINT "SpotProcurementLine_vatRateValueSnapshot_nonnegative_check"
    CHECK ("vatRateValueSnapshot" IS NULL OR "vatRateValueSnapshot" >= 0),
  CONSTRAINT "SpotProcurementLine_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "SpotProcurementVersion"("id"),
  CONSTRAINT "SpotProcurementLine_vatRateOptionId_fkey"
    FOREIGN KEY ("vatRateOptionId") REFERENCES "VatRateOption"("id")
);

CREATE TABLE "SpotProcurementAttachment" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementAttachment_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "SpotProcurementVersion"("id"),
  CONSTRAINT "SpotProcurementAttachment_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementAttachment_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPayment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "procurementId" TEXT NOT NULL,
  "procurementVersionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "settlementAmountCents" BIGINT NOT NULL DEFAULT 0,
  "supplierBalanceAmountCents" BIGINT NOT NULL DEFAULT 0,
  "companyPaymentAmountCents" BIGINT NOT NULL DEFAULT 0,
  "paidAmountCents" BIGINT NOT NULL DEFAULT 0,
  "executedSupplierBalanceAmountCents" BIGINT NOT NULL DEFAULT 0,
  "canceledAmountCents" BIGINT NOT NULL DEFAULT 0,
  "canceledCompanyPaymentAmountCents" BIGINT NOT NULL DEFAULT 0,
  "canceledSupplierBalanceAmountCents" BIGINT NOT NULL DEFAULT 0,
  "paymentPath" TEXT,
  "paymentMethod" TEXT,
  "payeePartyId" TEXT,
  "payeeUserId" TEXT,
  "payeeNameSnapshot" TEXT NOT NULL,
  "payeeAccountNameSnapshot" TEXT,
  "payeeBankNameSnapshot" TEXT,
  "payeeBankAccountSnapshot" TEXT,
  "expectedPaymentAt" TIMESTAMP(3),
  "paymentNote" TEXT,
  "supportingAttachmentFileId" TEXT,
  "merchantPaymentProofFileId" TEXT,
  "balanceOverrideReason" TEXT,
  "handlerUserId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedByUserId" TEXT,
  "invalidatedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotProcurementPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPayment_amounts_nonnegative_check"
    CHECK (
      "settlementAmountCents" >= 0
      AND "supplierBalanceAmountCents" >= 0
      AND "companyPaymentAmountCents" >= 0
      AND "paidAmountCents" >= 0
      AND "executedSupplierBalanceAmountCents" >= 0
      AND "canceledAmountCents" >= 0
      AND "canceledCompanyPaymentAmountCents" >= 0
      AND "canceledSupplierBalanceAmountCents" >= 0
    ),
  CONSTRAINT "SpotProcurementPayment_composition_check"
    CHECK (
      "settlementAmountCents" = "supplierBalanceAmountCents" + "companyPaymentAmountCents"
    ),
  CONSTRAINT "SpotProcurementPayment_canceled_composition_check"
    CHECK (
      "canceledAmountCents" = "canceledCompanyPaymentAmountCents" + "canceledSupplierBalanceAmountCents"
    ),
  CONSTRAINT "SpotProcurementPayment_company_execution_within_requested_check"
    CHECK (
      "paidAmountCents" + "canceledCompanyPaymentAmountCents" <= "companyPaymentAmountCents"
    ),
  CONSTRAINT "SpotProcurementPayment_balance_execution_within_requested_check"
    CHECK (
      "executedSupplierBalanceAmountCents" + "canceledSupplierBalanceAmountCents" <= "supplierBalanceAmountCents"
    ),
  CONSTRAINT "SpotProcurementPayment_cumulative_within_settlement_check"
    CHECK (
      "paidAmountCents" + "executedSupplierBalanceAmountCents" + "canceledAmountCents" <= "settlementAmountCents"
    ),
  CONSTRAINT "SpotProcurementPayment_invalidation_tuple_check"
    CHECK (
      (
        "invalidatedAt" IS NULL
        AND "invalidatedByUserId" IS NULL
        AND "invalidatedReason" IS NULL
      )
      OR (
        "invalidatedAt" IS NOT NULL
        AND "invalidatedByUserId" IS NOT NULL
        AND "invalidatedReason" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementPayment_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "SpotProcurementPayment_procurement_coordinates_fkey"
    FOREIGN KEY ("projectId", "procurementId")
    REFERENCES "SpotProcurement"("projectId", "id"),
  CONSTRAINT "SpotProcurementPayment_version_coordinates_fkey"
    FOREIGN KEY ("procurementId", "procurementVersionId")
    REFERENCES "SpotProcurementVersion"("procurementId", "id"),
  CONSTRAINT "SpotProcurementPayment_payeePartyId_fkey"
    FOREIGN KEY ("payeePartyId") REFERENCES "BusinessParty"("id"),
  CONSTRAINT "SpotProcurementPayment_payeeUserId_fkey"
    FOREIGN KEY ("payeeUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementPayment_supportingAttachmentFileId_fkey"
    FOREIGN KEY ("supportingAttachmentFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPayment_merchantPaymentProofFileId_fkey"
    FOREIGN KEY ("merchantPaymentProofFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPayment_handlerUserId_fkey"
    FOREIGN KEY ("handlerUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementPayment_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementPayment_invalidatedByUserId_fkey"
    FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SpotProcurementPaymentExecution" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "executedByUserId" TEXT NOT NULL,
  "voucherFileId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotProcurementPaymentExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotProcurementPaymentExecution_amountCents_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "SpotProcurementPaymentExecution_void_tuple_check"
    CHECK (
      (
        "voidedAt" IS NULL
        AND "voidedByUserId" IS NULL
        AND "voidReason" IS NULL
      )
      OR (
        "voidedAt" IS NOT NULL
        AND "voidedByUserId" IS NOT NULL
        AND "voidReason" IS NOT NULL
      )
    ),
  CONSTRAINT "SpotProcurementPaymentExecution_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SpotProcurementPaymentExecution_executedByUserId_fkey"
    FOREIGN KEY ("executedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SpotProcurementPaymentExecution_voucherFileId_fkey"
    FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "SpotProcurementPaymentExecution_voidedByUserId_fkey"
    FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SupplierBalanceAccount" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "supplierPartyId" TEXT,
  "supplierKey" TEXT NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "availableAmountCents" BIGINT NOT NULL DEFAULT 0,
  "reservedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierBalanceAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBalanceAccount_amounts_nonnegative_check"
    CHECK ("availableAmountCents" >= 0 AND "reservedAmountCents" >= 0),
  CONSTRAINT "SupplierBalanceAccount_reserved_within_available_check"
    CHECK ("reservedAmountCents" <= "availableAmountCents"),
  CONSTRAINT "SupplierBalanceAccount_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "SupplierBalanceAccount_supplierPartyId_fkey"
    FOREIGN KEY ("supplierPartyId") REFERENCES "BusinessParty"("id")
);

CREATE TABLE "SupplierBalanceReservation" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "reservedByUserId" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" TEXT,
  "releaseReason" TEXT,
  "executedAt" TIMESTAMP(3),
  "executedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierBalanceReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBalanceReservation_amountCents_positive_check"
    CHECK ("amountCents" > 0),
  CONSTRAINT "SupplierBalanceReservation_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "SupplierBalanceAccount"("id"),
  CONSTRAINT "SupplierBalanceReservation_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SupplierBalanceReservation_reservedByUserId_fkey"
    FOREIGN KEY ("reservedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SupplierBalanceReservation_releasedByUserId_fkey"
    FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "SupplierBalanceReservation_executedByUserId_fkey"
    FOREIGN KEY ("executedByUserId") REFERENCES "User"("id")
);

CREATE TABLE "SupplierBalanceEntry" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sequenceNo" BIGINT NOT NULL,
  "reservationId" TEXT,
  "paymentId" TEXT,
  "procurementId" TEXT,
  "entryType" TEXT NOT NULL,
  "availableDeltaCents" BIGINT NOT NULL,
  "reservedDeltaCents" BIGINT NOT NULL,
  "availableAmountAfterCents" BIGINT NOT NULL,
  "reservedAmountAfterCents" BIGINT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierBalanceEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBalanceEntry_sequenceNo_positive_check"
    CHECK ("sequenceNo" > 0),
  CONSTRAINT "SupplierBalanceEntry_delta_nonzero_check"
    CHECK ("availableDeltaCents" <> 0 OR "reservedDeltaCents" <> 0),
  CONSTRAINT "SupplierBalanceEntry_after_amounts_nonnegative_check"
    CHECK (
      "availableAmountAfterCents" >= 0
      AND "reservedAmountAfterCents" >= 0
    ),
  CONSTRAINT "SupplierBalanceEntry_reserved_after_within_available_check"
    CHECK ("reservedAmountAfterCents" <= "availableAmountAfterCents"),
  CONSTRAINT "SupplierBalanceEntry_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "SupplierBalanceAccount"("id"),
  CONSTRAINT "SupplierBalanceEntry_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "SupplierBalanceReservation"("id"),
  CONSTRAINT "SupplierBalanceEntry_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SpotProcurementPayment"("id"),
  CONSTRAINT "SupplierBalanceEntry_procurementId_fkey"
    FOREIGN KEY ("procurementId") REFERENCES "SpotProcurement"("id"),
  CONSTRAINT "SupplierBalanceEntry_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
);

CREATE UNIQUE INDEX "VatRateOption_rateValue_label_key"
  ON "VatRateOption"("rateValue", "label");
CREATE INDEX "VatRateOption_enabled_sortOrder_idx"
  ON "VatRateOption"("enabled", "sortOrder");

CREATE UNIQUE INDEX "SpotProcurement_code_key"
  ON "SpotProcurement"("code");
CREATE INDEX "SpotProcurement_projectId_status_idx"
  ON "SpotProcurement"("projectId", "status");
CREATE INDEX "SpotProcurement_projectId_supplierKey_idx"
  ON "SpotProcurement"("projectId", "supplierKey");

CREATE UNIQUE INDEX "SpotProcurementVersion_procurementId_versionNo_key"
  ON "SpotProcurementVersion"("procurementId", "versionNo");
CREATE INDEX "SpotProcurementVersion_procurementId_status_idx"
  ON "SpotProcurementVersion"("procurementId", "status");

CREATE UNIQUE INDEX "SpotProcurementLine_versionId_sortOrder_key"
  ON "SpotProcurementLine"("versionId", "sortOrder");
CREATE INDEX "SpotProcurementLine_versionId_idx"
  ON "SpotProcurementLine"("versionId");

CREATE UNIQUE INDEX "SpotProcurementAttachment_versionId_fileId_key"
  ON "SpotProcurementAttachment"("versionId", "fileId");
CREATE INDEX "SpotProcurementAttachment_fileId_idx"
  ON "SpotProcurementAttachment"("fileId");

CREATE UNIQUE INDEX "SpotProcurementPayment_code_key"
  ON "SpotProcurementPayment"("code");
CREATE INDEX "SpotProcurementPayment_projectId_status_idx"
  ON "SpotProcurementPayment"("projectId", "status");
CREATE INDEX "SpotProcurementPayment_procurementId_status_idx"
  ON "SpotProcurementPayment"("procurementId", "status");
CREATE INDEX "SpotProcurementPayment_procurementVersionId_idx"
  ON "SpotProcurementPayment"("procurementVersionId");
CREATE INDEX "SpotProcurementPayment_supportingAttachmentFileId_idx"
  ON "SpotProcurementPayment"("supportingAttachmentFileId");
CREATE INDEX "SpotProcurementPayment_merchantPaymentProofFileId_idx"
  ON "SpotProcurementPayment"("merchantPaymentProofFileId");

CREATE UNIQUE INDEX "SpotProcurementPaymentExecution_idempotencyKey_key"
  ON "SpotProcurementPaymentExecution"("idempotencyKey");
CREATE UNIQUE INDEX "SpotProcurementPaymentExecution_active_voucherFileId_key"
  ON "SpotProcurementPaymentExecution"("voucherFileId")
  WHERE "voidedAt" IS NULL;
CREATE INDEX "SpotProcurementPaymentExecution_paymentId_idx"
  ON "SpotProcurementPaymentExecution"("paymentId");
CREATE INDEX "SpotProcurementPaymentExecution_voucherFileId_idx"
  ON "SpotProcurementPaymentExecution"("voucherFileId");

CREATE UNIQUE INDEX "SupplierBalanceAccount_projectId_supplierKey_key"
  ON "SupplierBalanceAccount"("projectId", "supplierKey");
CREATE INDEX "SupplierBalanceAccount_supplierPartyId_idx"
  ON "SupplierBalanceAccount"("supplierPartyId");

CREATE UNIQUE INDEX "SupplierBalanceReservation_paymentId_key"
  ON "SupplierBalanceReservation"("paymentId");
CREATE INDEX "SupplierBalanceReservation_accountId_status_idx"
  ON "SupplierBalanceReservation"("accountId", "status");

CREATE UNIQUE INDEX "SupplierBalanceEntry_accountId_sequenceNo_key"
  ON "SupplierBalanceEntry"("accountId", "sequenceNo");
CREATE INDEX "SupplierBalanceEntry_accountId_createdAt_idx"
  ON "SupplierBalanceEntry"("accountId", "createdAt");
CREATE INDEX "SupplierBalanceEntry_reservationId_idx"
  ON "SupplierBalanceEntry"("reservationId");
CREATE INDEX "SupplierBalanceEntry_paymentId_idx"
  ON "SupplierBalanceEntry"("paymentId");
CREATE INDEX "SupplierBalanceEntry_procurementId_idx"
  ON "SupplierBalanceEntry"("procurementId");

ALTER TABLE "SpotProcurement"
  ADD CONSTRAINT "SpotProcurement_currentVersion_coordinates_fkey"
  FOREIGN KEY ("id", "currentVersionId")
  REFERENCES "SpotProcurementVersion"("procurementId", "id");
