import type {
  WageCostComponentInput,
  WageCreditorBreakdownInput,
  WageProjectAllocationInput,
  WageProjectCostComponentAllocationInput,
  WageProjectCreditorAllocationInput,
  WageStatementDraftInput
} from "./wage-statement.domain";

export type WageApprovedSourcePurpose = "ordinary" | "full_reversal";

export interface FullReversalTargetDto {
  statementId: string;
  priorConfirmedVersionId: string;
  priorConfirmedRevision: number;
  priorSourceVersionId: string;
}

export interface ApprovedWagePersonDto {
  employeeId: string;
  employmentSnapshotId: string;
  employmentCompanyId: string;
  employmentPeriodStart: string;
  employmentPeriodEnd: string;
  positionCategory: string;
  approvedAmountCents: string;
  costComponents: WageCostComponentInput[];
  creditorBreakdowns: WageCreditorBreakdownInput[];
  projectAllocations?: WageProjectAllocationInput[];
  projectCostComponentAllocations?: WageProjectCostComponentAllocationInput[];
  projectCreditorAllocations?: WageProjectCreditorAllocationInput[];
}

export interface CreateApprovedWageSourceDto {
  idempotencyKey: string;
  expectedRevision: number;
  sourcePurpose: WageApprovedSourcePurpose;
  fullReversalTarget?: FullReversalTargetDto;
  employmentCompanyId: string;
  wageMonth: string;
  periodStart: string;
  periodEnd: string;
  externalReference: string;
  sourceVersion: string;
  basisDate: string;
  evidenceFileId: string;
  approvedPersonLines: ApprovedWagePersonDto[];
}

export interface CreateWageStatementDraftDto extends WageStatementDraftInput {
  sourceVersionId: string;
  idempotencyKey: string;
  expectedRevision: number;
}

export interface UpdateWageStatementDraftDto extends WageStatementDraftInput {
  idempotencyKey: string;
  expectedRevision: number;
}

export interface WageStatementWorkbenchQueryDto {
  page?: number | string;
  pageSize?: number | string;
}

/**
 * A later frozen revision is never inferred from the previous version.  The
 * preparer supplies a new approved source and both complete finance matrices;
 * confirmation derives the immutable delta against the confirmed lineage.
 */
export interface CreateWageStatementRevisionDto extends WageStatementDraftInput {
  sourceVersionId: string;
  disposition: "supplemental" | "correction" | "reversal";
  idempotencyKey: string;
  expectedRevision: number;
}

export interface WageStatementCommandDto {
  idempotencyKey: string;
  expectedRevision: number;
}

export interface ReturnWageStatementDto extends WageStatementCommandDto {
  reason: string;
}
