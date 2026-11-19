-- Task02 field expansion and versioned CHECK compatibility. PREPARED / NOT EXECUTED.
BEGIN;
-- No backfill, rounding, UPDATE or change to an existing money/quantity column.
-- v1 rows retain original six-decimal source facts and integer-cent amounts.
ALTER TABLE "ContractVersion"
  ADD COLUMN "numericProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "amountYuan" NUMERIC(24,4),
  ADD CONSTRAINT "ContractVersion_numeric_protocol_check" CHECK ("numericProtocolVersion" IN (1,2)),
  ADD CONSTRAINT "ContractVersion_decimal_authority_check" CHECK ("numericProtocolVersion" = 2 OR "amountYuan" IS NULL),
  ADD CONSTRAINT "ContractVersion_decimal_finite_check" CHECK ("amountYuan" IS NULL OR "amountYuan" <> 'NaN'::numeric);

ALTER TABLE "ContractBill"
  ADD COLUMN "numericProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "taxInclusiveAmountYuan" NUMERIC(24,4),
  ADD COLUMN "taxExclusiveAmountYuan" NUMERIC(24,4),
  ADD COLUMN "taxAmountYuan" NUMERIC(24,4),
  ADD CONSTRAINT "ContractBill_numeric_protocol_check" CHECK ("numericProtocolVersion" IN (1,2)),
  ADD CONSTRAINT "ContractBill_decimal_authority_check" CHECK ("numericProtocolVersion" = 2 OR
    ("taxInclusiveAmountYuan" IS NULL AND "taxExclusiveAmountYuan" IS NULL AND "taxAmountYuan" IS NULL)),
  ADD CONSTRAINT "ContractBill_decimal_finite_check" CHECK (
    ("taxInclusiveAmountYuan" IS NULL OR "taxInclusiveAmountYuan" <> 'NaN'::numeric) AND
    ("taxExclusiveAmountYuan" IS NULL OR "taxExclusiveAmountYuan" <> 'NaN'::numeric) AND
    ("taxAmountYuan" IS NULL OR "taxAmountYuan" <> 'NaN'::numeric));

ALTER TABLE "ContractBillRow"
  ADD COLUMN "numericProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "numericSource" TEXT NOT NULL DEFAULT 'legacy_cents',
  ADD COLUMN "numericReviewStatus" TEXT NOT NULL DEFAULT 'not_assessed',
  ADD COLUMN "taxInclusiveAmountYuan" NUMERIC(24,4),
  ADD COLUMN "taxExclusiveAmountYuan" NUMERIC(24,4),
  ADD COLUMN "taxAmountYuan" NUMERIC(24,4),
  ADD CONSTRAINT "ContractBillRow_numeric_protocol_check" CHECK ("numericProtocolVersion" IN (1,2)),
  ADD CONSTRAINT "ContractBillRow_decimal_authority_check" CHECK ("numericProtocolVersion" = 2 OR
    ("taxInclusiveAmountYuan" IS NULL AND "taxExclusiveAmountYuan" IS NULL AND "taxAmountYuan" IS NULL)),
  ADD CONSTRAINT "ContractBillRow_numeric_source_check" CHECK ("numericSource" IN ('legacy_cents','decimal_input')),
  ADD CONSTRAINT "ContractBillRow_numeric_review_check" CHECK ("numericReviewStatus" IN ('not_assessed','verified','review_required')),
  ADD CONSTRAINT "ContractBillRow_decimal_input_scale_check" CHECK (
    "numericProtocolVersion" <> 2 OR "numericSource" <> 'decimal_input' OR
    (("quantity" IS NULL OR ("quantity" <> 'NaN'::numeric AND "quantity" > 0 AND "quantity" = round("quantity",4))) AND
     ("unitPrice" IS NULL OR ("unitPrice" <> 'NaN'::numeric AND "unitPrice" >= 0 AND "unitPrice" = round("unitPrice",4))) AND
     ("taxRate" IS NULL OR ("taxRate" BETWEEN 0 AND 100 AND "taxRate" = round("taxRate",4))))),
  ADD CONSTRAINT "ContractBillRow_decimal_fact_check" CHECK (
    "numericProtocolVersion" <> 2 OR "numericSource" <> 'decimal_input' OR
    CASE WHEN "quantity" IS NULL OR "unitPrice" IS NULL THEN "taxInclusiveAmountYuan" IS NULL AND "taxExclusiveAmountYuan" IS NULL AND "taxAmountYuan" IS NULL
    ELSE "taxInclusiveAmountYuan" IS NOT NULL AND "taxInclusiveAmountYuan" = round("quantity" * "unitPrice",4) AND
      CASE WHEN "taxRate" IS NULL THEN "taxExclusiveAmountYuan" IS NULL AND "taxAmountYuan" IS NULL
      ELSE "taxExclusiveAmountYuan" IS NOT NULL AND "taxAmountYuan" IS NOT NULL AND
        "taxExclusiveAmountYuan" = round("taxInclusiveAmountYuan" / (1 + "taxRate" / 100),4) AND
        "taxAmountYuan" = "taxInclusiveAmountYuan" - "taxExclusiveAmountYuan" END END),
  ADD CONSTRAINT "ContractBillRow_decimal_finite_check" CHECK (
    ("taxInclusiveAmountYuan" IS NULL OR "taxInclusiveAmountYuan" <> 'NaN'::numeric) AND
    ("taxExclusiveAmountYuan" IS NULL OR "taxExclusiveAmountYuan" <> 'NaN'::numeric) AND
    ("taxAmountYuan" IS NULL OR "taxAmountYuan" <> 'NaN'::numeric));

