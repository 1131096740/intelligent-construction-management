BEGIN;
ALTER TABLE "ContractProxyExecution" ADD COLUMN "bankObservationId" TEXT REFERENCES "VerifiedBankTransactionObservation"("id");
ALTER TABLE "ContractProxyExecution" ADD COLUMN "receivingBankObservationId" TEXT REFERENCES "VerifiedBankTransactionObservation"("id");
CREATE TABLE "ContractProxyBankClaim"("observationId" TEXT PRIMARY KEY REFERENCES "VerifiedBankTransactionObservation"("id"),"proxyExecutionId" TEXT NOT NULL REFERENCES "ContractProxyExecution"("id"),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION guard_contract_proxy_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "ContractProxyExecution"%ROWTYPE; observation "VerifiedBankTransactionObservation"%ROWTYPE; holder JSONB; expected_direction TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'contract_proxy_bank_claim_immutable'; END IF;
 SELECT * INTO observation FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "BankTransactionClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF;
 SELECT * INTO source FROM "ContractProxyExecution" WHERE "id"=NEW."proxyExecutionId";
 holder:=CASE WHEN source."entryKind"='repayment' AND source."frozenSource"->'debtor'->>'kind'='participating_company' THEN source."frozenSource"->'debtor' ELSE source."frozenSource"->'actualPayer' END;
 expected_direction:=CASE WHEN source."entryKind"='payment' OR (source."entryKind"='repayment' AND source."frozenSource"->'debtor'->>'kind'='participating_company') THEN 'outflow' ELSE 'inflow' END;
 IF NEW."observationId"=source."receivingBankObservationId" THEN
  IF source."entryKind"<>'repayment' OR source."frozenSource"->'debtor'->>'kind'<>'participating_company' THEN RAISE EXCEPTION 'receiving_claim_not_applicable'; END IF;
  holder:=source."frozenSource"->'actualPayer'; expected_direction:='inflow';
 END IF;
 IF source."status"<>'pending_confirm' OR (source."bankObservationId" IS DISTINCT FROM NEW."observationId" AND source."receivingBankObservationId" IS DISTINCT FROM NEW."observationId") OR holder->>'kind'<>'participating_company' OR holder->>'id' IS DISTINCT FROM observation."holderCompanyEntityId" OR source."amountCents"<>observation."amountCents" OR expected_direction<>observation."direction" OR ((source."occurredAt"+interval '8 hours')::date<>(observation."occurredAt"+interval '8 hours')::date) THEN RAISE EXCEPTION 'contract_proxy_bank_claim_identity_mismatch'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContractProxyBankClaim_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ContractProxyBankClaim" FOR EACH ROW EXECUTE FUNCTION guard_contract_proxy_bank_claim();
CREATE FUNCTION guard_bank_claim_against_contract_proxy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "BankTransactionClaim_contract_proxy_guard" BEFORE INSERT ON "BankTransactionClaim" FOR EACH ROW EXECUTE FUNCTION guard_bank_claim_against_contract_proxy();
CREATE FUNCTION require_contract_proxy_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE holder JSONB;
BEGIN
 IF NEW."status"='confirmed' THEN
  holder:=CASE WHEN NEW."entryKind"='repayment' AND NEW."frozenSource"->'debtor'->>'kind'='participating_company' THEN NEW."frozenSource"->'debtor' ELSE NEW."frozenSource"->'actualPayer' END;
  IF holder->>'kind'='participating_company' AND NOT EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "proxyExecutionId"=NEW."id" AND "observationId"=NEW."bankObservationId") THEN RAISE EXCEPTION 'contract_proxy_verified_bank_claim_required'; END IF;
  IF NEW."entryKind"='repayment' AND NEW."frozenSource"->'debtor'->>'kind'='participating_company' AND NEW."frozenSource"->'actualPayer'->>'kind'='participating_company' AND NOT EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "proxyExecutionId"=NEW."id" AND "observationId"=NEW."receivingBankObservationId") THEN RAISE EXCEPTION 'contract_proxy_receiving_bank_claim_required'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "ContractProxyExecution_bank_required" BEFORE INSERT OR UPDATE ON "ContractProxyExecution" FOR EACH ROW EXECUTE FUNCTION require_contract_proxy_bank_claim();
COMMIT;
