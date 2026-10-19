BEGIN;
CREATE TABLE "ContractEconomicReview" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
 "leftSourceRef" TEXT NOT NULL, "rightSourceRef" TEXT NOT NULL,
 "supersedesReviewId" TEXT REFERENCES "ContractEconomicReview"("id"),
 "targetSourceRef" TEXT, "targetVersionId" TEXT,
 "leftFingerprint" TEXT NOT NULL, "rightFingerprint" TEXT NOT NULL,
 "relation" TEXT NOT NULL CHECK ("relation" IN ('independent','supplement','replacement','shared_evidence')),
 "coverage" JSONB NOT NULL CHECK (jsonb_typeof("coverage") = 'array'),
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) > 0),
 "status" TEXT NOT NULL DEFAULT 'pending_review' CHECK ("status" IN ('pending_review','pending_finance','confirmed','returned')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "preparedByUserId" TEXT NOT NULL REFERENCES "User"("id"),
 "contractReviewedById" TEXT REFERENCES "User"("id"), "financeReviewedById" TEXT REFERENCES "User"("id"),
 "financeRequired" BOOLEAN NOT NULL DEFAULT false,
 "idempotencyKey" TEXT NOT NULL UNIQUE, "requestFingerprint" TEXT NOT NULL, "frozenSources" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmedAt" TIMESTAMP(3),
 "returnedAt" TIMESTAMP(3), "returnReason" TEXT,
 CHECK ("leftSourceRef" < "rightSourceRef"),
 CHECK ("contractReviewedById" IS NULL OR "contractReviewedById" <> "preparedByUserId"),
 CHECK ("financeReviewedById" IS NULL OR ("financeReviewedById" <> "preparedByUserId" AND "financeReviewedById" <> "contractReviewedById")),
 CHECK ("status" <> 'confirmed' OR ("confirmedAt" IS NOT NULL AND "contractReviewedById" IS NOT NULL AND (NOT "financeRequired" OR "financeReviewedById" IS NOT NULL)))
);
CREATE INDEX "ContractEconomicReview_projectId_leftSourceRef_rightSourceRef_sta_idx" ON "ContractEconomicReview"("projectId","leftSourceRef","rightSourceRef","status");
CREATE UNIQUE INDEX "ContractEconomicReview_one_live_pair" ON "ContractEconomicReview"("projectId","leftSourceRef","rightSourceRef","leftFingerprint","rightFingerprint") WHERE "status" IN ('pending_review','pending_finance');
CREATE FUNCTION "protectContractEconomicReview"() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD."status" IN ('confirmed','returned') THEN
  RAISE EXCEPTION '履约复核记录不可删除或覆盖，请保留历史' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW."targetSourceRef",NEW."targetVersionId",NEW."supersedesReviewId",NEW."projectId",NEW."leftSourceRef",NEW."rightSourceRef",NEW."leftFingerprint",NEW."rightFingerprint",NEW."relation",NEW."coverage",NEW."reason",NEW."preparedByUserId",NEW."idempotencyKey",NEW."requestFingerprint") IS DISTINCT FROM
    ROW(OLD."targetSourceRef",OLD."targetVersionId",OLD."supersedesReviewId",OLD."projectId",OLD."leftSourceRef",OLD."rightSourceRef",OLD."leftFingerprint",OLD."rightFingerprint",OLD."relation",OLD."coverage",OLD."reason",OLD."preparedByUserId",OLD."idempotencyKey",OLD."requestFingerprint") THEN
  RAISE EXCEPTION '已送审履约范围不可改写，请退回后重新发起' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ContractEconomicReview_immutable" BEFORE UPDATE OR DELETE ON "ContractEconomicReview" FOR EACH ROW EXECUTE FUNCTION "protectContractEconomicReview"();


CREATE TABLE "ContractEconomicSettlementCoverage" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id"),
 "sourceRef" TEXT NOT NULL UNIQUE, "contractRef" TEXT NOT NULL, "amountCents" BIGINT NOT NULL CHECK ("amountCents" <> 0),
 "reviewFingerprint" TEXT NOT NULL, "allocations" JSONB NOT NULL CHECK (jsonb_typeof("allocations") = 'array'),
 "preparedByUserId" TEXT NOT NULL REFERENCES "User"("id"), "status" TEXT NOT NULL DEFAULT 'prepared' CHECK ("status" IN ('prepared','confirmed')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmedAt" TIMESTAMP(3),
 CHECK (("status"='confirmed') = ("confirmedAt" IS NOT NULL))
);
CREATE INDEX "ContractEconomicSettlementCoverage_projectId_contractRef_status_idx" ON "ContractEconomicSettlementCoverage"("projectId","contractRef","status");
CREATE FUNCTION guard_contract_economic_settlement_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD."status" = 'confirmed' THEN RAISE EXCEPTION 'confirmed_economic_coverage_is_immutable'; END IF;
 IF NEW."sourceRef" <> OLD."sourceRef" OR NEW."projectId" <> OLD."projectId" OR NEW."contractRef" <> OLD."contractRef" THEN RAISE EXCEPTION 'economic_coverage_source_is_immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContractEconomicSettlementCoverage_immutable" BEFORE UPDATE OR DELETE ON "ContractEconomicSettlementCoverage" FOR EACH ROW EXECUTE FUNCTION guard_contract_economic_settlement_coverage();

COMMIT;
