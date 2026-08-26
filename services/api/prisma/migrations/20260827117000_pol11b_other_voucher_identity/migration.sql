ALTER TABLE "InvoiceRecord" ADD COLUMN "voucherType" TEXT;

ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_other_voucher_type_check"
CHECK (
  ("identityKind" = 'other' AND "voucherType" IS NOT NULL AND btrim("voucherType") <> '')
  OR "identityKind" <> 'other'
);

CREATE OR REPLACE FUNCTION "prevent_global_invoice_voucher_type_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."sourceBusinessType" IN ('global_clearing_invoice', 'global_clearing_invoice_red', 'global_clearing_invoice_reissue')
     AND NEW."voucherType" IS DISTINCT FROM OLD."voucherType" THEN
    RAISE EXCEPTION 'global invoice legal facts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceRecord_global_voucher_type_immutable"
BEFORE UPDATE ON "InvoiceRecord"
FOR EACH ROW EXECUTE FUNCTION "prevent_global_invoice_voucher_type_mutation"();
