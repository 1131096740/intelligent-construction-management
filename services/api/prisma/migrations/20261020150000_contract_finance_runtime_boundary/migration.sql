BEGIN;
-- Keep the original issuer private; only the secret-checked entry is callable by the runtime.
REVOKE ALL ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
CREATE FUNCTION public.issue_contract_bank_holder(
  request_id TEXT, actor_id TEXT, holder_file_id TEXT, signature_id TEXT,
  account_hash TEXT, write_secret TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(actor_id, write_secret);
  RETURN public.issue_contract_bank_holder(request_id, actor_id, holder_file_id, signature_id, account_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Existing immutable-table triggers continue to validate evidence, actor, amount and audit context.
CREATE FUNCTION public.record_verified_bank_observation(payload JSONB, write_secret TEXT)
RETURNS SETOF public."VerifiedBankTransactionObservation"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE entry public."VerifiedBankTransactionObservation";
BEGIN
  SELECT * INTO entry FROM jsonb_populate_record(NULL::public."VerifiedBankTransactionObservation", payload);
  PERFORM public."authorizeOperatingLedgerWrite"(entry."createdByUserId", write_secret);
  PERFORM set_config('app.fund_execution_actor', entry."createdByUserId", true);
  PERFORM set_config('app.fund_execution_request_id', entry."auditRequestId", true);
  PERFORM set_config('app.fund_execution_action', 'observe', true);
  entry."createdAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  RETURN QUERY INSERT INTO public."VerifiedBankTransactionObservation" SELECT entry.* RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.record_verified_bank_observation(JSONB,TEXT) FROM PUBLIC;

CREATE FUNCTION public.append_company_transfer_event(payload JSONB, write_secret TEXT)
RETURNS SETOF public."CompanyTransferEvent"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE entry public."CompanyTransferEvent";
BEGIN
  SELECT * INTO entry FROM jsonb_populate_record(NULL::public."CompanyTransferEvent", payload);
  PERFORM public."authorizeOperatingLedgerWrite"(entry."recordedByUserId", write_secret);
  entry."id" := public.gen_random_uuid()::TEXT;
  entry."createdAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  RETURN QUERY INSERT INTO public."CompanyTransferEvent" SELECT entry.* RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.append_company_transfer_event(JSONB,TEXT) FROM PUBLIC;
COMMIT;
