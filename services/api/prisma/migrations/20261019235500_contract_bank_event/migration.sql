BEGIN;
ALTER TABLE "ProjectUpstreamFundFact" ADD COLUMN "bankObservationReference" TEXT;
CREATE TABLE "ContractBankEventClaim"("observationId" TEXT PRIMARY KEY REFERENCES "VerifiedBankTransactionObservation"("id"),"sourceType" TEXT NOT NULL CHECK("sourceType" IN ('payment_execution','project_upstream_fund_fact')),"sourceId" TEXT NOT NULL,"createdByUserId" TEXT NOT NULL REFERENCES "User"("id"),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("sourceType","sourceId"));
CREATE FUNCTION guard_contract_bank_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observation "VerifiedBankTransactionObservation"%ROWTYPE; payment "PaymentExecution"%ROWTYPE; remittance "ProjectUpstreamFundFact"%ROWTYPE; company_id TEXT; amount BIGINT; event_date TIMESTAMP; direction TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'contract_bank_event_immutable'; END IF;
 SELECT * INTO observation FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "BankTransactionClaim" WHERE "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF;
 IF NEW."sourceType"='payment_execution' THEN
  SELECT * INTO payment FROM "PaymentExecution" WHERE "id"=NEW."sourceId";
  SELECT "holderCompanyEntityId" INTO company_id FROM "PaymentExecutionPayerAttestation" WHERE "paymentExecutionId"=payment."id";
  company_id:=coalesce(company_id,payment."companyEntityIdSnapshot"); amount:=payment."amountCents"; event_date:=payment."paidAt"; direction:='outflow';
 ELSE
  SELECT * INTO remittance FROM "ProjectUpstreamFundFact" WHERE "id"=NEW."sourceId";
  IF remittance."factType"<>'affiliate_remittance_to_company' OR remittance."bankObservationReference" IS DISTINCT FROM observation."reference" THEN RAISE EXCEPTION 'bank_remittance_source_mismatch'; END IF;
  company_id:=remittance."companyEntityId"; amount:=remittance."amountCents"; event_date:=remittance."occurredAt"; direction:=CASE WHEN remittance."effectDirection"='decrease' THEN 'outflow' ELSE 'inflow' END;
 END IF;
 IF company_id IS NULL OR company_id<>observation."holderCompanyEntityId" OR amount<>observation."amountCents" OR direction<>observation."direction" OR (event_date+interval '8 hours')::date<>(observation."occurredAt"+interval '8 hours')::date THEN RAISE EXCEPTION 'bank_event_source_mismatch'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContractBankEventClaim_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ContractBankEventClaim" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_event();
CREATE FUNCTION guard_other_bank_claim_against_contract_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "ContractBankEventClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "BankTransactionClaim_contract_event" BEFORE INSERT ON "BankTransactionClaim" FOR EACH ROW EXECUTE FUNCTION guard_other_bank_claim_against_contract_event();
CREATE TRIGGER "ContractProxyBankClaim_contract_event" BEFORE INSERT ON "ContractProxyBankClaim" FOR EACH ROW EXECUTE FUNCTION guard_other_bank_claim_against_contract_event();
COMMIT;