-- Original v1 predicate retained; explicit v2 permits four-place policy / real zero tax.
ALTER TABLE "ContractVersion" DROP CONSTRAINT "ContractVersion_default_tax_rate_check";
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_default_tax_rate_check" CHECK (
  ("numericProtocolVersion" = 1 AND (
    "defaultTaxRatePercent" IS NULL
    OR ("defaultTaxRatePercent" > 0 AND "defaultTaxRatePercent" <= 100)
  ))
  OR ("numericProtocolVersion" = 2 AND (
    "defaultTaxRatePercent" IS NULL
    OR ("defaultTaxRatePercent" > 0 AND "defaultTaxRatePercent" <= 100)
   OR ("defaultTaxRatePercent" = 0)))
) NOT VALID;

-- Original v1 predicate retained; explicit v2 permits four-place policy / real zero tax.
ALTER TABLE "ContractVersion" DROP CONSTRAINT "ContractVersion_confirmed_tax_facts_check";
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_confirmed_tax_facts_check" CHECK (
  ("numericProtocolVersion" = 1 AND (
    "taxFactStatus" <> 'confirmed'
    OR (
      "invoiceType" IS NOT NULL
      AND "defaultTaxRatePercent" IS NOT NULL
      AND "defaultTaxRatePercent" > 0
      AND "defaultTaxRatePercent" <= 100
    )
  ))
  OR ("numericProtocolVersion" = 2 AND (
    "taxFactStatus" <> 'confirmed'
    OR (
      "invoiceType" IS NOT NULL
      AND "defaultTaxRatePercent" IS NOT NULL
      AND "defaultTaxRatePercent" > 0
      AND "defaultTaxRatePercent" <= 100
    )
   OR ("taxFactStatus" <> 'confirmed' OR ("invoiceType" IS NOT NULL AND "defaultTaxRatePercent" IS NOT NULL AND "defaultTaxRatePercent" BETWEEN 0 AND 100))))
) NOT VALID;

-- Original v1 predicate retained; explicit v2 permits four-place policy / real zero tax.
ALTER TABLE "ContractBillRow" DROP CONSTRAINT "ContractBillRow_tax_rate_check";
ALTER TABLE "ContractBillRow" ADD CONSTRAINT "ContractBillRow_tax_rate_check" CHECK (
  ("numericProtocolVersion" = 1 AND ("taxRate" IS NULL OR ("taxRate" > 0 AND "taxRate" <= 100)))
  OR ("numericProtocolVersion" = 2 AND ("taxRate" IS NULL OR ("taxRate" > 0 AND "taxRate" <= 100) OR ("taxRate" = 0)))
) NOT VALID;

-- Original v1 predicate retained; explicit v2 permits four-place policy / real zero tax.
ALTER TABLE "ContractBillRow" DROP CONSTRAINT "ContractBillRow_precision_policy_check";
ALTER TABLE "ContractBillRow" ADD CONSTRAINT "ContractBillRow_precision_policy_check" CHECK (
  ("numericProtocolVersion" = 1 AND ("precisionPolicy" IN ('legacy', 'two_decimal')))
  OR ("numericProtocolVersion" = 2 AND ("precisionPolicy" IN ('legacy', 'two_decimal') OR ("precisionPolicy" = 'four_decimal')))
) NOT VALID;

-- Original v1 predicate retained; explicit v2 permits four-place policy / real zero tax.
ALTER TABLE "ContractBillRow" DROP CONSTRAINT "ContractBillRow_confirmed_pricing_facts_check";
ALTER TABLE "ContractBillRow" ADD CONSTRAINT "ContractBillRow_confirmed_pricing_facts_check" CHECK (
  ("numericProtocolVersion" = 1 AND (
    "pricingFactStatus" <> 'confirmed'
    OR (
      "unitPrice" IS NOT NULL
      AND "taxRate" IS NOT NULL
      AND "taxRate" > 0
      AND "taxRate" <= 100
    )
  ))
  OR ("numericProtocolVersion" = 2 AND (
    "pricingFactStatus" <> 'confirmed'
    OR (
      "unitPrice" IS NOT NULL
      AND "taxRate" IS NOT NULL
      AND "taxRate" > 0
      AND "taxRate" <= 100
    )
   OR ("pricingFactStatus" <> 'confirmed' OR ("unitPrice" IS NOT NULL AND "taxRate" IS NOT NULL AND "taxRate" BETWEEN 0 AND 100))))
) NOT VALID;

COMMIT;
