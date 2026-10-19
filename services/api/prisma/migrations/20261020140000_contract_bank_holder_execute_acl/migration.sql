-- Forward-only ACL repair. Preserve the latest issuer body and all business facts.
-- Runtime EXECUTE is separately granted by the owner deployment step.
REVOKE ALL ON FUNCTION public.issue_contract_bank_holder(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
-- Preserve the existing production boundary on the older context guard as well.
-- Otherwise a fresh installation cannot pass the same complete-backup preflight.
REVOKE ALL ON FUNCTION public.assert_fund_movement_write_context() FROM PUBLIC;
