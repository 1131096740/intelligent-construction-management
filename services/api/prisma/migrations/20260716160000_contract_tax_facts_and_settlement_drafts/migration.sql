BEGIN;

ALTER TABLE "ContractVersion"
  ADD COLUMN "invoiceType" TEXT,
  ADD COLUMN "taxMode" TEXT NOT NULL DEFAULT 'single_rate',
  ADD COLUMN "defaultTaxRatePercent" DECIMAL(9, 6),
  ADD COLUMN "taxFactStatus" TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN "taxFactSource" TEXT,
  ADD COLUMN "taxFactExplanation" TEXT,
  ADD COLUMN "taxFactEvidenceFileId" TEXT,
  ADD COLUMN "taxFactRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxFactsFrozenAt" TIMESTAMP(3);

ALTER TABLE "ContractBillRow"
  ADD COLUMN "taxRateSource" TEXT NOT NULL DEFAULT 'version_default',
  ADD COLUMN "pricingFactStatus" TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN "precisionPolicy" TEXT NOT NULL DEFAULT 'two_decimal',
  ALTER COLUMN "quantity" DROP NOT NULL,
  ALTER COLUMN "unitPrice" DROP NOT NULL,
  ALTER COLUMN "taxRate" DROP NOT NULL,
  ALTER COLUMN "taxInclusiveAmountCents" DROP NOT NULL,
  ALTER COLUMN "taxExclusiveAmountCents" DROP NOT NULL,
  ALTER COLUMN "taxAmountCents" DROP NOT NULL;

ALTER TABLE "Settlement"
  ADD COLUMN "invoiceTypeSnapshot" TEXT,
  ADD COLUMN "taxFactRevisionSnapshot" INTEGER;

ALTER TABLE "SettlementLine"
  ADD COLUMN "taxExclusiveAmountCents" BIGINT,
  ADD COLUMN "taxAmountCents" BIGINT;

CREATE TABLE "ContractTaxFactRevision" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "invoiceType" TEXT,
  "taxMode" TEXT,
  "defaultTaxRatePercent" DECIMAL(9, 6),
  "source" TEXT,
  "confirmationExplanation" TEXT,
  "evidenceFileId" TEXT,
  "rowFacts" JSONB NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "financeReviewedByUserId" TEXT,
  "financeReviewedAt" TIMESTAMP(3),
  "financeReviewComment" TEXT,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "contractReviewComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractTaxFactRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractTaxFactRevision_contractVersionId_revisionNo_key"
  ON "ContractTaxFactRevision"("contractVersionId", "revisionNo");
CREATE INDEX "ContractTaxFactRevision_projectId_status_idx"
  ON "ContractTaxFactRevision"("projectId", "status");
CREATE INDEX "ContractTaxFactRevision_contractVersionId_status_idx"
  ON "ContractTaxFactRevision"("contractVersionId", "status");
CREATE UNIQUE INDEX "ContractTaxFactRevision_one_in_progress_per_version_key"
  ON "ContractTaxFactRevision"("contractVersionId")
  WHERE "status" IN ('draft', 'pending_finance_review', 'pending_contract_confirmation');

CREATE TABLE "SettlementDraft" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "paymentTermsVersionId" TEXT NOT NULL,
  "settlementTemplateVersionId" TEXT,
  "code" TEXT NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "finalCumulativeAmountCents" BIGINT,
  "lines" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "ownerUserId" TEXT NOT NULL,
  "submittedSettlementId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SettlementDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementDraft_submittedSettlementId_key"
  ON "SettlementDraft"("submittedSettlementId");
CREATE INDEX "SettlementDraft_projectId_ownerUserId_status_updatedAt_idx"
  ON "SettlementDraft"("projectId", "ownerUserId", "status", "updatedAt");
