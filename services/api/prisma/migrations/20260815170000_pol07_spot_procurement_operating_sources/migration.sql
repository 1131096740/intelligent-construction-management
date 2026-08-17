-- POL-07 keeps invoice facts as traceable evidence without treating them as income or cost.
ALTER TABLE "OperatingImpactEntry"
  DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check",
  ADD CONSTRAINT "OperatingImpactEntry_impact_kind_check"
    CHECK ("impactKind" IN (
      'confirmed_income', 'confirmed_cost', 'estimated_clearing_expense',
      'receivable_increase', 'receivable_decrease', 'payable_increase', 'payable_decrease',
      'construction_enterprise_funds_increase', 'construction_enterprise_funds_decrease',
      'construction_enterprise_funds_freeze', 'construction_enterprise_funds_release',
      'company_project_funds_increase', 'company_project_funds_decrease',
      'company_advance_for_project_increase', 'company_advance_for_project_decrease',
      'company_returnable_to_project_increase', 'company_returnable_to_project_decrease',
      'inter_subject_balance_increase', 'inter_subject_balance_decrease',
      'temporary_profit_distribution', 'final_profit_distribution',
      'profit_distribution_adjustment', 'invoice_reference', 'evidence_gap_notice'
    )),
  ADD CONSTRAINT "OperatingImpactEntry_invoice_reference_direction_check"
    CHECK ("impactKind" <> 'invoice_reference' OR "direction" = 'notice');
