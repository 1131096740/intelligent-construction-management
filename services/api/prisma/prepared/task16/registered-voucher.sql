-- PREPARED WIP only, executed=false. Requires the funding/canonical composition.
-- It is not in migrations and must not be run or promoted independently.
-- Extend the latest registry through its existing wrapper chain; do not replace
-- it with the 202607 registry and lose newer business file bindings.
ALTER FUNCTION public.jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_registered_payment;
CREATE FUNCTION public.jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT * FROM public.jg_file_business_binding_columns_before_registered_payment()
 UNION ALL VALUES ('RegisteredPaymentVoucher','fileId',TRUE);
$$;
CREATE TRIGGER jg_efb_registered_payment_voucher BEFORE INSERT ON public."RegisteredPaymentVoucher"
 FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId','true');

CREATE FUNCTION public."jg_registered_payment_voucher_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payment public."PaymentExecution"; file public."FileObject";
BEGIN
 SELECT * INTO STRICT payment FROM public."PaymentExecution" WHERE "id" = NEW."executionId" FOR UPDATE;
 IF payment."voucherFileId" IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public."RegisteredPaymentFunding" WHERE "executionId" = payment."id") THEN
   RAISE EXCEPTION 'supplemental evidence requires the same registered pending-voucher payment';
 END IF;
 -- Same business-row -> shared file advisory -> FileObject lock order as the service.
 PERFORM pg_catalog.pg_advisory_xact_lock(190731,13);
 SELECT * INTO STRICT file FROM public."FileObject" WHERE "id" = NEW."fileId" FOR UPDATE;
 IF file."storageStatus" IS DISTINCT FROM 'active' OR file."contentSha256" IS DISTINCT FROM NEW."contentSha256" OR
    file."uploadedByUserId" IS DISTINCT FROM NEW."uploadedByUserId" OR file."supersedesFileObjectId" IS NOT NULL OR
    NOT EXISTS (SELECT 1 FROM public."User" WHERE "id" = NEW."uploadedByUserId" AND "isActive" = TRUE) THEN
   RAISE EXCEPTION 'supplemental voucher requires the current uploader private immutable file identity';
 END IF;
 -- The exclusive-binding trigger takes the shared file lock and rechecks all
 -- existing domains. No empty file identifier or client source flag is proof.
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredPaymentVoucher_insert" BEFORE INSERT ON public."RegisteredPaymentVoucher"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_voucher_insert"();
-- PaymentExecution and OperatingFact/Impact append-only triggers are untouched.

CREATE FUNCTION public."jg_registered_payment_voucher_file_immutable"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."RegisteredPaymentVoucher" WHERE "fileId" = OLD."id") THEN
   IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'registered payment voucher metadata is immutable'; END IF;
   IF pg_catalog.to_jsonb(NEW) IS DISTINCT FROM pg_catalog.to_jsonb(OLD) THEN RAISE EXCEPTION 'registered payment voucher metadata is immutable'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER "RegisteredPaymentVoucher_file_immutable" BEFORE UPDATE OR DELETE ON public."FileObject" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_voucher_file_immutable"();

-- Runtime resolution for only the legacy authority functions patched above.
ALTER FUNCTION public."jg_file_business_binding_columns_before_registered_payment"() SET search_path TO pg_catalog, public, pg_temp;
-- This existing trigger function is attached directly to the new voucher row,
-- not called through a new fixed-path function. Keep its body/registry intact
-- while binding the reused authority to formal schemas at runtime.
ALTER FUNCTION public.jg_enforce_exclusive_file_business_binding() SET search_path TO pg_catalog, public, pg_temp;
