-- 仅新增结构，不推断或回填历史金额；生产执行另行授权。
BEGIN;
ALTER TABLE "ProjectAffiliateCompanyContract"
  ADD COLUMN "amountNature" TEXT NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN "amountCents" BIGINT;
ALTER TABLE "ProjectAffiliateCompanyContract" ADD CONSTRAINT "affiliate_company_contract_amount_shape"
  CHECK (("amountNature" = 'fixed' AND "amountCents" IS NOT NULL AND "amountCents" >= 0)
    OR ("amountNature" IN ('uncapped', 'unconfirmed') AND "amountCents" IS NULL));
-- 承诺增减与成本完全独立；保留旧 notice 引用的兼容读取。
ALTER TABLE "OperatingImpactEntry" DROP CONSTRAINT "OperatingImpactEntry_contract_commitment_reference_direction_check";
CREATE FUNCTION "protectAffiliateCompanyContractAmount"() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW."amountNature", NEW."amountCents") IS DISTINCT FROM ROW(OLD."amountNature", OLD."amountCents") THEN
    RAISE EXCEPTION '对上合同金额不可直接改写，请保留历史并办理更正' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ProjectAffiliateCompanyContract_protect_amount" BEFORE UPDATE ON "ProjectAffiliateCompanyContract"
  FOR EACH ROW EXECUTE FUNCTION "protectAffiliateCompanyContractAmount"();
COMMIT;
