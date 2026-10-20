BEGIN;
-- Same legal enterprise and bank reference identify one outflow across projects and entry points.
-- Reserve pending entries as well; returned drafts release the reference. Corrections keep the original event.
CREATE FUNCTION enterprise_bank_party(version_id TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT "businessPartyId" FROM "BusinessPartyVersion" WHERE "id"=version_id $$;
CREATE FUNCTION enterprise_bank_reference(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(normalize(value,NFKC),'[[:space:]]','','g')) $$;
CREATE FUNCTION guard_enterprise_bank_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE party TEXT; reference TEXT;
BEGIN
 IF NEW."status"='returned' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='ContractProxyExecution' THEN
  IF NEW."entryKind"<>'payment' OR NEW."frozenSource"->'actualPayer'->>'kind'<>'construction_enterprise' THEN RETURN NEW; END IF;
  party:=enterprise_bank_party(NEW."frozenSource"->'actualPayer'->>'id'); reference:=enterprise_bank_reference(NEW."bankReference");
 ELSE
  IF NEW."entryKind"<>'original' THEN RETURN NEW; END IF;
  party:=enterprise_bank_party(NEW."affiliateBusinessPartyVersionId"); reference:=enterprise_bank_reference(NEW."externalPaymentReference");
 END IF;
 IF party IS NULL OR reference IS NULL OR reference='' THEN RAISE EXCEPTION 'enterprise_bank_identity_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('enterprise-bank:'||party||':'||reference,0));
 IF EXISTS(SELECT 1 FROM "ProjectAffiliatePaymentFact" p WHERE (TG_TABLE_NAME<>'ProjectAffiliatePaymentFact' OR p."id"<>NEW."id") AND p."status"<>'returned' AND p."entryKind"='original' AND enterprise_bank_party(p."affiliateBusinessPartyVersionId")=party AND enterprise_bank_reference(p."externalPaymentReference")=reference)
 OR EXISTS(SELECT 1 FROM "ContractProxyExecution" p WHERE (TG_TABLE_NAME<>'ContractProxyExecution' OR p."id"<>NEW."id") AND p."status"<>'returned' AND p."entryKind"='payment' AND p."frozenSource"->'actualPayer'->>'kind'='construction_enterprise' AND enterprise_bank_party(p."frozenSource"->'actualPayer'->>'id')=party AND enterprise_bank_reference(p."bankReference")=reference)
 THEN RAISE EXCEPTION '施工企业该银行流水已登记，不得跨入口重复付款'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectAffiliatePaymentFact_bank_event" BEFORE INSERT OR UPDATE ON "ProjectAffiliatePaymentFact" FOR EACH ROW EXECUTE FUNCTION guard_enterprise_bank_event();
CREATE TRIGGER "ContractProxyExecution_bank_event" BEFORE INSERT OR UPDATE ON "ContractProxyExecution" FOR EACH ROW EXECUTE FUNCTION guard_enterprise_bank_event();
COMMIT;
