import type { ClearingCategory, ClearingEventKind } from "@jiangkong/shared-domain";

export interface ClearingCommandDto {
  idempotencyKey: string;
  expectedRevision: number;
  delegatorUserId?: string;
}

export interface CreateClearingCaseDto extends ClearingCommandDto {
  projectId?: string;
  constructionEnterpriseAssignmentId?: string;
  category: ClearingCategory;
  governedSubjectKey?: string;
  authoritativeGrossCapCents?: string;
  authoritySelectionRef?: string;
  guaranteeTrancheAmountCents?: string;
}

export interface CreateClearingEventDto extends ClearingCommandDto {
  kind: ClearingEventKind;
  amountCents?: string;
  evidenceLevel?: "A" | "B";
  payableRef?: string;
  payload?: Record<string, unknown>;
  businessReason?: string;
  evidenceRef?: string;
}

export interface SubmitClearingEventDto extends ClearingCommandDto {}

export interface AttestClearingEventDto extends ClearingCommandDto {}

export interface ClearingAllocationDto {
  sourceEventVersionId?: string;
  sourceSelectionRef?: string;
  sourceKind: "authority_cap" | "withheld" | "final_confirmed" | "supplemental";
  amountCents: string;
}

export interface ConfirmClearingEventDto extends ClearingCommandDto {
  allocations: ClearingAllocationDto[];
  pairedWithheldAmountCents?: string;
}

export interface ReturnClearingEventDto extends ClearingCommandDto {
  reason: string;
}

export interface ReopenClearingEventDto extends ClearingCommandDto {
  reason: string;
}
