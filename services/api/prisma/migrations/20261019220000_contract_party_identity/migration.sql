BEGIN;
ALTER TABLE "ProjectAffiliateContractFact" ADD COLUMN "counterpartyVersionId" TEXT REFERENCES "BusinessPartyVersion"("id");
CREATE FUNCTION guard_external_contract_party_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."counterpartyVersionId" IS DISTINCT FROM OLD."counterpartyVersionId" THEN RAISE EXCEPTION 'external_contract_party_snapshot_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectAffiliateContractFact_identity_immutable" BEFORE UPDATE ON "ProjectAffiliateContractFact" FOR EACH ROW EXECUTE FUNCTION guard_external_contract_party_identity();
COMMIT;
