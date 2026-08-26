CREATE OR REPLACE FUNCTION "prevent_global_invoice_legal_fact_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."sourceBusinessType" IN ('global_clearing_invoice', 'global_clearing_invoice_red', 'global_clearing_invoice_reissue')
     AND (
       NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."identityKey" IS DISTINCT FROM OLD."identityKey"
       OR NEW."identityKind" IS DISTINCT FROM OLD."identityKind"
       OR NEW."owningCompanyEntityId" IS DISTINCT FROM OLD."owningCompanyEntityId"
       OR NEW."direction" IS DISTINCT FROM OLD."direction"
       OR NEW."invoiceType" IS DISTINCT FROM OLD."invoiceType"
       OR NEW."invoiceCode" IS DISTINCT FROM OLD."invoiceCode"
       OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
       OR NEW."externalIdentifier" IS DISTINCT FROM OLD."externalIdentifier"
       OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
       OR NEW."sellerName" IS DISTINCT FROM OLD."sellerName"
       OR NEW."sellerTaxId" IS DISTINCT FROM OLD."sellerTaxId"
       OR NEW."buyerName" IS DISTINCT FROM OLD."buyerName"
       OR NEW."buyerTaxId" IS DISTINCT FROM OLD."buyerTaxId"
       OR NEW."taxExclusiveAmountCents" IS DISTINCT FROM OLD."taxExclusiveAmountCents"
       OR NEW."taxAmountCents" IS DISTINCT FROM OLD."taxAmountCents"
       OR NEW."totalAmountCents" IS DISTINCT FROM OLD."totalAmountCents"
       OR NEW."allocatableAmountCents" IS DISTINCT FROM OLD."allocatableAmountCents"
       OR NEW."fileId" IS DISTINCT FROM OLD."fileId"
       OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId"
       OR NEW."sourceBusinessType" IS DISTINCT FROM OLD."sourceBusinessType"
       OR NEW."sourceBusinessId" IS DISTINCT FROM OLD."sourceBusinessId"
       OR NEW."sourceProcurementId" IS DISTINCT FROM OLD."sourceProcurementId"
       OR NEW."commandIdempotencyKey" IS DISTINCT FROM OLD."commandIdempotencyKey"
       OR NEW."commandFingerprint" IS DISTINCT FROM OLD."commandFingerprint"
     ) THEN
    RAISE EXCEPTION 'global invoice legal facts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceRecord_global_legal_fact_immutable"
BEFORE UPDATE ON "InvoiceRecord"
FOR EACH ROW EXECUTE FUNCTION "prevent_global_invoice_legal_fact_mutation"();
