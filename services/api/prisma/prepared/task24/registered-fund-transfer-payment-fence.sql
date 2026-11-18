-- Apply after Task16 registered-funding only on the #406 successor.
-- The exact historical Task16 installation files remain byte-identical.
CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_transfer_capacity"
 AFTER INSERT ON public."RegisteredFundPaymentAllocation"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 EXECUTE FUNCTION public."jg_registered_fund_transfer_account_trigger"();
