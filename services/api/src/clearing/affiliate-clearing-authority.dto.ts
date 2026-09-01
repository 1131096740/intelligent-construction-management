export interface AffiliateClearingAuthorityCommandDto {
  idempotencyKey: string;
  expectedRevision: number;
  delegatorUserId?: string;
}

export interface CreateAssignedWageAuthorityLineDto {
  selectionRef: string;
  wageMonth: string;
  amountCents: string;
  amountMode: "CONFIRMED_AMOUNT" | "EXPLICIT_TYPED_PRORATION";
  amountRuleVersion: number;
  midMonthPolicy: "NOT_APPLICABLE" | "EXPLICIT_TYPED_RULE";
  evidenceCoordinate: string;
}

export interface CreateGuaranteeObligationVersionDto {
  selectionRef: string;
  baseAmountCents: string;
  calculationMode: "FIXED_AMOUNT" | "RATE_BPS";
  fixedAmountCents?: string;
  rateBps?: number;
  returnCondition: string;
  evidenceCoordinate?: string;
}

export interface CreateAffiliateClearingAuthorityDto extends AffiliateClearingAuthorityCommandDto {
  contractSelectionRef: string;
  effectiveFrom: string;
  effectiveTo?: string;
  evidenceRef: string;
  wageLines: CreateAssignedWageAuthorityLineDto[];
  guaranteeObligations: CreateGuaranteeObligationVersionDto[];
}

export interface AuthorityLifecycleDto extends AffiliateClearingAuthorityCommandDto {
  reason?: string;
}

export interface AuthorityClearingCaseSelectionDto extends AffiliateClearingAuthorityCommandDto {
  selectionRef: string;
  guaranteeTrancheAmountCents?: string;
}