CREATE INDEX "SettlementDraft_contractVersionId_status_idx"
  ON "SettlementDraft"("contractVersionId", "status");

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_tax_fact_evidence_file_fk"
  FOREIGN KEY ("taxFactEvidenceFileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_evidence_file_fk"
  FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") NOT VALID;

ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_project_fk"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_contract_fk"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_contract_version_fk"
  FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_payment_terms_version_fk"
  FOREIGN KEY ("paymentTermsVersionId") REFERENCES "PaymentTermsVersion"("id") NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_template_version_fk"
  FOREIGN KEY ("settlementTemplateVersionId") REFERENCES "SettlementTemplateVersion"("id") NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_submitted_settlement_fk"
  FOREIGN KEY ("submittedSettlementId") REFERENCES "Settlement"("id") NOT VALID;

WITH raw_facts AS (
  SELECT
    cv."id",
    cv."status",
    COALESCE(
      NULLIF(BTRIM(cv."draftData" #>> '{fieldValues,invoiceType}'), ''),
      NULLIF(BTRIM(cv."draftData" ->> 'invoiceType'), '')
    ) AS "rawInvoiceType",
    COALESCE(
      NULLIF(BTRIM(cv."draftData" #>> '{fieldValues,taxRatePercent}'), ''),
      NULLIF(BTRIM(cv."draftData" ->> 'taxRatePercent'), '')
    ) AS "rawTaxRate"
  FROM "ContractVersion" cv
  INNER JOIN "Contract" c ON c."id" = cv."contractId"
  WHERE c."source" <> 'historical_takeover'
    AND cv."changeType" <> 'historical_takeover'
),
eligible_facts AS (
  SELECT
    "id",
    CASE "rawInvoiceType"
      WHEN '增值税普通发票' THEN 'vat_general'
      WHEN '增值税专用发票' THEN 'vat_special'
    END AS "invoiceType",
    CAST("rawTaxRate" AS DECIMAL(9, 6)) AS "defaultTaxRatePercent",
    CASE
      WHEN "status" IN ('effective', 'superseded') THEN 'confirmed'
      WHEN "status" IN ('draft', 'approval_rejected') THEN 'draft'
      WHEN "status" IN (
        'in_approval',
        'approved_pending_seal',
        'in_seal',
        'seal_approved_pending_archive',
        'pending_archive_confirm'
      ) THEN 'frozen'
      ELSE 'unconfirmed'
    END AS "taxFactStatus"
  FROM raw_facts
  WHERE "rawInvoiceType" IN ('增值税普通发票', '增值税专用发票')
    AND "rawTaxRate" ~ '^[0-9]+([.][0-9]+)?$'
    AND CAST("rawTaxRate" AS DECIMAL) > 0
    AND CAST("rawTaxRate" AS DECIMAL) <= 100
)
UPDATE "ContractVersion" cv
SET
  "invoiceType" = eligible."invoiceType",
  "defaultTaxRatePercent" = eligible."defaultTaxRatePercent",
  "taxFactStatus" = eligible."taxFactStatus",
  "taxFactSource" = 'contract_document'
FROM eligible_facts eligible
WHERE eligible."id" = cv."id";

UPDATE "ContractBillRow"
SET
  "precisionPolicy" = 'legacy',
  "pricingFactStatus" = CASE
    WHEN "unitPrice" IS NOT NULL AND "taxRate" > 0 THEN 'confirmed'
    ELSE 'unconfirmed'
  END;

ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_invoice_type_check"
  CHECK ("invoiceType" IS NULL OR "invoiceType" IN ('vat_general', 'vat_special')) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_tax_mode_check"
  CHECK ("taxMode" IN ('single_rate', 'multiple_rate')) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_tax_fact_status_check"
  CHECK (
    "taxFactStatus" IN (
      'unconfirmed',
      'draft',
      'frozen',
      'pending_finance_review',
      'pending_contract_confirmation',
      'confirmed'
    )
  ) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_default_tax_rate_check"
  CHECK (
    "defaultTaxRatePercent" IS NULL
    OR ("defaultTaxRatePercent" > 0 AND "defaultTaxRatePercent" <= 100)
  ) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_tax_fact_source_check"
  CHECK (
    "taxFactSource" IS NULL
    OR "taxFactSource" IN (
      'contract_document',
      'supplement_evidence',
      'business_finance_confirmation'
    )
  ) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_tax_fact_revision_check"
  CHECK ("taxFactRevision" >= 0) NOT VALID;
ALTER TABLE "ContractVersion"
  ADD CONSTRAINT "ContractVersion_confirmed_tax_facts_check"
  CHECK (
    "taxFactStatus" <> 'confirmed'
    OR (
      "invoiceType" IS NOT NULL
      AND "defaultTaxRatePercent" IS NOT NULL
      AND "defaultTaxRatePercent" > 0
      AND "defaultTaxRatePercent" <= 100
    )
  ) NOT VALID;

ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_tax_rate_check"
  CHECK ("taxRate" IS NULL OR ("taxRate" > 0 AND "taxRate" <= 100)) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_tax_rate_source_check"
  CHECK ("taxRateSource" IN ('version_default', 'row_override')) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_pricing_fact_status_check"
  CHECK ("pricingFactStatus" IN ('unconfirmed', 'confirmed')) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_precision_policy_check"
  CHECK ("precisionPolicy" IN ('legacy', 'two_decimal')) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_confirmed_pricing_facts_check"
  CHECK (
    "pricingFactStatus" <> 'confirmed'
    OR (
      "unitPrice" IS NOT NULL
      AND "taxRate" IS NOT NULL
      AND "taxRate" > 0
      AND "taxRate" <= 100
    )
  ) NOT VALID;
ALTER TABLE "ContractBillRow"
  ADD CONSTRAINT "ContractBillRow_tax_amounts_check"
  CHECK (
    (
      "taxInclusiveAmountCents" IS NULL
      AND "taxExclusiveAmountCents" IS NULL
      AND "taxAmountCents" IS NULL
    )
    OR (
      "taxInclusiveAmountCents" IS NOT NULL
      AND "taxExclusiveAmountCents" IS NOT NULL
      AND "taxAmountCents" IS NOT NULL
      AND "taxInclusiveAmountCents" = "taxExclusiveAmountCents" + "taxAmountCents"
    )
  ) NOT VALID;

ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_revision_no_check"
  CHECK ("revisionNo" > 0) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_kind_check"
  CHECK ("kind" IN ('supplement', 'correction')) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_status_check"
  CHECK (
    "status" IN (
      'draft',
      'pending_finance_review',
      'pending_contract_confirmation',
      'confirmed',
      'rejected'
    )
  ) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_invoice_type_check"
  CHECK ("invoiceType" IS NULL OR "invoiceType" IN ('vat_general', 'vat_special')) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_tax_mode_check"
  CHECK ("taxMode" IS NULL OR "taxMode" IN ('single_rate', 'multiple_rate')) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_default_tax_rate_check"
  CHECK (
    "defaultTaxRatePercent" IS NULL
    OR ("defaultTaxRatePercent" > 0 AND "defaultTaxRatePercent" <= 100)
  ) NOT VALID;
ALTER TABLE "ContractTaxFactRevision"
  ADD CONSTRAINT "ContractTaxFactRevision_source_check"
  CHECK (
    "source" IS NULL
    OR "source" IN (
      'contract_document',
      'supplement_evidence',
      'business_finance_confirmation'
    )
  ) NOT VALID;

ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_status_check"
  CHECK ("status" IN ('draft', 'submitted')) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_revision_check"
  CHECK ("revision" >= 1) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_lines_array_check"
  CHECK (jsonb_typeof("lines") = 'array') NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_final_amount_check"
  CHECK (
    "finalCumulativeAmountCents" IS NULL
    OR ("isFinal" AND "finalCumulativeAmountCents" >= 0)
  ) NOT VALID;
ALTER TABLE "SettlementDraft"
  ADD CONSTRAINT "SettlementDraft_submission_state_check"
  CHECK (
    (
      "status" = 'draft'
      AND "submittedSettlementId" IS NULL
      AND "submittedAt" IS NULL
    )
    OR (
      "status" = 'submitted'
      AND "submittedSettlementId" IS NOT NULL
      AND "submittedAt" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_invoice_type_snapshot_check"
  CHECK (
    "invoiceTypeSnapshot" IS NULL
    OR "invoiceTypeSnapshot" IN ('vat_general', 'vat_special')
  ) NOT VALID;
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_tax_fact_revision_snapshot_check"
  CHECK ("taxFactRevisionSnapshot" IS NULL OR "taxFactRevisionSnapshot" >= 0) NOT VALID;

ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_tax_amounts_check"
  CHECK (
    (
      "taxExclusiveAmountCents" IS NULL
      AND "taxAmountCents" IS NULL
    )
    OR (
      "taxExclusiveAmountCents" IS NOT NULL
      AND "taxAmountCents" IS NOT NULL
      AND "amountCents" = "taxExclusiveAmountCents" + "taxAmountCents"
    )
  ) NOT VALID;

COMMIT;
