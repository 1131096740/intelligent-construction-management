/** 签约关系与付款方、合同业务类型互相独立。缺少真实主体时不得默认为表内。 */
export const CONTRACT_RELATIONSHIP_LABELS = Object.freeze({
  inside: "表内（我方签约）",
  outside: "表外（施工企业签约）",
  upward: "对上（施工企业—我方）",
  owner: "业主合同",
  unclassified: "待确认分类",
  non_contract: "非合同业务"
});
export type ContractRelationship = keyof typeof CONTRACT_RELATIONSHIP_LABELS;
export interface ContractSigningIdentity {
  signingSubjectType?: string | null;
  companyEntityIdSnapshot?: string | null;
  companyEntityVersionId?: string | null;
  affiliateAssignmentId?: string | null;
  affiliateBusinessPartyVersionId?: string | null;
}
export function downstreamContractRelationship(identity: ContractSigningIdentity): ContractRelationship {
  if (identity.signingSubjectType === "our_company" &&
      (identity.companyEntityIdSnapshot || identity.companyEntityVersionId)) return "inside";
  if (identity.signingSubjectType === "affiliate" && identity.affiliateAssignmentId &&
      identity.affiliateBusinessPartyVersionId) return "outside";
  return "unclassified";
}
export function contractRelationshipLabel(value: ContractRelationship): string {
  return CONTRACT_RELATIONSHIP_LABELS[value];
}
export function isContractRelationship(value: unknown): value is ContractRelationship {
  return typeof value === "string" && Object.hasOwn(CONTRACT_RELATIONSHIP_LABELS, value);
}

/** 从冻结的来源读取分类，绝不从实际付款方反推签约关系。 */
export function operatingContractRelationship(sourceType: string, snapshot: unknown, depth = 0): ContractRelationship {
  if (depth > 8) return "unclassified";
  const source = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  if (source.authority === "contract_takeover_append_only_correction" && source.originalSnapshot && typeof source.originalSnapshot === "object") {
    const original = source.originalSnapshot as Record<string, unknown>;
    return operatingContractRelationship(typeof original.sourceType === "string" ? original.sourceType : sourceType, original.sourceSnapshot, depth + 1);
  }
  if (isContractRelationship(source.contractRelationship)) return source.contractRelationship;
  if (["project_upstream_settlement", "owner_settlement"].includes(sourceType) || source.factType === "owner_payment_to_affiliate") return "owner";
  if (source.affiliateCompanyContractId || source.factType === "affiliate_remittance_to_company") return "upward";
  if (["project_affiliate_contract_fact", "project_affiliate_settlement_fact", "project_affiliate_payment_fact"].includes(sourceType)) return "outside";
  const affiliate = source.affiliate && typeof source.affiliate === "object" ? source.affiliate as Record<string, unknown> : {};
  if (["contract_version", "settlement", "payment_execution", "contract_takeover_historical_payment", "project_proxy_payment"].includes(sourceType)) {
    return downstreamContractRelationship({
      signingSubjectType: typeof source.signingSubjectType === "string" ? source.signingSubjectType : null,
      companyEntityVersionId: typeof source.companyEntityVersionId === "string" ? source.companyEntityVersionId : null,
      companyEntityIdSnapshot: typeof source.companyEntityIdSnapshot === "string" ? source.companyEntityIdSnapshot : null,
      affiliateAssignmentId: typeof affiliate.assignmentId === "string" ? affiliate.assignmentId : null,
      affiliateBusinessPartyVersionId: typeof affiliate.businessPartyVersionId === "string" ? affiliate.businessPartyVersionId : null
    });
  }
  return ["project_upstream_fund_fact", "expense_claim_approval", "expense_claim_payment_execution", "employee_project_loan_entry",
    "spot_procurement_receipt_review", "spot_procurement_payment_execution", "spot_procurement_refund", "spot_procurement_invoice_record",
    "project_expense_execution", "expense_claim", "expense_claim_execution", "wage_statement_version", "fund_movement", "fund_execution",
    "clearing_event_version", "project_necessary_expense_reserve_entry", "project_fund_dispute_entry"].includes(sourceType) ? "non_contract" : "unclassified";
}
