BEGIN;
REVOKE EXECUTE ON FUNCTION public.guard_payment_execution_payer_verification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.require_fund_movement_write_context() FROM PUBLIC;
COMMIT;
