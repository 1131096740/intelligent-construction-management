import type { ContractClauseDefinition } from "@jiangkong/shared-domain";

export interface SaveContractDraftDto {
  expectedRevision: number;
  draftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
  pricingNature: "fixed_total" | "provisional_total" | "unit_price" | "framework";
  amountSource: "bill_sum" | "manual";
  manualAmountCents?: number;
  amountAdjustmentReason?: string;
  layoutTemplateVersionId?: string;
  paymentTermsOriginalText?: string;
  paymentStages?: Array<{
    name: string;
    basis: "current_settlement";
    ratioBps: number;
    triggerEvent: string;
    dueDays: number;
    requiresInvoice: boolean;
    allowsInstallments: boolean;
    originalText: string;
  }>;
}

export interface CreateDraftCheckpointDto {
  name?: string;
}

export interface VoidDraftDto {
  reason: string;
}

export interface PreviewContractTypeChangeDto {
  targetBusinessTemplateVersionId: string;
  expectedRevision: number;
}

export interface ApplyContractTypeChangeDto extends PreviewContractTypeChangeDto {
  confirmed: true;
}

export interface TransferContractDraftDto {
  toUserId: string;
}
