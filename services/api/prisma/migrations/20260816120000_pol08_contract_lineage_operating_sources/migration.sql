BEGIN;

ALTER TABLE "ProjectAffiliateSettlementFact"
  ADD COLUMN "affiliateCompanyContractId" TEXT;

CREATE INDEX "ProjectAffiliateSettlementFact_affiliateCompanyContractId_idx"
  ON "ProjectAffiliateSettlementFact"("affiliateCompanyContractId");

ALTER TABLE "OperatingFact"
  DROP CONSTRAINT "OperatingFact_fact_kind_check",
  ADD CONSTRAINT "OperatingFact_fact_kind_check"
    CHECK ("factKind" IN (
      'owner_settlement', 'owner_payment', 'downstream_contract', 'downstream_settlement',
      'downstream_payment', 'expense', 'employee_loan', 'project_wage',
      'construction_enterprise_deduction', 'invoice', 'fund_movement',
      'profit_distribution', 'historical_gap'
    )),
  DROP CONSTRAINT "OperatingFact_amount_kind_check",
  ADD CONSTRAINT "OperatingFact_amount_kind_check"
    CHECK ("factKind" IN ('historical_gap', 'downstream_contract') OR "amountCents" > 0);

ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check",
  ADD CONSTRAINT "OperatingImpactEntry_impact_kind_check"
    CHECK ("impactKind" IN (
      'confirmed_income', 'confirmed_cost', 'contract_commitment_reference',
      'estimated_clearing_expense', 'receivable_increase', 'receivable_decrease',
      'payable_increase', 'payable_decrease', 'construction_enterprise_funds_increase',
      'construction_enterprise_funds_decrease', 'construction_enterprise_funds_freeze',
      'construction_enterprise_funds_release', 'company_project_funds_increase',
      'company_project_funds_decrease', 'company_advance_for_project_increase',
      'company_advance_for_project_decrease', 'company_returnable_to_project_increase',
      'company_returnable_to_project_decrease', 'inter_subject_balance_increase',
      'inter_subject_balance_decrease', 'temporary_profit_distribution',
      'final_profit_distribution', 'profit_distribution_adjustment', 'invoice_reference',
      'evidence_gap_notice'
    )),
  DROP CONSTRAINT "OperatingImpactEntry_amount_kind_check",
  ADD CONSTRAINT "OperatingImpactEntry_amount_kind_check"
    CHECK ("impactKind" IN ('evidence_gap_notice', 'contract_commitment_reference') OR "amountCents" > 0),
  ADD CONSTRAINT "OperatingImpactEntry_contract_commitment_reference_direction_check"
    CHECK ("impactKind" <> 'contract_commitment_reference' OR "direction" = 'notice');

CREATE OR REPLACE FUNCTION "validateDownstreamContractReferences"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."factKind" = 'downstream_contract'
     AND (NEW."debtorSubjectKind" IS NULL OR NEW."creditorSubjectKind" IS NULL) THEN
    RAISE EXCEPTION '下游合同事实必须填写债务主体和债权主体' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperatingFact_validate_downstream_contract_references"
  BEFORE INSERT ON "OperatingFact"
  FOR EACH ROW EXECUTE FUNCTION "validateDownstreamContractReferences"();

COMMIT;
