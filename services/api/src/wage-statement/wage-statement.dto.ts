import type {
  WageCostComponentInput,
  WageCreditorBreakdownInput,
  WageProjectAllocationInput,
  WageStatementDraftInput
} from "./wage-statement.domain";

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
  projectAllocations: WageProjectAllocationInput[];
}

export interface CreateApprovedWageSourceDto {
  idempotencyKey: string;
  expectedRevision: number;
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

export interface WageStatementCommandDto {
  idempotencyKey: string;
  expectedRevision: number;
}

export interface ReturnWageStatementDto extends WageStatementCommandDto {
  reason: string;
}
